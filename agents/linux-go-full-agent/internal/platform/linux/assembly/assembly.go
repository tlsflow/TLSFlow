package assembly

import (
	"context"
	"errors"
	"path/filepath"
	"strings"

	"gcac/linux-go-full-agent/internal/compatibility"
	"gcac/linux-go-full-agent/internal/platform/linux/command"
	"gcac/linux-go-full-agent/internal/platform/linux/filesystem"
	"gcac/linux-go-full-agent/internal/platform/linux/privilege"
	"gcac/linux-go-full-agent/internal/platform/linux/securitymodule"
	"gcac/linux-go-full-agent/internal/platform/linux/service"
)

type Runtime struct {
	Filesystem *filesystem.Adapter
	Service    service.Controller
	Security   securitymodule.Adapter
	Privilege  privilege.Adapter
}

type Options struct {
	Capabilities map[string]bool
	AllowedRoots []string
	Executables  []string
	Runner       command.Runner
}

func Build(options Options) (Runtime, error) {
	if options.Runner == nil {
		return Runtime{}, errors.New("platform command runner is required")
	}
	filesystemAdapter, err := filesystem.New(cleanRoots(options.AllowedRoots))
	if err != nil {
		return Runtime{}, err
	}
	privilegeAdapter, err := resolvePrivilege(options)
	if err != nil {
		return Runtime{}, err
	}
	privilegedRunner := privilegeRunner{adapter: privilegeAdapter}
	serviceController, err := resolveService(options.Capabilities, privilegedRunner)
	if err != nil {
		return Runtime{}, err
	}
	securityAdapter, err := resolveSecurity(options.Capabilities, privilegedRunner)
	if err != nil {
		return Runtime{}, err
	}
	return Runtime{Filesystem: filesystemAdapter, Service: serviceController, Security: securityAdapter, Privilege: privilegeAdapter}, nil
}

type privilegeRunner struct {
	adapter privilege.Adapter
}

func (runner privilegeRunner) Run(ctx context.Context, spec command.Spec) (command.Result, error) {
	return runner.adapter.Execute(ctx, spec)
}

func resolvePrivilege(options Options) (privilege.Adapter, error) {
	registry := privilege.NewRegistry()
	policy := privilege.Policy{AllowedExecutables: append([]string(nil), options.Executables...)}
	for _, adapter := range []privilege.Adapter{
		privilege.NewRoot(options.Runner, policy),
		privilege.NewSudo(options.Runner, policy),
		privilege.NewDoas(options.Runner, policy),
	} {
		if err := registry.Register(adapter); err != nil {
			return nil, err
		}
	}
	return registry.Resolve(enabled(options.Capabilities,
		compatibility.CapabilityPrivilegeRoot,
		compatibility.CapabilityPrivilegeSudo,
		compatibility.CapabilityPrivilegeDoas,
	))
}

func resolveService(capabilities map[string]bool, runner command.Runner) (service.Controller, error) {
	registry := service.NewRegistry()
	for _, controller := range []service.Controller{service.NewSystemd(runner), service.NewSysV(runner), service.NewOpenRC(runner)} {
		if err := registry.Register(controller); err != nil {
			return nil, err
		}
	}
	return registry.Resolve(enabled(capabilities,
		compatibility.CapabilitySystemd,
		compatibility.CapabilitySysV,
		compatibility.CapabilityOpenRC,
	))
}

func resolveSecurity(capabilities map[string]bool, runner command.Runner) (securitymodule.Adapter, error) {
	registry := securitymodule.NewRegistry()
	for _, adapter := range []securitymodule.Adapter{securitymodule.NewSELinux(runner), securitymodule.NewAppArmor(runner), securitymodule.NewNone(runner)} {
		if err := registry.Register(adapter); err != nil {
			return nil, err
		}
	}
	return registry.Resolve(enabled(capabilities,
		compatibility.CapabilitySELinux,
		compatibility.CapabilityAppArmor,
		compatibility.CapabilitySecurityNone,
	))
}

func enabled(capabilities map[string]bool, keys ...string) []string {
	result := make([]string, 0, len(keys))
	for _, key := range keys {
		if capabilities[key] {
			result = append(result, key)
		}
	}
	return result
}

func cleanRoots(items []string) []string {
	result := make([]string, 0, len(items))
	seen := map[string]struct{}{}
	for _, item := range items {
		clean := filepath.Clean(strings.TrimSpace(item))
		if clean == "." || clean == "" {
			continue
		}
		if _, exists := seen[clean]; exists {
			continue
		}
		seen[clean] = struct{}{}
		result = append(result, clean)
	}
	return result
}

type BoundService struct {
	Controller service.Controller
	Name       string
	Validation command.Spec
}

func (bound BoundService) Validate(ctx context.Context) error {
	_, err := bound.Controller.Execute(ctx, service.Validate, bound.Name, bound.Validation)
	return err
}

func (bound BoundService) Reload(ctx context.Context) error {
	_, err := bound.Controller.Execute(ctx, service.Reload, bound.Name, command.Spec{})
	return err
}

func (bound BoundService) Restart(ctx context.Context) error {
	_, err := bound.Controller.Execute(ctx, service.Restart, bound.Name, command.Spec{})
	return err
}
