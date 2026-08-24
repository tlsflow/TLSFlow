package atomicplan

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Result struct {
	Success      bool
	ErrorCode    string
	ErrorMessage string
	Detail       map[string]any
}

type Plan struct {
	APIVersion      string         `json:"apiVersion"`
	PlanID          string         `json:"planId"`
	TenantID        string         `json:"tenantId"`
	AgentID         string         `json:"agentId"`
	ExecutionRunID  string         `json:"executionRunId"`
	ExecutionStepID string         `json:"executionStepId"`
	Plugin          map[string]any `json:"plugin"`
	IssuedAt        string         `json:"issuedAt"`
	ExpiresAt       string         `json:"expiresAt"`
	IdempotencyKey  string         `json:"idempotencyKey"`
	Permissions     []Permission   `json:"permissions"`
	VariablesDigest string         `json:"variablesDigest"`
	Operations      []Operation    `json:"operations"`
	Rollback        []Operation    `json:"rollback"`
	Authorization   Authorization  `json:"authorization"`
}

type Authorization struct {
	KeyID     string `json:"keyId"`
	Signature string `json:"signature"`
}
type Permission struct {
	Name   string   `json:"name"`
	Scope  string   `json:"scope"`
	Values []string `json:"values"`
}
type Operation struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	Stage          string         `json:"stage"`
	OperationType  string         `json:"operationType"`
	SchemaVersion  string         `json:"schemaVersion"`
	TimeoutSeconds int            `json:"timeoutSeconds,omitempty"`
	Input          map[string]any `json:"input"`
}
type OperationResult struct {
	OperationID   string         `json:"operationId"`
	OperationType string         `json:"operationType"`
	Stage         string         `json:"stage"`
	Status        string         `json:"status"`
	StartedAt     string         `json:"startedAt"`
	FinishedAt    string         `json:"finishedAt"`
	Detail        map[string]any `json:"detail,omitempty"`
	ErrorCode     string         `json:"errorCode,omitempty"`
	ErrorMessage  string         `json:"errorMessage,omitempty"`
}
type Backup struct {
	OperationID string `json:"operationId"`
	TargetPath  string `json:"targetPath"`
	BackupPath  string `json:"backupPath"`
	Existed     bool   `json:"existed"`
	Mode        uint32 `json:"mode"`
	UID         int    `json:"uid"`
	GID         int    `json:"gid"`
}
type Ledger struct {
	PlanID              string            `json:"planId"`
	IdempotencyKey      string            `json:"idempotencyKey"`
	State               string            `json:"state"`
	CompletedOperations []string          `json:"completedOperations"`
	OperationResults    []OperationResult `json:"operationResults"`
	RollbackResults     []OperationResult `json:"rollbackResults"`
	Backups             []Backup          `json:"backups"`
	UpdatedAt           string            `json:"updatedAt"`
}

