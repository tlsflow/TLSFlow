package filesystem

import (
	"os"
	"path/filepath"
	"testing"
)

func TestAtomicReplaceAndRestore(t *testing.T) {
	root := t.TempDir()
	adapter, err := New([]string{root})
	if err != nil {
		t.Fatal(err)
	}
	target := filepath.Join(root, "cert.pem")
	backupPath := filepath.Join(root, "backup", "cert.pem")
	if err := os.WriteFile(target, []byte("old"), 0o640); err != nil {
		t.Fatal(err)
	}
	backup, err := adapter.Backup(target, backupPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := adapter.AtomicReplace(target, []byte("new"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := adapter.Restore(backup); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(target)
	if err != nil || string(content) != "old" {
		t.Fatalf("恢复失败: content=%s err=%v", content, err)
	}
}

func TestAdapterRejectsPathTraversal(t *testing.T) {
	root := t.TempDir()
	adapter, _ := New([]string{root})
	outside := filepath.Join(filepath.Dir(root), "outside.pem")
	if err := adapter.AtomicReplace(outside, []byte("secret"), 0o600); err == nil {
		t.Fatal("越界路径必须拒绝")
	}
}
