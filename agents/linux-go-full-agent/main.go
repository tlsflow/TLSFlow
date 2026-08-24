package main

import (
	"bytes"
	"context"
	"crypto"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"

	"gcac/linux-go-full-agent/internal/atomicplan"
	"gcac/linux-go-full-agent/internal/buildinfo"
	"gcac/linux-go-full-agent/internal/compatibility"
	"gcac/linux-go-full-agent/internal/core/controlplane"
	coreRegistry "gcac/linux-go-full-agent/internal/core/registry"
	linuxFacts "gcac/linux-go-full-agent/internal/platform/linux/facts"
)

const (
	defaultTaskPoll   = 60
	defaultHealthPoll = 30
	defaultOfflineTTL = 180
)

var agentVersion = buildinfo.Version

type AgentConfig struct {
	SchemaVersion              string `json:"schemaVersion"`
	TenantID                   string `json:"tenantId"`
	AgentKey                   string `json:"agentKey"`
	EnrollmentToken            string `json:"enrollmentToken"`
	Role                       string `json:"role"`
	GatewayEnabled             bool   `json:"gatewayEnabled"`
	Zone                       string `json:"zone"`
	ControlPlane               string `json:"controlPlaneUrl"`
	Heartbeat                  int    `json:"heartbeatIntervalSeconds"`
	TaskPollIntervalSeconds    int    `json:"taskPollIntervalSeconds"`
	HealthCheckIntervalSeconds int    `json:"healthCheckIntervalSeconds"`
	OfflineTimeoutSeconds      int    `json:"offlineTimeoutSeconds"`
	DirectControlEnabled       bool   `json:"directControlEnabled"`
	DirectControlListenHost    string `json:"directControlListenHost"`
	DirectControlListenPort    int    `json:"directControlListenPort"`
	DirectControlAdvertiseHost string `json:"directControlAdvertiseHost"`
	CapabilityRescanInterval   int    `json:"capabilityRescanIntervalSeconds"`
	CapabilityRescanEnabled    *bool  `json:"capabilityRescanEnabled"`
	Paths                      struct {
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
	CollectedAt       string                 `json:"collectedAt"`
	GOOS              string                 `json:"goos"`
	GOARCH            string                 `json:"goarch"`
	Hostname          string                 `json:"hostname"`
	CurrentDir        string                 `json:"currentDir"`
	User              string                 `json:"user"`
	HomeDir           string                 `json:"homeDir"`
	Shell             string                 `json:"shell"`
	Path              string                 `json:"path"`
	MachineID         string                 `json:"machineId,omitempty"`
	PrimaryIPAddress  string                 `json:"primaryIpAddress,omitempty"`
	LinuxDistribution string                 `json:"linuxDistribution,omitempty"`
	OSVersion         string                 `json:"osVersion,omitempty"`
	NetworkInterfaces []NetworkInterfaceInfo `json:"networkInterfaces,omitempty"`
	OSRelease         map[string]string      `json:"osRelease"`
	Uname             map[string]string      `json:"uname"`
	Proc              map[string]string      `json:"proc"`
	Environment       map[string]string      `json:"environment"`
	PlatformFacts     linuxFacts.Snapshot    `json:"platformFacts"`
}

type NetworkInterfaceInfo struct {
	Name              string   `json:"name"`
	MACAddress        string   `json:"macAddress,omitempty"`
	IPv4              []string `json:"ipv4,omitempty"`
	IPv6              []string `json:"ipv6,omitempty"`
	Flags             []string `json:"flags,omitempty"`
	HasDefaultGateway bool     `json:"hasDefaultGateway,omitempty"`
	LikelyVirtual     bool     `json:"likelyVirtual,omitempty"`
}

type runtimeIdentity struct {
	MachineID         string
	StableAgentKey    string
	PrimaryIPAddress  string
	LinuxDistribution string
	OSVersion         string
	NetworkInterfaces []NetworkInterfaceInfo
	OSRelease         map[string]string
}

type InstallMetadata struct {
	ServiceName string `json:"serviceName"`
	InstallRoot string `json:"installRoot"`
	ConfigPath  string `json:"configPath"`
	DataDir     string `json:"dataDir"`
	LogDir      string `json:"logDir"`
	BinaryPath  string `json:"binaryPath"`
	BinaryVersion string `json:"binaryVersion"`
	InstalledAt string `json:"installedAt"`
	Mode        string `json:"mode"`
}

type apacheDetail struct {
	Installed  bool               `json:"installed"`
	Running    bool               `json:"running"`
	Version    string             `json:"version,omitempty"`
	BinaryPath string             `json:"binaryPath,omitempty"`
	ServerRoot string             `json:"serverRoot,omitempty"`
	ConfigPath string             `json:"configPath,omitempty"`
	Service    string             `json:"serviceName,omitempty"`
	Sites      []apacheSiteDetail `json:"sites,omitempty"`
}

type apacheSiteDetail struct {
	Name         string                `json:"name"`
	SiteMode     string                `json:"siteMode,omitempty"`
	ServerNames  []string              `json:"serverNames,omitempty"`
	SitePath     string                `json:"sitePath,omitempty"`
	ProxyTargets []string              `json:"proxyTargets,omitempty"`
	Listen       []apacheBindingDetail `json:"listen,omitempty"`
	ConfigFiles  []string              `json:"configFiles,omitempty"`

	serverCertificatePath    string
	serverCertificateKeyPath string
	tlsExplicitlyEnabled     bool
}

type apacheBindingDetail struct {
	Address            string                  `json:"address,omitempty"`
	Port               int                     `json:"port"`
	Protocol           string                  `json:"protocol,omitempty"`
	CertificateName    string                  `json:"certificateName,omitempty"`
	CertificatePath    string                  `json:"certificatePath,omitempty"`
	CertificateKeyPath string                  `json:"certificateKeyPath,omitempty"`
	Certificate        *linuxCertificateDetail `json:"certificate,omitempty"`
}

type apacheContextFrame struct {
	kind      string
	siteIndex int
}

type tomcatDetail struct {
	Installed    bool                    `json:"installed"`
	Running      bool                    `json:"running"`
	Version      string                  `json:"version,omitempty"`
	CatalinaHome string                  `json:"catalinaHome,omitempty"`
	CatalinaBase string                  `json:"catalinaBase,omitempty"`
	ConfigPath   string                  `json:"configPath,omitempty"`
	Service      string                  `json:"serviceName,omitempty"`
	Connectors   []tomcatConnectorDetail `json:"connectors,omitempty"`
	Apps         []tomcatAppDetail       `json:"apps,omitempty"`
}

type tomcatConnectorDetail struct {
	Address            string                  `json:"address,omitempty"`
	Port               int                     `json:"port"`
	Protocol           string                  `json:"protocol,omitempty"`
	TLS                bool                    `json:"tls"`
	CertificateName    string                  `json:"certificateName,omitempty"`
	CertificatePath    string                  `json:"certificatePath,omitempty"`
	CertificateKeyPath string                  `json:"certificateKeyPath,omitempty"`
	KeystorePath       string                  `json:"keystorePath,omitempty"`
	Certificate        *linuxCertificateDetail `json:"certificate,omitempty"`
}

type linuxCertificateDetail struct {
	Subject           string `json:"subject,omitempty"`
	Issuer            string `json:"issuer,omitempty"`
	NotBefore         string `json:"notBefore,omitempty"`
	NotAfter          string `json:"notAfter,omitempty"`
	Thumbprint        string `json:"thumbprint,omitempty"`
	FingerprintSHA256 string `json:"fingerprintSha256,omitempty"`
	StoreName         string `json:"storeName,omitempty"`
}

type tomcatAppDetail struct {
	ContextPath string `json:"contextPath,omitempty"`
	DocBase     string `json:"docBase,omitempty"`
	AppBase     string `json:"appBase,omitempty"`
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
	case "status":
		return handleStatus(args[1:])
	case "run":
		return handleRun(args[1:])
	case "service-info":
		return handleServiceInfo(args[1:])
	case "version":
		return writeJSON(buildinfo.Current())
	case "help", "-h", "--help":
		printUsage()
		return nil
	default:
		return fmt.Errorf("不支持的命令: %s", args[0])
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
		return errors.New("exec 需要命令参数，例如: exec -- uname -a")
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
				return fmt.Errorf("无效的超时时间: %w", err)
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
		checkItem("controlPlane.url", strings.TrimSpace(config.ControlPlane) != "", map[string]any{"value": config.ControlPlane}),
		checkItem("agent.key", strings.TrimSpace(config.AgentKey) != "", map[string]any{"value": config.AgentKey}),
		checkItem("task.poll.interval", effectiveTaskPollSeconds(config) > 0, map[string]any{"seconds": effectiveTaskPollSeconds(config)}),
		checkItem("health.check.interval", effectiveHealthCheckSeconds(config) > 0, map[string]any{"seconds": effectiveHealthCheckSeconds(config)}),
		checkItem("offline.timeout", effectiveOfflineTimeoutSeconds(config) > 0, map[string]any{"seconds": effectiveOfflineTimeoutSeconds(config)}),
		checkItem("direct.control.listen", !config.DirectControlEnabled || effectiveDirectControlListenPort(config) > 0, map[string]any{"enabled": config.DirectControlEnabled, "host": effectiveDirectControlListenHost(config), "port": effectiveDirectControlListenPort(config)}),
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
	checks = append(checks, buildTomcatPermissionChecks()...)

	return writeJSON(map[string]any{
		"success":   allChecksPassed(checks),
		"checkedAt": time.Now().Format(time.RFC3339),
		"checks":    checks,
	})
}

func handleHealth(args []string) error {
	return handleRuntimeStatusCommand(args, true)
}

func handleStatus(args []string) error {
	return handleRuntimeStatusCommand(args, false)
}

func handleServiceInfo(args []string) error {
	configPath := parseConfigPath(args)
	metadataPath := parseMetadataPath(args)
	config, err := loadConfig(configPath)
	if err != nil {
		return err
	}
	identity := collectRuntimeIdentity(config.AgentKey, config.ControlPlane)

	result := map[string]any{
		"binaryVersion": buildinfo.Current().Version,
		"config": map[string]any{
			"path":              configPath,
			"schema":            config.SchemaVersion,
			"serviceName":       config.Service.Name,
			"dataDir":           config.Paths.Linux.DataDir,
			"logDir":            config.Paths.Linux.LogDir,
			"controlPlaneUrl":   config.ControlPlane,
			"agentKey":          config.AgentKey,
			"effectiveAgentKey": identity.StableAgentKey,
			"machineId":         identity.MachineID,
			"ipAddress":         identity.PrimaryIPAddress,
			"linuxDistribution": identity.LinuxDistribution,
			"osVersion":         identity.OSVersion,
			"zone":              config.Zone,
		},
		"systemd": map[string]any{
			"available":     fileExists("/run/systemd/system") || lookPath("systemctl"),
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
	identity := collectRuntimeIdentity("", "")

	result := &InspectResult{
		CollectedAt:       time.Now().Format(time.RFC3339),
		GOOS:              runtime.GOOS,
		GOARCH:            runtime.GOARCH,
		Hostname:          hostname,
		CurrentDir:        currentDir,
		User:              user,
		HomeDir:           os.Getenv("HOME"),
		Shell:             os.Getenv("SHELL"),
		Path:              os.Getenv("PATH"),
		MachineID:         identity.MachineID,
		PrimaryIPAddress:  identity.PrimaryIPAddress,
		LinuxDistribution: identity.LinuxDistribution,
		OSVersion:         identity.OSVersion,
		NetworkInterfaces: identity.NetworkInterfaces,
		OSRelease:         identity.OSRelease,
		Uname:             map[string]string{},
		Proc:              map[string]string{},
		Environment:       pickEnvironment([]string{"LANG", "LC_ALL", "LC_CTYPE", "PATH", "HOME", "SHELL", "USER"}),
		PlatformFacts:     collectLinuxPlatformFacts(),
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
			return result, fmt.Errorf("命令执行超时: %w", err)
		}
		return result, err
	}

	return result, nil
}

func executeCommandWithInput(commandArgs []string, stdin []byte, timeout time.Duration) (*CommandResult, error) {
	startedAt := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, commandArgs[0], commandArgs[1:]...)
	if stdin != nil {
		cmd.Stdin = bytes.NewReader(stdin)
	}
	result := &CommandResult{
		Command: commandArgs[0],
	}
	if len(commandArgs) > 1 {
		result.Args = commandArgs[1:]
	}
	stdout, stderr, exitCode, err := runProcess(cmd)
	result.Stdout = stdout
	result.Stderr = stderr
	result.ExitCode = exitCode
	result.Success = err == nil
	result.DurationMs = time.Since(startedAt).Milliseconds()
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			return result, fmt.Errorf("命令执行超时: %w", err)
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
		return strings.TrimSpace(stdout), stderr, exitCode, fmt.Errorf("命令执行失败: exitCode=%d", exitCode)
	}

	return strings.TrimSpace(stdout), stderr, 1, err
}

