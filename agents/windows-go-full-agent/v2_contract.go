package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// 写操作的授权材料不可用时，必须失败关闭并向控制面报告 UNKNOWN。
var errAgentAuthorizationMaterialUnavailable = errors.New("agent authorization material unavailable")

// Receipt 签名器只在 Agent 本机生成和读取。锁用于避免首次并发写计划时生成两套材料。
var agentReceiptSignerMu sync.Mutex

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
	Action              string                              `json:"action"`
	RequestID           string                              `json:"requestId"`
	AgentID             string                              `json:"agentId"`
	TenantID            string                              `json:"tenantId"`
	PluginID            string                              `json:"pluginId"`
	PluginVersion       string                              `json:"pluginVersion"`
	Capability          string                              `json:"capability"`
	Actions             []string                            `json:"actions"`
	Paths               []string                            `json:"paths"`
	Services            []string                            `json:"services"`
	ArtifactDigests     []string                            `json:"artifactDigests"`
	PlanDigest          string                              `json:"planDigest"`
	Token               AgentCapabilityTokenV1              `json:"token"`
	PolicyDecision      PolicyAuthorityDecisionV1           `json:"policyDecision"`
	LocalPolicyMaterial *signedAgentLocalPolicyMaterialWire `json:"localPolicyMaterial,omitempty"`
	// DiscoverySpec 是旧控制面请求携带的兼容字段。Windows 运行态扫描器不会读取它，
	// 也不会因为它缺失或内容变化拒绝完整发现。
	DiscoverySpec       json.RawMessage          `json:"discoverySpec,omitempty"`
	RefreshWebInventory bool                     `json:"refreshWebInventory,omitempty"`
	Plan                agentPlanV2              `json:"plan"`
	Receipt             *AgentExecutionReceiptV1 `json:"receipt,omitempty"`
}

func executeAgentV2(ctx context.Context, request map[string]any, agentID string, configs ...*AgentConfig) (bool, string, string, map[string]any) {
	// 重新发现标记和操作者是控制面调度元数据，不属于签名 Agent v2 载荷。
	// 只在进入严格合同前移除这两个已声明的外层字段，其他未知字段仍会失败关闭。
	encoded, err := json.Marshal(agentV2ContractPayload(request))
	if err != nil || len(encoded) > 1<<20 {
		return false, "AGENT_V2_MESSAGE_INVALID", "Agent v2 请求无效或超长", nil
	}
	var envelope agentV2Request
	if err := decodeAgentV2Request(encoded, &envelope); err != nil {
		return false, "AGENT_V2_MESSAGE_INVALID", err.Error(), nil
	}
	if incoming := envelope.LocalPolicyMaterial; incoming != nil {
		if err := persistProvisionedLocalPolicy(firstAgentConfig(configs), agentID, incoming); err != nil {
			return false, "AGENT_V2_AUTHORIZATION_DENIED", err.Error(), nil
		}
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
		return executeAuthorizedAgentPlan(ctx, envelope.Plan, envelope.Token, firstAgentConfig(configs))
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

func firstAgentConfig(configs []*AgentConfig) *AgentConfig {
	if len(configs) == 0 {
		return nil
	}
	return configs[0]
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
	phaseDurations := map[string]int64{}
	timed := func(phase string, run func()) {
		phaseStarted := time.Now()
		run()
		phaseDurations[phase] = time.Since(phaseStarted).Milliseconds()
	}
	collectedAt := time.Now().UTC().Format(time.RFC3339Nano)
	facts := make([]map[string]any, 0, 16)
	warnings := make([]string, 0)
	ports := []map[string]any{}
	processes := []map[string]any{}
	requestServices := []map[string]any{}
	webInventory := map[string]any(nil)
	timed("ports", func() {
		ports = collectWindowsListeningPorts(scanCtx)
	})
	timed("processes", func() {
		processes = collectWindowsProcesses(scanCtx, ports)
	})
	timed("services", func() {
		requestServices = collectWindowsServices(scanCtx, request.Services)
	})
	if request.RefreshWebInventory {
		timed("runtimeWeb", func() {
			webInventory = collectWindowsMatureWebInventory(scanCtx, nil)
		})
	}
	facts = append(facts, processes...)
	facts = append(facts, requestServices...)
	if len(ports) == 0 {
		warnings = append(warnings, "未发现可读取的监听端口")
	}
	facts = append(facts, ports...)
	facts = append(facts, collectWindowsPermissions())
	// 根信任检查只需要 Windows Root 证书库事实，不需要 Web 配置或站点扫描。
	facts = append(facts, collectWindowsCertificateStores(scanCtx)...)
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
			"visitedEntries":      0,
			"stopped":             scanCtx.Err() != nil,
			"stopReason":          windowsDiscoveryStopReason(scanCtx),
			"processes":           len(processes),
			"services":            len(requestServices),
			"configFiles":         lenOfAny(webInventoryValue(webInventory, "configFiles")),
			"certificateFacts":    lenOfAny(webInventoryValue(webInventory, "certificateFiles")),
			"sslBindings":         lenOfAny(webInventoryValue(webInventory, "sites")),
			"scanner":             "windows-runtime-discovery",
		},
	}
	if webInventory != nil {
		envelope["webInventory"] = webInventory
	}
	digest, err := computeAgentFactDigest(envelope)
	if err != nil {
		return false, "AGENT_FACT_COLLECTION_FAILED", "通用事实摘要生成失败", nil
	}
	envelope["digest"] = digest
	return true, "", "", map[string]any{"factEnvelope": envelope}
}

// collectWindowsCertificateStores 通过固定的 PowerShell 只读命令读取
// LocalMachine\\Root 的 DER 原文，再由 Go 计算 SHA-256。命令没有用户输入，
// 不属于 Agent 计划的自由命令执行路径。
func collectWindowsCertificateStores(ctx context.Context) []map[string]any {
	script := "$ErrorActionPreference='Stop'; Get-ChildItem -LiteralPath 'Cert:\\LocalMachine\\Root' | ForEach-Object { [Convert]::ToBase64String($_.RawData) }"
	command := exec.CommandContext(ctx, windowsPowerShellPath, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	command.Dir = windowsSystem32Directory
	command.Env = fixedWindowsEnvironment()
	output, err := command.Output()
	if err != nil {
		return []map[string]any{{"kind": "certificate_store", "store": "root", "storeLocation": "LocalMachine", "storeName": "Root", "subject": "unavailable", "sha256Fingerprint": "unavailable", "hasPrivateKey": false}}
	}
	stores := parseWindowsCertificateStoreOutput(output)
	if len(stores) == 0 {
		return []map[string]any{{"kind": "certificate_store", "store": "root", "storeLocation": "LocalMachine", "storeName": "Root", "subject": "unavailable", "sha256Fingerprint": "unavailable", "hasPrivateKey": false}}
	}
	return stores
}

func parseWindowsCertificateStoreOutput(output []byte) []map[string]any {
	stores := make([]map[string]any, 0, 64)
	scanner := bufio.NewScanner(bytes.NewReader(output))
	for scanner.Scan() {
		encoded := strings.TrimSpace(scanner.Text())
		if encoded == "" {
			continue
		}
		der, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			continue
		}
		certificate, err := x509.ParseCertificate(der)
		if err != nil {
			continue
		}
		sha256Fingerprint := sha256.Sum256(certificate.Raw)
		sha1Fingerprint := sha1.Sum(certificate.Raw)
		stores = append(stores, map[string]any{
			"kind":              "certificate_store",
			"store":             "root",
			"storeLocation":     "LocalMachine",
			"storeName":         "Root",
			"path":              "windows-certstore://LocalMachine/Root/" + strings.ToUpper(hex.EncodeToString(sha1Fingerprint[:])),
			"subject":           certificate.Subject.String(),
			"issuer":            certificate.Issuer.String(),
			"serialNumber":      certificate.SerialNumber.String(),
			"notBefore":         certificate.NotBefore.UTC().Format(time.RFC3339Nano),
			"notAfter":          certificate.NotAfter.UTC().Format(time.RFC3339Nano),
			"sha256Fingerprint": strings.ToUpper(hex.EncodeToString(sha256Fingerprint[:])),
			"thumbprint":        strings.ToUpper(hex.EncodeToString(sha1Fingerprint[:])),
			"hasPrivateKey":     false,
		})
		if len(stores) >= 256 {
			break
		}
	}
	return stores
}

func webInventoryValue(inventory map[string]any, key string) any {
	if inventory == nil {
		return nil
	}
	return inventory[key]
}

// 内置命令失败必须作为完整快照的一部分显式可见，不能把空结果误报为“未发现”。
// 命令的错误、退出码、解析数量和输出语言仍保留在 diagnostics.commandDiagnostics。
func appendWindowsCommandWarning(warnings *[]string, diagnostic map[string]any) {
	if warnings == nil || len(diagnostic) == 0 || boolFromMap(diagnostic, "success") {
		return
	}
	command := strings.TrimSpace(stringFromMap(diagnostic, "command"))
	if command == "" {
		command = "Windows 内置读取命令"
	}
	message := strings.TrimSpace(stringFromMap(diagnostic, "error"))
	if message == "" {
		message = "未返回成功状态"
	}
	*warnings = append(*warnings, fmt.Sprintf("%s 执行失败（退出码 %d）：%s", command, intFromMap(diagnostic, "exitCode"), message))
}

func windowsDiscoveryStopReason(ctx context.Context) string {
	if ctx == nil || ctx.Err() == nil {
		return ""
	}
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		return "扫描超过期限"
	}
	return "请求已取消"
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
		// 发现只需要镜像位置；对每个监听进程读取完整文件再计算摘要会把扫描时间
		// 放大到不可接受，且这个摘要并不参与只读事实采集的安全校验。
		result = append(result, map[string]any{"kind": "process", "pid": pid, "executablePath": filepath.ToSlash(path)})
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
		return []map[string]any{}
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

