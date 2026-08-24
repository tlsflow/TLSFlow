package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMatureNginxInventoryProjectsConfirmedRuntimeFacts(t *testing.T) {
	inventory := map[string]any{
		"frameworks":       []map[string]any{},
		"sites":            []map[string]any{},
		"certificateFiles": []map[string]any{},
		"configFiles":      []map[string]any{},
		"warnings":         []map[string]any{},
	}
	programPath := filepath.Join(t.TempDir(), "nginx.exe")
	programContent := []byte("GCAC Nginx test executable")
	if err := os.WriteFile(programPath, programContent, 0o600); err != nil {
		t.Fatalf("写入 Nginx 测试程序失败: %v", err)
	}
	const serviceName = "nginx-production"
	fingerprint := strings.Repeat("a", 64)
	site := windowsRuntimeSite{
		ID:                "nginx:portal",
		Name:              "portal.example.test",
		ServerNames:       []string{"portal.example.test"},
		ConfigFiles:       []string{`D:\runtime\nginx\conf\nginx.conf`},
		ConfigFingerprint: fingerprint,
		Listen: []windowsRuntimeListener{{
			Address:            "*",
			Port:               443,
			Protocol:           "HTTPS",
			HostHeader:         "portal.example.test",
			CertificatePath:    `D:\runtime\nginx\conf\certs\portal.crt`,
			CertificateKeyPath: `D:\runtime\nginx\conf\certs\portal.key`,
			ConfigFingerprint:  fingerprint,
		}},
	}

	appendWindowsMatureRuntimeDetailWithService(
		inventory,
		"web.nginx",
		"Nginx",
		true,
		"1.26.1",
		programPath,
		serviceName,
		`D:\runtime\nginx\conf\nginx.conf`,
		fingerprint,
		`D:\runtime\nginx`,
		[]windowsRuntimeSite{site},
		nil,
	)

	sites := inventory["sites"].([]map[string]any)
	if len(sites) != 1 {
		t.Fatalf("Nginx 站点投影数量错误: %#v", sites)
	}
	metadata := sites[0]["metadata"].(map[string]any)
	listeners := metadata["listeners"].([]map[string]any)
	if len(listeners) != 1 {
		t.Fatalf("Nginx HTTPS 监听器投影错误: %#v", metadata)
	}
	listener := listeners[0]
	expectedProgramSha256 := sha256.Sum256(programContent)
	for key, expected := range map[string]string{
		"serviceName":       serviceName,
		"programPath":       normalizeWindowsRuntimeInventoryPath(programPath),
		"programSha256":     hex.EncodeToString(expectedProgramSha256[:]),
		"configFingerprint": fingerprint,
		"workingDirectory":  `D:/runtime/nginx`,
	} {
		if actual := listener[key]; actual != expected {
			t.Fatalf("Nginx 监听器未投影已确认事实 %s: actual=%#v listener=%#v", key, actual, listener)
		}
	}
	if actual := metadata["serviceName"]; actual != serviceName {
		t.Fatalf("Nginx 站点不应丢失 Agent 上报的服务名: %#v", metadata)
	}
	args, ok := listener["configCheckArgs"].([]string)
	if !ok || strings.Join(args, "|") != "-t|-p|D:/runtime/nginx|-c|D:/runtime/nginx/conf/nginx.conf" {
		t.Fatalf("Nginx 未投影真实配置检查参数: %#v", listener["configCheckArgs"])
	}
}

func TestDiscoverWindowsNginxUsesExistingDefaultConfigPath(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "conf"), 0o700); err != nil {
		t.Fatalf("创建 Nginx 配置目录失败: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "nginx.exe"), []byte("nginx"), 0o600); err != nil {
		t.Fatalf("写入 Nginx 程序失败: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "conf", "nginx.conf"), []byte("server { listen 8080; server_name default.example.test; }"), 0o600); err != nil {
		t.Fatalf("写入 Nginx 默认配置失败: %v", err)
	}
	detail := discoverWindowsNginx(windowsRuntimeFactSnapshot{
		Processes: []windowsRuntimeProcessFact{{
			Name:           "nginx.exe",
			ExecutablePath: filepath.Join(root, "nginx.exe"),
			CommandLine:    "nginx.exe",
		}},
	})
	if detail.ConfigPath != filepath.Join(root, "conf", "nginx.conf") {
		t.Fatalf("存在程序目录默认配置时应解析 nginx.conf: %#v", detail)
	}
	if len(detail.Sites) != 1 || detail.Sites[0].Name != "default.example.test" {
		t.Fatalf("默认配置中的 Nginx 站点未发现: %#v", detail.Sites)
	}
}

func TestDiscoverWindowsNginxUsesServicePathWhenProcessPathUnavailable(t *testing.T) {
	root := t.TempDir()
	if err := os.Mkdir(filepath.Join(root, "conf"), 0o700); err != nil {
		t.Fatalf("创建 Nginx 服务配置目录失败: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "nginx.exe"), []byte("nginx"), 0o600); err != nil {
		t.Fatalf("写入 Nginx 服务程序失败: %v", err)
	}
	if err := os.WriteFile(filepath.Join(root, "conf", "nginx.conf"), []byte("server { listen 8081; server_name service.example.test; }"), 0o600); err != nil {
		t.Fatalf("写入 Nginx 服务默认配置失败: %v", err)
	}
	detail := discoverWindowsNginx(windowsRuntimeFactSnapshot{
		Services: []windowsRuntimeServiceFact{{
			Name:     "nginx-service",
			State:    "Running",
			PathName: `"` + filepath.Join(root, "nginx.exe") + `"`,
		}},
	})
	if detail.BinaryPath != filepath.Join(root, "nginx.exe") || len(detail.Sites) != 1 || detail.Sites[0].Name != "service.example.test" {
		t.Fatalf("进程路径不可用时未从 Nginx 服务事实发现站点: %#v", detail)
	}
}

func TestDiscoverWindowsNginxDoesNotGuessMissingConfigPath(t *testing.T) {
	root := t.TempDir()
	detail := discoverWindowsNginx(windowsRuntimeFactSnapshot{
		Processes: []windowsRuntimeProcessFact{{
			Name:           "nginx.exe",
			ExecutablePath: filepath.Join(root, "nginx.exe"),
			CommandLine:    "nginx.exe",
		}},
	})

	if detail.ConfigPath != "" {
		t.Fatalf("缺少 -c 时不应猜测 NGINX 配置路径: %#v", detail)
	}
	if len(detail.Sites) != 0 || detail.ConfigFingerprint != "" {
		t.Fatalf("缺少实际配置路径时不应生成站点或指纹: %#v", detail)
	}
	foundWarning := false
	for _, warning := range detail.Warnings {
		if warning.Code == "CONFIG_PATH_UNCONFIRMED" {
			foundWarning = true
			break
		}
	}
	if !foundWarning {
		t.Fatalf("缺少实际配置路径时应记录 CONFIG_PATH_UNCONFIRMED: %#v", detail.Warnings)
	}
}
