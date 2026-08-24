package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	pluginVersion = "1.0.0"
	maxLineBytes  = 4 * 1024 * 1024
)

type request struct {
	Operation string         `json:"operation"`
	Payload   map[string]any `json:"payload,omitempty"`
}

type response struct {
	Success   bool           `json:"success"`
	Operation string         `json:"operation,omitempty"`
	Inventory map[string]any `json:"inventory,omitempty"`
	Detail    map[string]any `json:"detail,omitempty"`
	ErrorCode string         `json:"errorCode,omitempty"`
	Error     string         `json:"error,omitempty"`
}

func main() {
	if hasArg("--version") {
		fmt.Printf("web.iis-agent-side-plugin %s runtime=go toolchain=go1.20\n", pluginVersion)
		return
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetEscapeHTML(false)
	scanner := bufio.NewScanner(os.Stdin)
	scanner.Buffer(make([]byte, 64*1024), maxLineBytes)
	for scanner.Scan() {
		line := strings.TrimPrefix(scanner.Text(), "\ufeff")
		if len(line) == 0 {
			continue
		}
		var req request
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			writePluginResponse(encoder, response{Success: false, ErrorCode: "INVALID_JSON", Error: "Agent-side 请求 JSON 无效"})
			continue
		}
		writePluginResponse(encoder, handle(req))
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, io.EOF) {
		fmt.Fprintln(os.Stderr, "Agent-side 输入读取失败:", redact(err.Error()))
		os.Exit(2)
	}
}

func handle(req request) response {
	switch strings.ToLower(strings.TrimSpace(req.Operation)) {
	case "discover":
		inventory, err := discoverInventory()
		if err != nil {
			return response{Success: false, Operation: req.Operation, ErrorCode: "IIS_DISCOVERY_FAILED", Error: redact(err.Error())}
		}
		return response{Success: true, Operation: req.Operation, Inventory: inventory}
	case "capture-binding", "verify-binding", "update-binding", "rollback-binding":
		return response{Success: false, Operation: req.Operation, ErrorCode: "IIS_OPERATION_REQUIRES_AGENT_V2_PLAN", Error: "IIS 绑定操作必须由 Agent v2 授权计划驱动"}
	default:
		return response{Success: false, Operation: req.Operation, ErrorCode: "OPERATION_NOT_REGISTERED", Error: "Agent-side Operation 未登记"}
	}
}

func discoverInventory() (map[string]any, error) {
	executable, err := os.Executable()
	if err != nil {
		return nil, err
	}
	scannerPath := filepath.Join(filepath.Dir(executable), "windows-runtime-discovery.exe")
	if _, err := os.Stat(scannerPath); err != nil {
		return nil, fmt.Errorf("Windows runtime discovery scanner 不存在: %w", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, scannerPath)
	command.Stdin = strings.NewReader(`{"operation":"discover"}` + "\n")
	output, err := command.Output()
	if err != nil {
		return nil, fmt.Errorf("Windows runtime discovery scanner 执行失败: %w", err)
	}
	var result struct {
		Success   bool           `json:"success"`
		Inventory map[string]any `json:"inventory"`
		Error     string         `json:"error"`
	}
	if err := json.Unmarshal(output, &result); err != nil {
		return nil, fmt.Errorf("解析 Windows runtime discovery 结果失败: %w", err)
	}
	if !result.Success || result.Inventory == nil {
		return nil, errors.New(firstNonEmpty(result.Error, "Windows runtime discovery 未返回库存"))
	}
	return result.Inventory, nil
}

func writePluginResponse(encoder *json.Encoder, value response) {
	if err := encoder.Encode(value); err != nil {
		fmt.Fprintln(os.Stderr, "Agent-side 结果写入失败:", redact(err.Error()))
		os.Exit(2)
	}
}

func hasArg(expected string) bool {
	for _, arg := range os.Args[1:] {
		if arg == expected {
			return true
		}
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return "unknown"
}

func redact(value string) string {
	value = strings.NewReplacer("\r", " ", "\n", " ").Replace(value)
	for _, secret := range []string{"password", "secret", "token", "privateKey"} {
		value = strings.ReplaceAll(value, secret, "[REDACTED]")
	}
	return value
}
