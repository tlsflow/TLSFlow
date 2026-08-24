package main

import (
	"os"
	"runtime"
)

// windowsAdapterSnapshot 只承载 Agent Core 可以理解的原始主机事实。
// 第三方产品识别、配置解析和部署语义必须由插件负责。
type windowsAdapterSnapshot struct {
	Facts map[string]any `json:"facts"`
}

func collectWindowsAdapterSnapshot(logger *runtimeLogger) windowsAdapterSnapshot {
	if logger != nil {
		logger.Info("collecting generic Windows host facts")
	}
	hostname, _ := os.Hostname()
	return windowsAdapterSnapshot{Facts: map[string]any{
		"hostname": hostname,
		"os":       runtime.GOOS,
		"arch":     runtime.GOARCH,
	}}
}
