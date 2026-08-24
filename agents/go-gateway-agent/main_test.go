package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func TestGatewayConfigDefaultsAndSchema(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "agent.config.json")
	template, err := os.ReadFile("config/agent.config.template.json")
	if err != nil {
		t.Fatalf("读取模板失败: %v", err)
	}
	if err := os.WriteFile(configPath, template, 0o600); err != nil {
		t.Fatalf("写配置失败: %v", err)
	}
	config, err := loadConfig(configPath)
	if err != nil {
		t.Fatalf("加载配置失败: %v", err)
	}
	if config.SchemaVersion != gatewayConfigSchema {
		t.Fatalf("schema 不匹配: %s", config.SchemaVersion)
	}
	if effectiveManagementPort(config) != 18935 {
		t.Fatalf("网关管理端口应为 18935，实际 %d", effectiveManagementPort(config))
	}
	if effectiveRelayPort(config) != 18934 {
		t.Fatalf("网关中继端口应为 18934，实际 %d", effectiveRelayPort(config))
	}
	if effectiveRelayEnabled(config) {
		t.Fatalf("模板默认不应启用中继")
	}
	if runtimeDefaultConfigPath() == "" {
		t.Fatalf("默认配置路径不能为空")
	}
}

func runtimeDefaultConfigPath() string {
	return parseConfigPath(nil)
}

func TestGatewaySelfCheckFailsOnTemplateConfig(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "agent.config.json")
	template, _ := os.ReadFile("config/agent.config.template.json")
	_ = os.WriteFile(configPath, template, 0o600)
	checks := buildGatewaySelfChecks(configPath)
	for _, check := range checks {
		if check["key"] == "controlPlane.url" {
			if passed, _ := check["passed"].(bool); passed {
				t.Fatalf("模板占位 controlPlaneUrl 不应通过自检")
			}
		}
	}
}

func TestExecuteGatewayTaskRejectsDirectControl(t *testing.T) {
	task := agentTaskEnvelope{ID: "task_dc", Payload: map[string]any{"type": "gateway.forward.direct_control"}}
	success, errorCode, _, _, handled := executeGatewayTask(nil, nil, &AgentConfig{}, task, task.Payload)
	if !handled || success || errorCode != "GATEWAY_FORWARD_DIRECT_CONTROL_DISABLED" {
		t.Fatalf("旧 Direct Control 应被拒绝: handled=%v success=%v code=%s", handled, success, errorCode)
	}
}

func TestExecuteGatewayTaskRejectsUnknownType(t *testing.T) {
	task := agentTaskEnvelope{ID: "task_unknown", Payload: map[string]any{"type": "agent.plan.execute"}}
	_, _, _, _, handled := executeGatewayTask(nil, nil, &AgentConfig{}, task, task.Payload)
	if handled {
		t.Fatalf("Gateway Agent 不应处理非网关任务")
	}
}

func TestGatewayProbeTCPReachesLocalListener(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("监听失败: %v", err)
	}
	defer listener.Close()
	port := listener.Addr().(*net.TCPAddr).Port

	payload := map[string]any{"host": "127.0.0.1", "port": port}
	success, detail, err := probeTCPReachability(context.Background(), map[string]any{"target": map[string]any{}}, payload)
	if err != nil || !success {
		t.Fatalf("可达目标应探测成功: success=%v err=%v", success, err)
	}
	if intFromMap(detail, "port") != port {
		t.Fatalf("探测端口不匹配: %v", detail)
	}
}

func TestGatewayProbeTCPRejectsClosedPort(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("监听失败: %v", err)
	}
	closedPort := listener.Addr().(*net.TCPAddr).Port
	_ = listener.Close()

	payload := map[string]any{"host": "127.0.0.1", "port": closedPort}
	success, _, err := probeTCPReachability(context.Background(), map[string]any{}, payload)
	if err == nil || success {
		t.Fatalf("关闭端口应探测失败: success=%v err=%v", success, err)
	}
}