func loadConfig(path string) (*AgentConfig, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取配置失败: %w", err)
	}

	var config AgentConfig
	if err := json.Unmarshal(bytes, &config); err != nil {
		return nil, fmt.Errorf("解析配置失败: %w", err)
	}

	return &config, nil
}

func buildLinuxHealthChecks(config *AgentConfig, configPath string) []map[string]any {
	checks := []map[string]any{
		checkItem("config.exists", fileExists(configPath), map[string]any{"configPath": configPath}),
		checkItem("service.name", config.Service.Name != "", map[string]any{"serviceName": config.Service.Name}),
		checkItem("controlPlane.url", isValidControlPlaneURL(config.ControlPlane), map[string]any{"value": config.ControlPlane}),
		checkItem("agent.key", strings.TrimSpace(config.AgentKey) != "", map[string]any{"value": config.AgentKey}),
		checkItem("task.poll.interval", effectiveTaskPollSeconds(config) > 0, map[string]any{"seconds": effectiveTaskPollSeconds(config)}),
		checkItem("health.check.interval", effectiveHealthCheckSeconds(config) > 0, map[string]any{"seconds": effectiveHealthCheckSeconds(config)}),
		checkItem("offline.timeout", effectiveOfflineTimeoutSeconds(config) > 0, map[string]any{"seconds": effectiveOfflineTimeoutSeconds(config)}),
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
	checks = append(checks, buildTomcatPermissionChecks()...)
	return checks
}

func buildTomcatPermissionChecks() []map[string]any {
	processArgs := findTomcatProcessArgs()
	catalinaBase := extractJavaSystemProperty(processArgs, "catalina.base")
	catalinaHome := extractJavaSystemProperty(processArgs, "catalina.home")
	if catalinaBase == "" && catalinaHome == "" {
		catalinaBase, catalinaHome = findTomcatInstallPaths()
	}
	if catalinaBase == "" && catalinaHome == "" {
		return nil
	}

	checks := make([]map[string]any, 0, 2)
	configPath := findTomcatConfigPath(catalinaBase, catalinaHome)
	if configPath != "" {
		checks = append(checks, checkItem("tomcat.config.readable", fileReadable(configPath), map[string]any{"path": configPath}))
	}

	for _, candidate := range findTomcatConfigCandidates(catalinaBase, catalinaHome) {
		if candidate == "" || !fileReadable(candidate) {
			continue
		}
		connectors, _ := parseTomcatServerXML(candidate, catalinaBase)
		seen := make(map[string]struct{})
		for _, connector := range connectors {
			path := strings.TrimSpace(connector.KeystorePath)
			if path == "" {
				path = strings.TrimSpace(connector.CertificatePath)
			}
			if path == "" {
				continue
			}
			if _, exists := seen[path]; exists {
				continue
			}
			seen[path] = struct{}{}
			checks = append(checks, checkItem("tomcat.tls.readable:"+path, fileReadable(path), map[string]any{"path": path}))
		}
		break
	}
	return checks
}

func executeLinuxTaskPayload(taskID string, payload map[string]any) (bool, string, string, map[string]any) {
	taskType := firstNonEmpty(stringFromMap(payload, "actionType"), stringFromMap(payload, "type"))
	result := newLinuxActionRegistry(nil).Execute(context.Background(), coreRegistry.Request{
		TaskID:        taskID,
		ActionType:    taskType,
		SchemaVersion: resolveActionSchemaVersion(taskType, payload),
		Payload:       payload,
	})
	return result.Success, result.ErrorCode, result.ErrorMessage, result.Detail
}

func resolveActionSchemaVersion(actionType string, payload map[string]any) string {
	if schemaVersion := strings.TrimSpace(stringFromMap(payload, "actionSchemaVersion")); schemaVersion != "" {
		return schemaVersion
	}
	return coreRegistry.DefaultSchemaVersion
}

type linuxActionRuntime struct {
	client   *http.Client
	config   *AgentConfig
	state    *runtimeState
	counters *runtimeCounters
	rescan   *rescanState
}

func newLinuxActionRegistry(runtime *linuxActionRuntime) *coreRegistry.Registry {
	registry := coreRegistry.New()
	dataDir := ""
	agentID := ""
	if runtime != nil {
		dataDir = runtime.config.Paths.Linux.DataDir
		agentID = runtime.state.AgentID
	}
	mustRegisterAction(registry, coreRegistry.HandlerFunc{
		ActionType:    "agent.atomic_plan.execute",
		SchemaVersion: "1.0",
		Execute: func(ctx context.Context, request coreRegistry.Request) coreRegistry.Result {
			result := atomicplan.Execute(ctx, request.Payload, agentID, dataDir)
			return coreRegistry.Result{Success: result.Success, ErrorCode: result.ErrorCode, ErrorMessage: result.ErrorMessage, Detail: result.Detail}
		},
	})
	mustRegisterAction(registry, coreRegistry.HandlerFunc{
		ActionType: "agent.self_test",
		Execute: func(_ context.Context, request coreRegistry.Request) coreRegistry.Result {
			return coreRegistry.Result{Success: true, Detail: map[string]any{
				"executor": "linux-go-agent-runtime",
				"mode":     "self-test",
				"taskId":   request.TaskID,
			}}
		},
	})
	for _, handler := range []coreRegistry.HandlerFunc{
		{ActionType: "certificate.key.create_csr", SchemaVersion: "1.0", Execute: linuxCreateCertificateCSR},
		{ActionType: "certificate.install_issued", SchemaVersion: "1.0", Execute: linuxInstallIssuedCertificate},
		{ActionType: "certificate.key.retire", SchemaVersion: "1.0", Execute: linuxRetireCertificateKey},
		{ActionType: "certificate.trust.install", SchemaVersion: "1.0", Execute: linuxInstallCertificateTrust},
		{ActionType: "certificate.trust.rollback", SchemaVersion: "1.0", Execute: linuxRollbackCertificateTrust},
	} {
		mustRegisterAction(registry, handler)
	}
	if runtime != nil {
		mustRegisterAction(registry, coreRegistry.HandlerFunc{
			ActionType: "agent.capability.rescan",
			Execute: func(ctx context.Context, request coreRegistry.Request) coreRegistry.Result {
				detail, err := runCapabilityRescan(ctx, runtime.client, runtime.config, runtime.state, runtime.counters, runtime.rescan, "manual", request.Payload)
				if err != nil {
					return coreRegistry.Result{ErrorCode: "RESCAN_REPORT_FAILED", ErrorMessage: err.Error(), Detail: detail}
				}
				return coreRegistry.Result{Success: true, Detail: detail}
			},
		})
	}
	return registry
}

func mustRegisterAction(registry *coreRegistry.Registry, handler coreRegistry.Handler) {
	if err := registry.Register(handler); err != nil {
		panic(err)
	}
}

func currentLinuxCapabilityMap() map[string]bool {
	return linuxFacts.CapabilityMap(collectLinuxPlatformFacts())
}

func cloneMap(source map[string]any) map[string]any {
	target := make(map[string]any, len(source)+1)
	for key, value := range source {
		target[key] = value
	}
	return target
}

func sanitizePathComponent(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "unknown"
	}
	var builder strings.Builder
	for _, current := range value {
		switch {
		case current >= 'a' && current <= 'z':
			builder.WriteRune(current)
		case current >= 'A' && current <= 'Z':
			builder.WriteRune(current)
		case current >= '0' && current <= '9':
			builder.WriteRune(current)
		case current == '-', current == '_', current == '.':
			builder.WriteRune(current)
		default:
			builder.WriteByte('_')
		}
	}
	return builder.String()
}

func collectLinuxPlatformFacts() linuxFacts.Snapshot {
	registry := linuxFacts.New()
	mustRegisterFactCollector(registry, linuxFacts.CollectorFunc{CollectorName: "runtime", CollectorTimeout: 2 * time.Second, Execute: collectRuntimeFacts})
	mustRegisterFactCollector(registry, linuxFacts.CollectorFunc{CollectorName: "service", CollectorTimeout: 2 * time.Second, Execute: collectServiceFacts})
	mustRegisterFactCollector(registry, linuxFacts.CollectorFunc{CollectorName: "privilege", CollectorTimeout: 2 * time.Second, Execute: collectPrivilegeFacts})
	mustRegisterFactCollector(registry, linuxFacts.CollectorFunc{CollectorName: "filesystem", CollectorTimeout: 2 * time.Second, Execute: collectFilesystemFacts})
	mustRegisterFactCollector(registry, linuxFacts.CollectorFunc{CollectorName: "security", CollectorTimeout: 2 * time.Second, Execute: collectSecurityFacts})
	mustRegisterFactCollector(registry, linuxFacts.CollectorFunc{CollectorName: "products", CollectorTimeout: 10 * time.Second, Execute: collectProductFacts})
	return registry.Collect(context.Background())
}

func mustRegisterFactCollector(registry *linuxFacts.Registry, collector linuxFacts.Collector) {
	if err := registry.Register(collector); err != nil {
		panic(err)
	}
}