func collectWindowsPermissions() map[string]any {
	principal := strings.TrimSpace(os.Getenv("USERNAME"))
	if principal == "" {
		principal = "unknown"
	}
	return map[string]any{"kind": "privilege", "principal": principal, "elevated": windowsTokenIsElevated(), "groups": []string{}}
}

func windowsTokenIsElevated() bool {
	command := exec.Command(windowsSystem32Directory+`\whoami.exe`, "/groups")
	command.Dir = windowsSystem32Directory
	command.Env = fixedWindowsEnvironment()
	output, err := command.Output()
	return err == nil && strings.Contains(string(output), "S-1-5-32-544") && strings.Contains(strings.ToLower(string(output)), "enabled")
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
		if configPath := stringValue(operation.Input, "configPath"); configPath != "" && !pathScopeContains(token.AllowedPaths, configPath) {
			return errors.New("operation configPath is outside token scope")
		}
		if service := stringValue(operation.Input, "serviceName"); service != "" && !scopeContains(token.AllowedServices, service) {
			return errors.New("operation service is outside token scope")
		}
		if operation.OperationType == "command.execute_allowlisted" {
			if err := validateAllowlistedCommandScope(operation.Input, token.AllowedPaths, token.ArtifactDigests); err != nil {
				return err
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
			if err := validateAllowlistedCommandScope(operation.Input, decision.AllowedPaths, decision.ArtifactDigests); err != nil {
				return err
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
	if !v2ContainsString([]string{"process.list", "service.list", "service.status", "filesystem.stat", "filesystem.read", "filesystem.backup", "filesystem.atomic_replace", "filesystem.restore", "certificate.material.validate", "certificate.store.inspect", "certificate.store.install", "key.generate_csr", "certificate.install_issued", "certificate.iis.binding.update", "certificate.iis.binding.verify", "certificate.iis.binding.rollback", "certificate.tls.verify", "ca.certificate.issue", "ca.certificate.renew", "ca.certificate.query", "ca.certificate.revoke", "ca.revocation.evidence", "service.start", "service.stop", "service.restart", "service.reload", "command.execute_allowlisted"}, operation.OperationType) {
		return fmt.Errorf("unsupported Agent operation: %s", operation.OperationType)
	}
	if v2ContainsString([]string{"service.status", "service.start", "service.stop", "service.restart", "service.reload"}, operation.OperationType) && stringValue(operation.Input, "serviceName") == "" {
		return errors.New("service operation requires serviceName")
	}
	if operation.OperationType == "filesystem.atomic_replace" && stringValue(operation.Input, "contentBase64") == "" {
		return errors.New("filesystem.atomic_replace requires contentBase64")
	}
	if operation.OperationType == "certificate.material.validate" {
		if stringValue(operation.Input, "contentBase64") == "" {
			return errors.New("certificate.material.validate requires contentBase64")
		}
		storageKind := stringValue(operation.Input, "storageKind")
		if storageKind != "PEM_FILES" && storageKind != "KEYSTORE" {
			return errors.New("certificate.material.validate storageKind is invalid")
		}
	}
	if operation.OperationType == "certificate.tls.verify" {
		return validatePreDeployTLSVerificationInput(operation.Input)
	}
	if operation.OperationType == "certificate.store.install" {
		return validateCertificateStoreInstallInput(operation.Input)
	}
	if operation.OperationType == "key.generate_csr" {
		return validateLocalKeyGenerateInput(operation.Input)
	}
	if operation.OperationType == "certificate.install_issued" {
		return validateIssuedCertificateInstallInput(operation.Input)
	}
	if operation.OperationType == "certificate.material.validate" {
		return validateWindowsCertificateMaterialInput(operation.Input)
	}
	if strings.HasPrefix(operation.OperationType, "ca.") {
		return validateCertificateAuthorityOperationInput(operation.OperationType, operation.Input)
	}
	if strings.HasPrefix(operation.OperationType, "certificate.iis.binding.") {
		return validateIISBindingOperationInput(operation.OperationType, operation.Input)
	}
	if operation.OperationType == "command.execute_allowlisted" {
		return validateAllowlistedCommandInput(operation)
	}
	return nil
}

func validatePreDeployTLSVerificationInput(input map[string]any) error {
	if len(input) < 6 || len(input) > 7 {
		return errors.New("部署前 TLS 验证输入字段无效")
	}
	for key := range input {
		if !v2ContainsString([]string{"connectHost", "serverName", "port", "expectedFingerprintSha256", "bindingId", "bindingKey", "checkedAt"}, key) {
			return errors.New("部署前 TLS 验证包含未允许字段")
		}
	}
	connectHost := stringValue(input, "connectHost")
	if connectHost != "127.0.0.1" && connectHost != "::1" {
		return errors.New("部署前 TLS 验证只能连接 Agent 本机回环地址")
	}
	if port := intFromMap(input, "port"); port <= 0 || port > 65535 {
		return errors.New("部署前 TLS 验证端口无效")
	}
	if expected := strings.ToLower(strings.ReplaceAll(stringValue(input, "expectedFingerprintSha256"), ":", "")); !isAgentDigest(expected) {
		return errors.New("部署前 TLS 验证期望指纹无效")
	}
	if stringValue(input, "bindingId") == "" || stringValue(input, "bindingKey") == "" {
		return errors.New("部署前 TLS 验证缺少绑定身份")
	}
	if _, err := time.Parse(time.RFC3339, stringValue(input, "checkedAt")); err != nil {
		return errors.New("部署前 TLS 验证 checkedAt 无效")
	}
	return nil
}

type agentReceiptSigner struct {
	KeyID      string
	PrivateKey ed25519.PrivateKey
}

// agentPlanProgressFunc 只报告操作元数据和结果，不携带证书内容、私钥或其他输入载荷。
// 进度日志用于控制面展示当前卡在哪一个原语，不能改变 Agent v2 的签名合同。
type agentPlanProgressFunc func(operation agentPlanAction, status string, errorMessage string)

type agentPlanProgressContextKey struct{}

func reportAgentPlanProgress(ctx context.Context, operation agentPlanAction, status string, errorMessage string) {
	progress, ok := ctx.Value(agentPlanProgressContextKey{}).(agentPlanProgressFunc)
	if !ok || progress == nil {
		return
	}
	progress(operation, status, errorMessage)
}

// agentOperationError 标记操作失败时是否已经跨过了副作用边界。
// 校验、打开源文件等失败不会改变远端状态，应返回 FAILED；命令已启动、复制已开始
// 或原子替换结果无法确认时才返回 UNKNOWN，禁止控制面自动重试。
type agentOperationError struct {
	err     error
	unknown bool
}

func (e *agentOperationError) Error() string {
	if e == nil || e.err == nil {
		return "Agent 操作失败"
	}
	return e.err.Error()
}

func (e *agentOperationError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func unknownOperationError(err error) error {
	if err == nil {
		return nil
	}
	return &agentOperationError{err: err, unknown: true}
}

func commandExecutionError(message string, err error) error {
	if err == nil {
		return nil
	}
	// 进程尚未启动时没有外部副作用，例如可执行文件不存在；这类错误可以安全重试。
	var startErr *exec.Error
	var pathErr *os.PathError
	if errors.As(err, &startErr) || errors.As(err, &pathErr) {
		return fmt.Errorf("%s: %w", message, err)
	}
	return unknownOperationError(fmt.Errorf("%s（进程已启动，结果不明）: %w", message, err))
}

func operationResultUnknown(err error) bool {
	var operationErr *agentOperationError
	return errors.As(err, &operationErr) && operationErr.unknown
}

func executeAuthorizedAgentPlan(ctx context.Context, plan agentPlanV2, token AgentCapabilityTokenV1, configs ...*AgentConfig) (bool, string, string, map[string]any) {
	config := firstAgentConfig(configs)
	if err := validateAgentPlan(plan, token); err != nil {
		return false, "AGENT_PLAN_INVALID", err.Error(), nil
	}
	if !plan.WriteEffect || !hasAgentWriteOperation(plan) {
		return false, "AGENT_PLAN_INVALID", "agent.plan.execute 只接受包含写操作的计划", nil
	}
	signer, err := loadAgentReceiptSigner(config)
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
		reportAgentPlanProgress(ctx, operation, "RUNNING", "")
		result := map[string]any{"operationId": operation.OperationID, "operationType": operation.OperationType, "stage": operation.Stage, "status": "SUCCEEDED"}
		operationCtx, cancel := context.WithTimeout(ctx, time.Duration(operation.TimeoutSeconds)*time.Second)
		var err error
		var operationDetail map[string]any
		if err = agentContextError(operationCtx); err == nil {
			switch operation.OperationType {
			case "process.list":
				operationDetail, err = executeProcessList(operationCtx)
			case "service.list":
				operationDetail, err = executeServiceList(operationCtx, operation)
			case "service.status":
				operationDetail, err = executeServiceStatus(operationCtx, operation)
			case "filesystem.stat":
				operationDetail, err = executeFilesystemStat(operationCtx, operation)
			case "filesystem.read":
				operationDetail, err = executeFilesystemRead(operationCtx, operation)
			case "filesystem.backup":
				operationDetail, err = executeFilesystemBackup(operationCtx, operation, signer)
			case "certificate.material.validate":
				operationDetail, err = executeCertificateMaterialValidate(operationCtx, operation)
			case "certificate.store.inspect":
				operationDetail, err = executeCertificateStoreInspect(operationCtx, operation)
			case "certificate.tls.verify":
				operationDetail, err = executePreDeployTLSVerification(operationCtx, operation)
			case "certificate.store.install":
				operationDetail, err = executeCertificateStoreInstall(operationCtx, operation)
			case "key.generate_csr":
				operationDetail, err = executeLocalKeyGenerate(operationCtx, plan, operation)
			case "certificate.install_issued":
				operationDetail, err = executeIssuedCertificateInstall(operationCtx, plan, operation)
			case "ca.certificate.issue", "ca.certificate.renew", "ca.certificate.query", "ca.certificate.revoke", "ca.revocation.evidence":
				operationDetail, err = executeCertificateAuthorityOperation(operationCtx, plan, operation)
			case "certificate.iis.binding.update":
				operationDetail, err = executeIISBindingOperation(operationCtx, operation, "update")
			case "certificate.iis.binding.verify":
				operationDetail, err = executeIISBindingOperation(operationCtx, operation, "verify")
			case "certificate.iis.binding.rollback":
				operationDetail, err = executeIISBindingOperation(operationCtx, operation, "rollback")
			case "filesystem.atomic_replace":
				err = executeFileReplace(operationCtx, operation)
			case "filesystem.restore":
				operationDetail, err = executeFilesystemRestore(operationCtx, operation)
			case "service.start", "service.stop", "service.reload":
				err = executeAllowlistedService(operationCtx, operation)
			case "service.restart":
				operationDetail, err = executeServiceRestart(operationCtx, operation)
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
		for key, value := range operationDetail {
			result[key] = value
		}
		if err != nil {
			writeOperation := isAgentWriteOperationType(operation.OperationType)
			unknownWrite := writeOperation && operationResultUnknown(err)
			result["status"] = map[bool]string{true: "UNKNOWN", false: "FAILED"}[unknownWrite]
			result["error"] = err.Error()
			reportAgentPlanProgress(ctx, operation, result["status"].(string), err.Error())
			results = append(results, result)
			receiptStatus := map[bool]string{true: "UNKNOWN", false: "FAILED"}[unknownWrite]
			errorCode := map[bool]string{true: "AGENT_EXECUTION_UNKNOWN", false: "AGENT_EXECUTION_FAILED"}[unknownWrite]
			unknownReason := ""
			if unknownWrite {
				unknownReason = "写操作结果不明，禁止自动重试或回退"
			}
			receipt, receiptErr := buildAndPersistAgentReceipt(plan, token, receiptStatus, startedAt, results, errorCode, unknownReason, signer)
			if receiptErr != nil {
				failureCode := map[bool]string{true: "AGENT_EXECUTION_UNKNOWN", false: "AGENT_EXECUTION_FAILED"}[unknownWrite]
				failureMessage := map[bool]string{true: "写操作结果不明且回执无法持久化", false: "执行失败且回执无法持久化"}[unknownWrite]
				return false, failureCode, failureMessage, unknownAgentWriteDetail(plan, map[bool]string{true: "写操作结果不明且回执不可用", false: "执行失败且回执不可用"}[unknownWrite], map[string]any{
					"operations":         results,
					"operationResults":   results,
					"receiptUnavailable": true,
				})
			}
			if unknownWrite {
				return false, "AGENT_EXECUTION_UNKNOWN", "写操作结果不明，禁止自动重试或回退", map[string]any{"planId": plan.PlanID, "operations": results, "operationResults": results, "executionStatus": "UNKNOWN", "receipt": receipt}
			}
			return false, "AGENT_EXECUTION_FAILED", err.Error(), map[string]any{"planId": plan.PlanID, "operations": results, "operationResults": results, "executionStatus": "FAILED", "receipt": receipt}
		}
		reportAgentPlanProgress(ctx, operation, "SUCCEEDED", "")
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

func isAgentWriteOperationType(operationType string) bool {
	return v2ContainsString([]string{"filesystem.backup", "filesystem.atomic_replace", "filesystem.restore", "certificate.store.install", "key.generate_csr", "certificate.install_issued", "certificate.iis.binding.update", "certificate.iis.binding.rollback", "ca.certificate.issue", "ca.certificate.renew", "ca.certificate.revoke", "service.start", "service.stop", "service.restart", "service.reload", "command.execute_allowlisted"}, operationType)
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
		if v2ContainsString([]string{"filesystem.backup", "filesystem.atomic_replace", "filesystem.restore", "certificate.store.install", "key.generate_csr", "certificate.install_issued", "certificate.iis.binding.update", "certificate.iis.binding.rollback", "ca.certificate.issue", "ca.certificate.renew", "ca.certificate.revoke", "service.start", "service.stop", "service.restart", "service.reload", "command.execute_allowlisted"}, operation.OperationType) {
			return true
		}
	}
	return false
}

type windowsPreDeployTLSProbe struct {
	Address    string
	Port       int
	ServerName string
}

// 这里只为已经签名的部署计划执行显式回环校验，不参与框架、站点或证书发现。
func probeWindowsPreDeployTLS(ctx context.Context, target windowsPreDeployTLSProbe) (map[string]any, error) {
	address := strings.Trim(strings.TrimSpace(target.Address), "[]")
	if address == "" || strings.EqualFold(address, "*") || strings.EqualFold(address, "0.0.0.0") {
		address = "127.0.0.1"
	} else if address == "::" || strings.EqualFold(address, "[::]") {
		address = "::1"
	}
	if target.Port <= 0 || target.Port > 65535 {
		return nil, errors.New("部署前 TLS 验证端口无效")
	}
	probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	config := &tls.Config{InsecureSkipVerify: true, MinVersion: tls.VersionTLS12}
	if strings.TrimSpace(target.ServerName) != "" {
		config.ServerName = strings.TrimSpace(target.ServerName)
	}
	dialer := &tls.Dialer{NetDialer: &net.Dialer{Timeout: 3 * time.Second}, Config: config}
	connection, err := dialer.DialContext(probeCtx, "tcp", net.JoinHostPort(address, strconv.Itoa(target.Port)))
	if err != nil {
		return nil, fmt.Errorf("TLS 握手失败: %w", err)
	}
	defer connection.Close()
	state := connection.(*tls.Conn).ConnectionState()
	if len(state.PeerCertificates) == 0 {
		return nil, errors.New("TLS 握手未返回证书")
	}
	certificate := state.PeerCertificates[0]
	sha1Fingerprint := sha1.Sum(certificate.Raw)
	sha256Fingerprint := sha256.Sum256(certificate.Raw)
	return map[string]any{
		"kind":              "tls_certificate_verification",
		"thumbprint":        strings.ToUpper(hex.EncodeToString(sha1Fingerprint[:])),
		"sha256Fingerprint": strings.ToUpper(hex.EncodeToString(sha256Fingerprint[:])),
		"subject":           certificate.Subject.String(),
		"issuer":            certificate.Issuer.String(),
		"notBefore":         certificate.NotBefore.UTC().Format(time.RFC3339),
		"notAfter":          certificate.NotAfter.UTC().Format(time.RFC3339),
	}, nil
}

func executePreDeployTLSVerification(ctx context.Context, operation agentPlanAction) (map[string]any, error) {
	if err := agentContextError(ctx); err != nil {
		return nil, err
	}
	connectHost := strings.TrimSpace(stringValue(operation.Input, "connectHost"))
	if connectHost != "127.0.0.1" && connectHost != "::1" {
		return nil, errors.New("部署前 TLS 验证只能连接 Agent 本机回环地址")
	}
	port := intFromMap(operation.Input, "port")
	if port <= 0 || port > 65535 {
		return nil, errors.New("部署前 TLS 验证端口无效")
	}
	expected := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(stringValue(operation.Input, "expectedFingerprintSha256")), ":", ""))
	if !isAgentDigest(expected) {
		return nil, errors.New("部署前 TLS 验证缺少有效的期望证书 SHA-256 指纹")
	}
	serverName := strings.TrimSpace(stringValue(operation.Input, "serverName"))
	fact, err := probeWindowsPreDeployTLS(ctx, windowsPreDeployTLSProbe{Address: connectHost, Port: port, ServerName: serverName})
	if err != nil {
		return nil, fmt.Errorf("部署前 TLS 握手失败: %w", err)
	}
	actual := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(stringFromMap(fact, "sha256Fingerprint")), ":", ""))
	if actual != expected {
		return nil, fmt.Errorf("部署前 TLS 证书指纹不一致: expected=%s actual=%s", expected, actual)
	}
	return map[string]any{
		"verification":              "local-tls-handshake",
		"connectHost":               connectHost,
		"port":                      port,
		"serverName":                serverName,
		"expectedFingerprintSha256": expected,
		"observedFingerprintSha256": actual,
	}, nil
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

func executeProcessList(ctx context.Context) (map[string]any, error) {
	if err := agentContextError(ctx); err != nil {
		return nil, err
	}
	executable, _ := os.Executable()
	return map[string]any{
		"status": "SUCCEEDED",
		"facts": []map[string]any{{
			"kind":           "process",
			"pid":            os.Getpid(),
			"executablePath": executable,
		}},
	}, nil
}

func executeServiceList(ctx context.Context, operation agentPlanAction) (map[string]any, error) {
	names, err := stringArrayValue(operation.Input, "serviceNames")
	if err != nil || len(names) == 0 || len(names) > 100 {
		return nil, errors.New("service.list requires 1 to 100 serviceNames")
	}
	facts := make([]any, 0, len(names))
	for _, name := range names {
		fact, factErr := executeServiceStatus(ctx, agentPlanAction{Input: map[string]any{"serviceName": name}})
		if factErr != nil {
			return nil, factErr
		}
		if service, ok := fact["service"]; ok {
			facts = append(facts, service)
		}
	}
	return map[string]any{"status": "SUCCEEDED", "facts": facts}, nil
}

func executeServiceStatus(ctx context.Context, operation agentPlanAction) (map[string]any, error) {
	serviceName := stringValue(operation.Input, "serviceName")
	if !validWindowsServiceName(serviceName) {
		return nil, errors.New("service.status requires a fixed service name")
	}
	query := exec.CommandContext(ctx, windowsSystemControlPath, "query", serviceName)
	query.Dir = windowsSystem32Directory
	query.Env = fixedWindowsEnvironment()
	output, err := query.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("sc.exe query failed: %w", err)
	}
	status := "unknown"
	upper := strings.ToUpper(string(output))
	switch {
	case strings.Contains(upper, "RUNNING"):
		status = "running"
	case strings.Contains(upper, "STOPPED"):
		status = "stopped"
	case strings.Contains(upper, "PAUSED"):
		status = "paused"
	}
	return map[string]any{
		"status":  "SUCCEEDED",
		"service": map[string]any{"kind": "service", "name": serviceName, "status": status},
	}, nil
}

func executeFilesystemStat(ctx context.Context, operation agentPlanAction) (map[string]any, error) {
	path := stringValue(operation.Input, "path")
	if !isSafeWindowsAbsolutePath(path) {
		return nil, errors.New("filesystem.stat requires an absolute path")
	}
	info, err := os.Stat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return map[string]any{"status": "SUCCEEDED", "fact": map[string]any{"kind": "file_stat", "path": filepath.Clean(path), "exists": false, "sizeBytes": 0}}, nil
		}
		return nil, err
	}
	if err := agentContextError(ctx); err != nil {
		return nil, err
	}
	return map[string]any{"status": "SUCCEEDED", "fact": map[string]any{
		"kind": "file_stat", "path": filepath.Clean(path), "exists": true, "sizeBytes": info.Size(), "modifiedAt": info.ModTime().UTC().Format(time.RFC3339Nano),
	}}, nil
}

