package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	coreRegistry "gcac/linux-go-full-agent/internal/core/registry"
)

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

func TestV2RejectsLegacyActions(t *testing.T) {
	result := newLinuxActionRegistry(nil).Execute(context.Background(), coreRegistry.Request{ActionType: "agent.atomic_plan.execute", SchemaVersion: "1.0"})
	if result.Success || result.ErrorCode != "ACTION_HANDLER_NOT_REGISTERED" {
		t.Fatalf("legacy action must be rejected, got %+v", result)
	}
}

func TestLinuxApacheEnvExpandsShellVariablesWithoutPassingRawReferences(t *testing.T) {
	values := parseLinuxApacheEnv(`SUFFIX=""
export APACHE_RUN_DIR=/var/run/apache2$SUFFIX
export APACHE_PID_FILE=${APACHE_RUN_DIR}/apache2.pid
export APACHE_LOG_DIR=${APACHE_RUN_DIR:-/var/log/apache2}
export not_allowed=secret
`)

	joined := strings.Join(values, "\n")
	if !strings.Contains(joined, "APACHE_RUN_DIR=/var/run/apache2") {
		t.Fatalf("应展开 APACHE_RUN_DIR: %v", values)
	}
	if !strings.Contains(joined, "APACHE_PID_FILE=/var/run/apache2/apache2.pid") {
		t.Fatalf("应展开 APACHE_PID_FILE: %v", values)
	}
	if !strings.Contains(joined, "APACHE_LOG_DIR=/var/run/apache2") {
		t.Fatalf("已定义变量优先于默认值: %v", values)
	}
	if strings.Contains(joined, "not_allowed") || strings.Contains(joined, "$SUFFIX") || strings.Contains(joined, "${") {
		t.Fatalf("不得输出原始变量引用或小写变量: %v", values)
	}
}

func TestV2RejectsQueuePayloadWithoutCanonicalActionType(t *testing.T) {
	_, code, _, _ := executeLinuxTaskPayload("task-1", map[string]any{"type": agentPlanExecute})
	if code != "ACTION_HANDLER_NOT_REGISTERED" {
		t.Fatalf("非 canonical 队列字段不得选择 Agent v2 Handler, got %s", code)
	}
}

func TestV2QueueBoundaryConvertsActionTypeToWireAction(t *testing.T) {
	wirePayload, action, schemaVersion, err := decodeQueuedAgentV2Payload(map[string]any{
		"actionType":          agentPlanValidate,
		"actionSchemaVersion": "1.0",
	})
	if err != nil {
		t.Fatalf("canonical 队列动作转换失败: %v", err)
	}
	if action != agentPlanValidate || schemaVersion != "1.0" || stringFromMap(wirePayload, "action") != agentPlanValidate {
		t.Fatalf("队列动作转换结果不正确: action=%s schema=%s payload=%+v", action, schemaVersion, wirePayload)
	}
	if _, exists := wirePayload["actionType"]; exists {
		t.Fatal("进入 Agent v2 wire 后不得保留 actionType")
	}
	if _, exists := wirePayload["actionSchemaVersion"]; exists {
		t.Fatal("进入 Agent v2 wire 后不得保留 actionSchemaVersion")
	}
}

func TestV2QueueBoundaryDefaultsToRegisteredSchemaVersion(t *testing.T) {
	_, action, schemaVersion, err := decodeQueuedAgentV2Payload(map[string]any{
		"actionType": agentFactCollect,
	})
	if err != nil {
		t.Fatalf("缺少 schemaVersion 时 canonical 动作不应失败: %v", err)
	}
	if action != agentFactCollect || schemaVersion != agentV2SchemaVersion {
		t.Fatalf("缺省 schemaVersion 必须回退到 Agent v2 已注册版本: action=%s schema=%s", action, schemaVersion)
	}
}

func TestV2QueueBoundaryRejectsWireAndLegacyActions(t *testing.T) {
	for _, payload := range []map[string]any{
		{"action": agentPlanValidate, "actionSchemaVersion": "1.0"},
		{"actionType": "agent.atomic_plan.execute", "actionSchemaVersion": "1.0"},
		{"actionType": "agent.execute", "actionSchemaVersion": "1.0"},
		{"actionType": "command.execute", "actionSchemaVersion": "1.0"},
		{"actionType": "certificate.deploy", "actionSchemaVersion": "1.0"},
	} {
		if _, _, _, err := decodeQueuedAgentV2Payload(payload); err == nil {
			t.Fatalf("非 canonical Agent v2 动作必须失败关闭: %+v", payload)
		}
	}
}

