package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"
)

type gatewayIdentity struct {
	MachineID        string
	Hostname         string
	PrimaryIPAddress string
}

func collectGatewayIdentity(config *AgentConfig) gatewayIdentity {
	hostname, _ := os.Hostname()
	return gatewayIdentity{
		MachineID:        gatewayMachineID(),
		Hostname:         hostname,
		PrimaryIPAddress: gatewayPreferredSourceIP(config),
	}
}

func gatewayMachineID() string {
	if runtime.GOOS == "linux" {
		if content, err := os.ReadFile("/etc/machine-id"); err == nil {
			if value := strings.TrimSpace(string(content)); value != "" {
				return value
			}
		}
	}
	random := make([]byte, 16)
	_, _ = rand.Read(random)
	return "gw-" + hex.EncodeToString(random)
}

func gatewayPreferredSourceIP(config *AgentConfig) string {
	host := strings.TrimSpace(config.ControlPlane)
	if host == "" {
		return ""
	}
	parsed := strings.SplitN(strings.TrimPrefix(strings.TrimPrefix(host, "https://"), "http://"), "/", 2)[0]
	if strings.Contains(parsed, ":") {
		parsed = parsed[:strings.LastIndex(parsed, ":")]
	}
	connection, err := net.DialTimeout("tcp", net.JoinHostPort(parsed, "443"), 3*time.Second)
	if err != nil {
		connection, err = net.DialTimeout("tcp", net.JoinHostPort(parsed, "80"), 3*time.Second)
	}
	if err != nil {
		return ""
	}
	defer connection.Close()
	if address, ok := connection.LocalAddr().(*net.TCPAddr); ok {
		return address.IP.String()
	}
	return ""
}

// ---- 控制面 wire 结构 ----

type registerRequest struct {
	AgentKey           string   `json:"agentKey"`
	MachineID          string   `json:"machineId,omitempty"`
	Hostname           string   `json:"hostname"`
	Version            string   `json:"version"`
	OSType             string   `json:"osType"`
	Arch               string   `json:"arch,omitempty"`
	IPAddress          string   `json:"ipAddress,omitempty"`
	ManagementEndpoint string   `json:"managementEndpoint,omitempty"`
	Labels             []string `json:"labels,omitempty"`
	EnrollmentToken    string   `json:"enrollmentToken,omitempty"`
	Role               string   `json:"role,omitempty"`
	Zone               string   `json:"zone,omitempty"`
	ZoneIDs            []string `json:"zoneIds,omitempty"`
	Adapters           []string `json:"adapters,omitempty"`
	Capabilities       []string `json:"capabilities,omitempty"`
}

type registerResponse struct {
	ID string `json:"id"`
}

