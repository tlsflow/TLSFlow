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

func TestCommandRejectsShellMode(t *testing.T) {
	_, err := command(context.Background(), Operation{
		OperationType: "command.execute",
		Input:         map[string]any{"program": "/bin/echo", "shell": map[string]any{"enabled": true}},
	}, map[string][]string{"process": {"/bin/echo"}})
	if err == nil {
		t.Fatal("Shell 模式必须被拒绝")
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
