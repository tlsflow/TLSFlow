package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDiscoverWindowsNginxSingleHTTPSWithWindowsPaths(t *testing.T) {
	root := t.TempDir()
	_ = os.MkdirAll(filepath.Join(root, "conf", "conf.d"), 0o755)
	_ = os.MkdirAll(filepath.Join(root, "证书 目录 [测试]"), 0o755)
	certificatePath := filepath.Join(root, "证书 目录 [测试]", "server.crt.pem")
	keyPath := filepath.Join(root, "证书 目录 [测试]", "server.key.pem")
	chainPath := filepath.Join(root, "证书 目录 [测试]", "chain.crt.pem")
	writePEMCertificate(t, certificatePath, "nginx.test.local")
	writeTextFile(t, keyPath, "private-key-placeholder")
	writePEMCertificate(t, chainPath, "GCAC Test CA")
	writeTextFile(t, filepath.Join(root, "conf", "nginx.conf"), "include \"conf.d/*.conf\";\n")
	writeTextFile(t, filepath.Join(root, "conf", "conf.d", "site.conf"), strings.Join([]string{
		"server {",
		"  listen 127.0.0.1:8443 ssl;",
		"  server_name nginx.test.local 中文.test.local;",
		"  root \"站点 根目录\";",
		"  ssl_certificate \"证书 目录 [测试]/server.crt.pem\";",
		"  ssl_certificate_key \"证书 目录 [测试]/server.key.pem\";",
		"  ssl_certificate_chain \"证书 目录 [测试]/chain.crt.pem\";",
		"}",
	}, "\n"))

	detail := discoverWindowsNginx(windowsRuntimeFactSnapshot{
		Processes: []windowsRuntimeProcessFact{{
			Name:           "nginx.exe",
			ExecutablePath: filepath.Join(root, "nginx.exe"),
			CommandLine:    `"` + filepath.Join(root, "nginx.exe") + `" -p "` + root + `" -c conf\nginx.conf`,
			Version:        "1.30.4",
		}},
	})
	if !detail.Installed || !detail.Running || detail.Version != "1.30.4" {
		t.Fatalf("NGINX 安装和运行事实错误：%+v", detail)
	}
	if len(detail.Sites) != 1 || len(detail.Sites[0].Listen) != 1 {
		t.Fatalf("NGINX 单站点 HTTPS 解析错误：%+v", detail.Sites)
	}
	listener := detail.Sites[0].Listen[0]
	if listener.Protocol != "HTTPS" || listener.Port != 8443 || listener.HostHeader != "" {
		t.Fatalf("NGINX 监听事实错误：%+v", listener)
	}
	if listener.CertificatePath != certificatePath || listener.CertificateKeyPath != keyPath || listener.CertificateChainPath != chainPath {
		t.Fatalf("NGINX 证书位置没有保留 Windows 原始语义：%+v", listener)
	}
	if listener.Certificate == nil || listener.Certificate.FingerprintSHA256 == "" {
		t.Fatalf("NGINX 未读取证书公开指纹：%+v", listener)
	}
	if detail.ConfigFingerprint == "" || listener.ConfigFingerprint != detail.ConfigFingerprint {
		t.Fatalf("NGINX 配置指纹未传播：%+v", detail)
	}
	if len(detail.IncludeFiles) != 2 {
		t.Fatalf("NGINX include 文件集合错误：%+v", detail.IncludeFiles)
	}
}

