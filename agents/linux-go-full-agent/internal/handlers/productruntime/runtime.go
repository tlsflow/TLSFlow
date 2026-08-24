package productruntime

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gcac/linux-go-full-agent/internal/core/recovery"
	"gcac/linux-go-full-agent/internal/platform/linux/assembly"
	"gcac/linux-go-full-agent/internal/platform/linux/command"
	linuxfs "gcac/linux-go-full-agent/internal/platform/linux/filesystem"
)

func RecoverPending(ctx context.Context, root string, runner command.Runner) error {
	coordinator := recovery.NewCoordinator(30 * time.Second)
	if err := coordinator.Register("certificate.deploy", restoreCertificateDeployment(runner)); err != nil {
		return err
	}
	return coordinator.RecoverPending(ctx, root)
}

func restoreCertificateDeployment(runner command.Runner) recovery.RestoreFunc {
	return func(ctx context.Context, entry recovery.Entry) ([]string, error) {
		capabilities := capabilitiesFromEntry(entry)
		serviceName := stringValue(entry.ServiceState["serviceName"])
		roots := recoveryRoots(entry.Files)
		runtime, err := assembly.Build(assembly.Options{
			Capabilities: capabilities,
			AllowedRoots: roots,
			Executables:  []string{"systemctl", "service", "rc-service", "restorecon"},
			Runner:       runner,
		})
		if err != nil {
			return nil, err
		}
		steps := make([]string, 0, len(entry.Files)+1)
		var recoveryErrors []string
		for index := len(entry.Files) - 1; index >= 0; index-- {
			file := entry.Files[index]
			backup, conversionErr := backupFromFileState(file)
			if conversionErr != nil {
				recoveryErrors = append(recoveryErrors, conversionErr.Error())
				continue
			}
			if restoreErr := runtime.Filesystem.Restore(backup); restoreErr != nil {
				recoveryErrors = append(recoveryErrors, restoreErr.Error())
				continue
			}
			if securityErr := runtime.Security.RestoreFileContext(ctx, file.Path); securityErr != nil {
				recoveryErrors = append(recoveryErrors, securityErr.Error())
				continue
			}
			steps = append(steps, "restore:"+file.Path)
		}
		if serviceName != "" {
			service := assembly.BoundService{Controller: runtime.Service, Name: serviceName}
			if restartErr := service.Restart(ctx); restartErr != nil {
				recoveryErrors = append(recoveryErrors, restartErr.Error())
			} else {
				steps = append(steps, "restart-service")
			}
		}
		if len(recoveryErrors) > 0 {
			return steps, errors.New(strings.Join(recoveryErrors, "; "))
		}
		return steps, nil
	}
}

func recoveryRoots(files []recovery.FileState) []string {
	roots := make([]string, 0, len(files)*2)
	for _, file := range files {
		for _, path := range []string{file.Path, file.BackupPath} {
			if strings.TrimSpace(path) != "" {
				roots = append(roots, filepath.Dir(path))
			}
		}
	}
	return roots
}

func backupFromFileState(file recovery.FileState) (linuxfs.Backup, error) {
	mode := os.FileMode(0)
	if strings.TrimSpace(file.Mode) != "" {
		parsed, err := strconv.ParseUint(file.Mode, 8, 32)
		if err != nil {
			return linuxfs.Backup{}, fmt.Errorf("invalid recovery file mode for %s: %w", file.Path, err)
		}
		mode = os.FileMode(parsed)
	}
	return linuxfs.Backup{
		TargetPath: file.Path,
		BackupPath: file.BackupPath,
		Existed:    file.Existed,
		Mode:       mode,
		OwnerUID:   integerValue(file.Owner, -1),
		OwnerGID:   integerValue(file.Group, -1),
	}, nil
}

func capabilitiesFromEntry(entry recovery.Entry) map[string]bool {
	result := map[string]bool{}
	raw, exists := entry.BeforeState["capabilities"]
	if !exists {
		return result
	}
	items, ok := raw.(map[string]any)
	if !ok {
		return result
	}
	for key, value := range items {
		if enabled, ok := value.(bool); ok && enabled {
			result[key] = true
		}
	}
	return result
}

func cloneCapabilities(source map[string]bool) map[string]bool {
	result := make(map[string]bool, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func stringValue(value any) string {
	text, _ := value.(string)
	return strings.TrimSpace(text)
}

func integerValue(value string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil {
		return fallback
	}
	return parsed
}
