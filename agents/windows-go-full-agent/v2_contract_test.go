package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestV2RegistryPublishesOnlyLongLivedActions(t *testing.T) {
	actions := windowsActionHandlers.PublishedActionTypes()
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

func TestRuntimeDispatchesCanonicalQueuedActionType(t *testing.T) {
	fixture := newWindowsV2TestFixture(t)
	payload := cloneMap(fixture.Request)
	payload["actionType"] = agentPlanValidate
	delete(payload, "action")
	execution := &taskExecutionContext{
		ctx:          context.Background(),
		registration: &runtimeRegistration{AgentID: fixture.Plan.AgentID},
		task:         agentTaskEnvelope{ID: "queued-v2-task", Payload: payload},
	}
	success, code, message, _ := executeTask(execution)
	if !success || code != "" {
		t.Fatalf("合法 canonical actionType 队列任务未进入 Agent v2 主链: success=%v code=%s message=%s", success, code, message)
	}
	if stringFromMap(execution.task.Payload, "action") != agentPlanValidate {
		t.Fatalf("队列边界未转换为 canonical wire action: %+v", execution.task.Payload)
	}
	if _, exists := execution.task.Payload["actionType"]; exists {
		t.Fatal("进入 Agent v2 wire 后不得保留 actionType")
	}
}

func TestRuntimeRejectsWireActionBypass(t *testing.T) {
	execution := &taskExecutionContext{
		ctx:  context.Background(),
		task: agentTaskEnvelope{ID: "wire-bypass-task", Payload: map[string]any{"action": agentPlanValidate}},
	}
	success, code, _, _ := executeTask(execution)
	if success || code != "ACTION_HANDLER_NOT_REGISTERED" {
		t.Fatalf("队列 wire action 旁路未失败关闭: success=%v code=%s", success, code)
	}
}

func TestGatewayForwardUsesCanonicalActionTypeOnly(t *testing.T) {
	source := map[string]any{
		"actionType":          agentPlanExecute,
		"actionSchemaVersion": "1.0",
		"token":               map[string]any{"agentId": "agent-target", "pluginVersionId": "plugin-version-1", "planDigest": "digest-1"},
		"policyDecision":      map[string]any{},
	}
	payload, actionType, err := buildGatewayAgentV2Payload(source, agentTaskEnvelope{ID: "gateway-task-1"}, "agent-target")
	if err != nil {
		t.Fatalf("canonical Gateway 转发载荷构造失败: %v", err)
	}
	if actionType != agentPlanExecute || stringFromMap(payload, "actionType") != agentPlanExecute {
		t.Fatalf("Gateway 转发必须返回同一 canonical actionType: actionType=%s payload=%+v", actionType, payload)
	}
	if _, exists := payload["action"]; exists {
		t.Fatal("Gateway 目标队列载荷不得保留 action Alias")
	}
}

func TestGatewayForwardRejectsActionAliasAndNonCanonicalActionType(t *testing.T) {
	base := map[string]any{
		"token":          map[string]any{"agentId": "agent-target", "pluginVersionId": "plugin-version-1", "planDigest": "digest-1"},
		"policyDecision": map[string]any{},
	}
	for _, payload := range []map[string]any{
		{"action": agentPlanExecute},
		{"actionType": "agent.atomic_plan.execute"},
		{"actionType": agentPlanExecute, "action": agentPlanExecute},
	} {
		for key, value := range payload {
			base[key] = value
		}
		if _, _, err := buildGatewayAgentV2Payload(base, agentTaskEnvelope{ID: "gateway-task-1"}, "agent-target"); err == nil {
			t.Fatalf("非 canonical Gateway 动作必须失败关闭: %+v", payload)
		}
		for key := range payload {
			delete(base, key)
		}
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

func TestV2RejectsMissingOrMismatchedRuntimeAgentID(t *testing.T) {
	fixture := newWindowsV2TestFixture(t)
	for _, runtimeAgentID := range []string{"", "agent-other"} {
		if success, code, _, _ := executeAgentV2(context.Background(), fixture.Request, runtimeAgentID); success || code != "AGENT_V2_AUTHORIZATION_DENIED" {
			t.Fatalf("运行期 Agent ID 为空或不匹配时必须失败关闭: runtimeAgentID=%q success=%v code=%s", runtimeAgentID, success, code)
		}
	}
}

func TestV2PlanExecuteReportsUnknownWhenAuthorizationMaterialUnavailable(t *testing.T) {
	cases := []struct {
		name string
		env  string
	}{
		{name: "capability keyset", env: "GCAC_AGENT_CAPABILITY_KEYSET_JSON"},
		{name: "policy authority keyset", env: "GCAC_POLICY_AUTHORITY_KEYSET_JSON"},
		{name: "local policy", env: "GCAC_AGENT_LOCAL_POLICY_JSON"},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			fixture := newWindowsV2TestFixture(t)
			t.Setenv(testCase.env, "")
			fixture.Request["action"] = agentPlanExecute
			success, code, _, detail := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID)
			if success || code != "AGENT_V2_AUTHORIZATION_DENIED" {
				t.Fatalf("授权材料不可用必须失败关闭: success=%v code=%s detail=%+v", success, code, detail)
			}
			if detail["executionStatus"] != "UNKNOWN" || detail["fallback"] != false || detail["replayed"] != false || detail["authorizationUnavailable"] != true {
				t.Fatalf("授权材料不可用必须报告 UNKNOWN 且禁止 fallback/replay: %+v", detail)
			}
		})
	}
}