func collectRuntimeFacts(context.Context) (any, error) {
	return map[string]any{
		"goos":       runtime.GOOS,
		"goarch":     runtime.GOARCH,
		"goVersion":  runtime.Version(),
		"kernel":     firstNonEmpty(strings.TrimSpace(commandOutput("uname", "-r")), "unknown"),
		"libc":       detectLibcFact(),
		"cgoEnabled": false,
	}, nil
}

func collectServiceFacts(context.Context) (any, error) {
	systemd := lookPath("systemctl") && fileExists("/run/systemd/system")
	openrc := !systemd && lookPath("rc-service") && (fileExists("/run/openrc") || fileExists("/run/softlevel"))
	sysv := !systemd && !openrc && (lookPath("service") || fileExists("/etc/init.d"))
	return map[string]any{
		"systemd": map[string]any{"available": systemd, "runtimeDirectory": fileExists("/run/systemd/system")},
		"sysv":    map[string]any{"available": sysv},
		"openrc":  map[string]any{"available": openrc},
	}, nil
}

func collectPrivilegeFacts(context.Context) (any, error) {
	isRoot := os.Geteuid() == 0
	sudoAvailable, _ := probeSudoNoPassword()
	return map[string]any{
		"effectiveUid": os.Geteuid(),
		"root":         isRoot,
		"sudo":         !isRoot && sudoAvailable,
		"su":           lookPath("su"),
		"doas":         !isRoot && commandSucceeds("doas", "-n", "true"),
	}, nil
}

func commandSucceeds(name string, args ...string) bool {
	if !lookPath(name) {
		return false
	}
	_, err := captureCommand(name, args...)
	return err == nil
}

func collectFilesystemFacts(context.Context) (any, error) {
	return map[string]any{
		"temporaryDirectory": os.TempDir(),
		"atomicRename":       true,
		"posixPermissions":   true,
		"symbolicLinks":      true,
	}, nil
}

func collectSecurityFacts(context.Context) (any, error) {
	return map[string]any{
		"selinux":  map[string]any{"available": lookPath("getenforce") || fileExists("/sys/fs/selinux"), "status": commandOutput("getenforce")},
		"apparmor": map[string]any{"available": lookPath("aa-status") || fileExists("/sys/module/apparmor"), "status": commandOutput("aa-status", "--enabled")},
	}, nil
}

func collectProductFacts(context.Context) (any, error) {
	return map[string]any{
		"nginx":  summarizeProductFact(detectNginxDetail()),
		"apache": summarizeProductFact(detectApacheDetail()),
		"tomcat": summarizeProductFact(detectTomcatDetail()),
	}, nil
}

func summarizeProductFact(detail any) map[string]any {
	raw, err := json.Marshal(detail)
	if err != nil || string(raw) == "null" {
		return map[string]any{"installed": false}
	}
	value := map[string]any{}
	if err := json.Unmarshal(raw, &value); err != nil {
		return map[string]any{"installed": false}
	}
	return value
}

func commandOutput(name string, args ...string) string {
	output, err := captureCommand(name, args...)
	if err != nil {
		return ""
	}
	return output
}

func detectLibcFact() map[string]any {
	if output := commandOutput("getconf", "GNU_LIBC_VERSION"); output != "" {
		return map[string]any{"type": "glibc", "version": output}
	}
	if output := commandOutput("ldd", "--version"); output != "" {
		return map[string]any{"type": "detected", "version": strings.Split(output, "\n")[0]}
	}
	return map[string]any{"type": "unknown"}
}

func effectiveAgentRole(config *AgentConfig) string {
	role := strings.ToLower(strings.TrimSpace(config.Role))
	if role == "gateway" {
		return "gateway"
	}
	return "full_agent"
}

func isPureGatewayRole(config *AgentConfig) bool {
	return effectiveAgentRole(config) == "gateway"
}

func isGatewayEnabled(config *AgentConfig) bool {
	return isPureGatewayRole(config) || config.GatewayEnabled
}

func gatewayRouteChannels() []string {
	return []string{"probe.tcp", "probe.http", "probe.agent", "forward.agent_task", "forward.direct_control"}
}

func gatewayCapabilityKeys() []string {
	return []string{"gateway.probe.tcp", "gateway.probe.http", "gateway.probe.agent", "gateway.forward.agent_task", "gateway.forward.direct_control"}
}

func gatewayAdaptersIfNeeded(config *AgentConfig) []string {
	if !isGatewayEnabled(config) {
		return nil
	}
	return gatewayRouteChannels()
}

func registeredLinuxAdapterIDs(config *AgentConfig) []string {
	items := append([]string(nil), compatibility.PublicAdapterIDs()...)
	items = append(items, gatewayAdaptersIfNeeded(config)...)
	sort.Strings(items)
	result := items[:0]
	for _, item := range items {
		if len(result) == 0 || result[len(result)-1] != item {
			result = append(result, item)
		}
	}
	return result
}

func executeGatewayTask(ctx context.Context, client *http.Client, config *AgentConfig, task agentTaskEnvelope, payload map[string]any) (bool, string, string, map[string]any, bool) {
	taskType := strings.TrimSpace(stringFromMap(payload, "type"))
	if taskType != "gateway.probe" && taskType != "gateway.forward.agent_task" && taskType != "gateway.forward.direct_control" {
		return false, "", "", nil, false
	}
	if !isGatewayEnabled(config) {
		return false, "GATEWAY_ROLE_REQUIRED", "当前 Agent 未以 gateway 角色运行，拒绝处理 Gateway 路由任务", map[string]any{"taskId": task.ID, "type": taskType}, true
	}
	gatewayTask := mapFromMap(payload, "gatewayTask")
	gatewayPayload := mapFromMap(gatewayTask, "payload")
	if gatewayPayload == nil {
		gatewayPayload = payload
	}
	if err := validateForwardingGrant(gatewayTask, taskType); err != nil {
		return false, "GATEWAY_FORWARDING_GRANT_DENIED", err.Error(), map[string]any{"taskId": task.ID, "type": taskType, "mode": "gateway.forwarding_grant.denied"}, true
	}
	switch taskType {
	case "gateway.probe":
		return executeGatewayProbe(ctx, client, config, task, gatewayTask, gatewayPayload)
	case "gateway.forward.agent_task":
		return forwardGatewayAgentTask(ctx, client, config, task, gatewayTask, gatewayPayload, false)
	case "gateway.forward.direct_control":
		return forwardGatewayDirectControl(ctx, client, config, task, gatewayTask, gatewayPayload)
	default:
		return false, "GATEWAY_TASK_UNSUPPORTED", "不支持的 Gateway 路由任务", map[string]any{"taskId": task.ID, "type": taskType}, true
	}
}

func validateForwardingGrant(gatewayTask map[string]any, taskType string) error {
	grant := mapFromMap(gatewayTask, "forwardingGrant")
	if grant == nil {
		return errors.New("Gateway 转发缺少 ForwardingGrant")
	}
	if stringFromMap(grant, "status") != "active" {
		return fmt.Errorf("ForwardingGrant 不可用: %s", stringFromMap(grant, "status"))
	}
	expiresAt := stringFromMap(grant, "expiresAt")
	if expiresAt == "" {
		return errors.New("ForwardingGrant 缺少 expiresAt")
	}
	parsed, err := time.Parse(time.RFC3339, expiresAt)
	if err != nil {
		return fmt.Errorf("ForwardingGrant expiresAt 不合法: %w", err)
	}
	if !time.Now().Before(parsed) {
		return errors.New("ForwardingGrant 已过期")
	}
	if intFromMap(grant, "remainingUses") <= 0 {
		return errors.New("ForwardingGrant 使用次数已耗尽")
	}
	if stringFromMap(grant, "gatewayId") != stringFromMap(gatewayTask, "gatewayId") {
		return errors.New("ForwardingGrant gatewayId 不匹配")
	}
	if stringFromMap(grant, "delegatedTargetId") != stringFromMap(gatewayTask, "delegatedTargetId") {
		return errors.New("ForwardingGrant delegatedTargetId 不匹配")
	}
	if stringFromMap(grant, "taskType") != taskType {
		return errors.New("ForwardingGrant taskType 不匹配")
	}
	if stringFromMap(grant, "routeChannel") != stringFromMap(gatewayTask, "adapter") {
		return errors.New("ForwardingGrant routeChannel 不匹配")
	}
	return nil
}

func executeGatewayProbe(ctx context.Context, client *http.Client, config *AgentConfig, task agentTaskEnvelope, gatewayTask map[string]any, gatewayPayload map[string]any) (bool, string, string, map[string]any, bool) {
	channel := gatewayRouteChannel(gatewayTask, gatewayPayload)
	start := time.Now()
	var success bool
	var detail map[string]any
	var err error
	if channel == "probe.tls" {
		success, detail, err = probeTLSReachability(ctx, gatewayPayload)
	} else if channel == "probe.http" {
		success, detail, err = probeHTTPReachability(ctx, gatewayPayload)
	} else {
		success, detail, err = probeTCPReachability(ctx, gatewayTask, gatewayPayload)
	}
	detail["mode"] = "gateway.probe"
	detail["routeChannel"] = channel
	detail["taskId"] = task.ID
	detail["durationMs"] = time.Since(start).Milliseconds()
	if err != nil {
		recordGatewayReachability(ctx, client, config, gatewayTask, detail, "unreachable")
		return false, "GATEWAY_PROBE_FAILED", err.Error(), detail, true
	}
	recordGatewayReachability(ctx, client, config, gatewayTask, detail, "reachable")
	return success, "", "", detail, true
}

func probeTLSReachability(ctx context.Context, gatewayPayload map[string]any) (bool, map[string]any, error) {
	input := gatewayProbeInput(gatewayPayload)
	verification := mapFromMap(input, "certificateVerification")
	if stringFromMap(verification, "capabilityKey") != "certificate.verify" || stringFromMap(verification, "schemaVersion") != "1.0" {
		return false, map[string]any{}, errors.New("gateway.probe TLS 缺少 certificate.verify/v1 宿主能力输入")
	}
	host := stringFromMap(verification, "connectHost")
	port := intFromMap(verification, "port")
	serverName := stringFromMap(verification, "serverName")
	if host == "" || port <= 0 || serverName == "" {
		return false, map[string]any{"host": host, "port": port, "serverName": serverName}, errors.New("gateway.probe TLS 缺少连接地址、端口或 SNI")
	}
	dialer := &net.Dialer{Timeout: 8 * time.Second}
	connection, err := (&tls.Dialer{NetDialer: dialer, Config: &tls.Config{ServerName: serverName, InsecureSkipVerify: true, MinVersion: tls.VersionTLS12}}).DialContext(ctx, "tcp", net.JoinHostPort(host, fmt.Sprintf("%d", port)))
	if err != nil {
		return false, map[string]any{"host": host, "port": port, "serverName": serverName}, err
	}
	defer connection.Close()
	certificates := connection.(*tls.Conn).ConnectionState().PeerCertificates
	if len(certificates) == 0 {
		return false, map[string]any{"host": host, "port": port, "serverName": serverName}, errors.New("TLS 握手未返回远端证书")
	}
	certificate := certificates[0]
	if err := certificate.VerifyHostname(serverName); err != nil {
		return false, map[string]any{"host": host, "port": port, "serverName": serverName}, fmt.Errorf("TLS 证书域名不匹配: %w", err)
	}
	fingerprint := fmt.Sprintf("%x", sha256.Sum256(certificate.Raw))
	return true, map[string]any{
		"verify": map[string]any{
			"remoteCertificateSha256": fingerprint,
			"subject":                 certificate.Subject.String(),
			"notAfter":                certificate.NotAfter.UTC().Format(time.RFC3339),
		},
		"certificateVerification": map[string]any{
			"capabilityKey": "certificate.verify",
			"schemaVersion": "1.0",
			"source":        "GATEWAY",
		},
	}, nil
}

