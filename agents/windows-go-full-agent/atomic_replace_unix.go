//go:build !windows

package main

import "os"

func replaceAtomicFile(temporaryPath, targetPath string) error {
	if err := os.Rename(temporaryPath, targetPath); err != nil {
		_ = os.Remove(temporaryPath)
		return err
	}
	return nil
}