func executeFilesystemRead(ctx context.Context, operation agentPlanAction) (map[string]any, error) {
	path := stringValue(operation.Input, "path")
	if !isSafeWindowsAbsolutePath(path) {
		return nil, errors.New("filesystem.read requires an absolute path")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(content) > 64*1024 {
		return nil, errors.New("filesystem.read content exceeds the contract limit")
	}
	digest := sha256.Sum256(content)
	return map[string]any{"status": "SUCCEEDED", "fact": map[string]any{
		"kind": "file_content", "path": filepath.Clean(path), "contentBase64": base64.StdEncoding.EncodeToString(content), "bytesRead": len(content), "truncated": false, "sha256": hex.EncodeToString(digest[:]),
	}}, nil
}

// executeFilesystemBackup 在 Agent 本机创建固定备份并签发恢复 checkpoint。
// 回滚只接受该 checkpoint，不能用控制面的 ledgerRef 猜测恢复位置。
func executeFilesystemBackup(ctx context.Context, operation agentPlanAction, signer agentReceiptSigner) (map[string]any, error) {
	path := stringValue(operation.Input, "path")
	if !isSafeWindowsAbsolutePath(path) || stringValue(operation.Input, "ledgerRef") != "execution-recovery-ledger" {
		return nil, errors.New("filesystem.backup requires an absolute path and recovery ledger")
	}
	if err := agentContextError(ctx); err != nil {
		return nil, err
	}
	cleanPath := filepath.Clean(path)
	backupPath := cleanPath + ".gcac-backup"
	info, err := os.Lstat(cleanPath)
	if os.IsNotExist(err) {
		checkpoint := map[string]any{
			"schemaVersion": "gcac.windows.signed-checkpoint/v1",
			"operationId":   operation.OperationID,
			"targetPath":    cleanPath,
			"backupPath":    backupPath,
			"existed":       false,
			"mode":          0,
			"sha256":        "",
		}
		return signedCheckpointResult(checkpoint, signer)
	}
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return nil, errors.New("filesystem.backup refuses symbolic links and non-regular files")
	}
	content, err := os.ReadFile(cleanPath)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(content)
	if err := atomicWriteFile(backupPath, content, 0o600); err != nil {
		return nil, unknownOperationError(fmt.Errorf("备份文件已写入但结果不明: %w", err))
	}
	if err := agentContextError(ctx); err != nil {
		return nil, unknownOperationError(fmt.Errorf("备份已写入但操作上下文已取消: %w", err))
	}
	checkpoint := map[string]any{
		"schemaVersion": "gcac.windows.signed-checkpoint/v1",
		"operationId":   operation.OperationID,
		"targetPath":    cleanPath,
		"backupPath":    backupPath,
		"existed":       true,
		"mode":          int(info.Mode().Perm()),
		"sha256":        hex.EncodeToString(digest[:]),
		"bytes":         len(content),
	}
	result, err := signedCheckpointResult(checkpoint, signer)
	if err != nil {
		return nil, err
	}
	result["backupPath"] = backupPath
	result["bytesCopied"] = len(content)
	result["sha256"] = hex.EncodeToString(digest[:])
	return result, nil
}