func Execute(ctx context.Context, payload map[string]any, agentID, dataDir string) Result {
	plan, err := parse(payload)
	if err != nil {
		return Result{ErrorCode: "AGENT_ATOMIC_OPERATION_FAILED", ErrorMessage: err.Error()}
	}
	if plan.AgentID != "" && agentID != "" && plan.AgentID != agentID {
		return Result{ErrorCode: "AGENT_PLAN_SIGNATURE_INVALID", ErrorMessage: "执行计划目标 Agent 不匹配"}
	}
	if err := verify(plan); err != nil {
		return Result{ErrorCode: "AGENT_PLAN_SIGNATURE_INVALID", ErrorMessage: err.Error()}
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, plan.ExpiresAt)
	if err != nil || time.Now().After(expiresAt) {
		return Result{ErrorCode: "AGENT_PLAN_EXPIRED", ErrorMessage: "执行计划已过期"}
	}
	if strings.TrimSpace(dataDir) == "" {
		dataDir = filepath.Join(os.TempDir(), "gcac-linux-agent")
	}
	ledgerPath := filepath.Join(dataDir, "atomic-plans", plan.IdempotencyKey+".json")
	ledger, _ := loadLedger(ledgerPath)
	if ledger != nil && (ledger.State == "SUCCEEDED" || ledger.State == "ROLLED_BACK") {
		return Result{Success: ledger.State == "SUCCEEDED", Detail: ledgerDetail(*ledger, true)}
	}
	current := Ledger{PlanID: plan.PlanID, IdempotencyKey: plan.IdempotencyKey, State: "RUNNING", UpdatedAt: now()}
	if ledger != nil {
		current = *ledger
	}
	permissions := permissionMap(plan.Permissions)
	for _, operation := range plan.Operations {
		if contains(current.CompletedOperations, operation.ID) {
			continue
		}
		result := run(ctx, plan, operation, permissions, dataDir, &current)
		current.OperationResults = append(current.OperationResults, result)
		if result.Status != "SUCCEEDED" {
			current.State = "ROLLING_BACK"
			_ = saveLedger(ledgerPath, current)
			rollbackFailed := false
			for index := len(plan.Rollback) - 1; index >= 0; index-- {
				item := run(ctx, plan, plan.Rollback[index], permissions, dataDir, &current)
				current.RollbackResults = append(current.RollbackResults, item)
				rollbackFailed = rollbackFailed || item.Status != "SUCCEEDED"
			}
			current.State = "ROLLED_BACK"
			code := "AGENT_ATOMIC_OPERATION_FAILED"
			if rollbackFailed {
				current.State = "MANUAL_INTERVENTION"
				code = "AGENT_ROLLBACK_FAILED"
			}
			current.UpdatedAt = now()
			_ = saveLedger(ledgerPath, current)
			return Result{ErrorCode: code, ErrorMessage: result.ErrorMessage, Detail: ledgerDetail(current, false)}
		}
		current.CompletedOperations = append(current.CompletedOperations, operation.ID)
		current.UpdatedAt = now()
		if err := saveLedger(ledgerPath, current); err != nil {
			return Result{ErrorCode: "AGENT_ATOMIC_OPERATION_FAILED", ErrorMessage: err.Error(), Detail: ledgerDetail(current, false)}
		}
	}
	current.State = "SUCCEEDED"
	current.UpdatedAt = now()
	_ = saveLedger(ledgerPath, current)
	return Result{Success: true, Detail: ledgerDetail(current, false)}
}

func run(ctx context.Context, plan Plan, operation Operation, permissions map[string][]string, dataDir string, ledger *Ledger) OperationResult {
	started := now()
	if required := text(operation.Input, "whenOperationCompleted"); required != "" && !contains(ledger.CompletedOperations, required) {
		return OperationResult{
			OperationID: operation.ID, OperationType: operation.OperationType, Stage: operation.Stage, Status: "SUCCEEDED",
			StartedAt: started, FinishedAt: now(),
			Detail: map[string]any{"skipped": true, "reason": "required operation was not completed", "requiredOperationId": required},
		}
	}
	detail, err := execute(ctx, plan, operation, permissions, dataDir, ledger)
	result := OperationResult{OperationID: operation.ID, OperationType: operation.OperationType, Stage: operation.Stage, StartedAt: started, FinishedAt: now(), Detail: detail}
	if err != nil {
		result.Status = "FAILED"
		result.ErrorCode = "AGENT_ATOMIC_OPERATION_FAILED"
		result.ErrorMessage = err.Error()
	} else {
		result.Status = "SUCCEEDED"
	}
	return result
}

func execute(ctx context.Context, plan Plan, operation Operation, permissions map[string][]string, dataDir string, ledger *Ledger) (map[string]any, error) {
	switch operation.OperationType {
	case "preflight.assert":
		return preflight(operation.Input, permissions)
	case "file.backup":
		return backup(plan, operation, permissions, dataDir, ledger)
	case "file.atomic_replace":
		return replace(operation, permissions)
	case "file.restore":
		return restore(operation, ledger)
	case "file.set_permissions":
		return setPermissions(operation, permissions)
	case "command.execute":
		return command(ctx, operation, permissions)
	case "service.control":
		return service(ctx, operation, permissions)
	case "tls.verify":
		return verifyTLS(operation, permissions)
	default:
		return nil, fmt.Errorf("unsupported atomic operation: %s", operation.OperationType)
	}
}

func preflight(input map[string]any, permissions map[string][]string) (map[string]any, error) {
	path := text(input, "path")
	if path != "" {
		if err := validatePath(path, permissions["filesystem"]); err != nil {
			return nil, err
		}
		if boolean(input, "mustExist") {
			if _, err := os.Stat(path); err != nil {
				return nil, err
			}
		}
	}
	program := text(input, "program")
	if program != "" {
		if !allowed(program, permissions["process"]) {
			return nil, fmt.Errorf("program is not allowed: %s", program)
		}
		if _, err := os.Stat(program); err != nil {
			return nil, err
		}
	}
	return map[string]any{"passed": true}, nil
}