func probeTCPReachability(ctx context.Context, gatewayTask map[string]any, gatewayPayload map[string]any) (bool, map[string]any, error) {
	host, port := gatewayProbeHostPort(gatewayTask, gatewayPayload)
	if host == "" || port <= 0 {
		return false, map[string]any{"host": host, "port": port}, errors.New("gateway.probe 缺少 host/port")
	}
	dialer := net.Dialer{Timeout: 5 * time.Second}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, fmt.Sprintf("%d", port)))
	if err != nil {
		return false, map[string]any{"host": host, "port": port}, err
	}
	_ = conn.Close()
	return true, map[string]any{"host": host, "port": port}, nil
}

func probeHTTPReachability(ctx context.Context, gatewayPayload map[string]any) (bool, map[string]any, error) {
	targetURL := gatewayProbeURL(gatewayPayload)
	if targetURL == "" {
		return false, map[string]any{}, errors.New("gateway.probe HTTP 缺少 url/verifyUrl")
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, targetURL, nil)
	if err != nil {
		return false, map[string]any{"url": targetURL}, err
	}
	response, err := (&http.Client{Timeout: 8 * time.Second}).Do(request)
	if err != nil {
		request.Method = http.MethodGet
		response, err = (&http.Client{Timeout: 8 * time.Second}).Do(request)
	}
	if err != nil {
		return false, map[string]any{"url": targetURL}, err
	}
	defer response.Body.Close()
	return response.StatusCode < 500, map[string]any{"url": targetURL, "statusCode": response.StatusCode}, nil
}

func forwardGatewayAgentTask(ctx context.Context, client *http.Client, config *AgentConfig, task agentTaskEnvelope, gatewayTask map[string]any, gatewayPayload map[string]any, directControl bool) (bool, string, string, map[string]any, bool) {
	targetPayload := mapFromMap(gatewayPayload, "targetPayload")
	if targetPayload == nil {
		targetPayload = mapFromMap(gatewayTask, "payload")
	}
	targetAgentID := firstNonEmpty(
		stringFromMap(gatewayPayload, "targetAgentId"),
		stringFromMap(gatewayPayload, "delegatedAgentId"),
		stringFromMap(targetPayload, "agentId"),
		stringFromMap(targetPayload, "executionTargetId"),
		stringFromMap(gatewayTask, "delegatedTargetId"),
	)
	if targetAgentID == "" {
		return false, "GATEWAY_FORWARD_TARGET_AGENT_REQUIRED", "Gateway 转发缺少目标 agentId", map[string]any{"taskId": task.ID, "mode": "gateway.forward"}, true
	}
	if targetPayload == nil {
		targetPayload = map[string]any{}
	}
	forwardPayload := map[string]any{}
	for key, value := range targetPayload {
		forwardPayload[key] = value
	}
	forwardPayload["gatewayForwarded"] = true
	forwardPayload["gatewayTaskId"] = stringFromMap(gatewayTask, "id")
	var response agentTaskEnvelope
	err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/tasks", enqueueAgentTaskRequest{
		AgentID:         targetAgentID,
		ExecutionRunID:  firstNonEmpty(stringFromMap(gatewayTask, "executionRunId"), task.ExecutionRunID),
		ExecutionStepID: firstNonEmpty(stringFromMap(gatewayTask, "stepId"), task.ExecutionStepID),
		IdempotencyKey:  firstNonEmpty(stringFromMap(gatewayTask, "idempotencyKey"), "gateway-forward:"+task.ID),
		Payload:         forwardPayload,
	}, &response)
	detail := map[string]any{"mode": "gateway.forward.agent_task", "targetAgentId": targetAgentID, "forwardedTaskId": response.ID, "directControl": directControl}
	if err != nil {
		return false, "GATEWAY_FORWARD_AGENT_TASK_FAILED", err.Error(), detail, true
	}
	return true, "", "", detail, true
}

func forwardGatewayDirectControl(ctx context.Context, client *http.Client, config *AgentConfig, task agentTaskEnvelope, gatewayTask map[string]any, gatewayPayload map[string]any) (bool, string, string, map[string]any, bool) {
	targetPayload := mapFromMap(gatewayPayload, "targetPayload")
	directURL := firstNonEmpty(stringFromMap(gatewayPayload, "directControlUrl"), stringFromMap(targetPayload, "directControlUrl"))
	if directURL == "" {
		return forwardGatewayAgentTask(ctx, client, config, task, gatewayTask, gatewayPayload, true)
	}
	actionType := firstNonEmpty(stringFromMap(gatewayPayload, "actionType"), stringFromMap(targetPayload, "actionType"))
	inputs := mapFromMap(gatewayPayload, "inputs")
	if inputs == nil {
		inputs = mapFromMap(targetPayload, "inputs")
	}
	var response map[string]any
	err := doDirectControlJSON(ctx, directURL, "/api/v1/control/actions/execute", map[string]any{"actionType": actionType, "inputs": inputs, "requestId": "gateway-" + task.ID}, &response)
	detail := map[string]any{"mode": "gateway.forward.direct_control", "directControlUrl": directURL, "response": response}
	if err != nil {
		return false, "GATEWAY_FORWARD_DIRECT_CONTROL_FAILED", err.Error(), detail, true
	}
	return true, "", "", detail, true
}

func recordGatewayReachability(ctx context.Context, client *http.Client, config *AgentConfig, gatewayTask map[string]any, detail map[string]any, status string) {
	gatewayID := firstNonEmpty(stringFromMap(gatewayTask, "gatewayId"), stringFromMap(gatewayTask, "id"))
	targetID := firstNonEmpty(stringFromMap(gatewayTask, "delegatedTargetId"), stringFromMap(mapFromMap(gatewayTask, "target"), "id"))
	if gatewayID == "" || targetID == "" {
		return
	}
	_ = doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/gateways/probe", map[string]any{
		"gatewayId":  gatewayID,
		"targetId":   targetID,
		"protocol":   detail["routeChannel"],
		"port":       detail["port"],
		"status":     status,
		"latencyMs":  detail["durationMs"],
		"ttlSeconds": 300,
	}, nil)
}

func gatewayRouteChannel(gatewayTask map[string]any, gatewayPayload map[string]any) string {
	channel := strings.ToLower(firstNonEmpty(stringFromMap(gatewayTask, "adapter"), stringFromMap(gatewayPayload, "routeChannel")))
	switch channel {
	case "http", "https", "curl", "probe.http":
		return "probe.http"
	case "probe.tls":
		return "probe.tls"
	case "agent", "probe.agent":
		return "probe.agent"
	case "forward.direct_control", "gateway.forward.direct_control", "direct_control":
		return "forward.direct_control"
	case "forward.agent_task", "gateway.forward.agent_task", "agent_task":
		return "forward.agent_task"
	default:
		return "probe.tcp"
	}
}

func gatewayProbeHostPort(gatewayTask map[string]any, gatewayPayload map[string]any) (string, int) {
	gatewayPayload = gatewayProbeInput(gatewayPayload)
	target := mapFromMap(gatewayTask, "target")
	host := firstNonEmpty(stringFromMap(gatewayPayload, "host"), stringFromMap(target, "host"))
	port := intFromMap(gatewayPayload, "port")
	if port == 0 {
		port = intFromMap(target, "port")
	}
	if host == "" {
		if parsed, err := url.Parse(gatewayProbeURL(gatewayPayload)); err == nil {
			host = parsed.Hostname()
			if parsed.Port() != "" {
				fmt.Sscanf(parsed.Port(), "%d", &port)
			}
		}
	}
	if port == 0 {
		port = 443
	}
	return host, port
}

func gatewayProbeInput(gatewayPayload map[string]any) map[string]any {
	if targetPayload := mapFromMap(gatewayPayload, "targetPayload"); targetPayload != nil {
		return targetPayload
	}
	return gatewayPayload
}

func gatewayProbeURL(gatewayPayload map[string]any) string {
	return firstNonEmpty(stringFromMap(gatewayPayload, "url"), stringFromMap(gatewayPayload, "verifyUrl"))
}

func doDirectControlJSON(ctx context.Context, baseURL string, endpointPath string, payload any, target any) error {
	encoded, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(baseURL, "/")+endpointPath, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	response, err := (&http.Client{Timeout: 20 * time.Second}).Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	body, err := io.ReadAll(response.Body)
	if err != nil {
		return err
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	if target != nil && len(bytes.TrimSpace(body)) > 0 {
		return json.Unmarshal(body, target)
	}
	return nil
}

func sanitizePathSegment(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "default"
	}
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", " ", "_")
	return replacer.Replace(value)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func errorString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func commandExitCode(result *CommandResult) int {
	if result == nil {
		return 1
	}
	return result.ExitCode
}

func commandStdout(result *CommandResult) string {
	if result == nil {
		return ""
	}
	return strings.TrimSpace(result.Stdout)
}

func commandStderr(result *CommandResult) string {
	if result == nil {
		return ""
	}
	return strings.TrimSpace(result.Stderr)
}

func mapFromCommandResult(result *CommandResult, mode string) map[string]any {
	if result == nil {
		return map[string]any{"mode": mode}
	}
	return map[string]any{
		"mode":       mode,
		"command":    result.Command,
		"args":       result.Args,
		"exitCode":   result.ExitCode,
		"success":    result.Success,
		"durationMs": result.DurationMs,
		"stdout":     result.Stdout,
		"stderr":     result.Stderr,
	}
}

func classifyCommandFailure(defaultCode string, result *CommandResult) string {
	if result == nil {
		return defaultCode
	}
	text := strings.ToLower(strings.TrimSpace(result.Stderr + "\n" + result.Stdout))
	switch {
	case strings.Contains(text, "permission denied"), strings.Contains(text, "operation not permitted"), strings.Contains(text, "must be root"):
		return "PRIVILEGE_REQUIRED"
	case strings.Contains(text, "sudo: a password is required"), strings.Contains(text, "not in the sudoers"):
		return "SUDO_PERMISSION_REQUIRED"
	case result.ExitCode == 127:
		return "COMMAND_NOT_FOUND"
	default:
		return defaultCode
	}
}

func formatThumbprintSha1(cert *x509.Certificate) string {
	if cert == nil {
		return ""
	}
	sum := sha1.Sum(cert.Raw)
	hexValue := strings.ToUpper(hex.EncodeToString(sum[:]))
	parts := make([]string, 0, len(hexValue)/2)
	for index := 0; index < len(hexValue); index += 2 {
		parts = append(parts, hexValue[index:index+2])
	}
	return strings.Join(parts, ":")
}

func maxInt(left int, right int) int {
	if left >= right {
		return left
	}
	return right
}

func parseCertificatePEM(value string) (*x509.Certificate, error) {
	rest := []byte(value)
	for len(rest) > 0 {
		block, remaining := pem.Decode(rest)
		if block == nil {
			break
		}
		if block.Type == "CERTIFICATE" {
			cert, err := x509.ParseCertificate(block.Bytes)
			if err != nil {
				return nil, err
			}
			return cert, nil
		}
		rest = remaining
	}
	return nil, errors.New("certificatePem 中未找到可解析的 CERTIFICATE 块")
}

func parsePrivateKeyPEMSigner(value string) (crypto.Signer, string, error) {
	block, _ := pem.Decode([]byte(value))
	if block == nil {
		return nil, "", errors.New("未找到 PEM block")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, "PKCS1-RSA", nil
	}
	if keyAny, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		signer, ok := keyAny.(crypto.Signer)
		if !ok {
			return nil, "", errors.New("PKCS8 私钥类型不支持 signer 接口")
		}
		return signer, "PKCS8", nil
	}
	if key, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
		return key, "EC", nil
	}
	return nil, "", errors.New("私钥 PEM 解析失败")
}

