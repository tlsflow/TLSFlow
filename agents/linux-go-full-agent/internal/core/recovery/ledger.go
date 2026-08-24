package recovery

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type FileState struct {
	Path       string `json:"path"`
	BackupPath string `json:"backupPath,omitempty"`
	Mode       string `json:"mode,omitempty"`
	Owner      string `json:"owner,omitempty"`
	Group      string `json:"group,omitempty"`
	Existed    bool   `json:"existed"`
}

type Entry struct {
	SchemaVersion   string         `json:"schemaVersion"`
	State           string         `json:"state"`
	OperationID     string         `json:"operationId"`
	ActionType      string         `json:"actionType"`
	AuditID         string         `json:"auditId"`
	StartedAt       string         `json:"startedAt"`
	UpdatedAt       string         `json:"updatedAt"`
	BeforeState     map[string]any `json:"beforeState,omitempty"`
	Files           []FileState    `json:"files,omitempty"`
	ServiceState    map[string]any `json:"serviceState,omitempty"`
	CompletedSteps  []string       `json:"completedSteps,omitempty"`
	FailedStep      string         `json:"failedStep,omitempty"`
	FailureCode     string         `json:"failureCode,omitempty"`
	FailureMessage  string         `json:"failureMessage,omitempty"`
	RecoverySteps   []string       `json:"recoverySteps,omitempty"`
	RecoveryResult  string         `json:"recoveryResult,omitempty"`
	RecoveryMessage string         `json:"recoveryMessage,omitempty"`
}

type Ledger struct {
	path  string
	entry Entry
	mu    sync.Mutex
}

type Journal interface {
	Fail(string, string, string) error
	RecordRecovery([]string, string, string) error
	Snapshot() Entry
}

type PendingEntry struct {
	Path  string
	Entry Entry
}

func Start(path string, entry Entry) (*Ledger, error) {
	if strings.TrimSpace(path) == "" || strings.TrimSpace(entry.OperationID) == "" {
		return nil, errors.New("recovery ledger path and operation id are required")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	entry.SchemaVersion = "gcac.linux.recovery.v1"
	entry.State = "in_progress"
	entry.StartedAt = now
	entry.UpdatedAt = now
	ledger := &Ledger{path: path, entry: entry}
	if err := ledger.persist(); err != nil {
		return nil, err
	}
	return ledger, nil
}

func Load(path string) (Entry, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return Entry{}, err
	}
	var entry Entry
	if err := json.Unmarshal(content, &entry); err != nil {
		return Entry{}, err
	}
	return entry, nil
}

func (ledger *Ledger) CompleteStep(step string) error {
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	step = strings.TrimSpace(step)
	if step == "" {
		return errors.New("recovery ledger step is required")
	}
	for _, completed := range ledger.entry.CompletedSteps {
		if completed == step {
			return nil
		}
	}
	ledger.entry.CompletedSteps = append(ledger.entry.CompletedSteps, step)
	return ledger.persistLocked()
}

func (ledger *Ledger) RecordFiles(files []FileState) error {
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	ledger.entry.Files = append([]FileState(nil), files...)
	return ledger.persistLocked()
}

func (ledger *Ledger) RecordServiceState(state map[string]any) error {
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	ledger.entry.ServiceState = cloneMap(state)
	return ledger.persistLocked()
}

func (ledger *Ledger) Fail(step, code, message string) error {
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	ledger.entry.FailedStep = strings.TrimSpace(step)
	ledger.entry.FailureCode = strings.TrimSpace(code)
	ledger.entry.FailureMessage = strings.TrimSpace(message)
	ledger.entry.State = "failed"
	return ledger.persistLocked()
}

func (ledger *Ledger) Complete() error {
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	ledger.entry.State = "completed"
	return ledger.persistLocked()
}

func (ledger *Ledger) RecordRecovery(steps []string, result, message string) error {
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	ledger.entry.RecoverySteps = append([]string(nil), steps...)
	ledger.entry.RecoveryResult = strings.TrimSpace(result)
	ledger.entry.RecoveryMessage = strings.TrimSpace(message)
	if strings.EqualFold(strings.TrimSpace(result), "completed") || strings.EqualFold(strings.TrimSpace(result), "succeeded") {
		ledger.entry.State = "recovered"
	}
	return ledger.persistLocked()
}

func Pending(root string) ([]Entry, error) {
	pending, err := ScanPending(root)
	if err != nil {
		return nil, err
	}
	entries := make([]Entry, 0, len(pending))
	for _, item := range pending {
		entries = append(entries, item.Entry)
	}
	return entries, nil
}

func ScanPending(root string) ([]PendingEntry, error) {
	entries := []PendingEntry{}
	err := filepath.WalkDir(root, func(path string, item os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if item.IsDir() || !strings.HasSuffix(strings.ToLower(item.Name()), ".json") {
			return nil
		}
		entry, err := Load(path)
		if err != nil {
			return nil
		}
		if entry.State == "in_progress" || entry.State == "failed" {
			entries = append(entries, PendingEntry{Path: path, Entry: entry})
		}
		return nil
	})
	if os.IsNotExist(err) {
		return entries, nil
	}
	return entries, err
}

func Open(path string) (*Ledger, error) {
	entry, err := Load(path)
	if err != nil {
		return nil, err
	}
	return &Ledger{path: path, entry: entry}, nil
}

func (ledger *Ledger) Snapshot() Entry {
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	entry := ledger.entry
	entry.Files = append([]FileState(nil), ledger.entry.Files...)
	entry.CompletedSteps = append([]string(nil), ledger.entry.CompletedSteps...)
	entry.ServiceState = cloneMap(ledger.entry.ServiceState)
	entry.BeforeState = cloneMap(ledger.entry.BeforeState)
	return entry
}

func (ledger *Ledger) persist() error {
	ledger.mu.Lock()
	defer ledger.mu.Unlock()
	return ledger.persistLocked()
}

func (ledger *Ledger) persistLocked() error {
	ledger.entry.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	content, err := json.MarshalIndent(ledger.entry, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(ledger.path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(ledger.path), ".recovery-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(content); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, ledger.path); err != nil {
		return fmt.Errorf("persist recovery ledger: %w", err)
	}
	return nil
}

func cloneMap(source map[string]any) map[string]any {
	if source == nil {
		return nil
	}
	result := make(map[string]any, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}