func TestForwardGatewayAgentTaskEndToEnd(t *testing.T) {
	gatewayTask := gatewayFixtureTask(t, "agt_target")
	task := agentTaskEnvelope{
		ID: "gw_agt_task_1", ExecutionRunID: "run_1", ExecutionStepID: "step_1",
		Payload: map[string]any{
			"actionType":     "agent.plan.execute",
			"token":          gatewayTask["payload"].(map[string]any)["token"],
			"policyDecision": gatewayTask["payload"].(map[string]any)["policyDecision"],
			"plan":           gatewayTask["payload"].(map[string]any)["plan"],
			"gatewayTask":    gatewayTask,
		},
	}

	var mu sync.Mutex
	var enqueued map[string]any
	var submitted submitResultRequest
	enqueueCalls := 0

	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/agents/tasks/pull":
			_ = json.NewEncoder(writer).Encode([]agentTaskEnvelope{task})
		case request.Method == http.MethodPost && request.URL.Path == "/api/v1/agents/tasks/ack":
			var ack ackTaskRequest
			_ = json.NewDecoder(request.Body).Decode(&ack)
			_ = json.NewEncoder(writer).Encode(agentTaskEnvelope{ID: ack.TaskID, LeaseID: ack.LeaseID})
		case request.Method == http.MethodPost && request.URL.Path == "/api/v1/agents/tasks":
			mu.Lock()
			enqueueCalls++
			var enqueue enqueueAgentTaskRequest
			_ = json.NewDecoder(request.Body).Decode(&enqueue)
			enqueued = enqueue.Payload
			mu.Unlock()
			_ = json.NewEncoder(writer).Encode(agentTaskEnvelope{ID: "target-task-1"})
		case request.Method == http.MethodGet && request.URL.Path == "/api/v1/agents/tasks":
			_ = json.NewEncoder(writer).Encode(map[string]any{"tasks": []map[string]any{{
				"id": "target-task-1", "status": "succeeded",
				"result": map[string]any{"success": true, "detail": map[string]any{
					"executionStatus": "SUCCESS",
					"receipt":         map[string]any{"status": "SUCCESS", "planDigest": "digest_plan", "operationId": "op_1"},
				}},
			}}})
		case request.Method == http.MethodPost && request.URL.Path == "/api/v1/agents/tasks/result":
			mu.Lock()
			_ = json.NewDecoder(request.Body).Decode(&submitted)
			mu.Unlock()
			_ = json.NewEncoder(writer).Encode(agentTaskEnvelope{ID: submitted.TaskID})
		default:
			writer.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(writer).Encode(map[string]any{"message": "not found"})
		}
	}))
	defer server.Close()

	config := &AgentConfig{ControlPlane: server.URL, TenantID: "tenant_1", EnrollmentToken: "token-1", AgentKey: "agent-key-1"}
	state := &runtimeState{AgentID: "gw_agt_1", Hostname: "gateway-host", Version: agentVersion}
	counters := &runtimeCounters{}

	client := server.Client()
	pullAndProcessTasks(context.Background(), client, config, state, counters)

	mu.Lock()
	defer mu.Unlock()
	if enqueueCalls != 1 {
		t.Fatalf("应只向目标 Agent 入队一次，实际 %d", enqueueCalls)
	}
	if enqueued == nil {
		t.Fatalf("未捕获到转发载荷")
	}
	if stringFromMap(enqueued, "actionType") != "agent.plan.execute" {
		t.Fatalf("转发载荷 actionType 不匹配: %v", enqueued["actionType"])
	}
	if _, exists := enqueued["action"]; exists {
		t.Fatalf("转发载荷不得携带 action 字段")
	}
	if stringFromMap(enqueued, "agentId") != "agt_target" {
		t.Fatalf("转发载荷 agentId 不匹配: %v", enqueued["agentId"])
	}
	if !submitted.Success {
		t.Fatalf("转发结果应为成功: %+v", submitted)
	}
	if stringFromMap(submitted.Detail, "executionStatus") != "SUCCESS" {
		t.Fatalf("转发结果 executionStatus 应为 SUCCESS: %+v", submitted.Detail)
	}
	if submitted.ErrorCode != "" {
		t.Fatalf("成功结果不应带 errorCode: %+v", submitted)
	}
}

