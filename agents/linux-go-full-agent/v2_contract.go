package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"
)

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
	maxPlanMessageBytes   = 1 << 20
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
	Receipt         AgentExecutionReceiptV1   `json:"receipt,omitempty"`
}

func executeAgentV2(ctx context.Context, request map[string]any, agentID string) (bool, string, string, map[string]any) {
	encoded, err := json.Marshal(request)
	if err != nil || len(encoded) > maxPlanMessageBytes {
		return false, "AGENT_V2_MESSAGE_INVALID", "Agent v2 请求过大或无法编码", nil
	}
	var envelope agentV2Request
	if err := decodeAgentV2Request(encoded, &envelope); err != nil {
		return false, "AGENT_V2_MESSAGE_INVALID", err.Error(), nil
	}
	if err := validateAgentV2Request(envelope, agentID); err != nil {
		return false, "AGENT_V2_AUTHORIZATION_DENIED", err.Error(), nil
	}
	switch strings.TrimSpace(envelope.Action) {
	case agentFactCollect:
		return collectAgentFacts(envelope)
	case agentPlanValidate:
		if err := validateAgentPlan(envelope.Plan, envelope.Token); err != nil {
			return false, "AGENT_PLAN_INVALID", err.Error(), nil
		}
		return true, "", "", map[string]any{"planDigest": envelope.Plan.PlanDigest, "validated": true}
	case agentPlanExecute:
		return executeAgentPlan(ctx, envelope.Plan, envelope.Token)
	case agentExecutionReceipt:
		return true, "", "", map[string]any{"receiptAccepted": true, "receipt": envelope.Receipt}
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
	if agentID != "" && request.AgentID != agentID {
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
	}
	if request.Action == agentExecutionReceipt {
		if request.Receipt.ReceiptVersion == "" || request.Receipt.Digest == "" {
			return errors.New("receiptVersion and digest are required")
		}
	}
	return nil
}

func validateCapabilityToken(token AgentCapabilityTokenV1, decision PolicyAuthorityDecisionV1, request agentV2Request) error {
	if token.TokenVersion != agentTokenVersion || decision.DecisionVersion != policyDecisionVersion {
		return errors.New("security contract version is unsupported")
	}
	if token.AgentID != request.AgentID || token.TenantID != request.TenantID || token.PluginID != request.PluginID || token.PluginVersionID != request.PluginVersion || token.Capability != request.Capability {
		return errors.New("capability token binding mismatch")
	}
	if !containsString(token.Actions, request.Action) {
		return errors.New("capability token does not grant the requested action")
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
	issuedAt, err := time.Parse(time.RFC3339Nano, token.IssuedAt)
	if err != nil || time.Now().Before(issuedAt) {
		return errors.New("capability token issuedAt is invalid")
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, token.ExpiresAt)
	if err != nil || !time.Now().Before(expiresAt) {
		return errors.New("capability token is expired or invalid")
	}
	decisionIssuedAt, err := time.Parse(time.RFC3339Nano, decision.IssuedAt)
	if err != nil || time.Now().Before(decisionIssuedAt) {
		return errors.New("policy authority decision issuedAt is invalid")
	}
	decisionExpiresAt, err := time.Parse(time.RFC3339Nano, decision.ValidUntil)
	if err != nil || !time.Now().Before(decisionExpiresAt) || expiresAt.After(decisionExpiresAt) {
		return errors.New("policy authority decision is expired or less restrictive than token")
	}
	if revokedNonce(token.Nonce) {
		return errors.New("capability token nonce is revoked")
	}
	if err := validateLocalPolicy(request.Paths, request.Services); err != nil {
		return err
	}
	if err := consumePersistentAgentNonce(token.Nonce, token.TokenID, token.PlanDigest); err != nil {
		return err
	}
	return nil
}

func collectAgentFacts(request agentV2Request) (bool, string, string, map[string]any) {
	return true, "", "", map[string]any{
		"collectedAt": time.Now().UTC().Format(time.RFC3339Nano),
		"facts": map[string]any{
			"hostname": hostnameValue(),
			"os":       "linux",
			"arch":     runtime.GOARCH,
			"paths":    append([]string(nil), request.Paths...),
			"services": append([]string(nil), request.Services...),
		},
	}
}

func validateAgentPlan(plan agentPlanV2, token AgentCapabilityTokenV1) error {
	if len(plan.Operations) == 0 || len(plan.Operations) > maxPlanOperations {
		return errors.New("plan operation count is outside the allowed range")
	}
	if plan.PlanVersion != agentSecurityContract || plan.AgentID != token.AgentID || plan.TenantID != token.TenantID || plan.PluginID != token.PluginID || plan.PluginVersionID != token.PluginVersionID || plan.Capability != token.Capability || plan.TokenID != token.TokenID || plan.Nonce != token.Nonce || plan.PlanDigest != token.PlanDigest {
		return errors.New("plan identity binding mismatch")
	}
	for _, operation := range plan.Operations {
		if err := validateAgentPlanOperation(operation); err != nil {
			return err
		}
		if path := v2StringValue(operation.Input, "path"); path != "" && !pathScopeContains(token.AllowedPaths, path) {
			return fmt.Errorf("operation path is outside token scope: %s", path)
		}
		if service := v2StringValue(operation.Input, "serviceName"); service != "" && !scopeContains(token.AllowedServices, service) {
			return fmt.Errorf("operation service is outside token scope: %s", service)
		}
		if artifact := v2StringValue(operation.Input, "artifactDigest"); artifact != "" && !containsString(token.ArtifactDigests, artifact) {
			return errors.New("operation artifact is outside token scope")
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
	if !containsString([]string{"process.list", "service.list", "service.status", "filesystem.stat", "filesystem.read", "filesystem.backup", "filesystem.atomic_replace", "filesystem.restore", "certificate.material.validate", "certificate.store.inspect", "service.start", "service.stop", "service.reload", "command.execute_allowlisted"}, operation.OperationType) {
		return fmt.Errorf("unsupported Agent operation: %s", operation.OperationType)
	}
	if strings.HasPrefix(operation.OperationType, "service.") && v2StringValue(operation.Input, "serviceName") == "" {
		return errors.New("service operation requires serviceName")
	}
	if operation.OperationType == "command.execute_allowlisted" {
		return validateAllowlistedCommandInput(operation)
	}
	return nil
}

func executeAgentPlan(ctx context.Context, plan agentPlanV2, token AgentCapabilityTokenV1) (bool, string, string, map[string]any) {
	if err := validateAgentPlan(plan, token); err != nil {
		return false, "AGENT_PLAN_INVALID", err.Error(), nil
	}
	results := make([]map[string]any, 0, len(plan.Operations))
	for _, operation := range plan.Operations {
		started := time.Now()
		result := map[string]any{"operationId": operation.OperationID, "operationType": operation.OperationType, "status": "SUCCEEDED"}
		var err error
		switch operation.OperationType {
		case "filesystem.atomic_replace":
			err = executeFileReplace(operation)
		case "filesystem.restore":
			err = errors.New("filesystem.restore requires a signed checkpoint and is not available without one")
		case "service.start", "service.stop", "service.reload":
			err = executeAllowlistedService(ctx, operation)
		case "command.execute_allowlisted":
			err = executeAllowlistedProgram(ctx, operation)
		case "process.list", "service.list", "service.status", "filesystem.stat", "filesystem.read", "filesystem.backup", "certificate.material.validate", "certificate.store.inspect":
			err = errors.New("read-only operation requires the corresponding Agent fact collector")
		}
		if err != nil {
			result["status"] = "UNKNOWN"
			result["error"] = err.Error()
			result["finishedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
			result["durationMs"] = time.Since(started).Milliseconds()
			results = append(results, result)
			return false, "AGENT_EXECUTION_UNKNOWN", "写操作结果不明，禁止自动重试或回退", map[string]any{"planId": plan.PlanID, "operations": results}
		}
		result["finishedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
		result["durationMs"] = time.Since(started).Milliseconds()
		results = append(results, result)
	}
	return true, "", "", map[string]any{"planId": plan.PlanID, "status": "SUCCEEDED", "operations": results}
}

func executeFileReplace(operation agentPlanAction) error {
	path := v2StringValue(operation.Input, "path")
	content, err := base64.StdEncoding.DecodeString(v2StringValue(operation.Input, "contentBase64"))
	if err != nil || path == "" || !filepath.IsAbs(path) {
		return errors.New("file.atomic_replace requires an absolute path and base64 content")
	}
	return atomicWriteFile(path, content, 0o600)
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
	args, _ := v2StringArray(operation.Input, "args")
	command := exec.CommandContext(ctx, program, args...)
	command.Dir = "/"
	command.Env = []string{"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
	return command.Run()
}

func validateAllowlistedCommandInput(operation agentPlanAction) error {
	input := operation.Input
	program := v2StringValue(input, "executablePath")
	if program != "/usr/bin/systemctl" && program != "/bin/systemctl" {
		return errors.New("program is not in the fixed absolute-path allowlist")
	}
	if err := verifyExecutableSha256(program, v2StringValue(input, "executableSha256")); err != nil {
		return err
	}
	if v2StringValue(input, "workingDirectory") != "/" {
		return errors.New("allowlisted command working directory is not fixed")
	}
	args, err := v2StringArray(input, "args")
	if err != nil || len(args) != 2 || !containsString([]string{"reload", "restart", "start", "stop"}, args[0]) || !validLinuxServiceName(args[1]) {
		return errors.New("allowlisted command args do not match the fixed template")
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
	if len(args) != len(template) {
		return false
	}
	return (template[0] == args[0] || template[0] == "{verb}") && (template[1] == args[1] || template[1] == "{serviceName}")
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
		return errors.New("signature and keyId are required")
	}
	keySetRaw := strings.TrimSpace(os.Getenv(envName))
	if keySetRaw == "" {
		return errors.New("trusted policy key set is unavailable; fail closed")
	}
	var keySet map[string]string
	if err := json.Unmarshal([]byte(keySetRaw), &keySet); err != nil {
		return errors.New("trusted policy key set is invalid")
	}
	encodedKey, ok := keySet[keyID]
	if !ok {
		return errors.New("trusted policy key is not configured")
	}
	publicKey, err := base64.StdEncoding.DecodeString(encodedKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return errors.New("trusted policy key is invalid")
	}
	signed, err := base64.StdEncoding.DecodeString(signature)
	if err != nil || !ed25519.Verify(ed25519.PublicKey(publicKey), canonicalJSON(value), signed) {
		return errors.New("signature verification failed")
	}
	return nil
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
	raw := strings.TrimSpace(os.Getenv("GCAC_AGENT_LOCAL_POLICY_JSON"))
	if raw == "" {
		return errors.New("local agent policy is unavailable; fail closed")
	}
	var policy struct {
		AllowedPaths    []string `json:"allowedPaths"`
		AllowedServices []string `json:"allowedServices"`
	}
	if err := json.Unmarshal([]byte(raw), &policy); err != nil {
		return errors.New("local agent policy is invalid")
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
	normalizedValue := strings.TrimRight(strings.ReplaceAll(value, "\\", "/"), "/")
	for _, item := range scope {
		normalizedScope := strings.TrimRight(strings.ReplaceAll(item, "\\", "/"), "/")
		if normalizedValue == normalizedScope || strings.HasPrefix(normalizedValue, normalizedScope+"/") {
			return true
		}
	}
	return false
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
