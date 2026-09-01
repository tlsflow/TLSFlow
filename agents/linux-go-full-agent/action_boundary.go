package main

import (
	"errors"
	"fmt"
	"strings"
)

const agentV2SchemaVersion = "1.0"

// decodeQueuedAgentV2Payload 将控制面队列载荷转换为 Agent v2 wire 载荷。
// 队列字段只在这一层读取；进入 Agent v2 后只保留 canonical action。
func decodeQueuedAgentV2Payload(payload map[string]any) (map[string]any, string, string, error) {
	if payload == nil {
		return nil, "", "", errors.New("Agent v2 队列载荷不能为空")
	}
	if wireAction := strings.TrimSpace(stringFromMap(payload, "action")); wireAction != "" {
		return nil, "", "", errors.New("Agent v2 队列载荷不得直接携带 wire action")
	}
	action, err := canonicalAgentV2Action(stringFromMap(payload, "actionType"))
	if err != nil {
		return nil, "", "", err
	}
	wirePayload := cloneMap(payload)
	delete(wirePayload, "actionType")
	delete(wirePayload, "actionSchemaVersion")
	wirePayload["action"] = action
	return wirePayload, action, resolveQueuedActionSchemaVersion(payload), nil
}

// agentV2ContractPayload 保留 Agent v2 的严格合同，同时隔离控制面调度元数据。
func agentV2ContractPayload(payload map[string]any) map[string]any {
	contractPayload := cloneMap(payload)
	delete(contractPayload, "refreshWebInventory")
	delete(contractPayload, "requestedBy")
	return contractPayload
}

// encodeQueuedAgentV2Payload 将内部 Agent v2 载荷编码为控制面队列载荷。
// 队列出口只发送 actionType，禁止同时发送 action 形成双路径。
func encodeQueuedAgentV2Payload(payload map[string]any) (map[string]any, string, error) {
	if payload == nil {
		return nil, "", errors.New("Agent v2 队列载荷不能为空")
	}
	rawActionType := strings.TrimSpace(stringFromMap(payload, "actionType"))
	rawAction := strings.TrimSpace(stringFromMap(payload, "action"))
	if rawActionType != "" && rawAction != "" && rawActionType != rawAction {
		return nil, "", errors.New("Agent v2 队列动作字段不一致")
	}
	action, err := canonicalAgentV2Action(firstNonEmpty(rawActionType, rawAction))
	if err != nil {
		return nil, "", err
	}
	queuePayload := cloneMap(payload)
	delete(queuePayload, "action")
	queuePayload["actionType"] = action
	if strings.TrimSpace(stringFromMap(queuePayload, "actionSchemaVersion")) == "" {
		queuePayload["actionSchemaVersion"] = agentV2SchemaVersion
	}
	return queuePayload, action, nil
}

func canonicalAgentV2Action(value string) (string, error) {
	action := strings.TrimSpace(value)
	switch action {
	case agentFactCollect, agentPlanValidate, agentPlanExecute, agentExecutionReceipt:
		return action, nil
	default:
		if action == "" {
			return "", errors.New("Agent v2 队列载荷缺少 canonical actionType")
		}
		return "", fmt.Errorf("Agent v2 动作未登记: %s", action)
	}
}

func resolveQueuedActionSchemaVersion(payload map[string]any) string {
	if schemaVersion := strings.TrimSpace(stringFromMap(payload, "actionSchemaVersion")); schemaVersion != "" {
		return schemaVersion
	}
	return agentV2SchemaVersion
}
