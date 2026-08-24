package main

import (
	"os"
	"path/filepath"
	"strings"
	"time"
)

// probeSudoNoPassword 只验证非交互 sudo 是否可用，不执行任何产品命令。
func probeSudoNoPassword() (bool, map[string]any) {
	if os.Geteuid() == 0 {
		return false, map[string]any{
			"available": false,
			"skipped":   true,
			"reason":    "already running as root",
		}
	}
	if !lookPath("sudo") {
		return false, map[string]any{
			"available": false,
			"reason":    "sudo is not installed",
		}
	}
	result, err := executeCommand([]string{"sudo", "-n", "true"}, false, 5*time.Second, false)
	available := err == nil && result != nil && result.Success
	detail := map[string]any{"available": available, "nonInteractive": available}
	if err != nil {
		detail["error"] = err.Error()
	}
	return available, detail
}

// inspectNginxBindingPermission 仅采集文件与命令可达性，禁止在发现阶段执行测试或 reload。
func inspectNginxBindingPermission(binding nginxBindingDetail, testCommand string, reloadCommand string) map[string]any {
	isRoot := os.Geteuid() == 0
	sudoAvailable, sudoDetail := probeSudoNoPassword()
	certState := inspectDiscoveryPath(binding.CertificatePath)
	keyState := inspectDiscoveryPath(binding.CertificateKeyPath)
	directWriteReady := discoveryPathWritable(certState) && discoveryPathWritable(keyState)

	privilegeMode := "unavailable"
	switch {
	case isRoot:
		privilegeMode = "root"
	case directWriteReady:
		privilegeMode = "direct"
	case sudoAvailable:
		privilegeMode = "sudo-n"
	}

	return map[string]any{
		"certPath":            certState,
		"keyPath":             keyState,
		"sudo":                sudoDetail,
		"testCommand":         inspectDiscoveryCommand(testCommand),
		"reloadCommand":       inspectDiscoveryCommand(reloadCommand),
		"privilegeMode":       privilegeMode,
		"helperRequired":      privilegeMode == "unavailable",
		"nonInteractiveReady": privilegeMode != "unavailable",
	}
}

func inspectDiscoveryPath(rawPath string) map[string]any {
	path := filepath.Clean(strings.TrimSpace(rawPath))
	if strings.TrimSpace(rawPath) == "" {
		return map[string]any{"path": "", "exists": false, "readable": false, "writable": false}
	}
	parent := filepath.Dir(path)
	return map[string]any{
		"path":              path,
		"exists":            fileExists(path),
		"readable":          canReadPath(path),
		"writable":          canWritePath(path),
		"parentDir":         parent,
		"parentDirExists":   fileExists(parent),
		"parentDirWritable": canWriteDir(parent),
	}
}

func discoveryPathWritable(state map[string]any) bool {
	exists, _ := state["exists"].(bool)
	if exists {
		writable, _ := state["writable"].(bool)
		return writable
	}
	parentWritable, _ := state["parentDirWritable"].(bool)
	return parentWritable
}

func inspectDiscoveryCommand(command string) map[string]any {
	trimmed := strings.TrimSpace(command)
	parts := strings.Fields(trimmed)
	available := len(parts) > 0 && (lookPath(parts[0]) || fileExists(parts[0]))
	return map[string]any{
		"command":             trimmed,
		"executableAvailable": available,
		"executed":            false,
	}
}
