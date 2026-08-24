//go:build windows

package filesystem

import "os"

type owner struct {
	UID int
	GID int
}

func readOwner(os.FileInfo) owner {
	return owner{UID: -1, GID: -1}
}

func applyOwner(string, owner) error {
	return nil
}

func ensureSpace(string, int64) error {
	return nil
}

func syncDirectory(string) error {
	return nil
}
