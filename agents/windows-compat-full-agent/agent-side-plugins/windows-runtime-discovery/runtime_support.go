package main

import (
	"os"
	"time"
)

const (
	windowsSystem32Directory    = `C:\Windows\System32`
	windowsPowerShellPath       = windowsSystem32Directory + `\WindowsPowerShell\v1.0\powershell.exe`
	windowsDiscoveryScanTimeout = 30 * time.Second
	fullWebDiscoveryScope       = "FULL_WEB_DISCOVERY"
)

type runtimeLogger struct{}

func (*runtimeLogger) Info(string, ...any) {}

func (*runtimeLogger) Warn(string, ...any) {}

func fixedWindowsEnvironment() []string {
	return append([]string(nil), os.Environ()...)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func stringFromMap(value map[string]any, key string) string {
	if value == nil {
		return ""
	}
	result, _ := value[key].(string)
	return result
}
