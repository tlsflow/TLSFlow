package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

type AgentConfig struct {
	SchemaVersion string `json:"schemaVersion"`
	TenantID      string `json:"tenantId"`
	AgentKey      string `json:"agentKey"`
	ControlPlane  string `json:"controlPlaneUrl"`
	Heartbeat     int    `json:"heartbeatIntervalSeconds"`
	Paths         struct {
		Linux struct {
			ConfigPath string `json:"configPath"`
			DataDir    string `json:"dataDir"`
			LogDir     string `json:"logDir"`
		} `json:"linux"`
	} `json:"paths"`
	Service struct {
		Name        string `json:"name"`
		DisplayName string `json:"displayName"`
	} `json:"service"`
}

type CommandResult struct {
	Command    string            `json:"command"`
	Args       []string          `json:"args"`
	ExitCode   int               `json:"exitCode"`
	Success    bool              `json:"success"`
	DurationMs int64             `json:"durationMs"`
	Stdout     string            `json:"stdout"`
	Stderr     string            `json:"stderr"`
	Env        map[string]string `json:"env,omitempty"`
}

type InspectResult struct {
	CollectedAt string            `json:"collectedAt"`
	GOOS        string            `json:"goos"`
	GOARCH      string            `json:"goarch"`
	Hostname    string            `json:"hostname"`
	CurrentDir  string            `json:"currentDir"`
	User        string            `json:"user"`
	HomeDir     string            `json:"homeDir"`
	Shell       string            `json:"shell"`
	Path        string            `json:"path"`
	OSRelease   map[string]string `json:"osRelease"`
	Uname       map[string]string `json:"uname"`
	Proc        map[string]string `json:"proc"`
	Environment map[string]string `json:"environment"`
}

type InstallMetadata struct {
	ServiceName string `json:"serviceName"`
	InstallRoot string `json:"installRoot"`
	ConfigPath  string `json:"configPath"`
	DataDir     string `json:"dataDir"`
	LogDir      string `json:"logDir"`
	InstalledAt string `json:"installedAt"`
	Mode        string `json:"mode"`
}

func main() {
	if err := runCLI(os.Args[1:]); err != nil {
		writeError(err)
		os.Exit(1)
	}
}

func runCLI(args []string) error {
	if len(args) == 0 {
		printUsage()
		return nil
	}

	switch args[0] {
	case "inspect":
		return handleInspect()
	case "exec":
		return handleExec(args[1:])
	case "self-check":
		return handleSelfCheck(args[1:])
	case "health":
		return handleHealth(args[1:])
	case "run":
		return handleRun(args[1:])
	case "service-info":
		return handleServiceInfo(args[1:])
	case "version":
		return writeJSON(map[string]string{
			"name":    "gcac-linux-agent",
			"version": "0.1.0",
			"runtime": "go",
		})
	case "help", "-h", "--help":
		printUsage()
		return nil
	default:
		return fmt.Errorf("不支持的命令：%s", args[0])
	}
}

func handleInspect() error {
	result, err := collectInspectResult()
	if err != nil {
		return err
	}

	return writeJSON(result)
}

func handleExec(args []string) error {
	if len(args) == 0 {
		return errors.New("exec 需要命令参数，例如：exec -- uname -a")
	}

	timeout := 30 * time.Second
	includeEnv := false
	useShell := false
	commandArgs := args

	for len(commandArgs) > 0 {
		current := commandArgs[0]
		switch {
		case current == "--":
			commandArgs = commandArgs[1:]
			goto execute
		case current == "--shell":
			useShell = true
			commandArgs = commandArgs[1:]
		case current == "--include-env":
			includeEnv = true
			commandArgs = commandArgs[1:]
		case strings.HasPrefix(current, "--timeout="):
			value := strings.TrimPrefix(current, "--timeout=")
			parsed, err := time.ParseDuration(value)
			if err != nil {
				return fmt.Errorf("无效的超时时间：%w", err)
			}
			timeout = parsed
			commandArgs = commandArgs[1:]
		default:
			goto execute
		}
	}

execute:
	if len(commandArgs) == 0 {
		return errors.New("exec 缺少实际命令")
	}

	result, err := executeCommand(commandArgs, useShell, timeout, includeEnv)
	if err != nil {
		return err
	}

	return writeJSON(result)
}

