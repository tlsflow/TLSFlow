package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"

	coreRegistry "gcac/linux-go-full-agent/internal/core/registry"
	coreRuntime "gcac/linux-go-full-agent/internal/core/runtime"
	linuxFacts "gcac/linux-go-full-agent/internal/platform/linux/facts"
)

type registerRequest struct {
	AgentKey           string   `json:"agentKey"`
	MachineID          string   `json:"machineId,omitempty"`
	Hostname           string   `json:"hostname"`
	Version            string   `json:"version"`
	OSType             string   `json:"osType"`
	Arch               string   `json:"arch,omitempty"`
	IPAddress          string   `json:"ipAddress,omitempty"`
	ManagementEndpoint string   `json:"managementEndpoint,omitempty"`
	LinuxDistribution  string   `json:"linuxDistribution,omitempty"`
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

// 控制面只下发公钥和绑定策略，私钥从不离开本机 Authority。
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

var agentTrustMaterialState = struct {
	mu       sync.RWMutex
	material *agentTrustMaterialWire
}{}

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
	LeaseID         string         `json:"leaseId,omitempty"`
	Result          map[string]any `json:"result,omitempty"`
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
	Adapters           []string             `json:"adapters,omitempty"`
}

type reportedCapability struct {
	CapabilityKey string         `json:"capabilityKey"`
	Value         any            `json:"value"`
	Confidence    float64        `json:"confidence"`
	Evidence      map[string]any `json:"evidence,omitempty"`
}

