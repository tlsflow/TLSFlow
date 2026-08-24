package main

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
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

type atomicPlan struct {
	APIVersion      string              `json:"apiVersion"`
	PlanID          string              `json:"planId"`
	TenantID        string              `json:"tenantId"`
	AgentID         string              `json:"agentId"`
	ExecutionRunID  string              `json:"executionRunId"`
	ExecutionStepID string              `json:"executionStepId"`
	IssuedAt        string              `json:"issuedAt"`
	ExpiresAt       string              `json:"expiresAt"`
	IdempotencyKey  string              `json:"idempotencyKey"`
	Plugin          map[string]any      `json:"plugin"`
	Permissions     []atomicPermission  `json:"permissions"`
	VariablesDigest string              `json:"variablesDigest"`
	Operations      []atomicOperation   `json:"operations"`
	Rollback        []atomicOperation   `json:"rollback"`
	Authorization   atomicAuthorization `json:"authorization"`
}

type atomicAuthorization struct {
	KeyID     string `json:"keyId"`
	Signature string `json:"signature"`
}

type atomicPermission struct {
	Name   string   `json:"name"`
	Scope  string   `json:"scope"`
	Values []string `json:"values"`
}

type atomicOperation struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	Stage          string         `json:"stage"`
	OperationType  string         `json:"operationType"`
	SchemaVersion  string         `json:"schemaVersion"`
	TimeoutSeconds int            `json:"timeoutSeconds,omitempty"`
	Input          map[string]any `json:"input"`
}

