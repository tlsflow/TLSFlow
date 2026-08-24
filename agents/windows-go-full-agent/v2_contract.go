package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

// 写操作的授权材料不可用时，必须失败关闭并向控制面报告 UNKNOWN。
var errAgentAuthorizationMaterialUnavailable = errors.New("agent authorization material unavailable")

// Agent Core 只理解事实、标准计划和回执，不理解任何第三方产品。
const (
	agentFactCollect      = "agent.fact.collect"
	agentPlanValidate     = "agent.plan.validate"
	agentPlanExecute      = "agent.plan.execute"
	agentExecutionReceipt = "agent.execution.receipt"
	agentSecurityContract = "gcac.agent-security/v1"
	agentTokenVersion     = agentSecurityContract
	policyDecisionVersion = agentSecurityContract
	maxPlanOperations     = 100
	// 控制面与受管主机的 NTP 收敛存在短暂偏差时，仍允许已签名的短期授权执行。
	// 过期时间仍使用当前主机时间严格校验，超出该窗口的未来 Token 继续失败关闭。
	maxAuthorizationClockSkew = time.Minute
)

type AgentCapabilityTokenV1 struct {
	TokenVersion    string   `json:"tokenVersion"`
	TokenID         string   `json:"tokenId"`
	AgentID         string   `json:"agentId"`
	TenantID        string   `json:"tenantId"`
	PluginID        string   `json:"pluginId"`
	PluginVersionID string   `json:"pluginVersionId"`
	Capability      string   `json:"capability"`
	Actions         []string `json:"actions"`
	AllowedPaths    []string `json:"allowedPaths"`
	AllowedServices []string `json:"allowedServices"`
	ArtifactDigests []string `json:"artifactDigests"`
	ApprovalRef     string   `json:"approvalRef,omitempty"`
	PolicyRef       string   `json:"policyRef"`
	PolicyVersion   string   `json:"policyVersion"`
	IssuedAt        string   `json:"issuedAt"`
	ExpiresAt       string   `json:"expiresAt"`
	Nonce           string   `json:"nonce"`
	PlanDigest      string   `json:"planDigest"`
	AuthorityKeyID  string   `json:"authorityKeyId"`
	Signature       string   `json:"signature"`
}

type PolicyAuthorityDecisionV1 struct {
	DecisionVersion string   `json:"decisionVersion"`
	DecisionID      string   `json:"decisionId"`
	Allowed         bool     `json:"allowed"`
	AgentID         string   `json:"agentId"`
	TenantID        string   `json:"tenantId"`
	PluginID        string   `json:"pluginId"`
	PluginVersionID string   `json:"pluginVersionId"`
	Capability      string   `json:"capability"`
	Actions         []string `json:"actions"`
	AllowedPaths    []string `json:"allowedPaths"`
	AllowedServices []string `json:"allowedServices"`
	ArtifactDigests []string `json:"artifactDigests"`
	PolicyRef       string   `json:"policyRef"`
	PolicyVersion   string   `json:"policyVersion"`
	PlanDigest      string   `json:"planDigest"`
	TokenID         string   `json:"tokenId"`
	Nonce           string   `json:"nonce"`
	ApprovalRef     string   `json:"approvalRef,omitempty"`
	IssuedAt        string   `json:"issuedAt"`
	ValidUntil      string   `json:"validUntil"`
	AuthorityKeyID  string   `json:"authorityKeyId"`
	RevocationRef   string   `json:"revocationRef"`
	Signature       string   `json:"signature"`
	Reason          string   `json:"reason,omitempty"`
}

type AgentPlanV1 struct {
	PlanVersion      string                 `json:"planVersion"`
	PlanID           string                 `json:"planId"`
	AgentID          string                 `json:"agentId"`
	TenantID         string                 `json:"tenantId"`
	PluginID         string                 `json:"pluginId"`
	PluginVersionID  string                 `json:"pluginVersionId"`
	Capability       string                 `json:"capability"`
	Operations       []AgentPlanOperationV1 `json:"operations"`
	PlanDigest       string                 `json:"planDigest"`
	TokenID          string                 `json:"tokenId"`
	PolicyDecisionID string                 `json:"policyDecisionId"`
	Nonce            string                 `json:"nonce"`
	ExpiresAt        string                 `json:"expiresAt"`
	WriteEffect      bool                   `json:"writeEffect"`
	ApprovalRef      string                 `json:"approvalRef,omitempty"`
}

type AgentPlanOperationV1 struct {
	OperationID    string         `json:"operationId"`
	OperationType  string         `json:"operationType"`
	Stage          string         `json:"stage"`
	Input          map[string]any `json:"input"`
	DependsOn      []string       `json:"dependsOn"`
	IdempotencyKey string         `json:"idempotencyKey"`
	TimeoutSeconds int            `json:"timeoutSeconds"`
	Compensation   string         `json:"compensation,omitempty"`
}

type AgentExecutionReceiptV1 struct {
	ReceiptVersion   string           `json:"receiptVersion"`
	OperationID      string           `json:"operationId"`
	PlanID           string           `json:"planId"`
	PlanDigest       string           `json:"planDigest"`
	AgentID          string           `json:"agentId"`
	TenantID         string           `json:"tenantId"`
	TokenID          string           `json:"tokenId"`
	Status           string           `json:"status"`
	StartedAt        string           `json:"startedAt"`
	CompletedAt      string           `json:"completedAt"`
	OperationResults []map[string]any `json:"operationResults"`
	NonceConsumed    bool             `json:"nonceConsumed"`
	ErrorCode        string           `json:"errorCode,omitempty"`
	UnknownReason    string           `json:"unknownReason,omitempty"`
	Digest           string           `json:"digest"`
	AgentKeyID       string           `json:"agentKeyId"`
	Signature        string           `json:"signature"`
}

type agentPlanV2 = AgentPlanV1
type agentPlanAction = AgentPlanOperationV1

type agentV2Request struct {
	Action          string                    `json:"action"`
	RequestID       string                    `json:"requestId"`
	AgentID         string                    `json:"agentId"`
	TenantID        string                    `json:"tenantId"`
	PluginID        string                    `json:"pluginId"`
	PluginVersion   string                    `json:"pluginVersion"`
	Capability      string                    `json:"capability"`
	Actions         []string                  `json:"actions"`
	Paths           []string                  `json:"paths"`
	Services        []string                  `json:"services"`
	ArtifactDigests []string                  `json:"artifactDigests"`
	PlanDigest      string                    `json:"planDigest"`
	Token           AgentCapabilityTokenV1    `json:"token"`
	PolicyDecision  PolicyAuthorityDecisionV1 `json:"policyDecision"`
	DiscoverySpec   agentDiscoverySpecV1      `json:"discoverySpec,omitempty"`
	Plan            agentPlanV2               `json:"plan"`
	Receipt         *AgentExecutionReceiptV1  `json:"receipt,omitempty"`
}

type agentDiscoverySpecV1 struct {
	SpecVersion string                    `json:"specVersion,omitempty"`
	Source      string                    `json:"source,omitempty"`
	Profiles    []agentDiscoveryProfileV1 `json:"profiles,omitempty"`
}

type agentDiscoveryProfileV1 struct {
	PluginID                   string   `json:"pluginId,omitempty"`
	FrameworkType              string   `json:"frameworkType,omitempty"`
	ProcessNames               []string `json:"processNames,omitempty"`
	ServiceNames               []string `json:"serviceNames,omitempty"`
	CommandLineContains        []string `json:"commandLineContains,omitempty"`
	ConfigArgKeys              []string `json:"configArgKeys,omitempty"`
	RootArgKeys                []string `json:"rootArgKeys,omitempty"`
	ConfigPathHints            []string `json:"configPathHints,omitempty"`
	TargetPathHints            []string `json:"targetPathHints,omitempty"`
	DefaultConfigRelativePaths []string `json:"defaultConfigRelativePaths,omitempty"`
	ConfigFileNames            []string `json:"configFileNames,omitempty"`
	CertificateFileExtensions  []string `json:"certificateFileExtensions,omitempty"`
	ListeningPorts             []int    `json:"listeningPorts,omitempty"`
}

func validateAgentWebDiscoveryPlanDigest(request map[string]any) error {
	if !boolFromMap(request, "refreshWebInventory") {
		return nil
	}
	if _, exists := request["discoverySpec"]; !exists {
		return errors.New("Web 发现请求缺少 discoverySpec")
	}
	spec := agentDiscoverySpecFromValue(request["discoverySpec"])
	if spec.SpecVersion != "gcac.agent-web-discovery/v1" || spec.Source != "declarative-plugin-metadata" {
		return errors.New("Web 发现 discoverySpec 版本或来源无效")
	}
	paths, err := stringArray(request["paths"])
	if err != nil {
		return errors.New("Web 发现 paths 不是合法字符串数组")
	}
	expected := map[string]any{
		"actionType":          firstNonEmpty(stringFromMap(request, "actionType"), stringFromMap(request, "action")),
		"agentId":             stringFromMap(request, "agentId"),
		"tenantId":            stringFromMap(request, "tenantId"),
		"pluginId":            stringFromMap(request, "pluginId"),
		"pluginVersionId":     firstNonEmpty(stringFromMap(request, "pluginVersionId"), stringFromMap(request, "pluginVersion")),
		"capability":          stringFromMap(request, "capability"),
		"paths":               paths,
		"discoverySpec":       discoverySpecDigestValue(spec),
		"refreshWebInventory": true,
	}
	expectedDigest := sha256Bytes(canonicalJSON(expected))
	if !strings.EqualFold(expectedDigest, stringFromMap(request, "planDigest")) {
		return errors.New("Web 发现 discoverySpec 未绑定到签名 planDigest")
	}
	return nil
}

func discoverySpecDigestValue(spec agentDiscoverySpecV1) map[string]any {
	profiles := make([]map[string]any, 0, len(spec.Profiles))
	for _, profile := range spec.Profiles {
		profiles = append(profiles, map[string]any{
			"pluginId":                   profile.PluginID,
			"frameworkType":              profile.FrameworkType,
			"processNames":               profile.ProcessNames,
			"serviceNames":               profile.ServiceNames,
			"commandLineContains":        profile.CommandLineContains,
			"configArgKeys":              profile.ConfigArgKeys,
			"rootArgKeys":                profile.RootArgKeys,
			"configPathHints":            profile.ConfigPathHints,
			"targetPathHints":            profile.TargetPathHints,
			"defaultConfigRelativePaths": profile.DefaultConfigRelativePaths,
			"configFileNames":            profile.ConfigFileNames,
			"certificateFileExtensions":  profile.CertificateFileExtensions,
			"listeningPorts":             profile.ListeningPorts,
		})
	}
	return map[string]any{
		"specVersion": spec.SpecVersion,
		"source":      spec.Source,
		"profiles":    profiles,
	}
}

func executeAgentV2(ctx context.Context, request map[string]any, agentID string) (bool, string, string, map[string]any) {
	// 重新发现标记和操作者是控制面调度元数据，不属于签名 Agent v2 载荷。
	// 只在进入严格合同前移除这两个已声明的外层字段，其他未知字段仍会失败关闭。
	if err := validateAgentWebDiscoveryPlanDigest(request); err != nil {
		return false, "AGENT_V2_AUTHORIZATION_DENIED", err.Error(), nil
	}
	encoded, err := json.Marshal(agentV2ContractPayload(request))
	if err != nil || len(encoded) > 1<<20 {
		return false, "AGENT_V2_MESSAGE_INVALID", "Agent v2 请求无效或超长", nil
	}
	var envelope agentV2Request
	if err := decodeAgentV2Request(encoded, &envelope); err != nil {
		return false, "AGENT_V2_MESSAGE_INVALID", err.Error(), nil
	}
	if err := validateAgentV2Request(envelope, agentID); err != nil {
		if envelope.Action == agentPlanExecute && errors.Is(err, errAgentAuthorizationMaterialUnavailable) {
			return false, "AGENT_V2_AUTHORIZATION_DENIED", err.Error(), unknownAgentWriteDetail(envelope.Plan, "写操作授权材料不可用，状态不明", map[string]any{
				"authorizationUnavailable": true,
			})
		}
		return false, "AGENT_V2_AUTHORIZATION_DENIED", err.Error(), nil
	}
	switch envelope.Action {
	case agentFactCollect:
		return collectAgentFacts(ctx, envelope)
	case agentPlanValidate:
		if err := validateAgentPlan(envelope.Plan, envelope.Token); err != nil {
			return false, "AGENT_PLAN_INVALID", err.Error(), nil
		}
		return true, "", "", map[string]any{"planDigest": envelope.Plan.PlanDigest, "validated": true}
	case agentPlanExecute:
		return executeAuthorizedAgentPlan(ctx, envelope.Plan, envelope.Token)
	case agentExecutionReceipt:
		receipt, err := loadAndValidateAgentExecutionReceipt(envelope)
		if err != nil {
			return false, "AGENT_RECEIPT_INVALID", err.Error(), nil
		}
		return true, "", "", map[string]any{"receiptAccepted": true, "receipt": receipt}
	default:
		return false, "AGENT_V2_ACTION_UNSUPPORTED", "Agent v2 动作不在长期合同内", nil
	}
}

