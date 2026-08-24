package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
)

const windowsRuntimeDiscoveryOperation = "discover"

type windowsRuntimeDiscoveryResponse struct {
	Success   bool           `json:"success"`
	Operation string         `json:"operation"`
	Inventory map[string]any `json:"inventory,omitempty"`
	Error     string         `json:"error,omitempty"`
}

// collectWindowsMatureWebInventory 只负责调用固定的 Agent-side Plugin。
// 产品解析、证书绑定和配置语法不进入 Agent Core；进程异常时返回显式的空快照。
func collectWindowsMatureWebInventory(ctx context.Context, logger *runtimeLogger) map[string]any {
	inventory := emptyWindowsWebInventory()
	pluginPath, err := resolveWindowsRuntimeDiscoveryPlugin()
	if err != nil {
		inventory["warnings"] = []map[string]any{{"code": "AGENT_SIDE_PLUGIN_UNAVAILABLE", "message": err.Error()}}
		if logger != nil {
			logger.Warn("Windows Agent-side 发现进程不可用: %v", err)
		}
		return inventory
	}

	request, err := json.Marshal(map[string]string{"operation": windowsRuntimeDiscoveryOperation})
	if err != nil {
		inventory["warnings"] = []map[string]any{{"code": "AGENT_SIDE_REQUEST_FAILED", "message": "发现请求编码失败"}}
		return inventory
	}
	command := exec.CommandContext(ctx, pluginPath)
	command.Stdin = jsonReader(request)
	output, err := command.Output()
	if err != nil {
		inventory["warnings"] = []map[string]any{{"code": "AGENT_SIDE_PLUGIN_FAILED", "message": "发现进程执行失败"}}
		if logger != nil {
			logger.Warn("Windows Agent-side 发现进程执行失败: %v", err)
		}
		return inventory
	}

	var response windowsRuntimeDiscoveryResponse
	if err := json.Unmarshal(output, &response); err != nil {
		inventory["warnings"] = []map[string]any{{"code": "AGENT_SIDE_RESPONSE_INVALID", "message": "发现进程返回 JSON 无效"}}
		return inventory
	}
	if !response.Success || response.Operation != windowsRuntimeDiscoveryOperation || response.Inventory == nil {
		inventory["warnings"] = []map[string]any{{"code": "AGENT_SIDE_DISCOVERY_FAILED", "message": response.Error}}
		return inventory
	}
	if response.Inventory["scope"] != fullWebDiscoveryScope {
		inventory["warnings"] = []map[string]any{{"code": "AGENT_SIDE_SCOPE_INVALID", "message": "发现进程未返回完整 Web 快照"}}
		return inventory
	}
	return response.Inventory
}

func resolveWindowsRuntimeDiscoveryPlugin() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", errors.New("无法确定 Agent 安装目录")
	}
	pluginPath := filepath.Join(filepath.Dir(executable), "plugins", "windows-runtime-discovery.exe")
	if _, err := os.Stat(pluginPath); err != nil {
		return "", errors.New("Windows Agent-side 发现进程未随 Agent 安装")
	}
	return pluginPath, nil
}

func jsonReader(value []byte) io.Reader {
	return &staticReader{value: append(value, '\n')}
}

type staticReader struct {
	value []byte
	index int
}

func (reader *staticReader) Read(target []byte) (int, error) {
	if reader.index >= len(reader.value) {
		return 0, io.EOF
	}
	count := copy(target, reader.value[reader.index:])
	reader.index += count
	return count, nil
}

func emptyWindowsWebInventory() map[string]any {
	return map[string]any{
		"scope":            fullWebDiscoveryScope,
		"frameworks":       []map[string]any{},
		"sites":            []map[string]any{},
		"certificateFiles": []map[string]any{},
		"configFiles":      []map[string]any{},
		"warnings":         []map[string]any{},
		"diagnostics": map[string]any{
			"scanner": "windows-runtime-discovery",
			"source":  "agent-side-plugin",
		},
	}
}
