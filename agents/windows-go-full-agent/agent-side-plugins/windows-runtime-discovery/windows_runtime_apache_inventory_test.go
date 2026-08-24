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
		`C:\GCAC-Lab\Apache24`,
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
		"workingDirectory":  `C:/GCAC-Lab/Apache24`,
	} {
		if actual := listener[key]; actual != expected {
			t.Fatalf("Apache 监听器未投影 %s: actual=%#v listener=%#v", key, actual, listener)
		}
		args, ok := listener["configCheckArgs"].([]string)
		if !ok || strings.Join(args, "|") != "-t|-d|C:/GCAC-Lab/Apache24|-f|C:/GCAC-Lab/Apache24/conf/httpd-gcac.conf" {
			t.Fatalf("Apache 未投影真实配置检查参数: %#v", listener["configCheckArgs"])
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
		`C:\GCAC-Lab\Apache24`,
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

func TestMatureTomcatInventoryProjectsWorkingDirectory(t *testing.T) {
	inventory := map[string]any{
		"frameworks":       []map[string]any{},
		"sites":            []map[string]any{},
		"certificateFiles": []map[string]any{},
		"configFiles":      []map[string]any{},
		"warnings":         []map[string]any{},
	}
	programPath := filepath.Join(t.TempDir(), "java.exe")
	if err := os.WriteFile(programPath, []byte("GCAC Tomcat test executable"), 0o600); err != nil {
		t.Fatalf("写入 Tomcat 测试程序失败: %v", err)
	}
	appendWindowsMatureRuntimeDetailWithService(
		inventory,
		"app.tomcat",
		"Tomcat",
		true,
		"10.1.24",
		programPath,
		"GCAC-Lab-Tomcat",
		`F:\GCAC-Lab\Tomcat\conf\server.xml`,
		strings.Repeat("c", 64),
		`F:\GCAC-Lab\Tomcat`,
		[]windowsRuntimeSite{{
			Name:              "tomcat.test.local",
			ServerNames:       []string{"tomcat.test.local"},
			ConfigFingerprint: strings.Repeat("c", 64),
			Listen: []windowsRuntimeListener{{
				Address:           "*",
				Port:              8443,
				Protocol:          "HTTPS",
				KeystorePath:      `F:\GCAC-Lab\Tomcat\conf\server.p12`,
				KeystoreType:      "PKCS12",
				KeyAlias:          "server",
				ConfigFingerprint: strings.Repeat("c", 64),
			}},
		}},
		nil,
	)

	sites := inventory["sites"].([]map[string]any)
	if len(sites) != 1 {
		t.Fatalf("Tomcat 站点投影数量错误: %#v", sites)
	}
	listener := sites[0]["metadata"].(map[string]any)["listeners"].([]map[string]any)[0]
	expectedProgramSha256 := sha256.Sum256([]byte("GCAC Tomcat test executable"))
	if listener["programSha256"] != hex.EncodeToString(expectedProgramSha256[:]) {
		t.Fatalf("Tomcat 未投影已确认程序摘要: %#v", listener)
	}
	if listener["workingDirectory"] != `F:/GCAC-Lab/Tomcat` {
		t.Fatalf("Tomcat 未投影真实工作目录: %#v", listener)
	}
	args, ok := listener["configCheckArgs"].([]string)
	if !ok || len(args) != 6 || args[0] != "-Dcatalina.base=F:/GCAC-Lab/Tomcat" || args[5] != "configtest" {
		t.Fatalf("Tomcat 未投影真实配置检查参数: %#v", listener["configCheckArgs"])
	}
}