func TestV2PlanExecuteFailsClosedWithoutReceiptSigner(t *testing.T) {
	fixture := newWindowsV2TestFixture(t)
	t.Setenv("GCAC_AGENT_RECEIPT_KEY_ID", "")
	t.Setenv("GCAC_AGENT_RECEIPT_SIGNING_KEY_BASE64", "")
	t.Setenv("GCAC_AGENT_RECEIPT_KEYSET_JSON", "")
	fixture.Request["action"] = agentPlanExecute
	if success, code, _, _ := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID); success || code != "AGENT_RECEIPT_SIGNER_UNAVAILABLE" {
		t.Fatalf("缺少 Agent 回执签名材料必须失败关闭: success=%v code=%s", success, code)
	}
}

func TestV2PlanExecuteReportsUnknownWithoutReceiptSigner(t *testing.T) {
	fixture := newWindowsV2TestFixture(t)
	t.Setenv("GCAC_AGENT_RECEIPT_KEY_ID", "")
	t.Setenv("GCAC_AGENT_RECEIPT_SIGNING_KEY_BASE64", "")
	t.Setenv("GCAC_AGENT_RECEIPT_KEYSET_JSON", "")
	fixture.Request["action"] = agentPlanExecute
	success, code, _, detail := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID)
	if success || code != "AGENT_RECEIPT_SIGNER_UNAVAILABLE" {
		t.Fatalf("缺少 Receipt 签名器必须失败关闭: success=%v code=%s detail=%+v", success, code, detail)
	}
	if detail["executionStatus"] != "UNKNOWN" || detail["fallback"] != false || detail["replayed"] != false || detail["receiptUnavailable"] != true {
		t.Fatalf("签名器不可用必须报告 UNKNOWN 且禁止 fallback/replay: %+v", detail)
	}
}

func TestV2PathScopeUsesNormalizedComponentBoundaries(t *testing.T) {
	allowed := filepath.Join(t.TempDir(), "allowed")
	separator := string(filepath.Separator)
	cases := []struct {
		name  string
		value string
		want  bool
	}{
		{name: "自身路径", value: allowed, want: true},
		{name: "真实子路径", value: allowed + separator + "nested" + separator + "file", want: true},
		{name: "同前缀目录", value: allowed + "-other" + separator + "file", want: false},
		{name: "父目录跳转", value: allowed + separator + ".." + separator + "outside", want: false},
		{name: "子目录回退", value: allowed + separator + "nested" + separator + ".." + separator + "outside", want: false},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			if got := pathScopeContains([]string{allowed}, testCase.value); got != testCase.want {
				t.Fatalf("路径范围判断错误: value=%q got=%v want=%v", testCase.value, got, testCase.want)
			}
		})
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

type windowsV2TestFixture struct {
	Request map[string]any
	Plan    agentPlanV2
	Token   AgentCapabilityTokenV1
	Root    string
}

