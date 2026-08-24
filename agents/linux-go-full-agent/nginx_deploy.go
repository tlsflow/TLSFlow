package main

import (
	"context"
	"crypto"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode"

	"gcac/linux-go-full-agent/internal/core/recovery"
)

type linuxNginxDeployInput struct {
	Operation       string                    `json:"operation"`
	ProviderType    string                    `json:"providerType"`
	BindingSelector linuxNginxBindingSelector `json:"bindingSelector"`
	Artifact        linuxNginxArtifact        `json:"artifact"`
	ExecutionPolicy linuxNginxExecutionPolicy `json:"executionPolicy"`
	DryRun          bool                      `json:"dryRun"`
	StepType        string                    `json:"stepType"`
	ExecutionRunID  string                    `json:"executionRunId"`
	SourceRunID     string                    `json:"sourceRunId"`
	RollbackContext linuxNginxRollbackContext `json:"rollbackContext"`
}

type linuxNginxBindingSelector struct {
	SiteAssetID string   `json:"siteAssetId"`
	BindingID   string   `json:"bindingId"`
	SourceFile  string   `json:"sourceFile"`
	ListenPort  int      `json:"listenPort"`
	ServerNames []string `json:"serverNames"`
	CertPath    string   `json:"certPath"`
	KeyPath     string   `json:"keyPath"`
}

type linuxNginxArtifact struct {
	CertificatePEM          string `json:"certificatePem"`
	PrivateKeyPEM           string `json:"privateKeyPem"`
	TargetFingerprintSHA256 string `json:"targetFingerprintSha256"`
}

type linuxNginxExecutionPolicy struct {
	TestCommand   string `json:"testCommand"`
	ReloadCommand string `json:"reloadCommand"`
	HelperCommand string `json:"helperCommand"`
	VerifyHost    string `json:"verifyHost"`
	VerifyPort    int    `json:"verifyPort"`
	HostHeader    string `json:"hostHeader"`
	VerifyURL     string `json:"verifyUrl"`
}

type parsedLinuxNginxArtifact struct {
	certificate       *x509.Certificate
	certificateSHA256 string
	privateKeySigner  crypto.Signer
	privateKeyType    string
}

type linuxNginxTargetFileState struct {
	path               string
	exists             bool
	regularFile        bool
	readable           bool
	directReadable     bool
	writable           bool
	parentDir          string
	parentDirExists    bool
	parentDirWritable  bool
	mode               string
	certificateSHA256  string
	certificateSubject string
	privateKeyType     string
	matchesTarget      bool
	parseError         string
}

type linuxNginxDryRunState struct {
	sourceFile linuxNginxTargetFileState
	certFile   linuxNginxTargetFileState
	keyFile    linuxNginxTargetFileState
}

type linuxNginxRollbackContext struct {
	SourceRunID            string         `json:"sourceRunId"`
	SourceStepID           string         `json:"sourceStepId"`
	BackupManifestPath     string         `json:"backupManifestPath"`
	BackupManifest         map[string]any `json:"backupManifest"`
	RollbackCertificateSHA string         `json:"rollbackCertificateSha256,omitempty"`
	InstalledCertificateID string         `json:"installedCertificateSha256"`
}

type linuxNginxBackupManifest struct {
	TaskID                  string                  `json:"taskId"`
	ExecutionRunID          string                  `json:"executionRunId"`
	SourceRunID             string                  `json:"sourceRunId,omitempty"`
	BindingID               string                  `json:"bindingId"`
	SiteAssetID             string                  `json:"siteAssetId,omitempty"`
	CreatedAt               string                  `json:"createdAt"`
	CertificateSHA256       string                  `json:"certificateSha256"`
	TargetCertificateSHA256 string                  `json:"targetCertificateSha256,omitempty"`
	CertPath                string                  `json:"certPath"`
	KeyPath                 string                  `json:"keyPath"`
	CertBackup              linuxNginxBackupFileRef `json:"certBackup"`
	KeyBackup               linuxNginxBackupFileRef `json:"keyBackup"`
	PrivilegeAssessment     map[string]any          `json:"privilegeAssessment,omitempty"`
}

type linuxNginxBackupFileRef struct {
	TargetPath                   string `json:"targetPath"`
	BackupPath                   string `json:"backupPath,omitempty"`
	Existed                      bool   `json:"existed"`
	Mode                         string `json:"mode,omitempty"`
	UsedPrivilege                string `json:"usedPrivilege,omitempty"`
	ContentSHA256                string `json:"contentSha256,omitempty"`
	CertificateFingerprintSHA256 string `json:"certificateFingerprintSha256,omitempty"`
}

var (
	executeShellCommandFunc    = executeShellCommand
	executeCommandWithSudoFunc = executeCommandWithSudo
	executeHelperCommandFunc   = executeHelperCommand
	probeSudoNoPasswordFunc    = probeSudoNoPassword
	currentEUIDFunc            = os.Geteuid
	lookPathFunc               = lookPath
	canReadPathFunc            = canReadPath
	canWritePathFunc           = canWritePath
	canWriteDirFunc            = canWriteDir
	atomicWritePEMFileFunc     = atomicWritePEMFile
	readFileWithHelperFunc     = readFileWithHelper
	readFileWithSudoFunc       = readFileWithSudo
	removeFileWithHelperFunc   = removeFileWithHelper
	removeFileWithSudoFunc     = removeFileWithSudo
	pathExistsWithHelperFunc   = pathExistsWithHelper
	pathExistsWithSudoFunc     = pathExistsWithSudo
)

func parseLinuxNginxDeployInput(payload map[string]any) (linuxNginxDeployInput, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return linuxNginxDeployInput{}, err
	}
	var input linuxNginxDeployInput
	if err := json.Unmarshal(raw, &input); err != nil {
		return linuxNginxDeployInput{}, err
	}
	return input, nil
}

func isLinuxNginxDryRun(input linuxNginxDeployInput) bool {
	if input.DryRun {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(input.Operation), "dryRun")
}

func normalizeLinuxNginxOperation(input linuxNginxDeployInput) string {
	if isLinuxNginxDryRun(input) {
		return "dryRun"
	}
	if stepType := strings.ToUpper(strings.TrimSpace(input.StepType)); stepType != "" {
		switch stepType {
		case "DISCOVER":
			return "dryRun"
		case "BACKUP":
			return "backup"
		case "INSTALL":
			return "install"
		case "RELOAD":
			return "reload"
		case "VERIFY":
			return "verify"
		case "ROLLBACK":
			return "rollback"
		}
	}
	operation := strings.TrimSpace(input.Operation)
	if operation == "" {
		return "install"
	}
	return operation
}

func runLinuxNginxDeployment(taskID string, input linuxNginxDeployInput) (bool, string, string, map[string]any) {
	baseDir, err := resolveLinuxNginxBackupBaseDir()
	if err != nil {
		return false, "RECOVERY_LEDGER_FAILED", err.Error(), map[string]any{"taskId": taskID}
	}
	ledgerPath := filepath.Join(baseDir, "operations", sanitizePathComponent(taskID)+".json")
	ledger, err := recovery.Start(ledgerPath, recovery.Entry{
		OperationID: taskID,
		ActionType:  "linux.nginx.deploy_certificate",
		AuditID:     firstNonEmpty(input.ExecutionRunID, taskID),
		BeforeState: map[string]any{
			"certPath": input.BindingSelector.CertPath,
			"keyPath":  input.BindingSelector.KeyPath,
		},
		Files: []recovery.FileState{
			{Path: input.BindingSelector.CertPath},
			{Path: input.BindingSelector.KeyPath},
		},
	})
	if err != nil {
		return false, "RECOVERY_LEDGER_FAILED", err.Error(), map[string]any{"taskId": taskID, "recoveryLedgerPath": ledgerPath}
	}
	operation := normalizeLinuxNginxOperation(input)
	_ = ledger.CompleteStep("prepared:" + operation)
	success, errorCode, errorMessage, detail := runLinuxNginxDeploymentInternal(taskID, input)
	if detail == nil {
		detail = map[string]any{}
	}
	detail["recoveryLedgerPath"] = ledgerPath
	if success {
		_ = ledger.CompleteStep("completed:" + operation)
		_ = ledger.Complete()
		return success, errorCode, errorMessage, detail
	}
	_ = ledger.Fail(operation, errorCode, errorMessage)
	if operation == "rollback" || detail["rollback"] != nil || detail["rollbackResult"] != nil {
		_ = ledger.RecordRecovery([]string{"product-rollback"}, "attempted", errorMessage)
	}
	return success, errorCode, errorMessage, detail
}

func runLinuxNginxDeploymentInternal(taskID string, input linuxNginxDeployInput) (bool, string, string, map[string]any) {
	operation := normalizeLinuxNginxOperation(input)
	switch strings.ToLower(strings.TrimSpace(operation)) {
	case "dryrun":
		return runLinuxNginxDryRun(taskID, input)
	case "backup":
		return runLinuxNginxBackup(taskID, input)
	case "install":
		return runLinuxNginxInstall(taskID, input)
	case "reload":
		return runLinuxNginxReload(taskID, input)
	case "verify":
		return runLinuxNginxVerify(taskID, input)
	case "rollback":
		return runLinuxNginxRollback(taskID, input)
	default:
		return false, "UNSUPPORTED_OPERATION", "Linux NGINX Provider 不支持该 operation", map[string]any{
			"taskId":         taskID,
			"executor":       "linux-nginx-provider",
			"operation":      operation,
			"supportedModes": []string{"dryRun", "backup", "install", "reload", "verify", "rollback"},
		}
	}
}

func runLinuxNginxDryRun(taskID string, input linuxNginxDeployInput) (bool, string, string, map[string]any) {
	checks := make([]map[string]any, 0, 16)
	blockers := make([]map[string]any, 0)
	warnings := make([]map[string]any, 0)
	plannedChanges := make([]map[string]any, 0, 8)

	checks = append(checks, evaluateBindingSelectorCheck(input.BindingSelector))
	artifactChecks, parsedArtifact := evaluatePEMArtifactChecks(input.Artifact)
	checks = append(checks, artifactChecks...)
	privilegeEvidence, privilegeChecks := evaluateLinuxNginxPrivilegeChecks(input)
	checks = append(checks, privilegeChecks...)
	checks = append(checks, evaluatePathChecks(input.BindingSelector, privilegeEvidence)...)
	dryRunState, stateChecks := evaluateLinuxNginxTargetState(input.BindingSelector, parsedArtifact, input.ExecutionPolicy.HelperCommand, privilegeEvidence)
	checks = append(checks, stateChecks...)
	checks = append(checks, evaluateVerifyEndpointCheck(input.ExecutionPolicy))

	for _, check := range checks {
		status := strings.TrimSpace(stringFromAny(check["status"]))
		switch status {
		case "failed":
			blockers = append(blockers, map[string]any{
				"key":    check["key"],
				"label":  check["label"],
				"detail": check["detail"],
			})
		case "warning":
			warnings = append(warnings, map[string]any{
				"key":    check["key"],
				"label":  check["label"],
				"detail": check["detail"],
			})
		}
	}

	plannedChanges = append(plannedChanges, buildLinuxNginxPlannedChanges(input, dryRunState)...)

	detail := map[string]any{
		"executor":       "linux-nginx-provider",
		"mode":           "nginx_dry_run_preflight",
		"taskId":         taskID,
		"providerType":   "NGINX",
		"operation":      "dryRun",
		"executable":     len(blockers) == 0,
		"blockers":       blockers,
		"warnings":       warnings,
		"plannedChanges": plannedChanges,
		"bindingSelector": map[string]any{
			"siteAssetId": input.BindingSelector.SiteAssetID,
			"bindingId":   input.BindingSelector.BindingID,
			"sourceFile":  input.BindingSelector.SourceFile,
			"listenPort":  input.BindingSelector.ListenPort,
			"serverNames": input.BindingSelector.ServerNames,
			"certPath":    input.BindingSelector.CertPath,
			"keyPath":     input.BindingSelector.KeyPath,
		},
		"artifact": map[string]any{
			"targetFingerprintSha256": input.Artifact.TargetFingerprintSHA256,
			"certificatePemBytes":     len([]byte(input.Artifact.CertificatePEM)),
			"privateKeyPemBytes":      len([]byte(input.Artifact.PrivateKeyPEM)),
			"privateKeyType":          parsedArtifact.privateKeyType,
		},
		"currentState": map[string]any{
			"sourceFile": mapFromLinuxNginxTargetFileState(dryRunState.sourceFile),
			"certFile":   mapFromLinuxNginxTargetFileState(dryRunState.certFile),
			"keyFile":    mapFromLinuxNginxTargetFileState(dryRunState.keyFile),
		},
		"executionPolicy": map[string]any{
			"testCommand":   input.ExecutionPolicy.TestCommand,
			"reloadCommand": input.ExecutionPolicy.ReloadCommand,
			"verifyHost":    input.ExecutionPolicy.VerifyHost,
			"verifyPort":    input.ExecutionPolicy.VerifyPort,
			"hostHeader":    input.ExecutionPolicy.HostHeader,
			"verifyUrl":     input.ExecutionPolicy.VerifyURL,
		},
		"privilegeAssessment": privilegeEvidence,
		"dryRunChecks":        checks,
		"dryRunSummary":       summarizeDryRunChecks(checks),
	}

	if len(blockers) > 0 {
		return false, "NGINX_DRY_RUN_FAILED", "Linux NGINX dry-run 预检未通过", detail
	}
	return true, "", "", detail
}

