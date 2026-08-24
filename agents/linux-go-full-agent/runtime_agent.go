package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	"gcac/linux-go-full-agent/internal/atomicplan"
	coreRegistry "gcac/linux-go-full-agent/internal/core/registry"
	coreRuntime "gcac/linux-go-full-agent/internal/core/runtime"
	"gcac/linux-go-full-agent/internal/handlers/productruntime"
	linuxCommand "gcac/linux-go-full-agent/internal/platform/linux/command"
	linuxFacts "gcac/linux-go-full-agent/internal/platform/linux/facts"
)

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
	if identity.StableAgentKey != "" {
		config.AgentKey = identity.StableAgentKey
	}
	if !isValidControlPlaneURL(config.ControlPlane) {
		return errors.New("controlPlaneUrl 无效或仍是模板占位值，Linux Agent 无法启动")
	}
	if strings.TrimSpace(config.AgentKey) == "" {
		return errors.New("agentKey 不能为空，Linux Agent 无法启动")
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	heartbeatSeconds := effectiveHeartbeatSeconds(config)
	taskPollSeconds := effectiveTaskPollSeconds(config)
	healthCheckSeconds := effectiveHealthCheckSeconds(config)
	rescanSeconds := effectiveCapabilityRescanSeconds(config)
	rescanEnabled := effectiveCapabilityRescanEnabled(config)

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
	if err := productruntime.RecoverPending(ctx, filepath.Join(config.Paths.Linux.DataDir, "recovery"), linuxCommand.ExecRunner{}); err != nil {
		status.LastError = err.Error()
		status.ConsecutiveRecoveryFailures++
		fmt.Fprintf(os.Stderr, "[operation-recovery] %v\n", err)
	} else {
		status.LastRecoveryAt = time.Now().Format(time.RFC3339)
		status.ConsecutiveRecoveryFailures = 0
	}
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

	rescanInterval := time.Duration(0)
	if rescanEnabled {
		rescanInterval = time.Duration(rescanSeconds) * time.Second
	}
	return coreRuntime.Run(ctx, coreRuntime.Schedule{
		Heartbeat: time.Duration(heartbeatSeconds) * time.Second,
		TaskPoll:  time.Duration(taskPollSeconds) * time.Second,
		Health:    time.Duration(healthCheckSeconds) * time.Second,
		Rescan:    rescanInterval,
	}, coreRuntime.Hooks{
		Stop: func(context.Context) {
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
		},
		Heartbeat: func(ctx context.Context, now time.Time) {
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
		},
		TaskPoll: func(ctx context.Context, _ time.Time) {
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
		},
		Health: func(context.Context, time.Time) {
			status.LastSelfCheckAt = time.Now().Format(time.RFC3339)
			refreshRuntimeStatus(&status, counters, ledger)
			saveRuntimeStatusSnapshot(statusPath, status)
		},
		Rescan: func(ctx context.Context, _ time.Time) {
			if _, err := runCapabilityRescan(ctx, client, config, state, counters, rescan, "scheduled", nil); err != nil {
				fmt.Fprintf(os.Stderr, "[rescan] scheduled failed agent=%s error=%v\n", config.AgentKey, err)
			}
		},
	})
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

func effectiveCapabilityRescanSeconds(config *AgentConfig) int {
	if config.CapabilityRescanInterval > 0 {
		return config.CapabilityRescanInterval
	}
	return 300
}

func effectiveCapabilityRescanEnabled(config *AgentConfig) bool {
	if config.CapabilityRescanEnabled != nil {
		return *config.CapabilityRescanEnabled
	}
	return true
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
		SupportedActions: []string{"health", "discovery.run", "agent.capability.rescan", "agent.atomic_plan.execute"},
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
	payload := cloneMap(request.Inputs)
	payload["type"] = actionType
	schemaVersion := resolveActionSchemaVersion(actionType, payload)

	taskID := fmt.Sprintf("direct_%d", time.Now().UnixNano())
	result := newLinuxActionRegistry(nil).Execute(context.Background(), coreRegistry.Request{
		TaskID:        taskID,
		ActionType:    actionType,
		SchemaVersion: schemaVersion,
		Payload:       payload,
	})
	statusCode := http.StatusOK
	if !result.Success {
		statusCode = http.StatusBadRequest
	}
	return map[string]any{
		"success":      result.Success,
		"errorCode":    result.ErrorCode,
		"errorMessage": result.ErrorMessage,
		"detail":       result.Detail,
		"taskId":       taskID,
		"requestId":    request.RequestID,
		"actionType":   actionType,
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
	payload := cloneMap(request.Inputs)
	payload["type"] = actionType
	schemaVersion := resolveActionSchemaVersion(actionType, payload)
	registry := newLinuxActionRegistry(nil)
	if _, err := registry.Lookup(actionType, schemaVersion); err != nil {
		return map[string]any{
			"success":      false,
			"errorCode":    "ACTION_HANDLER_NOT_REGISTERED",
			"errorMessage": fmt.Sprintf("action handler not registered: %s", actionType),
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
		result := registry.Execute(context.Background(), coreRegistry.Request{
			TaskID:        actionID,
			ActionType:    actionType,
			SchemaVersion: schemaVersion,
			Payload:       payload,
		})
		globalDirectActionStatusStore.upsert(directActionStatusSnapshot{
			ActionID:     actionID,
			ActionType:   actionType,
			RequestID:    request.RequestID,
			Status:       "completed",
			StartedAt:    startedAt,
			FinishedAt:   time.Now().Format(time.RFC3339),
			Success:      result.Success,
			ErrorCode:    result.ErrorCode,
			ErrorMessage: result.ErrorMessage,
			Detail:       result.Detail,
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
	if strings.EqualFold(strings.TrimSpace(actionType), "agent.atomic_plan.execute") {
		ctx = atomicplan.WithProgressReporter(ctx, func(detail map[string]any) {
			globalDirectActionStatusStore.updateProgress(taskID, detail)
		})
	}
	payload := cloneMap(inputs)
	payload["type"] = actionType
	registry := newLinuxActionRegistry(&linuxActionRuntime{
		client:   client,
		config:   config,
		state:    state,
		counters: counters,
		rescan:   rescan,
	})
	result := registry.Execute(ctx, coreRegistry.Request{
		TaskID:        taskID,
		ActionType:    actionType,
		SchemaVersion: resolveActionSchemaVersion(actionType, payload),
		Payload:       payload,
	})
	return result.Success, result.ErrorCode, result.ErrorMessage, result.Detail
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

func (s *directActionStatusStore) updateProgress(actionID string, detail map[string]any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	snapshot, ok := s.actions[actionID]
	if !ok || snapshot.Status != "running" {
		return
	}
	snapshot.Detail = cloneMap(detail)
	s.actions[actionID] = snapshot
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
		Adapters:           registeredLinuxAdapterIDs(config),
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
		return nil, fmt.Errorf("拉取任务失败: %w", err)
	}
	return tasks, nil
}

func processTask(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState, counters *runtimeCounters, rescan *rescanState, ledger *resultLedger, task agentTaskEnvelope) error {
	leaseID := newLeaseID(task.ID)
	if _, err := ackTask(ctx, client, config, state.AgentID, task.ID, leaseID); err != nil {
		return fmt.Errorf("ack 任务失败: %w", err)
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
		return fmt.Errorf("暂存任务结果失败: %w", err)
	}
	if _, err := submitTaskResult(ctx, client, config, request); err != nil {
		return fmt.Errorf("上报任务结果失败: %w", err)
	}
	if err := ledger.markReported(task.ID); err != nil {
		return fmt.Errorf("标记任务结果已上报失败: %w", err)
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
			return fmt.Errorf("恢复上报任务结果失败 taskId=%s: %w", item.TaskID, err)
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
	taskType := firstNonEmpty(stringFromMap(payload, "actionType"), stringFromMap(payload, "type"))
	if success, code, message, detail, handled := executeGatewayTask(ctx, client, config, task, payload); handled {
		return success, code, message, detail
	}
	if strings.TrimSpace(taskType) == "" {
		taskType = "agent.self_test"
	}
	registry := newLinuxActionRegistry(&linuxActionRuntime{
		client:   client,
		config:   config,
		state:    state,
		counters: counters,
		rescan:   rescan,
	})
	result := registry.Execute(ctx, coreRegistry.Request{
		TaskID:        task.ID,
		ActionType:    taskType,
		SchemaVersion: resolveActionSchemaVersion(taskType, payload),
		Payload:       payload,
	})
	return result.Success, result.ErrorCode, result.ErrorMessage, result.Detail
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
	snapshot := collectLinuxPlatformFacts()
	publicCapabilities := linuxFacts.Capabilities(snapshot)
	capabilities := make([]reportedCapability, 0, len(publicCapabilities)+3)
	for _, capability := range publicCapabilities {
		capabilities = append(capabilities, reportedCapability{
			CapabilityKey: capability.Key,
			Value:         capability.Value,
			Confidence:    capability.Confidence,
			Evidence:      capability.Evidence,
		})
	}
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