func signedCheckpointResult(checkpoint map[string]any, signer agentReceiptSigner) (map[string]any, error) {
	if strings.TrimSpace(signer.KeyID) == "" || len(signer.PrivateKey) != ed25519.PrivateKeySize {
		return nil, errors.New("Agent checkpoint 签名器不可用")
	}
	signature := base64.RawURLEncoding.EncodeToString(ed25519.Sign(signer.PrivateKey, canonicalJSON(checkpoint)))
	signed := make(map[string]any, len(checkpoint)+2)
	for key, value := range checkpoint {
		signed[key] = value
	}
	signed["keyId"] = signer.KeyID
	signed["signature"] = signature
	return map[string]any{"status": "SUCCEEDED", "checkpoint": signed}, nil
}

func executeFilesystemRestore(ctx context.Context, operation agentPlanAction) (map[string]any, error) {
	path := stringValue(operation.Input, "path")
	if !isSafeWindowsAbsolutePath(path) {
		return nil, errors.New("filesystem.restore requires an absolute target path")
	}
	checkpoint, ok := operation.Input["checkpoint"].(map[string]any)
	if !ok {
		return nil, errors.New("filesystem.restore requires a signed checkpoint")
	}
	if err := validateSignedCheckpoint(path, checkpoint); err != nil {
		return nil, err
	}
	if err := agentContextError(ctx); err != nil {
		return nil, err
	}
	cleanPath := filepath.Clean(path)
	if info, err := os.Lstat(cleanPath); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("filesystem.restore refuses symbolic link targets")
	}
	existed, _ := checkpoint["existed"].(bool)
	if !existed {
		if err := os.Remove(cleanPath); err != nil && !os.IsNotExist(err) {
			return nil, err
		}
		return map[string]any{"status": "SUCCEEDED", "restored": true, "existed": false, "targetPath": cleanPath}, nil
	}
	backupPath := stringValue(checkpoint, "backupPath")
	backupInfo, err := os.Lstat(backupPath)
	if err != nil {
		return nil, err
	}
	if backupInfo.Mode()&os.ModeSymlink != 0 || !backupInfo.Mode().IsRegular() {
		return nil, errors.New("filesystem.restore refuses symbolic link or non-regular backup")
	}
	content, err := os.ReadFile(backupPath)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(content)
	actualDigest := hex.EncodeToString(digest[:])
	if actualDigest != strings.ToLower(stringValue(checkpoint, "sha256")) {
		return nil, errors.New("filesystem.restore backup digest does not match checkpoint")
	}
	if err := atomicWriteFile(cleanPath, content, checkpointMode(checkpoint)); err != nil {
		return nil, err
	}
	return map[string]any{"status": "SUCCEEDED", "restored": true, "existed": true, "targetPath": cleanPath, "restoredSha256": actualDigest}, nil
}

func validateSignedCheckpoint(path string, checkpoint map[string]any) error {
	if stringValue(checkpoint, "schemaVersion") != "gcac.windows.signed-checkpoint/v1" {
		return errors.New("filesystem.restore checkpoint schema is unsupported")
	}
	cleanPath := filepath.Clean(path)
	if stringValue(checkpoint, "targetPath") != cleanPath {
		return errors.New("filesystem.restore checkpoint target does not match operation path")
	}
	keyID := stringValue(checkpoint, "keyId")
	signature := stringValue(checkpoint, "signature")
	unsigned := make(map[string]any, len(checkpoint))
	for key, value := range checkpoint {
		if key != "keyId" && key != "signature" {
			unsigned[key] = value
		}
	}
	if err := verifySignedValue(keyID, signature, unsigned, "GCAC_AGENT_RECEIPT_KEYSET_JSON"); err != nil {
		return fmt.Errorf("filesystem.restore checkpoint signature verification failed: %w", err)
	}
	existed, ok := checkpoint["existed"].(bool)
	if !ok {
		return errors.New("filesystem.restore checkpoint existed flag is invalid")
	}
	if !existed {
		return nil
	}
	backupPath := stringValue(checkpoint, "backupPath")
	if backupPath != cleanPath+".gcac-backup" || !isSafeWindowsAbsolutePath(backupPath) {
		return errors.New("filesystem.restore checkpoint backup path is invalid")
	}
	if !isSHA256Hex(stringValue(checkpoint, "sha256")) {
		return errors.New("filesystem.restore checkpoint digest is invalid")
	}
	if _, ok := checkpoint["mode"]; !ok {
		return errors.New("filesystem.restore checkpoint mode is missing")
	}
	return nil
}

func checkpointMode(checkpoint map[string]any) os.FileMode {
	value, ok := integerValue(checkpoint["mode"])
	if !ok || value <= 0 {
		return 0o600
	}
	return os.FileMode(value) & os.ModePerm
}