func backup(plan Plan, operation Operation, permissions map[string][]string, dataDir string, ledger *Ledger) (map[string]any, error) {
	target := first(operation.Input, "path", "targetPath")
	if err := validatePath(target, permissions["filesystem"]); err != nil {
		return nil, err
	}
	info, err := os.Lstat(target)
	item := Backup{OperationID: operation.ID, TargetPath: target}
	if os.IsNotExist(err) {
		ledger.Backups = append(ledger.Backups, item)
		return map[string]any{"existed": false}, nil
	}
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("symbolic link is not allowed")
	}
	item.Existed = true
	item.Mode = uint32(info.Mode().Perm())
	item.UID, item.GID = readFileOwnership(info)
	dir := filepath.Join(dataDir, "atomic-backups", plan.PlanID)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	item.BackupPath = filepath.Join(dir, operation.ID+"-"+filepath.Base(target))
	if err := copyFile(target, item.BackupPath, info.Mode().Perm()); err != nil {
		return nil, err
	}
	ledger.Backups = append(ledger.Backups, item)
	return map[string]any{"existed": true, "backupPath": item.BackupPath, "size": info.Size()}, nil
}

func replace(operation Operation, permissions map[string][]string) (map[string]any, error) {
	target := first(operation.Input, "path", "targetPath")
	if err := validatePath(target, permissions["filesystem"]); err != nil {
		return nil, err
	}
	content, err := content(operation.Input)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return nil, err
	}
	temporary, err := os.CreateTemp(filepath.Dir(target), ".gcac-agent-*")
	if err != nil {
		return nil, err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	mode := os.FileMode(0o600)
	if raw := integer(operation.Input, "mode"); raw > 0 {
		mode = os.FileMode(raw)
	}
	_ = temporary.Chmod(mode)
	if _, err := temporary.Write(content); err != nil {
		temporary.Close()
		return nil, err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return nil, err
	}
	if err := temporary.Close(); err != nil {
		return nil, err
	}
	if err := os.Rename(temporaryPath, target); err != nil {
		return nil, err
	}
	digest := sha256.Sum256(content)
	return map[string]any{"path": target, "bytes": len(content), "sha256": hex.EncodeToString(digest[:])}, nil
}

func restore(operation Operation, ledger *Ledger) (map[string]any, error) {
	reference := text(operation.Input, "backupOperationId")
	item, ok := findBackup(ledger.Backups, reference)
	if !ok {
		return nil, fmt.Errorf("backup not found: %s", reference)
	}
	if !item.Existed {
		if err := os.Remove(item.TargetPath); err != nil && !os.IsNotExist(err) {
			return nil, err
		}
		return map[string]any{"removed": item.TargetPath}, nil
	}
	data, err := os.ReadFile(item.BackupPath)
	if err != nil {
		return nil, err
	}
	operation.Input = map[string]any{"targetPath": item.TargetPath, "content": string(data), "mode": int(item.Mode)}
	detail, err := replace(operation, map[string][]string{"filesystem": []string{item.TargetPath}})
	if err == nil {
		_ = applyFileOwnership(item.TargetPath, item.UID, item.GID)
	}
	return detail, err
}

func setPermissions(operation Operation, permissions map[string][]string) (map[string]any, error) {
	path := first(operation.Input, "path", "targetPath")
	if err := validatePath(path, permissions["filesystem"]); err != nil {
		return nil, err
	}
	if mode := integer(operation.Input, "mode"); mode > 0 {
		if err := os.Chmod(path, os.FileMode(mode)); err != nil {
			return nil, err
		}
	}
	uid, gid := -1, -1
	if name := text(operation.Input, "owner"); name != "" {
		account, err := user.Lookup(name)
		if err != nil {
			return nil, err
		}
		uid, _ = strconv.Atoi(account.Uid)
	}
	if name := text(operation.Input, "group"); name != "" {
		group, err := user.LookupGroup(name)
		if err != nil {
			return nil, err
		}
		gid, _ = strconv.Atoi(group.Gid)
	}
	if uid >= 0 || gid >= 0 {
		if err := applyFileOwnership(path, uid, gid); err != nil {
			return nil, err
		}
	}
	return map[string]any{"path": path, "mode": integer(operation.Input, "mode")}, nil
}