func runLinuxNginxBackup(taskID string, input linuxNginxDeployInput) (bool, string, string, map[string]any) {
	preflight, errorCode, errorMessage, preflightDetail := runLinuxNginxDryRun(taskID, input)
	if !preflight {
		return false, errorCode, errorMessage, preflightDetail
	}
	manifest, detail, err := createLinuxNginxBackupManifest(taskID, input)
	if err != nil {
		return false, "NGINX_BACKUP_FAILED", err.Error(), detail
	}
	return true, "", "", map[string]any{
		"executor":            "linux-nginx-provider",
		"mode":                "nginx_backup_completed",
		"taskId":              taskID,
		"operation":           "backup",
		"backupManifestPath":  detail["backupManifestPath"],
		"backupManifest":      manifestToMap(manifest),
		"privilegeAssessment": detail["privilegeAssessment"],
	}
}

func runLinuxNginxInstall(taskID string, input linuxNginxDeployInput) (bool, string, string, map[string]any) {
	preflight, errorCode, errorMessage, preflightDetail := runLinuxNginxDryRun(taskID, input)
	if !preflight {
		return false, errorCode, errorMessage, preflightDetail
	}
	manifest, backupDetail, err := createLinuxNginxBackupManifest(taskID, input)
	if err != nil {
		return false, "NGINX_BACKUP_FAILED", err.Error(), backupDetail
	}

	artifactChecks, parsedArtifact := evaluatePEMArtifactChecks(input.Artifact)
	for _, check := range artifactChecks {
		if strings.TrimSpace(stringFromAny(check["status"])) == "failed" {
			return false, "TASK_PAYLOAD_INVALID", "安装前部署材料校验失败", map[string]any{
				"executor":       "linux-nginx-provider",
				"mode":           "nginx_install_rejected",
				"taskId":         taskID,
				"operation":      "install",
				"artifactChecks": artifactChecks,
			}
		}
	}

	writeCommands := make([]map[string]any, 0, 2)
	certWriteMode, err := atomicWritePEMFileWithPrivilege(input.BindingSelector.CertPath, []byte(input.Artifact.CertificatePEM), input)
	if err != nil {
		return rollbackAfterInstallFailure(taskID, input, manifest, "CERT_WRITE_FAILED", fmt.Sprintf("写入证书文件失败: %v", err), map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_install_failed",
			"taskId":             taskID,
			"backupManifestPath": backupDetail["backupManifestPath"],
			"backupManifest":     manifestToMap(manifest),
		})
	}
	writeCommands = append(writeCommands, map[string]any{
		"type":          "write_certificate_file",
		"path":          input.BindingSelector.CertPath,
		"bytes":         len([]byte(input.Artifact.CertificatePEM)),
		"atomic":        true,
		"usedPrivilege": certWriteMode,
	})
	keyWriteMode, err := atomicWritePEMFileWithPrivilege(input.BindingSelector.KeyPath, []byte(input.Artifact.PrivateKeyPEM), input)
	if err != nil {
		return rollbackAfterInstallFailure(taskID, input, manifest, "KEY_WRITE_FAILED", fmt.Sprintf("写入私钥文件失败: %v", err), map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_install_failed",
			"taskId":             taskID,
			"backupManifestPath": backupDetail["backupManifestPath"],
			"backupManifest":     manifestToMap(manifest),
		})
	}
	writeCommands = append(writeCommands, map[string]any{
		"type":          "write_private_key_file",
		"path":          input.BindingSelector.KeyPath,
		"bytes":         len([]byte(input.Artifact.PrivateKeyPEM)),
		"atomic":        true,
		"usedPrivilege": keyWriteMode,
	})
	installedState := inspectCertificateFileState(input.BindingSelector.CertPath, input.Artifact.TargetFingerprintSHA256, input.ExecutionPolicy.HelperCommand)
	installedFingerprint := installedState.certificateSHA256
	if installedFingerprint == "" {
		return rollbackAfterInstallFailure(taskID, input, manifest, "INSTALLED_CERT_READ_FAILED", "证书写入后无法读取目标 certPath 的证书指纹", map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_install_failed",
			"taskId":             taskID,
			"backupManifestPath": backupDetail["backupManifestPath"],
			"backupManifest":     manifestToMap(manifest),
			"installedFile": map[string]any{
				"certFile": mapFromLinuxNginxTargetFileState(installedState),
			},
		})
	}
	if expected := normalizeHexFingerprint(input.Artifact.TargetFingerprintSHA256); expected != "" && installedFingerprint != expected {
		return rollbackAfterInstallFailure(taskID, input, manifest, "INSTALLED_CERT_FINGERPRINT_MISMATCH", "证书写入后目标 certPath 指纹与部署产物指纹不一致", map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_install_failed",
			"taskId":             taskID,
			"backupManifestPath": backupDetail["backupManifestPath"],
			"backupManifest":     manifestToMap(manifest),
			"expectedSha256":     expected,
			"actualSha256":       installedFingerprint,
			"installedFile": map[string]any{
				"certFile": mapFromLinuxNginxTargetFileState(installedState),
			},
		})
	}

	return true, "", "", map[string]any{
		"executor":                   "linux-nginx-provider",
		"mode":                       "nginx_install_completed",
		"taskId":                     taskID,
		"operation":                  "install",
		"backupManifestPath":         backupDetail["backupManifestPath"],
		"backupManifest":             manifestToMap(manifest),
		"installedCertificateSha256": installedFingerprint,
		"newThumbprint":              strings.ToUpper(formatThumbprintSha1(parsedArtifact.certificate)),
		"writeCommands":              writeCommands,
		"privilegeAssessment":        backupDetail["privilegeAssessment"],
		"fileWriteMode":              mergeLinuxNginxPrivilegeMode(certWriteMode, keyWriteMode),
		"installedFile": map[string]any{
			"certFile": mapFromLinuxNginxTargetFileState(installedState),
		},
	}
}

func runLinuxNginxReload(taskID string, input linuxNginxDeployInput) (bool, string, string, map[string]any) {
	testResult, testMode, testErr := executeControlledCommandWithPrivilege(input.ExecutionPolicy.TestCommand, true)
	if testErr != nil || !testResult.Success {
		return false, classifyCommandFailure("NGINX_TEST_FAILED", testResult), "执行 reload 前 nginx -t 失败", map[string]any{
			"executor":    "linux-nginx-provider",
			"mode":        "nginx_reload_failed",
			"taskId":      taskID,
			"operation":   "reload",
			"testCommand": mapFromCommandResult(testResult, testMode),
		}
	}
	reloadResult, reloadMode, reloadErr := executeControlledCommandWithPrivilege(input.ExecutionPolicy.ReloadCommand, true)
	if reloadErr != nil || !reloadResult.Success {
		return false, classifyCommandFailure("NGINX_RELOAD_FAILED", reloadResult), "执行 NGINX reload 失败", map[string]any{
			"executor":      "linux-nginx-provider",
			"mode":          "nginx_reload_failed",
			"taskId":        taskID,
			"operation":     "reload",
			"testCommand":   mapFromCommandResult(testResult, testMode),
			"reloadCommand": mapFromCommandResult(reloadResult, reloadMode),
		}
	}
	return true, "", "", map[string]any{
		"executor":      "linux-nginx-provider",
		"mode":          "nginx_reload_completed",
		"taskId":        taskID,
		"operation":     "reload",
		"testCommand":   mapFromCommandResult(testResult, testMode),
		"reloadCommand": mapFromCommandResult(reloadResult, reloadMode),
	}
}

func runLinuxNginxVerify(taskID string, input linuxNginxDeployInput) (bool, string, string, map[string]any) {
	return true, "", "", map[string]any{
		"executor":  "linux-nginx-provider",
		"mode":      "nginx_verify_delegated",
		"taskId":    taskID,
		"operation": "verify",
		"verify": map[string]any{
			"delegatedTo":               "control-plane",
			"reason":                    "远端 TLS 验证必须从控制面或 Gateway 的访问视角发起，Agent 只负责本机安装、nginx -t 与 reload",
			"verifyHost":                strings.TrimSpace(input.ExecutionPolicy.VerifyHost),
			"verifyPort":                input.ExecutionPolicy.VerifyPort,
			"verifyUrl":                 strings.TrimSpace(input.ExecutionPolicy.VerifyURL),
			"serverName":                strings.TrimSpace(input.ExecutionPolicy.HostHeader),
			"expectedCertificateSha256": normalizeHexFingerprint(input.Artifact.TargetFingerprintSHA256),
			"remoteCertificateSha256":   nil,
			"remoteFingerprintSha256":   nil,
			"remoteThumbprint":          nil,
		},
	}
}

