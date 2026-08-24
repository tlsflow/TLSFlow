//go:build windows

package main

import (
	"encoding/binary"
	"fmt"
	"strings"
	"syscall"
	"unsafe"
)

const (
	windowsHKEYLocalMachine uintptr = 0x80000002
	windowsKeyQueryValue    uintptr = 0x0001
	windowsKeyWow64_64Key   uintptr = 0x0100
	windowsRegSz            uint32  = 1
	windowsRegExpandSz      uint32  = 2
	windowsRegDword         uint32  = 4
	windowsErrorMoreData    uintptr = 234
)

var (
	windowsAdvapi32       = syscall.NewLazyDLL("advapi32.dll")
	windowsRegOpenKeyExW  = windowsAdvapi32.NewProc("RegOpenKeyExW")
	windowsRegQueryValueW = windowsAdvapi32.NewProc("RegQueryValueExW")
	windowsRegCloseKey    = windowsAdvapi32.NewProc("RegCloseKey")
	windowsRtlGetVersion  = syscall.NewLazyDLL("ntdll.dll").NewProc("RtlGetVersion")
)

// readWindowsOSDetail 只读取 Windows CurrentVersion 固定键，避免注册表扫描和产品识别。
func collectWindowsOSDetail() (*windowsOSDetail, error) {
	detail := &windowsOSDetail{}
	key, err := openWindowsCurrentVersionKey()
	if err == nil {
		defer windowsRegCloseKey.Call(key)
		detail.ProductName = readWindowsRegistryString(key, "ProductName")
		detail.DisplayVersion = readWindowsRegistryString(key, "DisplayVersion")
		detail.ReleaseID = readWindowsRegistryString(key, "ReleaseId")
		detail.CurrentBuild = readWindowsRegistryString(key, "CurrentBuild")
		if detail.CurrentBuild == "" {
			detail.CurrentBuild = readWindowsRegistryString(key, "CurrentBuildNumber")
		}
		if ubr, ok := readWindowsRegistryDword(key, "UBR"); ok && detail.CurrentBuild != "" {
			detail.BuildRevision = fmt.Sprintf("%s.%d", detail.CurrentBuild, ubr)
		}
	}

	detail.Version = readWindowsKernelVersion()
	if formatWindowsSystemVersion(detail) == "" {
		if err != nil {
			return nil, fmt.Errorf("读取 Windows 版本注册表失败: %w", err)
		}
		return nil, fmt.Errorf("Windows 版本事实为空")
	}
	return detail, nil
}

func openWindowsCurrentVersionKey() (uintptr, error) {
	path, err := syscall.UTF16PtrFromString(`SOFTWARE\Microsoft\Windows NT\CurrentVersion`)
	if err != nil {
		return 0, err
	}
	var key uintptr
	status, _, _ := windowsRegOpenKeyExW.Call(
		windowsHKEYLocalMachine,
		uintptr(unsafe.Pointer(path)),
		0,
		windowsKeyQueryValue|windowsKeyWow64_64Key,
		uintptr(unsafe.Pointer(&key)),
	)
	if status != 0 {
		return 0, fmt.Errorf("RegOpenKeyExW status=0x%x", status)
	}
	return key, nil
}

func readWindowsRegistryString(key uintptr, name string) string {
	valueType, data, err := readWindowsRegistryValue(key, name)
	if err != nil || (valueType != windowsRegSz && valueType != windowsRegExpandSz) {
		return ""
	}
	return strings.TrimSpace(windowsUTF16BytesToString(data))
}

func readWindowsRegistryDword(key uintptr, name string) (uint32, bool) {
	valueType, data, err := readWindowsRegistryValue(key, name)
	if err != nil || valueType != windowsRegDword || len(data) < 4 {
		return 0, false
	}
	return binary.LittleEndian.Uint32(data[:4]), true
}

func readWindowsRegistryValue(key uintptr, name string) (uint32, []byte, error) {
	valueName, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return 0, nil, err
	}
	var valueType uint32
	var size uint32
	status, _, _ := windowsRegQueryValueW.Call(
		key,
		uintptr(unsafe.Pointer(valueName)),
		0,
		uintptr(unsafe.Pointer(&valueType)),
		0,
		uintptr(unsafe.Pointer(&size)),
	)
	if status != 0 && status != windowsErrorMoreData {
		return 0, nil, fmt.Errorf("RegQueryValueExW size status=0x%x", status)
	}
	data := make([]byte, size)
	var dataPtr uintptr
	if len(data) > 0 {
		dataPtr = uintptr(unsafe.Pointer(&data[0]))
	}
	status, _, _ = windowsRegQueryValueW.Call(
		key,
		uintptr(unsafe.Pointer(valueName)),
		0,
		uintptr(unsafe.Pointer(&valueType)),
		dataPtr,
		uintptr(unsafe.Pointer(&size)),
	)
	if status != 0 {
		return 0, nil, fmt.Errorf("RegQueryValueExW data status=0x%x", status)
	}
	if size > uint32(len(data)) {
		return 0, nil, fmt.Errorf("RegQueryValueExW returned an invalid size: %d", size)
	}
	return valueType, data[:size], nil
}

func windowsUTF16BytesToString(data []byte) string {
	if len(data) < 2 {
		return ""
	}
	values := make([]uint16, len(data)/2)
	for index := range values {
		values[index] = binary.LittleEndian.Uint16(data[index*2:])
	}
	return syscall.UTF16ToString(values)
}

func readWindowsKernelVersion() string {
	var info windowsRTLVersionInfo
	info.Size = uint32(unsafe.Sizeof(info))
	status, _, _ := windowsRtlGetVersion.Call(uintptr(unsafe.Pointer(&info)))
	if status != 0 {
		return ""
	}
	return fmt.Sprintf("%d.%d.%d", info.Major, info.Minor, info.Build)
}

type windowsRTLVersionInfo struct {
	Size           uint32
	Major          uint32
	Minor          uint32
	Build          uint32
	PlatformID     uint32
	ServicePack    [128]uint16
	ServicePackLen uint16
	SuiteMask      uint16
	ProductType    byte
	Reserved       byte
}
