package main

import (
	"bytes"
	"context"
	"crypto/sha256"
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
	Zone                       string `json:"zone"`
	ControlPlane               string `json:"controlPlaneUrl"`
	Heartbeat                  int    `json:"heartbeatIntervalSeconds"`
	TaskPollIntervalSeconds    int    `json:"taskPollIntervalSeconds"`
	HealthCheckIntervalSeconds int    `json:"healthCheckIntervalSeconds"`
	OfflineTimeoutSeconds      int    `json:"offlineTimeoutSeconds"`
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
	Zone              string   `json:"zone,omitempty"`
}

type registerResponse struct {
	ID string `json:"id"`
}

type heartbeatRequest struct {
	AgentID       string                  `json:"agentId"`
	Version       string                  `json:"version"`
	RuntimeHealth *heartbeatRuntimeHealth `json:"runtimeHealth,omitempty"`
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
}

type runtimeFailureCounts struct {
	Heartbeat int `json:"heartbeat,omitempty"`
	TaskPoll  int `json:"taskPoll,omitempty"`
	Recovery  int `json:"recovery,omitempty"`
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
	Address            string `json:"address,omitempty"`
	Port               int    `json:"port"`
	Protocol           string `json:"protocol,omitempty"`
	CertificateName    string `json:"certificateName,omitempty"`
	CertificatePath    string `json:"certificatePath,omitempty"`
	CertificateKeyPath string `json:"certificateKeyPath,omitempty"`
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
}

type apacheBindingDetail struct {
	Address            string `json:"address,omitempty"`
	Port               int    `json:"port"`
	Protocol           string `json:"protocol,omitempty"`
	CertificateName    string `json:"certificateName,omitempty"`
	CertificatePath    string `json:"certificatePath,omitempty"`
	CertificateKeyPath string `json:"certificateKeyPath,omitempty"`
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
	Address            string `json:"address,omitempty"`
	Port               int    `json:"port"`
	Protocol           string `json:"protocol,omitempty"`
	TLS                bool   `json:"tls"`
	CertificateName    string `json:"certificateName,omitempty"`
	CertificatePath    string `json:"certificatePath,omitempty"`
	CertificateKeyPath string `json:"certificateKeyPath,omitempty"`
	KeystorePath       string `json:"keystorePath,omitempty"`
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
	identity := collectRuntimeIdentity(config.AgentKey)
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
	identity := collectRuntimeIdentity(config.AgentKey)

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
		Zone:              strings.TrimSpace(config.Zone),
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
	if counters != nil {
		request.TaskSummary.Running = counters.Running
		request.TaskSummary.Queued = counters.Queued
		request.TaskSummary.Succeeded = counters.Succeeded
		request.TaskSummary.Failed = counters.Failed
	}
	if status != nil {
		request.RuntimeHealth = buildHeartbeatRuntimeHealth(config, *status)
	}

	return doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/heartbeat", request, nil)
}

func reportCapabilities(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState) error {
	capabilities := collectCapabilityReports()
	if len(capabilities) == 0 {
		return nil
	}
	request := capabilityReportRequest{
		AgentID:            state.AgentID,
		CompatibilityLevel: "L1",
		Capabilities:       capabilities,
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
	switch taskType {
	case "", "agent.self_test":
		return true, "", "", map[string]any{
			"executor": "linux-go-agent-runtime",
			"mode":     "self-test",
			"taskId":   task.ID,
		}
	case "agent.capability.rescan":
		detail, err := runCapabilityRescan(ctx, client, config, state, counters, rescan, "manual", payload)
		if err != nil {
			return false, "RESCAN_REPORT_FAILED", err.Error(), detail
		}
		return true, "", "", detail
	default:
		return false, "UNSUPPORTED_TASK", "当前 Linux Go Agent 仅支持能力重扫任务", map[string]any{
			"taskId":   task.ID,
			"type":     taskType,
			"executor": "linux-go-agent-runtime",
		}
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
	return collectRuntimeIdentity("").PrimaryIPAddress
}

func detectLinuxDistribution() string {
	return collectRuntimeIdentity("").LinuxDistribution
}

func detectLinuxVersion() string {
	return collectRuntimeIdentity("").OSVersion
}

func collectRuntimeIdentity(fallbackAgentKey string) runtimeIdentity {
	release := parseKeyValueFiles([]string{"/etc/os-release", "/usr/lib/os-release"})
	machineID := detectMachineID()
	defaultRouteInterfaces := detectDefaultRouteInterfaces()
	dnsConfigured := hasConfiguredDNS()
	interfaces := collectNetworkInterfaces(defaultRouteInterfaces)
	identity := runtimeIdentity{
		MachineID:         machineID,
		StableAgentKey:    strings.TrimSpace(fallbackAgentKey),
		PrimaryIPAddress:  selectPrimaryIPAddress(interfaces, dnsConfigured),
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
	if dumpErr != nil || strings.TrimSpace(configDump) == "" {
		return detail
	}

	sites := parseNginxConfigDump(configDump)
	for index := range sites {
		enrichNginxSiteCertificates(&sites[index])
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

func enrichNginxSiteCertificates(site *nginxSiteDetail) {
	for index := range site.Listen {
		if site.Listen[index].CertificatePath == "" {
			continue
		}
		site.Listen[index].CertificateName = readCertificateSubject(site.Listen[index].CertificatePath)
	}
}

func readCertificateSubject(path string) string {
	content, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	for {
		block, rest := pem.Decode(content)
		if block == nil {
			return ""
		}
		if block.Type == "CERTIFICATE" {
			certificate, err := x509.ParseCertificate(block.Bytes)
			if err == nil {
				return certificate.Subject.String()
			}
		}
		content = rest
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

func enrichApacheSiteCertificates(site *apacheSiteDetail) {
	for index := range site.Listen {
		if site.Listen[index].CertificatePath == "" {
			continue
		}
		site.Listen[index].CertificateName = readCertificateSubject(site.Listen[index].CertificatePath)
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
	configPath := ""
	if catalinaBase != "" {
		configPath = filepath.Join(catalinaBase, "conf", "server.xml")
	}
	detail := &tomcatDetail{
		Installed:    catalinaBase != "" || catalinaHome != "",
		Running:      running,
		CatalinaHome: catalinaHome,
		CatalinaBase: catalinaBase,
		ConfigPath:   configPath,
		Service:      "tomcat",
	}
	detail.Version = detectTomcatVersion(catalinaHome)
	if configPath != "" && fileExists(configPath) {
		detail.Connectors, detail.Apps = parseTomcatServerXML(configPath, catalinaBase)
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
				item.CertificateName = readCertificateSubject(item.CertificatePath)
			}
			connectors = append(connectors, item)
		}
		for _, host := range service.Engine.Hosts {
			appBase := resolveApachePath(baseDir, catalinaBase, host.AppBase)
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
		}
	}

	apps = append(apps, parseTomcatExternalContexts(catalinaBase, hostAppBases)...)

	return connectors, apps
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
