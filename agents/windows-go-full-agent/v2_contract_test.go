package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestV2RegistryPublishesOnlyLongLivedActions(t *testing.T) {
	actions := windowsActionHandlers.PublishedActionTypes(false)
	if len(actions) != 4 {
		t.Fatalf("expected four Agent v2 actions, got %+v", actions)
	}
	for _, action := range actions {
		if !v2ContainsString([]string{agentFactCollect, agentPlanValidate, agentPlanExecute, agentExecutionReceipt}, action) {
			t.Fatalf("unexpected long-lived action: %s", action)
		}
	}
}

func TestV2RejectsLegacyActionsWithoutCompatibilityAlias(t *testing.T) {
	_, err := windowsActionHandlers.Resolve(map[string]any{"action": "agent.atomic_plan.execute", "actionType": "agent.atomic_plan.execute"})
	if err == nil {
		t.Fatal("legacy action must be rejected")
	}
}

func TestV2RejectsTypeFieldWithoutCanonicalActionType(t *testing.T) {
	_, err := windowsActionHandlers.Resolve(map[string]any{"type": agentPlanExecute})
	if err == nil {
		t.Fatal("legacy type field must not select an action handler")
	}
}

func TestV2RejectsMissingActionTypeWithoutSelfTestDefault(t *testing.T) {
	_, err := windowsActionHandlers.Resolve(map[string]any{})
	if err == nil {
		t.Fatal("missing actionType must be rejected")
	}
}

func TestRegisterDoesNotRetryWithoutEnrollmentToken(t *testing.T) {
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		atomic.AddInt32(&requests, 1)
		if request.Header.Get("X-Agent-Token") != "explicit-enrollment-token" {
			t.Errorf("注册请求未携带显式 enrollment token")
		}
		writer.WriteHeader(http.StatusForbidden)
	}))
	defer server.Close()

	_, err := registerAgent(context.Background(), server.Client(), &AgentConfig{
		AgentKey:        "explicit-agent-key",
		EnrollmentToken: "explicit-enrollment-token",
		ControlPlane:    server.URL,
	}, runtimeIdentity{})
	if err == nil {
		t.Fatal("注册被拒绝时必须失败")
	}
	if got := atomic.LoadInt32(&requests); got != 1 {
		t.Fatalf("注册失败不得移除 token 静默重试，requests=%d", got)
	}
}

func TestV2FailsClosedWithoutIndependentTrustRoots(t *testing.T) {
	t.Setenv("GCAC_AGENT_CAPABILITY_KEYSET_JSON", "")
	t.Setenv("GCAC_POLICY_AUTHORITY_KEYSET_JSON", "")
	t.Setenv("GCAC_AGENT_LOCAL_POLICY_JSON", "")
	success, code, _, _ := executeAgentV2(context.Background(), map[string]any{
		"action": agentPlanValidate, "requestId": "req-1", "agentId": "agent-1", "tenantId": "tenant-1",
	}, "agent-1")
	if success || code != "AGENT_V2_AUTHORIZATION_DENIED" {
		t.Fatalf("missing trust roots must fail closed, success=%v code=%s", success, code)
	}
}

func TestV2RejectsUnallowlistedOperation(t *testing.T) {
	err := validateAgentPlan(agentPlanV2{
		PlanVersion: agentSecurityContract, PlanID: "plan-1", AgentID: "agent-1", TenantID: "tenant-1", PluginID: "web.generic", PluginVersionID: "plugin-version-1",
		Capability: "filesystem.read", PlanDigest: "digest-1", TokenID: "token-1", Nonce: "nonce-1",
		Operations: []agentPlanAction{{OperationID: "op-1", OperationType: "command.execute", Stage: "prepare", Input: map[string]any{}, DependsOn: []string{}, IdempotencyKey: "idem-1", TimeoutSeconds: 30}},
	}, AgentCapabilityTokenV1{TokenVersion: agentSecurityContract, TokenID: "token-1", AgentID: "agent-1", TenantID: "tenant-1", PluginID: "web.generic", PluginVersionID: "plugin-version-1", Capability: "filesystem.read", PlanDigest: "digest-1", AllowedPaths: []string{`C:\GCAC\example.conf`}})
	if err == nil {
		t.Fatal("free command operation must be rejected")
	}
}
