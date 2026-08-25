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
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultAgentVersion   = "0.1.1"
	defaultConfigPath     = `C:\ProgramData\GCAC\WindowsAdcsAgent\config\agent.config.json`
	defaultConfigDir      = `C:\ProgramData\GCAC\WindowsAdcsAgent\config`
	defaultDataDir        = `C:\ProgramData\GCAC\WindowsAdcsAgent\data`
	defaultLogDir         = `C:\ProgramData\GCAC\WindowsAdcsAgent\logs`
	defaultManagementPort = 18933
	defaultHeartbeat      = 10
	defaultTaskPoll       = 5
)

var agentVersion = defaultAgentVersion

// AgentConfig 只包含 AD CS Agent 自己的配置空间，不能解析其它 Agent 的目录或服务信息。
type AgentConfig struct {
	SchemaVersion            string `json:"schemaVersion"`
	Version                  string `json:"version"`
	TenantID                 string `json:"tenantId"`
	AgentKey                 string `json:"agentKey"`
	EnrollmentToken          string `json:"enrollmentToken"`
	Zone                     string `json:"zone"`
	ControlPlane             string `json:"controlPlaneUrl"`
	HeartbeatIntervalSeconds int    `json:"heartbeatIntervalSeconds"`
	TaskPollIntervalSeconds  int    `json:"taskPollIntervalSeconds"`
	ManagementListenAddress  string `json:"managementListenAddress"`
	ManagementPort           int    `json:"managementPort"`
	Paths                    struct {
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
	ErrorCode    string         `json:"errorCode,omitempty"`
	ErrorMessage string         `json:"errorMessage,omitempty"`
	Detail       map[string]any `json:"detail,omitempty"`
}

type registration struct{ AgentID string }
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
		return err
	}
	server := startManagementServer(config)
	defer server.Shutdown(context.Background())
	var state counters
	if err := heartbeat(ctx, client, config, reg, &state); err != nil {
		fmt.Fprintf(os.Stderr, "AD CS Agent 首次心跳失败：%v\n", err)
	}
	heartbeatTicker := time.NewTicker(time.Duration(config.HeartbeatIntervalSeconds) * time.Second)
	defer heartbeatTicker.Stop()
	taskTicker := time.NewTicker(time.Duration(config.TaskPollIntervalSeconds) * time.Second)
	defer taskTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-heartbeatTicker.C:
			_ = heartbeat(ctx, client, config, reg, &state)
		case <-taskTicker.C:
			if err := pullAndProcessTasks(ctx, client, config, reg, &state); err != nil {
				fmt.Fprintf(os.Stderr, "AD CS Agent 任务轮询失败：%v\n", err)
			}
		}
	}
}

func registerAgent(ctx context.Context, client *http.Client, config *AgentConfig) (*registration, error) {
	hostname, _ := os.Hostname()
	caName := discoverCaName(ctx)
	request := registerRequest{AgentKey: config.AgentKey, Hostname: hostname, CaName: caName, Version: agentVersion, OSType: "windows_adcs", Arch: runtime.GOARCH, ManagementEndpoint: managementEndpoint(config), Labels: []string{"windows-adcs", "windows-service", "adcs_agent"}, Capabilities: adcsCapabilities(), EnrollmentToken: config.EnrollmentToken, Role: "adcs_agent", Zone: config.Zone}
	var response registerResponse
	if err := doJSON(ctx, client, config, http.MethodPost, "/api/v1/agents/register", request, &response); err != nil {
		return nil, fmt.Errorf("注册 AD CS Agent 失败：%w", err)
	}
	if response.ID == "" {
		return nil, errors.New("注册 AD CS Agent 失败：控制面未返回 agentId")
	}
	return &registration{AgentID: response.ID}, nil
}

