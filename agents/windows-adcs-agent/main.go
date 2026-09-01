package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/csv"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"runtime/debug"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf16"
)

const (
	defaultAgentVersion      = "0.1.20"
	defaultConfigPath        = `C:\ProgramData\GCAC\WindowsAdcsAgent\config\agent.config.json`
	defaultConfigDir         = `C:\ProgramData\GCAC\WindowsAdcsAgent\config`
	defaultDataDir           = `C:\ProgramData\GCAC\WindowsAdcsAgent\data`
	defaultLogDir            = `C:\ProgramData\GCAC\WindowsAdcsAgent\logs`
	defaultManagementPort    = 18933
	defaultHeartbeat         = 10
	defaultTaskPoll          = 5
	defaultObservation       = 5
	observationStateVersion  = 5
	observationParserVersion = "adcs-observation-20260827-v6"
	adcsCommandTimeout       = 45 * time.Second
	adcsTaskExecutionTimeout = 75 * time.Second
)

var agentVersion = defaultAgentVersion

// AgentConfig 只包含 AD CS Agent 自己的配置空间，不能解析其它 Agent 的目录或服务信息。
type AgentConfig struct {
	SchemaVersion              string `json:"schemaVersion"`
	Version                    string `json:"version"`
	TenantID                   string `json:"tenantId"`
	AgentKey                   string `json:"agentKey"`
	EnrollmentToken            string `json:"enrollmentToken"`
	Zone                       string `json:"zone"`
	ControlPlane               string `json:"controlPlaneUrl"`
	HeartbeatIntervalSeconds   int    `json:"heartbeatIntervalSeconds"`
	TaskPollIntervalSeconds    int    `json:"taskPollIntervalSeconds"`
	ObservationIntervalSeconds int    `json:"observationIntervalSeconds"`
	CaConfig                   string `json:"caConfig,omitempty"`
	ManagementListenAddress    string `json:"managementListenAddress"`
	ManagementPort             int    `json:"managementPort"`
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

type registerRequest struct {
	AgentKey           string   `json:"agentKey"`
	MachineID          string   `json:"machineId,omitempty"`
	Hostname           string   `json:"hostname"`
	CaName             string   `json:"caName,omitempty"`
	CaConfig           string   `json:"caConfig,omitempty"`
	Version            string   `json:"version"`
	OSType             string   `json:"osType"`
	Arch               string   `json:"arch,omitempty"`
	IPAddress          string   `json:"ipAddress,omitempty"`
	ManagementEndpoint string   `json:"managementEndpoint,omitempty"`
	OSVersion          string   `json:"osVersion,omitempty"`
	Labels             []string `json:"labels,omitempty"`
	Capabilities       []string `json:"capabilities,omitempty"`
	EnrollmentToken    string   `json:"enrollmentToken,omitempty"`
	Role               string   `json:"role"`
	Zone               string   `json:"zone,omitempty"`
}

type registerResponse struct {
	ID string `json:"id"`
}

type heartbeatRequest struct {
	AgentID            string `json:"agentId"`
	Version            string `json:"version"`
	ManagementEndpoint string `json:"managementEndpoint,omitempty"`
	TaskSummary        struct {
		Running int `json:"running"`
		Queued  int `json:"queued"`
	} `json:"taskSummary"`
	RuntimeHealth map[string]any `json:"runtimeHealth,omitempty"`
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

type agentTaskEnvelope struct {
	ID      string         `json:"id"`
	AgentID string         `json:"agentId"`
	Payload map[string]any `json:"payload"`
	Status  string         `json:"status"`
	LeaseID string         `json:"leaseId,omitempty"`
}
type ackTaskRequest struct{ AgentID, TaskID, LeaseID string }

func (r ackTaskRequest) MarshalJSON() ([]byte, error) {
	return json.Marshal(map[string]string{"agentId": r.AgentID, "taskId": r.TaskID, "leaseId": r.LeaseID})
}

type submitResultRequest struct {
	AgentID      string         `json:"agentId"`
	TaskID       string         `json:"taskId"`
	LeaseID      string         `json:"leaseId"`
	Success      bool           `json:"success"`
	Status       string         `json:"status"`
	ErrorCode    string         `json:"errorCode,omitempty"`
	ErrorMessage string         `json:"errorMessage,omitempty"`
	Detail       map[string]any `json:"detail,omitempty"`
}

type registration struct {
	AgentID  string
	CaName   string
	CaConfig string
}
type counters struct {
	mu              sync.Mutex
	running, queued int
}

func main() {
	if err := runCLI(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func runCLI(args []string) error {
	if len(args) == 0 {
		return errors.New("用法：gcac-adcs-agent.exe [run|service run|register-once|self-check] --config=...")
	}
	command := args[0]
	serviceMode := false
	if command == "service" {
		if len(args) < 2 || args[1] != "run" {
			return errors.New("service 仅支持 service run")
		}
		command = "run"
		args = args[1:]
		serviceMode = true
	}
	fs := flag.NewFlagSet("gcac-adcs-agent", flag.ContinueOnError)
	configPath := fs.String("config", defaultConfigPath, "配置文件路径")
	if err := fs.Parse(args[1:]); err != nil {
		return err
	}
	config, err := loadConfig(*configPath)
	if err != nil {
		return err
	}
	switch command {
	case "self-check":
		return validateConfig(config)
	case "register-once":
		_, err = registerAgent(context.Background(), http.DefaultClient, config)
		return err
	case "run":
		if serviceMode {
			return runWindowsService(config.Service.Name, config)
		}
		return runAgent(config)
	default:
		return fmt.Errorf("不支持的命令：%s", command)
	}
}

func loadConfig(path string) (*AgentConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("读取 AD CS Agent 配置失败：%w", err)
	}
	var config AgentConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("解析 AD CS Agent 配置失败：%w", err)
	}
	if config.ManagementPort == 0 {
		config.ManagementPort = defaultManagementPort
	}
	if strings.TrimSpace(config.Version) == "" {
		config.Version = agentVersion
	}
	if config.ManagementListenAddress == "" {
		config.ManagementListenAddress = "0.0.0.0"
	}
	if config.HeartbeatIntervalSeconds == 0 {
		config.HeartbeatIntervalSeconds = defaultHeartbeat
	}
	if config.TaskPollIntervalSeconds == 0 {
		config.TaskPollIntervalSeconds = defaultTaskPoll
	}
	if config.ObservationIntervalSeconds <= 0 || config.ObservationIntervalSeconds > 3600 {
		config.ObservationIntervalSeconds = defaultObservation
	}
	if config.Paths.Windows.ConfigPath == "" {
		config.Paths.Windows.ConfigPath = defaultConfigPath
	}
	if config.Paths.Windows.DataDir == "" {
		config.Paths.Windows.DataDir = defaultDataDir
	}
	if config.Paths.Windows.LogDir == "" {
		config.Paths.Windows.LogDir = defaultLogDir
	}
	if config.Service.Name == "" {
		config.Service.Name = "GCACWindowsAdcsAgent"
	}
	if config.Service.DisplayName == "" {
		config.Service.DisplayName = "GCAC Windows AD CS Agent"
	}
	return &config, validateConfig(&config)
}

func validateConfig(config *AgentConfig) error {
	if config == nil {
		return errors.New("配置不能为空")
	}
	if config.SchemaVersion != "gcac.adcs-agent.windows.v1" {
		return fmt.Errorf("不支持的配置 schemaVersion：%s", config.SchemaVersion)
	}
	if strings.TrimSpace(config.AgentKey) == "" || strings.TrimSpace(config.ControlPlane) == "" {
		return errors.New("agentKey 和 controlPlaneUrl 不能为空")
	}
	if config.ManagementPort != defaultManagementPort {
		return fmt.Errorf("AD CS Agent 管理端口必须为 %d", defaultManagementPort)
	}
	if config.Service.Name != "GCACWindowsAdcsAgent" {
		return errors.New("AD CS Agent 服务名不匹配")
	}
	if config.Paths.Windows.ConfigPath != "" && config.Paths.Windows.ConfigPath != defaultConfigPath {
		return errors.New("AD CS Agent 配置目录不匹配")
	}
	if config.Paths.Windows.DataDir != "" && config.Paths.Windows.DataDir != defaultDataDir {
		return errors.New("AD CS Agent 数据目录不匹配")
	}
	if config.Paths.Windows.LogDir != "" && config.Paths.Windows.LogDir != defaultLogDir {
		return errors.New("AD CS Agent 日志目录不匹配")
	}
	return nil
}

func runAgent(config *AgentConfig) error {
	return runAgentContext(context.Background(), config)
}

func runAgentContext(ctx context.Context, config *AgentConfig) error {
	client := &http.Client{Timeout: 60 * time.Second}
	reg, err := registerAgent(ctx, client, config)
	if err != nil {
		return err
	}
	if err := reportCapabilities(ctx, client, config, reg); err != nil {
		// 能力投影失败不应阻断本机 CA 观测。记录推送有独立的鉴权、解析和
		// 失败队列，控制面恢复后能力快照也会在下一次重启或补偿时更新。
		logAdcsAgentError(config, fmt.Sprintf("AD CS Agent 能力上报失败，将继续运行观测循环：%v", err))
	}
	writeAdcsServiceLog(config, fmt.Sprintf("AD CS Agent 已注册：agentId=%s caConfig=%s", reg.AgentID, reg.CaConfig))
	var state counters
	observationState, err := loadObservationState(config.Paths.Windows.DataDir)
	if err != nil {
		logAdcsAgentError(config, fmt.Sprintf("读取 AD CS Agent 观测队列失败，将创建空队列：%v", err))
		observationState = newObservationState()
	}
	var observationMu sync.RWMutex
	runObservation := func(runCtx context.Context, force bool) (observationRunSummary, error) {
		observationMu.Lock()
		defer observationMu.Unlock()
		err := collectAndPushObservations(runCtx, client, config, reg, observationState, force)
		if observationState.LastRun == nil {
			return observationRunSummary{}, err
		}
		return *observationState.LastRun, err
	}
	sendHeartbeat := func(heartbeatCtx context.Context) error {
		return heartbeat(heartbeatCtx, client, config, reg, &state, observationState, &observationMu)
	}
	server := startManagementServer(config, runObservation, sendHeartbeat)
	defer server.Shutdown(context.Background())
	if err := sendHeartbeat(ctx); err != nil {
		logAdcsAgentError(config, fmt.Sprintf("AD CS Agent 首次心跳失败：%v", err))
	}
	if _, err := runObservation(ctx, false); err != nil {
		logAdcsAgentError(config, fmt.Sprintf("AD CS Agent 首次观测上报失败：%v", err))
	}
	heartbeatTicker := time.NewTicker(time.Duration(config.HeartbeatIntervalSeconds) * time.Second)
	defer heartbeatTicker.Stop()
	taskTicker := time.NewTicker(time.Duration(config.TaskPollIntervalSeconds) * time.Second)
	defer taskTicker.Stop()
	observationTicker := time.NewTicker(time.Duration(config.ObservationIntervalSeconds) * time.Second)
	defer observationTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-heartbeatTicker.C:
			if err := sendHeartbeat(ctx); err != nil {
				logAdcsAgentError(config, fmt.Sprintf("AD CS Agent 心跳失败：%v", err))
			}
		case <-taskTicker.C:
			if err := pullAndProcessTasks(ctx, client, config, reg, &state); err != nil {
				logAdcsAgentError(config, fmt.Sprintf("AD CS Agent 任务轮询失败：%v", err))
			}
		case <-observationTicker.C:
			if _, err := runObservation(ctx, false); err != nil {
				logAdcsAgentError(config, fmt.Sprintf("AD CS Agent 观测上报失败：%v", err))
			}
		}
	}
}

func logAdcsAgentError(config *AgentConfig, message string) {
	fmt.Fprintln(os.Stderr, message)
	writeAdcsServiceLog(config, message)
}

