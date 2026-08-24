package command

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path"
	"strings"
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
	if err := validateFixedSpec(spec); err != nil {
		return Result{}, err
	}
	program, err := resolveFixedProgram(spec.Name)
	if err != nil {
		return Result{}, err
	}
	args := append([]string(nil), spec.Args...)
	if isPrivilegeProgram(spec.Name) {
		// sudo/doas 后面的目标程序也必须改成固定绝对路径，不能让提权工具再次走 PATH。
		target, err := resolveFixedProgram(args[2])
		if err != nil {
			return Result{}, err
		}
		args[2] = target
	}
	runCtx := ctx
	cancel := func() {}
	if spec.Timeout > 0 {
		runCtx, cancel = context.WithTimeout(ctx, spec.Timeout)
	}
	defer cancel()
	cmd := exec.CommandContext(runCtx, program, args...)
	cmd.Env = []string{"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
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

func validateFixedSpec(spec Spec) error {
	name, ok := fixedProgramName(spec.Name)
	if !ok {
		return errors.New("program is not in the fixed absolute-path allowlist")
	}
	switch name {
	case "systemctl":
		if len(spec.Args) != 2 || !contains([]string{"status", "reload", "restart", "start", "stop"}, spec.Args[0]) || !validServiceName(spec.Args[1]) {
			return errors.New("systemctl arguments do not match the fixed template")
		}
	case "service", "rc-service":
		if len(spec.Args) != 2 || !validServiceName(spec.Args[0]) || !contains([]string{"status", "reload", "restart", "start", "stop"}, spec.Args[1]) {
			return errors.New("service arguments do not match the fixed template")
		}
	case "restorecon":
		if len(spec.Args) != 1 || !strings.HasPrefix(path.Clean(spec.Args[0]), "/") || strings.ContainsAny(spec.Args[0], "\x00\r\n") {
			return errors.New("restorecon requires one absolute path")
		}
	case "getenforce":
		if len(spec.Args) != 0 {
			return errors.New("getenforce does not accept arguments")
		}
	case "aa-status":
		if len(spec.Args) != 1 || spec.Args[0] != "--enabled" {
			return errors.New("aa-status arguments do not match the fixed template")
		}
	case "sudo", "doas":
		if len(spec.Args) < 4 || spec.Args[0] != "-n" || spec.Args[1] != "--" {
			return errors.New("privilege wrapper arguments do not match the fixed template")
		}
		if _, ok := fixedProgramName(spec.Args[2]); !ok || isPrivilegeProgram(spec.Args[2]) {
			return errors.New("privilege wrapper target is not in the fixed allowlist")
		}
		if err := validateFixedSpec(Spec{Name: spec.Args[2], Args: spec.Args[3:]}); err != nil {
			return err
		}
	default:
		return errors.New("program is not in the fixed allowlist")
	}
	return nil
}

var fixedProgramPaths = map[string][]string{
	"systemctl":  {"/usr/bin/systemctl", "/bin/systemctl"},
	"service":    {"/usr/sbin/service", "/sbin/service", "/usr/bin/service", "/bin/service"},
	"rc-service": {"/sbin/rc-service", "/usr/sbin/rc-service", "/usr/bin/rc-service"},
	"restorecon": {"/usr/sbin/restorecon", "/sbin/restorecon", "/usr/bin/restorecon"},
	"getenforce": {"/usr/sbin/getenforce", "/sbin/getenforce", "/usr/bin/getenforce"},
	"aa-status":  {"/usr/sbin/aa-status", "/usr/bin/aa-status", "/sbin/aa-status"},
	"sudo":       {"/usr/bin/sudo", "/bin/sudo"},
	"doas":       {"/usr/bin/doas", "/bin/doas"},
}

func fixedProgramName(value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || strings.ContainsAny(trimmed, "\x00\r\n") {
		return "", false
	}
	if _, ok := fixedProgramPaths[trimmed]; ok {
		return trimmed, true
	}
	cleaned := path.Clean(trimmed)
	for name, paths := range fixedProgramPaths {
		for _, path := range paths {
			if cleaned == path {
				return name, true
			}
		}
	}
	return "", false
}

func resolveFixedProgram(value string) (string, error) {
	name, ok := fixedProgramName(value)
	if !ok {
		return "", errors.New("program is not in the fixed absolute-path allowlist")
	}
	cleaned := path.Clean(strings.TrimSpace(value))
	if strings.HasPrefix(cleaned, "/") {
		if info, err := os.Stat(cleaned); err != nil || !info.Mode().IsRegular() {
			return "", errors.New("fixed program is unavailable")
		}
		return cleaned, nil
	}
	for _, path := range fixedProgramPaths[name] {
		info, err := os.Stat(path)
		if err == nil && info.Mode().IsRegular() {
			return path, nil
		}
	}
	return "", errors.New("fixed program is unavailable")
}

func isPrivilegeProgram(value string) bool {
	name, ok := fixedProgramName(value)
	return ok && (name == "sudo" || name == "doas")
}

func validServiceName(value string) bool {
	if value == "" || len(value) > 128 || strings.TrimSpace(value) != value {
		return false
	}
	for index, current := range value {
		if (current >= 'a' && current <= 'z') || (current >= 'A' && current <= 'Z') || (current >= '0' && current <= '9') || current == '-' || current == '_' || current == '.' || current == '@' || current == ':' {
			if index == 0 && current == '-' {
				return false
			}
			continue
		}
		return false
	}
	return true
}

func contains(values []string, expected string) bool {
	for _, value := range values {
		if value == expected {
			return true
		}
	}
	return false
}
