//go:build !windows

package atomicplan

import (
	"os"
	"syscall"
)

func readFileOwnership(info os.FileInfo) (int, int) {
	if stat, ok := info.Sys().(*syscall.Stat_t); ok {
		return int(stat.Uid), int(stat.Gid)
	}
	return -1, -1
}

func applyFileOwnership(path string, uid, gid int) error {
	return os.Chown(path, uid, gid)
}
