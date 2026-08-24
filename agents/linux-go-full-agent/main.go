package main

import (
	"bytes"
	"context"
	"crypto"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
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
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"unicode"
)

const (
	agentVersion      = "0.1.0"
	defaultTaskPoll   = 60
	defaultHealthPoll = 30
	defaultOfflineTTL = 180
)

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
	InstalledAt string `json:"installedAt"`
	Mode        string `json:"mode"`
}

type registerRequest struct {
	AgentKey          string   `json:"agentKey"`
	MachineID         string   `json:"machineId,omitempty"`
	Hostname          string   `json:"hostname"`
	Version           string   `json:"version"`
	OSType            string   `json:"osType"`
	Arch              string   `json:"arch,omitempty"`
	IPAddress         string   `json:"ipAddress,omitempty"`
	LinuxDistribution string   `json:"linuxDistribution,omitempty"`
	OSVersion         string   `json:"osVersion,omitempty"`
	Labels            []string `json:"labels,omitempty"`
	EnrollmentToken   string   `json:"enrollmentToken,omitempty"`
	Role              string   `json:"role,omitempty"`
	Zone              string   `json:"zone,omitempty"`
	ZoneIDs           []string `json:"zoneIds,omitempty"`
	Adapters          []string `json:"adapters,omitempty"`
	Capabilities      []string `json:"capabilities,omitempty"`
}

type registerResponse struct {
	ID string `json:"id"`
}

type heartbeatRequest struct {
	AgentID       string                  `json:"agentId"`
	Version       string                  `json:"version"`
	Adapters      []string                `json:"adapters,omitempty"`
	Capabilities  []string                `json:"capabilities,omitempty"`
	RuntimeHealth *heartbeatRuntimeHealth `json:"runtimeHealth,omitempty"`
	DirectControl *directControlState     `json:"directControl,omitempty"`
	TaskSummary   struct {
		Running   int `json:"running"`
		Queued    int `json:"queued"`
		Succeeded int `json:"succeeded,omitempty"`
		Failed    int `json:"failed,omitempty"`
	} `json:"taskSummary"`
}

type heartbeatRuntimeHealth struct {
	ModelVersion         string               `json:"modelVersion"`
	Status               string               `json:"status"`
	PendingResultCount   int                  `json:"pendingResultCount"`
	RecoverableTaskCount int                  `json:"recoverableTaskCount,omitempty"`
	LastRecoveryAt       string               `json:"lastRecoveryAt,omitempty"`
	LastTaskPollAt       string               `json:"lastTaskPollAt,omitempty"`
	LastTaskResultAt     string               `json:"lastTaskResultAt,omitempty"`
	LastSelfCheckAt      string               `json:"lastSelfCheckAt,omitempty"`
	LastError            string               `json:"lastError,omitempty"`
	DegradedReasons      []string             `json:"degradedReasons,omitempty"`
	FailureCounts        runtimeFailureCounts `json:"failureCounts"`
	DirectControl        *directControlState  `json:"directControl,omitempty"`
}

type runtimeFailureCounts struct {
	Heartbeat int `json:"heartbeat,omitempty"`
	TaskPoll  int `json:"taskPoll,omitempty"`
	Recovery  int `json:"recovery,omitempty"`
}

type directControlState struct {
	Enabled          bool     `json:"enabled"`
	Reachable        bool     `json:"reachable"`
	ListenAddress    string   `json:"listenAddress,omitempty"`
	ProtocolVersion  string   `json:"protocolVersion,omitempty"`
	SupportedActions []string `json:"supportedActions"`
	LastReadyAt      string   `json:"lastReadyAt,omitempty"`
	LastDirectError  string   `json:"lastDirectError,omitempty"`
}

type apiErrorResponse struct {
	Message   string `json:"message"`
	ErrorCode string `json:"errorCode"`
}

type runtimeState struct {
	AgentID  string
	Hostname string
	Version  string
}

type agentTaskEnvelope struct {
	ID              string         `json:"id"`
	AgentID         string         `json:"agentId"`
	ExecutionRunID  string         `json:"executionRunId"`
	ExecutionStepID string         `json:"executionStepId"`
	IdempotencyKey  string         `json:"idempotencyKey"`
	Payload         map[string]any `json:"payload"`
	Status          string         `json:"status"`
}

type ackTaskRequest struct {
	AgentID string `json:"agentId"`
	TaskID  string `json:"taskId"`
	LeaseID string `json:"leaseId"`
}

type submitResultRequest struct {
	AgentID      string         `json:"agentId"`
	TaskID       string         `json:"taskId"`
	LeaseID      string         `json:"leaseId"`
	Success      bool           `json:"success"`
	ErrorCode    string         `json:"errorCode,omitempty"`
	ErrorMessage string         `json:"errorMessage,omitempty"`
	Detail       map[string]any `json:"detail,omitempty"`
}

type enqueueAgentTaskRequest struct {
	AgentID         string         `json:"agentId"`
	ExecutionRunID  string         `json:"executionRunId"`
	ExecutionStepID string         `json:"executionStepId"`
	IdempotencyKey  string         `json:"idempotencyKey"`
	Payload         map[string]any `json:"payload,omitempty"`
}

type submitRuntimeLogRequest struct {
	AgentID   string         `json:"agentId"`
	Category  string         `json:"category"`
	Level     string         `json:"level,omitempty"`
	Summary   string         `json:"summary"`
	Detail    map[string]any `json:"detail,omitempty"`
	EmittedAt string         `json:"emittedAt,omitempty"`
}

type runtimeCounters struct {
	Running   int `json:"running"`
	Queued    int `json:"queued"`
	Succeeded int `json:"succeeded"`
	Failed    int `json:"failed"`
}

type rescanState struct {
	Running bool
}

type persistedRuntimeState struct {
	StableAgentKey        string `json:"stableAgentKey,omitempty"`
	EnrollmentCompleted   bool   `json:"enrollmentCompleted,omitempty"`
	LastRegisteredAgentID string `json:"lastRegisteredAgentId,omitempty"`
}

type runtimeStatusSnapshot struct {
	SchemaVersion                string              `json:"schemaVersion"`
	UpdatedAt                    string              `json:"updatedAt"`
	State                        string              `json:"state"`
	StartedAt                    string              `json:"startedAt,omitempty"`
	StoppedAt                    string              `json:"stoppedAt,omitempty"`
	AgentID                      string              `json:"agentId,omitempty"`
	ServiceName                  string              `json:"serviceName,omitempty"`
	LastHeartbeatAt              string              `json:"lastHeartbeatAt,omitempty"`
	LastTaskPollAt               string              `json:"lastTaskPollAt,omitempty"`
	LastTaskResultAt             string              `json:"lastTaskResultAt,omitempty"`
	LastRecoveryAt               string              `json:"lastRecoveryAt,omitempty"`
	LastSelfCheckAt              string              `json:"lastSelfCheckAt,omitempty"`
	LastError                    string              `json:"lastError,omitempty"`
	ConsecutiveHeartbeatFailures int                 `json:"consecutiveHeartbeatFailures"`
	ConsecutiveTaskPollFailures  int                 `json:"consecutiveTaskPollFailures"`
	ConsecutiveRecoveryFailures  int                 `json:"consecutiveRecoveryFailures"`
	PendingResultCount           int                 `json:"pendingResultCount"`
	RecoverableTaskCount         int                 `json:"recoverableTaskCount"`
	TaskCounters                 runtimeCounters     `json:"taskCounters"`
	DirectControl                *directControlState `json:"directControl,omitempty"`
}

type directControlServer struct {
	state   *directControlState
	server  *http.Server
	started bool
}

type directDiscoveryRequest struct {
	ProviderTypes   []string `json:"providerTypes"`
	Scope           string   `json:"scope,omitempty"`
	IncludeBindings bool     `json:"includeBindings"`
	RequestID       string   `json:"requestId,omitempty"`
}

type directActionExecuteRequest struct {
	ActionType string         `json:"actionType"`
	Inputs     map[string]any `json:"inputs"`
	RequestID  string         `json:"requestId,omitempty"`
}

type directActionStartRequest struct {
	ActionType string         `json:"actionType"`
	Inputs     map[string]any `json:"inputs"`
	RequestID  string         `json:"requestId,omitempty"`
}

type directActionStatusSnapshot struct {
	ActionID     string         `json:"actionId"`
	ActionType   string         `json:"actionType"`
	RequestID    string         `json:"requestId,omitempty"`
	Status       string         `json:"status"`
	StartedAt    string         `json:"startedAt"`
	FinishedAt   string         `json:"finishedAt,omitempty"`
	Success      bool           `json:"success"`
	ErrorCode    string         `json:"errorCode,omitempty"`
	ErrorMessage string         `json:"errorMessage,omitempty"`
	Detail       map[string]any `json:"detail,omitempty"`
}

type directActionStatusStore struct {
	mu      sync.Mutex
	actions map[string]directActionStatusSnapshot
}

var globalDirectActionStatusStore = &directActionStatusStore{
	actions: map[string]directActionStatusSnapshot{},
}

type pendingTaskResult struct {
	TaskID       string         `json:"taskId"`
	LeaseID      string         `json:"leaseId"`
	Success      bool           `json:"success"`
	ErrorCode    string         `json:"errorCode,omitempty"`
	ErrorMessage string         `json:"errorMessage,omitempty"`
	Detail       map[string]any `json:"detail,omitempty"`
	Reported     bool           `json:"reported"`
	StagedAt     string         `json:"stagedAt"`
	ReportedAt   string         `json:"reportedAt,omitempty"`
}

type resultLedger struct {
	path  string
	mu    sync.Mutex
	Items map[string]pendingTaskResult `json:"items"`
}

type capabilityReportRequest struct {
	AgentID            string               `json:"agentId"`
	CompatibilityLevel string               `json:"compatibilityLevel,omitempty"`
	Capabilities       []reportedCapability `json:"capabilities"`
	Adapters           []string             `json:"adapters,omitempty"`
}

type reportedCapability struct {
	CapabilityKey string         `json:"capabilityKey"`
	Value         any            `json:"value"`
	Confidence    float64        `json:"confidence"`
	Evidence      map[string]any `json:"evidence,omitempty"`
}

type nginxDetail struct {
	Installed  bool              `json:"installed"`
	Running    bool              `json:"running"`
	Version    string            `json:"version,omitempty"`
	BinaryPath string            `json:"binaryPath,omitempty"`
	ConfigPath string            `json:"configPath,omitempty"`
	Prefix     string            `json:"prefix,omitempty"`
	Service    string            `json:"serviceName,omitempty"`
	Sites      []nginxSiteDetail `json:"sites,omitempty"`
}

type nginxSiteDetail struct {
	Name         string               `json:"name"`
	SiteMode     string               `json:"siteMode,omitempty"`
	ServerNames  []string             `json:"serverNames,omitempty"`
	SitePath     string               `json:"sitePath,omitempty"`
	ProxyTargets []string             `json:"proxyTargets,omitempty"`
	Listen       []nginxBindingDetail `json:"listen,omitempty"`
	ConfigFiles  []string             `json:"configFiles,omitempty"`

	serverCertificatePath    string
	serverCertificateKeyPath string
}

type nginxBindingDetail struct {
	Address            string                  `json:"address,omitempty"`
	Port               int                     `json:"port"`
	Protocol           string                  `json:"protocol,omitempty"`
	CertificateName    string                  `json:"certificateName,omitempty"`
	CertificatePath    string                  `json:"certificatePath,omitempty"`
	CertificateKeyPath string                  `json:"certificateKeyPath,omitempty"`
	Permission         map[string]any          `json:"permission,omitempty"`
	TestCommand        string                  `json:"testCommand,omitempty"`
	ReloadCommand      string                  `json:"reloadCommand,omitempty"`
	Certificate        *linuxCertificateDetail `json:"certificate,omitempty"`
}

