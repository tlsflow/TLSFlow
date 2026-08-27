package main

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestAtomicReplacePreservesTargetOwnershipAndMode(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "tomcat.p12")
	if err := os.WriteFile(target, []byte("old"), 0o640); err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	beforeOwner, ok := before.Sys().(*syscall.Stat_t)
	if !ok {
		t.Skip("当前测试平台无法读取 POSIX 文件属主")
	}

	if err := atomicReplaceFile(target, []byte("new")); err != nil {
		t.Fatalf("原子替换失败: %v", err)
	}
	after, err := os.Stat(target)
	if err != nil {
		t.Fatal(err)
	}
	afterOwner, ok := after.Sys().(*syscall.Stat_t)
	if !ok {
		t.Fatal("替换后无法读取 POSIX 文件属主")
	}
	if after.Mode().Perm() != before.Mode().Perm() {
		t.Fatalf("替换后权限被改变: before=%#o after=%#o", before.Mode().Perm(), after.Mode().Perm())
	}
	if afterOwner.Uid != beforeOwner.Uid || afterOwner.Gid != beforeOwner.Gid {
		t.Fatalf("替换后属主被改变: before=%d:%d after=%d:%d", beforeOwner.Uid, beforeOwner.Gid, afterOwner.Uid, afterOwner.Gid)
	}
}
