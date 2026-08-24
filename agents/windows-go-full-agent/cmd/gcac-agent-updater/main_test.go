package main

import (
	"path/filepath"
	"testing"
)

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

var errTestUpdater = testUpdaterError("updater failed after rollback")

type testUpdaterError string

func (e testUpdaterError) Error() string { return string(e) }