func executeCertificateMaterialValidate(ctx context.Context, operation agentPlanAction) (map[string]any, error) {
	path := stringValue(operation.Input, "path")
	storageKind := stringValue(operation.Input, "storageKind")
	if !isSafeWindowsAbsolutePath(path) || (storageKind != "PEM_FILES" && storageKind != "KEYSTORE") {
		return nil, errors.New("certificate.material.validate input is invalid")
	}
	content, err := decodeOperationContent(operation.Input)
	if err != nil {
		return nil, err
	}
	if err := agentContextError(ctx); err != nil {
		return nil, err
	}
	if storageKind == "KEYSTORE" {
		if err := validateWindowsCertificateMaterialInput(operation.Input); err != nil {
			return nil, err
		}
		if verifyCurrent, _ := operation.Input["verifyCurrentKeyStorePassword"].(bool); verifyCurrent {
			keystoreType := strings.ToUpper(strings.TrimSpace(stringValue(operation.Input, "keystoreType")))
			password, passwordErr := resolveWindowsKeyStorePassword(operation.Input)
			if passwordErr != nil {
				return nil, passwordErr
			}
			if err := validateWindowsCurrentKeyStore(
				path,
				keystoreType,
				password,
				strings.TrimSpace(stringValue(operation.Input, "keyAlias")),
			); err != nil {
				return nil, err
			}
		}
	} else if err := validatePemMaterial(path, content); err != nil {
		return nil, err
	}
	digest := sha256.Sum256(content)
	detail := map[string]any{"status": "SUCCEEDED", "path": filepath.Clean(path), "storageKind": storageKind, "bytes": len(content), "contentSha256": hex.EncodeToString(digest[:])}
	if storageKind == "KEYSTORE" {
		material, err := validateWindowsKeyStoreMaterial(operation.Input, path, content)
		if err != nil {
			return nil, err
		}
		detail["keystoreType"] = material.Format
		detail["keyAlias"] = material.Alias
		detail["aliasVerified"] = material.AliasVerified
		detail["certificateCount"] = material.CertificateCount
		detail["hasPrivateKey"] = len(material.PrivateKeyPublicKey) > 0
		detail["certificateFingerprintSha256"] = material.CertificateFingerprint
	}
	return detail, nil
}

func validateWindowsCertificateMaterialInput(input map[string]any) error {
	path := stringValue(input, "path")
	if !isSafeWindowsAbsolutePath(path) {
		return errors.New("certificate.material.validate KeyStore path is invalid")
	}
	if stringValue(input, "storageKind") != "KEYSTORE" {
		return nil
	}
	keystoreType := strings.ToUpper(strings.TrimSpace(stringValue(input, "keystoreType")))
	if keystoreType != "JKS" && keystoreType != "PKCS12" {
		return errors.New("certificate.material.validate KeyStore type is invalid")
	}
	if stringValue(input, "keystorePassword") == "" && stringValue(input, "configPath") == "" {
		return errors.New("certificate.material.validate KeyStore password source is required")
	}
	if configPath := stringValue(input, "configPath"); configPath != "" && !isSafeWindowsAbsolutePath(configPath) {
		return errors.New("certificate.material.validate configPath is invalid")
	}
	return nil
}

func decodeOperationContent(input map[string]any) ([]byte, error) {
	value := stringValue(input, "contentBase64")
	if value == "" {
		return nil, errors.New("operation requires contentBase64")
	}
	content, err := base64.StdEncoding.DecodeString(value)
	if err != nil || len(content) == 0 || len(content) > 64*1024 {
		return nil, errors.New("operation contentBase64 is invalid or exceeds the contract limit")
	}
	return content, nil
}

func validatePemMaterial(path string, content []byte) error {
	remaining := content
	certificateCount := 0
	privateKeyCount := 0
	for {
		block, rest := pem.Decode(remaining)
		if block == nil {
			break
		}
		remaining = rest
		switch block.Type {
		case "CERTIFICATE":
			if _, err := x509.ParseCertificate(block.Bytes); err != nil {
				return fmt.Errorf("certificate PEM 无法解析: %w", err)
			}
			certificateCount++
		case "PRIVATE KEY", "RSA PRIVATE KEY", "EC PRIVATE KEY", "DSA PRIVATE KEY":
			if err := parsePrivateKey(block); err != nil {
				return err
			}
			privateKeyCount++
		default:
			return fmt.Errorf("不支持的 PEM 块类型: %s", block.Type)
		}
	}
	if certificateCount == 0 && privateKeyCount == 0 {
		return errors.New("证书材料不包含有效 PEM 块")
	}
	if strings.Contains(strings.ToLower(filepath.Ext(path)), "key") && privateKeyCount == 0 {
		return errors.New("私钥路径未包含私钥 PEM")
	}
	if privateKeyCount == 0 && certificateCount == 0 {
		return errors.New("证书材料为空")
	}
	return nil
}

func parsePrivateKey(block *pem.Block) error {
	if _, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		return nil
	}
	if _, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return nil
	}
	if _, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
		return nil
	}
	return errors.New("私钥 PEM 无法解析")
}

func executeCertificateStoreInspect(ctx context.Context, operation agentPlanAction) (map[string]any, error) {
	store := stringValue(operation.Input, "store")
	if store == "" {
		store = "My"
	}
	if !v2ContainsString([]string{"My", "Root"}, store) {
		return nil, errors.New("certificate.store.inspect only supports My or Root")
	}
	command := exec.CommandContext(ctx, windowsSystem32Directory+`\certutil.exe`, "-store", store)
	command.Dir = windowsSystem32Directory
	command.Env = fixedWindowsEnvironment()
	if output, err := command.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("certutil -store failed: %w: %s", err, strings.TrimSpace(string(output)))
	}
	return map[string]any{"status": "SUCCEEDED", "store": store, "storeLocation": "LocalMachine", "verification": "certutil-store"}, nil
}

func executeFileReplace(ctx context.Context, operation agentPlanAction) error {
	if err := agentContextError(ctx); err != nil {
		return err
	}
	path := stringValue(operation.Input, "path")
	content, err := decodeOperationContent(operation.Input)
	if err != nil || path == "" || !isSafeWindowsAbsolutePath(path) {
		return errors.New("filesystem.atomic_replace requires an absolute path and base64 content")
	}
	if err := atomicWriteFile(path, content, 0o600); err != nil {
		return err
	}
	if err := agentContextError(ctx); err != nil {
		return unknownOperationError(fmt.Errorf("原子替换已完成但操作上下文已取消: %w", err))
	}
	return nil
}

func executeCertificateStoreInstall(ctx context.Context, operation agentPlanAction) (map[string]any, error) {
	if err := validateCertificateStoreInstallInput(operation.Input); err != nil {
		return nil, err
	}
	block, _ := pem.Decode([]byte(stringValue(operation.Input, "certificatePem")))
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, errors.New("certificate.store.install requires a certificate PEM")
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil || !certificate.IsCA {
		return nil, errors.New("certificate.store.install requires a CA certificate")
	}
	expected := strings.ToLower(strings.ReplaceAll(stringValue(operation.Input, "fingerprintSha256"), ":", ""))
	actual := sha256.Sum256(certificate.Raw)
	if hex.EncodeToString(actual[:]) != expected {
		return nil, errors.New("certificate.store.install fingerprint does not match certificate PEM")
	}
	temporary, err := os.CreateTemp(os.TempDir(), "gcac-root-*.cer")
	if err != nil {
		return nil, err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return nil, err
	}
	if _, err := temporary.Write(certificate.Raw); err != nil {
		temporary.Close()
		return nil, err
	}
	if err := temporary.Close(); err != nil {
		return nil, err
	}
	if err := agentContextError(ctx); err != nil {
		return nil, err
	}
	certutil := windowsSystem32Directory + `\certutil.exe`
	add := exec.CommandContext(ctx, certutil, "-addstore", "-f", "Root", temporaryPath)
	add.Dir = windowsSystem32Directory
	add.Env = fixedWindowsEnvironment()
	if output, err := add.CombinedOutput(); err != nil {
		return nil, commandExecutionError(fmt.Sprintf("certutil -addstore failed: %s", strings.TrimSpace(string(output))), err)
	}
	sha1Fingerprint := sha1.Sum(certificate.Raw)
	verify := exec.CommandContext(ctx, certutil, "-store", "Root", strings.ToUpper(hex.EncodeToString(sha1Fingerprint[:])))
	verify.Dir = windowsSystem32Directory
	verify.Env = fixedWindowsEnvironment()
	if output, err := verify.CombinedOutput(); err != nil {
		return nil, commandExecutionError(fmt.Sprintf("certutil -store verification failed: %s", strings.TrimSpace(string(output))), err)
	}
	return map[string]any{
		"store":             "root",
		"storeLocation":     "LocalMachine",
		"sha256Fingerprint": expected,
		"verification":      "certutil-store-sha1-and-pem-sha256",
	}, nil
}

func validateCertificateStoreInstallInput(input map[string]any) error {
	if len(input) != 3 || stringValue(input, "certificatePem") == "" || stringValue(input, "fingerprintSha256") == "" || stringValue(input, "store") != "root" {
		return errors.New("certificate.store.install input must contain certificatePem, fingerprintSha256 and store=root")
	}
	if strings.Count(stringValue(input, "certificatePem"), "BEGIN CERTIFICATE") != 1 {
		return errors.New("certificate.store.install certificatePem is invalid")
	}
	if fingerprint := strings.ToLower(strings.ReplaceAll(stringValue(input, "fingerprintSha256"), ":", "")); len(fingerprint) != sha256.Size*2 || !isHexDigest(fingerprint) {
		return errors.New("certificate.store.install fingerprintSha256 is invalid")
	}
	return nil
}

