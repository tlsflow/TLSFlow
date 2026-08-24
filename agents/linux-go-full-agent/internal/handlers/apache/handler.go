package apache

import (
	"context"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"gcac/linux-go-full-agent/internal/core/recovery"
	linuxfs "gcac/linux-go-full-agent/internal/platform/linux/filesystem"
)

type Filesystem interface {
	Backup(string, string) (linuxfs.Backup, error)
	AtomicReplace(string, []byte, os.FileMode) error
	Restore(linuxfs.Backup) error
}

type Service interface {
	Validate(context.Context) error
	Reload(context.Context) error
	Restart(context.Context) error
}

type Security interface {
	RestoreFileContext(context.Context, string) error
}

type Verifier interface {
	Verify(context.Context) error
}

type RecoveryRecorder interface {
	CompleteStep(string) error
	Complete() error
	Fail(string, string, string) error
	RecordFiles([]recovery.FileState) error
	RecordRecovery([]string, string, string) error
	Snapshot() recovery.Entry
}

type Input struct {
	CertificatePath string
	PrivateKeyPath  string
	ChainPath       string
	CertificatePEM  []byte
	PrivateKeyPEM   []byte
	ChainPEM        []byte
	BackupDirectory string
	AllowRestart    bool
	CertificateMode os.FileMode
	PrivateKeyMode  os.FileMode
	ChainMode       os.FileMode
}

type Result struct {
	Success        bool
	ErrorCode      string
	ErrorMessage   string
	CompletedSteps []string
	RecoverySteps  []string
}

type Handler struct {
	filesystem Filesystem
	service    Service
	security   Security
	verifier   Verifier
	recovery   RecoveryRecorder
}

func New(filesystem Filesystem, service Service, security Security, verifier Verifier) *Handler {
	return &Handler{filesystem: filesystem, service: service, security: security, verifier: verifier}
}

func (handler *Handler) WithRecovery(recorder RecoveryRecorder) *Handler {
	handler.recovery = recorder
	return handler
}

func (handler *Handler) Deploy(ctx context.Context, input Input) Result {
	if err := validateInput(input); err != nil {
		return failed("APACHE_PAYLOAD_INVALID", err, nil, nil)
	}
	targets := deploymentTargets(input)
	backups := make([]linuxfs.Backup, 0, len(targets))
	completed := []string{}
	for _, target := range targets {
		backup, err := handler.filesystem.Backup(target.path, target.backupPath)
		if err != nil {
			return failed("APACHE_BACKUP_FAILED", err, completed, nil)
		}
		backups = append(backups, backup)
	}
	handler.recordFiles(backups)
	completed = append(completed, "backup")
	handler.recordStep("backup")
	for _, target := range targets {
		if err := handler.filesystem.AtomicReplace(target.path, target.content, target.mode); err != nil {
			return handler.recover(ctx, "APACHE_INSTALL_FAILED", err, completed, backups)
		}
		if err := handler.security.RestoreFileContext(ctx, target.path); err != nil {
			return handler.recover(ctx, "APACHE_SECURITY_CONTEXT_FAILED", err, completed, backups)
		}
	}
	completed = append(completed, "install")
	handler.recordStep("install")
	if err := handler.service.Validate(ctx); err != nil {
		return handler.recover(ctx, "APACHE_CONFIG_INVALID", err, completed, backups)
	}
	completed = append(completed, "validate")
	handler.recordStep("validate")
	if err := handler.service.Reload(ctx); err != nil {
		if !input.AllowRestart {
			return handler.recover(ctx, "APACHE_RELOAD_FAILED", err, completed, backups)
		}
		if restartErr := handler.service.Restart(ctx); restartErr != nil {
			return handler.recover(ctx, "APACHE_RESTART_FAILED", restartErr, completed, backups)
		}
	}
	completed = append(completed, "reload")
	handler.recordStep("reload")
	if err := handler.verifier.Verify(ctx); err != nil {
		return handler.recover(ctx, "APACHE_VERIFY_FAILED", err, completed, backups)
	}
	completed = append(completed, "verify")
	handler.recordStep("verify")
	handler.recordComplete()
	return Result{Success: true, CompletedSteps: completed}
}

func (handler *Handler) recover(ctx context.Context, code string, cause error, completed []string, backups []linuxfs.Backup) Result {
	coordinator := recovery.NewCoordinator(30 * time.Second)
	outcome := coordinator.Recover(ctx, handler.recovery, "deploy", code, cause, func(recoveryContext context.Context, _ recovery.Entry) ([]string, error) {
		return handler.restore(recoveryContext, backups)
	})
	if outcome.RecoveryFailed {
		return failed("APACHE_RECOVERY_FAILED", fmt.Errorf("%v; recovery: %w", cause, outcome.Error), completed, outcome.RecoverySteps)
	}
	return failed(outcome.FailureCode, cause, completed, outcome.RecoverySteps)
}