func TestDiscoverWindowsNginxMultipleServerBlocksAndStableKeys(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(root, "nginx.conf")
	writeTextFile(t, configPath, strings.Join([]string{
		"server { listen 8443 ssl; server_name first.test.local; ssl_certificate cert1.pem; ssl_certificate_key key1.pem; }",
		"server { listen 9443 ssl; server_name second.test.local; ssl_certificate cert2.pem; ssl_certificate_key key2.pem; }",
	}, "\n"))
	for _, name := range []string{"cert1.pem", "key1.pem", "cert2.pem", "key2.pem"} {
		writeTextFile(t, filepath.Join(root, name), name)
	}
	firstSites, _, firstFingerprint, _ := parseWindowsNginxConfigTree(configPath, root)
	secondSites, _, _, _ := parseWindowsNginxConfigTree(configPath, root)
	if len(firstSites) != 2 {
		t.Fatalf("NGINX 多 server 块数量错误：%+v", firstSites)
	}
	if firstSites[0].ID != secondSites[0].ID || firstSites[0].Listen[0].BindingInformation != secondSites[0].Listen[0].BindingInformation {
		t.Fatalf("同一输入没有生成稳定键：%+v / %+v", firstSites, secondSites)
	}
	writeTextFile(t, configPath, "server { listen 8443 ssl; server_name changed.test.local; ssl_certificate cert1.pem; ssl_certificate_key key1.pem; }\n")
	_, _, changedFingerprint, _ := parseWindowsNginxConfigTree(configPath, root)
	if firstFingerprint == changedFingerprint {
		t.Fatalf("NGINX 配置变更未识别指纹变化：%s", firstFingerprint)
	}
}

func TestDiscoverWindowsApacheVirtualHostsAndChain(t *testing.T) {
	root := t.TempDir()
	_ = os.MkdirAll(filepath.Join(root, "conf", "extra"), 0o755)
	configPath := filepath.Join(root, "conf", "httpd.conf")
	writeTextFile(t, configPath, "ServerRoot \""+root+"\"\nInclude conf/extra/*.conf\nListen 8444\n")
	sitePath := filepath.Join(root, "conf", "extra", "https.conf")
	writeTextFile(t, sitePath, strings.Join([]string{
		"<VirtualHost *:8444>",
		"  ServerName apache.test.local",
		"  ServerAlias apache-alt.test.local",
		"  DocumentRoot \"站点 根目录\"",
		"  SSLCertificateFile \"certs/apache.crt.pem\"",
		"  SSLCertificateKeyFile \"certs/apache.key.pem\"",
		"  SSLCertificateChainFile \"certs/ca.crt.pem\"",
		"</VirtualHost>",
		"<VirtualHost 127.0.0.1:9444>",
		"  ServerName apache-second.test.local",
		"  SSLCertificateFile \"certs/apache2.crt.pem\"",
		"  SSLCertificateKeyFile \"certs/apache2.key.pem\"",
		"</VirtualHost>",
	}, "\n"))
	_ = os.MkdirAll(filepath.Join(root, "certs"), 0o755)
	for _, name := range []string{"apache.crt.pem", "apache.key.pem", "ca.crt.pem", "apache2.crt.pem", "apache2.key.pem"} {
		writeTextFile(t, filepath.Join(root, "certs", name), name)
	}

	detail := discoverWindowsApache(windowsRuntimeFactSnapshot{
		Processes: []windowsRuntimeProcessFact{{
			Name:           "httpd.exe",
			ExecutablePath: filepath.Join(root, "bin", "httpd.exe"),
			CommandLine:    `"` + filepath.Join(root, "bin", "httpd.exe") + `" -d "` + root + `" -f conf\httpd.conf`,
			Version:        "2.4.66",
		}},
		Services: []windowsRuntimeServiceFact{{
			Name:  "GCAC-Lab-Apache",
			State: "Running",
		}},
	})
	if len(detail.Sites) != 2 {
		t.Fatalf("Apache VirtualHost 数量错误：%+v", detail.Sites)
	}
	if detail.Sites[0].Listen[0].Protocol != "HTTPS" || detail.Sites[1].Listen[0].Protocol != "HTTPS" {
		t.Fatalf("Apache VirtualHost TLS 协议没有标记为 HTTPS：%+v", detail.Sites)
	}
	if detail.ServiceName != "GCAC-Lab-Apache" || detail.ServiceStatus != "Running" {
		t.Fatalf("Apache 服务事实错误：%+v", detail)
	}
	if detail.Sites[0].Listen[0].CertificateChainPath != filepath.Join(root, "certs", "ca.crt.pem") {
		t.Fatalf("Apache 证书链路径错误：%+v", detail.Sites[0].Listen[0])
	}
	if len(detail.IncludeFiles) != 2 || detail.ConfigFingerprint == "" {
		t.Fatalf("Apache 配置文件或指纹错误：%+v", detail)
	}
}

