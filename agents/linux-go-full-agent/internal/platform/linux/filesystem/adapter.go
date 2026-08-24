package filesystem

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type Backup struct {
	TargetPath string
	BackupPath string
	Existed    bool
	Mode       os.FileMode
	OwnerUID   int
	OwnerGID   int
}

type Adapter struct {
	allowedRoots []string
}

func New(allowedRoots []string) (*Adapter, error) {
	roots := make([]string, 0, len(allowedRoots))
	for _, root := range allowedRoots {
		absolute, err := filepath.Abs(strings.TrimSpace(root))
		if err != nil || strings.TrimSpace(root) == "" {
			return nil, fmt.Errorf("invalid filesystem root: %s", root)
		}
		roots = append(roots, filepath.Clean(absolute))
	}
	if len(roots) == 0 {
		return nil, errors.New("at least one filesystem root is required")
	}
	return &Adapter{allowedRoots: roots}, nil
}

func (adapter *Adapter) Backup(targetPath, backupPath string) (Backup, error) {
	if err := adapter.validatePath(targetPath); err != nil {
		return Backup{}, err
	}
	if err := adapter.validatePath(backupPath); err != nil {
		return Backup{}, err
	}
	info, err := os.Lstat(targetPath)
	if os.IsNotExist(err) {
		return Backup{TargetPath: targetPath, BackupPath: backupPath, Existed: false}, nil
	}
	if err != nil {
		return Backup{}, err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return Backup{}, fmt.Errorf("symbolic link target requires explicit resolution: %s", targetPath)
	}
	if err := copyFile(targetPath, backupPath, info.Mode().Perm()); err != nil {
		return Backup{}, err
	}
	owner := readOwner(info)
	return Backup{
		TargetPath: targetPath,
		BackupPath: backupPath,
		Existed:    true,
		Mode:       info.Mode().Perm(),
		OwnerUID:   owner.UID,
		OwnerGID:   owner.GID,
	}, nil
}

func (adapter *Adapter) AtomicReplace(targetPath string, content []byte, mode os.FileMode) error {
	if err := adapter.validatePath(targetPath); err != nil {
		return err
	}
	if info, err := os.Lstat(targetPath); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("symbolic link target requires explicit resolution: %s", targetPath)
	}
	if err := ensureSpace(filepath.Dir(targetPath), int64(len(content))); err != nil {
		return err
	}
	directory := filepath.Dir(targetPath)
	if err := os.MkdirAll(directory, 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(directory, ".gcac-agent-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(mode.Perm()); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(content); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	if err := os.Rename(temporaryPath, targetPath); err != nil {
		return err
	}
	return syncDirectory(directory)
}

func (adapter *Adapter) Restore(backup Backup) error {
	if !backup.Existed {
		if err := adapter.validatePath(backup.TargetPath); err != nil {
			return err
		}
		if err := os.Remove(backup.TargetPath); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	content, err := os.ReadFile(backup.BackupPath)
	if err != nil {
		return err
	}
	if err := adapter.AtomicReplace(backup.TargetPath, content, backup.Mode); err != nil {
		return err
	}
	return applyOwner(backup.TargetPath, owner{UID: backup.OwnerUID, GID: backup.OwnerGID})
}

func (adapter *Adapter) validatePath(path string) error {
	if strings.TrimSpace(path) == "" || !filepath.IsAbs(path) {
		return fmt.Errorf("absolute path is required: %s", path)
	}
	clean := filepath.Clean(path)
	for _, root := range adapter.allowedRoots {
		relative, err := filepath.Rel(root, clean)
		if err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(os.PathSeparator)) {
			return nil
		}
	}
	return fmt.Errorf("path escapes allowed roots: %s", path)
}

func copyFile(sourcePath, targetPath string, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o700); err != nil {
		return err
	}
	source, err := os.Open(sourcePath)
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.OpenFile(targetPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(target, source); err != nil {
		target.Close()
		return err
	}
	if err := target.Sync(); err != nil {
		target.Close()
		return err
	}
	return target.Close()
}