func certificateMatchesPrivateKey(cert *x509.Certificate, signer crypto.Signer) bool {
	if cert == nil || signer == nil {
		return false
	}
	return publicKeysEqual(cert.PublicKey, signer.Public())
}

func publicKeysEqual(left any, right any) bool {
	leftBytes, leftErr := x509.MarshalPKIXPublicKey(left)
	rightBytes, rightErr := x509.MarshalPKIXPublicKey(right)
	if leftErr != nil || rightErr != nil {
		return false
	}
	return bytes.Equal(leftBytes, rightBytes)
}

func normalizeHexFingerprint(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, ":", "")
	return value
}

func summarizeDryRunChecks(checks []map[string]any) map[string]int {
	summary := map[string]int{
		"passed":  0,
		"failed":  0,
		"warning": 0,
		"unknown": 0,
	}
	for _, check := range checks {
		status := strings.TrimSpace(stringFromAny(check["status"]))
		if _, ok := summary[status]; ok {
			summary[status]++
		} else {
			summary["unknown"]++
		}
	}
	return summary
}

func dryRunCheck(key string, label string, status string, detail string, evidence map[string]any) map[string]any {
	check := map[string]any{
		"key":    key,
		"label":  label,
		"status": status,
	}
	if strings.TrimSpace(detail) != "" {
		check["detail"] = detail
	}
	if len(evidence) > 0 {
		check["evidence"] = evidence
	}
	return check
}

func firstShellToken(command string) string {
	fields := strings.Fields(strings.TrimSpace(command))
	if len(fields) == 0 {
		return ""
	}
	return strings.Trim(fields[0], `"'`)
}

func resolveExecutablePath(name string) string {
	if strings.TrimSpace(name) == "" {
		return ""
	}
	if strings.ContainsRune(name, filepath.Separator) {
		info, err := os.Stat(name)
		if err != nil || info.IsDir() {
			return ""
		}
		if info.Mode().Perm()&0o111 == 0 {
			return ""
		}
		return name
	}
	return findPath(name)
}

func modeReadable(mode os.FileMode) bool {
	return mode.Perm()&0o444 != 0
}

func modeWritable(mode os.FileMode) bool {
	return mode.Perm()&0o222 != 0
}

func stringFromMap(input map[string]any, key string) string {
	if input == nil {
		return ""
	}
	return stringFromAny(input[key])
}

func mapFromMap(input map[string]any, key string) map[string]any {
	if input == nil {
		return nil
	}
	typed, _ := input[key].(map[string]any)
	return typed
}

func intFromMap(input map[string]any, key string) int {
	if input == nil {
		return 0
	}
	switch value := input[key].(type) {
	case int:
		return value
	case float64:
		return int(value)
	case json.Number:
		parsed, _ := value.Int64()
		return int(parsed)
	default:
		return 0
	}
}

func stringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case fmt.Stringer:
		return typed.String()
	default:
		return ""
	}
}

func detectPrimaryIPAddress() string {
	return collectRuntimeIdentity("", "").PrimaryIPAddress
}

func detectLinuxDistribution() string {
	return collectRuntimeIdentity("", "").LinuxDistribution
}

func detectLinuxVersion() string {
	return collectRuntimeIdentity("", "").OSVersion
}

func collectRuntimeIdentity(fallbackAgentKey string, controlPlaneURL string) runtimeIdentity {
	release := parseKeyValueFiles([]string{"/etc/os-release", "/usr/lib/os-release"})
	machineID := detectMachineID()
	defaultRouteInterfaces := detectDefaultRouteInterfaces()
	dnsConfigured := hasConfiguredDNS()
	interfaces := collectNetworkInterfaces(defaultRouteInterfaces)
	primaryIP := detectPreferredSourceIP(controlPlaneURL)
	if primaryIP == "" {
		primaryIP = selectPrimaryIPAddress(interfaces, dnsConfigured)
	}
	identity := runtimeIdentity{
		MachineID:         machineID,
		StableAgentKey:    strings.TrimSpace(fallbackAgentKey),
		PrimaryIPAddress:  primaryIP,
		LinuxDistribution: detectLinuxDistributionFromRelease(release),
		OSVersion:         detectLinuxVersionFromRelease(release),
		NetworkInterfaces: interfaces,
		OSRelease:         release,
	}
	if machineID != "" {
		identity.StableAgentKey = buildStableAgentKey(machineID)
	}
	return identity
}

func detectPreferredSourceIP(controlPlaneURL string) string {
	target := strings.TrimSpace(controlPlaneURL)
	if target == "" {
		return ""
	}
	address, err := parseDialTarget(target)
	if err != nil {
		return ""
	}
	conn, err := net.DialTimeout("tcp", address, 5*time.Second)
	if err != nil {
		return ""
	}
	defer conn.Close()
	tcpAddr, ok := conn.LocalAddr().(*net.TCPAddr)
	if !ok || tcpAddr == nil || tcpAddr.IP == nil {
		return ""
	}
	ip := tcpAddr.IP
	if ipv4 := ip.To4(); ipv4 != nil {
		return ipv4.String()
	}
	if ip.IsUnspecified() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return ""
	}
	return ip.String()
}

func parseDialTarget(rawURL string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "", err
	}
	host := strings.TrimSpace(parsed.Hostname())
	if host == "" {
		return "", fmt.Errorf("controlPlaneUrl 缺少主机名: %s", rawURL)
	}
	port := strings.TrimSpace(parsed.Port())
	if port == "" {
		switch strings.ToLower(strings.TrimSpace(parsed.Scheme)) {
		case "https":
			port = "443"
		case "http":
			port = "80"
		default:
			port = "443"
		}
	}
	return net.JoinHostPort(host, port), nil
}

func detectMachineID() string {
	for _, path := range []string{"/etc/machine-id", "/var/lib/dbus/machine-id"} {
		content, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		value := strings.ToLower(strings.TrimSpace(string(content)))
		value = strings.ReplaceAll(value, "-", "")
		if value != "" {
			return value
		}
	}
	return ""
}

func buildStableAgentKey(machineID string) string {
	sum := sha256.Sum256([]byte(machineID))
	return "linuxgo.mid." + hex.EncodeToString(sum[:8])
}

func detectLinuxDistributionFromRelease(release map[string]string) string {
	for _, key := range []string{"PRETTY_NAME", "NAME", "ID"} {
		if value := strings.TrimSpace(release[key]); value != "" {
			return value
		}
	}
	return ""
}

func detectLinuxVersionFromRelease(release map[string]string) string {
	for _, key := range []string{"VERSION", "VERSION_ID"} {
		if value := strings.TrimSpace(release[key]); value != "" {
			return value
		}
	}
	return ""
}

func collectNetworkInterfaces(defaultRouteInterfaces map[string]struct{}) []NetworkInterfaceInfo {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil
	}

	results := make([]NetworkInterfaceInfo, 0, len(interfaces))
	for _, iface := range interfaces {
		addresses, err := iface.Addrs()
		if err != nil {
			continue
		}
		item := NetworkInterfaceInfo{
			Name:              iface.Name,
			MACAddress:        strings.TrimSpace(iface.HardwareAddr.String()),
			Flags:             interfaceFlags(iface.Flags),
			HasDefaultGateway: interfaceHasDefaultRoute(defaultRouteInterfaces, iface.Name),
			LikelyVirtual:     isLikelyVirtualInterface(iface.Name),
		}
		for _, addr := range addresses {
			ip := extractIP(addr)
			if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			if ipv4 := ip.To4(); ipv4 != nil {
				item.IPv4 = append(item.IPv4, ipv4.String())
				continue
			}
			item.IPv6 = append(item.IPv6, ip.String())
		}
		sort.Strings(item.IPv4)
		sort.Strings(item.IPv6)
		results = append(results, item)
	}
	sort.Slice(results, func(i, j int) bool {
		return results[i].Name < results[j].Name
	})
	return results
}

func selectPrimaryIPAddress(items []NetworkInterfaceInfo, dnsConfigured bool) string {
	bestIPv4 := ""
	bestIPv4Score := -1 << 30
	bestIPv6 := ""
	bestIPv6Score := -1 << 30
	for _, item := range items {
		if !containsFlag(item.Flags, "up") || containsFlag(item.Flags, "loopback") {
			continue
		}
		score := scoreInterface(item, dnsConfigured)
		if len(item.IPv4) > 0 && score > bestIPv4Score {
			bestIPv4Score = score
			bestIPv4 = item.IPv4[0]
		}
		if len(item.IPv6) > 0 && score > bestIPv6Score {
			bestIPv6Score = score
			bestIPv6 = item.IPv6[0]
		}
	}
	if bestIPv4 != "" {
		return bestIPv4
	}
	if bestIPv6 != "" {
		return bestIPv6
	}
	return ""
}

func scoreInterface(item NetworkInterfaceInfo, dnsConfigured bool) int {
	score := 0
	if containsFlag(item.Flags, "up") {
		score += 10
	}
	if containsFlag(item.Flags, "running") {
		score += 10
	}
	if item.HasDefaultGateway {
		score += 100
	}
	if dnsConfigured && item.HasDefaultGateway {
		score += 30
	}
	if item.MACAddress != "" {
		score += 5
	}
	if item.LikelyVirtual {
		score -= 80
	}
	if len(item.IPv4) > 0 {
		score += 20
	}
	if len(item.IPv6) > 0 {
		score += 5
	}
	return score
}

func extractIP(addr net.Addr) net.IP {
	switch value := addr.(type) {
	case *net.IPNet:
		return value.IP
	case *net.IPAddr:
		return value.IP
	default:
		return nil
	}
}