func TestDiscoverWindowsApacheMainServerHTTPSite(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(root, "conf", "httpd-gcac.conf")
	writeTextFile(t, configPath, strings.Join([]string{
		"ServerRoot \"" + root + "\"",
		"Listen 8444",
		"ServerName apache.test.local:8444",
		"DocumentRoot \"htdocs\"",
		"SSLEngine on",
		"SSLCertificateFile \"certs/apache.crt.pem\"",
		"SSLCertificateKeyFile \"certs/apache.key.pem\"",
		"SSLCertificateChainFile \"certs/ca.crt.pem\"",
	}, "\n"))
	writePEMCertificate(t, filepath.Join(root, "certs", "apache.crt.pem"), "apache.test.local")
	writeTextFile(t, filepath.Join(root, "certs", "apache.key.pem"), "private-key-placeholder")
	writePEMCertificate(t, filepath.Join(root, "certs", "ca.crt.pem"), "GCAC Test CA")

	detail := discoverWindowsApache(windowsRuntimeFactSnapshot{
		Processes: []windowsRuntimeProcessFact{{
			Name:           "httpd.exe",
			ExecutablePath: filepath.Join(root, "bin", "httpd.exe"),
			CommandLine:    `"` + filepath.Join(root, "bin", "httpd.exe") + `" -d "` + root + `" -f conf\httpd-gcac.conf"`,
			Version:        "2.4.66",
		}},
		Services: []windowsRuntimeServiceFact{{
			Name:  "GCAC-Lab-Apache",
			State: "Running",
		}},
	})

	if len(detail.Sites) != 1 {
		t.Fatalf("Apache 主服务级 HTTPS 站点没有被发现：%+v", detail.Sites)
	}
	site := detail.Sites[0]
	if site.Name != "apache.test.local" || len(site.ServerNames) != 1 || site.ServerNames[0] != "apache.test.local" {
		t.Fatalf("Apache 主服务级站点名称不正确：%+v", site)
	}
	if site.SitePath != filepath.Join(root, "htdocs") {
		t.Fatalf("Apache 主服务级站点根目录错误：%+v", site)
	}
	if len(site.Listen) != 1 || site.Listen[0].Protocol != "HTTPS" || site.Listen[0].Port != 8444 {
		t.Fatalf("Apache 主服务级监听没有识别为 HTTPS：%+v", site.Listen)
	}
	if site.Listen[0].CertificatePath != filepath.Join(root, "certs", "apache.crt.pem") ||
		site.Listen[0].CertificateKeyPath != filepath.Join(root, "certs", "apache.key.pem") ||
		site.Listen[0].CertificateChainPath != filepath.Join(root, "certs", "ca.crt.pem") {
		t.Fatalf("Apache 主服务级证书位置错误：%+v", site.Listen[0])
	}
	if site.Listen[0].Certificate == nil || !strings.Contains(site.Listen[0].Certificate.Subject, "CN=apache.test.local") {
		t.Fatalf("Apache 主服务级证书摘要未读取：%+v", site.Listen[0].Certificate)
	}
}

func TestWindowsCommandArgumentSupportsAttachedWindowsPath(t *testing.T) {
	commandLine := `"C:\GCAC-Lab\Apache24\bin\httpd.exe" -d"C:\GCAC-Lab\Apache24" -f"C:\GCAC-Lab\Apache24\conf\httpd-gcac.conf"`
	if got := windowsCommandArgument(commandLine, "-d"); got != `C:\GCAC-Lab\Apache24` {
		t.Fatalf("未解析拼接的 -d 参数：%q", got)
	}
	if got := windowsCommandArgument(commandLine, "-f"); got != `C:\GCAC-Lab\Apache24\conf\httpd-gcac.conf` {
		t.Fatalf("未解析拼接的 -f 参数：%q", got)
	}
}