func gatewayFixtureTask(t *testing.T, targetAgentID string) map[string]any {
	t.Helper()
	now := time.Now()
	gatewayTask := map[string]any{
		"id":                "gw_task_1",
		"gatewayId":         "gw_1",
		"delegatedTargetId": "target_1",
		"adapter":           gatewayAdapterAgentTask,
		"action":            "gateway.forward.agent_task",
		"executionRunId":    "run_1",
		"stepId":            "step_1",
		"idempotencyKey":    "idem_1",
		"forwardingGrant": map[string]any{
			"id": "fwgrt_1", "gatewayId": "gw_1", "delegatedTargetId": "target_1",
			"delegatedAgentId": targetAgentID, "tenantId": "tenant_1",
			"taskType": "gateway.forward.agent_task", "routeChannel": gatewayAdapterAgentTask,
			"executionRunId": "run_1", "stepId": "step_1",
			"maxUses": 1, "remainingUses": 1, "status": "active",
			"issuedAt":  now.Add(-time.Minute).Format(time.RFC3339),
			"expiresAt": now.Add(time.Hour).Format(time.RFC3339),
		},
		"payload": map[string]any{
			"actionType": "agent.plan.execute",
			"requestId":  "req_1",
			"token": map[string]any{
				"agentId": targetAgentID, "tenantId": "tenant_1", "pluginId": "web.nginx",
				"pluginVersionId": "pv_1", "capability": "web.nginx.deploy", "planDigest": "digest_plan",
				"tokenId": "token_1", "nonce": "nonce_1", "actions": []any{},
				"allowedPaths": []any{}, "allowedServices": []any{}, "artifactDigests": []any{},
			},
			"policyDecision": map[string]any{"allowed": true, "agentId": targetAgentID, "tenantId": "tenant_1", "actions": []any{}, "decisionId": "decision_1"},
			"plan": map[string]any{
				"planId": "plan_1", "planDigest": "digest_plan",
				"operations": []any{map[string]any{"operationId": "op_1", "timeoutSeconds": 30}},
			},
		},
	}
	if stringFromMap(gatewayTask["payload"].(map[string]any), "actionType") == "" {
		t.Fatalf("fixture payload 缺少 actionType")
	}
	return gatewayTask
}

func TestForwardGatewayAgentTaskWaitTimeoutMarksUnknown(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		// 目标任务一直不出现在队列里，等待超时后按 UNKNOWN 处理。
		_ = json.NewEncoder(writer).Encode(map[string]any{"tasks": []any{}})
	}))
	defer server.Close()
	config := &AgentConfig{ControlPlane: server.URL, TenantID: "tenant_1"}
	client := server.Client()
	detail := map[string]any{"mode": "gateway.forward.agent_task", "targetAgentId": "agt_target"}
	success, errorCode, _, result, handled := waitForGatewayAgentTask(
		context.Background(), client, config, "target-task-2", "agt_target", "agent.plan.execute", detail, 500*time.Millisecond,
	)
	if !handled {
		t.Fatalf("等待结果应返回 handled")
	}
	if success || errorCode != "AGENT_EXECUTION_UNKNOWN" {
		t.Fatalf("等待超时应按 UNKNOWN 失败: success=%v code=%s", success, errorCode)
	}
	if stringFromMap(result, "executionStatus") != "UNKNOWN" {
		t.Fatalf("detail 应标记 UNKNOWN: %v", result)
	}
}
