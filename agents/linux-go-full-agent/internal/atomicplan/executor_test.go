package atomicplan

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestExecuteReplacesFileAndReusesLedger(t *testing.T) {
	target := filepath.Join(t.TempDir(), "server.pem")
	dataDir := t.TempDir()
	plan := testPlan(target, time.Now().Add(time.Minute))
	payload := map[string]any{"plan": planMap(t, signPlan(t, plan))}

	first := Execute(context.Background(), payload, "agent-1", dataDir)
	if !first.Success {
		t.Fatalf("首次执行失败: %s %s", first.ErrorCode, first.ErrorMessage)
	}
	content, err := os.ReadFile(target)
	if err != nil || string(content) != "certificate" {
		t.Fatalf("证书文件未正确替换: %v %q", err, string(content))
	}
	second := Execute(context.Background(), payload, "agent-1", dataDir)
	if !second.Success || second.Detail["cached"] != true {
		t.Fatalf("幂等账本未命中: %#v", second)
	}
}

func TestExecuteRejectsTamperedAndExpiredPlans(t *testing.T) {
	plan := signPlan(t, testPlan(filepath.Join(t.TempDir(), "server.pem"), time.Now().Add(time.Minute)))
	plan.Operations[0].Input["content"] = "tampered"
	tampered := Execute(context.Background(), map[string]any{"plan": planMap(t, plan)}, "agent-1", t.TempDir())
	if tampered.ErrorCode != "AGENT_PLAN_SIGNATURE_INVALID" {
		t.Fatalf("篡改计划未被拒绝: %#v", tampered)
	}

	expiredPlan := signPlan(t, testPlan(filepath.Join(t.TempDir(), "server.pem"), time.Now().Add(-time.Minute)))
	expired := Execute(context.Background(), map[string]any{"plan": planMap(t, expiredPlan)}, "agent-1", t.TempDir())
	if expired.ErrorCode != "AGENT_PLAN_EXPIRED" {
		t.Fatalf("过期计划未被拒绝: %#v", expired)
	}
}

func TestExecuteVerifiesOriginalPlanFieldsBeforeTypedParsing(t *testing.T) {
	target := filepath.Join(t.TempDir(), "server.pem")
	plan := planMap(t, testPlan(target, time.Now().Add(time.Minute)))
	permissions := plan["permissions"].([]any)
	permissions[0].(map[string]any)["risk"] = "high"
	operations := plan["operations"].([]any)
	operations[0].(map[string]any)["dependsOn"] = []any{}
	operations[0].(map[string]any)["continueOnError"] = false
	plan["authorization"] = map[string]any{
		"keyId":     "agent-plan-v1",
		"signature": signRawPlan(plan),
	}

	result := Execute(context.Background(), map[string]any{"plan": plan}, "agent-1", t.TempDir())
	if !result.Success {
		t.Fatalf("包含扩展协议字段的原始计划应通过验签: %#v", result)
	}
}

func TestVerifyAcceptsTypeScriptCanonicalSignatureVector(t *testing.T) {
	const fixture = `{
		"apiVersion":"gcac.agent-plan/v1",
		"planId":"cross-plan-1",
		"tenantId":"tenant-1",
		"agentId":"agent-1",
		"executionRunId":"run-1",
		"executionStepId":"step-1",
		"plugin":{"pluginPackageId":"plugin-1","pluginVersionId":"plugin-1","packageHash":"sha256:<package>&hash","manifestHash":"sha256:manifest"},
		"issuedAt":"2026-07-28T14:00:00.000Z",
		"expiresAt":"2026-07-28T15:00:00.000Z",
		"idempotencyKey":"idem-1",
		"permissions":[{"name":"files","description":"证书<&>","risk":"high","scope":"filesystem","values":["/tmp/*"]}],
		"variablesDigest":"sha256:variables",
		"operations":[{"id":"check","name":"check","stage":"prepare","operationType":"preflight.assert","schemaVersion":"1.0","dependsOn":[],"continueOnError":false,"input":{"path":"/tmp/<cert>&.pem","port":443}}],
		"rollback":[],
		"authorization":{"keyId":"agent-plan-v1","signature":"e58d03c815cd2ca10e38ddb23294383d863cb180e2557f9ad1719a08a2bb3f01"}
	}`
	var plan map[string]any
	if err := json.Unmarshal([]byte(fixture), &plan); err != nil {
		t.Fatal(err)
	}
	if err := verify(plan); err != nil {
		t.Fatalf("Linux Agent 必须接受 TypeScript canonical 签名向量: %v", err)
	}
}