type nginxContextFrame struct {
	kind      string
	siteIndex int
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
		return writeJSON(map[string]string{
			"name":    "gcac-linux-agent",
			"version": agentVersion,
			"runtime": "go",
		})
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

func handleRuntimeStatusCommand(args []string, includeChecks bool) error {
	configPath := parseConfigPath(args)
	config, err := loadConfig(configPath)
	if err != nil {
		return err
	}

	status := loadRuntimeStatusSnapshot(resolveAgentRuntimeStatusPath(config))
	ledger := loadResultLedger(resolveResultLedgerPath(config))
	checks := buildLinuxHealthChecks(config, configPath)
	status.PendingResultCount = ledger.pendingCount()
	return writeJSON(buildRuntimeStatusReport(config, status, checks, includeChecks))
}

func handleRun(args []string) error {
	configPath := parseConfigPath(args)
	config, err := loadConfig(configPath)
	if err != nil {
		return err
	}
	identity := collectRuntimeIdentity(config.AgentKey, config.ControlPlane)
	runtimeStatePath := resolveRuntimeStatePath(config)
	persisted := loadPersistedRuntimeState(runtimeStatePath)
	if identity.StableAgentKey != "" {
		config.AgentKey = identity.StableAgentKey
	}
	if persisted.EnrollmentCompleted {
		config.EnrollmentToken = ""
	}
	if strings.TrimSpace(config.ControlPlane) == "" {
		return errors.New("controlPlaneUrl ?????Linux Agent ??????")
	}
	if strings.TrimSpace(config.AgentKey) == "" {
		return errors.New("agentKey ?????Linux Agent ??????")
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	heartbeatSeconds := effectiveHeartbeatSeconds(config)
	taskPollSeconds := effectiveTaskPollSeconds(config)
	healthCheckSeconds := effectiveHealthCheckSeconds(config)
	rescanSeconds := config.CapabilityRescanInterval
	rescanEnabled := rescanSeconds > 0
	if config.CapabilityRescanEnabled != nil {
		rescanEnabled = *config.CapabilityRescanEnabled
	}

	client := &http.Client{Timeout: 15 * time.Second}
	state, err := registerAgent(ctx, client, config, identity)
	if err != nil {
		return err
	}
	savePersistedRuntimeState(runtimeStatePath, persistedRuntimeState{
		StableAgentKey:        config.AgentKey,
		EnrollmentCompleted:   true,
		LastRegisteredAgentID: state.AgentID,
	})

	counters := &runtimeCounters{}
	rescan := &rescanState{}
	ledger := loadResultLedger(resolveResultLedgerPath(config))
	statusPath := resolveAgentRuntimeStatusPath(config)
	status := loadRuntimeStatusSnapshot(statusPath)
	status.SchemaVersion = "gcac.agent.runtime.status.v1"
	status.State = "starting"
	status.StartedAt = time.Now().Format(time.RFC3339)
	status.StoppedAt = ""
	status.ServiceName = config.Service.Name
	status.AgentID = state.AgentID
	status.DirectControl = newDirectControlState(config)

	directServer, directErr := startDirectControlServer(config, client, state, counters, rescan, &status)
	if directErr != nil {
		status.DirectControl = newDirectControlState(config)
		status.DirectControl.LastDirectError = directErr.Error()
		fmt.Fprintf(os.Stderr, "[direct-control] listener failed: %v\n", directErr)
	} else if directServer != nil {
		defer directServer.shutdown(context.Background())
		status.DirectControl = directServer.snapshot()
	}
	refreshRuntimeStatus(&status, counters, ledger)
	saveRuntimeStatusSnapshot(statusPath, status)

	fmt.Fprintf(os.Stderr, "GCAC Linux Agent running service=%s config=%s agentId=%s\n", config.Service.Name, configPath, state.AgentID)
	if err := postHeartbeat(ctx, client, config, state, counters, &status); err != nil {
		status.LastError = err.Error()
		status.ConsecutiveHeartbeatFailures++
		fmt.Fprintf(os.Stderr, "[heartbeat] first report failed: %v\n", err)
		_ = submitRuntimeLog(ctx, client, config, submitRuntimeLogRequest{
			AgentID:   state.AgentID,
			Category:  "heartbeat",
			Level:     "error",
			Summary:   "first heartbeat failed",
			Detail:    map[string]any{"error": err.Error(), "phase": "startup"},
			EmittedAt: time.Now().Format(time.RFC3339),
		})
	} else {
		status.LastHeartbeatAt = time.Now().Format(time.RFC3339)
		status.ConsecutiveHeartbeatFailures = 0
		fmt.Fprintf(os.Stderr, "[heartbeat] first report ok agent=%s agentId=%s\n", config.AgentKey, state.AgentID)
	}

	if err := reportCapabilities(ctx, client, config, state); err != nil {
		fmt.Fprintf(os.Stderr, "[capabilities] first report failed: %v\n", err)
		_ = submitRuntimeLog(ctx, client, config, submitRuntimeLogRequest{
			AgentID:   state.AgentID,
			Category:  "capability_report",
			Level:     "error",
			Summary:   "initial capability report failed",
			Detail:    map[string]any{"error": err.Error(), "phase": "startup"},
			EmittedAt: time.Now().Format(time.RFC3339),
		})
	} else {
		fmt.Fprintf(os.Stderr, "[capabilities] first report ok agent=%s agentId=%s\n", config.AgentKey, state.AgentID)
	}

	if err := recoverPendingResults(ctx, client, config, state, counters, ledger); err != nil {
		status.LastError = err.Error()
		status.ConsecutiveRecoveryFailures++
		fmt.Fprintf(os.Stderr, "[result-replay] %v\n", err)
	} else {
		status.LastRecoveryAt = time.Now().Format(time.RFC3339)
		status.ConsecutiveRecoveryFailures = 0
	}

	if err := pullAndProcessTasks(ctx, client, config, state, counters, rescan, ledger); err != nil {
		status.LastError = err.Error()
		status.ConsecutiveTaskPollFailures++
		fmt.Fprintf(os.Stderr, "[task-pull] first pull failed: %v\n", err)
	} else {
		status.LastTaskPollAt = time.Now().Format(time.RFC3339)
		status.LastTaskResultAt = status.LastTaskPollAt
		status.ConsecutiveTaskPollFailures = 0
	}
	refreshRuntimeStatus(&status, counters, ledger)
	status.State = "running"
	saveRuntimeStatusSnapshot(statusPath, status)

	heartbeatTicker := time.NewTicker(time.Duration(heartbeatSeconds) * time.Second)
	defer heartbeatTicker.Stop()
	taskTicker := time.NewTicker(time.Duration(taskPollSeconds) * time.Second)
	defer taskTicker.Stop()
	healthTicker := time.NewTicker(time.Duration(healthCheckSeconds) * time.Second)
	defer healthTicker.Stop()
	var rescanTicker *time.Ticker
	if rescanEnabled {
		rescanTicker = time.NewTicker(time.Duration(rescanSeconds) * time.Second)
		defer rescanTicker.Stop()
	}

	for {
		select {
		case <-ctx.Done():
			status.State = "stopped"
			status.StoppedAt = time.Now().Format(time.RFC3339)
			saveRuntimeStatusSnapshot(statusPath, status)
			_ = submitRuntimeLog(context.Background(), client, config, submitRuntimeLogRequest{
				AgentID:   state.AgentID,
				Category:  "heartbeat",
				Level:     "warn",
				Summary:   "agent runtime stopped",
				Detail:    map[string]any{"state": "stopped"},
				EmittedAt: time.Now().Format(time.RFC3339),
			})
			fmt.Fprintln(os.Stderr, "received stop signal, Linux Agent exiting")
			return nil
		case now := <-heartbeatTicker.C:
			if err := postHeartbeat(ctx, client, config, state, counters, &status); err != nil {
				status.LastError = err.Error()
				status.ConsecutiveHeartbeatFailures++
				fmt.Fprintf(os.Stderr, "[heartbeat] %s failed agent=%s error=%v\n", now.Format(time.RFC3339), config.AgentKey, err)
				_ = submitRuntimeLog(ctx, client, config, submitRuntimeLogRequest{
					AgentID:   state.AgentID,
					Category:  "heartbeat",
					Level:     "error",
					Summary:   "heartbeat failed",
					Detail:    map[string]any{"error": err.Error()},
					EmittedAt: time.Now().Format(time.RFC3339),
				})
			} else {
				status.LastHeartbeatAt = time.Now().Format(time.RFC3339)
				status.ConsecutiveHeartbeatFailures = 0
				fmt.Fprintf(os.Stderr, "[heartbeat] %s ok agent=%s agentId=%s\n", now.Format(time.RFC3339), config.AgentKey, state.AgentID)
			}
			refreshRuntimeStatus(&status, counters, ledger)
			saveRuntimeStatusSnapshot(statusPath, status)
		case <-taskTicker.C:
			if err := recoverPendingResults(ctx, client, config, state, counters, ledger); err != nil {
				status.LastError = err.Error()
				status.ConsecutiveRecoveryFailures++
				fmt.Fprintf(os.Stderr, "[result-replay] agent=%s error=%v\n", config.AgentKey, err)
			} else {
				status.LastRecoveryAt = time.Now().Format(time.RFC3339)
				status.ConsecutiveRecoveryFailures = 0
			}
			if err := pullAndProcessTasks(ctx, client, config, state, counters, rescan, ledger); err != nil {
				status.LastError = err.Error()
				status.ConsecutiveTaskPollFailures++
				fmt.Fprintf(os.Stderr, "[task-pull] agent=%s error=%v\n", config.AgentKey, err)
			} else {
				status.LastTaskPollAt = time.Now().Format(time.RFC3339)
				status.LastTaskResultAt = status.LastTaskPollAt
				status.ConsecutiveTaskPollFailures = 0
			}
			refreshRuntimeStatus(&status, counters, ledger)
			saveRuntimeStatusSnapshot(statusPath, status)
		case <-healthTicker.C:
			status.LastSelfCheckAt = time.Now().Format(time.RFC3339)
			refreshRuntimeStatus(&status, counters, ledger)
			saveRuntimeStatusSnapshot(statusPath, status)
		case <-rescanTickerChannel(rescanTicker):
			if _, err := runCapabilityRescan(ctx, client, config, state, counters, rescan, "scheduled", nil); err != nil {
				fmt.Fprintf(os.Stderr, "[rescan] scheduled failed agent=%s error=%v\n", config.AgentKey, err)
			}
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
	identity := collectRuntimeIdentity(config.AgentKey, config.ControlPlane)

	result := map[string]any{
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

func resolveRuntimeStatePath(config *AgentConfig) string {
	dataDir := strings.TrimSpace(config.Paths.Linux.DataDir)
	if dataDir == "" {
		return "/var/lib/gcac/linux-agent/runtime-state.json"
	}
	return filepath.Join(dataDir, "runtime-state.json")
}

func resolveAgentRuntimeStatusPath(config *AgentConfig) string {
	dataDir := strings.TrimSpace(config.Paths.Linux.DataDir)
	if dataDir == "" {
		return "/var/lib/gcac/linux-agent/runtime-status.json"
	}
	return filepath.Join(dataDir, "runtime-status.json")
}

func resolveResultLedgerPath(config *AgentConfig) string {
	dataDir := strings.TrimSpace(config.Paths.Linux.DataDir)
	if dataDir == "" {
		return "/var/lib/gcac/linux-agent/task-results.json"
	}
	return filepath.Join(dataDir, "task-results.json")
}

func loadPersistedRuntimeState(path string) persistedRuntimeState {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return persistedRuntimeState{}
	}
	var state persistedRuntimeState
	if err := json.Unmarshal(bytes, &state); err != nil {
		return persistedRuntimeState{}
	}
	return state
}

func savePersistedRuntimeState(path string, state persistedRuntimeState) {
	parent := filepath.Dir(path)
	if parent != "" {
		_ = os.MkdirAll(parent, 0o750)
	}
	encoded, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(path, append(encoded, '\n'), 0o640)
}

func loadRuntimeStatusSnapshot(path string) runtimeStatusSnapshot {
	content, err := os.ReadFile(path)
	if err != nil {
		return runtimeStatusSnapshot{
			SchemaVersion: "gcac.agent.runtime.status.v1",
			State:         "unknown",
		}
	}
	var snapshot runtimeStatusSnapshot
	if err := json.Unmarshal(content, &snapshot); err != nil {
		return runtimeStatusSnapshot{
			SchemaVersion: "gcac.agent.runtime.status.v1",
			State:         "unknown",
			LastError:     err.Error(),
		}
	}
	if strings.TrimSpace(snapshot.SchemaVersion) == "" {
		snapshot.SchemaVersion = "gcac.agent.runtime.status.v1"
	}
	if strings.TrimSpace(snapshot.State) == "" {
		snapshot.State = "unknown"
	}
	return snapshot
}

func saveRuntimeStatusSnapshot(path string, snapshot runtimeStatusSnapshot) {
	snapshot.UpdatedAt = time.Now().Format(time.RFC3339)
	parent := filepath.Dir(path)
	if parent != "" {
		_ = os.MkdirAll(parent, 0o750)
	}
	encoded, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(path, append(encoded, '\n'), 0o640)
}

func refreshRuntimeStatus(snapshot *runtimeStatusSnapshot, counters *runtimeCounters, ledger *resultLedger) {
	if snapshot == nil {
		return
	}
	if counters != nil {
		snapshot.TaskCounters = *counters
	}
	if ledger != nil {
		snapshot.PendingResultCount = ledger.pendingCount()
	}
	snapshot.RecoverableTaskCount = 0
}

func loadResultLedger(path string) *resultLedger {
	ledger := &resultLedger{
		path:  path,
		Items: map[string]pendingTaskResult{},
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return ledger
	}
	_ = json.Unmarshal(content, ledger)
	if ledger.Items == nil {
		ledger.Items = map[string]pendingTaskResult{}
	}
	return ledger
}

func (l *resultLedger) saveLocked() error {
	if l.Items == nil {
		l.Items = map[string]pendingTaskResult{}
	}
	parent := filepath.Dir(l.path)
	if parent != "" {
		if err := os.MkdirAll(parent, 0o750); err != nil {
			return err
		}
	}
	encoded, err := json.MarshalIndent(l, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(l.path, append(encoded, '\n'), 0o640)
}

func (l *resultLedger) stage(request submitResultRequest) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.Items == nil {
		l.Items = map[string]pendingTaskResult{}
	}
	l.Items[request.TaskID] = pendingTaskResult{
		TaskID:       request.TaskID,
		LeaseID:      request.LeaseID,
		Success:      request.Success,
		ErrorCode:    request.ErrorCode,
		ErrorMessage: request.ErrorMessage,
		Detail:       request.Detail,
		Reported:     false,
		StagedAt:     time.Now().Format(time.RFC3339),
	}
	return l.saveLocked()
}

func (l *resultLedger) markReported(taskID string) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	item, ok := l.Items[taskID]
	if !ok {
		return nil
	}
	item.Reported = true
	item.ReportedAt = time.Now().Format(time.RFC3339)
	delete(l.Items, taskID)
	return l.saveLocked()
}

func (l *resultLedger) pending() []pendingTaskResult {
	l.mu.Lock()
	defer l.mu.Unlock()
	result := make([]pendingTaskResult, 0, len(l.Items))
	for _, item := range l.Items {
		if !item.Reported {
			result = append(result, item)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].StagedAt < result[j].StagedAt
	})
	return result
}

func (l *resultLedger) pendingCount() int {
	return len(l.pending())
}

func buildLinuxHealthChecks(config *AgentConfig, configPath string) []map[string]any {
	checks := []map[string]any{
		checkItem("config.exists", fileExists(configPath), map[string]any{"configPath": configPath}),
		checkItem("service.name", config.Service.Name != "", map[string]any{"serviceName": config.Service.Name}),
		checkItem("controlPlane.url", strings.TrimSpace(config.ControlPlane) != "", map[string]any{"value": config.ControlPlane}),
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

func buildRuntimeStatusReport(config *AgentConfig, status runtimeStatusSnapshot, checks []map[string]any, includeChecks bool) map[string]any {
	reasons := buildDegradedReasons(config, status, checks)
	healthState := "healthy"
	if len(reasons) > 0 {
		healthState = "degraded"
	}
	result := map[string]any{
		"success":      len(reasons) == 0,
		"modelVersion": "gcac.agent.health.v1",
		"checkedAt":    time.Now().Format(time.RFC3339),
		"service": map[string]any{
			"name":             config.Service.Name,
			"displayName":      config.Service.DisplayName,
			"systemdAvailable": fileExists("/run/systemd/system") || lookPath("systemctl"),
		},
		"config": map[string]any{
			"configPath":                 config.Paths.Linux.ConfigPath,
			"dataDir":                    config.Paths.Linux.DataDir,
			"logDir":                     config.Paths.Linux.LogDir,
			"heartbeatIntervalSeconds":   effectiveHeartbeatSeconds(config),
			"taskPollIntervalSeconds":    effectiveTaskPollSeconds(config),
			"healthCheckIntervalSeconds": effectiveHealthCheckSeconds(config),
			"offlineTimeoutSeconds":      effectiveOfflineTimeoutSeconds(config),
			"directControlEnabled":       config.DirectControlEnabled,
			"directControlListenHost":    effectiveDirectControlListenHost(config),
			"directControlListenPort":    effectiveDirectControlListenPort(config),
		},
		"runtime": status,
		"health": map[string]any{
			"status":               healthState,
			"failureCounts":        map[string]any{"heartbeat": status.ConsecutiveHeartbeatFailures, "taskPoll": status.ConsecutiveTaskPollFailures, "recovery": status.ConsecutiveRecoveryFailures},
			"degradedReasons":      reasons,
			"pendingResultCount":   status.PendingResultCount,
			"recoverableTaskCount": status.RecoverableTaskCount,
		},
	}
	if includeChecks {
		result["checks"] = checks
	}
	return result
}

func buildHeartbeatRuntimeHealth(config *AgentConfig, status runtimeStatusSnapshot) *heartbeatRuntimeHealth {
	reasons := buildDegradedReasons(config, status, nil)
	filteredReasons := make([]string, 0, len(reasons))
	for _, reason := range reasons {
		if reason == "heartbeat_stale" {
			continue
		}
		filteredReasons = append(filteredReasons, reason)
	}
	healthStatus := "healthy"
	if len(filteredReasons) > 0 {
		healthStatus = "degraded"
	}
	return &heartbeatRuntimeHealth{
		ModelVersion:         "gcac.agent.health.v1",
		Status:               healthStatus,
		PendingResultCount:   status.PendingResultCount,
		RecoverableTaskCount: status.RecoverableTaskCount,
		LastRecoveryAt:       status.LastRecoveryAt,
		LastTaskPollAt:       status.LastTaskPollAt,
		LastTaskResultAt:     status.LastTaskResultAt,
		LastSelfCheckAt:      status.LastSelfCheckAt,
		LastError:            status.LastError,
		DegradedReasons:      filteredReasons,
		DirectControl:        status.DirectControl,
		FailureCounts: runtimeFailureCounts{
			Heartbeat: status.ConsecutiveHeartbeatFailures,
			TaskPoll:  status.ConsecutiveTaskPollFailures,
			Recovery:  status.ConsecutiveRecoveryFailures,
		},
	}
}

func buildDegradedReasons(config *AgentConfig, status runtimeStatusSnapshot, checks []map[string]any) []string {
	reasons := make([]string, 0)
	for _, check := range checks {
		if success, ok := check["success"].(bool); ok && !success {
			if name, ok := check["name"].(string); ok {
				reasons = append(reasons, "check_failed:"+name)
			}
		}
	}
	if status.ConsecutiveHeartbeatFailures > 0 {
		reasons = append(reasons, fmt.Sprintf("heartbeat_failures:%d", status.ConsecutiveHeartbeatFailures))
	}
	if status.ConsecutiveTaskPollFailures > 0 {
		reasons = append(reasons, fmt.Sprintf("task_poll_failures:%d", status.ConsecutiveTaskPollFailures))
	}
	if status.ConsecutiveRecoveryFailures > 0 {
		reasons = append(reasons, fmt.Sprintf("recovery_failures:%d", status.ConsecutiveRecoveryFailures))
	}
	if status.PendingResultCount > 0 {
		reasons = append(reasons, fmt.Sprintf("pending_results:%d", status.PendingResultCount))
	}
	if status.RecoverableTaskCount > 0 {
		reasons = append(reasons, fmt.Sprintf("recoverable_tasks:%d", status.RecoverableTaskCount))
	}
	if isStatusStale(status.LastHeartbeatAt, effectiveOfflineTimeoutSeconds(config)) {
		reasons = append(reasons, "heartbeat_stale")
	}
	return reasons
}

func isStatusStale(value string, thresholdSeconds int) bool {
	if strings.TrimSpace(value) == "" || thresholdSeconds <= 0 {
		return false
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return false
	}
	return time.Since(parsed) > time.Duration(thresholdSeconds)*time.Second
}

func effectiveHeartbeatSeconds(config *AgentConfig) int {
	if config.Heartbeat > 0 {
		return config.Heartbeat
	}
	return 30
}

func effectiveTaskPollSeconds(config *AgentConfig) int {
	if config.TaskPollIntervalSeconds > 0 {
		return config.TaskPollIntervalSeconds
	}
	return defaultTaskPoll
}

func effectiveHealthCheckSeconds(config *AgentConfig) int {
	if config.HealthCheckIntervalSeconds > 0 {
		return config.HealthCheckIntervalSeconds
	}
	return defaultHealthPoll
}

func effectiveOfflineTimeoutSeconds(config *AgentConfig) int {
	if config.OfflineTimeoutSeconds > 0 {
		return config.OfflineTimeoutSeconds
	}
	return defaultOfflineTTL
}

func effectiveDirectControlListenHost(config *AgentConfig) string {
	if strings.TrimSpace(config.DirectControlListenHost) != "" {
		return strings.TrimSpace(config.DirectControlListenHost)
	}
	return "0.0.0.0"
}

func effectiveDirectControlListenPort(config *AgentConfig) int {
	if config.DirectControlListenPort > 0 {
		return config.DirectControlListenPort
	}
	return 18931
}

func effectiveDirectControlAdvertiseHost(config *AgentConfig) string {
	if strings.TrimSpace(config.DirectControlAdvertiseHost) != "" {
		return strings.TrimSpace(config.DirectControlAdvertiseHost)
	}
	if primaryIP := strings.TrimSpace(collectRuntimeIdentity(config.AgentKey, config.ControlPlane).PrimaryIPAddress); primaryIP != "" {
		return primaryIP
	}
	return effectiveDirectControlListenHost(config)
}

func newDirectControlState(config *AgentConfig) *directControlState {
	state := &directControlState{
		Enabled:          config.DirectControlEnabled,
		Reachable:        false,
		ProtocolVersion:  "v1",
		SupportedActions: []string{"health", "discovery.run", "agent.capability.rescan", "linux.nginx.deploy_certificate"},
	}
	if config.DirectControlEnabled {
		state.ListenAddress = fmt.Sprintf("%s:%d", effectiveDirectControlAdvertiseHost(config), effectiveDirectControlListenPort(config))
	}
	return state
}

func startDirectControlServer(
	config *AgentConfig,
	client *http.Client,
	runtimeState *runtimeState,
	counters *runtimeCounters,
	rescan *rescanState,
	status *runtimeStatusSnapshot,
) (*directControlServer, error) {
	if !config.DirectControlEnabled {
		return nil, nil
	}
	host := effectiveDirectControlListenHost(config)
	port := effectiveDirectControlListenPort(config)
	directState := newDirectControlState(config)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/control/health", func(w http.ResponseWriter, _ *http.Request) {
		payload := map[string]any{
			"success":         true,
			"checkedAt":       time.Now().Format(time.RFC3339),
			"protocolVersion": "v1",
			"platform":        "linux",
			"service": map[string]any{
				"name":        config.Service.Name,
				"displayName": config.Service.DisplayName,
			},
			"directControl": directState,
			"runtime":       status,
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(payload)
	})
	mux.HandleFunc("/api/v1/control/discovery/run", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var request directDiscoveryRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil && !errors.Is(err, io.EOF) {
			http.Error(w, "invalid json body", http.StatusBadRequest)
			return
		}
		payload := buildDirectDiscoveryPayloadLinux(config.ControlPlane, request)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		_ = json.NewEncoder(w).Encode(payload)
	})
	mux.HandleFunc("/api/v1/control/actions/execute", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var request directActionExecuteRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil && !errors.Is(err, io.EOF) {
			http.Error(w, "invalid json body", http.StatusBadRequest)
			return
		}
		response, statusCode := executeDirectControlActionWithRuntime(r.Context(), client, config, runtimeState, counters, rescan, request)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(statusCode)
		_ = json.NewEncoder(w).Encode(response)
	})
	mux.HandleFunc("/api/v1/control/actions/start", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		var request directActionStartRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil && !errors.Is(err, io.EOF) {
			http.Error(w, "invalid json body", http.StatusBadRequest)
			return
		}
		response, statusCode := startDirectControlActionWithRuntime(client, config, runtimeState, counters, rescan, request)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(statusCode)
		_ = json.NewEncoder(w).Encode(response)
	})
	mux.HandleFunc("/api/v1/control/actions/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		actionID := strings.TrimSpace(r.URL.Query().Get("actionId"))
		response, statusCode := readDirectControlActionStatus(actionID)
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(statusCode)
		_ = json.NewEncoder(w).Encode(response)
	})
	server := &http.Server{
		Addr:              fmt.Sprintf("%s:%d", host, port),
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
	}
	listener, err := net.Listen("tcp", server.Addr)
	if err != nil {
		return nil, err
	}
	directState.Reachable = true
	directState.LastReadyAt = time.Now().Format(time.RFC3339)
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			directState.Reachable = false
			directState.LastDirectError = serveErr.Error()
		}
	}()
	return &directControlServer{state: directState, server: server, started: true}, nil
}

func (s *directControlServer) snapshot() *directControlState {
	if s == nil || s.state == nil {
		return nil
	}
	copyState := *s.state
	copyState.SupportedActions = append([]string{}, s.state.SupportedActions...)
	return &copyState
}

func (s *directControlServer) shutdown(ctx context.Context) {
	if s == nil || s.server == nil || !s.started {
		return
	}
	_ = s.server.Shutdown(ctx)
}

func executeDirectControlAction(request directActionExecuteRequest) (map[string]any, int) {
	actionType := strings.TrimSpace(request.ActionType)
	if !strings.EqualFold(actionType, "linux.nginx.deploy_certificate") {
		return map[string]any{
			"success":      false,
			"errorCode":    "DIRECT_ACTION_UNSUPPORTED",
			"errorMessage": fmt.Sprintf("unsupported direct action: %s", actionType),
		}, http.StatusBadRequest
	}

	payload := map[string]any{}
	for key, value := range request.Inputs {
		payload[key] = value
	}
	payload["type"] = "linux.nginx.deploy_certificate"

	taskID := fmt.Sprintf("direct_%d", time.Now().UnixNano())
	success, errorCode, errorMessage, detail := executeLinuxTaskPayload(taskID, payload)
	statusCode := http.StatusOK
	if !success {
		statusCode = http.StatusBadRequest
	}
	return map[string]any{
		"success":      success,
		"errorCode":    errorCode,
		"errorMessage": errorMessage,
		"detail":       detail,
		"taskId":       taskID,
		"requestId":    request.RequestID,
		"actionType":   "linux.nginx.deploy_certificate",
	}, statusCode
}

func executeDirectControlActionWithRuntime(
	ctx context.Context,
	client *http.Client,
	config *AgentConfig,
	state *runtimeState,
	counters *runtimeCounters,
	rescan *rescanState,
	request directActionExecuteRequest,
) (map[string]any, int) {
	actionType := strings.TrimSpace(request.ActionType)
	taskID := fmt.Sprintf("direct_%d", time.Now().UnixNano())
	success, errorCode, errorMessage, detail := executeDirectActionPayload(ctx, client, config, state, counters, rescan, taskID, actionType, request.Inputs)
	statusCode := http.StatusOK
	if !success {
		statusCode = http.StatusBadRequest
	}
	return map[string]any{
		"success":      success,
		"errorCode":    errorCode,
		"errorMessage": errorMessage,
		"detail":       detail,
		"taskId":       taskID,
		"requestId":    request.RequestID,
		"actionType":   actionType,
	}, statusCode
}

func startDirectControlAction(request directActionStartRequest) (map[string]any, int) {
	actionType := strings.TrimSpace(request.ActionType)
	if !strings.EqualFold(actionType, "linux.nginx.deploy_certificate") {
		return map[string]any{
			"success":      false,
			"errorCode":    "DIRECT_ACTION_UNSUPPORTED",
			"errorMessage": fmt.Sprintf("unsupported direct action: %s", actionType),
		}, http.StatusBadRequest
	}

	payload := map[string]any{}
	for key, value := range request.Inputs {
		payload[key] = value
	}
	payload["type"] = "linux.nginx.deploy_certificate"

	actionID := fmt.Sprintf("direct_action_%d", time.Now().UnixNano())
	startedAt := time.Now().Format(time.RFC3339)
	globalDirectActionStatusStore.upsert(directActionStatusSnapshot{
		ActionID:   actionID,
		ActionType: "linux.nginx.deploy_certificate",
		RequestID:  request.RequestID,
		Status:     "running",
		StartedAt:  startedAt,
	})

	go func() {
		success, errorCode, errorMessage, detail := executeLinuxTaskPayload(actionID, payload)
		globalDirectActionStatusStore.upsert(directActionStatusSnapshot{
			ActionID:     actionID,
			ActionType:   "linux.nginx.deploy_certificate",
			RequestID:    request.RequestID,
			Status:       "completed",
			StartedAt:    startedAt,
			FinishedAt:   time.Now().Format(time.RFC3339),
			Success:      success,
			ErrorCode:    errorCode,
			ErrorMessage: errorMessage,
			Detail:       detail,
		})
	}()

	return map[string]any{
		"success":    true,
		"accepted":   true,
		"actionId":   actionID,
		"requestId":  request.RequestID,
		"actionType": "linux.nginx.deploy_certificate",
		"status":     "running",
	}, http.StatusAccepted
}

func startDirectControlActionWithRuntime(
	client *http.Client,
	config *AgentConfig,
	state *runtimeState,
	counters *runtimeCounters,
	rescan *rescanState,
	request directActionStartRequest,
) (map[string]any, int) {
	actionType := strings.TrimSpace(request.ActionType)
	if actionType == "" {
		return map[string]any{
			"success":      false,
			"errorCode":    "DIRECT_ACTION_UNSUPPORTED",
			"errorMessage": "unsupported direct action: ",
		}, http.StatusBadRequest
	}

	actionID := fmt.Sprintf("direct_action_%d", time.Now().UnixNano())
	startedAt := time.Now().Format(time.RFC3339)
	globalDirectActionStatusStore.upsert(directActionStatusSnapshot{
		ActionID:   actionID,
		ActionType: actionType,
		RequestID:  request.RequestID,
		Status:     "running",
		StartedAt:  startedAt,
	})

	go func() {
		runCtx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		success, errorCode, errorMessage, detail := executeDirectActionPayload(runCtx, client, config, state, counters, rescan, actionID, actionType, request.Inputs)
		globalDirectActionStatusStore.upsert(directActionStatusSnapshot{
			ActionID:     actionID,
			ActionType:   actionType,
			RequestID:    request.RequestID,
			Status:       "completed",
			StartedAt:    startedAt,
			FinishedAt:   time.Now().Format(time.RFC3339),
			Success:      success,
			ErrorCode:    errorCode,
			ErrorMessage: errorMessage,
			Detail:       detail,
		})
	}()

	return map[string]any{
		"success":    true,
		"accepted":   true,
		"actionId":   actionID,
		"requestId":  request.RequestID,
		"actionType": actionType,
		"status":     "running",
	}, http.StatusAccepted
}

func executeDirectActionPayload(
	ctx context.Context,
	client *http.Client,
	config *AgentConfig,
	state *runtimeState,
	counters *runtimeCounters,
	rescan *rescanState,
	taskID string,
	actionType string,
	inputs map[string]any,
) (bool, string, string, map[string]any) {
	payload := map[string]any{}
	for key, value := range inputs {
		payload[key] = value
	}

	switch {
	case strings.EqualFold(actionType, "linux.nginx.deploy_certificate"):
		payload["type"] = "linux.nginx.deploy_certificate"
		return executeLinuxTaskPayload(taskID, payload)
	case strings.EqualFold(actionType, "agent.capability.rescan"):
		payload["type"] = "agent.capability.rescan"
		detail, err := runCapabilityRescan(ctx, client, config, state, counters, rescan, "manual", payload)
		if err != nil {
			return false, "RESCAN_REPORT_FAILED", err.Error(), detail
		}
		return true, "", "", detail
	default:
		return false, "DIRECT_ACTION_UNSUPPORTED", fmt.Sprintf("unsupported direct action: %s", actionType), map[string]any{
			"actionType": actionType,
		}
	}
}

func readDirectControlActionStatus(actionID string) (map[string]any, int) {
	if strings.TrimSpace(actionID) == "" {
		return map[string]any{
			"success":      false,
			"errorCode":    "ACTION_ID_REQUIRED",
			"errorMessage": "actionId is required",
		}, http.StatusBadRequest
	}
	snapshot, ok := globalDirectActionStatusStore.get(actionID)
	if !ok {
		return map[string]any{
			"success":      false,
			"errorCode":    "DIRECT_ACTION_NOT_FOUND",
			"errorMessage": fmt.Sprintf("direct action not found: %s", actionID),
		}, http.StatusNotFound
	}
	return map[string]any{
		"success":      snapshot.Success,
		"actionId":     snapshot.ActionID,
		"actionType":   snapshot.ActionType,
		"requestId":    snapshot.RequestID,
		"status":       snapshot.Status,
		"startedAt":    snapshot.StartedAt,
		"finishedAt":   snapshot.FinishedAt,
		"errorCode":    snapshot.ErrorCode,
		"errorMessage": snapshot.ErrorMessage,
		"detail":       snapshot.Detail,
	}, http.StatusOK
}

