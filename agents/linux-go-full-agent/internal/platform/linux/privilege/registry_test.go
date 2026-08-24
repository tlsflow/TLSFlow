package privilege

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

func TestSudoUsesNonInteractiveExecution(t *testing.T) {
	runner := &recordingRunner{}
	adapter := NewSudo(runner, Policy{AllowedExecutables: []string{"/usr/bin/systemctl"}})
	_, err := adapter.Execute(context.Background(), command.Spec{Name: "/usr/bin/systemctl", Args: []string{"reload", "nginx"}})
	if err != nil {
		t.Fatal(err)
	}
	if runner.spec.Name != "sudo" || !reflect.DeepEqual(runner.spec.Args, []string{"-n", "--", "/usr/bin/systemctl", "reload", "nginx"}) {
		t.Fatalf("sudo 命令不安全: %#v", runner.spec)
	}
}

func TestAdapterRejectsUnapprovedExecutable(t *testing.T) {
	adapter := NewRoot(&recordingRunner{}, Policy{AllowedExecutables: []string{"/usr/bin/systemctl"}})
	if _, err := adapter.Execute(context.Background(), command.Spec{Name: "/bin/sh"}); err == nil {
		t.Fatal("未批准命令必须拒绝")
	}
}