func TestDiscoverWindowsApacheUsesServiceConfigWhenProcessOmitsConfig(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(root, "conf", "httpd-gcac.conf")
	writeTextFile(t, configPath, strings.Join([]string{
		"ServerRoot \"" + root + "\"",
		"Listen 8444",
		"<VirtualHost *:8444>",
		"  ServerName apache.test.local",
		"  SSLCertificateFile certs/apache.crt.pem",
		"  SSLCertificateKeyFile certs/apache.key.pem",
		"</VirtualHost>",
	}, "\n"))
	writeTextFile(t, filepath.Join(root, "certs", "apache.crt.pem"), "certificate")
	writeTextFile(t, filepath.Join(root, "certs", "apache.key.pem"), "key")

	detail := discoverWindowsApache(windowsRuntimeFactSnapshot{
		Processes: []windowsRuntimeProcessFact{{
			Name:           "httpd.exe",
			ExecutablePath: filepath.Join(root, "bin", "httpd.exe"),
			CommandLine:    `"` + filepath.Join(root, "bin", "httpd.exe") + `" -k runservice`,
		}},
		Services: []windowsRuntimeServiceFact{{
			Name:     "GCAC-Lab-Apache",
			State:    "Running",
			PathName: `"` + filepath.Join(root, "bin", "httpd.exe") + `" -k runservice -d "` + root + `" -f conf\httpd-gcac.conf"`,
		}},
	})

	if detail.ConfigPath != configPath {
		t.Fatalf("Apache 未使用 Windows 服务显式配置路径：%q", detail.ConfigPath)
	}
	if len(detail.Sites) != 1 || detail.Sites[0].ServerNames[0] != "apache.test.local" {
		t.Fatalf("Apache 服务配置未解析 VirtualHost：%+v", detail.Sites)
	}
}

func TestDiscoverWindowsApacheUsesRegistryArgsWhenPathNameOmitsConfig(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(root, "conf", "httpd-gcac.conf")
	writeTextFile(t, configPath, strings.Join([]string{
		"ServerRoot \"" + root + "\"",
		"Listen 8444",
		"ServerName apache.test.local:8444",
		"DocumentRoot htdocs",
		"SSLEngine on",
		"SSLCertificateFile certs/apache.crt.pem",
		"SSLCertificateKeyFile certs/apache.key.pem",
	}, "\n"))
	writePEMCertificate(t, filepath.Join(root, "certs", "apache.crt.pem"), "apache.test.local")
	writeTextFile(t, filepath.Join(root, "certs", "apache.key.pem"), "private-key-placeholder")

	detail := discoverWindowsApache(windowsRuntimeFactSnapshot{
		Processes: []windowsRuntimeProcessFact{{
			Name:           "httpd.exe",
			ExecutablePath: filepath.Join(root, "bin", "httpd.exe"),
			CommandLine:    `"` + filepath.Join(root, "bin", "httpd.exe") + `" -k runservice -n GCAC-Lab-Apache`,
		}},
		Services: []windowsRuntimeServiceFact{{
			Name:         "GCAC-Lab-Apache",
			State:        "Running",
			PathName:     `"` + filepath.Join(root, "bin", "httpd.exe") + `" -k runservice -n GCAC-Lab-Apache`,
			RegistryArgs: []string{"-d", root, "-f", `conf\httpd-gcac.conf`},
		}},
	})

	if detail.ConfigPath != configPath {
		t.Fatalf("Apache 未从服务注册表参数解析配置路径：%q", detail.ConfigPath)
	}
	if len(detail.Sites) != 1 || detail.Sites[0].Name != "apache.test.local" {
		t.Fatalf("Apache 服务注册表参数未解析出站点：%+v", detail.Sites)
	}
}