func validateAgentV2Request(request agentV2Request, agentID string) error {
	if !containsString([]string{agentFactCollect, agentPlanValidate, agentPlanExecute, agentExecutionReceipt}, request.Action) {
		return errors.New("action is not part of Agent v2 contract")
	}
	if request.RequestID == "" || request.AgentID == "" || request.TenantID == "" || request.PluginID == "" || request.PluginVersion == "" || request.Capability == "" {
		return errors.New("requestId, agent, tenant, plugin and capability bindings are required")
	}
	if strings.TrimSpace(agentID) == "" || request.AgentID != agentID {
		return errors.New("agent identity does not match request")
	}
	if err := validateCapabilityToken(request.Token, request.PolicyDecision, request); err != nil {
		return err
	}
	if request.Action == agentPlanValidate || request.Action == agentPlanExecute {
		if request.Plan.PlanVersion == "" || request.Plan.PlanID == "" || request.Plan.PlanDigest == "" || request.Plan.PlanDigest != request.Token.PlanDigest {
			return errors.New("planVersion, planId and planDigest are invalid")
		}
		if err := validateAgentPlan(request.Plan, request.Token); err != nil {
			return err
		}
		if err := validateAgentPlanAuthorization(request.Plan, request.PolicyDecision); err != nil {
			return err
		}
		if err := validateAgentPlanLocalPolicy(request.Plan); err != nil {
			return err
		}
	}
	if request.Action == agentExecutionReceipt && request.PlanDigest != request.Token.PlanDigest {
		return errors.New("receipt planDigest does not match capability token")
	}
	return nil
}

func validateCapabilityToken(token AgentCapabilityTokenV1, decision PolicyAuthorityDecisionV1, request agentV2Request) error {
	if token.TokenVersion == "" || decision.DecisionVersion == "" {
		return unavailableAgentAuthorizationMaterial("security contract material is unavailable")
	}
	if token.TokenVersion != agentTokenVersion || decision.DecisionVersion != policyDecisionVersion {
		return errors.New("security contract version is unsupported")
	}
	if token.AgentID != request.AgentID || token.TenantID != request.TenantID || token.PluginID != request.PluginID || token.PluginVersionID != request.PluginVersion || token.Capability != request.Capability {
		return errors.New("capability token binding mismatch")
	}
	if !sameStringSet(token.Actions, request.Actions) || !sameStringSet(token.AllowedPaths, request.Paths) || !sameStringSet(token.AllowedServices, request.Services) || !sameStringSet(token.ArtifactDigests, request.ArtifactDigests) {
		return errors.New("capability token scope mismatch")
	}
	if decision.TenantID != request.TenantID || decision.AgentID != request.AgentID || decision.PluginID != request.PluginID || decision.PluginVersionID != request.PluginVersion || decision.Capability != request.Capability {
		return errors.New("policy authority decision binding mismatch")
	}
	if token.PolicyRef != decision.PolicyRef || token.PolicyVersion != decision.PolicyVersion || token.Nonce != decision.Nonce || token.AuthorityKeyID != decision.AuthorityKeyID || token.TokenID != decision.TokenID || token.PlanDigest != decision.PlanDigest || token.ApprovalRef != decision.ApprovalRef || !sameStringSet(token.Actions, decision.Actions) || !sameStringSet(token.AllowedPaths, decision.AllowedPaths) || !sameStringSet(token.AllowedServices, decision.AllowedServices) || !sameStringSet(token.ArtifactDigests, decision.ArtifactDigests) || !decision.Allowed {
		return errors.New("policy authority decision mismatch or denied")
	}
	if err := verifySignedValue(token.AuthorityKeyID, token.Signature, tokenWithoutSignature(token), "GCAC_AGENT_CAPABILITY_KEYSET_JSON"); err != nil {
		return err
	}
	if err := verifySignedValue(decision.AuthorityKeyID, decision.Signature, decisionWithoutSignature(decision), "GCAC_POLICY_AUTHORITY_KEYSET_JSON"); err != nil {
		return err
	}
	now := time.Now()
	issuedAt, err := time.Parse(time.RFC3339Nano, token.IssuedAt)
	if err != nil || issuedAtBeyondAuthorizationClockSkew(issuedAt, now) {
		return errors.New("capability token issuedAt is invalid")
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, token.ExpiresAt)
	if err != nil || !now.Before(expiresAt) {
		return errors.New("capability token is expired or invalid")
	}
	decisionIssuedAt, err := time.Parse(time.RFC3339Nano, decision.IssuedAt)
	if err != nil || issuedAtBeyondAuthorizationClockSkew(decisionIssuedAt, now) {
		return errors.New("policy authority decision issuedAt is invalid")
	}
	decisionExpiresAt, err := time.Parse(time.RFC3339Nano, decision.ValidUntil)
	if err != nil || !now.Before(decisionExpiresAt) || expiresAt.After(decisionExpiresAt) {
		return errors.New("policy authority decision is expired or less restrictive than token")
	}
	if revokedNonce(token.Nonce) {
		return errors.New("capability token nonce is revoked")
	}
	if err := validateLocalPolicy(request.Paths, request.Services); err != nil {
		return err
	}
	return nil
}

func issuedAtBeyondAuthorizationClockSkew(issuedAt, now time.Time) bool {
	return issuedAt.After(now.Add(maxAuthorizationClockSkew))
}

func collectAgentFacts(ctx context.Context, request agentV2Request) (bool, string, string, map[string]any) {
	started := time.Now()
	scanCtx, cancel := context.WithTimeout(ctx, windowsDiscoveryScanTimeout)
	defer cancel()
	budget := newWindowsDiscoveryBudget(scanCtx, windowsDiscoveryVisitLimit)
	phaseDurations := map[string]int64{}
	timed := func(phase string, run func()) {
		phaseStarted := time.Now()
		run()
		phaseDurations[phase] = time.Since(phaseStarted).Milliseconds()
	}
	collectedAt := time.Now().UTC().Format(time.RFC3339Nano)
	facts := make([]map[string]any, 0, 16)
	warnings := make([]string, 0)
	discoverySpec := sanitizeAgentDiscoverySpec(request.DiscoverySpec)
	ports := []map[string]any{}
	processes := []map[string]any{}
	requestServices := []map[string]any{}
	discoveryServices := []map[string]any{}
	discoveryFiles := []map[string]any{}
	certificateFacts := []map[string]any{}
	sslBindings := []map[string]any{}
	certificateStores := []map[string]any{}
	timed("ports", func() {
		ports = collectWindowsListeningPorts(scanCtx)
	})
	timed("processes", func() {
		processes = collectWindowsProcesses(scanCtx, ports)
	})
	timed("services", func() {
		requestServices = collectWindowsServices(scanCtx, request.Services)
		discoveryServices = collectWindowsDiscoveryServices(scanCtx, discoverySpec)
	})
	timed("config", func() {
		// request.paths 是安全授权边界，不是扫描根目录。真实配置入口只能来自插件静态声明、
		// 监听端口关联进程、进程命令行和服务注册表参数。
		discoveryFiles = collectWindowsDiscoveryFiles(scanCtx, discoverySpec, processes, discoveryServices)
	})
	timed("certificates", func() {
		certificateFacts = collectWindowsCertificateFactsFromConfigFacts(discoverySpec, discoveryFiles)
		sslBindings = collectWindowsSSLCertificateBindings(scanCtx)
		certificateStores = collectWindowsCertificateStores(scanCtx)
	})
	facts = append(facts, processes...)
	facts = append(facts, requestServices...)
	facts = append(facts, discoveryServices...)
	facts = append(facts, discoveryFiles...)
	facts = append(facts, certificateFacts...)
	if len(ports) == 0 {
		warnings = append(warnings, "未发现可读取的监听端口")
	}
	facts = append(facts, ports...)
	facts = append(facts, sslBindings...)
	facts = append(facts, collectWindowsPermissions())
	facts = append(facts, certificateStores...)
	envelope := map[string]any{
		"contractVersion": agentSecurityContract,
		"factId":          request.RequestID,
		"agentId":         request.AgentID,
		"tenantId":        request.TenantID,
		"collectedAt":     collectedAt,
		"ttlSeconds":      300,
		"source":          "windows",
		"facts":           facts,
		"warnings":        warnings,
		"diagnostics": map[string]any{
			"phaseDurationsMs":    phaseDurations,
			"totalMs":             time.Since(started).Milliseconds(),
			"requestPathsScanned": false,
			"visitedEntries":      budget.visitedCount(),
			"stopped":             budget.stopped(),
			"stopReason":          budget.stopReason(),
			"processes":           len(processes),
			"services":            len(requestServices) + len(discoveryServices),
			"configFiles":         len(discoveryFiles),
			"certificateFacts":    len(certificateFacts) + len(certificateStores),
			"sslBindings":         len(sslBindings),
		},
	}
	digest, err := computeAgentFactDigest(envelope)
	if err != nil {
		return false, "AGENT_FACT_COLLECTION_FAILED", "通用事实摘要生成失败", nil
	}
	envelope["digest"] = digest
	return true, "", "", map[string]any{"factEnvelope": envelope}
}

func sanitizeAgentDiscoverySpec(spec agentDiscoverySpecV1) agentDiscoverySpecV1 {
	if spec.SpecVersion != "" && spec.SpecVersion != "gcac.agent-web-discovery/v1" {
		return agentDiscoverySpecV1{}
	}
	result := agentDiscoverySpecV1{SpecVersion: "gcac.agent-web-discovery/v1", Source: "declarative-plugin-metadata"}
	for _, profile := range spec.Profiles {
		if len(result.Profiles) >= 16 {
			break
		}
		normalized := agentDiscoveryProfileV1{
			PluginID:                   sanitizeDiscoveryIdentifier(profile.PluginID),
			FrameworkType:              sanitizeDiscoveryIdentifier(profile.FrameworkType),
			ProcessNames:               sanitizeDiscoveryStrings(profile.ProcessNames, 32, validDiscoveryName),
			ServiceNames:               sanitizeDiscoveryStrings(profile.ServiceNames, 32, validDiscoveryName),
			CommandLineContains:        sanitizeDiscoveryStrings(profile.CommandLineContains, 16, validDiscoveryNeedle),
			ConfigArgKeys:              sanitizeDiscoveryStrings(profile.ConfigArgKeys, 16, validDiscoveryArgKey),
			RootArgKeys:                sanitizeDiscoveryStrings(profile.RootArgKeys, 16, validDiscoveryArgKey),
			ConfigPathHints:            sanitizeDiscoveryStrings(profile.ConfigPathHints, 32, filepath.IsAbs),
			TargetPathHints:            sanitizeDiscoveryStrings(profile.TargetPathHints, 32, filepath.IsAbs),
			DefaultConfigRelativePaths: sanitizeDiscoveryStrings(profile.DefaultConfigRelativePaths, 16, validRelativeDiscoveryPath),
			ConfigFileNames:            sanitizeDiscoveryStrings(profile.ConfigFileNames, 32, validDiscoveryFileName),
			CertificateFileExtensions:  sanitizeDiscoveryStrings(profile.CertificateFileExtensions, 16, validDiscoveryExtension),
			ListeningPorts:             sanitizeDiscoveryPorts(profile.ListeningPorts, 32),
		}
		if normalized.PluginID == "" || normalized.FrameworkType == "" {
			continue
		}
		result.Profiles = append(result.Profiles, normalized)
	}
	return result
}