func TestPreflightPlanPreviewsAtomicReplaceWithoutMutation(t *testing.T) {
	target := filepath.Join(t.TempDir(), "server.pem")
	if err := os.WriteFile(target, []byte("old-certificate"), 0o600); err != nil {
		t.Fatal(err)
	}
	plan := testPlan(target, time.Now().Add(time.Minute))
	plan.ExecutionMode = "PREFLIGHT"
	result := Execute(context.Background(), map[string]any{"plan": planMap(t, signPlan(t, plan))}, "agent-1", t.TempDir())
	if !result.Success {
		t.Fatalf("PREFLIGHT 应成功返回预演结果: %#v", result)
	}
	content, err := os.ReadFile(target)
	if err != nil || string(content) != "old-certificate" {
		t.Fatalf("PREFLIGHT 不得修改目标文件: err=%v content=%q", err, string(content))
	}
	results, ok := result.Detail["operationResults"].([]OperationResult)
	if !ok || len(results) != 1 {
		t.Fatalf("PREFLIGHT 应返回逐操作结果: %#v", result.Detail)
	}
	if results[0].Detail["mutating"] != false || results[0].Detail["plannedAction"] != "atomic_replace" {
		t.Fatalf("PREFLIGHT 应明确标记非破坏性预演: %#v", results[0])
	}
}

func TestCommandRejectsShellMode(t *testing.T) {
	_, err := command(context.Background(), Operation{
		OperationType: "command.execute",
		Input:         map[string]any{"program": "/bin/echo", "shell": map[string]any{"enabled": true}},
	}, map[string][]string{"process": {"/bin/echo"}})
	if err == nil {
		t.Fatal("Shell 模式必须被拒绝")
	}
}

func TestRollbackOperationSkipsWhenRequiredOperationWasNotCompleted(t *testing.T) {
	result := run(context.Background(), Plan{}, Operation{
		ID: "restore", OperationType: "file.restore", Stage: "rollback",
		Input: map[string]any{"whenOperationCompleted": "install"},
	}, nil, t.TempDir(), &Ledger{})
	if result.Status != "SUCCEEDED" || result.Detail["skipped"] != true {
		t.Fatalf("未完成前序操作时回滚应跳过: %#v", result)
	}
}

func TestReadFileWithPrivilegeFallsBackToControlledHelper(t *testing.T) {
	originalReadFile := readFileDirect
	originalHelper := executePrivilegedFileHelper
	t.Cleanup(func() {
		readFileDirect = originalReadFile
		executePrivilegedFileHelper = originalHelper
	})

	readFileDirect = func(string) ([]byte, error) {
		return nil, os.ErrPermission
	}
	executePrivilegedFileHelper = func(_ context.Context, input []byte, args ...string) ([]byte, error) {
		if input != nil {
			t.Fatalf("读取文件不应传入标准输入: %q", string(input))
		}
		if len(args) != 2 || args[0] != "read-file" || args[1] != "/etc/gcac-test/certs/test.key" {
			t.Fatalf("受控 helper 参数错误: %#v", args)
		}
		return []byte("private-key"), nil
	}

	content, privilegeMode, err := readFileWithPrivilege(context.Background(), "/etc/gcac-test/certs/test.key")
	if err != nil || string(content) != "private-key" || privilegeMode != "sudo-helper" {
		t.Fatalf("权限回退结果错误: content=%q mode=%s err=%v", string(content), privilegeMode, err)
	}
}

