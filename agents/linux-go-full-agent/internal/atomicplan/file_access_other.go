//go:build !linux

package atomicplan

import (
	"os"
)

func checkDirectoryWritable(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode().Perm()&0o222 == 0 {
		return os.ErrPermission
	}
	return nil
}
