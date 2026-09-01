package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	keystore "github.com/pavlo-v-chernykh/keystore-go/v4"
	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

func TestCollectLinuxWebCertificateFilesReadsTomcatPKCS12AndPreservesConfiguredPath(t *testing.T) {
	certificate, privateKey := testCertificate(t)
	root := t.TempDir()
	configPath := filepath.Join(root, "tomcat", "conf", "server.xml")
	keystorePath := filepath.Join(root, "tomcat", "conf", "localhost-rsa.p12")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatal(err)
	}
	content, err := pkcs12.Modern2023.Encode(privateKey, certificate, nil, "changeit")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keystorePath, content, 0o600); err != nil {
		t.Fatal(err)
	}

	previousRoots := webDiscoveryRoots
	webDiscoveryRoots = []string{root}
	t.Cleanup(func() { webDiscoveryRoots = previousRoots })
	files := collectLinuxWebCertificateFiles([]map[string]any{{
		"path":    configPath,
		"content": `<Connector port="8445" scheme="https" certificateKeystoreFile="localhost-rsa.p12" certificateKeystorePassword="changeit"/>`,
	}})

	if len(files) != 1 {
		t.Fatalf("Tomcat PKCS12 必须发现一张证书，实际: %#v", files)
	}
	if files[0]["path"] != keystorePath {
		t.Fatalf("必须上报实际 keystore 路径: %#v", files[0])
	}
	if configuredPaths, ok := files[0]["configuredPaths"].([]string); !ok || len(configuredPaths) != 1 || configuredPaths[0] != "localhost-rsa.p12" {
		t.Fatalf("必须保留 server.xml 的配置路径别名: %#v", files[0])
	}
	if got := sanitizeLinuxWebConfigFiles([]map[string]any{{"content": `<Connector certificateKeystorePassword="changeit"/>`}})[0]["content"]; got != `<Connector certificateKeystorePassword="***"/>` {
		t.Fatalf("keystore 密码不得进入能力快照: %v", got)
	}
}