func TestDiscoverWindowsTomcatHTTPSPKCS12LocationAndNoPassword(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(root, "conf", "server.xml")
	_ = os.MkdirAll(filepath.Dir(configPath), 0o755)
	writeTextFile(t, filepath.Join(root, "RELEASE-NOTES"), "Apache Tomcat Version 9.0.120\n")
	writeTextFile(t, configPath, `<Server><Service name="Catalina"><Connector port="8445" protocol="org.apache.coyote.http11.Http11NioProtocol" SSLEnabled="true"><SSLHostConfig hostName="tomcat.test.local"><Certificate certificateKeystoreFile="certs\tomcat.p12" certificateKeystoreType="PKCS12" certificateKeystorePassword="changeit" certificateKeyAlias="tomcat"/></SSLHostConfig></Connector><Engine><Host name="tomcat.test.local"/></Engine></Service></Server>`)
	writeTextFile(t, filepath.Join(root, "certs", "tomcat.p12"), "not-a-real-pkcs12")

	detail := discoverWindowsTomcat(windowsRuntimeFactSnapshot{
		Processes: []windowsRuntimeProcessFact{{
			Name:           "java.exe",
			ExecutablePath: filepath.Join(root, "Java", "bin", "java.exe"),
			CommandLine:    `java -Dcatalina.base="` + root + `" -Dcatalina.home="` + root + `" org.apache.catalina.startup.Bootstrap`,
		}},
		Services: []windowsRuntimeServiceFact{{Name: "GCAC-Lab-Tomcat", State: "Running"}},
	})
	if detail.Version != "9.0.120" || detail.ServiceName != "GCAC-Lab-Tomcat" {
		t.Fatalf("Tomcat 版本或服务事实错误：%+v", detail)
	}
	if len(detail.Connectors) != 1 || detail.Connectors[0].KeystoreType != "PKCS12" {
		t.Fatalf("Tomcat PKCS#12 位置解析错误：%+v", detail.Connectors)
	}
	if detail.Connectors[0].KeystorePath != filepath.Join(root, "certs", "tomcat.p12") {
		t.Fatalf("Tomcat KeyStore 路径错误：%+v", detail.Connectors[0])
	}
	encoded, err := json.Marshal(detail)
	if err != nil {
		t.Fatal(err)
	}
	output := string(encoded)
	if strings.Contains(output, "changeit") ||
		strings.Contains(output, "certificateKeystorePassword") ||
		strings.Contains(strings.ToLower(output), `"password"`) {
		t.Fatalf("Tomcat KeyStore 密码进入发现输出：%s", output)
	}
}

func TestReadWindowsPKCS12CertificateSummaryWithCertificateChain(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "tomcat-with-chain.p12")
	writeBase64File(t, path, testWindowsTomcatPKCS12WithChainBase64)

	summary := readWindowsPKCS12CertificateSummary(path, "changeit")
	if summary == nil {
		t.Fatal("Tomcat PKCS#12 公开证书没有解析出来")
	}
	if !strings.Contains(summary.Subject, "CN=tomcat.test.local") {
		t.Fatalf("Tomcat PKCS#12 证书主题错误：%+v", summary)
	}
	if summary.FingerprintSHA256 == "" || summary.NotBefore == "" || summary.NotAfter == "" {
		t.Fatalf("Tomcat PKCS#12 证书摘要不完整：%+v", summary)
	}
}

func TestWindowsTomcatSiteUsesEngineHostWhenConnectorHostIsEmpty(t *testing.T) {
	detail := windowsTomcatDetail{
		ConfigPath: "C:\\GCAC-Lab\\Tomcat\\conf\\server.xml",
		Hosts:      []string{"tomcat.test.local"},
		Connectors: []windowsRuntimeListener{{
			Address:      "*",
			Port:         8445,
			Protocol:     "HTTPS",
			KeystorePath: "C:\\GCAC-Lab\\certs\\tomcat.p12",
		}},
	}

	sites := windowsTomcatSite(detail)
	if len(sites) != 1 || sites[0].Name != "tomcat.test.local" || sites[0].Listen[0].HostHeader != "tomcat.test.local" {
		t.Fatalf("Tomcat Engine Host 未回填到 Connector：%+v", sites)
	}
}

