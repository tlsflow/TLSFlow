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

	path := nonceRecordPath(directory, "", nonce)
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

func persistentAgentNoncePath(directory, nonce, suffix string) (string, error) {
	if strings.TrimSpace(directory) == "" || strings.TrimSpace(nonce) == "" {
		return "", errors.New("Nonce 记录路径缺少绑定字段")
	}
	key := sha256.Sum256([]byte(strings.TrimSpace(nonce)))
	return filepath.Join(directory, hex.EncodeToString(key[:])+suffix+".json"), nil
}

func persistentNonceDirectory() (string, error) {
	agentNonceStore.mu.RLock()
	directory := agentNonceStore.directory
	agentNonceStore.mu.RUnlock()
	if directory == "" {
		return "", errors.New("Agent v2 Nonce 本地存储未装配，失败关闭")
	}
	return directory, nil
}

func nonceRecordPath(directory, prefix, nonce string) string {
	key := sha256.Sum256([]byte(nonce))
	return filepath.Join(directory, prefix+hex.EncodeToString(key[:])+".json")
}

func loadPersistentAgentNonce(nonce string) (nonceConsumptionRecord, error) {
	nonce = strings.TrimSpace(nonce)
	if nonce == "" {
		return nonceConsumptionRecord{}, errors.New("Nonce 不能为空")
	}
	directory, err := persistentNonceDirectory()
	if err != nil {
		return nonceConsumptionRecord{}, err
	}
	encoded, err := os.ReadFile(nonceRecordPath(directory, "", nonce))
	if err != nil {
		return nonceConsumptionRecord{}, errors.New("Nonce 尚未消费，回执读取失败关闭")
	}
	var record nonceConsumptionRecord
	if err := json.Unmarshal(encoded, &record); err != nil || record.RecordVersion != agentSecurityContract || record.Nonce != nonce || record.TokenID == "" || record.ResultDigest == "" {
		return nonceConsumptionRecord{}, errors.New("Nonce 消费记录无效，失败关闭")
	}
	return record, nil
}

func persistAgentExecutionReceipt(nonce string, receipt AgentExecutionReceiptV1) error {
	directory, err := persistentNonceDirectory()
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(receipt)
	if err != nil {
		return fmt.Errorf("编码 Agent 回执失败: %w", err)
	}
	path := nonceRecordPath(directory, "receipt-", nonce)
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		if os.IsExist(err) {
			return errors.New("Agent 回执已存在，拒绝覆盖")
		}
		return fmt.Errorf("创建 Agent 回执记录失败: %w", err)
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
		return fmt.Errorf("持久化 Agent 回执失败: %w", writeErr)
	}
	return nil
}

func loadPersistentAgentReceipt(nonce string) (AgentExecutionReceiptV1, error) {
	directory, err := persistentNonceDirectory()
	if err != nil {
		return AgentExecutionReceiptV1{}, err
	}
	encoded, err := os.ReadFile(nonceRecordPath(directory, "receipt-", strings.TrimSpace(nonce)))
	if err != nil {
		return AgentExecutionReceiptV1{}, errors.New("Agent 回执尚未持久化，失败关闭")
	}
	var receipt AgentExecutionReceiptV1
	if err := json.Unmarshal(encoded, &receipt); err != nil {
		return AgentExecutionReceiptV1{}, errors.New("Agent 回执记录无效，失败关闭")
	}
	return receipt, nil
}