func newWindowsV2TestFixture(t *testing.T) windowsV2TestFixture {
	t.Helper()
	root := t.TempDir()
	target := filepath.Join(root, "managed.conf")
	capabilityPublic, capabilityPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	policyPublic, policyPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	receiptPublic, receiptPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	t.Setenv("GCAC_AGENT_CAPABILITY_KEYSET_JSON", testWindowsKeySet("authority-key", capabilityPublic))
	t.Setenv("GCAC_POLICY_AUTHORITY_KEYSET_JSON", testWindowsKeySet("authority-key", policyPublic))
	t.Setenv("GCAC_AGENT_RECEIPT_KEY_ID", "agent-receipt-key")
	t.Setenv("GCAC_AGENT_RECEIPT_SIGNING_KEY_BASE64", base64.StdEncoding.EncodeToString(receiptPrivate))
	t.Setenv("GCAC_AGENT_RECEIPT_KEYSET_JSON", testWindowsKeySet("agent-receipt-key", receiptPublic))
	localPolicy, _ := json.Marshal(map[string]any{"allowedPaths": []string{root}, "allowedServices": []string{}})
	t.Setenv("GCAC_AGENT_LOCAL_POLICY_JSON", string(localPolicy))
	if err := configurePersistentAgentNonceStore(filepath.Join(root, "nonces")); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	plan := agentPlanV2{
		PlanVersion: agentSecurityContract, PlanID: "plan-windows-v2-1", AgentID: "agent-windows-1", TenantID: "tenant-1",
		PluginID: "web.generic", PluginVersionID: "plugin-version-1", Capability: "filesystem.atomic_replace",
		Operations: []agentPlanAction{{OperationID: "operation-1", OperationType: "filesystem.atomic_replace", Stage: "execute", Input: map[string]any{"path": target, "contentBase64": base64.StdEncoding.EncodeToString([]byte("v2"))}, DependsOn: []string{}, IdempotencyKey: "idempotency-1", TimeoutSeconds: 30}},
		TokenID:    "token-windows-v2-1", PolicyDecisionID: "decision-windows-v2-1", Nonce: "nonce-windows-v2-1", ExpiresAt: now.Add(5 * time.Minute).Format(time.RFC3339Nano), WriteEffect: true,
	}
	digest, err := computeAgentPlanDigest(plan)
	if err != nil {
		t.Fatal(err)
	}
	plan.PlanDigest = digest
	token := AgentCapabilityTokenV1{
		TokenVersion: agentSecurityContract, TokenID: plan.TokenID, AgentID: plan.AgentID, TenantID: plan.TenantID, PluginID: plan.PluginID, PluginVersionID: plan.PluginVersionID, Capability: plan.Capability,
		Actions: []string{"filesystem.atomic_replace"}, AllowedPaths: []string{root}, AllowedServices: []string{}, ArtifactDigests: []string{}, PolicyRef: "policy-1", PolicyVersion: "1",
		IssuedAt: now.Add(-time.Minute).Format(time.RFC3339Nano), ExpiresAt: now.Add(5 * time.Minute).Format(time.RFC3339Nano), Nonce: plan.Nonce, PlanDigest: plan.PlanDigest, AuthorityKeyID: "authority-key",
	}
	decision := PolicyAuthorityDecisionV1{
		DecisionVersion: agentSecurityContract, DecisionID: plan.PolicyDecisionID, Allowed: true, AgentID: plan.AgentID, TenantID: plan.TenantID, PluginID: plan.PluginID, PluginVersionID: plan.PluginVersionID, Capability: plan.Capability,
		Actions: token.Actions, AllowedPaths: token.AllowedPaths, AllowedServices: token.AllowedServices, ArtifactDigests: token.ArtifactDigests, PolicyRef: token.PolicyRef, PolicyVersion: token.PolicyVersion, PlanDigest: plan.PlanDigest, TokenID: token.TokenID, Nonce: token.Nonce,
		IssuedAt: now.Add(-time.Minute).Format(time.RFC3339Nano), ValidUntil: now.Add(5 * time.Minute).Format(time.RFC3339Nano), AuthorityKeyID: "authority-key", RevocationRef: "revocation-1",
	}
	token.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(capabilityPrivate, canonicalJSON(tokenWithoutSignature(token))))
	decision.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(policyPrivate, canonicalJSON(decisionWithoutSignature(decision))))
	request := map[string]any{
		"action": agentPlanValidate, "requestId": "request-windows-v2-1", "agentId": plan.AgentID, "tenantId": plan.TenantID, "pluginId": plan.PluginID, "pluginVersion": plan.PluginVersionID, "capability": plan.Capability,
		"actions": token.Actions, "paths": token.AllowedPaths, "services": token.AllowedServices, "artifactDigests": token.ArtifactDigests, "planDigest": plan.PlanDigest, "token": token, "policyDecision": decision, "plan": plan,
	}
	return windowsV2TestFixture{Request: request, Plan: plan, Token: token, Root: root}
}