func handleSelfCheck(args []string) error {
	configPath := parseConfigPath(args)
	config, err := loadConfig(configPath)
	if err != nil {
		return err
	}

	checks := []map[string]any{
		checkItem("config.exists", true, map[string]any{"configPath": configPath}),
		checkItem("config.schema", config.SchemaVersion != "", map[string]any{"schemaVersion": config.SchemaVersion}),
		checkItem("service.name", config.Service.Name != "", map[string]any{"serviceName": config.Service.Name}),
		checkItem("linux.configPath", config.Paths.Linux.ConfigPath != "", map[string]any{"value": config.Paths.Linux.ConfigPath}),
		checkItem("linux.dataDir", config.Paths.Linux.DataDir != "", map[string]any{"value": config.Paths.Linux.DataDir}),
		checkItem("linux.logDir", config.Paths.Linux.LogDir != "", map[string]any{"value": config.Paths.Linux.LogDir}),
	}

	systemdAvailable := fileExists("/run/systemd/system") || lookPath("systemctl")
	checks = append(checks, checkItem("linux.systemd.available", systemdAvailable, map[string]any{
		"runSystemdDir": fileExists("/run/systemd/system"),
		"systemctl":     lookPath("systemctl"),
	}))

	for _, target := range []string{config.Paths.Linux.DataDir, config.Paths.Linux.LogDir} {
		if target == "" {
			continue
		}
		checks = append(checks, checkItem("path.writable:"+target, dirWritable(target), map[string]any{"path": target}))
	}

	return writeJSON(map[string]any{
		"success":   allChecksPassed(checks),
		"checkedAt": time.Now().Format(time.RFC3339),
		"checks":    checks,
	})
}

func handleHealth(args []string) error {
	configPath := parseConfigPath(args)
	config, err := loadConfig(configPath)
	if err != nil {
		return err
	}

	return writeJSON(map[string]any{
		"success":   true,
		"checkedAt": time.Now().Format(time.RFC3339),
		"service": map[string]any{
			"name":             config.Service.Name,
			"systemdAvailable": fileExists("/run/systemd/system") || lookPath("systemctl"),
		},
		"paths": map[string]any{
			"dataDirExists": fileExists(config.Paths.Linux.DataDir),
			"logDirExists":  fileExists(config.Paths.Linux.LogDir),
		},
	})
}

func handleRun(args []string) error {
	configPath := parseConfigPath(args)
	config, err := loadConfig(configPath)
	if err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	tickerSeconds := config.Heartbeat
	if tickerSeconds <= 0 {
		tickerSeconds = 30
	}

	fmt.Fprintf(os.Stderr, "GCAC Linux Agent 前台运行中，service=%s config=%s\n", config.Service.Name, configPath)
	ticker := time.NewTicker(time.Duration(tickerSeconds) * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			fmt.Fprintln(os.Stderr, "收到停止信号，Linux Agent 即将退出")
			return nil
		case now := <-ticker.C:
			fmt.Fprintf(os.Stderr, "[heartbeat] %s agent=%s\n", now.Format(time.RFC3339), config.AgentKey)
		}
	}
}

func handleServiceInfo(args []string) error {
	configPath := parseConfigPath(args)
	metadataPath := parseMetadataPath(args)
	config, err := loadConfig(configPath)
	if err != nil {
		return err
	}

	result := map[string]any{
		"config": map[string]any{
			"path":        configPath,
			"schema":      config.SchemaVersion,
			"serviceName": config.Service.Name,
			"dataDir":     config.Paths.Linux.DataDir,
			"logDir":      config.Paths.Linux.LogDir,
		},
		"systemd": map[string]any{
			"available":    fileExists("/run/systemd/system") || lookPath("systemctl"),
			"systemctlPath": findPath("systemctl"),
			"unitPath":      "/etc/systemd/system/" + config.Service.Name + ".service",
		},
		"metadata": map[string]any{
			"path":   metadataPath,
			"exists": fileExists(metadataPath),
		},
	}

	if fileExists(metadataPath) {
		metadata, err := loadInstallMetadata(metadataPath)
		if err == nil {
			result["metadata"] = metadata
		}
	}

	return writeJSON(result)
}