func interfaceFlags(flags net.Flags) []string {
	names := []struct {
		mask net.Flags
		name string
	}{
		{mask: net.FlagUp, name: "up"},
		{mask: net.FlagBroadcast, name: "broadcast"},
		{mask: net.FlagLoopback, name: "loopback"},
		{mask: net.FlagPointToPoint, name: "point_to_point"},
		{mask: net.FlagMulticast, name: "multicast"},
		{mask: net.FlagRunning, name: "running"},
	}
	result := make([]string, 0, len(names))
	for _, item := range names {
		if flags&item.mask != 0 {
			result = append(result, item.name)
		}
	}
	return result
}

func containsFlag(flags []string, expected string) bool {
	for _, flag := range flags {
		if flag == expected {
			return true
		}
	}
	return false
}

func detectDefaultRouteInterfaces() map[string]struct{} {
	results := make(map[string]struct{})
	collectIPv4DefaultRouteInterfaces(results)
	collectIPv6DefaultRouteInterfaces(results)
	return results
}

func collectIPv4DefaultRouteInterfaces(target map[string]struct{}) {
	content, err := os.ReadFile("/proc/net/route")
	if err != nil {
		return
	}
	lines := strings.Split(string(content), "\n")
	for _, line := range lines[1:] {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 4 {
			continue
		}
		if fields[1] != "00000000" {
			continue
		}
		ifaceName := strings.TrimSpace(fields[0])
		if ifaceName != "" {
			target[ifaceName] = struct{}{}
		}
	}
}

func collectIPv6DefaultRouteInterfaces(target map[string]struct{}) {
	content, err := os.ReadFile("/proc/net/ipv6_route")
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(content), "\n") {
		fields := strings.Fields(strings.TrimSpace(line))
		if len(fields) < 10 {
			continue
		}
		if fields[0] != strings.Repeat("0", 32) || fields[1] != "00000000" {
			continue
		}
		ifaceName := strings.TrimSpace(fields[len(fields)-1])
		if ifaceName != "" {
			target[ifaceName] = struct{}{}
		}
	}
}

func interfaceHasDefaultRoute(defaultRouteInterfaces map[string]struct{}, name string) bool {
	_, ok := defaultRouteInterfaces[name]
	return ok
}

func hasConfiguredDNS() bool {
	content, err := os.ReadFile("/etc/resolv.conf")
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(content), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(strings.ToLower(line), "nameserver ") {
			return true
		}
	}
	return false
}

func isLikelyVirtualInterface(name string) bool {
	lower := strings.ToLower(strings.TrimSpace(name))
	virtualPrefixes := []string{
		"docker", "br-", "veth", "cni", "flannel", "kube", "virbr", "vmnet", "vboxnet",
		"zt", "tailscale", "wg", "tun", "tap", "podman", "lxc", "cbr", "ifb",
	}
	for _, prefix := range virtualPrefixes {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return false
}

func captureCombinedCommand(name string, args ...string) (string, error) {
	cmd := exec.Command(name, args...)
	output, err := cmd.CombinedOutput()
	return strings.TrimSpace(string(output)), err
}

func detectApacheDetail() *apacheDetail {
	binaryPath := findApacheBinaryPath()
	running := processRunning("apache2") || processRunning("httpd")
	if binaryPath == "" && !running {
		return nil
	}

	detail := &apacheDetail{
		Installed:  binaryPath != "",
		Running:    running,
		BinaryPath: binaryPath,
		Service:    detectApacheServiceName(binaryPath),
	}
	if binaryPath == "" {
		return detail
	}

	versionOutput, _ := captureCombinedCommand(binaryPath, "-v")
	buildOutput, _ := captureCombinedCommand(binaryPath, "-V")
	detail.Version = parseApacheVersion(versionOutput)
	detail.ServerRoot = parseApacheDefine(buildOutput, "HTTPD_ROOT")
	serverConfigFile := parseApacheDefine(buildOutput, "SERVER_CONFIG_FILE")
	detail.ConfigPath = resolveApacheConfigPath(detail.ServerRoot, serverConfigFile)
	if detail.ConfigPath != "" {
		sites := parseApacheConfigTree(detail.ConfigPath, detail.ServerRoot)
		for index := range sites {
			enrichApacheSiteCertificates(&sites[index])
		}
		detail.Sites = sites
	}
	return detail
}

func findApacheBinaryPath() string {
	for _, name := range []string{"apache2ctl", "apachectl", "httpd", "apache2"} {
		if path, err := exec.LookPath(name); err == nil {
			return path
		}
	}
	for _, candidate := range []string{
		"/usr/sbin/apache2ctl",
		"/usr/sbin/apachectl",
		"/usr/sbin/httpd",
		"/usr/sbin/apache2",
	} {
		if fileExists(candidate) {
			return candidate
		}
	}
	return ""
}

func detectApacheServiceName(binaryPath string) string {
	lower := strings.ToLower(binaryPath)
	if strings.Contains(lower, "apache2") {
		return "apache2"
	}
	return "httpd"
}

func parseApacheVersion(output string) string {
	marker := "Server version: Apache/"
	index := strings.Index(output, marker)
	if index < 0 {
		return ""
	}
	value := output[index+len(marker):]
	if end := strings.IndexAny(value, " \r\n\t"); end >= 0 {
		value = value[:end]
	}
	return strings.TrimSpace(value)
}

func parseApacheDefine(output string, key string) string {
	pattern := key + "=\""
	index := strings.Index(output, pattern)
	if index < 0 {
		return ""
	}
	value := output[index+len(pattern):]
	if end := strings.Index(value, "\""); end >= 0 {
		return strings.TrimSpace(value[:end])
	}
	return ""
}

func resolveApacheConfigPath(serverRoot string, configFile string) string {
	configFile = strings.TrimSpace(configFile)
	if configFile == "" {
		return ""
	}
	if filepath.IsAbs(configFile) {
		return configFile
	}
	if serverRoot != "" {
		return filepath.Join(serverRoot, configFile)
	}
	return configFile
}

func parseApacheConfigTree(configPath string, serverRoot string) []apacheSiteDetail {
	visited := make(map[string]struct{})
	sites := make([]apacheSiteDetail, 0)
	parseApacheConfigFile(configPath, serverRoot, visited, &sites)
	for index := range sites {
		finalizeApacheSite(&sites[index], index)
	}
	filtered := make([]apacheSiteDetail, 0, len(sites))
	for _, site := range sites {
		if len(site.Listen) == 0 && len(site.ServerNames) == 0 && site.SitePath == "" && len(site.ProxyTargets) == 0 {
			continue
		}
		filtered = append(filtered, site)
	}
	return filtered
}

func parseApacheConfigFile(configPath string, serverRoot string, visited map[string]struct{}, sites *[]apacheSiteDetail) {
	absolutePath := configPath
	if !filepath.IsAbs(absolutePath) {
		if serverRoot != "" {
			absolutePath = filepath.Join(serverRoot, absolutePath)
		} else {
			absolutePath, _ = filepath.Abs(absolutePath)
		}
	}
	absolutePath = filepath.Clean(absolutePath)
	if _, seen := visited[absolutePath]; seen {
		return
	}
	visited[absolutePath] = struct{}{}

	content, err := os.ReadFile(absolutePath)
	if err != nil {
		return
	}
	lines := strings.Split(string(content), "\n")
	stack := make([]apacheContextFrame, 0, 8)
	listenDefaults := make([]apacheBindingDetail, 0)
	baseDir := filepath.Dir(absolutePath)

	for _, rawLine := range lines {
		line := stripApacheInlineComment(rawLine)
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "<virtualhost") && strings.HasSuffix(trimmed, ">") {
			inside := strings.TrimSuffix(strings.TrimPrefix(trimmed, "<VirtualHost"), ">")
			inside = strings.TrimSuffix(strings.TrimPrefix(inside, "<virtualhost"), ">")
			site := apacheSiteDetail{}
			site.Listen = append(site.Listen, parseApacheVirtualHostBindings(inside)...)
			addApacheSiteConfigFile(&site, absolutePath)
			*sites = append(*sites, site)
			stack = append(stack, apacheContextFrame{kind: "virtualhost", siteIndex: len(*sites) - 1})
			continue
		}
		if strings.HasPrefix(lower, "</virtualhost") {
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
			continue
		}
		fields := strings.Fields(trimmed)
		if len(fields) == 0 {
			continue
		}
		directive := strings.ToLower(fields[0])
		args := fields[1:]
		siteIndex := activeApacheSiteIndex(stack)
		switch directive {
		case "include", "includeoptional":
			for _, includePath := range resolveApacheIncludePaths(baseDir, serverRoot, firstArgument(args)) {
				parseApacheConfigFile(includePath, serverRoot, visited, sites)
			}
		case "listen":
			if binding, ok := parseApacheListen(args); ok {
				listenDefaults = append(listenDefaults, binding)
				if siteIndex >= 0 && siteIndex < len(*sites) {
					(*sites)[siteIndex].Listen = append((*sites)[siteIndex].Listen, binding)
				}
			}
		case "servername":
			if siteIndex >= 0 && siteIndex < len(*sites) && len(args) > 0 {
				(*sites)[siteIndex].ServerNames = append((*sites)[siteIndex].ServerNames, strings.TrimSpace(args[0]))
			}
		case "serveralias":
			if siteIndex >= 0 && siteIndex < len(*sites) {
				for _, arg := range args {
					if trimmedArg := strings.TrimSpace(arg); trimmedArg != "" {
						(*sites)[siteIndex].ServerNames = append((*sites)[siteIndex].ServerNames, trimmedArg)
					}
				}
			}
		case "documentroot":
			if siteIndex >= 0 && siteIndex < len(*sites) && len(args) > 0 {
				(*sites)[siteIndex].SitePath = strings.Trim(firstArgument(args), "\"'")
			}
		case "sslcertificatefile":
			if siteIndex >= 0 && siteIndex < len(*sites) {
				(*sites)[siteIndex].serverCertificatePath = resolveApachePath(baseDir, serverRoot, firstArgument(args))
			}
		case "sslcertificatekeyfile":
			if siteIndex >= 0 && siteIndex < len(*sites) {
				(*sites)[siteIndex].serverCertificateKeyPath = resolveApachePath(baseDir, serverRoot, firstArgument(args))
			}
		case "sslengine":
			if siteIndex >= 0 && siteIndex < len(*sites) && len(args) > 0 && strings.EqualFold(strings.TrimSpace(args[0]), "on") {
				(*sites)[siteIndex].tlsExplicitlyEnabled = true
			}
		case "proxypass":
			if siteIndex >= 0 && siteIndex < len(*sites) && len(args) >= 2 {
				target := strings.TrimSpace(args[1])
				if target != "" {
					(*sites)[siteIndex].ProxyTargets = append((*sites)[siteIndex].ProxyTargets, target)
				}
			}
		}
		if siteIndex >= 0 && siteIndex < len(*sites) {
			addApacheSiteConfigFile(&(*sites)[siteIndex], absolutePath)
		}
	}
}