func (s *directActionStatusStore) upsert(snapshot directActionStatusSnapshot) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.actions[snapshot.ActionID] = snapshot
}

func (s *directActionStatusStore) get(actionID string) (directActionStatusSnapshot, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	snapshot, ok := s.actions[actionID]
	return snapshot, ok
}

func buildDirectDiscoveryPayloadLinux(controlPlaneURL string, request directDiscoveryRequest) map[string]any {
	identity := collectRuntimeIdentity("", controlPlaneURL)
	hostname, _ := os.Hostname()
	hosts := []map[string]any{
		{
			"hostname":        hostname,
			"primaryIp":       identity.PrimaryIPAddress,
			"ipAddresses":     firstIPv4Addresses(identity.NetworkInterfaces),
			"osType":          "LINUX",
			"osName":          identity.LinuxDistribution,
			"osVersion":       identity.OSVersion,
			"arch":            runtime.GOARCH,
			"discoverySource": "AGENT",
			"managementMode":  "AGENT",
			"status":          "ACTIVE",
		},
	}
	payload := map[string]any{
		"collectedAt":   time.Now().Format(time.RFC3339),
		"source":        "agent_direct",
		"platform":      "linux",
		"requestId":     request.RequestID,
		"hosts":         hosts,
		"services":      []map[string]any{},
		"serviceAssets": []map[string]any{},
		"siteAssets":    []map[string]any{},
		"bindings":      []map[string]any{},
	}

	appendLinuxDetailDiscovery(payload, hostname, "NGINX", "nginx", detectNginxDetail(), request.IncludeBindings)
	appendLinuxDetailDiscovery(payload, hostname, "APACHE", "apache", detectApacheDetail(), request.IncludeBindings)
	appendLinuxTomcatDiscovery(payload, hostname, detectTomcatDetail(), request.IncludeBindings)
	return payload
}

func firstIPv4Addresses(items []NetworkInterfaceInfo) []string {
	results := make([]string, 0)
	for _, item := range items {
		results = append(results, item.IPv4...)
	}
	return results
}

func appendLinuxDetailDiscovery(payload map[string]any, hostname, providerType, serviceName string, detail any, includeBindings bool) {
	if detail == nil {
		return
	}
	detailMap, ok := anyToMap(detail)
	if !ok || !readBool(detailMap, "Installed", "installed") {
		return
	}
	services := payload["services"].([]map[string]any)
	services = append(services, map[string]any{
		"hostname":        hostname,
		"providerType":    providerType,
		"serviceName":     serviceName,
		"displayName":     serviceName,
		"configPath":      readStringMap(detailMap, "ConfigPath", "configPath"),
		"discoverySource": "AGENT",
		"status":          "ACTIVE",
		"rawFacts":        detail,
	})
	payload["services"] = services

	sites := readObjectSlice(detailMap, "Sites", "sites")
	serviceAssets := payload["serviceAssets"].([]map[string]any)
	bindings := payload["bindings"].([]map[string]any)
	for _, site := range sites {
		serverNames := readStringSliceMap(site, "ServerNames", "serverNames")
		address := ""
		if len(serverNames) > 0 {
			address = serverNames[0]
		}
		if address == "" {
			address = readStringMap(site, "Name", "name")
		}
		for _, listen := range readObjectSlice(site, "Listen", "listen") {
			port := readIntMap(listen, "Port", "port")
			protocol := normalizeProtocolString(readStringMap(listen, "Protocol", "protocol"))
			if address == "" || port <= 0 || protocol == "" {
				continue
			}
			serviceAssetRef := strings.ToLower(fmt.Sprintf("%s:%d:%s", address, port, protocol))
			serviceAssets = append(serviceAssets, map[string]any{
				"serviceAssetRef": serviceAssetRef,
				"hostname":        hostname,
				"providerType":    providerType,
				"serviceName":     serviceName,
				"address":         address,
				"port":            port,
				"protocol":        protocol,
				"sniName":         address,
				"displayName":     address,
				"metadata": map[string]any{
					"testCommand":   readStringMap(listen, "TestCommand", "testCommand"),
					"reloadCommand": readStringMap(listen, "ReloadCommand", "reloadCommand"),
					"permission":    readMapValue(listen, "Permission", "permission"),
				},
			})
			if includeBindings {
				bindings = append(bindings, map[string]any{
					"serviceAssetRef": serviceAssetRef,
					"hostname":        hostname,
					"providerType":    providerType,
					"serviceName":     serviceName,
					"domainName":      address,
					"port":            port,
					"protocol":        protocol,
					"bindingType":     "FILE_PATH",
					"certPath":        readStringMap(listen, "CertificatePath", "certificatePath"),
					"keyPath":         readStringMap(listen, "CertificateKeyPath", "certificateKeyPath"),
					"metadata": map[string]any{
						"testCommand":   readStringMap(listen, "TestCommand", "testCommand"),
						"reloadCommand": readStringMap(listen, "ReloadCommand", "reloadCommand"),
						"permission":    readMapValue(listen, "Permission", "permission"),
					},
					"verifyMethod": "TLS_CONNECT",
				})
			}
		}
	}
	payload["serviceAssets"] = serviceAssets
	payload["bindings"] = bindings
}

func appendLinuxTomcatDiscovery(payload map[string]any, hostname string, detail *tomcatDetail, includeBindings bool) {
	if detail == nil || !detail.Installed {
		return
	}
	services := payload["services"].([]map[string]any)
	services = append(services, map[string]any{
		"hostname":        hostname,
		"providerType":    "TOMCAT",
		"serviceName":     "tomcat",
		"displayName":     "tomcat",
		"configPath":      detail.ConfigPath,
		"discoverySource": "AGENT",
		"status":          "ACTIVE",
		"rawFacts":        detail,
	})
	payload["services"] = services

	serviceAssets := payload["serviceAssets"].([]map[string]any)
	bindings := payload["bindings"].([]map[string]any)
	for _, connector := range detail.Connectors {
		protocol := normalizeProtocolString(connector.Protocol)
		if connector.Port <= 0 || protocol == "" {
			continue
		}
		address := strings.TrimSpace(connector.Address)
		if address == "" || address == "0.0.0.0" {
			address = hostname
		}
		serviceAssetRef := strings.ToLower(fmt.Sprintf("%s:%d:%s", address, connector.Port, protocol))
		serviceAssets = append(serviceAssets, map[string]any{
			"serviceAssetRef": serviceAssetRef,
			"hostname":        hostname,
			"providerType":    "TOMCAT",
			"serviceName":     "tomcat",
			"address":         address,
			"port":            connector.Port,
			"protocol":        protocol,
			"sniName":         address,
			"displayName":     address,
		})
		if includeBindings {
			bindings = append(bindings, map[string]any{
				"serviceAssetRef": serviceAssetRef,
				"hostname":        hostname,
				"providerType":    "TOMCAT",
				"serviceName":     "tomcat",
				"domainName":      address,
				"port":            connector.Port,
				"protocol":        protocol,
				"bindingType":     "FILE_PATH",
				"certPath":        connector.CertificatePath,
				"keyPath":         connector.CertificateKeyPath,
				"keystorePath":    connector.KeystorePath,
				"verifyMethod":    "TLS_CONNECT",
			})
		}
	}
	payload["serviceAssets"] = serviceAssets
	payload["bindings"] = bindings
}

func anyToMap(value any) (map[string]any, bool) {
	if value == nil {
		return nil, false
	}
	bytes, err := json.Marshal(value)
	if err != nil {
		return nil, false
	}
	var out map[string]any
	if err := json.Unmarshal(bytes, &out); err != nil {
		return nil, false
	}
	return out, true
}

func readMapValue(value map[string]any, primary string, secondary string) map[string]any {
	if direct, ok := value[primary].(map[string]any); ok {
		return direct
	}
	if direct, ok := value[secondary].(map[string]any); ok {
		return direct
	}
	return map[string]any{}
}

func readBool(value map[string]any, keys ...string) bool {
	for _, key := range keys {
		if raw, ok := value[key].(bool); ok {
			return raw
		}
	}
	return false
}

func readStringMap(value map[string]any, keys ...string) string {
	for _, key := range keys {
		if raw, ok := value[key].(string); ok && strings.TrimSpace(raw) != "" {
			return strings.TrimSpace(raw)
		}
	}
	return ""
}

func readIntMap(value map[string]any, keys ...string) int {
	for _, key := range keys {
		switch raw := value[key].(type) {
		case float64:
			return int(raw)
		case int:
			return raw
		}
	}
	return 0
}

func readObjectSlice(value map[string]any, keys ...string) []map[string]any {
	for _, key := range keys {
		raw, ok := value[key]
		if !ok {
			continue
		}
		items, ok := raw.([]any)
		if !ok {
			continue
		}
		result := make([]map[string]any, 0, len(items))
		for _, item := range items {
			if record, ok := item.(map[string]any); ok {
				result = append(result, record)
			}
		}
		return result
	}
	return nil
}

func readStringSliceMap(value map[string]any, keys ...string) []string {
	for _, key := range keys {
		raw, ok := value[key]
		if !ok {
			continue
		}
		items, ok := raw.([]any)
		if !ok {
			continue
		}
		result := make([]string, 0, len(items))
		for _, item := range items {
			if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
				result = append(result, strings.TrimSpace(text))
			}
		}
		return result
	}
	return nil
}

func normalizeProtocolString(value string) string {
	normalized := strings.ToUpper(strings.TrimSpace(value))
	switch normalized {
	case "HTTPS", "HTTP", "TLS", "STARTTLS":
		return normalized
	case "HTTP/1.1":
		return "HTTPS"
	default:
		return ""
	}
}

func registerAgent(ctx context.Context, client *http.Client, config *AgentConfig, identity runtimeIdentity) (*runtimeState, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return nil, fmt.Errorf("读取主机名失败: %w", err)
	}

	request := registerRequest{
		AgentKey:          config.AgentKey,
		MachineID:         identity.MachineID,
		Hostname:          hostname,
		Version:           agentVersion,
		OSType:            "linux",
		Arch:              runtime.GOARCH,
		IPAddress:         identity.PrimaryIPAddress,
		LinuxDistribution: identity.LinuxDistribution,
		OSVersion:         identity.OSVersion,
		Labels:            []string{"linux-go", "systemd"},
		EnrollmentToken:   strings.TrimSpace(config.EnrollmentToken),
		Role:              effectiveAgentRole(config),
		Zone:              strings.TrimSpace(config.Zone),
	}
	if config.DirectControlEnabled {
		request.Labels = append(request.Labels, "direct-control")
	}
	if isGatewayEnabled(config) {
		request.ZoneIDs = []string{firstNonEmpty(strings.TrimSpace(config.Zone), "default")}
		request.Adapters = gatewayRouteChannels()
		request.Capabilities = gatewayCapabilityKeys()
	}

	var response registerResponse
	if err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/register", request, &response); err != nil {
		if strings.TrimSpace(request.EnrollmentToken) != "" && strings.Contains(err.Error(), "AUTH_FORBIDDEN") {
			request.EnrollmentToken = ""
			if retryErr := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/register", request, &response); retryErr == nil {
				goto registered
			}
		}
		return nil, fmt.Errorf("注册 Agent 失败: %w", err)
	}
registered:
	if strings.TrimSpace(response.ID) == "" {
		return nil, errors.New("注册 Agent 失败: 服务端未返回 agentId")
	}

	return &runtimeState{
		AgentID:  response.ID,
		Hostname: hostname,
		Version:  agentVersion,
	}, nil
}

func postHeartbeat(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState, counters *runtimeCounters, status *runtimeStatusSnapshot) error {
	request := heartbeatRequest{
		AgentID: state.AgentID,
		Version: state.Version,
	}
	if isGatewayEnabled(config) {
		request.Adapters = gatewayRouteChannels()
		request.Capabilities = gatewayCapabilityKeys()
	}
	if counters != nil {
		request.TaskSummary.Running = counters.Running
		request.TaskSummary.Queued = counters.Queued
		request.TaskSummary.Succeeded = counters.Succeeded
		request.TaskSummary.Failed = counters.Failed
	}
	if status != nil {
		request.RuntimeHealth = buildHeartbeatRuntimeHealth(config, *status)
		request.DirectControl = status.DirectControl
	}

	return doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/heartbeat", request, nil)
}

func reportCapabilities(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState) error {
	capabilities := []reportedCapability{}
	if !isPureGatewayRole(config) {
		capabilities = collectCapabilityReports()
	}
	if len(capabilities) == 0 && !isGatewayEnabled(config) {
		return nil
	}
	request := capabilityReportRequest{
		AgentID:            state.AgentID,
		CompatibilityLevel: "L1",
		Capabilities:       capabilities,
		Adapters:           gatewayAdaptersIfNeeded(config),
	}
	if isGatewayEnabled(config) {
		for _, capability := range gatewayCapabilityKeys() {
			request.Capabilities = append(request.Capabilities, reportedCapability{
				CapabilityKey: capability,
				Value:         true,
				Confidence:    0.95,
				Evidence:      map[string]any{"source": "gateway-role"},
			})
		}
	}
	return doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/capabilities", request, nil)
}

func pullAndProcessTasks(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState, counters *runtimeCounters, rescan *rescanState, ledger *resultLedger) error {
	tasks, err := pullTasks(ctx, client, config, state.AgentID)
	if err != nil {
		return err
	}
	if counters != nil {
		counters.Queued = len(tasks)
	}
	for _, task := range tasks {
		if err := processTask(ctx, client, config, state, counters, rescan, ledger, task); err != nil {
			fmt.Fprintf(os.Stderr, "[task] taskId=%s error=%v\n", task.ID, err)
		}
	}
	if counters != nil {
		counters.Queued = 0
	}
	return nil
}

func pullTasks(ctx context.Context, client *http.Client, config *AgentConfig, agentID string) ([]agentTaskEnvelope, error) {
	var tasks []agentTaskEnvelope
	if err := doJSONRequest(ctx, client, config, http.MethodGet, "/api/v1/agents/tasks/pull?agentId="+agentID, nil, &tasks); err != nil {
		return nil, fmt.Errorf("??????: %w", err)
	}
	return tasks, nil
}

func processTask(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState, counters *runtimeCounters, rescan *rescanState, ledger *resultLedger, task agentTaskEnvelope) error {
	leaseID := newLeaseID(task.ID)
	if _, err := ackTask(ctx, client, config, state.AgentID, task.ID, leaseID); err != nil {
		return fmt.Errorf("ack ????: %w", err)
	}
	if counters != nil {
		counters.Running++
		defer func() { counters.Running-- }()
	}

	success, errorCode, errorMessage, detail := executeTask(ctx, client, config, state, counters, rescan, task)
	request := submitResultRequest{
		AgentID:      state.AgentID,
		TaskID:       task.ID,
		LeaseID:      leaseID,
		Success:      success,
		ErrorCode:    errorCode,
		ErrorMessage: errorMessage,
		Detail:       detail,
	}
	if err := ledger.stage(request); err != nil {
		return fmt.Errorf("????????: %w", err)
	}
	if _, err := submitTaskResult(ctx, client, config, request); err != nil {
		return fmt.Errorf("????????: %w", err)
	}
	if err := ledger.markReported(task.ID); err != nil {
		return fmt.Errorf("?????????: %w", err)
	}
	if counters != nil {
		if success {
			counters.Succeeded++
		} else {
			counters.Failed++
		}
	}
	return nil
}

func recoverPendingResults(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState, counters *runtimeCounters, ledger *resultLedger) error {
	for _, item := range ledger.pending() {
		request := submitResultRequest{
			AgentID:      state.AgentID,
			TaskID:       item.TaskID,
			LeaseID:      item.LeaseID,
			Success:      item.Success,
			ErrorCode:    item.ErrorCode,
			ErrorMessage: item.ErrorMessage,
			Detail:       item.Detail,
		}
		if _, err := submitTaskResult(ctx, client, config, request); err != nil {
			return fmt.Errorf("???????? taskId=%s: %w", item.TaskID, err)
		}
		if err := ledger.markReported(item.TaskID); err != nil {
			return err
		}
		if counters != nil {
			if item.Success {
				counters.Succeeded++
			} else {
				counters.Failed++
			}
		}
	}
	return nil
}

func executeTask(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState, counters *runtimeCounters, rescan *rescanState, task agentTaskEnvelope) (bool, string, string, map[string]any) {
	payload := task.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	taskType, _ := payload["type"].(string)
	if success, code, message, detail, handled := executeGatewayTask(ctx, client, config, task, payload); handled {
		return success, code, message, detail
	}
	switch taskType {
	case "", "agent.self_test":
		return true, "", "", map[string]any{
			"executor": "linux-go-agent-runtime",
			"mode":     "self-test",
			"taskId":   task.ID,
		}
	case "linux.nginx.deploy_certificate":
		return executeLinuxTaskPayload(task.ID, payload)
	case "agent.capability.rescan":
		detail, err := runCapabilityRescan(ctx, client, config, state, counters, rescan, "manual", payload)
		if err != nil {
			return false, "RESCAN_REPORT_FAILED", err.Error(), detail
		}
		return true, "", "", detail
	default:
		return false, "UNSUPPORTED_TASK", "当前 Linux Go Agent 尚未接入该任务类型", map[string]any{
			"taskId":         task.ID,
			"type":           taskType,
			"executor":       "linux-go-agent-runtime",
			"supportedModes": []string{"agent.self_test", "agent.capability.rescan", "linux.nginx.deploy_certificate"},
		}
	}
}

type linuxNginxDeployInput struct {
	Operation       string                    `json:"operation"`
	ProviderType    string                    `json:"providerType"`
	BindingSelector linuxNginxBindingSelector `json:"bindingSelector"`
	Artifact        linuxNginxArtifact        `json:"artifact"`
	ExecutionPolicy linuxNginxExecutionPolicy `json:"executionPolicy"`
	DryRun          bool                      `json:"dryRun"`
	StepType        string                    `json:"stepType"`
	ExecutionRunID  string                    `json:"executionRunId"`
	SourceRunID     string                    `json:"sourceRunId"`
	RollbackContext linuxNginxRollbackContext `json:"rollbackContext"`
}

type linuxNginxBindingSelector struct {
	SiteAssetID string   `json:"siteAssetId"`
	BindingID   string   `json:"bindingId"`
	SourceFile  string   `json:"sourceFile"`
	ListenPort  int      `json:"listenPort"`
	ServerNames []string `json:"serverNames"`
	CertPath    string   `json:"certPath"`
	KeyPath     string   `json:"keyPath"`
}

type linuxNginxArtifact struct {
	CertificatePEM          string `json:"certificatePem"`
	PrivateKeyPEM           string `json:"privateKeyPem"`
	TargetFingerprintSHA256 string `json:"targetFingerprintSha256"`
}

type linuxNginxExecutionPolicy struct {
	TestCommand   string `json:"testCommand"`
	ReloadCommand string `json:"reloadCommand"`
	HelperCommand string `json:"helperCommand"`
	VerifyHost    string `json:"verifyHost"`
	VerifyPort    int    `json:"verifyPort"`
	HostHeader    string `json:"hostHeader"`
	VerifyURL     string `json:"verifyUrl"`
}

type parsedLinuxNginxArtifact struct {
	certificate       *x509.Certificate
	certificateSHA256 string
	privateKeySigner  crypto.Signer
	privateKeyType    string
}

type linuxNginxTargetFileState struct {
	path               string
	exists             bool
	regularFile        bool
	readable           bool
	directReadable     bool
	writable           bool
	parentDir          string
	parentDirExists    bool
	parentDirWritable  bool
	mode               string
	certificateSHA256  string
	certificateSubject string
	privateKeyType     string
	matchesTarget      bool
	parseError         string
}

type linuxNginxDryRunState struct {
	sourceFile linuxNginxTargetFileState
	certFile   linuxNginxTargetFileState
	keyFile    linuxNginxTargetFileState
}

type linuxNginxRollbackContext struct {
	SourceRunID            string         `json:"sourceRunId"`
	SourceStepID           string         `json:"sourceStepId"`
	BackupManifestPath     string         `json:"backupManifestPath"`
	BackupManifest         map[string]any `json:"backupManifest"`
	RollbackCertificateSHA string         `json:"rollbackCertificateSha256,omitempty"`
	InstalledCertificateID string         `json:"installedCertificateSha256"`
}

type linuxNginxBackupManifest struct {
	TaskID                  string                  `json:"taskId"`
	ExecutionRunID          string                  `json:"executionRunId"`
	SourceRunID             string                  `json:"sourceRunId,omitempty"`
	BindingID               string                  `json:"bindingId"`
	SiteAssetID             string                  `json:"siteAssetId,omitempty"`
	CreatedAt               string                  `json:"createdAt"`
	CertificateSHA256       string                  `json:"certificateSha256"`
	TargetCertificateSHA256 string                  `json:"targetCertificateSha256,omitempty"`
	CertPath                string                  `json:"certPath"`
	KeyPath                 string                  `json:"keyPath"`
	CertBackup              linuxNginxBackupFileRef `json:"certBackup"`
	KeyBackup               linuxNginxBackupFileRef `json:"keyBackup"`
	PrivilegeAssessment     map[string]any          `json:"privilegeAssessment,omitempty"`
}

type linuxNginxBackupFileRef struct {
	TargetPath                   string `json:"targetPath"`
	BackupPath                   string `json:"backupPath,omitempty"`
	Existed                      bool   `json:"existed"`
	Mode                         string `json:"mode,omitempty"`
	UsedPrivilege                string `json:"usedPrivilege,omitempty"`
	ContentSHA256                string `json:"contentSha256,omitempty"`
	CertificateFingerprintSHA256 string `json:"certificateFingerprintSha256,omitempty"`
}

var (
	executeShellCommandFunc    = executeShellCommand
	executeCommandWithSudoFunc = executeCommandWithSudo
	executeHelperCommandFunc   = executeHelperCommand
	probeSudoNoPasswordFunc    = probeSudoNoPassword
	currentEUIDFunc            = os.Geteuid
	lookPathFunc               = lookPath
	canReadPathFunc            = canReadPath
	canWritePathFunc           = canWritePath
	canWriteDirFunc            = canWriteDir
	atomicWritePEMFileFunc     = atomicWritePEMFile
	readFileWithHelperFunc     = readFileWithHelper
	readFileWithSudoFunc       = readFileWithSudo
	removeFileWithHelperFunc   = removeFileWithHelper
	removeFileWithSudoFunc     = removeFileWithSudo
	pathExistsWithHelperFunc   = pathExistsWithHelper
	pathExistsWithSudoFunc     = pathExistsWithSudo
)

func executeLinuxTaskPayload(taskID string, payload map[string]any) (bool, string, string, map[string]any) {
	taskType := strings.TrimSpace(stringFromMap(payload, "type"))
	if !strings.EqualFold(taskType, "linux.nginx.deploy_certificate") {
		return false, "UNSUPPORTED_TASK", "当前 Linux Go Agent 仅支持 linux.nginx.deploy_certificate 的执行入口", map[string]any{
			"taskId":         taskID,
			"type":           taskType,
			"executor":       "linux-go-agent-runtime",
			"supportedModes": []string{"linux.nginx.deploy_certificate"},
		}
	}

	input, err := parseLinuxNginxDeployInput(payload)
	if err != nil {
		return false, "TASK_PAYLOAD_INVALID", err.Error(), map[string]any{
			"taskId":   taskID,
			"executor": "linux-nginx-provider",
		}
	}
	return runLinuxNginxDeployment(taskID, input)
}

