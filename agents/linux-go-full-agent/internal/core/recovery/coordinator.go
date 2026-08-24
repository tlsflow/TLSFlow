package recovery

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	FailureCanceled = "OPERATION_CANCELED"
	FailureTimeout  = "OPERATION_TIMEOUT"
)

type RestoreFunc func(context.Context, Entry) ([]string, error)

type Outcome struct {
	FailureCode    string
	RecoverySteps  []string
	RecoveryFailed bool
	Error          error
}

type Coordinator struct {
	handlers map[string]RestoreFunc
	timeout  time.Duration
}

func NewCoordinator(timeout time.Duration) *Coordinator {
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	return &Coordinator{handlers: map[string]RestoreFunc{}, timeout: timeout}
}

func (coordinator *Coordinator) Register(actionType string, restore RestoreFunc) error {
	actionType = strings.TrimSpace(actionType)
	if actionType == "" || restore == nil {
		return errors.New("recovery action type and handler are required")
	}
	if _, exists := coordinator.handlers[actionType]; exists {
		return fmt.Errorf("recovery handler already registered: %s", actionType)
	}
	coordinator.handlers[actionType] = restore
	return nil
}

func (coordinator *Coordinator) Recover(ctx context.Context, journal Journal, step, fallbackCode string, cause error, restore RestoreFunc) Outcome {
	if cause == nil {
		cause = errors.New("operation failed")
	}
	code := ClassifyFailure(fallbackCode, cause)
	if journal != nil {
		_ = journal.Fail(step, code, cause.Error())
	}
	recoveryContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), coordinator.timeout)
	defer cancel()
	entry := Entry{}
	if journal != nil {
		entry = journal.Snapshot()
	}
	steps, err := restore(recoveryContext, entry)
	if journal != nil {
		result := "completed"
		message := cause.Error()
		if err != nil {
			result = "failed"
			message = err.Error()
		}
		_ = journal.RecordRecovery(steps, result, message)
	}
	return Outcome{FailureCode: code, RecoverySteps: steps, RecoveryFailed: err != nil, Error: err}
}

func (coordinator *Coordinator) RecoverPending(ctx context.Context, root string) error {
	items, err := ScanPending(root)
	if err != nil {
		return err
	}
	sort.Slice(items, func(left, right int) bool {
		return items[left].Entry.StartedAt < items[right].Entry.StartedAt
	})
	var failures []string
	for _, item := range items {
		restore, exists := coordinator.handlers[item.Entry.ActionType]
		if !exists {
			failures = append(failures, fmt.Sprintf("%s: no recovery handler for %s", item.Entry.OperationID, item.Entry.ActionType))
			continue
		}
		ledger, openErr := Open(item.Path)
		if openErr != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", item.Entry.OperationID, openErr))
			continue
		}
		recoveryContext, cancel := context.WithTimeout(context.WithoutCancel(ctx), coordinator.timeout)
		steps, recoveryErr := restore(recoveryContext, item.Entry)
		cancel()
		if recoveryErr != nil {
			_ = ledger.RecordRecovery(steps, "failed", recoveryErr.Error())
			failures = append(failures, fmt.Sprintf("%s: %v", item.Entry.OperationID, recoveryErr))
			continue
		}
		_ = ledger.RecordRecovery(steps, "completed", "interrupted operation recovered during startup")
	}
	if len(failures) > 0 {
		return errors.New(strings.Join(failures, "; "))
	}
	return nil
}

func ClassifyFailure(fallbackCode string, err error) string {
	switch {
	case errors.Is(err, context.Canceled):
		return FailureCanceled
	case errors.Is(err, context.DeadlineExceeded):
		return FailureTimeout
	default:
		return strings.TrimSpace(fallbackCode)
	}
}