type heartbeatRequest struct {
	AgentID            string   `json:"agentId"`
	Version            string   `json:"version"`
	ManagementEndpoint string   `json:"managementEndpoint,omitempty"`
	Adapters           []string `json:"adapters,omitempty"`
	Capabilities       []string `json:"capabilities,omitempty"`
	TaskSummary        struct {
		Running   int `json:"running"`
		Queued    int `json:"queued"`
		Succeeded int `json:"succeeded,omitempty"`
		Failed    int `json:"failed,omitempty"`
	} `json:"taskSummary"`
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

type submitResultRequest struct {
	AgentID      string         `json:"agentId"`
	TaskID       string         `json:"taskId"`
	LeaseID      string         `json:"leaseId"`
	Success      bool           `json:"success"`
	ErrorCode    string         `json:"errorCode,omitempty"`
	ErrorMessage string         `json:"errorMessage,omitempty"`
	Detail       map[string]any `json:"detail,omitempty"`
}

type ackTaskRequest struct {
	AgentID string `json:"agentId"`
	TaskID  string `json:"taskId"`
	LeaseID string `json:"leaseId"`
}

type enqueueAgentTaskRequest struct {
	AgentID         string         `json:"agentId"`
	ExecutionRunID  string         `json:"executionRunId"`
	ExecutionStepID string         `json:"executionStepId"`
	IdempotencyKey  string         `json:"idempotencyKey"`
	Payload         map[string]any `json:"payload"`
}

type runtimeState struct {
	AgentID  string
	Hostname string
	Version  string
}

// ---- 控制面 HTTP 客户端 ----

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
	request.Header.Set("X-Request-Id", fmt.Sprintf("gateway_agent_%d", time.Now().UnixNano()))
	if tenantID := strings.TrimSpace(config.TenantID); tenantID != "" {
		request.Header.Set("X-Tenant-Id", tenantID)
	}
	if token := strings.TrimSpace(config.EnrollmentToken); token != "" {
		request.Header.Set("X-Agent-Token", token)
	}
	response, err := client.Do(request)
	if err != nil {
		return fmt.Errorf("请求控制面失败: %w", err)
	}
	defer response.Body.Close()
	responseBody, err := io.ReadAll(response.Body)
	if err != nil {
		return fmt.Errorf("读取响应失败: %w", err)
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		var apiErr struct {
			Message   string `json:"message"`
			ErrorCode string `json:"errorCode"`
		}
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
	var wrapped struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(responseBody, &wrapped); err == nil && len(wrapped.Data) > 0 {
		if err := json.Unmarshal(wrapped.Data, target); err == nil {
			return nil
		}
	}
	if err := json.Unmarshal(responseBody, target); err != nil {
		return fmt.Errorf("解析响应失败: %s", strings.TrimSpace(string(responseBody)))
	}
	return nil
}

// ---- 注册 / 心跳 / 能力上报 ----

func registerAgent(ctx context.Context, client *http.Client, config *AgentConfig, identity gatewayIdentity) (*runtimeState, error) {
	hostname := identity.Hostname
	if hostname == "" {
		hostname, _ = os.Hostname()
	}
	zone := strings.TrimSpace(config.Zone)
	if zone == "" {
		zone = "default"
	}
	request := registerRequest{
		AgentKey:           config.AgentKey,
		MachineID:          identity.MachineID,
		Hostname:           hostname,
		Version:            agentVersion,
		OSType:             runtime.GOOS,
		Arch:               runtime.GOARCH,
		IPAddress:          identity.PrimaryIPAddress,
		ManagementEndpoint: managementEndpointForIdentity(identity, config),
		Labels:             []string{"gateway-agent"},
		EnrollmentToken:    strings.TrimSpace(config.EnrollmentToken),
		Role:               "gateway",
		Zone:               zone,
		ZoneIDs:            []string{zone},
		Adapters:           gatewayRouteChannels(),
		Capabilities:       gatewayCapabilityKeys(),
	}
	var response registerResponse
	if err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/register", request, &response); err != nil {
		return nil, fmt.Errorf("注册 Gateway Agent 失败: %w", err)
	}
	if strings.TrimSpace(response.ID) == "" {
		return nil, errors.New("注册 Gateway Agent 失败: 服务端未返回 agentId")
	}
	return &runtimeState{AgentID: response.ID, Hostname: hostname, Version: agentVersion}, nil
}

func postHeartbeat(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState, counters *runtimeCounters) error {
	request := heartbeatRequest{AgentID: state.AgentID, Version: state.Version, Adapters: gatewayRouteChannels(), Capabilities: gatewayCapabilityKeys()}
	if counters != nil {
		request.TaskSummary.Running = counters.Running
		request.TaskSummary.Queued = counters.Queued
		request.TaskSummary.Succeeded = counters.Succeeded
		request.TaskSummary.Failed = counters.Failed
	}
	return doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/heartbeat", request, nil)
}

func reportGatewayCapabilities(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState) error {
	capabilities := make([]reportedCapability, 0, len(gatewayCapabilityKeys()))
	for _, capability := range gatewayCapabilityKeys() {
		capabilities = append(capabilities, reportedCapability{
			CapabilityKey: capability,
			Value:         true,
			Confidence:    0.95,
			Evidence:      map[string]any{"source": "gateway-role"},
		})
	}
	request := capabilityReportRequest{
		AgentID:            state.AgentID,
		CompatibilityLevel: "L1",
		Capabilities:       capabilities,
		Adapters:           gatewayRouteChannels(),
	}
	return doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/capabilities", request, nil)
}

