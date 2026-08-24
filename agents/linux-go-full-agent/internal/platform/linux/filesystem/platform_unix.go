//go:build !windows

package filesystem

import (
	"fmt"
	"os"
	"syscall"
)

type owner struct {
	UID int
	GID int
}

func readOwner(info os.FileInfo) owner {
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return owner{UID: -1, GID: -1}
	}
	return owner{UID: int(stat.Uid), GID: int(stat.Gid)}
}

func applyOwner(path string, value owner) error {
	if value.UID < 0 || value.GID < 0 {
		return nil
	}
	return os.Chown(path, value.UID, value.GID)
}

func ensureSpace(path string, required int64) error {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return err
	}
	available := int64(stat.Bavail) * int64(stat.Bsize)
	if available < required {
		return fmt.Errorf("insufficient disk space: required=%d available=%d", required, available)
	}
	return nil
}

func syncDirectory(path string) error {
	directory, err := os.Open(path)
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
