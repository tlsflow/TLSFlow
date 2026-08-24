package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type nonceConsumptionRecord struct {
	RecordVersion string `json:"recordVersion"`
	Nonce         string `json:"nonce"`
	TokenID       string `json:"tokenId"`
	ConsumedAt    string `json:"consumedAt"`
	ResultDigest  string `json:"resultDigest"`
}

var agentNonceStore = struct {
	mu        sync.RWMutex
	directory string
}{}

// configurePersistentAgentNonceStore 在运行期启动前固定本机 Nonce 账本目录；不允许默认临时目录。
func configurePersistentAgentNonceStore(directory string) error {
	directory = strings.TrimSpace(directory)
	if directory == "" {
		return errors.New("Agent v2 Nonce 本地存储目录未配置，拒绝启动")
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return fmt.Errorf("创建 Agent v2 Nonce 本地存储目录失败: %w", err)
	}
	agentNonceStore.mu.Lock()
	agentNonceStore.directory = directory
	agentNonceStore.mu.Unlock()
	return nil
}

// consumePersistentAgentNonce 使用 O_EXCL 保证同一主机上重启后也不能再次消费同一 Nonce。
func consumePersistentAgentNonce(nonce, tokenID, resultDigest string) error {
	nonce = strings.TrimSpace(nonce)
	tokenID = strings.TrimSpace(tokenID)
	resultDigest = strings.TrimSpace(resultDigest)
	if nonce == "" || tokenID == "" || resultDigest == "" {
		return errors.New("Nonce 消费记录缺少绑定字段")
	}

	agentNonceStore.mu.RLock()
	directory := agentNonceStore.directory
	agentNonceStore.mu.RUnlock()
	if directory == "" {
		return errors.New("Agent v2 Nonce 本地存储未装配，失败关闭")
	}

	key := sha256.Sum256([]byte(nonce))
	path := filepath.Join(directory, hex.EncodeToString(key[:])+".json")
	record := nonceConsumptionRecord{
		RecordVersion: agentSecurityContract,
		Nonce:         nonce,
		TokenID:       tokenID,
		ConsumedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		ResultDigest:  resultDigest,
	}
	encoded, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("编码 Nonce 消费记录失败: %w", err)
	}

	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if os.IsExist(err) {
			return errors.New("capability token nonce has already been consumed")
		}
		return fmt.Errorf("创建 Nonce 消费记录失败: %w", err)
	}

	writeErr := error(nil)
	if _, err = file.Write(encoded); err != nil {
		writeErr = err
	} else if err = file.Sync(); err != nil {
		writeErr = err
	}
	if err = file.Close(); err != nil && writeErr == nil {
		writeErr = err
	}
	if writeErr != nil {
		_ = os.Remove(path)
		return fmt.Errorf("持久化 Nonce 消费记录失败: %w", writeErr)
	}
	return nil
}
