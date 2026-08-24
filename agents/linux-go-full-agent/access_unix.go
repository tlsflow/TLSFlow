//go:build !windows

package main

import "syscall"

const (
	accessExecute = 1
	accessWrite   = 2
	accessRead    = 4
)

func canReadPath(path string) bool {
	return syscall.Access(path, accessRead) == nil
}

func canWritePath(path string) bool {
	return syscall.Access(path, accessWrite) == nil
}

func canWriteDir(path string) bool {
	return syscall.Access(path, accessWrite|accessExecute) == nil
}

func shellInvocation(command string) (string, []string) {
	return "/bin/sh", []string{"-lc", command}
}
