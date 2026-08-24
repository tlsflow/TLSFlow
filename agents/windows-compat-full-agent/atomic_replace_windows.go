//go:build windows

package main

import (
	"fmt"
	"os"
	"syscall"
	"unsafe"
)

var (
	modKernel32      = syscall.NewLazyDLL("kernel32.dll")
	procReplaceFileW = modKernel32.NewProc("ReplaceFileW")
	procMoveFileExW  = modKernel32.NewProc("MoveFileExW")
)

const (
	replaceFileWriteThrough = 0x00000001
	moveFileReplaceExisting = 0x00000001
	moveFileWriteThrough    = 0x00000008
)

func replaceAtomicFile(temporaryPath, targetPath string) error {
	temporary, err := syscall.UTF16PtrFromString(temporaryPath)
	if err != nil {
		_ = os.Remove(temporaryPath)
		return err
	}
	target, err := syscall.UTF16PtrFromString(targetPath)
	if err != nil {
		_ = os.Remove(temporaryPath)
		return err
	}

	// ReplaceFileW 在目标已存在时保持替换动作的原子性，避免“先删除旧文件、
	// 再重命名临时文件”的窗口。Windows API 失败时不会声称替换已经完成，
	// 因而这类错误是确定性 FAILED，而不是写入结果 UNKNOWN。
	result, _, replaceErr := procReplaceFileW.Call(
		uintptr(unsafe.Pointer(target)),
		uintptr(unsafe.Pointer(temporary)),
		0,
		replaceFileWriteThrough,
		0,
		0,
	)
	if result != 0 {
		return nil
	}
	if replaceErr == nil {
		replaceErr = syscall.GetLastError()
	}

	// 首次写入时目标可能不存在，回退到同样要求写穿的 MoveFileExW。
	if result, _, moveErr := procMoveFileExW.Call(
		uintptr(unsafe.Pointer(temporary)),
		uintptr(unsafe.Pointer(target)),
		moveFileReplaceExisting|moveFileWriteThrough,
	); result != 0 {
		return nil
	} else {
		_ = os.Remove(temporaryPath)
		if moveErr == nil {
			moveErr = syscall.GetLastError()
		}
		return fmt.Errorf("ReplaceFileW failed: %v; MoveFileExW failed: %v", replaceErr, moveErr)
	}
}
