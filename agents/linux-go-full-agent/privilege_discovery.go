package main

import (
	"path/filepath"
	"strings"
)

// inspectHostPath 只采集通用路径状态，不解析任何产品配置或部署语义。
func inspectHostPath(rawPath string) map[string]any {
	path := filepath.Clean(strings.TrimSpace(rawPath))
	if strings.TrimSpace(rawPath) == "" {
		return map[string]any{"path": "", "exists": false, "readable": false, "writable": false}
	}
	parent := filepath.Dir(path)
	return map[string]any{
		"path":              path,
		"exists":            fileExists(path),
		"readable":          canReadPath(path),
		"writable":          canWritePath(path),
		"parentDir":         parent,
		"parentDirExists":   fileExists(parent),
		"parentDirWritable": canWriteDir(parent),
	}
}

func hostPathWritable(state map[string]any) bool {
	exists, _ := state["exists"].(bool)
	if exists {
		writable, _ := state["writable"].(bool)
		return writable
	}
	parentWritable, _ := state["parentDirWritable"].(bool)
	return parentWritable
}
