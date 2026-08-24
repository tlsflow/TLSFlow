package assembly

import (
	"context"
	"path/filepath"
	"testing"

	"gcac/linux-go-full-agent/internal/compatibility"
	"gcac/linux-go-full-agent/internal/platform/linux/command"
)

type runnerStub struct{}

func (runnerStub) Run(context.Context, command.Spec) (command.Result, error) {
	return command.Result{}, nil
}

func TestBuildResolvesSingleCapabilityPath(t *testing.T) {
	runtime, err := Build(Options{
		Capabilities: map[string]bool{
			compatibility.CapabilityPrivilegeRoot: true,
			compatibility.CapabilitySystemd:       true,
			compatibility.CapabilitySecurityNone:  true,
		},
		AllowedRoots: []string{filepath.Clean(t.TempDir())},
		Executables:  []string{"systemctl", "apachectl"},
		Runner:       runnerStub{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if runtime.Privilege.ID() != compatibility.CapabilityPrivilegeRoot || runtime.Service.ID() != compatibility.CapabilitySystemd {
		t.Fatalf("平台装配错误: privilege=%s service=%s", runtime.Privilege.ID(), runtime.Service.ID())
	}
}

func TestBuildRejectsAmbiguousServiceCapabilities(t *testing.T) {
	_, err := Build(Options{
		Capabilities: map[string]bool{
			compatibility.CapabilityPrivilegeRoot: true,
			compatibility.CapabilitySystemd:       true,
			compatibility.CapabilitySysV:          true,
			compatibility.CapabilitySecurityNone:  true,
		},
		AllowedRoots: []string{t.TempDir()},
		Executables:  []string{"systemctl", "service"},
		Runner:       runnerStub{},
	})
	if err == nil {
		t.Fatal("多个服务管理能力必须失败关闭")
	}
}