func TestReplaceFileFallsBackToControlledHelper(t *testing.T) {
	originalCreateTemp := createTempDirect
	originalHelper := executePrivilegedFileHelper
	t.Cleanup(func() {
		createTempDirect = originalCreateTemp
		executePrivilegedFileHelper = originalHelper
	})

	createTempDirect = func(string, string) (*os.File, error) {
		return nil, os.ErrPermission
	}
	executePrivilegedFileHelper = func(_ context.Context, input []byte, args ...string) ([]byte, error) {
		if string(input) != "private-key" {
			t.Fatalf("helper 未收到私钥内容: %q", string(input))
		}
		if len(args) != 3 || args[0] != "write-file" || args[1] != "/etc/gcac-test/certs/test.key" || args[2] != "600" {
			t.Fatalf("受控 helper 参数错误: %#v", args)
		}
		return nil, nil
	}

	privilegeMode, err := replaceFile(context.Background(), "/etc/gcac-test/certs/test.key", []byte("private-key"), 0o600)
	if err != nil || privilegeMode != "sudo-helper" {
		t.Fatalf("权限回退结果错误: mode=%s err=%v", privilegeMode, err)
	}
}

func TestRemoveFileFallsBackToControlledHelper(t *testing.T) {
	originalRemoveFile := removeFileDirect
	originalHelper := executePrivilegedFileHelper
	t.Cleanup(func() {
		removeFileDirect = originalRemoveFile
		executePrivilegedFileHelper = originalHelper
	})

	removeFileDirect = func(string) error {
		return os.ErrPermission
	}
	executePrivilegedFileHelper = func(_ context.Context, input []byte, args ...string) ([]byte, error) {
		if input != nil {
			t.Fatalf("删除文件不应传入标准输入: %q", string(input))
		}
		if len(args) != 2 || args[0] != "remove-file" || args[1] != "/etc/gcac-test/certs/test.key" {
			t.Fatalf("受控 helper 参数错误: %#v", args)
		}
		return nil, nil
	}

	privilegeMode, err := removeFileWithPrivilege(context.Background(), "/etc/gcac-test/certs/test.key")
	if err != nil || privilegeMode != "sudo-helper" {
		t.Fatalf("权限回退结果错误: mode=%s err=%v", privilegeMode, err)
	}
}

func testPlan(target string, expiresAt time.Time) Plan {
	return Plan{
		APIVersion: "gcac.agent-plan/v1", PlanID: "plan-1", TenantID: "tenant-1", AgentID: "agent-1",
		ExecutionRunID: "run-1", ExecutionStepID: "step-1", Plugin: map[string]any{"pluginPackageId": "plugin-1"},
		IssuedAt: time.Now().UTC().Format(time.RFC3339Nano), ExpiresAt: expiresAt.UTC().Format(time.RFC3339Nano), IdempotencyKey: "idempotency-1",
		Permissions:     []Permission{{Name: "files", Scope: "filesystem", Values: []string{filepath.Dir(target) + string(os.PathSeparator) + "*"}}},
		VariablesDigest: "digest",
		Operations:      []Operation{{ID: "replace", Name: "replace", Stage: "install", OperationType: "file.atomic_replace", SchemaVersion: "1.0", Input: map[string]any{"path": target, "content": "certificate"}}},
		Rollback:        []Operation{}, Authorization: Authorization{KeyID: "agent-plan-v1"},
	}
}

func signPlan(t *testing.T, plan Plan) Plan {
	t.Helper()
	raw, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	var unsigned map[string]any
	if err := json.Unmarshal(raw, &unsigned); err != nil {
		t.Fatal(err)
	}
	delete(unsigned, "authorization")
	mac := hmac.New(sha256.New, []byte(signingKey()))
	_, _ = mac.Write([]byte(renderCanonical(unsigned)))
	plan.Authorization.Signature = hex.EncodeToString(mac.Sum(nil))
	return plan
}

func signRawPlan(plan map[string]any) string {
	unsigned := make(map[string]any, len(plan))
	for key, value := range plan {
		if key != "authorization" {
			unsigned[key] = value
		}
	}
	mac := hmac.New(sha256.New, []byte(signingKey()))
	_, _ = mac.Write([]byte(renderCanonical(unsigned)))
	return hex.EncodeToString(mac.Sum(nil))
}

func planMap(t *testing.T, plan Plan) map[string]any {
	t.Helper()
	raw, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	return value
}
