package recovery

import (
	"path/filepath"
	"reflect"
	"testing"
)

func TestLedgerPersistsFailureAndRecoveryEvidence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "operation.json")
	ledger, err := Start(path, Entry{
		OperationID: "task-1",
		ActionType:  "certificate.deploy",
		AuditID:     "audit-1",
		BeforeState: map[string]any{"service": "active"},
		Files:       []FileState{{Path: "/etc/ssl/cert.pem", BackupPath: "/backup/cert.pem", Existed: true, Mode: "0644", Owner: "root", Group: "root"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := ledger.CompleteStep("backup"); err != nil {
		t.Fatal(err)
	}
	if err := ledger.Fail("reload", "SERVICE_RELOAD_FAILED", "reload failed"); err != nil {
		t.Fatal(err)
	}
	if err := ledger.RecordRecovery([]string{"restore-files", "restart-service"}, "succeeded", "restored"); err != nil {
		t.Fatal(err)
	}
	entry, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if entry.FailedStep != "reload" || entry.RecoveryResult != "succeeded" {
		t.Fatalf("恢复证据不完整: %#v", entry)
	}
	if !reflect.DeepEqual(entry.CompletedSteps, []string{"backup"}) {
		t.Fatalf("完成步骤不正确: %#v", entry.CompletedSteps)
	}
}