type atomicOperationResult struct {
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

type atomicBackup struct {
	OperationID string `json:"operationId"`
	TargetPath  string `json:"targetPath"`
	BackupPath  string `json:"backupPath"`
	Existed     bool   `json:"existed"`
	Mode        uint32 `json:"mode"`
}

type atomicIISBindingBackup struct {
	OperationID string            `json:"operationId"`
	SiteName    string            `json:"siteName"`
	Binding     windowsIISBinding `json:"binding"`
}

type atomicLedger struct {
	PlanID              string                   `json:"planId"`
	IdempotencyKey      string                   `json:"idempotencyKey"`
	State               string                   `json:"state"`
	CompletedOperations []string                 `json:"completedOperations"`
	OperationResults    []atomicOperationResult  `json:"operationResults"`
	RollbackResults     []atomicOperationResult  `json:"rollbackResults"`
	Backups             []atomicBackup           `json:"backups"`
	IISBindingBackups   []atomicIISBindingBackup `json:"iisBindingBackups,omitempty"`
	UpdatedAt           string                   `json:"updatedAt"`
}

func windowsAtomicPlanActionHandler() actionHandler {
	return actionHandlerFunc{
		descriptor: actionHandlerDescriptor{ActionType: "agent.atomic_plan.execute", SchemaVersions: []string{"1.0"}, DirectControl: true},
		execute: func(execution *taskExecutionContext) actionExecutionResult {
			return executeWindowsAtomicPlan(execution)
		},
	}
}

func executeWindowsAtomicPlan(execution *taskExecutionContext) actionExecutionResult {
	plan, err := parseAtomicPlan(execution.task.Payload)
	if err != nil {
		return actionExecutionResult{ErrorCode: "AGENT_ATOMIC_OPERATION_FAILED", ErrorMessage: err.Error()}
	}
	if plan.AgentID != "" && execution.registration != nil && plan.AgentID != execution.registration.AgentID {
		return actionExecutionResult{ErrorCode: "AGENT_PLAN_SIGNATURE_INVALID", ErrorMessage: "执行计划目标 Agent 不匹配"}
	}
	if err := verifyAtomicPlan(plan); err != nil {
		return actionExecutionResult{ErrorCode: "AGENT_PLAN_SIGNATURE_INVALID", ErrorMessage: err.Error()}
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, plan.ExpiresAt)
	if err != nil || time.Now().After(expiresAt) {
		return actionExecutionResult{ErrorCode: "AGENT_PLAN_EXPIRED", ErrorMessage: "执行计划已过期"}
	}
	dataDir := execution.config.Paths.Windows.DataDir
	ledgerPath := filepath.Join(dataDir, "atomic-plans", plan.IdempotencyKey+".json")
	ledger, _ := loadAtomicLedger(ledgerPath)
	if ledger != nil && (ledger.State == "SUCCEEDED" || ledger.State == "ROLLED_BACK") {
		return actionExecutionResult{Success: ledger.State == "SUCCEEDED", Detail: atomicLedgerDetail(*ledger, true)}
	}
	current := atomicLedger{PlanID: plan.PlanID, IdempotencyKey: plan.IdempotencyKey, State: "RUNNING", UpdatedAt: time.Now().UTC().Format(time.RFC3339Nano)}
	if ledger != nil {
		current = *ledger
	}
	permissionMap := atomicPermissionMap(plan.Permissions)
	for _, operation := range plan.Operations {
		if containsAtomicString(current.CompletedOperations, operation.ID) {
			continue
		}
		result := runWindowsAtomicOperation(execution.ctx, plan, operation, permissionMap, dataDir, &current)
		current.OperationResults = append(current.OperationResults, result)
		if result.Status != "SUCCEEDED" {
			current.State = "ROLLING_BACK"
			_ = saveAtomicLedger(ledgerPath, current)
			rollbackFailed := false
			for index := len(plan.Rollback) - 1; index >= 0; index-- {
				rollbackResult := runWindowsAtomicOperation(execution.ctx, plan, plan.Rollback[index], permissionMap, dataDir, &current)
				current.RollbackResults = append(current.RollbackResults, rollbackResult)
				if rollbackResult.Status != "SUCCEEDED" {
					rollbackFailed = true
				}
			}
			current.State = "ROLLED_BACK"
			code := "AGENT_ATOMIC_OPERATION_FAILED"
			if rollbackFailed {
				current.State = "MANUAL_INTERVENTION"
				code = "AGENT_ROLLBACK_FAILED"
			}
			current.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
			_ = saveAtomicLedger(ledgerPath, current)
			return actionExecutionResult{ErrorCode: code, ErrorMessage: result.ErrorMessage, Detail: atomicLedgerDetail(current, false)}
		}
		current.CompletedOperations = append(current.CompletedOperations, operation.ID)
		current.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
		if err := saveAtomicLedger(ledgerPath, current); err != nil {
			return actionExecutionResult{ErrorCode: "AGENT_ATOMIC_OPERATION_FAILED", ErrorMessage: err.Error(), Detail: atomicLedgerDetail(current, false)}
		}
	}
	current.State = "SUCCEEDED"
	current.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	_ = saveAtomicLedger(ledgerPath, current)
	return actionExecutionResult{Success: true, Detail: atomicLedgerDetail(current, false)}
}

func runWindowsAtomicOperation(ctx context.Context, plan atomicPlan, operation atomicOperation, permissions map[string][]string, dataDir string, ledger *atomicLedger) atomicOperationResult {
	startedAt := time.Now().UTC()
	if required := atomicString(operation.Input, "whenOperationCompleted"); required != "" && !containsAtomicString(ledger.CompletedOperations, required) {
		return atomicOperationResult{
			OperationID: operation.ID, OperationType: operation.OperationType, Stage: operation.Stage, Status: "SUCCEEDED",
			StartedAt: startedAt.Format(time.RFC3339Nano), FinishedAt: time.Now().UTC().Format(time.RFC3339Nano),
			Detail: map[string]any{"skipped": true, "reason": "required operation was not completed", "requiredOperationId": required},
		}
	}
	detail, err := executeWindowsAtomicOperation(ctx, plan, operation, permissions, dataDir, ledger)
	result := atomicOperationResult{OperationID: operation.ID, OperationType: operation.OperationType, Stage: operation.Stage, StartedAt: startedAt.Format(time.RFC3339Nano), FinishedAt: time.Now().UTC().Format(time.RFC3339Nano), Detail: detail}
	if err != nil {
		result.Status = "FAILED"
		result.ErrorCode = "AGENT_ATOMIC_OPERATION_FAILED"
		result.ErrorMessage = err.Error()
		return result
	}
	result.Status = "SUCCEEDED"
	return result
}

func executeWindowsAtomicOperation(ctx context.Context, plan atomicPlan, operation atomicOperation, permissions map[string][]string, dataDir string, ledger *atomicLedger) (map[string]any, error) {
	switch operation.OperationType {
	case "preflight.assert":
		return windowsPreflight(operation.Input, permissions)
	case "file.backup":
		return windowsFileBackup(plan, operation, permissions, dataDir, ledger)
	case "file.atomic_replace":
		return windowsFileReplace(operation, permissions)
	case "file.restore":
		return windowsFileRestore(operation, ledger)
	case "file.set_permissions":
		return windowsFilePermissions(ctx, operation, permissions)
	case "command.execute":
		return windowsCommandExecute(ctx, operation, permissions)
	case "service.control":
		return windowsServiceControl(ctx, operation, permissions)
	case "tls.verify":
		return atomicTLSVerify(operation, permissions)
	case "windows.certificate.inspect_pfx":
		return windowsCertificateInspectPFX(operation, permissions)
	case "windows.certificate_store.import_pfx":
		return windowsCertificateStoreImportPFX(operation, permissions)
	case "windows.certificate_private_key.grant":
		return windowsCertificatePrivateKeyGrant(operation, permissions)
	case "windows.iis.binding.capture":
		return windowsIISBindingCapture(operation, permissions, ledger)
	case "windows.iis.binding.update_certificate":
		return windowsIISBindingUpdate(operation, permissions)
	case "windows.iis.binding.restore_certificate":
		return windowsIISBindingRestore(operation, permissions, ledger)
	default:
		return nil, fmt.Errorf("unsupported atomic operation: %s", operation.OperationType)
	}
}

func windowsCertificateInspectPFX(operation atomicOperation, permissions map[string][]string) (map[string]any, error) {
	input, err := windowsPFXInputFromOperation(operation, permissions)
	if err != nil {
		return nil, err
	}
	result, err := (windowsExecutionHost{timeout: 90 * time.Second}).inspectPFX(input)
	if err != nil {
		return nil, err
	}
	certificateSHA256 := ""
	if result.Certificate != nil {
		certificateSHA256 = certificateFingerprintSHA256(result.Certificate)
	}
	if expected := normalizeSHA256(input.ExpectedCertificateSHA256); expected != "" && certificateSHA256 != expected {
		return nil, fmt.Errorf("PFX certificate fingerprint mismatch: expected=%s actual=%s", expected, certificateSHA256)
	}
	if len(input.ExpectedDomains) > 0 && result.Certificate != nil {
		if err := verifyExpectedDomainsAgainstCertificate(result.Certificate, input.ExpectedDomains); err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"thumbprint":        result.Thumbprint,
		"fingerprintSha256": certificateSHA256,
		"subject":           result.Subject,
		"notAfter":          result.NotAfter,
		"dnsNames":          result.DNSNames,
		"commonName":        result.CommonName,
		"pfxSha256":         result.PFXSHA256,
		"pfxSize":           result.PFXSize,
	}, nil
}

func windowsCertificateStoreImportPFX(operation atomicOperation, permissions map[string][]string) (map[string]any, error) {
	input, err := windowsPFXInputFromOperation(operation, permissions)
	if err != nil {
		return nil, err
	}
	host := windowsExecutionHost{timeout: 90 * time.Second}
	inspection, err := host.inspectPFX(input)
	if err != nil {
		return nil, err
	}
	input.ExpectedThumbprint = inspection.Thumbprint
	if exists, err := windowsCertificateStoreContains(host, inspection.Thumbprint); err != nil {
		return nil, err
	} else if exists {
		return map[string]any{"thumbprint": inspection.Thumbprint, "alreadyPresent": true, "store": "LocalMachine/My"}, nil
	}
	result, err := host.importPFX(input)
	if err != nil {
		return nil, err
	}
	return map[string]any{"thumbprint": result.Thumbprint, "subject": result.Subject, "notAfter": result.NotAfter, "alreadyPresent": false, "store": "LocalMachine/My"}, nil
}

func windowsCertificatePrivateKeyGrant(operation atomicOperation, permissions map[string][]string) (map[string]any, error) {
	input, err := windowsPFXInputFromOperation(operation, permissions)
	if err != nil {
		return nil, err
	}
	appPoolName := atomicString(operation.Input, "appPoolName")
	if appPoolName == "" {
		return map[string]any{"skipped": true, "reason": "appPoolName is empty"}, nil
	}
	account := "IIS AppPool\\" + appPoolName
	if !atomicAllowed(account, permissions["iis"]) && !atomicAllowed(appPoolName, permissions["iis"]) {
		return nil, fmt.Errorf("IIS application pool is not allowed: %s", appPoolName)
	}
	inspection, err := (windowsExecutionHost{timeout: 90 * time.Second}).inspectPFX(input)
	if err != nil {
		return nil, err
	}
	if err := (windowsExecutionHost{timeout: 90 * time.Second}).grantPrivateKeyACL(inspection.Thumbprint, appPoolName); err != nil {
		return nil, err
	}
	return map[string]any{"thumbprint": inspection.Thumbprint, "account": account}, nil
}

func windowsIISBindingCapture(operation atomicOperation, permissions map[string][]string, ledger *atomicLedger) (map[string]any, error) {
	siteName, selector, err := windowsIISBindingInput(operation, permissions)
	if err != nil {
		return nil, err
	}
	_, binding, err := findTargetBinding(windowsExecutionHost{timeout: 90 * time.Second}, windowsIISDeploymentInput{SiteName: siteName, BindingSelector: selector})
	if err != nil {
		return nil, err
	}
	ledger.IISBindingBackups = append(ledger.IISBindingBackups, atomicIISBindingBackup{OperationID: operation.ID, SiteName: siteName, Binding: binding})
	return map[string]any{"siteName": siteName, "bindingInformation": binding.BindingInformation, "certificateThumbprint": binding.CertificateThumbprint}, nil
}

func windowsIISBindingUpdate(operation atomicOperation, permissions map[string][]string) (map[string]any, error) {
	siteName, selector, err := windowsIISBindingInput(operation, permissions)
	if err != nil {
		return nil, err
	}
	input, err := windowsPFXInputFromOperation(operation, permissions)
	if err != nil {
		return nil, err
	}
	host := windowsExecutionHost{timeout: 90 * time.Second}
	inspection, err := host.inspectPFX(input)
	if err != nil {
		return nil, err
	}
	_, binding, err := findTargetBinding(host, windowsIISDeploymentInput{SiteName: siteName, BindingSelector: selector})
	if err != nil {
		return nil, err
	}
	if err := host.updateBindingCertificate(siteName, binding, inspection.Thumbprint); err != nil {
		return nil, err
	}
	return map[string]any{"siteName": siteName, "bindingInformation": binding.BindingInformation, "thumbprint": inspection.Thumbprint}, nil
}

func windowsIISBindingRestore(operation atomicOperation, permissions map[string][]string, ledger *atomicLedger) (map[string]any, error) {
	siteName := atomicString(operation.Input, "siteName")
	if siteName == "" || !atomicAllowed(siteName, permissions["iis"]) {
		return nil, fmt.Errorf("IIS site is not allowed: %s", siteName)
	}
	reference := atomicString(operation.Input, "captureOperationId")
	backup, ok := findAtomicIISBindingBackup(ledger.IISBindingBackups, reference)
	if !ok {
		return nil, fmt.Errorf("IIS binding backup not found: %s", reference)
	}
	if !strings.EqualFold(backup.SiteName, siteName) {
		return nil, errors.New("IIS binding backup site mismatch")
	}
	if err := (windowsExecutionHost{timeout: 90 * time.Second}).restoreBindingCertificate(siteName, backup.Binding); err != nil {
		return nil, err
	}
	return map[string]any{"siteName": siteName, "bindingInformation": backup.Binding.BindingInformation, "thumbprint": backup.Binding.CertificateThumbprint}, nil
}

func windowsPFXInputFromOperation(operation atomicOperation, permissions map[string][]string) (windowsIISDeploymentInput, error) {
	store := firstAtomicString(operation.Input, "store", "certificateStore")
	if store == "" {
		store = "LocalMachine/My"
	}
	if !atomicAllowed(store, permissions["certificate_store"]) {
		return windowsIISDeploymentInput{}, fmt.Errorf("certificate store is not allowed: %s", store)
	}
	artifact, _ := operation.Input["artifact"].(map[string]any)
	input := windowsIISDeploymentInput{
		PFXPath:                   firstAtomicString(operation.Input, "pfxPath"),
		PFXBase64:                 firstAtomicString(operation.Input, "pfxBase64"),
		PFXPassword:               firstAtomicString(operation.Input, "pfxPassword"),
		ExpectedCertificateSHA256: firstAtomicString(operation.Input, "expectedFingerprintSha256", "expectedCertificateFingerprintSha256"),
		ExpectedDomains:           atomicStringSlice(operation.Input["expectedDomains"]),
	}
	if artifact != nil {
		if input.PFXPath == "" {
			input.PFXPath = firstAtomicString(artifact, "pfxPath", "path")
		}
		if input.PFXBase64 == "" {
			input.PFXBase64 = firstAtomicString(artifact, "pfxBase64", "contentBase64")
		}
		if input.PFXPassword == "" {
			input.PFXPassword = firstAtomicString(artifact, "pfxPassword", "password")
		}
		if input.ExpectedCertificateSHA256 == "" {
			input.ExpectedCertificateSHA256 = firstAtomicString(artifact, "expectedFingerprintSha256", "fingerprintSha256")
		}
	}
	if input.PFXPath == "" && input.PFXBase64 == "" {
		return windowsIISDeploymentInput{}, errors.New("PFX artifact is required")
	}
	return input, nil
}

func windowsIISBindingInput(operation atomicOperation, permissions map[string][]string) (string, bindingSelector, error) {
	siteName := atomicString(operation.Input, "siteName")
	if siteName == "" || !atomicAllowed(siteName, permissions["iis"]) {
		return "", bindingSelector{}, fmt.Errorf("IIS site is not allowed: %s", siteName)
	}
	selectorMap, _ := operation.Input["bindingSelector"].(map[string]any)
	if selectorMap == nil {
		selectorMap = operation.Input
	}
	selector := bindingSelector{
		IP:                 firstAtomicString(selectorMap, "ip", "ipAddress"),
		Port:               atomicInt(selectorMap, "port"),
		HostHeader:         atomicString(selectorMap, "hostHeader"),
		BindingInformation: atomicString(selectorMap, "bindingInformation"),
	}
	if selector.Port == 0 {
		selector.Port = 443
	}
	return siteName, selector, nil
}

func windowsCertificateStoreContains(host windowsExecutionHost, thumbprint string) (bool, error) {
	script := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
$certificate = Get-Item -LiteralPath ("Cert:\LocalMachine\My\" + %s) -ErrorAction SilentlyContinue
[pscustomobject]@{ success = $true; exists = ($null -ne $certificate) } | ConvertTo-Json -Compress
`, psSingleQuoted(normalizeThumbprint(thumbprint)))
	var result struct {
		Success bool `json:"success"`
		Exists  bool `json:"exists"`
	}
	if err := host.runPowerShellJSON(script, &result); err != nil {
		return false, err
	}
	return result.Success && result.Exists, nil
}

func windowsPreflight(input map[string]any, permissions map[string][]string) (map[string]any, error) {
	path := atomicString(input, "path")
	if path != "" {
		if err := validateAtomicPath(path, permissions["filesystem"]); err != nil {
			return nil, err
		}
		_, err := os.Stat(path)
		if atomicBool(input, "mustExist") && err != nil {
			return nil, err
		}
	}
	program := atomicString(input, "program")
	if program != "" {
		if !atomicAllowed(program, permissions["process"]) {
			return nil, fmt.Errorf("program is not allowed: %s", program)
		}
		if _, err := os.Stat(program); err != nil {
			return nil, err
		}
	}
	return map[string]any{"passed": true}, nil
}

func windowsFileBackup(plan atomicPlan, operation atomicOperation, permissions map[string][]string, dataDir string, ledger *atomicLedger) (map[string]any, error) {
	target := firstAtomicString(operation.Input, "path", "targetPath")
	if err := validateAtomicPath(target, permissions["filesystem"]); err != nil {
		return nil, err
	}
	info, err := os.Lstat(target)
	backup := atomicBackup{OperationID: operation.ID, TargetPath: target}
	if os.IsNotExist(err) {
		ledger.Backups = append(ledger.Backups, backup)
		return map[string]any{"existed": false}, nil
	}
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return nil, errors.New("symbolic link or reparse point is not allowed")
	}
	backupDir := filepath.Join(dataDir, "atomic-backups", plan.PlanID)
	if err := os.MkdirAll(backupDir, 0o700); err != nil {
		return nil, err
	}
	backup.BackupPath = filepath.Join(backupDir, operation.ID+"-"+filepath.Base(target))
	backup.Existed = true
	backup.Mode = uint32(info.Mode().Perm())
	if err := copyAtomicFile(target, backup.BackupPath, info.Mode().Perm()); err != nil {
		return nil, err
	}
	ledger.Backups = append(ledger.Backups, backup)
	return map[string]any{"existed": true, "backupPath": backup.BackupPath, "size": info.Size()}, nil
}

func windowsFileReplace(operation atomicOperation, permissions map[string][]string) (map[string]any, error) {
	target := firstAtomicString(operation.Input, "path", "targetPath")
	if err := validateAtomicPath(target, permissions["filesystem"]); err != nil {
		return nil, err
	}
	content, err := atomicContent(operation.Input)
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
	if err := windowsReplaceFile(temporaryPath, target); err != nil {
		return nil, err
	}
	digest := sha256.Sum256(content)
	return map[string]any{"path": target, "bytes": len(content), "sha256": hex.EncodeToString(digest[:])}, nil
}

func windowsReplaceFile(source, target string) error {
	moveFileEx := syscall.NewLazyDLL("kernel32.dll").NewProc("MoveFileExW")
	sourcePointer, _ := syscall.UTF16PtrFromString(source)
	targetPointer, _ := syscall.UTF16PtrFromString(target)
	const moveFileReplaceExisting = 0x1
	const moveFileWriteThrough = 0x8
	result, _, callErr := moveFileEx.Call(uintptr(unsafePointer(sourcePointer)), uintptr(unsafePointer(targetPointer)), moveFileReplaceExisting|moveFileWriteThrough)
	if result == 0 {
		return callErr
	}
	return nil
}

func unsafePointer(value *uint16) uintptr { return uintptr(unsafe.Pointer(value)) }

func windowsFileRestore(operation atomicOperation, ledger *atomicLedger) (map[string]any, error) {
	reference := atomicString(operation.Input, "backupOperationId")
	backup, ok := findAtomicBackup(ledger.Backups, reference)
	if !ok {
		return nil, fmt.Errorf("backup not found: %s", reference)
	}
	if !backup.Existed {
		if err := os.Remove(backup.TargetPath); err != nil && !os.IsNotExist(err) {
			return nil, err
		}
		return map[string]any{"removed": backup.TargetPath}, nil
	}
	content, err := os.ReadFile(backup.BackupPath)
	if err != nil {
		return nil, err
	}
	operation.Input = map[string]any{"targetPath": backup.TargetPath, "content": string(content)}
	return windowsFileReplace(operation, map[string][]string{"filesystem": {backup.TargetPath}})
}

func windowsFilePermissions(ctx context.Context, operation atomicOperation, permissions map[string][]string) (map[string]any, error) {
	path := firstAtomicString(operation.Input, "path", "targetPath")
	if err := validateAtomicPath(path, permissions["filesystem"]); err != nil {
		return nil, err
	}
	acl := atomicString(operation.Input, "acl")
	if acl == "" {
		return map[string]any{"unchanged": true}, nil
	}
	return runAtomicCommand(ctx, "icacls.exe", []string{path, "/grant:r", acl}, 30*time.Second)
}

func windowsCommandExecute(ctx context.Context, operation atomicOperation, permissions map[string][]string) (map[string]any, error) {
	program := atomicString(operation.Input, "program")
	if !atomicAllowed(program, permissions["process"]) {
		return nil, fmt.Errorf("program is not allowed: %s", program)
	}
	if shell, ok := operation.Input["shell"].(map[string]any); ok && atomicBool(shell, "enabled") {
		return nil, errors.New("shell mode is disabled")
	}
	args := atomicStringSlice(operation.Input["args"])
	timeout := time.Duration(operation.TimeoutSeconds) * time.Second
	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	return runAtomicCommand(ctx, program, args, timeout)
}

func windowsServiceControl(ctx context.Context, operation atomicOperation, permissions map[string][]string) (map[string]any, error) {
	serviceName := firstAtomicString(operation.Input, "service", "serviceName")
	if !atomicAllowed(serviceName, permissions["service"]) {
		return nil, fmt.Errorf("service is not allowed: %s", serviceName)
	}
	action := strings.ToLower(atomicString(operation.Input, "action"))
	switch action {
	case "status":
		return runAtomicCommand(ctx, "sc.exe", []string{"query", serviceName}, 30*time.Second)
	case "start":
		return runAtomicCommand(ctx, "sc.exe", []string{"start", serviceName}, 30*time.Second)
	case "stop":
		return runAtomicCommand(ctx, "sc.exe", []string{"stop", serviceName}, 30*time.Second)
	case "restart", "reload":
		_, _ = runAtomicCommand(ctx, "sc.exe", []string{"stop", serviceName}, 30*time.Second)
		return runAtomicCommand(ctx, "sc.exe", []string{"start", serviceName}, 30*time.Second)
	default:
		return nil, fmt.Errorf("unsupported service action: %s", action)
	}
}

func runAtomicCommand(ctx context.Context, program string, args []string, timeout time.Duration) (map[string]any, error) {
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
	if err != nil {
		return detail, err
	}
	return detail, nil
}

func atomicTLSVerify(operation atomicOperation, permissions map[string][]string) (map[string]any, error) {
	host := atomicString(operation.Input, "host")
	port := atomicInt(operation.Input, "port")
	target := net.JoinHostPort(host, strconv.Itoa(port))
	if !atomicAllowed(target, permissions["network"]) {
		return nil, fmt.Errorf("network target is not allowed: %s", target)
	}
	sni := firstAtomicString(operation.Input, "sni", "serverName")
	if sni == "" {
		sni = host
	}
	expected := strings.ToLower(strings.ReplaceAll(atomicString(operation.Input, "expectedFingerprint"), ":", ""))
	skipChainValidation := atomicBool(operation.Input, "skipChainValidation")
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
	return map[string]any{"fingerprintSha256": actual, "serialNumber": certificate.SerialNumber.String(), "subject": certificate.Subject.String(), "dnsNames": certificate.DNSNames, "notBefore": certificate.NotBefore.UTC().Format(time.RFC3339), "notAfter": certificate.NotAfter.UTC().Format(time.RFC3339), "tlsVersion": tlsVersionName(connection.ConnectionState().Version)}, nil
}

func parseAtomicPlan(payload map[string]any) (atomicPlan, error) {
	value := any(payload)
	if nested, ok := payload["plan"].(map[string]any); ok {
		value = nested
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return atomicPlan{}, err
	}
	var plan atomicPlan
	if err := json.Unmarshal(encoded, &plan); err != nil {
		return atomicPlan{}, err
	}
	if plan.APIVersion != "gcac.agent-plan/v1" || plan.PlanID == "" || plan.IdempotencyKey == "" {
		return atomicPlan{}, errors.New("invalid atomic execution plan")
	}
	return plan, nil
}

func verifyAtomicPlan(plan atomicPlan) error {
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
	canonical, err := canonicalAtomicJSON(unsigned)
	if err != nil {
		return err
	}
	mac := hmac.New(sha256.New, []byte(atomicPlanSigningKey()))
	_, _ = mac.Write(canonical)
	expected := hex.EncodeToString(mac.Sum(nil))
	if !hmac.Equal([]byte(strings.ToLower(signature)), []byte(expected)) {
		return errors.New("atomic plan signature mismatch")
	}
	return nil
}

func atomicPlanSigningKey() string {
	if value := strings.TrimSpace(os.Getenv("GCAC_AGENT_PLAN_SIGNING_KEY")); value != "" {
		return value
	}
	return "gcac-development-agent-plan-key"
}

func canonicalAtomicJSON(value any) ([]byte, error) {
	var normalized any
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(raw, &normalized); err != nil {
		return nil, err
	}
	return []byte(renderCanonicalJSON(normalized)), nil
}

func renderCanonicalJSON(value any) string {
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
			parts = append(parts, string(keyJSON)+":"+renderCanonicalJSON(current[key]))
		}
		return "{" + strings.Join(parts, ",") + "}"
	case []any:
		parts := make([]string, len(current))
		for index, item := range current {
			parts[index] = renderCanonicalJSON(item)
		}
		return "[" + strings.Join(parts, ",") + "]"
	default:
		raw, _ := json.Marshal(current)
		return string(raw)
	}
}

func atomicPermissionMap(permissions []atomicPermission) map[string][]string {
	result := map[string][]string{}
	for _, permission := range permissions {
		result[permission.Scope] = append(result[permission.Scope], permission.Values...)
	}
	return result
}
func atomicAllowed(value string, patterns []string) bool {
	clean := filepath.Clean(value)
	for _, pattern := range patterns {
		if pattern == value || filepath.Clean(pattern) == clean || (strings.HasSuffix(pattern, "*") && strings.HasPrefix(value, strings.TrimSuffix(pattern, "*"))) {
			return true
		}
	}
	return false
}
func validateAtomicPath(path string, patterns []string) error {
	if path == "" || !filepath.IsAbs(path) {
		return errors.New("absolute path is required")
	}
	info, err := os.Lstat(path)
	if err == nil && info.Mode()&os.ModeSymlink != 0 {
		return errors.New("symbolic link or reparse point is not allowed")
	}
	if !atomicAllowed(path, patterns) {
		return fmt.Errorf("path is outside allowed roots: %s", path)
	}
	return nil
}
func atomicString(input map[string]any, key string) string {
	value, _ := input[key].(string)
	return strings.TrimSpace(value)
}
func firstAtomicString(input map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := atomicString(input, key); value != "" {
			return value
		}
	}
	return ""
}
func atomicBool(input map[string]any, key string) bool { value, _ := input[key].(bool); return value }
func atomicInt(input map[string]any, key string) int {
	switch value := input[key].(type) {
	case float64:
		return int(value)
	case int:
		return value
	case json.Number:
		number, _ := value.Int64()
		return int(number)
	}
	return 0
}
func atomicStringSlice(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		if values, ok := value.([]string); ok {
			return values
		}
		return nil
	}
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if text, ok := item.(string); ok {
			result = append(result, text)
		}
	}
	return result
}
func atomicContent(input map[string]any) ([]byte, error) {
	if content, ok := input["content"].(string); ok {
		return []byte(content), nil
	}
	if content, ok := input["contentBase64"].(string); ok {
		return base64.StdEncoding.DecodeString(content)
	}
	if artifact, ok := input["artifact"].(map[string]any); ok {
		if content, ok := artifact["content"].(string); ok {
			return []byte(content), nil
		}
		if content, ok := artifact["contentBase64"].(string); ok {
			return base64.StdEncoding.DecodeString(content)
		}
	}
	return nil, errors.New("file content is required")
}
func findAtomicBackup(backups []atomicBackup, operationID string) (atomicBackup, bool) {
	for _, backup := range backups {
		if backup.OperationID == operationID {
			return backup, true
		}
	}
	return atomicBackup{}, false
}
func findAtomicIISBindingBackup(backups []atomicIISBindingBackup, operationID string) (atomicIISBindingBackup, bool) {
	for _, backup := range backups {
		if backup.OperationID == operationID {
			return backup, true
		}
	}
	return atomicIISBindingBackup{}, false
}
func containsAtomicString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
func copyAtomicFile(source, target string, mode os.FileMode) error {
	content, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
		return err
	}
	return os.WriteFile(target, content, mode)
}
func loadAtomicLedger(path string) (*atomicLedger, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var ledger atomicLedger
	if err := json.Unmarshal(content, &ledger); err != nil {
		return nil, err
	}
	return &ledger, nil
}
func saveAtomicLedger(path string, ledger atomicLedger) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	content, err := json.MarshalIndent(ledger, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, content, 0o600); err != nil {
		return err
	}
	return windowsReplaceFile(temporary, path)
}
func atomicLedgerDetail(ledger atomicLedger, cached bool) map[string]any {
	return map[string]any{"planId": ledger.PlanID, "state": ledger.State, "cached": cached, "operationResults": ledger.OperationResults, "rollbackResults": ledger.RollbackResults, "completedOperations": ledger.CompletedOperations}
}
func tlsVersionName(version uint16) string {
	switch version {
	case tls.VersionTLS13:
		return "TLS1.3"
	case tls.VersionTLS12:
		return "TLS1.2"
	default:
		return fmt.Sprintf("0x%x", version)
	}
}
