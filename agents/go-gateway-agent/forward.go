package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// 网关任务执行：gateway.probe / gateway.forward.agent_task。
// Gateway Agent 只把已授权任务转发给目标 Agent 队列，不在本机执行任何应用操作。

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

// forwardGatewayAgentTask 把控制面已授权的 Agent v2 载荷转发给目标 Agent 的任务队列，
// 然后轮询目标队列直到拿到真实结果。转发不解析载荷内容，不改变授权材料。
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
	forwardPayload, action, err := buildGatewayAgentV2Payload(gatewayPayload, task, targetAgentID)
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
	detail := map[string]any{"mode": "gateway.forward.agent_task", "targetAgentId": targetAgentID, "forwardedTaskId": response.ID, "actionType": action}
	if err != nil {
		return false, "GATEWAY_FORWARD_AGENT_TASK_FAILED", err.Error(), detail, true
	}
	return waitForGatewayAgentTask(ctx, client, config, response.ID, targetAgentID, action, detail, gatewayForwardWaitDuration(gatewayPayload))
}

func buildGatewayAgentV2Payload(source map[string]any, task agentTaskEnvelope, targetAgentID string) (map[string]any, string, error) {
	token := mapFromMap(source, "token")
	decision := mapFromMap(source, "policyDecision")
	if token == nil || decision == nil {
		return nil, "", errors.New("Gateway 转发缺少 Token 或 Policy Decision")
	}
	if tokenAgentID := stringFromMap(token, "agentId"); tokenAgentID != targetAgentID {
		return nil, "", errors.New("Gateway Token agentId 与目标 Agent 不一致")
	}
	if _, exists := source["action"]; exists {
		return nil, "", errors.New("Gateway 转发不得使用 action，必须提供 canonical actionType")
	}
	pluginVersion := firstNonEmpty(stringFromMap(source, "pluginVersion"), stringFromMap(token, "pluginVersionId"))
	planDigest := stringFromMap(token, "planDigest")
	payload := map[string]any{
		"actionType":          firstNonEmpty(stringFromMap(source, "actionType"), stringFromMap(source, "action")),
		"actionSchemaVersion": firstNonEmpty(stringFromMap(source, "actionSchemaVersion"), "1.0"),
		"requestId":           firstNonEmpty(stringFromMap(source, "requestId"), "gateway-forward:"+task.ID),
		"agentId":             targetAgentID,
		"tenantId":            firstNonEmpty(stringFromMap(source, "tenantId"), stringFromMap(token, "tenantId")),
		"pluginId":            stringFromMap(token, "pluginId"),
		"pluginVersion":       pluginVersion,
		"pluginVersionId":     stringFromMap(token, "pluginVersionId"),
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
	return payload, firstNonEmpty(stringFromMap(payload, "actionType"), "agent.plan.execute"), nil
}

// waitForGatewayAgentTask 轮询目标 Agent 的任务队列，直到转发任务进入终态或超时。
// 写操作（agent.plan.execute / agent.execution.receipt）未拿到可确认的成功 Receipt 一律按 UNKNOWN 处理。
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