// 管理监听只提供健康检查，不提供任务执行或任意命令入口。
func startManagementServer(config *AgentConfig, identity runtimeIdentity) (*http.Server, string, error) {
	listenAddress := net.JoinHostPort(effectiveManagementListenAddress(config), fmt.Sprintf("%d", effectiveManagementPort(config)))
	listener, err := net.Listen("tcp", listenAddress)
	if err != nil {
		return nil, "", fmt.Errorf("管理 TCP 监听启动失败 %s: %w", listenAddress, err)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet || (request.URL.Path != "/api/v1/control/health" && request.URL.Path != "/healthz") {
			writer.Header().Set("Allow", http.MethodGet)
			http.Error(writer, "management endpoint only supports health checks", http.StatusNotFound)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		hostname, _ := os.Hostname()
		_ = json.NewEncoder(writer).Encode(map[string]any{"success": true, "status": "healthy", "agentVersion": agentVersion, "hostname": hostname, "managementEndpoint": managementEndpointForIdentity(identity, config)})
	})}
	go func() {
		if serveErr := server.Serve(listener); serveErr != nil && !errors.Is(serveErr, http.ErrServerClosed) {
			fmt.Fprintf(os.Stderr, "[management] listener stopped: %v\n", serveErr)
		}
	}()
	return server, managementEndpointForIdentity(identity, config), nil
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
	identity := collectRuntimeIdentity(config.ControlPlane)
	if !isValidControlPlaneURL(config.ControlPlane) {
		return errors.New("controlPlaneUrl 无效或仍是模板占位值，Linux Agent 无法启动")
	}
	if strings.TrimSpace(config.AgentKey) == "" {
		return errors.New("agentKey 不能为空，Linux Agent 无法启动")
	}
	if dataDir := strings.TrimSpace(config.Paths.Linux.DataDir); dataDir == "" {
		return errors.New("linux.dataDir 不能为空，无法装配 Agent v2 Nonce 存储")
	} else if err := configurePersistentAgentNonceStore(filepath.Join(dataDir, "ledger", "agent-v2-nonces")); err != nil {
		return err
	}
	if err := loadPersistedAgentTrustMaterial(config); err != nil {
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	heartbeatSeconds := effectiveHeartbeatSeconds(config)
	taskPollSeconds := effectiveTaskPollSeconds(config)
	healthCheckSeconds := effectiveHealthCheckSeconds(config)
	rescanSeconds := effectiveCapabilityRescanSeconds(config)
	rescanEnabled := effectiveCapabilityRescanEnabled(config)

	client := &http.Client{Timeout: 15 * time.Second}
	managementServer, _, err := startManagementServer(config, identity)
	if err != nil {
		return err
	}
	defer managementServer.Shutdown(context.Background())
	state, err := registerAgent(ctx, client, config, identity)
	if err != nil {
		return err
	}
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
	status.LastRecoveryAt = time.Now().Format(time.RFC3339)
	status.ConsecutiveRecoveryFailures = 0
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

func resolveAgentTrustMaterialPath(config *AgentConfig) string {
	if configured := strings.TrimSpace(config.AuthorizationMaterialPath); configured != "" {
		return configured
	}
	dataDir := strings.TrimSpace(config.Paths.Linux.DataDir)
	if dataDir == "" {
		return "/var/lib/gcac/linux-agent/policy/agent-trust-material.json"
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
			// 首次注册后控制面会下发材料；现有安装可先启动完成注册再持久化。
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
	if err := verifySignatureWithKeySet(material.LocalPolicyAuthorityKeyID, material.LocalPolicySignature, localPolicyWithoutSignature(material.LocalPolicy), config.AuthorizationTrustKeySet); err != nil {
		return fmt.Errorf("Agent 本地策略签名无效: %w", err)
	}
	if !sameStringMap(material.CapabilityKeySet, config.AuthorizationTrustKeySet) ||
		!sameStringMap(material.PolicyAuthorityKeySet, config.AuthorizationTrustKeySet) {
		return errors.New("Agent 授权材料 KeySet 与安装信任根不匹配")
	}
	return nil
}

func localPolicyWithoutSignature(policy agentLocalPolicyWire) map[string]any {
	return map[string]any{
		"policyVersion":   policy.PolicyVersion,
		"agentId":         policy.AgentID,
		"authorityKeyIds": policy.AuthorityKeyIDs,
		"allowedActions":  policy.AllowedActions,
		"pathRules":       policy.PathRules,
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

// 自检必须验证端口确实能够绑定，不能只验证配置中存在端口数字。
func managementListenAddressAvailable(config *AgentConfig) bool {
	address := net.JoinHostPort(effectiveManagementListenAddress(config), fmt.Sprintf("%d", effectiveManagementPort(config)))
	response, probeErr := (&http.Client{Timeout: 500 * time.Millisecond}).Get("http://" + address + "/healthz")
	if probeErr == nil {
		_ = response.Body.Close()
		return response.StatusCode >= 200 && response.StatusCode < 500
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		return false
	}
	_ = listener.Close()
	return true
}

func registerAgent(ctx context.Context, client *http.Client, config *AgentConfig, identity runtimeIdentity) (*runtimeState, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return nil, fmt.Errorf("读取主机名失败: %w", err)
	}

	request := registerRequest{
		AgentKey:           config.AgentKey,
		MachineID:          identity.MachineID,
		Hostname:           hostname,
		Version:            agentVersion,
		OSType:             "linux",
		Arch:               runtime.GOARCH,
		IPAddress:          identity.PrimaryIPAddress,
		ManagementEndpoint: managementEndpointForIdentity(identity, config),
		LinuxDistribution:  identity.LinuxDistribution,
		OSVersion:          identity.OSVersion,
		Labels:             []string{"linux-go", "systemd"},
		EnrollmentToken:    strings.TrimSpace(config.EnrollmentToken),
		Role:               effectiveAgentRole(config),
		Zone:               strings.TrimSpace(config.Zone),
	}
	if isGatewayEnabled(config) {
		request.ZoneIDs = []string{firstNonEmpty(strings.TrimSpace(config.Zone), "default")}
		request.Adapters = gatewayRouteChannels()
		request.Capabilities = gatewayCapabilityKeys()
	}

	var response registerResponse
	if err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/register", request, &response); err != nil {
		return nil, fmt.Errorf("注册 Agent 失败: %w", err)
	}
	if strings.TrimSpace(response.ID) == "" {
		return nil, errors.New("注册 Agent 失败: 服务端未返回 agentId")
	}
	if response.TrustMaterial != nil {
		if err := persistAgentTrustMaterial(config, response.ID, response.TrustMaterial); err != nil {
			return nil, fmt.Errorf("保存 Agent 授权材料失败: %w", err)
		}
	}
	return &runtimeState{AgentID: response.ID, Hostname: hostname, Version: agentVersion}, nil
}

func postHeartbeat(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState, counters *runtimeCounters, status *runtimeStatusSnapshot) error {
	request := heartbeatRequest{AgentID: state.AgentID, Version: state.Version, ManagementEndpoint: managementEndpointForIdentity(collectRuntimeIdentity(config.ControlPlane), config)}
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
	acknowledged, err := ackTask(ctx, client, config, state.AgentID, task.ID, leaseID)
	if err != nil {
		return fmt.Errorf("ack 任务失败: %w", err)
	}
	if acknowledged.LeaseID != "" && acknowledged.LeaseID != leaseID {
		fmt.Fprintf(os.Stderr, "[task] skip taskId=%s because it is already owned by another lease\n", task.ID)
		return nil
	}
	if counters != nil {
		counters.Running++
		defer func() { counters.Running-- }()
	}

	success, errorCode, errorMessage, detail := executeTask(ctx, client, config, state, counters, rescan, task)
	request := submitResultRequest{AgentID: state.AgentID, TaskID: task.ID, LeaseID: leaseID, Success: success, ErrorCode: errorCode, ErrorMessage: errorMessage, Detail: detail}
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
		request := submitResultRequest{AgentID: state.AgentID, TaskID: item.TaskID, LeaseID: item.LeaseID, Success: item.Success, ErrorCode: item.ErrorCode, ErrorMessage: item.ErrorMessage, Detail: item.Detail}
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
	if success, code, message, detail, handled := executeGatewayTask(ctx, client, config, task, payload); handled {
		return success, code, message, detail
	}
	wirePayload, action, schemaVersion, err := decodeQueuedAgentV2Payload(payload)
	if err != nil {
		return false, "ACTION_HANDLER_NOT_REGISTERED", err.Error(), map[string]any{
			"taskId":          task.ID,
			"executionRunId":  task.ExecutionRunID,
			"executionStepId": task.ExecutionStepID,
		}
	}
	registry := newLinuxActionRegistry(&linuxActionRuntime{client: client, config: config, state: state, counters: counters, rescan: rescan})
	result := registry.Execute(ctx, coreRegistry.Request{TaskID: task.ID, ActionType: action, SchemaVersion: schemaVersion, Payload: wirePayload})
	if action == agentFactCollect && boolFromMap(wirePayload, "refreshWebInventory") {
		if !result.Success {
			return result.Success, result.ErrorCode, result.ErrorMessage, result.Detail
		}
		if client == nil || config == nil || state == nil {
			return false, "CAPABILITY_RESCAN_UNAVAILABLE", "手动 Web 库存刷新缺少运行时控制面上下文", result.Detail
		}
		rescanDetail, err := runCapabilityRescan(ctx, client, config, state, counters, rescan, "manual", wirePayload)
		detail := cloneMap(result.Detail)
		detail["capabilityRescan"] = rescanDetail
		if err != nil {
			return false, "CAPABILITY_RESCAN_FAILED", fmt.Sprintf("Web 库存上报失败: %v", err), detail
		}
		return true, "", "", detail
	}
	return result.Success, result.ErrorCode, result.ErrorMessage, result.Detail
}

func runCapabilityRescan(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState, _ *runtimeCounters, rescan *rescanState, trigger string, payload map[string]any) (map[string]any, error) {
	if rescan != nil && rescan.Running {
		return map[string]any{"trigger": trigger, "skipped": true}, errors.New("能力重扫正在执行中")
	}
	if rescan != nil {
		rescan.Running = true
		defer func() { rescan.Running = false }()
	}
	startedAt := time.Now().Format(time.RFC3339)
	capabilities := collectCapabilityReports()
	request := capabilityReportRequest{AgentID: state.AgentID, CompatibilityLevel: "L1", Capabilities: capabilities}
	if err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/capabilities", request, nil); err != nil {
		_ = submitRuntimeLog(ctx, client, config, submitRuntimeLogRequest{AgentID: state.AgentID, Category: runtimeLogCategoryForTrigger(trigger), Level: "error", Summary: runtimeLogSummaryForTrigger(trigger, false), Detail: map[string]any{"error": err.Error(), "requestedBy": readRequestedBy(payload)}, EmittedAt: time.Now().Format(time.RFC3339)})
		return map[string]any{"trigger": trigger, "startedAt": startedAt, "finishedAt": time.Now().Format(time.RFC3339), "capabilityCount": len(capabilities), "requestedBy": readRequestedBy(payload)}, err
	}
	_ = submitRuntimeLog(ctx, client, config, submitRuntimeLogRequest{AgentID: state.AgentID, Category: runtimeLogCategoryForTrigger(trigger), Level: "info", Summary: runtimeLogSummaryForTrigger(trigger, true), Detail: map[string]any{"requestedBy": readRequestedBy(payload), "capabilityCount": len(capabilities)}, EmittedAt: time.Now().Format(time.RFC3339)})
	return map[string]any{"trigger": trigger, "startedAt": startedAt, "finishedAt": time.Now().Format(time.RFC3339), "capabilityCount": len(capabilities), "requestedBy": readRequestedBy(payload)}, nil
}

func ackTask(ctx context.Context, client *http.Client, config *AgentConfig, agentID string, taskID string, leaseID string) (*agentTaskEnvelope, error) {
	var response agentTaskEnvelope
	if err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/tasks/ack", ackTaskRequest{AgentID: agentID, TaskID: taskID, LeaseID: leaseID}, &response); err != nil {
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

func readRequestedBy(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	value, _ := payload["requestedBy"].(string)
	return value
}

func boolFromMap(payload map[string]any, key string) bool {
	if payload == nil {
		return false
	}
	value, ok := payload[key].(bool)
	return ok && value
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
	capabilities := make([]reportedCapability, 0, len(publicCapabilities)+1)
	for _, capability := range publicCapabilities {
		capabilities = append(capabilities, reportedCapability{
			CapabilityKey: capability.Key,
			Value:         capability.Value,
			Confidence:    capability.Confidence,
			Evidence:      capability.Evidence,
		})
	}
	capabilities = append(capabilities, reportedCapability{
		CapabilityKey: "web.inventory",
		Value:         collectLinuxWebInventory(),
		Confidence:    0.8,
		Evidence:      map[string]any{"source": "agent-v2-generic-inventory"},
	})
	return capabilities
}

func collectLinuxWebInventory() map[string]any {
	processes := collectLinuxProcesses()
	processPaths := make([]string, 0, len(processes))
	for _, process := range processes {
		if value, ok := process["executablePath"].(string); ok && strings.TrimSpace(value) != "" {
			processPaths = append(processPaths, value)
		}
	}
	configFiles := collectLinuxWebConfigFiles()
	certificateFiles := collectLinuxWebCertificateFiles(configFiles)
	return map[string]any{
		"processExecutables": processPaths,
		"listeningPorts":     collectLinuxListeningPorts(),
		"configFiles":        sanitizeLinuxWebConfigFiles(configFiles),
		"certificateFiles":   certificateFiles,
	}
}

// 只在本机读取受控系统目录中的配置文本；回传前会去掉 keystore 密码。
func collectLinuxWebConfigFiles() []map[string]any {
	files := make([]map[string]any, 0, 128)
	for _, root := range webDiscoveryRoots {
		_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil || entry == nil {
				return nil
			}
			if entry.IsDir() {
				if path != root && strings.Count(strings.TrimPrefix(path, root), string(os.PathSeparator)) > 4 {
					return filepath.SkipDir
				}
				return nil
			}
			resolvedPath, err := filepath.EvalSymlinks(path)
			if err != nil || !isAllowedWebDiscoveryPath(resolvedPath) {
				return nil
			}
			ext := strings.ToLower(filepath.Ext(path))
			if ext != ".conf" && ext != ".xml" && ext != ".properties" {
				return nil
			}
			info, err := os.Stat(resolvedPath)
			if err != nil || info.Size() > 256*1024 {
				return nil
			}
			content, err := os.ReadFile(resolvedPath)
			if err == nil && containsWebConfigSyntax(content) {
				files = append(files, map[string]any{"path": path, "content": string(content)})
			}
			return nil
		})
		if len(files) >= 256 {
			break
		}
	}
	return files
}

