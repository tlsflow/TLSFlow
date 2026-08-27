//go:build !windows

package main

import (
	"errors"
	"fmt"
	"os"
	"syscall"
)

type atomicFileMetadata struct {
	mode          os.FileMode
	uid           int
	gid           int
	preserveOwner bool
}

func readAtomicFileMetadata(path string) (atomicFileMetadata, error) {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return atomicFileMetadata{mode: 0o600}, nil
	}
	if err != nil {
		return atomicFileMetadata{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return atomicFileMetadata{}, errors.New("atomic replace refuses symbolic link targets")
	}
	if !info.Mode().IsRegular() {
		return atomicFileMetadata{}, errors.New("atomic replace refuses non-regular targets")
	}

	metadata := atomicFileMetadata{mode: info.Mode().Perm()}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return atomicFileMetadata{}, errors.New("atomic replace cannot inspect target ownership")
	}
	metadata.uid = int(stat.Uid)
	metadata.gid = int(stat.Gid)
	metadata.preserveOwner = true
	return metadata, nil
}

func applyAtomicFileMetadata(file *os.File, metadata atomicFileMetadata) error {
	if metadata.preserveOwner {
		// 非 root 测试进程只能保留自身属主；生产 Agent 以 root 运行时
		// 必须把临时文件恢复为原目标属主，避免 Tomcat 等服务账号失去读取权限。
		if os.Geteuid() != 0 && (metadata.uid != os.Getuid() || metadata.gid != os.Getgid()) {
			return fmt.Errorf("atomic replace cannot preserve target ownership uid=%d gid=%d", metadata.uid, metadata.gid)
		}
		if os.Geteuid() == 0 || metadata.uid != os.Getuid() || metadata.gid != os.Getgid() {
			if err := file.Chown(metadata.uid, metadata.gid); err != nil {
				return fmt.Errorf("atomic replace cannot preserve target ownership: %w", err)
			}
		}
	}
	if err := file.Chmod(metadata.mode.Perm()); err != nil {
		return fmt.Errorf("atomic replace cannot preserve target mode: %w", err)
	}
	return nil
}
