package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
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
	"unicode/utf16"
	"unsafe"
)

//go:embed config/agent.config.template.json
var defaultAgentConfigTemplate []byte

const (
	agentVersion                  = "0.1.17"
	defaultConfigPath             = `C:\ProgramData\GCAC\FullAgentGo\config\agent.config.json`
	defaultMetadata               = `C:\ProgramData\GCAC\FullAgentGo\service.install.json`
	defaultTaskPoll               = 60
	defaultHealthPoll             = 30
	defaultOfflineTTL             = 180
	defaultManagementPort         = 18930
	directWebDiscoveryTimeout     = 90 * time.Second
	windowsDiscoveryScanTimeout   = 75 * time.Second
	windowsDiscoveryVisitLimit    = 5000
	windowsDiscoveryReadFileLimit = 256
)

type AgentConfig struct {
	SchemaVersion              string            `json:"schemaVersion"`
	TenantID                   string            `json:"tenantId"`
	AgentKey                   string            `json:"agentKey"`
	EnrollmentToken            string            `json:"enrollmentToken"`
	Role                       string            `json:"role"`
	GatewayEnabled             bool              `json:"gatewayEnabled"`
	Zone                       string            `json:"zone"`
	ControlPlane               string            `json:"controlPlaneUrl"`
	Heartbeat                  int               `json:"heartbeatIntervalSeconds"`
	TaskPollIntervalSeconds    int               `json:"taskPollIntervalSeconds"`
	HealthCheckIntervalSeconds int               `json:"healthCheckIntervalSeconds"`
	OfflineTimeoutSeconds      int               `json:"offlineTimeoutSeconds"`
	ManagementListenAddress    string            `json:"managementListenAddress"`
	ManagementPort             int               `json:"managementPort"`
	AuthorizationMaterialPath  string            `json:"authorizationMaterialPath"`
	AuthorizationTrustKeySet   map[string]string `json:"authorizationTrustKeySet"`
	Paths                      struct {
		Windows struct {
			ConfigPath     string   `json:"configPath"`
			DataDir        string   `json:"dataDir"`
			LogDir         string   `json:"logDir"`
			InventoryPaths []string `json:"inventoryPaths"`
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
	AgentKey           string   `json:"agentKey"`
	MachineID          string   `json:"machineId,omitempty"`
	Hostname           string   `json:"hostname"`
	Version            string   `json:"version"`
	OSType             string   `json:"osType"`
	Arch               string   `json:"arch,omitempty"`
	IPAddress          string   `json:"ipAddress,omitempty"`
	ManagementEndpoint string   `json:"managementEndpoint,omitempty"`
	OSVersion          string   `json:"osVersion,omitempty"`
	Labels             []string `json:"labels,omitempty"`
	EnrollmentToken    string   `json:"enrollmentToken,omitempty"`
	Role               string   `json:"role,omitempty"`
	Zone               string   `json:"zone,omitempty"`
	ZoneIDs            []string `json:"zoneIds,omitempty"`
	Adapters           []string `json:"adapters,omitempty"`
	Capabilities       []string `json:"capabilities,omitempty"`
}

type registerResponse struct {
	ID            string                  `json:"id"`
	TrustMaterial *agentTrustMaterialWire `json:"trustMaterial,omitempty"`
}

// 控制面只下发公钥和已签名的本地策略，私钥始终留在 Policy Authority。
type agentTrustMaterialWire struct {
	MaterialVersion           string               `json:"materialVersion"`
	IssuedAt                  string               `json:"issuedAt"`
	ValidUntil                string               `json:"validUntil"`
	CapabilityKeySet          map[string]string    `json:"capabilityKeySet"`
	PolicyAuthorityKeySet     map[string]string    `json:"policyAuthorityKeySet"`
	LocalPolicy               agentLocalPolicyWire `json:"localPolicy"`
	LocalPolicyAuthorityKeyID string               `json:"localPolicyAuthorityKeyId"`
	LocalPolicySignature      string               `json:"localPolicySignature"`
}

type agentLocalPolicyWire struct {
	PolicyVersion   string   `json:"policyVersion"`
	AgentID         string   `json:"agentId"`
	AuthorityKeyIDs []string `json:"authorityKeyIds"`
	AllowedActions  []string `json:"allowedActions"`
	PathRules       []struct {
		Prefix     string   `json:"prefix"`
		Operations []string `json:"operations"`
	} `json:"pathRules"`
	ServiceRules []string `json:"serviceRules"`
	CommandRules []any    `json:"commandRules"`
	Disabled     bool     `json:"disabled"`
	UpdatedAt    string   `json:"updatedAt"`
}

var agentTrustMaterialState = struct {
	mu       sync.RWMutex
	material *agentTrustMaterialWire
}{}

type heartbeatRequest struct {
	AgentID            string                  `json:"agentId"`
	Version            string                  `json:"version"`
	ManagementEndpoint string                  `json:"managementEndpoint,omitempty"`
	Adapters           []string                `json:"adapters,omitempty"`
	Capabilities       []string                `json:"capabilities,omitempty"`
	RuntimeHealth      *heartbeatRuntimeHealth `json:"runtimeHealth,omitempty"`
	TaskSummary        struct {
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
}

type runtimeFailureCounts struct {
	Heartbeat int `json:"heartbeat,omitempty"`
	TaskPoll  int `json:"taskPoll,omitempty"`
	Recovery  int `json:"recovery,omitempty"`
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

// directDiscoveryResponse 是管理端口唯一允许执行的直接操作返回值。
// 重新发现没有写效果，但仍必须经过 Agent v2 的签名授权校验。
type directDiscoveryResponse struct {
	Success      bool           `json:"success"`
	ErrorCode    string         `json:"errorCode,omitempty"`
	ErrorMessage string         `json:"errorMessage,omitempty"`
	Detail       map[string]any `json:"detail,omitempty"`
}

type directDiscoveryController struct {
	mu     sync.Mutex
	active bool
	last   directDiscoveryResponse
	lastAt time.Time
}

func (controller *directDiscoveryController) execute(ctx context.Context, run func(context.Context) directDiscoveryResponse) directDiscoveryResponse {
	controller.mu.Lock()
	if controller.active {
		if controller.lastAt.After(time.Now().Add(-5 * time.Minute)) && controller.last.Success {
			result := controller.last
			result.Detail = cloneMap(result.Detail)
			if result.Detail == nil {
				result.Detail = map[string]any{}
			}
			result.Detail["reusedCompletedAt"] = controller.lastAt.UTC().Format(time.RFC3339Nano)
			result.Detail["scanState"] = "running_reused_last_success"
			controller.mu.Unlock()
			return result
		}
		controller.mu.Unlock()
		return directDiscoveryResponse{
			ErrorCode:    "AGENT_DIRECT_DISCOVERY_IN_PROGRESS",
			ErrorMessage: "Agent Web 重新扫描正在进行中，请稍后查看最新发现结果",
		}
	}
	controller.active = true
	controller.mu.Unlock()

	result := run(ctx)
	controller.mu.Lock()
	controller.active = false
	if result.Success {
		controller.last = result
		controller.lastAt = time.Now()
	}
	controller.mu.Unlock()
	return result
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

type enqueueAgentTaskRequest struct {
	AgentID         string         `json:"agentId"`
	ExecutionRunID  string         `json:"executionRunId"`
	ExecutionStepID string         `json:"executionStepId"`
	IdempotencyKey  string         `json:"idempotencyKey"`
	Payload         map[string]any `json:"payload,omitempty"`
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
	SchemaVersion                string          `json:"schemaVersion"`
	UpdatedAt                    string          `json:"updatedAt"`
	State                        string          `json:"state"`
	StartedAt                    string          `json:"startedAt,omitempty"`
	StoppedAt                    string          `json:"stoppedAt,omitempty"`
	AgentID                      string          `json:"agentId,omitempty"`
	ServiceName                  string          `json:"serviceName,omitempty"`
	LastHeartbeatAt              string          `json:"lastHeartbeatAt,omitempty"`
	LastTaskPollAt               string          `json:"lastTaskPollAt,omitempty"`
	LastTaskResultAt             string          `json:"lastTaskResultAt,omitempty"`
	LastRecoveryAt               string          `json:"lastRecoveryAt,omitempty"`
	LastSelfCheckAt              string          `json:"lastSelfCheckAt,omitempty"`
	LastError                    string          `json:"lastError,omitempty"`
	ConsecutiveHeartbeatFailures int             `json:"consecutiveHeartbeatFailures"`
	ConsecutiveTaskPollFailures  int             `json:"consecutiveTaskPollFailures"`
	ConsecutiveRecoveryFailures  int             `json:"consecutiveRecoveryFailures"`
	PendingResultCount           int             `json:"pendingResultCount"`
	RecoverableTaskCount         int             `json:"recoverableTaskCount"`
	TaskCounters                 runtimeCounters `json:"taskCounters"`
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
	if err := loadPersistedAgentTrustMaterial(config); err != nil {
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
	config, err := loadConfig(configPath)
	if err != nil {
		return err
	}
	if strings.TrimSpace(logPath) == "" {
		logPath = filepath.Join(config.Paths.Windows.LogDir, "agent.log")
	}
	program := &serviceProgram{
		configPath: configPath,
		logPath:    logPath,
	}
	return runWindowsService(serviceNameFromConfig(config), program)
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
	if err := loadPersistedAgentTrustMaterial(config); err != nil {
		return err
	}

	heartbeat := effectiveHeartbeatSeconds(config)
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
	registration, err := registerAgentWithRetry(ctx, client, config, identity, logger)
	if err != nil {
		return err
	}
	logger.Info("agent registered agentId=%s hostname=%s", registration.AgentID, registration.Hostname)
	directDiscovery := &directDiscoveryController{}
	managementServer, _, err := startManagementServer(config, identity, func(requestCtx context.Context, payload map[string]any) directDiscoveryResponse {
		return directDiscovery.execute(requestCtx, func(scanCtx context.Context) directDiscoveryResponse {
			return executeDirectWebDiscovery(scanCtx, client, config, registration, payload, logger)
		})
	})
	if err != nil {
		return err
	}
	defer managementServer.Shutdown(context.Background())

	deps, err := loadRuntimeDependencies(config)
	if err != nil {
		return err
	}
	if err := configurePersistentAgentNonceStore(filepath.Join(config.Paths.Windows.DataDir, "ledger", "agent-v2-nonces")); err != nil {
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
	counters := &runtimeCounters{}
	heartbeatTicker := time.NewTicker(time.Duration(heartbeat) * time.Second)
	defer heartbeatTicker.Stop()
	taskTicker := time.NewTicker(time.Duration(taskPollSeconds) * time.Second)
	defer taskTicker.Stop()
	healthTicker := time.NewTicker(time.Duration(healthCheckSeconds) * time.Second)
	defer healthTicker.Stop()
	startCapabilityReportWorker(ctx, client, config, registration, identity, maxInt(taskPollSeconds, 60), logger)

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

func startCapabilityReportWorker(
	ctx context.Context,
	client *http.Client,
	config *AgentConfig,
	registration *runtimeRegistration,
	identity runtimeIdentity,
	intervalSeconds int,
	logger *runtimeLogger,
) {
	go func() {
		runCapabilityReport := func(phase string) {
			requestCtx, cancel := context.WithTimeout(ctx, directWebDiscoveryTimeout)
			defer cancel()
			if err := reportCapabilitiesWithScanLog(requestCtx, client, config, registration, identity, logger); err != nil {
				logger.Warn("%s capability report failed: %v", phase, err)
				_ = submitRuntimeLog(ctx, client, config, submitRuntimeLogRequest{
					AgentID:   registration.AgentID,
					Category:  "capability_report",
					Level:     "error",
					Summary:   phase + " capability report failed",
					Detail:    map[string]any{"error": err.Error(), "phase": phase},
					EmittedAt: time.Now().Format(time.RFC3339),
				})
				return
			}
			logger.Info("%s capability report ok agentId=%s", phase, registration.AgentID)
		}

		runCapabilityReport("initial")
		ticker := time.NewTicker(time.Duration(maxInt(intervalSeconds, 60)) * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runCapabilityReport("periodic")
			}
		}
	}()
}

func registerAgentWithRetry(ctx context.Context, client *http.Client, config *AgentConfig, identity runtimeIdentity, logger *runtimeLogger) (*runtimeRegistration, error) {
	for attempt := 0; ; attempt++ {
		requestCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
		registration, err := registerAgent(requestCtx, client, config, identity)
		cancel()
		if err == nil {
			return registration, nil
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		if logger != nil {
			logger.Warn("agent registration failed attempt=%d: %v; retrying", attempt+1, err)
		}
		delay := time.Duration(5*(1<<minInt(attempt, 3))) * time.Second
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			if !timer.Stop() {
				<-timer.C
			}
			return nil, ctx.Err()
		case <-timer.C:
		}
	}
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
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

func resolveAgentTrustMaterialPath(config *AgentConfig) string {
	if configured := strings.TrimSpace(config.AuthorizationMaterialPath); configured != "" {
		return configured
	}
	dataDir := strings.TrimSpace(config.Paths.Windows.DataDir)
	if dataDir == "" {
		return `C:\ProgramData\GCAC\FullAgentGo\data\policy\agent-trust-material.json`
	}
	return filepath.Join(dataDir, "policy", "agent-trust-material.json")
}

func persistAgentTrustMaterial(config *AgentConfig, agentID string, material *agentTrustMaterialWire) error {
	if material == nil {
		return errors.New("控制面未返回 Agent 授权材料")
	}
	if err := validateAgentTrustMaterial(config, agentID, material); err != nil {
		return err
	}
	path := resolveAgentTrustMaterialPath(config)
	if !filepath.IsAbs(path) {
		return errors.New("Agent 授权材料路径必须是绝对路径")
	}
	encoded, err := json.Marshal(material)
	if err != nil {
		return fmt.Errorf("编码 Agent 授权材料失败: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("创建 Agent 授权材料目录失败: %w", err)
	}
	temporary := fmt.Sprintf("%s.tmp-%d", path, os.Getpid())
	if err := os.WriteFile(temporary, append(encoded, '\n'), 0o600); err != nil {
		return fmt.Errorf("写入 Agent 授权材料临时文件失败: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("替换 Agent 授权材料失败: %w", err)
	}
	return loadPersistedAgentTrustMaterial(config)
}

func loadPersistedAgentTrustMaterial(config *AgentConfig) error {
	path := resolveAgentTrustMaterialPath(config)
	content, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			// 首次注册由控制面下发材料；已有材料则必须在启动时重新验签。
			return nil
		}
		return fmt.Errorf("读取 Agent 授权材料失败: %w", err)
	}
	var material agentTrustMaterialWire
	if err := json.Unmarshal(content, &material); err != nil {
		return fmt.Errorf("解析 Agent 授权材料失败: %w", err)
	}
	if err := validateAgentTrustMaterial(config, material.LocalPolicy.AgentID, &material); err != nil {
		return err
	}
	setAgentTrustMaterial(&material)
	return nil
}

func setAgentTrustMaterial(material *agentTrustMaterialWire) {
	agentTrustMaterialState.mu.Lock()
	defer agentTrustMaterialState.mu.Unlock()
	if material == nil {
		agentTrustMaterialState.material = nil
		return
	}
	cloned := *material
	cloned.CapabilityKeySet = cloneStringMap(material.CapabilityKeySet)
	cloned.PolicyAuthorityKeySet = cloneStringMap(material.PolicyAuthorityKeySet)
	agentTrustMaterialState.material = &cloned
}

func currentAgentTrustMaterial() *agentTrustMaterialWire {
	agentTrustMaterialState.mu.RLock()
	defer agentTrustMaterialState.mu.RUnlock()
	if agentTrustMaterialState.material == nil {
		return nil
	}
	cloned := *agentTrustMaterialState.material
	cloned.CapabilityKeySet = cloneStringMap(agentTrustMaterialState.material.CapabilityKeySet)
	cloned.PolicyAuthorityKeySet = cloneStringMap(agentTrustMaterialState.material.PolicyAuthorityKeySet)
	return &cloned
}

func validateAgentTrustMaterial(config *AgentConfig, agentID string, material *agentTrustMaterialWire) error {
	if material == nil || material.MaterialVersion != "gcac.agent-trust-material/v1" ||
		strings.TrimSpace(agentID) == "" ||
		material.LocalPolicy.AgentID != agentID ||
		material.LocalPolicy.PolicyVersion != agentSecurityContract ||
		material.LocalPolicyAuthorityKeyID == "" ||
		material.LocalPolicySignature == "" ||
		len(material.CapabilityKeySet) == 0 ||
		len(material.PolicyAuthorityKeySet) == 0 {
		return errors.New("Agent 授权材料缺失必要字段")
	}
	issuedAt, issuedErr := time.Parse(time.RFC3339Nano, material.IssuedAt)
	validUntil, validErr := time.Parse(time.RFC3339Nano, material.ValidUntil)
	if issuedErr != nil || validErr != nil || !validUntil.After(issuedAt) || !time.Now().Before(validUntil) {
		return errors.New("Agent 授权材料已过期或时间窗无效")
	}
	if !containsString(material.LocalPolicy.AuthorityKeyIDs, material.LocalPolicyAuthorityKeyID) {
		return errors.New("Agent 本地策略未信任签发 Key")
	}
	trustedKey, ok := config.AuthorizationTrustKeySet[material.LocalPolicyAuthorityKeyID]
	if !ok || strings.TrimSpace(trustedKey) == "" {
		return errors.New("Agent 安装配置未固定本地策略签发 Key")
	}
	if err := verifyTrustMaterialSignature(material.LocalPolicyAuthorityKeyID, material.LocalPolicySignature, localPolicyWithoutSignature(material.LocalPolicy), config.AuthorizationTrustKeySet); err != nil {
		return fmt.Errorf("Agent 本地策略签名无效: %w", err)
	}
	if !sameStringMap(material.CapabilityKeySet, config.AuthorizationTrustKeySet) ||
		!sameStringMap(material.PolicyAuthorityKeySet, config.AuthorizationTrustKeySet) {
		return errors.New("Agent 授权材料 KeySet 与安装信任根不匹配")
	}
	return nil
}

func verifyTrustMaterialSignature(keyID, signature string, value any, keySet map[string]string) error {
	encodedKey, ok := keySet[keyID]
	if !ok {
		return errors.New("本地策略签发 Key 未配置")
	}
	publicKey, err := base64.StdEncoding.DecodeString(encodedKey)
	if err != nil || len(publicKey) != ed25519.PublicKeySize {
		return errors.New("本地策略签发 Key 无效")
	}
	signed, err := base64.RawURLEncoding.DecodeString(signature)
	if err != nil {
		signed, err = base64.StdEncoding.DecodeString(signature)
	}
	if err != nil || !ed25519.Verify(ed25519.PublicKey(publicKey), canonicalJSON(value), signed) {
		return errors.New("signature verification failed")
	}
	return nil
}

func localPolicyWithoutSignature(policy agentLocalPolicyWire) map[string]any {
	// Node 控制面按对象键的字典序规范化 JSON；结构体字段顺序会导致跨语言签名不一致。
	pathRules := make([]map[string]any, 0, len(policy.PathRules))
	for _, rule := range policy.PathRules {
		pathRules = append(pathRules, map[string]any{
			"operations": rule.Operations,
			"prefix":     rule.Prefix,
		})
	}
	return map[string]any{
		"policyVersion":   policy.PolicyVersion,
		"agentId":         policy.AgentID,
		"authorityKeyIds": policy.AuthorityKeyIDs,
		"allowedActions":  policy.AllowedActions,
		"pathRules":       pathRules,
		"serviceRules":    policy.ServiceRules,
		"commandRules":    policy.CommandRules,
		"disabled":        policy.Disabled,
		"updatedAt":       policy.UpdatedAt,
	}
}

func sameStringMap(left, right map[string]string) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if right[key] != value {
			return false
		}
	}
	return true
}

func cloneStringMap(input map[string]string) map[string]string {
	cloned := make(map[string]string, len(input))
	for key, value := range input {
		cloned[key] = value
	}
	return cloned
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
	return 10
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

func effectiveManagementListenAddress(config *AgentConfig) string {
	if value := strings.TrimSpace(config.ManagementListenAddress); value != "" {
		return value
	}
	return "0.0.0.0"
}

func effectiveManagementPort(config *AgentConfig) int {
	if config.ManagementPort > 0 && config.ManagementPort <= 65535 {
		return config.ManagementPort
	}
	return defaultManagementPort
}

func managementEndpointForIdentity(identity runtimeIdentity, config *AgentConfig) string {
	host := strings.TrimSpace(identity.PrimaryIPAddress)
	if host == "" {
		host, _ = os.Hostname()
	}
	if host == "" {
		host = "127.0.0.1"
	}
	return fmt.Sprintf("http://%s", net.JoinHostPort(host, fmt.Sprintf("%d", effectiveManagementPort(config))))
}

func startManagementServer(
	config *AgentConfig,
	identity runtimeIdentity,
	executeDiscovery func(context.Context, map[string]any) directDiscoveryResponse,
) (*http.Server, string, error) {
	listenAddress := net.JoinHostPort(effectiveManagementListenAddress(config), fmt.Sprintf("%d", effectiveManagementPort(config)))
	listener, err := net.Listen("tcp", listenAddress)
	if err != nil {
		return nil, "", fmt.Errorf("管理 TCP 监听启动失败 %s: %w", listenAddress, err)
	}
	server := &http.Server{
		ReadHeaderTimeout: 5 * time.Second,
		WriteTimeout:      directWebDiscoveryTimeout,
		Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
			if request.Method == http.MethodGet && (request.URL.Path == "/api/v1/control/health" || request.URL.Path == "/healthz") {
				writer.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(writer).Encode(map[string]any{"success": true, "status": "healthy", "agentVersion": agentVersion})
				return
			}
			if request.Method != http.MethodPost || request.URL.Path != "/api/v1/control/discovery" {
				writer.Header().Set("Allow", "GET, POST")
				http.Error(writer, "management endpoint only supports health checks and direct web discovery", http.StatusNotFound)
				return
			}
			if executeDiscovery == nil {
				writeDirectDiscoveryResponse(writer, http.StatusServiceUnavailable, directDiscoveryResponse{
					ErrorCode: "AGENT_DIRECT_DISCOVERY_UNAVAILABLE", ErrorMessage: "Agent 运行时尚未完成注册",
				})
				return
			}
			defer request.Body.Close()
			var payload map[string]any
			decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 1<<20))
			if err := decoder.Decode(&payload); err != nil || payload == nil {
				writeDirectDiscoveryResponse(writer, http.StatusBadRequest, directDiscoveryResponse{
					ErrorCode: "AGENT_DIRECT_DISCOVERY_INVALID", ErrorMessage: "直接重新发现请求不是有效 JSON",
				})
				return
			}
			requestCtx, cancel := context.WithTimeout(request.Context(), directWebDiscoveryTimeout)
			defer cancel()
			result := executeDiscovery(requestCtx, payload)
			if requestCtx.Err() == context.DeadlineExceeded && !result.Success && result.ErrorCode == "" {
				result = directDiscoveryResponse{
					ErrorCode:    "AGENT_DIRECT_DISCOVERY_TIMEOUT",
					ErrorMessage: "Agent Web 重新扫描超过 90 秒，已取消本次请求",
				}
			}
			writeDirectDiscoveryResponse(writer, directDiscoveryHTTPStatus(result), result)
		}),
	}
	go func() { _ = server.Serve(listener) }()
	host := strings.TrimSpace(identity.PrimaryIPAddress)
	if host == "" {
		host = "127.0.0.1"
	}
	return server, fmt.Sprintf("http://%s", net.JoinHostPort(host, fmt.Sprintf("%d", effectiveManagementPort(config)))), nil
}

func writeDirectDiscoveryResponse(writer http.ResponseWriter, status int, response directDiscoveryResponse) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(response)
}

func directDiscoveryHTTPStatus(response directDiscoveryResponse) int {
	if response.Success {
		return http.StatusOK
	}
	switch response.ErrorCode {
	case "AGENT_DIRECT_DISCOVERY_IN_PROGRESS":
		return http.StatusConflict
	case "AGENT_DIRECT_DISCOVERY_TIMEOUT":
		return http.StatusGatewayTimeout
	default:
		return http.StatusBadRequest
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
	state := collectRuntimeStateBase(controlPlaneURL)
	state.WindowsVersion = runtime.GOOS
	return state
}

func collectRuntimeStateBase(controlPlaneURL string) RuntimeState {
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
	state.Interfaces, state.PrimaryIPAddress = collectNetworkInterfaces()
	if preferredIP := detectPreferredSourceIP(controlPlaneURL); preferredIP != "" {
		state.PrimaryIPAddress = preferredIP
	}
	return state
}

func collectRuntimeIdentity(controlPlaneURL string) runtimeIdentity {
	state := collectRuntimeStateBase(controlPlaneURL)
	adapterSnapshot := collectWindowsAdapterSnapshot(newRuntimeLogger(""))
	state.WindowsVersion = runtime.GOOS
	return runtimeIdentity{
		MachineID:         state.MachineID,
		PrimaryIPAddress:  state.PrimaryIPAddress,
		WindowsVersion:    state.WindowsVersion,
		NetworkInterfaces: state.Interfaces,
		AdapterSnapshot:   adapterSnapshot,
	}
}

func collectCapabilityReports(identity runtimeIdentity) []reportedCapability {
	return collectCapabilityReportsWithConfiguredInventory(identity, nil, nil)
}

func collectCapabilityReportsWithInventory(identity runtimeIdentity, inventory map[string]any) []reportedCapability {
	return collectCapabilityReportsWithConfiguredInventory(identity, nil, inventory)
}

func collectCapabilityReportsWithConfiguredInventory(identity runtimeIdentity, config *AgentConfig, inventory map[string]any) []reportedCapability {
	if inventory == nil {
		inventory = collectWindowsWebInventory(context.Background(), config)
	}
	return []reportedCapability{
		{
			CapabilityKey: "windows.os.detail",
			Value: map[string]any{
				"goos": runtime.GOOS, "goarch": runtime.GOARCH, "osVersion": identity.WindowsVersion,
				"machineId": identity.MachineID, "primaryIp": identity.PrimaryIPAddress,
				"runtime": "go", "hostType": "windows-service", "agentModel": "full-agent",
			},
			Confidence: 0.98, Evidence: map[string]any{"source": "runtime-inspection"},
		},
		{
			CapabilityKey: "windows.network.adapters", Value: identity.NetworkInterfaces,
			Confidence: 0.92, Evidence: map[string]any{"source": "runtime-inspection"},
		},
		{
			CapabilityKey: "web.inventory",
			Value:         inventory,
			Confidence:    0.8, Evidence: map[string]any{"source": "agent-v2-generic-inventory"},
		},
	}
}

func collectWindowsWebInventory(ctx context.Context, config *AgentConfig, discoverySpecs ...agentDiscoverySpecV1) map[string]any {
	return collectWindowsWebInventoryWithLogger(ctx, config, nil, discoverySpecs...)
}

// 周期库存只做受控事实刷新。完整产品语法解析由宿主插件完成，Agent 不再扫全局目录。
func collectWindowsWebInventoryWithLogger(ctx context.Context, config *AgentConfig, logger *runtimeLogger, discoverySpecs ...agentDiscoverySpecV1) map[string]any {
	started := time.Now()
	scanCtx, cancel := context.WithTimeout(ctx, windowsDiscoveryScanTimeout)
	defer cancel()
	budget := newWindowsDiscoveryBudget(scanCtx, windowsDiscoveryVisitLimit)
	phaseDurations := map[string]int64{}
	timed := func(phase string, run func()) {
		phaseStarted := time.Now()
		run()
		phaseDurations[phase] = time.Since(phaseStarted).Milliseconds()
	}

	discoverySpec := agentDiscoverySpecV1{}
	if len(discoverySpecs) > 0 {
		discoverySpec = sanitizeAgentDiscoverySpec(discoverySpecs[0])
	}
	roots := configuredWindowsInventoryRoots(config)
	listeningPorts := []map[string]any{}
	processFacts := []map[string]any{}
	serviceFacts := []map[string]any{}
	configFiles := []map[string]any{}
	certificateFiles := []map[string]any{}
	sslBindings := []map[string]any{}

	timed("ports", func() {
		listeningPorts = collectWindowsListeningPorts(scanCtx)
	})
	timed("processes", func() {
		processFacts = collectWindowsProcesses(scanCtx, listeningPorts)
	})
	timed("services", func() {
		serviceFacts = collectWindowsDiscoveryServices(scanCtx, discoverySpec)
	})
	timed("config", func() {
		configFiles = collectWindowsWebConfigFiles(scanCtx, budget, roots)
		configFiles = append(configFiles, collectWindowsProcessConfigFiles(scanCtx, budget, processFacts)...)
		configFiles = append(configFiles, collectWindowsDiscoveryConfigFiles(scanCtx, discoverySpec, processFacts, serviceFacts)...)
	})
	timed("certificates", func() {
		certificateFiles = collectWindowsCertificateFiles(scanCtx, budget, roots)
		certificateFiles = append(certificateFiles, collectWindowsProcessCertificateFiles(scanCtx, budget, processFacts)...)
		certificateFiles = append(certificateFiles, collectWindowsDiscoveryCertificateFiles(scanCtx, discoverySpec, processFacts, serviceFacts)...)
		certificateFiles = append(certificateFiles, collectWindowsCertificateFilesFromConfigFiles(discoverySpec, configFiles)...)
		sslBindings = collectWindowsSSLCertificateBindings(scanCtx)
	})
	if logger != nil {
		logger.Info(
			"web inventory scan completed totalMs=%d portsMs=%d processesMs=%d servicesMs=%d configMs=%d certificatesMs=%d roots=%d visited=%d stopped=%t stopReason=%s processes=%d services=%d configFiles=%d certificateFiles=%d sslBindings=%d",
			time.Since(started).Milliseconds(),
			phaseDurations["ports"],
			phaseDurations["processes"],
			phaseDurations["services"],
			phaseDurations["config"],
			phaseDurations["certificates"],
			len(roots),
			budget.visitedCount(),
			budget.stopped(),
			budget.stopReason(),
			len(processFacts),
			len(serviceFacts),
			len(configFiles),
			len(certificateFiles),
			len(sslBindings),
		)
	}
	return map[string]any{
		"processes":              processFacts,
		"processExecutables":     processExecutablePaths(processFacts),
		"services":               serviceFacts,
		"listeningPorts":         listeningPorts,
		"sslCertificateBindings": sslBindings,
		"configFiles":            configFiles,
		"certificateFiles":       certificateFiles,
	}
}

func configuredWindowsInventoryRoots(config *AgentConfig) []string {
	paths := []string{}
	if config != nil {
		paths = append(paths, config.Paths.Windows.InventoryPaths...)
	}
	seen := map[string]struct{}{}
	result := make([]string, 0, len(paths))
	for _, path := range paths {
		path = strings.TrimSpace(path)
		if path == "" || isBlockedWindowsInventoryRoot(path) {
			continue
		}
		key := strings.ToLower(filepath.Clean(path))
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, path)
	}
	return result
}

func isBlockedWindowsInventoryRoot(path string) bool {
	normalized := strings.TrimRight(strings.ToLower(filepath.Clean(path)), `\/`)
	blocked := []string{
		`c:\programdata`,
		`c:\program files`,
		`c:\program files (x86)`,
		`c:\windows`,
		`c:\`,
	}
	for _, item := range blocked {
		if normalized == strings.TrimRight(strings.ToLower(filepath.Clean(item)), `\/`) {
			return true
		}
	}
	return false
}

type windowsDiscoveryBudget struct {
	ctx        context.Context
	maxVisits int
	mu         sync.Mutex
	visits     int
	stop       bool
	reason     string
}

func newWindowsDiscoveryBudget(ctx context.Context, maxVisits int) *windowsDiscoveryBudget {
	if ctx == nil {
		ctx = context.Background()
	}
	if maxVisits <= 0 {
		maxVisits = windowsDiscoveryVisitLimit
	}
	return &windowsDiscoveryBudget{ctx: ctx, maxVisits: maxVisits}
}

func (budget *windowsDiscoveryBudget) visit() error {
	if budget == nil {
		return nil
	}
	budget.mu.Lock()
	defer budget.mu.Unlock()
	if err := budget.ctx.Err(); err != nil {
		budget.stop = true
		if budget.reason == "" {
			if errors.Is(err, context.DeadlineExceeded) {
				budget.reason = "扫描超过期限"
			} else {
				budget.reason = "请求已取消"
			}
		}
		return err
	}
	if budget.visits >= budget.maxVisits {
		budget.stop = true
		if budget.reason == "" {
			budget.reason = "扫描访问条目超过上限"
		}
		return filepath.SkipAll
	}
	budget.visits++
	return nil
}

func (budget *windowsDiscoveryBudget) stopped() bool {
	if budget == nil {
		return false
	}
	budget.mu.Lock()
	defer budget.mu.Unlock()
	if err := budget.ctx.Err(); err != nil {
		budget.stop = true
		if budget.reason == "" {
			if errors.Is(err, context.DeadlineExceeded) {
				budget.reason = "扫描超过期限"
			} else {
				budget.reason = "请求已取消"
			}
		}
	}
	return budget.stop
}

func (budget *windowsDiscoveryBudget) stopReason() string {
	if budget == nil {
		return ""
	}
	budget.mu.Lock()
	defer budget.mu.Unlock()
	return budget.reason
}

func (budget *windowsDiscoveryBudget) visitedCount() int {
	if budget == nil {
		return 0
	}
	budget.mu.Lock()
	defer budget.mu.Unlock()
	return budget.visits
}

func discoveryBudgetStopped(ctx context.Context, budget *windowsDiscoveryBudget) bool {
	if ctx != nil && ctx.Err() != nil {
		if budget != nil {
			_ = budget.visit()
		}
		return true
	}
	return budget != nil && budget.stopped()
}

// 只读取配置声明的受控目录中的原始配置；控制面会再次校验并完成最终资产投影。
func collectWindowsWebConfigFiles(ctx context.Context, budget *windowsDiscoveryBudget, roots []string) []map[string]any {
	files := make([]map[string]any, 0, 128)
	seen := make(map[string]struct{})
	for _, root := range roots {
		if discoveryBudgetStopped(ctx, budget) {
			break
		}
		if _, exists := seen[strings.ToLower(root)]; exists {
			continue
		}
		seen[strings.ToLower(root)] = struct{}{}
		if info, err := os.Stat(root); err == nil && !info.IsDir() {
			if item := collectWebConfigFile(root); item != nil {
				files = append(files, item)
			}
			continue
		}
		_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
			if len(files) >= windowsDiscoveryReadFileLimit || discoveryBudgetStopped(ctx, budget) {
				return filepath.SkipAll
			}
			if budget != nil {
				if err := budget.visit(); err != nil {
					return filepath.SkipAll
				}
			}
			if walkErr != nil || entry == nil || entry.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(path))
			if ext != ".conf" && ext != ".xml" && ext != ".properties" && ext != ".config" {
				return nil
			}
			info, err := entry.Info()
			if err != nil || info.Size() > 256*1024 {
				return nil
			}
			if item := collectWebConfigFile(path); item != nil {
				files = append(files, item)
			}
			return nil
		})
		if len(files) >= windowsDiscoveryReadFileLimit || discoveryBudgetStopped(ctx, budget) {
			break
		}
	}
	return files
}

// 从监听端口关联到进程镜像后，只在镜像目录附近读取有限数量的配置文件。
// 这里不解析产品语法，也不按端口号猜测框架；宿主插件仍是唯一解析入口。
func collectWindowsProcessConfigFiles(ctx context.Context, budget *windowsDiscoveryBudget, processFacts []map[string]any) []map[string]any {
	files := make([]map[string]any, 0, 64)
	seen := make(map[string]struct{})
	for _, process := range processFacts {
		if discoveryBudgetStopped(ctx, budget) {
			break
		}
		for _, root := range windowsProcessDiscoveryRoots(ctx, process) {
			for depth := 0; depth < 3 && root != ""; depth++ {
				for _, candidateRoot := range []string{root, filepath.Join(root, "conf"), filepath.Join(root, "config"), filepath.Join(root, "..", "conf"), filepath.Join(root, "..", "config")} {
					if len(files) >= 128 || discoveryBudgetStopped(ctx, budget) {
						return files
					}
					info, err := os.Stat(candidateRoot)
					if err != nil || !info.IsDir() {
						continue
					}
					_ = filepath.WalkDir(candidateRoot, func(candidate string, entry os.DirEntry, walkErr error) error {
						if len(files) >= 128 || discoveryBudgetStopped(ctx, budget) {
							return filepath.SkipAll
						}
						if budget != nil {
							if err := budget.visit(); err != nil {
								return filepath.SkipAll
							}
						}
						if walkErr != nil || entry == nil {
							return nil
						}
						if entry.IsDir() {
							if strings.Count(strings.TrimPrefix(candidate, candidateRoot), string(os.PathSeparator)) > 2 {
								return filepath.SkipDir
							}
							return nil
						}
						ext := strings.ToLower(filepath.Ext(candidate))
						if ext != ".conf" && ext != ".xml" && ext != ".properties" && ext != ".config" {
							return nil
						}
						key := strings.ToLower(filepath.Clean(candidate))
						if _, exists := seen[key]; exists {
							return nil
						}
						if item := collectWebConfigFile(candidate); item != nil {
							seen[key] = struct{}{}
							files = append(files, item)
						}
						return nil
					})
				}
				parent := filepath.Dir(root)
				if strings.EqualFold(parent, root) {
					break
				}
				root = parent
			}
		}
	}
	return files
}

func collectWindowsProcessCertificateFiles(ctx context.Context, budget *windowsDiscoveryBudget, processFacts []map[string]any) []map[string]any {
	files := make([]map[string]any, 0, 64)
	seen := make(map[string]struct{})
	for _, process := range processFacts {
		if discoveryBudgetStopped(ctx, budget) {
			break
		}
		for _, root := range windowsProcessDiscoveryRoots(ctx, process) {
			for depth := 0; depth < 3 && root != ""; depth++ {
				for _, candidateRoot := range []string{root, filepath.Join(root, "conf"), filepath.Join(root, "config"), filepath.Join(root, "..", "conf"), filepath.Join(root, "..", "config")} {
					if len(files) >= 128 || discoveryBudgetStopped(ctx, budget) {
						return files
					}
					info, err := os.Stat(candidateRoot)
					if err != nil || !info.IsDir() {
						continue
					}
					_ = filepath.WalkDir(candidateRoot, func(candidate string, entry os.DirEntry, walkErr error) error {
						if len(files) >= 128 || discoveryBudgetStopped(ctx, budget) {
							return filepath.SkipAll
						}
						if budget != nil {
							if err := budget.visit(); err != nil {
								return filepath.SkipAll
							}
						}
						if walkErr != nil || entry == nil {
							return nil
						}
						if entry.IsDir() {
							if strings.Count(strings.TrimPrefix(candidate, candidateRoot), string(os.PathSeparator)) > 2 {
								return filepath.SkipDir
							}
							return nil
						}
						ext := strings.ToLower(filepath.Ext(candidate))
						if ext != ".pem" && ext != ".crt" && ext != ".cer" && ext != ".der" {
							return nil
						}
						key := strings.ToLower(filepath.Clean(candidate))
						if _, exists := seen[key]; exists {
							return nil
						}
						if item := collectWindowsCertificateFile(candidate); item != nil {
							seen[key] = struct{}{}
							files = append(files, item)
						}
						return nil
					})
				}
				parent := filepath.Dir(root)
				if strings.EqualFold(parent, root) {
					break
				}
				root = parent
			}
		}
	}
	return files
}

func collectWindowsDiscoveryConfigFiles(ctx context.Context, spec agentDiscoverySpecV1, processFacts []map[string]any, serviceFacts []map[string]any) []map[string]any {
	if len(spec.Profiles) == 0 {
		return []map[string]any{}
	}
	files := make([]map[string]any, 0, 32)
	seen := make(map[string]struct{})
	for _, path := range windowsDiscoveryCandidatePaths(ctx, spec, processFacts, serviceFacts) {
		if len(files) >= 128 {
			break
		}
		if !isWindowsDiscoveryConfigPath(spec, path) {
			continue
		}
		key := strings.ToLower(filepath.Clean(path))
		if _, exists := seen[key]; exists {
			continue
		}
		if item := collectWebConfigFile(path); item != nil {
			seen[key] = struct{}{}
			files = append(files, item)
		}
	}
	return files
}

func collectWindowsDiscoveryCertificateFiles(ctx context.Context, spec agentDiscoverySpecV1, processFacts []map[string]any, serviceFacts []map[string]any) []map[string]any {
	if len(spec.Profiles) == 0 {
		return []map[string]any{}
	}
	files := make([]map[string]any, 0, 32)
	seen := make(map[string]struct{})
	for _, path := range windowsDiscoveryCandidatePaths(ctx, spec, processFacts, serviceFacts) {
		if len(files) >= 128 {
			break
		}
		if !isWindowsDiscoveryCertificatePath(spec, path) {
			continue
		}
		key := strings.ToLower(filepath.Clean(path))
		if _, exists := seen[key]; exists {
			continue
		}
		if item := collectWindowsCertificateFile(path); item != nil {
			seen[key] = struct{}{}
			files = append(files, item)
		}
	}
	return files
}

func collectWindowsCertificateFilesFromConfigFiles(spec agentDiscoverySpecV1, configFiles []map[string]any) []map[string]any {
	files := make([]map[string]any, 0, 16)
	seen := map[string]struct{}{}
	for _, file := range configFiles {
		configPath := stringFromMap(file, "path")
		content := stringFromMap(file, "content")
		if configPath == "" || content == "" {
			continue
		}
		for _, certificatePath := range windowsCertificateReferencesFromConfigContent(spec, configPath, content) {
			key := strings.ToLower(filepath.Clean(certificatePath))
			if _, exists := seen[key]; exists {
				continue
			}
			seen[key] = struct{}{}
			if item := collectWindowsCertificateFile(certificatePath); item != nil {
				files = append(files, item)
			}
			if len(files) >= 128 {
				return files
			}
		}
	}
	return files
}

func isWindowsDiscoveryConfigPath(spec agentDiscoverySpecV1, path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	if ext == ".conf" || ext == ".xml" || ext == ".properties" || ext == ".config" {
		return true
	}
	name := strings.ToLower(filepath.Base(path))
	for _, profile := range spec.Profiles {
		for _, allowed := range profile.ConfigFileNames {
			allowed = strings.ToLower(allowed)
			if strings.HasPrefix(allowed, "*.") && strings.HasSuffix(name, strings.TrimPrefix(allowed, "*")) {
				return true
			}
			if name == allowed {
				return true
			}
		}
	}
	return false
}

func windowsProcessDiscoveryRoots(ctx context.Context, process map[string]any) []string {
	roots := make([]string, 0, 4)
	seen := make(map[string]struct{})
	appendRoot := func(value string) {
		value = strings.Trim(strings.TrimSpace(value), "\"")
		if value == "" {
			return
		}
		if !filepath.IsAbs(value) {
			return
		}
		if info, err := os.Stat(value); err == nil && info.IsDir() {
			value = filepath.Clean(value)
		} else {
			value = filepath.Dir(value)
		}
		key := strings.ToLower(value)
		if _, exists := seen[key]; exists {
			return
		}
		seen[key] = struct{}{}
		roots = append(roots, value)
	}
	appendRoot(filepath.Dir(stringFromMap(process, "executablePath")))
	pid := uint32(intFromMap(process, "pid"))
	if pid == 0 {
		return roots
	}
	commandLine := windowsProcessCommandLine(ctx, pid)
	for _, token := range parseWindowsCommandLine(commandLine) {
		if path := windowsDrivePathFromToken(token); path != "" {
			appendRoot(path)
		}
	}
	return roots
}

func windowsDrivePathFromToken(token string) string {
	for index := 0; index+2 < len(token); index++ {
		letter := token[index]
		if ((letter >= 'A' && letter <= 'Z') || (letter >= 'a' && letter <= 'z')) && token[index+1] == ':' && (token[index+2] == '\\' || token[index+2] == '/') {
			return strings.Trim(token[index:], "\"'")
		}
	}
	return ""
}

// 按 Windows 命令行规则保留带空格的参数；这里只在本地提取路径，
// 不把完整命令行写入事实快照，避免把密码或 Token 带回控制面。
func parseWindowsCommandLine(commandLine string) []string {
	result := make([]string, 0, 8)
	var builder strings.Builder
	inQuotes := false
	started := false
	flush := func() {
		if !started {
			return
		}
		result = append(result, builder.String())
		builder.Reset()
		started = false
	}
	for index := 0; index < len(commandLine); {
		current := commandLine[index]
		if current == '"' {
			inQuotes = !inQuotes
			started = true
			index++
			continue
		}
		if (current == ' ' || current == '\t' || current == '\r' || current == '\n') && !inQuotes {
			flush()
			index++
			continue
		}
		builder.WriteByte(current)
		started = true
		index++
	}
	flush()
	return result
}

func processExecutablePaths(processFacts []map[string]any) []string {
	paths := make([]string, 0, len(processFacts))
	seen := make(map[string]struct{})
	for _, process := range processFacts {
		path := filepath.ToSlash(stringFromMap(process, "executablePath"))
		if path == "" {
			continue
		}
		key := strings.ToLower(path)
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		paths = append(paths, path)
	}
	sort.Strings(paths)
	return paths
}

func collectWebConfigFile(path string) map[string]any {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() || info.Size() > 256*1024 {
		return nil
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	text, ok := decodeWindowsConfigText(content)
	if !ok {
		return nil
	}
	return map[string]any{"path": filepath.ToSlash(path), "content": text}
}

// 仅回传公开证书摘要，不回传 PEM、私钥或 PKCS#12 原文。
func collectWindowsCertificateFiles(ctx context.Context, budget *windowsDiscoveryBudget, roots []string) []map[string]any {
	files := make([]map[string]any, 0, 64)
	seen := make(map[string]struct{})
	for _, root := range roots {
		if discoveryBudgetStopped(ctx, budget) {
			break
		}
		_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
			if len(files) >= windowsDiscoveryReadFileLimit || discoveryBudgetStopped(ctx, budget) {
				return filepath.SkipAll
			}
			if budget != nil {
				if err := budget.visit(); err != nil {
					return filepath.SkipAll
				}
			}
			if walkErr != nil || entry == nil || entry.IsDir() {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(path))
			if ext != ".pem" && ext != ".crt" && ext != ".cer" && ext != ".der" {
				return nil
			}
			key := strings.ToLower(filepath.Clean(path))
			if _, exists := seen[key]; exists {
				return nil
			}
			seen[key] = struct{}{}
			if item := collectWindowsCertificateFile(path); item != nil {
				files = append(files, item)
			}
			return nil
		})
		if len(files) >= windowsDiscoveryReadFileLimit || discoveryBudgetStopped(ctx, budget) {
			break
		}
	}
	// Windows 证书库绑定使用 Thumbprint，而不是磁盘证书文件。
	// 周期库存也必须携带 LocalMachine\My 摘要，以建立证书关联。
	for _, fact := range collectWindowsCertificateStores(ctx) {
		if certificate := certificateFileFromFact(fact); certificate != nil {
			files = append(files, certificate)
		}
	}
	return files
}

func collectWindowsCertificateFile(path string) map[string]any {
	content, err := os.ReadFile(path)
	if err != nil || len(content) == 0 || len(content) > 512*1024 {
		return nil
	}
	der := content
	if block, _ := pem.Decode(content); block != nil {
		der = block.Bytes
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		return nil
	}
	fingerprint := sha256.Sum256(certificate.Raw)
	thumbprint := sha1.Sum(certificate.Raw)
	return map[string]any{
		"path":              filepath.ToSlash(path),
		"configuredPaths":   []string{filepath.Base(path)},
		"sha256Fingerprint": hex.EncodeToString(fingerprint[:]),
		"thumbprint":        hex.EncodeToString(thumbprint[:]),
		"subject":           certificate.Subject.String(),
		"issuer":            certificate.Issuer.String(),
		"notBefore":         certificate.NotBefore.UTC().Format(time.RFC3339),
		"notAfter":          certificate.NotAfter.UTC().Format(time.RFC3339),
	}
}

// Windows 配置文件常见 UTF-8、UTF-16 LE 和 UTF-16 BE 三种编码。UTF-16 原始字节不能直接转 string，否则会把 NUL 上报到 JSONB。
func decodeWindowsConfigText(content []byte) (string, bool) {
	if len(content) >= 2 && content[0] == 0xff && content[1] == 0xfe {
		return decodeUTF16ConfigText(content[2:], true)
	}
	if len(content) >= 2 && content[0] == 0xfe && content[1] == 0xff {
		return decodeUTF16ConfigText(content[2:], false)
	}
	text := strings.TrimPrefix(string(content), "\ufeff")
	return text, !strings.ContainsRune(text, '\x00')
}

func decodeUTF16ConfigText(content []byte, littleEndian bool) (string, bool) {
	if len(content)%2 != 0 {
		return "", false
	}
	units := make([]uint16, 0, len(content)/2)
	for index := 0; index < len(content); index += 2 {
		if littleEndian {
			units = append(units, uint16(content[index])|uint16(content[index+1])<<8)
		} else {
			units = append(units, uint16(content[index])<<8|uint16(content[index+1]))
		}
	}
	text := string(utf16.Decode(units))
	return text, !strings.ContainsRune(text, '\x00')
}

// Windows Go Agent 使用系统 tasklist 获取原始进程镜像名；控制面插件负责解释事实。
func collectWindowsWebProcessExecutables(ctx context.Context) []string {
	command := exec.CommandContext(ctx, windowsSystem32Directory+`\tasklist.exe`, "/fo", "csv", "/nh")
	command.Dir = windowsSystem32Directory
	command.Env = fixedWindowsEnvironment()
	output, err := command.Output()
	if err != nil {
		return []string{}
	}
	seen := map[string]struct{}{}
	result := make([]string, 0, 8)
	for _, line := range strings.Split(string(output), "\n") {
		fields := strings.Split(line, "\",\"")
		if len(fields) == 0 {
			continue
		}
		name := strings.Trim(fields[0], " \t\"\r")
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		result = append(result, name)
	}
	sort.Strings(result)
	return result
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
		AgentKey:           config.AgentKey,
		MachineID:          identity.MachineID,
		Hostname:           hostname,
		Version:            agentVersion,
		OSType:             "windows",
		Arch:               runtime.GOARCH,
		IPAddress:          identity.PrimaryIPAddress,
		ManagementEndpoint: managementEndpointForIdentity(identity, config),
		OSVersion:          identity.WindowsVersion,
		Labels:             []string{"windows-go", "windows-service"},
		EnrollmentToken:    strings.TrimSpace(config.EnrollmentToken),
		Role:               effectiveAgentRole(config),
		Zone:               strings.TrimSpace(config.Zone),
		Capabilities: []string{
			"agent.full.online",
			"agent.task.receive",
			"agent.log.report",
		},
	}
	if isGatewayEnabled(config) {
		request.ZoneIDs = []string{firstNonEmpty(strings.TrimSpace(config.Zone), "default")}
		request.Adapters = gatewayRouteChannels()
		request.Capabilities = append(request.Capabilities, gatewayCapabilityKeys()...)
	}

	var response registerResponse
	if err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/register", request, &response); err != nil {
		return nil, fmt.Errorf("注册 Agent 失败: %w", err)
	}
	if strings.TrimSpace(response.ID) == "" {
		return nil, errors.New("注册 Agent 失败: 控制面未返回有效 agentId")
	}
	if response.TrustMaterial != nil {
		if err := persistAgentTrustMaterial(config, response.ID, response.TrustMaterial); err != nil {
			return nil, fmt.Errorf("保存 Agent 授权材料失败: %w", err)
		}
	}

	return &runtimeRegistration{
		AgentID:  response.ID,
		Hostname: hostname,
		Version:  agentVersion,
	}, nil
}

func postHeartbeat(ctx context.Context, client *http.Client, config *AgentConfig, registration *runtimeRegistration, counters *runtimeCounters, status *runtimeStatusSnapshot) error {
	request := heartbeatRequest{
		AgentID:            registration.AgentID,
		Version:            registration.Version,
		ManagementEndpoint: managementEndpointForIdentity(collectRuntimeIdentity(config.ControlPlane), config),
	}
	if isGatewayEnabled(config) {
		request.Adapters = gatewayRouteChannels()
		request.Capabilities = gatewayCapabilityKeys()
	}
	request.TaskSummary.Running = counters.Running
	request.TaskSummary.Queued = counters.Queued
	request.TaskSummary.Succeeded = counters.Succeeded
	request.TaskSummary.Failed = counters.Failed
	if status != nil {
		request.RuntimeHealth = buildHeartbeatRuntimeHealth(config, *status)
	}
	return doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/heartbeat", request, nil)
}

func reportCapabilities(ctx context.Context, client *http.Client, config *AgentConfig, registration *runtimeRegistration, identity runtimeIdentity) error {
	return reportCapabilitiesWithInventory(ctx, client, config, registration, identity, nil)
}

func reportCapabilitiesWithScanLog(ctx context.Context, client *http.Client, config *AgentConfig, registration *runtimeRegistration, identity runtimeIdentity, logger *runtimeLogger) error {
	var inventory map[string]any
	if !isPureGatewayRole(config) {
		inventory = collectWindowsWebInventoryWithLogger(ctx, config, logger)
	}
	return reportCapabilitiesWithInventory(ctx, client, config, registration, identity, inventory)
}

func reportCapabilitiesWithInventory(ctx context.Context, client *http.Client, config *AgentConfig, registration *runtimeRegistration, identity runtimeIdentity, inventory map[string]any) error {
	capabilities := []reportedCapability{}
	if !isPureGatewayRole(config) {
		capabilities = collectCapabilityReportsWithConfiguredInventory(identity, config, inventory)
	}
	request := capabilityReportRequest{
		AgentID:            registration.AgentID,
		CompatibilityLevel: "modern",
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

// executeDirectWebDiscovery 是手动重新发现的唯一直连出口。
// 它只接收带签名的 agent.fact.collect，禁止把管理端口变成通用任务执行通道。
func executeDirectWebDiscovery(
	ctx context.Context,
	client *http.Client,
	config *AgentConfig,
	registration *runtimeRegistration,
	payload map[string]any,
	logger *runtimeLogger,
) directDiscoveryResponse {
	if client == nil || config == nil || registration == nil || strings.TrimSpace(registration.AgentID) == "" {
		return directDiscoveryResponse{ErrorCode: "AGENT_DIRECT_DISCOVERY_UNAVAILABLE", ErrorMessage: "Agent 运行时尚未完成注册"}
	}
	wirePayload, action, err := decodeQueuedAgentV2Payload(payload)
	if err != nil {
		return directDiscoveryResponse{ErrorCode: "AGENT_DIRECT_DISCOVERY_INVALID", ErrorMessage: err.Error()}
	}
	if action != agentFactCollect || !boolFromMap(wirePayload, "refreshWebInventory") {
		return directDiscoveryResponse{ErrorCode: "AGENT_DIRECT_DISCOVERY_INVALID", ErrorMessage: "管理端点只接受 agent.fact.collect Web 库存刷新"}
	}
	started := time.Now()
	if logger != nil {
		logger.Info("direct web discovery started requestId=%s", stringFromMap(wirePayload, "requestId"))
	}
	success, errorCode, errorMessage, detail := executeAgentV2(ctx, wirePayload, registration.AgentID)
	if !success {
		if ctx.Err() == context.DeadlineExceeded {
			return directDiscoveryResponse{ErrorCode: "AGENT_DIRECT_DISCOVERY_TIMEOUT", ErrorMessage: "Agent Web 重新扫描超过 90 秒，已取消本次请求"}
		}
		return directDiscoveryResponse{ErrorCode: firstNonEmpty(errorCode, "AGENT_DIRECT_DISCOVERY_DENIED"), ErrorMessage: firstNonEmpty(errorMessage, "Agent v2 授权校验失败")}
	}
	factEnvelope := mapFromMap(detail, "factEnvelope")
	if factEnvelope == nil {
		return directDiscoveryResponse{ErrorCode: "AGENT_FACT_COLLECTION_FAILED", ErrorMessage: "Agent v2 未返回 factEnvelope，不能生成 Web 库存"}
	}
	logDiscoveryDiagnostics(logger, "direct", stringFromMap(wirePayload, "requestId"), started, factEnvelope)
	// agent.fact.collect 已经完成本轮进程、端口、服务、配置和证书采集。
	// 直接把同一份事实转换成 web.inventory，避免再次扫描造成快照漂移。
	inventory := webInventoryFromFactEnvelope(factEnvelope)
	if err := reportCapabilitiesWithInventory(ctx, client, config, registration, collectRuntimeIdentity(config.ControlPlane), inventory); err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return directDiscoveryResponse{ErrorCode: "AGENT_DIRECT_DISCOVERY_TIMEOUT", ErrorMessage: "Agent Web 重新扫描超过 90 秒，已取消本次请求"}
		}
		return directDiscoveryResponse{ErrorCode: "CAPABILITY_RESCAN_FAILED", ErrorMessage: fmt.Sprintf("Web 库存上报失败: %v", err)}
	}
	if logger != nil {
		logger.Info("direct web discovery completed requestId=%s totalMs=%d", stringFromMap(wirePayload, "requestId"), time.Since(started).Milliseconds())
	}
	return directDiscoveryResponse{
		Success: true,
		Detail: map[string]any{
			"capabilityRescan": map[string]any{"trigger": "direct", "requestedBy": stringFromMap(wirePayload, "requestedBy"), "success": true},
			"webInventory":     map[string]any{"configFiles": lenOfAny(inventory["configFiles"]), "certificateFiles": lenOfAny(inventory["certificateFiles"]), "listeningPorts": lenOfAny(inventory["listeningPorts"])},
		},
	}
}

// webInventoryFromFactEnvelope 将事实采集结果转换为宿主可消费的通用 Web 库存。
// Agent 只搬运原始配置、监听和证书元数据；框架语法解析由宿主插件完成。
func webInventoryFromFactEnvelope(envelope map[string]any) map[string]any {
	inventory := map[string]any{"processes": []map[string]any{}, "processExecutables": []string{}, "services": []map[string]any{}, "listeningPorts": []map[string]any{}, "sslCertificateBindings": []map[string]any{}, "configFiles": []map[string]any{}, "certificateFiles": []map[string]any{}, "frameworks": []map[string]any{}, "sites": []map[string]any{}}
	if envelope == nil {
		return inventory
	}
	facts := factMaps(envelope["facts"])
	for _, fact := range facts {
		switch stringFromMap(fact, "kind") {
		case "process":
			inventory["processes"] = append(inventory["processes"].([]map[string]any), fact)
			if executable := stringFromMap(fact, "executablePath"); executable != "" {
				inventory["processExecutables"] = append(inventory["processExecutables"].([]string), executable)
			}
			continue
		case "service":
			inventory["services"] = append(inventory["services"].([]map[string]any), fact)
			continue
		case "listening_port":
			port := map[string]any{
				"address": stringFromMap(fact, "address"), "port": intFromMap(fact, "port"), "protocol": stringFromMap(fact, "protocol"),
			}
			if pid := intFromMap(fact, "pid"); pid > 0 {
				port["pid"] = pid
			}
			inventory["listeningPorts"] = append(inventory["listeningPorts"].([]map[string]any), port)
		case "ssl_certificate_binding":
			binding := map[string]any{
				"address": stringFromMap(fact, "address"), "port": intFromMap(fact, "port"), "protocol": "https",
				"thumbprint": normalizeCertificateHex(stringFromMap(fact, "thumbprint")),
			}
			for _, key := range []string{"store", "hostname"} {
				if value := stringFromMap(fact, key); value != "" {
					binding[key] = value
				}
			}
			inventory["sslCertificateBindings"] = append(inventory["sslCertificateBindings"].([]map[string]any), binding)
		case "certificate_store":
			if certificate := certificateFileFromFact(fact); certificate != nil {
				inventory["certificateFiles"] = append(inventory["certificateFiles"].([]map[string]any), certificate)
			}
			continue
		case "certificate_file":
			if certificate := certificateFileFromFact(fact); certificate != nil {
				inventory["certificateFiles"] = append(inventory["certificateFiles"].([]map[string]any), certificate)
			}
			continue
		case "file_content":
			// 受控配置文本继续向控制面提供原始证据，控制面可据此进行完整解析。
		default:
			continue
		}
		path := stringFromMap(fact, "path")
		encoded := stringFromMap(fact, "contentBase64")
		if path == "" || encoded == "" {
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			continue
		}
		content, ok := decodeWindowsConfigText(decoded)
		if !ok {
			continue
		}
		inventory["configFiles"] = append(inventory["configFiles"].([]map[string]any), map[string]any{"path": filepath.ToSlash(path), "content": content})
	}
	return inventory
}

func certificateFileFromFact(fact map[string]any) map[string]any {
	thumbprint := strings.ToUpper(strings.Map(func(r rune) rune {
		if (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F') {
			return r
		}
		return -1
	}, stringFromMap(fact, "thumbprint")))
	if len(thumbprint) < 8 {
		return nil
	}
	path := stringFromMap(fact, "path")
	if path == "" {
		path = "windows-certstore://LocalMachine/" + stringFromMap(fact, "store") + "/" + thumbprint
	}
	item := map[string]any{"path": filepath.ToSlash(path), "thumbprint": thumbprint, "store": stringFromMap(fact, "store"), "storeLocation": stringFromMap(fact, "storeLocation")}
	for _, key := range []string{"sha256Fingerprint", "subject", "issuer", "notBefore", "notAfter", "hasPrivateKey"} {
		if value := fact[key]; value != nil && value != "" {
			item[key] = value
		}
	}
	return item
}

func lenOfAny(value any) int {
	switch items := value.(type) {
	case []map[string]any:
		return len(items)
	case []any:
		return len(items)
	default:
		return 0
	}
}

func factMaps(value any) []map[string]any {
	switch facts := value.(type) {
	case []map[string]any:
		return facts
	case []any:
		result := make([]map[string]any, 0, len(facts))
		for _, item := range facts {
			if fact, ok := item.(map[string]any); ok {
				result = append(result, fact)
			}
		}
		return result
	default:
		return nil
	}
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
	acknowledged, err := ackTask(ctx, client, config, registration.AgentID, task.ID, leaseID)
	if err != nil {
		return fmt.Errorf("ack 任务失败: %w", err)
	}
	if acknowledged.LeaseID != "" && acknowledged.LeaseID != leaseID {
		logger.Info("skip task already owned by another lease taskId=%s", task.ID)
		return nil
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
	if execution == nil {
		return false, "ACTION_HANDLER_NOT_REGISTERED", "Agent v2 执行上下文不能为空", nil
	}
	payload := execution.task.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	if success, code, message, detail, handled := executeGatewayTask(execution.ctx, execution.client, execution.config, execution.task, payload); handled {
		return success, code, message, detail
	}
	wirePayload, action, err := decodeQueuedAgentV2Payload(payload)
	if err != nil {
		return false, "ACTION_HANDLER_NOT_REGISTERED", err.Error(), map[string]any{
			"taskId":          execution.task.ID,
			"executionStepId": execution.task.ExecutionStepID,
		}
	}
	execution.task.Payload = wirePayload
	result := windowsActionHandlers.Execute(execution)
	if action == agentFactCollect && boolFromMap(wirePayload, "refreshWebInventory") {
		if !result.Success {
			return result.Success, result.ErrorCode, result.ErrorMessage, result.Detail
		}
		factEnvelope := mapFromMap(result.Detail, "factEnvelope")
		if factEnvelope == nil {
			return false, "AGENT_FACT_COLLECTION_FAILED", "Agent v2 未返回 factEnvelope，不能生成 Web 库存", result.Detail
		}
		inventory := webInventoryFromFactEnvelope(factEnvelope)
		if err := reportCapabilitiesWithInventory(execution.ctx, execution.client, execution.config, execution.registration, collectRuntimeIdentity(execution.config.ControlPlane), inventory); err != nil {
			detail := cloneMap(result.Detail)
			detail["capabilityRescan"] = map[string]any{"trigger": "manual", "requestedBy": stringFromMap(wirePayload, "requestedBy"), "success": false, "error": err.Error()}
			return false, "CAPABILITY_RESCAN_FAILED", fmt.Sprintf("Web 库存上报失败: %v", err), detail
		}
		detail := cloneMap(result.Detail)
		detail["webInventory"] = map[string]any{"frameworks": inventory["frameworks"], "sites": inventory["sites"], "configFiles": lenOfAny(inventory["configFiles"])}
		detail["capabilityRescan"] = map[string]any{"trigger": "manual", "requestedBy": stringFromMap(wirePayload, "requestedBy"), "success": true}
		return true, "", "", detail
	}
	return result.Success, result.ErrorCode, result.ErrorMessage, result.Detail
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
	return []string{"probe.tcp", "probe.http", "probe.agent", "forward.agent_task"}
}

func gatewayCapabilityKeys() []string {
	return []string{"gateway.probe.tcp", "gateway.probe.http", "gateway.probe.agent", "gateway.forward.agent_task"}
}

func gatewayAdaptersIfNeeded(config *AgentConfig) []string {
	if !isGatewayEnabled(config) {
		return nil
	}
	return gatewayRouteChannels()
}

func executeGatewayTask(ctx context.Context, client *http.Client, config *AgentConfig, task agentTaskEnvelope, payload map[string]any) (bool, string, string, map[string]any, bool) {
	taskType := strings.TrimSpace(stringFromMap(payload, "type"))
	gatewayTask := mapFromMap(payload, "gatewayTask")
	if taskType == "" {
		taskType = strings.TrimSpace(stringFromMap(gatewayTask, "action"))
	}
	if taskType == "gateway.forward.direct_control" {
		return false, "GATEWAY_FORWARD_DIRECT_CONTROL_DISABLED", "旧 Direct Control Action 路径已移除，必须提交 Agent v2 计划", map[string]any{"taskId": task.ID, "type": taskType}, true
	}
	if taskType != "gateway.probe" && taskType != "gateway.forward.agent_task" {
		return false, "", "", nil, false
	}
	if !isGatewayEnabled(config) {
		return false, "GATEWAY_ROLE_REQUIRED", "当前 Agent 未以 gateway 角色运行，拒绝处理 Gateway 路由任务", map[string]any{"taskId": task.ID, "type": taskType}, true
	}
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
		return forwardGatewayAgentTask(ctx, client, config, task, gatewayTask, gatewayPayload)
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

func forwardGatewayAgentTask(ctx context.Context, client *http.Client, config *AgentConfig, task agentTaskEnvelope, gatewayTask map[string]any, gatewayPayload map[string]any) (bool, string, string, map[string]any, bool) {
	if gatewayPayload == nil {
		return false, "AGENT_V2_AUTHORIZATION_DENIED", "Gateway 转发缺少 Agent v2 授权载荷", map[string]any{"taskId": task.ID, "mode": "gateway.forward.agent_task"}, true
	}
	token := mapFromMap(gatewayPayload, "token")
	forwardingGrant := mapFromMap(gatewayTask, "forwardingGrant")
	targetAgentID := firstNonEmpty(
		stringFromMap(token, "agentId"),
		stringFromMap(forwardingGrant, "delegatedAgentId"),
		stringFromMap(gatewayPayload, "targetAgentId"),
		stringFromMap(gatewayPayload, "delegatedAgentId"),
	)
	if targetAgentID == "" {
		return false, "GATEWAY_FORWARD_TARGET_AGENT_REQUIRED", "Gateway 转发缺少目标 agentId", map[string]any{"taskId": task.ID, "mode": "gateway.forward"}, true
	}
	if tokenAgentID := stringFromMap(token, "agentId"); tokenAgentID != "" && tokenAgentID != targetAgentID {
		return false, "AGENT_V2_AUTHORIZATION_DENIED", "Gateway 转发目标 Agent 与 Token 不一致", map[string]any{"taskId": task.ID, "targetAgentId": targetAgentID, "tokenAgentId": tokenAgentID}, true
	}
	if grantAgentID := stringFromMap(forwardingGrant, "delegatedAgentId"); grantAgentID != "" && grantAgentID != targetAgentID {
		return false, "AGENT_V2_AUTHORIZATION_DENIED", "Gateway 转发目标 Agent 与 ForwardingGrant 不一致", map[string]any{"taskId": task.ID, "targetAgentId": targetAgentID, "grantAgentId": grantAgentID}, true
	}
	forwardPayload, actionType, err := buildGatewayAgentV2Payload(gatewayPayload, task, targetAgentID)
	if err != nil {
		return false, "AGENT_V2_AUTHORIZATION_DENIED", err.Error(), map[string]any{"taskId": task.ID, "mode": "gateway.forward.agent_task"}, true
	}
	var response agentTaskEnvelope
	err = doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/tasks", enqueueAgentTaskRequest{
		AgentID:         targetAgentID,
		ExecutionRunID:  firstNonEmpty(stringFromMap(gatewayTask, "executionRunId"), task.ExecutionRunID),
		ExecutionStepID: firstNonEmpty(stringFromMap(gatewayTask, "stepId"), task.ExecutionStepID),
		IdempotencyKey:  firstNonEmpty(stringFromMap(gatewayTask, "idempotencyKey"), "gateway-forward:"+task.ID),
		Payload:         forwardPayload,
	}, &response)
	detail := map[string]any{"mode": "gateway.forward.agent_task", "targetAgentId": targetAgentID, "forwardedTaskId": response.ID, "actionType": actionType}
	if err != nil {
		return false, "GATEWAY_FORWARD_AGENT_TASK_FAILED", err.Error(), detail, true
	}
	return waitForGatewayAgentTask(ctx, client, config, response.ID, targetAgentID, actionType, detail, gatewayForwardWaitDuration(gatewayPayload))
}

func buildGatewayAgentV2Payload(source map[string]any, task agentTaskEnvelope, targetAgentID string) (map[string]any, string, error) {
	token := mapFromMap(source, "token")
	decision := mapFromMap(source, "policyDecision")
	if token == nil || decision == nil {
		return nil, "", errors.New("Gateway 转发缺少 Token 或 Policy Decision")
	}
	if _, exists := source["action"]; exists {
		return nil, "", errors.New("Gateway 转发不得使用 action，必须提供 canonical actionType")
	}
	actionType, err := canonicalAgentV2Action(stringFromMap(source, "actionType"))
	if err != nil {
		return nil, "", err
	}
	if tokenAgentID := stringFromMap(token, "agentId"); tokenAgentID != targetAgentID {
		return nil, "", errors.New("Gateway Token agentId 与目标 Agent 不一致")
	}
	pluginVersion := firstNonEmpty(stringFromMap(source, "pluginVersion"), stringFromMap(token, "pluginVersionId"))
	planDigest := stringFromMap(token, "planDigest")
	payload := map[string]any{
		"actionType":          actionType,
		"actionSchemaVersion": firstNonEmpty(stringFromMap(source, "actionSchemaVersion"), "1.0"),
		"requestId":           firstNonEmpty(stringFromMap(source, "requestId"), "gateway-forward:"+task.ID),
		"agentId":             targetAgentID,
		"tenantId":            firstNonEmpty(stringFromMap(source, "tenantId"), stringFromMap(token, "tenantId")),
		"pluginId":            stringFromMap(token, "pluginId"),
		"pluginVersion":       pluginVersion,
		"capability":          stringFromMap(token, "capability"),
		"actions":             token["actions"],
		"paths":               token["allowedPaths"],
		"services":            token["allowedServices"],
		"artifactDigests":     token["artifactDigests"],
		"planDigest":          planDigest,
		"token":               token,
		"policyDecision":      decision,
	}
	if plan := mapFromMap(source, "plan"); plan != nil {
		payload["plan"] = plan
	}
	if receipt := mapFromMap(source, "receipt"); receipt != nil {
		payload["receipt"] = receipt
	}
	return payload, actionType, nil
}

// Gateway 队列出口只允许四个已登记的 Agent v2 canonical 动作。
func canonicalAgentV2Action(value string) (string, error) {
	actionType := strings.TrimSpace(value)
	switch actionType {
	case agentFactCollect, agentPlanValidate, agentPlanExecute, agentExecutionReceipt:
		return actionType, nil
	case "":
		return "", errors.New("Gateway 转发缺少 canonical actionType")
	default:
		return "", fmt.Errorf("Gateway 转发动作未登记: %s", actionType)
	}
}

func waitForGatewayAgentTask(ctx context.Context, client *http.Client, config *AgentConfig, taskID, targetAgentID, actionType string, detail map[string]any, timeout time.Duration) (bool, string, string, map[string]any, bool) {
	waitContext, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	lastError := ""
	for {
		var queue struct {
			Tasks []agentTaskEnvelope `json:"tasks"`
		}
		err := doJSONRequest(waitContext, client, config, http.MethodGet, "/api/v1/agents/tasks?agentId="+url.QueryEscape(targetAgentID), nil, &queue)
		if err != nil {
			lastError = err.Error()
		} else if target := findAgentTask(queue.Tasks, taskID); target != nil {
			return gatewayAgentTaskResult(*target, actionType, detail)
		}
		select {
		case <-waitContext.Done():
			unknown := cloneMap(detail)
			unknown["executionStatus"] = "UNKNOWN"
			unknown["targetAgentId"] = targetAgentID
			unknown["unknownReason"] = "Gateway 等待目标 Agent Receipt 超时，禁止重放"
			if lastError != "" {
				unknown["lastPollError"] = lastError
			}
			return false, "AGENT_EXECUTION_UNKNOWN", "Gateway 等待目标 Agent Receipt 超时，写入状态不明", unknown, true
		case <-time.After(250 * time.Millisecond):
		}
	}
}

func findAgentTask(tasks []agentTaskEnvelope, taskID string) *agentTaskEnvelope {
	for index := range tasks {
		if tasks[index].ID == taskID {
			return &tasks[index]
		}
	}
	return nil
}

func gatewayAgentTaskResult(task agentTaskEnvelope, actionType string, detail map[string]any) (bool, string, string, map[string]any, bool) {
	result := cloneMap(detail)
	result["targetTaskStatus"] = task.Status
	result["targetTaskId"] = task.ID
	targetResult := task.Result
	targetDetail := mapFromMap(targetResult, "detail")
	if receipt := mapFromMap(targetDetail, "receipt"); receipt != nil {
		result["receipt"] = receipt
		result["executionStatus"] = firstNonEmpty(stringFromMap(receipt, "status"), stringFromMap(targetDetail, "executionStatus"))
	}
	if actionType == "agent.plan.execute" || actionType == "agent.execution.receipt" {
		if stringFromMap(result, "executionStatus") == "SUCCESS" {
			return true, "", "", result, true
		}
		result["executionStatus"] = "UNKNOWN"
		result["unknownReason"] = firstNonEmpty(stringFromMap(receiptOrEmpty(targetDetail), "unknownReason"), "目标 Agent 未返回可确认的成功 Receipt")
		return false, "AGENT_EXECUTION_UNKNOWN", "目标 Agent 写入结果不明，禁止 Gateway 重放", result, true
	}
	if task.Status == "succeeded" {
		result["executionStatus"] = "SUCCESS"
		return true, "", "", result, true
	}
	result["executionStatus"] = "FAILED"
	return false, firstNonEmpty(stringFromMap(targetResult, "errorCode"), "AGENT_V2_TARGET_FAILED"), firstNonEmpty(stringFromMap(targetResult, "errorMessage"), "目标 Agent 任务失败"), result, true
}

func receiptOrEmpty(detail map[string]any) map[string]any {
	if receipt := mapFromMap(detail, "receipt"); receipt != nil {
		return receipt
	}
	return map[string]any{}
}

func gatewayForwardWaitDuration(gatewayPayload map[string]any) time.Duration {
	seconds := 30
	plan := mapFromMap(gatewayPayload, "plan")
	if operations, ok := plan["operations"].([]any); ok {
		for _, raw := range operations {
			operation, _ := raw.(map[string]any)
			if timeoutSeconds := intFromMap(operation, "timeoutSeconds"); timeoutSeconds > seconds {
				seconds = timeoutSeconds
			}
		}
	}
	if seconds > 3600 {
		seconds = 3600
	}
	return time.Duration(seconds+30) * time.Second
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
	if input == nil {
		return nil
	}
	value, ok := input[key]
	if !ok {
		return nil
	}
	typed, _ := value.(map[string]any)
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
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
	// Agent Core 不启动平台命令；默认路由事实由通用网络事实采集器补充。
	return map[string]struct{}{}
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

func serviceNameFromConfig(config *AgentConfig) string {
	if config == nil || strings.TrimSpace(config.Service.Name) == "" {
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
	if strings.TrimSpace(config.EnrollmentToken) != "" {
		request.Header.Set("X-Agent-Token", strings.TrimSpace(config.EnrollmentToken))
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
