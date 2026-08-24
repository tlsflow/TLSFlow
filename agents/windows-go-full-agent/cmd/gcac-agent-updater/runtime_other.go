//go:build !windows

package main

import "errors"

func ensureWindowsRuntime() error {
	return errors.New("Windows Agent 升级器只能运行在 Windows")
}
