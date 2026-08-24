package command

import (
	"context"
	"os/exec"
	"time"
)

type Spec struct {
	Name    string
	Args    []string
	Stdin   []byte
	Timeout time.Duration
}

type Result struct {
	Stdout   string
	Stderr   string
	ExitCode int
}

type Runner interface {
	Run(context.Context, Spec) (Result, error)
}

type ExecRunner struct{}

func (ExecRunner) Run(ctx context.Context, spec Spec) (Result, error) {
	runCtx := ctx
	cancel := func() {}
	if spec.Timeout > 0 {
		runCtx, cancel = context.WithTimeout(ctx, spec.Timeout)
	}
	defer cancel()
	cmd := exec.CommandContext(runCtx, spec.Name, spec.Args...)
	if len(spec.Stdin) > 0 {
		stdin, err := cmd.StdinPipe()
		if err != nil {
			return Result{}, err
		}
		go func() {
			defer stdin.Close()
			_, _ = stdin.Write(spec.Stdin)
		}()
	}
	stdout, err := cmd.Output()
	result := Result{Stdout: string(stdout)}
	if exitErr, ok := err.(*exec.ExitError); ok {
		result.Stderr = string(exitErr.Stderr)
		result.ExitCode = exitErr.ExitCode()
	}
	return result, err
}