func TestParseLinuxApacheConfigTreeUsesEffectiveIncludeAndTLSVirtualHost(t *testing.T) {
	root := t.TempDir()
	mainPath := filepath.Join(root, "apache2.conf")
	sitePath := filepath.Join(root, "sites-enabled", "happy.conf")
	if err := os.MkdirAll(filepath.Dir(sitePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(mainPath, []byte("ServerName happy.example.test\nListen 8081\nInclude sites-enabled/*.conf\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sitePath, []byte("<VirtualHost *:8444>\n ServerName happy.example.test\n SSLEngine on\n SSLCertificateFile /etc/gcac-test/certs/test.crt\n SSLCertificateKeyFile /etc/gcac-test/certs/test.key\n</VirtualHost>\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	files, sites, fingerprint, warnings := parseLinuxApacheConfigTree(mainPath, root)
	if len(warnings) != 0 || fingerprint == "" || len(files) != 2 || len(sites) != 1 {
		t.Fatalf("Apache 有效配置树解析失败 files=%v sites=%v fingerprint=%q warnings=%v", files, sites, fingerprint, warnings)
	}
	metadata := sites[0]["metadata"].(map[string]any)
	listeners := metadata["listeners"].([]map[string]any)
	if len(listeners) != 1 || listeners[0]["port"] != 8444 || listeners[0]["protocol"] != "HTTPS" || listeners[0]["certificatePath"] != "/etc/gcac-test/certs/test.crt" {
		t.Fatalf("Apache TLS VirtualHost 事实不完整: %#v", listeners)
	}
}

func TestLinuxApachePathsHonorProcessOverrides(t *testing.T) {
	output := `-D HTTPD_ROOT="/opt/apache" -D SERVER_CONFIG_FILE="conf/httpd.conf"`
	root, configPath := linuxApachePaths(output, `apache2 -d /srv/apache -f conf/live.conf`, "/")
	if root != "/srv/apache" || configPath != "/srv/apache/conf/live.conf" {
		t.Fatalf("Apache 进程 -d/-f 覆盖未生效: root=%q config=%q", root, configPath)
	}

	root, configPath = linuxApachePaths(output, `apache2 -f /etc/apache-live.conf`, "/")
	if root != "/opt/apache" || configPath != "/etc/apache-live.conf" {
		t.Fatalf("Apache 绝对 -f 或编译 ServerRoot 解析错误: root=%q config=%q", root, configPath)
	}

	root, configPath = linuxApachePaths(`-D SERVER_CONFIG_FILE="conf/httpd.conf"`, "apache2", "/")
	if root != "" || configPath != "conf/httpd.conf" {
		t.Fatalf("缺少 ServerRoot 时不得伪造当前目录: root=%q config=%q", root, configPath)
	}
}

func TestLinuxProcessRuntimeFallsBackToProcExecutableForDeletedInode(t *testing.T) {
	procPath := filepath.Join("/proc", strconv.Itoa(os.Getpid()), "exe")
	runtime := linuxProcessRuntime(map[string]any{
		"pid":                os.Getpid(),
		"executablePath":     "/path/that/was/replaced/apache2",
		"procExecutablePath": procPath,
	})
	if runtime.programPath != "/path/that/was/replaced/apache2" || runtime.executionPath != procPath {
		t.Fatalf("稳定程序路径不应改写为 procfs: %q", runtime.programPath)
	}
	if !isLinuxProcExecutablePath(procPath) || isLinuxProcExecutablePath("/proc/self/exe") {
		t.Fatal("procfs 可执行入口校验错误")
	}
}

func TestLinuxWebProcessCandidateRecognizesApacheVariants(t *testing.T) {
	for _, executable := range []string{"/usr/sbin/apache2", "/usr/sbin/httpd.worker", "/opt/apache/bin/httpd (deleted)"} {
		if linuxWebProcessKind(executable, "") != "apache" {
			t.Fatalf("Apache 进程候选识别失败: %q", executable)
		}
	}
	if linuxWebProcessKind("/usr/bin/java", "java org.apache.catalina.startup.Bootstrap") != "tomcat" {
		t.Fatal("Tomcat Java 进程候选识别失败")
	}
	if linuxWebProcessKind("/usr/bin/python3", "python3 app.py") != "" {
		t.Fatal("普通进程不应被识别为 Web 候选")
	}
}

func TestLinuxIncludeMatchesFallsBackToCurrentConfigDirectory(t *testing.T) {
	root := t.TempDir()
	configDir := filepath.Join(root, "conf.d")
	includePath := filepath.Join(configDir, "sites-enabled", "happy.conf")
	if err := os.MkdirAll(filepath.Dir(includePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(includePath, []byte("<VirtualHost *:8444>\n</VirtualHost>\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	matches := linuxIncludeMatches("sites-enabled/*.conf", configDir, root)
	if len(matches) != 1 || matches[0] != includePath {
		t.Fatalf("Include 必须回退到当前配置目录: %#v", matches)
	}
}

func TestParseLinuxNginxConfigTreeUsesCompiledPrefixAndDeduplicatesIncludes(t *testing.T) {
	root := t.TempDir()
	mainPath := filepath.Join(root, "nginx.conf")
	sitePath := filepath.Join(root, "conf.d", "happy.conf")
	if err := os.MkdirAll(filepath.Dir(sitePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(mainPath, []byte("include conf.d/*.conf;\ninclude conf.d/*.conf;\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(sitePath, []byte("server {\n listen 8444 ssl;\n server_name happy.example.test;\n ssl_certificate /etc/gcac-test/certs/test.crt;\n ssl_certificate_key /etc/gcac-test/certs/test.key;\n}\n"), 0o640); err != nil {
		t.Fatal(err)
	}
	files, sites, fingerprint, warnings := parseLinuxNginxConfigTree(mainPath, root)
	if len(warnings) != 0 || fingerprint == "" || len(files) != 2 || len(sites) != 1 {
		t.Fatalf("NGINX 有效配置树解析失败 files=%v sites=%v fingerprint=%q warnings=%v", files, sites, fingerprint, warnings)
	}
	listeners := sites[0]["metadata"].(map[string]any)["listeners"].([]map[string]any)
	if len(listeners) != 1 || listeners[0]["port"] != 8444 || listeners[0]["protocol"] != "HTTPS" || listeners[0]["certificateKeyPath"] != "/etc/gcac-test/certs/test.key" {
		t.Fatalf("NGINX TLS listener 事实不完整: %#v", listeners)
	}
}

func TestParseLinuxTomcatServerXMLIgnoresCommentExampleAndKeepsKeystoreKind(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(root, "conf", "server.xml")
	content := []byte(`<?xml version="1.0"?><Server>
<!-- <Connector port="8443" scheme="https" certificateFile="comment.crt"/> -->
<Service><Connector port="8445" protocol="org.apache.coyote.http11.Http11NioProtocol" SSLEnabled="true" scheme="https" certificateKeystoreFile="conf/test.p12" certificateKeystoreType="PKCS12" keystorePass="changeit"/><Engine><Host name="happy.example.test"/></Engine></Service>
</Server>`)
	files, sites, warnings := parseLinuxTomcatServerXML(configPath, root, content)
	if len(warnings) != 0 || len(files) != 1 || len(sites) != 1 {
		t.Fatalf("Tomcat XML 解析失败 files=%v sites=%v warnings=%v", files, sites, warnings)
	}
	state := &linuxWebDiscoveryState{certSeen: map[string]map[string]any{}, configSeen: map[string]struct{}{}}
	appendLinuxSite(state, linuxWebRuntime{frameworkType: "app.tomcat", configPath: configPath, configFingerprint: strings.Repeat("a", 64), configCheckArgs: []string{"configtest"}}, sites[0])
	listener := state.sites[0]["metadata"].(map[string]any)["listeners"].([]map[string]any)[0]
	if listener["port"] != 8445 || listener["keystoreType"] != "PKCS12" || listener["keystorePath"] != filepath.Join(root, "conf", "test.p12") {
		t.Fatalf("Tomcat KeyStore 事实不完整: %#v", listener)
	}
	if strings.Contains(fmt.Sprint(listener), "changeit") {
		t.Fatal("Tomcat KeyStore 密码不得进入运行事实")
	}
}

func TestParseLinuxTomcatServerXMLSupportsConnectorKeystoreFile(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(root, "conf", "server.xml")
	content := []byte(`<Server><Service><Connector port="8445" protocol="org.apache.coyote.http11.Http11NioProtocol" SSLEnabled="true" scheme="https" keystoreFile="conf/localhost-rsa.p12" keystorePass="changeit"/><Engine><Host name="happy.example.test"/></Engine></Service></Server>`)
	_, sites, warnings := parseLinuxTomcatServerXML(configPath, root, content)
	if len(warnings) != 0 || len(sites) != 1 {
		t.Fatalf("Tomcat keystoreFile 解析失败 sites=%v warnings=%v", sites, warnings)
	}
	state := &linuxWebDiscoveryState{certSeen: map[string]map[string]any{}, configSeen: map[string]struct{}{}}
	appendLinuxSite(state, linuxWebRuntime{frameworkType: "app.tomcat", configPath: configPath, configFingerprint: strings.Repeat("b", 64), configCheckArgs: []string{"configtest"}}, sites[0])
	projectedSite := state.sites[0]
	listener := projectedSite["metadata"].(map[string]any)["listeners"].([]map[string]any)[0]
	if listener["keystorePath"] != filepath.Join(root, "conf", "localhost-rsa.p12") || listener["keystoreType"] != "PKCS12" {
		t.Fatalf("Tomcat keystoreFile 未解析为实际 PKCS12 路径: %#v", listener)
	}
	if strings.Contains(fmt.Sprint(listener), "changeit") {
		t.Fatal("Tomcat keystore 密码不得进入运行事实")
	}
}

func TestParseLinuxTomcatServerXMLPreservesLegacyKeystoreType(t *testing.T) {
	root := t.TempDir()
	configPath := filepath.Join(root, "conf", "server.xml")
	content := []byte(`<Server><Service><Connector port="8445" protocol="org.apache.coyote.http11.Http11NioProtocol" SSLEnabled="true" scheme="https" keystoreFile="/etc/gcac-test/certs/test.p12" keystorePass="changeit" keystoreType="PKCS12"/></Service></Server>`)
	_, sites, warnings := parseLinuxTomcatServerXML(configPath, root, content)
	if len(warnings) != 0 || len(sites) != 1 {
		t.Fatalf("Tomcat 传统 keystoreType 解析失败 sites=%v warnings=%v", sites, warnings)
	}
	listener := sites[0]["metadata"].(map[string]any)["listeners"].([]map[string]any)[0]
	if listener["keystorePath"] != "/etc/gcac-test/certs/test.p12" || listener["keystoreType"] != "PKCS12" {
		t.Fatalf("Tomcat 传统 keystoreType 未保留: %#v", listener)
	}
}

func TestAuthoritativeTomcatDiscoveryReadsConfiguredKeystorePassword(t *testing.T) {
	certificate, privateKey := testCertificate(t)
	root := t.TempDir()
	configPath := filepath.Join(root, "conf", "server.xml")
	keystorePath := filepath.Join(root, "certs", "test.p12")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(keystorePath), 0o755); err != nil {
		t.Fatal(err)
	}
	content, err := pkcs12.Modern2023.Encode(privateKey, certificate, nil, "changeit")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keystorePath, content, 0o600); err != nil {
		t.Fatal(err)
	}
	previousRoots := webDiscoveryRoots
	webDiscoveryRoots = []string{root}
	t.Cleanup(func() { webDiscoveryRoots = previousRoots })

	serverXML := []byte(`<Server><Service><Connector port="8445" protocol="org.apache.coyote.http11.Http11NioProtocol" SSLEnabled="true" scheme="https" keystoreFile="` + keystorePath + `" keystorePass="changeit" keystoreType="PKCS12"/></Service></Server>`)
	_, sites, warnings := parseLinuxTomcatServerXML(configPath, root, serverXML)
	if len(warnings) != 0 || len(sites) != 1 {
		t.Fatalf("Tomcat 权威配置解析失败 sites=%v warnings=%v", sites, warnings)
	}
	state := &linuxWebDiscoveryState{certSeen: map[string]map[string]any{}, configSeen: map[string]struct{}{}}
	appendLinuxSite(state, linuxWebRuntime{frameworkType: "app.tomcat", configPath: configPath, configFingerprint: strings.Repeat("c", 64), configCheckArgs: []string{"configtest"}}, sites[0])
	if len(state.certificates) != 1 || state.certificates[0]["path"] != keystorePath {
		t.Fatalf("Agent 必须使用 server.xml 密码读取实际 keystore: %#v", state.certificates)
	}
	listener := state.sites[0]["metadata"].(map[string]any)["listeners"].([]map[string]any)[0]
	if strings.Contains(fmt.Sprint(listener), "changeit") {
		t.Fatal("keystore 密码不得进入权威运行事实")
	}
}

func TestLinuxWebRuntimeVersionsUseActualProgramOutput(t *testing.T) {
	if got := linuxApacheVersion("Server version: Apache/2.4.52 (Ubuntu)"); got != "2.4.52" {
		t.Fatalf("Apache 版本解析错误: %q", got)
	}
	if got := linuxNginxVersion("nginx version: nginx/1.18.0"); got != "1.18.0" {
		t.Fatalf("NGINX 版本解析错误: %q", got)
	}
	if got := linuxApacheVersion("Apache version unavailable"); got != "" {
		t.Fatalf("无法取得版本时不得猜测: %q", got)
	}
}

func TestCollectLinuxWebCertificateFilesResolvesTomcatCatalinaBaseKeystore(t *testing.T) {
	certificate, privateKey := testCertificate(t)
	root := t.TempDir()
	configPath := filepath.Join(root, "etc", "tomcat9", "server.xml")
	keystorePath := filepath.Join(root, "var", "lib", "tomcat9", "conf", "localhost-rsa.p12")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(keystorePath), 0o755); err != nil {
		t.Fatal(err)
	}
	content, err := pkcs12.Modern2023.Encode(privateKey, certificate, nil, "changeit")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keystorePath, content, 0o600); err != nil {
		t.Fatal(err)
	}

	previousRoots := webDiscoveryRoots
	webDiscoveryRoots = []string{root}
	t.Cleanup(func() { webDiscoveryRoots = previousRoots })
	files := collectLinuxWebCertificateFiles([]map[string]any{{
		"path":    configPath,
		"content": `<Connector port="8445" scheme="https" keystoreFile="conf/localhost-rsa.p12" keystorePass="changeit"/>`,
	}}, filepath.Join(root, "var", "lib", "tomcat9"))

	if len(files) != 1 || files[0]["path"] != keystorePath {
		t.Fatalf("必须按 CATALINA_BASE 发现 Tomcat keystore: %#v", files)
	}
}

func TestCollectLinuxTomcatRuntimeRootsReadsCatalinaProperties(t *testing.T) {
	root := t.TempDir()
	previousRoots := webDiscoveryRoots
	webDiscoveryRoots = []string{root}
	t.Cleanup(func() { webDiscoveryRoots = previousRoots })
	roots := collectLinuxJvmRuntimeRoots([]map[string]any{{
		"commandLine": "java -Dcatalina.base='" + root + "/base' -Dcatalina.home=" + root + "/home org.apache.catalina.startup.Bootstrap",
	}})
	if len(roots) != 2 || roots[0] != filepath.Join(root, "base") || roots[1] != filepath.Join(root, "home") {
		t.Fatalf("必须读取 Catalina base/home: %#v", roots)
	}
}

func TestCollectLinuxWebInventoryDeclaresFullDiscoveryScope(t *testing.T) {
	previousRoots := webDiscoveryRoots
	webDiscoveryRoots = []string{t.TempDir()}
	t.Cleanup(func() { webDiscoveryRoots = previousRoots })

	inventory := collectLinuxWebInventory()
	if inventory["scope"] != fullWebDiscoveryScope {
		t.Fatalf("Linux Web 库存必须声明完整发现 scope: %#v", inventory["scope"])
	}
}

func TestReadLinuxPublicCertificateReadsTomcatJKS(t *testing.T) {
	certificate, _ := testCertificate(t)
	root := t.TempDir()
	path := filepath.Join(root, "server.store")
	store := keystore.New()
	if err := store.SetTrustedCertificateEntry("tomcat", keystore.TrustedCertificateEntry{
		CreationTime: time.Now(),
		Certificate:  keystore.Certificate{Type: "X509", Content: certificate.Raw},
	}); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Store(file, []byte("changeit")); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	previousRoots := webDiscoveryRoots
	webDiscoveryRoots = []string{root}
	t.Cleanup(func() { webDiscoveryRoots = previousRoots })
	metadata := readLinuxPublicCertificateWithPasswords(path, []string{"changeit"})
	if metadata == nil || metadata["name"] != "tomcat.example.test" {
		t.Fatalf("Tomcat JKS 必须读取叶子证书: %#v", metadata)
	}
}

func testCertificate(t *testing.T) (*x509.Certificate, *rsa.PrivateKey) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "tomcat.example.test"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &privateKey.PublicKey, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return certificate, privateKey
}
