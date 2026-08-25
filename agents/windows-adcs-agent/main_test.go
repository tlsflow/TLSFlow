package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestAdcsConfigIsolated(t *testing.T) {
	config := &AgentConfig{SchemaVersion: "gcac.adcs-agent.windows.v1", AgentKey: "adcs.test", ControlPlane: "https://control.invalid", ManagementPort: 18933, Service: struct {
		Name        string `json:"name"`
		DisplayName string `json:"displayName"`
	}{Name: "GCACWindowsAdcsAgent"}}
	if err := validateConfig(config); err != nil {
		t.Fatal(err)
	}
	config.ManagementPort = 18930
	if err := validateConfig(config); err == nil {
		t.Fatal("AD CS Agent 必须拒绝 Full Agent 端口")
	}
}

func TestRegisterUsesAdcsRoleAndCapabilities(t *testing.T) {
	var request registerRequest
	var tenantHeader, agentTokenHeader string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/agents/register" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		tenantHeader = r.Header.Get("x-tenant-id")
		agentTokenHeader = r.Header.Get("x-agent-token")
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write([]byte(`{"id":"agent-adcs-1"}`))
	}))
	defer server.Close()
	_, err := registerAgent(context.Background(), server.Client(), &AgentConfig{SchemaVersion: "gcac.adcs-agent.windows.v1", TenantID: "tenant-adcs", AgentKey: "adcs.test", EnrollmentToken: "enrollment-adcs", ControlPlane: server.URL, ManagementPort: 18933, ManagementListenAddress: "127.0.0.1", Service: struct {
		Name        string `json:"name"`
		DisplayName string `json:"displayName"`
	}{Name: "GCACWindowsAdcsAgent"}})
	if err != nil {
		t.Fatal(err)
	}
	if request.Role != "adcs_agent" || request.OSType != "windows_adcs" {
		t.Fatalf("注册身份错误：%+v", request)
	}
	if tenantHeader != "tenant-adcs" || agentTokenHeader != "enrollment-adcs" {
		t.Fatalf("机器请求身份头错误：tenant=%q agent=%q", tenantHeader, agentTokenHeader)
	}
	if !contains(request.Capabilities, "ca.microsoft-adcs.status") || !contains(request.Capabilities, "ca.certificate.issue") || !contains(request.Capabilities, "ca.certificate.revoke") || !contains(request.Capabilities, "ca.crl.publish") {
		t.Fatalf("AD CS 能力缺失：%v", request.Capabilities)
	}
}

func TestProviderOperationAliasesAreAccepted(t *testing.T) {
	for _, operation := range []string{"status", "issue", "query", "revoke", "revocation_evidence", "crl.status", "crl.publish"} {
		if operation == "status" {
			if _, err := executeAdcsOperation(context.Background(), operation, map[string]any{}); err == nil || !strings.Contains(err.Error(), "sc.exe") {
				t.Fatalf("status 别名应进入 CertSvc 状态检查：%v", err)
			}
			continue
		}
		if operation == "issue" {
			if _, err := executeAdcsOperation(context.Background(), operation, map[string]any{}); err == nil || !strings.Contains(err.Error(), "csrPem") {
				t.Fatalf("issue 别名应进入 AD CS 签发校验：%v", err)
			}
			continue
		}
		if operation == "query" {
			if _, err := executeAdcsOperation(context.Background(), operation, map[string]any{}); err == nil || !strings.Contains(err.Error(), "providerRequestId") {
				t.Fatalf("query 别名应进入 AD CS 查询校验：%v", err)
			}
			continue
		}
		if operation == "revoke" {
			if _, err := executeAdcsOperation(context.Background(), operation, map[string]any{}); err == nil || !strings.Contains(err.Error(), "serialNumber") {
				t.Fatalf("revoke 别名应进入 AD CS 吊销校验：%v", err)
			}
			continue
		}
		if operation == "revocation_evidence" {
			if _, err := executeAdcsOperation(context.Background(), operation, map[string]any{}); err == nil || !strings.Contains(err.Error(), "certificatePath") {
				t.Fatalf("revocation_evidence 别名应进入证据校验：%v", err)
			}
			continue
		}
		if _, err := executeAdcsOperation(context.Background(), operation, map[string]any{}); err == nil || !strings.Contains(err.Error(), "certutil.exe") {
			t.Fatalf("CRL 别名应进入 certutil 执行路径：%v", err)
		}
	}
}

