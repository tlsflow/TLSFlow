package main

import (
	"errors"
	"fmt"
	"os"
)

const migrationMessage = "gcac-adcs-agent 已停用：该未发布的旧 ADCS Agent 不再提供兼容执行能力，请迁移到 Plugin Runner/Agent v2。"

// startupError 是唯一的运行时行为：旧程序必须拒绝启动，避免误执行已退役协议或业务。
func startupError() error {
	return errors.New(migrationMessage)
}

func main() {
	if err := startupError(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
