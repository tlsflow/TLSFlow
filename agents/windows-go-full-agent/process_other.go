//go:build !windows

package main

import "context"

func windowsProcessExecutablePath(_ uint32) string { return "" }

func collectWindowsProcessCommandLines(_ context.Context, _ []uint32) (map[uint32]string, map[string]any) {
	return map[uint32]string{}, map[string]any{"source": "windows-process-command-line", "success": false, "skipped": true, "reason": "非 Windows 主机"}
}