func runLinuxNginxRollback(taskID string, input linuxNginxDeployInput) (bool, string, string, map[string]any) {
	manifest, manifestPath, err := resolveRollbackManifest(input)
	if err != nil {
		return false, "ROLLBACK_MANIFEST_MISSING", err.Error(), map[string]any{
			"executor":  "linux-nginx-provider",
			"mode":      "nginx_rollback_failed",
			"taskId":    taskID,
			"operation": "rollback",
		}
	}
	certRestoreMode, err := restoreBackupFileWithPrivilege(manifest.CertBackup, input)
	if err != nil {
		return false, "ROLLBACK_CERT_RESTORE_FAILED", fmt.Sprintf("恢复证书文件失败: %v", err), map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_rollback_failed",
			"taskId":             taskID,
			"operation":          "rollback",
			"backupManifestPath": manifestPath,
			"backupManifest":     manifestToMap(manifest),
		}
	}
	keyRestoreMode, err := restoreBackupFileWithPrivilege(manifest.KeyBackup, input)
	if err != nil {
		return false, "ROLLBACK_KEY_RESTORE_FAILED", fmt.Sprintf("恢复私钥文件失败: %v", err), map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_rollback_failed",
			"taskId":             taskID,
			"operation":          "rollback",
			"backupManifestPath": manifestPath,
			"backupManifest":     manifestToMap(manifest),
		}
	}
	testResult, testMode, testErr := executeControlledCommandWithPrivilege(input.ExecutionPolicy.TestCommand, true)
	if testErr != nil || !testResult.Success {
		return false, classifyCommandFailure("ROLLBACK_TEST_FAILED", testResult), "回滚后 nginx -t 失败", map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_rollback_failed",
			"taskId":             taskID,
			"operation":          "rollback",
			"backupManifestPath": manifestPath,
			"backupManifest":     manifestToMap(manifest),
			"testCommand":        mapFromCommandResult(testResult, testMode),
		}
	}
	reloadResult, reloadMode, reloadErr := executeControlledCommandWithPrivilege(input.ExecutionPolicy.ReloadCommand, true)
	if reloadErr != nil || !reloadResult.Success {
		return false, classifyCommandFailure("ROLLBACK_RELOAD_FAILED", reloadResult), "回滚后 NGINX reload 失败", map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_rollback_failed",
			"taskId":             taskID,
			"operation":          "rollback",
			"backupManifestPath": manifestPath,
			"backupManifest":     manifestToMap(manifest),
			"testCommand":        mapFromCommandResult(testResult, testMode),
			"reloadCommand":      mapFromCommandResult(reloadResult, reloadMode),
		}
	}
	rollbackCertificateSHA := resolveRollbackCertificateSHA256(manifest, input)
	return true, "", "", map[string]any{
		"executor":           "linux-nginx-provider",
		"mode":               "nginx_rollback_completed",
		"taskId":             taskID,
		"operation":          "rollback",
		"backupManifestPath": manifestPath,
		"backupManifest":     manifestToMap(manifest),
		"testCommand":        mapFromCommandResult(testResult, testMode),
		"reloadCommand":      mapFromCommandResult(reloadResult, reloadMode),
		"fileRestoreMode":    mergeLinuxNginxPrivilegeMode(certRestoreMode, keyRestoreMode),
		"verify": map[string]any{
			"delegatedTo":               "control-plane",
			"reason":                    "回滚后的远端 TLS 验证必须从控制面或 Gateway 的访问视角发起",
			"verifyHost":                strings.TrimSpace(input.ExecutionPolicy.VerifyHost),
			"verifyPort":                input.ExecutionPolicy.VerifyPort,
			"verifyUrl":                 strings.TrimSpace(input.ExecutionPolicy.VerifyURL),
			"serverName":                strings.TrimSpace(input.ExecutionPolicy.HostHeader),
			"expectedCertificateSha256": rollbackCertificateSHA,
		},
	}
}

func evaluateBindingSelectorCheck(selector linuxNginxBindingSelector) map[string]any {
	missing := make([]string, 0, 4)
	if strings.TrimSpace(selector.CertPath) == "" {
		missing = append(missing, "certPath")
	}
	if strings.TrimSpace(selector.KeyPath) == "" {
		missing = append(missing, "keyPath")
	}
	if selector.ListenPort <= 0 {
		missing = append(missing, "listenPort")
	}
	if len(selector.ServerNames) == 0 {
		missing = append(missing, "serverNames")
	}
	if len(missing) > 0 {
		return dryRunCheck("binding_selector_complete", "目标绑定信息完整", "failed", fmt.Sprintf("bindingSelector 缺少必要字段: %s", strings.Join(missing, ", ")), map[string]any{
			"missingFields": missing,
		})
	}
	return dryRunCheck("binding_selector_complete", "目标绑定信息完整", "passed", "已识别 certPath/keyPath/监听端口/域名", map[string]any{
		"certPath":    selector.CertPath,
		"keyPath":     selector.KeyPath,
		"listenPort":  selector.ListenPort,
		"serverNames": selector.ServerNames,
	})
}

func evaluatePEMArtifactChecks(artifact linuxNginxArtifact) ([]map[string]any, parsedLinuxNginxArtifact) {
	checks := make([]map[string]any, 0, 4)
	parsed := parsedLinuxNginxArtifact{}
	if strings.TrimSpace(artifact.CertificatePEM) == "" || strings.TrimSpace(artifact.PrivateKeyPEM) == "" {
		return append(checks, dryRunCheck("deployment_material_complete", "证书材料完整", "failed", "certificatePem/privateKeyPem 不能为空", nil)), parsed
	}

	cert, certErr := parseCertificatePEM(artifact.CertificatePEM)
	if certErr != nil {
		checks = append(checks, dryRunCheck("certificate_pem_parseable", "证书 PEM 可解析", "failed", certErr.Error(), nil))
	} else {
		evidence := map[string]any{
			"subject":   cert.Subject.String(),
			"notBefore": cert.NotBefore.Format(time.RFC3339),
			"notAfter":  cert.NotAfter.Format(time.RFC3339),
		}
		fingerprint := sha256.Sum256(cert.Raw)
		fingerprintHex := strings.ToLower(hex.EncodeToString(fingerprint[:]))
		evidence["fingerprintSha256"] = fingerprintHex
		parsed.certificate = cert
		parsed.certificateSHA256 = fingerprintHex
		status := "passed"
		detail := "证书 PEM 可解析"
		if expected := normalizeHexFingerprint(artifact.TargetFingerprintSHA256); expected != "" && expected != fingerprintHex {
			status = "failed"
			detail = "证书指纹与 payload 目标指纹不一致"
			evidence["expectedFingerprintSha256"] = expected
		}
		checks = append(checks, dryRunCheck("certificate_pem_parseable", "证书 PEM 可解析", status, detail, evidence))
	}

	signer, keyType, keyErr := parsePrivateKeyPEMSigner(artifact.PrivateKeyPEM)
	if keyErr != nil {
		checks = append(checks, dryRunCheck("private_key_pem_parseable", "私钥 PEM 可解析", "failed", "privateKeyPem 不是合法 PEM 块", nil))
	} else {
		parsed.privateKeySigner = signer
		parsed.privateKeyType = keyType
		checks = append(checks, dryRunCheck("private_key_pem_parseable", "私钥 PEM 可解析", "passed", "私钥 PEM 结构存在", map[string]any{
			"keyType": keyType,
		}))
	}

	if parsed.certificate != nil && parsed.privateKeySigner != nil {
		if certificateMatchesPrivateKey(parsed.certificate, parsed.privateKeySigner) {
			checks = append(checks, dryRunCheck("certificate_key_match", "证书与私钥匹配", "passed", "部署材料内的证书和私钥匹配", nil))
		} else {
			checks = append(checks, dryRunCheck("certificate_key_match", "证书与私钥匹配", "failed", "部署材料内的证书和私钥不匹配", nil))
		}
	}

	return checks, parsed
}

func evaluatePathChecks(selector linuxNginxBindingSelector, privilegeAssessment map[string]any) []map[string]any {
	checks := make([]map[string]any, 0, 4)
	checks = append(checks, evaluateSinglePathCheck("cert_path_valid", "证书文件路径合法", selector.CertPath))
	checks = append(checks, evaluateSinglePathCheck("key_path_valid", "私钥文件路径合法", selector.KeyPath))
	checks = append(checks, evaluateWriteTargetCheck("cert_path_access", "证书文件写入权限", selector.CertPath, privilegeAssessment))
	checks = append(checks, evaluateWriteTargetCheck("key_path_access", "私钥文件写入权限", selector.KeyPath, privilegeAssessment))
	return checks
}

func evaluateLinuxNginxTargetState(selector linuxNginxBindingSelector, artifact parsedLinuxNginxArtifact, helperCommand string, privilegeAssessment map[string]any) (linuxNginxDryRunState, []map[string]any) {
	state := linuxNginxDryRunState{
		sourceFile: inspectPlainFileState(strings.TrimSpace(selector.SourceFile)),
		certFile:   inspectCertificateFileState(strings.TrimSpace(selector.CertPath), artifact.certificateSHA256, helperCommand),
		keyFile:    inspectPrivateKeyFileState(strings.TrimSpace(selector.KeyPath), artifact.privateKeySigner, helperCommand),
	}
	checks := make([]map[string]any, 0, 7)
	checks = append(checks, evaluateSourceFileStateCheck(state.sourceFile))
	checks = append(checks, evaluateTargetFileStateCheck("current_cert_file_state", "当前证书文件状态", state.certFile))
	checks = append(checks, evaluateTargetFileStateCheck("current_key_file_state", "当前私钥文件状态", state.keyFile))
	checks = append(checks, evaluateBackupPreconditionCheck("cert_backup_precondition", "证书文件备份前置条件", state.certFile, privilegeAssessment))
	checks = append(checks, evaluateBackupPreconditionCheck("key_backup_precondition", "私钥文件备份前置条件", state.keyFile, privilegeAssessment))
	if state.certFile.exists && state.certFile.matchesTarget {
		checks = append(checks, dryRunCheck("current_cert_matches_target", "当前证书已匹配目标", "passed", "目标 certPath 当前证书已是目标指纹", map[string]any{
			"path":               state.certFile.path,
			"certificateSha256":  state.certFile.certificateSHA256,
			"certificateSubject": state.certFile.certificateSubject,
		}))
	}
	if state.keyFile.exists && state.keyFile.matchesTarget {
		checks = append(checks, dryRunCheck("current_key_matches_target", "当前私钥已匹配目标", "passed", "目标 keyPath 当前私钥已匹配部署材料", map[string]any{
			"path":           state.keyFile.path,
			"privateKeyType": state.keyFile.privateKeyType,
		}))
	}
	return state, checks
}

func evaluateSinglePathCheck(key string, label string, targetPath string) map[string]any {
	targetPath = strings.TrimSpace(targetPath)
	if targetPath == "" {
		return dryRunCheck(key, label, "failed", "路径不能为空", nil)
	}
	if strings.Contains(targetPath, "\x00") {
		return dryRunCheck(key, label, "failed", "路径包含 NUL 字符", map[string]any{"path": targetPath})
	}
	if strings.Contains(targetPath, "$") {
		return dryRunCheck(key, label, "warning", "路径包含变量占位符，当前版本不会自动展开变量路径", map[string]any{"path": targetPath})
	}
	if !filepath.IsAbs(targetPath) {
		return dryRunCheck(key, label, "failed", "路径必须是绝对路径", map[string]any{"path": targetPath})
	}
	cleaned := filepath.Clean(targetPath)
	return dryRunCheck(key, label, "passed", "路径格式通过基础校验", map[string]any{
		"path":      targetPath,
		"cleaned":   cleaned,
		"parentDir": filepath.Dir(cleaned),
	})
}

func evaluateWriteTargetCheck(key string, label string, targetPath string, privilegeAssessment map[string]any) map[string]any {
	targetPath = strings.TrimSpace(targetPath)
	if !filepath.IsAbs(targetPath) {
		return dryRunCheck(key, label, "failed", "路径非法，无法评估写入权限", map[string]any{"path": targetPath})
	}
	parentDir := filepath.Dir(filepath.Clean(targetPath))
	parentInfo, parentErr := os.Stat(parentDir)
	if parentErr != nil {
		return dryRunCheck(key, label, "failed", fmt.Sprintf("目标目录不存在或不可访问: %v", parentErr), map[string]any{
			"path":      targetPath,
			"parentDir": parentDir,
		})
	}
	if !parentInfo.IsDir() {
		return dryRunCheck(key, label, "failed", "目标父路径不是目录", map[string]any{
			"path":      targetPath,
			"parentDir": parentDir,
		})
	}

	if info, err := os.Stat(targetPath); err == nil {
		writable := canWritePathFunc(targetPath)
		readable := canReadPathFunc(targetPath)
		if !writable {
			if detail, ok := filePrivilegeSatisfiesWrite(privilegeAssessment); ok {
				return dryRunCheck(key, label, detail.status, detail.message, map[string]any{
					"path":           targetPath,
					"readable":       readable,
					"writable":       writable,
					"mode":           info.Mode().String(),
					"privilegeMode":  detail.mode,
					"effectiveWrite": true,
				})
			}
			return dryRunCheck(key, label, "failed", "目标文件已存在，但当前用户没有写权限", map[string]any{
				"path":     targetPath,
				"readable": readable,
				"writable": writable,
				"mode":     info.Mode().String(),
			})
		}
		return dryRunCheck(key, label, "passed", "目标文件已存在，当前用户具备覆盖写入权限", map[string]any{
			"path":     targetPath,
			"readable": readable,
			"writable": writable,
			"mode":     info.Mode().String(),
		})
	}

	writableParent := canWriteDirFunc(parentDir)
	if !writableParent {
		if detail, ok := filePrivilegeSatisfiesWrite(privilegeAssessment); ok {
			return dryRunCheck(key, label, detail.status, detail.message, map[string]any{
				"path":           targetPath,
				"parentDir":      parentDir,
				"privilegeMode":  detail.mode,
				"effectiveWrite": true,
			})
		}
		return dryRunCheck(key, label, "failed", "目标文件不存在，且父目录不可写", map[string]any{
			"path":      targetPath,
			"parentDir": parentDir,
		})
	}
	return dryRunCheck(key, label, "warning", "目标文件不存在，但父目录可写，可在 install 阶段创建新文件", map[string]any{
		"path":      targetPath,
		"parentDir": parentDir,
	})
}

