//go:build !windows

package main

import "errors"

func runWindowsService(_ string, _ *serviceProgram) error {
	return errors.New("Windows Service 仅支持 Windows 主机")
}

func isInteractiveSession() bool { return false }