func registerAgent(ctx context.Context, client *http.Client, config *AgentConfig) (*registration, error) {
	hostname, _ := os.Hostname()
	caName, discoveredCaConfig := discoverCaIdentity(ctx)
	caConfig := strings.TrimSpace(config.CaConfig)
	if caConfig == "" {
		caConfig = discoveredCaConfig
	}
	if caConfig == "" && caName != "" && hostname != "" {
		caConfig = hostname + `\` + caName
	}
	if caName == "" && caConfig != "" {
		parts := strings.SplitN(caConfig, `\`, 2)
		if len(parts) == 2 {
			caName = strings.TrimSpace(parts[1])
		}
	}
	request := registerRequest{AgentKey: config.AgentKey, Hostname: hostname, CaName: caName, CaConfig: caConfig, Version: agentVersion, OSType: "windows_adcs", Arch: runtime.GOARCH, ManagementEndpoint: managementEndpoint(config), Labels: []string{"windows-adcs", "windows-service", "adcs_agent"}, Capabilities: adcsCapabilities(), EnrollmentToken: config.EnrollmentToken, Role: "adcs_agent", Zone: config.Zone}
	var response registerResponse
	if err := doJSON(ctx, client, config, http.MethodPost, "/api/v1/agents/register", request, &response); err != nil {
		return nil, fmt.Errorf("注册 AD CS Agent 失败：%w", err)
	}
	if response.ID == "" {
		return nil, errors.New("注册 AD CS Agent 失败：控制面未返回 agentId")
	}
	return &registration{AgentID: response.ID, CaName: caName, CaConfig: caConfig}, nil
}

// discoverCaIdentity 从本机 AD CS 读取稳定的 server\CAName 身份。非 Windows
// 环境返回空值，这样交叉编译和协议测试不需要伪造 certutil.exe。
func discoverCaIdentity(ctx context.Context) (string, string) {
	if runtime.GOOS != "windows" {
		return "", ""
	}
	if output, err := runCommand(ctx, "certutil.exe", "-getconfig"); err == nil {
		if caConfig := parseCaConfigOutput(output); caConfig != "" {
			parts := strings.SplitN(caConfig, `\`, 2)
			if len(parts) == 2 {
				return strings.TrimSpace(parts[1]), caConfig
			}
		}
	}
	for _, registryName := range []string{"DisplayName", "CommonName"} {
		output, err := runCommand(ctx, "certutil.exe", "-getreg", "CA\\"+registryName)
		if err != nil {
			continue
		}
		if value := parseRegistryValue(output); value != "" {
			return value, ""
		}
	}
	return "", ""
}

func parseRegistryValue(output string) string {
	for _, line := range strings.Split(output, "\n") {
		if _, value, ok := strings.Cut(line, "="); ok {
			value = strings.Trim(strings.TrimSpace(value), "\"'")
			if value != "" {
				return value
			}
		}
	}
	return ""
}

func parseCaConfigOutput(output string) string {
	for _, line := range strings.Split(output, "\n") {
		value := strings.Trim(strings.TrimSpace(line), "\"' ,")
		if index := strings.Index(value, ":"); index >= 0 {
			value = strings.Trim(strings.TrimSpace(value[index+1:]), "\"' ,")
		}
		if strings.Count(value, `\`) != 1 || strings.Contains(strings.ToLower(value), "certutil:") {
			continue
		}
		parts := strings.SplitN(value, `\`, 2)
		if strings.TrimSpace(parts[0]) != "" && strings.TrimSpace(parts[1]) != "" {
			return value
		}
	}
	return ""
}

func adcsCapabilities() []string {
	return []string{"ca.microsoft-adcs", "ca.microsoft-adcs.status", "ca.certificate.issue", "ca.certificate.renew", "ca.certificate.query", "ca.certificate.revoke", "ca.revocation.evidence", "ca.crl.status", "ca.crl.publish"}
}

func reportCapabilities(ctx context.Context, client *http.Client, config *AgentConfig, reg *registration) error {
	caps := make([]reportedCapability, 0, len(adcsCapabilities()))
	for _, key := range adcsCapabilities() {
		caps = append(caps, reportedCapability{CapabilityKey: key, Value: true, Confidence: 1, Evidence: map[string]any{"agentRole": "adcs_agent", "platform": "windows_adcs"}})
	}
	return doJSON(ctx, client, config, http.MethodPost, "/api/v1/agents/capabilities", capabilityReportRequest{AgentID: reg.AgentID, CompatibilityLevel: "native", Capabilities: caps}, nil)
}

func heartbeat(ctx context.Context, client *http.Client, config *AgentConfig, reg *registration, state *counters, observationState *persistedObservationState, observationMu *sync.RWMutex) error {
	state.mu.Lock()
	defer state.mu.Unlock()
	runtimeHealth := map[string]any{"modelVersion": "gcac-adcs-agent/v1", "status": "healthy"}
	if observationMu != nil {
		observationMu.RLock()
		if observationState != nil && observationState.LastRun != nil {
			runtimeHealth["observation"] = observationState.LastRun
		}
		observationMu.RUnlock()
	}
	request := heartbeatRequest{AgentID: reg.AgentID, Version: agentVersion, ManagementEndpoint: managementEndpoint(config), RuntimeHealth: runtimeHealth}
	request.TaskSummary.Running, request.TaskSummary.Queued = state.running, state.queued
	return doJSON(ctx, client, config, http.MethodPost, "/api/v1/agents/heartbeat", request, nil)
}

type adcsObservationBatch struct {
	AgentID    string           `json:"agentId"`
	CaName     string           `json:"caName,omitempty"`
	CaConfig   string           `json:"caConfig,omitempty"`
	ObservedAt string           `json:"observedAt"`
	Sequence   int64            `json:"sequence"`
	Records    []map[string]any `json:"records"`
}

type adcsObservationIngestResult struct {
	Accepted   int `json:"accepted"`
	Inserted   int `json:"inserted"`
	Updated    int `json:"updated"`
	Duplicates int `json:"duplicates"`
	Rejected   int `json:"rejected"`
	Rejections []struct {
		Index  int    `json:"index"`
		Reason string `json:"reason"`
	} `json:"rejections,omitempty"`
	AgentID    string `json:"agentId,omitempty"`
	CaID       string `json:"caId,omitempty"`
	ProviderID string `json:"providerId,omitempty"`
	ObservedAt string `json:"observedAt,omitempty"`
}

type pendingObservationBatch struct {
	Batch         adcsObservationBatch `json:"batch"`
	Fingerprints  map[string]string    `json:"fingerprints"`
	AttemptCount  int                  `json:"attemptCount"`
	NextAttemptAt string               `json:"nextAttemptAt,omitempty"`
	LastError     string               `json:"lastError,omitempty"`
}

// observationSourceIdentity 标识本地观测来源。Agent 重新注册后可能获得新的
// agentId，旧的 sent 指纹不能跨身份复用，否则会把历史记录错误判定为已发送。
type observationSourceIdentity struct {
	AgentID       string `json:"agentId,omitempty"`
	AgentKey      string `json:"agentKey,omitempty"`
	AgentVersion  string `json:"agentVersion,omitempty"`
	CaName        string `json:"caName,omitempty"`
	CaConfig      string `json:"caConfig,omitempty"`
	ParserVersion string `json:"parserVersion,omitempty"`
}

type observationRunSummary struct {
	Status           string         `json:"status"`
	Forced           bool           `json:"forced,omitempty"`
	ParserVersion    string         `json:"parserVersion,omitempty"`
	StartedAt        string         `json:"startedAt"`
	CompletedAt      string         `json:"completedAt"`
	LastRunAt        string         `json:"lastRunAt,omitempty"`
	SourceAgentID    string         `json:"sourceAgentId,omitempty"`
	SourceCaName     string         `json:"sourceCaName,omitempty"`
	SourceCaConfig   string         `json:"sourceCaConfig,omitempty"`
	ScannedRecords   int            `json:"scannedRecords"`
	ChangedRecords   int            `json:"changedRecords"`
	QueuedRecords    int            `json:"queuedRecords"`
	AttemptedBatches int            `json:"attemptedBatches"`
	SubmittedRecords int            `json:"submittedRecords"`
	FailedBatches    int            `json:"failedBatches"`
	SentBatches      int            `json:"sentBatches"`
	SentRecords      int            `json:"sentRecords"`
	AcceptedRecords  int            `json:"acceptedRecords"`
	InsertedRecords  int            `json:"insertedRecords"`
	UpdatedRecords   int            `json:"updatedRecords"`
	DuplicateRecords int            `json:"duplicateRecords"`
	RejectedRecords  int            `json:"rejectedRecords"`
	PendingBatches   int            `json:"pendingBatches"`
	StatusCounts     map[string]int `json:"statusCounts,omitempty"`
	Warnings         []string       `json:"warnings,omitempty"`
	Error            string         `json:"error,omitempty"`
}

type observationFlushSummary struct {
	AttemptedBatches int
	SubmittedRecords int
	SentBatches      int
	SentRecords      int
	FailedBatches    int
	AcceptedRecords  int
	InsertedRecords  int
	UpdatedRecords   int
	DuplicateRecords int
	RejectedRecords  int
}

type persistedObservationState struct {
	Version int                       `json:"version"`
	Source  observationSourceIdentity `json:"source,omitempty"`
	// Sequence 只用于观测批次排序提示，不参与去重。
	Sequence int64                     `json:"sequence"`
	Sent     map[string]string         `json:"sent"`
	Pending  []pendingObservationBatch `json:"pending"`
	LastRun  *observationRunSummary    `json:"lastRun,omitempty"`
}

func newObservationState() *persistedObservationState {
	return &persistedObservationState{Version: observationStateVersion, Sent: map[string]string{}, Pending: []pendingObservationBatch{}}
}

func loadObservationState(dataDir string) (*persistedObservationState, error) {
	state := newObservationState()
	path := filepath.Join(dataDir, "ca-observations.json")
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(data, state); err != nil {
		return nil, err
	}
	if state.Sent == nil {
		state.Sent = map[string]string{}
	}
	if state.Pending == nil {
		state.Pending = []pendingObservationBatch{}
	}
	return state, nil
}

// reconcileObservationState 在每轮扫描前绑定当前 Agent/CA 身份。
//
// 旧版本状态文件没有来源身份，或者当前注册返回了新的 agentId 时，
// 必须清空 sent 指纹，保证重新安装/删除后重建 Agent 能重新回填历史记录。
// 未完成队列只更新 Agent 身份，保留原始 CA 标识，避免失败记录因重注册而
// 永久停留在旧 Agent 身份下。
func reconcileObservationState(config *AgentConfig, reg *registration, state *persistedObservationState) {
	if config == nil || reg == nil || state == nil {
		return
	}
	current := observationSourceIdentity{
		AgentID:       strings.TrimSpace(reg.AgentID),
		AgentKey:      strings.TrimSpace(config.AgentKey),
		AgentVersion:  strings.TrimSpace(agentVersion),
		CaName:        strings.TrimSpace(reg.CaName),
		CaConfig:      strings.TrimSpace(reg.CaConfig),
		ParserVersion: observationParserVersion,
	}
	if current.CaConfig == "" {
		current.CaConfig = strings.TrimSpace(config.CaConfig)
	}
	previous := state.Source
	legacyState := state.Version < observationStateVersion
	legacyState = legacyState || (previous.AgentID == "" && previous.AgentKey == "" && previous.CaName == "" && previous.CaConfig == "")
	sourceChanged := legacyState
	if !legacyState {
		sourceChanged = previous.AgentID != current.AgentID
		sourceChanged = sourceChanged || !sameIdentityText(previous.AgentKey, current.AgentKey)
		sourceChanged = sourceChanged || !sameIdentityText(previous.AgentVersion, current.AgentVersion)
		sourceChanged = sourceChanged || !sameIdentityText(previous.CaName, current.CaName)
		sourceChanged = sourceChanged || !sameIdentityText(previous.CaConfig, current.CaConfig)
		sourceChanged = sourceChanged || !sameIdentityText(previous.ParserVersion, current.ParserVersion)
	}
	if sourceChanged {
		state.Sent = map[string]string{}
		for index := range state.Pending {
			state.Pending[index].Batch.AgentID = current.AgentID
		}
	}
	state.Version = observationStateVersion
	state.Source = current
}

func sameIdentityText(left, right string) bool {
	return strings.EqualFold(strings.TrimSpace(left), strings.TrimSpace(right))
}

func saveObservationState(dataDir string, state *persistedObservationState) error {
	if state == nil {
		return errors.New("观测状态不能为空")
	}
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(state)
	if err != nil {
		return err
	}
	path := filepath.Join(dataDir, "ca-observations.json")
	tmp, err := os.CreateTemp(dataDir, "ca-observations-*.tmp")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err == nil {
		return nil
	}
	// Windows 的 Rename 在目标文件已存在时可能拒绝覆盖；保留同一临时文件
	// 重试，避免队列因旧状态文件存在而无法持久化。
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return os.Rename(tmpPath, path)
}

func collectAndPushObservations(ctx context.Context, client *http.Client, config *AgentConfig, reg *registration, state *persistedObservationState, force bool) (resultErr error) {
	if state == nil {
		return errors.New("观测状态不能为空")
	}
	reconcileObservationState(config, reg, state)
	startedAt := time.Now().UTC()
	summary := observationRunSummary{
		Status:         "running",
		Forced:         force,
		ParserVersion:  observationParserVersion,
		StartedAt:      startedAt.Format(time.RFC3339Nano),
		SourceAgentID:  strings.TrimSpace(reg.AgentID),
		SourceCaName:   strings.TrimSpace(reg.CaName),
		SourceCaConfig: strings.TrimSpace(reg.CaConfig),
	}
	defer func() {
		summary.CompletedAt = time.Now().UTC().Format(time.RFC3339Nano)
		// lastRunAt 是控制面运行态的稳定读取字段；CompletedAt 继续保留给
		// 观测批次明细和兼容旧版心跳解析。
		summary.LastRunAt = summary.CompletedAt
		summary.PendingBatches = len(state.Pending)
		if resultErr != nil {
			summary.Status = "failed"
			summary.Error = truncate(resultErr.Error(), 1024)
		} else {
			summary.Status = "success"
		}
		state.LastRun = &summary
		if saveErr := saveObservationState(config.Paths.Windows.DataDir, state); saveErr != nil {
			if resultErr == nil {
				resultErr = saveErr
				summary.Status = "failed"
				summary.Error = truncate(saveErr.Error(), 1024)
				state.LastRun = &summary
				_ = saveObservationState(config.Paths.Windows.DataDir, state)
			}
		}
		logObservationRun(config, summary)
	}()
	// 先补发磁盘队列；补发失败不应阻止本轮继续读取本机 CA。
	firstFlush, firstErr := flushObservationQueueWithStats(ctx, client, config, state)
	mergeObservationFlushSummary(&summary, firstFlush)
	records, warnings, err := collectAdcsObservationRecords(ctx, config, reg)
	if err != nil {
		if firstErr != nil {
			return errors.Join(firstErr, err)
		}
		return err
	}
	summary.Warnings = append(summary.Warnings, warnings...)
	summary.ScannedRecords, summary.StatusCounts = summarizeAdcsObservationRecords(records)
	pendingKeys := make(map[string]struct{})
	for _, item := range state.Pending {
		for key := range item.Fingerprints {
			pendingKeys[key] = struct{}{}
		}
	}
	changed := make([]map[string]any, 0, len(records))
	fingerprints := make(map[string]string)
	for _, record := range records {
		objectType := stringValue(record, "objectType")
		externalID := stringValue(record, "externalObjectId")
		if objectType == "" || externalID == "" {
			continue
		}
		key := objectType + "|" + externalID
		fingerprint := sha256JSON(record)
		if !shouldQueueObservation(force, state.Sent, pendingKeys, key, fingerprint) {
			continue
		}
		changed = append(changed, record)
		fingerprints[key] = fingerprint
	}
	if len(changed) > 0 {
		state.Sequence++
		state.Pending = append(state.Pending, pendingObservationBatch{
			Batch: adcsObservationBatch{
				AgentID: reg.AgentID, CaName: reg.CaName, CaConfig: reg.CaConfig,
				ObservedAt: time.Now().UTC().Format(time.RFC3339Nano), Sequence: state.Sequence, Records: changed,
			},
			Fingerprints: fingerprints,
		})
		if len(state.Pending) > 1000 {
			// 失败队列不能静默丢弃旧记录；这里只告警，待控制面恢复后按顺序补发。
			logAdcsAgentError(config, "AD CS Agent 观测失败队列超过 1000 批，仍保留全部待重试记录")
		}
	}
	summary.ChangedRecords = len(changed)
	summary.QueuedRecords = len(changed)
	secondFlush, err := flushObservationQueueWithStats(ctx, client, config, state)
	mergeObservationFlushSummary(&summary, secondFlush)
	if firstErr != nil && err == nil {
		err = firstErr
	}
	return err
}

// summarizeAdcsObservationRecords 按唯一 request 统计扫描数，并报告三种
// 外部观测投影的数量。
// Agent 会为同一条 CA 记录生成 request 以及 issuance/revocation 派生对象，
// 派生对象不能再次计入扫描数，否则 2 条证书会显示成扫描 4 条。
func summarizeAdcsObservationRecords(records []map[string]any) (int, map[string]int) {
	// 前端和控制面需要的是三种投影的数量，而不是 normalizedStatus
	// 的数量。两条 issued 记录应报告 request=2、issuance=2、revocation=0。
	counts := map[string]int{"request": 0, "issuance": 0, "revocation": 0}
	scanned := 0
	for _, record := range records {
		switch stringValue(record, "objectType") {
		case "request":
			scanned++
			counts["request"]++
		case "issuance", "revocation":
			counts[stringValue(record, "objectType")]++
		}
	}
	if scanned == 0 && len(records) > 0 {
		scanned = len(records)
	}
	return scanned, counts
}

// shouldQueueObservation 决定本轮记录是否进入投递队列。强制扫描用于纠正
// 解析器升级或后端残留投影，必须绕过本地 sent/待发送去重，但不删除失败队列。
func shouldQueueObservation(force bool, sent map[string]string, pending map[string]struct{}, key, fingerprint string) bool {
	if _, queued := pending[key]; queued {
		return false
	}
	if force {
		return true
	}
	if sent[key] == fingerprint {
		return false
	}
	return true
}

func mergeObservationFlushSummary(summary *observationRunSummary, flush observationFlushSummary) {
	if summary == nil {
		return
	}
	summary.SentBatches += flush.SentBatches
	summary.SentRecords += flush.SentRecords
	summary.AttemptedBatches += flush.AttemptedBatches
	summary.SubmittedRecords += flush.SubmittedRecords
	summary.FailedBatches += flush.FailedBatches
	summary.AcceptedRecords += flush.AcceptedRecords
	summary.InsertedRecords += flush.InsertedRecords
	summary.UpdatedRecords += flush.UpdatedRecords
	summary.DuplicateRecords += flush.DuplicateRecords
	summary.RejectedRecords += flush.RejectedRecords
}

func logObservationRun(config *AgentConfig, summary observationRunSummary) {
	data, err := json.Marshal(summary)
	if err != nil {
		logAdcsAgentError(config, fmt.Sprintf("AD CS Agent 观测链路摘要编码失败：%v", err))
		return
	}
	message := "AD CS Agent 观测链路摘要：" + string(data)
	fmt.Fprintln(os.Stderr, message)
	writeAdcsServiceLog(config, message)
}

func collectAdcsObservationRecords(ctx context.Context, config *AgentConfig, reg *registration) ([]map[string]any, []string, error) {
	caConfig := reg.CaConfig
	if caConfig == "" {
		caConfig = config.CaConfig
	}
	// caConfig 为空时让 certutil 使用本机默认 CA。注册表显示名读取失败
	// 不应阻断本机 CA 数据库扫描，后端会通过 Agent 关联解析 Authority。
	// AD CS 的历史签发记录在 Log 视图，待处理请求在 Queue 视图。旧实现省略
	// 视图参数，Windows 上会落到默认队列，因此历史记录永远是 0。
	rawByRequest := make(map[string]map[string]any)
	warnings := make([]string, 0)
	successfulViews := 0
	for _, view := range []string{"Log", "Queue"} {
		rawRecords, err := collectAdcsObservationView(ctx, caConfig, view)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("%s 视图读取失败：%v", view, err))
			continue
		}
		successfulViews++
		if len(rawRecords) == 0 {
			warnings = append(warnings, fmt.Sprintf("%s 视图命令成功，但没有解析出可用记录", view))
		}
		for _, raw := range rawRecords {
			key := stringValue(raw, "externalObjectId")
			if key == "" {
				continue
			}
			previous, exists := rawByRequest[key]
			if !exists || adcsObservationStatusRank(stringValue(raw, "normalizedStatus")) > adcsObservationStatusRank(stringValue(previous, "normalizedStatus")) {
				rawByRequest[key] = raw
			}
		}
	}
	if successfulViews == 0 {
		return nil, warnings, errors.New("AD CS 历史和队列视图均读取失败")
	}
	rawRecords := make([]map[string]any, 0, len(rawByRequest))
	for _, raw := range rawByRequest {
		rawRecords = append(rawRecords, raw)
	}
	sort.SliceStable(rawRecords, func(i, j int) bool {
		return stringValue(rawRecords[i], "externalObjectId") < stringValue(rawRecords[j], "externalObjectId")
	})
	all := make([]map[string]any, 0, len(rawRecords)*2)
	for _, raw := range rawRecords {
		requestRecord := cloneMap(raw)
		requestRecord["objectType"] = "request"
		all = append(all, requestRecord)
		status := stringValue(raw, "normalizedStatus")
		if status == "issued" {
			issuance := cloneMap(raw)
			issuance["objectType"] = "issuance"
			all = append(all, issuance)
		}
		if status == "revoked" {
			revocation := cloneMap(raw)
			revocation["objectType"] = "revocation"
			all = append(all, revocation)
		}
	}
	return all, warnings, nil
}

func collectAdcsObservationView(ctx context.Context, caConfig, view string) ([]map[string]any, error) {
	// certutil.exe 是 0.1.9 已在现场验证过的最短路径。不能把观测链路
	// 绑定到 PowerShell 或 COM：任一组件被策略禁用，都会把“本来可读的 CA”
	// 误报成扫描失败。因此先走 certutil，只有失败、空结果或乱码时才尝试
	// CertificateAuthority.View；若 COM 仍不可用，仍返回 certutil 的有效记录。
	certutilRecords, certutilErr := collectAdcsCertutilObservationView(ctx, caConfig, view)
	if certutilErr == nil && len(certutilRecords) > 0 && !containsAdcsMojibake(certutilRecords) {
		return certutilRecords, nil
	}
	if runtime.GOOS != "windows" {
		return certutilRecords, certutilErr
	}

	comRecords, comErr := collectAdcsComObservationView(ctx, caConfig, view)
	if comErr == nil && !containsAdcsMojibake(comRecords) {
		return comRecords, nil
	}
	if comErr == nil {
		comErr = errors.New("CertificateAuthority.View 返回了疑似乱码字段")
	}
	// certutil 命令成功但字段含本地化乱码时，记录仍然可通过稳定的数字
	// RequestID/Disposition 投影入库；不能因为显示字段乱码而把整轮扫描判失败。
	if certutilErr == nil {
		return certutilRecords, nil
	}
	return nil, fmt.Errorf("certutil 读取失败：%v；CertificateAuthority.View 回退失败：%v", certutilErr, comErr)
}

func collectAdcsComObservationView(ctx context.Context, caConfig, view string) ([]map[string]any, error) {
	all := make([]map[string]any, 0)
	cursor := ""
	for page := 0; page < 100; page++ {
		result, err := collectAdcsComObservationPage(ctx, caConfig, view, cursor, 500)
		if err != nil {
			return nil, err
		}
		all = append(all, result.Records...)
		if result.Complete {
			return all, nil
		}
		if result.NextCursor == "" || result.NextCursor == cursor {
			return nil, errors.New("CertificateAuthority.View 观测游标无效")
		}
		cursor = result.NextCursor
	}
	return nil, errors.New("CertificateAuthority.View 观测分页超过安全上限")
}

type adcsComObservationPage struct {
	Records    []map[string]any `json:"records"`
	Complete   bool             `json:"complete"`
	NextCursor string           `json:"nextCursor,omitempty"`
}

func collectAdcsComObservationPage(ctx context.Context, caConfig, view, cursor string, limit int) (adcsComObservationPage, error) {
	if strings.TrimSpace(caConfig) == "" {
		return adcsComObservationPage{}, errors.New("CA 配置标识为空，无法打开 CertificateAuthority.View")
	}
	if view != "Log" && view != "Queue" {
		return adcsComObservationPage{}, fmt.Errorf("不支持的 AD CS COM 视图：%s", view)
	}
	if limit < 1 || limit > 500 {
		return adcsComObservationPage{}, errors.New("AD CS COM 观测 limit 必须在 1 到 500 之间")
	}
	script := adcsComObservationScript
	commandCtx, cancel := context.WithTimeout(ctx, adcsCommandTimeout)
	defer cancel()
	output, err := runPowerShellScript(commandCtx, script, map[string]string{
		"GCAC_ADCS_CA_CONFIG": caConfig,
		"GCAC_ADCS_VIEW":      view,
		"GCAC_ADCS_CURSOR":    cursor,
		"GCAC_ADCS_LIMIT":     strconv.Itoa(limit),
	})
	if err != nil {
		return adcsComObservationPage{}, err
	}
	var page adcsComObservationPage
	if err := json.Unmarshal([]byte(strings.TrimSpace(output)), &page); err != nil {
		return adcsComObservationPage{}, fmt.Errorf("解析 CertificateAuthority.View JSON 失败：%w：%s", err, truncate(output, 2048))
	}
	if page.Records == nil {
		page.Records = []map[string]any{}
	}
	projected := make([]map[string]any, 0, len(page.Records))
	for _, record := range page.Records {
		projectedRecord, err := projectAdcsComRecord(record)
		if err != nil {
			return adcsComObservationPage{}, err
		}
		projected = append(projected, projectedRecord)
	}
	page.Records = projected
	return page, nil
}

func projectAdcsComRecord(record map[string]any) (map[string]any, error) {
	requestID, ok := parseAdcsRequestID(adcsRecordString(record, "requestId"))
	if !ok || requestID < 1 {
		return nil, errors.New("CertificateAuthority.View 返回了无效 RequestID")
	}
	disposition := adcsRecordString(record, "disposition")
	revokedWhen := normalizeAdcsDate(adcsRecordString(record, "revokedWhen"))
	return (adcsViewRow{
		requestID:        requestID,
		disposition:      disposition,
		normalizedStatus: normalizeAdcsDisposition(disposition, revokedWhen),
		commonName:       adcsRecordString(record, "commonName"),
		template:         adcsRecordString(record, "template"),
		serialNumber:     adcsRecordString(record, "serialNumber"),
		notBefore:        normalizeAdcsDate(adcsRecordString(record, "notBefore")),
		notAfter:         normalizeAdcsDate(adcsRecordString(record, "notAfter")),
		submittedWhen:    normalizeAdcsDate(adcsRecordString(record, "submittedWhen")),
		resolvedWhen:     normalizeAdcsDate(adcsRecordString(record, "resolvedWhen")),
		revokedWhen:      revokedWhen,
		requester:        adcsRecordString(record, "requester"),
	}).observation(), nil
}

func adcsRecordString(record map[string]any, key string) string {
	value, ok := record[key]
	if !ok || value == nil {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case float64:
		return strconv.FormatInt(int64(typed), 10)
	case json.Number:
		return strings.TrimSpace(typed.String())
	default:
		return strings.TrimSpace(fmt.Sprint(typed))
	}
}

// normalizeAdcsDate 清理 AD CS/COM 用来表示“没有时间”的默认日期。
// CertificateAuthority.View 在空列上可能返回 1601-01-01、1899-12-30
// 或 .NET 的 0001-01-01，不能把这些占位值当成真实吊销时间。
func normalizeAdcsDate(value string) string {
	trimmed := strings.Trim(strings.TrimSpace(value), "\"'")
	if trimmed == "" {
		return ""
	}
	lower := strings.ToLower(trimmed)
	if lower == "0" || lower == "null" || lower == "none" || lower == "n/a" || lower == "system.dbnull" {
		return ""
	}
	for _, marker := range []string{
		"0001-01-01", "0001/01/01", "1/1/1", "1/1/0001",
		"1600-12-31", "1600/12/31", "12/31/1600",
		"1601-01-01", "1601/01/01", "1/1/1601",
		"1899-12-30", "1899/12/30", "12/30/1899",
	} {
		if strings.HasPrefix(lower, marker) {
			return ""
		}
	}
	for _, part := range strings.FieldsFunc(trimmed, func(r rune) bool {
		return r < '0' || r > '9'
	}) {
		if len(part) != 4 {
			continue
		}
		year, err := strconv.Atoi(part)
		if err == nil && year > 0 && year <= 1901 {
			return ""
		}
	}
	return trimmed
}

func collectAdcsCertutilObservationView(ctx context.Context, caConfig, view string) ([]map[string]any, error) {
	all := make([]map[string]any, 0)
	cursor := ""
	for page := 0; page < 100; page++ {
		input := map[string]any{"objectType": "request", "limit": 500, "view": view}
		if cursor != "" {
			input["cursor"] = cursor
		}
		result, err := adcsList(ctx, input, caConfig)
		if err != nil {
			return nil, err
		}
		rawRecords, _ := result["records"].([]map[string]any)
		all = append(all, rawRecords...)
		complete, _ := result["complete"].(bool)
		if complete {
			return all, nil
		}
		next, _ := result["nextCursor"].(string)
		if next == "" || next == cursor {
			return nil, errors.New("AD CS 观测游标无效")
		}
		cursor = next
	}
	return nil, errors.New("AD CS 观测分页超过安全上限")
}

// adcsComObservationScript 通过 CertificateAuthority.View COM 读取结构化列。
// 使用环境变量传参，再以 UTF-16LE Base64 传给 PowerShell，避免 CA 名称中的
// 反斜杠、引号或空格破坏命令行解析。
const adcsComObservationScript = `
$ErrorActionPreference = 'Stop'
$caConfig = [Environment]::GetEnvironmentVariable('GCAC_ADCS_CA_CONFIG')
$viewName = [Environment]::GetEnvironmentVariable('GCAC_ADCS_VIEW')
$cursorText = [Environment]::GetEnvironmentVariable('GCAC_ADCS_CURSOR')
$limit = [int]([Environment]::GetEnvironmentVariable('GCAC_ADCS_LIMIT'))
if ([string]::IsNullOrWhiteSpace($caConfig)) { throw 'CA 配置标识为空' }
if ($viewName -notin @('Log', 'Queue')) { throw "不支持的视图：$viewName" }
if ($limit -lt 1 -or $limit -gt 500) { throw 'limit 超出范围' }

function Convert-Value {
    param([object]$Value)
    if ($null -eq $Value -or $Value -is [System.DBNull]) { return '' }
    if ($Value -is [DateTime]) { return ([DateTimeOffset]$Value).ToUniversalTime().ToString('o') }
    if ($Value -is [DateTimeOffset]) { return $Value.ToUniversalTime().ToString('o') }
    if ($Value -is [byte[]]) { return '' }
    return ([string]$Value).Trim()
}

$view = New-Object -ComObject CertificateAuthority.View
$view.OpenConnection($caConfig)
$columnCandidates = [ordered]@{
    requestId = @('Request.RequestID', 'RequestID')
    disposition = @('Request.Disposition', 'Disposition')
    requester = @('Request.RequesterName', 'RequesterName')
    submittedWhen = @('Request.SubmittedWhen', 'SubmittedWhen')
    resolvedWhen = @('Request.ResolvedWhen', 'ResolvedWhen')
    revokedWhen = @('Request.RevokedWhen', 'RevokedWhen')
    commonName = @('Request.CommonName', 'CommonName')
    template = @('CertificateTemplate', 'Request.CertificateTemplate')
    serialNumber = @('SerialNumber', 'CertificateSerialNumber')
    notBefore = @('NotBefore', 'CertificateEffectiveDate')
    notAfter = @('NotAfter', 'CertificateExpirationDate')
}
$selected = New-Object System.Collections.Generic.List[object]
foreach ($entry in $columnCandidates.GetEnumerator()) {
    $resolved = $null
    foreach ($candidate in $entry.Value) {
        try {
            $index = [int]$view.GetColumnIndex($false, $candidate)
            if ($index -ge 0) {
                $resolved = [ordered]@{ key = $entry.Key; name = $candidate; index = $index }
                break
            }
        } catch {}
    }
    if ($null -ne $resolved) { $selected.Add($resolved) }
}
$requestColumn = $selected | Where-Object { $_.key -eq 'requestId' } | Select-Object -First 1
if ($null -eq $requestColumn) { throw 'CertificateAuthority.View 找不到 RequestID 列' }
$view.SetResultColumnCount($selected.Count)
foreach ($column in $selected) { $view.SetResultColumn([int]$column.index) }
$view.SetRestriction($(if ($viewName -eq 'Queue') { -1 } else { -2 }), 0, 0, 0)
if (-not [string]::IsNullOrWhiteSpace($cursorText)) {
    $after = [int]$cursorText
    $view.SetRestriction([int]$requestColumn.index, 0x10, 0x1, $after)
}

$rows = $view.OpenView()
$items = New-Object System.Collections.Generic.List[object]
$rowIndex = $rows.Next()
while ($rowIndex -ne -1 -and $items.Count -lt ($limit + 1)) {
    $values = New-Object System.Collections.Generic.List[object]
    $rowColumns = $rows.EnumCertViewColumn()
    $columnIndex = $rowColumns.Next()
    while ($columnIndex -ne -1) {
        $values.Add((Convert-Value $rowColumns.GetValue(0)))
        $columnIndex = $rowColumns.Next()
    }
    $record = [ordered]@{}
    for ($i = 0; $i -lt $selected.Count; $i++) {
        $key = [string]$selected[$i].key
        $record[$key] = if ($i -lt $values.Count) { [string]$values[$i] } else { '' }
    }
    $items.Add($record)
    $rowIndex = $rows.Next()
}
$hasMore = $items.Count -gt $limit
$outputItems = @($items.ToArray())
if ($hasMore) { $outputItems = @($items | Select-Object -First $limit) }
$nextCursor = ''
if ($hasMore -and $outputItems.Count -gt 0) { $nextCursor = [string]$outputItems[$outputItems.Count - 1].requestId }
$json = [ordered]@{
    records = @($outputItems)
    complete = (-not $hasMore)
    nextCursor = $nextCursor
} | ConvertTo-Json -Compress -Depth 8
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
`

func runPowerShellScript(ctx context.Context, script string, environment map[string]string) (string, error) {
	encoded := encodePowerShellCommand(script)
	command := exec.CommandContext(ctx, "powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded)
	command.Env = os.Environ()
	for key, value := range environment {
		command.Env = append(command.Env, key+"="+value)
	}
	output, err := command.CombinedOutput()
	// PowerShell 5.1 的错误流通常按系统 ACP/OEMCP 输出；不能直接
	// string(output)，否则中文错误会在 Agent 日志中变成“瑙嗗浘”等乱码。
	// 成功路径仍然是 ASCII Base64，不会受到该解码的影响。
	decodedOutput := decodeWindowsCommandOutput(output)
	if err != nil {
		return "", fmt.Errorf("powershell.exe 执行 AD CS 查询失败：%w：%s", err, truncate(decodedOutput, 2048))
	}
	encodedOutput := strings.TrimSpace(decodedOutput)
	decoded, decodeErr := base64.StdEncoding.DecodeString(encodedOutput)
	if decodeErr != nil {
		return "", fmt.Errorf("解析 PowerShell UTF-8 Base64 输出失败：%w：%s", decodeErr, truncate(encodedOutput, 2048))
	}
	return string(decoded), nil
}

func encodePowerShellCommand(script string) string {
	units := utf16.Encode([]rune(script))
	data := make([]byte, len(units)*2)
	for index, unit := range units {
		binary.LittleEndian.PutUint16(data[index*2:index*2+2], unit)
	}
	return base64.StdEncoding.EncodeToString(data)
}

func adcsObservationStatusRank(status string) int {
	switch status {
	case "issued", "revoked", "rejected", "failed":
		return 3
	case "pending":
		return 2
	default:
		return 1
	}
}

func flushObservationQueue(ctx context.Context, client *http.Client, config *AgentConfig, state *persistedObservationState) error {
	_, err := flushObservationQueueWithStats(ctx, client, config, state)
	return err
}

func flushObservationQueueWithStats(ctx context.Context, client *http.Client, config *AgentConfig, state *persistedObservationState) (observationFlushSummary, error) {
	now := time.Now()
	remaining := make([]pendingObservationBatch, 0, len(state.Pending))
	var firstErr error
	summary := observationFlushSummary{}
	for _, pending := range state.Pending {
		if pending.NextAttemptAt != "" {
			next, err := time.Parse(time.RFC3339Nano, pending.NextAttemptAt)
			if err == nil && next.After(now) {
				remaining = append(remaining, pending)
				continue
			}
		}
		summary.AttemptedBatches++
		summary.SubmittedRecords += len(pending.Batch.Records)
		result, err := pushObservationBatchWithResult(ctx, client, config, pending.Batch)
		if err != nil {
			summary.FailedBatches++
			pending.AttemptCount++
			pending.LastError = truncate(err.Error(), 1024)
			backoff := time.Duration(5*int64(time.Second)) * time.Duration(1<<minInt(pending.AttemptCount-1, 8))
			if backoff > 5*time.Minute {
				backoff = 5 * time.Minute
			}
			pending.NextAttemptAt = time.Now().Add(backoff).UTC().Format(time.RFC3339Nano)
			remaining = append(remaining, pending)
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		summary.SentBatches++
		summary.SentRecords += len(pending.Batch.Records)
		summary.AcceptedRecords += result.Accepted
		summary.InsertedRecords += result.Inserted
		summary.UpdatedRecords += result.Updated
		summary.DuplicateRecords += result.Duplicates
		summary.RejectedRecords += result.Rejected
		if result.Rejected > 0 {
			markAcceptedObservationRecords(state, pending, result)
			retry := retainRejectedObservationRecords(pending, result)
			if len(retry.Batch.Records) == 0 {
				// 后端只返回 rejected 数量而没有索引时，不能误删本地队列。
				retry = pending
			}
			retry.AttemptCount++
			retry.LastError = fmt.Sprintf("控制面拒绝 %d 条 AD CS 观测记录", result.Rejected)
			backoff := time.Duration(5*int64(time.Second)) * time.Duration(1<<minInt(retry.AttemptCount-1, 8))
			if backoff > 5*time.Minute {
				backoff = 5 * time.Minute
			}
			retry.NextAttemptAt = time.Now().Add(backoff).UTC().Format(time.RFC3339Nano)
			remaining = append(remaining, retry)
			if firstErr == nil {
				firstErr = errors.New(retry.LastError)
			}
			continue
		}
		for key, fingerprint := range pending.Fingerprints {
			state.Sent[key] = fingerprint
		}
	}
	state.Pending = remaining
	return summary, firstErr
}

func pushObservationBatch(ctx context.Context, client *http.Client, config *AgentConfig, batch adcsObservationBatch) error {
	_, err := pushObservationBatchWithResult(ctx, client, config, batch)
	return err
}

func pushObservationBatchWithResult(ctx context.Context, client *http.Client, config *AgentConfig, batch adcsObservationBatch) (adcsObservationIngestResult, error) {
	var result adcsObservationIngestResult
	if err := doJSON(ctx, client, config, http.MethodPost, "/api/v1/agents/ca-observations", batch, &result); err != nil {
		return result, err
	}
	if len(batch.Records) > 0 && result.Accepted+result.Rejected != len(batch.Records) {
		return result, fmt.Errorf(
			"控制面返回的 AD CS 观测统计不完整：submitted=%d accepted=%d rejected=%d",
			len(batch.Records), result.Accepted, result.Rejected,
		)
	}
	return result, nil
}

func retainRejectedObservationRecords(pending pendingObservationBatch, result adcsObservationIngestResult) pendingObservationBatch {
	if len(result.Rejections) == 0 {
		return pendingObservationBatch{}
	}
	rejectedIndexes := make(map[int]struct{}, len(result.Rejections))
	for _, rejection := range result.Rejections {
		rejectedIndexes[rejection.Index] = struct{}{}
	}
	retry := pendingObservationBatch{
		Batch:        pending.Batch,
		Fingerprints: make(map[string]string),
		AttemptCount: pending.AttemptCount,
		LastError:    pending.LastError,
	}
	retry.Batch.Records = make([]map[string]any, 0, len(result.Rejections))
	for index, record := range pending.Batch.Records {
		if _, rejected := rejectedIndexes[index]; !rejected {
			continue
		}
		retry.Batch.Records = append(retry.Batch.Records, record)
		if key := observationRecordKey(record); key != "" {
			if fingerprint, ok := pending.Fingerprints[key]; ok {
				retry.Fingerprints[key] = fingerprint
			}
		}
	}
	return retry
}

func markAcceptedObservationRecords(state *persistedObservationState, pending pendingObservationBatch, result adcsObservationIngestResult) {
	if state == nil || len(result.Rejections) == 0 {
		return
	}
	rejectedIndexes := make(map[int]struct{}, len(result.Rejections))
	for _, rejection := range result.Rejections {
		rejectedIndexes[rejection.Index] = struct{}{}
	}
	for index, record := range pending.Batch.Records {
		if _, rejected := rejectedIndexes[index]; rejected {
			continue
		}
		if key := observationRecordKey(record); key != "" {
			if fingerprint, ok := pending.Fingerprints[key]; ok {
				state.Sent[key] = fingerprint
			}
		}
	}
}

func observationRecordKey(record map[string]any) string {
	if record == nil {
		return ""
	}
	objectType := stringValue(record, "objectType")
	externalID := stringValue(record, "externalObjectId")
	if objectType == "" || externalID == "" {
		return ""
	}
	return objectType + "|" + externalID
}

func cloneMap(input map[string]any) map[string]any {
	output := make(map[string]any, len(input)+1)
	for key, value := range input {
		output[key] = value
	}
	return output
}

func minInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func pullAndProcessTasks(ctx context.Context, client *http.Client, config *AgentConfig, reg *registration, state *counters) error {
	var tasks []agentTaskEnvelope
	if err := doJSON(ctx, client, config, http.MethodGet, "/api/v1/agents/tasks/pull?agentId="+urlQuery(reg.AgentID), nil, &tasks); err != nil {
		return err
	}
	for _, task := range tasks {
		logAdcsTaskEvent(config, "pulled", task.ID, nil)
		if err := processTask(ctx, client, config, reg, state, task); err != nil {
			// 服务模式下 stderr 不会进入 agent.log；任务失败必须复用统一
			// 错误记录路径，否则 Receipt 持久化或结果回传失败只能靠远端猜测。
			logAdcsAgentError(config, fmt.Sprintf("AD CS Agent 任务 %s 失败：%v", task.ID, err))
		}
	}
	return nil
}

func processTask(ctx context.Context, client *http.Client, config *AgentConfig, reg *registration, state *counters, task agentTaskEnvelope) (err error) {
	leaseID := fmt.Sprintf("adcs-%s-%d", task.ID, time.Now().UnixNano())
	acked := false
	resultSubmitted := false
	defer func() {
		if recovered := recover(); recovered != nil {
			panicMessage := fmt.Sprintf("AD CS Agent 任务执行异常：%v", recovered)
			logAdcsTaskEvent(config, "panic", task.ID, map[string]any{"error": panicMessage})
			logAdcsAgentError(config, fmt.Sprintf("%s\n%s", panicMessage, truncate(string(debug.Stack()), 4096)))
			if !acked || resultSubmitted {
				err = errors.New(panicMessage)
				return
			}

			detail := map[string]any{"executionStatus": "UNKNOWN", "operationResults": []any{}}
			if plan, ok := adcsPlanFromPayload(task.Payload); ok {
				operations := adcsOperationsFromPlan(plan)
				receipt := buildAgentReceiptWithStatus(task.Payload, plan, operations, nil, reg.AgentID, time.Now().UTC().Format(time.RFC3339Nano), "UNKNOWN", "ADCS_AGENT_PANIC", panicMessage)
				if persistErr := persistAdcsReceipt(config, task.ID, receipt); persistErr != nil {
					logAdcsTaskEvent(config, "panic_receipt_persist_failed", task.ID, map[string]any{"error": persistErr.Error()})
					err = fmt.Errorf("%s；UNKNOWN Receipt 持久化失败：%w", panicMessage, persistErr)
					return
				}
				detail["planId"] = planIdentifier(plan)
				detail["receipt"] = receipt
				detail["receiptPersisted"] = true
			}
			recoveryResult := submitResultRequest{
				AgentID: reg.AgentID, TaskID: task.ID, LeaseID: leaseID,
				Success: false, Status: "UNKNOWN", ErrorCode: "ADCS_AGENT_PANIC",
				ErrorMessage: "AD CS 写操作结果不明，禁止自动重试或重复提交", Detail: detail,
			}
			recoveryCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			submitErr := doJSON(recoveryCtx, client, config, http.MethodPost, "/api/v1/agents/tasks/result", recoveryResult, nil)
			cancel()
			if submitErr != nil {
				logAdcsTaskEvent(config, "panic_result_submit_failed", task.ID, map[string]any{"error": submitErr.Error()})
				err = fmt.Errorf("%s；UNKNOWN 结果回传失败：%w", panicMessage, submitErr)
				return
			}
			resultSubmitted = true
			logAdcsTaskEvent(config, "panic_result_submitted", task.ID, map[string]any{"status": "UNKNOWN"})
			err = errors.New(panicMessage)
		}
	}()
	logAdcsTaskEvent(config, "ack_start", task.ID, nil)
	var ack agentTaskEnvelope
	if err := doJSON(ctx, client, config, http.MethodPost, "/api/v1/agents/tasks/ack", ackTaskRequest{AgentID: reg.AgentID, TaskID: task.ID, LeaseID: leaseID}, &ack); err != nil {
		logAdcsTaskEvent(config, "ack_failed", task.ID, map[string]any{"error": err.Error()})
		return err
	}
	if ack.LeaseID != "" {
		leaseID = ack.LeaseID
	}
	acked = true
	logAdcsTaskEvent(config, "acked", task.ID, nil)
	state.mu.Lock()
	state.running++
	state.mu.Unlock()
	defer func() { state.mu.Lock(); state.running--; state.mu.Unlock() }()
	success, code, message, detail := false, "", "", map[string]any{}
	if receipt, err := loadAdcsReceipt(config, task.ID); err == nil && receiptMatchesTask(receipt, task.Payload) {
		// 结果提交失败后的重试只重传已落盘 Receipt，绝不重放 certreq/certutil。
		success, code, message, detail = resultFromAdcsReceipt(receipt)
		detail["receiptReplayed"] = true
		logAdcsTaskEvent(config, "receipt_replay", task.ID, map[string]any{"status": strings.ToUpper(stringValue(receipt, "status"))})
	} else {
		logAdcsTaskEvent(config, "execute_start", task.ID, nil)
		success, code, message, detail = executePlanWithTimeout(ctx, task.Payload, reg.AgentID)
		if detail == nil {
			detail = map[string]any{}
		}
		logAdcsTaskEvent(config, "execute_finished", task.ID, map[string]any{"success": success, "errorCode": code, "hasReceipt": detail["receipt"] != nil})
		if receipt, ok := detail["receipt"].(map[string]any); ok {
			// Receipt 必须在提交控制面之前落盘。控制面短暂不可达时，Agent
			// 仍保留同一任务的失败/未知事实，后续恢复不得重新执行写操作。
			if err := persistAdcsReceipt(config, task.ID, receipt); err != nil {
				return fmt.Errorf("AD CS Receipt 无法持久化，停止提交结果：%w", err)
			}
			detail["receiptPersisted"] = true
		}
	}
	result := submitResultRequest{AgentID: reg.AgentID, TaskID: task.ID, LeaseID: leaseID, Success: success, Status: agentResultStatus(success, code, detail), ErrorCode: code, ErrorMessage: message, Detail: detail}
	logAdcsTaskEvent(config, "result_submit_start", task.ID, map[string]any{"success": success, "errorCode": code})
	if err := doJSON(ctx, client, config, http.MethodPost, "/api/v1/agents/tasks/result", result, nil); err != nil {
		logAdcsTaskEvent(config, "result_submit_failed", task.ID, map[string]any{"error": err.Error()})
		return err
	}
	resultSubmitted = true
	logAdcsTaskEvent(config, "result_submitted", task.ID, map[string]any{"success": success})
	return nil
}

func agentResultStatus(success bool, errorCode string, detail map[string]any) string {
	if receipt, ok := detail["receipt"].(map[string]any); ok {
		status := strings.ToUpper(strings.TrimSpace(stringValue(receipt, "status")))
		if status == "SUCCESS" || status == "FAILED" || status == "UNKNOWN" || status == "CANCELLED" {
			return status
		}
	}
	if success {
		return "SUCCESS"
	}
	if errorCode == "ADCS_OPERATION_UNKNOWN" || errorCode == "ADCS_AGENT_PANIC" {
		return "UNKNOWN"
	}
	return "FAILED"
}

type executePlanResult struct {
	success bool
	code    string
	message string
	detail  map[string]any
}

// executePlanWithTimeout 覆盖操作函数之外的解析、证书读取和回执组装路径。
// 任意内部等待超过上限都只能回传 UNKNOWN，不能让任务永久停留在 acked。
func executePlanWithTimeout(ctx context.Context, payload map[string]any, agentID string) (bool, string, string, map[string]any) {
	executeCtx, cancel := context.WithTimeout(ctx, adcsTaskExecutionTimeout)
	defer cancel()
	resultCh := make(chan executePlanResult, 1)
	go func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				resultCh <- unknownExecutionResult(payload, agentID, "ADCS_AGENT_PANIC", fmt.Sprintf("AD CS Agent 执行异常：%v", recovered))
			}
		}()
		success, code, message, detail := executePlan(executeCtx, payload, agentID)
		resultCh <- executePlanResult{success: success, code: code, message: message, detail: detail}
	}()
	select {
	case result := <-resultCh:
		return result.success, result.code, result.message, result.detail
	case <-executeCtx.Done():
		result := unknownExecutionResult(payload, agentID, "ADCS_OPERATION_UNKNOWN", "AD CS Agent 任务执行超过硬超时，结果可能已在 CA 生效")
		return result.success, result.code, result.message, result.detail
	}
}

func unknownExecutionResult(payload map[string]any, agentID, code, reason string) executePlanResult {
	plan, ok := adcsPlanFromPayload(payload)
	detail := map[string]any{}
	if ok {
		operations := adcsOperationsFromPlan(plan)
		receipt := buildAgentReceiptWithStatus(payload, plan, operations, nil, agentID, time.Now().UTC().Format(time.RFC3339Nano), "UNKNOWN", code, reason)
		detail["planId"] = planIdentifier(plan)
		detail["operations"] = []any{}
		detail["operationResults"] = []any{}
		detail["executionStatus"] = "UNKNOWN"
		detail["receipt"] = receipt
	}
	return executePlanResult{success: false, code: code, message: "AD CS 写操作结果不明，禁止自动重试或重复提交", detail: detail}
}

// logAdcsTaskEvent 只记录任务阶段和布尔结果，不记录计划、凭据、证书或 Receipt 正文。
// 这样现场只需返回目标任务的事件行，就能判断卡在拉取、执行还是结果回传。
func logAdcsTaskEvent(config *AgentConfig, event, taskID string, fields map[string]any) {
	if strings.TrimSpace(taskID) == "" {
		return
	}
	entry := map[string]any{
		"event":      event,
		"taskId":     taskID,
		"occurredAt": time.Now().UTC().Format(time.RFC3339Nano),
	}
	for key, value := range fields {
		if key == "error" {
			entry[key] = truncate(fmt.Sprint(value), 512)
			continue
		}
		entry[key] = value
	}
	data, err := json.Marshal(entry)
	if err != nil {
		return
	}
	writeAdcsServiceLog(config, "AD CS Agent 任务事件："+string(data))
}

func persistAdcsReceipt(config *AgentConfig, taskID string, receipt map[string]any) error {
	if config == nil {
		return errors.New("AD CS Agent 配置为空，无法持久化 Receipt")
	}
	dataDir := strings.TrimSpace(config.Paths.Windows.DataDir)
	if dataDir == "" {
		dataDir = defaultDataDir
	}
	receiptDir := filepath.Join(dataDir, "receipts")
	if err := os.MkdirAll(receiptDir, 0o700); err != nil {
		return fmt.Errorf("创建 AD CS Receipt 目录失败：%w", err)
	}
	name := sanitizeReceiptFileName(taskID)
	if name == "" {
		return errors.New("AD CS Receipt taskId 为空")
	}
	content, err := json.MarshalIndent(receipt, "", "  ")
	if err != nil {
		return fmt.Errorf("编码 AD CS Receipt 失败：%w", err)
	}
	temporary, err := os.CreateTemp(receiptDir, ".receipt-*.tmp")
	if err != nil {
		return fmt.Errorf("创建 AD CS Receipt 临时文件失败：%w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("设置 AD CS Receipt 文件权限失败：%w", err)
	}
	if _, err := temporary.Write(content); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("写入 AD CS Receipt 失败：%w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("同步 AD CS Receipt 失败：%w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("关闭 AD CS Receipt 临时文件失败：%w", err)
	}
	if err := os.Rename(temporaryPath, filepath.Join(receiptDir, name+".json")); err != nil {
		return fmt.Errorf("原子发布 AD CS Receipt 失败：%w", err)
	}
	return nil
}

func loadAdcsReceipt(config *AgentConfig, taskID string) (map[string]any, error) {
	if config == nil {
		return nil, errors.New("AD CS Agent 配置为空，无法读取 Receipt")
	}
	dataDir := strings.TrimSpace(config.Paths.Windows.DataDir)
	if dataDir == "" {
		dataDir = defaultDataDir
	}
	name := sanitizeReceiptFileName(taskID)
	if name == "" {
		return nil, errors.New("AD CS Receipt taskId 为空")
	}
	data, err := os.ReadFile(filepath.Join(dataDir, "receipts", name+".json"))
	if err != nil {
		return nil, err
	}
	var receipt map[string]any
	if err := json.Unmarshal(data, &receipt); err != nil {
		return nil, fmt.Errorf("解析 AD CS Receipt 失败：%w", err)
	}
	if receipt == nil || stringValue(receipt, "receiptVersion") != "gcac.agent-security/v1" {
		return nil, errors.New("AD CS Receipt 合同版本无效")
	}
	return receipt, nil
}

func receiptMatchesTask(receipt, payload map[string]any) bool {
	plan, ok := adcsPlanFromPayload(payload)
	if !ok {
		return false
	}
	expected := strings.TrimPrefix(strings.ToLower(stringValue(plan, "planDigest")), "sha256:")
	actual := strings.TrimPrefix(strings.ToLower(stringValue(receipt, "planDigest")), "sha256:")
	return expected != "" && expected == actual
}

func resultFromAdcsReceipt(receipt map[string]any) (bool, string, string, map[string]any) {
	status := strings.ToUpper(stringValue(receipt, "status"))
	detail := map[string]any{
		"planId":           stringValue(receipt, "planId"),
		"executionStatus":  status,
		"operationResults": receipt["operationResults"],
		"receipt":          receipt,
	}
	if status == "SUCCESS" {
		return true, "", "", detail
	}
	if status == "UNKNOWN" {
		return false, firstNonEmptyString(stringValue(receipt, "errorCode"), "ADCS_OPERATION_UNKNOWN"), firstNonEmptyString(stringValue(receipt, "unknownReason"), "AD CS 写操作结果不明，禁止自动重试或重复提交"), detail
	}
	return false, firstNonEmptyString(stringValue(receipt, "errorCode"), "ADCS_OPERATION_FAILED"), firstNonEmptyString(stringValue(receipt, "errorMessage"), "AD CS 操作失败"), detail
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func sanitizeReceiptFileName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	var builder strings.Builder
	for _, character := range value {
		if (character >= 'a' && character <= 'z') || (character >= 'A' && character <= 'Z') || (character >= '0' && character <= '9') || character == '-' || character == '_' || character == '.' {
			builder.WriteRune(character)
			continue
		}
		builder.WriteByte('_')
	}
	return strings.Trim(builder.String(), "._")
}

type adcsOperationError struct {
	err     error
	unknown bool
}

func (e *adcsOperationError) Error() string {
	if e == nil || e.err == nil {
		return "AD CS 操作失败"
	}
	return e.err.Error()
}

func (e *adcsOperationError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func adcsUnknownOperationError(err error) error {
	if err == nil {
		return nil
	}
	return &adcsOperationError{err: err, unknown: true}
}

func adcsOperationResultUnknown(err error) bool {
	var operationErr *adcsOperationError
	return errors.As(err, &operationErr) && operationErr.unknown
}

func isAdcsWriteOperation(operationType string) bool {
	switch operationType {
	case "issue", "ca.certificate.issue", "ca.certificate.issue.v1",
		"renew", "ca.certificate.renew", "ca.certificate.renew.v1",
		"revoke", "ca.certificate.revoke", "ca.certificate.revoke.v1",
		"crl.publish", "ca.crl.publish":
		return true
	default:
		return false
	}
}

func executePlan(ctx context.Context, payload map[string]any, agentID string) (bool, string, string, map[string]any) {
	plan, ok := adcsPlanFromPayload(payload)
	if !ok {
		return false, "ADCS_PLAN_REQUIRED", "AD CS Agent 任务缺少 plan", nil
	}
	if err := validateAdcsPlan(payload, plan, agentID); err != nil {
		return false, "ADCS_PLAN_INVALID", err.Error(), nil
	}
	if requestedAgentID := stringValue(payload, "agentId"); requestedAgentID != "" && requestedAgentID != agentID {
		return false, "ADCS_AGENT_ID_MISMATCH", "AD CS Agent 任务目标与当前注册身份不匹配", nil
	}
	operations := adcsOperationsFromPlan(plan)
	if len(operations) == 0 {
		return false, "ADCS_OPERATION_REQUIRED", "AD CS Agent 任务缺少 operations", nil
	}
	startedAt := time.Now().UTC().Format(time.RFC3339Nano)
	results := make([]any, 0, len(operations))
	for _, op := range operations {
		operationType, _ := op["operationType"].(string)
		input, _ := op["input"].(map[string]any)
		if operationType == "" {
			return false, "ADCS_OPERATION_INVALID", "AD CS operationType 为空", nil
		}
		if operationType == "agent.execution.receipt" {
			continue
		}
		result, err := executeAdcsOperation(ctx, operationType, input)
		if err != nil {
			unknown := isAdcsWriteOperation(operationType) && adcsOperationResultUnknown(err)
			status := "FAILED"
			errorCode := "ADCS_OPERATION_FAILED"
			message := err.Error()
			unknownReason := ""
			if unknown {
				status = "UNKNOWN"
				errorCode = "ADCS_OPERATION_UNKNOWN"
				message = "AD CS 写操作结果不明，禁止自动重试或重复提交"
				unknownReason = "AD CS 写操作已启动但未取得确定结果"
			}
			result = map[string]any{"operationType": operationType, "status": status, "error": err.Error()}
			if operationID, ok := op["operationId"].(string); ok {
				result["operationId"] = operationID
			}
			results = append(results, result)
			receipt := buildAgentReceiptWithStatus(payload, plan, operations, results, agentID, startedAt, status, errorCode, unknownReason)
			detail := map[string]any{
				"planId": planIdentifier(plan), "operations": results, "operationResults": results,
				"executionStatus": status, "receipt": receipt,
			}
			return false, errorCode, message, detail
		}
		result["operationId"] = op["operationId"]
		results = append(results, result)
	}
	last := map[string]any{}
	if len(results) > 0 {
		last, _ = results[len(results)-1].(map[string]any)
	}
	last["operationResults"] = results
	last["receipt"] = buildAgentReceiptWithStatus(payload, plan, operations, results, agentID, startedAt, "SUCCESS", "", "")
	return true, "", "", last
}

// validateAdcsPlan 是 AD CS Agent 与控制面的最小执行边界。AD CS Agent
// 只接受固定 ca.microsoft-adcs 计划和 CA 原子动作，不执行 Full Agent 的
// 文件、服务或任意命令操作。计划摘要覆盖去掉 planDigest 后的完整 JSON，
// 与插件 Runtime 的 canonicalJson 规则一致。
func validateAdcsPlan(payload, plan map[string]any, agentID string) error {
	if strings.TrimSpace(agentID) == "" {
		return errors.New("AD CS Agent 当前身份为空")
	}
	if value := stringValue(plan, "apiVersion"); value != "" && value != "gcac.agent-plan/v1" {
		return fmt.Errorf("AD CS Agent 计划 apiVersion 不受支持：%s", value)
	}
	if kind := stringValue(plan, "kind"); kind != "" && kind != "AgentPlanV1" {
		return fmt.Errorf("AD CS Agent 计划 kind 不受支持：%s", kind)
	}
	if stringValue(plan, "pluginId") != "ca.microsoft-adcs" {
		return errors.New("AD CS Agent 计划 pluginId 必须为 ca.microsoft-adcs")
	}
	if strings.TrimSpace(stringValue(plan, "pluginVersionId")) == "" {
		return errors.New("AD CS Agent 计划缺少固定 pluginVersionId")
	}
	if strings.TrimSpace(stringValue(plan, "tenantId")) == "" {
		return errors.New("AD CS Agent 计划缺少 tenantId")
	}
	if requestedTenant := stringValue(payload, "tenantId"); requestedTenant != "" && requestedTenant != stringValue(plan, "tenantId") {
		return errors.New("AD CS Agent 计划租户与任务租户不一致")
	}
	if requestedAgent := stringValue(plan, "agentId"); requestedAgent != "" && requestedAgent != agentID {
		return errors.New("AD CS Agent 计划 agentId 与当前注册身份不一致")
	}
	digest := strings.TrimPrefix(strings.ToLower(stringValue(plan, "planDigest")), "sha256:")
	if len(digest) != sha256.Size*2 || !isHex(digest) {
		return errors.New("AD CS Agent 计划缺少有效 planDigest")
	}
	unsigned := cloneMap(plan)
	delete(unsigned, "planDigest")
	if sha256JSON(unsigned) != digest {
		return errors.New("AD CS Agent 计划摘要与内容不一致")
	}
	operations := adcsOperationsFromPlan(plan)
	if len(operations) == 0 || len(operations) > 16 {
		return errors.New("AD CS Agent 计划 operations 数量无效")
	}
	for _, operation := range operations {
		operationType := strings.TrimSpace(stringValue(operation, "operationType"))
		if operationType == "" {
			return errors.New("AD CS Agent 计划缺少 operationType")
		}
		if !isAllowedAdcsOperation(operationType) {
			return fmt.Errorf("AD CS Agent 不允许执行操作：%s", operationType)
		}
		if input, ok := operation["input"].(map[string]any); !ok || input == nil {
			return fmt.Errorf("AD CS Agent 操作 %s 缺少 input", operationType)
		}
	}
	return nil
}

func isAllowedAdcsOperation(operation string) bool {
	switch operation {
	case "issue", "ca.certificate.issue", "ca.certificate.issue.v1",
		"renew", "ca.certificate.renew", "ca.certificate.renew.v1",
		"query", "ca.certificate.query", "ca.certificate.query.v1",
		"revoke", "ca.certificate.revoke", "ca.certificate.revoke.v1",
		"revocation_evidence", "ca.revocation.evidence", "ca.revocation.evidence.v1",
		"status", "ca.status", "ca.microsoft-adcs.status",
		"crl.status", "crl.publish", "ca.crl.status", "ca.crl.publish":
		return true
	default:
		return false
	}
}

func isHex(value string) bool {
	if value == "" {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

// adcsPlanFromPayload 兼容统一 Agent v2 载荷和旧版 AD CS Plugin 生成的 agentPlan。
// 两种载荷最终都必须落到同一组 AD CS operation，避免在 Agent 内维护两套执行器。
func adcsPlanFromPayload(payload map[string]any) (map[string]any, bool) {
	if plan, ok := payload["plan"].(map[string]any); ok {
		return plan, true
	}
	if plan, ok := payload["agentPlan"].(map[string]any); ok {
		return plan, true
	}
	return nil, false
}

func adcsOperationsFromPlan(plan map[string]any) []map[string]any {
	if raw, ok := plan["operations"].([]any); ok {
		operations := make([]map[string]any, 0, len(raw))
		for _, value := range raw {
			if operation, ok := value.(map[string]any); ok {
				operations = append(operations, operation)
			}
		}
		return operations
	}
	if raw, ok := plan["actions"].([]any); ok {
		operations := make([]map[string]any, 0, len(raw))
		for _, value := range raw {
			action, ok := value.(map[string]any)
			if !ok {
				continue
			}
			operationType, _ := action["operation"].(string)
			if strings.TrimSpace(operationType) == "" {
				continue
			}
			input := make(map[string]any, len(action))
			for key, item := range action {
				if key != "kind" && key != "operation" {
					input[key] = item
				}
			}
			operation := map[string]any{"operationType": operationType, "input": input}
			if operationID, ok := action["operationId"].(string); ok && strings.TrimSpace(operationID) != "" {
				operation["operationId"] = operationID
			}
			operations = append(operations, operation)
		}
		return operations
	}
	if operationType, ok := plan["operation"].(string); ok && strings.TrimSpace(operationType) != "" {
		input := make(map[string]any, len(plan))
		for key, item := range plan {
			if key != "operation" {
				input[key] = item
			}
		}
		return []map[string]any{{"operationType": operationType, "input": input}}
	}
	return nil
}

func buildAgentReceipt(payload, plan map[string]any, operations []map[string]any, results []any, agentID, startedAt string) map[string]any {
	return buildAgentReceiptWithStatus(payload, plan, operations, results, agentID, startedAt, "SUCCESS", "", "")
}

func buildAgentReceiptWithStatus(payload, plan map[string]any, operations []map[string]any, results []any, agentID, startedAt, status, errorCode, unknownReason string) map[string]any {
	operationID := "adcs-operation-" + sha256Text(fmt.Sprintf("%v", results))[:16]
	if len(operations) > 0 {
		if value, ok := operations[0]["operationId"].(string); ok && strings.TrimSpace(value) != "" {
			operationID = value
		}
	}
	planID := stringValue(plan, "planId")
	if planID == "" {
		planID = stringValue(plan, "executionId")
	}
	tenantID := stringValue(payload, "tenantId")
	if tenantID == "" {
		tenantID = stringValue(plan, "tenantId")
	}
	tokenID := stringValue(plan, "tokenId")
	if token, ok := payload["token"].(map[string]any); ok && stringValue(token, "tokenId") != "" {
		tokenID = stringValue(token, "tokenId")
	}
	planDigest := strings.TrimPrefix(stringValue(plan, "planDigest"), "sha256:")
	receipt := map[string]any{
		"receiptVersion":   "gcac.agent-security/v1",
		"operationId":      operationID,
		"planId":           planID,
		"planDigest":       planDigest,
		"agentId":          agentID,
		"tenantId":         tenantID,
		"tokenId":          tokenID,
		"status":           status,
		"startedAt":        startedAt,
		"completedAt":      time.Now().UTC().Format(time.RFC3339Nano),
		"operationResults": results,
		"nonceConsumed":    true,
	}
	if errorCode != "" {
		receipt["errorCode"] = errorCode
	}
	if unknownReason != "" {
		receipt["unknownReason"] = unknownReason
	}
	// Receipt 摘要覆盖除 digest/signature 外的完整合同，和控制面
	// AgentExecutionReceiptV1 校验保持一致；不把自身字段递归纳入摘要。
	receipt["digest"] = sha256JSON(receipt)
	return receipt
}

func planIdentifier(plan map[string]any) string {
	if value := stringValue(plan, "planId"); value != "" {
		return value
	}
	return stringValue(plan, "executionId")
}

func executeAdcsOperation(ctx context.Context, operationType string, input map[string]any) (map[string]any, error) {
	// 所有外部 certreq/certutil/sc 命令都必须拥有独立的硬超时。
	// 如果 CA、RPC 或网络异常，不能让任务处理循环永久阻塞并停止心跳；
	// 写操作超时仍由 runCommand 标记为 UNKNOWN，禁止控制面安全地重复提交。
	commandCtx, cancel := context.WithTimeout(ctx, adcsCommandTimeout)
	defer cancel()
	caConfig := stringValue(input, "caConfig")
	switch operationType {
	case "issue", "ca.certificate.issue", "ca.certificate.issue.v1", "renew", "ca.certificate.renew", "ca.certificate.renew.v1":
		return adcsSubmit(commandCtx, input, caConfig)
	case "query", "ca.certificate.query", "ca.certificate.query.v1":
		return adcsRetrieve(commandCtx, input, caConfig)
	case "revoke", "ca.certificate.revoke", "ca.certificate.revoke.v1":
		return adcsRevoke(commandCtx, input, caConfig)
	case "revocation_evidence", "ca.revocation.evidence", "ca.revocation.evidence.v1":
		return adcsEvidence(commandCtx, input)
	case "status", "ca.status", "ca.microsoft-adcs.status":
		return adcsStatus(commandCtx, caConfig)
	case "crl.status", "crl.publish", "ca.crl.status", "ca.crl.publish":
		return adcsCrl(commandCtx, operationType, input, caConfig)
	default:
		return nil, fmt.Errorf("AD CS Agent 不支持操作：%s", operationType)
	}
}

// adcsList 使用 certutil 的固定列集合读取 CA 数据库，返回公开摘要和请求号游标。
// 不读取私钥、凭据或证书内容；limit+1 行用于判断是否还有下一页。
func adcsList(ctx context.Context, input map[string]any, caConfig string) (map[string]any, error) {
	objectType := stringValue(input, "objectType")
	if objectType != "request" && objectType != "issuance" && objectType != "revocation" {
		return nil, errors.New("AD CS list requires request, issuance or revocation objectType")
	}
	limit := intValue(input, "limit")
	if limit < 1 || limit > 500 {
		return nil, errors.New("AD CS list limit must be between 1 and 500")
	}
	argSets := adcsListArgSets(input, caConfig)
	if len(argSets) == 0 {
		return nil, errors.New("AD CS list 参数无效")
	}
	commandCtx, cancel := context.WithTimeout(ctx, adcsCommandTimeout)
	defer cancel()
	var lastErr error
	for argIndex, args := range argSets {
		output, err := runAdcsCertutilCommand(commandCtx, args...)
		if err != nil {
			lastErr = err
			continue
		}
		// 前两组 -out 列集合的顺序是 Agent 自己固定的，允许在本地化
		// 表头不可识别时按固定位置读取；最后一组是不带 -out 的完整输出，
		// 列顺序由 Windows 决定，禁止猜位置。
		rows, err := parseAdcsViewCsvWithPositional(output, argIndex < 2)
		if err != nil {
			lastErr = err
			continue
		}
		// 不同 Windows 版本对 -out 的字段别名支持不完全一致。第一组字段
		// 成功但解析为空时，继续用兼容别名重试，避免命令成功却静默得到 0 条。
		if len(rows) == 0 && argIndex < len(argSets)-1 {
			continue
		}
		// certutil 某些版本会忽略不支持的 -out 列并仍返回 0 退出码。
		// 这种结果看起来“有记录”，实际字段已经错位；继续尝试兼容列集
		// 或完整表头输出，不能把错误状态写入后端。
		if len(rows) > 0 && adcsRowsNeedFallback(rows) && argIndex < len(argSets)-1 {
			lastErr = errors.New("AD CS certutil 返回的列映射不可靠")
			continue
		}
		return projectAdcsListRows(rows, objectType, limit, caConfig)
	}
	if lastErr == nil {
		lastErr = errors.New("AD CS certutil 未返回可解析记录")
	}
	return nil, lastErr
}

// adcsListArgs 将 -config 放在 certutil 子命令之前。Windows 不同版本对
// 全局参数位置处理不完全一致，固定顺序可以避免服务账户下的采集失败。
func adcsListArgs(input map[string]any, caConfig string) []string {
	argSets := adcsListArgSets(input, caConfig)
	if len(argSets) == 0 {
		return nil
	}
	return argSets[0]
}

func adcsListArgSets(input map[string]any, caConfig string) [][]string {
	objectType := stringValue(input, "objectType")
	if objectType != "request" && objectType != "issuance" && objectType != "revocation" {
		return nil
	}
	limit := intValue(input, "limit")
	if limit < 1 || limit > 500 {
		return nil
	}
	view := strings.ToLower(stringValue(input, "view"))
	if view == "" {
		view = "log"
	}
	if view != "log" && view != "queue" {
		return nil
	}
	restriction := stringValue(input, "cursor")
	if restriction != "" {
		if _, err := strconv.Atoi(restriction); err != nil {
			return nil
		}
		restriction = "RequestID>=" + restriction
	}
	prefix := make([]string, 0, 8)
	if caConfig != "" {
		prefix = append(prefix, "-config", caConfig)
	}
	if restriction != "" {
		prefix = append(prefix, "-restrict", restriction)
	}
	viewArg := strings.ToUpper(view[:1]) + view[1:]
	columnSets := []string{
		"Request.RequestID,Request.Disposition,Request.RequesterName,Request.SubmittedWhen,Request.ResolvedWhen,Request.RevokedWhen,Request.CommonName,CertificateTemplate,SerialNumber,NotBefore,NotAfter",
		"RequestID,Disposition,RequesterName,SubmittedWhen,ResolvedWhen,RevokedWhen,CommonName,CertificateTemplate,SerialNumber,NotBefore,NotAfter",
	}
	argSets := make([][]string, 0, len(columnSets))
	for _, columns := range columnSets {
		args := append([]string{}, prefix...)
		args = append(args, "-out", columns, "-view", viewArg, "csv")
		argSets = append(argSets, args)
	}
	// 某些版本对 -out 列名集合支持不完整，但默认 CSV 仍会返回完整表头；
	// 让解析器根据表头识别字段，避免因为单个列名不兼容而得到空结果。
	args := append([]string{}, prefix...)
	args = append(args, "-view", viewArg, "csv")
	argSets = append(argSets, args)
	return argSets
}

func projectAdcsListRows(rows []adcsViewRow, objectType string, limit int, caConfig string) (map[string]any, error) {
	sort.Slice(rows, func(i, j int) bool { return rows[i].requestID < rows[j].requestID })
	filtered := rows[:0]
	for _, row := range rows {
		if objectType == "issuance" && row.normalizedStatus != "issued" {
			continue
		}
		if objectType == "revocation" && row.normalizedStatus != "revoked" {
			continue
		}
		filtered = append(filtered, row)
	}
	rows = filtered
	complete := len(rows) <= limit
	if len(rows) > limit {
		rows = rows[:limit]
	}
	records := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		records = append(records, row.observation())
	}
	result := map[string]any{"records": records, "complete": complete, "caConfig": caConfig}
	if !complete && len(rows) > 0 {
		result["nextCursor"] = strconv.FormatInt(rows[len(rows)-1].requestID+1, 10)
	}
	for _, row := range rows {
		if row.submittedWhen != "" {
			result["sourceWatermark"] = row.submittedWhen
		}
	}
	return result, nil
}

type adcsViewRow struct {
	requestID        int64
	disposition      string
	normalizedStatus string
	commonName       string
	template         string
	serialNumber     string
	notBefore        string
	notAfter         string
	submittedWhen    string
	resolvedWhen     string
	revokedWhen      string
	requester        string
}

func (row adcsViewRow) observation() map[string]any {
	observation := map[string]any{
		"externalObjectId":   fmt.Sprintf("request:%d", row.requestID),
		"normalizedStatus":   row.normalizedStatus,
		"sourceStatus":       row.disposition,
		"sourceRevision":     sha256Text(fmt.Sprintf("%d|%s|%s|%s|%s|%s", row.requestID, row.disposition, row.serialNumber, row.resolvedWhen, row.revokedWhen, row.notAfter)),
		"subjectCommonName":  row.commonName,
		"templateExternalId": row.template,
		"requestedByDisplay": row.requester,
		"submittedAt":        row.submittedWhen,
		"issuedAt":           row.resolvedWhen,
		"revokedAt":          row.revokedWhen,
		"notBefore":          row.notBefore,
		"notAfter":           row.notAfter,
		"rawSummary": map[string]any{
			"requestId": row.requestID, "disposition": row.disposition,
			"commonName": row.commonName, "template": row.template,
			"serialNumber": row.serialNumber, "requester": row.requester,
		},
	}
	if row.serialNumber != "" {
		observation["serialNumber"] = row.serialNumber
	}
	return observation
}

func parseAdcsViewCsv(output string) ([]adcsViewRow, error) {
	return parseAdcsViewCsvWithPositional(output, true)
}

func parseAdcsViewCsvWithPositional(output string, allowPositional bool) ([]adcsViewRow, error) {
	decoded := decodeAdcsCommandOutput(output)
	reader := csv.NewReader(strings.NewReader(decoded))
	reader.Comma = detectAdcsCsvDelimiter(decoded)
	reader.FieldsPerRecord = -1
	rows, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("解析 AD CS certutil CSV 失败：%w", err)
	}
	if len(rows) == 0 {
		return []adcsViewRow{}, nil
	}
	// certutil 可能在 CSV 表头前输出提示或本地化信息，不能假定第一行就是表头。
	headerIndex := -1
	indexes := map[string]int{}
	for rowIndex, row := range rows {
		for columnIndex, value := range row {
			if field, ok := adcsColumnAlias(value); ok {
				indexes[field] = columnIndex
			}
		}
		if _, ok := indexes["requestId"]; ok {
			headerIndex = rowIndex
			break
		}
	}
	dataStart := 0
	positionalMode := false
	if headerIndex >= 0 {
		dataStart = headerIndex + 1
	} else {
		if !allowPositional {
			return nil, errors.New("AD CS certutil CSV 缺少可识别表头")
		}
		positionalMode = true
		// 本地化系统可能把表头编码成非 UTF-8，无法按名称识别。由于 -out
		// 已固定列顺序，找到第一行可解析的 RequestID 后按位置读取即可。
		foundData := false
		for rowIndex, row := range rows {
			if len(row) > 0 {
				if _, ok := parseAdcsRequestID(row[0]); ok {
					dataStart = rowIndex
					foundData = true
					break
				}
			}
		}
		if !foundData {
			return []adcsViewRow{}, nil
		}
	}
	index := func(name string) int {
		if value, ok := indexes[name]; ok {
			return value
		}
		if !positionalMode {
			return -1
		}
		return adcsColumnPosition[name]
	}
	value := func(row []string, name string) string {
		i := index(name)
		if i < 0 || i >= len(row) {
			return ""
		}
		return strings.TrimSpace(row[i])
	}
	parsed := make([]adcsViewRow, 0, len(rows)-dataStart)
	for _, record := range rows[dataStart:] {
		requestID, ok := parseAdcsRequestID(value(record, "requestId"))
		if !ok || requestID < 1 {
			continue
		}
		disposition := value(record, "disposition")
		resolvedWhen := normalizeAdcsDate(value(record, "resolvedWhen"))
		revokedWhen := normalizeAdcsDate(value(record, "revokedWhen"))
		requester := value(record, "requesterName")
		parsed = append(parsed, adcsViewRow{
			requestID: requestID, disposition: disposition, normalizedStatus: normalizeAdcsDisposition(disposition, revokedWhen),
			commonName: value(record, "commonName"), template: value(record, "certificateTemplate"),
			serialNumber: value(record, "serialNumber"), notBefore: normalizeAdcsDate(value(record, "notBefore")), notAfter: normalizeAdcsDate(value(record, "notAfter")),
			submittedWhen: normalizeAdcsDate(value(record, "submittedWhen")), resolvedWhen: resolvedWhen, revokedWhen: revokedWhen, requester: requester,
		})
	}
	return parsed, nil
}

// adcsRowsNeedFallback 拦截“命令成功但字段错位”的 certutil 输出。
// Disposition 是 AD CS 状态的唯一权威字段；如果它没有明确处置码，
// 就不能用某个错位日期字段把记录猜成 revoked。
func adcsRowsNeedFallback(rows []adcsViewRow) bool {
	if len(rows) == 0 {
		return false
	}
	requesterMissing := true
	for _, row := range rows {
		if row.disposition == "" || row.normalizedStatus == "unknown" {
			return true
		}
		if strings.TrimSpace(row.requester) != "" {
			requesterMissing = false
		}
	}
	// 请求人是 CA 历史记录的关键公开字段。固定列被 Windows 忽略时，
	// 其它字段仍可能看起来正常，但 RequesterName 会全部为空；让完整
	// 表头输出再尝试一次，避免页面只能显示“暂无”。
	return requesterMissing
}

var adcsColumnPosition = map[string]int{
	"requestId": 0, "disposition": 1, "requesterName": 2, "submittedWhen": 3, "resolvedWhen": 4,
	"revokedWhen": 5, "commonName": 6, "certificateTemplate": 7, "serialNumber": 8, "notBefore": 9, "notAfter": 10,
}

func adcsColumnAlias(value string) (string, bool) {
	normalized := normalizeAdcsColumn(value)
	switch normalized {
	case "requestrequestid", "requestid", "requestidnumber", "requestnumber", "requestno", "请求id", "请求号", "请求编号":
		return "requestId", true
	case "requestdisposition", "disposition", "requeststatus", "请求处置", "请求状态", "处置":
		return "disposition", true
	case "requestrequestername", "requestername", "requester", "requesterdisplayname", "请求者姓名", "请求人":
		return "requesterName", true
	case "requestsubmittedwhen", "submittedwhen", "submittedat", "submissiondate", "提交时间", "提交日期":
		return "submittedWhen", true
	case "requestresolvedwhen", "resolvedwhen", "resolvedat", "resolutiondate", "解决时间", "解决日期":
		return "resolvedWhen", true
	case "requestrevokedwhen", "revokedwhen", "revokedat", "revocationdate", "吊销时间", "吊销日期":
		return "revokedWhen", true
	case "requestcommonname", "commonname", "issuedcommonname", "主题", "通用名称":
		return "commonName", true
	case "certificatetemplate", "certificatetemplatename", "templatename", "模板", "证书模板":
		return "certificateTemplate", true
	case "serialnumber", "certificateserialnumber", "序列号":
		return "serialNumber", true
	case "notbefore", "certificateeffectivedate", "生效日期", "证书生效日期":
		return "notBefore", true
	case "notafter", "certificateexpirationdate", "expirationdate", "过期日期", "证书过期日期":
		return "notAfter", true
	default:
		return "", false
	}
}

func normalizeAdcsColumn(value string) string {
	var normalized strings.Builder
	for _, runeValue := range strings.ToLower(strings.TrimPrefix(strings.TrimSpace(value), "\ufeff")) {
		if unicode.IsLetter(runeValue) || unicode.IsDigit(runeValue) {
			normalized.WriteRune(runeValue)
		}
	}
	return normalized.String()
}

func parseAdcsRequestID(value string) (int64, bool) {
	value = strings.Trim(strings.TrimSpace(value), "\"'")
	if open := strings.IndexByte(value, '('); open >= 0 {
		value = strings.TrimSpace(value[:open])
	}
	if strings.HasPrefix(strings.ToLower(value), "0x") {
		parsed, err := strconv.ParseInt(value[2:], 16, 64)
		return parsed, err == nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	return parsed, err == nil
}

func decodeAdcsCommandOutput(value string) string {
	data := []byte(value)
	switch {
	case len(data) >= 2 && data[0] == 0xff && data[1] == 0xfe:
		return decodeAdcsUtf16(data[2:], binary.LittleEndian)
	case len(data) >= 2 && data[0] == 0xfe && data[1] == 0xff:
		return decodeAdcsUtf16(data[2:], binary.BigEndian)
	case len(data) >= 4 && data[1] == 0x00 && data[3] == 0x00:
		return decodeAdcsUtf16(data, binary.LittleEndian)
	case len(data) >= 4 && data[0] == 0x00 && data[2] == 0x00:
		return decodeAdcsUtf16(data, binary.BigEndian)
	case len(data) >= 3 && data[0] == 0xef && data[1] == 0xbb && data[2] == 0xbf:
		return string(data[3:])
	}
	return value
}

// runAdcsCertutilCommand 优先直接执行 certutil，避免观测链路依赖
// PowerShell；直连失败时才通过 PowerShell 将本地化输出转成 UTF-8。
func runAdcsCertutilCommand(ctx context.Context, args ...string) (string, error) {
	// 先直接执行 certutil。该路径不依赖 PowerShell，兼容服务账户、
	// 精简系统和被 AppLocker/组策略限制 PowerShell 的 Windows 主机。
	directOutput, directErr := runCommand(ctx, "certutil.exe", args...)
	if directErr == nil || runtime.GOOS != "windows" {
		return directOutput, directErr
	}

	// 直连失败时才使用 PowerShell 做输出编码转换，改善中文字段显示。
	argsJSON, err := json.Marshal(args)
	if err != nil {
		return "", fmt.Errorf("编码 certutil 参数失败：%w", err)
	}
	wrappedOutput, wrappedErr := runPowerShellScript(ctx, adcsCertutilUtf8Script, map[string]string{
		"GCAC_CERTUTIL_ARGS_JSON": string(argsJSON),
	})
	if wrappedErr == nil {
		return wrappedOutput, nil
	}
	return "", fmt.Errorf("certutil 直连失败：%v；PowerShell 编码回退失败：%v", directErr, wrappedErr)
}

const adcsCertutilUtf8Script = `
$ErrorActionPreference = 'Stop'
$argJson = [Environment]::GetEnvironmentVariable('GCAC_CERTUTIL_ARGS_JSON')
if ([string]::IsNullOrWhiteSpace($argJson)) { throw 'certutil 参数为空' }
$certutilArgs = @($argJson | ConvertFrom-Json | ForEach-Object { [string]$_ })
$text = (& certutil.exe @certutilArgs 2>&1 | Out-String -Width 4096)
if ($LASTEXITCODE -ne 0) { throw $text }
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text))
`

func detectAdcsCsvDelimiter(value string) rune {
	best := ','
	bestCount := 0
	for _, line := range strings.Split(value, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		for _, candidate := range []rune{',', ';', '\t'} {
			count := strings.Count(line, string(candidate))
			if count > bestCount {
				best = candidate
				bestCount = count
			}
		}
		if bestCount >= 2 {
			return best
		}
	}
	return best
}

func decodeAdcsUtf16(data []byte, order binary.ByteOrder) string {
	if len(data)%2 != 0 {
		data = data[:len(data)-1]
	}
	units := make([]uint16, len(data)/2)
	for index := range units {
		units[index] = order.Uint16(data[index*2 : index*2+2])
	}
	return string(utf16.Decode(units))
}

func normalizeAdcsDisposition(disposition, _ string) string {
	value := strings.ToLower(strings.TrimSpace(disposition))
	code := adcsDispositionCode(value)
	switch {
	case code == "21" || strings.Contains(value, "revoked") || strings.Contains(value, "吊销"):
		return "revoked"
	case code == "20" || strings.Contains(value, "issued") || strings.Contains(value, "颁发"):
		return "issued"
	case code == "9" || strings.Contains(value, "pending") || strings.Contains(value, "挂起"):
		return "pending"
	case code == "11" || strings.Contains(value, "denied") || strings.Contains(value, "reject") || strings.Contains(value, "拒绝"):
		return "rejected"
	case strings.Contains(value, "failed") || strings.Contains(value, "error"):
		return "failed"
	default:
		// RevokedWhen 只是时间字段，不能替代 AD CS Disposition。
		// 列错位、空列占位符或本地化文本解析失败时必须保持 unknown，
		// 绝不能把正常已签发记录误判成 revoked。
		return "unknown"
	}
}

func containsAdcsMojibake(records []map[string]any) bool {
	for _, record := range records {
		for _, key := range []string{"sourceStatus", "subjectCommonName", "requestedByDisplay", "templateExternalId", "serialNumber"} {
			value := stringValue(record, key)
			if strings.ContainsRune(value, '\ufffd') || strings.Contains(value, "Ã") || strings.Contains(value, "Â") {
				return true
			}
		}
	}
	return false
}

// adcsDispositionCode 从 certutil/COM 的本地化处置文本中提取数字代码。
// 例如“20 -- 已颁发”“21 -- 已吊销”即使后半段因代码页损坏，也必须
// 依靠稳定的数字代码判定，不能把已颁发记录误归类为吊销。
func adcsDispositionCode(value string) string {
	value = strings.TrimSpace(value)
	end := 0
	for end < len(value) && value[end] >= '0' && value[end] <= '9' {
		end++
	}
	if end == 0 {
		return ""
	}
	code := value[:end]
	switch code {
	case "9", "11", "20", "21":
		return code
	default:
		return ""
	}
}

func adcsStatus(ctx context.Context, caConfig string) (map[string]any, error) {
	output, err := runCommand(ctx, "sc.exe", "query", "CertSvc")
	if err != nil {
		return nil, err
	}
	serviceStatus := "stopped"
	if strings.Contains(strings.ToUpper(output), "RUNNING") {
		serviceStatus = "running"
	}
	return map[string]any{"status": serviceStatus, "serviceName": "CertSvc", "caConfig": caConfig, "evidenceSummary": truncate(output, 4096)}, nil
}

func adcsSubmit(ctx context.Context, input map[string]any, caConfig string) (map[string]any, error) {
	csr := stringValue(input, "csrPem")
	if csr == "" {
		return nil, errors.New("AD CS issue requires csrPem")
	}
	requestPath, err := writeTempFile("gcac-adcs-*.csr", []byte(csr))
	if err != nil {
		return nil, err
	}
	defer os.Remove(requestPath)
	certificatePath := stringValue(input, "certificateOutputPath")
	temporary := certificatePath == ""
	if temporary {
		certificatePath, err = tempPath("gcac-adcs-*.cer")
		if err != nil {
			return nil, err
		}
		defer os.Remove(certificatePath)
	}
	args := []string{"-submit"}
	if caConfig != "" {
		args = append(args, "-config", caConfig)
	}
	if template := stringValue(input, "templateId"); template != "" {
		args = append(args, "-attrib", "CertificateTemplate:"+template)
	}
	args = append(args, requestPath, certificatePath)
	output, err := runCommand(ctx, "certreq.exe", args...)
	if err != nil {
		return nil, err
	}
	requestID := parseRequestID(output)
	if requestID == "" {
		requestID = stringValue(input, "providerRequestId")
	}
	result := map[string]any{"providerRequestId": requestID, "requestId": requestID, "caConfig": caConfig}
	if certificate, readErr := os.ReadFile(certificatePath); readErr == nil && len(certificate) > 0 {
		material, materialErr := certificateMaterial(certificate)
		if materialErr != nil {
			return nil, fmt.Errorf("解析 AD CS 证书结果失败：%w", materialErr)
		}
		result["status"] = "issued"
		for key, value := range material {
			result[key] = value
		}
	} else {
		result["status"] = "pending"
	}
	_ = temporary
	return result, nil
}

func adcsRetrieve(ctx context.Context, input map[string]any, caConfig string) (map[string]any, error) {
	requestID := stringValue(input, "providerRequestId")
	if requestID == "" {
		return nil, errors.New("AD CS query requires providerRequestId")
	}
	certificatePath, err := tempPath("gcac-adcs-*.cer")
	if err != nil {
		return nil, err
	}
	defer os.Remove(certificatePath)
	args := []string{"-retrieve"}
	if caConfig != "" {
		args = append(args, "-config", caConfig)
	}
	args = append(args, requestID, certificatePath)
	output, err := runCommand(ctx, "certreq.exe", args...)
	if err != nil {
		return nil, err
	}
	result := map[string]any{"providerRequestId": requestID, "caConfig": caConfig}
	if certificate, readErr := os.ReadFile(certificatePath); readErr == nil && len(certificate) > 0 {
		material, materialErr := certificateMaterial(certificate)
		if materialErr != nil {
			return nil, fmt.Errorf("解析 AD CS 查询证书失败：%w", materialErr)
		}
		result["status"] = "issued"
		for key, value := range material {
			result[key] = value
		}
	} else if strings.Contains(strings.ToLower(output), "pending") {
		result["status"] = "pending"
	} else {
		result["status"] = "unknown"
	}
	return result, nil
}

func adcsRevoke(ctx context.Context, input map[string]any, caConfig string) (map[string]any, error) {
	serial := stringValue(input, "serialNumber")
	if serial == "" {
		return nil, errors.New("AD CS revoke requires serialNumber")
	}
	args := []string{}
	if caConfig != "" {
		args = append(args, "-config", caConfig)
	}
	args = append(args, "-revoke", serial, strconv.Itoa(revocationReason(stringValue(input, "reason"))))
	if _, err := runCommand(ctx, "certutil.exe", args...); err != nil {
		return nil, err
	}
	return map[string]any{"status": "revoked", "serialNumber": strings.ToUpper(serial), "revokedAt": time.Now().UTC().Format(time.RFC3339Nano)}, nil
}

func adcsEvidence(ctx context.Context, input map[string]any) (map[string]any, error) {
	path := stringValue(input, "certificatePath")
	if path == "" {
		return nil, errors.New("AD CS revocation evidence requires certificatePath")
	}
	output, err := runCommand(ctx, "certutil.exe", "-verify", "-urlfetch", path)
	if err != nil {
		return nil, err
	}
	status := "unknown"
	if strings.Contains(strings.ToLower(output), "revoked") {
		status = "revoked"
	}
	return map[string]any{"status": status, "revocationStatus": status, "serialNumber": strings.ToUpper(stringValue(input, "serialNumber")), "evidenceSummary": truncate(output, 4096)}, nil
}

func adcsCrl(ctx context.Context, operationType string, input map[string]any, caConfig string) (map[string]any, error) {
	if operationType == "crl.publish" || operationType == "ca.crl.publish" || stringValue(input, "operation") == "ca.crl.publish" {
		args := []string{}
		if caConfig != "" {
			args = append(args, "-config", caConfig)
		}
		args = append(args, "-crl")
		if _, err := runCommand(ctx, "certutil.exe", args...); err != nil {
			return nil, err
		}
	}
	output, err := runCommand(ctx, "certutil.exe", "-getreg", "CA\\CRLPublicationURLs")
	if err != nil {
		return nil, err
	}
	return map[string]any{"status": "available", "caConfig": caConfig, "crlSummary": truncate(output, 4096)}, nil
}

func startManagementServer(config *AgentConfig, runObservation func(context.Context, bool) (observationRunSummary, error), sendHeartbeat func(context.Context) error) *http.Server {
	server := &http.Server{Addr: net.JoinHostPort(config.ManagementListenAddress, strconv.Itoa(config.ManagementPort)), Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" && r.URL.Path != "/api/v1/control/health" && r.URL.Path != "/api/v1/control/observations" && r.URL.Path != "/api/v1/control/observations/scan" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("content-type", "application/json")
		if r.URL.Path == "/api/v1/control/observations/scan" {
			if r.Method != http.MethodPost {
				w.WriteHeader(http.StatusMethodNotAllowed)
				_ = json.NewEncoder(w).Encode(map[string]any{"status": "failed", "errorCode": "METHOD_NOT_ALLOWED"})
				return
			}
			if runObservation == nil {
				w.WriteHeader(http.StatusServiceUnavailable)
				_ = json.NewEncoder(w).Encode(map[string]any{"status": "failed", "errorCode": "OBSERVATION_RUNNER_UNAVAILABLE"})
				return
			}
			runCtx, cancel := context.WithTimeout(r.Context(), 90*time.Second)
			defer cancel()
			force := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("force")), "true")
			summary, err := runObservation(runCtx, force)
			if sendHeartbeat != nil {
				_ = sendHeartbeat(runCtx)
			}
			if err != nil {
				w.WriteHeader(http.StatusBadGateway)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"status": "failed", "agentRole": "adcs_agent", "agentVersion": agentVersion,
					"lastRun": summary, "errorCode": "OBSERVATION_SCAN_FAILED", "errorMessage": truncate(err.Error(), 1024),
				})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status": "success", "success": true, "agentRole": "adcs_agent", "agentVersion": agentVersion,
				"lastRun": summary, "pendingBatches": summary.PendingBatches,
			})
			return
		}
		if r.URL.Path == "/api/v1/control/observations" {
			if r.Method != http.MethodGet {
				w.WriteHeader(http.StatusMethodNotAllowed)
				_ = json.NewEncoder(w).Encode(map[string]any{"status": "failed", "errorCode": "METHOD_NOT_ALLOWED"})
				return
			}
			state, err := loadObservationState(config.Paths.Windows.DataDir)
			if err != nil {
				w.WriteHeader(http.StatusServiceUnavailable)
				_ = json.NewEncoder(w).Encode(map[string]any{
					"status":       "unavailable",
					"agentRole":    "adcs_agent",
					"agentVersion": agentVersion,
					"error":        truncate(err.Error(), 512),
				})
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"status":         "healthy",
				"agentRole":      "adcs_agent",
				"agentVersion":   agentVersion,
				"parserVersion":  observationParserVersion,
				"source":         state.Source,
				"lastRun":        state.LastRun,
				"pendingBatches": len(state.Pending),
				"sentKeys":       len(state.Sent),
			})
			return
		}
		_, _ = io.WriteString(w, fmt.Sprintf(`{"status":"healthy","agentRole":"adcs_agent","agentVersion":%q,"parserVersion":%q,"managementPort":18933}`, agentVersion, observationParserVersion))
	})}
	go func() {
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fmt.Fprintf(os.Stderr, "AD CS Agent 管理端点失败：%v\n", err)
		}
	}()
	return server
}

func managementEndpoint(config *AgentConfig) string {
	return "http://" + net.JoinHostPort(managementHost(config), strconv.Itoa(config.ManagementPort))
}
func managementHost(config *AgentConfig) string {
	address := strings.TrimSpace(config.ManagementListenAddress)
	if address != "" && address != "0.0.0.0" && address != "::" {
		return strings.Trim(address, "[]")
	}
	if interfaces, err := net.Interfaces(); err == nil {
		for _, iface := range interfaces {
			if iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagUp == 0 {
				continue
			}
			addresses, _ := iface.Addrs()
			for _, raw := range addresses {
				ip, _, err := net.ParseCIDR(raw.String())
				if err == nil {
					if ip4 := ip.To4(); ip4 != nil {
						return ip4.String()
					}
				}
			}
		}
	}
	return "127.0.0.1"
}
func urlQuery(value string) string {
	return strings.ReplaceAll(strings.ReplaceAll(value, "%", "%25"), " ", "%20")
}

func doJSON(ctx context.Context, client *http.Client, config *AgentConfig, method, route string, body any, output any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(config.ControlPlane, "/")+route, reader)
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("content-type", "application/json")
	request.Header.Set("x-request-id", fmt.Sprintf("windows_adcs_agent_%d", time.Now().UnixNano()))
	if strings.TrimSpace(config.TenantID) != "" {
		request.Header.Set("x-tenant-id", strings.TrimSpace(config.TenantID))
	}
	if strings.TrimSpace(config.EnrollmentToken) != "" {
		// 控制面通过该令牌装配租户上下文和 Agent 身份；请求体中的
		// enrollmentToken 只用于注册业务校验，不能替代机器请求头。
		request.Header.Set("x-agent-token", strings.TrimSpace(config.EnrollmentToken))
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(response.Body, 4<<20))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("控制面返回 HTTP %d：%s", response.StatusCode, truncate(string(data), 1024))
	}
	if output != nil && len(data) > 0 {
		return json.Unmarshal(data, output)
	}
	return nil
}

func runCommand(ctx context.Context, command string, args ...string) (string, error) {
	outputFile, err := os.CreateTemp("", "gcac-adcs-command-*.log")
	if err != nil {
		return "", fmt.Errorf("创建 %s 输出文件失败：%w", command, err)
	}
	outputPath := outputFile.Name()
	defer os.Remove(outputPath)
	defer outputFile.Close()

	cmd := exec.Command(command, args...)
	// 使用真实文件承接输出，避免 Windows 子进程继承 Go 管道后，父进程
	// 被 taskkill 终止但 cmd.Wait 仍等待管道关闭，任务永远卡在 execute_start。
	cmd.Stdout = outputFile
	cmd.Stderr = outputFile
	if err := cmd.Start(); err != nil {
		return "", fmt.Errorf("%s 执行失败：%w", command, err)
	}
	waitResult := make(chan error, 1)
	go func() { waitResult <- cmd.Wait() }()
	var waitErr error
	select {
	case waitErr = <-waitResult:
	case <-ctx.Done():
		// Windows certreq 可能创建子进程；先终止整个进程树，再给 Wait
		// 一个有限宽限期，绝不让单个 CA 命令阻塞 Agent 任务循环。
		terminateCommandProcess(cmd.Process)
		select {
		case waitErr = <-waitResult:
		case <-time.After(5 * time.Second):
			return "", adcsUnknownOperationError(fmt.Errorf("%s 执行超时且进程未退出：%w", command, ctx.Err()))
		}
	}
	if closeErr := outputFile.Close(); closeErr != nil && waitErr == nil {
		return "", fmt.Errorf("读取 %s 输出失败：%w", command, closeErr)
	}
	output, readErr := os.ReadFile(outputPath)
	if readErr != nil {
		return "", fmt.Errorf("读取 %s 输出失败：%w", command, readErr)
	}
	decodedOutput := decodeWindowsCommandOutput(output)
	if waitErr != nil {
		wrapped := fmt.Errorf("%s 执行失败：%w：%s", command, waitErr, truncate(decodedOutput, 2048))
		// 命令未启动时没有修改 CA 状态，可以安全按 FAILED 处理；进程
		// 已启动、超时或被中断时，写操作的外部结果可能已经生效，只能标记 UNKNOWN。
		var startErr *exec.Error
		var pathErr *os.PathError
		if errors.As(waitErr, &startErr) || errors.As(waitErr, &pathErr) {
			return "", wrapped
		}
		return "", adcsUnknownOperationError(wrapped)
	}
	return decodedOutput, nil
}
func writeTempFile(pattern string, content []byte) (string, error) {
	file, err := os.CreateTemp("", pattern)
	if err != nil {
		return "", err
	}
	name := file.Name()
	if _, err := file.Write(content); err != nil {
		file.Close()
		os.Remove(name)
		return "", err
	}
	if err := file.Close(); err != nil {
		os.Remove(name)
		return "", err
	}
	return name, nil
}
func tempPath(pattern string) (string, error) {
	file, err := os.CreateTemp("", pattern)
	if err != nil {
		return "", err
	}
	name := file.Name()
	if err := file.Close(); err != nil {
		_ = os.Remove(name)
		return "", err
	}
	// certreq.exe 会把已存在的目标文件视为交互式覆盖确认，服务进程
	// 无法回答该提示。这里只保留随机生成的路径，执行前删除占位文件。
	if err := os.Remove(name); err != nil {
		return "", err
	}
	return name, nil
}
func stringValue(input map[string]any, key string) string {
	value, _ := input[key].(string)
	return strings.TrimSpace(value)
}

func intValue(input map[string]any, key string) int {
	switch value := input[key].(type) {
	case int:
		return value
	case int64:
		return int(value)
	case float64:
		return int(value)
	case string:
		parsed, _ := strconv.Atoi(strings.TrimSpace(value))
		return parsed
	default:
		return 0
	}
}
func parseRequestID(output string) string {
	lower := strings.ToLower(output)
	for _, marker := range []string{"request id", "requestid", "请求 id", "请求号"} {
		index := strings.Index(lower, strings.ToLower(marker))
		if index < 0 {
			continue
		}
		value := strings.TrimLeft(output[index+len(marker):], " :#\t")
		end := 0
		for end < len(value) && value[end] >= '0' && value[end] <= '9' {
			end++
		}
		if end > 0 {
			return value[:end]
		}
	}
	return ""
}
func revocationReason(value string) int {
	switch value {
	case "keyCompromise":
		return 1
	case "caCompromise":
		return 2
	case "affiliationChanged":
		return 3
	case "superseded":
		return 4
	case "cessationOfOperation":
		return 5
	default:
		return 0
	}
}
func truncate(value string, max int) string {
	if len(value) <= max {
		return value
	}
	return value[:max]
}
func sha256Text(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func sha256JSON(value any) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return sha256Text(fmt.Sprintf("%v", value))
	}
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

func certificateMaterial(value []byte) (map[string]any, error) {
	pemValue := certificateText(value)
	block, _ := pem.Decode([]byte(pemValue))
	if block == nil {
		return nil, errors.New("证书不是有效 PEM/DER")
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, err
	}
	publicKey, err := x509.MarshalPKIXPublicKey(certificate.PublicKey)
	if err != nil {
		return nil, err
	}
	fingerprint := sha256.Sum256(certificate.Raw)
	publicKeyFingerprint := sha256.Sum256(publicKey)
	return map[string]any{
		"certificatePem":             pemValue,
		"certificateChainPem":        pemValue,
		"serialNumber":               strings.ToUpper(certificate.SerialNumber.Text(16)),
		"fingerprintSha256":          hex.EncodeToString(fingerprint[:]),
		"publicKeyFingerprintSha256": hex.EncodeToString(publicKeyFingerprint[:]),
		"notBefore":                  certificate.NotBefore.UTC().Format(time.RFC3339),
		"notAfter":                   certificate.NotAfter.UTC().Format(time.RFC3339),
	}, nil
}

func certificateText(value []byte) string {
	if strings.Contains(string(value), "-----BEGIN CERTIFICATE-----") {
		return string(value)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: value}))
}
