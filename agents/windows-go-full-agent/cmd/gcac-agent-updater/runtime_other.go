//go:build !windows

package main

import "errors"

func ensureWindowsRuntime() error {
	return errors.New("Windows Agent 升级器只能运行在 Windows")
}

const (
	windowsSystem32Directory = `C:\Windows\System32`
	windowsPowerShellPath    = windowsSystem32Directory + `\WindowsPowerShell\v1.0\powershell.exe`
)