func validateIISBindingOperationInput(operationType string, input map[string]any) error {
	common := []string{"siteName", "bindingInformation", "storeName", "storeLocation", "bindingKey", "configFingerprint"}
	for _, key := range common {
		if stringValue(input, key) == "" {
			return fmt.Errorf("%s requires %s", operationType, key)
		}
	}
	if stringValue(input, "storeName") != "My" || stringValue(input, "storeLocation") != "LocalMachine" {
		return errors.New("IIS binding only supports LocalMachine\\My")
	}
	if !isSHA256Hex(stringValue(input, "configFingerprint")) || !isSHA256Hex(stringValue(input, "artifactDigest")) && operationType != "certificate.iis.binding.rollback" {
		return errors.New("IIS binding digest is invalid")
	}
	switch operationType {
	case "certificate.iis.binding.update":
		if len(input) != 10 {
			return errors.New("IIS binding update input contains unsupported fields")
		}
		pfx, err := base64.StdEncoding.DecodeString(stringValue(input, "pfxBase64"))
		if err != nil || len(pfx) == 0 || len(pfx) > 256*1024 {
			return errors.New("IIS binding update pfxBase64 is invalid")
		}
		if stringValue(input, "pfxPassword") == "" || len(stringValue(input, "pfxPassword")) > 1024 {
			return errors.New("IIS binding update pfxPassword is invalid")
		}
		if !isSHA256Hex(stringValue(input, "expectedFingerprintSha256")) || !isSHA256Hex(stringValue(input, "artifactDigest")) {
			return errors.New("IIS binding update fingerprint is invalid")
		}
	case "certificate.iis.binding.verify":
		if len(input) != 8 || !isSHA256Hex(stringValue(input, "expectedFingerprintSha256")) || !isSHA256Hex(stringValue(input, "artifactDigest")) {
			return errors.New("IIS binding verify input is invalid")
		}
	case "certificate.iis.binding.rollback":
		if len(input) != 7 || !isSHA1Hex(stringValue(input, "previousThumbprint")) {
			return errors.New("IIS binding rollback input is invalid")
		}
	default:
		return errors.New("unsupported IIS binding operation")
	}
	return nil
}

func isSHA1Hex(value string) bool {
	compact := strings.NewReplacer(":", "", " ", "").Replace(strings.TrimSpace(value))
	if len(compact) != sha1.Size*2 {
		return false
	}
	_, err := hex.DecodeString(compact)
	return err == nil
}

func executeIISBindingOperation(ctx context.Context, operation agentPlanAction, action string) (map[string]any, error) {
	if err := validateIISBindingOperationInput(operation.OperationType, operation.Input); err != nil {
		return nil, err
	}
	if err := agentContextError(ctx); err != nil {
		return nil, err
	}
	var pfxPath string
	if action == "update" {
		content, err := base64.StdEncoding.DecodeString(stringValue(operation.Input, "pfxBase64"))
		if err != nil {
			return nil, errors.New("IIS PFX 内容解码失败")
		}
		temporary, err := os.CreateTemp(os.TempDir(), "gcac-iis-*.pfx")
		if err != nil {
			return nil, err
		}
		pfxPath = temporary.Name()
		defer os.Remove(pfxPath)
		if err := temporary.Chmod(0o600); err != nil {
			_ = temporary.Close()
			return nil, err
		}
		if _, err := temporary.Write(content); err != nil {
			_ = temporary.Close()
			return nil, err
		}
		if err := temporary.Close(); err != nil {
			return nil, err
		}
	}
	environment := append(fixedWindowsEnvironment(),
		"GCAC_IIS_ACTION="+action,
		"GCAC_IIS_SITE_NAME="+stringValue(operation.Input, "siteName"),
		"GCAC_IIS_BINDING_INFORMATION="+stringValue(operation.Input, "bindingInformation"),
		"GCAC_IIS_EXPECTED_SHA256="+stringValue(operation.Input, "expectedFingerprintSha256"),
		"GCAC_IIS_CONFIG_SHA256="+stringValue(operation.Input, "configFingerprint"),
		"GCAC_IIS_PREVIOUS_THUMBPRINT="+strings.ReplaceAll(strings.ReplaceAll(stringValue(operation.Input, "previousThumbprint"), ":", ""), " ", ""),
		"GCAC_IIS_PFX_PATH="+pfxPath,
		"GCAC_IIS_PFX_PASSWORD="+stringValue(operation.Input, "pfxPassword"),
	)
	command := exec.CommandContext(ctx, windowsPowerShellPath, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", windowsIISBindingOperationScript)
	command.Dir = windowsSystem32Directory
	command.Env = environment
	output, err := command.CombinedOutput()
	if err != nil {
		wrapped := commandExecutionError("IIS binding operation failed", err)
		if action != "verify" && !operationResultUnknown(wrapped) {
			wrapped = unknownOperationError(wrapped)
		}
		return nil, wrapped
	}
	var detail map[string]any
	if err := json.Unmarshal(bytes.TrimSpace(output), &detail); err != nil {
		if action == "verify" {
			return nil, errors.New("IIS binding operation returned invalid JSON")
		}
		return nil, unknownOperationError(errors.New("IIS binding operation completed but result is unavailable"))
	}
	return detail, nil
}

const windowsIISBindingOperationScript = `$ErrorActionPreference = 'Stop'
$assemblyPath = Join-Path $env:SystemRoot 'System32\inetsrv\Microsoft.Web.Administration.dll'
if (Test-Path -LiteralPath $assemblyPath) { Add-Type -Path $assemblyPath } else { Add-Type -AssemblyName 'Microsoft.Web.Administration' }
$manager = New-Object Microsoft.Web.Administration.ServerManager
$site = $manager.Sites | Where-Object { $_.Name -ceq $env:GCAC_IIS_SITE_NAME } | Select-Object -First 1
if ($null -eq $site) { throw 'IIS site was not found' }
$binding = $site.Bindings | Where-Object { $_.Protocol -ieq 'https' -and $_.BindingInformation -ceq $env:GCAC_IIS_BINDING_INFORMATION } | Select-Object -First 1
if ($null -eq $binding) { throw 'IIS HTTPS binding was not found' }
$configPath = Join-Path $env:SystemRoot 'System32\inetsrv\config\applicationHost.config'
$configSha256 = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($env:GCAC_IIS_CONFIG_SHA256 -and $configSha256 -ne $env:GCAC_IIS_CONFIG_SHA256.ToLowerInvariant()) { throw 'IIS applicationHost.config fingerprint changed' }
function Get-Sha256([System.Security.Cryptography.X509Certificates.X509Certificate2] $certificate) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return ([System.BitConverter]::ToString($sha.ComputeHash($certificate.RawData))).Replace('-', '').ToLowerInvariant() } finally { $sha.Dispose() }
}
function Get-Certificate([byte[]] $hash, [string] $storeName) {
  if ($null -eq $hash -or $hash.Length -eq 0) { return $null }
  $thumbprint = ([System.BitConverter]::ToString($hash)).Replace('-', '')
  try { return Get-Item -LiteralPath ('Cert:\LocalMachine\' + $storeName + '\' + $thumbprint) -ErrorAction Stop } catch { return $null }
}
$previous = Get-Certificate $binding.CertificateHash $binding.CertificateStoreName
$action = $env:GCAC_IIS_ACTION
if ($action -eq 'update') {
  $securePassword = ConvertTo-SecureString $env:GCAC_IIS_PFX_PASSWORD -AsPlainText -Force
  $imported = Import-PfxCertificate -FilePath $env:GCAC_IIS_PFX_PATH -Password $securePassword -CertStoreLocation 'Cert:\LocalMachine\My' -Exportable
  $certificate = $imported | Where-Object { $_.HasPrivateKey } | Select-Object -First 1
  if ($null -eq $certificate) { $certificate = $imported | Select-Object -First 1 }
  if ($null -eq $certificate) { throw 'PFX did not contain a certificate' }
  $actualSha256 = Get-Sha256 $certificate
  if ($actualSha256 -ne $env:GCAC_IIS_EXPECTED_SHA256.ToLowerInvariant()) { throw 'PFX certificate fingerprint does not match expected fingerprint' }
  $binding.CertificateHash = $certificate.GetCertHash()
  $binding.CertificateStoreName = 'My'
  $manager.CommitChanges()
  [pscustomobject]@{ status = 'SUCCEEDED'; action = 'update'; certificateThumbprint = $certificate.Thumbprint; fingerprintSha256 = $actualSha256; previousThumbprint = if ($null -ne $previous) { $previous.Thumbprint } else { $null }; configFingerprint = $configSha256 } | ConvertTo-Json -Compress
  exit 0
}
if ($action -eq 'rollback') {
  $previousThumbprint = ($env:GCAC_IIS_PREVIOUS_THUMBPRINT -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
  $certificate = Get-Item -LiteralPath ('Cert:\LocalMachine\My\' + $previousThumbprint) -ErrorAction Stop
  $binding.CertificateHash = $certificate.GetCertHash()
  $binding.CertificateStoreName = 'My'
  $manager.CommitChanges()
  [pscustomobject]@{ status = 'SUCCEEDED'; action = 'rollback'; certificateThumbprint = $certificate.Thumbprint; fingerprintSha256 = Get-Sha256 $certificate; configFingerprint = $configSha256 } | ConvertTo-Json -Compress
  exit 0
}
$certificate = Get-Certificate $binding.CertificateHash $binding.CertificateStoreName
if ($null -eq $certificate) { throw 'IIS binding certificate was not found in the certificate store' }
$actualSha256 = Get-Sha256 $certificate
if ($actualSha256 -ne $env:GCAC_IIS_EXPECTED_SHA256.ToLowerInvariant()) { throw 'IIS binding certificate fingerprint does not match expected fingerprint' }
[pscustomobject]@{ status = 'SUCCEEDED'; action = 'verify'; certificateThumbprint = $certificate.Thumbprint; fingerprintSha256 = $actualSha256; configFingerprint = $configSha256 } | ConvertTo-Json -Compress`

func isHexDigest(value string) bool {
	_, err := hex.DecodeString(value)
	return err == nil
}
func executeAllowlistedService(ctx context.Context, operation agentPlanAction) error {
	service, verb := stringValue(operation.Input, "serviceName"), strings.TrimPrefix(operation.OperationType, "service.")
	if !validWindowsServiceName(service) || !v2ContainsString([]string{"start", "stop", "reload"}, verb) {
		return errors.New("service operation requires a fixed service and verb")
	}
	return runWindowsServiceCommand(ctx, verb, service)
}

// executeServiceRestart 是 Windows 服务生命周期的单一原语。
// 控制面只看到一个写操作，Agent 在本机完成停止、等待、启动和等待，避免
// stop/start 被拆成两个可被超时或重试打断的计划步骤。
func executeServiceRestart(ctx context.Context, operation agentPlanAction) (map[string]any, error) {
	service := stringValue(operation.Input, "serviceName")
	if !validWindowsServiceName(service) {
		return nil, errors.New("service.restart requires a fixed service name")
	}
	initialState, err := queryWindowsServiceState(ctx, service)
	if err != nil {
		return nil, err
	}
	detail := map[string]any{"serviceName": service, "initialState": initialState}
	if initialState != "running" && initialState != "stopped" {
		return detail, errors.New("service.restart requires a running or stopped service")
	}
	if initialState == "stopped" {
		detail["stopSkipped"] = true
	} else {
		if err := runWindowsServiceCommand(ctx, "stop", service); err != nil {
			detail["stopError"] = err.Error()
			if recoveryErr := recoverWindowsService(service); recoveryErr == nil {
				detail["recovered"] = true
				return detail, unknownOperationError(errors.New("service.restart 停止结果不明，服务已恢复运行"))
			}
			return detail, unknownOperationError(fmt.Errorf("service.restart 停止失败: %w", err))
		}
		detail["stopCommand"] = "succeeded"
		if err := waitForWindowsServiceState(ctx, service, "stopped"); err != nil {
			detail["stopWaitError"] = err.Error()
			if recoveryErr := recoverWindowsService(service); recoveryErr == nil {
				detail["recovered"] = true
				return detail, unknownOperationError(errors.New("service.restart 停止等待超时，服务已恢复运行"))
			}
			return detail, unknownOperationError(fmt.Errorf("service.restart 等待服务停止失败: %w", err))
		}
		detail["stopped"] = true
	}
	if err := runWindowsServiceCommand(ctx, "start", service); err != nil {
		detail["startError"] = err.Error()
		if recoveryErr := recoverWindowsService(service); recoveryErr == nil {
			detail["recovered"] = true
			return detail, unknownOperationError(errors.New("service.restart 启动结果不明，服务已恢复运行"))
		}
		return detail, unknownOperationError(fmt.Errorf("service.restart 启动失败: %w", err))
	}
	detail["startCommand"] = "succeeded"
	if err := waitForWindowsServiceState(ctx, service, "running"); err != nil {
		detail["startWaitError"] = err.Error()
		if recoveryErr := recoverWindowsService(service); recoveryErr == nil {
			detail["recovered"] = true
			return detail, unknownOperationError(errors.New("service.restart 启动等待超时，服务已恢复运行"))
		}
		return detail, unknownOperationError(fmt.Errorf("service.restart 等待服务运行失败: %w", err))
	}
	detail["running"] = true
	return detail, nil
}

func runWindowsServiceCommand(ctx context.Context, verb, service string) error {
	command := exec.CommandContext(ctx, windowsSystemControlPath, verb, service)
	command.Dir = windowsSystem32Directory
	command.Env = fixedWindowsEnvironment()
	if err := command.Run(); err != nil {
		return commandExecutionError(fmt.Sprintf("service %s %s failed", verb, service), err)
	}
	return nil
}

func queryWindowsServiceState(ctx context.Context, service string) (string, error) {
	if !validWindowsServiceName(service) {
		return "", errors.New("service.status requires a fixed service name")
	}
	query := exec.CommandContext(ctx, windowsSystemControlPath, "query", service)
	query.Dir = windowsSystem32Directory
	query.Env = fixedWindowsEnvironment()
	output, err := query.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("sc.exe query failed: %w", err)
	}
	upper := strings.ToUpper(string(output))
	switch {
	case strings.Contains(upper, "RUNNING"):
		return "running", nil
	case strings.Contains(upper, "STOPPED"):
		return "stopped", nil
	case strings.Contains(upper, "PAUSED"):
		return "paused", nil
	default:
		return "unknown", nil
	}
}

