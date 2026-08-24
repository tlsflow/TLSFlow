package tomcat

import (
	"context"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"strings"

	linuxfs "gcac/linux-go-full-agent/internal/platform/linux/filesystem"
)

type Filesystem interface {
	Backup(string, string) (linuxfs.Backup, error)
	AtomicReplace(string, []byte, os.FileMode) error
	Restore(linuxfs.Backup) error
}

type Service interface {
	Validate(context.Context) error
	Restart(context.Context) error
}

type Security interface {
	RestoreFileContext(context.Context, string) error
}

type Verifier interface {
	Verify(context.Context) error
}

type Mode string

const (
	ModePEM      Mode = "pem"
	ModeKeystore Mode = "keystore"
)

type Input struct {
	Mode            Mode
	CertificatePath string
	PrivateKeyPath  string
	ChainPath       string
	KeystorePath    string
	CertificatePEM  []byte
	PrivateKeyPEM   []byte
	ChainPEM        []byte
	KeystoreContent []byte
	BackupDirectory string
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
}

func New(filesystem Filesystem, service Service, security Security, verifier Verifier) *Handler {
	return &Handler{filesystem: filesystem, service: service, security: security, verifier: verifier}
}

func (handler *Handler) Deploy(ctx context.Context, input Input) Result {
	if err := validateInput(input); err != nil {
		return failed("TOMCAT_PAYLOAD_INVALID", err, nil, nil)
	}
	targets := deploymentTargets(input)
	backups := make([]linuxfs.Backup, 0, len(targets))
	completed := []string{}
	for _, target := range targets {
		backup, err := handler.filesystem.Backup(target.path, target.backupPath)
		if err != nil {
			return failed("TOMCAT_BACKUP_FAILED", err, completed, nil)
		}
		backups = append(backups, backup)
	}
	completed = append(completed, "backup")
	for _, target := range targets {
		if err := handler.filesystem.AtomicReplace(target.path, target.content, target.mode); err != nil {
			return handler.recover(ctx, "TOMCAT_INSTALL_FAILED", err, completed, backups)
		}
		if err := handler.security.RestoreFileContext(ctx, target.path); err != nil {
			return handler.recover(ctx, "TOMCAT_SECURITY_CONTEXT_FAILED", err, completed, backups)
		}
	}
	completed = append(completed, "install")
	if err := handler.service.Validate(ctx); err != nil {
		return handler.recover(ctx, "TOMCAT_CONFIG_INVALID", err, completed, backups)
	}
	completed = append(completed, "validate")
	if err := handler.service.Restart(ctx); err != nil {
		return handler.recover(ctx, "TOMCAT_RESTART_FAILED", err, completed, backups)
	}
	completed = append(completed, "restart")
	if err := handler.verifier.Verify(ctx); err != nil {
		return handler.recover(ctx, "TOMCAT_VERIFY_FAILED", err, completed, backups)
	}
	completed = append(completed, "verify")
	return Result{Success: true, CompletedSteps: completed}
}

func (handler *Handler) recover(ctx context.Context, code string, cause error, completed []string, backups []linuxfs.Backup) Result {
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
		return failed("TOMCAT_RECOVERY_FAILED", fmt.Errorf("%v; recovery: %s", cause, strings.Join(recoveryErrors, "; ")), completed, recoverySteps)
	}
	return failed(code, cause, completed, recoverySteps)
}

type target struct {
	path       string
	backupPath string
	content    []byte
	mode       os.FileMode
}

func deploymentTargets(input Input) []target {
	if input.Mode == ModeKeystore {
		return []target{{path: input.KeystorePath, backupPath: input.BackupDirectory + "/keystore", content: input.KeystoreContent, mode: 0o600}}
	}
	items := []target{
		{path: input.CertificatePath, backupPath: input.BackupDirectory + "/certificate.pem", content: input.CertificatePEM, mode: 0o644},
		{path: input.PrivateKeyPath, backupPath: input.BackupDirectory + "/private-key.pem", content: input.PrivateKeyPEM, mode: 0o600},
	}
	if strings.TrimSpace(input.ChainPath) != "" {
		items = append(items, target{path: input.ChainPath, backupPath: input.BackupDirectory + "/chain.pem", content: input.ChainPEM, mode: 0o644})
	}
	return items
}

func validateInput(input Input) error {
	if strings.TrimSpace(input.BackupDirectory) == "" {
		return errors.New("backup directory is required")
	}
	switch input.Mode {
	case ModeKeystore:
		if strings.TrimSpace(input.KeystorePath) == "" || len(input.KeystoreContent) == 0 {
			return errors.New("keystore path and content are required")
		}
	case ModePEM:
		if strings.TrimSpace(input.CertificatePath) == "" || strings.TrimSpace(input.PrivateKeyPath) == "" {
			return errors.New("certificate and private key paths are required")
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
	default:
		return fmt.Errorf("unsupported Tomcat certificate mode: %s", input.Mode)
	}
	return nil
}

func failed(code string, err error, completed, recovery []string) Result {
	return Result{Success: false, ErrorCode: code, ErrorMessage: err.Error(), CompletedSteps: append([]string(nil), completed...), RecoverySteps: append([]string(nil), recovery...)}
}