func parseLinuxNginxDeployInput(payload map[string]any) (linuxNginxDeployInput, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return linuxNginxDeployInput{}, err
	}
	var input linuxNginxDeployInput
	if err := json.Unmarshal(raw, &input); err != nil {
		return linuxNginxDeployInput{}, err
	}
	return input, nil
}

func isLinuxNginxDryRun(input linuxNginxDeployInput) bool {
	if input.DryRun {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(input.Operation), "dryRun")
}

func normalizeLinuxNginxOperation(input linuxNginxDeployInput) string {
	if isLinuxNginxDryRun(input) {
		return "dryRun"
	}
	if stepType := strings.ToUpper(strings.TrimSpace(input.StepType)); stepType != "" {
		switch stepType {
		case "DISCOVER":
			return "dryRun"
		case "BACKUP":
			return "backup"
		case "INSTALL":
			return "install"
		case "RELOAD":
			return "reload"
		case "VERIFY":
			return "verify"
		case "ROLLBACK":
			return "rollback"
		}
	}
	operation := strings.TrimSpace(input.Operation)
	if operation == "" {
		return "install"
	}
	return operation
}

func runLinuxNginxDeployment(taskID string, input linuxNginxDeployInput) (bool, string, string, map[string]any) {
	operation := normalizeLinuxNginxOperation(input)
	switch strings.ToLower(strings.TrimSpace(operation)) {
	case "dryrun":
		return runLinuxNginxDryRun(taskID, input)
	case "backup":
		return runLinuxNginxBackup(taskID, input)
	case "install":
		return runLinuxNginxInstall(taskID, input)
	case "reload":
		return runLinuxNginxReload(taskID, input)
	case "verify":
		return runLinuxNginxVerify(taskID, input)
	case "rollback":
		return runLinuxNginxRollback(taskID, input)
	default:
		return false, "UNSUPPORTED_OPERATION", "Linux NGINX Provider 不支持该 operation", map[string]any{
			"taskId":         taskID,
			"executor":       "linux-nginx-provider",
			"operation":      operation,
			"supportedModes": []string{"dryRun", "backup", "install", "reload", "verify", "rollback"},
		}
	}
}

func runLinuxNginxDryRun(taskID string, input linuxNginxDeployInput) (bool, string, string, map[string]any) {
	checks := make([]map[string]any, 0, 16)
	blockers := make([]map[string]any, 0)
	warnings := make([]map[string]any, 0)
	plannedChanges := make([]map[string]any, 0, 8)

	checks = append(checks, evaluateBindingSelectorCheck(input.BindingSelector))
	artifactChecks, parsedArtifact := evaluatePEMArtifactChecks(input.Artifact)
	checks = append(checks, artifactChecks...)
	privilegeEvidence, privilegeChecks := evaluateLinuxNginxPrivilegeChecks(input)
	checks = append(checks, privilegeChecks...)
	checks = append(checks, evaluatePathChecks(input.BindingSelector, privilegeEvidence)...)
	dryRunState, stateChecks := evaluateLinuxNginxTargetState(input.BindingSelector, parsedArtifact, input.ExecutionPolicy.HelperCommand, privilegeEvidence)
	checks = append(checks, stateChecks...)
	checks = append(checks, evaluateVerifyEndpointCheck(input.ExecutionPolicy))

	for _, check := range checks {
		status := strings.TrimSpace(stringFromAny(check["status"]))
		switch status {
		case "failed":
			blockers = append(blockers, map[string]any{
				"key":    check["key"],
				"label":  check["label"],
				"detail": check["detail"],
			})
		case "warning":
			warnings = append(warnings, map[string]any{
				"key":    check["key"],
				"label":  check["label"],
				"detail": check["detail"],
			})
		}
	}

	plannedChanges = append(plannedChanges, buildLinuxNginxPlannedChanges(input, dryRunState)...)

	detail := map[string]any{
		"executor":       "linux-nginx-provider",
		"mode":           "nginx_dry_run_preflight",
		"taskId":         taskID,
		"providerType":   "NGINX",
		"operation":      "dryRun",
		"executable":     len(blockers) == 0,
		"blockers":       blockers,
		"warnings":       warnings,
		"plannedChanges": plannedChanges,
		"bindingSelector": map[string]any{
			"siteAssetId": input.BindingSelector.SiteAssetID,
			"bindingId":   input.BindingSelector.BindingID,
			"sourceFile":  input.BindingSelector.SourceFile,
			"listenPort":  input.BindingSelector.ListenPort,
			"serverNames": input.BindingSelector.ServerNames,
			"certPath":    input.BindingSelector.CertPath,
			"keyPath":     input.BindingSelector.KeyPath,
		},
		"artifact": map[string]any{
			"targetFingerprintSha256": input.Artifact.TargetFingerprintSHA256,
			"certificatePemBytes":     len([]byte(input.Artifact.CertificatePEM)),
			"privateKeyPemBytes":      len([]byte(input.Artifact.PrivateKeyPEM)),
			"privateKeyType":          parsedArtifact.privateKeyType,
		},
		"currentState": map[string]any{
			"sourceFile": mapFromLinuxNginxTargetFileState(dryRunState.sourceFile),
			"certFile":   mapFromLinuxNginxTargetFileState(dryRunState.certFile),
			"keyFile":    mapFromLinuxNginxTargetFileState(dryRunState.keyFile),
		},
		"executionPolicy": map[string]any{
			"testCommand":   input.ExecutionPolicy.TestCommand,
			"reloadCommand": input.ExecutionPolicy.ReloadCommand,
			"verifyHost":    input.ExecutionPolicy.VerifyHost,
			"verifyPort":    input.ExecutionPolicy.VerifyPort,
			"hostHeader":    input.ExecutionPolicy.HostHeader,
			"verifyUrl":     input.ExecutionPolicy.VerifyURL,
		},
		"privilegeAssessment": privilegeEvidence,
		"dryRunChecks":        checks,
		"dryRunSummary":       summarizeDryRunChecks(checks),
	}

	if len(blockers) > 0 {
		return false, "NGINX_DRY_RUN_FAILED", "Linux NGINX dry-run 预检未通过", detail
	}
	return true, "", "", detail
}

func runLinuxNginxBackup(taskID string, input linuxNginxDeployInput) (bool, string, string, map[string]any) {
	preflight, errorCode, errorMessage, preflightDetail := runLinuxNginxDryRun(taskID, input)
	if !preflight {
		return false, errorCode, errorMessage, preflightDetail
	}
	manifest, detail, err := createLinuxNginxBackupManifest(taskID, input)
	if err != nil {
		return false, "NGINX_BACKUP_FAILED", err.Error(), detail
	}
	return true, "", "", map[string]any{
		"executor":            "linux-nginx-provider",
		"mode":                "nginx_backup_completed",
		"taskId":              taskID,
		"operation":           "backup",
		"backupManifestPath":  detail["backupManifestPath"],
		"backupManifest":      manifestToMap(manifest),
		"privilegeAssessment": detail["privilegeAssessment"],
	}
}

func runLinuxNginxInstall(taskID string, input linuxNginxDeployInput) (bool, string, string, map[string]any) {
	preflight, errorCode, errorMessage, preflightDetail := runLinuxNginxDryRun(taskID, input)
	if !preflight {
		return false, errorCode, errorMessage, preflightDetail
	}
	manifest, backupDetail, err := createLinuxNginxBackupManifest(taskID, input)
	if err != nil {
		return false, "NGINX_BACKUP_FAILED", err.Error(), backupDetail
	}

	artifactChecks, parsedArtifact := evaluatePEMArtifactChecks(input.Artifact)
	for _, check := range artifactChecks {
		if strings.TrimSpace(stringFromAny(check["status"])) == "failed" {
			return false, "TASK_PAYLOAD_INVALID", "安装前部署材料校验失败", map[string]any{
				"executor":       "linux-nginx-provider",
				"mode":           "nginx_install_rejected",
				"taskId":         taskID,
				"operation":      "install",
				"artifactChecks": artifactChecks,
			}
		}
	}

	writeCommands := make([]map[string]any, 0, 2)
	certWriteMode, err := atomicWritePEMFileWithPrivilege(input.BindingSelector.CertPath, []byte(input.Artifact.CertificatePEM), input)
	if err != nil {
		return rollbackAfterInstallFailure(taskID, input, manifest, "CERT_WRITE_FAILED", fmt.Sprintf("写入证书文件失败: %v", err), map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_install_failed",
			"taskId":             taskID,
			"backupManifestPath": backupDetail["backupManifestPath"],
			"backupManifest":     manifestToMap(manifest),
		})
	}
	writeCommands = append(writeCommands, map[string]any{
		"type":          "write_certificate_file",
		"path":          input.BindingSelector.CertPath,
		"bytes":         len([]byte(input.Artifact.CertificatePEM)),
		"atomic":        true,
		"usedPrivilege": certWriteMode,
	})
	keyWriteMode, err := atomicWritePEMFileWithPrivilege(input.BindingSelector.KeyPath, []byte(input.Artifact.PrivateKeyPEM), input)
	if err != nil {
		return rollbackAfterInstallFailure(taskID, input, manifest, "KEY_WRITE_FAILED", fmt.Sprintf("写入私钥文件失败: %v", err), map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_install_failed",
			"taskId":             taskID,
			"backupManifestPath": backupDetail["backupManifestPath"],
			"backupManifest":     manifestToMap(manifest),
		})
	}
	writeCommands = append(writeCommands, map[string]any{
		"type":          "write_private_key_file",
		"path":          input.BindingSelector.KeyPath,
		"bytes":         len([]byte(input.Artifact.PrivateKeyPEM)),
		"atomic":        true,
		"usedPrivilege": keyWriteMode,
	})
	installedState := inspectCertificateFileState(input.BindingSelector.CertPath, input.Artifact.TargetFingerprintSHA256, input.ExecutionPolicy.HelperCommand)
	installedFingerprint := installedState.certificateSHA256
	if installedFingerprint == "" {
		return rollbackAfterInstallFailure(taskID, input, manifest, "INSTALLED_CERT_READ_FAILED", "证书写入后无法读取目标 certPath 的证书指纹", map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_install_failed",
			"taskId":             taskID,
			"backupManifestPath": backupDetail["backupManifestPath"],
			"backupManifest":     manifestToMap(manifest),
			"installedFile": map[string]any{
				"certFile": mapFromLinuxNginxTargetFileState(installedState),
			},
		})
	}
	if expected := normalizeHexFingerprint(input.Artifact.TargetFingerprintSHA256); expected != "" && installedFingerprint != expected {
		return rollbackAfterInstallFailure(taskID, input, manifest, "INSTALLED_CERT_FINGERPRINT_MISMATCH", "证书写入后目标 certPath 指纹与部署产物指纹不一致", map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_install_failed",
			"taskId":             taskID,
			"backupManifestPath": backupDetail["backupManifestPath"],
			"backupManifest":     manifestToMap(manifest),
			"expectedSha256":     expected,
			"actualSha256":       installedFingerprint,
			"installedFile": map[string]any{
				"certFile": mapFromLinuxNginxTargetFileState(installedState),
			},
		})
	}

	return true, "", "", map[string]any{
		"executor":                   "linux-nginx-provider",
		"mode":                       "nginx_install_completed",
		"taskId":                     taskID,
		"operation":                  "install",
		"backupManifestPath":         backupDetail["backupManifestPath"],
		"backupManifest":             manifestToMap(manifest),
		"installedCertificateSha256": installedFingerprint,
		"newThumbprint":              strings.ToUpper(formatThumbprintSha1(parsedArtifact.certificate)),
		"writeCommands":              writeCommands,
		"privilegeAssessment":        backupDetail["privilegeAssessment"],
		"fileWriteMode":              mergeLinuxNginxPrivilegeMode(certWriteMode, keyWriteMode),
		"installedFile": map[string]any{
			"certFile": mapFromLinuxNginxTargetFileState(installedState),
		},
	}
}

func runLinuxNginxReload(taskID string, input linuxNginxDeployInput) (bool, string, string, map[string]any) {
	testResult, testMode, testErr := executeControlledCommandWithPrivilege(input.ExecutionPolicy.TestCommand, true)
	if testErr != nil || !testResult.Success {
		return false, classifyCommandFailure("NGINX_TEST_FAILED", testResult), "执行 reload 前 nginx -t 失败", map[string]any{
			"executor":    "linux-nginx-provider",
			"mode":        "nginx_reload_failed",
			"taskId":      taskID,
			"operation":   "reload",
			"testCommand": mapFromCommandResult(testResult, testMode),
		}
	}
	reloadResult, reloadMode, reloadErr := executeControlledCommandWithPrivilege(input.ExecutionPolicy.ReloadCommand, true)
	if reloadErr != nil || !reloadResult.Success {
		return false, classifyCommandFailure("NGINX_RELOAD_FAILED", reloadResult), "执行 NGINX reload 失败", map[string]any{
			"executor":      "linux-nginx-provider",
			"mode":          "nginx_reload_failed",
			"taskId":        taskID,
			"operation":     "reload",
			"testCommand":   mapFromCommandResult(testResult, testMode),
			"reloadCommand": mapFromCommandResult(reloadResult, reloadMode),
		}
	}
	return true, "", "", map[string]any{
		"executor":      "linux-nginx-provider",
		"mode":          "nginx_reload_completed",
		"taskId":        taskID,
		"operation":     "reload",
		"testCommand":   mapFromCommandResult(testResult, testMode),
		"reloadCommand": mapFromCommandResult(reloadResult, reloadMode),
	}
}

func runLinuxNginxVerify(taskID string, input linuxNginxDeployInput) (bool, string, string, map[string]any) {
	return true, "", "", map[string]any{
		"executor":  "linux-nginx-provider",
		"mode":      "nginx_verify_delegated",
		"taskId":    taskID,
		"operation": "verify",
		"verify": map[string]any{
			"delegatedTo":               "control-plane",
			"reason":                    "远端 TLS 验证必须从控制面或 Gateway 的访问视角发起，Agent 只负责本机安装、nginx -t 与 reload",
			"verifyHost":                strings.TrimSpace(input.ExecutionPolicy.VerifyHost),
			"verifyPort":                input.ExecutionPolicy.VerifyPort,
			"verifyUrl":                 strings.TrimSpace(input.ExecutionPolicy.VerifyURL),
			"serverName":                strings.TrimSpace(input.ExecutionPolicy.HostHeader),
			"expectedCertificateSha256": normalizeHexFingerprint(input.Artifact.TargetFingerprintSHA256),
			"remoteCertificateSha256":   nil,
			"remoteFingerprintSha256":   nil,
			"remoteThumbprint":          nil,
		},
	}
}

func runLinuxNginxRollback(taskID string, input linuxNginxDeployInput) (bool, string, string, map[string]any) {
	manifest, manifestPath, err := resolveRollbackManifest(input)
	if err != nil {
		return false, "ROLLBACK_MANIFEST_MISSING", err.Error(), map[string]any{
			"executor":  "linux-nginx-provider",
			"mode":      "nginx_rollback_failed",
			"taskId":    taskID,
			"operation": "rollback",
		}
	}
	certRestoreMode, err := restoreBackupFileWithPrivilege(manifest.CertBackup, input)
	if err != nil {
		return false, "ROLLBACK_CERT_RESTORE_FAILED", fmt.Sprintf("恢复证书文件失败: %v", err), map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_rollback_failed",
			"taskId":             taskID,
			"operation":          "rollback",
			"backupManifestPath": manifestPath,
			"backupManifest":     manifestToMap(manifest),
		}
	}
	keyRestoreMode, err := restoreBackupFileWithPrivilege(manifest.KeyBackup, input)
	if err != nil {
		return false, "ROLLBACK_KEY_RESTORE_FAILED", fmt.Sprintf("恢复私钥文件失败: %v", err), map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_rollback_failed",
			"taskId":             taskID,
			"operation":          "rollback",
			"backupManifestPath": manifestPath,
			"backupManifest":     manifestToMap(manifest),
		}
	}
	testResult, testMode, testErr := executeControlledCommandWithPrivilege(input.ExecutionPolicy.TestCommand, true)
	if testErr != nil || !testResult.Success {
		return false, classifyCommandFailure("ROLLBACK_TEST_FAILED", testResult), "回滚后 nginx -t 失败", map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_rollback_failed",
			"taskId":             taskID,
			"operation":          "rollback",
			"backupManifestPath": manifestPath,
			"backupManifest":     manifestToMap(manifest),
			"testCommand":        mapFromCommandResult(testResult, testMode),
		}
	}
	reloadResult, reloadMode, reloadErr := executeControlledCommandWithPrivilege(input.ExecutionPolicy.ReloadCommand, true)
	if reloadErr != nil || !reloadResult.Success {
		return false, classifyCommandFailure("ROLLBACK_RELOAD_FAILED", reloadResult), "回滚后 NGINX reload 失败", map[string]any{
			"executor":           "linux-nginx-provider",
			"mode":               "nginx_rollback_failed",
			"taskId":             taskID,
			"operation":          "rollback",
			"backupManifestPath": manifestPath,
			"backupManifest":     manifestToMap(manifest),
			"testCommand":        mapFromCommandResult(testResult, testMode),
			"reloadCommand":      mapFromCommandResult(reloadResult, reloadMode),
		}
	}
	rollbackCertificateSHA := resolveRollbackCertificateSHA256(manifest, input)
	return true, "", "", map[string]any{
		"executor":           "linux-nginx-provider",
		"mode":               "nginx_rollback_completed",
		"taskId":             taskID,
		"operation":          "rollback",
		"backupManifestPath": manifestPath,
		"backupManifest":     manifestToMap(manifest),
		"testCommand":        mapFromCommandResult(testResult, testMode),
		"reloadCommand":      mapFromCommandResult(reloadResult, reloadMode),
		"fileRestoreMode":    mergeLinuxNginxPrivilegeMode(certRestoreMode, keyRestoreMode),
		"verify": map[string]any{
			"delegatedTo":               "control-plane",
			"reason":                    "回滚后的远端 TLS 验证必须从控制面或 Gateway 的访问视角发起",
			"verifyHost":                strings.TrimSpace(input.ExecutionPolicy.VerifyHost),
			"verifyPort":                input.ExecutionPolicy.VerifyPort,
			"verifyUrl":                 strings.TrimSpace(input.ExecutionPolicy.VerifyURL),
			"serverName":                strings.TrimSpace(input.ExecutionPolicy.HostHeader),
			"expectedCertificateSha256": rollbackCertificateSHA,
		},
	}
}

func evaluateBindingSelectorCheck(selector linuxNginxBindingSelector) map[string]any {
	missing := make([]string, 0, 4)
	if strings.TrimSpace(selector.CertPath) == "" {
		missing = append(missing, "certPath")
	}
	if strings.TrimSpace(selector.KeyPath) == "" {
		missing = append(missing, "keyPath")
	}
	if selector.ListenPort <= 0 {
		missing = append(missing, "listenPort")
	}
	if len(selector.ServerNames) == 0 {
		missing = append(missing, "serverNames")
	}
	if len(missing) > 0 {
		return dryRunCheck("binding_selector_complete", "目标绑定信息完整", "failed", fmt.Sprintf("bindingSelector 缺少必要字段: %s", strings.Join(missing, ", ")), map[string]any{
			"missingFields": missing,
		})
	}
	return dryRunCheck("binding_selector_complete", "目标绑定信息完整", "passed", "已识别 certPath/keyPath/监听端口/域名", map[string]any{
		"certPath":    selector.CertPath,
		"keyPath":     selector.KeyPath,
		"listenPort":  selector.ListenPort,
		"serverNames": selector.ServerNames,
	})
}

func evaluatePEMArtifactChecks(artifact linuxNginxArtifact) ([]map[string]any, parsedLinuxNginxArtifact) {
	checks := make([]map[string]any, 0, 4)
	parsed := parsedLinuxNginxArtifact{}
	if strings.TrimSpace(artifact.CertificatePEM) == "" || strings.TrimSpace(artifact.PrivateKeyPEM) == "" {
		return append(checks, dryRunCheck("deployment_material_complete", "证书材料完整", "failed", "certificatePem/privateKeyPem 不能为空", nil)), parsed
	}

	cert, certErr := parseCertificatePEM(artifact.CertificatePEM)
	if certErr != nil {
		checks = append(checks, dryRunCheck("certificate_pem_parseable", "证书 PEM 可解析", "failed", certErr.Error(), nil))
	} else {
		evidence := map[string]any{
			"subject":   cert.Subject.String(),
			"notBefore": cert.NotBefore.Format(time.RFC3339),
			"notAfter":  cert.NotAfter.Format(time.RFC3339),
		}
		fingerprint := sha256.Sum256(cert.Raw)
		fingerprintHex := strings.ToLower(hex.EncodeToString(fingerprint[:]))
		evidence["fingerprintSha256"] = fingerprintHex
		parsed.certificate = cert
		parsed.certificateSHA256 = fingerprintHex
		status := "passed"
		detail := "证书 PEM 可解析"
		if expected := normalizeHexFingerprint(artifact.TargetFingerprintSHA256); expected != "" && expected != fingerprintHex {
			status = "failed"
			detail = "证书指纹与 payload 目标指纹不一致"
			evidence["expectedFingerprintSha256"] = expected
		}
		checks = append(checks, dryRunCheck("certificate_pem_parseable", "证书 PEM 可解析", status, detail, evidence))
	}

	signer, keyType, keyErr := parsePrivateKeyPEMSigner(artifact.PrivateKeyPEM)
	if keyErr != nil {
		checks = append(checks, dryRunCheck("private_key_pem_parseable", "私钥 PEM 可解析", "failed", "privateKeyPem 不是合法 PEM 块", nil))
	} else {
		parsed.privateKeySigner = signer
		parsed.privateKeyType = keyType
		checks = append(checks, dryRunCheck("private_key_pem_parseable", "私钥 PEM 可解析", "passed", "私钥 PEM 结构存在", map[string]any{
			"keyType": keyType,
		}))
	}

	if parsed.certificate != nil && parsed.privateKeySigner != nil {
		if certificateMatchesPrivateKey(parsed.certificate, parsed.privateKeySigner) {
			checks = append(checks, dryRunCheck("certificate_key_match", "证书与私钥匹配", "passed", "部署材料内的证书和私钥匹配", nil))
		} else {
			checks = append(checks, dryRunCheck("certificate_key_match", "证书与私钥匹配", "failed", "部署材料内的证书和私钥不匹配", nil))
		}
	}

	return checks, parsed
}