// discoverCaName 从本机 AD CS 注册表读取 CA 显示名称。非 Windows 环境返回空值，
// 这样交叉编译和协议测试不需要伪造 certutil.exe。
func discoverCaName(ctx context.Context) string {
	if runtime.GOOS != "windows" {
		return ""
	}
	output, err := runCommand(ctx, "certutil.exe", "-getreg", "CA\\DisplayName")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(output, "\n") {
		if _, value, ok := strings.Cut(line, "="); ok {
			value = strings.Trim(strings.TrimSpace(value), "\"")
			if value != "" {
				return value
			}
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

func heartbeat(ctx context.Context, client *http.Client, config *AgentConfig, reg *registration, state *counters) error {
	state.mu.Lock()
	defer state.mu.Unlock()
	request := heartbeatRequest{AgentID: reg.AgentID, Version: agentVersion, ManagementEndpoint: managementEndpoint(config), RuntimeHealth: map[string]any{"modelVersion": "gcac-adcs-agent/v1", "status": "healthy"}}
	request.TaskSummary.Running, request.TaskSummary.Queued = state.running, state.queued
	return doJSON(ctx, client, config, http.MethodPost, "/api/v1/agents/heartbeat", request, nil)
}

func pullAndProcessTasks(ctx context.Context, client *http.Client, config *AgentConfig, reg *registration, state *counters) error {
	var tasks []agentTaskEnvelope
	if err := doJSON(ctx, client, config, http.MethodGet, "/api/v1/agents/tasks/pull?agentId="+urlQuery(reg.AgentID), nil, &tasks); err != nil {
		return err
	}
	for _, task := range tasks {
		if err := processTask(ctx, client, config, reg, state, task); err != nil {
			fmt.Fprintf(os.Stderr, "AD CS Agent 任务 %s 失败：%v\n", task.ID, err)
		}
	}
	return nil
}

func processTask(ctx context.Context, client *http.Client, config *AgentConfig, reg *registration, state *counters, task agentTaskEnvelope) error {
	leaseID := fmt.Sprintf("adcs-%s-%d", task.ID, time.Now().UnixNano())
	var ack agentTaskEnvelope
	if err := doJSON(ctx, client, config, http.MethodPost, "/api/v1/agents/tasks/ack", ackTaskRequest{AgentID: reg.AgentID, TaskID: task.ID, LeaseID: leaseID}, &ack); err != nil {
		return err
	}
	if ack.LeaseID != "" {
		leaseID = ack.LeaseID
	}
	state.mu.Lock()
	state.running++
	state.mu.Unlock()
	defer func() { state.mu.Lock(); state.running--; state.mu.Unlock() }()
	success, code, message, detail := executePlan(ctx, task.Payload, reg.AgentID)
	result := submitResultRequest{AgentID: reg.AgentID, TaskID: task.ID, LeaseID: leaseID, Success: success, ErrorCode: code, ErrorMessage: message, Detail: detail}
	return doJSON(ctx, client, config, http.MethodPost, "/api/v1/agents/tasks/result", result, nil)
}

func executePlan(ctx context.Context, payload map[string]any, agentID string) (bool, string, string, map[string]any) {
	plan, ok := adcsPlanFromPayload(payload)
	if !ok {
		return false, "ADCS_PLAN_REQUIRED", "AD CS Agent 任务缺少 plan", nil
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
			return false, "ADCS_OPERATION_FAILED", err.Error(), map[string]any{"operationType": operationType, "operationResults": results}
		}
		result["operationId"] = op["operationId"]
		results = append(results, result)
	}
	last := map[string]any{}
	if len(results) > 0 {
		last, _ = results[len(results)-1].(map[string]any)
	}
	last["operationResults"] = results
	last["receipt"] = buildAgentReceipt(payload, plan, operations, results, agentID, startedAt)
	return true, "", "", last
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
		"status":           "SUCCESS",
		"startedAt":        startedAt,
		"completedAt":      time.Now().UTC().Format(time.RFC3339Nano),
		"operationResults": results,
		"nonceConsumed":    true,
	}
	// Receipt 摘要覆盖除 digest/signature 外的完整合同，和控制面
	// AgentExecutionReceiptV1 校验保持一致；不把自身字段递归纳入摘要。
	receipt["digest"] = sha256JSON(receipt)
	return receipt
}

func executeAdcsOperation(ctx context.Context, operationType string, input map[string]any) (map[string]any, error) {
	caConfig := stringValue(input, "caConfig")
	switch operationType {
	case "issue", "ca.certificate.issue", "ca.certificate.issue.v1", "renew", "ca.certificate.renew", "ca.certificate.renew.v1":
		return adcsSubmit(ctx, input, caConfig)
	case "query", "ca.certificate.query", "ca.certificate.query.v1":
		return adcsRetrieve(ctx, input, caConfig)
	case "revoke", "ca.certificate.revoke", "ca.certificate.revoke.v1":
		return adcsRevoke(ctx, input, caConfig)
	case "revocation_evidence", "ca.revocation.evidence", "ca.revocation.evidence.v1":
		return adcsEvidence(ctx, input)
	case "status", "ca.status", "ca.microsoft-adcs.status":
		return adcsStatus(ctx, caConfig)
	case "crl.status", "crl.publish", "ca.crl.status", "ca.crl.publish":
		return adcsCrl(ctx, operationType, input, caConfig)
	default:
		return nil, fmt.Errorf("AD CS Agent 不支持操作：%s", operationType)
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

func startManagementServer(config *AgentConfig) *http.Server {
	server := &http.Server{Addr: net.JoinHostPort(config.ManagementListenAddress, strconv.Itoa(config.ManagementPort)), Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/healthz" && r.URL.Path != "/api/v1/control/health" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("content-type", "application/json")
		_, _ = io.WriteString(w, fmt.Sprintf(`{"status":"healthy","agentRole":"adcs_agent","agentVersion":%q,"managementPort":18933}`, agentVersion))
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
	output, err := exec.CommandContext(ctx, command, args...).CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("%s 执行失败：%w：%s", command, err, truncate(string(output), 2048))
	}
	return string(output), nil
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
		return "", err
	}
	return name, nil
}
func stringValue(input map[string]any, key string) string {
	value, _ := input[key].(string)
	return strings.TrimSpace(value)
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