func collectInspectResult() (*InspectResult, error) {
	hostname, _ := os.Hostname()
	currentDir, _ := os.Getwd()
	user := os.Getenv("USER")
	if user == "" {
		user = os.Getenv("LOGNAME")
	}

	result := &InspectResult{
		CollectedAt: time.Now().Format(time.RFC3339),
		GOOS:        runtime.GOOS,
		GOARCH:      runtime.GOARCH,
		Hostname:    hostname,
		CurrentDir:  currentDir,
		User:        user,
		HomeDir:     os.Getenv("HOME"),
		Shell:       os.Getenv("SHELL"),
		Path:        os.Getenv("PATH"),
		OSRelease:   parseKeyValueFiles([]string{"/etc/os-release", "/usr/lib/os-release"}),
		Uname:       map[string]string{},
		Proc:        map[string]string{},
		Environment: pickEnvironment([]string{"LANG", "LC_ALL", "LC_CTYPE", "PATH", "HOME", "SHELL", "USER"}),
	}

	for _, entry := range []struct {
		key  string
		args []string
	}{
		{key: "sysname", args: []string{"-s"}},
		{key: "release", args: []string{"-r"}},
		{key: "machine", args: []string{"-m"}},
		{key: "full", args: []string{"-a"}},
	} {
		output, err := captureCommand("uname", entry.args...)
		if err == nil {
			result.Uname[entry.key] = output
		}
	}

	for _, item := range []struct {
		key  string
		path string
	}{
		{key: "kernel", path: "/proc/version"},
		{key: "cmdline", path: "/proc/cmdline"},
		{key: "cpuinfoModel", path: "/proc/cpuinfo"},
		{key: "meminfo", path: "/proc/meminfo"},
	} {
		value, err := readProcSnippet(item.path)
		if err == nil && value != "" {
			result.Proc[item.key] = value
		}
	}

	return result, nil
}

func executeCommand(commandArgs []string, useShell bool, timeout time.Duration, includeEnv bool) (*CommandResult, error) {
	startedAt := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	var cmd *exec.Cmd
	result := &CommandResult{}

	if useShell {
		script := strings.Join(commandArgs, " ")
		cmd = exec.CommandContext(ctx, "/bin/sh", "-lc", script)
		result.Command = "/bin/sh"
		result.Args = []string{"-lc", script}
	} else {
		cmd = exec.CommandContext(ctx, commandArgs[0], commandArgs[1:]...)
		result.Command = commandArgs[0]
		result.Args = commandArgs[1:]
	}

	stdout, stderr, exitCode, err := runProcess(cmd)
	result.Stdout = stdout
	result.Stderr = stderr
	result.ExitCode = exitCode
	result.Success = err == nil
	result.DurationMs = time.Since(startedAt).Milliseconds()

	if includeEnv {
		result.Env = pickEnvironment([]string{"LANG", "LC_ALL", "PATH", "HOME", "SHELL", "USER"})
	}

	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return result, fmt.Errorf("命令执行超时：%w", err)
		}
		return result, err
	}

	return result, nil
}

func runProcess(cmd *exec.Cmd) (string, string, int, error) {
	output, err := cmd.CombinedOutput()
	stdout := string(output)
	stderr := ""
	exitCode := 0

	if err == nil {
		return strings.TrimSpace(stdout), stderr, exitCode, nil
	}

	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		exitCode = exitErr.ExitCode()
		stderr = strings.TrimSpace(string(exitErr.Stderr))
		return strings.TrimSpace(stdout), stderr, exitCode, fmt.Errorf("命令执行失败，exitCode=%d", exitCode)
	}

	return strings.TrimSpace(stdout), stderr, 1, err
}

func loadConfig(path string) (*AgentConfig, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取配置失败：%w", err)
	}

	var config AgentConfig
	if err := json.Unmarshal(bytes, &config); err != nil {
		return nil, fmt.Errorf("解析配置失败：%w", err)
	}

	return &config, nil
}

