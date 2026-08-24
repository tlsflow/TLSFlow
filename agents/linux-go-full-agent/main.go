package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"time"

	"gcac/linux-go-full-agent/internal/buildinfo"
	"gcac/linux-go-full-agent/internal/core/controlplane"
	coreRegistry "gcac/linux-go-full-agent/internal/core/registry"
	linuxFacts "gcac/linux-go-full-agent/internal/platform/linux/facts"
)

const (
	defaultTaskPoll       = 60
	defaultHealthPoll     = 30
	defaultOfflineTTL     = 180
	defaultManagementPort = 18931
)

var agentVersion = buildinfo.Version

type AgentConfig struct {
	SchemaVersion              string            `json:"schemaVersion"`
	TenantID                   string            `json:"tenantId"`
	AgentKey                   string            `json:"agentKey"`
	EnrollmentToken            string            `json:"enrollmentToken"`
	Zone                       string            `json:"zone"`
	ControlPlane               string            `json:"controlPlaneUrl"`
	Heartbeat                  int               `json:"heartbeatIntervalSeconds"`
	TaskPollIntervalSeconds    int               `json:"taskPollIntervalSeconds"`
	HealthCheckIntervalSeconds int               `json:"healthCheckIntervalSeconds"`
	OfflineTimeoutSeconds      int               `json:"offlineTimeoutSeconds"`
	ManagementListenAddress    string            `json:"managementListenAddress"`
	ManagementPort             int               `json:"managementPort"`
	CapabilityRescanInterval   int               `json:"capabilityRescanIntervalSeconds"`
	CapabilityRescanEnabled    *bool             `json:"capabilityRescanEnabled"`
	AuthorizationMaterialPath  string            `json:"authorizationMaterialPath"`
	AuthorizationTrustKeySet   map[string]string `json:"authorizationTrustKeySet"`
	UpgradeTrustKeySet         map[string]string `json:"upgradeTrustKeySet"`
	ReleaseTrustKeySet         map[string]string `json:"releaseTrustKeySet"`
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
	PrimaryIPAddress  string
	LinuxDistribution string
	OSVersion         string
	NetworkInterfaces []NetworkInterfaceInfo
	OSRelease         map[string]string
}

type InstallMetadata struct {
	ServiceName   string `json:"serviceName"`
	InstallRoot   string `json:"installRoot"`
	ConfigPath    string `json:"configPath"`
	DataDir       string `json:"dataDir"`
	LogDir        string `json:"logDir"`
	BinaryPath    string `json:"binaryPath"`
	BinaryVersion string `json:"binaryVersion"`
	InstalledAt   string `json:"installedAt"`
	Mode          string `json:"mode"`
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
		return errors.New("自由进程入口已移除，请使用 agent.plan.execute 的受控原语")
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
		checkItem("management.listen", managementListenAddressAvailable(config), map[string]any{"address": effectiveManagementListenAddress(config), "port": effectiveManagementPort(config)}),
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
	identity := collectRuntimeIdentity(config.ControlPlane)

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
	identity := collectRuntimeIdentity("")

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
		checkItem("management.listen", managementListenAddressAvailable(config), map[string]any{"address": effectiveManagementListenAddress(config), "port": effectiveManagementPort(config)}),
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
	return checks
}

