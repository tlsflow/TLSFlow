package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDiscoverWindowsApacheFallsBackToConfirmedServicePath(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(root, "conf", "httpd-gcac.conf")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatalf("创建 Apache 测试配置目录失败: %v", err)
	}
	if err := os.WriteFile(configPath, []byte(`<VirtualHost *:8444>
ServerName apache.test.local
SSLEngine on
SSLCertificateFile certs/apache.crt.pem
SSLCertificateKeyFile certs/apache.key.pem
</VirtualHost>
`), 0o600); err != nil {
		t.Fatalf("写入 Apache 测试配置失败: %v", err)
	}

	binaryPath := filepath.Join(root, "bin", "httpd.exe")
	detail := discoverWindowsApache(windowsRuntimeFactSnapshot{
		Processes: []windowsRuntimeProcessFact{{
			Name:        "httpd.exe",
			CommandLine: `"` + binaryPath + `" -k runservice -n GCAC-Lab-Apache`,
		}},
		Services: []windowsRuntimeServiceFact{{
			Name:           "GCAC-Lab-Apache",
			PathName:       `"` + binaryPath + `" -k runservice -n GCAC-Lab-Apache -f "` + configPath + `"`,
			ExecutablePath: "",
		}},
	})

	if !detail.Installed || detail.BinaryPath != binaryPath {
		t.Fatalf("Apache 应从已确认命令行回退程序路径: %#v", detail)
	}
	if detail.ServiceName != "GCAC-Lab-Apache" {
		t.Fatalf("Apache 服务名丢失: %#v", detail)
	}
	if detail.ConfigPath != configPath {
		t.Fatalf("Apache 未采用 SCM 的实际配置入口: got=%q want=%q", detail.ConfigPath, configPath)
	}
	if len(detail.Sites) != 1 || len(detail.Sites[0].Listen) != 1 || detail.Sites[0].Listen[0].Protocol != "HTTPS" {
		t.Fatalf("Apache VirtualHost 未形成 HTTPS 站点: %#v", detail)
	}
	if detail.ConfigFingerprint == "" || len(detail.ConfigFingerprint) != 64 {
		t.Fatalf("Apache 配置指纹未生成: %#v", detail)
	}
}

func TestDiscoverWindowsApacheMatchesServiceByImagePath(t *testing.T) {
	binaryPath := `C:\GCAC-Lab\Apache24\bin\httpd.exe`
	detail := discoverWindowsApache(windowsRuntimeFactSnapshot{
		Services: []windowsRuntimeServiceFact{{
			Name:        "GCAC-Lab-Web",
			DisplayName: "GCAC Lab Web",
			PathName:    `"` + binaryPath + `" -k runservice -n GCAC-Lab-Web`,
		}},
	})

	if !detail.Installed || detail.BinaryPath != binaryPath {
		t.Fatalf("Apache 应从服务 ImagePath 识别安装位置: %#v", detail)
	}
	if detail.ServiceName != "GCAC-Lab-Web" {
		t.Fatalf("通过 ImagePath 识别服务时不能丢失服务名: %#v", detail)
	}
}

func TestMatureApacheInventoryProjectsRuntimeFacts(t *testing.T) {
	inventory := map[string]any{
		"frameworks":       []map[string]any{},
		"sites":            []map[string]any{},
		"certificateFiles": []map[string]any{},
		"configFiles":      []map[string]any{},
		"warnings":         []map[string]any{},
	}
	fingerprint := strings.Repeat("b", 64)
	programPath := filepath.Join(t.TempDir(), "httpd.exe")
	programContent := []byte("GCAC Apache test executable")
	if err := os.WriteFile(programPath, programContent, 0o600); err != nil {
		t.Fatalf("写入 Apache 测试程序失败: %v", err)
	}
	appendWindowsMatureRuntimeDetailWithService(
		inventory,
		"web.apache",
		"Apache",
		true,
		"2.4.66",
		programPath,
		"GCAC-Lab-Apache",
		`C:\GCAC-Lab\Apache24\conf\httpd-gcac.conf`,
		fingerprint,
		[]windowsRuntimeSite{{
			Name:              "apache.test.local",
			ServerNames:       []string{"apache.test.local"},
			ConfigFingerprint: fingerprint,
			Listen: []windowsRuntimeListener{{
				Address:            "*",
				Port:               8444,
				Protocol:           "HTTPS",
				CertificatePath:    `C:\GCAC-Lab\certs\apache.crt.pem`,
				CertificateKeyPath: `C:\GCAC-Lab\certs\apache.key.pem`,
				ConfigFingerprint:  fingerprint,
			}},
		}},
		nil,
	)

	sites := inventory["sites"].([]map[string]any)
	if len(sites) != 1 {
		t.Fatalf("Apache 站点投影数量错误: %#v", sites)
	}
	listener := sites[0]["metadata"].(map[string]any)["listeners"].([]map[string]any)[0]
	expectedProgramSha256 := sha256.Sum256(programContent)
	for key, expected := range map[string]string{
		"serviceName":       "GCAC-Lab-Apache",
		"programPath":       normalizeWindowsRuntimeInventoryPath(programPath),
		"programSha256":     hex.EncodeToString(expectedProgramSha256[:]),
		"configFingerprint": fingerprint,
	} {
		if actual := listener[key]; actual != expected {
			t.Fatalf("Apache 监听器未投影 %s: actual=%#v listener=%#v", key, actual, listener)
		}
	}
}

func TestMatureApacheInventoryWarnsWhenProgramSha256CannotBeRead(t *testing.T) {
	inventory := map[string]any{
		"frameworks":       []map[string]any{},
		"sites":            []map[string]any{},
		"certificateFiles": []map[string]any{},
		"configFiles":      []map[string]any{},
		"warnings":         []map[string]any{},
	}
	appendWindowsMatureRuntimeDetailWithService(
		inventory,
		"web.apache",
		"Apache",
		true,
		"2.4.66",
		filepath.Join(t.TempDir(), "missing-httpd.exe"),
		"GCAC-Lab-Apache",
		`C:\GCAC-Lab\Apache24\conf\httpd-gcac.conf`,
		strings.Repeat("b", 64),
		nil,
		nil,
	)

	warnings := inventory["warnings"].([]map[string]any)
	if len(warnings) != 1 || warnings[0]["code"] != "PROGRAM_SHA256_UNAVAILABLE" {
		t.Fatalf("程序摘要读取失败时必须保留告警且不伪造摘要: %#v", warnings)
	}
	framework := inventory["frameworks"].([]map[string]any)[0]
	metadata := framework["metadata"].(map[string]any)
	if _, exists := metadata["programSha256"]; exists {
		t.Fatalf("程序摘要读取失败时不能写入猜测值: %#v", metadata)
	}
}