func parseConfigPath(args []string) string {
	defaultPath := "/etc/gcac/linux-agent/agent.config.json"
	for i := 0; i < len(args); i++ {
		if args[i] == "--config" && i+1 < len(args) {
			return args[i+1]
		}
		if strings.HasPrefix(args[i], "--config=") {
			return strings.TrimPrefix(args[i], "--config=")
		}
	}
	return defaultPath
}

func parseMetadataPath(args []string) string {
	defaultPath := "/etc/gcac/linux-agent/service.install.json"
	for i := 0; i < len(args); i++ {
		if args[i] == "--metadata" && i+1 < len(args) {
			return args[i+1]
		}
		if strings.HasPrefix(args[i], "--metadata=") {
			return strings.TrimPrefix(args[i], "--metadata=")
		}
	}
	return defaultPath
}

func parseKeyValueFiles(paths []string) map[string]string {
	result := map[string]string{}
	for _, path := range paths {
		content, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(content), "\n") {
			line = strings.TrimSpace(line)
			if line == "" || strings.HasPrefix(line, "#") {
				continue
			}
			parts := strings.SplitN(line, "=", 2)
			if len(parts) != 2 {
				continue
			}
			key := strings.TrimSpace(parts[0])
			value := strings.Trim(strings.TrimSpace(parts[1]), `"`)
			result[key] = value
		}
		if len(result) > 0 {
			return result
		}
	}
	return result
}

func readProcSnippet(path string) (string, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	content := strings.TrimSpace(string(bytes))
	if path == "/proc/cpuinfo" {
		for _, line := range strings.Split(content, "\n") {
			if strings.Contains(line, "model name") {
				return strings.TrimSpace(line), nil
			}
		}
	}
	if len(content) > 400 {
		return content[:400], nil
	}
	return content, nil
}

func pickEnvironment(keys []string) map[string]string {
	result := make(map[string]string, len(keys))
	for _, key := range keys {
		if value, ok := os.LookupEnv(key); ok {
			result[key] = value
		}
	}
	return result
}

func captureCommand(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

func loadInstallMetadata(path string) (*InstallMetadata, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var metadata InstallMetadata
	if err := json.Unmarshal(bytes, &metadata); err != nil {
		return nil, err
	}
	return &metadata, nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func dirWritable(path string) bool {
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return false
	}
	testFile := filepath.Join(path, ".gcac-write-test")
	if err := os.WriteFile(testFile, []byte("ok"), 0o600); err != nil {
		return false
	}
	_ = os.Remove(testFile)
	return true
}

func lookPath(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}

func findPath(name string) string {
	path, err := exec.LookPath(name)
	if err != nil {
		return ""
	}
	return path
}

func allChecksPassed(checks []map[string]any) bool {
	for _, check := range checks {
		if passed, ok := check["success"].(bool); ok && !passed {
			return false
		}
	}
	return true
}

func checkItem(name string, success bool, detail map[string]any) map[string]any {
	return map[string]any{
		"name":    name,
		"success": success,
		"detail":  detail,
	}
}

func writeJSON(value any) error {
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	encoder.SetIndent("", "  ")
	return encoder.Encode(value)
}

func writeError(err error) {
	_ = writeJSON(map[string]any{
		"success": false,
		"error":   err.Error(),
	})
}

func printUsage() {
	lines := []string{
		"GCAC Linux Go Full Agent 最小实现",
		"",
		"用法：",
		"  gcac-linux-agent inspect",
		"  gcac-linux-agent exec [--timeout=30s] [--include-env] -- <cmd> [args...]",
		"  gcac-linux-agent exec --shell -- \"uname -a && id\"",
		"  gcac-linux-agent self-check [--config=/etc/gcac/linux-agent/agent.config.json]",
		"  gcac-linux-agent health [--config=/etc/gcac/linux-agent/agent.config.json]",
		"  gcac-linux-agent service-info [--config=...] [--metadata=...]",
		"  gcac-linux-agent run [--config=/etc/gcac/linux-agent/agent.config.json]",
		"  gcac-linux-agent version",
	}
	fmt.Println(strings.Join(lines, "\n"))
}