func evaluatePathChecks(selector linuxNginxBindingSelector, privilegeAssessment map[string]any) []map[string]any {
	checks := make([]map[string]any, 0, 4)
	checks = append(checks, evaluateSinglePathCheck("cert_path_valid", "证书文件路径合法", selector.CertPath))
	checks = append(checks, evaluateSinglePathCheck("key_path_valid", "私钥文件路径合法", selector.KeyPath))
	checks = append(checks, evaluateWriteTargetCheck("cert_path_access", "证书文件写入权限", selector.CertPath, privilegeAssessment))
	checks = append(checks, evaluateWriteTargetCheck("key_path_access", "私钥文件写入权限", selector.KeyPath, privilegeAssessment))
	return checks
}

func evaluateLinuxNginxTargetState(selector linuxNginxBindingSelector, artifact parsedLinuxNginxArtifact, helperCommand string, privilegeAssessment map[string]any) (linuxNginxDryRunState, []map[string]any) {
	state := linuxNginxDryRunState{
		sourceFile: inspectPlainFileState(strings.TrimSpace(selector.SourceFile)),
		certFile:   inspectCertificateFileState(strings.TrimSpace(selector.CertPath), artifact.certificateSHA256, helperCommand),
		keyFile:    inspectPrivateKeyFileState(strings.TrimSpace(selector.KeyPath), artifact.privateKeySigner, helperCommand),
	}
	checks := make([]map[string]any, 0, 7)
	checks = append(checks, evaluateSourceFileStateCheck(state.sourceFile))
	checks = append(checks, evaluateTargetFileStateCheck("current_cert_file_state", "当前证书文件状态", state.certFile))
	checks = append(checks, evaluateTargetFileStateCheck("current_key_file_state", "当前私钥文件状态", state.keyFile))
	checks = append(checks, evaluateBackupPreconditionCheck("cert_backup_precondition", "证书文件备份前置条件", state.certFile, privilegeAssessment))
	checks = append(checks, evaluateBackupPreconditionCheck("key_backup_precondition", "私钥文件备份前置条件", state.keyFile, privilegeAssessment))
	if state.certFile.exists && state.certFile.matchesTarget {
		checks = append(checks, dryRunCheck("current_cert_matches_target", "当前证书已匹配目标", "passed", "目标 certPath 当前证书已是目标指纹", map[string]any{
			"path":               state.certFile.path,
			"certificateSha256":  state.certFile.certificateSHA256,
			"certificateSubject": state.certFile.certificateSubject,
		}))
	}
	if state.keyFile.exists && state.keyFile.matchesTarget {
		checks = append(checks, dryRunCheck("current_key_matches_target", "当前私钥已匹配目标", "passed", "目标 keyPath 当前私钥已匹配部署材料", map[string]any{
			"path":           state.keyFile.path,
			"privateKeyType": state.keyFile.privateKeyType,
		}))
	}
	return state, checks
}

func evaluateSinglePathCheck(key string, label string, targetPath string) map[string]any {
	targetPath = strings.TrimSpace(targetPath)
	if targetPath == "" {
		return dryRunCheck(key, label, "failed", "路径不能为空", nil)
	}
	if strings.Contains(targetPath, "\x00") {
		return dryRunCheck(key, label, "failed", "路径包含 NUL 字符", map[string]any{"path": targetPath})
	}
	if strings.Contains(targetPath, "$") {
		return dryRunCheck(key, label, "warning", "路径包含变量占位符，当前版本不会自动展开变量路径", map[string]any{"path": targetPath})
	}
	if !filepath.IsAbs(targetPath) {
		return dryRunCheck(key, label, "failed", "路径必须是绝对路径", map[string]any{"path": targetPath})
	}
	cleaned := filepath.Clean(targetPath)
	return dryRunCheck(key, label, "passed", "路径格式通过基础校验", map[string]any{
		"path":      targetPath,
		"cleaned":   cleaned,
		"parentDir": filepath.Dir(cleaned),
	})
}

func evaluateWriteTargetCheck(key string, label string, targetPath string, privilegeAssessment map[string]any) map[string]any {
	targetPath = strings.TrimSpace(targetPath)
	if !filepath.IsAbs(targetPath) {
		return dryRunCheck(key, label, "failed", "路径非法，无法评估写入权限", map[string]any{"path": targetPath})
	}
	parentDir := filepath.Dir(filepath.Clean(targetPath))
	parentInfo, parentErr := os.Stat(parentDir)
	if parentErr != nil {
		return dryRunCheck(key, label, "failed", fmt.Sprintf("目标目录不存在或不可访问: %v", parentErr), map[string]any{
			"path":      targetPath,
			"parentDir": parentDir,
		})
	}
	if !parentInfo.IsDir() {
		return dryRunCheck(key, label, "failed", "目标父路径不是目录", map[string]any{
			"path":      targetPath,
			"parentDir": parentDir,
		})
	}

	if info, err := os.Stat(targetPath); err == nil {
		writable := canWritePathFunc(targetPath)
		readable := canReadPathFunc(targetPath)
		if !writable {
			if detail, ok := filePrivilegeSatisfiesWrite(privilegeAssessment); ok {
				return dryRunCheck(key, label, detail.status, detail.message, map[string]any{
					"path":           targetPath,
					"readable":       readable,
					"writable":       writable,
					"mode":           info.Mode().String(),
					"privilegeMode":  detail.mode,
					"effectiveWrite": true,
				})
			}
			return dryRunCheck(key, label, "failed", "目标文件已存在，但当前用户没有写权限", map[string]any{
				"path":     targetPath,
				"readable": readable,
				"writable": writable,
				"mode":     info.Mode().String(),
			})
		}
		return dryRunCheck(key, label, "passed", "目标文件已存在，当前用户具备覆盖写入权限", map[string]any{
			"path":     targetPath,
			"readable": readable,
			"writable": writable,
			"mode":     info.Mode().String(),
		})
	}

	writableParent := canWriteDirFunc(parentDir)
	if !writableParent {
		if detail, ok := filePrivilegeSatisfiesWrite(privilegeAssessment); ok {
			return dryRunCheck(key, label, detail.status, detail.message, map[string]any{
				"path":           targetPath,
				"parentDir":      parentDir,
				"privilegeMode":  detail.mode,
				"effectiveWrite": true,
			})
		}
		return dryRunCheck(key, label, "failed", "目标文件不存在，且父目录不可写", map[string]any{
			"path":      targetPath,
			"parentDir": parentDir,
		})
	}
	return dryRunCheck(key, label, "warning", "目标文件不存在，但父目录可写，可在 install 阶段创建新文件", map[string]any{
		"path":      targetPath,
		"parentDir": parentDir,
	})
}

func evaluateCommandCheck(key string, label string, command string) map[string]any {
	command = strings.TrimSpace(command)
	if command == "" {
		return dryRunCheck(key, label, "failed", "命令不能为空", nil)
	}
	executable := firstShellToken(command)
	if executable == "" {
		return dryRunCheck(key, label, "failed", "无法解析命令入口", map[string]any{"command": command})
	}
	found := resolveExecutablePath(executable)
	if found == "" {
		return dryRunCheck(key, label, "failed", "命令入口不可执行或未找到", map[string]any{
			"command":    command,
			"executable": executable,
		})
	}
	return dryRunCheck(key, label, "passed", "命令入口存在，可进入后续真实执行阶段", map[string]any{
		"command":    command,
		"executable": executable,
		"resolved":   found,
	})
}

func evaluateVerifyEndpointCheck(policy linuxNginxExecutionPolicy) map[string]any {
	verifyHost := strings.TrimSpace(policy.VerifyHost)
	verifyURL := strings.TrimSpace(policy.VerifyURL)
	if verifyHost == "" && verifyURL == "" {
		return dryRunCheck("verify_endpoint_resolved", "验证端点可推导", "failed", "verifyHost/verifyUrl 至少需要一个", nil)
	}
	if verifyHost != "" && policy.VerifyPort <= 0 {
		return dryRunCheck("verify_endpoint_resolved", "验证端点可推导", "failed", "verifyHost 存在但 verifyPort 非法", map[string]any{
			"verifyHost": verifyHost,
			"verifyPort": policy.VerifyPort,
		})
	}
	return dryRunCheck("verify_endpoint_resolved", "验证端点可推导", "passed", "已推导 TLS 验证目标", map[string]any{
		"verifyHost": verifyHost,
		"verifyPort": policy.VerifyPort,
		"verifyUrl":  verifyURL,
		"hostHeader": strings.TrimSpace(policy.HostHeader),
	})
}

func evaluateSourceFileStateCheck(state linuxNginxTargetFileState) map[string]any {
	if strings.TrimSpace(state.path) == "" {
		return dryRunCheck("binding_source_file_state", "配置来源文件状态", "warning", "payload 未提供 sourceFile，dry-run 无法确认绑定来源配置文件是否可读", nil)
	}
	if !state.exists {
		return dryRunCheck("binding_source_file_state", "配置来源文件状态", "warning", "sourceFile 不存在或当前用户不可见", map[string]any{
			"path": state.path,
		})
	}
	if !state.regularFile {
		return dryRunCheck("binding_source_file_state", "配置来源文件状态", "failed", "sourceFile 不是常规文件", map[string]any{
			"path": state.path,
			"mode": state.mode,
		})
	}
	if !state.readable {
		return dryRunCheck("binding_source_file_state", "配置来源文件状态", "warning", "sourceFile 存在，但当前用户没有读取权限", map[string]any{
			"path": state.path,
			"mode": state.mode,
		})
	}
	return dryRunCheck("binding_source_file_state", "配置来源文件状态", "passed", "sourceFile 存在且可读", map[string]any{
		"path": state.path,
		"mode": state.mode,
	})
}

func evaluateTargetFileStateCheck(key string, label string, state linuxNginxTargetFileState) map[string]any {
	if !state.exists {
		return dryRunCheck(key, label, "warning", "目标文件当前不存在", map[string]any{
			"path":      state.path,
			"parentDir": state.parentDir,
		})
	}
	if !state.regularFile {
		return dryRunCheck(key, label, "failed", "目标路径存在，但不是常规文件", map[string]any{
			"path": state.path,
			"mode": state.mode,
		})
	}
	if !state.readable {
		return dryRunCheck(key, label, "failed", "目标文件存在，但当前用户没有读取权限", map[string]any{
			"path": state.path,
			"mode": state.mode,
		})
	}
	if strings.TrimSpace(state.parseError) != "" {
		return dryRunCheck(key, label, "warning", state.parseError, map[string]any{
			"path": state.path,
			"mode": state.mode,
		})
	}
	evidence := map[string]any{
		"path":      state.path,
		"mode":      state.mode,
		"writable":  state.writable,
		"parentDir": state.parentDir,
	}
	if state.certificateSHA256 != "" {
		evidence["certificateSha256"] = state.certificateSHA256
	}
	if state.certificateSubject != "" {
		evidence["certificateSubject"] = state.certificateSubject
	}
	if state.privateKeyType != "" {
		evidence["privateKeyType"] = state.privateKeyType
	}
	return dryRunCheck(key, label, "passed", "目标文件存在且可读取当前状态", evidence)
}

func evaluateBackupPreconditionCheck(key string, label string, state linuxNginxTargetFileState, privilegeAssessment map[string]any) map[string]any {
	if strings.TrimSpace(state.path) == "" {
		return dryRunCheck(key, label, "failed", "目标路径为空，无法评估备份前置条件", nil)
	}
	if !state.parentDirWritable {
		if detail, ok := filePrivilegeSatisfiesWrite(privilegeAssessment); ok {
			return dryRunCheck(key, label, detail.status, fmt.Sprintf("%s，可通过 %s 在原目录创建备份或临时文件", strings.TrimSuffix(detail.message, "可继续执行部署"), detail.mode), map[string]any{
				"path":           state.path,
				"parentDir":      state.parentDir,
				"privilegeMode":  detail.mode,
				"effectiveWrite": true,
			})
		}
		return dryRunCheck(key, label, "failed", "父目录不可写，后续无法在原目录创建备份或临时文件", map[string]any{
			"path":      state.path,
			"parentDir": state.parentDir,
		})
	}
	if !state.exists {
		return dryRunCheck(key, label, "warning", "目标文件当前不存在，install 阶段不会有旧文件可备份", map[string]any{
			"path":      state.path,
			"parentDir": state.parentDir,
		})
	}
	return dryRunCheck(key, label, "passed", "父目录可写，具备同目录备份/原子替换前提", map[string]any{
		"path":      state.path,
		"parentDir": state.parentDir,
	})
}

func buildLinuxNginxPlannedChanges(input linuxNginxDeployInput, state linuxNginxDryRunState) []map[string]any {
	changes := make([]map[string]any, 0, 8)
	if state.certFile.exists {
		changes = append(changes, map[string]any{
			"type":       "backup_certificate_file",
			"path":       input.BindingSelector.CertPath,
			"parentDir":  state.certFile.parentDir,
			"required":   true,
			"targetSame": state.certFile.matchesTarget,
		})
	}
	if state.keyFile.exists {
		changes = append(changes, map[string]any{
			"type":       "backup_private_key_file",
			"path":       input.BindingSelector.KeyPath,
			"parentDir":  state.keyFile.parentDir,
			"required":   true,
			"targetSame": state.keyFile.matchesTarget,
		})
	}
	certChangeType := "write_certificate_file"
	if state.certFile.matchesTarget {
		certChangeType = "skip_certificate_write"
	}
	keyChangeType := "write_private_key_file"
	if state.keyFile.matchesTarget {
		keyChangeType = "skip_private_key_write"
	}
	changes = append(changes,
		map[string]any{
			"type":   certChangeType,
			"path":   input.BindingSelector.CertPath,
			"format": "pem",
		},
		map[string]any{
			"type":   keyChangeType,
			"path":   input.BindingSelector.KeyPath,
			"format": "pem",
		},
		map[string]any{
			"type":    "run_nginx_test",
			"command": input.ExecutionPolicy.TestCommand,
		},
		map[string]any{
			"type":    "reload_nginx",
			"command": input.ExecutionPolicy.ReloadCommand,
		},
	)
	return changes
}

func inspectPlainFileState(targetPath string) linuxNginxTargetFileState {
	state := linuxNginxTargetFileState{
		path:      targetPath,
		parentDir: filepath.Dir(filepath.Clean(targetPath)),
	}
	if strings.TrimSpace(targetPath) == "" || !filepath.IsAbs(targetPath) {
		return state
	}
	if parentInfo, err := os.Stat(state.parentDir); err == nil && parentInfo.IsDir() {
		state.parentDirExists = true
		state.parentDirWritable = canWriteDirFunc(state.parentDir)
	}
	info, err := os.Stat(targetPath)
	if err != nil {
		return state
	}
	state.exists = true
	state.regularFile = info.Mode().IsRegular()
	state.mode = info.Mode().String()
	state.directReadable = canReadPathFunc(targetPath)
	state.readable = state.directReadable
	state.writable = canWritePathFunc(targetPath)
	return state
}

func inspectCertificateFileState(targetPath string, targetFingerprint string, helperCommand string) linuxNginxTargetFileState {
	state := inspectPlainFileState(targetPath)
	if !state.exists || !state.regularFile || !state.readable {
		if state.exists && state.regularFile && !state.readable {
			if content, err := readFileWithHelperFunc(targetPath, helperCommand); err == nil {
				state.readable = true
				cert, parseErr := parseCertificatePEM(string(content))
				if parseErr != nil {
					state.parseError = fmt.Sprintf("证书文件不是可解析的 PEM: %v", parseErr)
					return state
				}
				sum := sha256.Sum256(cert.Raw)
				state.certificateSHA256 = strings.ToLower(hex.EncodeToString(sum[:]))
				state.certificateSubject = cert.Subject.String()
				state.matchesTarget = targetFingerprint != "" && state.certificateSHA256 == normalizeHexFingerprint(targetFingerprint)
			}
		}
		return state
	}
	content, err := os.ReadFile(targetPath)
	if err != nil {
		state.parseError = fmt.Sprintf("证书文件读取失败: %v", err)
		return state
	}
	cert, parseErr := parseCertificatePEM(string(content))
	if parseErr != nil {
		state.parseError = fmt.Sprintf("证书文件不是可解析的 PEM: %v", parseErr)
		return state
	}
	sum := sha256.Sum256(cert.Raw)
	state.certificateSHA256 = strings.ToLower(hex.EncodeToString(sum[:]))
	state.certificateSubject = cert.Subject.String()
	state.matchesTarget = targetFingerprint != "" && state.certificateSHA256 == normalizeHexFingerprint(targetFingerprint)
	return state
}

func inspectPrivateKeyFileState(targetPath string, targetSigner crypto.Signer, helperCommand string) linuxNginxTargetFileState {
	state := inspectPlainFileState(targetPath)
	if !state.exists || !state.regularFile || !state.readable {
		if state.exists && state.regularFile && !state.readable {
			if content, err := readFileWithHelperFunc(targetPath, helperCommand); err == nil {
				state.readable = true
				signer, keyType, parseErr := parsePrivateKeyPEMSigner(string(content))
				if parseErr != nil {
					state.parseError = fmt.Sprintf("私钥文件不是可解析的 PEM: %v", parseErr)
					return state
				}
				state.privateKeyType = keyType
				if targetSigner != nil {
					state.matchesTarget = publicKeysEqual(signer.Public(), targetSigner.Public())
				}
			}
		}
		return state
	}
	content, err := os.ReadFile(targetPath)
	if err != nil {
		state.parseError = fmt.Sprintf("私钥文件读取失败: %v", err)
		return state
	}
	signer, keyType, parseErr := parsePrivateKeyPEMSigner(string(content))
	if parseErr != nil {
		state.parseError = fmt.Sprintf("私钥文件不是可解析的 PEM: %v", parseErr)
		return state
	}
	state.privateKeyType = keyType
	if targetSigner != nil {
		state.matchesTarget = publicKeysEqual(signer.Public(), targetSigner.Public())
	}
	return state
}

func mapFromLinuxNginxTargetFileState(state linuxNginxTargetFileState) map[string]any {
	return map[string]any{
		"path":               state.path,
		"exists":             state.exists,
		"regularFile":        state.regularFile,
		"readable":           state.readable,
		"directReadable":     state.directReadable,
		"writable":           state.writable,
		"parentDir":          state.parentDir,
		"parentDirExists":    state.parentDirExists,
		"parentDirWritable":  state.parentDirWritable,
		"mode":               state.mode,
		"certificateSha256":  state.certificateSHA256,
		"certificateSubject": state.certificateSubject,
		"privateKeyType":     state.privateKeyType,
		"matchesTarget":      state.matchesTarget,
		"parseError":         state.parseError,
	}
}

func inspectNginxBindingPermission(binding nginxBindingDetail, testCommand string, reloadCommand string) map[string]any {
	certState := inspectPlainFileState(strings.TrimSpace(binding.CertificatePath))
	keyState := inspectPlainFileState(strings.TrimSpace(binding.CertificateKeyPath))
	isRoot := currentEUIDFunc() == 0
	sudoAvailable, sudoDetail := probeSudoNoPasswordFunc()
	privilegedMode := deriveLocalPrivilegeMode(isRoot, sudoAvailable)
	helperCommand, helperDetail, helperReady := detectLinuxNginxHelperCommand("")
	testPrivilege := inspectCommandPrivilegeSummary(testCommand, helperCommand, sudoAvailable)
	reloadPrivilege := inspectCommandPrivilegeSummary(reloadCommand, helperCommand, sudoAvailable)
	filePrivilege := evaluateNginxFilePrivilege(certState, keyState, sudoAvailable, helperReady, isRoot)
	resolvedPrivilegeMode := derivePrivilegeModeWithHelper(privilegedMode, helperReady, testPrivilege, reloadPrivilege, filePrivilege)
	return map[string]any{
		"certPath":                 mapFromLinuxNginxTargetFileState(certState),
		"keyPath":                  mapFromLinuxNginxTargetFileState(keyState),
		"sudo":                     sudoDetail,
		"helper":                   helperDetail,
		"testCommand":              testPrivilege,
		"reloadCommand":            reloadPrivilege,
		"filePrivilege":            filePrivilege,
		"privilegeMode":            resolvedPrivilegeMode,
		"helperRequired":           resolvedPrivilegeMode == "helper-required",
		"recommendedHelperCommand": helperCommand,
		"nonInteractiveReady":      resolvedPrivilegeMode != "helper-required",
	}
}

func detectLinuxNginxHelperCommand(configuredCommand string) (string, map[string]any, bool) {
	helperPath := strings.TrimSpace(configuredCommand)
	if helperPath == "" {
		helperPath = strings.TrimSpace(os.Getenv("GCAC_NGINX_HELPER"))
	}
	if helperPath == "" {
		helperPath = "/usr/local/libexec/gcac-nginx-helper"
	}
	parts, splitErr := splitCommandLine(helperPath)
	if splitErr != nil || len(parts) == 0 {
		return helperPath, map[string]any{
			"command":    helperPath,
			"exists":     false,
			"executable": false,
			"ready":      false,
			"error":      firstNonEmpty(errorString(splitErr), "helper command is empty"),
		}, false
	}
	executablePath := parts[0]
	if resolved := resolveExecutablePath(parts[0]); resolved != "" {
		executablePath = resolved
	}
	info, err := os.Stat(executablePath)
	if err != nil {
		return helperPath, map[string]any{
			"command":    helperPath,
			"executable": executablePath,
			"exists":     false,
			"ready":      false,
			"error":      err.Error(),
		}, false
	}
	mode := info.Mode()
	executable := mode&0o111 != 0
	return helperPath, map[string]any{
		"command":    helperPath,
		"executable": executablePath,
		"exists":     true,
		"callable":   executable,
		"ready":      executable,
		"mode":       mode.String(),
	}, executable
}

func inspectCommandPrivilegeSummary(command string, helperCommand string, sudoAvailable bool) map[string]any {
	command = strings.TrimSpace(command)
	if command == "" {
		return map[string]any{
			"command":        command,
			"mode":           "invalid",
			"needsPrivilege": true,
			"ready":          false,
		}
	}
	selfResult, selfMode, selfErr := executeControlledCommandWithPrivilege(command, false)
	if selfErr == nil && selfResult.Success {
		return map[string]any{
			"command":        command,
			"mode":           selfMode,
			"needsPrivilege": false,
			"ready":          true,
			"exitCode":       selfResult.ExitCode,
		}
	}
	if currentEUIDFunc() == 0 {
		return map[string]any{
			"command":        command,
			"mode":           "direct",
			"needsPrivilege": false,
			"ready":          false,
			"exitCode":       selfResult.ExitCode,
			"failureCode":    classifyCommandFailure("COMMAND_FAILED", selfResult),
		}
	}
	if sudoAvailable || lookPathFunc("sudo") {
		sudoResult, sudoMode, sudoErr := executeCommandWithSudoFunc(command, false)
		if sudoErr == nil && sudoResult.Success {
			return map[string]any{
				"command":        command,
				"mode":           sudoMode,
				"needsPrivilege": true,
				"ready":          true,
				"exitCode":       sudoResult.ExitCode,
			}
		}
		return map[string]any{
			"command":        command,
			"mode":           "sudo-n",
			"needsPrivilege": true,
			"ready":          false,
			"helperCommand":  helperCommand,
			"directExitCode": selfResult.ExitCode,
			"sudoExitCode":   sudoResult.ExitCode,
			"failureCode":    classifyCommandFailure("COMMAND_FAILED", sudoResult),
		}
	}
	return map[string]any{
		"command":        command,
		"mode":           "helper-required",
		"needsPrivilege": true,
		"ready":          false,
		"helperCommand":  helperCommand,
		"directExitCode": selfResult.ExitCode,
		"failureCode":    classifyCommandFailure("COMMAND_FAILED", selfResult),
	}
}

