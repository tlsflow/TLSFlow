package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"os/user"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
	"unsafe"
)

const (
	agentVersion      = "0.1.0"
	defaultConfigPath = `C:\ProgramData\GCAC\FullAgentGo\config\agent.config.json`
	defaultMetadata   = `C:\ProgramData\GCAC\FullAgentGo\service.install.json`
	defaultTaskPoll   = 60
	defaultHealthPoll = 30
	defaultOfflineTTL = 180
)

type AgentConfig struct {
	SchemaVersion              string `json:"schemaVersion"`
	TenantID                   string `json:"tenantId"`
	AgentKey                   string `json:"agentKey"`
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
	Paths                      struct {
		Windows struct {
			ConfigPath string `json:"configPath"`
			DataDir    string `json:"dataDir"`
			LogDir     string `json:"logDir"`
		} `json:"windows"`
	} `json:"paths"`
	Service struct {
		Name        string `json:"name"`
		DisplayName string `json:"displayName"`
	} `json:"service"`
}

type InstallMetadata struct {
	ServiceName string `json:"serviceName"`
	DisplayName string `json:"displayName"`
	InstallRoot string `json:"installRoot"`
	ConfigPath  string `json:"configPath"`
	DataDir     string `json:"dataDir"`
	LogDir      string `json:"logDir"`
	BinaryPath  string `json:"binaryPath"`
	InstalledAt string `json:"installedAt"`
	Mode        string `json:"mode"`
}

type RuntimeState struct {
	CollectedAt      string                 `json:"collectedAt"`
	GOOS             string                 `json:"goos"`
	GOARCH           string                 `json:"goarch"`
	Hostname         string                 `json:"hostname"`
	User             string                 `json:"user"`
	Executable       string                 `json:"executable"`
	CurrentDir       string                 `json:"currentDir"`
	MachineID        string                 `json:"machineId"`
	PrimaryIPAddress string                 `json:"primaryIpAddress,omitempty"`
	WindowsVersion   string                 `json:"windowsVersion,omitempty"`
	Environment      map[string]string      `json:"environment"`
	Interfaces       []NetworkInterfaceInfo `json:"networkInterfaces,omitempty"`
}

type runtimeIdentity struct {
	MachineID         string
	PrimaryIPAddress  string
	WindowsVersion    string
	NetworkInterfaces []NetworkInterfaceInfo
	AdapterSnapshot   windowsAdapterSnapshot
}

type runtimeRegistration struct {
	AgentID  string
	Hostname string
	Version  string
}

type registerRequest struct {
	AgentKey     string   `json:"agentKey"`
	MachineID    string   `json:"machineId,omitempty"`
	Hostname     string   `json:"hostname"`
	Version      string   `json:"version"`
	OSType       string   `json:"osType"`
	Arch         string   `json:"arch,omitempty"`
	IPAddress    string   `json:"ipAddress,omitempty"`
	OSVersion    string   `json:"osVersion,omitempty"`
	Labels       []string `json:"labels,omitempty"`
	Role         string   `json:"role,omitempty"`
	Zone         string   `json:"zone,omitempty"`
	Capabilities []string `json:"capabilities,omitempty"`
}

type registerResponse struct {
	ID string `json:"id"`
}

