package securitymodule

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

func TestSELinuxRestoresOnlyTargetContext(t *testing.T) {
	runner := &recordingRunner{}
	if err := NewSELinux(runner).RestoreFileContext(context.Background(), "/etc/ssl/cert.pem"); err != nil {
		t.Fatal(err)
	}
	if runner.spec.Name != "restorecon" || !reflect.DeepEqual(runner.spec.Args, []string{"/etc/ssl/cert.pem"}) {
		t.Fatalf("SELinux 恢复命令错误: %#v", runner.spec)
	}
}

func TestAppArmorDoesNotModifyGlobalPolicy(t *testing.T) {
	runner := &recordingRunner{}
	if err := NewAppArmor(runner).RestoreFileContext(context.Background(), "/etc/ssl/cert.pem"); err != nil {
		t.Fatal(err)
	}
	if runner.spec.Name != "" {
		t.Fatalf("AppArmor Adapter 不得修改全局策略: %#v", runner.spec)
	}
}
