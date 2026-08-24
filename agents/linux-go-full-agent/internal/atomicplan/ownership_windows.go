//go:build windows

package atomicplan

import "os"

func readFileOwnership(_ os.FileInfo) (int, int) {
	return -1, -1
}

func applyFileOwnership(_ string, _, _ int) error {
	return nil
}