type heartbeatRequest struct {
	AgentID       string                  `json:"agentId"`
	Version       string                  `json:"version"`
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

type capabilityReportRequest struct {
	AgentID            string               `json:"agentId"`
	CompatibilityLevel string               `json:"compatibilityLevel,omitempty"`
	Capabilities       []reportedCapability `json:"capabilities"`
}

type reportedCapability struct {
	CapabilityKey string         `json:"capabilityKey"`
	Value         any            `json:"value"`
	Confidence    float64        `json:"confidence"`
	Evidence      map[string]any `json:"evidence,omitempty"`
}

type apiErrorResponse struct {
	Message   string `json:"message"`
	ErrorCode string `json:"errorCode"`
}

type agentTaskEnvelope struct {
	ID              string                 `json:"id"`
	AgentID         string                 `json:"agentId"`
	ExecutionRunID  string                 `json:"executionRunId"`
	ExecutionStepID string                 `json:"executionStepId"`
	IdempotencyKey  string                 `json:"idempotencyKey"`
	Payload         map[string]any         `json:"payload"`
	Status          string                 `json:"status"`
	LeaseID         string                 `json:"leaseId,omitempty"`
	Result          map[string]any         `json:"result,omitempty"`
	UpdatedAt       string                 `json:"updatedAt,omitempty"`
	CreatedAt       string                 `json:"createdAt,omitempty"`
	Raw             map[string]interface{} `json:"-"`
}

type ackTaskRequest struct {
	AgentID string `json:"agentId"`
	TaskID  string `json:"taskId"`
	LeaseID string `json:"leaseId"`
}

type submitLogRequest struct {
	AgentID   string `json:"agentId"`
	TaskID    string `json:"taskId"`
	Sequence  int    `json:"sequence"`
	Level     string `json:"level,omitempty"`
	Message   string `json:"message"`
	EmittedAt string `json:"emittedAt,omitempty"`
}

type submitRuntimeLogRequest struct {
	AgentID   string         `json:"agentId"`
	Category  string         `json:"category"`
	Level     string         `json:"level,omitempty"`
	Summary   string         `json:"summary"`
	Detail    map[string]any `json:"detail,omitempty"`
	EmittedAt string         `json:"emittedAt,omitempty"`
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

type runtimeCounters struct {
	Running   int `json:"running"`
	Queued    int `json:"queued"`
	Succeeded int `json:"succeeded"`
	Failed    int `json:"failed"`
}

type runtimeDependencies struct {
	taskLedger     *localTaskLedger
	recoveryLedger *recoveryLedger
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

type NetworkInterfaceInfo struct {
	Name              string   `json:"name"`
	MACAddress        string   `json:"macAddress,omitempty"`
	IPv4              []string `json:"ipv4,omitempty"`
	IPv6              []string `json:"ipv6,omitempty"`
	IsUp              bool     `json:"isUp"`
	IsLoopback        bool     `json:"isLoopback"`
	HasDefaultGateway bool     `json:"hasDefaultGateway,omitempty"`
	LikelyVirtual     bool     `json:"likelyVirtual,omitempty"`
}

type serviceProgram struct {
	configPath string
	logPath    string
}

type windowsService struct {
	name     string
	logPath  string
	run      func(context.Context) error
	ctx      context.Context
	cancel   context.CancelFunc
	done     chan error
	handle   serviceStatusHandle
	status   serviceStatus
	statusMu sync.Mutex
}

type serviceTableEntry struct {
	serviceName *uint16
	serviceProc uintptr
}

type serviceStatus struct {
	serviceType             uint32
	currentState            uint32
	controlsAccepted        uint32
	win32ExitCode           uint32
	serviceSpecificExitCode uint32
	checkPoint              uint32
	waitHint                uint32
}

type serviceStatusHandle uintptr

type taskExecutionContext struct {
	ctx          context.Context
	client       *http.Client
	config       *AgentConfig
	registration *runtimeRegistration
	logger       *runtimeLogger
	deps         *runtimeDependencies
	task         agentTaskEnvelope
	leaseID      string
	logSequence  int
}

var (
	modAdvapi32                    = syscall.NewLazyDLL("advapi32.dll")
	procStartServiceCtrlDispatcher = modAdvapi32.NewProc("StartServiceCtrlDispatcherW")
	procRegisterServiceCtrlHandler = modAdvapi32.NewProc("RegisterServiceCtrlHandlerExW")
	procSetServiceStatus           = modAdvapi32.NewProc("SetServiceStatus")
	procGetConsoleWindow           = syscall.NewLazyDLL("kernel32.dll").NewProc("GetConsoleWindow")

	activeWindowsService *windowsService
)

const (
	serviceWin32OwnProcess       = 0x00000010
	serviceStartPending          = 0x00000002
	serviceStopPending           = 0x00000003
	serviceRunning               = 0x00000004
	serviceStopped               = 0x00000001
	serviceAcceptStop            = 0x00000001
	serviceAcceptShutdown        = 0x00000004
	serviceControlStop           = 0x00000001
	serviceControlInterrogate    = 0x00000004
	serviceControlShutdown       = 0x00000005
	noError                      = 0x00000000
	errorFailedServiceController = 1063
)

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
	case "inspect-adapter":
		return handleInspectAdapter()
	case "inspect-iis":
		return handleInspectIIS()
	case "self-check":
		return handleSelfCheck(args[1:])
	case "health":
		return handleHealth(args[1:])
	case "status":
		return handleStatus(args[1:])
	case "register-once":
		return handleRegisterOnce(args[1:])
	case "run":
		return handleRun(args[1:])
	case "service":
		return handleService(args[1:])
	case "service-info":
		return handleServiceInfo(args[1:])
	case "version":
		return writeJSON(map[string]string{
			"name":    "gcac-agent",
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
	return writeJSON(collectRuntimeState(""))
}

func handleInspectAdapter() error {
	return writeJSON(collectWindowsAdapterSnapshot(newRuntimeLogger("")))
}

func handleInspectIIS() error {
	return writeJSON(debugInspectWindowsIIS())
}

func handleSelfCheck(args []string) error {
	configPath := parseConfigPath(args)
	config, err := loadConfig(configPath)
	if err != nil {
		return err
	}

	checks := []map[string]any{
		checkItem("config.exists", true, map[string]any{"configPath": configPath}),
		checkItem("config.schema", strings.TrimSpace(config.SchemaVersion) != "", map[string]any{"schemaVersion": config.SchemaVersion}),
		checkItem("service.name", strings.TrimSpace(config.Service.Name) != "", map[string]any{"serviceName": config.Service.Name}),
		checkItem("windows.configPath", strings.TrimSpace(config.Paths.Windows.ConfigPath) != "", map[string]any{"value": config.Paths.Windows.ConfigPath}),
		checkItem("windows.dataDir", strings.TrimSpace(config.Paths.Windows.DataDir) != "", map[string]any{"value": config.Paths.Windows.DataDir}),
		checkItem("windows.logDir", strings.TrimSpace(config.Paths.Windows.LogDir) != "", map[string]any{"value": config.Paths.Windows.LogDir}),
		checkItem("controlPlane.url", strings.TrimSpace(config.ControlPlane) != "", map[string]any{"value": config.ControlPlane}),
		checkItem("agent.key", strings.TrimSpace(config.AgentKey) != "", map[string]any{"value": config.AgentKey}),
		checkItem("task.poll.interval", effectiveTaskPollSeconds(config) > 0, map[string]any{"seconds": effectiveTaskPollSeconds(config)}),
		checkItem("health.check.interval", effectiveHealthCheckSeconds(config) > 0, map[string]any{"seconds": effectiveHealthCheckSeconds(config)}),
		checkItem("offline.timeout", effectiveOfflineTimeoutSeconds(config) > 0, map[string]any{"seconds": effectiveOfflineTimeoutSeconds(config)}),
		checkItem("direct.control.listen", !config.DirectControlEnabled || effectiveDirectControlListenPort(config) > 0, map[string]any{"enabled": config.DirectControlEnabled, "host": effectiveDirectControlListenHost(config), "port": effectiveDirectControlListenPort(config)}),
	}

	for _, dir := range []string{config.Paths.Windows.DataDir, config.Paths.Windows.LogDir} {
		if strings.TrimSpace(dir) == "" {
			continue
		}
		checks = append(checks, checkItem("path.writable:"+dir, ensureDirWritable(dir) == nil, map[string]any{"path": dir}))
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

func handleRuntimeStatusCommand(args []string, includeChecks bool) error {
	configPath := parseConfigPath(args)
	config, err := loadConfig(configPath)
	if err != nil {
		return err
	}

	status := loadRuntimeStatusSnapshot(resolveRuntimeStatusPath(config))
	checks := buildWindowsHealthChecks(config, configPath)
	return writeJSON(buildRuntimeStatusReport(config, status, checks, includeChecks))
}

func handleRegisterOnce(args []string) error {
	configPath := parseConfigPath(args)
	config, err := loadConfig(configPath)
	if err != nil {
		return err
	}
	if err := ensureConfigDirectories(config); err != nil {
		return err
	}
	if strings.TrimSpace(config.ControlPlane) == "" {
		return errors.New("controlPlaneUrl 不能为空，Windows Go Agent 无法接入控制面")
	}
	if strings.TrimSpace(config.AgentKey) == "" {
		return errors.New("agentKey 不能为空，Windows Go Agent 无法完成注册")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	identity := collectRuntimeIdentity(config.ControlPlane)
	client := &http.Client{Timeout: 20 * time.Second}
	registration, err := registerAgent(ctx, client, config, identity)
	if err != nil {
		return err
	}
	if err := reportCapabilities(ctx, client, config, registration, identity); err != nil {
		return err
	}

	return writeJSON(map[string]any{
		"success":   true,
		"checkedAt": time.Now().Format(time.RFC3339),
		"agentId":   registration.AgentID,
		"hostname":  registration.Hostname,
		"version":   registration.Version,
		"mode":      "register-once",
	})
}

func handleRun(args []string) error {
	configPath := parseConfigPath(args)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return runForeground(ctx, configPath)
}

func handleService(args []string) error {
	if len(args) == 0 || args[0] != "run" {
		return errors.New("service 仅支持 `service run`")
	}
	configPath := parseConfigPath(args[1:])
	logPath := parseLogPath(args[1:])
	if isInteractiveSession() {
		return errors.New("`service run` 必须由 Windows Service Manager 调用，交互会话请使用 `run`")
	}
	program := &serviceProgram{
		configPath: configPath,
		logPath:    logPath,
	}
	return runWindowsService(serviceNameFromPath(configPath), program)
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
			"path":            configPath,
			"schema":          config.SchemaVersion,
			"serviceName":     config.Service.Name,
			"displayName":     config.Service.DisplayName,
			"dataDir":         config.Paths.Windows.DataDir,
			"logDir":          config.Paths.Windows.LogDir,
			"controlPlaneUrl": config.ControlPlane,
			"agentKey":        config.AgentKey,
			"zone":            config.Zone,
		},
		"runtime": collectRuntimeState(config.ControlPlane),
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

func runForeground(ctx context.Context, configPath string) error {
	config, err := loadConfig(configPath)
	if err != nil {
		return err
	}
	if err := ensureConfigDirectories(config); err != nil {
		return err
	}

	heartbeat := config.Heartbeat
	if heartbeat <= 0 {
		heartbeat = 30
	}
	taskPollSeconds := effectiveTaskPollSeconds(config)
	healthCheckSeconds := effectiveHealthCheckSeconds(config)

	logPath := filepath.Join(config.Paths.Windows.LogDir, "agent.log")
	logger := newRuntimeLogger(logPath)
	logger.Info("gcac-agent started runtime=go service=%s config=%s", config.Service.Name, configPath)

	if strings.TrimSpace(config.ControlPlane) == "" {
		return errors.New("controlPlaneUrl 不能为空，Windows Go Agent 无法接入控制面")
	}
	if strings.TrimSpace(config.AgentKey) == "" {
		return errors.New("agentKey 不能为空，Windows Go Agent 无法完成注册")
	}

	identity := collectRuntimeIdentity(config.ControlPlane)
	client := &http.Client{Timeout: 20 * time.Second}
	registration, err := registerAgent(ctx, client, config, identity)
	if err != nil {
		return err
	}
	logger.Info("agent registered agentId=%s hostname=%s", registration.AgentID, registration.Hostname)

	deps, err := loadRuntimeDependencies(config)
	if err != nil {
		return err
	}
	logger.Info("local ledgers loaded recoverableTasks=%d recoverableEntries=%d", len(deps.taskLedger.recoverable()), len(deps.recoveryLedger.recoverable()))
	statusPath := resolveRuntimeStatusPath(config)
	status := loadRuntimeStatusSnapshot(statusPath)
	status.SchemaVersion = "gcac.agent.runtime.status.v1"
	status.State = "starting"
	status.StartedAt = time.Now().Format(time.RFC3339)
	status.StoppedAt = ""
	status.ServiceName = config.Service.Name
	status.AgentID = registration.AgentID
	status.DirectControl = newDirectControlState(config)

	if firewallErr := syncWindowsDirectControlFirewallRule(config, logger); firewallErr != nil {
		logger.Warn("direct control firewall rule sync failed: %v", firewallErr)
	}

	directServer, directErr := startDirectControlServer(config, &status)
	if directErr != nil {
		logger.Warn("direct control listener failed: %v", directErr)
		status.DirectControl = newDirectControlState(config)
		status.DirectControl.LastDirectError = directErr.Error()
	} else if directServer != nil {
		defer directServer.shutdown(context.Background())
		status.DirectControl = directServer.snapshot()
	}

	if err := reportCapabilities(ctx, client, config, registration, identity); err != nil {
		logger.Warn("capability report failed: %v", err)
		_ = submitRuntimeLog(ctx, client, config, submitRuntimeLogRequest{
			AgentID:   registration.AgentID,
			Category:  "capability_report",
			Level:     "error",
			Summary:   "initial capability report failed",
			Detail:    map[string]any{"error": err.Error(), "phase": "startup"},
			EmittedAt: time.Now().Format(time.RFC3339),
		})
	} else {
		logger.Info("capability report ok agentId=%s", registration.AgentID)
	}

	counters := &runtimeCounters{}
	heartbeatTicker := time.NewTicker(time.Duration(heartbeat) * time.Second)
	defer heartbeatTicker.Stop()
	taskTicker := time.NewTicker(time.Duration(taskPollSeconds) * time.Second)
	defer taskTicker.Stop()
	healthTicker := time.NewTicker(time.Duration(healthCheckSeconds) * time.Second)
	defer healthTicker.Stop()

	if err := postHeartbeat(ctx, client, config, registration, counters, &status); err != nil {
		logger.Warn("first heartbeat failed: %v", err)
		_ = submitRuntimeLog(ctx, client, config, submitRuntimeLogRequest{
			AgentID:   registration.AgentID,
			Category:  "heartbeat",
			Level:     "error",
			Summary:   "first heartbeat failed",
			Detail:    map[string]any{"error": err.Error(), "phase": "startup"},
			EmittedAt: time.Now().Format(time.RFC3339),
		})
		status.LastError = err.Error()
		status.ConsecutiveHeartbeatFailures++
	} else {
		logger.Info("first heartbeat ok agentId=%s", registration.AgentID)
		status.LastHeartbeatAt = time.Now().Format(time.RFC3339)
		status.ConsecutiveHeartbeatFailures = 0
	}
	refreshRuntimeStatusMetrics(&status, deps, counters)
	saveRuntimeStatusSnapshot(statusPath, status)
	if err := recoverOutstandingTasks(ctx, client, config, registration, logger, counters, deps); err != nil {
		logger.Warn("outstanding task recovery failed: %v", err)
		status.LastError = err.Error()
		status.ConsecutiveRecoveryFailures++
	} else {
		status.LastRecoveryAt = time.Now().Format(time.RFC3339)
		status.ConsecutiveRecoveryFailures = 0
	}
	refreshRuntimeStatusMetrics(&status, deps, counters)
	saveRuntimeStatusSnapshot(statusPath, status)
	if err := pullAndProcessTasks(ctx, client, config, registration, logger, counters, deps); err != nil {
		logger.Warn("initial task polling failed: %v", err)
		status.LastError = err.Error()
		status.ConsecutiveTaskPollFailures++
	} else {
		status.LastTaskPollAt = time.Now().Format(time.RFC3339)
		status.LastTaskResultAt = status.LastTaskPollAt
		status.ConsecutiveTaskPollFailures = 0
	}
	refreshRuntimeStatusMetrics(&status, deps, counters)
	status.State = "running"
	saveRuntimeStatusSnapshot(statusPath, status)

	for {
		select {
		case <-ctx.Done():
			logger.Info("收到停止信号，gcac-agent 准备退出")
			_ = submitRuntimeLog(context.Background(), client, config, submitRuntimeLogRequest{
				AgentID:   registration.AgentID,
				Category:  "heartbeat",
				Level:     "warn",
				Summary:   "agent runtime stopped",
				Detail:    map[string]any{"state": "stopped"},
				EmittedAt: time.Now().Format(time.RFC3339),
			})
			status.State = "stopped"
			status.StoppedAt = time.Now().Format(time.RFC3339)
			saveRuntimeStatusSnapshot(statusPath, status)
			return nil
		case <-heartbeatTicker.C:
			if err := postHeartbeat(ctx, client, config, registration, counters, &status); err != nil {
				logger.Warn("heartbeat failed: %v", err)
				_ = submitRuntimeLog(ctx, client, config, submitRuntimeLogRequest{
					AgentID:   registration.AgentID,
					Category:  "heartbeat",
					Level:     "error",
					Summary:   "heartbeat failed",
					Detail:    map[string]any{"error": err.Error()},
					EmittedAt: time.Now().Format(time.RFC3339),
				})
				status.LastError = err.Error()
				status.ConsecutiveHeartbeatFailures++
			} else {
				logger.Info("heartbeat ok running=%d queued=%d succeeded=%d failed=%d", counters.Running, counters.Queued, counters.Succeeded, counters.Failed)
				status.LastHeartbeatAt = time.Now().Format(time.RFC3339)
				status.ConsecutiveHeartbeatFailures = 0
			}
			refreshRuntimeStatusMetrics(&status, deps, counters)
			saveRuntimeStatusSnapshot(statusPath, status)
		case <-taskTicker.C:
			if err := recoverOutstandingTasks(ctx, client, config, registration, logger, counters, deps); err != nil {
				logger.Warn("outstanding task recovery failed: %v", err)
				status.LastError = err.Error()
				status.ConsecutiveRecoveryFailures++
			} else {
				status.LastRecoveryAt = time.Now().Format(time.RFC3339)
				status.ConsecutiveRecoveryFailures = 0
			}
			if err := pullAndProcessTasks(ctx, client, config, registration, logger, counters, deps); err != nil {
				logger.Warn("task polling failed: %v", err)
				status.LastError = err.Error()
				status.ConsecutiveTaskPollFailures++
			} else {
				status.LastTaskPollAt = time.Now().Format(time.RFC3339)
				status.LastTaskResultAt = status.LastTaskPollAt
				status.ConsecutiveTaskPollFailures = 0
			}
			refreshRuntimeStatusMetrics(&status, deps, counters)
			saveRuntimeStatusSnapshot(statusPath, status)
		case <-healthTicker.C:
			status.LastSelfCheckAt = time.Now().Format(time.RFC3339)
			refreshRuntimeStatusMetrics(&status, deps, counters)
			saveRuntimeStatusSnapshot(statusPath, status)
		}
	}
}

func loadConfig(path string) (*AgentConfig, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取配置失败: %w", err)
	}
	content = bytes.TrimPrefix(content, []byte{0xEF, 0xBB, 0xBF})
	var config AgentConfig
	if err := json.Unmarshal(content, &config); err != nil {
		return nil, fmt.Errorf("解析配置失败: %w", err)
	}
	if strings.TrimSpace(config.Paths.Windows.ConfigPath) == "" {
		config.Paths.Windows.ConfigPath = path
	}
	return &config, nil
}

func ensureConfigDirectories(config *AgentConfig) error {
	for _, dir := range []string{config.Paths.Windows.DataDir, config.Paths.Windows.LogDir} {
		if err := ensureDirWritable(dir); err != nil {
			return err
		}
	}
	return nil
}

func ensureDirWritable(path string) error {
	if strings.TrimSpace(path) == "" {
		return errors.New("目录路径不能为空")
	}
	if err := os.MkdirAll(path, 0o755); err != nil {
		return fmt.Errorf("创建目录失败 %s: %w", path, err)
	}
	testPath := filepath.Join(path, ".gcac-write-test")
	if err := os.WriteFile(testPath, []byte("ok"), 0o600); err != nil {
		return fmt.Errorf("目录不可写 %s: %w", path, err)
	}
	_ = os.Remove(testPath)
	return nil
}

func resolveRuntimeStatusPath(config *AgentConfig) string {
	dataDir := strings.TrimSpace(config.Paths.Windows.DataDir)
	if dataDir == "" {
		return `C:\ProgramData\GCAC\FullAgentGo\data\runtime-status.json`
	}
	return filepath.Join(dataDir, "runtime-status.json")
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
		_ = os.MkdirAll(parent, 0o755)
	}
	encoded, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(path, append(encoded, '\n'), 0o644)
}

func refreshRuntimeStatusMetrics(snapshot *runtimeStatusSnapshot, deps *runtimeDependencies, counters *runtimeCounters) {
	if snapshot == nil {
		return
	}
	if counters != nil {
		snapshot.TaskCounters = *counters
	}
	if deps == nil {
		return
	}
	snapshot.PendingResultCount = len(deps.taskLedger.recoverable())
	snapshot.RecoverableTaskCount = len(deps.recoveryLedger.recoverable())
}

func buildWindowsHealthChecks(config *AgentConfig, configPath string) []map[string]any {
	checks := []map[string]any{
		checkItem("config.exists", fileExists(configPath), map[string]any{"configPath": configPath}),
		checkItem("service.name", strings.TrimSpace(config.Service.Name) != "", map[string]any{"serviceName": config.Service.Name}),
		checkItem("controlPlane.url", strings.TrimSpace(config.ControlPlane) != "", map[string]any{"value": config.ControlPlane}),
		checkItem("agent.key", strings.TrimSpace(config.AgentKey) != "", map[string]any{"value": config.AgentKey}),
		checkItem("task.poll.interval", effectiveTaskPollSeconds(config) > 0, map[string]any{"seconds": effectiveTaskPollSeconds(config)}),
		checkItem("health.check.interval", effectiveHealthCheckSeconds(config) > 0, map[string]any{"seconds": effectiveHealthCheckSeconds(config)}),
		checkItem("offline.timeout", effectiveOfflineTimeoutSeconds(config) > 0, map[string]any{"seconds": effectiveOfflineTimeoutSeconds(config)}),
	}
	for _, dir := range []string{config.Paths.Windows.DataDir, config.Paths.Windows.LogDir} {
		if strings.TrimSpace(dir) == "" {
			continue
		}
		checks = append(checks, checkItem("path.writable:"+dir, ensureDirWritable(dir) == nil, map[string]any{"path": dir}))
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
			"name":        config.Service.Name,
			"displayName": config.Service.DisplayName,
		},
		"config": map[string]any{
			"configPath":                 config.Paths.Windows.ConfigPath,
			"dataDir":                    config.Paths.Windows.DataDir,
			"logDir":                     config.Paths.Windows.LogDir,
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
	return 18930
}

func effectiveDirectControlAdvertiseHost(config *AgentConfig) string {
	if strings.TrimSpace(config.DirectControlAdvertiseHost) != "" {
		return strings.TrimSpace(config.DirectControlAdvertiseHost)
	}
	if primaryIP := strings.TrimSpace(collectRuntimeIdentity(config.ControlPlane).PrimaryIPAddress); primaryIP != "" {
		return primaryIP
	}
	return effectiveDirectControlListenHost(config)
}

func directControlFirewallRuleName(config *AgentConfig) string {
	serviceName := strings.TrimSpace(config.Service.Name)
	if serviceName == "" {
		serviceName = "gcac-agent"
	}
	return fmt.Sprintf("GCAC Agent Direct Control (%s)", serviceName)
}

func syncWindowsDirectControlFirewallRule(config *AgentConfig, logger *runtimeLogger) error {
	ruleName := directControlFirewallRuleName(config)
	if !shouldExposeDirectControlBeyondLoopback(config) {
		if err := removeWindowsFirewallRule(ruleName); err != nil {
			return err
		}
		logger.Info("direct control firewall rule not required host=%s port=%d", effectiveDirectControlListenHost(config), effectiveDirectControlListenPort(config))
		return nil
	}

	executablePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("读取当前可执行文件路径失败: %w", err)
	}
	if err := ensureWindowsFirewallRule(ruleName, executablePath, effectiveDirectControlListenPort(config), firewallLocalAddressForHost(effectiveDirectControlListenHost(config))); err != nil {
		return err
	}
	logger.Info("direct control firewall rule ensured rule=%s host=%s port=%d", ruleName, effectiveDirectControlListenHost(config), effectiveDirectControlListenPort(config))
	return nil
}

func shouldExposeDirectControlBeyondLoopback(config *AgentConfig) bool {
	if !config.DirectControlEnabled {
		return false
	}
	return !isLoopbackListenHost(effectiveDirectControlListenHost(config))
}

func isLoopbackListenHost(host string) bool {
	normalized := normalizeListenHost(host)
	if normalized == "" {
		return true
	}
	if strings.EqualFold(normalized, "localhost") {
		return true
	}
	if ip := net.ParseIP(normalized); ip != nil {
		return ip.IsLoopback()
	}
	return false
}

func firewallLocalAddressForHost(host string) string {
	normalized := normalizeListenHost(host)
	switch {
	case normalized == "":
		return ""
	case strings.EqualFold(normalized, "localhost"):
		return ""
	case normalized == "0.0.0.0":
		return ""
	case normalized == "::":
		return ""
	case normalized == "*":
		return ""
	}
	if ip := net.ParseIP(normalized); ip != nil {
		if ip.IsLoopback() {
			return ""
		}
		return normalized
	}
	return ""
}

func normalizeListenHost(host string) string {
	normalized := strings.TrimSpace(host)
	normalized = strings.TrimPrefix(normalized, "[")
	normalized = strings.TrimSuffix(normalized, "]")
	return normalized
}

func ensureWindowsFirewallRule(ruleName string, programPath string, port int, localAddress string) error {
	script := `
$ruleName = $env:GCAC_FIREWALL_RULE_NAME
$programPath = $env:GCAC_FIREWALL_PROGRAM
$portValue = [int]$env:GCAC_FIREWALL_PORT
$localAddress = $env:GCAC_FIREWALL_LOCAL_ADDRESS

Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue | Out-Null

$params = @{
  DisplayName = $ruleName
  Direction = 'Inbound'
  Action = 'Allow'
  Enabled = 'True'
  Profile = 'Any'
  Protocol = 'TCP'
  LocalPort = $portValue
  Program = $programPath
}

if (-not [string]::IsNullOrWhiteSpace($localAddress)) {
  $params.LocalAddress = $localAddress
}

New-NetFirewallRule @params | Out-Null
`
	_, err := runWindowsPowerShellScript(script, map[string]string{
		"GCAC_FIREWALL_RULE_NAME":     ruleName,
		"GCAC_FIREWALL_PROGRAM":       programPath,
		"GCAC_FIREWALL_PORT":          fmt.Sprintf("%d", port),
		"GCAC_FIREWALL_LOCAL_ADDRESS": localAddress,
	})
	if err != nil {
		return fmt.Errorf("写入 Windows 防火墙规则失败: %w", err)
	}
	return nil
}

func removeWindowsFirewallRule(ruleName string) error {
	script := `
$ruleName = $env:GCAC_FIREWALL_RULE_NAME
Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue | Out-Null
`
	_, err := runWindowsPowerShellScript(script, map[string]string{
		"GCAC_FIREWALL_RULE_NAME": ruleName,
	})
	if err != nil {
		return fmt.Errorf("删除 Windows 防火墙规则失败: %w", err)
	}
	return nil
}

func runWindowsPowerShellScript(script string, env map[string]string) (string, error) {
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	cmd.Env = os.Environ()
	for key, value := range env {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", key, value))
	}
	output, err := cmd.CombinedOutput()
	trimmed := strings.TrimSpace(string(output))
	if err != nil {
		if trimmed == "" {
			return "", err
		}
		return trimmed, fmt.Errorf("%w: %s", err, trimmed)
	}
	return trimmed, nil
}

func newDirectControlState(config *AgentConfig) *directControlState {
	state := &directControlState{
		Enabled:          config.DirectControlEnabled,
		Reachable:        false,
		ProtocolVersion:  "v1",
		SupportedActions: []string{"health", "discovery.run", "windows.iis.deploy_certificate"},
	}
	if config.DirectControlEnabled {
		state.ListenAddress = fmt.Sprintf("%s:%d", effectiveDirectControlAdvertiseHost(config), effectiveDirectControlListenPort(config))
	}
	return state
}

func startDirectControlServer(config *AgentConfig, status *runtimeStatusSnapshot) (*directControlServer, error) {
	if !config.DirectControlEnabled {
		return nil, nil
	}
	host := effectiveDirectControlListenHost(config)
	port := effectiveDirectControlListenPort(config)
	state := newDirectControlState(config)
	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/control/health", func(w http.ResponseWriter, _ *http.Request) {
		payload := map[string]any{
			"success":         true,
			"checkedAt":       time.Now().Format(time.RFC3339),
			"protocolVersion": "v1",
			"platform":        "windows",
			"service": map[string]any{
				"name":        config.Service.Name,
				"displayName": config.Service.DisplayName,
			},
			"directControl": state,
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
		payload := buildDirectDiscoveryPayloadWindows(collectRuntimeIdentity(config.ControlPlane), request)
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
		response, statusCode := executeDirectControlAction(config, request)
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
		response, statusCode := startDirectControlAction(config, request)
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
	state.Reachable = true
	state.LastReadyAt = time.Now().Format(time.RFC3339)
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			state.Reachable = false
			state.LastDirectError = serveErr.Error()
		}
	}()
	return &directControlServer{state: state, server: server, started: true}, nil
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

func executeDirectControlAction(config *AgentConfig, request directActionExecuteRequest) (map[string]any, int) {
	actionType := strings.TrimSpace(request.ActionType)
	if !strings.EqualFold(actionType, "windows.iis.deploy_certificate") {
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
	payload["type"] = "windows.iis.deploy_certificate"

	taskID := fmt.Sprintf("direct_%d", time.Now().UnixNano())
	hostName, err := os.Hostname()
	if err != nil || strings.TrimSpace(hostName) == "" {
		hostName = "localhost"
	}
	execution := &taskExecutionContext{
		ctx:    context.Background(),
		client: &http.Client{Timeout: 20 * time.Second},
		config: config,
		logger: newRuntimeLogger(filepath.Join(config.Paths.Windows.LogDir, "agent.log")),
		deps: &runtimeDependencies{
			taskLedger: &localTaskLedger{
				filePath:         filepath.Join(config.Paths.Windows.DataDir, "ledger", "direct-control-tasks.json"),
				tasks:            map[string]localTaskRecord{},
				idempotencyIndex: map[string]string{},
			},
			recoveryLedger: &recoveryLedger{
				filePath: filepath.Join(config.Paths.Windows.DataDir, "ledger", "direct-control-recovery.json"),
				entries:  map[string]recoveryLedgerEntry{},
			},
		},
		registration: &runtimeRegistration{
			AgentID:  "direct-control",
			Hostname: hostName,
			Version:  agentVersion,
		},
		task: agentTaskEnvelope{
			ID:              taskID,
			ExecutionRunID:  fmt.Sprintf("direct_run_%d", time.Now().UnixNano()),
			ExecutionStepID: fmt.Sprintf("direct_step_%d", time.Now().UnixNano()),
			Payload:         payload,
		},
		leaseID:     fmt.Sprintf("direct_lease_%d", time.Now().UnixNano()),
		logSequence: 1,
	}

	success, errorCode, errorMessage, detail := executeTask(execution)
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
		"actionType":   "windows.iis.deploy_certificate",
	}, statusCode
}

func startDirectControlAction(config *AgentConfig, request directActionStartRequest) (map[string]any, int) {
	actionType := strings.TrimSpace(request.ActionType)
	if !strings.EqualFold(actionType, "windows.iis.deploy_certificate") {
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
	payload["type"] = "windows.iis.deploy_certificate"

	actionID := fmt.Sprintf("direct_action_%d", time.Now().UnixNano())
	startedAt := time.Now().Format(time.RFC3339)
	globalDirectActionStatusStore.upsert(directActionStatusSnapshot{
		ActionID:   actionID,
		ActionType: "windows.iis.deploy_certificate",
		RequestID:  request.RequestID,
		Status:     "running",
		StartedAt:  startedAt,
	})

	go func() {
		hostName, err := os.Hostname()
		if err != nil || strings.TrimSpace(hostName) == "" {
			hostName = "localhost"
		}
		execution := &taskExecutionContext{
			ctx:    context.Background(),
			client: &http.Client{Timeout: 20 * time.Second},
			config: config,
			logger: newRuntimeLogger(filepath.Join(config.Paths.Windows.LogDir, "agent.log")),
			deps: &runtimeDependencies{
				taskLedger: &localTaskLedger{
					filePath:         filepath.Join(config.Paths.Windows.DataDir, "ledger", "direct-control-tasks.json"),
					tasks:            map[string]localTaskRecord{},
					idempotencyIndex: map[string]string{},
				},
				recoveryLedger: &recoveryLedger{
					filePath: filepath.Join(config.Paths.Windows.DataDir, "ledger", "direct-control-recovery.json"),
					entries:  map[string]recoveryLedgerEntry{},
				},
			},
			registration: &runtimeRegistration{
				AgentID:  "direct-control",
				Hostname: hostName,
				Version:  agentVersion,
			},
			task: agentTaskEnvelope{
				ID:              actionID,
				ExecutionRunID:  fmt.Sprintf("direct_run_%d", time.Now().UnixNano()),
				ExecutionStepID: fmt.Sprintf("direct_step_%d", time.Now().UnixNano()),
				Payload:         payload,
			},
			leaseID:     fmt.Sprintf("direct_lease_%d", time.Now().UnixNano()),
			logSequence: 1,
		}
		success, errorCode, errorMessage, detail := executeTask(execution)
		globalDirectActionStatusStore.upsert(directActionStatusSnapshot{
			ActionID:     actionID,
			ActionType:   "windows.iis.deploy_certificate",
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
		"actionType": "windows.iis.deploy_certificate",
		"status":     "running",
	}, http.StatusAccepted
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

func buildDirectDiscoveryPayloadWindows(identity runtimeIdentity, request directDiscoveryRequest) map[string]any {
	hostName, _ := os.Hostname()
	primaryIP := strings.TrimSpace(identity.PrimaryIPAddress)
	hosts := []map[string]any{
		{
			"hostname":        hostName,
			"primaryIp":       primaryIP,
			"ipAddresses":     []string{primaryIP},
			"osType":          "WINDOWS",
			"osName":          readWindowsOSValue(identity, "ProductName"),
			"osVersion":       readWindowsOSValue(identity, "Version"),
			"arch":            runtime.GOARCH,
			"agentId":         "",
			"discoverySource": "AGENT",
			"managementMode":  "AGENT",
			"status":          "ACTIVE",
		},
	}
	services := make([]map[string]any, 0, 1)
	serviceAssets := make([]map[string]any, 0)
	siteAssets := make([]map[string]any, 0)
	bindings := make([]map[string]any, 0)

	if identity.AdapterSnapshot.IIS != nil && identity.AdapterSnapshot.IIS.Installed {
		services = append(services, map[string]any{
			"hostname":        hostName,
			"providerType":    "IIS",
			"serviceName":     "iis",
			"displayName":     "iis",
			"configPath":      `IIS:\Sites`,
			"discoverySource": "AGENT",
			"status":          "ACTIVE",
			"rawFacts":        identity.AdapterSnapshot.IIS,
		})
		for _, site := range identity.AdapterSnapshot.IIS.Sites {
			for _, binding := range site.Bindings {
				protocol := strings.ToUpper(strings.TrimSpace(binding.Protocol))
				if protocol != "HTTPS" && protocol != "HTTP" {
					continue
				}
				hostHeader := strings.TrimSpace(binding.HostHeader)
				if hostHeader == "" || binding.Port <= 0 {
					continue
				}
				serviceAssetRef := strings.ToLower(fmt.Sprintf("%s:%d:%s", hostHeader, binding.Port, protocol))
				siteKey := strings.ToLower(fmt.Sprintf("%s:iis:%s:%s", hostName, site.Name, binding.BindingInformation))
				serviceAssets = append(serviceAssets, map[string]any{
					"serviceAssetRef": serviceAssetRef,
					"hostname":        hostName,
					"providerType":    "IIS",
					"serviceName":     "iis",
					"address":         hostHeader,
					"port":            binding.Port,
					"protocol":        protocol,
					"sniName":         hostHeader,
					"displayName":     hostHeader,
				})
				siteAssets = append(siteAssets, map[string]any{
					"siteAssetRef":       "site-asset:" + siteKey,
					"serviceAssetRef":    serviceAssetRef,
					"hostname":           hostName,
					"providerType":       "IIS",
					"serviceName":        "iis",
					"siteType":           "WEB_SITE",
					"siteName":           site.Name,
					"siteKey":            siteKey,
					"bindingInformation": binding.BindingInformation,
					"hostHeader":         hostHeader,
					"listenIp":           binding.IPAddress,
					"port":               binding.Port,
					"protocol":           protocol,
					"configPath":         `IIS:\Sites`,
				})
				if request.IncludeBindings {
					observedFingerprint := ""
					if binding.Certificate != nil {
						observedFingerprint = strings.TrimSpace(binding.Certificate.FingerprintSHA256)
					}
					bindings = append(bindings, map[string]any{
						"siteAssetRef":              "site-asset:" + siteKey,
						"serviceAssetRef":           serviceAssetRef,
						"hostname":                  hostName,
						"providerType":              "IIS",
						"serviceName":               "iis",
						"domainName":                hostHeader,
						"port":                      binding.Port,
						"protocol":                  protocol,
						"bindingType":               "WINDOWS_CERT_STORE",
						"storeLocation":             "LocalMachine",
						"storeName":                 binding.CertificateStoreName,
						"storeThumbprint":           binding.CertificateThumbprint,
						"observedFingerprintSha256": observedFingerprint,
						"verifyMethod":              "TLS_CONNECT",
						"metadata": map[string]any{
							"certificateSubject": binding.CertificateSubject(),
							"certificateIssuer":  binding.CertificateIssuer(),
						},
					})
				}
			}
		}
	}

	return map[string]any{
		"collectedAt":   time.Now().Format(time.RFC3339),
		"source":        "agent_direct",
		"platform":      "windows",
		"requestId":     request.RequestID,
		"hosts":         hosts,
		"services":      services,
		"serviceAssets": serviceAssets,
		"siteAssets":    siteAssets,
		"bindings":      bindings,
	}
}

func readWindowsOSValue(identity runtimeIdentity, key string) string {
	if identity.AdapterSnapshot.OS == nil {
		return ""
	}
	switch key {
	case "ProductName":
		return identity.AdapterSnapshot.OS.ProductName
	case "Version":
		return identity.AdapterSnapshot.OS.Version
	default:
		return ""
	}
}

func runWindowsService(name string, program *serviceProgram) error {
	ctx, cancel := context.WithCancel(context.Background())
	service := &windowsService{
		name:    name,
		logPath: program.logPath,
		run: func(runCtx context.Context) error {
			return runForeground(runCtx, program.configPath)
		},
		ctx:    ctx,
		cancel: cancel,
		done:   make(chan error, 1),
		status: serviceStatus{
			serviceType: serviceWin32OwnProcess,
		},
	}
	activeWindowsService = service

	serviceNamePtr, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return err
	}
	table := []serviceTableEntry{
		{serviceName: serviceNamePtr, serviceProc: syscall.NewCallback(serviceMain)},
		{serviceName: nil, serviceProc: 0},
	}
	ret, _, callErr := procStartServiceCtrlDispatcher.Call(uintptr(unsafe.Pointer(&table[0])))
	if ret == 0 {
		if errno, ok := callErr.(syscall.Errno); ok && errno == errorFailedServiceController {
			return errors.New("当前进程不是由 SCM 启动的 Windows Service 进程")
		}
		return fmt.Errorf("StartServiceCtrlDispatcherW 失败: %v", callErr)
	}

	runErr := <-service.done
	return runErr
}

func serviceMain(argc uint32, argv uintptr) uintptr {
	_ = argc
	_ = argv

	service := activeWindowsService
	if service == nil {
		return 0
	}

	namePtr, err := syscall.UTF16PtrFromString(service.name)
	if err != nil {
		service.done <- err
		return 0
	}
	handler, _, callErr := procRegisterServiceCtrlHandler.Call(
		uintptr(unsafe.Pointer(namePtr)),
		syscall.NewCallback(serviceControlHandler),
		0,
	)
	if handler == 0 {
		service.done <- fmt.Errorf("RegisterServiceCtrlHandlerExW 失败: %v", callErr)
		return 0
	}
	service.handle = serviceStatusHandle(handler)

	service.setStatus(serviceStatus{
		serviceType:      serviceWin32OwnProcess,
		currentState:     serviceStartPending,
		controlsAccepted: 0,
		waitHint:         15000,
	})

	go func() {
		runErr := service.run(service.ctx)
		if runErr != nil {
			writeServiceLog(service.logPath, fmt.Sprintf("service runtime exited with error: %v", runErr))
			service.setStatus(serviceStatus{
				serviceType:      serviceWin32OwnProcess,
				currentState:     serviceStopped,
				controlsAccepted: 0,
				win32ExitCode:    1,
			})
			service.done <- runErr
			return
		}
		service.setStatus(serviceStatus{
			serviceType:      serviceWin32OwnProcess,
			currentState:     serviceStopped,
			controlsAccepted: 0,
			win32ExitCode:    noError,
		})
		service.done <- nil
	}()

	service.setStatus(serviceStatus{
		serviceType:      serviceWin32OwnProcess,
		currentState:     serviceRunning,
		controlsAccepted: serviceAcceptStop | serviceAcceptShutdown,
		win32ExitCode:    noError,
	})

	<-service.ctx.Done()
	return 0
}

func serviceControlHandler(control, eventType, eventData, context uintptr) uintptr {
	_ = eventType
	_ = eventData
	_ = context

	service := activeWindowsService
	if service == nil {
		return noError
	}

	switch uint32(control) {
	case serviceControlInterrogate:
		return noError
	case serviceControlStop, serviceControlShutdown:
		service.setStatus(serviceStatus{
			serviceType:      serviceWin32OwnProcess,
			currentState:     serviceStopPending,
			controlsAccepted: 0,
			waitHint:         15000,
		})
		service.cancel()
		return noError
	default:
		return noError
	}
}

func (s *windowsService) setStatus(status serviceStatus) {
	s.statusMu.Lock()
	defer s.statusMu.Unlock()
	s.status = status
	if s.handle == 0 {
		return
	}
	_, _, _ = procSetServiceStatus.Call(uintptr(s.handle), uintptr(unsafe.Pointer(&s.status)))
}

func isInteractiveSession() bool {
	ret, _, _ := procGetConsoleWindow.Call()
	return ret != 0
}

func collectRuntimeState(controlPlaneURL string) RuntimeState {
	hostname, _ := os.Hostname()
	executable, _ := os.Executable()
	currentDir, _ := os.Getwd()
	currentUser, _ := user.Current()
	state := RuntimeState{
		CollectedAt: time.Now().Format(time.RFC3339),
		GOOS:        runtime.GOOS,
		GOARCH:      runtime.GOARCH,
		Hostname:    hostname,
		Executable:  executable,
		CurrentDir:  currentDir,
		Environment: pickEnvironment([]string{"COMPUTERNAME", "USERNAME", "USERDOMAIN", "ProgramData", "ProgramFiles", "PATH"}),
	}
	if currentUser != nil {
		state.User = currentUser.Username
	}
	state.MachineID = buildMachineID(hostname)
	state.WindowsVersion = strings.TrimSpace(os.Getenv("OS"))
	state.Interfaces, state.PrimaryIPAddress = collectNetworkInterfaces()
	if preferredIP := detectPreferredSourceIP(controlPlaneURL); preferredIP != "" {
		state.PrimaryIPAddress = preferredIP
	}
	return state
}

func collectRuntimeIdentity(controlPlaneURL string) runtimeIdentity {
	state := collectRuntimeState(controlPlaneURL)
	adapterSnapshot := collectWindowsAdapterSnapshot(newRuntimeLogger(""))
	return runtimeIdentity{
		MachineID:         state.MachineID,
		PrimaryIPAddress:  state.PrimaryIPAddress,
		WindowsVersion:    state.WindowsVersion,
		NetworkInterfaces: state.Interfaces,
		AdapterSnapshot:   adapterSnapshot,
	}
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

func registerAgent(ctx context.Context, client *http.Client, config *AgentConfig, identity runtimeIdentity) (*runtimeRegistration, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return nil, fmt.Errorf("读取主机名失败: %w", err)
	}

	request := registerRequest{
		AgentKey:  config.AgentKey,
		MachineID: identity.MachineID,
		Hostname:  hostname,
		Version:   agentVersion,
		OSType:    "windows",
		Arch:      runtime.GOARCH,
		IPAddress: identity.PrimaryIPAddress,
		OSVersion: identity.WindowsVersion,
		Labels:    []string{"windows-go", "windows-service"},
		Role:      "full_agent",
		Zone:      strings.TrimSpace(config.Zone),
		Capabilities: []string{
			"agent.full.online",
			"agent.task.receive",
			"agent.log.report",
		},
	}
	if config.DirectControlEnabled {
		request.Capabilities = append(request.Capabilities, "agent.direct_control.health")
	}

	var response registerResponse
	if err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/register", request, &response); err != nil {
		return nil, fmt.Errorf("注册 Agent 失败: %w", err)
	}
	if strings.TrimSpace(response.ID) == "" {
		return nil, errors.New("注册 Agent 失败: 控制面未返回有效 agentId")
	}

	return &runtimeRegistration{
		AgentID:  response.ID,
		Hostname: hostname,
		Version:  agentVersion,
	}, nil
}

func postHeartbeat(ctx context.Context, client *http.Client, config *AgentConfig, registration *runtimeRegistration, counters *runtimeCounters, status *runtimeStatusSnapshot) error {
	request := heartbeatRequest{
		AgentID: registration.AgentID,
		Version: registration.Version,
	}
	request.TaskSummary.Running = counters.Running
	request.TaskSummary.Queued = counters.Queued
	request.TaskSummary.Succeeded = counters.Succeeded
	request.TaskSummary.Failed = counters.Failed
	if status != nil {
		request.RuntimeHealth = buildHeartbeatRuntimeHealth(config, *status)
		request.DirectControl = status.DirectControl
	}
	return doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/heartbeat", request, nil)
}

func reportCapabilities(ctx context.Context, client *http.Client, config *AgentConfig, registration *runtimeRegistration, identity runtimeIdentity) error {
	request := capabilityReportRequest{
		AgentID:            registration.AgentID,
		CompatibilityLevel: "modern",
		Capabilities:       collectCapabilityReports(identity),
	}
	return doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/capabilities", request, nil)
}

func collectCapabilityReports(identity runtimeIdentity) []reportedCapability {
	capabilities := []reportedCapability{
		{
			CapabilityKey: "windows.os.detail",
			Value: map[string]any{
				"goos":       runtime.GOOS,
				"goarch":     runtime.GOARCH,
				"osVersion":  identity.WindowsVersion,
				"machineId":  identity.MachineID,
				"primaryIp":  identity.PrimaryIPAddress,
				"runtime":    "go",
				"hostType":   "windows-service",
				"agentModel": "full-agent",
			},
			Confidence: 0.98,
			Evidence: map[string]any{
				"source": "runtime-inspection",
			},
		},
		{
			CapabilityKey: "windows.network.adapters",
			Value:         identity.NetworkInterfaces,
			Confidence:    0.92,
			Evidence: map[string]any{
				"source": "runtime-inspection",
			},
		},
	}
	if identity.AdapterSnapshot.OS != nil {
		capabilities[0] = reportedCapability{
			CapabilityKey: "windows.os.detail",
			Value: map[string]any{
				"goos":           runtime.GOOS,
				"goarch":         runtime.GOARCH,
				"osVersion":      identity.AdapterSnapshot.OS.Version,
				"machineId":      identity.MachineID,
				"primaryIp":      identity.PrimaryIPAddress,
				"runtime":        "go",
				"hostType":       "windows-service",
				"agentModel":     "full-agent",
				"ProductName":    identity.AdapterSnapshot.OS.ProductName,
				"DisplayVersion": identity.AdapterSnapshot.OS.DisplayVersion,
				"ReleaseId":      identity.AdapterSnapshot.OS.ReleaseID,
				"CurrentBuild":   identity.AdapterSnapshot.OS.CurrentBuild,
				"BuildRevision":  identity.AdapterSnapshot.OS.BuildRevision,
				"Version":        identity.AdapterSnapshot.OS.Version,
			},
			Confidence: 1,
			Evidence: map[string]any{
				"source": "adapter-exec",
			},
		}
	}
	if identity.AdapterSnapshot.PowerShell.Available {
		capabilities = append(capabilities, reportedCapability{
			CapabilityKey: "windows.powershell.available",
			Value: map[string]any{
				"available": true,
				"path":      identity.AdapterSnapshot.PowerShell.Path,
			},
			Confidence: 1,
			Evidence: map[string]any{
				"source": "adapter-exec",
			},
		})
	}
	if len(identity.AdapterSnapshot.CertStore.LocalMachineMy) > 0 {
		capabilities = append(capabilities, reportedCapability{
			CapabilityKey: "windows.certstore.localmachine.my",
			Value:         identity.AdapterSnapshot.CertStore.LocalMachineMy,
			Confidence:    0.95,
			Evidence: map[string]any{
				"source": "adapter-exec",
			},
		})
	}
	if identity.AdapterSnapshot.IIS != nil {
		capabilities = append(capabilities, reportedCapability{
			CapabilityKey: "windows.iis.detail",
			Value:         identity.AdapterSnapshot.IIS,
			Confidence:    0.95,
			Evidence: map[string]any{
				"source": "adapter-exec",
			},
		})
		if len(identity.AdapterSnapshot.IIS.Sites) > 0 {
			capabilities = append(capabilities, reportedCapability{
				CapabilityKey: "windows.iis.sites",
				Value:         identity.AdapterSnapshot.IIS.Sites,
				Confidence:    0.95,
				Evidence: map[string]any{
					"source": "adapter-exec",
				},
			})
		}
	}
	return capabilities
}

func loadRuntimeDependencies(config *AgentConfig) (*runtimeDependencies, error) {
	ledgerDir := filepath.Join(config.Paths.Windows.DataDir, "ledger")
	if err := os.MkdirAll(ledgerDir, 0o755); err != nil {
		return nil, fmt.Errorf("创建 ledger 目录失败: %w", err)
	}

	taskLedger, err := loadLocalTaskLedger(filepath.Join(ledgerDir, "tasks.json"))
	if err != nil {
		return nil, err
	}
	recoveryLedger, err := loadRecoveryLedger(filepath.Join(ledgerDir, "recovery.json"))
	if err != nil {
		return nil, err
	}
	return &runtimeDependencies{
		taskLedger:     taskLedger,
		recoveryLedger: recoveryLedger,
	}, nil
}

func pullAndProcessTasks(ctx context.Context, client *http.Client, config *AgentConfig, registration *runtimeRegistration, logger *runtimeLogger, counters *runtimeCounters, deps *runtimeDependencies) error {
	tasks, err := pullTasks(ctx, client, config, registration.AgentID)
	if err != nil {
		return err
	}
	counters.Queued = len(tasks)
	if len(tasks) == 0 {
		return nil
	}
	for _, task := range tasks {
		if err := processTask(ctx, client, config, registration, logger, counters, deps, task); err != nil {
			logger.Warn("process task failed taskId=%s error=%v", task.ID, err)
		}
	}
	counters.Queued = 0
	return nil
}

func pullTasks(ctx context.Context, client *http.Client, config *AgentConfig, agentID string) ([]agentTaskEnvelope, error) {
	var tasks []agentTaskEnvelope
	if err := doJSONRequest(ctx, client, config, http.MethodGet, "/api/v1/agents/tasks/pull?agentId="+agentID, nil, &tasks); err != nil {
		return nil, fmt.Errorf("拉取任务失败: %w", err)
	}
	return tasks, nil
}

func processTask(ctx context.Context, client *http.Client, config *AgentConfig, registration *runtimeRegistration, logger *runtimeLogger, counters *runtimeCounters, deps *runtimeDependencies, task agentTaskEnvelope) error {
	record, err := deps.taskLedger.accept(task)
	if err != nil {
		return err
	}
	_ = deps.recoveryLedger.record(task.ID, "runtime", record.Status, "task.accepted", map[string]any{
		"taskId":          task.ID,
		"idempotencyKey":  task.IdempotencyKey,
		"executionStepId": task.ExecutionStepID,
	})

	if record.Result != nil && !record.ResultReported {
		logger.Info("replaying pending result taskId=%s status=%s", task.ID, record.Status)
		return replayTaskResult(ctx, client, config, logger, counters, deps, registration.AgentID, record)
	}
	if isTerminalTaskStatus(record.Status) && record.ResultReported {
		logger.Info("skip already completed task taskId=%s status=%s", task.ID, record.Status)
		return nil
	}
	if record.Status == taskStatusRecovering && record.LeaseID != "" {
		logger.Warn("task recovered without final result, reporting recovery failure taskId=%s", task.ID)
		recoveryResult := submitResultRequest{
			AgentID:      registration.AgentID,
			TaskID:       task.ID,
			LeaseID:      record.LeaseID,
			Success:      false,
			ErrorCode:    "RECOVERY_INCOMPLETE",
			ErrorMessage: "Agent restart detected before task completion; automatic replay is not safe",
			Detail: map[string]any{
				"recoveryNote": record.RecoveryNote,
				"taskId":       task.ID,
			},
		}
		if _, err := deps.taskLedger.stageResult(task.ID, recoveryResult, "recovery failure staged"); err != nil {
			return err
		}
		_ = deps.recoveryLedger.record(task.ID, "runtime", taskStatusResultPending, "task.recovery_failure_staged", map[string]any{
			"taskId": task.ID,
		})
		record, _ = deps.taskLedger.get(task.ID)
		return replayTaskResult(ctx, client, config, logger, counters, deps, registration.AgentID, record)
	}

	leaseID := newLeaseID(task.ID)
	if _, err := ackTask(ctx, client, config, registration.AgentID, task.ID, leaseID); err != nil {
		return fmt.Errorf("ack 任务失败: %w", err)
	}
	if _, err := deps.taskLedger.markAcked(task.ID, leaseID); err != nil {
		return err
	}
	_ = deps.recoveryLedger.record(task.ID, "runtime", taskStatusAcked, "task.acked", map[string]any{
		"taskId":  task.ID,
		"leaseId": leaseID,
	})
	counters.Running++
	defer func() {
		if counters.Running > 0 {
			counters.Running--
		}
	}()
	if _, err := deps.taskLedger.markRunning(task.ID); err != nil {
		return err
	}
	_ = deps.recoveryLedger.record(task.ID, "runtime", taskStatusRunning, "task.running", map[string]any{
		"taskId":  task.ID,
		"leaseId": leaseID,
	})

	sequence := 1
	_ = submitTaskLog(ctx, client, config, submitLogRequest{
		AgentID:   registration.AgentID,
		TaskID:    task.ID,
		Sequence:  sequence,
		Level:     "info",
		Message:   fmt.Sprintf("开始处理任务 taskId=%s stepId=%s", task.ID, task.ExecutionStepID),
		EmittedAt: time.Now().Format(time.RFC3339),
	})
	sequence++

	execution := taskExecutionContext{
		ctx:          ctx,
		client:       client,
		config:       config,
		registration: registration,
		logger:       logger,
		deps:         deps,
		task:         task,
		leaseID:      leaseID,
		logSequence:  sequence,
	}
	success, errorCode, errorMessage, detail := executeTask(&execution)
	sequence = execution.logSequence

	resultRequest := submitResultRequest{
		AgentID:      registration.AgentID,
		TaskID:       task.ID,
		LeaseID:      leaseID,
		Success:      success,
		ErrorCode:    errorCode,
		ErrorMessage: errorMessage,
		Detail:       detail,
	}
	if _, err := deps.taskLedger.stageResult(task.ID, resultRequest, "result staged before control plane submit"); err != nil {
		return err
	}
	_ = deps.recoveryLedger.record(task.ID, "runtime", taskStatusResultPending, "task.result_staged", map[string]any{
		"taskId":  task.ID,
		"leaseId": leaseID,
		"success": success,
	})

	logMessage := "任务执行完成"
	logLevel := "info"
	if !success {
		logLevel = "error"
		logMessage = fmt.Sprintf("任务执行失败: %s", errorMessage)
	}
	_ = submitTaskLog(ctx, client, config, submitLogRequest{
		AgentID:   registration.AgentID,
		TaskID:    task.ID,
		Sequence:  sequence,
		Level:     logLevel,
		Message:   logMessage,
		EmittedAt: time.Now().Format(time.RFC3339),
	})

	return replayTaskResult(ctx, client, config, logger, counters, deps, registration.AgentID, mustGetTaskRecord(deps.taskLedger, task.ID))
}

func recoverOutstandingTasks(ctx context.Context, client *http.Client, config *AgentConfig, registration *runtimeRegistration, logger *runtimeLogger, counters *runtimeCounters, deps *runtimeDependencies) error {
	for _, record := range deps.taskLedger.recoverable() {
		if record.Result == nil || record.ResultReported {
			continue
		}
		logger.Info("recovering pending result taskId=%s status=%s", record.TaskID, record.Status)
		if err := replayTaskResult(ctx, client, config, logger, counters, deps, registration.AgentID, record); err != nil {
			logger.Warn("recover pending result failed taskId=%s error=%v", record.TaskID, err)
		}
	}
	return nil
}

func replayTaskResult(ctx context.Context, client *http.Client, config *AgentConfig, logger *runtimeLogger, counters *runtimeCounters, deps *runtimeDependencies, agentID string, record localTaskRecord) error {
	if record.Result == nil {
		return nil
	}
	request := submitResultRequest{
		AgentID:      agentID,
		TaskID:       record.TaskID,
		LeaseID:      record.LeaseID,
		Success:      boolFromMap(record.Result, "success"),
		ErrorCode:    stringFromMap(record.Result, "errorCode"),
		ErrorMessage: stringFromMap(record.Result, "errorMessage"),
		Detail:       mapFromMap(record.Result, "detail"),
	}
	if _, err := submitTaskResult(ctx, client, config, request); err != nil {
		return fmt.Errorf("补传任务结果失败 taskId=%s: %w", record.TaskID, err)
	}
	if _, err := deps.taskLedger.markReported(record.TaskID, request.Success); err != nil {
		return err
	}
	finalStatus := taskStatusFailed
	if request.Success {
		finalStatus = taskStatusSucceeded
		counters.Succeeded++
		logger.Info("task succeeded taskId=%s leaseId=%s", record.TaskID, record.LeaseID)
	} else {
		counters.Failed++
		logger.Warn("task failed taskId=%s leaseId=%s error=%s", record.TaskID, record.LeaseID, request.ErrorCode)
	}
	_ = deps.recoveryLedger.record(record.TaskID, "runtime", finalStatus, "task.result_reported", map[string]any{
		"taskId":  record.TaskID,
		"leaseId": record.LeaseID,
		"success": request.Success,
	})
	return nil
}

func (e *taskExecutionContext) submitLog(level string, format string, args ...any) {
	message := fmt.Sprintf(format, args...)
	switch strings.ToLower(strings.TrimSpace(level)) {
	case "error":
		e.logger.Warn("task=%s %s", e.task.ID, message)
		level = "error"
	case "warn", "warning":
		e.logger.Warn("task=%s %s", e.task.ID, message)
		level = "warn"
	default:
		e.logger.Info("task=%s %s", e.task.ID, message)
		level = "info"
	}
	_ = submitTaskLog(e.ctx, e.client, e.config, submitLogRequest{
		AgentID:   e.registration.AgentID,
		TaskID:    e.task.ID,
		Sequence:  e.logSequence,
		Level:     level,
		Message:   message,
		EmittedAt: time.Now().Format(time.RFC3339),
	})
	e.logSequence++
}

func executeTask(execution *taskExecutionContext) (bool, string, string, map[string]any) {
	task := execution.task
	payload := task.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	if isWindowsIISDeploymentTask(task) {
		return runWindowsIISDeployment(execution)
	}
	if dryRun, ok := payload["dryRun"].(bool); ok && dryRun {
		execution.submitLog("info", "任务以 dry-run 模式结束")
		return true, "", "", map[string]any{
			"executor":        "windows-go-agent-runtime",
			"mode":            "dry-run",
			"executionStepId": task.ExecutionStepID,
			"taskId":          task.ID,
		}
	}
	if taskType, ok := payload["type"].(string); ok && taskType == "agent.self_test" {
		execution.submitLog("info", "任务以 self-test 模式结束")
		return true, "", "", map[string]any{
			"executor": "windows-go-agent-runtime",
			"mode":     "self-test",
			"taskId":   task.ID,
		}
	}
	if taskType, ok := payload["type"].(string); ok && taskType == "agent.capability.rescan" {
		execution.submitLog("info", "开始执行手动能力重扫")
		if err := reportCapabilities(execution.ctx, execution.client, execution.config, execution.registration, collectRuntimeIdentity(execution.config.ControlPlane)); err != nil {
			_ = submitRuntimeLog(execution.ctx, execution.client, execution.config, submitRuntimeLogRequest{
				AgentID:   execution.registration.AgentID,
				Category:  "manual_rescan",
				Level:     "error",
				Summary:   "manual capability rescan failed",
				Detail:    map[string]any{"error": err.Error(), "taskId": task.ID, "requestedBy": stringFromMap(payload, "requestedBy")},
				EmittedAt: time.Now().Format(time.RFC3339),
			})
			execution.submitLog("error", "能力重扫失败: %v", err)
			return false, "RESCAN_REPORT_FAILED", err.Error(), map[string]any{
				"executor":        "windows-go-agent-runtime",
				"mode":            "capability-rescan",
				"executionStepId": task.ExecutionStepID,
				"taskId":          task.ID,
				"requestedBy":     stringFromMap(payload, "requestedBy"),
			}
		}
		_ = submitRuntimeLog(execution.ctx, execution.client, execution.config, submitRuntimeLogRequest{
			AgentID:   execution.registration.AgentID,
			Category:  "manual_rescan",
			Level:     "info",
			Summary:   "manual capability rescan succeeded",
			Detail:    map[string]any{"taskId": task.ID, "requestedBy": stringFromMap(payload, "requestedBy")},
			EmittedAt: time.Now().Format(time.RFC3339),
		})
		execution.submitLog("info", "能力重扫完成")
		return true, "", "", map[string]any{
			"executor":        "windows-go-agent-runtime",
			"mode":            "capability-rescan",
			"executionStepId": task.ExecutionStepID,
			"taskId":          task.ID,
			"requestedBy":     stringFromMap(payload, "requestedBy"),
		}
	}
	if isWindowsIISDeploymentTask(task) {
		return runWindowsIISDeployment(execution)
	}
	return false, "UNSUPPORTED_TASK", "当前 Windows Go Agent 已切到 Go Runtime，但该任务类型尚未接入对应 Provider", map[string]any{
		"executor":        "windows-go-agent-runtime",
		"supportedModes":  []string{"dryRun", "agent.self_test", "windows.iis.deploy_certificate"},
		"executionStepId": task.ExecutionStepID,
		"taskId":          task.ID,
	}
}

func ackTask(ctx context.Context, client *http.Client, config *AgentConfig, agentID string, taskID string, leaseID string) (*agentTaskEnvelope, error) {
	request := ackTaskRequest{
		AgentID: agentID,
		TaskID:  taskID,
		LeaseID: leaseID,
	}
	var response agentTaskEnvelope
	if err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/tasks/ack", request, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

func submitTaskLog(ctx context.Context, client *http.Client, config *AgentConfig, request submitLogRequest) error {
	return doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/tasks/logs", request, nil)
}

func submitRuntimeLog(ctx context.Context, client *http.Client, config *AgentConfig, request submitRuntimeLogRequest) error {
	return doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/runtime-logs", request, nil)
}

func submitTaskResult(ctx context.Context, client *http.Client, config *AgentConfig, request submitResultRequest) (*agentTaskEnvelope, error) {
	var response agentTaskEnvelope
	if err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/tasks/result", request, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

func newLeaseID(taskID string) string {
	return fmt.Sprintf("lease_%s_%d", strings.ReplaceAll(taskID, "-", "_"), time.Now().UnixNano())
}

func mustGetTaskRecord(ledger *localTaskLedger, taskID string) localTaskRecord {
	record, ok := ledger.get(taskID)
	if !ok {
		panic("local task record not found: " + taskID)
	}
	return record
}

func boolFromMap(input map[string]any, key string) bool {
	value, ok := input[key]
	if !ok {
		return false
	}
	typed, _ := value.(bool)
	return typed
}

func stringFromMap(input map[string]any, key string) string {
	value, ok := input[key]
	if !ok {
		return ""
	}
	typed, _ := value.(string)
	return typed
}

func mapFromMap(input map[string]any, key string) map[string]any {
	value, ok := input[key]
	if !ok {
		return nil
	}
	typed, _ := value.(map[string]any)
	return typed
}

func collectNetworkInterfaces() ([]NetworkInterfaceInfo, string) {
	interfaces, err := net.Interfaces()
	if err != nil {
		return nil, ""
	}

	defaultRouteInterfaces := detectWindowsDefaultRouteInterfaces()
	result := make([]NetworkInterfaceInfo, 0, len(interfaces))
	for _, item := range interfaces {
		info := NetworkInterfaceInfo{
			Name:              item.Name,
			MACAddress:        item.HardwareAddr.String(),
			IsUp:              item.Flags&net.FlagUp != 0,
			IsLoopback:        item.Flags&net.FlagLoopback != 0,
			HasDefaultGateway: interfaceHasDefaultRoute(defaultRouteInterfaces, item.Name),
			LikelyVirtual:     isLikelyVirtualWindowsInterface(item.Name),
		}
		addrs, _ := item.Addrs()
		for _, addr := range addrs {
			ip := extractIP(addr)
			if ip == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			if ip.To4() != nil {
				value := ip.String()
				info.IPv4 = append(info.IPv4, value)
				continue
			}
			info.IPv6 = append(info.IPv6, ip.String())
		}
		sort.Strings(info.IPv4)
		sort.Strings(info.IPv6)
		result = append(result, info)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Name < result[j].Name
	})
	return result, selectPrimaryIPAddressWindows(result)
}

func selectPrimaryIPAddressWindows(items []NetworkInterfaceInfo) string {
	bestIPv4 := ""
	bestIPv4Score := -1 << 30
	bestIPv6 := ""
	bestIPv6Score := -1 << 30
	for _, item := range items {
		if !item.IsUp || item.IsLoopback {
			continue
		}
		score := scoreWindowsInterface(item)
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

func scoreWindowsInterface(item NetworkInterfaceInfo) int {
	score := 0
	if item.IsUp {
		score += 20
	}
	if item.HasDefaultGateway {
		score += 100
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

func detectWindowsDefaultRouteInterfaces() map[string]struct{} {
	results := make(map[string]struct{})
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", `
$rows = Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
  Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.InterfaceAlias) } |
  Select-Object -ExpandProperty InterfaceAlias -Unique
if ($null -eq $rows) { return }
$rows | ForEach-Object { [string]$_ }
`)
	output, err := command.CombinedOutput()
	if err != nil {
		return results
	}
	for _, line := range strings.Split(string(output), "\n") {
		name := strings.TrimSpace(line)
		if name == "" {
			continue
		}
		results[name] = struct{}{}
	}
	return results
}

func interfaceHasDefaultRoute(defaultRouteInterfaces map[string]struct{}, name string) bool {
	_, ok := defaultRouteInterfaces[name]
	return ok
}

func isLikelyVirtualWindowsInterface(name string) bool {
	lower := strings.ToLower(strings.TrimSpace(name))
	virtualPrefixes := []string{
		"docker", "vethernet", "vmnet", "vboxnet", "virbr", "vethernet", "npcap", "loopback",
		"zt", "tailscale", "wg", "tun", "tap", "podman", "lxc", "br-", "veth",
	}
	for _, prefix := range virtualPrefixes {
		if strings.HasPrefix(lower, prefix) {
			return true
		}
	}
	return false
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

func buildMachineID(hostname string) string {
	source := strings.TrimSpace(hostname) + "|" + strings.TrimSpace(os.Getenv("COMPUTERNAME")) + "|" + runtime.GOARCH
	sum := sha256.Sum256([]byte(source))
	return hex.EncodeToString(sum[:16])
}

func loadInstallMetadata(path string) (*InstallMetadata, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var metadata InstallMetadata
	if err := json.Unmarshal(content, &metadata); err != nil {
		return nil, err
	}
	return &metadata, nil
}

func serviceNameFromPath(configPath string) string {
	config, err := loadConfig(configPath)
	if err != nil || strings.TrimSpace(config.Service.Name) == "" {
		return "gcac-agent"
	}
	return config.Service.Name
}

func parseConfigPath(args []string) string {
	fs := flag.NewFlagSet("config", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	configPath := fs.String("config", defaultConfigPath, "")
	_ = fs.Parse(args)
	return *configPath
}

func parseLogPath(args []string) string {
	fs := flag.NewFlagSet("log", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	logPath := fs.String("log-file", "", "")
	_ = fs.Parse(args)
	return *logPath
}

func parseMetadataPath(args []string) string {
	fs := flag.NewFlagSet("metadata", flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	metadataPath := fs.String("metadata", defaultMetadata, "")
	_ = fs.Parse(args)
	return *metadataPath
}

func writeServiceLog(logPath string, message string) {
	line := fmt.Sprintf("%s %s\n", time.Now().Format(time.RFC3339), message)
	if strings.TrimSpace(logPath) == "" {
		return
	}
	_ = os.MkdirAll(filepath.Dir(logPath), 0o755)
	file, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = file.WriteString(line)
}

type runtimeLogger struct {
	logPath string
}

func newRuntimeLogger(logPath string) *runtimeLogger {
	return &runtimeLogger{logPath: logPath}
}

func (l *runtimeLogger) Info(format string, args ...any) {
	writeServiceLog(l.logPath, "[INFO] "+fmt.Sprintf(format, args...))
}

func (l *runtimeLogger) Warn(format string, args ...any) {
	writeServiceLog(l.logPath, "[WARN] "+fmt.Sprintf(format, args...))
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

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func allChecksPassed(checks []map[string]any) bool {
	for _, check := range checks {
		if success, ok := check["success"].(bool); ok && !success {
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
	request.Header.Set("X-Request-Id", fmt.Sprintf("windows_go_agent_%d", time.Now().UnixNano()))
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
		"GCAC Windows Go Full Agent",
		"",
		"用法:",
		"  gcac-agent inspect",
		"  gcac-agent self-check [--config=C:\\ProgramData\\GCAC\\FullAgentGo\\config\\agent.config.json]",
		"  gcac-agent health [--config=C:\\ProgramData\\GCAC\\FullAgentGo\\config\\agent.config.json]",
		"  gcac-agent status [--config=C:\\ProgramData\\GCAC\\FullAgentGo\\config\\agent.config.json]",
		"  gcac-agent register-once [--config=C:\\ProgramData\\GCAC\\FullAgentGo\\config\\agent.config.json]",
		"  gcac-agent service-info [--config=...] [--metadata=...]",
		"  gcac-agent run [--config=C:\\ProgramData\\GCAC\\FullAgentGo\\config\\agent.config.json]",
		"  gcac-agent service run [--config=...]",
		"  gcac-agent version",
	}
	fmt.Println(strings.Join(lines, "\n"))
}