func waitForWindowsServiceState(ctx context.Context, service, expected string) error {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		state, err := queryWindowsServiceState(ctx, service)
		if err != nil {
			return err
		}
		if state == expected {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
		}
	}
}

// 恢复动作使用独立的短超时，确保 restart 自身超时或上游取消后不会把服务留在 stopped。
func recoverWindowsService(service string) error {
	recoveryCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := runWindowsServiceCommand(recoveryCtx, "start", service); err != nil {
		state, queryErr := queryWindowsServiceState(recoveryCtx, service)
		if queryErr == nil && state == "running" {
			return nil
		}
		return err
	}
	return waitForWindowsServiceState(recoveryCtx, service, "running")
}

func executeAllowlistedProgram(ctx context.Context, operation agentPlanAction) error {
	if err := validateAllowlistedCommandInput(operation); err != nil {
		return err
	}
	workingDirectory := stringValue(operation.Input, "workingDirectory")
	program := stringValue(operation.Input, "executablePath")
	args, _ := stringArrayValue(operation.Input, "args")
	command := exec.CommandContext(ctx, program, args...)
	command.Dir = workingDirectory
	command.Env = fixedWindowsEnvironment()
	if err := command.Run(); err != nil {
		return commandExecutionError("allowlisted command failed", err)
	}
	return nil
}

const (
	windowsSystem32Directory = `C:\Windows\System32`
	windowsSystemControlPath = windowsSystem32Directory + `\sc.exe`
	windowsPowerShellPath    = windowsSystem32Directory + `\WindowsPowerShell\v1.0\powershell.exe`
)

