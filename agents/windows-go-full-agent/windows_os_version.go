package main

import "strings"

// windowsOSDetail 只保存固定 Windows 主机版本键的原始事实，不包含产品扫描或版本推断。
type windowsOSDetail struct {
	ProductName    string `json:"productName,omitempty"`
	DisplayVersion string `json:"displayVersion,omitempty"`
	ReleaseID      string `json:"releaseId,omitempty"`
	CurrentBuild   string `json:"currentBuild,omitempty"`
	BuildRevision  string `json:"buildRevision,omitempty"`
	Version        string `json:"version,omitempty"`
}

// formatWindowsSystemVersion 统一注册字段和能力快照中的可读系统版本格式。
func formatWindowsSystemVersion(detail *windowsOSDetail) string {
	if detail == nil {
		return ""
	}
	productName := strings.TrimSpace(detail.ProductName)
	displayVersion := strings.TrimSpace(detail.DisplayVersion)
	build := strings.TrimSpace(detail.BuildRevision)
	if build == "" {
		build = strings.TrimSpace(detail.CurrentBuild)
	}
	version := strings.TrimSpace(detail.Version)
	if productName != "" && displayVersion != "" {
		return productName + " " + displayVersion
	}
	if productName != "" && build != "" {
		return productName + " (Build " + build + ")"
	}
	if productName != "" && version != "" {
		return productName + " (" + version + ")"
	}
	if productName != "" {
		return productName
	}
	if displayVersion != "" {
		return displayVersion
	}
	if build != "" {
		return build
	}
	return version
}