func executeLinuxTaskPayload(taskID string, payload map[string]any) (bool, string, string, map[string]any) {
	wirePayload, action, schemaVersion, err := decodeQueuedAgentV2Payload(payload)
	if err != nil {
		return false, "ACTION_HANDLER_NOT_REGISTERED", err.Error(), map[string]any{"taskId": taskID}
	}
	result := newLinuxActionRegistry(nil).Execute(context.Background(), coreRegistry.Request{
		TaskID:        taskID,
		ActionType:    action,
		SchemaVersion: schemaVersion,
		Payload:       wirePayload,
	})
	return result.Success, result.ErrorCode, result.ErrorMessage, result.Detail
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
	agentID := ""
	if runtime != nil {
		agentID = runtime.state.AgentID
	}
	mustRegisterAction(registry, coreRegistry.HandlerFunc{
		ActionType:    agentPlanExecute,
		SchemaVersion: "1.0",
		Execute: func(ctx context.Context, request coreRegistry.Request) coreRegistry.Result {
			payload := cloneMap(request.Payload)
			payload["action"] = agentPlanExecute
			payload["agentId"] = agentID
			success, code, message, detail := executeAgentV2(ctx, payload, agentID)
			return coreRegistry.Result{Success: success, ErrorCode: code, ErrorMessage: message, Detail: detail}
		},
	})
	_ = runtime
	for _, action := range []string{agentFactCollect, agentPlanValidate, agentExecutionReceipt} {
		mustRegisterAction(registry, coreRegistry.HandlerFunc{
			ActionType:    action,
			SchemaVersion: "1.0",
			Execute: func(ctx context.Context, request coreRegistry.Request) coreRegistry.Result {
				payload := cloneMap(request.Payload)
				payload["action"] = action
				success, code, message, detail := executeAgentV2(ctx, payload, agentID)
				return coreRegistry.Result{Success: success, ErrorCode: code, ErrorMessage: message, Detail: detail}
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
	return map[string]any{
		"effectiveUid":  os.Geteuid(),
		"root":          isRoot,
		"sudoInstalled": lookPath("sudo"),
		"suInstalled":   lookPath("su"),
		"doasInstalled": lookPath("doas"),
	}, nil
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

func stringFromMap(input map[string]any, key string) string {
	if input == nil {
		return ""
	}
	return stringFromAny(input[key])
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
	return collectRuntimeIdentity("").PrimaryIPAddress
}

func detectLinuxDistribution() string {
	return collectRuntimeIdentity("").LinuxDistribution
}

func detectLinuxVersion() string {
	return collectRuntimeIdentity("").OSVersion
}

func collectRuntimeIdentity(controlPlaneURL string) runtimeIdentity {
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
		PrimaryIPAddress:  primaryIP,
		LinuxDistribution: detectLinuxDistributionFromRelease(release),
		OSVersion:         detectLinuxVersionFromRelease(release),
		NetworkInterfaces: interfaces,
		OSRelease:         release,
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
	if !allowedFactCommand(name, args...) {
		return "", fmt.Errorf("事实采集程序或参数不在固定白名单中: %s", name)
	}
	program, err := resolveFactProgram(name)
	if err != nil {
		return "", err
	}
	cmd := exec.Command(program, args...)
	cmd.Env = []string{"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}
	output, err := cmd.Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}

func allowedFactCommand(name string, args ...string) bool {
	cleanName, ok := factProgramName(name)
	if !ok {
		return false
	}
	switch cleanName {
	case "uname":
		return len(args) == 1 && containsString([]string{"-s", "-r", "-m", "-a"}, args[0])
	case "getconf":
		return len(args) == 1 && args[0] == "GNU_LIBC_VERSION"
	case "ldd":
		return len(args) == 1 && args[0] == "--version"
	case "getenforce":
		return len(args) == 0
	case "aa-status":
		return len(args) == 1 && args[0] == "--enabled"
	default:
		return false
	}
}

var factProgramPaths = map[string][]string{
	"uname":      {"/usr/bin/uname", "/bin/uname"},
	"getconf":    {"/usr/bin/getconf", "/bin/getconf"},
	"ldd":        {"/usr/bin/ldd", "/bin/ldd"},
	"getenforce": {"/usr/sbin/getenforce", "/sbin/getenforce", "/usr/bin/getenforce"},
	"aa-status":  {"/usr/sbin/aa-status", "/usr/bin/aa-status", "/sbin/aa-status"},
	"systemctl":  {"/usr/bin/systemctl", "/bin/systemctl"},
	"service":    {"/usr/sbin/service", "/sbin/service", "/usr/bin/service", "/bin/service"},
	"rc-service": {"/sbin/rc-service", "/usr/sbin/rc-service", "/usr/bin/rc-service"},
	"sudo":       {"/usr/bin/sudo", "/bin/sudo"},
	"su":         {"/usr/bin/su", "/bin/su"},
	"doas":       {"/usr/bin/doas", "/bin/doas"},
}

func factProgramName(value string) (string, bool) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" || strings.ContainsAny(trimmed, "\x00\r\n") {
		return "", false
	}
	if _, ok := factProgramPaths[trimmed]; ok {
		return trimmed, true
	}
	cleaned := path.Clean(trimmed)
	for name, paths := range factProgramPaths {
		for _, path := range paths {
			if cleaned == path {
				return name, true
			}
		}
	}
	return "", false
}

func resolveFactProgram(value string) (string, error) {
	name, ok := factProgramName(value)
	if !ok {
		return "", errors.New("事实采集程序不在固定绝对路径白名单中")
	}
	cleaned := path.Clean(strings.TrimSpace(value))
	if strings.HasPrefix(cleaned, "/") {
		info, err := os.Stat(cleaned)
		if err != nil || !info.Mode().IsRegular() {
			return "", errors.New("固定事实采集程序不可用")
		}
		return cleaned, nil
	}
	for _, path := range factProgramPaths[name] {
		info, err := os.Stat(path)
		if err == nil && info.Mode().IsRegular() {
			return path, nil
		}
	}
	return "", errors.New("固定事实采集程序不可用")
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
	_, err := resolveFactProgram(name)
	return err == nil
}

func findPath(name string) string {
	path, err := resolveFactProgram(name)
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
		"  agent.plan.execute 通过受控 JSON 合同执行固定通用原语",
		"  gcac-linux-agent self-check [--config=/etc/gcac/linux-agent/agent.config.json]",
		"  gcac-linux-agent health [--config=/etc/gcac/linux-agent/agent.config.json]",
		"  gcac-linux-agent status [--config=/etc/gcac/linux-agent/agent.config.json]",
		"  gcac-linux-agent service-info [--config=...] [--metadata=...]",
		"  gcac-linux-agent run [--config=/etc/gcac/linux-agent/agent.config.json]",
		"  gcac-linux-agent version",
	}
	fmt.Println(strings.Join(lines, "\n"))
}