func evaluateNginxFilePrivilege(certState linuxNginxTargetFileState, keyState linuxNginxTargetFileState, sudoAvailable bool, helperReady bool, isRoot bool) map[string]any {
	certReady := writeTargetReady(certState)
	keyReady := writeTargetReady(keyState)
	if certReady && keyReady {
		return map[string]any{
			"filePrivilegeMode":  "direct",
			"fileHelperRequired": false,
			"fileWriteReady":     true,
		}
	}
	if isRoot {
		return map[string]any{
			"filePrivilegeMode":  "root",
			"fileHelperRequired": false,
			"fileWriteReady":     rootWriteTargetReady(certState) && rootWriteTargetReady(keyState),
		}
	}
	if sudoAvailable {
		return map[string]any{
			"filePrivilegeMode":  "sudo-n",
			"fileHelperRequired": false,
			"fileWriteReady":     false,
		}
	}
	if helperReady {
		return map[string]any{
			"filePrivilegeMode":  "helper",
			"fileHelperRequired": true,
			"fileWriteReady":     false,
		}
	}
	return map[string]any{
		"filePrivilegeMode":  "blocked",
		"fileHelperRequired": true,
		"fileWriteReady":     false,
	}
}

func writeTargetReady(state linuxNginxTargetFileState) bool {
	if strings.TrimSpace(state.path) == "" {
		return false
	}
	if state.exists {
		return state.regularFile && state.writable
	}
	return state.parentDirWritable
}

func rootWriteTargetReady(state linuxNginxTargetFileState) bool {
	if strings.TrimSpace(state.path) == "" || !filepath.IsAbs(state.path) {
		return false
	}
	if state.exists {
		return state.regularFile
	}
	return state.parentDirExists
}

func evaluateLinuxNginxPrivilegeChecks(input linuxNginxDeployInput) (map[string]any, []map[string]any) {
	checks := make([]map[string]any, 0, 8)
	isRoot := currentEUIDFunc() == 0
	identity := map[string]any{
		"uid":      os.Getuid(),
		"euid":     currentEUIDFunc(),
		"gid":      os.Getgid(),
		"egid":     os.Getegid(),
		"username": firstNonEmpty(os.Getenv("USER"), os.Getenv("USERNAME")),
		"isRoot":   isRoot,
	}
	checks = append(checks, dryRunCheck("runtime_identity_detected", "运行身份探测", "passed", "已读取当前进程身份", identity))

	sudoAvailable, sudoDetail := probeSudoNoPassword()
	privilegedMode := deriveLocalPrivilegeMode(isRoot, sudoAvailable)
	if isRoot {
		sudoAvailable = false
		privilegedMode = "root"
		sudoDetail = map[string]any{
			"available":       false,
			"skipped":         true,
			"privilegedReady": true,
			"effectiveMode":   "root",
			"reason":          "current process already runs as root",
		}
	}

	helperCommand, helperDetail, helperReady := detectLinuxNginxHelperCommand(input.ExecutionPolicy.HelperCommand)
	testCheck, testPrivilege := evaluateCommandExecutionPrivilege("test_command_execution", "NGINX 测试命令权限", input.ExecutionPolicy.TestCommand, sudoAvailable)
	reloadCheck, reloadPrivilege := evaluateCommandExecutionPrivilege("reload_command_execution", "NGINX reload 命令权限", input.ExecutionPolicy.ReloadCommand, sudoAvailable)
	certState := inspectPlainFileState(strings.TrimSpace(input.BindingSelector.CertPath))
	keyState := inspectPlainFileState(strings.TrimSpace(input.BindingSelector.KeyPath))
	filePrivilege := evaluateNginxFilePrivilege(certState, keyState, sudoAvailable, helperReady, isRoot)
	resolvedPrivilegeMode := derivePrivilegeModeWithHelper(privilegedMode, helperReady, testPrivilege, reloadPrivilege, filePrivilege)
	helperRequired := resolvedPrivilegeMode == "helper-required"

	switch {
	case isRoot:
		checks = append(checks, dryRunCheck("sudo_non_interactive_available", "sudo -n 可用性", "passed", "当前进程已是 root，不需要 sudo -n", sudoDetail))
	case sudoAvailable:
		checks = append(checks, dryRunCheck("sudo_non_interactive_available", "sudo -n 可用性", "passed", "检测到当前环境支持无交互 sudo", sudoDetail))
	case commandScopedSudoReady(testPrivilege, reloadPrivilege):
		checks = append(checks, dryRunCheck("sudo_non_interactive_available", "sudo -n 可用性", "passed", "当前环境未开放通用 sudo，但已确认部署所需命令白名单可通过 sudo -n 执行", sudoDetail))
	default:
		checks = append(checks, dryRunCheck("sudo_non_interactive_available", "sudo -n 可用性", "warning", "当前环境未确认 sudo -n 可用，涉及系统写入或 reload 时可能需要 helper/提权运行", sudoDetail))
	}

	switch {
	case helperReady:
		checks = append(checks, dryRunCheck("helper_command_available", "NGINX helper 可用性", "passed", "检测到 helper 命令已就绪", helperDetail))
	case helperRequired:
		checks = append(checks, dryRunCheck("helper_command_available", "NGINX helper 可用性", "warning", "当前未检测到可用 helper 命令", helperDetail))
	default:
		checks = append(checks, dryRunCheck("helper_command_available", "NGINX helper 可用性", "passed", "当前策略未使用 helper", helperDetail))
	}

	checks = append(checks, testCheck, reloadCheck)
	checks = append(checks,
		evaluateWriteTargetCheck("cert_path_access", "证书文件写入权限", input.BindingSelector.CertPath, map[string]any{"filePrivilege": filePrivilege}),
		evaluateWriteTargetCheck("key_path_access", "私钥文件写入权限", input.BindingSelector.KeyPath, map[string]any{"filePrivilege": filePrivilege}),
	)

	return map[string]any{
		"identity":       identity,
		"sudo":           sudoDetail,
		"helper":         helperDetail,
		"helperCommand":  helperCommand,
		"certPath":       mapFromLinuxNginxTargetFileState(certState),
		"keyPath":        mapFromLinuxNginxTargetFileState(keyState),
		"filePrivilege":  filePrivilege,
		"testCommand":    testPrivilege,
		"reloadCommand":  reloadPrivilege,
		"privilegeMode":  resolvedPrivilegeMode,
		"helperRequired": helperRequired,
	}, checks
}

func deriveLocalPrivilegeMode(isRoot bool, sudoAvailable bool) string {
	if isRoot {
		return "root"
	}
	if sudoAvailable {
		return "sudo-n"
	}
	return ""
}

func derivePrivilegeModeWithHelper(privilegedMode string, helperReady bool, testPrivilege map[string]any, reloadPrivilege map[string]any, filePrivilege map[string]any) string {
	fileMode := strings.TrimSpace(stringFromMap(filePrivilege, "filePrivilegeMode"))
	testMode := strings.TrimSpace(stringFromMap(testPrivilege, "mode"))
	reloadMode := strings.TrimSpace(stringFromMap(reloadPrivilege, "mode"))
	if fileMode == "direct" && !readBoolValue(testPrivilege, "needsPrivilege") && !readBoolValue(reloadPrivilege, "needsPrivilege") {
		return "direct"
	}
	if fileMode == "root" || strings.TrimSpace(privilegedMode) == "root" {
		return "root"
	}
	if fileMode == "sudo-n" || testMode == "sudo" || reloadMode == "sudo" || strings.TrimSpace(privilegedMode) == "sudo-n" {
		return "sudo-n"
	}
	if fileMode == "helper" || testMode == "helper" || reloadMode == "helper" {
		return "helper"
	}
	if strings.TrimSpace(privilegedMode) != "" {
		return strings.TrimSpace(privilegedMode)
	}
	if helperReady {
		return "helper"
	}
	return "helper-required"
}

func evaluateCommandExecutionPrivilege(key string, label string, command string, sudoAvailable bool) (map[string]any, map[string]any) {
	command = strings.TrimSpace(command)
	if command == "" {
		return dryRunCheck(key, label, "failed", "命令不能为空", nil), map[string]any{
			"command": command,
		}
	}
	selfResult, selfMode, selfErr := executeControlledCommandWithPrivilege(command, false)
	if selfErr == nil && selfResult.Success {
		return dryRunCheck(key, label, "passed", "当前用户可直接执行命令", map[string]any{
				"command":  selfResult.Command,
				"mode":     selfMode,
				"exitCode": selfResult.ExitCode,
			}), map[string]any{
				"command":        command,
				"mode":           selfMode,
				"needsPrivilege": false,
				"ready":          true,
				"exitCode":       selfResult.ExitCode,
			}
	}
	if currentEUIDFunc() == 0 {
		failureCode := classifyCommandFailure("COMMAND_FAILED", selfResult)
		return dryRunCheck(key, label, "failed", fmt.Sprintf("当前进程已是 root，命令直连执行失败，exit=%d，failure=%s", selfResult.ExitCode, failureCode), map[string]any{
				"command":     command,
				"self":        mapFromCommandResult(selfResult, selfMode),
				"failureCode": failureCode,
			}), map[string]any{
				"command":        command,
				"mode":           selfMode,
				"needsPrivilege": false,
				"ready":          false,
				"exitCode":       selfResult.ExitCode,
				"failureCode":    failureCode,
			}
	}
	sudoPresent := lookPathFunc("sudo")
	if !sudoAvailable && !sudoPresent {
		failureCode := classifyCommandFailure("COMMAND_FAILED", selfResult)
		return dryRunCheck(key, label, "failed", fmt.Sprintf("当前用户直连执行失败，且 sudo -n 不可用，exit=%d，failure=%s", selfResult.ExitCode, failureCode), map[string]any{
				"command":     command,
				"self":        mapFromCommandResult(selfResult, selfMode),
				"failureCode": failureCode,
			}), map[string]any{
				"command":        command,
				"mode":           "helper-required",
				"needsPrivilege": true,
				"ready":          false,
				"exitCode":       selfResult.ExitCode,
				"failureCode":    failureCode,
			}
	}
	sudoResult, sudoMode, sudoErr := executeCommandWithSudoFunc(command, false)
	if sudoErr == nil && sudoResult.Success {
		return dryRunCheck(key, label, "warning", "当前用户直连执行失败，但可通过 sudo -n 成功执行", map[string]any{
				"command":          command,
				"selfExitCode":     selfResult.ExitCode,
				"sudoExitCode":     sudoResult.ExitCode,
				"sudoResolvedMode": sudoMode,
				"sudoRequired":     true,
			}), map[string]any{
				"command":        command,
				"mode":           sudoMode,
				"needsPrivilege": true,
				"ready":          true,
				"exitCode":       sudoResult.ExitCode,
			}
	}
	detail := fmt.Sprintf("当前用户与 sudo -n 都未确认可执行命令，自执行 exit=%d", selfResult.ExitCode)
	if !sudoAvailable && sudoPresent {
		detail = fmt.Sprintf("当前用户直连执行失败，sudo 存在但未通过通用探测，且针对当前命令的 sudo -n 试跑也失败，自执行 exit=%d", selfResult.ExitCode)
	}
	if sudoErr != nil || !sudoResult.Success {
		detail = fmt.Sprintf("%s，sudo exit=%d", detail, sudoResult.ExitCode)
	}
	return dryRunCheck(key, label, "failed", detail, map[string]any{
			"command": command,
			"self":    mapFromCommandResult(selfResult, selfMode),
			"sudo":    mapFromCommandResult(sudoResult, "sudo"),
		}), map[string]any{
			"command":        command,
			"mode":           "unknown",
			"needsPrivilege": true,
			"ready":          false,
			"exitCode":       maxInt(selfResult.ExitCode, sudoResult.ExitCode),
		}
}

func commandScopedSudoReady(testPrivilege map[string]any, reloadPrivilege map[string]any) bool {
	return privilegeSatisfiedWithoutHelper(testPrivilege) &&
		privilegeSatisfiedWithoutHelper(reloadPrivilege) &&
		(strings.TrimSpace(stringFromMap(testPrivilege, "mode")) == "sudo" || strings.TrimSpace(stringFromMap(reloadPrivilege, "mode")) == "sudo")
}

func privilegeSatisfiedWithoutHelper(privilege map[string]any) bool {
	if privilege == nil {
		return false
	}
	if !readBoolValue(privilege, "needsPrivilege") {
		return readBoolValue(privilege, "ready") || strings.TrimSpace(stringFromMap(privilege, "failureCode")) == ""
	}
	mode := strings.TrimSpace(stringFromMap(privilege, "mode"))
	return readBoolValue(privilege, "ready") && mode != "helper" && mode != "helper-required" && mode != "unknown"
}

type filePrivilegeResolution struct {
	mode    string
	status  string
	message string
}

func filePrivilegeSatisfiesWrite(privilegeAssessment map[string]any) (filePrivilegeResolution, bool) {
	filePrivilege, ok := privilegeAssessment["filePrivilege"].(map[string]any)
	if !ok {
		return filePrivilegeResolution{}, false
	}
	mode := strings.TrimSpace(stringFromMap(filePrivilege, "filePrivilegeMode"))
	switch mode {
	case "direct", "root":
		return filePrivilegeResolution{
			mode:    mode,
			status:  "passed",
			message: "当前执行路径具备文件写入能力",
		}, true
	case "helper":
		return filePrivilegeResolution{
			mode:    mode,
			status:  "passed",
			message: "当前用户无直写权限，但可通过 helper 完成文件写入",
		}, true
	case "sudo-n":
		if readBoolValue(filePrivilege, "fileWriteReady") {
			return filePrivilegeResolution{
				mode:    mode,
				status:  "passed",
				message: "当前执行路径具备文件写入能力",
			}, true
		}
		return filePrivilegeResolution{}, false
	default:
		return filePrivilegeResolution{}, false
	}
}

func executeControlledCommandWithPrivilege(command string, allowSudo bool) (*CommandResult, string, error) {
	result, err := executeShellCommandFunc(command, 20*time.Second)
	if err == nil {
		return result, "direct", nil
	}
	if !allowSudo {
		return result, "direct", err
	}
	sudoResult, sudoMode, sudoErr := executeCommandWithSudoFunc(command, true)
	if sudoErr == nil {
		return sudoResult, sudoMode, nil
	}
	return sudoResult, sudoMode, sudoErr
}

func executeCommandWithSudo(command string, withTimeout bool) (*CommandResult, string, error) {
	if !lookPathFunc("sudo") {
		return &CommandResult{Command: "sudo", Args: []string{"-n"}, ExitCode: 127, Success: false}, "sudo", errors.New("sudo 不存在")
	}
	timeout := 20 * time.Second
	if !withTimeout {
		timeout = 10 * time.Second
	}
	commandArgs, err := buildSudoCommandArgs(command)
	if err != nil {
		return &CommandResult{
			Command:  "sudo",
			Args:     []string{"-n"},
			ExitCode: 2,
			Success:  false,
			Stderr:   err.Error(),
		}, "sudo", err
	}
	result, err := executeCommand(commandArgs, false, timeout, false)
	return result, "sudo", err
}

func executeHelperCommand(helperCommand string, helperArgs []string, stdin []byte, timeout time.Duration) (*CommandResult, error) {
	parts, err := splitCommandLine(strings.TrimSpace(helperCommand))
	if err != nil {
		return &CommandResult{
			Command:  "sudo",
			Args:     []string{"-n"},
			ExitCode: 2,
			Success:  false,
			Stderr:   err.Error(),
		}, err
	}
	if len(parts) == 0 {
		return &CommandResult{
			Command:  "sudo",
			Args:     []string{"-n"},
			ExitCode: 2,
			Success:  false,
			Stderr:   "helper command is empty",
		}, errors.New("helper command is empty")
	}
	if resolved := resolveExecutablePath(parts[0]); resolved != "" {
		parts[0] = resolved
	}
	commandArgs := append([]string{"sudo", "-n", "--"}, parts...)
	commandArgs = append(commandArgs, helperArgs...)
	return executeCommandWithInput(commandArgs, stdin, timeout)
}

func buildSudoCommandArgs(command string) ([]string, error) {
	command = strings.TrimSpace(command)
	if command == "" {
		return nil, errors.New("sudo command is empty")
	}
	if requiresShellSyntax(command) {
		return []string{"sudo", "-n", "/bin/sh", "-lc", command}, nil
	}
	parts, err := splitCommandLine(command)
	if err != nil {
		return nil, err
	}
	if len(parts) == 0 {
		return nil, errors.New("sudo command is empty")
	}
	if resolved := resolveExecutablePath(parts[0]); resolved != "" {
		parts[0] = resolved
	}
	return append([]string{"sudo", "-n", "--"}, parts...), nil
}

func splitCommandLine(command string) ([]string, error) {
	trimmed := strings.TrimSpace(command)
	if trimmed == "" {
		return nil, errors.New("command is empty")
	}
	args := make([]string, 0, 4)
	var current strings.Builder
	quote := rune(0)
	escaped := false
	flush := func() {
		if current.Len() == 0 {
			return
		}
		args = append(args, current.String())
		current.Reset()
	}
	for _, ch := range trimmed {
		if escaped {
			current.WriteRune(ch)
			escaped = false
			continue
		}
		switch quote {
		case '\'':
			if ch == '\'' {
				quote = 0
				continue
			}
			current.WriteRune(ch)
		case '"':
			if ch == '"' {
				quote = 0
				continue
			}
			if ch == '\\' {
				escaped = true
				continue
			}
			current.WriteRune(ch)
		default:
			switch {
			case unicode.IsSpace(ch):
				flush()
			case ch == '\'' || ch == '"':
				quote = ch
			case ch == '\\':
				escaped = true
			default:
				current.WriteRune(ch)
			}
		}
	}
	if escaped {
		return nil, errors.New("unterminated escape in command")
	}
	if quote != 0 {
		return nil, errors.New("unterminated quote in command")
	}
	flush()
	if len(args) == 0 {
		return nil, errors.New("command is empty")
	}
	return args, nil
}

func requiresShellSyntax(command string) bool {
	quote := rune(0)
	escaped := false
	for _, ch := range command {
		if escaped {
			escaped = false
			continue
		}
		switch quote {
		case '\'':
			if ch == '\'' {
				quote = 0
			}
			continue
		case '"':
			if ch == '"' {
				quote = 0
				continue
			}
			if ch == '\\' {
				escaped = true
			}
			continue
		}
		switch ch {
		case '\'', '"':
			quote = ch
		case '\\':
			escaped = true
		case '|', '&', ';', '<', '>', '$', '`', '(', ')', '{', '}', '\n', '\r':
			return true
		}
	}
	return false
}

func executeShellCommand(command string, timeout time.Duration) (*CommandResult, error) {
	startedAt := time.Now()
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	shellCommand := "/bin/sh"
	shellArgs := []string{"-lc", command}
	if runtime.GOOS == "windows" {
		shellCommand = "cmd.exe"
		shellArgs = []string{"/c", command}
	}
	cmd := exec.CommandContext(ctx, shellCommand, shellArgs...)
	result := &CommandResult{
		Command: shellCommand,
		Args:    shellArgs,
	}
	stdout, stderr, exitCode, err := runProcess(cmd)
	result.Stdout = stdout
	result.Stderr = stderr
	result.ExitCode = exitCode
	result.Success = err == nil
	result.DurationMs = time.Since(startedAt).Milliseconds()
	if err != nil {
		return result, err
	}
	return result, nil
}

func probeSudoNoPassword() (bool, map[string]any) {
	if currentEUIDFunc() == 0 {
		return false, map[string]any{
			"available": false,
			"skipped":   true,
			"reason":    "current process already runs as root",
		}
	}
	if !lookPath("sudo") {
		return false, map[string]any{
			"available": false,
			"reason":    "sudo not found",
		}
	}
	result, err := executeCommand([]string{"sudo", "-n", "true"}, false, 5*time.Second, false)
	return err == nil && result.Success, map[string]any{
		"available": err == nil && result.Success,
		"command":   "sudo -n true",
		"exitCode":  result.ExitCode,
		"stdout":    result.Stdout,
		"stderr":    result.Stderr,
	}
}

func derivePrivilegeMode(sudoAvailable bool, testPrivilege map[string]any, reloadPrivilege map[string]any) string {
	if !readBoolValue(testPrivilege, "needsPrivilege") && !readBoolValue(reloadPrivilege, "needsPrivilege") {
		return "direct"
	}
	if sudoAvailable {
		return "sudo-n"
	}
	return "helper-required"
}

func readBoolValue(record map[string]any, key string) bool {
	value, ok := record[key]
	if !ok {
		return false
	}
	typed, ok := value.(bool)
	return ok && typed
}

func createLinuxNginxBackupManifest(taskID string, input linuxNginxDeployInput) (*linuxNginxBackupManifest, map[string]any, error) {
	privilegeAssessment, _ := evaluateLinuxNginxPrivilegeChecks(input)
	baseDir, err := resolveLinuxNginxBackupBaseDir()
	if err != nil {
		return nil, map[string]any{
			"executor": "linux-nginx-provider",
			"taskId":   taskID,
		}, err
	}
	runID := firstNonEmpty(strings.TrimSpace(input.ExecutionRunID), taskID)
	targetDir := filepath.Join(baseDir, sanitizePathSegment(runID), sanitizePathSegment(firstNonEmpty(input.BindingSelector.BindingID, "binding")))
	if err := os.MkdirAll(targetDir, 0o700); err != nil {
		return nil, map[string]any{
			"executor": "linux-nginx-provider",
			"taskId":   taskID,
			"baseDir":  baseDir,
		}, err
	}
	manifest := &linuxNginxBackupManifest{
		TaskID:                  taskID,
		ExecutionRunID:          input.ExecutionRunID,
		SourceRunID:             input.SourceRunID,
		BindingID:               input.BindingSelector.BindingID,
		SiteAssetID:             input.BindingSelector.SiteAssetID,
		CreatedAt:               time.Now().Format(time.RFC3339),
		TargetCertificateSHA256: normalizeHexFingerprint(input.Artifact.TargetFingerprintSHA256),
		CertPath:                input.BindingSelector.CertPath,
		KeyPath:                 input.BindingSelector.KeyPath,
		PrivilegeAssessment:     privilegeAssessment,
	}
	certRef, err := backupTargetFile(targetDir, input.BindingSelector.CertPath, "cert", input.ExecutionPolicy.HelperCommand)
	if err != nil {
		return nil, map[string]any{
			"executor": "linux-nginx-provider",
			"taskId":   taskID,
			"target":   input.BindingSelector.CertPath,
		}, err
	}
	keyRef, err := backupTargetFile(targetDir, input.BindingSelector.KeyPath, "key", input.ExecutionPolicy.HelperCommand)
	if err != nil {
		return nil, map[string]any{
			"executor": "linux-nginx-provider",
			"taskId":   taskID,
			"target":   input.BindingSelector.KeyPath,
		}, err
	}
	manifest.CertBackup = certRef
	manifest.KeyBackup = keyRef
	manifest.CertificateSHA256 = firstNonEmpty(certRef.CertificateFingerprintSHA256, manifest.TargetCertificateSHA256)
	manifestPath := filepath.Join(targetDir, "backup-manifest.json")
	if err := writeJSONFileAtomic(manifestPath, manifest); err != nil {
		return nil, map[string]any{
			"executor":           "linux-nginx-provider",
			"taskId":             taskID,
			"backupManifestPath": manifestPath,
		}, err
	}
	return manifest, map[string]any{
		"backupManifestPath":  manifestPath,
		"privilegeAssessment": privilegeAssessment,
	}, nil
}