func stripApacheInlineComment(line string) string {
	inSingle := false
	inDouble := false
	for index, char := range line {
		switch char {
		case '\'':
			if !inDouble {
				inSingle = !inSingle
			}
		case '"':
			if !inSingle {
				inDouble = !inDouble
			}
		case '#':
			if !inSingle && !inDouble {
				return line[:index]
			}
		}
	}
	return line
}

func parseApacheVirtualHostBindings(value string) []apacheBindingDetail {
	fields := strings.Fields(strings.TrimSpace(value))
	bindings := make([]apacheBindingDetail, 0, len(fields))
	for _, field := range fields {
		address, port := splitListenAddress(strings.Trim(field, "\"'"))
		if port <= 0 {
			continue
		}
		binding := apacheBindingDetail{Address: address, Port: port, Protocol: "http"}
		if binding.Address == "" {
			binding.Address = "*"
		}
		if port == 443 {
			binding.Protocol = "https"
		}
		bindings = append(bindings, binding)
	}
	return bindings
}

func activeApacheSiteIndex(stack []apacheContextFrame) int {
	for index := len(stack) - 1; index >= 0; index-- {
		if stack[index].siteIndex >= 0 {
			return stack[index].siteIndex
		}
	}
	return -1
}

func resolveApacheIncludePaths(baseDir string, serverRoot string, includePattern string) []string {
	includePattern = strings.Trim(includePattern, "\"'")
	if includePattern == "" {
		return nil
	}
	resolved := resolveApachePath(baseDir, serverRoot, includePattern)
	matches, err := filepath.Glob(resolved)
	if err == nil && len(matches) > 0 {
		return matches
	}
	if fileExists(resolved) {
		return []string{resolved}
	}
	return nil
}

func resolveApachePath(baseDir string, serverRoot string, pathValue string) string {
	pathValue = strings.Trim(pathValue, "\"'")
	if pathValue == "" {
		return ""
	}
	if isUnixAbsolutePath(pathValue) {
		return cleanUnixPath(pathValue)
	}
	if filepath.IsAbs(pathValue) {
		return filepath.Clean(pathValue)
	}
	if baseDir != "" {
		return filepath.Clean(filepath.Join(baseDir, pathValue))
	}
	if serverRoot != "" {
		return filepath.Clean(filepath.Join(serverRoot, pathValue))
	}
	return filepath.Clean(pathValue)
}

func isUnixAbsolutePath(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	return strings.HasPrefix(value, "/")
}

func cleanUnixPath(value string) string {
	parts := strings.Split(value, "/")
	stack := make([]string, 0, len(parts))
	for _, part := range parts {
		switch part {
		case "", ".":
			continue
		case "..":
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		default:
			stack = append(stack, part)
		}
	}
	return "/" + strings.Join(stack, "/")
}

func parseApacheListen(args []string) (apacheBindingDetail, bool) {
	if len(args) == 0 {
		return apacheBindingDetail{}, false
	}
	address, port := splitListenAddress(strings.Trim(args[0], "\"'"))
	if port <= 0 {
		return apacheBindingDetail{}, false
	}
	if address == "" {
		address = "*"
	}
	protocol := "http"
	if port == 443 {
		protocol = "https"
	}
	return apacheBindingDetail{Address: address, Port: port, Protocol: protocol}, true
}

func ensureApacheBinding(site *apacheSiteDetail, defaults []apacheBindingDetail) {
	if len(site.Listen) > 0 {
		return
	}
	if len(defaults) > 0 {
		site.Listen = append(site.Listen, defaults[0])
		return
	}
	site.Listen = append(site.Listen, apacheBindingDetail{Address: "*", Port: 443, Protocol: "https"})
}

func addApacheSiteConfigFile(site *apacheSiteDetail, path string) {
	path = strings.TrimSpace(path)
	if path == "" {
		return
	}
	for _, existing := range site.ConfigFiles {
		if existing == path {
			return
		}
	}
	site.ConfigFiles = append(site.ConfigFiles, path)
}

func finalizeApacheSite(site *apacheSiteDetail, index int) {
	site.ServerNames = uniqueStrings(site.ServerNames)
	site.ProxyTargets = uniqueStrings(site.ProxyTargets)
	site.ConfigFiles = uniqueStrings(site.ConfigFiles)
	applyApacheSiteCertificate(site)
	if site.Name == "" {
		if len(site.ServerNames) > 0 {
			site.Name = site.ServerNames[0]
		} else {
			site.Name = fmt.Sprintf("apache-vhost-%d", index+1)
		}
	}
	if site.SitePath != "" {
		site.SiteMode = "static_root"
	} else if len(site.ProxyTargets) > 0 {
		site.SiteMode = "reverse_proxy"
	} else {
		site.SiteMode = "unknown"
	}
}

func applyApacheSiteCertificate(site *apacheSiteDetail) {
	if site.serverCertificatePath == "" && site.serverCertificateKeyPath == "" {
		return
	}
	ensureApacheBinding(site, nil)
	for index := range site.Listen {
		site.Listen[index].Protocol = "https"
		if site.Listen[index].CertificatePath == "" {
			site.Listen[index].CertificatePath = site.serverCertificatePath
		}
		if site.Listen[index].CertificateKeyPath == "" {
			site.Listen[index].CertificateKeyPath = site.serverCertificateKeyPath
		}
	}
}

func enrichApacheSiteCertificates(site *apacheSiteDetail) {
	for index := range site.Listen {
		if site.Listen[index].CertificatePath == "" {
			continue
		}
		site.Listen[index].Certificate = readCertificateDetail(site.Listen[index].CertificatePath)
		if site.Listen[index].Certificate != nil {
			site.Listen[index].CertificateName = site.Listen[index].Certificate.Subject
		}
		if site.Listen[index].Protocol == "" {
			site.Listen[index].Protocol = "https"
		}
	}
}

func detectTomcatDetail() *tomcatDetail {
	processArgs := findTomcatProcessArgs()
	catalinaBase := extractJavaSystemProperty(processArgs, "catalina.base")
	catalinaHome := extractJavaSystemProperty(processArgs, "catalina.home")
	running := processArgs != ""
	if catalinaBase == "" && catalinaHome == "" {
		catalinaBase, catalinaHome = findTomcatInstallPaths()
	}
	if catalinaBase == "" && catalinaHome == "" && !running {
		return nil
	}
	if catalinaBase == "" {
		catalinaBase = catalinaHome
	}
	if catalinaHome == "" {
		catalinaHome = catalinaBase
	}
	configPath := findTomcatConfigPath(catalinaBase, catalinaHome)
	detail := &tomcatDetail{
		Installed:    catalinaBase != "" || catalinaHome != "",
		Running:      running,
		CatalinaHome: catalinaHome,
		CatalinaBase: catalinaBase,
		ConfigPath:   configPath,
		Service:      "tomcat",
	}
	detail.Version = detectTomcatVersion(catalinaHome)
	for _, candidate := range findTomcatConfigCandidates(catalinaBase, catalinaHome) {
		if candidate == "" || !fileExists(candidate) {
			continue
		}
		connectors, apps := parseTomcatServerXML(candidate, catalinaBase)
		if len(connectors) == 0 && len(apps) == 0 {
			continue
		}
		detail.ConfigPath = candidate
		detail.Connectors = connectors
		detail.Apps = apps
		break
	}
	if len(detail.Apps) == 0 {
		detail.Apps = append(detail.Apps, scanTomcatKnownAppBases(catalinaBase, catalinaHome)...)
	}
	detail.Apps = uniqueTomcatApps(detail.Apps)
	return detail
}

func findTomcatProcessArgs() string {
	output, err := captureCommand("ps", "-eo", "args=")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.Contains(trimmed, "org.apache.catalina.startup.Bootstrap") {
			return trimmed
		}
	}
	return ""
}

func extractJavaSystemProperty(args string, key string) string {
	pattern := regexp.MustCompile(`-D` + regexp.QuoteMeta(key) + `=([^\s]+)`)
	match := pattern.FindStringSubmatch(args)
	if len(match) < 2 {
		return ""
	}
	return strings.Trim(match[1], "\"'")
}

func findTomcatInstallPaths() (string, string) {
	candidates := []string{
		"/opt/tomcat",
		"/usr/share/tomcat",
		"/usr/share/tomcat9",
		"/usr/share/tomcat10",
		"/var/lib/tomcat9",
		"/var/lib/tomcat10",
	}
	for _, candidate := range candidates {
		if fileExists(filepath.Join(candidate, "conf", "server.xml")) {
			return candidate, candidate
		}
	}
	return "", ""
}

func findTomcatConfigPath(catalinaBase string, catalinaHome string) string {
	for _, candidate := range findTomcatConfigCandidates(catalinaBase, catalinaHome) {
		if fileExists(candidate) {
			return candidate
		}
	}
	candidates := findTomcatConfigCandidates(catalinaBase, catalinaHome)
	if len(candidates) > 0 {
		return candidates[0]
	}
	return ""
}

func findTomcatConfigCandidates(catalinaBase string, catalinaHome string) []string {
	candidates := make([]string, 0, 8)
	if catalinaBase != "" {
		candidates = append(candidates, filepath.Join(catalinaBase, "conf", "server.xml"))
		if baseName := filepath.Base(catalinaBase); baseName != "" {
			candidates = append(candidates, filepath.Join("/etc", baseName, "server.xml"))
		}
	}
	if catalinaHome != "" {
		candidates = append(candidates, filepath.Join(catalinaHome, "conf", "server.xml"))
		if homeName := filepath.Base(catalinaHome); homeName != "" {
			candidates = append(candidates, filepath.Join("/etc", homeName, "server.xml"))
		}
	}
	candidates = append(candidates,
		"/etc/tomcat/server.xml",
		"/etc/tomcat9/server.xml",
		"/etc/tomcat10/server.xml",
	)
	return uniqueStrings(candidates)
}

func detectTomcatVersion(catalinaHome string) string {
	if catalinaHome == "" {
		return ""
	}
	releaseInfoPath := filepath.Join(catalinaHome, "RELEASE-NOTES")
	if content, err := os.ReadFile(releaseInfoPath); err == nil {
		pattern := regexp.MustCompile(`Apache Tomcat Version ([0-9.]+)`)
		match := pattern.FindStringSubmatch(string(content))
		if len(match) >= 2 {
			return match[1]
		}
	}
	return ""
}

type tomcatServerXML struct {
	Services []tomcatServiceXML `xml:"Service"`
}

type tomcatServiceXML struct {
	Connectors []tomcatConnectorXML `xml:"Connector"`
	Engine     tomcatEngineXML      `xml:"Engine"`
}

type tomcatEngineXML struct {
	Hosts []tomcatHostXML `xml:"Host"`
}

type tomcatHostXML struct {
	Name     string             `xml:"name,attr"`
	AppBase  string             `xml:"appBase,attr"`
	Contexts []tomcatContextXML `xml:"Context"`
}

type tomcatContextXML struct {
	Path    string `xml:"path,attr"`
	DocBase string `xml:"docBase,attr"`
}