func agentDiscoverySpecFromValue(value any) agentDiscoverySpecV1 {
	if spec, ok := value.(agentDiscoverySpecV1); ok {
		return sanitizeAgentDiscoverySpec(spec)
	}
	if value == nil {
		return agentDiscoverySpecV1{}
	}
	encoded, err := json.Marshal(value)
	if err != nil || len(encoded) > 256*1024 {
		return agentDiscoverySpecV1{}
	}
	var spec agentDiscoverySpecV1
	if err := json.Unmarshal(encoded, &spec); err != nil {
		return agentDiscoverySpecV1{}
	}
	return sanitizeAgentDiscoverySpec(spec)
}

func sanitizeDiscoveryIdentifier(value string) string {
	value = strings.TrimSpace(value)
	if len(value) == 0 || len(value) > 128 {
		return ""
	}
	for _, current := range value {
		if (current >= 'a' && current <= 'z') || (current >= 'A' && current <= 'Z') || (current >= '0' && current <= '9') || current == '.' || current == '_' || current == '-' || current == ':' {
			continue
		}
		return ""
	}
	return value
}

func sanitizeDiscoveryStrings(values []string, limit int, valid func(string) bool) []string {
	result := make([]string, 0, minInt(len(values), limit))
	seen := map[string]struct{}{}
	for _, value := range values {
		if len(result) >= limit {
			break
		}
		value = strings.TrimSpace(value)
		if !valid(value) {
			continue
		}
		key := strings.ToLower(filepath.ToSlash(value))
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
	}
	return result
}

func sanitizeDiscoveryPorts(values []int, limit int) []int {
	result := make([]int, 0, minInt(len(values), limit))
	seen := map[int]struct{}{}
	for _, port := range values {
		if len(result) >= limit {
			break
		}
		if port <= 0 || port > 65535 {
			continue
		}
		if _, exists := seen[port]; exists {
			continue
		}
		seen[port] = struct{}{}
		result = append(result, port)
	}
	sort.Ints(result)
	return result
}

func validDiscoveryName(value string) bool {
	if value == "" || len(value) > 128 || strings.ContainsAny(value, `/\`) {
		return false
	}
	for _, current := range value {
		if (current >= 'a' && current <= 'z') || (current >= 'A' && current <= 'Z') || (current >= '0' && current <= '9') || current == '.' || current == '_' || current == '-' || current == '*' || current == ':' {
			continue
		}
		return false
	}
	return true
}

func validDiscoveryNeedle(value string) bool {
	return value != "" && len(value) <= 128 && !strings.ContainsAny(value, "\x00\r\n;&|<>")
}

func validDiscoveryArgKey(value string) bool {
	return value != "" && len(value) <= 64 && strings.HasPrefix(value, "-") && !strings.ContainsAny(value, "\x00\r\n;&|<>")
}

func validRelativeDiscoveryPath(value string) bool {
	if value == "" || len(value) > 260 || filepath.IsAbs(value) {
		return false
	}
	normalized := filepath.ToSlash(filepath.Clean(value))
	return normalized != "." && !strings.HasPrefix(normalized, "../") && normalized != ".."
}

func validDiscoveryFileName(value string) bool {
	return value != "" && len(value) <= 128 && !strings.ContainsAny(value, `/\`+"\x00\r\n") && (strings.HasPrefix(value, "*.") || !strings.Contains(value, "*"))
}

func validDiscoveryExtension(value string) bool {
	if value == "" || len(value) > 32 || !strings.HasPrefix(value, ".") {
		return false
	}
	for _, current := range value[1:] {
		if (current >= 'a' && current <= 'z') || (current >= 'A' && current <= 'Z') || (current >= '0' && current <= '9') {
			continue
		}
		return false
	}
	return true
}

func collectWindowsProcesses(ctx context.Context, snapshots ...[]map[string]any) []map[string]any {
	executablePath, err := os.Executable()
	result := make([]map[string]any, 0, 16)
	seen := map[uint32]struct{}{}
	appendProcess := func(pid uint32, path string) {
		if pid == 0 || path == "" || !filepath.IsAbs(path) {
			return
		}
		if _, exists := seen[pid]; exists {
			return
		}
		seen[pid] = struct{}{}
		process := map[string]any{"kind": "process", "pid": pid, "executablePath": filepath.ToSlash(path)}
		if digest, digestErr := sha256FileDigest(path); digestErr == nil {
			process["executableSha256"] = digest
		}
		result = append(result, process)
	}
	if err == nil {
		appendProcess(uint32(os.Getpid()), executablePath)
	}
	ports := []map[string]any(nil)
	if len(snapshots) > 0 {
		ports = snapshots[0]
	} else {
		ports = collectWindowsListeningPorts(ctx)
	}
	for _, port := range ports {
		pid := uint32(intFromMap(port, "pid"))
		if pid == 0 {
			continue
		}
		appendProcess(pid, windowsProcessExecutablePath(pid))
	}
	return result
}

func collectWindowsServices(ctx context.Context, names []string) []map[string]any {
	if len(names) == 0 {
		names = []string{"agent-core"}
	}
	services := make([]map[string]any, 0, len(names))
	for _, name := range names {
		item := map[string]any{"kind": "service", "name": name, "status": "unknown"}
		if !validWindowsServiceName(name) {
			services = append(services, item)
			continue
		}
		command := exec.CommandContext(ctx, windowsSystemControlPath, "query", name)
		command.Dir = windowsSystem32Directory
		command.Env = fixedWindowsEnvironment()
		output, err := command.Output()
		if err == nil {
			text := string(output)
			switch {
			case strings.Contains(text, "RUNNING"):
				item["status"] = "running"
			case strings.Contains(text, "STOPPED"):
				item["status"] = "stopped"
			}
		}
		services = append(services, item)
	}
	return services
}

func collectWindowsDiscoveryServices(ctx context.Context, spec agentDiscoverySpecV1) []map[string]any {
	if len(spec.Profiles) == 0 {
		return []map[string]any{}
	}
	command := exec.CommandContext(ctx, windowsSystemControlPath, "query", "type=", "service", "state=", "all")
	command.Dir = windowsSystem32Directory
	command.Env = fixedWindowsEnvironment()
	output, err := command.Output()
	if err != nil {
		return []map[string]any{}
	}
	services := parseWindowsScQueryServices(string(output))
	result := make([]map[string]any, 0, len(services))
	seen := map[string]struct{}{}
	for _, service := range services {
		name := strings.TrimSpace(stringFromMap(service, "name"))
		if name == "" {
			continue
		}
		if !matchesDiscoveryServiceIdentity(service, spec) {
			continue
		}
		pathName := windowsServiceImagePath(ctx, name)
		if pathName != "" {
			service["pathName"] = pathName
			service["executablePath"] = windowsExecutableFromCommandLine(pathName)
		}
		if !matchesDiscoveryService(service, spec) {
			continue
		}
		key := strings.ToLower(name)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		item := map[string]any{"kind": "service", "name": name, "status": strings.ToLower(strings.TrimSpace(stringFromMap(service, "status")))}
		for _, field := range []string{"displayName", "executablePath", "pathName"} {
			if value := strings.TrimSpace(stringFromMap(service, field)); value != "" {
				item[field] = value
			}
		}
		result = append(result, item)
	}
	return result
}

func matchesDiscoveryServiceIdentity(service map[string]any, spec agentDiscoverySpecV1) bool {
	haystack := strings.ToLower(strings.Join([]string{
		stringFromMap(service, "name"),
		stringFromMap(service, "displayName"),
	}, " "))
	if strings.TrimSpace(haystack) == "" {
		return false
	}
	for _, profile := range spec.Profiles {
		for _, name := range append(append([]string{}, profile.ServiceNames...), profile.ProcessNames...) {
			name = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(name), ".exe"))
			if name != "" && strings.Contains(haystack, name) {
				return true
			}
		}
		for _, needle := range profile.CommandLineContains {
			if strings.Contains(haystack, strings.ToLower(needle)) {
				return true
			}
		}
	}
	return false
}

func parseWindowsScQueryServices(output string) []map[string]any {
	services := make([]map[string]any, 0, 64)
	current := map[string]any{}
	flush := func() {
		if strings.TrimSpace(stringFromMap(current, "name")) != "" {
			services = append(services, current)
		}
		current = map[string]any{}
	}
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "service_name:") {
			flush()
			current["name"] = strings.TrimSpace(trimmed[len("SERVICE_NAME:"):])
			continue
		}
		if strings.HasPrefix(lower, "display_name:") {
			current["displayName"] = strings.TrimSpace(trimmed[len("DISPLAY_NAME:"):])
			continue
		}
		if strings.HasPrefix(lower, "state") {
			parts := strings.Fields(trimmed)
			if len(parts) > 0 {
				status := strings.ToLower(parts[len(parts)-1])
				if status == "running" || status == "stopped" || status == "paused" {
					current["status"] = status
				}
			}
		}
	}
	flush()
	return services
}

func matchesDiscoveryService(service map[string]any, spec agentDiscoverySpecV1) bool {
	haystack := strings.ToLower(strings.Join([]string{
		stringFromMap(service, "name"),
		stringFromMap(service, "displayName"),
		stringFromMap(service, "pathName"),
		filepath.Base(stringFromMap(service, "executablePath")),
	}, " "))
	if strings.TrimSpace(haystack) == "" {
		return false
	}
	for _, profile := range spec.Profiles {
		for _, name := range append(append([]string{}, profile.ServiceNames...), profile.ProcessNames...) {
			name = strings.ToLower(strings.TrimSuffix(strings.TrimSpace(name), ".exe"))
			if name == "" {
				continue
			}
			if strings.Contains(haystack, name) {
				return true
			}
		}
		for _, needle := range profile.CommandLineContains {
			if strings.Contains(haystack, strings.ToLower(needle)) {
				return true
			}
		}
	}
	return false
}

func collectWindowsDiscoveryFiles(ctx context.Context, spec agentDiscoverySpecV1, processes []map[string]any, services []map[string]any) []map[string]any {
	if len(spec.Profiles) == 0 {
		return []map[string]any{}
	}
	candidates := windowsDiscoveryCandidatePaths(ctx, spec, processes, services)
	files := make([]map[string]any, 0, len(candidates)*2)
	seen := map[string]struct{}{}
	appendFile := func(path string) {
		path = strings.TrimSpace(path)
		if path == "" || !filepath.IsAbs(path) {
			return
		}
		key := strings.ToLower(filepath.Clean(path))
		if _, exists := seen[key]; exists {
			return
		}
		seen[key] = struct{}{}
		if isWindowsDiscoveryCertificatePath(spec, path) {
			if certificate := collectWindowsCertificateFact(path); certificate != nil {
				files = append(files, certificate)
			}
			return
		}
		files = append(files, collectWindowsFile(path))
		if content := collectWindowsFileContent(path); content != nil {
			files = append(files, content)
		}
	}
	for _, path := range candidates {
		if ctx.Err() != nil {
			break
		}
		appendFile(path)
		if len(files) >= 512 {
			break
		}
	}
	return files
}

func windowsDiscoveryCandidatePaths(ctx context.Context, spec agentDiscoverySpecV1, processes []map[string]any, services []map[string]any) []string {
	result := make([]string, 0, 64)
	seen := map[string]struct{}{}
	appendPath := func(path string) {
		path = strings.Trim(strings.TrimSpace(path), "\"'")
		if path == "" || !filepath.IsAbs(path) {
			return
		}
		path = filepath.Clean(path)
		key := strings.ToLower(path)
		if _, exists := seen[key]; exists {
			return
		}
		seen[key] = struct{}{}
		result = append(result, path)
	}
	for _, profile := range spec.Profiles {
		if ctx.Err() != nil {
			break
		}
		for _, path := range append(append([]string{}, profile.ConfigPathHints...), profile.TargetPathHints...) {
			appendPath(path)
		}
	}
	for _, process := range processes {
		if ctx.Err() != nil {
			break
		}
		executable := stringFromMap(process, "executablePath")
		commandLine := ""
		if pid := uint32(intFromMap(process, "pid")); pid > 0 {
			commandLine = windowsProcessCommandLine(ctx, pid)
		}
		for _, path := range windowsDiscoveryPathsFromExecutableAndCommandLine(spec, executable, commandLine) {
			appendPath(path)
		}
	}
	for _, service := range services {
		if ctx.Err() != nil {
			break
		}
		commandLine := stringFromMap(service, "pathName")
		if extra := windowsServiceDiscoveryArguments(ctx, stringFromMap(service, "name")); extra != "" {
			commandLine = strings.TrimSpace(commandLine + " " + extra)
		}
		for _, path := range windowsDiscoveryPathsFromExecutableAndCommandLine(spec, stringFromMap(service, "executablePath"), commandLine) {
			appendPath(path)
		}
	}
	return result
}

func windowsDiscoveryPathsFromExecutableAndCommandLine(spec agentDiscoverySpecV1, executablePath, commandLine string) []string {
	result := make([]string, 0, 16)
	tokens := parseWindowsCommandLine(commandLine)
	executableDir := ""
	if strings.TrimSpace(executablePath) != "" {
		executableDir = filepath.Dir(strings.Trim(strings.TrimSpace(executablePath), "\"'"))
	}
	appendResolved := func(base, value string) {
		value = strings.Trim(strings.TrimSpace(value), "\"'")
		if value == "" {
			return
		}
		if filepath.IsAbs(value) {
			result = append(result, filepath.Clean(value))
			return
		}
		if base != "" {
			result = append(result, filepath.Clean(filepath.Join(base, value)))
		}
	}
	for _, profile := range spec.Profiles {
		if !matchesDiscoveryProcess(executablePath, commandLine, profile) {
			continue
		}
		roots := make([]string, 0, 8)
		for _, key := range profile.RootArgKeys {
			if value := windowsArgumentValue(tokens, key); value != "" {
				root := resolveWindowsCandidatePath(executableDir, value)
				if root != "" {
					roots = append(roots, root)
				}
			}
		}
		configBase := executableDir
		if len(roots) > 0 {
			configBase = roots[0]
		}
		for _, key := range profile.ConfigArgKeys {
			if value := windowsArgumentValue(tokens, key); value != "" {
				appendResolved(configBase, value)
			}
		}
		if executableDir != "" {
			roots = append(roots, executableDir, filepath.Dir(executableDir))
		}
		for _, root := range roots {
			for _, relative := range profile.DefaultConfigRelativePaths {
				appendResolved(root, relative)
			}
		}
		for _, token := range tokens {
			if path := windowsDrivePathFromToken(token); path != "" {
				appendResolved(executableDir, path)
			}
		}
	}
	return result
}

func matchesDiscoveryProcess(executablePath, commandLine string, profile agentDiscoveryProfileV1) bool {
	base := strings.ToLower(strings.TrimSuffix(filepath.Base(executablePath), ".exe"))
	haystack := strings.ToLower(commandLine)
	for _, name := range profile.ProcessNames {
		expected := strings.ToLower(strings.TrimSuffix(filepath.Base(name), ".exe"))
		if expected != "" && (base == expected || strings.Contains(base, expected)) {
			return true
		}
	}
	for _, needle := range profile.CommandLineContains {
		if strings.Contains(haystack, strings.ToLower(needle)) {
			return true
		}
	}
	return false
}

func resolveWindowsCandidatePath(base, value string) string {
	value = strings.Trim(strings.TrimSpace(value), "\"'")
	if value == "" {
		return ""
	}
	if filepath.IsAbs(value) {
		return filepath.Clean(value)
	}
	if base == "" {
		return ""
	}
	return filepath.Clean(filepath.Join(base, value))
}

func windowsArgumentValue(tokens []string, key string) string {
	for index, token := range tokens {
		token = strings.TrimSpace(token)
		if token == key && index+1 < len(tokens) {
			return strings.Trim(tokens[index+1], "\"'")
		}
		if strings.HasPrefix(token, key+"=") {
			return strings.Trim(strings.TrimPrefix(token, key+"="), "\"'")
		}
		if strings.HasPrefix(token, key) && len(token) > len(key) && !strings.HasPrefix(key, "-D") {
			return strings.Trim(token[len(key):], "\"'")
		}
	}
	return ""
}

func isWindowsDiscoveryCertificatePath(spec agentDiscoverySpecV1, path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == "" {
		return false
	}
	for _, profile := range spec.Profiles {
		for _, allowed := range profile.CertificateFileExtensions {
			if ext == strings.ToLower(allowed) {
				return true
			}
		}
	}
	return ext == ".pem" || ext == ".crt" || ext == ".cer" || ext == ".der"
}

func collectWindowsCertificateFactsFromConfigFacts(spec agentDiscoverySpecV1, facts []map[string]any) []map[string]any {
	files := make([]map[string]any, 0, 16)
	seen := map[string]struct{}{}
	for _, fact := range facts {
		if stringFromMap(fact, "kind") != "file_content" {
			continue
		}
		path := stringFromMap(fact, "path")
		encoded := stringFromMap(fact, "contentBase64")
		if path == "" || encoded == "" {
			continue
		}
		contentBytes, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			continue
		}
		content, ok := decodeWindowsConfigText(contentBytes)
		if !ok {
			continue
		}
		for _, certificatePath := range windowsCertificateReferencesFromConfigContent(spec, path, content) {
			key := strings.ToLower(filepath.Clean(certificatePath))
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			if certificate := collectWindowsCertificateFact(certificatePath); certificate != nil {
				files = append(files, certificate)
			}
			if len(files) >= 128 {
				return files
			}
		}
	}
	return files
}

func windowsCertificateReferencesFromConfigContent(spec agentDiscoverySpecV1, configPath string, content string) []string {
	allowedExtensions := windowsDiscoveryCertificateExtensions(spec)
	tokens := configReferenceTokens(content)
	paths := make([]string, 0, 16)
	seen := map[string]struct{}{}
	appendPath := func(path string) {
		path = strings.Trim(strings.TrimSpace(path), "\"'`;,)")
		if path == "" || strings.Contains(path, "\x00") {
			return
		}
		if !hasAllowedCertificateExtension(path, allowedExtensions) {
			return
		}
		for _, candidate := range resolveWindowsConfigReferencePaths(configPath, path) {
			if !filepath.IsAbs(candidate) || !isWindowsDiscoveryCertificatePath(spec, candidate) {
				continue
			}
			key := strings.ToLower(filepath.Clean(candidate))
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			paths = append(paths, filepath.Clean(candidate))
			if len(paths) >= 128 {
				return
			}
		}
	}
	for _, token := range tokens {
		appendPath(token)
		if len(paths) >= 128 {
			break
		}
	}
	return paths
}

