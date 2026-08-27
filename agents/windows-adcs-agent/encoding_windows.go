//go:build windows

package main

import (
	"syscall"
	"unicode/utf16"
	"unicode/utf8"
	"unsafe"
)

var (
	adcsKernel32            = syscall.NewLazyDLL("kernel32.dll")
	adcsGetACP              = adcsKernel32.NewProc("GetACP")
	adcsGetOEMCP            = adcsKernel32.NewProc("GetOEMCP")
	adcsMultiByteToWideChar = adcsKernel32.NewProc("MultiByteToWideChar")
)

const adcsMbErrInvalidChars = 0x00000008

// decodeWindowsCommandOutput 将 Windows 原生命令的 ACP/OEMCP 字节转换为
// Go 内部使用的 UTF-8 字符串。certutil、certreq、sc.exe 在服务进程中
// 经常不会输出 UTF-8，直接把 stdout 当 UTF-8 会把中文变成“����”。
func decodeWindowsCommandOutput(value []byte) string {
	if len(value) == 0 {
		return ""
	}
	decoded := decodeAdcsCommandOutput(string(value))
	if decoded != string(value) {
		return decoded
	}
	if utf8.Valid(value) {
		return string(value)
	}
	for _, codePage := range []uint32{windowsCodePage(adcsGetACP), windowsCodePage(adcsGetOEMCP)} {
		if decoded, ok := decodeWindowsCodePage(value, codePage); ok {
			return decoded
		}
	}
	return string(value)
}

func windowsCodePage(proc *syscall.LazyProc) uint32 {
	if proc == nil {
		return 0
	}
	value, _, _ := proc.Call()
	return uint32(value)
}

func decodeWindowsCodePage(value []byte, codePage uint32) (string, bool) {
	if codePage == 0 || len(value) == 0 {
		return "", false
	}
	source := uintptr(unsafe.Pointer(&value[0]))
	size, _, _ := adcsMultiByteToWideChar.Call(
		uintptr(codePage),
		adcsMbErrInvalidChars,
		source,
		uintptr(len(value)),
		0,
		0,
	)
	if size == 0 {
		return "", false
	}
	buffer := make([]uint16, int(size))
	converted, _, _ := adcsMultiByteToWideChar.Call(
		uintptr(codePage),
		adcsMbErrInvalidChars,
		source,
		uintptr(len(value)),
		uintptr(unsafe.Pointer(&buffer[0])),
		size,
	)
	if converted == 0 {
		return "", false
	}
	return string(utf16.Decode(buffer[:converted])), true
}
