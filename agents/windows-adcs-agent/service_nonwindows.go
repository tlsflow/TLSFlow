//go:build !windows

package main

import (
	"errors"
)

// 非 Windows 构建只用于本地测试和 Windows 交叉编译检查，不能伪装成本机服务运行。
func runWindowsService(_ string, _ *AgentConfig) error {
	return errors.New("Windows AD CS Agent 服务入口只能在 Windows 上运行")
}

func writeAdcsServiceLog(_ *AgentConfig, _ string) {}