func configReferenceTokens(content string) []string {
	tokens := make([]string, 0, 32)
	var builder strings.Builder
	inQuote := byte(0)
	flush := func() {
		value := strings.TrimSpace(builder.String())
		if value != "" {
			tokens = append(tokens, value)
		}
		builder.Reset()
	}
	for index := 0; index < len(content); index++ {
		current := content[index]
		if inQuote != 0 {
			if current == inQuote {
				flush()
				inQuote = 0
				continue
			}
			builder.WriteByte(current)
			continue
		}
		if current == '"' || current == '\'' {
			flush()
			inQuote = current
			continue
		}
		if current <= ' ' || strings.ContainsRune("<>=;{},", rune(current)) {
			flush()
			continue
		}
		builder.WriteByte(current)
	}
	flush()
	return tokens
}

func resolveWindowsConfigReferencePaths(configPath, reference string) []string {
	reference = strings.Trim(strings.TrimSpace(reference), "\"'`;,)")
	if reference == "" {
		return nil
	}
	if filepath.IsAbs(reference) {
		return []string{filepath.Clean(reference)}
	}
	configDir := filepath.Dir(configPath)
	parentDir := filepath.Dir(configDir)
	candidates := []string{}
	if configDir != "" && configDir != "." {
		candidates = append(candidates, filepath.Join(configDir, reference))
	}
	if parentDir != "" && parentDir != "." && !strings.EqualFold(parentDir, configDir) {
		candidates = append(candidates, filepath.Join(parentDir, reference))
	}
	return candidates
}

func windowsDiscoveryCertificateExtensions(spec agentDiscoverySpecV1) []string {
	values := []string{".pem", ".crt", ".cer", ".der", ".pfx", ".p12", ".jks", ".keystore"}
	for _, profile := range spec.Profiles {
		values = append(values, profile.CertificateFileExtensions...)
	}
	return sanitizeDiscoveryStrings(values, 32, validDiscoveryExtension)
}

func hasAllowedCertificateExtension(path string, extensions []string) bool {
	lower := strings.ToLower(strings.TrimSpace(path))
	for _, extension := range extensions {
		if strings.HasSuffix(lower, strings.ToLower(extension)) {
			return true
		}
	}
	return false
}