func TestV2RejectsMissingActionTypeWithoutSelfTestDefault(t *testing.T) {
	_, code, _, _ := executeLinuxTaskPayload("task-1", map[string]any{})
	if code != "ACTION_HANDLER_NOT_REGISTERED" {
		t.Fatalf("缺少队列 actionType 必须失败关闭, got %s", code)
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

func TestV2AllowsOnlyBoundedControlPlaneClockSkew(t *testing.T) {
	now := time.Now().UTC()
	if issuedAtBeyondAuthorizationClockSkew(now.Add(maxAuthorizationClockSkew), now) {
		t.Fatal("授权时钟容差的边界判断不正确")
	}
	if !issuedAtBeyondAuthorizationClockSkew(now.Add(maxAuthorizationClockSkew+time.Nanosecond), now) {
		t.Fatal("超过授权时钟容差的 Token 必须继续被拒绝")
	}
}

func TestV2RejectsMissingOrMismatchedRuntimeAgentID(t *testing.T) {
	fixture := newLinuxV2TestFixture(t)
	for _, runtimeAgentID := range []string{"", "agent-other"} {
		if success, code, _, _ := executeAgentV2(context.Background(), fixture.Request, runtimeAgentID); success || code != "AGENT_V2_AUTHORIZATION_DENIED" {
			t.Fatalf("运行期 Agent ID 为空或不匹配时必须失败关闭: runtimeAgentID=%q success=%v code=%s", runtimeAgentID, success, code)
		}
	}
}

func TestV2ExecutionBoundaryStripsDiscoveryMetadataAndRejectsUnknownFields(t *testing.T) {
	fixture := newLinuxV2TestFixture(t)
	fixture.Request["refreshWebInventory"] = true
	fixture.Request["requestedBy"] = "user-1"
	if success, code, _, _ := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID); !success || code != "" {
		t.Fatalf("调度元数据必须在严格合同前剥离: success=%v code=%s", success, code)
	}
	fixture.Request["unexpected"] = true
	if success, code, _, _ := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID); success || code != "AGENT_V2_MESSAGE_INVALID" {
		t.Fatalf("未声明字段仍必须被严格合同拒绝: success=%v code=%s", success, code)
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
			fixture := newLinuxV2TestFixture(t)
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
	fixture := newLinuxV2TestFixture(t)
	t.Setenv("GCAC_AGENT_RECEIPT_KEY_ID", "")
	t.Setenv("GCAC_AGENT_RECEIPT_SIGNING_KEY_BASE64", "")
	t.Setenv("GCAC_AGENT_RECEIPT_KEYSET_JSON", "")
	fixture.Request["action"] = agentPlanExecute
	if success, code, _, _ := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID); success || code != "AGENT_RECEIPT_SIGNER_UNAVAILABLE" {
		t.Fatalf("缺少 Agent 回执签名材料必须失败关闭: success=%v code=%s", success, code)
	}
}

