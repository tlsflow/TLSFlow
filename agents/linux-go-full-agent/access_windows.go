//go:build windows

package main

import "os"

func canReadPath(path string) bool {
	file, err := os.Open(path)
	if err != nil {
		return false
	}
	_ = file.Close()
	return true
}

func canWritePath(path string) bool {
	file, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return false
	}
	_ = file.Close()
	return true
}

func canWriteDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func shellInvocation(command string) (string, []string) {
	return "cmd.exe", []string{"/c", command}
}
