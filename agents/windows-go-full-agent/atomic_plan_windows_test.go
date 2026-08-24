package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestVerifyAtomicPlanRejectsTampering(t *testing.T) {
	plan := signedWindowsTestPlan(t)
	rawPlan := windowsTestPlanMap(t, plan)
	if err := verifyAtomicPlan(rawPlan); err != nil {
		t.Fatalf("有效签名被拒绝: %v", err)
	}
	operations := rawPlan["operations"].([]any)
	operation := operations[0].(map[string]any)
	operation["input"].(map[string]any)["content"] = "tampered"
	if err := verifyAtomicPlan(rawPlan); err == nil {
		t.Fatal("篡改计划必须被拒绝")
	}
}

func TestVerifyAtomicPlanPreservesUnsignedProtocolFields(t *testing.T) {
	rawPlan := windowsTestPlanMap(t, signedWindowsTestPlan(t))
	rawPlan["executionMode"] = "PREFLIGHT"
	rawPlan["protocolExtension"] = map[string]any{"revision": "future-compatible"}
	signWindowsRawPlan(t, rawPlan)

	plan, transportedPlan, err := parseAtomicPlan(map[string]any{"plan": rawPlan})
	if err != nil {
		t.Fatal(err)
	}
	if plan.ExecutionMode != "PREFLIGHT" {
		t.Fatalf("执行模式解析错误: %q", plan.ExecutionMode)
	}
	if err := verifyAtomicPlan(transportedPlan); err != nil {
		t.Fatalf("原始传输字段参与签名时不应被结构体裁剪: %v", err)
	}
}

func TestWindowsAtomicPreflightDoesNotWriteFile(t *testing.T) {
	targetPath := filepath.Join(t.TempDir(), "certificate.pem")
	plan := signedWindowsTestPlan(t)
	plan.AgentID = "agent-preflight"
	plan.ExecutionMode = "PREFLIGHT"
	plan.IdempotencyKey = "windows-preflight-no-write"
	plan.Permissions = []atomicPermission{{Name: "test-files", Scope: "filesystem", Values: []string{targetPath}}}
	plan.Operations = []atomicOperation{{
		ID: "replace", Name: "replace", Stage: "install", OperationType: "file.atomic_replace", SchemaVersion: "1.0",
		Input: map[string]any{"path": targetPath, "content": "must-not-be-written"},
	}}
	plan = signWindowsTestPlan(t, plan)
	config := &AgentConfig{}
	config.Paths.Windows.DataDir = t.TempDir()

	result := executeWindowsAtomicPlan(&taskExecutionContext{
		ctx: t.Context(), config: config, registration: &runtimeRegistration{AgentID: "agent-preflight"},
		task: agentTaskEnvelope{Payload: map[string]any{"plan": windowsTestPlanMap(t, plan)}},
	})
	if !result.Success {
		t.Fatalf("只读预演应成功: %#v", result)
	}
	if _, err := os.Stat(targetPath); !os.IsNotExist(err) {
		t.Fatalf("只读预演不得写入目标文件: %v", err)
	}
}

func TestWindowsAtomicOperationSkipsAbsentOptionalVariable(t *testing.T) {
	result := runWindowsAtomicOperation(t.Context(), atomicPlan{}, atomicOperation{
		ID: "optional-chain", Name: "optional-chain", Stage: "backup", OperationType: "file.backup", SchemaVersion: "1.0",
		Input: map[string]any{"path": "", "whenVariablePresent": ""},
	}, map[string][]string{"filesystem": {}}, t.TempDir(), &atomicLedger{})
	if result.Status != "SUCCEEDED" || result.Detail["skipped"] != true {
		t.Fatalf("缺少可选变量时操作应安全跳过：%#v", result)
	}
}