func TestV2PlanExecuteReportsUnknownWithoutReceiptSigner(t *testing.T) {
	fixture := newLinuxV2TestFixture(t)
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

func TestLinuxPersistentReceiptSignerIsGeneratedAndReused(t *testing.T) {
	root := t.TempDir()
	config := &AgentConfig{}
	config.Paths.Linux.DataDir = root
	config.ReceiptSigningKeyPath = filepath.Join(root, "policy", "agent-receipt-signing-key.bin")
	config.ReceiptKeySetPath = filepath.Join(root, "policy", "agent-receipt-keyset.json")
	t.Setenv("GCAC_AGENT_RECEIPT_KEY_ID", "")
	t.Setenv("GCAC_AGENT_RECEIPT_SIGNING_KEY_BASE64", "")
	t.Setenv("GCAC_AGENT_RECEIPT_KEYSET_JSON", "")

	first, err := loadAgentReceiptSigner(config)
	if err != nil {
		t.Fatalf("Linux Agent 应自动生成持久化 Receipt 签名材料: %v", err)
	}
	if first.KeyID == "" || isDevelopmentKeyID(first.KeyID) {
		t.Fatalf("自动生成的 Receipt KeyId 不合法: %q", first.KeyID)
	}
	if _, err := os.Stat(config.ReceiptSigningKeyPath); err != nil {
		t.Fatalf("Receipt 私钥未持久化: %v", err)
	}
	if _, err := os.Stat(config.ReceiptKeySetPath); err != nil {
		t.Fatalf("Receipt KeySet 未持久化: %v", err)
	}

	second, err := loadAgentReceiptSigner(config)
	if err != nil {
		t.Fatalf("Linux Agent 应复用已持久化 Receipt 签名材料: %v", err)
	}
	if second.KeyID != first.KeyID || !bytes.Equal(second.PrivateKey, first.PrivateKey) {
		t.Fatalf("重复加载不得生成新的 Receipt 身份: first=%q second=%q", first.KeyID, second.KeyID)
	}
}

func TestLinuxPersistentReceiptSignerFailsClosedOnPartialMaterial(t *testing.T) {
	root := t.TempDir()
	config := &AgentConfig{}
	config.Paths.Linux.DataDir = root
	config.ReceiptSigningKeyPath = filepath.Join(root, "policy", "agent-receipt-signing-key.bin")
	config.ReceiptKeySetPath = filepath.Join(root, "policy", "agent-receipt-keyset.json")
	if err := os.MkdirAll(filepath.Dir(config.ReceiptSigningKeyPath), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config.ReceiptSigningKeyPath, []byte("partial"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadAgentReceiptSigner(config); err == nil {
		t.Fatal("Receipt 材料只存在一半时必须失败关闭")
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
	}, AgentCapabilityTokenV1{TokenVersion: agentSecurityContract, TokenID: "token-1", AgentID: "agent-1", TenantID: "tenant-1", PluginID: "web.generic", PluginVersionID: "plugin-version-1", Capability: "filesystem.read", PlanDigest: "digest-1", AllowedPaths: []string{"/etc/gcac/example.conf"}})
	if err == nil {
		t.Fatal("free command operation must be rejected")
	}
}

func TestV2RejectsKeyPathOutsideTokenScope(t *testing.T) {
	fixture := newLinuxV2TestFixture(t)
	tampered := fixture.Plan
	tampered.Operations = append([]agentPlanAction(nil), fixture.Plan.Operations...)
	tampered.Operations[0].Input = map[string]any{
		"path":          fixture.Plan.Operations[0].Input["path"],
		"keyPath":       filepath.Join(t.TempDir(), "outside.key.pem"),
		"contentBase64": base64.StdEncoding.EncodeToString([]byte("v2")),
	}
	digest, err := computeAgentPlanDigest(tampered)
	if err != nil {
		t.Fatal(err)
	}
	tampered.PlanDigest = digest
	fixture.Token.PlanDigest = digest
	if err := validateAgentPlan(tampered, fixture.Token); err == nil {
		t.Fatal("keyPath 不在 Token 路径范围内时必须失败关闭")
	}
}

type linuxV2TestFixture struct {
	Request map[string]any
	Plan    agentPlanV2
	Token   AgentCapabilityTokenV1
	Root    string
}

func newLinuxV2TestFixture(t *testing.T) linuxV2TestFixture {
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
	t.Setenv("GCAC_AGENT_CAPABILITY_KEYSET_JSON", testKeySet("authority-key", capabilityPublic))
	t.Setenv("GCAC_POLICY_AUTHORITY_KEYSET_JSON", testKeySet("authority-key", policyPublic))
	t.Setenv("GCAC_AGENT_RECEIPT_KEY_ID", "agent-receipt-key")
	t.Setenv("GCAC_AGENT_RECEIPT_SIGNING_KEY_BASE64", base64.StdEncoding.EncodeToString(receiptPrivate))
	t.Setenv("GCAC_AGENT_RECEIPT_KEYSET_JSON", testKeySet("agent-receipt-key", receiptPublic))
	localPolicy, _ := json.Marshal(map[string]any{"allowedPaths": []string{root}, "allowedServices": []string{}})
	t.Setenv("GCAC_AGENT_LOCAL_POLICY_JSON", string(localPolicy))
	if err := configurePersistentAgentNonceStore(filepath.Join(root, "nonces")); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	plan := agentPlanV2{
		PlanVersion:     agentSecurityContract,
		PlanID:          "plan-linux-v2-1",
		AgentID:         "agent-linux-1",
		TenantID:        "tenant-1",
		PluginID:        "web.generic",
		PluginVersionID: "plugin-version-1",
		Capability:      "filesystem.atomic_replace",
		Operations: []agentPlanAction{{
			OperationID:    "operation-1",
			OperationType:  "filesystem.atomic_replace",
			Stage:          "execute",
			Input:          map[string]any{"path": target, "contentBase64": base64.StdEncoding.EncodeToString([]byte("v2"))},
			DependsOn:      []string{},
			IdempotencyKey: "idempotency-1",
			TimeoutSeconds: 30,
		}},
		TokenID:          "token-linux-v2-1",
		PolicyDecisionID: "decision-linux-v2-1",
		Nonce:            "nonce-linux-v2-1",
		ExpiresAt:        now.Add(5 * time.Minute).Format(time.RFC3339Nano),
		WriteEffect:      true,
	}
	digest, err := computeAgentPlanDigest(plan)
	if err != nil {
		t.Fatal(err)
	}
	plan.PlanDigest = digest
	token := AgentCapabilityTokenV1{
		TokenVersion: agentSecurityContract, TokenID: plan.TokenID, AgentID: plan.AgentID, TenantID: plan.TenantID,
		PluginID: plan.PluginID, PluginVersionID: plan.PluginVersionID, Capability: plan.Capability,
		Actions:      []string{"filesystem.atomic_replace"},
		AllowedPaths: []string{root}, AllowedServices: []string{}, ArtifactDigests: []string{}, PolicyRef: "policy-1", PolicyVersion: "1",
		IssuedAt: now.Add(-time.Minute).Format(time.RFC3339Nano), ExpiresAt: now.Add(5 * time.Minute).Format(time.RFC3339Nano),
		Nonce: plan.Nonce, PlanDigest: plan.PlanDigest, AuthorityKeyID: "authority-key",
	}
	decision := PolicyAuthorityDecisionV1{
		DecisionVersion: agentSecurityContract, DecisionID: plan.PolicyDecisionID, Allowed: true, AgentID: plan.AgentID, TenantID: plan.TenantID,
		PluginID: plan.PluginID, PluginVersionID: plan.PluginVersionID, Capability: plan.Capability,
		Actions: token.Actions, AllowedPaths: token.AllowedPaths, AllowedServices: token.AllowedServices, ArtifactDigests: token.ArtifactDigests,
		PolicyRef: token.PolicyRef, PolicyVersion: token.PolicyVersion, PlanDigest: plan.PlanDigest, TokenID: token.TokenID, Nonce: token.Nonce,
		IssuedAt: now.Add(-time.Minute).Format(time.RFC3339Nano), ValidUntil: now.Add(5 * time.Minute).Format(time.RFC3339Nano), AuthorityKeyID: "authority-key", RevocationRef: "revocation-1",
	}
	token.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(capabilityPrivate, canonicalJSON(tokenWithoutSignature(token))))
	decision.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(policyPrivate, canonicalJSON(decisionWithoutSignature(decision))))
	request := map[string]any{
		"action": agentPlanValidate, "requestId": "request-linux-v2-1", "agentId": plan.AgentID, "tenantId": plan.TenantID,
		"pluginId": plan.PluginID, "pluginVersion": plan.PluginVersionID, "capability": plan.Capability, "actions": token.Actions,
		"paths": token.AllowedPaths, "services": token.AllowedServices, "artifactDigests": token.ArtifactDigests, "planDigest": plan.PlanDigest,
		"token": token, "policyDecision": decision, "plan": plan,
	}
	return linuxV2TestFixture{Request: request, Plan: plan, Token: token, Root: root}
}