func backupTargetFile(targetDir string, targetPath string, prefix string, helperCommand string) (linuxNginxBackupFileRef, error) {
	ref := linuxNginxBackupFileRef{
		TargetPath: targetPath,
	}
	info, err := os.Stat(targetPath)
	if err != nil {
		existsWithHelper, helperErr := pathExistsWithHelperFunc(targetPath, helperCommand)
		if helperErr == nil && existsWithHelper {
			ref.Existed = true
			ref.UsedPrivilege = "helper"
			content, readErr := readFileWithHelperFunc(targetPath, helperCommand)
			if readErr != nil {
				return ref, readErr
			}
			sum := sha256.Sum256(content)
			ref.ContentSHA256 = strings.ToLower(hex.EncodeToString(sum[:]))
			backupPath := filepath.Join(targetDir, fmt.Sprintf("%s-%d.bak", prefix, time.Now().UnixNano()))
			if writeErr := os.WriteFile(backupPath, content, 0o600); writeErr != nil {
				return ref, writeErr
			}
			ref.BackupPath = backupPath
			populateBackupCertificateFingerprint(&ref, prefix, content)
			return ref, nil
		}
		if errors.Is(err, os.ErrNotExist) {
			existsWithSudo, sudoErr := pathExistsWithSudoFunc(targetPath)
			if sudoErr != nil || !existsWithSudo {
				return ref, nil
			}
		} else {
			existsWithSudo, sudoErr := pathExistsWithSudoFunc(targetPath)
			if sudoErr != nil || !existsWithSudo {
				return ref, err
			}
		}
		ref.Existed = true
		ref.UsedPrivilege = "sudo"
		content, readErr := readFileWithSudoFunc(targetPath)
		if readErr != nil {
			return ref, readErr
		}
		sum := sha256.Sum256(content)
		ref.ContentSHA256 = strings.ToLower(hex.EncodeToString(sum[:]))
		backupPath := filepath.Join(targetDir, fmt.Sprintf("%s-%d.bak", prefix, time.Now().UnixNano()))
		if writeErr := os.WriteFile(backupPath, content, 0o600); writeErr != nil {
			return ref, writeErr
		}
		ref.BackupPath = backupPath
		populateBackupCertificateFingerprint(&ref, prefix, content)
		return ref, nil
	}
	ref.Existed = true
	ref.Mode = info.Mode().String()
	content, err := os.ReadFile(targetPath)
	if err != nil {
		if helperContent, helperErr := readFileWithHelperFunc(targetPath, helperCommand); helperErr == nil {
			ref.UsedPrivilege = "helper"
			content = helperContent
		} else {
			return ref, err
		}
	}
	sum := sha256.Sum256(content)
	ref.ContentSHA256 = strings.ToLower(hex.EncodeToString(sum[:]))
	backupPath := filepath.Join(targetDir, fmt.Sprintf("%s-%d.bak", prefix, time.Now().UnixNano()))
	if err := os.WriteFile(backupPath, content, 0o600); err != nil {
		return ref, err
	}
	ref.BackupPath = backupPath
	populateBackupCertificateFingerprint(&ref, prefix, content)
	return ref, nil
}

func populateBackupCertificateFingerprint(ref *linuxNginxBackupFileRef, prefix string, content []byte) {
	if ref == nil || prefix != "cert" {
		return
	}
	certificate, err := parseCertificatePEM(string(content))
	if err != nil {
		return
	}
	sum := sha256.Sum256(certificate.Raw)
	ref.CertificateFingerprintSHA256 = strings.ToLower(hex.EncodeToString(sum[:]))
}

func resolveLinuxNginxBackupBaseDir() (string, error) {
	baseDir := filepath.Join(os.TempDir(), "gcac-linux-nginx")
	if err := os.MkdirAll(baseDir, 0o700); err != nil {
		return "", err
	}
	return baseDir, nil
}

func writeJSONFileAtomic(targetPath string, value any) error {
	bytes, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	return atomicWritePEMFileFunc(targetPath, bytes)
}

func atomicWritePEMFile(targetPath string, content []byte) error {
	targetPath = filepath.Clean(strings.TrimSpace(targetPath))
	if targetPath == "" {
		return errors.New("目标路径为空")
	}
	parentDir := filepath.Dir(targetPath)
	if err := os.MkdirAll(parentDir, 0o755); err != nil {
		return err
	}
	tempFile, err := os.CreateTemp(parentDir, ".gcac-tmp-*")
	if err != nil {
		return err
	}
	tempPath := tempFile.Name()
	defer func() {
		_ = tempFile.Close()
		_ = os.Remove(tempPath)
	}()
	if _, err := tempFile.Write(content); err != nil {
		return err
	}
	mode := os.FileMode(0o600)
	if strings.HasSuffix(strings.ToLower(targetPath), ".crt") || strings.HasSuffix(strings.ToLower(targetPath), ".pem") {
		mode = 0o644
	}
	if err := tempFile.Chmod(mode); err != nil {
		return err
	}
	if err := tempFile.Sync(); err != nil {
		return err
	}
	if err := tempFile.Close(); err != nil {
		return err
	}
	return os.Rename(tempPath, targetPath)
}

func atomicWritePEMFileWithPrivilege(targetPath string, content []byte, input linuxNginxDeployInput) (string, error) {
	if err := atomicWritePEMFileFunc(targetPath, content); err == nil {
		return "direct", nil
	}
	if mode, err := writeFileWithHelper(targetPath, content, input.ExecutionPolicy.HelperCommand); err == nil {
		return mode, nil
	}
	if mode, err := writeFileWithSudo(targetPath, content); err == nil {
		return mode, nil
	} else {
		return mode, err
	}
}

func restoreBackupFileWithPrivilege(ref linuxNginxBackupFileRef, input linuxNginxDeployInput) (string, error) {
	if strings.TrimSpace(ref.TargetPath) == "" {
		return "", errors.New("targetPath is empty")
	}
	if !ref.Existed {
		if fileExists(ref.TargetPath) {
			if err := os.Remove(ref.TargetPath); err == nil {
				return "direct", nil
			}
			if mode, err := removeFileWithHelper(ref.TargetPath, input.ExecutionPolicy.HelperCommand); err == nil {
				return mode, nil
			}
			return removeFileWithSudoFunc(ref.TargetPath)
		}
		existsWithSudo, _ := pathExistsWithSudoFunc(ref.TargetPath)
		if existsWithSudo {
			if mode, err := removeFileWithHelper(ref.TargetPath, input.ExecutionPolicy.HelperCommand); err == nil {
				return mode, nil
			}
			return removeFileWithSudoFunc(ref.TargetPath)
		}
		return "direct", nil
	}
	content, err := os.ReadFile(ref.BackupPath)
	if err != nil {
		return "", err
	}
	return atomicWritePEMFileWithPrivilege(ref.TargetPath, content, input)
}

func writeFileWithSudo(targetPath string, content []byte) (string, error) {
	targetPath = filepath.Clean(strings.TrimSpace(targetPath))
	if targetPath == "" {
		return "sudo", errors.New("target path is empty")
	}
	parentDir := filepath.Dir(targetPath)
	mode := "600"
	lowerTargetPath := strings.ToLower(targetPath)
	if strings.HasSuffix(lowerTargetPath, ".crt") || strings.HasSuffix(lowerTargetPath, ".pem") {
		mode = "644"
	}
	encoded := base64.StdEncoding.EncodeToString(content)
	command := fmt.Sprintf("install -d -m 755 %q && tmp=$(mktemp %q) && trap 'rm -f \"$tmp\"' EXIT && printf '%%s' %q | base64 -d > \"$tmp\" && chmod %s \"$tmp\" && mv \"$tmp\" %q", parentDir, filepath.Join(parentDir, ".gcac-tmp-XXXXXX"), encoded, mode, targetPath)
	result, usedMode, err := executeCommandWithSudoFunc(command, true)
	if err != nil {
		return usedMode, fmt.Errorf("sudo write failed (exit=%d): %s", result.ExitCode, firstNonEmpty(strings.TrimSpace(result.Stderr), strings.TrimSpace(result.Stdout), err.Error()))
	}
	return usedMode, nil
}

func readFileWithSudo(targetPath string) ([]byte, error) {
	command := fmt.Sprintf("cat %q", filepath.Clean(strings.TrimSpace(targetPath)))
	result, _, err := executeCommandWithSudoFunc(command, true)
	if err != nil {
		return nil, fmt.Errorf("sudo read failed (exit=%d): %s", result.ExitCode, firstNonEmpty(strings.TrimSpace(result.Stderr), strings.TrimSpace(result.Stdout), err.Error()))
	}
	return []byte(result.Stdout), nil
}