// ---- 任务队列 ----

func pullTasks(ctx context.Context, client *http.Client, config *AgentConfig, agentID string) ([]agentTaskEnvelope, error) {
	var tasks []agentTaskEnvelope
	if err := doJSONRequest(ctx, client, config, http.MethodGet, "/api/v1/agents/tasks/pull?agentId="+agentID, nil, &tasks); err != nil {
		return nil, fmt.Errorf("拉取任务失败: %w", err)
	}
	return tasks, nil
}

func ackTask(ctx context.Context, client *http.Client, config *AgentConfig, agentID, taskID, leaseID string) (*agentTaskEnvelope, error) {
	var acknowledged agentTaskEnvelope
	err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/tasks/ack", ackTaskRequest{AgentID: agentID, TaskID: taskID, LeaseID: leaseID}, &acknowledged)
	if err != nil {
		return nil, fmt.Errorf("ack 任务失败: %w", err)
	}
	return &acknowledged, nil
}

func submitTaskResult(ctx context.Context, client *http.Client, config *AgentConfig, request submitResultRequest) (*agentTaskEnvelope, error) {
	var response agentTaskEnvelope
	if err := doJSONRequest(ctx, client, config, http.MethodPost, "/api/v1/agents/tasks/result", request, &response); err != nil {
		return nil, err
	}
	return &response, nil
}

func newLeaseID(taskID string) string {
	return fmt.Sprintf("gw_lease_%s_%d", taskID, time.Now().UnixNano())
}

func pullAndProcessTasks(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState, counters *runtimeCounters) {
	tasks, err := pullTasks(ctx, client, config, state.AgentID)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[task] pull failed: %v\n", err)
		return
	}
	if counters != nil {
		counters.Queued = len(tasks)
	}
	for _, task := range tasks {
		if err := processTask(ctx, client, config, state, counters, task); err != nil {
			fmt.Fprintf(os.Stderr, "[task] taskId=%s error=%v\n", task.ID, err)
		}
	}
	if counters != nil {
		counters.Queued = 0
	}
}

func processTask(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState, counters *runtimeCounters, task agentTaskEnvelope) error {
	leaseID := newLeaseID(task.ID)
	acknowledged, err := ackTask(ctx, client, config, state.AgentID, task.ID, leaseID)
	if err != nil {
		return err
	}
	if acknowledged.LeaseID != "" && acknowledged.LeaseID != leaseID {
		fmt.Fprintf(os.Stderr, "[task] skip taskId=%s because it is already owned by another lease\n", task.ID)
		return nil
	}
	if counters != nil {
		counters.Running++
		defer func() { counters.Running-- }()
	}
	success, errorCode, errorMessage, detail := executeTask(ctx, client, config, state, task)
	request := submitResultRequest{AgentID: state.AgentID, TaskID: task.ID, LeaseID: leaseID, Success: success, ErrorCode: errorCode, ErrorMessage: errorMessage, Detail: detail}
	if _, err := submitTaskResult(ctx, client, config, request); err != nil {
		return fmt.Errorf("上报任务结果失败: %w", err)
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

func executeTask(ctx context.Context, client *http.Client, config *AgentConfig, state *runtimeState, task agentTaskEnvelope) (bool, string, string, map[string]any) {
	payload := task.Payload
	if payload == nil {
		payload = map[string]any{}
	}
	if success, code, message, detail, handled := executeGatewayTask(ctx, client, config, task, payload); handled {
		return success, code, message, detail
	}
	return false, "GATEWAY_TASK_UNSUPPORTED", "Gateway Agent 只处理 gateway.probe 与 gateway.forward.agent_task", map[string]any{
		"taskId": task.ID, "mode": "gateway.agent.unsupported",
	}
}
