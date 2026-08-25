package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWriteBootstrapScriptUsesSingleUTF8BOM(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bootstrap.ps1")
	if err := writeBootstrapScript(path, "\uFEFF$变量 = '拓联思'\r\n"); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(content[:3]), "\xEF\xBB\xBF"; got != want {
		t.Fatalf("bootstrap 必须以 UTF-8 BOM 开头: got %q", got)
	}
	if len(content) >= 6 && string(content[3:6]) == "\xEF\xBB\xBF" {
		t.Fatal("bootstrap 不应重复写入 UTF-8 BOM")
	}
	if got, want := string(content[3:]), "$变量 = '拓联思'\r\n"; got != want {
		t.Fatalf("bootstrap 内容被错误改写: got %q", got)
	}
}

func TestWriteFailurePreservesRollbackOutcome(t *testing.T) {
	statusPath := filepath.Join(t.TempDir(), "upgrade-status.json")
	initial := upgradeStatus{
		SchemaVersion: "management.upgrade.v1",
		TransactionID: "txn-rollback",
		Status:        "rolled_back",
		Phase:         "rolled_back",
		Rollback:      "succeeded",
	}
	if err := saveStatus(statusPath, initial); err != nil {
		t.Fatal(err)
	}
	writeFailure(updaterArgs{statusPath: statusPath}, errTestUpdater)
	actual := loadStatus(statusPath)
	if actual.Status != "rolled_back" || actual.Rollback != "succeeded" {
		t.Fatalf("回滚终态不应被覆盖: %+v", actual)
	}
}

func TestWriteFailureMarksBootstrapExecutionAsManualRequired(t *testing.T) {
	statusPath := filepath.Join(t.TempDir(), "upgrade-status.json")
	initial := upgradeStatus{
		SchemaVersion: "management.upgrade.v1",
		TransactionID: "txn-bootstrap",
		Phase:         "executing_script",
		Status:        "running",
	}
	if err := saveStatus(statusPath, initial); err != nil {
		t.Fatal(err)
	}
	writeFailure(updaterArgs{statusPath: statusPath, bootstrapURL: "https://control.example/agent-install.ps1?token=one-time"}, errTestUpdater)
	actual := loadStatus(statusPath)
	if actual.Status != "manual_required" || actual.Phase != "manual_required" || actual.Rollback != "unknown" {
		t.Fatalf("bootstrap 执行失败必须进入人工处置: %+v", actual)
	}
}

var errTestUpdater = testUpdaterError("updater failed after rollback")

type testUpdaterError string

func (e testUpdaterError) Error() string { return string(e) }
