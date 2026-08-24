package main

import (
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
	const programPath = `D:\runtime\nginx\nginx.exe`
	const serviceName = "nginx-production"
	fingerprint := strings.Repeat("a", 64)
	site := windowsRuntimeSite{
		ID:                "nginx:portal",
		Name:              "portal.example.test",
		ServerNames:       []string{"portal.example.test"},
		ConfigFiles:       []string{`D:\runtime\nginx\conf\nginx.conf`},
		ConfigFingerprint: fingerprint,
		Listen: []windowsRuntimeListener{{
			Address:              "*",
			Port:                 443,
			Protocol:             "HTTPS",
			HostHeader:           "portal.example.test",
			CertificatePath:      `D:\runtime\nginx\conf\certs\portal.crt`,
			CertificateKeyPath:   `D:\runtime\nginx\conf\certs\portal.key`,
			ConfigFingerprint:    fingerprint,
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
	for key, expected := range map[string]string{
		"serviceName":       serviceName,
		"programPath":       `D:/runtime/nginx/nginx.exe`,
		"configFingerprint": fingerprint,
	} {
		if actual := listener[key]; actual != expected {
			t.Fatalf("Nginx 监听器未投影已确认事实 %s: actual=%#v listener=%#v", key, actual, listener)
		}
	}
	if actual := metadata["serviceName"]; actual != serviceName {
		t.Fatalf("Nginx 站点不应丢失 Agent 上报的服务名: %#v", metadata)
	}
}

func TestDiscoverWindowsNginxDoesNotGuessConfigPath(t *testing.T) {
	detail := discoverWindowsNginx(windowsRuntimeFactSnapshot{
		Processes: []windowsRuntimeProcessFact{{
			Name:           "nginx.exe",
			ExecutablePath: `D:\runtime\nginx\nginx.exe`,
			CommandLine:    `"D:\runtime\nginx\nginx.exe"`,
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
