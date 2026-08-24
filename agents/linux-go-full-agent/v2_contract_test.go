package main

import (
	"context"
	"reflect"
	"sort"
	"testing"

	coreRegistry "gcac/linux-go-full-agent/internal/core/registry"
)

func TestRegisteredLinuxAdaptersExposeOnlyGatewayRoutes(t *testing.T) {
	if adapters := registeredLinuxAdapterIDs(&AgentConfig{}); len(adapters) != 0 {
		t.Fatalf("普通 Agent 不得暴露历史产品适配器: %+v", adapters)
	}
	config := &AgentConfig{GatewayEnabled: true}
	want := gatewayRouteChannels()
	sort.Strings(want)
	if got := registeredLinuxAdapterIDs(config); !reflect.DeepEqual(got, want) {
		t.Fatalf("Gateway 只能暴露通用路由适配器, got=%v want=%v", got, want)
	}
}

func TestV2RegistryPublishesOnlyLongLivedActions(t *testing.T) {
	descriptors := newLinuxActionRegistry(nil).Descriptors()
	if len(descriptors) != 4 {
		t.Fatalf("expected four Agent v2 actions, got %+v", descriptors)
	}
	for _, descriptor := range descriptors {
		if !containsString([]string{agentFactCollect, agentPlanValidate, agentPlanExecute, agentExecutionReceipt}, descriptor.ActionType) {
			t.Fatalf("unexpected long-lived action: %+v", descriptor)
		}
	}
}

func TestV2RejectsLegacyActionsWithoutCompatibilityAlias(t *testing.T) {
	result := newLinuxActionRegistry(nil).Execute(context.Background(), coreRegistry.Request{ActionType: "agent.atomic_plan.execute", SchemaVersion: "1.0"})
	if result.Success || result.ErrorCode != "ACTION_HANDLER_NOT_REGISTERED" {
		t.Fatalf("legacy action must be rejected, got %+v", result)
	}
}

func TestV2RejectsTypeFieldWithoutCanonicalActionType(t *testing.T) {
	_, code, _, _ := executeLinuxTaskPayload("task-1", map[string]any{"type": agentPlanExecute})
	if code != "ACTION_HANDLER_NOT_REGISTERED" {
		t.Fatalf("legacy type field must not select an action handler, got %s", code)
	}
}

func TestV2RejectsMissingActionTypeWithoutSelfTestDefault(t *testing.T) {
	_, code, _, _ := executeLinuxTaskPayload("task-1", map[string]any{})
	if code != "ACTION_HANDLER_NOT_REGISTERED" {
		t.Fatalf("missing actionType must be rejected, got %s", code)
	}
}

func TestV2FailsClosedWithoutIndependentTrustRoots(t *testing.T) {
	previous := []string{"GCAC_AGENT_CAPABILITY_KEYSET_JSON", "GCAC_POLICY_AUTHORITY_KEYSET_JSON", "GCAC_AGENT_LOCAL_POLICY_JSON"}
	for _, key := range previous {
		t.Setenv(key, "")
	}
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
	}, AgentCapabilityTokenV1{TokenVersion: agentSecurityContract, TokenID: "token-1", AgentID: "agent-1", TenantID: "tenant-1", PluginID: "web.generic", PluginVersionID: "plugin-version-1", Capability: "filesystem.read", PlanDigest: "digest-1", AllowedPaths: []string{"/etc/gcac/example.conf"}})
	if err == nil {
		t.Fatal("free command operation must be rejected")
	}
}