func (handler *Handler) restore(ctx context.Context, backups []linuxfs.Backup) ([]string, error) {
	recoverySteps := []string{}
	var recoveryErrors []string
	for index := len(backups) - 1; index >= 0; index-- {
		if err := handler.filesystem.Restore(backups[index]); err != nil {
			recoveryErrors = append(recoveryErrors, err.Error())
			continue
		}
		recoverySteps = append(recoverySteps, "restore:"+backups[index].TargetPath)
	}
	if err := handler.service.Restart(ctx); err != nil {
		recoveryErrors = append(recoveryErrors, err.Error())
	} else {
		recoverySteps = append(recoverySteps, "restart-service")
	}
	if len(recoveryErrors) > 0 {
		return recoverySteps, errors.New(strings.Join(recoveryErrors, "; "))
	}
	return recoverySteps, nil
}

func (handler *Handler) recordStep(step string) {
	if handler.recovery != nil {
		_ = handler.recovery.CompleteStep(step)
	}
}

func (handler *Handler) recordComplete() {
	if handler.recovery != nil {
		_ = handler.recovery.Complete()
	}
}

func (handler *Handler) recordFailure(code string, cause error) {
	if handler.recovery != nil {
		_ = handler.recovery.Fail("deploy", code, cause.Error())
	}
}

func (handler *Handler) recordFiles(backups []linuxfs.Backup) {
	if handler.recovery == nil {
		return
	}
	files := make([]recovery.FileState, 0, len(backups))
	for _, backup := range backups {
		files = append(files, recovery.FileState{
			Path: backup.TargetPath, BackupPath: backup.BackupPath, Existed: backup.Existed,
			Mode: fmt.Sprintf("%04o", backup.Mode.Perm()), Owner: strconv.Itoa(backup.OwnerUID), Group: strconv.Itoa(backup.OwnerGID),
		})
	}
	_ = handler.recovery.RecordFiles(files)
}

func (handler *Handler) recordRecovery(steps []string, result, message string) {
	if handler.recovery != nil {
		_ = handler.recovery.RecordRecovery(steps, result, message)
	}
}

type target struct {
	path       string
	backupPath string
	content    []byte
	mode       os.FileMode
}

func deploymentTargets(input Input) []target {
	items := []target{
		{path: input.CertificatePath, backupPath: input.BackupDirectory + "/certificate.pem", content: input.CertificatePEM, mode: defaultMode(input.CertificateMode, 0o644)},
		{path: input.PrivateKeyPath, backupPath: input.BackupDirectory + "/private-key.pem", content: input.PrivateKeyPEM, mode: defaultMode(input.PrivateKeyMode, 0o600)},
	}
	if strings.TrimSpace(input.ChainPath) != "" {
		items = append(items, target{path: input.ChainPath, backupPath: input.BackupDirectory + "/chain.pem", content: input.ChainPEM, mode: defaultMode(input.ChainMode, 0o644)})
	}
	return items
}

func validateInput(input Input) error {
	if strings.TrimSpace(input.CertificatePath) == "" || strings.TrimSpace(input.PrivateKeyPath) == "" || strings.TrimSpace(input.BackupDirectory) == "" {
		return errors.New("certificate, private key and backup paths are required")
	}
	if block, _ := pem.Decode(input.CertificatePEM); block == nil || block.Type != "CERTIFICATE" {
		return errors.New("invalid certificate PEM")
	}
	if block, _ := pem.Decode(input.PrivateKeyPEM); block == nil || !strings.Contains(block.Type, "PRIVATE KEY") {
		return errors.New("invalid private key PEM")
	}
	if strings.TrimSpace(input.ChainPath) != "" {
		if block, _ := pem.Decode(input.ChainPEM); block == nil || block.Type != "CERTIFICATE" {
			return errors.New("invalid certificate chain PEM")
		}
	}
	return nil
}

func defaultMode(value, fallback os.FileMode) os.FileMode {
	if value == 0 {
		return fallback
	}
	return value
}

func failed(code string, err error, completed, recovery []string) Result {
	return Result{Success: false, ErrorCode: code, ErrorMessage: err.Error(), CompletedSteps: append([]string(nil), completed...), RecoverySteps: append([]string(nil), recovery...)}
}