func evaluateCommandCheck(key string, label string, command string) map[string]any {
	command = strings.TrimSpace(command)
	if command == "" {
		return dryRunCheck(key, label, "failed", "命令不能为空", nil)
	}
	executable := firstShellToken(command)
	if executable == "" {
		return dryRunCheck(key, label, "failed", "无法解析命令入口", map[string]any{"command": command})
	}
	found := resolveExecutablePath(executable)
	if found == "" {
		return dryRunCheck(key, label, "failed", "命令入口不可执行或未找到", map[string]any{
			"command":    command,
			"executable": executable,
		})
	}
	return dryRunCheck(key, label, "passed", "命令入口存在，可进入后续真实执行阶段", map[string]any{
		"command":    command,
		"executable": executable,
		"resolved":   found,
	})
}

func evaluateVerifyEndpointCheck(policy linuxNginxExecutionPolicy) map[string]any {
	verifyHost := strings.TrimSpace(policy.VerifyHost)
	verifyURL := strings.TrimSpace(policy.VerifyURL)
	if verifyHost == "" && verifyURL == "" {
		return dryRunCheck("verify_endpoint_resolved", "验证端点可推导", "failed", "verifyHost/verifyUrl 至少需要一个", nil)
	}
	if verifyHost != "" && policy.VerifyPort <= 0 {
		return dryRunCheck("verify_endpoint_resolved", "验证端点可推导", "failed", "verifyHost 存在但 verifyPort 非法", map[string]any{
			"verifyHost": verifyHost,
			"verifyPort": policy.VerifyPort,
		})
	}
	return dryRunCheck("verify_endpoint_resolved", "验证端点可推导", "passed", "已推导 TLS 验证目标", map[string]any{
		"verifyHost": verifyHost,
		"verifyPort": policy.VerifyPort,
		"verifyUrl":  verifyURL,
		"hostHeader": strings.TrimSpace(policy.HostHeader),
	})
}

func evaluateSourceFileStateCheck(state linuxNginxTargetFileState) map[string]any {
	if strings.TrimSpace(state.path) == "" {
		return dryRunCheck("binding_source_file_state", "配置来源文件状态", "warning", "payload 未提供 sourceFile，dry-run 无法确认绑定来源配置文件是否可读", nil)
	}
	if !state.exists {
		return dryRunCheck("binding_source_file_state", "配置来源文件状态", "warning", "sourceFile 不存在或当前用户不可见", map[string]any{
			"path": state.path,
		})
	}
	if !state.regularFile {
		return dryRunCheck("binding_source_file_state", "配置来源文件状态", "failed", "sourceFile 不是常规文件", map[string]any{
			"path": state.path,
			"mode": state.mode,
		})
	}
	if !state.readable {
		return dryRunCheck("binding_source_file_state", "配置来源文件状态", "warning", "sourceFile 存在，但当前用户没有读取权限", map[string]any{
			"path": state.path,
			"mode": state.mode,
		})
	}
	return dryRunCheck("binding_source_file_state", "配置来源文件状态", "passed", "sourceFile 存在且可读", map[string]any{
		"path": state.path,
		"mode": state.mode,
	})
}

func evaluateTargetFileStateCheck(key string, label string, state linuxNginxTargetFileState) map[string]any {
	if !state.exists {
		return dryRunCheck(key, label, "warning", "目标文件当前不存在", map[string]any{
			"path":      state.path,
			"parentDir": state.parentDir,
		})
	}
	if !state.regularFile {
		return dryRunCheck(key, label, "failed", "目标路径存在，但不是常规文件", map[string]any{
			"path": state.path,
			"mode": state.mode,
		})
	}
	if !state.readable {
		return dryRunCheck(key, label, "failed", "目标文件存在，但当前用户没有读取权限", map[string]any{
			"path": state.path,
			"mode": state.mode,
		})
	}
	if strings.TrimSpace(state.parseError) != "" {
		return dryRunCheck(key, label, "warning", state.parseError, map[string]any{
			"path": state.path,
			"mode": state.mode,
		})
	}
	evidence := map[string]any{
		"path":      state.path,
		"mode":      state.mode,
		"writable":  state.writable,
		"parentDir": state.parentDir,
	}
	if state.certificateSHA256 != "" {
		evidence["certificateSha256"] = state.certificateSHA256
	}
	if state.certificateSubject != "" {
		evidence["certificateSubject"] = state.certificateSubject
	}
	if state.privateKeyType != "" {
		evidence["privateKeyType"] = state.privateKeyType
	}
	return dryRunCheck(key, label, "passed", "目标文件存在且可读取当前状态", evidence)
}

func evaluateBackupPreconditionCheck(key string, label string, state linuxNginxTargetFileState, privilegeAssessment map[string]any) map[string]any {
	if strings.TrimSpace(state.path) == "" {
		return dryRunCheck(key, label, "failed", "目标路径为空，无法评估备份前置条件", nil)
	}
	if !state.parentDirWritable {
		if detail, ok := filePrivilegeSatisfiesWrite(privilegeAssessment); ok {
			return dryRunCheck(key, label, detail.status, fmt.Sprintf("%s，可通过 %s 在原目录创建备份或临时文件", strings.TrimSuffix(detail.message, "可继续执行部署"), detail.mode), map[string]any{
				"path":           state.path,
				"parentDir":      state.parentDir,
				"privilegeMode":  detail.mode,
				"effectiveWrite": true,
			})
		}
		return dryRunCheck(key, label, "failed", "父目录不可写，后续无法在原目录创建备份或临时文件", map[string]any{
			"path":      state.path,
			"parentDir": state.parentDir,
		})
	}
	if !state.exists {
		return dryRunCheck(key, label, "warning", "目标文件当前不存在，install 阶段不会有旧文件可备份", map[string]any{
			"path":      state.path,
			"parentDir": state.parentDir,
		})
	}
	return dryRunCheck(key, label, "passed", "父目录可写，具备同目录备份/原子替换前提", map[string]any{
		"path":      state.path,
		"parentDir": state.parentDir,
	})
}

func buildLinuxNginxPlannedChanges(input linuxNginxDeployInput, state linuxNginxDryRunState) []map[string]any {
	changes := make([]map[string]any, 0, 8)
	if state.certFile.exists {
		changes = append(changes, map[string]any{
			"type":       "backup_certificate_file",
			"path":       input.BindingSelector.CertPath,
			"parentDir":  state.certFile.parentDir,
			"required":   true,
			"targetSame": state.certFile.matchesTarget,
		})
	}
	if state.keyFile.exists {
		changes = append(changes, map[string]any{
			"type":       "backup_private_key_file",
			"path":       input.BindingSelector.KeyPath,
			"parentDir":  state.keyFile.parentDir,
			"required":   true,
			"targetSame": state.keyFile.matchesTarget,
		})
	}
	certChangeType := "write_certificate_file"
	if state.certFile.matchesTarget {
		certChangeType = "skip_certificate_write"
	}
	keyChangeType := "write_private_key_file"
	if state.keyFile.matchesTarget {
		keyChangeType = "skip_private_key_write"
	}
	changes = append(changes,
		map[string]any{
			"type":   certChangeType,
			"path":   input.BindingSelector.CertPath,
			"format": "pem",
		},
		map[string]any{
			"type":   keyChangeType,
			"path":   input.BindingSelector.KeyPath,
			"format": "pem",
		},
		map[string]any{
			"type":    "run_nginx_test",
			"command": input.ExecutionPolicy.TestCommand,
		},
		map[string]any{
			"type":    "reload_nginx",
			"command": input.ExecutionPolicy.ReloadCommand,
		},
	)
	return changes
}

func inspectPlainFileState(targetPath string) linuxNginxTargetFileState {
	state := linuxNginxTargetFileState{
		path:      targetPath,
		parentDir: filepath.Dir(filepath.Clean(targetPath)),
	}
	if strings.TrimSpace(targetPath) == "" || !filepath.IsAbs(targetPath) {
		return state
	}
	if parentInfo, err := os.Stat(state.parentDir); err == nil && parentInfo.IsDir() {
		state.parentDirExists = true
		state.parentDirWritable = canWriteDirFunc(state.parentDir)
	}
	info, err := os.Stat(targetPath)
	if err != nil {
		return state
	}
	state.exists = true
	state.regularFile = info.Mode().IsRegular()
	state.mode = info.Mode().String()
	state.directReadable = canReadPathFunc(targetPath)
	state.readable = state.directReadable
	state.writable = canWritePathFunc(targetPath)
	return state
}

func inspectCertificateFileState(targetPath string, targetFingerprint string, helperCommand string) linuxNginxTargetFileState {
	state := inspectPlainFileState(targetPath)
	if !state.exists || !state.regularFile || !state.readable {
		if state.exists && state.regularFile && !state.readable {
			if content, err := readFileWithHelperFunc(targetPath, helperCommand); err == nil {
				state.readable = true
				cert, parseErr := parseCertificatePEM(string(content))
				if parseErr != nil {
					state.parseError = fmt.Sprintf("证书文件不是可解析的 PEM: %v", parseErr)
					return state
				}
				sum := sha256.Sum256(cert.Raw)
				state.certificateSHA256 = strings.ToLower(hex.EncodeToString(sum[:]))
				state.certificateSubject = cert.Subject.String()
				state.matchesTarget = targetFingerprint != "" && state.certificateSHA256 == normalizeHexFingerprint(targetFingerprint)
			}
		}
		return state
	}
	content, err := os.ReadFile(targetPath)
	if err != nil {
		state.parseError = fmt.Sprintf("证书文件读取失败: %v", err)
		return state
	}
	cert, parseErr := parseCertificatePEM(string(content))
	if parseErr != nil {
		state.parseError = fmt.Sprintf("证书文件不是可解析的 PEM: %v", parseErr)
		return state
	}
	sum := sha256.Sum256(cert.Raw)
	state.certificateSHA256 = strings.ToLower(hex.EncodeToString(sum[:]))
	state.certificateSubject = cert.Subject.String()
	state.matchesTarget = targetFingerprint != "" && state.certificateSHA256 == normalizeHexFingerprint(targetFingerprint)
	return state
}