func windowsServiceDiscoveryArguments(ctx context.Context, serviceName string) string {
	serviceName = strings.TrimSpace(serviceName)
	if serviceName == "" || !validWindowsServiceName(serviceName) {
		return ""
	}
	values := make([]string, 0, 8)
	for _, key := range []string{
		`HKLM\SYSTEM\CurrentControlSet\Services\` + serviceName + `\Parameters`,
		`HKLM\SYSTEM\CurrentControlSet\Services\` + serviceName + `\Parameters\Java`,
		`HKLM\SYSTEM\CurrentControlSet\Services\` + serviceName + `\Parameters\Start`,
	} {
		command := exec.CommandContext(ctx, windowsSystem32Directory+`\reg.exe`, "query", key)
		command.Dir = windowsSystem32Directory
		command.Env = fixedWindowsEnvironment()
		output, err := command.Output()
		if err != nil {
			continue
		}
		values = append(values, parseWindowsRegistryDiscoveryArguments(string(output))...)
	}
	return strings.Join(values, " ")
}

func windowsServiceImagePath(ctx context.Context, serviceName string) string {
	serviceName = strings.TrimSpace(serviceName)
	if serviceName == "" || !validWindowsServiceName(serviceName) {
		return ""
	}
	return redactWindowsDiscoverySecretArguments(windowsRegistryValue(ctx, `HKLM\SYSTEM\CurrentControlSet\Services\`+serviceName, "ImagePath"))
}

func windowsRegistryValue(ctx context.Context, key string, valueName string) string {
	command := exec.CommandContext(ctx, windowsSystem32Directory+`\reg.exe`, "query", key, "/v", valueName)
	command.Dir = windowsSystem32Directory
	command.Env = fixedWindowsEnvironment()
	output, err := command.Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(output), "\n") {
		trimmed := strings.TrimSpace(line)
		fields := strings.Fields(trimmed)
		if len(fields) < 3 || !strings.EqualFold(fields[0], valueName) || !strings.HasPrefix(strings.ToUpper(fields[1]), "REG_") {
			continue
		}
		typeIndex := strings.Index(trimmed, fields[1])
		if typeIndex < 0 {
			continue
		}
		return strings.TrimSpace(trimmed[typeIndex+len(fields[1]):])
	}
	return ""
}

func windowsExecutableFromCommandLine(commandLine string) string {
	commandLine = strings.TrimSpace(commandLine)
	if commandLine == "" {
		return ""
	}
	lower := strings.ToLower(commandLine)
	if index := strings.Index(lower, ".exe"); index >= 0 {
		candidate := strings.Trim(commandLine[:index+len(".exe")], "\"'")
		if filepath.IsAbs(candidate) {
			return filepath.Clean(candidate)
		}
	}
	tokens := parseWindowsCommandLine(commandLine)
	if len(tokens) == 0 {
		return ""
	}
	candidate := strings.Trim(tokens[0], "\"'")
	if filepath.IsAbs(candidate) {
		return filepath.Clean(candidate)
	}
	return ""
}

func parseWindowsRegistryDiscoveryArguments(output string) []string {
	allowed := map[string]struct{}{
		"configargs":    {},
		"options":       {},
		"jvmoptions":    {},
		"javaoptions":   {},
		"appparameters": {},
		"parameters":    {},
		"workingpath":   {},
	}
	values := make([]string, 0, 8)
	scanner := bufio.NewScanner(strings.NewReader(output))
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(strings.ToUpper(line), "HKEY_") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		if _, ok := allowed[strings.ToLower(fields[0])]; !ok || !strings.HasPrefix(strings.ToUpper(fields[1]), "REG_") {
			continue
		}
		typeIndex := strings.Index(line, fields[1])
		if typeIndex < 0 {
			continue
		}
		value := strings.TrimSpace(line[typeIndex+len(fields[1]):])
		value = strings.ReplaceAll(value, `\0`, " ")
		value = redactWindowsDiscoverySecretArguments(value)
		if value != "" {
			values = append(values, value)
		}
	}
	return values
}

func redactWindowsDiscoverySecretArguments(value string) string {
	tokens := parseWindowsCommandLine(value)
	for index, token := range tokens {
		lower := strings.ToLower(token)
		if strings.Contains(lower, "password") || strings.Contains(lower, "passwd") || strings.Contains(lower, "secret") || strings.Contains(lower, "token") {
			if strings.Contains(token, "=") {
				prefix := token[:strings.Index(token, "=")+1]
				tokens[index] = prefix + "<redacted>"
			} else {
				tokens[index] = "<redacted>"
			}
		}
	}
	return strings.Join(tokens, " ")
}

func collectWindowsFiles(ctx context.Context, budget *windowsDiscoveryBudget, paths []string) []map[string]any {
	files := make([]map[string]any, 0, len(paths))
	for _, path := range paths {
		if discoveryBudgetStopped(ctx, budget) {
			break
		}
		if info, statErr := os.Stat(path); statErr == nil && info.IsDir() {
			files = append(files, collectWindowsFile(path))
			_ = filepath.WalkDir(path, func(candidate string, entry os.DirEntry, walkErr error) error {
				if discoveryBudgetStopped(ctx, budget) {
					return filepath.SkipAll
				}
				if budget != nil {
					if err := budget.visit(); err != nil {
						return filepath.SkipAll
					}
				}
				if walkErr != nil || entry == nil {
					return nil
				}
				if entry.IsDir() {
					if candidate != path && strings.Count(strings.TrimPrefix(candidate, path), string(os.PathSeparator)) > 4 {
						return filepath.SkipDir
					}
					return nil
				}
				if len(files) >= 512 {
					return filepath.SkipAll
				}
				ext := strings.ToLower(filepath.Ext(candidate))
				if ext == ".pem" || ext == ".crt" || ext == ".cer" || ext == ".der" {
					if certificate := collectWindowsCertificateFact(candidate); certificate != nil {
						files = append(files, certificate)
					}
					return nil
				}
				if ext != ".conf" && ext != ".xml" && ext != ".properties" && ext != ".config" {
					return nil
				}
				files = append(files, collectWindowsFile(candidate))
				if content := collectWindowsFileContent(candidate); content != nil {
					files = append(files, content)
				}
				return nil
			})
			continue
		}
		if certificateExt := strings.ToLower(filepath.Ext(path)); certificateExt == ".pem" || certificateExt == ".crt" || certificateExt == ".cer" || certificateExt == ".der" {
			if certificate := collectWindowsCertificateFact(path); certificate != nil {
				files = append(files, certificate)
			}
			continue
		}
		files = append(files, collectWindowsFile(path))
		if content := collectWindowsFileContent(path); content != nil {
			files = append(files, content)
		}
	}
	return files
}

func collectWindowsCertificateFact(path string) map[string]any {
	content, err := os.ReadFile(path)
	if err != nil || len(content) == 0 || len(content) > 512*1024 {
		return nil
	}
	der := content
	if block, _ := pem.Decode(content); block != nil {
		der = block.Bytes
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		return nil
	}
	sha256Fingerprint := sha256.Sum256(certificate.Raw)
	sha1Fingerprint := sha1.Sum(certificate.Raw)
	// Windows binding 使用 SHA-1 Thumbprint；这里只保留摘要，不上传证书材料。
	return map[string]any{
		"kind":              "certificate_file",
		"path":              path,
		"configuredPaths":   []string{filepath.Base(path)},
		"sha256Fingerprint": hex.EncodeToString(sha256Fingerprint[:]),
		"thumbprint":        hex.EncodeToString(sha1Fingerprint[:]),
		"subject":           certificate.Subject.String(),
		"issuer":            certificate.Issuer.String(),
		"notBefore":         certificate.NotBefore.UTC().Format(time.RFC3339),
		"notAfter":          certificate.NotAfter.UTC().Format(time.RFC3339),
	}
}

func collectWindowsFile(path string) map[string]any {
	item := map[string]any{"kind": "file_stat", "path": path, "exists": false, "sizeBytes": int64(0)}
	info, err := os.Stat(path)
	if err != nil {
		return item
	}
	item["exists"] = true
	item["sizeBytes"] = info.Size()
	item["mode"] = info.Mode().String()
	item["modifiedAt"] = info.ModTime().UTC().Format(time.RFC3339Nano)
	if info.Mode().IsRegular() {
		if digest, digestErr := sha256FileDigest(path); digestErr == nil {
			item["sha256"] = digest
		}
	}
	return item
}

func collectWindowsFileContent(path string) map[string]any {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	// 大型配置保持在 256 KiB 单文件受控上限内，避免截断 XML 导致宿主无法解析。
	const maximumFileContentBytes = 256 * 1024
	truncated := len(content) > maximumFileContentBytes
	if truncated {
		content = content[:maximumFileContentBytes]
	}
	return map[string]any{
		"kind":          "file_content",
		"path":          path,
		"contentBase64": base64.StdEncoding.EncodeToString(content),
		"bytesRead":     len(content),
		"truncated":     truncated,
		"sha256":        sha256Bytes(content),
	}
}

func sha256Bytes(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func collectWindowsListeningPorts(ctx context.Context) []map[string]any {
	command := exec.CommandContext(ctx, windowsSystem32Directory+`\netstat.exe`, "-ano", "-p", "TCP")
	command.Dir = windowsSystem32Directory
	command.Env = fixedWindowsEnvironment()
	output, err := command.Output()
	if err != nil {
		return []map[string]any{}
	}
	return parseWindowsListeningPorts(output)
}

func parseWindowsListeningPorts(output []byte) []map[string]any {
	ports := make([]map[string]any, 0, 128)
	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 5 || !strings.EqualFold(fields[len(fields)-2], "LISTENING") {
			continue
		}
		endpoint := fields[1]
		separator := strings.LastIndexByte(endpoint, ':')
		if separator < 0 {
			continue
		}
		port, err := strconv.Atoi(endpoint[separator+1:])
		if err != nil {
			continue
		}
		address := strings.Trim(strings.TrimSpace(endpoint[:separator]), "[]")
		if address == "" {
			address = "unknown"
		}
		item := map[string]any{"kind": "listening_port", "address": address, "port": port, "protocol": "tcp"}
		if pid, parseErr := strconv.Atoi(fields[len(fields)-1]); parseErr == nil && pid > 0 {
			item["pid"] = pid
		}
		ports = append(ports, item)
		if len(ports) >= 1000 {
			break
		}
	}
	return ports
}

// HTTP.sys 的 HTTPS 证书绑定不可靠地保存在服务配置文件中，
// 通过 netsh 读取是 Windows 上不依赖具体 Web 产品的通用来源。
func collectWindowsSSLCertificateBindings(ctx context.Context) []map[string]any {
	command := exec.CommandContext(ctx, windowsSystem32Directory+`\netsh.exe`, "http", "show", "sslcert")
	command.Dir = windowsSystem32Directory
	command.Env = fixedWindowsEnvironment()
	output, err := command.Output()
	if err != nil {
		return []map[string]any{}
	}
	return parseWindowsSSLCertificateBindings(string(output))
}

func parseWindowsSSLCertificateBindings(output string) []map[string]any {
	bindings := make([]map[string]any, 0, 16)
	current := map[string]any{}
	flush := func() {
		address := strings.TrimSpace(stringFromMap(current, "address"))
		port := intFromMap(current, "port")
		thumbprint := normalizeCertificateHex(stringFromMap(current, "thumbprint"))
		if address == "" || port <= 0 || port > 65535 || len(thumbprint) < 8 {
			current = map[string]any{}
			return
		}
		current["kind"] = "ssl_certificate_binding"
		current["address"] = address
		current["port"] = port
		current["thumbprint"] = thumbprint
		current["protocol"] = "https"
		bindings = append(bindings, current)
		current = map[string]any{}
	}
	for _, rawLine := range strings.Split(output, "\n") {
		line := strings.TrimSpace(rawLine)
		if line == "" {
			flush()
			continue
		}
		if value := netshValue(line, "IP:port", "IP 地址和端口", "Hostname:port", "主机名和端口"); value != "" {
			if stringFromMap(current, "address") != "" {
				flush()
			}
			address, port := splitWindowsEndpoint(value)
			if address != "" && port > 0 {
				current["address"] = address
				current["port"] = port
			}
			continue
		}
		if value := netshValue(line, "Certificate Hash", "证书哈希", "证书哈希值"); value != "" {
			current["thumbprint"] = value
			continue
		}
		if value := netshValue(line, "Certificate Store Name", "证书存储区名称"); value != "" {
			current["store"] = value
		}
	}
	flush()
	return bindings
}

func netshValue(line string, labels ...string) string {
	for _, label := range labels {
		index := strings.Index(strings.ToLower(line), strings.ToLower(label))
		if index < 0 {
			continue
		}
		value := line[index+len(label):]
		if colon := strings.IndexAny(value, ":："); colon >= 0 {
			return strings.TrimSpace(value[colon+1:])
		}
		return strings.TrimSpace(value)
	}
	return ""
}

func splitWindowsEndpoint(value string) (string, int) {
	value = strings.TrimSpace(value)
	separator := strings.LastIndexByte(value, ':')
	if separator < 0 {
		return "", 0
	}
	port, err := strconv.Atoi(strings.TrimSpace(value[separator+1:]))
	if err != nil {
		return "", 0
	}
	address := strings.Trim(strings.TrimSpace(value[:separator]), "[]")
	if address == "" {
		address = "*"
	}
	return address, port
}

func collectWindowsPermissions() map[string]any {
	principal := strings.TrimSpace(os.Getenv("USERNAME"))
	if principal == "" {
		principal = "unknown"
	}
	return map[string]any{"kind": "privilege", "principal": principal, "elevated": windowsTokenIsElevated(), "groups": []string{}}
}

func collectWindowsCertificateStores(ctx context.Context) []map[string]any {
	stores := make([]map[string]any, 0, 16)
	for _, name := range []string{"My", "Root"} {
		command := exec.CommandContext(ctx, windowsSystem32Directory+`\certutil.exe`, "-store", name)
		command.Dir = windowsSystem32Directory
		command.Env = fixedWindowsEnvironment()
		output, err := command.Output()
		if err != nil {
			stores = append(stores, map[string]any{"kind": "certificate_store", "store": name, "storeLocation": "LocalMachine", "subject": "unavailable", "thumbprint": "unavailable", "hasPrivateKey": false})
			continue
		}
		records := parseCertificateStoreOutput(string(output), name)
		if len(records) == 0 {
			stores = append(stores, map[string]any{"kind": "certificate_store", "store": name, "storeLocation": "LocalMachine", "subject": "unavailable", "thumbprint": "unavailable", "hasPrivateKey": false})
			continue
		}
		stores = append(stores, records...)
	}
	return stores
}

func parseCertificateStoreOutput(output, store string) []map[string]any {
	lines := strings.Split(output, "\n")
	result := make([]map[string]any, 0, 8)
	current := map[string]any{}
	flush := func() {
		thumbprint := normalizeCertificateHex(stringFromMap(current, "thumbprint"))
		if len(thumbprint) < 8 {
			current = map[string]any{}
			return
		}
		current["kind"] = "certificate_store"
		current["store"] = store
		current["storeLocation"] = "LocalMachine"
		current["thumbprint"] = strings.ToUpper(thumbprint)
		if fingerprint := normalizeCertificateHex(stringFromMap(current, "sha256Fingerprint")); len(fingerprint) == 64 {
			current["sha256Fingerprint"] = fingerprint
		} else {
			delete(current, "sha256Fingerprint")
		}
		current["path"] = "windows-certstore://LocalMachine/" + store + "/" + strings.ToUpper(thumbprint)
		if current["subject"] == nil {
			current["subject"] = "unavailable"
		}
		if current["hasPrivateKey"] == nil {
			current["hasPrivateKey"] = false
		}
		result = append(result, current)
		current = map[string]any{}
	}
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.Contains(trimmed, "Certificate ") && strings.Contains(trimmed, "====") {
			flush()
			continue
		}
		for _, field := range []struct{ key, label string }{
			{key: "subject", label: "Subject:"},
			{key: "issuer", label: "Issuer:"},
			{key: "notBefore", label: "NotBefore:"},
			{key: "notAfter", label: "NotAfter:"},
			{key: "thumbprint", label: "Cert Hash(sha1):"},
			{key: "sha256Fingerprint", label: "Cert Hash(sha256):"},
		} {
			// 只解析当前行。旧实现从完整输出中取第一个匹配值，
			// 导致证书库中每一条记录都复用了第一张证书的 Thumbprint。
			if value := certificateutilLineField(trimmed, field.label); value != "" {
				current[field.key] = value
			}
		}
	}
	flush()
	return result
}

func normalizeCertificateHex(value string) string {
	return strings.ToUpper(strings.Map(func(r rune) rune {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F') {
			return r
		}
		return -1
	}, value))
}

func windowsTokenIsElevated() bool {
	command := exec.Command(windowsSystem32Directory+`\whoami.exe`, "/groups")
	command.Dir = windowsSystem32Directory
	command.Env = fixedWindowsEnvironment()
	output, err := command.Output()
	return err == nil && strings.Contains(string(output), "S-1-5-32-544") && strings.Contains(strings.ToLower(string(output)), "enabled")
}

func certificateutilLineField(line, field string) string {
	labels := []string{field}
	switch strings.ToLower(field) {
	case "subject:":
		labels = append(labels, "主题:", "主题：")
	case "issuer:":
		labels = append(labels, "颁发者:", "颁发者：", "签发者:", "签发者：")
	case "notbefore:":
		labels = append(labels, "起始日期:", "起始日期：", "NotBefore：")
	case "notafter:":
		labels = append(labels, "截止日期:", "截止日期：", "NotAfter：")
	}
	lowerLine := strings.ToLower(line)
	for _, label := range labels {
		index := strings.Index(lowerLine, strings.ToLower(label))
		if index < 0 {
			continue
		}
		value := line[index+len(label):]
		return strings.TrimSpace(strings.TrimLeft(value, ":： \t"))
	}
	// certutil 的字段前缀会随 Windows 系统语言变化，但 SHA-1/SHA-256 标记
	// 保持不变。仅为指纹字段使用不依赖本地化文本的后备匹配。
	lowerField := strings.ToLower(field)
	for _, marker := range []string{"(sha1)", "(sha256)"} {
		if !strings.Contains(lowerField, marker) {
			continue
		}
		markerIndex := strings.Index(lowerLine, marker)
		if markerIndex < 0 {
			return ""
		}
		tail := line[markerIndex+len(marker):]
		colon := strings.IndexAny(tail, ":：")
		if colon >= 0 {
			return strings.TrimSpace(tail[colon+1:])
		}
		return ""
	}
	return ""
}

func validateAgentPlan(plan agentPlanV2, token AgentCapabilityTokenV1) error {
	if len(plan.Operations) == 0 || len(plan.Operations) > maxPlanOperations {
		return errors.New("plan operation count is outside the allowed range")
	}
	if plan.PlanVersion != agentSecurityContract || plan.AgentID != token.AgentID || plan.TenantID != token.TenantID || plan.PluginID != token.PluginID || plan.PluginVersionID != token.PluginVersionID || plan.Capability != token.Capability || plan.TokenID != token.TokenID || plan.Nonce != token.Nonce || plan.PlanDigest != token.PlanDigest {
		return errors.New("plan identity binding mismatch")
	}
	expectedDigest, err := computeAgentPlanDigest(plan)
	if err != nil || expectedDigest != plan.PlanDigest {
		return errors.New("planDigest does not match the complete plan")
	}
	for _, operation := range plan.Operations {
		if err := validateAgentPlanOperation(operation); err != nil {
			return err
		}
		if !v2ContainsString(token.Actions, operation.OperationType) {
			return fmt.Errorf("Token 未授权 Agent 操作: %s", operation.OperationType)
		}
		if path := stringValue(operation.Input, "path"); path != "" && !pathScopeContains(token.AllowedPaths, path) {
			return errors.New("operation path is outside token scope")
		}
		if service := stringValue(operation.Input, "serviceName"); service != "" && !scopeContains(token.AllowedServices, service) {
			return errors.New("operation service is outside token scope")
		}
		if operation.OperationType == "command.execute_allowlisted" {
			args, _ := stringArrayValue(operation.Input, "args")
			if len(args) != 2 || !scopeContains(token.AllowedServices, args[1]) {
				return errors.New("allowlisted command service is outside token scope")
			}
			if digest := stringValue(operation.Input, "executableSha256"); !v2ContainsString(token.ArtifactDigests, digest) {
				return errors.New("allowlisted command executable is outside token scope")
			}
		}
		if artifact := stringValue(operation.Input, "artifactDigest"); artifact != "" && !v2ContainsString(token.ArtifactDigests, artifact) {
			return errors.New("operation artifact is outside token scope")
		}
	}
	return nil
}

func validateAgentPlanAuthorization(plan agentPlanV2, decision PolicyAuthorityDecisionV1) error {
	for _, operation := range plan.Operations {
		if !v2ContainsString(decision.Actions, operation.OperationType) {
			return fmt.Errorf("Policy Decision 未授权 Agent 操作: %s", operation.OperationType)
		}
		if operation.OperationType == "command.execute_allowlisted" {
			args, _ := stringArrayValue(operation.Input, "args")
			if len(args) != 2 || !scopeContains(decision.AllowedServices, args[1]) {
				return errors.New("allowlisted command service is outside Policy Decision scope")
			}
			if digest := stringValue(operation.Input, "executableSha256"); !v2ContainsString(decision.ArtifactDigests, digest) {
				return errors.New("allowlisted command executable is outside Policy Decision scope")
			}
		}
	}
	return nil
}

func validateAgentPlanOperation(operation agentPlanAction) error {
	if operation.OperationID == "" || operation.IdempotencyKey == "" {
		return errors.New("operationId and idempotencyKey are required")
	}
	if !v2ContainsString([]string{"prepare", "execute", "verify", "compensate"}, operation.Stage) {
		return fmt.Errorf("unsupported plan stage: %s", operation.Stage)
	}
	if operation.TimeoutSeconds < 1 || operation.TimeoutSeconds > 3600 {
		return errors.New("timeoutSeconds is outside the allowed range")
	}
	if operation.Input == nil {
		return errors.New("operation input is required")
	}
	if !v2ContainsString([]string{"process.list", "service.list", "service.status", "filesystem.stat", "filesystem.read", "filesystem.backup", "filesystem.atomic_replace", "filesystem.restore", "certificate.material.validate", "certificate.store.inspect", "service.start", "service.stop", "service.reload", "command.execute_allowlisted"}, operation.OperationType) {
		return fmt.Errorf("unsupported Agent operation: %s", operation.OperationType)
	}
	if strings.HasPrefix(operation.OperationType, "service.") && stringValue(operation.Input, "serviceName") == "" {
		return errors.New("service operation requires serviceName")
	}
	if operation.OperationType == "command.execute_allowlisted" {
		return validateAllowlistedCommandInput(operation)
	}
	return nil
}

type agentReceiptSigner struct {
	KeyID      string
	PrivateKey ed25519.PrivateKey
}

func executeAuthorizedAgentPlan(ctx context.Context, plan agentPlanV2, token AgentCapabilityTokenV1) (bool, string, string, map[string]any) {
	if err := validateAgentPlan(plan, token); err != nil {
		return false, "AGENT_PLAN_INVALID", err.Error(), nil
	}
	if !plan.WriteEffect || !hasAgentWriteOperation(plan) {
		return false, "AGENT_PLAN_INVALID", "agent.plan.execute 只接受包含写操作的计划", nil
	}
	signer, err := loadAgentReceiptSigner()
	if err != nil {
		return false, "AGENT_RECEIPT_SIGNER_UNAVAILABLE", err.Error(), unknownAgentWriteDetail(plan, "Agent 回执签名器不可用，无法确认写操作结果", map[string]any{
			"receiptUnavailable": true,
		})
	}
	resultDigest, err := computeAgentPlanResultDigest(plan)
	if err != nil {
		return false, "AGENT_PLAN_INVALID", "计划结果摘要生成失败", nil
	}
	if err := consumePersistentAgentNonce(token.Nonce, token.TokenID, resultDigest); err != nil {
		return false, "AGENT_V2_AUTHORIZATION_DENIED", err.Error(), nil
	}
	return executeAgentPlan(ctx, plan, token, signer)
}

func executeAgentPlan(ctx context.Context, plan agentPlanV2, token AgentCapabilityTokenV1, signer agentReceiptSigner) (bool, string, string, map[string]any) {
	startedAt := time.Now().UTC()
	results := make([]map[string]any, 0, len(plan.Operations))
	for _, operation := range plan.Operations {
		result := map[string]any{"operationId": operation.OperationID, "operationType": operation.OperationType, "stage": operation.Stage, "status": "SUCCEEDED"}
		operationCtx, cancel := context.WithTimeout(ctx, time.Duration(operation.TimeoutSeconds)*time.Second)
		var err error
		if err = agentContextError(operationCtx); err == nil {
			switch operation.OperationType {
			case "filesystem.atomic_replace":
				err = executeFileReplace(operationCtx, operation)
			case "filesystem.restore":
				err = errors.New("filesystem.restore requires a signed checkpoint")
			case "service.start", "service.stop", "service.reload":
				err = executeAllowlistedService(operationCtx, operation)
			case "command.execute_allowlisted":
				err = executeAllowlistedProgram(operationCtx, operation)
			default:
				err = errors.New("agent.plan.execute 只接受写操作")
			}
		}
		if err == nil {
			err = agentContextError(operationCtx)
		}
		cancel()
		if err != nil {
			result["status"] = "UNKNOWN"
			result["error"] = err.Error()
			results = append(results, result)
			receipt, receiptErr := buildAndPersistAgentReceipt(plan, token, "UNKNOWN", startedAt, results, "AGENT_EXECUTION_UNKNOWN", "写操作结果不明，禁止自动重试或回退", signer)
			if receiptErr != nil {
				return false, "AGENT_EXECUTION_UNKNOWN", "写操作结果不明且回执无法持久化", unknownAgentWriteDetail(plan, "写操作结果不明且回执不可用", map[string]any{
					"operations":         results,
					"operationResults":   results,
					"receiptUnavailable": true,
				})
			}
			return false, "AGENT_EXECUTION_UNKNOWN", "写操作结果不明，禁止自动重试或回退", map[string]any{"planId": plan.PlanID, "operations": results, "operationResults": results, "executionStatus": "UNKNOWN", "receipt": receipt}
		}
		results = append(results, result)
	}
	receipt, err := buildAndPersistAgentReceipt(plan, token, "SUCCESS", startedAt, results, "", "", signer)
	if err != nil {
		return false, "AGENT_EXECUTION_UNKNOWN", "执行完成但回执无法持久化，状态不明", unknownAgentWriteDetail(plan, "执行完成但回执不可用，状态不明", map[string]any{
			"operations":         results,
			"operationResults":   results,
			"receiptUnavailable": true,
		})
	}
	return true, "", "", map[string]any{"planId": plan.PlanID, "status": "SUCCEEDED", "executionStatus": "SUCCESS", "operations": results, "operationResults": results, "receipt": receipt}
}

func unknownAgentWriteDetail(plan agentPlanV2, reason string, fields map[string]any) map[string]any {
	detail := map[string]any{
		"planId":          plan.PlanID,
		"executionStatus": "UNKNOWN",
		"unknownReason":   reason,
		"fallback":        false,
		"replayed":        false,
	}
	for key, value := range fields {
		detail[key] = value
	}
	return detail
}

func buildAndPersistAgentReceipt(plan agentPlanV2, token AgentCapabilityTokenV1, status string, startedAt time.Time, results []map[string]any, errorCode, unknownReason string, signer agentReceiptSigner) (AgentExecutionReceiptV1, error) {
	receipt := AgentExecutionReceiptV1{
		ReceiptVersion:   agentSecurityContract,
		OperationID:      receiptOperationID(plan, results),
		PlanID:           plan.PlanID,
		PlanDigest:       plan.PlanDigest,
		AgentID:          plan.AgentID,
		TenantID:         plan.TenantID,
		TokenID:          token.TokenID,
		Status:           status,
		StartedAt:        startedAt.Format(time.RFC3339Nano),
		CompletedAt:      time.Now().UTC().Format(time.RFC3339Nano),
		OperationResults: results,
		NonceConsumed:    true,
		ErrorCode:        errorCode,
		UnknownReason:    unknownReason,
		AgentKeyID:       signer.KeyID,
	}
	if err := signAgentExecutionReceipt(&receipt, signer); err != nil {
		return AgentExecutionReceiptV1{}, err
	}
	if err := persistAgentExecutionReceipt(token.Nonce, receipt); err != nil {
		return AgentExecutionReceiptV1{}, err
	}
	return receipt, nil
}

func receiptOperationID(plan agentPlanV2, results []map[string]any) string {
	for index := len(results) - 1; index >= 0; index-- {
		if operationID := stringValue(results[index], "operationId"); operationID != "" {
			return operationID
		}
	}
	if len(plan.Operations) > 0 {
		return plan.Operations[0].OperationID
	}
	return ""
}

func hasAgentWriteOperation(plan agentPlanV2) bool {
	for _, operation := range plan.Operations {
		if v2ContainsString([]string{"filesystem.atomic_replace", "filesystem.restore", "service.start", "service.stop", "service.reload", "command.execute_allowlisted"}, operation.OperationType) {
			return true
		}
	}
	return false
}

func agentContextError(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
		return nil
	}
}

func signAgentExecutionReceipt(receipt *AgentExecutionReceiptV1, signer agentReceiptSigner) error {
	if strings.TrimSpace(signer.KeyID) == "" || len(signer.PrivateKey) != ed25519.PrivateKeySize {
		return errors.New("Agent 回执签名器不可用，失败关闭")
	}
	digest, err := computeAgentExecutionReceiptDigest(*receipt)
	if err != nil {
		return err
	}
	receipt.Digest = digest
	receipt.Signature = base64.StdEncoding.EncodeToString(ed25519.Sign(signer.PrivateKey, canonicalJSON(agentReceiptWithoutSignature(*receipt))))
	return nil
}

func validateAgentExecutionReceipt(receipt AgentExecutionReceiptV1, token AgentCapabilityTokenV1, request agentV2Request) error {
	if receipt.ReceiptVersion != agentSecurityContract || receipt.PlanID == "" || receipt.OperationID == "" || receipt.AgentID != token.AgentID || receipt.AgentID != request.AgentID || receipt.TenantID != token.TenantID || receipt.TenantID != request.TenantID || receipt.TokenID != token.TokenID || receipt.PlanDigest != token.PlanDigest || !receipt.NonceConsumed {
		return errors.New("receipt identity or nonce binding mismatch")
	}
	if !v2ContainsString([]string{"SUCCESS", "FAILED", "UNKNOWN", "CANCELLED"}, receipt.Status) {
		return errors.New("receipt status is unsupported")
	}
	startedAt, err := time.Parse(time.RFC3339Nano, receipt.StartedAt)
	if err != nil {
		return errors.New("receipt startedAt is invalid")
	}
	completedAt, err := time.Parse(time.RFC3339Nano, receipt.CompletedAt)
	if err != nil || completedAt.Before(startedAt) {
		return errors.New("receipt completedAt is invalid")
	}
	if len(receipt.OperationResults) > maxPlanOperations {
		return errors.New("receipt operation results exceed the allowed range")
	}
	if receipt.Status == "UNKNOWN" && strings.TrimSpace(receipt.UnknownReason) == "" {
		return errors.New("UNKNOWN receipt requires a reason")
	}
	if receipt.Status == "SUCCESS" && receipt.ErrorCode != "" {
		return errors.New("SUCCESS receipt cannot contain an error code")
	}
	expectedDigest, err := computeAgentExecutionReceiptDigest(receipt)
	if err != nil || expectedDigest != receipt.Digest {
		return errors.New("receipt digest does not match the complete receipt")
	}
	return verifySignedValue(receipt.AgentKeyID, receipt.Signature, agentReceiptWithoutSignature(receipt), "GCAC_AGENT_RECEIPT_KEYSET_JSON")
}

func loadAndValidateAgentExecutionReceipt(request agentV2Request) (AgentExecutionReceiptV1, error) {
	nonceRecord, err := loadPersistentAgentNonce(request.Token.Nonce)
	if err != nil {
		return AgentExecutionReceiptV1{}, err
	}
	if nonceRecord.TokenID != request.Token.TokenID || !isAgentDigest(nonceRecord.ResultDigest) {
		return AgentExecutionReceiptV1{}, errors.New("Nonce 消费记录与授权绑定不一致")
	}
	if request.Plan.PlanVersion != "" {
		if err := validateAgentPlan(request.Plan, request.Token); err != nil {
			return AgentExecutionReceiptV1{}, err
		}
		expectedResultDigest, err := computeAgentPlanResultDigest(request.Plan)
		if err != nil || expectedResultDigest != nonceRecord.ResultDigest {
			return AgentExecutionReceiptV1{}, errors.New("Nonce 消费记录与完整计划绑定不一致")
		}
	}
	receipt, err := loadPersistentAgentReceipt(request.Token.Nonce)
	if err != nil {
		return AgentExecutionReceiptV1{}, err
	}
	if err := validateAgentExecutionReceipt(receipt, request.Token, request); err != nil {
		return AgentExecutionReceiptV1{}, err
	}
	if request.Plan.PlanVersion != "" && !planContainsOperation(request.Plan, receipt.OperationID) {
		return AgentExecutionReceiptV1{}, errors.New("receipt operationId does not belong to the plan")
	}
	if request.Receipt != nil && string(canonicalJSON(*request.Receipt)) != string(canonicalJSON(receipt)) {
		return AgentExecutionReceiptV1{}, errors.New("submitted receipt does not match the persisted Agent receipt")
	}
	return receipt, nil
}

func executeFileReplace(ctx context.Context, operation agentPlanAction) error {
	if err := agentContextError(ctx); err != nil {
		return err
	}
	path := stringValue(operation.Input, "path")
	content, err := base64.StdEncoding.DecodeString(stringValue(operation.Input, "contentBase64"))
	if err != nil || path == "" || !filepath.IsAbs(path) {
		return errors.New("filesystem.atomic_replace requires an absolute path and base64 content")
	}
	if err := atomicWriteFile(path, content, 0o600); err != nil {
		return err
	}
	return agentContextError(ctx)
}
func executeAllowlistedService(ctx context.Context, operation agentPlanAction) error {
	service, verb := stringValue(operation.Input, "serviceName"), strings.TrimPrefix(operation.OperationType, "service.")
	if !validWindowsServiceName(service) || !v2ContainsString([]string{"start", "stop", "reload"}, verb) {
		return errors.New("service operation requires a fixed service and verb")
	}
	command := exec.CommandContext(ctx, windowsSystemControlPath, verb, service)
	command.Dir = windowsSystem32Directory
	command.Env = fixedWindowsEnvironment()
	return command.Run()
}

func executeAllowlistedProgram(ctx context.Context, operation agentPlanAction) error {
	if err := validateAllowlistedCommandInput(operation); err != nil {
		return err
	}
	args, _ := stringArrayValue(operation.Input, "args")
	command := exec.CommandContext(ctx, windowsSystemControlPath, args...)
	command.Dir = windowsSystem32Directory
	command.Env = fixedWindowsEnvironment()
	return command.Run()
}

const (
	windowsSystem32Directory = `C:\Windows\System32`
	windowsSystemControlPath = windowsSystem32Directory + `\sc.exe`
)

func validateAllowlistedCommandInput(operation agentPlanAction) error {
	input := operation.Input
	program := stringValue(input, "executablePath")
	if !strings.EqualFold(filepath.Clean(program), windowsSystemControlPath) {
		return errors.New("program is not in the fixed absolute-path allowlist")
	}
	if err := verifyExecutableSha256(program, stringValue(input, "executableSha256")); err != nil {
		return err
	}
	if !strings.EqualFold(filepath.Clean(stringValue(input, "workingDirectory")), windowsSystem32Directory) {
		return errors.New("allowlisted command working directory is not fixed")
	}
	args, err := stringArrayValue(input, "args")
	if err != nil || len(args) != 2 || !v2ContainsString([]string{"start", "stop", "query"}, args[0]) || !validWindowsServiceName(args[1]) {
		return errors.New("allowlisted command args do not match the fixed template")
	}
	template, err := stringArrayValue(input, "argumentTemplate")
	if err != nil || !matchesWindowsArgumentTemplate(args, template) {
		return errors.New("allowlisted command argument template is invalid")
	}
	if values, ok := input["environmentAllowlist"]; ok {
		environment, err := stringArray(values)
		if err != nil || len(environment) != 0 {
			return errors.New("allowlisted command environment is not permitted")
		}
	}
	if values, ok := input["networkScopes"]; ok {
		networkScopes, err := stringArray(values)
		if err != nil || len(networkScopes) != 0 {
			return errors.New("allowlisted command network scope is not permitted")
		}
	}
	if value, ok := input["childProcessPolicy"]; ok {
		policy, ok := value.(string)
		if !ok || strings.TrimSpace(policy) != "deny" {
			return errors.New("allowlisted command child process policy is not deny")
		}
	}
	if value, ok := input["timeoutSeconds"]; ok {
		seconds, ok := integerValue(value)
		if !ok || seconds < 1 || seconds > operation.TimeoutSeconds {
			return errors.New("allowlisted command timeout exceeds the operation limit")
		}
	}
	if value, ok := input["outputLimitBytes"]; ok {
		limit, ok := integerValue(value)
		if !ok || limit < 1 || limit > 16*1024*1024 {
			return errors.New("allowlisted command output limit is invalid")
		}
	}
	if value, ok := input["artifactDigest"]; ok {
		if digest, ok := value.(string); !ok || !isSHA256Hex(digest) {
			return errors.New("allowlisted command artifact digest is invalid")
		}
	}
	for key := range input {
		switch strings.ToLower(strings.TrimSpace(key)) {
		case "command", "shell", "script", "powershell", "cmd", "spawn", "exec", "interpreter", "detached", "stdio", "inheritparentenvironment", "childprocessescape":
			return fmt.Errorf("allowlisted command input contains forbidden field: %s", key)
		}
	}
	return nil
}

func matchesWindowsArgumentTemplate(args, template []string) bool {
	if len(args) != len(template) {
		return false
	}
	return (template[0] == args[0] || template[0] == "{verb}") && (template[1] == args[1] || template[1] == "{serviceName}")
}

func stringArrayValue(values map[string]any, key string) ([]string, error) {
	raw, ok := values[key]
	if !ok {
		return nil, errors.New("allowlisted command array is missing")
	}
	return stringArray(raw)
}

func stringArray(raw any) ([]string, error) {
	result := []string{}
	switch values := raw.(type) {
	case []any:
		result = make([]string, 0, len(values))
		for _, value := range values {
			text, ok := value.(string)
			if !ok || strings.TrimSpace(text) == "" {
				return nil, errors.New("array item is not a non-empty string")
			}
			result = append(result, text)
		}
	case []string:
		for _, value := range values {
			if strings.TrimSpace(value) == "" {
				return nil, errors.New("array item is not a non-empty string")
			}
			result = append(result, value)
		}
	default:
		return nil, errors.New("value is not a string array")
	}
	if len(result) > 100 {
		return nil, errors.New("array has too many items")
	}
	return result, nil
}

func integerValue(value any) (int, bool) {
	switch current := value.(type) {
	case int:
		return current, true
	case int32:
		return int(current), true
	case int64:
		return int(current), true
	case float64:
		return int(current), current == float64(int(current))
	case float32:
		return int(current), current == float32(int(current))
	default:
		return 0, false
	}
}

func verifyExecutableSha256(path, expected string) error {
	if !isSHA256Hex(expected) {
		return errors.New("executableSha256 must be a SHA-256 digest")
	}
	file, err := os.Open(path)
	if err != nil {
		return errors.New("fixed executable is unavailable")
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return errors.New("fixed executable digest could not be calculated")
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if !strings.EqualFold(actual, expected) {
		return errors.New("fixed executable digest does not match")
	}
	return nil
}

func isSHA256Hex(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func fixedWindowsEnvironment() []string {
	return []string{"SystemRoot=C:\\Windows", "PATH=C:\\Windows\\System32"}
}

func validWindowsServiceName(value string) bool {
	if value == "" || len(value) > 256 || strings.TrimSpace(value) != value {
		return false
	}
	for index, current := range value {
		if (current >= 'a' && current <= 'z') || (current >= 'A' && current <= 'Z') || (current >= '0' && current <= '9') || current == '-' || current == '_' || current == '.' || current == '@' || current == ':' {
			if index == 0 && current == '-' {
				return false
			}
			continue
		}
		return false
	}
	return true
}

func verifySignedValue(keyID, signature string, value any, envName string) error {
	if keyID == "" || signature == "" {
		return unavailableAgentAuthorizationMaterial("signature and authorityKeyId are required")
	}
	raw := strings.TrimSpace(agentAuthorizationKeySet(envName))
	if raw == "" {
		return unavailableAgentAuthorizationMaterial("trusted policy key set is unavailable; fail closed")
	}
	var keySet map[string]string
	if json.Unmarshal([]byte(raw), &keySet) != nil {
		return unavailableAgentAuthorizationMaterial("trusted policy key set is invalid")
	}
	encoded, ok := keySet[keyID]
	if !ok {
		return unavailableAgentAuthorizationMaterial("trusted policy key is not configured")
	}
	publicKey, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return unavailableAgentAuthorizationMaterial("trusted policy key is invalid")
	}
	signed, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil {
		signed, err = base64.StdEncoding.DecodeString(signature)
	}
	if err != nil || !ed25519.Verify(ed25519.PublicKey(publicKey), canonicalJSON(value), signed) {
		return errors.New("signature verification failed")
	}
	return nil
}

func agentAuthorizationKeySet(envName string) string {
	if material := currentAgentTrustMaterial(); material != nil {
		var keySet map[string]string
		switch envName {
		case "GCAC_AGENT_CAPABILITY_KEYSET_JSON":
			keySet = material.CapabilityKeySet
		case "GCAC_POLICY_AUTHORITY_KEYSET_JSON":
			keySet = material.PolicyAuthorityKeySet
		}
		if len(keySet) > 0 {
			if encoded, err := json.Marshal(keySet); err == nil {
				return string(encoded)
			}
		}
	}
	return os.Getenv(envName)
}

func agentAuthorizationLocalPolicy() string {
	if material := currentAgentTrustMaterial(); material != nil {
		paths := make([]string, 0, len(material.LocalPolicy.PathRules))
		for _, rule := range material.LocalPolicy.PathRules {
			paths = append(paths, rule.Prefix)
		}
		if encoded, err := json.Marshal(map[string]any{
			"allowedPaths":    paths,
			"allowedServices": material.LocalPolicy.ServiceRules,
		}); err == nil {
			return string(encoded)
		}
	}
	return os.Getenv("GCAC_AGENT_LOCAL_POLICY_JSON")
}
func tokenWithoutSignature(value AgentCapabilityTokenV1) map[string]any {
	value.Signature = ""
	raw, _ := json.Marshal(value)
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	delete(result, "signature")
	return result
}
func decisionWithoutSignature(value PolicyAuthorityDecisionV1) map[string]any {
	value.Signature = ""
	raw, _ := json.Marshal(value)
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	delete(result, "signature")
	return result
}
func canonicalJSON(value any) []byte {
	raw, _ := json.Marshal(value)
	var normalized any
	if json.Unmarshal(raw, &normalized) != nil {
		return nil
	}
	canonical, _ := json.Marshal(normalized)
	return canonical
}

func computeAgentFactDigest(fact map[string]any) (string, error) {
	payload := make(map[string]any, len(fact))
	for key, value := range fact {
		if key != "digest" {
			payload[key] = value
		}
	}
	canonical := canonicalJSON(payload)
	if len(canonical) == 0 {
		return "", errors.New("fact cannot be canonicalized")
	}
	digest := sha256.Sum256(canonical)
	return hex.EncodeToString(digest[:]), nil
}

func sha256FileDigest(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func computeAgentPlanDigest(plan agentPlanV2) (string, error) {
	payload := map[string]any{
		"planVersion":     plan.PlanVersion,
		"planId":          plan.PlanID,
		"agentId":         plan.AgentID,
		"tenantId":        plan.TenantID,
		"pluginId":        plan.PluginID,
		"pluginVersionId": plan.PluginVersionID,
		"capability":      plan.Capability,
		"operations":      plan.Operations,
		"writeEffect":     plan.WriteEffect,
	}
	if plan.ApprovalRef != "" {
		payload["approvalRef"] = plan.ApprovalRef
	}
	canonical := canonicalJSON(payload)
	if len(canonical) == 0 {
		return "", errors.New("plan cannot be canonicalized")
	}
	digest := sha256.Sum256(canonical)
	return hex.EncodeToString(digest[:]), nil
}

func computeAgentPlanResultDigest(plan agentPlanV2) (string, error) {
	canonical := canonicalJSON(plan)
	if len(canonical) == 0 {
		return "", errors.New("plan cannot be canonicalized")
	}
	digest := sha256.Sum256(canonical)
	return hex.EncodeToString(digest[:]), nil
}

func isAgentDigest(value string) bool {
	if len(value) != sha256.Size*2 {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func planContainsOperation(plan agentPlanV2, operationID string) bool {
	for _, operation := range plan.Operations {
		if operation.OperationID == operationID {
			return true
		}
	}
	return false
}

func computeAgentExecutionReceiptDigest(receipt AgentExecutionReceiptV1) (string, error) {
	receipt.Digest = ""
	receipt.Signature = ""
	canonical := canonicalJSON(receipt)
	if len(canonical) == 0 {
		return "", errors.New("receipt cannot be canonicalized")
	}
	digest := sha256.Sum256(canonical)
	return hex.EncodeToString(digest[:]), nil
}

func agentReceiptWithoutSignature(receipt AgentExecutionReceiptV1) map[string]any {
	receipt.Signature = ""
	raw, _ := json.Marshal(receipt)
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	delete(result, "signature")
	return result
}

func loadAgentReceiptSigner() (agentReceiptSigner, error) {
	keyID := strings.TrimSpace(os.Getenv("GCAC_AGENT_RECEIPT_KEY_ID"))
	if keyID == "" || isDevelopmentKeyID(keyID) {
		return agentReceiptSigner{}, errors.New("Agent 回执签名 KeyId 未配置或属于开发密钥")
	}
	encodedPrivateKey := strings.TrimSpace(os.Getenv("GCAC_AGENT_RECEIPT_SIGNING_KEY_BASE64"))
	privateKey, err := base64.StdEncoding.DecodeString(encodedPrivateKey)
	if err != nil || len(privateKey) != ed25519.PrivateKeySize {
		return agentReceiptSigner{}, errors.New("Agent 回执签名私钥不可用，失败关闭")
	}
	if err := verifyReceiptPublicKey(keyID, ed25519.PrivateKey(privateKey).Public().(ed25519.PublicKey)); err != nil {
		return agentReceiptSigner{}, err
	}
	return agentReceiptSigner{KeyID: keyID, PrivateKey: ed25519.PrivateKey(privateKey)}, nil
}

func verifyReceiptPublicKey(keyID string, expected ed25519.PublicKey) error {
	raw := strings.TrimSpace(os.Getenv("GCAC_AGENT_RECEIPT_KEYSET_JSON"))
	if raw == "" {
		return errors.New("Agent 回执受信 KeySet 不可用，失败关闭")
	}
	var keySet map[string]string
	if err := json.Unmarshal([]byte(raw), &keySet); err != nil {
		return errors.New("Agent 回执受信 KeySet 无效")
	}
	encoded, ok := keySet[keyID]
	if !ok {
		return errors.New("Agent 回执签名 KeyId 未被受信 KeySet 登记")
	}
	publicKey, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(publicKey) != ed25519.PublicKeySize || !bytes.Equal(publicKey, expected) {
		return errors.New("Agent 回执签名密钥与受信 KeySet 不匹配")
	}
	return nil
}

func isDevelopmentKeyID(value string) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	return value == "default" || value == "development" || value == "dev" || value == "test" || strings.Contains(value, "development")
}
func revokedNonce(nonce string) bool {
	var values []string
	_ = json.Unmarshal([]byte(os.Getenv("GCAC_AGENT_REVOKED_NONCES")), &values)
	for _, value := range values {
		if value == nonce {
			return true
		}
	}
	return false
}
func validateLocalPolicy(paths, services []string) error {
	raw := strings.TrimSpace(agentAuthorizationLocalPolicy())
	if raw == "" {
		return unavailableAgentAuthorizationMaterial("local agent policy is unavailable; fail closed")
	}
	var policy struct {
		AllowedPaths    []string `json:"allowedPaths"`
		AllowedServices []string `json:"allowedServices"`
	}
	if json.Unmarshal([]byte(raw), &policy) != nil {
		return unavailableAgentAuthorizationMaterial("local agent policy is invalid")
	}
	for _, path := range paths {
		if !pathScopeContains(policy.AllowedPaths, path) {
			return errors.New("path is denied by local policy")
		}
	}
	for _, service := range services {
		if !scopeContains(policy.AllowedServices, service) {
			return errors.New("service is denied by local policy")
		}
	}
	return nil
}

func validateAgentPlanLocalPolicy(plan agentPlanV2) error {
	raw := strings.TrimSpace(agentAuthorizationLocalPolicy())
	if raw == "" {
		return unavailableAgentAuthorizationMaterial("local agent policy is unavailable; fail closed")
	}
	var policy struct {
		AllowedPaths    []string `json:"allowedPaths"`
		AllowedServices []string `json:"allowedServices"`
	}
	if err := json.Unmarshal([]byte(raw), &policy); err != nil {
		return unavailableAgentAuthorizationMaterial("local agent policy is invalid")
	}
	for _, operation := range plan.Operations {
		if path := stringValue(operation.Input, "path"); path != "" && !pathScopeContains(policy.AllowedPaths, path) {
			return errors.New("operation path is denied by local policy")
		}
		if service := stringValue(operation.Input, "serviceName"); service != "" && !scopeContains(policy.AllowedServices, service) {
			return errors.New("operation service is denied by local policy")
		}
		if operation.OperationType == "command.execute_allowlisted" {
			args, _ := stringArrayValue(operation.Input, "args")
			if len(args) != 2 || !scopeContains(policy.AllowedServices, args[1]) {
				return errors.New("allowlisted command service is denied by local policy")
			}
		}
	}
	return nil
}
func sameStringSet(left, right []string) bool {
	a, b := append([]string(nil), left...), append([]string(nil), right...)
	sort.Strings(a)
	sort.Strings(b)
	return strings.Join(a, "\x00") == strings.Join(b, "\x00")
}
func scopeContains(scope []string, value string) bool {
	for _, item := range scope {
		if item == value {
			return true
		}
	}
	return false
}
func pathScopeContains(scope []string, value string) bool {
	normalizedValue, ok := normalizeAgentScopedPath(value)
	if !ok {
		return false
	}
	for _, item := range scope {
		normalizedScope, ok := normalizeAgentScopedPath(item)
		if !ok {
			continue
		}
		relative, err := filepath.Rel(normalizedScope, normalizedValue)
		if err != nil {
			continue
		}
		relative = filepath.ToSlash(relative)
		if relative == "." || (relative != ".." && !strings.HasPrefix(relative, "../")) {
			return true
		}
	}
	return false
}

func normalizeAgentScopedPath(value string) (string, bool) {
	if value == "" || strings.IndexByte(value, 0) >= 0 {
		return "", false
	}
	slashValue := strings.ReplaceAll(value, "\\", "/")
	for _, component := range strings.Split(slashValue, "/") {
		if component == ".." {
			return "", false
		}
	}
	normalized := filepath.Clean(filepath.FromSlash(slashValue))
	if normalized == "" {
		return "", false
	}
	return normalized, true
}

func unavailableAgentAuthorizationMaterial(message string) error {
	return fmt.Errorf("%w: %s", errAgentAuthorizationMaterialUnavailable, message)
}
func decodeAgentV2Request(encoded []byte, envelope *agentV2Request) error {
	decoder := json.NewDecoder(bytes.NewReader(encoded))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(envelope); err != nil {
		return err
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		if err == nil {
			return errors.New("multiple JSON values are not allowed")
		}
		return err
	}
	return nil
}
func v2ContainsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
func stringValue(values map[string]any, key string) string {
	value, _ := values[key].(string)
	return strings.TrimSpace(value)
}
func hostnameValue() string {
	value, err := os.Hostname()
	if err != nil {
		return ""
	}
	return value
}

func atomicWriteFile(path string, content []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".gcac-v2-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(mode); err != nil {
		_ = temporary.Close()
		return err
	}
	if _, err := temporary.Write(content); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func v2ActionHandler(action string) actionHandler {
	return actionHandlerFunc{
		descriptor: actionHandlerDescriptor{ActionType: action},
		execute: func(execution *taskExecutionContext) actionExecutionResult {
			payload := cloneMap(execution.task.Payload)
			payload["action"] = action
			agentID := ""
			if execution.registration != nil {
				agentID = execution.registration.AgentID
			}
			success, code, message, detail := executeAgentV2(execution.ctx, payload, agentID)
			return actionExecutionResult{Success: success, ErrorCode: code, ErrorMessage: message, Detail: detail}
		},
	}
}
