//go:build windows

package main

import "os"

func replaceAtomicFile(temporaryPath, targetPath string) error {
	if err := os.Rename(temporaryPath, targetPath); err == nil {
		return nil
	}
	// Windows 不允许 Rename 覆盖已存在文件；删除旧状态后立即重命名，
	// 避免升级状态在第二次写入时被错误判定为不可恢复。
	if err := os.Remove(targetPath); err != nil && !os.IsNotExist(err) {
		_ = os.Remove(temporaryPath)
		return err
	}
	if err := os.Rename(temporaryPath, targetPath); err != nil {
		_ = os.Remove(temporaryPath)
		return err
	}
	return nil
}