func testWindowsKeySet(keyID string, publicKey ed25519.PublicKey) string {
	encoded, _ := json.Marshal(map[string]string{keyID: base64.StdEncoding.EncodeToString(publicKey)})
	return string(encoded)
}

func TestV2RejectsPlanOperationTamperingAfterDigestWasIssued(t *testing.T) {
	fixture := newWindowsV2TestFixture(t)
	tampered := fixture.Plan
	tampered.Operations = append([]agentPlanAction(nil), fixture.Plan.Operations...)
	tampered.Operations[0].Input = map[string]any{"path": filepath.Join(fixture.Root, "managed.conf"), "contentBase64": base64.StdEncoding.EncodeToString([]byte("tampered"))}
	if err := validateAgentPlan(tampered, fixture.Token); err == nil {
		t.Fatal("修改 operations 后必须因完整 planDigest 不匹配而失败关闭")
	}
}

func TestV2NonceIsConsumedOnlyByPlanExecute(t *testing.T) {
	fixture := newWindowsV2TestFixture(t)
	if success, code, _, _ := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID); !success || code != "" {
		t.Fatalf("plan.validate 不应因 Nonce 消费失败: success=%v code=%s", success, code)
	}
	if _, err := loadPersistentAgentNonce(fixture.Token.Nonce); err == nil {
		t.Fatal("fact.collect/plan.validate 不得消费执行 Nonce")
	}
	fixture.Request["action"] = agentPlanExecute
	if success, code, message, _ := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID); !success || code != "" {
		t.Fatalf("plan.execute 应消费一次授权并返回成功: success=%v code=%s message=%s", success, code, message)
	}
	if _, err := loadPersistentAgentNonce(fixture.Token.Nonce); err != nil {
		t.Fatalf("plan.execute 后 Nonce 消费记录缺失: %v", err)
	}
	record, err := loadPersistentAgentNonce(fixture.Token.Nonce)
	if err != nil {
		t.Fatalf("读取 Nonce 消费记录失败: %v", err)
	}
	expectedResultDigest, err := computeAgentPlanResultDigest(fixture.Plan)
	if err != nil || record.ResultDigest != expectedResultDigest || record.ResultDigest == fixture.Plan.PlanDigest {
		t.Fatalf("Nonce 必须绑定完整计划结果摘要: got=%s expected=%s planDigest=%s", record.ResultDigest, expectedResultDigest, fixture.Plan.PlanDigest)
	}
	if success, code, _, _ := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID); success || code != "AGENT_V2_AUTHORIZATION_DENIED" {
		t.Fatalf("相同授权重放必须失败关闭: success=%v code=%s", success, code)
	}
}

func TestV2ReceiptRejectsTamperedDigestAndSignature(t *testing.T) {
	fixture := newWindowsV2TestFixture(t)
	fixture.Request["action"] = agentPlanExecute
	success, code, _, detail := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID)
	if !success || code != "" {
		t.Fatalf("执行应生成签名回执: success=%v code=%s", success, code)
	}
	receipt := detail["receipt"].(AgentExecutionReceiptV1)
	if receipt.OperationID != fixture.Plan.Operations[0].OperationID || receipt.OperationID == fixture.Plan.PlanID {
		t.Fatalf("Receipt operationId 必须绑定真实操作: got=%s", receipt.OperationID)
	}
	request := agentV2Request{AgentID: fixture.Plan.AgentID, TenantID: fixture.Plan.TenantID}
	if err := validateAgentExecutionReceipt(receipt, fixture.Token, request); err != nil {
		t.Fatalf("生成的回执必须可验证: %v", err)
	}
	tampered := receipt
	tampered.Digest = strings.Repeat("0", 64)
	if err := validateAgentExecutionReceipt(tampered, fixture.Token, request); err == nil {
		t.Fatal("篡改回执 digest 必须失败关闭")
	}
	tampered = receipt
	tampered.Signature = base64.StdEncoding.EncodeToString([]byte("forged"))
	if err := validateAgentExecutionReceipt(tampered, fixture.Token, request); err == nil {
		t.Fatal("伪造回执 signature 必须失败关闭")
	}
	fixture.Request["action"] = agentExecutionReceipt
	fixture.Request["receipt"] = &tampered
	if success, code, _, _ := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID); success || code != "AGENT_RECEIPT_INVALID" {
		t.Fatalf("运行期不得接受客户端篡改回执: success=%v code=%s", success, code)
	}
	delete(fixture.Request, "receipt")
	if success, code, _, _ := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID); !success || code != "" {
		t.Fatalf("回执动作应只读取本地已签名回执: success=%v code=%s", success, code)
	}
}

