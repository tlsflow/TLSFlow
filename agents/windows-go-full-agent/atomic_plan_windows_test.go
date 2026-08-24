package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"testing"
	"time"
)

func TestVerifyAtomicPlanRejectsTampering(t *testing.T) {
	plan := signedWindowsTestPlan(t)
	if err := verifyAtomicPlan(plan); err != nil {
		t.Fatalf("有效签名被拒绝: %v", err)
	}
	plan.Operations[0].Input["content"] = "tampered"
	if err := verifyAtomicPlan(plan); err == nil {
		t.Fatal("篡改计划必须被拒绝")
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