func testKeySet(keyID string, publicKey ed25519.PublicKey) string {
	encoded, _ := json.Marshal(map[string]string{keyID: base64.StdEncoding.EncodeToString(publicKey)})
	return string(encoded)
}

func TestV2RejectsPlanOperationTamperingAfterDigestWasIssued(t *testing.T) {
	fixture := newLinuxV2TestFixture(t)
	tampered := fixture.Plan
	tampered.Operations = append([]agentPlanAction(nil), fixture.Plan.Operations...)
	tampered.Operations[0].Input = map[string]any{"path": filepath.Join(fixture.Root, "managed.conf"), "contentBase64": base64.StdEncoding.EncodeToString([]byte("tampered"))}
	if err := validateAgentPlan(tampered, fixture.Token); err == nil {
		t.Fatal("修改 operations 后必须因完整 planDigest 不匹配而失败关闭")
	}
}

func TestV2NonceIsConsumedOnlyByPlanExecute(t *testing.T) {
	fixture := newLinuxV2TestFixture(t)
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
	fixture := newLinuxV2TestFixture(t)
	fixture.Request["action"] = agentPlanExecute
	success, code, _, detail := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID)
	if !success || code != "" {
		t.Fatalf("执行应生成签名回执: success=%v code=%s", success, code)
	}
	receipt := detail["receipt"].(AgentExecutionReceiptV1)
	if receipt.OperationID != fixture.Plan.Operations[0].OperationID || receipt.OperationID == fixture.Plan.PlanID {
		t.Fatalf("Receipt operationId 必须绑定真实操作: got=%s", receipt.OperationID)
	}
	if err := validateAgentExecutionReceipt(receipt, fixture.Token, agentV2Request{AgentID: fixture.Plan.AgentID, TenantID: fixture.Plan.TenantID}); err != nil {
		t.Fatalf("生成的回执必须可验证: %v", err)
	}
	tampered := receipt
	tampered.Digest = strings.Repeat("0", 64)
	if err := validateAgentExecutionReceipt(tampered, fixture.Token, agentV2Request{AgentID: fixture.Plan.AgentID, TenantID: fixture.Plan.TenantID}); err == nil {
		t.Fatal("篡改回执 digest 必须失败关闭")
	}
	tampered = receipt
	tampered.Signature = base64.StdEncoding.EncodeToString([]byte("forged"))
	if err := validateAgentExecutionReceipt(tampered, fixture.Token, agentV2Request{AgentID: fixture.Plan.AgentID, TenantID: fixture.Plan.TenantID}); err == nil {
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

func TestReceiptCanonicalJSONMatchesControlPlaneForXMLOutput(t *testing.T) {
	receipt := AgentExecutionReceiptV1{
		ReceiptVersion: "gcac.agent-security/v1",
		OperationID:    "op-xml",
		PlanID:         "plan-xml",
		PlanDigest:     strings.Repeat("a", 64),
		AgentID:        "agent-xml",
		TenantID:       "tenant-xml",
		TokenID:        "token-xml",
		Status:         "FAILED",
		StartedAt:      "2026-08-27T00:00:00.000Z",
		CompletedAt:    "2026-08-27T00:00:01.000Z",
		OperationResults: []map[string]any{{
			"operationId": "config-check",
			"error":       `<Connector foo="bar"> & invalid`,
		}},
		NonceConsumed: true,
		ErrorCode:     "AGENT_EXECUTION_FAILED",
		AgentKeyID:    "agent-key",
	}
	digest, err := computeAgentExecutionReceiptDigest(receipt)
	if err != nil {
		t.Fatal(err)
	}
	const controlPlaneDigest = "b7b4cef11b60dcca6f21c59c8e1ea9815b8a27bdecad6113b44c1f3374e8ac76"
	if digest != controlPlaneDigest {
		t.Fatalf("Receipt 摘要必须与控制面的 JSON.stringify 语义一致: got=%s want=%s", digest, controlPlaneDigest)
	}
	legacyDigest, err := computeLegacyGoAgentExecutionReceiptDigest(receipt)
	if err != nil {
		t.Fatal(err)
	}
	if legacyDigest == digest {
		t.Fatalf("XML 特殊字符必须能区分旧 Go HTML 转义摘要: digest=%s", digest)
	}

	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer := agentReceiptSigner{KeyID: receipt.AgentKeyID, PrivateKey: privateKey}
	if err := signAgentExecutionReceipt(&receipt, signer); err != nil {
		t.Fatal(err)
	}
	keySet := map[string]string{receipt.AgentKeyID: base64.StdEncoding.EncodeToString(publicKey)}
	if err := verifySignatureWithKeySetAndCanonicalizer(receipt.AgentKeyID, receipt.Signature, agentReceiptWithoutSignature(receipt), canonicalJSONForReceipt, keySet); err != nil {
		t.Fatalf("Receipt 使用不转义 HTML 的规范化后必须可验签: %v", err)
	}
	if err := verifySignatureWithKeySet(receipt.AgentKeyID, receipt.Signature, agentReceiptWithoutSignature(receipt), keySet); err == nil {
		t.Fatal("默认 Go HTML 转义规范化不得误验收新的 Receipt 签名")
	}
}

func TestV2CancelledWriteProducesUnknownReceipt(t *testing.T) {
	fixture := newLinuxV2TestFixture(t)
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
	fixture := newLinuxV2TestFixture(t)
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

	fixture = newLinuxV2TestFixture(t)
	fixture.Request["action"] = agentPlanExecute
	timedOut, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	if success, code, _, detail := executeAgentV2(timedOut, fixture.Request, fixture.Plan.AgentID); success || code != "AGENT_EXECUTION_UNKNOWN" {
		t.Fatalf("超时写操作必须进入 UNKNOWN: success=%v code=%s detail=%+v", success, code, detail)
	} else if receipt, ok := detail["receipt"].(AgentExecutionReceiptV1); !ok || receipt.Status != "UNKNOWN" || receipt.UnknownReason == "" {
		t.Fatalf("超时写操作必须生成 UNKNOWN Receipt: %+v", detail)
	}
}

func TestLinuxCertificateMaterialValidateParsesCertificateAndPrivateKey(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "apache.test"},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	certificatePem := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	privateKeyPem := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: mustMarshalPKCS8(t, key)})
	certificateCount, privateKeyCount, err := parseLinuxPEMMaterial("/tmp/apache.crt", certificatePem)
	if err != nil || certificateCount != 1 || privateKeyCount != 0 {
		t.Fatalf("证书 PEM 校验失败: certificateCount=%d privateKeyCount=%d err=%v", certificateCount, privateKeyCount, err)
	}
	certificateCount, privateKeyCount, err = parseLinuxPEMMaterial("/tmp/apache.key", privateKeyPem)
	if err != nil || certificateCount != 0 || privateKeyCount != 1 {
		t.Fatalf("私钥 PEM 校验失败: certificateCount=%d privateKeyCount=%d err=%v", certificateCount, privateKeyCount, err)
	}
}

