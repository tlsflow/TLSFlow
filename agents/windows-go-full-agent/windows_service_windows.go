//go:build windows

package main

import (
	"context"
	"errors"
	"fmt"
	"syscall"
	"unsafe"
)

var (
	modAdvapi32                    = syscall.NewLazyDLL("advapi32.dll")
	procStartServiceCtrlDispatcher = modAdvapi32.NewProc("StartServiceCtrlDispatcherW")
	procRegisterServiceCtrlHandler = modAdvapi32.NewProc("RegisterServiceCtrlHandlerExW")
	procSetServiceStatus           = modAdvapi32.NewProc("SetServiceStatus")
	procGetConsoleWindow           = syscall.NewLazyDLL("kernel32.dll").NewProc("GetConsoleWindow")
	activeWindowsService           *windowsService
)

const (
	serviceWin32OwnProcess       = 0x00000010
	serviceStartPending          = 0x00000002
	serviceStopPending           = 0x00000003
	serviceRunning               = 0x00000004
	serviceStopped               = 0x00000001
	serviceAcceptStop            = 0x00000001
	serviceAcceptShutdown        = 0x00000004
	serviceControlStop           = 0x00000001
	serviceControlInterrogate    = 0x00000004
	serviceControlShutdown       = 0x00000005
	noError                      = 0x00000000
	errorFailedServiceController = 1063
)

func runWindowsService(name string, program *serviceProgram) error {
	ctx, cancel := context.WithCancel(context.Background())
	service := &windowsService{
		name: name, logPath: program.logPath,
		run: func(runCtx context.Context) error { return runForeground(runCtx, program.configPath) },
		ctx: ctx, cancel: cancel, done: make(chan error, 1),
		status: serviceStatus{serviceType: serviceWin32OwnProcess},
	}
	activeWindowsService = service
	serviceNamePtr, err := syscall.UTF16PtrFromString(name)
	if err != nil { return err }
	table := []serviceTableEntry{{serviceName: serviceNamePtr, serviceProc: syscall.NewCallback(serviceMain)}, {}}
	ret, _, callErr := procStartServiceCtrlDispatcher.Call(uintptr(unsafe.Pointer(&table[0])))
	if ret == 0 {
		if errno, ok := callErr.(syscall.Errno); ok && errno == errorFailedServiceController {
			return errors.New("当前进程不是由 SCM 启动的 Windows Service 进程")
		}
		return fmt.Errorf("StartServiceCtrlDispatcherW 失败: %v", callErr)
	}
	return <-service.done
}

func serviceMain(argc uint32, argv uintptr) uintptr {
	_ = argc; _ = argv
	service := activeWindowsService
	if service == nil { return 0 }
	namePtr, err := syscall.UTF16PtrFromString(service.name)
	if err != nil { service.done <- err; return 0 }
	handler, _, callErr := procRegisterServiceCtrlHandler.Call(uintptr(unsafe.Pointer(namePtr)), syscall.NewCallback(serviceControlHandler), 0)
	if handler == 0 { service.done <- fmt.Errorf("RegisterServiceCtrlHandlerExW 失败: %v", callErr); return 0 }
	service.handle = serviceStatusHandle(handler)
	service.setStatus(serviceStatus{serviceType: serviceWin32OwnProcess, currentState: serviceStartPending, waitHint: 15000})
	go func() {
		runErr := service.run(service.ctx)
		if runErr != nil {
			writeServiceLog(service.logPath, fmt.Sprintf("service runtime exited with error: %v", runErr))
			service.setStatus(serviceStatus{serviceType: serviceWin32OwnProcess, currentState: serviceStopped, win32ExitCode: 1})
			service.done <- runErr
			return
		}
		service.setStatus(serviceStatus{serviceType: serviceWin32OwnProcess, currentState: serviceStopped})
		service.done <- nil
	}()
	service.setStatus(serviceStatus{serviceType: serviceWin32OwnProcess, currentState: serviceRunning, controlsAccepted: serviceAcceptStop | serviceAcceptShutdown})
	<-service.ctx.Done()
	return 0
}

func serviceControlHandler(control, eventType, eventData, context uintptr) uintptr {
	_ = eventType; _ = eventData; _ = context
	service := activeWindowsService
	if service == nil { return noError }
	switch uint32(control) {
	case serviceControlInterrogate:
		return noError
	case serviceControlStop, serviceControlShutdown:
		service.setStatus(serviceStatus{serviceType: serviceWin32OwnProcess, currentState: serviceStopPending, waitHint: 15000})
		service.cancel()
	}
	return noError
}

func (s *windowsService) setStatus(status serviceStatus) {
	s.statusMu.Lock(); defer s.statusMu.Unlock()
	s.status = status
	if s.handle != 0 { _, _, _ = procSetServiceStatus.Call(uintptr(s.handle), uintptr(unsafe.Pointer(&s.status))) }
}

func isInteractiveSession() bool { ret, _, _ := procGetConsoleWindow.Call(); return ret != 0 }