func TestWindowsDiscoveryWarningsAndPartialProductFailure(t *testing.T) {
	root := t.TempDir()
	nginxConfig := filepath.Join(root, "nginx.conf")
	writeTextFile(t, nginxConfig, "server { listen 8443 ssl; server_name nginx.test.local; ssl_certificate missing.crt; ssl_certificate_key missing.key; }\n")
	nginx := discoverWindowsNginx(windowsRuntimeFactSnapshot{
		Processes: []windowsRuntimeProcessFact{{Name: "nginx.exe", ExecutablePath: filepath.Join(root, "nginx.exe"), CommandLine: `nginx -p "` + root + `" -c nginx.conf`}},
	})
	apache := discoverWindowsApache(windowsRuntimeFactSnapshot{
		Processes: []windowsRuntimeProcessFact{{Name: "httpd.exe", ExecutablePath: filepath.Join(root, "httpd.exe"), CommandLine: `httpd -d "` + root + `" -f unreadable.conf`}},
	})
	if len(nginx.Warnings) == 0 || !hasWindowsWarning(nginx.Warnings, "CERTIFICATE_PATH_MISSING") {
		t.Fatalf("NGINX 缺失证书路径没有 warning：%+v", nginx.Warnings)
	}
	if len(apache.Warnings) == 0 || !hasWindowsWarning(apache.Warnings, "CONFIG_UNREADABLE") {
		t.Fatalf("Apache 配置不可读没有 warning：%+v", apache.Warnings)
	}
	if !nginx.Installed || !apache.Installed {
		t.Fatalf("单个产品异常不应污染其他产品安装事实：nginx=%+v apache=%+v", nginx, apache)
	}
}

func TestWindowsDiscoveryTomcatConfigParseFailureDoesNotExposeSecrets(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(root, "conf", "server.xml")
	_ = os.MkdirAll(filepath.Dir(configPath), 0o755)
	writeTextFile(t, configPath, `<Server><Connector port="8445" certificateKeystorePassword="super-secret"`)
	detail := discoverWindowsTomcat(windowsRuntimeFactSnapshot{
		Processes: []windowsRuntimeProcessFact{{
			Name:           "java.exe",
			ExecutablePath: filepath.Join(root, "Java", "bin", "java.exe"),
			CommandLine:    `java -Dcatalina.base="` + root + `" org.apache.catalina.startup.Bootstrap`,
		}},
	})
	if !hasWindowsWarning(detail.Warnings, "CONFIG_PARSE_FAILED") {
		t.Fatalf("Tomcat 损坏配置没有结构化 warning：%+v", detail.Warnings)
	}
	encoded, _ := json.Marshal(detail)
	if strings.Contains(string(encoded), "super-secret") || strings.Contains(string(encoded), "certificateKeystorePassword") {
		t.Fatalf("Tomcat 损坏配置中的密码泄漏到输出：%s", encoded)
	}
}

func writeTextFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func writeBase64File(t *testing.T, path string, contentBase64 string) {
	t.Helper()
	payload, err := base64.StdEncoding.DecodeString(strings.TrimSpace(contentBase64))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, payload, 0o644); err != nil {
		t.Fatal(err)
	}
}

func writePEMCertificate(t *testing.T, path string, commonName string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 1024)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: newSerialNumber(t),
		Subject:      pkix.Name{CommonName: commonName},
		DNSNames:     []string{commonName},
		NotBefore:    time.Now().Add(-time.Minute),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	writeTextFile(t, path, string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})))
}

func newSerialNumber(t *testing.T) *big.Int {
	t.Helper()
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 64))
	if err != nil {
		t.Fatal(err)
	}
	return serial
}

func hasWindowsWarning(warnings []windowsDiscoveryWarning, code string) bool {
	for _, warning := range warnings {
		if warning.Code == code {
			return true
		}
	}
	return false
}

const testWindowsTomcatPKCS12WithChainBase64 = `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`