func TestSaveAtomicLedgerCreatesAndReplacesFile(t *testing.T) {
	dataDir := t.TempDir()
	path := atomicLedgerPath(dataDir, "sha256:"+strings.Repeat("a", 64))
	if strings.Contains(filepath.Base(path), ":") {
		t.Fatalf("恢复账本文件名不得包含 Windows 非法字符: %s", path)
	}
	first := atomicLedger{PlanID: "plan-1", IdempotencyKey: "ledger-test", State: "RUNNING"}
	if err := saveAtomicLedger(path, first); err != nil {
		t.Fatalf("首次保存恢复账本失败: %v", err)
	}
	second := first
	second.State = "SUCCEEDED"
	if err := saveAtomicLedger(path, second); err != nil {
		t.Fatalf("替换恢复账本失败: %v", err)
	}
	loaded, err := loadAtomicLedger(path)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.State != "SUCCEEDED" {
		t.Fatalf("恢复账本未更新: %#v", loaded)
	}
}

func TestAtomicLedgerPathPreservesExistingSafeNames(t *testing.T) {
	path := atomicLedgerPath(t.TempDir(), "existing-safe-key")
	if filepath.Base(path) != "existing-safe-key.json" {
		t.Fatalf("合法旧幂等键路径必须保持兼容: %s", path)
	}
}

func TestAtomicContentAndShellBoundary(t *testing.T) {
	content, err := atomicContent(map[string]any{"artifact": map[string]any{"content": "certificate"}})
	if err != nil || string(content) != "certificate" {
		t.Fatalf("Artifact 内容解析失败: %v %q", err, string(content))
	}
	_, err = windowsCommandExecute(t.Context(), atomicOperation{
		OperationType: "command.execute",
		Input:         map[string]any{"program": "C:\\Windows\\System32\\cmd.exe", "shell": map[string]any{"enabled": true}},
	}, map[string][]string{"process": {"C:\\Windows\\System32\\cmd.exe"}})
	if err == nil {
		t.Fatal("Shell 模式必须被拒绝")
	}
}

func TestWindowsPFXOperationRequiresCertificateStorePermission(t *testing.T) {
	operation := atomicOperation{
		OperationType: "windows.certificate.inspect_pfx",
		Input: map[string]any{
			"artifact": map[string]any{
				"pfxBase64":                 "cGZ4",
				"pfxPassword":               "secret",
				"expectedFingerprintSha256": "aa",
			},
		},
	}
	if _, err := windowsPFXInputFromOperation(operation, map[string][]string{}); err == nil {
		t.Fatal("缺少证书库权限时必须拒绝 PFX 操作")
	}
	input, err := windowsPFXInputFromOperation(operation, map[string][]string{"certificate_store": {"LocalMachine/My"}})
	if err != nil {
		t.Fatalf("合法 PFX 操作解析失败: %v", err)
	}
	if input.PFXBase64 != "cGZ4" || input.PFXPassword != "secret" || input.ExpectedCertificateSHA256 != "aa" {
		t.Fatalf("PFX 输入解析错误: %#v", input)
	}
}

func TestWindowsIISBindingBackupIsResolvedByCaptureOperation(t *testing.T) {
	ledger := atomicLedger{IISBindingBackups: []atomicIISBindingBackup{{
		OperationID: "capture-binding",
		SiteName:    "Default Web Site",
		Binding: windowsIISBinding{
			Protocol:              "https",
			BindingInformation:    "*:443:example.com",
			CertificateThumbprint: "OLD",
		},
	}}}
	backup, ok := findAtomicIISBindingBackup(ledger.IISBindingBackups, "capture-binding")
	if !ok || backup.SiteName != "Default Web Site" || backup.Binding.CertificateThumbprint != "OLD" {
		t.Fatalf("IIS Binding 恢复引用解析失败: %#v", backup)
	}
}

func TestWindowsRollbackOperationSkipsWhenRequiredOperationWasNotCompleted(t *testing.T) {
	result := runWindowsAtomicOperation(t.Context(), atomicPlan{}, atomicOperation{
		ID: "restore", OperationType: "windows.iis.binding.restore_certificate", Stage: "rollback",
		Input: map[string]any{"whenOperationCompleted": "iis-binding-update"},
	}, nil, t.TempDir(), &atomicLedger{})
	if result.Status != "SUCCEEDED" || result.Detail["skipped"] != true {
		t.Fatalf("未完成前序操作时回滚应跳过: %#v", result)
	}
}