func sanitizeLinuxWebConfigFiles(configFiles []map[string]any) []map[string]any {
	files := make([]map[string]any, 0, len(configFiles))
	for _, config := range configFiles {
		copy := make(map[string]any, len(config))
		for key, value := range config {
			copy[key] = value
		}
		if content, ok := copy["content"].(string); ok {
			copy["content"] = redactWebKeystorePasswords(content)
		}
		files = append(files, copy)
	}
	return files
}

// 仅保留包含固定 Web 配置语法的文件，避免无关配置先耗尽快照配额。
func containsWebConfigSyntax(content []byte) bool {
	lower := bytes.ToLower(content)
	for _, marker := range [][]byte{
		[]byte("server_name"), []byte("ssl_certificate"), []byte("server {"),
		[]byte("<virtualhost"), []byte("sslcertificatefile"),
		[]byte("<connector"), []byte("<host"), []byte("<context"),
	} {
		if bytes.Contains(lower, marker) {
			return true
		}
	}
	return false
}

// 只回传配置引用的公钥证书候选；禁止私钥和过大的文件进入能力快照。
func collectLinuxWebCertificateFiles(configFiles []map[string]any) []map[string]any {
	files := make([]map[string]any, 0, 256)
	seen := make(map[string]map[string]any)
	for _, config := range configFiles {
		content, ok := config["content"].(string)
		if !ok {
			continue
		}
		configPath, _ := config["path"].(string)
		passwords := webKeystorePasswords(content)
		for _, match := range certificatePathPattern.FindAllStringSubmatch(content, -1) {
			configuredPath := strings.TrimSpace(strings.Trim(match[1], "\"'"))
			candidate := resolveWebCertificatePath(configuredPath, configPath)
			if candidate == "" || !isAllowedWebDiscoveryPath(candidate) {
				continue
			}
			if certificate, ok := seen[candidate]; ok {
				configuredPaths, _ := certificate["configuredPaths"].([]string)
				if !containsString(configuredPaths, configuredPath) {
					certificate["configuredPaths"] = append(configuredPaths, configuredPath)
				}
				continue
			}
			if certificate := readLinuxPublicCertificateWithPasswords(candidate, passwords); certificate != nil {
				certificate["configuredPaths"] = []string{configuredPath}
				seen[candidate] = certificate
				files = append(files, certificate)
			}
			if len(files) >= 256 {
				return files
			}
		}
	}
	return files
}