func command(ctx context.Context, operation Operation, permissions map[string][]string) (map[string]any, error) {
	program := text(operation.Input, "program")
	if !allowed(program, permissions["process"]) {
		return nil, fmt.Errorf("program is not allowed: %s", program)
	}
	if shell, ok := operation.Input["shell"].(map[string]any); ok && boolean(shell, "enabled") {
		return nil, errors.New("shell mode is disabled")
	}
	timeout := time.Duration(operation.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	return runCommand(ctx, program, stringsValue(operation.Input["args"]), timeout)
}

func service(ctx context.Context, operation Operation, permissions map[string][]string) (map[string]any, error) {
	name := first(operation.Input, "service", "serviceName")
	if !allowed(name, permissions["service"]) {
		return nil, fmt.Errorf("service is not allowed: %s", name)
	}
	action := strings.ToLower(text(operation.Input, "action"))
	program := "/bin/systemctl"
	if _, err := os.Stat(program); err != nil {
		program = "/usr/bin/systemctl"
	}
	if _, err := os.Stat(program); err != nil {
		return nil, errors.New("systemctl is unavailable")
	}
	if action == "status" {
		action = "is-active"
	}
	return runCommand(ctx, program, []string{action, name}, 60*time.Second)
}

func verifyTLS(operation Operation, permissions map[string][]string) (map[string]any, error) {
	host := text(operation.Input, "host")
	port := integer(operation.Input, "port")
	target := net.JoinHostPort(host, strconv.Itoa(port))
	if !allowed(target, permissions["network"]) {
		return nil, fmt.Errorf("network target is not allowed: %s", target)
	}
	sni := first(operation.Input, "sni", "serverName")
	if sni == "" {
		sni = host
	}
	expected := strings.ToLower(strings.ReplaceAll(text(operation.Input, "expectedFingerprint"), ":", ""))
	skipChainValidation := boolean(operation.Input, "skipChainValidation")
	if skipChainValidation && expected == "" {
		return nil, errors.New("skipChainValidation requires expectedFingerprint")
	}
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	connection, err := tls.DialWithDialer(dialer, "tcp", target, &tls.Config{ServerName: sni, MinVersion: tls.VersionTLS12, InsecureSkipVerify: skipChainValidation})
	if err != nil {
		return nil, err
	}
	defer connection.Close()
	certificates := connection.ConnectionState().PeerCertificates
	if len(certificates) == 0 {
		return nil, errors.New("peer did not provide certificate")
	}
	certificate := certificates[0]
	fingerprint := sha256.Sum256(certificate.Raw)
	actual := strings.ToLower(hex.EncodeToString(fingerprint[:]))
	if expected != "" && actual != expected {
		return nil, fmt.Errorf("certificate fingerprint mismatch: %s", actual)
	}
	return map[string]any{"fingerprintSha256": actual, "serialNumber": certificate.SerialNumber.String(), "subject": certificate.Subject.String(), "dnsNames": certificate.DNSNames, "notBefore": certificate.NotBefore.UTC().Format(time.RFC3339), "notAfter": certificate.NotAfter.UTC().Format(time.RFC3339)}, nil
}

func runCommand(ctx context.Context, program string, args []string, timeout time.Duration) (map[string]any, error) {
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	command := exec.CommandContext(runCtx, program, args...)
	output, err := command.CombinedOutput()
	if len(output) > 64*1024 {
		output = output[:64*1024]
	}
	detail := map[string]any{"program": program, "args": args, "output": string(output)}
	if runCtx.Err() == context.DeadlineExceeded {
		return detail, errors.New("command timed out")
	}
	return detail, err
}
func parse(payload map[string]any) (Plan, error) {
	value := any(payload)
	if nested, ok := payload["plan"].(map[string]any); ok {
		value = nested
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return Plan{}, err
	}
	var plan Plan
	if err := json.Unmarshal(raw, &plan); err != nil {
		return Plan{}, err
	}
	if plan.APIVersion != "gcac.agent-plan/v1" || plan.PlanID == "" || plan.IdempotencyKey == "" {
		return Plan{}, errors.New("invalid atomic execution plan")
	}
	return plan, nil
}
func verify(plan Plan) error {
	signature := plan.Authorization.Signature
	raw, err := json.Marshal(plan)
	if err != nil {
		return err
	}
	var unsigned map[string]any
	if err := json.Unmarshal(raw, &unsigned); err != nil {
		return err
	}
	delete(unsigned, "authorization")
	canonical := []byte(renderCanonical(unsigned))
	mac := hmac.New(sha256.New, []byte(signingKey()))
	_, _ = mac.Write(canonical)
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(strings.ToLower(signature)), []byte(expected)) {
		return errors.New("atomic plan signature mismatch")
	}
	return nil
}
func renderCanonical(value any) string {
	switch current := value.(type) {
	case map[string]any:
		keys := make([]string, 0, len(current))
		for key := range current {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			keyJSON, _ := json.Marshal(key)
			parts = append(parts, string(keyJSON)+":"+renderCanonical(current[key]))
		}
		return "{" + strings.Join(parts, ",") + "}"
	case []any:
		parts := make([]string, len(current))
		for index, item := range current {
			parts[index] = renderCanonical(item)
		}
		return "[" + strings.Join(parts, ",") + "]"
	default:
		raw, _ := json.Marshal(current)
		return string(raw)
	}
}
func signingKey() string {
	if value := strings.TrimSpace(os.Getenv("GCAC_AGENT_PLAN_SIGNING_KEY")); value != "" {
		return value
	}
	return "gcac-development-agent-plan-key"
}
func permissionMap(items []Permission) map[string][]string {
	result := map[string][]string{}
	for _, item := range items {
		result[item.Scope] = append(result[item.Scope], item.Values...)
	}
	return result
}
func allowed(value string, patterns []string) bool {
	clean := filepath.Clean(value)
	for _, pattern := range patterns {
		if pattern == value || filepath.Clean(pattern) == clean || (strings.HasSuffix(pattern, "*") && strings.HasPrefix(value, strings.TrimSuffix(pattern, "*"))) {
			return true
		}
	}
	return false
}
func validatePath(path string, patterns []string) error {
	if path == "" || !filepath.IsAbs(path) {
		return errors.New("absolute path is required")
	}
	if info, err := os.Lstat(path); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return errors.New("symbolic link is not allowed")
	}
	if !allowed(path, patterns) {
		return fmt.Errorf("path is outside allowed roots: %s", path)
	}
	return nil
}
func text(input map[string]any, key string) string {
	value, _ := input[key].(string)
	return strings.TrimSpace(value)
}
func first(input map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := text(input, key); value != "" {
			return value
		}
	}
	return ""
}
func boolean(input map[string]any, key string) bool { value, _ := input[key].(bool); return value }
func integer(input map[string]any, key string) int {
	switch value := input[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	case string:
		parsed, _ := strconv.ParseInt(value, 0, 32)
		return int(parsed)
	}
	return 0
}
func stringsValue(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		values, _ := value.([]string)
		return values
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if value, ok := item.(string); ok {
			result = append(result, value)
		}
	}
	return result
}
func content(input map[string]any) ([]byte, error) {
	if value, ok := input["content"].(string); ok {
		return []byte(value), nil
	}
	if value, ok := input["contentBase64"].(string); ok {
		return base64.StdEncoding.DecodeString(value)
	}
	if artifact, ok := input["artifact"].(map[string]any); ok {
		if value, ok := artifact["content"].(string); ok {
			return []byte(value), nil
		}
		if value, ok := artifact["contentBase64"].(string); ok {
			return base64.StdEncoding.DecodeString(value)
		}
	}
	return nil, errors.New("file content is required")
}
func findBackup(items []Backup, id string) (Backup, bool) {
	for _, item := range items {
		if item.OperationID == id {
			return item, true
		}
	}
	return Backup{}, false
}
func contains(items []string, value string) bool {
	for _, item := range items {
		if item == value {
			return true
		}
	}
	return false
}
func copyFile(source, target string, mode os.FileMode) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	return os.WriteFile(target, data, mode)
}
func loadLedger(path string) (*Ledger, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var ledger Ledger
	if err := json.Unmarshal(data, &ledger); err != nil {
		return nil, err
	}
	return &ledger, nil
}
func saveLedger(path string, ledger Ledger) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(ledger, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return err
	}
	return os.Rename(temporary, path)
}
func ledgerDetail(ledger Ledger, cached bool) map[string]any {
	return map[string]any{"planId": ledger.PlanID, "state": ledger.State, "cached": cached, "operationResults": ledger.OperationResults, "rollbackResults": ledger.RollbackResults, "completedOperations": ledger.CompletedOperations}
}
func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }
