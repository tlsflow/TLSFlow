package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

const (
	taskStatusReceived      = "received"
	taskStatusAcked         = "acked"
	taskStatusRunning       = "running"
	taskStatusRecovering    = "recovering"
	taskStatusResultPending = "result_pending"
	taskStatusSucceeded     = "succeeded"
	taskStatusFailed        = "failed"
	taskStatusRejected      = "rejected"
)

type localTaskRecord struct {
	TaskID          string                 `json:"taskId"`
	IdempotencyKey  string                 `json:"idempotencyKey"`
	ExecutionRunID  string                 `json:"executionRunId"`
	ExecutionStepID string                 `json:"executionStepId"`
	PayloadHash     string                 `json:"payloadHash"`
	Status          string                 `json:"status"`
	LeaseID         string                 `json:"leaseId,omitempty"`
	ReceivedAt      string                 `json:"receivedAt"`
	UpdatedAt       string                 `json:"updatedAt"`
	Result          map[string]any         `json:"result,omitempty"`
	ResultReported  bool                   `json:"resultReported"`
	RecoveryNote    string                 `json:"recoveryNote,omitempty"`
	Metadata        map[string]interface{} `json:"metadata,omitempty"`
}

type localTaskLedgerSnapshot struct {
	Tasks []localTaskRecord `json:"tasks"`
}

type localTaskLedger struct {
	filePath         string
	tasks            map[string]localTaskRecord
	idempotencyIndex map[string]string
}

type recoveryLedgerEntry struct {
	ID        string         `json:"id"`
	Kind      string         `json:"kind"`
	Status    string         `json:"status"`
	Step      string         `json:"step"`
	Detail    map[string]any `json:"detail,omitempty"`
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
	Checksum  string         `json:"checksum"`
}

type recoveryLedgerSnapshot struct {
	Entries []recoveryLedgerEntry `json:"entries"`
}

type recoveryLedger struct {
	filePath string
	entries  map[string]recoveryLedgerEntry
}

func loadLocalTaskLedger(path string) (*localTaskLedger, error) {
	ledger := &localTaskLedger{
		filePath:         path,
		tasks:            map[string]localTaskRecord{},
		idempotencyIndex: map[string]string{},
	}

	content, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ledger, nil
		}
		return nil, fmt.Errorf("读取本地任务账本失败: %w", err)
	}

	var snapshot localTaskLedgerSnapshot
	if err := json.Unmarshal(content, &snapshot); err != nil {
		return nil, fmt.Errorf("解析本地任务账本失败: %w", err)
	}

	for _, task := range snapshot.Tasks {
		if !isTerminalTaskStatus(task.Status) && task.Status != taskStatusResultPending {
			task.Status = taskStatusRecovering
			task.RecoveryNote = "agent restart detected"
			task.UpdatedAt = time.Now().Format(time.RFC3339)
		}
		ledger.tasks[task.TaskID] = task
		ledger.idempotencyIndex[task.IdempotencyKey] = task.TaskID
	}
	return ledger, nil
}

func (l *localTaskLedger) accept(task agentTaskEnvelope) (localTaskRecord, error) {
	fingerprint := fingerprintTaskPayload(task)
	if existing, ok := l.tasks[task.ID]; ok {
		return existing, nil
	}

	if existingTaskID, ok := l.idempotencyIndex[task.IdempotencyKey]; ok {
		existing := l.tasks[existingTaskID]
		if existing.PayloadHash != fingerprint {
			return localTaskRecord{}, fmt.Errorf("本地任务幂等键冲突 taskId=%s existingTaskId=%s idempotencyKey=%s", task.ID, existingTaskID, task.IdempotencyKey)
		}
		return existing, nil
	}

	now := time.Now().Format(time.RFC3339)
	record := localTaskRecord{
		TaskID:          task.ID,
		IdempotencyKey:  task.IdempotencyKey,
		ExecutionRunID:  task.ExecutionRunID,
		ExecutionStepID: task.ExecutionStepID,
		PayloadHash:     fingerprint,
		Status:          taskStatusReceived,
		ReceivedAt:      now,
		UpdatedAt:       now,
		Metadata: map[string]interface{}{
			"agentTaskStatus": task.Status,
		},
	}
	l.tasks[record.TaskID] = record
	l.idempotencyIndex[record.IdempotencyKey] = record.TaskID
	return record, l.persist()
}

func (l *localTaskLedger) markAcked(taskID string, leaseID string) (localTaskRecord, error) {
	return l.patch(taskID, func(record *localTaskRecord) {
		record.Status = taskStatusAcked
		record.LeaseID = leaseID
		record.RecoveryNote = ""
	})
}

func (l *localTaskLedger) markRunning(taskID string) (localTaskRecord, error) {
	return l.patch(taskID, func(record *localTaskRecord) {
		record.Status = taskStatusRunning
		record.RecoveryNote = ""
	})
}

func (l *localTaskLedger) stageResult(taskID string, result submitResultRequest, recoveryNote string) (localTaskRecord, error) {
	return l.patch(taskID, func(record *localTaskRecord) {
		record.Status = taskStatusResultPending
		record.ResultReported = false
		record.Result = map[string]any{
			"success":      result.Success,
			"errorCode":    result.ErrorCode,
			"errorMessage": result.ErrorMessage,
			"detail":       result.Detail,
		}
		record.LeaseID = result.LeaseID
		record.RecoveryNote = recoveryNote
	})
}

func (l *localTaskLedger) markReported(taskID string, success bool) (localTaskRecord, error) {
	return l.patch(taskID, func(record *localTaskRecord) {
		record.ResultReported = true
		record.RecoveryNote = ""
		if success {
			record.Status = taskStatusSucceeded
			return
		}
		record.Status = taskStatusFailed
	})
}

func (l *localTaskLedger) get(taskID string) (localTaskRecord, bool) {
	record, ok := l.tasks[taskID]
	return record, ok
}

func (l *localTaskLedger) recoverable() []localTaskRecord {
	result := make([]localTaskRecord, 0)
	for _, task := range l.tasks {
		if isTerminalTaskStatus(task.Status) && task.ResultReported {
			continue
		}
		result = append(result, cloneLocalTaskRecord(task))
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].UpdatedAt < result[j].UpdatedAt
	})
	return result
}

func (l *localTaskLedger) patch(taskID string, mutate func(record *localTaskRecord)) (localTaskRecord, error) {
	record, ok := l.tasks[taskID]
	if !ok {
		return localTaskRecord{}, fmt.Errorf("本地任务不存在: %s", taskID)
	}
	mutate(&record)
	record.UpdatedAt = time.Now().Format(time.RFC3339)
	l.tasks[taskID] = record
	return record, l.persist()
}

func (l *localTaskLedger) persist() error {
	snapshot := localTaskLedgerSnapshot{
		Tasks: make([]localTaskRecord, 0, len(l.tasks)),
	}
	for _, task := range l.tasks {
		snapshot.Tasks = append(snapshot.Tasks, cloneLocalTaskRecord(task))
	}
	sort.Slice(snapshot.Tasks, func(i, j int) bool {
		return snapshot.Tasks[i].TaskID < snapshot.Tasks[j].TaskID
	})
	return atomicWriteJSON(l.filePath, snapshot)
}

func loadRecoveryLedger(path string) (*recoveryLedger, error) {
	ledger := &recoveryLedger{
		filePath: path,
		entries:  map[string]recoveryLedgerEntry{},
	}

	content, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return ledger, nil
		}
		return nil, fmt.Errorf("读取恢复账本失败: %w", err)
	}

	var snapshot recoveryLedgerSnapshot
	if err := json.Unmarshal(content, &snapshot); err != nil {
		return nil, fmt.Errorf("解析恢复账本失败: %w", err)
	}

	for _, entry := range snapshot.Entries {
		if entry.Checksum != checksumRecoveryEntry(entry) {
			return nil, fmt.Errorf("恢复账本校验失败: %s", entry.ID)
		}
		ledger.entries[entry.ID] = entry
	}
	return ledger, nil
}

func (l *recoveryLedger) record(id string, kind string, status string, step string, detail map[string]any) error {
	now := time.Now().Format(time.RFC3339)
	current, ok := l.entries[id]
	if !ok {
		current = recoveryLedgerEntry{
			ID:        id,
			Kind:      kind,
			CreatedAt: now,
		}
	}
	current.Kind = kind
	current.Status = status
	current.Step = step
	current.Detail = cloneMap(detail)
	current.UpdatedAt = now
	current.Checksum = checksumRecoveryEntry(current)
	l.entries[id] = current
	return l.persist()
}

func (l *recoveryLedger) recoverable() []recoveryLedgerEntry {
	result := make([]recoveryLedgerEntry, 0)
	for _, entry := range l.entries {
		if entry.Status == taskStatusSucceeded || entry.Status == taskStatusFailed || entry.Status == taskStatusRejected {
			continue
		}
		result = append(result, entry)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].UpdatedAt < result[j].UpdatedAt
	})
	return result
}

func (l *recoveryLedger) persist() error {
	snapshot := recoveryLedgerSnapshot{
		Entries: make([]recoveryLedgerEntry, 0, len(l.entries)),
	}
	for _, entry := range l.entries {
		snapshot.Entries = append(snapshot.Entries, entry)
	}
	sort.Slice(snapshot.Entries, func(i, j int) bool {
		return snapshot.Entries[i].ID < snapshot.Entries[j].ID
	})
	return atomicWriteJSON(l.filePath, snapshot)
}

func atomicWriteJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	content, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	tmpPath := fmt.Sprintf("%s.tmp-%d", path, time.Now().UnixNano())
	if err := os.WriteFile(tmpPath, append(content, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

func fingerprintTaskPayload(task agentTaskEnvelope) string {
	payload := stableJSON(map[string]any{
		"agentId":         task.AgentID,
		"executionRunId":  task.ExecutionRunID,
		"executionStepId": task.ExecutionStepID,
		"idempotencyKey":  task.IdempotencyKey,
		"payload":         task.Payload,
	})
	sum := sha256.Sum256([]byte(payload))
	return hex.EncodeToString(sum[:])
}

func checksumRecoveryEntry(entry recoveryLedgerEntry) string {
	unsigned := map[string]any{
		"id":        entry.ID,
		"kind":      entry.Kind,
		"status":    entry.Status,
		"step":      entry.Step,
		"detail":    entry.Detail,
		"createdAt": entry.CreatedAt,
		"updatedAt": entry.UpdatedAt,
	}
	sum := sha256.Sum256([]byte(stableJSON(unsigned)))
	return hex.EncodeToString(sum[:])
}

func stableJSON(value any) string {
	switch item := value.(type) {
	case nil:
		return "null"
	case string:
		bytes, _ := json.Marshal(item)
		return string(bytes)
	case bool:
		if item {
			return "true"
		}
		return "false"
	case float64, float32, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
		bytes, _ := json.Marshal(item)
		return string(bytes)
	case []any:
		parts := make([]string, 0, len(item))
		for _, child := range item {
			parts = append(parts, stableJSON(child))
		}
		return "[" + stringsJoin(parts, ",") + "]"
	case map[string]any:
		keys := make([]string, 0, len(item))
		for key := range item {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			parts = append(parts, stableJSON(key)+":"+stableJSON(item[key]))
		}
		return "{" + stringsJoin(parts, ",") + "}"
	default:
		bytes, _ := json.Marshal(item)
		var decoded any
		if err := json.Unmarshal(bytes, &decoded); err == nil {
			return stableJSON(decoded)
		}
		return string(bytes)
	}
}

func stringsJoin(items []string, sep string) string {
	if len(items) == 0 {
		return ""
	}
	result := items[0]
	for index := 1; index < len(items); index++ {
		result += sep + items[index]
	}
	return result
}

func isTerminalTaskStatus(status string) bool {
	return status == taskStatusSucceeded || status == taskStatusFailed || status == taskStatusRejected
}

func cloneLocalTaskRecord(record localTaskRecord) localTaskRecord {
	return localTaskRecord{
		TaskID:          record.TaskID,
		IdempotencyKey:  record.IdempotencyKey,
		ExecutionRunID:  record.ExecutionRunID,
		ExecutionStepID: record.ExecutionStepID,
		PayloadHash:     record.PayloadHash,
		Status:          record.Status,
		LeaseID:         record.LeaseID,
		ReceivedAt:      record.ReceivedAt,
		UpdatedAt:       record.UpdatedAt,
		Result:          cloneMap(record.Result),
		ResultReported:  record.ResultReported,
		RecoveryNote:    record.RecoveryNote,
		Metadata:        cloneInterfaceMap(record.Metadata),
	}
}

func cloneMap(input map[string]any) map[string]any {
	if input == nil {
		return nil
	}
	bytes, _ := json.Marshal(input)
	var output map[string]any
	_ = json.Unmarshal(bytes, &output)
	return output
}

func cloneInterfaceMap(input map[string]interface{}) map[string]interface{} {
	if input == nil {
		return nil
	}
	bytes, _ := json.Marshal(input)
	var output map[string]interface{}
	_ = json.Unmarshal(bytes, &output)
	return output
}