var certificatePathPattern = regexp.MustCompile(`(?im)(?:ssl_certificate|SSLCertificateFile|certificateFile|certificate-file|certificateKeystoreFile|keystoreFile)\s*(?:=\s*|\s+)(["']?[^;\s"']+["']?)`)

var webDiscoveryRoots = []string{"/etc", "/opt", "/usr/local", "/srv", "/var/lib", "/var/www"}

func isAllowedWebDiscoveryPath(candidate string) bool {
	if !filepath.IsAbs(candidate) {
		return false
	}
	clean := filepath.Clean(candidate)
	for _, root := range webDiscoveryRoots {
		if pathWithinWebDiscoveryRoot(clean, root) {
			return true
		}
		if resolvedRoot, err := filepath.EvalSymlinks(root); err == nil && pathWithinWebDiscoveryRoot(clean, resolvedRoot) {
			return true
		}
	}
	return false
}

func pathWithinWebDiscoveryRoot(path, root string) bool {
	relative, err := filepath.Rel(root, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator))
}

func readLinuxPublicCertificate(path string) map[string]any {
	return readLinuxPublicCertificateWithPasswords(path, nil)
}

func readLinuxPublicCertificateWithPasswords(path string, passwords []string) map[string]any {
	resolvedPath, err := filepath.EvalSymlinks(path)
	if err != nil || !isAllowedWebDiscoveryPath(resolvedPath) {
		return nil
	}
	info, err := os.Stat(resolvedPath)
	if err != nil || !info.Mode().IsRegular() || info.Size() > 256*1024 {
		return nil
	}
	content, err := os.ReadFile(resolvedPath)
	if err != nil {
		return nil
	}
	if bytes.Contains(bytes.ToUpper(content), []byte("PRIVATE KEY")) {
		return nil
	}
	block, _ := pem.Decode(content)
	if block != nil && block.Type == "CERTIFICATE" {
		return certificateMetadata(path, block.Bytes)
	}
	for _, password := range append([]string{""}, passwords...) {
		if certificate := readJKSOrPKCS12Certificate(path, content, password); certificate != nil {
			return certificate
		}
	}
	return nil
}

