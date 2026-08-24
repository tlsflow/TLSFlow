package command

import "testing"

func TestExecRunnerRejectsShellAndFreeProgram(t *testing.T) {
	runner := ExecRunner{}
	if _, err := runner.Run(t.Context(), Spec{Name: "/bin/sh", Args: []string{"-c", "id"}}); err == nil {
		t.Fatal("shell execution must be rejected")
	}
	if _, err := runner.Run(t.Context(), Spec{Name: "/tmp/custom-program"}); err == nil {
		t.Fatal("free executable must be rejected")
	}
}

func TestExecRunnerAcceptsFixedServiceTemplate(t *testing.T) {
	if err := validateFixedSpec(Spec{Name: "/usr/bin/systemctl", Args: []string{"restart", "gcac-agent"}}); err != nil {
		t.Fatalf("fixed service template was rejected: %v", err)
	}
}
