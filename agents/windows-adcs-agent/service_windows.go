//go:build windows

package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"unsafe"
)

type adcsWindowsService struct {
	name   string
	config *AgentConfig
	ctx    context.Context
	cancel context.CancelFunc
	done   chan error
	handle uintptr
	status adcsServiceStatus
}

type adcsServiceTableEntry struct {
	serviceName *uint16
	serviceProc uintptr
}

type adcsServiceStatus struct {
	serviceType             uint32
	currentState            uint32
	controlsAccepted        uint32
	win32ExitCode           uint32
	serviceSpecificExitCode uint32
	checkPoint              uint32
	waitHint                uint32
}

var (
	adcsAdvapi32                   = syscall.NewLazyDLL("advapi32.dll")
	adcsStartServiceCtrlDispatcher = adcsAdvapi32.NewProc("StartServiceCtrlDispatcherW")
	adcsRegisterServiceCtrlHandler = adcsAdvapi32.NewProc("RegisterServiceCtrlHandlerExW")
	adcsSetServiceStatus           = adcsAdvapi32.NewProc("SetServiceStatus")
	activeAdcsWindowsService       *adcsWindowsService
)

const (
	adcsServiceWin32OwnProcess       = 0x00000010
	adcsServiceStartPending          = 0x00000002
	adcsServiceStopPending           = 0x00000003
	adcsServiceRunning               = 0x00000004
	adcsServiceStopped               = 0x00000001
	adcsServiceAcceptStop            = 0x00000001
	adcsServiceAcceptShutdown        = 0x00000004
	adcsServiceControlStop           = 0x00000001
	adcsServiceControlInterrogate    = 0x00000004
	adcsServiceControlShutdown       = 0x00000005
	adcsServiceNoError               = 0x00000000
	adcsErrorFailedServiceController = 1063
)

func runWindowsService(name string, config *AgentConfig) error {
	if name == "" {
		name = "GCACWindowsAdcsAgent"
	}
	ctx, cancel := context.WithCancel(context.Background())
	service := &adcsWindowsService{name: name, config: config, ctx: ctx, cancel: cancel, done: make(chan error, 1)}
	activeAdcsWindowsService = service
	namePtr, err := syscall.UTF16PtrFromString(name)
	if err != nil {
		return err
	}
	table := []adcsServiceTableEntry{{serviceName: namePtr, serviceProc: syscall.NewCallback(adcsServiceMain)}, {}}
	ret, _, callErr := adcsStartServiceCtrlDispatcher.Call(uintptr(unsafe.Pointer(&table[0])))
	if ret == 0 {
		if errno, ok := callErr.(syscall.Errno); ok && errno == adcsErrorFailedServiceController {
			return errors.New("当前进程不是由 SCM 启动的 Windows Service 进程")
		}
		return fmt.Errorf("StartServiceCtrlDispatcherW 失败: %v", callErr)
	}
	return <-service.done
}

func adcsServiceMain(_ uint32, _ uintptr) uintptr {
	service := activeAdcsWindowsService
	if service == nil {
		return 0
	}
	namePtr, err := syscall.UTF16PtrFromString(service.name)
	if err != nil {
		service.done <- err
		return 0
	}
	handler, _, callErr := adcsRegisterServiceCtrlHandler.Call(uintptr(unsafe.Pointer(namePtr)), syscall.NewCallback(adcsServiceControlHandler), 0)
	if handler == 0 {
		service.done <- fmt.Errorf("RegisterServiceCtrlHandlerExW 失败: %v", callErr)
		return 0
	}
	service.handle = handler
	service.setStatus(adcsServiceStatus{serviceType: adcsServiceWin32OwnProcess, currentState: adcsServiceStartPending, waitHint: 15000})
	go func() {
		defer service.cancel()
		runErr := runAgentContext(service.ctx, service.config)
		if runErr != nil {
			writeAdcsServiceLog(service.config, runErr.Error())
			service.setStatus(adcsServiceStatus{serviceType: adcsServiceWin32OwnProcess, currentState: adcsServiceStopped, win32ExitCode: 1})
			service.done <- runErr
			return
		}
		service.setStatus(adcsServiceStatus{serviceType: adcsServiceWin32OwnProcess, currentState: adcsServiceStopped, win32ExitCode: adcsServiceNoError})
		service.done <- nil
	}()
	service.setStatus(adcsServiceStatus{serviceType: adcsServiceWin32OwnProcess, currentState: adcsServiceRunning, controlsAccepted: adcsServiceAcceptStop | adcsServiceAcceptShutdown, win32ExitCode: adcsServiceNoError})
	<-service.ctx.Done()
	return 0
}

func adcsServiceControlHandler(control, _, _, _ uintptr) uintptr {
	service := activeAdcsWindowsService
	if service == nil {
		return adcsServiceNoError
	}
	switch uint32(control) {
	case adcsServiceControlInterrogate:
		return adcsServiceNoError
	case adcsServiceControlStop, adcsServiceControlShutdown:
		service.setStatus(adcsServiceStatus{serviceType: adcsServiceWin32OwnProcess, currentState: adcsServiceStopPending, waitHint: 15000})
		service.cancel()
	}
	return adcsServiceNoError
}

func (service *adcsWindowsService) setStatus(status adcsServiceStatus) {
	service.status = status
	if service.handle != 0 {
		_, _, _ = adcsSetServiceStatus.Call(service.handle, uintptr(unsafe.Pointer(&service.status)))
	}
}

func writeAdcsServiceLog(config *AgentConfig, message string) {
	if config == nil {
		return
	}
	path := filepath.Join(config.Paths.Windows.LogDir, "agent.log")
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = fmt.Fprintf(file, "%s\n", message)
}