func validateAllowlistedCommandInput(operation agentPlanAction) error {
	input := operation.Input
	program := stringValue(input, "executablePath")
	if !isSafeWindowsAbsolutePath(program) {
		return errors.New("allowlisted command executable path must be absolute and cannot contain parent traversal")
	}
	if err := verifyExecutableSha256(program, stringValue(input, "executableSha256")); err != nil {
		return err
	}
	if err := validateWindowsWorkingDirectory(stringValue(input, "workingDirectory")); err != nil {
		return err
	}
	args, err := stringArrayValue(input, "args")
	if err != nil || !validAllowlistedCommandArgs(args) {
		return errors.New("allowlisted command args do not match the declared template")
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
	if len(args) == 0 || len(args) != len(template) {
		return false
	}
	for index, expected := range template {
		if expected == args[index] {
			continue
		}
		switch expected {
		case "{verb}":
			if !v2ContainsString([]string{"start", "stop", "query", "reload", "restart"}, args[index]) {
				return false
			}
		case "{serviceName}":
			if !validWindowsServiceName(args[index]) {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func validateAllowlistedCommandScope(input map[string]any, allowedPaths, allowedDigests []string) error {
	for _, field := range []string{"executablePath", "workingDirectory"} {
		value := stringValue(input, field)
		if value == "" || !pathScopeContains(allowedPaths, value) {
			return fmt.Errorf("allowlisted command %s is outside token scope", field)
		}
	}
	if digest := stringValue(input, "executableSha256"); digest == "" || !v2ContainsString(allowedDigests, digest) {
		return errors.New("allowlisted command executable is outside token scope")
	}
	return nil
}

func validAllowlistedCommandArgs(args []string) bool {
	if len(args) == 0 || len(args) > 32 {
		return false
	}
	for _, arg := range args {
		if strings.TrimSpace(arg) == "" || strings.IndexByte(arg, 0) >= 0 || strings.ContainsAny(arg, "\r\n;&|<>`$()") {
			return false
		}
	}
	return true
}

func isSafeWindowsAbsolutePath(value string) bool {
	if value == "" || strings.IndexByte(value, 0) >= 0 || hasParentPathSegment(value) {
		return false
	}
	if filepath.IsAbs(value) || strings.HasPrefix(value, `\\`) {
		return true
	}
	return len(value) >= 3 && ((value[0] >= 'a' && value[0] <= 'z') || (value[0] >= 'A' && value[0] <= 'Z')) && value[1] == ':' && (value[2] == '\\' || value[2] == '/')
}

func validateWindowsWorkingDirectory(value string) error {
	if !isSafeWindowsAbsolutePath(value) {
		return errors.New("allowlisted command working directory must be absolute and cannot contain parent traversal")
	}
	info, err := os.Stat(value)
	if err != nil || !info.IsDir() {
		return errors.New("allowlisted command working directory is unavailable")
	}
	return nil
}

func hasParentPathSegment(value string) bool {
	for _, segment := range strings.FieldsFunc(value, func(r rune) bool { return r == '\\' || r == '/' }) {
		if segment == ".." {
			return true
		}
	}
	return false
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
	// digest 和 signature 不属于摘要输入。Go 结构体字段即使为空也会被
	// json.Marshal 输出，因此不能像普通字段那样把它们置空后直接序列化；
	// 控制面合同要求这两个字段从摘要对象中完全移除。
	receiptPayload := agentReceiptWithoutDigest(receipt)
	canonical := canonicalJSON(receiptPayload)
	if len(canonical) == 0 {
		return "", errors.New("receipt cannot be canonicalized")
	}
	digest := sha256.Sum256(canonical)
	return hex.EncodeToString(digest[:]), nil
}

func agentReceiptWithoutDigest(receipt AgentExecutionReceiptV1) map[string]any {
	raw, _ := json.Marshal(receipt)
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	delete(result, "digest")
	delete(result, "signature")
	return result
}

func agentReceiptWithoutSignature(receipt AgentExecutionReceiptV1) map[string]any {
	receipt.Signature = ""
	raw, _ := json.Marshal(receipt)
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	delete(result, "signature")
	return result
}

func loadAgentReceiptSigner(configs ...*AgentConfig) (agentReceiptSigner, error) {
	config := firstAgentConfig(configs)
	if config != nil {
		return loadPersistentAgentReceiptSigner(config)
	}
	return loadEnvironmentAgentReceiptSigner()
}

func loadEnvironmentAgentReceiptSigner() (agentReceiptSigner, error) {
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

func loadPersistentAgentReceiptSigner(config *AgentConfig) (agentReceiptSigner, error) {
	keyID, signingKeyPath, keySetPath, err := resolveReceiptSignerPaths(config)
	if err != nil {
		return agentReceiptSigner{}, err
	}
	agentReceiptSignerMu.Lock()
	defer agentReceiptSignerMu.Unlock()

	privateBytes, privateErr := os.ReadFile(signingKeyPath)
	keySetBytes, keySetErr := os.ReadFile(keySetPath)
	if os.IsNotExist(privateErr) && os.IsNotExist(keySetErr) {
		privateBytes, keySetBytes, keyID, err = generatePersistentReceiptSigner(keyID, signingKeyPath, keySetPath)
		if err != nil {
			return agentReceiptSigner{}, err
		}
	} else if privateErr != nil || keySetErr != nil {
		return agentReceiptSigner{}, errors.New("Agent 回执签名材料不完整，失败关闭")
	}
	if len(privateBytes) != ed25519.PrivateKeySize {
		return agentReceiptSigner{}, errors.New("Agent 回执签名私钥不可用，失败关闭")
	}
	privateKey := ed25519.PrivateKey(append([]byte(nil), privateBytes...))
	if keyID == "" {
		keyID, err = resolvePersistedReceiptKeyID(privateKey.Public().(ed25519.PublicKey), keySetBytes)
		if err != nil {
			return agentReceiptSigner{}, err
		}
	}
	if isDevelopmentKeyID(keyID) {
		return agentReceiptSigner{}, errors.New("Agent 回执签名 KeyId 未配置或属于开发密钥")
	}
	if err := verifyReceiptPublicKeyFromBytes(keyID, privateKey.Public().(ed25519.PublicKey), keySetBytes); err != nil {
		return agentReceiptSigner{}, err
	}
	return agentReceiptSigner{KeyID: keyID, PrivateKey: privateKey}, nil
}

// 当 Agent 配置没有保存 receiptKeyId 时，从本机持久化 KeySet 反查私钥对应的唯一 KeyId。
// 只接受唯一匹配，避免在 KeySet 损坏或出现歧义时误用错误的生产身份。
func resolvePersistedReceiptKeyID(publicKey ed25519.PublicKey, raw []byte) (string, error) {
	if len(bytes.TrimSpace(raw)) == 0 {
		return "", errors.New("Agent 回执受信 KeySet 不可用，失败关闭")
	}
	var keySet map[string]string
	if err := json.Unmarshal(raw, &keySet); err != nil {
		return "", errors.New("Agent 回执受信 KeySet 无效")
	}
	if len(keySet) == 0 {
		return "", errors.New("Agent 回执签名 KeyId 未被受信 KeySet 登记")
	}
	matches := make([]string, 0, 1)
	for keyID, encoded := range keySet {
		keyID = strings.TrimSpace(keyID)
		if keyID == "" {
			continue
		}
		candidate, err := base64.StdEncoding.DecodeString(strings.TrimSpace(encoded))
		if err != nil || len(candidate) != ed25519.PublicKeySize {
			return "", errors.New("Agent 回执受信 KeySet 无效")
		}
		if bytes.Equal(candidate, publicKey) {
			matches = append(matches, keyID)
		}
	}
	if len(matches) != 1 {
		return "", errors.New("Agent 回执签名 KeyId 必须在受信 KeySet 中唯一匹配")
	}
	return matches[0], nil
}

func resolveReceiptSignerPaths(config *AgentConfig) (string, string, string, error) {
	if config == nil {
		return "", "", "", errors.New("Agent 配置不可用，无法加载 Receipt 签名材料")
	}
	dataDir := strings.TrimSpace(config.Paths.Windows.DataDir)
	signingKeyPath := strings.TrimSpace(config.ReceiptSigningKeyPath)
	keySetPath := strings.TrimSpace(config.ReceiptKeySetPath)
	if signingKeyPath == "" {
		if dataDir == "" {
			return "", "", "", errors.New("Agent Receipt 签名私钥路径未配置")
		}
		signingKeyPath = filepath.Join(dataDir, "policy", "agent-receipt-signing-key.bin")
	}
	if keySetPath == "" {
		if dataDir == "" {
			return "", "", "", errors.New("Agent Receipt KeySet 路径未配置")
		}
		keySetPath = filepath.Join(dataDir, "policy", "agent-receipt-keyset.json")
	}
	if !filepath.IsAbs(signingKeyPath) || !filepath.IsAbs(keySetPath) {
		return "", "", "", errors.New("Agent Receipt 签名材料路径必须是绝对路径")
	}
	keyID := strings.TrimSpace(config.ReceiptKeyID)
	if keyID != "" && isDevelopmentKeyID(keyID) {
		return "", "", "", errors.New("Agent 回执签名 KeyId 未配置或属于开发密钥")
	}
	return keyID, signingKeyPath, keySetPath, nil
}

func generatePersistentReceiptSigner(configuredKeyID, signingKeyPath, keySetPath string) ([]byte, []byte, string, error) {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, "", fmt.Errorf("生成 Agent 回执签名密钥失败: %w", err)
	}
	keyID := strings.TrimSpace(configuredKeyID)
	if keyID == "" {
		digest := sha256.Sum256(publicKey)
		keyID = "agent-receipt-" + hex.EncodeToString(digest[:])[:16]
	}
	if isDevelopmentKeyID(keyID) {
		return nil, nil, "", errors.New("Agent 回执签名 KeyId 未配置或属于开发密钥")
	}
	keySetBytes, err := json.Marshal(map[string]string{keyID: base64.StdEncoding.EncodeToString(publicKey)})
	if err != nil {
		return nil, nil, "", errors.New("Agent 回执受信 KeySet 编码失败")
	}
	if err := atomicWriteFile(signingKeyPath, privateKey, 0o600); err != nil {
		return nil, nil, "", fmt.Errorf("写入 Agent 回执签名私钥失败: %w", err)
	}
	if err := atomicWriteFile(keySetPath, append(keySetBytes, '\n'), 0o600); err != nil {
		return nil, nil, "", fmt.Errorf("写入 Agent 回执受信 KeySet 失败: %w", err)
	}
	return privateKey, keySetBytes, keyID, nil
}

func verifyReceiptPublicKey(keyID string, expected ed25519.PublicKey) error {
	raw := strings.TrimSpace(os.Getenv("GCAC_AGENT_RECEIPT_KEYSET_JSON"))
	if raw == "" {
		return errors.New("Agent 回执受信 KeySet 不可用，失败关闭")
	}
	return verifyReceiptPublicKeyFromBytes(keyID, expected, []byte(raw))
}

func verifyReceiptPublicKeyFromBytes(keyID string, expected ed25519.PublicKey, raw []byte) error {
	if len(bytes.TrimSpace(raw)) == 0 {
		return errors.New("Agent 回执受信 KeySet 不可用，失败关闭")
	}
	var keySet map[string]string
	if err := json.Unmarshal(raw, &keySet); err != nil {
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
			for _, field := range []string{"executablePath", "workingDirectory"} {
				value := stringValue(operation.Input, field)
				if value == "" || !pathScopeContains(policy.AllowedPaths, value) {
					return fmt.Errorf("allowlisted command %s is denied by local policy", field)
				}
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

// v2StringValue 是本地证书动作与既有 v2 合同之间的兼容别名。
func v2StringValue(values map[string]any, key string) string {
	return stringValue(values, key)
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
	// 统一复用平台原子替换实现。平台实现只在确认替换已经发生或无法确认时
	// 返回 UNKNOWN；普通 API 失败必须保留为确定性 FAILED，不能在这里统一升级。
	if err := replaceAtomicFile(temporaryPath, path); err != nil {
		return err
	}
	return nil
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
			progressCtx := context.WithValue(execution.ctx, agentPlanProgressContextKey{}, agentPlanProgressFunc(func(operation agentPlanAction, status string, errorMessage string) {
				if errorMessage == "" {
					execution.submitLog("info", "Agent 操作进度 operationId=%s operationType=%s stage=%s status=%s", operation.OperationID, operation.OperationType, operation.Stage, status)
					return
				}
				execution.submitLog("error", "Agent 操作进度 operationId=%s operationType=%s stage=%s status=%s error=%s", operation.OperationID, operation.OperationType, operation.Stage, status, errorMessage)
			}))
			success, code, message, detail := executeAgentV2(progressCtx, payload, agentID, execution.config)
			return actionExecutionResult{Success: success, ErrorCode: code, ErrorMessage: message, Detail: detail}
		},
	}
}