func TestLinuxCertificateMaterialRejectsMismatchedPrivateKey(t *testing.T) {
	certificateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	otherKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "nginx.test"},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &certificateKey.PublicKey, certificateKey)
	if err != nil {
		t.Fatal(err)
	}
	certificatePem := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	matchingKeyPem := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: mustMarshalPKCS8(t, certificateKey)})
	mismatchingKeyPem := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: mustMarshalPKCS8(t, otherKey)})
	operations := func(keyPem []byte) []agentPlanAction {
		return []agentPlanAction{
			{OperationType: "certificate.material.validate", Input: map[string]any{
				"path": filepath.Join(t.TempDir(), "site.crt"), "contentBase64": base64.StdEncoding.EncodeToString(certificatePem),
			}},
			{OperationType: "certificate.material.validate", Input: map[string]any{
				"path": filepath.Join(t.TempDir(), "site.key"), "contentBase64": base64.StdEncoding.EncodeToString(keyPem),
			}},
		}
	}
	if err := validateLinuxCertificateMaterialPair(operations(matchingKeyPem)); err != nil {
		t.Fatalf("匹配的证书和私钥必须通过: %v", err)
	}
	if err := validateLinuxCertificateMaterialPair(operations(mismatchingKeyPem)); err == nil {
		t.Fatal("不匹配的证书和私钥必须在写入前被拒绝")
	}
}

