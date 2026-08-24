package main

import "testing"

func TestHandleRejectsWriteOperationsOutsideAgentV2(t *testing.T) {
	for _, operation := range []string{"capture-binding", "verify-binding", "update-binding", "rollback-binding"} {
		result := handle(request{Operation: operation})
		if result.Success {
			t.Fatalf("操作 %s 不应在 Plugin 内直接成功", operation)
		}
		if result.ErrorCode != "IIS_OPERATION_REQUIRES_AGENT_V2_PLAN" {
			t.Fatalf("操作 %s 错误码=%q", operation, result.ErrorCode)
		}
	}
}

func TestHandleRejectsUnknownOperation(t *testing.T) {
	result := handle(request{Operation: "command.execute"})
	if result.Success || result.ErrorCode != "OPERATION_NOT_REGISTERED" {
		t.Fatalf("未知操作必须失败关闭: %+v", result)
	}
}

func TestFirstNonEmptySkipsBlankValues(t *testing.T) {
	if got := firstNonEmpty("", "  ", "scanner failed"); got != "scanner failed" {
		t.Fatalf("firstNonEmpty()=%q", got)
	}
}
