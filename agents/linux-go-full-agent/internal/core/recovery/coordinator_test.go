package recovery

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestCoordinatorClassifiesCancellationAndUsesIndependentRecoveryContext(t *testing.T) {
	ledger, err := Start(filepath.Join(t.TempDir(), "cancel.json"), Entry{OperationID: "cancel-1", ActionType: "certificate.deploy"})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	coordinator := NewCoordinator(time.Second)
	outcome := coordinator.Recover(ctx, ledger, "deploy", "VERIFY_FAILED", context.Canceled, func(recoveryContext context.Context, entry Entry) ([]string, error) {
		if recoveryContext.Err() != nil {
			t.Fatalf("恢复上下文不应继承业务取消状态: %v", recoveryContext.Err())
		}
		return []string{"restore-files"}, nil
	})
	if outcome.FailureCode != FailureCanceled || outcome.RecoveryFailed {
		t.Fatalf("取消恢复结果错误: %#v", outcome)
	}
	entry, err := Load(filepath.Join(filepath.Dir(ledger.path), "cancel.json"))
	if err != nil {
		t.Fatal(err)
	}
	if entry.State != "recovered" || entry.FailureCode != FailureCanceled {
		t.Fatalf("取消恢复证据错误: %#v", entry)
	}
}

func TestCoordinatorRecoversPendingEntriesByRegisteredAction(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "pending.json")
	ledger, err := Start(path, Entry{OperationID: "pending-1", ActionType: "certificate.deploy"})
	if err != nil {
		t.Fatal(err)
	}
	if err := ledger.RecordFiles([]FileState{{Path: "/tmp/cert.pem", BackupPath: "/tmp/cert.pem.bak", Existed: true}}); err != nil {
		t.Fatal(err)
	}
	coordinator := NewCoordinator(time.Second)
	if err := coordinator.Register("certificate.deploy", func(context.Context, Entry) ([]string, error) {
		return []string{"restore:/tmp/cert.pem"}, nil
	}); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.RecoverPending(context.Background(), root); err != nil {
		t.Fatal(err)
	}
	entry, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if entry.State != "recovered" || len(entry.RecoverySteps) != 1 {
		t.Fatalf("启动恢复证据错误: %#v", entry)
	}
}

func TestCoordinatorKeepsFailedRecoveryPending(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "pending.json")
	if _, err := Start(path, Entry{OperationID: "pending-1", ActionType: "certificate.deploy"}); err != nil {
		t.Fatal(err)
	}
	coordinator := NewCoordinator(time.Second)
	if err := coordinator.Register("certificate.deploy", func(context.Context, Entry) ([]string, error) {
		return nil, errors.New("restore failed")
	}); err != nil {
		t.Fatal(err)
	}
	if err := coordinator.RecoverPending(context.Background(), root); err == nil {
		t.Fatal("恢复失败时必须返回错误")
	}
	entry, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if entry.State != "in_progress" || entry.RecoveryResult != "failed" {
		t.Fatalf("失败恢复必须保留待处理状态: %#v", entry)
	}
}