func TestV2CancelledWriteProducesUnknownReceipt(t *testing.T) {
	fixture := newWindowsV2TestFixture(t)
	fixture.Request["action"] = agentPlanExecute
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	success, code, _, detail := executeAgentV2(ctx, fixture.Request, fixture.Plan.AgentID)
	if success || code != "AGENT_EXECUTION_UNKNOWN" {
		t.Fatalf("取消写操作必须进入 UNKNOWN: success=%v code=%s", success, code)
	}
	receipt, ok := detail["receipt"].(AgentExecutionReceiptV1)
	if !ok || receipt.Status != "UNKNOWN" || receipt.UnknownReason == "" {
		t.Fatalf("取消写操作必须生成 UNKNOWN Receipt: %+v", detail)
	}
}

func TestV2WriteFailureAndTimeoutProduceUnknownReceipt(t *testing.T) {
	fixture := newWindowsV2TestFixture(t)
	plan := fixture.Plan
	plan.Operations = append([]agentPlanAction(nil), fixture.Plan.Operations...)
	plan.Operations[0].Input = map[string]any{"path": filepath.Join(fixture.Root, "managed.conf"), "contentBase64": "%"}
	signer, err := loadAgentReceiptSigner()
	if err != nil {
		t.Fatalf("加载测试回执签名器失败: %v", err)
	}
	if success, code, _, detail := executeAgentPlan(context.Background(), plan, fixture.Token, signer); success || code != "AGENT_EXECUTION_UNKNOWN" {
		t.Fatalf("写操作失败必须进入 UNKNOWN: success=%v code=%s detail=%+v", success, code, detail)
	} else if receipt, ok := detail["receipt"].(AgentExecutionReceiptV1); !ok || receipt.Status != "UNKNOWN" || receipt.UnknownReason == "" {
		t.Fatalf("写操作失败必须生成 UNKNOWN Receipt: %+v", detail)
	}

	fixture = newWindowsV2TestFixture(t)
	fixture.Request["action"] = agentPlanExecute
	timedOut, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	if success, code, _, detail := executeAgentV2(timedOut, fixture.Request, fixture.Plan.AgentID); success || code != "AGENT_EXECUTION_UNKNOWN" {
		t.Fatalf("超时写操作必须进入 UNKNOWN: success=%v code=%s detail=%+v", success, code, detail)
	} else if receipt, ok := detail["receipt"].(AgentExecutionReceiptV1); !ok || receipt.Status != "UNKNOWN" || receipt.UnknownReason == "" {
		t.Fatalf("超时写操作必须生成 UNKNOWN Receipt: %+v", detail)
	}
}

func TestV2FactCollectRejectsUnboundScopeAndReturnsGenericFacts(t *testing.T) {
	fixture := newWindowsV2TestFixture(t)
	fixture.Request["action"] = agentFactCollect
	if success, code, _, detail := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID); !success || code != "" {
		t.Fatalf("事实采集应成功: success=%v code=%s", success, code)
	} else {
		facts := detail["facts"].([]map[string]any)
		seen := map[string]bool{}
		for _, fact := range facts {
			seen[fact["kind"].(string)] = true
		}
		for _, kind := range []string{"process", "service", "file_stat", "privilege", "certificate_store"} {
			if !seen[kind] {
				t.Fatalf("事实采集缺少最低合同类别: %s", kind)
			}
		}
	}
	fixture.Request["paths"] = []string{filepath.Join(fixture.Root, "outside", "secret")}
	if success, code, _, _ := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID); success || code != "AGENT_V2_AUTHORIZATION_DENIED" {
		t.Fatalf("事实范围越权必须失败关闭: success=%v code=%s", success, code)
	}
}