func inspectPrivateKeyFileState(targetPath string, targetSigner crypto.Signer, helperCommand string) linuxNginxTargetFileState {
	state := inspectPlainFileState(targetPath)
	if !state.exists || !state.regularFile || !state.readable {
		if state.exists && state.regularFile && !state.readable {
			if content, err := readFileWithHelperFunc(targetPath, helperCommand); err == nil {
				state.readable = true
				signer, keyType, parseErr := parsePrivateKeyPEMSigner(string(content))
				if parseErr != nil {
					state.parseError = fmt.Sprintf("私钥文件不是可解析的 PEM: %v", parseErr)
					return state
				}
				state.privateKeyType = keyType
				if targetSigner != nil {
					state.matchesTarget = publicKeysEqual(signer.Public(), targetSigner.Public())
				}
			}
		}
		return state
	}
	content, err := os.ReadFile(targetPath)
	if err != nil {
		state.parseError = fmt.Sprintf("私钥文件读取失败: %v", err)
		return state
	}
	signer, keyType, parseErr := parsePrivateKeyPEMSigner(string(content))
	if parseErr != nil {
		state.parseError = fmt.Sprintf("私钥文件不是可解析的 PEM: %v", parseErr)
		return state
	}
	state.privateKeyType = keyType
	if targetSigner != nil {
		state.matchesTarget = publicKeysEqual(signer.Public(), targetSigner.Public())
	}
	return state
}

func mapFromLinuxNginxTargetFileState(state linuxNginxTargetFileState) map[string]any {
	return map[string]any{
		"path":               state.path,
		"exists":             state.exists,
		"regularFile":        state.regularFile,
		"readable":           state.readable,
		"directReadable":     state.directReadable,
		"writable":           state.writable,
		"parentDir":          state.parentDir,
		"parentDirExists":    state.parentDirExists,
		"parentDirWritable":  state.parentDirWritable,
		"mode":               state.mode,
		"certificateSha256":  state.certificateSHA256,
		"certificateSubject": state.certificateSubject,
		"privateKeyType":     state.privateKeyType,
		"matchesTarget":      state.matchesTarget,
		"parseError":         state.parseError,
	}
}

func inspectNginxBindingPermission(binding nginxBindingDetail, testCommand string, reloadCommand string) map[string]any {
	certState := inspectPlainFileState(strings.TrimSpace(binding.CertificatePath))
	keyState := inspectPlainFileState(strings.TrimSpace(binding.CertificateKeyPath))
	isRoot := currentEUIDFunc() == 0
	sudoAvailable, sudoDetail := probeSudoNoPasswordFunc()
	privilegedMode := deriveLocalPrivilegeMode(isRoot, sudoAvailable)
	helperCommand, helperDetail, helperReady := detectLinuxNginxHelperCommand("")
	testPrivilege := inspectCommandPrivilegeSummary(testCommand, helperCommand, sudoAvailable)
	reloadPrivilege := inspectCommandPrivilegeSummary(reloadCommand, helperCommand, sudoAvailable)
	filePrivilege := evaluateNginxFilePrivilege(certState, keyState, sudoAvailable, helperReady, isRoot)
	resolvedPrivilegeMode := derivePrivilegeModeWithHelper(privilegedMode, helperReady, testPrivilege, reloadPrivilege, filePrivilege)
	return map[string]any{
		"certPath":                 mapFromLinuxNginxTargetFileState(certState),
		"keyPath":                  mapFromLinuxNginxTargetFileState(keyState),
		"sudo":                     sudoDetail,
		"helper":                   helperDetail,
		"testCommand":              testPrivilege,
		"reloadCommand":            reloadPrivilege,
		"filePrivilege":            filePrivilege,
		"privilegeMode":            resolvedPrivilegeMode,
		"helperRequired":           resolvedPrivilegeMode == "helper-required",
		"recommendedHelperCommand": helperCommand,
		"nonInteractiveReady":      resolvedPrivilegeMode != "helper-required",
	}
}

func detectLinuxNginxHelperCommand(configuredCommand string) (string, map[string]any, bool) {
	helperPath := strings.TrimSpace(configuredCommand)
	if helperPath == "" {
		helperPath = strings.TrimSpace(os.Getenv("GCAC_NGINX_HELPER"))
	}
	if helperPath == "" {
		helperPath = "/usr/local/libexec/gcac-nginx-helper"
	}
	parts, splitErr := splitCommandLine(helperPath)
	if splitErr != nil || len(parts) == 0 {
		return helperPath, map[string]any{
			"command":    helperPath,
			"exists":     false,
			"executable": false,
			"ready":      false,
			"error":      firstNonEmpty(errorString(splitErr), "helper command is empty"),
		}, false
	}
	executablePath := parts[0]
	if resolved := resolveExecutablePath(parts[0]); resolved != "" {
		executablePath = resolved
	}
	info, err := os.Stat(executablePath)
	if err != nil {
		return helperPath, map[string]any{
			"command":    helperPath,
			"executable": executablePath,
			"exists":     false,
			"ready":      false,
			"error":      err.Error(),
		}, false
	}
	mode := info.Mode()
	executable := mode&0o111 != 0
	return helperPath, map[string]any{
		"command":    helperPath,
		"executable": executablePath,
		"exists":     true,
		"callable":   executable,
		"ready":      executable,
		"mode":       mode.String(),
	}, executable
}

func inspectCommandPrivilegeSummary(command string, helperCommand string, sudoAvailable bool) map[string]any {
	command = strings.TrimSpace(command)
	if command == "" {
		return map[string]any{
			"command":        command,
			"mode":           "invalid",
			"needsPrivilege": true,
			"ready":          false,
		}
	}
	selfResult, selfMode, selfErr := executeControlledCommandWithPrivilege(command, false)
	if selfErr == nil && selfResult.Success {
		return map[string]any{
			"command":        command,
			"mode":           selfMode,
			"needsPrivilege": false,
			"ready":          true,
			"exitCode":       selfResult.ExitCode,
		}
	}
	if currentEUIDFunc() == 0 {
		return map[string]any{
			"command":        command,
			"mode":           "direct",
			"needsPrivilege": false,
			"ready":          false,
			"exitCode":       selfResult.ExitCode,
			"failureCode":    classifyCommandFailure("COMMAND_FAILED", selfResult),
		}
	}
	if sudoAvailable || lookPathFunc("sudo") {
		sudoResult, sudoMode, sudoErr := executeCommandWithSudoFunc(command, false)
		if sudoErr == nil && sudoResult.Success {
			return map[string]any{
				"command":        command,
				"mode":           sudoMode,
				"needsPrivilege": true,
				"ready":          true,
				"exitCode":       sudoResult.ExitCode,
			}
		}
		return map[string]any{
			"command":        command,
			"mode":           "sudo-n",
			"needsPrivilege": true,
			"ready":          false,
			"helperCommand":  helperCommand,
			"directExitCode": selfResult.ExitCode,
			"sudoExitCode":   sudoResult.ExitCode,
			"failureCode":    classifyCommandFailure("COMMAND_FAILED", sudoResult),
		}
	}
	return map[string]any{
		"command":        command,
		"mode":           "helper-required",
		"needsPrivilege": true,
		"ready":          false,
		"helperCommand":  helperCommand,
		"directExitCode": selfResult.ExitCode,
		"failureCode":    classifyCommandFailure("COMMAND_FAILED", selfResult),
	}
}

func evaluateNginxFilePrivilege(certState linuxNginxTargetFileState, keyState linuxNginxTargetFileState, sudoAvailable bool, helperReady bool, isRoot bool) map[string]any {
	certReady := writeTargetReady(certState)
	keyReady := writeTargetReady(keyState)
	if certReady && keyReady {
		return map[string]any{
			"filePrivilegeMode":  "direct",
			"fileHelperRequired": false,
			"fileWriteReady":     true,
		}
	}
	if isRoot {
		return map[string]any{
			"filePrivilegeMode":  "root",
			"fileHelperRequired": false,
			"fileWriteReady":     rootWriteTargetReady(certState) && rootWriteTargetReady(keyState),
		}
	}
	if sudoAvailable {
		return map[string]any{
			"filePrivilegeMode":  "sudo-n",
			"fileHelperRequired": false,
			"fileWriteReady":     false,
		}
	}
	if helperReady {
		return map[string]any{
			"filePrivilegeMode":  "helper",
			"fileHelperRequired": true,
			"fileWriteReady":     false,
		}
	}
	return map[string]any{
		"filePrivilegeMode":  "blocked",
		"fileHelperRequired": true,
		"fileWriteReady":     false,
	}
}

func writeTargetReady(state linuxNginxTargetFileState) bool {
	if strings.TrimSpace(state.path) == "" {
		return false
	}
	if state.exists {
		return state.regularFile && state.writable
	}
	return state.parentDirWritable
}

func rootWriteTargetReady(state linuxNginxTargetFileState) bool {
	if strings.TrimSpace(state.path) == "" || !filepath.IsAbs(state.path) {
		return false
	}
	if state.exists {
		return state.regularFile
	}
	return state.parentDirExists
}

func evaluateLinuxNginxPrivilegeChecks(input linuxNginxDeployInput) (map[string]any, []map[string]any) {
	checks := make([]map[string]any, 0, 8)
	isRoot := currentEUIDFunc() == 0
	identity := map[string]any{
		"uid":      os.Getuid(),
		"euid":     currentEUIDFunc(),
		"gid":      os.Getgid(),
		"egid":     os.Getegid(),
		"username": firstNonEmpty(os.Getenv("USER"), os.Getenv("USERNAME")),
		"isRoot":   isRoot,
	}
	checks = append(checks, dryRunCheck("runtime_identity_detected", "运行身份探测", "passed", "已读取当前进程身份", identity))

	sudoAvailable, sudoDetail := probeSudoNoPassword()
	privilegedMode := deriveLocalPrivilegeMode(isRoot, sudoAvailable)
	if isRoot {
		sudoAvailable = false
		privilegedMode = "root"
		sudoDetail = map[string]any{
			"available":       false,
			"skipped":         true,
			"privilegedReady": true,
			"effectiveMode":   "root",
			"reason":          "current process already runs as root",
		}
	}

	helperCommand, helperDetail, helperReady := detectLinuxNginxHelperCommand(input.ExecutionPolicy.HelperCommand)
	testCheck, testPrivilege := evaluateCommandExecutionPrivilege("test_command_execution", "NGINX 测试命令权限", input.ExecutionPolicy.TestCommand, sudoAvailable)
	reloadCheck, reloadPrivilege := evaluateCommandExecutionPrivilege("reload_command_execution", "NGINX reload 命令权限", input.ExecutionPolicy.ReloadCommand, sudoAvailable)
	certState := inspectPlainFileState(strings.TrimSpace(input.BindingSelector.CertPath))
	keyState := inspectPlainFileState(strings.TrimSpace(input.BindingSelector.KeyPath))
	filePrivilege := evaluateNginxFilePrivilege(certState, keyState, sudoAvailable, helperReady, isRoot)
	resolvedPrivilegeMode := derivePrivilegeModeWithHelper(privilegedMode, helperReady, testPrivilege, reloadPrivilege, filePrivilege)
	helperRequired := resolvedPrivilegeMode == "helper-required"

	switch {
	case isRoot:
		checks = append(checks, dryRunCheck("sudo_non_interactive_available", "sudo -n 可用性", "passed", "当前进程已是 root，不需要 sudo -n", sudoDetail))
	case sudoAvailable:
		checks = append(checks, dryRunCheck("sudo_non_interactive_available", "sudo -n 可用性", "passed", "检测到当前环境支持无交互 sudo", sudoDetail))
	case commandScopedSudoReady(testPrivilege, reloadPrivilege):
		checks = append(checks, dryRunCheck("sudo_non_interactive_available", "sudo -n 可用性", "passed", "当前环境未开放通用 sudo，但已确认部署所需命令白名单可通过 sudo -n 执行", sudoDetail))
	default:
		checks = append(checks, dryRunCheck("sudo_non_interactive_available", "sudo -n 可用性", "warning", "当前环境未确认 sudo -n 可用，涉及系统写入或 reload 时可能需要 helper/提权运行", sudoDetail))
	}

	switch {
	case helperReady:
		checks = append(checks, dryRunCheck("helper_command_available", "NGINX helper 可用性", "passed", "检测到 helper 命令已就绪", helperDetail))
	case helperRequired:
		checks = append(checks, dryRunCheck("helper_command_available", "NGINX helper 可用性", "warning", "当前未检测到可用 helper 命令", helperDetail))
	default:
		checks = append(checks, dryRunCheck("helper_command_available", "NGINX helper 可用性", "passed", "当前策略未使用 helper", helperDetail))
	}

	checks = append(checks, testCheck, reloadCheck)
	checks = append(checks,
		evaluateWriteTargetCheck("cert_path_access", "证书文件写入权限", input.BindingSelector.CertPath, map[string]any{"filePrivilege": filePrivilege}),
		evaluateWriteTargetCheck("key_path_access", "私钥文件写入权限", input.BindingSelector.KeyPath, map[string]any{"filePrivilege": filePrivilege}),
	)

	return map[string]any{
		"identity":       identity,
		"sudo":           sudoDetail,
		"helper":         helperDetail,
		"helperCommand":  helperCommand,
		"certPath":       mapFromLinuxNginxTargetFileState(certState),
		"keyPath":        mapFromLinuxNginxTargetFileState(keyState),
		"filePrivilege":  filePrivilege,
		"testCommand":    testPrivilege,
		"reloadCommand":  reloadPrivilege,
		"privilegeMode":  resolvedPrivilegeMode,
		"helperRequired": helperRequired,
	}, checks
}