func removeFileWithSudo(targetPath string) (string, error) {
	command := fmt.Sprintf("rm -f %q", filepath.Clean(strings.TrimSpace(targetPath)))
	result, usedMode, err := executeCommandWithSudoFunc(command, true)
	if err != nil {
		return usedMode, fmt.Errorf("sudo remove failed (exit=%d): %s", result.ExitCode, firstNonEmpty(strings.TrimSpace(result.Stderr), strings.TrimSpace(result.Stdout), err.Error()))
	}
	return usedMode, nil
}
func pathExistsWithSudo(targetPath string) (bool, error) {
	command := fmt.Sprintf("test -e %q", filepath.Clean(strings.TrimSpace(targetPath)))
	result, _, err := executeCommandWithSudoFunc(command, false)
	if err == nil && result.Success {
		return true, nil
	}
	if result != nil && result.ExitCode == 1 {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return false, nil
}

func writeFileWithHelper(targetPath string, content []byte, helperCommand string) (string, error) {
	helperCommand = strings.TrimSpace(helperCommand)
	if helperCommand == "" {
		return "helper", errors.New("helper command not configured")
	}
	mode := "600"
	lowerTargetPath := strings.ToLower(filepath.Clean(strings.TrimSpace(targetPath)))
	if strings.HasSuffix(lowerTargetPath, ".crt") || strings.HasSuffix(lowerTargetPath, ".pem") {
		mode = "644"
	}
	result, err := executeHelperCommandFunc(helperCommand, []string{"write-file", filepath.Clean(strings.TrimSpace(targetPath)), mode}, content, 20*time.Second)
	if err != nil {
		return "helper", fmt.Errorf("helper write failed (exit=%d): %s", commandExitCode(result), firstNonEmpty(commandStderr(result), commandStdout(result), err.Error()))
	}
	return "helper", nil
}

func readFileWithHelper(targetPath string, helperCommand string) ([]byte, error) {
	helperCommand = strings.TrimSpace(helperCommand)
	if helperCommand == "" {
		return nil, errors.New("helper command not configured")
	}
	result, err := executeHelperCommandFunc(helperCommand, []string{"read-file", filepath.Clean(strings.TrimSpace(targetPath))}, nil, 20*time.Second)
	if err != nil {
		return nil, fmt.Errorf("helper read failed (exit=%d): %s", commandExitCode(result), firstNonEmpty(commandStderr(result), commandStdout(result), err.Error()))
	}
	return []byte(result.Stdout), nil
}

func removeFileWithHelper(targetPath string, helperCommand string) (string, error) {
	helperCommand = strings.TrimSpace(helperCommand)
	if helperCommand == "" {
		return "helper", errors.New("helper command not configured")
	}
	result, err := executeHelperCommandFunc(helperCommand, []string{"remove-file", filepath.Clean(strings.TrimSpace(targetPath))}, nil, 20*time.Second)
	if err != nil {
		return "helper", fmt.Errorf("helper remove failed (exit=%d): %s", commandExitCode(result), firstNonEmpty(commandStderr(result), commandStdout(result), err.Error()))
	}
	return "helper", nil
}

func pathExistsWithHelper(targetPath string, helperCommand string) (bool, error) {
	helperCommand = strings.TrimSpace(helperCommand)
	if helperCommand == "" {
		return false, errors.New("helper command not configured")
	}
	result, err := executeHelperCommandFunc(helperCommand, []string{"exists", filepath.Clean(strings.TrimSpace(targetPath))}, nil, 10*time.Second)
	if err == nil && result.Success {
		return true, nil
	}
	if result != nil && result.ExitCode == 1 {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return false, nil
}

func mergeLinuxNginxPrivilegeMode(left string, right string) string {
	left = strings.TrimSpace(left)
	right = strings.TrimSpace(right)
	if left == "" {
		return right
	}
	if right == "" || right == left {
		return left
	}
	if left == "helper" || right == "helper" {
		return "helper"
	}
	if left == "sudo" || right == "sudo" {
		return "sudo"
	}
	return left + "+" + right
}

func rollbackAfterInstallFailure(taskID string, input linuxNginxDeployInput, manifest *linuxNginxBackupManifest, code string, message string, baseDetail map[string]any) (bool, string, string, map[string]any) {
	rollbackSuccess, rollbackCode, rollbackMessage, rollbackDetail := runLinuxNginxRollback(taskID, linuxNginxDeployInput{
		Operation:       "rollback",
		ProviderType:    input.ProviderType,
		BindingSelector: input.BindingSelector,
		Artifact:        input.Artifact,
		ExecutionPolicy: input.ExecutionPolicy,
		ExecutionRunID:  input.ExecutionRunID,
		SourceRunID:     firstNonEmpty(input.SourceRunID, input.ExecutionRunID),
		RollbackContext: linuxNginxRollbackContext{
			SourceRunID:        firstNonEmpty(input.SourceRunID, input.ExecutionRunID),
			BackupManifestPath: resolveManifestPathFromManifest(manifest),
			BackupManifest:     manifestToMap(manifest),
		},
	})
	baseDetail["backupManifest"] = manifestToMap(manifest)
	baseDetail["backupManifestPath"] = resolveManifestPathFromManifest(manifest)
	baseDetail["rollback"] = rollbackDetail
	baseDetail["rolledBack"] = rollbackSuccess
	if rollbackSuccess {
		return false, code, message, baseDetail
	}
	return false, rollbackCode, fmt.Sprintf("%s；自动回滚也失败: %s", message, rollbackMessage), baseDetail
}

func resolveRollbackManifest(input linuxNginxDeployInput) (*linuxNginxBackupManifest, string, error) {
	if strings.TrimSpace(input.RollbackContext.BackupManifestPath) != "" {
		manifest, err := loadLinuxNginxBackupManifest(input.RollbackContext.BackupManifestPath)
		return manifest, input.RollbackContext.BackupManifestPath, err
	}
	if len(input.RollbackContext.BackupManifest) > 0 {
		raw, err := json.Marshal(input.RollbackContext.BackupManifest)
		if err != nil {
			return nil, "", err
		}
		var manifest linuxNginxBackupManifest
		if err := json.Unmarshal(raw, &manifest); err != nil {
			return nil, "", err
		}
		return &manifest, "", nil
	}
	return nil, "", errors.New("rollbackContext 缺少 backupManifestPath/backupManifest")
}

func resolveRollbackCertificateSHA256(manifest *linuxNginxBackupManifest, input linuxNginxDeployInput) string {
	if manifest != nil {
		if value := normalizeHexFingerprint(manifest.CertBackup.CertificateFingerprintSHA256); value != "" {
			return value
		}
		if value := normalizeHexFingerprint(manifest.CertificateSHA256); value != "" {
			return value
		}
	}
	if value := normalizeHexFingerprint(input.RollbackContext.RollbackCertificateSHA); value != "" {
		return value
	}
	return normalizeHexFingerprint(input.Artifact.TargetFingerprintSHA256)
}

func loadLinuxNginxBackupManifest(path string) (*linuxNginxBackupManifest, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var manifest linuxNginxBackupManifest
	if err := json.Unmarshal(bytes, &manifest); err != nil {
		return nil, err
	}
	return &manifest, nil
}

func restoreBackupFile(ref linuxNginxBackupFileRef) error {
	if strings.TrimSpace(ref.TargetPath) == "" {
		return errors.New("targetPath 为空")
	}
	if !ref.Existed {
		if fileExists(ref.TargetPath) {
			return os.Remove(ref.TargetPath)
		}
		return nil
	}
	content, err := os.ReadFile(ref.BackupPath)
	if err != nil {
		return err
	}
	return atomicWritePEMFile(ref.TargetPath, content)
}

func manifestToMap(manifest *linuxNginxBackupManifest) map[string]any {
	if manifest == nil {
		return nil
	}
	raw, _ := json.Marshal(manifest)
	decoded := map[string]any{}
	_ = json.Unmarshal(raw, &decoded)
	return decoded
}

func resolveManifestPathFromManifest(manifest *linuxNginxBackupManifest) string {
	if manifest == nil {
		return ""
	}
	baseDir, err := resolveLinuxNginxBackupBaseDir()
	if err != nil {
		return ""
	}
	runID := sanitizePathSegment(firstNonEmpty(manifest.ExecutionRunID, manifest.TaskID))
	bindingID := sanitizePathSegment(firstNonEmpty(manifest.BindingID, "binding"))
	return filepath.Join(baseDir, runID, bindingID, "backup-manifest.json")
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
	if channel == "probe.http" {
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
	target := mapFromMap(gatewayTask, "target")
	host := firstNonEmpty(stringFromMap(gatewayPayload, "host"), stringFromMap(gatewayPayload, "verifyHost"), stringFromMap(target, "host"))
	port := intFromMap(gatewayPayload, "port")
	if port == 0 {
		port = intFromMap(gatewayPayload, "verifyPort")
	}
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

func runCapabilityRescan(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState, _ *runtimeCounters, rescan *rescanState, trigger string, payload map[string]any) (map[string]any, error) {
	if rescan != nil && rescan.Running {
		return map[string]any{
			"trigger": trigger,
			"skipped": true,
		}, errors.New("能力重扫正在执行中")
	}
	if rescan != nil {
		rescan.Running = true
		defer func() { rescan.Running = false }()
	}

	startedAt := time.Now().Format(time.RFC3339)
	capabilities := collectCapabilityReports()
	request := capabilityReportRequest{
		AgentID:            state.AgentID,
		CompatibilityLevel: "L1",
		Capabilities:       capabilities,
	}
	if err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/capabilities", request, nil); err != nil {
		_ = submitRuntimeLog(ctx, client, config, submitRuntimeLogRequest{
			AgentID:   state.AgentID,
			Category:  runtimeLogCategoryForTrigger(trigger),
			Level:     "error",
			Summary:   runtimeLogSummaryForTrigger(trigger, false),
			Detail:    map[string]any{"error": err.Error(), "requestedBy": readRequestedBy(payload)},
			EmittedAt: time.Now().Format(time.RFC3339),
		})
		return map[string]any{
			"trigger":         trigger,
			"startedAt":       startedAt,
			"finishedAt":      time.Now().Format(time.RFC3339),
			"capabilityCount": len(capabilities),
			"requestedBy":     readRequestedBy(payload),
		}, err
	}
	_ = submitRuntimeLog(ctx, client, config, submitRuntimeLogRequest{
		AgentID:   state.AgentID,
		Category:  runtimeLogCategoryForTrigger(trigger),
		Level:     "info",
		Summary:   runtimeLogSummaryForTrigger(trigger, true),
		Detail:    map[string]any{"requestedBy": readRequestedBy(payload), "capabilityCount": len(capabilities)},
		EmittedAt: time.Now().Format(time.RFC3339),
	})
	return map[string]any{
		"trigger":         trigger,
		"startedAt":       startedAt,
		"finishedAt":      time.Now().Format(time.RFC3339),
		"capabilityCount": len(capabilities),
		"requestedBy":     readRequestedBy(payload),
	}, nil
}

func ackTask(ctx context.Context, client *http.Client, config *AgentConfig, agentID string, taskID string, leaseID string) (*agentTaskEnvelope, error) {
	var response agentTaskEnvelope
	if err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/tasks/ack", ackTaskRequest{
		AgentID: agentID,
		TaskID:  taskID,
		LeaseID: leaseID,
	}, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

func submitTaskResult(ctx context.Context, client *http.Client, config *AgentConfig, request submitResultRequest) (*agentTaskEnvelope, error) {
	var response agentTaskEnvelope
	if err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/tasks/result", request, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

func submitRuntimeLog(ctx context.Context, client *http.Client, config *AgentConfig, request submitRuntimeLogRequest) error {
	return doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/runtime-logs", request, nil)
}

func newLeaseID(taskID string) string {
	return fmt.Sprintf("lease_%s_%d", strings.ReplaceAll(taskID, "-", "_"), time.Now().UnixNano())
}

func rescanTickerChannel(ticker *time.Ticker) <-chan time.Time {
	if ticker == nil {
		return nil
	}
	return ticker.C
}

func readRequestedBy(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	value, _ := payload["requestedBy"].(string)
	return value
}

func runtimeLogCategoryForTrigger(trigger string) string {
	if trigger == "manual" {
		return "manual_rescan"
	}
	return "capability_report"
}

func runtimeLogSummaryForTrigger(trigger string, success bool) string {
	if trigger == "manual" {
		if success {
			return "manual capability rescan succeeded"
		}
		return "manual capability rescan failed"
	}
	if success {
		return "scheduled capability report succeeded"
	}
	return "scheduled capability report failed"
}

func collectCapabilityReports() []reportedCapability {
	capabilities := make([]reportedCapability, 0, 3)
	if detail := detectNginxDetail(); detail != nil && detail.Installed {
		capabilities = append(capabilities, reportedCapability{
			CapabilityKey: "linux.nginx.detail",
			Value:         detail,
			Confidence:    0.92,
			Evidence: map[string]any{
				"source": "runtime-inspection",
			},
		})
	}
	if detail := detectApacheDetail(); detail != nil && detail.Installed {
		capabilities = append(capabilities, reportedCapability{
			CapabilityKey: "linux.apache.detail",
			Value:         detail,
			Confidence:    0.9,
			Evidence: map[string]any{
				"source": "runtime-inspection",
			},
		})
	}
	if detail := detectTomcatDetail(); detail != nil && detail.Installed {
		capabilities = append(capabilities, reportedCapability{
			CapabilityKey: "linux.tomcat.detail",
			Value:         detail,
			Confidence:    0.88,
			Evidence: map[string]any{
				"source": "runtime-inspection",
			},
		})
	}
	return capabilities
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

func detectNginxDetail() *nginxDetail {
	binaryPath := findNginxBinaryPath()
	running := processRunning("nginx")
	if binaryPath == "" && !running {
		return nil
	}

	detail := &nginxDetail{
		Installed:  binaryPath != "",
		Running:    running,
		BinaryPath: binaryPath,
		Service:    "nginx",
	}
	if binaryPath == "" {
		return detail
	}

	versionOutput, _ := captureCombinedCommand(binaryPath, "-V")
	detail.Version = parseNginxVersion(versionOutput)
	detail.ConfigPath = parseNginxBuildArgument(versionOutput, "--conf-path")
	detail.Prefix = parseNginxBuildArgument(versionOutput, "--prefix")

	configDump, dumpErr := captureCombinedCommand(binaryPath, "-T")
	sites := make([]nginxSiteDetail, 0)
	if strings.TrimSpace(configDump) != "" {
		sites = parseNginxConfigDump(configDump)
	}
	if len(sites) == 0 && detail.ConfigPath != "" && fileExists(detail.ConfigPath) {
		sites = parseNginxConfigTree(detail.ConfigPath, detail.Prefix)
	}
	if dumpErr != nil && len(sites) == 0 {
		return detail
	}
	for index := range sites {
		enrichNginxSiteCertificates(&sites[index], detail.BinaryPath, detail.Service)
	}
	detail.Sites = sites
	return detail
}

func findNginxBinaryPath() string {
	if path, err := exec.LookPath("nginx"); err == nil {
		return path
	}
	for _, candidate := range []string{
		"/usr/sbin/nginx",
		"/usr/bin/nginx",
		"/usr/local/sbin/nginx",
		"/usr/local/nginx/sbin/nginx",
	} {
		if fileExists(candidate) {
			return candidate
		}
	}
	return ""
}

func processRunning(name string) bool {
	output, err := captureCommand("ps", "-eo", "comm=")
	if err != nil {
		return false
	}
	for _, line := range strings.Split(output, "\n") {
		if strings.TrimSpace(line) == name {
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

func parseNginxVersion(output string) string {
	marker := "nginx version: nginx/"
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

func parseNginxBuildArgument(output string, key string) string {
	marker := key + "="
	index := strings.Index(output, marker)
	if index < 0 {
		return ""
	}
	value := output[index+len(marker):]
	if strings.HasPrefix(value, "\"") {
		value = strings.TrimPrefix(value, "\"")
		if end := strings.Index(value, "\""); end >= 0 {
			return strings.TrimSpace(value[:end])
		}
	}
	if end := strings.IndexAny(value, " \r\n\t"); end >= 0 {
		value = value[:end]
	}
	return strings.TrimSpace(value)
}

func parseNginxConfigDump(dump string) []nginxSiteDetail {
	lines := strings.Split(dump, "\n")
	sites := make([]nginxSiteDetail, 0)
	stack := make([]nginxContextFrame, 0, 8)
	currentFile := ""

	for _, rawLine := range lines {
		trimmedLine := strings.TrimSpace(rawLine)
		if strings.HasPrefix(trimmedLine, "# configuration file ") && strings.HasSuffix(trimmedLine, ":") {
			currentFile = strings.TrimSuffix(strings.TrimPrefix(trimmedLine, "# configuration file "), ":")
			continue
		}

		line := stripNginxInlineComment(rawLine)
		for {
			trimmed := strings.TrimSpace(line)
			if trimmed == "" {
				break
			}
			if strings.HasPrefix(trimmed, "}") {
				if len(stack) > 0 {
					stack = stack[:len(stack)-1]
				}
				line = strings.TrimSpace(strings.TrimPrefix(trimmed, "}"))
				continue
			}
			if openIndex := strings.Index(trimmed, "{"); openIndex >= 0 && (strings.Index(trimmed, ";") == -1 || openIndex < strings.Index(trimmed, ";")) {
				statement := strings.TrimSpace(trimmed[:openIndex])
				kind := firstToken(statement)
				siteIndex := activeSiteIndex(stack)
				if kind == "server" {
					sites = append(sites, nginxSiteDetail{})
					siteIndex = len(sites) - 1
					addSiteConfigFile(&sites[siteIndex], currentFile)
				}
				stack = append(stack, nginxContextFrame{kind: kind, siteIndex: siteIndex})
				line = strings.TrimSpace(trimmed[openIndex+1:])
				continue
			}
			semicolonIndex := strings.Index(trimmed, ";")
			if semicolonIndex < 0 {
				break
			}
			statement := strings.TrimSpace(trimmed[:semicolonIndex])
			siteIndex := activeSiteIndex(stack)
			if siteIndex >= 0 && siteIndex < len(sites) {
				applyNginxDirective(&sites[siteIndex], statement, currentFile)
			}
			line = strings.TrimSpace(trimmed[semicolonIndex+1:])
		}
	}

	for index := range sites {
		finalizeNginxSite(&sites[index], index)
	}

	filtered := make([]nginxSiteDetail, 0, len(sites))
	for _, site := range sites {
		if len(site.Listen) == 0 && len(site.ServerNames) == 0 && site.SitePath == "" && len(site.ProxyTargets) == 0 {
			continue
		}
		filtered = append(filtered, site)
	}
	return filtered
}

func parseNginxConfigTree(configPath string, prefix string) []nginxSiteDetail {
	files := collectNginxConfigFiles(configPath, prefix, map[string]struct{}{})
	sites := make([]nginxSiteDetail, 0)
	for _, filePath := range files {
		content, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}
		dump := fmt.Sprintf("# configuration file %s:\n%s\n", filePath, string(content))
		sites = append(sites, parseNginxConfigDump(dump)...)
	}
	return uniqueNginxSites(sites)
}

func collectNginxConfigFiles(configPath string, prefix string, visited map[string]struct{}) []string {
	resolvedPath := resolveNginxPath("", prefix, configPath)
	if resolvedPath == "" {
		return nil
	}
	if _, seen := visited[resolvedPath]; seen {
		return nil
	}
	visited[resolvedPath] = struct{}{}

	content, err := os.ReadFile(resolvedPath)
	if err != nil {
		return nil
	}

	files := []string{resolvedPath}
	baseDir := filepath.Dir(resolvedPath)
	for _, includePattern := range parseNginxIncludePatterns(string(content)) {
		for _, includePath := range resolveNginxIncludePaths(baseDir, prefix, includePattern) {
			files = append(files, collectNginxConfigFiles(includePath, prefix, visited)...)
		}
	}
	return files
}

func parseNginxIncludePatterns(content string) []string {
	patterns := make([]string, 0)
	for _, rawLine := range strings.Split(content, "\n") {
		line := stripNginxInlineComment(rawLine)
		for _, statement := range splitNginxStatements(line) {
			fields := strings.Fields(statement)
			if len(fields) >= 2 && fields[0] == "include" {
				pattern := strings.TrimSpace(strings.Trim(fields[1], "\"'"))
				if pattern != "" {
					patterns = append(patterns, pattern)
				}
			}
		}
	}
	return uniqueStrings(patterns)
}

func splitNginxStatements(line string) []string {
	statements := make([]string, 0)
	rest := line
	for {
		trimmed := strings.TrimSpace(rest)
		if trimmed == "" {
			return statements
		}
		semicolonIndex := strings.Index(trimmed, ";")
		if semicolonIndex < 0 {
			return statements
		}
		statement := strings.TrimSpace(trimmed[:semicolonIndex])
		if statement != "" {
			statements = append(statements, statement)
		}
		rest = strings.TrimSpace(trimmed[semicolonIndex+1:])
	}
}

func resolveNginxIncludePaths(baseDir string, prefix string, includePattern string) []string {
	includePattern = strings.TrimSpace(strings.Trim(includePattern, "\"'"))
	if includePattern == "" || strings.Contains(includePattern, "$") {
		return nil
	}
	candidates := make([]string, 0, 2)
	if filepath.IsAbs(includePattern) {
		candidates = append(candidates, filepath.Clean(includePattern))
	} else {
		if baseDir != "" {
			candidates = append(candidates, filepath.Clean(filepath.Join(baseDir, includePattern)))
		}
		if prefix != "" {
			candidates = append(candidates, filepath.Clean(filepath.Join(prefix, includePattern)))
		}
	}

	results := make([]string, 0)
	seen := map[string]struct{}{}
	for _, candidate := range candidates {
		matches, err := filepath.Glob(candidate)
		if err == nil && len(matches) > 0 {
			for _, match := range matches {
				if _, exists := seen[match]; exists {
					continue
				}
				seen[match] = struct{}{}
				results = append(results, match)
			}
			continue
		}
		if fileExists(candidate) {
			if _, exists := seen[candidate]; exists {
				continue
			}
			seen[candidate] = struct{}{}
			results = append(results, candidate)
		}
	}
	return results
}

func resolveNginxPath(baseDir string, prefix string, value string) string {
	value = strings.TrimSpace(strings.Trim(value, "\"'"))
	if value == "" {
		return ""
	}
	if filepath.IsAbs(value) {
		return filepath.Clean(value)
	}
	if baseDir != "" {
		return filepath.Clean(filepath.Join(baseDir, value))
	}
	if prefix != "" {
		return filepath.Clean(filepath.Join(prefix, value))
	}
	return filepath.Clean(value)
}

func uniqueNginxSites(items []nginxSiteDetail) []nginxSiteDetail {
	seen := make(map[string]struct{}, len(items))
	results := make([]nginxSiteDetail, 0, len(items))
	for _, item := range items {
		key := item.Name + "\n" + item.SitePath + "\n" + strings.Join(item.ServerNames, ",") + "\n" + strings.Join(item.ConfigFiles, ",")
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		results = append(results, item)
	}
	return results
}

func stripNginxInlineComment(line string) string {
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

func firstToken(statement string) string {
	fields := strings.Fields(statement)
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

func activeSiteIndex(stack []nginxContextFrame) int {
	for index := len(stack) - 1; index >= 0; index-- {
		if stack[index].siteIndex >= 0 {
			return stack[index].siteIndex
		}
	}
	return -1
}

func applyNginxDirective(site *nginxSiteDetail, statement string, currentFile string) {
	fields := strings.Fields(statement)
	if len(fields) == 0 {
		return
	}
	addSiteConfigFile(site, currentFile)
	directive := fields[0]
	args := fields[1:]
	switch directive {
	case "listen":
		if binding, ok := parseNginxListen(args); ok {
			site.Listen = append(site.Listen, binding)
		}
	case "server_name":
		for _, name := range args {
			if trimmed := strings.TrimSpace(name); trimmed != "" {
				site.ServerNames = append(site.ServerNames, trimmed)
			}
		}
	case "root":
		if site.SitePath == "" && len(args) > 0 {
			site.SitePath = strings.TrimSpace(args[0])
		}
	case "ssl_certificate":
		site.serverCertificatePath = strings.TrimSpace(firstArgument(args))
	case "ssl_certificate_key":
		site.serverCertificateKeyPath = strings.TrimSpace(firstArgument(args))
	case "proxy_pass":
		target := strings.TrimSpace(firstArgument(args))
		if target != "" {
			site.ProxyTargets = append(site.ProxyTargets, target)
		}
	}
}

func firstArgument(args []string) string {
	if len(args) == 0 {
		return ""
	}
	return strings.Trim(args[0], "\"'")
}

func parseNginxListen(args []string) (nginxBindingDetail, bool) {
	binding := nginxBindingDetail{Address: "*", Protocol: "http"}
	if len(args) == 0 {
		return binding, false
	}
	for _, arg := range args {
		value := strings.TrimSpace(strings.Trim(arg, "\"'"))
		if value == "" {
			continue
		}
		if value == "ssl" {
			binding.Protocol = "https"
			continue
		}
		if strings.ContainsAny(value, "[]:.") || isNumeric(value) {
			address, port := splitListenAddress(value)
			if port > 0 {
				if address != "" {
					binding.Address = address
				}
				binding.Port = port
				if port == 443 {
					binding.Protocol = "https"
				}
			}
		}
	}
	return binding, binding.Port > 0
}

func splitListenAddress(value string) (string, int) {
	if isNumeric(value) {
		return "*", atoiSafe(value)
	}
	if strings.HasPrefix(value, "unix:") {
		return "", 0
	}
	lastColon := strings.LastIndex(value, ":")
	if lastColon < 0 {
		return value, 0
	}
	address := value[:lastColon]
	address = strings.Trim(address, "[]")
	port := atoiSafe(value[lastColon+1:])
	return address, port
}

func isNumeric(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func atoiSafe(value string) int {
	result := 0
	for _, char := range value {
		if char < '0' || char > '9' {
			return 0
		}
		result = result*10 + int(char-'0')
	}
	return result
}

func addSiteConfigFile(site *nginxSiteDetail, path string) {
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

func finalizeNginxSite(site *nginxSiteDetail, index int) {
	site.ServerNames = uniqueStrings(site.ServerNames)
	site.ProxyTargets = uniqueStrings(site.ProxyTargets)
	site.ConfigFiles = uniqueStrings(site.ConfigFiles)
	applyNginxServerCertificate(site)
	if site.Name == "" {
		if len(site.ServerNames) > 0 {
			site.Name = site.ServerNames[0]
		} else {
			site.Name = fmt.Sprintf("server-%d", index+1)
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

func applyNginxServerCertificate(site *nginxSiteDetail) {
	if site.serverCertificatePath == "" && site.serverCertificateKeyPath == "" {
		return
	}
	if len(site.Listen) == 0 {
		site.Listen = append(site.Listen, nginxBindingDetail{Address: "*", Port: 443, Protocol: "https"})
	}
	for index := range site.Listen {
		if site.Listen[index].Protocol == "" {
			site.Listen[index].Protocol = "http"
		}
		if site.Listen[index].Protocol != "https" && site.Listen[index].Port != 443 && site.Listen[index].Port != 8443 {
			continue
		}
		site.Listen[index].Protocol = "https"
		if site.Listen[index].CertificatePath == "" {
			site.Listen[index].CertificatePath = site.serverCertificatePath
		}
		if site.Listen[index].CertificateKeyPath == "" {
			site.Listen[index].CertificateKeyPath = site.serverCertificateKeyPath
		}
	}
}

func enrichNginxSiteCertificates(site *nginxSiteDetail, binaryPath string, serviceName string) {
	for index := range site.Listen {
		if site.Listen[index].CertificatePath == "" && site.Listen[index].Protocol != "https" {
			continue
		}
		site.Listen[index].Certificate = readNginxLiveCertificateDetail(site.Listen[index], site.ServerNames)
		if site.Listen[index].Certificate == nil && site.Listen[index].CertificatePath != "" {
			site.Listen[index].Certificate = readCertificateDetail(site.Listen[index].CertificatePath)
		}
		if site.Listen[index].Certificate != nil {
			site.Listen[index].CertificateName = site.Listen[index].Certificate.Subject
		}
		site.Listen[index].TestCommand = defaultNginxTestCommand(binaryPath)
		site.Listen[index].ReloadCommand = defaultNginxReloadCommand(binaryPath, serviceName)
		site.Listen[index].Permission = inspectNginxBindingPermission(site.Listen[index], site.Listen[index].TestCommand, site.Listen[index].ReloadCommand)
	}
}

func defaultNginxTestCommand(binaryPath string) string {
	path := strings.TrimSpace(binaryPath)
	if path == "" {
		return "nginx -t"
	}
	return fmt.Sprintf("%s -t", path)
}

func defaultNginxReloadCommand(binaryPath string, serviceName string) string {
	trimmedService := strings.TrimSpace(serviceName)
	if trimmedService != "" && lookPath("systemctl") {
		return fmt.Sprintf("systemctl reload %s", trimmedService)
	}
	path := strings.TrimSpace(binaryPath)
	if path == "" {
		return "nginx -s reload"
	}
	return fmt.Sprintf("%s -s reload", path)
}

func readCertificateDetail(path string) *linuxCertificateDetail {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return readCertificateDetailFromPEMBytes(content, "FILE_PATH")
}

func readNginxLiveCertificateDetail(binding nginxBindingDetail, serverNames []string) *linuxCertificateDetail {
	if binding.Port <= 0 {
		return nil
	}
	if binding.Protocol != "https" && binding.Port != 443 && binding.Port != 8443 {
		return nil
	}
	address := nginxTLSProbeAddress(binding)
	if address == "" {
		return nil
	}
	for _, serverName := range nginxTLSProbeServerNames(binding, serverNames) {
		dialer := &net.Dialer{Timeout: 2 * time.Second}
		config := &tls.Config{InsecureSkipVerify: true}
		if serverName != "" {
			config.ServerName = serverName
		}
		conn, err := tls.DialWithDialer(dialer, "tcp", address, config)
		if err != nil {
			continue
		}
		state := conn.ConnectionState()
		_ = conn.Close()
		if len(state.PeerCertificates) == 0 {
			continue
		}
		return buildLinuxCertificateDetail(state.PeerCertificates[0], "TLS_CONNECT")
	}
	return nil
}

func nginxTLSProbeAddress(binding nginxBindingDetail) string {
	host := strings.TrimSpace(binding.Address)
	if host == "" || host == "*" || host == "0.0.0.0" || host == "::" || host == "[::]" || strings.EqualFold(host, "default_server") {
		host = "127.0.0.1"
	}
	host = strings.Trim(host, "[]")
	if strings.HasPrefix(host, "unix:") || strings.Contains(host, "$") {
		return ""
	}
	return net.JoinHostPort(host, fmt.Sprintf("%d", binding.Port))
}

func nginxTLSProbeServerNames(binding nginxBindingDetail, serverNames []string) []string {
	candidates := make([]string, 0, len(serverNames)+2)
	for _, name := range serverNames {
		trimmed := strings.TrimSpace(strings.Trim(name, "\"'"))
		if trimmed == "" || trimmed == "_" || strings.Contains(trimmed, "$") || strings.Contains(trimmed, "*") {
			continue
		}
		candidates = append(candidates, trimmed)
	}
	address := strings.Trim(strings.TrimSpace(binding.Address), "[]")
	if address != "" && address != "*" && address != "0.0.0.0" && address != "::" && net.ParseIP(address) == nil && !strings.Contains(address, "$") {
		candidates = append(candidates, address)
	}
	candidates = append(candidates, "")
	return uniqueStrings(candidates)
}

func readCertificateSubject(path string) string {
	detail := readCertificateDetail(path)
	if detail == nil {
		return ""
	}
	return detail.Subject
}

func readCertificateDetailFromPEMBytes(content []byte, storeName string) *linuxCertificateDetail {
	for {
		block, rest := pem.Decode(content)
		if block == nil {
			return nil
		}
		if block.Type == "CERTIFICATE" {
			certificate, err := x509.ParseCertificate(block.Bytes)
			if err == nil {
				return buildLinuxCertificateDetail(certificate, storeName)
			}
		}
		content = rest
	}
}

func buildLinuxCertificateDetail(certificate *x509.Certificate, storeName string) *linuxCertificateDetail {
	if certificate == nil {
		return nil
	}
	sum := sha1.Sum(certificate.Raw)
	thumbprint := strings.ToUpper(hex.EncodeToString(sum[:]))
	sha256Sum := sha256.Sum256(certificate.Raw)
	return &linuxCertificateDetail{
		Subject:           certificate.Subject.String(),
		Issuer:            certificate.Issuer.String(),
		NotBefore:         certificate.NotBefore.UTC().Format(time.RFC3339),
		NotAfter:          certificate.NotAfter.UTC().Format(time.RFC3339),
		Thumbprint:        thumbprint,
		FingerprintSHA256: strings.ToLower(hex.EncodeToString(sha256Sum[:])),
		StoreName:         storeName,
	}
}

func readPKCS12CertificateSubject(path string, password string) string {
	detail := readPKCS12CertificateDetail(path, password)
	if detail == nil {
		return ""
	}
	return detail.Subject
}

func readPKCS12CertificateDetail(path string, password string) *linuxCertificateDetail {
	if !fileExists(path) || !lookPath("openssl") {
		return nil
	}
	args := []string{"pkcs12", "-in", path, "-clcerts", "-nokeys", "-passin", "pass:" + password}
	output, err := captureCombinedCommand("openssl", args...)
	if err != nil {
		return nil
	}
	return readCertificateDetailFromPEM(output, path)
}

func readCertificateSubjectFromPEM(content string) string {
	detail := readCertificateDetailFromPEM(content, "FILE_PATH")
	if detail == nil {
		return ""
	}
	return detail.Subject
}

func readCertificateDetailFromPEM(content string, storeName string) *linuxCertificateDetail {
	remaining := []byte(content)
	for {
		block, rest := pem.Decode(remaining)
		if block == nil {
			return nil
		}
		if block.Type == "CERTIFICATE" {
			certificate, err := x509.ParseCertificate(block.Bytes)
			if err == nil {
				return buildLinuxCertificateDetail(certificate, storeName)
			}
		}
		remaining = rest
	}
}

func uniqueStrings(items []string) []string {
	seen := make(map[string]struct{}, len(items))
	result := make([]string, 0, len(items))
	for _, item := range items {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
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
	baseURL := strings.TrimRight(strings.TrimSpace(config.ControlPlane), "/")
	if baseURL == "" {
		return errors.New("controlPlaneUrl 不能为空")
	}

	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("编码请求失败: %w", err)
		}
		body = bytes.NewReader(encoded)
	}

	request, err := http.NewRequestWithContext(ctx, method, baseURL+endpointPath, body)
	if err != nil {
		return fmt.Errorf("创建请求失败: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Request-Id", fmt.Sprintf("linux_agent_%d", time.Now().UnixNano()))
	if strings.TrimSpace(config.TenantID) != "" {
		request.Header.Set("X-Tenant-Id", strings.TrimSpace(config.TenantID))
	}

	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("请求服务端失败: %w", err)
	}
	defer response.Body.Close()

	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return fmt.Errorf("读取响应失败: %w", err)
	}

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var apiErr apiErrorResponse
		if err := json.Unmarshal(responseBody, &apiErr); err == nil && strings.TrimSpace(apiErr.Message) != "" {
			if strings.TrimSpace(apiErr.ErrorCode) != "" {
				return fmt.Errorf("%s (%s)", apiErr.Message, apiErr.ErrorCode)
			}
			return errors.New(apiErr.Message)
		}
		return fmt.Errorf("HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(responseBody)))
	}

	if target == nil || len(bytes.TrimSpace(responseBody)) == 0 {
		return nil
	}
	if err := json.Unmarshal(responseBody, target); err == nil {
		return nil
	}

	var wrapped struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(responseBody, &wrapped); err == nil && len(wrapped.Data) > 0 {
		if err := json.Unmarshal(wrapped.Data, target); err == nil {
			return nil
		}
	}

	return fmt.Errorf("解析响应失败: %s", strings.TrimSpace(string(responseBody)))
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
