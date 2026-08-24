package main

import (
	"context"
	"encoding/json"
	"os/exec"
	"strconv"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

const processQueryLimitedInformation = 0x1000

const windowsProcessCommandLineBatchTimeout = 6 * time.Second

var (
	modKernel32Process        = syscall.NewLazyDLL("kernel32.dll")
	procOpenProcess           = modKernel32Process.NewProc("OpenProcess")
	procQueryFullProcessImage = modKernel32Process.NewProc("QueryFullProcessImageNameW")
	procCloseProcessHandle    = modKernel32Process.NewProc("CloseHandle")
)

// windowsProcessExecutablePath 只读取进程镜像路径，不执行进程命令行，避免把敏感参数带回控制面。
func windowsProcessExecutablePath(pid uint32) string {
	handle, _, _ := procOpenProcess.Call(processQueryLimitedInformation, 0, uintptr(pid))
	if handle == 0 {
		return ""
	}
	defer procCloseProcessHandle.Call(handle)
	buffer := make([]uint16, 32768)
	size := uint32(len(buffer))
	result, _, _ := procQueryFullProcessImage.Call(handle, 0, uintptr(unsafe.Pointer(&buffer[0])), uintptr(unsafe.Pointer(&size)))
	if result == 0 || size == 0 {
		return ""
	}
	return syscall.UTF16ToString(buffer[:size])
}

// collectWindowsProcessCommandLines 一次性读取已由监听端口匹配出的进程命令行。
// 只把 PID 作为参数传给固定的 CIM 查询；命令行仅在 Agent 本地用于定位配置，
// 不进入事实快照，避免泄漏密码、Token 或私钥参数，也避免逐进程启动 WMI。
func collectWindowsProcessCommandLines(ctx context.Context, pids []uint32) (map[uint32]string, map[string]any) {
	result := make(map[uint32]string)
	diagnostic := map[string]any{
		"command":        "powershell Get-CimInstance Win32_Process",
		"source":         "windows-process-command-line",
		"success":        true,
		"exitCode":       0,
		"outputLanguage": "unknown",
		"requestedCount": 0,
		"parsedCount":    0,
	}

	uniquePIDs := make([]uint32, 0, len(pids))
	seen := make(map[uint32]struct{}, len(pids))
	for _, pid := range pids {
		if pid == 0 {
			continue
		}
		if _, exists := seen[pid]; exists {
			continue
		}
		seen[pid] = struct{}{}
		uniquePIDs = append(uniquePIDs, pid)
	}
	diagnostic["requestedCount"] = len(uniquePIDs)
	if len(uniquePIDs) == 0 {
		diagnostic["skipped"] = true
		diagnostic["reason"] = "没有需要读取命令行的匹配监听进程"
		return result, diagnostic
	}

	clauses := make([]string, 0, len(uniquePIDs))
	for _, pid := range uniquePIDs {
		clauses = append(clauses, "ProcessId="+strconv.FormatUint(uint64(pid), 10))
	}
	filter := strings.Join(clauses, " OR ")
	script := "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; $records=@(Get-CimInstance -ClassName Win32_Process -Filter " + strconv.Quote(filter) + " | Select-Object ProcessId,CommandLine); if ($records.Count -eq 0) { '[]' } else { $records | ConvertTo-Json -Compress }"
	queryCtx, cancel := context.WithTimeout(ctx, windowsProcessCommandLineBatchTimeout)
	defer cancel()
	command := exec.CommandContext(queryCtx, windowsPowerShellPath, "-NoProfile", "-NonInteractive", "-Command", script)
	command.Dir = windowsSystem32Directory
	command.Env = fixedWindowsEnvironment()
	output, err := command.Output()
	diagnostic = windowsCommandDiagnostic(stringFromMap(diagnostic, "command"), output, err)
	diagnostic["source"] = "windows-process-command-line"
	diagnostic["requestedCount"] = len(uniquePIDs)
	if err != nil {
		return result, diagnostic
	}

	result = parseWindowsProcessCommandLineRecords(output, seen)
	diagnostic["parsedCount"] = len(result)
	return result, diagnostic
}

func parseWindowsProcessCommandLineRecords(output []byte, requested map[uint32]struct{}) map[uint32]string {
	result := make(map[uint32]string)
	for _, record := range parseWindowsJSONRecords(output) {
		pid := uint32(intFromMap(record, "ProcessId"))
		if pid == 0 {
			pid = uint32(intFromMap(record, "processId"))
		}
		commandLine := stringFromMap(record, "CommandLine")
		if commandLine == "" {
			commandLine = stringFromMap(record, "commandLine")
		}
		if pid == 0 || commandLine == "" {
			continue
		}
		if _, allowed := requested[pid]; !allowed {
			continue
		}
		result[pid] = commandLine
	}
	return result
}

// windowsCommandDiagnostic 和 JSON 记录解析是进程采集的通用辅助函数。它们不含
// 框架、站点或证书推断语义，保留在进程模块避免重新引入旧 Web 扫描链。
func windowsCommandDiagnostic(commandName string, output []byte, err error) map[string]any {
	diagnostic := map[string]any{
		"command":        commandName,
		"success":        err == nil,
		"exitCode":       0,
		"outputLanguage": "unknown",
	}
	if err == nil {
		return diagnostic
	}
	diagnostic["exitCode"] = 1
	diagnostic["error"] = err.Error()
	if exitError, ok := err.(*exec.ExitError); ok {
		diagnostic["exitCode"] = exitError.ExitCode()
	}
	return diagnostic
}

func parseWindowsJSONRecords(output []byte) []map[string]any {
	if len(output) == 0 {
		return []map[string]any{}
	}
	var many []map[string]any
	if err := json.Unmarshal(output, &many); err == nil {
		return many
	}
	var single map[string]any
	if err := json.Unmarshal(output, &single); err == nil && len(single) > 0 {
		return []map[string]any{single}
	}
	return []map[string]any{}
}