func deriveLocalPrivilegeMode(isRoot bool, sudoAvailable bool) string {
	if isRoot {
		return "root"
	}
	if sudoAvailable {
		return "sudo-n"
	}
	return ""
}

func derivePrivilegeModeWithHelper(privilegedMode string, helperReady bool, testPrivilege map[string]any, reloadPrivilege map[string]any, filePrivilege map[string]any) string {
	fileMode := strings.TrimSpace(stringFromMap(filePrivilege, "filePrivilegeMode"))
	testMode := strings.TrimSpace(stringFromMap(testPrivilege, "mode"))
	reloadMode := strings.TrimSpace(stringFromMap(reloadPrivilege, "mode"))
	if fileMode == "direct" && !readBoolValue(testPrivilege, "needsPrivilege") && !readBoolValue(reloadPrivilege, "needsPrivilege") {
		return "direct"
	}
	if fileMode == "root" || strings.TrimSpace(privilegedMode) == "root" {
		return "root"
	}
	if fileMode == "sudo-n" || testMode == "sudo" || reloadMode == "sudo" || strings.TrimSpace(privilegedMode) == "sudo-n" {
		return "sudo-n"
	}
	if fileMode == "helper" || testMode == "helper" || reloadMode == "helper" {
		return "helper"
	}
	if strings.TrimSpace(privilegedMode) != "" {
		return strings.TrimSpace(privilegedMode)
	}
	if helperReady {
		return "helper"
	}
	return "helper-required"
}

func evaluateCommandExecutionPrivilege(key string, label string, command string, sudoAvailable bool) (map[string]any, map[string]any) {
	command = strings.TrimSpace(command)
	if command == "" {
		return dryRunCheck(key, label, "failed", "命令不能为空", nil), map[string]any{
			"command": command,
		}
	}
	selfResult, selfMode, selfErr := executeControlledCommandWithPrivilege(command, false)
	if selfErr == nil && selfResult.Success {
		return dryRunCheck(key, label, "passed", "当前用户可直接执行命令", map[string]any{
				"command":  selfResult.Command,
				"mode":     selfMode,
				"exitCode": selfResult.ExitCode,
			}), map[string]any{
				"command":        command,
				"mode":           selfMode,
				"needsPrivilege": false,
				"ready":          true,
				"exitCode":       selfResult.ExitCode,
			}
	}
	if currentEUIDFunc() == 0 {
		failureCode := classifyCommandFailure("COMMAND_FAILED", selfResult)
		return dryRunCheck(key, label, "failed", fmt.Sprintf("当前进程已是 root，命令直连执行失败，exit=%d，failure=%s", selfResult.ExitCode, failureCode), map[string]any{
				"command":     command,
				"self":        mapFromCommandResult(selfResult, selfMode),
				"failureCode": failureCode,
			}), map[string]any{
				"command":        command,
				"mode":           selfMode,
				"needsPrivilege": false,
				"ready":          false,
				"exitCode":       selfResult.ExitCode,
				"failureCode":    failureCode,
			}
	}
	sudoPresent := lookPathFunc("sudo")
	if !sudoAvailable && !sudoPresent {
		failureCode := classifyCommandFailure("COMMAND_FAILED", selfResult)
		return dryRunCheck(key, label, "failed", fmt.Sprintf("当前用户直连执行失败，且 sudo -n 不可用，exit=%d，failure=%s", selfResult.ExitCode, failureCode), map[string]any{
				"command":     command,
				"self":        mapFromCommandResult(selfResult, selfMode),
				"failureCode": failureCode,
			}), map[string]any{
				"command":        command,
				"mode":           "helper-required",
				"needsPrivilege": true,
				"ready":          false,
				"exitCode":       selfResult.ExitCode,
				"failureCode":    failureCode,
			}
	}
	sudoResult, sudoMode, sudoErr := executeCommandWithSudoFunc(command, false)
	if sudoErr == nil && sudoResult.Success {
		return dryRunCheck(key, label, "warning", "当前用户直连执行失败，但可通过 sudo -n 成功执行", map[string]any{
				"command":          command,
				"selfExitCode":     selfResult.ExitCode,
				"sudoExitCode":     sudoResult.ExitCode,
				"sudoResolvedMode": sudoMode,
				"sudoRequired":     true,
			}), map[string]any{
				"command":        command,
				"mode":           sudoMode,
				"needsPrivilege": true,
				"ready":          true,
				"exitCode":       sudoResult.ExitCode,
			}
	}
	detail := fmt.Sprintf("当前用户与 sudo -n 都未确认可执行命令，自执行 exit=%d", selfResult.ExitCode)
	if !sudoAvailable && sudoPresent {
		detail = fmt.Sprintf("当前用户直连执行失败，sudo 存在但未通过通用探测，且针对当前命令的 sudo -n 试跑也失败，自执行 exit=%d", selfResult.ExitCode)
	}
	if sudoErr != nil || !sudoResult.Success {
		detail = fmt.Sprintf("%s，sudo exit=%d", detail, sudoResult.ExitCode)
	}
	return dryRunCheck(key, label, "failed", detail, map[string]any{
			"command": command,
			"self":    mapFromCommandResult(selfResult, selfMode),
			"sudo":    mapFromCommandResult(sudoResult, "sudo"),
		}), map[string]any{
			"command":        command,
			"mode":           "unknown",
			"needsPrivilege": true,
			"ready":          false,
			"exitCode":       maxInt(selfResult.ExitCode, sudoResult.ExitCode),
		}
}

func commandScopedSudoReady(testPrivilege map[string]any, reloadPrivilege map[string]any) bool {
	return privilegeSatisfiedWithoutHelper(testPrivilege) &&
		privilegeSatisfiedWithoutHelper(reloadPrivilege) &&
		(strings.TrimSpace(stringFromMap(testPrivilege, "mode")) == "sudo" || strings.TrimSpace(stringFromMap(reloadPrivilege, "mode")) == "sudo")
}

func privilegeSatisfiedWithoutHelper(privilege map[string]any) bool {
	if privilege == nil {
		return false
	}
	if !readBoolValue(privilege, "needsPrivilege") {
		return readBoolValue(privilege, "ready") || strings.TrimSpace(stringFromMap(privilege, "failureCode")) == ""
	}
	mode := strings.TrimSpace(stringFromMap(privilege, "mode"))
	return readBoolValue(privilege, "ready") && mode != "helper" && mode != "helper-required" && mode != "unknown"
}

type filePrivilegeResolution struct {
	mode    string
	status  string
	message string
}

func filePrivilegeSatisfiesWrite(privilegeAssessment map[string]any) (filePrivilegeResolution, bool) {
	filePrivilege, ok := privilegeAssessment["filePrivilege"].(map[string]any)
	if !ok {
		return filePrivilegeResolution{}, false
	}
	mode := strings.TrimSpace(stringFromMap(filePrivilege, "filePrivilegeMode"))
	switch mode {
	case "direct", "root":
		return filePrivilegeResolution{
			mode:    mode,
			status:  "passed",
			message: "当前执行路径具备文件写入能力",
		}, true
	case "helper":
		return filePrivilegeResolution{
			mode:    mode,
			status:  "passed",
			message: "当前用户无直写权限，但可通过 helper 完成文件写入",
		}, true
	case "sudo-n":
		if readBoolValue(filePrivilege, "fileWriteReady") {
			return filePrivilegeResolution{
				mode:    mode,
				status:  "passed",
				message: "当前执行路径具备文件写入能力",
			}, true
		}
		return filePrivilegeResolution{}, false
	default:
		return filePrivilegeResolution{}, false
	}
}

func executeControlledCommandWithPrivilege(command string, allowSudo bool) (*CommandResult, string, error) {
	result, err := executeShellCommandFunc(command, 20*time.Second)
	if err == nil {
		return result, "direct", nil
	}
	if !allowSudo {
		return result, "direct", err
	}
	sudoResult, sudoMode, sudoErr := executeCommandWithSudoFunc(command, true)
	if sudoErr == nil {
		return sudoResult, sudoMode, nil
	}
	return sudoResult, sudoMode, sudoErr
}

func executeCommandWithSudo(command string, withTimeout bool) (*CommandResult, string, error) {
	if !lookPathFunc("sudo") {
		return &CommandResult{Command: "sudo", Args: []string{"-n"}, ExitCode: 127, Success: false}, "sudo", errors.New("sudo 不存在")
	}
	timeout := 20 * time.Second
	if !withTimeout {
		timeout = 10 * time.Second
	}
	commandArgs, err := buildSudoCommandArgs(command)
	if err != nil {
		return &CommandResult{
			Command:  "sudo",
			Args:     []string{"-n"},
			ExitCode: 2,
			Success:  false,
			Stderr:   err.Error(),
		}, "sudo", err
	}
	result, err := executeCommand(commandArgs, false, timeout, false)
	return result, "sudo", err
}

func executeHelperCommand(helperCommand string, helperArgs []string, stdin []byte, timeout time.Duration) (*CommandResult, error) {
	parts, err := splitCommandLine(strings.TrimSpace(helperCommand))
	if err != nil {
		return &CommandResult{
			Command:  "sudo",
			Args:     []string{"-n"},
			ExitCode: 2,
			Success:  false,
			Stderr:   err.Error(),
		}, err
	}
	if len(parts) == 0 {
		return &CommandResult{
			Command:  "sudo",
			Args:     []string{"-n"},
			ExitCode: 2,
			Success:  false,
			Stderr:   "helper command is empty",
		}, errors.New("helper command is empty")
	}
	if resolved := resolveExecutablePath(parts[0]); resolved != "" {
		parts[0] = resolved
	}
	commandArgs := append([]string{"sudo", "-n", "--"}, parts...)
	commandArgs = append(commandArgs, helperArgs...)
	return executeCommandWithInput(commandArgs, stdin, timeout)
}

func buildSudoCommandArgs(command string) ([]string, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return nil, errors.New("sudo command is empty")
	}
	if requiresShellSyntax(command) {
		return []string{"sudo", "-n", "/bin/sh", "-lc", command}, nil
	}
	parts, err := splitCommandLine(command)
	if err != nil {
		return nil, err
	}
	if len(parts) == 0 {
		return nil, errors.New("sudo command is empty")
	}
	if resolved := resolveExecutablePath(parts[0]); resolved != "" {
		parts[0] = resolved
	}
	return append([]string{"sudo", "-n", "--"}, parts...), nil
}

