package main

import (
	"context"
	"net/http"
	"testing"
)

func TestDirectControlGatewayTaskFailsClosed(t *testing.T) {
	success, errorCode, _, _, handled := executeGatewayTask(
		context.Background(),
		&http.Client{},
		&AgentConfig{},
		agentTaskEnvelope{ID: "task-retired-direct-control"},
		map[string]any{"type": "gateway.forward.direct_control"},
	)
	if success || errorCode != "GATEWAY_FORWARD_DIRECT_CONTROL_DISABLED" || !handled {
		t.Fatalf("旧 Direct Control Gateway 任务未失败关闭: success=%v code=%s handled=%v", success, errorCode, handled)
	}
}