func certificateMetadata(path string, der []byte) map[string]any {
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		return nil
	}
	fingerprint := sha256.Sum256(certificate.Raw)
	return map[string]any{
		"path":              path,
		"name":              certificate.Subject.CommonName,
		"sha256Fingerprint": hex.EncodeToString(fingerprint[:]),
		"subject":           certificate.Subject.String(),
		"issuer":            certificate.Issuer.String(),
		"notBefore":         certificate.NotBefore.UTC().Format(time.RFC3339),
		"notAfter":          certificate.NotAfter.UTC().Format(time.RFC3339),
	}
}

func readJKSOrPKCS12Certificate(path string, content []byte, password string) map[string]any {
	store := keystore.New()
	if err := store.Load(bytes.NewReader(content), []byte(password)); err == nil {
		for _, alias := range store.Aliases() {
			if store.IsPrivateKeyEntry(alias) {
				chain, err := store.GetPrivateKeyEntryCertificateChain(alias)
				if err == nil && len(chain) > 0 {
					return certificateMetadata(path, chain[0].Content)
				}
			}
			if store.IsTrustedCertificateEntry(alias) {
				entry, err := store.GetTrustedCertificateEntry(alias)
				if err == nil {
					return certificateMetadata(path, entry.Certificate.Content)
				}
			}
		}
	}
	_, certificate, _, err := pkcs12.DecodeChain(content, password)
	if err != nil || certificate == nil {
		return nil
	}
	return certificateMetadata(path, certificate.Raw)
}

