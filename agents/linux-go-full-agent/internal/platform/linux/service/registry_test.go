package service

import (
	"context"
	"reflect"
	"testing"

	"gcac/linux-go-full-agent/internal/platform/linux/command"
)

type recordingRunner struct {
	spec command.Spec
}

func (runner *recordingRunner) Run(_ context.Context, spec command.Spec) (command.Result, error) {
	runner.spec = spec
	return command.Result{}, nil
}

func TestSystemdControllerBuildsCapabilityCommand(t *testing.T) {
	runner := &recordingRunner{}
	_, err := NewSystemd(runner).Execute(context.Background(), Reload, "gcac-agent", command.Spec{})
	if err != nil {
		t.Fatal(err)
	}
	if runner.spec.Name != "systemctl" || !reflect.DeepEqual(runner.spec.Args, []string{"reload", "gcac-agent"}) {
		t.Fatalf("systemd 命令错误: %#v", runner.spec)
	}
}

func TestRegistryRejectsAmbiguousCapabilities(t *testing.T) {
	registry := NewRegistry()
	_ = registry.Register(NewSystemd(&recordingRunner{}))
	_ = registry.Register(NewSysV(&recordingRunner{}))
	if _, err := registry.Resolve([]string{"linux.systemd.v1", "linux.sysv.v1"}); err == nil {
		t.Fatal("多个服务能力必须明确失败")
	}
}
