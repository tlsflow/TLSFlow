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
