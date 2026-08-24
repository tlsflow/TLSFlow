//go:build linux

package atomicplan

import "syscall"

const (
	accessExecute = 1
	accessWrite   = 2
)

func checkDirectoryWritable(path string) error {
	return syscall.Access(path, accessWrite|accessExecute)
}