type tomcatConnectorXML struct {
	Port            int    `xml:"port,attr"`
	Address         string `xml:"address,attr"`
	Protocol        string `xml:"protocol,attr"`
	SSLEnabled      string `xml:"SSLEnabled,attr"`
	Scheme          string `xml:"scheme,attr"`
	Secure          string `xml:"secure,attr"`
	CertificateFile string `xml:"certificateFile,attr"`
	CertificateKey  string `xml:"certificateKeyFile,attr"`
	KeystoreFile    string `xml:"keystoreFile,attr"`
	KeystorePass    string `xml:"keystorePass,attr"`
}

func parseTomcatServerXML(configPath string, catalinaBase string) ([]tomcatConnectorDetail, []tomcatAppDetail) {
	content, err := os.ReadFile(configPath)
	if err != nil {
		return nil, nil
	}
	var document tomcatServerXML
	if err := xml.Unmarshal(content, &document); err != nil {
		return nil, nil
	}
	connectors := make([]tomcatConnectorDetail, 0)
	apps := make([]tomcatAppDetail, 0)
	hostAppBases := make(map[string]string)
	baseDir := filepath.Dir(configPath)

	for _, service := range document.Services {
		for _, connector := range service.Connectors {
			if connector.Port <= 0 {
				continue
			}
			item := tomcatConnectorDetail{
				Address:            strings.TrimSpace(connector.Address),
				Port:               connector.Port,
				Protocol:           strings.TrimSpace(connector.Protocol),
				TLS:                strings.EqualFold(connector.SSLEnabled, "true") || strings.EqualFold(connector.Scheme, "https") || strings.EqualFold(connector.Secure, "true") || connector.Port == 443 || connector.Port == 8443,
				CertificatePath:    resolveApachePath(baseDir, catalinaBase, connector.CertificateFile),
				CertificateKeyPath: resolveApachePath(baseDir, catalinaBase, connector.CertificateKey),
				KeystorePath:       resolveApachePath(baseDir, catalinaBase, connector.KeystoreFile),
			}
			if item.TLS && item.CertificatePath != "" {
				item.Certificate = readCertificateDetail(item.CertificatePath)
				if item.Certificate != nil {
					item.CertificateName = item.Certificate.Subject
				}
			}
			if item.TLS && item.CertificateName == "" && item.KeystorePath != "" {
				item.Certificate = readPKCS12CertificateDetail(item.KeystorePath, strings.TrimSpace(connector.KeystorePass))
				if item.Certificate != nil {
					item.CertificateName = item.Certificate.Subject
				}
			}
			if item.Address == "" {
				item.Address = "*"
			}
			connectors = append(connectors, item)
		}
		for _, host := range service.Engine.Hosts {
			appBase := resolveTomcatAppBase(baseDir, catalinaBase, host.AppBase)
			hostName := strings.TrimSpace(host.Name)
			if hostName != "" {
				hostAppBases[hostName] = appBase
			}
			for _, context := range host.Contexts {
				apps = append(apps, tomcatAppDetail{
					ContextPath: strings.TrimSpace(context.Path),
					DocBase:     resolveTomcatDocBase(baseDir, catalinaBase, appBase, context.DocBase),
					AppBase:     appBase,
				})
			}
			apps = append(apps, scanTomcatAppBase(appBase)...)
		}
	}

	apps = append(apps, parseTomcatExternalContexts(catalinaBase, hostAppBases)...)

	return connectors, apps
}

func resolveTomcatAppBase(baseDir string, catalinaBase string, appBase string) string {
	appBase = strings.TrimSpace(appBase)
	if appBase == "" {
		if catalinaBase != "" {
			return filepath.Join(catalinaBase, "webapps")
		}
		return ""
	}
	if filepath.IsAbs(appBase) {
		return filepath.Clean(appBase)
	}
	if catalinaBase != "" {
		return filepath.Clean(filepath.Join(catalinaBase, appBase))
	}
	return resolveApachePath(baseDir, catalinaBase, appBase)
}

func scanTomcatAppBase(appBase string) []tomcatAppDetail {
	appBase = strings.TrimSpace(appBase)
	if appBase == "" {
		return nil
	}
	entries, err := os.ReadDir(appBase)
	if err != nil {
		return nil
	}
	apps := make([]tomcatAppDetail, 0)
	directories := make(map[string]struct{})
	for _, entry := range entries {
		name := strings.TrimSpace(entry.Name())
		if name == "" || strings.HasPrefix(name, ".") {
			continue
		}
		if entry.IsDir() {
			directories[name] = struct{}{}
			apps = append(apps, tomcatAppDetail{
				ContextPath: deriveTomcatContextPathFromName(name),
				DocBase:     filepath.Join(appBase, name),
				AppBase:     appBase,
			})
		}
	}
	for _, entry := range entries {
		name := strings.TrimSpace(entry.Name())
		if name == "" || entry.IsDir() || !strings.HasSuffix(strings.ToLower(name), ".war") {
			continue
		}
		baseName := strings.TrimSuffix(name, filepath.Ext(name))
		if _, exists := directories[baseName]; exists {
			continue
		}
		apps = append(apps, tomcatAppDetail{
			ContextPath: deriveTomcatContextPathFromName(baseName),
			DocBase:     filepath.Join(appBase, name),
			AppBase:     appBase,
		})
	}
	return apps
}

func scanTomcatKnownAppBases(catalinaBase string, catalinaHome string) []tomcatAppDetail {
	candidates := make([]string, 0, 4)
	if catalinaBase != "" {
		candidates = append(candidates, filepath.Join(catalinaBase, "webapps"))
	}
	if catalinaHome != "" {
		candidates = append(candidates, filepath.Join(catalinaHome, "webapps"))
	}
	results := make([]tomcatAppDetail, 0)
	for _, candidate := range uniqueStrings(candidates) {
		results = append(results, scanTomcatAppBase(candidate)...)
	}
	return results
}

func deriveTomcatContextPathFromName(name string) string {
	name = strings.TrimSpace(name)
	if strings.EqualFold(name, "ROOT") {
		return "/"
	}
	name = strings.ReplaceAll(name, "#", "/")
	if name == "" {
		return "/"
	}
	if strings.HasPrefix(name, "/") {
		return name
	}
	return "/" + name
}

type tomcatContextFileXML struct {
	XMLName xml.Name `xml:"Context"`
	Path    string   `xml:"path,attr"`
	DocBase string   `xml:"docBase,attr"`
}

func parseTomcatExternalContexts(catalinaBase string, hostAppBases map[string]string) []tomcatAppDetail {
	if strings.TrimSpace(catalinaBase) == "" {
		return nil
	}
	catalinaDir := filepath.Join(catalinaBase, "conf", "Catalina")
	hostDirs, err := os.ReadDir(catalinaDir)
	if err != nil {
		return nil
	}
	apps := make([]tomcatAppDetail, 0)
	for _, hostDir := range hostDirs {
		if !hostDir.IsDir() {
			continue
		}
		hostName := strings.TrimSpace(hostDir.Name())
		if hostName == "" {
			continue
		}
		files, err := filepath.Glob(filepath.Join(catalinaDir, hostName, "*.xml"))
		if err != nil {
			continue
		}
		appBase := hostAppBases[hostName]
		if appBase == "" {
			appBase = filepath.Join(catalinaBase, "webapps")
		}
		for _, filePath := range files {
			if app := parseTomcatContextFile(filePath, catalinaBase, appBase); app != nil {
				apps = append(apps, *app)
			}
		}
	}
	return apps
}

func parseTomcatContextFile(filePath string, catalinaBase string, appBase string) *tomcatAppDetail {
	content, err := os.ReadFile(filePath)
	if err != nil {
		return nil
	}
	var document tomcatContextFileXML
	if err := xml.Unmarshal(content, &document); err != nil {
		return nil
	}
	contextPath := strings.TrimSpace(document.Path)
	if contextPath == "" {
		contextPath = deriveTomcatContextPathFromFile(filePath)
	}
	return &tomcatAppDetail{
		ContextPath: normalizeTomcatContextPath(contextPath),
		DocBase:     resolveTomcatDocBase(filepath.Dir(filePath), catalinaBase, appBase, document.DocBase),
		AppBase:     appBase,
	}
}

func deriveTomcatContextPathFromFile(filePath string) string {
	name := strings.TrimSuffix(filepath.Base(filePath), filepath.Ext(filePath))
	return deriveTomcatContextPathFromName(name)
}

func normalizeTomcatContextPath(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "/"
	}
	if !strings.HasPrefix(value, "/") {
		value = "/" + value
	}
	return value
}

func resolveTomcatDocBase(baseDir string, catalinaBase string, appBase string, docBase string) string {
	docBase = strings.TrimSpace(docBase)
	if docBase == "" {
		return ""
	}
	if filepath.IsAbs(docBase) {
		return filepath.Clean(docBase)
	}
	if appBase != "" {
		return filepath.Clean(filepath.Join(appBase, docBase))
	}
	return resolveApachePath(baseDir, catalinaBase, docBase)
}

func uniqueTomcatApps(items []tomcatAppDetail) []tomcatAppDetail {
	seen := make(map[string]struct{}, len(items))
	result := make([]tomcatAppDetail, 0, len(items))
	for _, item := range items {
		item.ContextPath = normalizeTomcatContextPath(item.ContextPath)
		item.DocBase = strings.TrimSpace(item.DocBase)
		item.AppBase = strings.TrimSpace(item.AppBase)
		key := item.ContextPath + "\n" + item.DocBase + "\n" + item.AppBase
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, item)
	}
	return result
}

func doJSONRequest(ctx context.Context, client *http.Client, config *AgentConfig, method string, endpointPath string, payload any, target any) error {
	transport := controlplane.New(client, controlplane.Config{
		BaseURL:    config.ControlPlane,
		TenantID:   config.TenantID,
		AgentToken: config.EnrollmentToken,
	})
	return transport.DoJSON(ctx, method, endpointPath, payload, target)
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

func isValidControlPlaneURL(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return false
	}
	if strings.Contains(trimmed, "gcac.example.invalid") || strings.Contains(trimmed, "CHANGE_ME") {
		return false
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return false
	}
	return strings.TrimSpace(parsed.Scheme) != "" && strings.TrimSpace(parsed.Hostname()) != ""
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func fileReadable(path string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	_ = file.Close()
	return true
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
		"用法:",
		"  gcac-linux-agent inspect",
		"  gcac-linux-agent exec [--timeout=30s] [--include-env] -- <cmd> [args...]",
		"  gcac-linux-agent exec --shell -- \"uname -a && id\"",
		"  gcac-linux-agent self-check [--config=/etc/gcac/linux-agent/agent.config.json]",
		"  gcac-linux-agent health [--config=/etc/gcac/linux-agent/agent.config.json]",
		"  gcac-linux-agent status [--config=/etc/gcac/linux-agent/agent.config.json]",
		"  gcac-linux-agent service-info [--config=...] [--metadata=...]",
		"  gcac-linux-agent run [--config=/etc/gcac/linux-agent/agent.config.json]",
		"  gcac-linux-agent version",
	}
	fmt.Println(strings.Join(lines, "\n"))
}
