//go:build windows

package main

import "os"

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
		return atomicFileMetadata{}, os.ErrInvalid
	}
	return atomicFileMetadata{mode: info.Mode().Perm()}, nil
}

func applyAtomicFileMetadata(file *os.File, metadata atomicFileMetadata) error {
	return file.Chmod(metadata.mode.Perm())
}