func TestLinuxFilesystemBackupAndRestoreRequireSignedCheckpoint(t *testing.T) {
	fixture := newLinuxV2TestFixture(t)
	signer, err := loadAgentReceiptSigner()
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(fixture.Root, "apache.crt")
	if err := os.WriteFile(target, []byte("old-certificate"), 0o640); err != nil {
		t.Fatal(err)
	}
	operation := agentPlanAction{OperationID: "backup-1", OperationType: "filesystem.backup", Input: map[string]any{
		"path": target, "ledgerRef": "execution-recovery-ledger",
	}}
	detail, err := executeFilesystemBackup(context.Background(), operation, signer)
	if err != nil {
		t.Fatal(err)
	}
	checkpoint, ok := detail["checkpoint"].(map[string]any)
	if !ok || checkpoint["signature"] == "" {
		t.Fatalf("备份必须返回签名 checkpoint: %+v", detail)
	}
	if err := os.WriteFile(target, []byte("new-certificate"), 0o600); err != nil {
		t.Fatal(err)
	}
	restore := agentPlanAction{OperationID: "restore-1", OperationType: "filesystem.restore", Input: map[string]any{
		"path": target, "checkpoint": checkpoint,
	}}
	if _, err := executeFilesystemRestore(context.Background(), restore); err != nil {
		t.Fatalf("签名 checkpoint 恢复失败: %v", err)
	}
	content, err := os.ReadFile(target)
	if err != nil || string(content) != "old-certificate" {
		t.Fatalf("恢复内容不正确: content=%q err=%v", content, err)
	}
	if err := os.WriteFile(target+".gcac-backup", []byte("tampered-backup"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := executeFilesystemRestore(context.Background(), restore); err == nil {
		t.Fatal("篡改备份内容后摘要不匹配必须被拒绝")
	}
	checkpoint["targetPath"] = filepath.Join(fixture.Root, "tampered")
	if _, err := executeFilesystemRestore(context.Background(), restore); err == nil {
		t.Fatal("篡改 checkpoint 必须被拒绝")
	}
	withoutCheckpoint := agentPlanAction{OperationID: "restore-2", OperationType: "filesystem.restore", Input: map[string]any{"path": target, "ledgerRef": "execution-recovery-ledger"}}
	if _, err := executeFilesystemRestore(context.Background(), withoutCheckpoint); err == nil {
		t.Fatal("仅传递 ledgerRef 的恢复请求必须被拒绝")
	}
}

func TestLinuxFilesystemBackupReturnsSignedIdempotentNoOpWhenTargetMatches(t *testing.T) {
	fixture := newLinuxV2TestFixture(t)
	signer, err := loadAgentReceiptSigner()
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(fixture.Root, "apache.crt")
	content := []byte("same-certificate")
	if err := os.WriteFile(target, content, 0o640); err != nil {
		t.Fatal(err)
	}
	detail, err := executeFilesystemBackup(context.Background(), agentPlanAction{
		OperationID:   "backup-noop",
		OperationType: "filesystem.backup",
		Input: map[string]any{
			"path": target, "ledgerRef": "execution-recovery-ledger",
			"contentBase64": base64.StdEncoding.EncodeToString(content),
		},
	}, signer)
	if err != nil {
		t.Fatal(err)
	}
	if detail["alreadyCurrent"] != true || detail["idempotentNoOp"] != true {
		t.Fatalf("相同目标必须返回显式幂等 no-op: %+v", detail)
	}
	if _, err := os.Stat(target + ".gcac-backup"); !os.IsNotExist(err) {
		t.Fatalf("幂等 no-op 不得创建备份文件: err=%v", err)
	}
}

func TestLinuxAgentPlanSkipsAtomicReplaceAndConfigCheckButReloadsForIdempotentNoOp(t *testing.T) {
	fixture := newLinuxV2TestFixture(t)
	signer, err := loadAgentReceiptSigner()
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(fixture.Root, "managed.conf")
	content := []byte("v2")
	if err := os.WriteFile(target, content, 0o640); err != nil {
		t.Fatal(err)
	}
	plan := fixture.Plan
	encoded := base64.StdEncoding.EncodeToString(content)
	plan.Operations = []agentPlanAction{
		{OperationID: "backup-1", OperationType: "filesystem.backup", Stage: "execute", Input: map[string]any{
			"path": target, "ledgerRef": "execution-recovery-ledger", "contentBase64": encoded,
		}, DependsOn: []string{}, IdempotencyKey: "backup-1", TimeoutSeconds: 30},
		{OperationID: "replace-1", OperationType: "filesystem.atomic_replace", Stage: "execute", Input: map[string]any{
			"path": target, "contentBase64": encoded,
		}, DependsOn: []string{"backup-1"}, IdempotencyKey: "replace-1", TimeoutSeconds: 30},
		{OperationID: "config-check", OperationType: "command.execute_allowlisted", Stage: "execute", Input: map[string]any{
			"executablePath": "/bin/false", "workingDirectory": "/", "args": []string{"config-check"},
		}, DependsOn: []string{"replace-1"}, IdempotencyKey: "config-check", TimeoutSeconds: 30},
		{OperationID: "reload-1", OperationType: "service.reload", Stage: "execute", Input: map[string]any{
			"serviceName": "apache-noop-test",
		}, DependsOn: []string{"config-check"}, IdempotencyKey: "reload-1", TimeoutSeconds: 30},
	}
	detailSuccess, code, message, detail := executeAgentPlan(context.Background(), plan, fixture.Token, signer)
	if detailSuccess || code != "AGENT_EXECUTION_UNKNOWN" {
		t.Fatalf("服务重载失败时必须失败关闭并报告 UNKNOWN: success=%v code=%s message=%s detail=%+v", detailSuccess, code, message, detail)
	}
	operationResults, ok := detail["operationResults"].([]map[string]any)
	if !ok || len(operationResults) != 4 {
		t.Fatalf("失败回执必须保留四个操作结果: %+v", detail["operationResults"])
	}
	if operationResults[1]["status"] != "SKIPPED" || operationResults[1]["idempotentNoOp"] != true {
		t.Fatalf("幂等计划必须跳过原子替换: %+v", operationResults[1])
	}
	if operationResults[2]["status"] != "SKIPPED" || operationResults[2]["idempotentNoOp"] != true {
		t.Fatalf("文件幂等时必须跳过配置检查: %+v", operationResults[2])
	}
	if operationResults[3]["status"] == "SKIPPED" || operationResults[3]["idempotentNoOp"] == true {
		t.Fatalf("文件幂等时仍必须执行服务重载: %+v", operationResults[3])
	}
	if _, err := os.Stat(target + ".gcac-backup"); !os.IsNotExist(err) {
		t.Fatalf("幂等计划不得创建备份文件: err=%v", err)
	}
}

func mustMarshalPKCS8(t *testing.T, key *rsa.PrivateKey) []byte {
	t.Helper()
	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func TestV2FactCollectRejectsUnboundScopeAndReturnsGenericFacts(t *testing.T) {
	fixture := newLinuxV2TestFixture(t)
	fixture.Request["action"] = agentFactCollect
	fixture.Request["refreshWebInventory"] = true
	fixture.Request["requestedBy"] = "user-1"
	if success, code, _, detail := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID); !success || code != "" {
		t.Fatalf("事实采集应成功: success=%v code=%s", success, code)
	} else {
		if runtime.GOOS != "linux" {
			fixture.Request["paths"] = []string{filepath.Join(fixture.Root, "outside", "secret")}
			if success, code, _, _ := executeAgentV2(context.Background(), fixture.Request, fixture.Plan.AgentID); success || code != "AGENT_V2_AUTHORIZATION_DENIED" {
				t.Fatalf("事实范围越权必须失败关闭: success=%v code=%s", success, code)
			}
			return
		}
		factEnvelope, ok := detail["factEnvelope"].(map[string]any)
		if !ok {
			t.Fatalf("事实采集必须返回 factEnvelope: %#v", detail)
		}
		facts := factEnvelope["facts"].([]map[string]any)
		seen := map[string]bool{}
		for _, fact := range facts {
			seen[fact["kind"].(string)] = true
		}
		requiredKinds := []string{"process", "service", "file_stat", "privilege", "certificate_store"}
		if len(collectLinuxListeningPorts()) > 0 {
			requiredKinds = append(requiredKinds, "listening_port")
		}
		for _, kind := range requiredKinds {
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
