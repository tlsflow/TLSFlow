//go:build !windows

package main

import "runtime"

// 非 Windows 构建只用于静态检查；真实版本事实由 Windows 实现提供。
func collectWindowsOSDetail() (*windowsOSDetail, error) {
	return &windowsOSDetail{Version: runtime.GOOS}, nil
}
