package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPersistentAgentNonceStoreRejectsReplayAfterReconfigure(t *testing.T) {
	directory := filepath.Join(t.TempDir(), "agent-v2-nonces")
	if err := configurePersistentAgentNonceStore(directory); err != nil {
		t.Fatalf("配置 Nonce 存储失败: %v", err)
	}
	if err := consumePersistentAgentNonce("nonce-persisted", "token-persisted", "plan-digest-persisted"); err != nil {
		t.Fatalf("首次消费 Nonce 失败: %v", err)
	}
	if err := configurePersistentAgentNonceStore(directory); err != nil {
		t.Fatalf("重启后重新装配 Nonce 存储失败: %v", err)
	}
	if err := consumePersistentAgentNonce("nonce-persisted", "token-persisted", "plan-digest-persisted"); err == nil {
		t.Fatal("重启后重放 Nonce 必须失败关闭")
	}
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) != 1 {
		t.Fatalf("Nonce 消费记录未持久化: entries=%d err=%v", len(entries), err)
	}
}
