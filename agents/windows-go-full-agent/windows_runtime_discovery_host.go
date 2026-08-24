package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// windowsRuntimeDiscoveryHost 只执行固定的本机只读查询，供成熟扫描器读取
// 运行进程、服务参数和有效配置入口。它不是通用命令执行入口。
type windowsRuntimeDiscoveryHost struct {
	ctx     context.Context
	timeout time.Duration
}

func (h windowsRuntimeDiscoveryHost) runPowerShellJSON(script string, target any) error {
	output, err := h.runPowerShell(script)
	if err != nil {
		return err
	}
	if err := json.Unmarshal([]byte(output), target); err != nil {
		return fmt.Errorf("Windows 运行态查询 JSON 解析失败: %w", err)
	}
	return nil
}

func (h windowsRuntimeDiscoveryHost) runPowerShell(script string) (string, error) {
	ctx := h.ctx
	if ctx == nil {
		ctx = context.Background()
	}
	timeout := h.timeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	queryCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	utf8Script := "$utf8 = New-Object System.Text.UTF8Encoding($false); [Console]::OutputEncoding = $utf8; $OutputEncoding = $utf8; " + script
	command := exec.CommandContext(queryCtx, windowsPowerShellPath, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", utf8Script)
	command.Dir = windowsSystem32Directory
	command.Env = fixedWindowsEnvironment()
	output, err := command.Output()
	if err != nil {
		if queryCtx.Err() != nil {
			return "", queryCtx.Err()
		}
		return "", fmt.Errorf("Windows 运行态只读查询失败: %w", err)
	}
	return strings.TrimSpace(string(output)), nil
}

func (h windowsRuntimeDiscoveryHost) inspectWindowsServiceRegistryArgs(serviceName string) ([]string, error) {
	serviceName = strings.TrimSpace(serviceName)
	if serviceName == "" {
		return nil, nil
	}
	script := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
$serviceName = %s
try {
  $properties = Get-ItemProperty -LiteralPath ("Registry::HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\" + $serviceName + "\Parameters") -ErrorAction Stop
  $values = @()
  if ($properties.PSObject.Properties.Name -contains 'ConfigArgs') {
    foreach ($value in @($properties.ConfigArgs)) {
      if (-not [string]::IsNullOrWhiteSpace([string]$value)) { $values += [string]$value }
    }
  }
  @($values) | ConvertTo-Json -Depth 4 -Compress
} catch {
  @() | ConvertTo-Json -Depth 4 -Compress
}
`, windowsRuntimePowerShellQuoted(serviceName))

	var values []string
	if err := h.runPowerShellJSON(script, &values); err == nil {
		return values, nil
	}
	var single string
	if err := h.runPowerShellJSON(script, &single); err == nil && strings.TrimSpace(single) != "" {
		return []string{strings.TrimSpace(single)}, nil
	}
	return nil, fmt.Errorf("无法读取服务注册表参数: %s", serviceName)
}

func windowsRuntimePowerShellQuoted(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