func splitCommandLine(command string) ([]string, error) {
	trimmed := strings.TrimSpace(command)
	if trimmed == "" {
		return nil, errors.New("command is empty")
	}
	args := make([]string, 0, 4)
	var current strings.Builder
	quote := rune(0)
	escaped := false
	flush := func() {
		if current.Len() == 0 {
			return
		}
		args = append(args, current.String())
		current.Reset()
	}
	for _, ch := range trimmed {
		if escaped {
			current.WriteRune(ch)
			escaped = false
			continue
		}
		switch quote {
		case '\'':
			if ch == '\'' {
				quote = 0
				continue
			}
			current.WriteRune(ch)
		case '"':
			if ch == '"' {
				quote = 0
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			current.WriteRune(ch)
		default:
			switch {
			case unicode.IsSpace(ch):
				flush()
			case ch == '\'' || ch == '"':
				quote = ch
			case ch == '\\':
				escaped = true
			default:
				current.WriteRune(ch)
			}
		}
	}
	if escaped {
		return nil, errors.New("unterminated escape in command")
	}
	if quote != 0 {
		return nil, errors.New("unterminated quote in command")
	}
	flush()
	if len(args) == 0 {
		return nil, errors.New("command is empty")
	}
	return args, nil
}

func requiresShellSyntax(command string) bool {
	quote := rune(0)
	escaped := false
	for _, ch := range command {
		if escaped {
			escaped = false
			continue
		}
		switch quote {
		case '\'':
			if ch == '\'' {
				quote = 0
			}
			continue
		case '"':
			if ch == '"' {
				quote = 0
				continue
			}
			if ch == '\\' {
				escaped = true
			}
			continue
		}
		switch ch {
		case '\'', '"':
			quote = ch
		case '\\':
			escaped = true
		case '|', '&', ';', '<', '>', '$', '`', '(', ')', '{', '}', '\n', '\r':
			return true
		}
	}
	return false
}

func executeShellCommand(command string, timeout time.Duration) (*CommandResult, error) {
	startedAt := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	shellCommand, shellArgs := shellInvocation(command)
	cmd := exec.CommandContext(ctx, shellCommand, shellArgs...)
	result := &CommandResult{
		Command: shellCommand,
		Args:    shellArgs,
	}
	stdout, stderr, exitCode, err := runProcess(cmd)
	result.Stdout = stdout
	result.Stderr = stderr
	result.ExitCode = exitCode
	result.Success = err == nil
	result.DurationMs = time.Since(startedAt).Milliseconds()
	if err != nil {
		return result, err
	}
	return result, nil
}

func probeSudoNoPassword() (bool, map[string]any) {
	if currentEUIDFunc() == 0 {
		return false, map[string]any{
			"available": false,
			"skipped":   true,
			"reason":    "current process already runs as root",
		}
	}
	if !lookPath("sudo") {
		return false, map[string]any{
			"available": false,
			"reason":    "sudo not found",
		}
	}
	result, err := executeCommand([]string{"sudo", "-n", "true"}, false, 5*time.Second, false)
	return err == nil && result.Success, map[string]any{
		"available": err == nil && result.Success,
		"command":   "sudo -n true",
		"exitCode":  result.ExitCode,
		"stdout":    result.Stdout,
		"stderr":    result.Stderr,
	}
}

func derivePrivilegeMode(sudoAvailable bool, testPrivilege map[string]any, reloadPrivilege map[string]any) string {
	if !readBoolValue(testPrivilege, "needsPrivilege") && !readBoolValue(reloadPrivilege, "needsPrivilege") {
		return "direct"
	}
	if sudoAvailable {
		return "sudo-n"
	}
	return "helper-required"
}

func readBoolValue(record map[string]any, key string) bool {
	value, ok := record[key]
	if !ok {
		return false
	}
	typed, ok := value.(bool)
	return ok && typed
}

func createLinuxNginxBackupManifest(taskID string, input linuxNginxDeployInput) (*linuxNginxBackupManifest, map[string]any, error) {
	privilegeAssessment, _ := evaluateLinuxNginxPrivilegeChecks(input)
	baseDir, err := resolveLinuxNginxBackupBaseDir()
	if err != nil {
		return nil, map[string]any{
			"executor": "linux-nginx-provider",
			"taskId":   taskID,
		}, err
	}
	runID := firstNonEmpty(strings.TrimSpace(input.ExecutionRunID), taskID)
	targetDir := filepath.Join(baseDir, sanitizePathSegment(runID), sanitizePathSegment(firstNonEmpty(input.BindingSelector.BindingID, "binding")))
	if err := os.MkdirAll(targetDir, 0o700); err != nil {
		return nil, map[string]any{
			"executor": "linux-nginx-provider",
			"taskId":   taskID,
			"baseDir":  baseDir,
		}, err
	}
	manifest := &linuxNginxBackupManifest{
		TaskID:                  taskID,
		ExecutionRunID:          input.ExecutionRunID,
		SourceRunID:             input.SourceRunID,
		BindingID:               input.BindingSelector.BindingID,
		SiteAssetID:             input.BindingSelector.SiteAssetID,
		CreatedAt:               time.Now().Format(time.RFC3339),
		TargetCertificateSHA256: normalizeHexFingerprint(input.Artifact.TargetFingerprintSHA256),
		CertPath:                input.BindingSelector.CertPath,
		KeyPath:                 input.BindingSelector.KeyPath,
		PrivilegeAssessment:     privilegeAssessment,
	}
	certRef, err := backupTargetFile(targetDir, input.BindingSelector.CertPath, "cert", input.ExecutionPolicy.HelperCommand)
	if err != nil {
		return nil, map[string]any{
			"executor": "linux-nginx-provider",
			"taskId":   taskID,
			"target":   input.BindingSelector.CertPath,
		}, err
	}
	keyRef, err := backupTargetFile(targetDir, input.BindingSelector.KeyPath, "key", input.ExecutionPolicy.HelperCommand)
	if err != nil {
		return nil, map[string]any{
			"executor": "linux-nginx-provider",
			"taskId":   taskID,
			"target":   input.BindingSelector.KeyPath,
		}, err
	}
	manifest.CertBackup = certRef
	manifest.KeyBackup = keyRef
	manifest.CertificateSHA256 = firstNonEmpty(certRef.CertificateFingerprintSHA256, manifest.TargetCertificateSHA256)
	manifestPath := filepath.Join(targetDir, "backup-manifest.json")
	if err := writeJSONFileAtomic(manifestPath, manifest); err != nil {
		return nil, map[string]any{
			"executor":           "linux-nginx-provider",
			"taskId":             taskID,
			"backupManifestPath": manifestPath,
		}, err
	}
	return manifest, map[string]any{
		"backupManifestPath":  manifestPath,
		"privilegeAssessment": privilegeAssessment,
	}, nil
}

func backupTargetFile(targetDir string, targetPath string, prefix string, helperCommand string) (linuxNginxBackupFileRef, error) {
	ref := linuxNginxBackupFileRef{
		TargetPath: targetPath,
	}
	info, err := os.Stat(targetPath)
	if err != nil {
		existsWithHelper, helperErr := pathExistsWithHelperFunc(targetPath, helperCommand)
		if helperErr == nil && existsWithHelper {
			ref.Existed = true
			ref.UsedPrivilege = "helper"
			content, readErr := readFileWithHelperFunc(targetPath, helperCommand)
			if readErr != nil {
				return ref, readErr
			}
			sum := sha256.Sum256(content)
			ref.ContentSHA256 = strings.ToLower(hex.EncodeToString(sum[:]))
			backupPath := filepath.Join(targetDir, fmt.Sprintf("%s-%d.bak", prefix, time.Now().UnixNano()))
			if writeErr := os.WriteFile(backupPath, content, 0o600); writeErr != nil {
				return ref, writeErr
			}
			ref.BackupPath = backupPath
			populateBackupCertificateFingerprint(&ref, prefix, content)
			return ref, nil
		}
		if errors.Is(err, os.ErrNotExist) {
			existsWithSudo, sudoErr := pathExistsWithSudoFunc(targetPath)
			if sudoErr != nil || !existsWithSudo {
				return ref, nil
			}
		} else {
			existsWithSudo, sudoErr := pathExistsWithSudoFunc(targetPath)
			if sudoErr != nil || !existsWithSudo {
				return ref, err
			}
		}
		ref.Existed = true
		ref.UsedPrivilege = "sudo"
		content, readErr := readFileWithSudoFunc(targetPath)
		if readErr != nil {
			return ref, readErr
		}
		sum := sha256.Sum256(content)
		ref.ContentSHA256 = strings.ToLower(hex.EncodeToString(sum[:]))
		backupPath := filepath.Join(targetDir, fmt.Sprintf("%s-%d.bak", prefix, time.Now().UnixNano()))
		if writeErr := os.WriteFile(backupPath, content, 0o600); writeErr != nil {
			return ref, writeErr
		}
		ref.BackupPath = backupPath
		populateBackupCertificateFingerprint(&ref, prefix, content)
		return ref, nil
	}
	ref.Existed = true
	ref.Mode = info.Mode().String()
	content, err := os.ReadFile(targetPath)
	if err != nil {
		if helperContent, helperErr := readFileWithHelperFunc(targetPath, helperCommand); helperErr == nil {
			ref.UsedPrivilege = "helper"
			content = helperContent
		} else {
			return ref, err
		}
	}
	sum := sha256.Sum256(content)
	ref.ContentSHA256 = strings.ToLower(hex.EncodeToString(sum[:]))
	backupPath := filepath.Join(targetDir, fmt.Sprintf("%s-%d.bak", prefix, time.Now().UnixNano()))
	if err := os.WriteFile(backupPath, content, 0o600); err != nil {
		return ref, err
	}
	ref.BackupPath = backupPath
	populateBackupCertificateFingerprint(&ref, prefix, content)
	return ref, nil
}

func populateBackupCertificateFingerprint(ref *linuxNginxBackupFileRef, prefix string, content []byte) {
	if ref == nil || prefix != "cert" {
		return
	}
	certificate, err := parseCertificatePEM(string(content))
	if err != nil {
		return
	}
	sum := sha256.Sum256(certificate.Raw)
	ref.CertificateFingerprintSHA256 = strings.ToLower(hex.EncodeToString(sum[:]))
}

func resolveLinuxNginxBackupBaseDir() (string, error) {
	baseDir := filepath.Join(os.TempDir(), "gcac-linux-nginx")
	if err := os.MkdirAll(baseDir, 0o700); err != nil {
		return "", err
	}
	return baseDir, nil
}

func writeJSONFileAtomic(targetPath string, value any) error {
	bytes, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return atomicWritePEMFileFunc(targetPath, bytes)
}

func atomicWritePEMFile(targetPath string, content []byte) error {
	targetPath = filepath.Clean(strings.TrimSpace(targetPath))
	if targetPath == "" {
		return errors.New("目标路径为空")
	}
	parentDir := filepath.Dir(targetPath)
	if err := os.MkdirAll(parentDir, 0o755); err != nil {
		return err
	}
	tempFile, err := os.CreateTemp(parentDir, ".gcac-tmp-*")
	if err != nil {
		return err
	}
	tempPath := tempFile.Name()
	defer func() {
		_ = tempFile.Close()
		_ = os.Remove(tempPath)
	}()
	if _, err := tempFile.Write(content); err != nil {
		return err
	}
	mode := os.FileMode(0o600)
	if strings.HasSuffix(strings.ToLower(targetPath), ".crt") || strings.HasSuffix(strings.ToLower(targetPath), ".pem") {
		mode = 0o644
	}
	if err := tempFile.Chmod(mode); err != nil {
		return err
	}
	if err := tempFile.Sync(); err != nil {
		return err
	}
	if err := tempFile.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, targetPath)
}

