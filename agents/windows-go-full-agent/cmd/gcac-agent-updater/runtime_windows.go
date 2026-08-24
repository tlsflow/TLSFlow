//go:build windows

package main

func ensureWindowsRuntime() error {
	return nil
}

const (
	windowsSystem32Directory = `C:\Windows\System32`
	windowsPowerShellPath    = windowsSystem32Directory + `\WindowsPowerShell\v1.0\powershell.exe`
)
