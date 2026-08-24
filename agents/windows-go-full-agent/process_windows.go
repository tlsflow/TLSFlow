package main

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"syscall"
	"unsafe"
)

const processQueryLimitedInformation = 0x1000

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

// windowsProcessCommandLine 只读获取进程命令行。
// 命令行只在本地用于提取配置目录，不进入事实快照，避免泄漏密码、Token 或私钥参数。
func windowsProcessCommandLine(ctx context.Context, pid uint32) string {
	command := exec.CommandContext(ctx, `C:\Windows\System32\wbem\wmic.exe`, "process", "where", fmt.Sprintf("(ProcessId=%d)", pid), "get", "CommandLine", "/value")
	command.Dir = `C:\Windows\System32\wbem`
	output, err := command.Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(line), "commandline=") {
			return strings.TrimSpace(line[len("commandline="):])
		}
	}
	return ""
}
