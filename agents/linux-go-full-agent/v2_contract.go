package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
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

// Agent v2 是 Agent Core 的长期协议边界。除这四个动作外，控制面任务一律拒绝。
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
	maxPlanMessageBytes       = 1 << 20
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
	Plan            agentPlanV2               `json:"plan"`
	Receipt         *AgentExecutionReceiptV1  `json:"receipt,omitempty"`
}

func executeAgentV2(ctx context.Context, request map[string]any, agentID string) (bool, string, string, map[string]any) {
	// 重新发现标记和操作者是控制面调度元数据，不属于签名 Agent v2 载荷。
	// 只在进入严格合同前移除这两个已声明的外层字段，其他未知字段仍会失败关闭。
	encoded, err := json.Marshal(agentV2ContractPayload(request))
	if err != nil || len(encoded) > maxPlanMessageBytes {
		return false, "AGENT_V2_MESSAGE_INVALID", "Agent v2 请求过大或无法编码", nil
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
	switch strings.TrimSpace(envelope.Action) {
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
		return false, "AGENT_V2_ACTION_UNSUPPORTED", "Agent v2 动作不在长期合同内", map[string]any{"action": envelope.Action}
	}
}

func validateAgentV2Request(request agentV2Request, agentID string) error {
	if !containsString([]string{agentFactCollect, agentPlanValidate, agentPlanExecute, agentExecutionReceipt}, request.Action) {
		return errors.New("action is not part of Agent v2 contract")
	}
	if strings.TrimSpace(request.RequestID) == "" || strings.TrimSpace(request.AgentID) == "" || strings.TrimSpace(request.TenantID) == "" || strings.TrimSpace(request.PluginID) == "" || strings.TrimSpace(request.PluginVersion) == "" || strings.TrimSpace(request.Capability) == "" {
		return errors.New("requestId, agent, tenant, plugin and capability bindings are required")
	}
	if strings.TrimSpace(agentID) == "" || request.AgentID != agentID {
		return errors.New("agent identity does not match request")
	}
	if err := validateCapabilityToken(request.Token, request.PolicyDecision, request); err != nil {
		return err
	}
	if request.Action == agentPlanValidate || request.Action == agentPlanExecute {
		if request.Plan.PlanVersion == "" || request.Plan.PlanID == "" || request.Plan.PlanDigest == "" {
			return errors.New("planVersion, planId and planDigest are required")
		}
		if request.Plan.PlanDigest != request.Token.PlanDigest {
			return errors.New("planDigest does not match capability token")
		}
		if err := validateAgentPlan(request.Plan, request.Token); err != nil {
			return err
		}
		if err := validateAgentPlanAuthorization(request.Plan, request.PolicyDecision); err != nil {
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
	collectedAt := time.Now().UTC().Format(time.RFC3339Nano)
	facts := make([]map[string]any, 0, 16)
	warnings := make([]string, 0)
	facts = append(facts, collectLinuxProcesses()...)
	facts = append(facts, collectLinuxServices(ctx, request.Services)...)
	facts = append(facts, collectLinuxFiles(request.Paths)...)
	ports := collectLinuxListeningPorts()
	if len(ports) == 0 {
		warnings = append(warnings, "未发现可读取的监听端口")
	}
	facts = append(facts, ports...)
	facts = append(facts, map[string]any{
		"kind":      "privilege",
		"principal": linuxPrincipal(),
		"elevated":  os.Geteuid() == 0,
		"groups":    collectLinuxGroups(),
	})
	facts = append(facts, collectLinuxCertificateStores()...)
	envelope := map[string]any{
		"contractVersion": agentSecurityContract,
		"factId":          request.RequestID,
		"agentId":         request.AgentID,
		"tenantId":        request.TenantID,
		"collectedAt":     collectedAt,
		"ttlSeconds":      300,
		"source":          "linux",
		"facts":           facts,
		"warnings":        warnings,
	}
	digest, err := computeAgentFactDigest(envelope)
	if err != nil {
		return false, "AGENT_FACT_COLLECTION_FAILED", "通用事实摘要生成失败", nil
	}
	envelope["digest"] = digest
	return true, "", "", map[string]any{"factEnvelope": envelope}
}

func collectLinuxProcesses() []map[string]any {
	entries, err := os.ReadDir("/proc")
	if err != nil {
		return []map[string]any{}
	}
	processes := make([]map[string]any, 0, 128)
	for _, entry := range entries {
		pid, err := strconv.Atoi(entry.Name())
		if err != nil || pid < 1 {
			continue
		}
		executablePath, err := os.Readlink(filepath.Join("/proc", entry.Name(), "exe"))
		if err != nil || !filepath.IsAbs(executablePath) {
			continue
		}
		process := map[string]any{"kind": "process", "pid": pid, "executablePath": executablePath}
		if commandLine, commandErr := os.ReadFile(filepath.Join("/proc", entry.Name(), "cmdline")); commandErr == nil && len(commandLine) > 0 {
			text := strings.TrimSpace(strings.ReplaceAll(string(commandLine), "\x00", " "))
			if len(text) > 4096 {
				text = text[:4096]
			}
			if text != "" && !containsSensitiveCommandLine(text) {
				process["commandLine"] = text
			}
		}
		processes = append(processes, process)
		if len(processes) >= 1000 {
			break
		}
	}
	sort.Slice(processes, func(left, right int) bool {
		return processes[left]["pid"].(int) < processes[right]["pid"].(int)
	})
	return processes
}

func containsSensitiveCommandLine(value string) bool {
	lower := strings.ToLower(value)
	for _, marker := range []string{"password=", "passwd=", "token=", "secret=", "private_key="} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	return false
}

func collectLinuxServices(ctx context.Context, names []string) []map[string]any {
	if len(names) == 0 {
		names = []string{"agent-core"}
	}
	services := make([]map[string]any, 0, len(names))
	program, err := resolveLinuxSystemctl()
	for _, name := range names {
		item := map[string]any{"kind": "service", "name": name, "status": "unknown"}
		if err != nil || !validLinuxServiceName(name) {
			services = append(services, item)
			continue
		}
		command := exec.CommandContext(ctx, program, "is-active", name)
		command.Dir = "/"
		command.Env = []string{"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
		output, commandErr := command.Output()
		status := strings.TrimSpace(string(output))
		if commandErr != nil || status == "" {
			status = "unknown"
		} else if status == "active" {
			status = "running"
		} else if status == "inactive" {
			status = "stopped"
		} else {
			status = "unknown"
		}
		item["status"] = status
		services = append(services, item)
	}
	return services
}

func collectLinuxFiles(paths []string) []map[string]any {
	if len(paths) == 0 {
		paths = []string{"/etc/hosts"}
	}
	files := make([]map[string]any, 0, len(paths))
	for _, path := range paths {
		if !filepath.IsAbs(path) {
			continue
		}
		if info, statErr := os.Stat(path); statErr == nil && info.IsDir() {
			_ = filepath.WalkDir(path, func(candidate string, entry os.DirEntry, walkErr error) error {
				if walkErr != nil || entry == nil {
					return nil
				}
				if entry.IsDir() {
					if candidate != path && strings.Count(strings.TrimPrefix(candidate, path), string(os.PathSeparator)) > 4 {
						return filepath.SkipDir
					}
					return nil
				}
				ext := strings.ToLower(filepath.Ext(candidate))
				if ext != ".conf" && ext != ".xml" && ext != ".properties" && ext != ".config" {
					return nil
				}
				if len(files) >= 512 {
					return filepath.SkipDir
				}
				files = append(files, collectLinuxFile(candidate))
				return nil
			})
			continue
		}
		files = append(files, collectLinuxFile(path))
	}
	return files
}

func collectLinuxFile(path string) map[string]any {
	item := map[string]any{"kind": "file_stat", "path": path, "exists": false, "sizeBytes": 0}
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
		if content, readErr := os.ReadFile(path); readErr == nil {
			const maximumFileContentBytes = 64 * 1024
			truncated := len(content) > maximumFileContentBytes
			if truncated {
				content = content[:maximumFileContentBytes]
			}
			item = map[string]any{
				"kind":          "file_content",
				"path":          path,
				"contentBase64": base64.StdEncoding.EncodeToString(content),
				"bytesRead":     len(content),
				"truncated":     truncated,
				"sha256":        sha256Bytes(content),
			}
		}
	}
	return item
}

func sha256Bytes(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func collectLinuxListeningPorts() []map[string]any {
	ports := make([]map[string]any, 0, 128)
	for _, source := range []struct {
		path     string
		protocol string
		address  string
	}{
		{path: "/proc/net/tcp", protocol: "tcp", address: "0.0.0.0"},
		{path: "/proc/net/tcp6", protocol: "tcp", address: "::"},
	} {
		file, err := os.Open(source.path)
		if err != nil {
			continue
		}
		scanner := bufio.NewScanner(file)
		first := true
		for scanner.Scan() {
			if first {
				first = false
				continue
			}
			fields := strings.Fields(scanner.Text())
			if len(fields) < 4 || fields[3] != "0A" {
				continue
			}
			portText := fields[1]
			separator := strings.LastIndexByte(portText, ':')
			if separator < 0 {
				continue
			}
			port, err := strconv.ParseInt(portText[separator+1:], 16, 32)
			if err != nil {
				continue
			}
			ports = append(ports, map[string]any{"kind": "listening_port", "address": source.address, "port": int(port), "protocol": source.protocol})
			if len(ports) >= 1000 {
				break
			}
		}
		_ = file.Close()
		if len(ports) >= 1000 {
			break
		}
	}
	return ports
}

func collectLinuxGroups() []string {
	groups, err := os.Getgroups()
	if err != nil {
		return []string{}
	}
	sort.Ints(groups)
	result := make([]string, 0, len(groups))
	for _, group := range groups {
		result = append(result, strconv.Itoa(group))
	}
	return result
}

func collectLinuxCertificateStores() []map[string]any {
	stores := make([]map[string]any, 0, 4)
	for _, path := range []string{"/etc/ssl/certs", "/etc/pki/tls/certs", "/etc/ca-certificates"} {
		entries, err := os.ReadDir(path)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if entry.IsDir() || !(strings.HasSuffix(strings.ToLower(entry.Name()), ".pem") || strings.HasSuffix(strings.ToLower(entry.Name()), ".crt")) {
				continue
			}
			encoded, err := os.ReadFile(filepath.Join(path, entry.Name()))
			block, _ := pem.Decode(encoded)
			if err != nil || block == nil || block.Type != "CERTIFICATE" {
				continue
			}
			certificate, err := x509.ParseCertificate(block.Bytes)
			if err != nil {
				continue
			}
			thumbprint := sha256.Sum256(block.Bytes)
			fingerprint := hex.EncodeToString(thumbprint[:])
			stores = append(stores, map[string]any{"kind": "certificate_store", "store": "linux-system-trust", "subject": certificate.Subject.String(), "sha256Fingerprint": fingerprint, "thumbprint": fingerprint, "notAfter": certificate.NotAfter.UTC().Format(time.RFC3339Nano), "hasPrivateKey": false})
			if len(stores) >= 100 {
				return stores
			}
		}
	}
	if len(stores) == 0 {
		return []map[string]any{{"kind": "certificate_store", "store": "linux-system-trust", "subject": "unavailable", "thumbprint": "unavailable", "hasPrivateKey": false}}
	}
	return stores
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
		if !containsString(token.Actions, operation.OperationType) {
			return fmt.Errorf("Token 未授权 Agent 操作: %s", operation.OperationType)
		}
		if path := v2StringValue(operation.Input, "path"); path != "" && !pathScopeContains(token.AllowedPaths, path) {
			return fmt.Errorf("operation path is outside token scope: %s", path)
		}
		if service := v2StringValue(operation.Input, "serviceName"); service != "" && !scopeContains(token.AllowedServices, service) {
			return fmt.Errorf("operation service is outside token scope: %s", service)
		}
		if operation.OperationType == "command.execute_allowlisted" {
			if err := validateAllowlistedCommandScope(operation.Input, token.AllowedPaths, token.ArtifactDigests); err != nil {
				return err
			}
		}
		if artifact := v2StringValue(operation.Input, "artifactDigest"); artifact != "" && !containsString(token.ArtifactDigests, artifact) {
			return errors.New("operation artifact is outside token scope")
		}
	}
	return nil
}

func validateAgentPlanAuthorization(plan agentPlanV2, decision PolicyAuthorityDecisionV1) error {
	for _, operation := range plan.Operations {
		if !containsString(decision.Actions, operation.OperationType) {
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
	if strings.TrimSpace(operation.OperationID) == "" || strings.TrimSpace(operation.IdempotencyKey) == "" {
		return errors.New("operationId and idempotencyKey are required")
	}
	if !containsString([]string{"prepare", "execute", "verify", "compensate"}, operation.Stage) {
		return fmt.Errorf("unsupported plan stage: %s", operation.Stage)
	}
	if operation.TimeoutSeconds < 1 || operation.TimeoutSeconds > 3600 {
		return errors.New("timeoutSeconds is outside the allowed range")
	}
	if operation.Input == nil {
		return errors.New("operation input is required")
	}
	if !containsString([]string{"process.list", "service.list", "service.status", "filesystem.stat", "filesystem.read", "filesystem.backup", "filesystem.atomic_replace", "filesystem.restore", "certificate.material.validate", "certificate.store.inspect", "certificate.store.install", "service.start", "service.stop", "service.reload", "command.execute_allowlisted"}, operation.OperationType) {
		return fmt.Errorf("unsupported Agent operation: %s", operation.OperationType)
	}
	if strings.HasPrefix(operation.OperationType, "service.") && v2StringValue(operation.Input, "serviceName") == "" {
		return errors.New("service operation requires serviceName")
	}
	if operation.OperationType == "certificate.store.install" {
		return validateCertificateStoreInstallInput(operation.Input)
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
		started := time.Now()
		result := map[string]any{"operationId": operation.OperationID, "operationType": operation.OperationType, "stage": operation.Stage, "status": "SUCCEEDED"}
		operationCtx, cancel := context.WithTimeout(ctx, time.Duration(operation.TimeoutSeconds)*time.Second)
		var err error
		if err = agentContextError(operationCtx); err == nil {
			switch operation.OperationType {
			case "filesystem.atomic_replace":
				err = executeFileReplace(operationCtx, operation)
			case "certificate.store.install":
				err = executeCertificateStoreInstall(operationCtx, operation)
			case "filesystem.restore":
				err = errors.New("filesystem.restore requires a signed checkpoint and is not available without one")
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
			result["finishedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
			result["durationMs"] = time.Since(started).Milliseconds()
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
		result["finishedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
		result["durationMs"] = time.Since(started).Milliseconds()
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
		if operationID := v2StringValue(results[index], "operationId"); operationID != "" {
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
		if containsString([]string{"filesystem.atomic_replace", "filesystem.restore", "certificate.store.install", "service.start", "service.stop", "service.reload", "command.execute_allowlisted"}, operation.OperationType) {
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
	if !containsString([]string{"SUCCESS", "FAILED", "UNKNOWN", "CANCELLED"}, receipt.Status) {
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
	path := v2StringValue(operation.Input, "path")
	content, err := base64.StdEncoding.DecodeString(v2StringValue(operation.Input, "contentBase64"))
	if err != nil || path == "" || !filepath.IsAbs(path) {
		return errors.New("file.atomic_replace requires an absolute path and base64 content")
	}
	if err := atomicWriteFile(path, content, 0o600); err != nil {
		return err
	}
	return agentContextError(ctx)
}

func executeCertificateStoreInstall(ctx context.Context, operation agentPlanAction) error {
	if err := validateCertificateStoreInstallInput(operation.Input); err != nil {
		return err
	}
	block, _ := pem.Decode([]byte(v2StringValue(operation.Input, "certificatePem")))
	if block == nil || block.Type != "CERTIFICATE" {
		return errors.New("certificate.store.install requires a certificate PEM")
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil || !certificate.IsCA {
		return errors.New("certificate.store.install requires a CA certificate")
	}
	expected := strings.ToLower(strings.ReplaceAll(v2StringValue(operation.Input, "fingerprintSha256"), ":", ""))
	actual := sha256.Sum256(certificate.Raw)
	if hex.EncodeToString(actual[:]) != expected {
		return errors.New("certificate.store.install fingerprint does not match certificate PEM")
	}
	if err := agentContextError(ctx); err != nil {
		return err
	}
	type trustLayout struct {
		anchorDir string
		refresh   string
		bundle    string
		args      []string
	}
	layouts := []trustLayout{
		{anchorDir: "/usr/local/share/ca-certificates", refresh: "/usr/sbin/update-ca-certificates", bundle: "/etc/ssl/certs/ca-certificates.crt"},
		{anchorDir: "/etc/pki/ca-trust/source/anchors", refresh: "/usr/bin/update-ca-trust", bundle: "/etc/pki/tls/certs/ca-bundle.crt", args: []string{"extract"}},
	}
	var selected *trustLayout
	for index := range layouts {
		candidate := &layouts[index]
		if directoryExists(candidate.anchorDir) && executableExists(candidate.refresh) {
			selected = candidate
			break
		}
	}
	if selected == nil {
		return errors.New("no supported Linux system trust store refresh flow is available")
	}
	anchorPath := filepath.Join(selected.anchorDir, "gcac-"+expected+".crt")
	if err := atomicWriteFile(anchorPath, []byte(v2StringValue(operation.Input, "certificatePem")), 0o644); err != nil {
		return err
	}
	refresh := exec.CommandContext(ctx, selected.refresh, selected.args...)
	refresh.Dir = "/"
	refresh.Env = []string{"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
	if output, err := refresh.CombinedOutput(); err != nil {
		return fmt.Errorf("system trust refresh failed: %w: %s", err, strings.TrimSpace(string(output)))
	}
	if !systemTrustBundleContains(selected.bundle, expected) {
		return errors.New("system trust refresh completed but SHA-256 certificate verification failed")
	}
	return nil
}

func validateCertificateStoreInstallInput(input map[string]any) error {
	if len(input) != 3 || v2StringValue(input, "certificatePem") == "" || v2StringValue(input, "fingerprintSha256") == "" || v2StringValue(input, "store") != "root" {
		return errors.New("certificate.store.install input must contain certificatePem, fingerprintSha256 and store=root")
	}
	if strings.Count(v2StringValue(input, "certificatePem"), "BEGIN CERTIFICATE") != 1 {
		return errors.New("certificate.store.install certificatePem is invalid")
	}
	fingerprint := strings.ToLower(strings.ReplaceAll(v2StringValue(input, "fingerprintSha256"), ":", ""))
	if len(fingerprint) != sha256.Size*2 {
		return errors.New("certificate.store.install fingerprintSha256 is invalid")
	}
	if _, err := hex.DecodeString(fingerprint); err != nil {
		return errors.New("certificate.store.install fingerprintSha256 is invalid")
	}
	return nil
}

func directoryExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func executableExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func systemTrustBundleContains(path, expected string) bool {
	encoded, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	for len(encoded) > 0 {
		block, remainder := pem.Decode(encoded)
		if block == nil {
			break
		}
		encoded = remainder
		certificate, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			continue
		}
		fingerprint := sha256.Sum256(certificate.Raw)
		if hex.EncodeToString(fingerprint[:]) == expected {
			return true
		}
	}
	return false
}

func executeAllowlistedService(ctx context.Context, operation agentPlanAction) error {
	service := v2StringValue(operation.Input, "serviceName")
	verb := strings.TrimPrefix(operation.OperationType, "service.")
	if !validLinuxServiceName(service) || !containsString([]string{"reload", "start", "stop"}, verb) {
		return errors.New("service operation requires a fixed service and verb")
	}
	program, err := resolveLinuxSystemctl()
	if err != nil {
		return err
	}
	command := exec.CommandContext(ctx, program, verb, service)
	command.Dir = "/"
	command.Env = []string{"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
	return command.Run()
}

func executeAllowlistedProgram(ctx context.Context, operation agentPlanAction) error {
	if err := validateAllowlistedCommandInput(operation); err != nil {
		return err
	}
	program := v2StringValue(operation.Input, "executablePath")
	workingDirectory := v2StringValue(operation.Input, "workingDirectory")
	args, _ := v2StringArray(operation.Input, "args")
	command := exec.CommandContext(ctx, program, args...)
	command.Dir = workingDirectory
	command.Env = []string{"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
	return command.Run()
}

func validateAllowlistedCommandInput(operation agentPlanAction) error {
	input := operation.Input
	program := v2StringValue(input, "executablePath")
	if err := validateLinuxExecutablePath(program); err != nil {
		return err
	}
	if err := verifyExecutableSha256(program, v2StringValue(input, "executableSha256")); err != nil {
		return err
	}
	if err := validateLinuxWorkingDirectory(v2StringValue(input, "workingDirectory")); err != nil {
		return err
	}
	args, err := v2StringArray(input, "args")
	if err != nil || !validAllowlistedCommandArgs(args) {
		return errors.New("allowlisted command args do not match the declared template")
	}
	template, err := v2StringArray(input, "argumentTemplate")
	if err != nil || !matchesLinuxArgumentTemplate(args, template) {
		return errors.New("allowlisted command argument template is invalid")
	}
	if values, ok := input["environmentAllowlist"]; ok {
		environment, err := stringArrayValue(values)
		if err != nil || len(environment) != 0 {
			return errors.New("allowlisted command environment is not permitted")
		}
	}
	if values, ok := input["networkScopes"]; ok {
		networkScopes, err := stringArrayValue(values)
		if err != nil || len(networkScopes) != 0 {
			return errors.New("allowlisted command network scope is not permitted")
		}
	}
	if value, ok := input["childProcessPolicy"]; ok && v2StringValue(map[string]any{"value": value}, "value") != "deny" {
		return errors.New("allowlisted command child process policy is not deny")
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

func matchesLinuxArgumentTemplate(args, template []string) bool {
	if len(args) == 0 || len(args) != len(template) {
		return false
	}
	for index, expected := range template {
		if expected == args[index] {
			continue
		}
		switch expected {
		case "{verb}":
			if !containsString([]string{"reload", "restart", "start", "stop"}, args[index]) {
				return false
			}
		case "{serviceName}":
			if !validLinuxServiceName(args[index]) {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func v2StringArray(values map[string]any, key string) ([]string, error) {
	raw, ok := values[key]
	if !ok {
		return nil, errors.New("allowlisted command array is missing")
	}
	result, err := stringArrayValue(raw)
	if err != nil || len(result) > 100 {
		return nil, errors.New("allowlisted command array is invalid")
	}
	return result, nil
}

func stringArrayValue(raw any) ([]string, error) {
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

func resolveLinuxSystemctl() (string, error) {
	for _, path := range []string{"/usr/bin/systemctl", "/bin/systemctl"} {
		info, err := os.Stat(path)
		if err == nil && info.Mode().IsRegular() {
			return path, nil
		}
	}
	return "", errors.New("allowlisted service program is unavailable")
}

func validateAllowlistedCommandScope(input map[string]any, allowedPaths, allowedDigests []string) error {
	for _, field := range []string{"executablePath", "workingDirectory"} {
		value := v2StringValue(input, field)
		if value == "" || !pathScopeContains(allowedPaths, value) {
			return fmt.Errorf("allowlisted command %s is outside token scope", field)
		}
	}
	if digest := v2StringValue(input, "executableSha256"); digest == "" || !containsString(allowedDigests, digest) {
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

func validateLinuxExecutablePath(value string) error {
	if value == "" || !filepath.IsAbs(value) || hasParentPathSegment(value) {
		return errors.New("allowlisted command executable path must be absolute and cannot contain parent traversal")
	}
	info, err := os.Stat(value)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&0o111 == 0 {
		return errors.New("allowlisted command executable is unavailable or not executable")
	}
	base := strings.ToLower(filepath.Base(value))
	switch base {
	case "sh", "bash", "dash", "zsh", "fish", "python", "python3", "perl", "ruby", "node":
		return errors.New("allowlisted command executable cannot be a shell, script or interpreter")
	}
	if strings.HasSuffix(base, ".sh") || strings.HasSuffix(base, ".py") || strings.HasSuffix(base, ".pl") || strings.HasSuffix(base, ".rb") {
		return errors.New("allowlisted command executable cannot be a shell, script or interpreter")
	}
	return nil
}

func validateLinuxWorkingDirectory(value string) error {
	if value == "" || !filepath.IsAbs(value) || hasParentPathSegment(value) {
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

func validLinuxServiceName(value string) bool {
	if value == "" || len(value) > 128 || strings.TrimSpace(value) != value {
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
	if strings.TrimSpace(keyID) == "" || strings.TrimSpace(signature) == "" {
		return unavailableAgentAuthorizationMaterial("signature and keyId are required")
	}
	keySetRaw := strings.TrimSpace(agentAuthorizationKeySet(envName))
	if keySetRaw == "" {
		return unavailableAgentAuthorizationMaterial("trusted policy key set is unavailable; fail closed")
	}
	var keySet map[string]string
	if err := json.Unmarshal([]byte(keySetRaw), &keySet); err != nil {
		return unavailableAgentAuthorizationMaterial("trusted policy key set is invalid")
	}
	return verifySignatureWithKeySet(keyID, signature, value, keySet)
}

func verifySignatureWithKeySet(keyID, signature string, value any, keySet map[string]string) error {
	encodedKey, ok := keySet[keyID]
	if !ok {
		return unavailableAgentAuthorizationMaterial("trusted policy key is not configured")
	}
	publicKey, err := base64.StdEncoding.DecodeString(encodedKey)
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
		if envName == "GCAC_AGENT_CAPABILITY_KEYSET_JSON" {
			keySet = material.CapabilityKeySet
		} else if envName == "GCAC_POLICY_AUTHORITY_KEYSET_JSON" {
			keySet = material.PolicyAuthorityKeySet
		}
		if len(keySet) > 0 {
			encoded, err := json.Marshal(keySet)
			if err == nil {
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
		encoded, err := json.Marshal(map[string]any{
			"allowedPaths":    paths,
			"allowedServices": material.LocalPolicy.ServiceRules,
		})
		if err == nil {
			return string(encoded)
		}
	}
	return os.Getenv("GCAC_AGENT_LOCAL_POLICY_JSON")
}

func tokenWithoutSignature(value AgentCapabilityTokenV1) map[string]any {
	value.Signature = ""
	return omitEmptySignature(value)
}
func decisionWithoutSignature(value PolicyAuthorityDecisionV1) map[string]any {
	value.Signature = ""
	return omitEmptyDecisionSignature(value)
}
func omitEmptySignature(value AgentCapabilityTokenV1) map[string]any {
	raw, _ := json.Marshal(value)
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	delete(result, "signature")
	return result
}
func omitEmptyDecisionSignature(value PolicyAuthorityDecisionV1) map[string]any {
	raw, _ := json.Marshal(value)
	var result map[string]any
	_ = json.Unmarshal(raw, &result)
	delete(result, "signature")
	return result
}
func canonicalJSON(value any) []byte {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil
	}
	var normalized any
	if err := json.Unmarshal(raw, &normalized); err != nil {
		return nil
	}
	canonical, err := json.Marshal(normalized)
	if err != nil {
		return nil
	}
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

func linuxPrincipal() string {
	for _, key := range []string{"USER", "LOGNAME"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return "unknown"
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
	if err := json.Unmarshal([]byte(raw), &policy); err != nil {
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
func containsString(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
func v2StringValue(values map[string]any, key string) string {
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
	if strings.TrimSpace(path) == "" || !filepath.IsAbs(path) {
		return errors.New("atomic write requires an absolute path")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".gcac-atomic-*")
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
