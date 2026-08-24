package productruntime

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"gcac/linux-go-full-agent/internal/compatibility"
	"gcac/linux-go-full-agent/internal/core/recovery"
	"gcac/linux-go-full-agent/internal/handlers/apache"
	productregistry "gcac/linux-go-full-agent/internal/handlers/registry"
	"gcac/linux-go-full-agent/internal/handlers/tlsverifier"
	"gcac/linux-go-full-agent/internal/handlers/tomcat"
	"gcac/linux-go-full-agent/internal/platform/linux/assembly"
	"gcac/linux-go-full-agent/internal/platform/linux/command"
	linuxfs "gcac/linux-go-full-agent/internal/platform/linux/filesystem"
)

type Input struct {
	ServiceName               string      `json:"serviceName"`
	CertificatePath           string      `json:"certificatePath"`
	PrivateKeyPath            string      `json:"privateKeyPath"`
	ChainPath                 string      `json:"chainPath"`
	KeystorePath              string      `json:"keystorePath"`
	CertificatePEM            string      `json:"certificatePem"`
	PrivateKeyPEM             string      `json:"privateKeyPem"`
	ChainPEM                  string      `json:"chainPem"`
	KeystoreContent           string      `json:"keystoreContent"`
	KeystoreContentEncoding   string      `json:"keystoreContentEncoding"`
	BackupDirectory           string      `json:"backupDirectory"`
	RecoveryLedgerPath        string      `json:"recoveryLedgerPath"`
	AllowRestart              bool        `json:"allowRestart"`
	ValidationCommand         CommandSpec `json:"validationCommand"`
	VerifyHost                string      `json:"verifyHost"`
	VerifyPort                int         `json:"verifyPort"`
	VerifyServerName          string      `json:"verifyServerName"`
	ExpectedFingerprintSHA256 string      `json:"expectedFingerprintSha256"`
}

type CommandSpec struct {
	Name string   `json:"name"`
	Args []string `json:"args"`
}

func Register(registry *productregistry.Registry, runner command.Runner) error {
	for _, handler := range []productregistry.Handler{
		productregistry.HandlerFunc{AdapterID: compatibility.ProductApache, Execute: apacheHandler(runner)},
		productregistry.HandlerFunc{AdapterID: compatibility.ProductTomcat, Execute: tomcatHandler(runner)},
	} {
		if err := registry.Register(handler); err != nil {
			return err
		}
	}
	return nil
}

func RecoverPending(ctx context.Context, root string, runner command.Runner) error {
	coordinator := recovery.NewCoordinator(30 * time.Second)
	if err := coordinator.Register("certificate.deploy", restoreCertificateDeployment(runner)); err != nil {
		return err
	}
	return coordinator.RecoverPending(ctx, root)
}

func apacheHandler(runner command.Runner) func(context.Context, productregistry.Request) productregistry.Result {
	return func(ctx context.Context, request productregistry.Request) productregistry.Result {
		input, runtime, ledger, err := prepare(request, runner)
		if err != nil {
			return failure("APACHE_RUNTIME_PREPARE_FAILED", err)
		}
		service := assembly.BoundService{Controller: runtime.Service, Name: input.ServiceName, Validation: input.ValidationCommand.spec()}
		result := apache.New(runtime.Filesystem, service, runtime.Security, input.verifier()).WithRecovery(ledger).Deploy(ctx, apache.Input{
			CertificatePath: input.CertificatePath, PrivateKeyPath: input.PrivateKeyPath, ChainPath: input.ChainPath,
			CertificatePEM: []byte(input.CertificatePEM), PrivateKeyPEM: []byte(input.PrivateKeyPEM), ChainPEM: []byte(input.ChainPEM),
			BackupDirectory: input.BackupDirectory, AllowRestart: input.AllowRestart,
		})
		return productregistry.Result{Success: result.Success, ErrorCode: result.ErrorCode, ErrorMessage: result.ErrorMessage, Detail: resultDetail(input, result.CompletedSteps, result.RecoverySteps)}
	}
}