func TestAdcsPlanRejectsNonAdcsOperation(t *testing.T) {
	success, code, _, _ := executePlan(context.Background(), map[string]any{"plan": map[string]any{"operations": []any{map[string]any{"operationType": "filesystem.read", "input": map[string]any{}}}}}, "agent-adcs")
	if success || code != "ADCS_OPERATION_FAILED" {
		t.Fatalf("非 AD CS 操作必须失败：%v %s", success, code)
	}
}

func TestAdcsPlanAcceptsPluginAgentPlanActions(t *testing.T) {
	success, code, message, _ := executePlan(context.Background(), map[string]any{
		"agentPlan": map[string]any{
			"agentId":     "agent-adcs",
			"tenantId":    "tenant-adcs",
			"executionId": "execution-adcs",
			"actions":     []any{map[string]any{"kind": "certificate.authority.operation", "operation": "ca.certificate.issue"}},
		},
	}, "agent-adcs")
	if success || code != "ADCS_OPERATION_FAILED" || !strings.Contains(message, "csrPem") {
		t.Fatalf("Plugin Agent Plan actions 未转换到 AD CS 执行器：%v %s %s", success, code, message)
	}
}

func TestAdcsReceiptUsesAgentV2ContractFields(t *testing.T) {
	plan := map[string]any{
		"planId":     "plan-adcs",
		"planDigest": "sha256:" + strings.Repeat("a", 64),
		"tenantId":   "tenant-adcs",
		"tokenId":    "token-adcs",
	}
	operations := []map[string]any{{"operationId": "operation-adcs"}}
	receipt := buildAgentReceipt(map[string]any{}, plan, operations, []any{map[string]any{"status": "success"}}, "agent-adcs", "2026-08-25T00:00:00Z")
	if receipt["receiptVersion"] != "gcac.agent-security/v1" || receipt["operationId"] != "operation-adcs" || receipt["status"] != "SUCCESS" {
		t.Fatalf("Receipt 字段不符合 Agent v2 合同：%v", receipt)
	}
	if digest, ok := receipt["digest"].(string); !ok || len(digest) != 64 {
		t.Fatalf("Receipt 摘要缺失：%v", receipt)
	}
}

func TestAdcsReceiptDigestExcludesDigestField(t *testing.T) {
	plan := map[string]any{
		"planId":     "plan-adcs",
		"planDigest": strings.Repeat("b", 64),
		"tenantId":   "tenant-adcs",
		"tokenId":    "token-adcs",
	}
	receipt := buildAgentReceipt(map[string]any{}, plan, []map[string]any{{"operationId": "operation-adcs"}}, []any{map[string]any{"status": "success"}}, "agent-adcs", "2026-08-25T00:00:00Z")
	digest := receipt["digest"].(string)
	delete(receipt, "digest")
	if digest != sha256JSON(receipt) {
		t.Fatalf("Receipt 摘要不得包含自身 digest 字段")
	}
}

func TestAdcsScriptsAndTemplateStayIsolated(t *testing.T) {
	root := "."
	for _, name := range []string{"install-service.ps1", "uninstall-service.ps1", "service-control.ps1", filepath.Join("config", "agent.config.template.json")} {
		if _, err := os.Stat(filepath.Join(root, name)); err != nil {
			t.Fatalf("缺少独立制品：%s", name)
		}
	}
	for _, forbidden := range []string{"windows-go-full-agent", "GCACWindowsCompatibilityAgent", "FullAgentGo", "WindowsCompatibilityAgent", "18930", "18932"} {
		for _, name := range []string{"install-service.ps1", "uninstall-service.ps1", "service-control.ps1"} {
			data, err := os.ReadFile(filepath.Join(root, name))
			if err != nil {
				t.Fatal(err)
			}
			if strings.Contains(string(data), forbidden) {
				t.Fatalf("脚本包含其它 Agent 内容 %s: %s", forbidden, name)
			}
		}
	}
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