func atomicWritePEMFileWithPrivilege(targetPath string, content []byte, input linuxNginxDeployInput) (string, error) {
	if err := atomicWritePEMFileFunc(targetPath, content); err == nil {
		return "direct", nil
	}
	if mode, err := writeFileWithHelper(targetPath, content, input.ExecutionPolicy.HelperCommand); err == nil {
		return mode, nil
	}
	if mode, err := writeFileWithSudo(targetPath, content); err == nil {
		return mode, nil
	} else {
		return mode, err
	}
}

func restoreBackupFileWithPrivilege(ref linuxNginxBackupFileRef, input linuxNginxDeployInput) (string, error) {
	if strings.TrimSpace(ref.TargetPath) == "" {
		return "", errors.New("targetPath is empty")
	}
	if !ref.Existed {
		if fileExists(ref.TargetPath) {
			if err := os.Remove(ref.TargetPath); err == nil {
				return "direct", nil
			}
			if mode, err := removeFileWithHelper(ref.TargetPath, input.ExecutionPolicy.HelperCommand); err == nil {
				return mode, nil
			}
			return removeFileWithSudoFunc(ref.TargetPath)
		}
		existsWithSudo, _ := pathExistsWithSudoFunc(ref.TargetPath)
		if existsWithSudo {
			if mode, err := removeFileWithHelper(ref.TargetPath, input.ExecutionPolicy.HelperCommand); err == nil {
				return mode, nil
			}
			return removeFileWithSudoFunc(ref.TargetPath)
		}
		return "direct", nil
	}
	content, err := os.ReadFile(ref.BackupPath)
	if err != nil {
		return "", err
	}
	return atomicWritePEMFileWithPrivilege(ref.TargetPath, content, input)
}

func writeFileWithSudo(targetPath string, content []byte) (string, error) {
	targetPath = filepath.Clean(strings.TrimSpace(targetPath))
	if targetPath == "" {
		return "sudo", errors.New("target path is empty")
	}
	parentDir := filepath.Dir(targetPath)
	mode := "600"
	lowerTargetPath := strings.ToLower(targetPath)
	if strings.HasSuffix(lowerTargetPath, ".crt") || strings.HasSuffix(lowerTargetPath, ".pem") {
		mode = "644"
	}
	encoded := base64.StdEncoding.EncodeToString(content)
	command := fmt.Sprintf("install -d -m 755 %q && tmp=$(mktemp %q) && trap 'rm -f \"$tmp\"' EXIT && printf '%%s' %q | base64 -d > \"$tmp\" && chmod %s \"$tmp\" && mv \"$tmp\" %q", parentDir, filepath.Join(parentDir, ".gcac-tmp-XXXXXX"), encoded, mode, targetPath)
	result, usedMode, err := executeCommandWithSudoFunc(command, true)
	if err != nil {
		return usedMode, fmt.Errorf("sudo write failed (exit=%d): %s", result.ExitCode, firstNonEmpty(strings.TrimSpace(result.Stderr), strings.TrimSpace(result.Stdout), err.Error()))
	}
	return usedMode, nil
}

func readFileWithSudo(targetPath string) ([]byte, error) {
	command := fmt.Sprintf("cat %q", filepath.Clean(strings.TrimSpace(targetPath)))
	result, _, err := executeCommandWithSudoFunc(command, true)
	if err != nil {
		return nil, fmt.Errorf("sudo read failed (exit=%d): %s", result.ExitCode, firstNonEmpty(strings.TrimSpace(result.Stderr), strings.TrimSpace(result.Stdout), err.Error()))
	}
	return []byte(result.Stdout), nil
}

func removeFileWithSudo(targetPath string) (string, error) {
	command := fmt.Sprintf("rm -f %q", filepath.Clean(strings.TrimSpace(targetPath)))
	result, usedMode, err := executeCommandWithSudoFunc(command, true)
	if err != nil {
		return usedMode, fmt.Errorf("sudo remove failed (exit=%d): %s", result.ExitCode, firstNonEmpty(strings.TrimSpace(result.Stderr), strings.TrimSpace(result.Stdout), err.Error()))
	}
	return usedMode, nil
}
func pathExistsWithSudo(targetPath string) (bool, error) {
	command := fmt.Sprintf("test -e %q", filepath.Clean(strings.TrimSpace(targetPath)))
	result, _, err := executeCommandWithSudoFunc(command, false)
	if err == nil && result.Success {
		return true, nil
	}
	if result != nil && result.ExitCode == 1 {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return false, nil
}

func writeFileWithHelper(targetPath string, content []byte, helperCommand string) (string, error) {
	helperCommand = strings.TrimSpace(helperCommand)
	if helperCommand == "" {
		return "helper", errors.New("helper command not configured")
	}
	mode := "600"
	lowerTargetPath := strings.ToLower(filepath.Clean(strings.TrimSpace(targetPath)))
	if strings.HasSuffix(lowerTargetPath, ".crt") || strings.HasSuffix(lowerTargetPath, ".pem") {
		mode = "644"
	}
	result, err := executeHelperCommandFunc(helperCommand, []string{"write-file", filepath.Clean(strings.TrimSpace(targetPath)), mode}, content, 20*time.Second)
	if err != nil {
		return "helper", fmt.Errorf("helper write failed (exit=%d): %s", commandExitCode(result), firstNonEmpty(commandStderr(result), commandStdout(result), err.Error()))
	}
	return "helper", nil
}

func readFileWithHelper(targetPath string, helperCommand string) ([]byte, error) {
	helperCommand = strings.TrimSpace(helperCommand)
	if helperCommand == "" {
		return nil, errors.New("helper command not configured")
	}
	result, err := executeHelperCommandFunc(helperCommand, []string{"read-file", filepath.Clean(strings.TrimSpace(targetPath))}, nil, 20*time.Second)
	if err != nil {
		return nil, fmt.Errorf("helper read failed (exit=%d): %s", commandExitCode(result), firstNonEmpty(commandStderr(result), commandStdout(result), err.Error()))
	}
	return []byte(result.Stdout), nil
}

func removeFileWithHelper(targetPath string, helperCommand string) (string, error) {
	helperCommand = strings.TrimSpace(helperCommand)
	if helperCommand == "" {
		return "helper", errors.New("helper command not configured")
	}
	result, err := executeHelperCommandFunc(helperCommand, []string{"remove-file", filepath.Clean(strings.TrimSpace(targetPath))}, nil, 20*time.Second)
	if err != nil {
		return "helper", fmt.Errorf("helper remove failed (exit=%d): %s", commandExitCode(result), firstNonEmpty(commandStderr(result), commandStdout(result), err.Error()))
	}
	return "helper", nil
}

func pathExistsWithHelper(targetPath string, helperCommand string) (bool, error) {
	helperCommand = strings.TrimSpace(helperCommand)
	if helperCommand == "" {
		return false, errors.New("helper command not configured")
	}
	result, err := executeHelperCommandFunc(helperCommand, []string{"exists", filepath.Clean(strings.TrimSpace(targetPath))}, nil, 10*time.Second)
	if err == nil && result.Success {
		return true, nil
	}
	if result != nil && result.ExitCode == 1 {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return false, nil
}

func mergeLinuxNginxPrivilegeMode(left string, right string) string {
	left = strings.TrimSpace(left)
	right = strings.TrimSpace(right)
	if left == "" {
		return right
	}
	if right == "" || right == left {
		return left
	}
	if left == "helper" || right == "helper" {
		return "helper"
	}
	if left == "sudo" || right == "sudo" {
		return "sudo"
	}
	return left + "+" + right
}

func rollbackAfterInstallFailure(taskID string, input linuxNginxDeployInput, manifest *linuxNginxBackupManifest, code string, message string, baseDetail map[string]any) (bool, string, string, map[string]any) {
	rollbackSuccess, rollbackCode, rollbackMessage, rollbackDetail := runLinuxNginxRollback(taskID, linuxNginxDeployInput{
		Operation:       "rollback",
		ProviderType:    input.ProviderType,
		BindingSelector: input.BindingSelector,
		Artifact:        input.Artifact,
		ExecutionPolicy: input.ExecutionPolicy,
		ExecutionRunID:  input.ExecutionRunID,
		SourceRunID:     firstNonEmpty(input.SourceRunID, input.ExecutionRunID),
		RollbackContext: linuxNginxRollbackContext{
			SourceRunID:        firstNonEmpty(input.SourceRunID, input.ExecutionRunID),
			BackupManifestPath: resolveManifestPathFromManifest(manifest),
			BackupManifest:     manifestToMap(manifest),
		},
	})
	baseDetail["backupManifest"] = manifestToMap(manifest)
	baseDetail["backupManifestPath"] = resolveManifestPathFromManifest(manifest)
	baseDetail["rollback"] = rollbackDetail
	baseDetail["rolledBack"] = rollbackSuccess
	if rollbackSuccess {
		return false, code, message, baseDetail
	}
	return false, rollbackCode, fmt.Sprintf("%s；自动回滚也失败: %s", message, rollbackMessage), baseDetail
}

func resolveRollbackManifest(input linuxNginxDeployInput) (*linuxNginxBackupManifest, string, error) {
	if strings.TrimSpace(input.RollbackContext.BackupManifestPath) != "" {
		manifest, err := loadLinuxNginxBackupManifest(input.RollbackContext.BackupManifestPath)
		return manifest, input.RollbackContext.BackupManifestPath, err
	}
	if len(input.RollbackContext.BackupManifest) > 0 {
		raw, err := json.Marshal(input.RollbackContext.BackupManifest)
		if err != nil {
			return nil, "", err
		}
		var manifest linuxNginxBackupManifest
		if err := json.Unmarshal(raw, &manifest); err != nil {
			return nil, "", err
		}
		return &manifest, "", nil
	}
	return nil, "", errors.New("rollbackContext 缺少 backupManifestPath/backupManifest")
}

func resolveRollbackCertificateSHA256(manifest *linuxNginxBackupManifest, input linuxNginxDeployInput) string {
	if manifest != nil {
		if value := normalizeHexFingerprint(manifest.CertBackup.CertificateFingerprintSHA256); value != "" {
			return value
		}
		if value := normalizeHexFingerprint(manifest.CertificateSHA256); value != "" {
			return value
		}
	}
	if value := normalizeHexFingerprint(input.RollbackContext.RollbackCertificateSHA); value != "" {
		return value
	}
	return normalizeHexFingerprint(input.Artifact.TargetFingerprintSHA256)
}

func loadLinuxNginxBackupManifest(path string) (*linuxNginxBackupManifest, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var manifest linuxNginxBackupManifest
	if err := json.Unmarshal(bytes, &manifest); err != nil {
		return nil, err
	}
	return &manifest, nil
}

func restoreBackupFile(ref linuxNginxBackupFileRef) error {
	if strings.TrimSpace(ref.TargetPath) == "" {
		return errors.New("targetPath 为空")
	}
	if !ref.Existed {
		if fileExists(ref.TargetPath) {
			return os.Remove(ref.TargetPath)
		}
		return nil
	}
	content, err := os.ReadFile(ref.BackupPath)
	if err != nil {
		return err
	}
	return atomicWritePEMFile(ref.TargetPath, content)
}

func manifestToMap(manifest *linuxNginxBackupManifest) map[string]any {
	if manifest == nil {
		return nil
	}
	raw, _ := json.Marshal(manifest)
	decoded := map[string]any{}
	_ = json.Unmarshal(raw, &decoded)
	return decoded
}

func resolveManifestPathFromManifest(manifest *linuxNginxBackupManifest) string {
	if manifest == nil {
		return ""
	}
	baseDir, err := resolveLinuxNginxBackupBaseDir()
	if err != nil {
		return ""
	}
	runID := sanitizePathSegment(firstNonEmpty(manifest.ExecutionRunID, manifest.TaskID))
	bindingID := sanitizePathSegment(firstNonEmpty(manifest.BindingID, "binding"))
	return filepath.Join(baseDir, runID, bindingID, "backup-manifest.json")
}
