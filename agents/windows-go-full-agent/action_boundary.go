package main

import (
	"errors"
	"fmt"
	"strings"
)

// decodeQueuedAgentV2Payload 将控制面队列中的 canonical actionType 转换为内部 wire action。
// actionType 只允许在队列边界存在，旧 action 字段不得成为运行期旁路。
func decodeQueuedAgentV2Payload(payload map[string]any) (map[string]any, string, error) {
	if payload == nil {
		return nil, "", errors.New("Agent v2 队列载荷不能为空")
	}
	if wireAction := strings.TrimSpace(stringFromMap(payload, "action")); wireAction != "" {
		return nil, "", errors.New("Agent v2 队列载荷不得直接携带 wire action")
	}
	action, err := canonicalAgentV2Action(stringFromMap(payload, "actionType"))
	if err != nil {
		return nil, "", err
	}
	wirePayload := cloneMap(payload)
	delete(wirePayload, "actionType")
	delete(wirePayload, "actionSchemaVersion")
	wirePayload["action"] = action
	return wirePayload, action, nil
}

// canonicalAgentV2Action 只允许长期合同中的四个 canonical 动作。
func canonicalAgentV2Action(value string) (string, error) {
	actionType := strings.TrimSpace(value)
	switch actionType {
	case agentFactCollect, agentPlanValidate, agentPlanExecute, agentExecutionReceipt:
		return actionType, nil
	case "":
		return "", errors.New("Agent v2 队列载荷缺少 canonical actionType")
	default:
		return "", fmt.Errorf("Agent v2 动作未登记: %s", actionType)
	}
}

// agentV2ContractPayload 保留 Agent v2 的严格合同，同时隔离控制面调度元数据。
func agentV2ContractPayload(payload map[string]any) map[string]any {
	contractPayload := cloneMap(payload)
	delete(contractPayload, "refreshWebInventory")
	delete(contractPayload, "requestedBy")
	return contractPayload
}