func tomcatHandler(runner command.Runner) func(context.Context, productregistry.Request) productregistry.Result {
	return func(ctx context.Context, request productregistry.Request) productregistry.Result {
		input, runtime, ledger, err := prepare(request, runner)
		if err != nil {
			return failure("TOMCAT_RUNTIME_PREPARE_FAILED", err)
		}
		keystore, err := input.keystoreBytes()
		if err != nil {
			return failure("TOMCAT_PAYLOAD_INVALID", err)
		}
		mode := tomcat.ModePEM
		if request.Resolution.ArtifactCodecID != compatibility.CodecPEM {
			mode = tomcat.ModeKeystore
		}
		service := assembly.BoundService{Controller: runtime.Service, Name: input.ServiceName, Validation: input.ValidationCommand.spec()}
		result := tomcat.New(runtime.Filesystem, service, runtime.Security, input.verifier()).WithRecovery(ledger).Deploy(ctx, tomcat.Input{
			Mode: mode, CertificatePath: input.CertificatePath, PrivateKeyPath: input.PrivateKeyPath, ChainPath: input.ChainPath,
			KeystorePath: input.KeystorePath, CertificatePEM: []byte(input.CertificatePEM), PrivateKeyPEM: []byte(input.PrivateKeyPEM),
			ChainPEM: []byte(input.ChainPEM), KeystoreContent: keystore, BackupDirectory: input.BackupDirectory,
		})
		return productregistry.Result{Success: result.Success, ErrorCode: result.ErrorCode, ErrorMessage: result.ErrorMessage, Detail: resultDetail(input, result.CompletedSteps, result.RecoverySteps)}
	}
}

func prepare(request productregistry.Request, runner command.Runner) (Input, assembly.Runtime, *recovery.Ledger, error) {
	input, err := parseInput(request.Input)
	if err != nil {
		return Input{}, assembly.Runtime{}, nil, err
	}
	if strings.TrimSpace(input.ServiceName) == "" || strings.TrimSpace(input.BackupDirectory) == "" || strings.TrimSpace(input.RecoveryLedgerPath) == "" {
		return Input{}, assembly.Runtime{}, nil, errors.New("serviceName, backupDirectory and recoveryLedgerPath are required")
	}
	roots := targetRoots(input)
	executables := []string{"systemctl", "service", "rc-service", "restorecon", input.ValidationCommand.Name}
	runtime, err := assembly.Build(assembly.Options{Capabilities: request.Capabilities, AllowedRoots: roots, Executables: executables, Runner: runner})
	if err != nil {
		return Input{}, assembly.Runtime{}, nil, err
	}
	ledger, err := recovery.Start(input.RecoveryLedgerPath, recovery.Entry{
		OperationID: request.TaskID, ActionType: "certificate.deploy", AuditID: request.TaskID,
		BeforeState: map[string]any{
			"productAdapterId": request.Resolution.ProductAdapterID,
			"serviceName":      input.ServiceName,
			"capabilities":     cloneCapabilities(request.Capabilities),
		},
		ServiceState: map[string]any{"serviceName": input.ServiceName, "controllerId": runtime.Service.ID()},
	})
	return input, runtime, ledger, err
}

func parseInput(input map[string]any) (Input, error) {
	raw, err := json.Marshal(input)
	if err != nil {
		return Input{}, err
	}
	var result Input
	if err := json.Unmarshal(raw, &result); err != nil {
		return Input{}, err
	}
	return result, nil
}

func targetRoots(input Input) []string {
	paths := []string{input.CertificatePath, input.PrivateKeyPath, input.ChainPath, input.KeystorePath, input.BackupDirectory, input.RecoveryLedgerPath}
	roots := make([]string, 0, len(paths))
	for _, path := range paths {
		if strings.TrimSpace(path) != "" {
			roots = append(roots, filepath.Dir(path))
		}
	}
	return roots
}

func (input Input) verifier() tlsverifier.Verifier {
	address := ""
	if strings.TrimSpace(input.VerifyHost) != "" && input.VerifyPort > 0 {
		address = net.JoinHostPort(input.VerifyHost, fmt.Sprintf("%d", input.VerifyPort))
	}
	return tlsverifier.Verifier{Address: address, ServerName: input.VerifyServerName, ExpectedFingerprint: input.ExpectedFingerprintSHA256, Timeout: 5 * time.Second}
}

func (input Input) keystoreBytes() ([]byte, error) {
	if strings.EqualFold(strings.TrimSpace(input.KeystoreContentEncoding), "base64") {
		return base64.StdEncoding.DecodeString(strings.TrimSpace(input.KeystoreContent))
	}
	return []byte(input.KeystoreContent), nil
}

func (spec CommandSpec) spec() command.Spec {
	return command.Spec{Name: strings.TrimSpace(spec.Name), Args: append([]string(nil), spec.Args...), Timeout: 15 * time.Second}
}

func resultDetail(input Input, completed, recovered []string) map[string]any {
	return map[string]any{
		"serviceName": input.ServiceName, "recoveryLedgerPath": input.RecoveryLedgerPath,
		"completedSteps": append([]string(nil), completed...), "recoverySteps": append([]string(nil), recovered...),
	}
}

func failure(code string, err error) productregistry.Result {
	return productregistry.Result{ErrorCode: code, ErrorMessage: err.Error()}
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