func TestDirectControlAtomicPlanUsesRegisteredAgentIdentity(t *testing.T) {
	plan := signedWindowsTestPlan(t)
	plan.AgentID = "agent-direct"
	plan.Operations = []atomicOperation{{
		ID: "identity-preflight", Name: "identity-preflight", Stage: "prepare",
		OperationType: "preflight.assert", SchemaVersion: "1.0", Input: map[string]any{},
	}}
	plan.IdempotencyKey = "direct-control-agent-identity"
	plan = signWindowsTestPlan(t, plan)
	config := &AgentConfig{}
	config.Paths.Windows.DataDir = t.TempDir()
	config.Paths.Windows.LogDir = t.TempDir()
	rawPlan, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	var transportedPlan map[string]any
	if err := json.Unmarshal(rawPlan, &transportedPlan); err != nil {
		t.Fatal(err)
	}

	response, statusCode := executeDirectControlAction(config, &runtimeRegistration{AgentID: "agent-direct"}, directActionExecuteRequest{
		ActionType: "agent.atomic_plan.execute",
		Inputs:     map[string]any{"plan": transportedPlan},
	})
	if statusCode != 200 || response["success"] != true {
		t.Fatalf("直连原子计划应使用真实注册 Agent 身份：status=%d response=%#v", statusCode, response)
	}
}

func signedWindowsTestPlan(t *testing.T) atomicPlan {
	t.Helper()
	plan := atomicPlan{
		APIVersion: "gcac.agent-plan/v1", PlanID: "plan-1", TenantID: "tenant-1", AgentID: "agent-1",
		ExecutionRunID: "run-1", ExecutionStepID: "step-1", IssuedAt: time.Now().UTC().Format(time.RFC3339Nano),
		ExpiresAt: time.Now().Add(time.Minute).UTC().Format(time.RFC3339Nano), IdempotencyKey: "idempotency-1",
		Plugin: map[string]any{"pluginPackageId": "plugin-1"}, VariablesDigest: "digest",
		Operations:    []atomicOperation{{ID: "replace", Name: "replace", Stage: "install", OperationType: "file.atomic_replace", SchemaVersion: "1.0", Input: map[string]any{"path": "C:\\GCAC\\server.pem", "content": "certificate"}}},
		Authorization: atomicAuthorization{KeyID: "agent-plan-v1"},
	}
	return signWindowsTestPlan(t, plan)
}

func signWindowsTestPlan(t *testing.T, plan atomicPlan) atomicPlan {
	t.Helper()
	plan.Authorization.Signature = ""
	raw, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	var unsigned map[string]any
	if err := json.Unmarshal(raw, &unsigned); err != nil {
		t.Fatal(err)
	}
	delete(unsigned, "authorization")
	canonical, err := canonicalAtomicJSON(unsigned)
	if err != nil {
		t.Fatal(err)
	}
	mac := hmac.New(sha256.New, []byte(atomicPlanSigningKey()))
	_, _ = mac.Write(canonical)
	plan.Authorization.Signature = hex.EncodeToString(mac.Sum(nil))
	return plan
}

func windowsTestPlanMap(t *testing.T, plan atomicPlan) map[string]any {
	t.Helper()
	raw, err := json.Marshal(plan)
	if err != nil {
		t.Fatal(err)
	}
	var rawPlan map[string]any
	if err := json.Unmarshal(raw, &rawPlan); err != nil {
		t.Fatal(err)
	}
	return rawPlan
}

func signWindowsRawPlan(t *testing.T, rawPlan map[string]any) {
	t.Helper()
	unsigned := make(map[string]any, len(rawPlan)-1)
	for key, value := range rawPlan {
		if key != "authorization" {
			unsigned[key] = value
		}
	}
	canonical, err := canonicalAtomicJSON(unsigned)
	if err != nil {
		t.Fatal(err)
	}
	mac := hmac.New(sha256.New, []byte(atomicPlanSigningKey()))
	_, _ = mac.Write(canonical)
	authorization, _ := rawPlan["authorization"].(map[string]any)
	if authorization == nil {
		authorization = map[string]any{"keyId": "agent-plan-v1"}
		rawPlan["authorization"] = authorization
	}
	authorization["signature"] = hex.EncodeToString(mac.Sum(nil))
}
