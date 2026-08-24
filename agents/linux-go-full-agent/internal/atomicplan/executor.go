package atomicplan

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

const defaultPrivilegedFileHelper = "/usr/local/libexec/gcac-nginx-helper"

var readFileDirect = os.ReadFile
var createTempDirect = os.CreateTemp
var removeFileDirect = os.Remove
var executePrivilegedFileHelper = runPrivilegedFileHelper

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
	ExecutionMode   string         `json:"executionMode"`
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

const (
	defaultPreflightOperationTimeout = 20 * time.Second
	maximumPreflightOperationTimeout = 60 * time.Second
	preflightPlanTimeout             = 90 * time.Second
)

type progressReporterKey struct{}

// WithProgressReporter 为主动直连执行附加进度上报函数。
func WithProgressReporter(ctx context.Context, reporter func(map[string]any)) context.Context {
	if reporter == nil {
		return ctx
	}
	return context.WithValue(ctx, progressReporterKey{}, reporter)
}

func Execute(ctx context.Context, payload map[string]any, agentID, dataDir string) Result {
	plan, rawPlan, err := parse(payload)
	if err != nil {
		return Result{ErrorCode: "AGENT_ATOMIC_OPERATION_FAILED", ErrorMessage: err.Error()}
	}
	if plan.AgentID != "" && agentID != "" && plan.AgentID != agentID {
		return Result{ErrorCode: "AGENT_PLAN_SIGNATURE_INVALID", ErrorMessage: "执行计划目标 Agent 不匹配"}
	}
	if err := verify(rawPlan); err != nil {
		return Result{ErrorCode: "AGENT_PLAN_SIGNATURE_INVALID", ErrorMessage: err.Error()}
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, plan.ExpiresAt)
	if err != nil || time.Now().After(expiresAt) {
		return Result{ErrorCode: "AGENT_PLAN_EXPIRED", ErrorMessage: "执行计划已过期"}
	}
	permissions := permissionMap(plan.Permissions)
	if strings.EqualFold(strings.TrimSpace(plan.ExecutionMode), "PREFLIGHT") {
		return executePreflightPlan(ctx, plan, permissions)
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

func executePreflightPlan(ctx context.Context, plan Plan, permissions map[string][]string) Result {
	planCtx, cancel := context.WithTimeout(ctx, preflightPlanTimeout)
	defer cancel()
	results := make([]OperationResult, 0, len(plan.Operations))
	failed := false
	for index, operation := range plan.Operations {
		reportProgress(planCtx, map[string]any{
			"executionMode": "PREFLIGHT", "state": "RUNNING", "currentOperationId": operation.ID,
			"currentOperationType": operation.OperationType, "completedOperationCount": len(results),
			"totalOperationCount": len(plan.Operations), "operationIndex": index + 1,
		})
		result := preview(planCtx, operation, permissions)
		results = append(results, result)
		failed = failed || result.Status == "FAILED"
		reportProgress(planCtx, map[string]any{
			"executionMode": "PREFLIGHT", "state": "RUNNING", "currentOperationId": operation.ID,
			"currentOperationType": operation.OperationType, "currentOperationStatus": result.Status,
			"completedOperationCount": len(results), "totalOperationCount": len(plan.Operations),
			"operationIndex": index + 1, "operationResults": append([]OperationResult(nil), results...),
		})
		if result.ErrorCode == "AGENT_ATOMIC_PREFLIGHT_TIMEOUT" || planCtx.Err() != nil {
			break
		}
	}
	state := "SUCCEEDED"
	if failed {
		state = "FAILED"
	}
	detail := map[string]any{
		"planId":           plan.PlanID,
		"state":            state,
		"executionMode":    "PREFLIGHT",
		"operationResults": results,
	}
	if failed {
		for _, result := range results {
			if result.ErrorCode == "AGENT_ATOMIC_PREFLIGHT_TIMEOUT" {
				return Result{ErrorCode: result.ErrorCode, ErrorMessage: result.ErrorMessage, Detail: detail}
			}
		}
		return Result{ErrorCode: "AGENT_ATOMIC_PREFLIGHT_FAILED", ErrorMessage: "原子计划预演存在失败项", Detail: detail}
	}
	return Result{Success: true, Detail: detail}
}

func preview(ctx context.Context, operation Operation, permissions map[string][]string) OperationResult {
	started := now()
	operationCtx, cancel := context.WithTimeout(ctx, preflightOperationTimeout(operation.TimeoutSeconds))
	defer cancel()
	type previewOutcome struct {
		detail map[string]any
		status string
		err    error
	}
	completed := make(chan previewOutcome, 1)
	go func() {
		detail, status, err := previewOperation(operationCtx, operation, permissions)
		completed <- previewOutcome{detail: detail, status: status, err: err}
	}()
	var detail map[string]any
	var status string
	var err error
	select {
	case outcome := <-completed:
		detail, status, err = outcome.detail, outcome.status, outcome.err
	case <-operationCtx.Done():
		detail = map[string]any{
			"preview": true, "mutating": false, "timedOut": true,
			"timeoutSeconds": int(preflightOperationTimeout(operation.TimeoutSeconds).Seconds()),
		}
		status = "FAILED"
		err = fmt.Errorf("preflight operation timed out: %s (%s)", operation.ID, operation.OperationType)
	}
	result := OperationResult{
		OperationID: operation.ID, OperationType: operation.OperationType, Stage: operation.Stage,
		Status: status, StartedAt: started, FinishedAt: now(), Detail: detail,
	}
	if err != nil {
		result.Status = "FAILED"
		result.ErrorCode = "AGENT_ATOMIC_PREFLIGHT_FAILED"
		if errors.Is(operationCtx.Err(), context.DeadlineExceeded) {
			result.ErrorCode = "AGENT_ATOMIC_PREFLIGHT_TIMEOUT"
		}
		result.ErrorMessage = err.Error()
	}
	return result
}

func preflightOperationTimeout(timeoutSeconds int) time.Duration {
	if timeoutSeconds <= 0 {
		return defaultPreflightOperationTimeout
	}
	timeout := time.Duration(timeoutSeconds) * time.Second
	if timeout > maximumPreflightOperationTimeout {
		return maximumPreflightOperationTimeout
	}
	return timeout
}

func reportProgress(ctx context.Context, detail map[string]any) {
	reporter, _ := ctx.Value(progressReporterKey{}).(func(map[string]any))
	if reporter != nil {
		reporter(detail)
	}
}

func previewOperation(ctx context.Context, operation Operation, permissions map[string][]string) (map[string]any, string, error) {
	switch operation.OperationType {
	case "preflight.assert":
		detail, err := preflight(operation.Input, permissions)
		return mergePreviewDetail(detail, operation, false), "SUCCEEDED", err
	case "file.backup":
		return previewFileBackup(ctx, operation, permissions)
	case "file.atomic_replace":
		return previewFileReplace(ctx, operation, permissions)
	case "file.set_permissions":
		path := first(operation.Input, "path", "targetPath")
		if err := validatePath(path, permissions["filesystem"]); err != nil {
			return nil, "FAILED", err
		}
		return map[string]any{"preview": true, "mutating": false, "plannedAction": "set_permissions", "path": path, "mode": integer(operation.Input, "mode")}, "SUCCEEDED", nil
	case "command.execute":
		return previewCommand(operation, permissions)
	case "service.control":
		return previewService(ctx, operation, permissions)
	default:
		return map[string]any{"preview": true, "mutating": false, "plannedAction": operation.OperationType}, "WARNING", nil
	}
}

func mergePreviewDetail(detail map[string]any, operation Operation, mutating bool) map[string]any {
	if detail == nil {
		detail = map[string]any{}
	}
	detail["preview"] = true
	detail["mutating"] = mutating
	detail["plannedAction"] = operation.OperationType
	return detail
}

func previewFileBackup(ctx context.Context, operation Operation, permissions map[string][]string) (map[string]any, string, error) {
	path := first(operation.Input, "path", "targetPath")
	if err := validatePath(path, permissions["filesystem"]); err != nil {
		return nil, "FAILED", err
	}
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return map[string]any{"preview": true, "mutating": false, "plannedAction": "backup", "path": path, "exists": false}, "WARNING", nil
	}
	if err != nil {
		return nil, "FAILED", err
	}
	privilegeMode, err := checkReadable(ctx, path)
	if err != nil {
		return nil, "FAILED", err
	}
	return map[string]any{"preview": true, "mutating": false, "plannedAction": "backup", "path": path, "exists": true, "size": info.Size(), "mode": info.Mode().Perm().String(), "privilegeMode": privilegeMode}, "SUCCEEDED", nil
}

func previewFileReplace(ctx context.Context, operation Operation, permissions map[string][]string) (map[string]any, string, error) {
	path := first(operation.Input, "path", "targetPath")
	if err := validatePath(path, permissions["filesystem"]); err != nil {
		return nil, "FAILED", err
	}
	data, err := content(operation.Input)
	artifact, _ := operation.Input["artifact"].(map[string]any)
	artifactRef := text(artifact, "artifactRef")
	artifactSHA256 := text(artifact, "sha256")
	if err != nil && artifactRef == "" && artifactSHA256 == "" {
		return nil, "FAILED", err
	}
	_, statErr := os.Stat(path)
	detail := map[string]any{
		"preview": true, "mutating": false, "plannedAction": "atomic_replace", "path": path,
		"targetExists": statErr == nil, "parentDirectory": filepath.Dir(path), "mode": integer(operation.Input, "mode"),
	}
	privilegeMode, accessErr := checkWritable(ctx, path)
	if accessErr != nil {
		return nil, "FAILED", accessErr
	}
	detail["privilegeMode"] = privilegeMode
	if err == nil {
		detail["contentBytes"] = len(data)
		detail["artifactResolved"] = true
	} else {
		detail["artifactRef"] = artifactRef
		detail["artifactSha256"] = artifactSHA256
		detail["artifactSize"] = integer(artifact, "size")
		detail["artifactResolved"] = true
	}
	return detail, "SUCCEEDED", nil
}

func previewCommand(operation Operation, permissions map[string][]string) (map[string]any, string, error) {
	program := text(operation.Input, "program")
	if !allowed(program, permissions["process"]) {
		return nil, "FAILED", fmt.Errorf("program is not allowed: %s", program)
	}
	if _, err := os.Stat(program); err != nil {
		return nil, "FAILED", err
	}
	if shell, ok := operation.Input["shell"].(map[string]any); ok && boolean(shell, "enabled") {
		return nil, "FAILED", errors.New("shell mode is disabled")
	}
	return map[string]any{"preview": true, "mutating": false, "plannedAction": "execute_command", "program": program, "args": stringsValue(operation.Input["args"]), "executed": false}, "SUCCEEDED", nil
}

func previewService(ctx context.Context, operation Operation, permissions map[string][]string) (map[string]any, string, error) {
	name := first(operation.Input, "service", "serviceName")
	if !allowed(name, permissions["service"]) {
		return nil, "FAILED", fmt.Errorf("service is not allowed: %s", name)
	}
	program := "/bin/systemctl"
	if _, err := os.Stat(program); err != nil {
		program = "/usr/bin/systemctl"
	}
	if _, err := os.Stat(program); err != nil {
		return nil, "FAILED", errors.New("systemctl is unavailable")
	}
	detail, err := runCommand(ctx, program, []string{"is-active", name}, 15*time.Second)
	status := "SUCCEEDED"
	if err != nil {
		status = "WARNING"
	}
	detail["preview"] = true
	detail["mutating"] = false
	detail["plannedAction"] = strings.ToLower(text(operation.Input, "action"))
	detail["serviceName"] = name
	detail["currentStateCheckPassed"] = err == nil
	return detail, status, nil
}

func cloneAnyMap(source map[string]any) map[string]any {
	result := make(map[string]any, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
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
		return backup(ctx, plan, operation, permissions, dataDir, ledger)
	case "file.atomic_replace":
		return replace(ctx, operation, permissions)
	case "file.restore":
		return restore(ctx, operation, ledger)
	case "file.set_permissions":
		return setPermissions(operation, permissions)
	case "command.execute":
		return command(ctx, operation, permissions)
	case "service.control":
		return service(ctx, operation, permissions)
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

func backup(ctx context.Context, plan Plan, operation Operation, permissions map[string][]string, dataDir string, ledger *Ledger) (map[string]any, error) {
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
	privilegeMode, err := copyFileWithPrivilege(ctx, target, item.BackupPath, info.Mode().Perm())
	if err != nil {
		return nil, err
	}
	ledger.Backups = append(ledger.Backups, item)
	return map[string]any{"existed": true, "backupPath": item.BackupPath, "size": info.Size(), "privilegeMode": privilegeMode}, nil
}

func replace(ctx context.Context, operation Operation, permissions map[string][]string) (map[string]any, error) {
	target := first(operation.Input, "path", "targetPath")
	if err := validatePath(target, permissions["filesystem"]); err != nil {
		return nil, err
	}
	content, err := content(operation.Input)
	if err != nil {
		return nil, err
	}
	mode := os.FileMode(0o600)
	if raw := integer(operation.Input, "mode"); raw > 0 {
		mode = os.FileMode(raw)
	}
	privilegeMode, err := replaceFile(ctx, target, content, mode)
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(content)
	return map[string]any{"path": target, "bytes": len(content), "sha256": hex.EncodeToString(digest[:]), "privilegeMode": privilegeMode}, nil
}

func replaceFile(ctx context.Context, target string, content []byte, mode os.FileMode) (string, error) {
	err := replaceFileDirect(target, content, mode)
	if err == nil {
		return "direct", nil
	}
	if !errors.Is(err, os.ErrPermission) {
		return "", err
	}
	if _, helperErr := executePrivilegedFileHelper(ctx, content, "write-file", target, fmt.Sprintf("%03o", mode.Perm())); helperErr != nil {
		return "", fmt.Errorf("direct file replace failed: %v; privileged helper failed: %w", err, helperErr)
	}
	return "sudo-helper", nil
}

func replaceFileDirect(target string, content []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	temporary, err := createTempDirect(filepath.Dir(target), ".gcac-agent-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	_ = temporary.Chmod(mode)
	if _, err := temporary.Write(content); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, target); err != nil {
		return err
	}
	return nil
}

func restore(ctx context.Context, operation Operation, ledger *Ledger) (map[string]any, error) {
	reference := text(operation.Input, "backupOperationId")
	item, ok := findBackup(ledger.Backups, reference)
	if !ok {
		return nil, fmt.Errorf("backup not found: %s", reference)
	}
	if !item.Existed {
		privilegeMode, err := removeFileWithPrivilege(ctx, item.TargetPath)
		if err != nil {
			return nil, err
		}
		return map[string]any{"removed": item.TargetPath, "privilegeMode": privilegeMode}, nil
	}
	data, err := os.ReadFile(item.BackupPath)
	if err != nil {
		return nil, err
	}
	operation.Input = map[string]any{"targetPath": item.TargetPath, "content": string(data), "mode": int(item.Mode)}
	detail, err := replace(ctx, operation, map[string][]string{"filesystem": []string{item.TargetPath}})
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
	args := stringsValue(operation.Input["args"])
	detail, err := runCommand(ctx, program, args, timeout)
	if err == nil || len(args) != 1 || args[0] != "-t" {
		return detail, err
	}
	return runSudoCommand(ctx, program, args, timeout)
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
	detail, err := runCommand(ctx, program, []string{action, name}, 60*time.Second)
	if err == nil {
		return detail, nil
	}
	return runSudoCommand(ctx, program, []string{action, name}, 60*time.Second)
}

func runSudoCommand(ctx context.Context, program string, args []string, timeout time.Duration) (map[string]any, error) {
	sudo, err := exec.LookPath("sudo")
	if err != nil {
		return nil, errors.New("sudo is unavailable")
	}
	privilegedArgs := append([]string{"-n", "--", program}, args...)
	detail, err := runCommand(ctx, sudo, privilegedArgs, timeout)
	detail["privilegeMode"] = "sudo"
	return detail, err
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
func parse(payload map[string]any) (Plan, map[string]any, error) {
	value := any(payload)
	if nested, ok := payload["plan"].(map[string]any); ok {
		value = nested
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return Plan{}, nil, err
	}
	var rawPlan map[string]any
	if err := json.Unmarshal(raw, &rawPlan); err != nil {
		return Plan{}, nil, err
	}
	var plan Plan
	if err := json.Unmarshal(raw, &plan); err != nil {
		return Plan{}, nil, err
	}
	if plan.APIVersion != "gcac.agent-plan/v1" || plan.PlanID == "" || plan.IdempotencyKey == "" {
		return Plan{}, nil, errors.New("invalid atomic execution plan")
	}
	return plan, rawPlan, nil
}
func verify(rawPlan map[string]any) error {
	authorization, ok := rawPlan["authorization"].(map[string]any)
	if !ok {
		return errors.New("atomic plan signature is required")
	}
	signature, _ := authorization["signature"].(string)
	if strings.TrimSpace(signature) == "" {
		return errors.New("atomic plan signature is required")
	}
	unsigned := make(map[string]any, len(rawPlan)-1)
	for key, value := range rawPlan {
		if key != "authorization" {
			unsigned[key] = value
		}
	}
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
		var output strings.Builder
		encoder := json.NewEncoder(&output)
		encoder.SetEscapeHTML(false)
		_ = encoder.Encode(current)
		return strings.TrimSuffix(output.String(), "\n")
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
func copyFileWithPrivilege(ctx context.Context, source, target string, mode os.FileMode) (string, error) {
	data, privilegeMode, err := readFileWithPrivilege(ctx, source)
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return "", err
	}
	if err := os.WriteFile(target, data, mode); err != nil {
		return "", err
	}
	return privilegeMode, nil
}

func readFileWithPrivilege(ctx context.Context, path string) ([]byte, string, error) {
	data, err := readFileDirect(path)
	if err == nil {
		return data, "direct", nil
	}
	if !errors.Is(err, os.ErrPermission) {
		return nil, "", err
	}
	data, helperErr := executePrivilegedFileHelper(ctx, nil, "read-file", path)
	if helperErr != nil {
		return nil, "", fmt.Errorf("direct file read failed: %v; privileged helper failed: %w", err, helperErr)
	}
	return data, "sudo-helper", nil
}

func removeFileWithPrivilege(ctx context.Context, path string) (string, error) {
	err := removeFileDirect(path)
	if err == nil || os.IsNotExist(err) {
		return "direct", nil
	}
	if !errors.Is(err, os.ErrPermission) {
		return "", err
	}
	if _, helperErr := executePrivilegedFileHelper(ctx, nil, "remove-file", path); helperErr != nil {
		return "", fmt.Errorf("direct file removal failed: %v; privileged helper failed: %w", err, helperErr)
	}
	return "sudo-helper", nil
}

func checkReadable(ctx context.Context, path string) (string, error) {
	file, err := os.Open(path)
	if err == nil {
		_ = file.Close()
		return "direct", nil
	}
	if !errors.Is(err, os.ErrPermission) {
		return "", err
	}
	if _, helperErr := executePrivilegedFileHelper(ctx, nil, "check-readable", path); helperErr != nil {
		return "", fmt.Errorf("direct read check failed: %v; privileged helper failed: %w", err, helperErr)
	}
	return "sudo-helper", nil
}

func checkWritable(ctx context.Context, path string) (string, error) {
	if err := checkDirectoryWritable(filepath.Dir(path)); err == nil {
		return "direct", nil
	}
	if _, helperErr := executePrivilegedFileHelper(ctx, nil, "check-writable", path); helperErr != nil {
		return "", fmt.Errorf("target directory is not writable and privileged helper check failed: %w", helperErr)
	}
	return "sudo-helper", nil
}

func runPrivilegedFileHelper(ctx context.Context, input []byte, args ...string) ([]byte, error) {
	sudo, err := exec.LookPath("sudo")
	if err != nil {
		return nil, errors.New("sudo is unavailable")
	}
	helper := strings.TrimSpace(os.Getenv("GCAC_NGINX_HELPER_PATH"))
	if helper == "" {
		helper = defaultPrivilegedFileHelper
	}
	commandArgs := append([]string{"-n", "--", helper}, args...)
	command := exec.CommandContext(ctx, sudo, commandArgs...)
	if input != nil {
		command.Stdin = bytes.NewReader(input)
	}
	output, err := command.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("%s: %w", strings.TrimSpace(string(output)), err)
	}
	return output, nil
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
