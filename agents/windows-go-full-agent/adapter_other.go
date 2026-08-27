//go:build !windows

package main

import (
	"os"
	"runtime"
)

// 非 Windows 构建只用于协议和静态检查，不能伪造 Windows 产品或服务事实。
type windowsAdapterSnapshot struct {
	Facts map[string]any   `json:"facts"`
	OS    *windowsOSDetail `json:"os,omitempty"`
}

func collectWindowsAdapterSnapshot(logger *runtimeLogger) windowsAdapterSnapshot {
	if logger != nil {
		logger.Info("collecting generic Windows host facts in non-Windows build")
	}
	hostname, _ := os.Hostname()
	detail := &windowsOSDetail{Version: runtime.GOOS}
	return windowsAdapterSnapshot{
		Facts: map[string]any{
			"hostname":  hostname,
			"os":        runtime.GOOS,
			"arch":      runtime.GOARCH,
			"osVersion": formatWindowsSystemVersion(detail),
		},
		OS: detail,
	}
}
