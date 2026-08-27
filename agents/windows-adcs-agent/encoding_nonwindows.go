//go:build !windows

package main

// 非 Windows 构建只用于测试和交叉编译检查；本机没有 Windows ACP/OEMCP。
func decodeWindowsCommandOutput(value []byte) string {
	return string(value)
}