func webKeystorePasswords(content string) []string {
	passwords := make([]string, 0, 2)
	for _, key := range []string{"certificateKeystorePassword", "keystorePass", "keystorePassword"} {
		pattern := regexp.MustCompile(`(?i)` + key + `\s*=\s*["']([^"']*)["']`)
		for _, match := range pattern.FindAllStringSubmatch(content, -1) {
			if len(match) > 1 && match[1] != "" && !containsString(passwords, match[1]) {
				passwords = append(passwords, match[1])
			}
		}
	}
	return passwords
}

func redactWebKeystorePasswords(content string) string {
	return regexp.MustCompile(`(?i)(certificateKeystorePassword|keystorePass|keystorePassword)(\s*=\s*["'])[^"']*(["'])`).ReplaceAllString(content, `$1$2***$3`)
}

func resolveWebCertificatePath(candidate, configPath string) string {
	candidate = strings.TrimSpace(strings.Trim(candidate, "\"'"))
	if candidate == "" {
		return ""
	}
	if filepath.IsAbs(candidate) {
		return filepath.Clean(candidate)
	}
	configDir := filepath.Dir(configPath)
	for _, base := range []string{configDir, filepath.Dir(configDir)} {
		resolved := filepath.Clean(filepath.Join(base, candidate))
		if isAllowedWebDiscoveryPath(resolved) && fileExists(resolved) {
			return resolved
		}
	}
	return filepath.Clean(filepath.Join(configDir, candidate))
}
