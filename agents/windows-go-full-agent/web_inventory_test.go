package main

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestDecodeWindowsConfigTextDecodesUTF16LE(t *testing.T) {
	text, ok := decodeWindowsConfigText([]byte{0xff, 0xfe, '<', 0x00, 'x', 0x00, '>', 0x00})
	if !ok {
		t.Fatal("UTF-16 LE 配置应可解码")
	}
	if text != "<x>" {
		t.Fatalf("UTF-16 LE 解码结果错误: %q", text)
	}
}

func TestDecodeWindowsConfigTextRejectsRawNulBytes(t *testing.T) {
	if _, ok := decodeWindowsConfigText([]byte{'<', 0x00, 'x'}); ok {
		t.Fatal("没有 BOM 的含 NUL 内容必须视为非文本配置")
	}
}

func TestConfiguredWindowsInventoryRootsPrefersRuntimeConfig(t *testing.T) {
	config := &AgentConfig{}
	config.Paths.Windows.InventoryPaths = []string{"C:\\Custom", "c:\\custom", "C:\\Other"}
	roots := configuredWindowsInventoryRoots(config)
	if len(roots) < 2 || roots[0] != "C:\\Custom" || roots[1] != "C:\\Other" {
		t.Fatalf("运行配置中的发现目录未优先去重保留: %#v", roots)
	}
	seenDefault := false
	for _, root := range roots {
		if root == "C:\\Tomcat" {
			seenDefault = true
			break
		}
	}
	if !seenDefault {
		t.Fatalf("旧配置升级时必须合并当前默认 Web 发现目录: %#v", roots)
	}
}

func TestConfiguredWindowsInventoryRootsLoadsTemplateDefaults(t *testing.T) {
	roots := configuredWindowsInventoryRoots(nil)
	if len(roots) == 0 {
		t.Fatal("安装模板必须提供默认发现目录")
	}
}

func TestWindowsProcessPathExtractionPreservesArbitraryWindowsInstallRoots(t *testing.T) {
	commandLine := `"C:\Program Files\Java\bin\java.exe" -Dcatalina.base="D:\Web Apps\Tomcat" -Dcatalina.home="D:\Web Apps\Tomcat"`
	tokens := parseWindowsCommandLine(commandLine)
	if len(tokens) != 3 {
		t.Fatalf("Windows 命令行分词错误: %#v", tokens)
	}
	if got := windowsDrivePathFromToken(tokens[1]); got != `D:\Web Apps\Tomcat` {
		t.Fatalf("未保留带空格的任意盘符路径: %q", got)
	}
}

func TestParseWindowsListeningPortsKeepsPIDFromNetstatAno(t *testing.T) {
	output := []byte(`  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:443            0.0.0.0:0              LISTENING       4321
  TCP    [::]:8443              [::]:0                 LISTENING       9876
`)
	ports := parseWindowsListeningPorts(output)
	if len(ports) != 2 {
		t.Fatalf("netstat -ano 应解析两个监听端口: %#v", ports)
	}
	if ports[0]["port"] != 443 || ports[0]["pid"] != 4321 {
		t.Fatalf("第一个监听端口 PID 解析错误: %#v", ports[0])
	}
	if ports[1]["port"] != 8443 || ports[1]["pid"] != 9876 {
		t.Fatalf("IPv6 监听端口 PID 解析错误: %#v", ports[1])
	}
}

func TestDiscoverySpecDerivesConfigPathsFromArbitraryWindowsCommandLine(t *testing.T) {
	spec := sanitizeAgentDiscoverySpec(agentDiscoverySpecV1{
		SpecVersion: "gcac.agent-web-discovery/v1",
		Profiles: []agentDiscoveryProfileV1{{
			PluginID: "web.nginx", FrameworkType: "web.nginx",
			ProcessNames:               []string{"nginx.exe"},
			ConfigArgKeys:              []string{"-c"},
			RootArgKeys:                []string{"-p"},
			DefaultConfigRelativePaths: []string{"conf/nginx.conf"},
		}, {
			PluginID: "app.tomcat", FrameworkType: "app.tomcat",
			ProcessNames:               []string{"java.exe"},
			CommandLineContains:        []string{"org.apache.catalina"},
			RootArgKeys:                []string{"-Dcatalina.base", "-Dcatalina.home"},
			DefaultConfigRelativePaths: []string{"conf/server.xml"},
		}},
	})
	nginx := windowsDiscoveryPathsFromExecutableAndCommandLine(spec, `D:\runtime\nginx\sbin\nginx.exe`, `"D:\runtime\nginx\sbin\nginx.exe" -p "E:\Sites\nginx" -c conf\nginx.conf`)
	if !containsWindowsPath(nginx, `E:\Sites\nginx\conf\nginx.conf`) {
		t.Fatalf("Nginx 任意盘符配置入口未从 -p/-c 推出: %#v", nginx)
	}
	tomcat := windowsDiscoveryPathsFromExecutableAndCommandLine(spec, `C:\Program Files\Java\bin\java.exe`, `"C:\Program Files\Java\bin\java.exe" -Dcatalina.base="F:\Apps\Tomcat A" org.apache.catalina.startup.Bootstrap start`)
	if !containsWindowsPath(tomcat, `F:\Apps\Tomcat A\conf\server.xml`) {
		t.Fatalf("Tomcat 任意盘符 server.xml 未从 catalina.base 推出: %#v", tomcat)
	}
}

func TestDiscoverySpecSanitizerRejectsExecutablePayloadShape(t *testing.T) {
	spec := sanitizeAgentDiscoverySpec(agentDiscoverySpecV1{
		SpecVersion: "gcac.agent-web-discovery/v1",
		Profiles: []agentDiscoveryProfileV1{{
			PluginID: "web.nginx", FrameworkType: "web.nginx",
			ProcessNames:               []string{"nginx.exe", `..\evil.exe`},
			ConfigArgKeys:              []string{"-c", "; powershell"},
			DefaultConfigRelativePaths: []string{"conf/nginx.conf", "../secret.txt"},
			ConfigFileNames:            []string{"nginx.conf", "bad/name.conf"},
		}},
	})
	profile := spec.Profiles[0]
	if len(profile.ProcessNames) != 1 || profile.ProcessNames[0] != "nginx.exe" {
		t.Fatalf("进程名过滤不正确: %#v", profile.ProcessNames)
	}
	if len(profile.ConfigArgKeys) != 1 || profile.ConfigArgKeys[0] != "-c" {
		t.Fatalf("参数键过滤不正确: %#v", profile.ConfigArgKeys)
	}
	if len(profile.DefaultConfigRelativePaths) != 1 || profile.DefaultConfigRelativePaths[0] != "conf/nginx.conf" {
		t.Fatalf("相对路径过滤不正确: %#v", profile.DefaultConfigRelativePaths)
	}
	if len(profile.ConfigFileNames) != 1 || profile.ConfigFileNames[0] != "nginx.conf" {
		t.Fatalf("配置文件名过滤不正确: %#v", profile.ConfigFileNames)
	}
}

func TestWebDiscoveryPlanDigestBindsStaticProfile(t *testing.T) {
	spec := sanitizeAgentDiscoverySpec(agentDiscoverySpecV1{
		SpecVersion: "gcac.agent-web-discovery/v1",
		Source:      "declarative-plugin-metadata",
		Profiles: []agentDiscoveryProfileV1{{
			PluginID: "web.nginx", FrameworkType: "web.nginx",
			ProcessNames:    []string{"nginx.exe"},
			ConfigFileNames: []string{"nginx.conf"},
		}},
	})
	request := map[string]any{
		"actionType":          agentFactCollect,
		"agentId":             "agent-1",
		"tenantId":            "tenant-1",
		"pluginId":            "web.nginx",
		"pluginVersion":       "plugin-version-1",
		"capability":          "application.discover",
		"paths":               []string{`C:\nginx`},
		"discoverySpec":       discoverySpecDigestValue(spec),
		"refreshWebInventory": true,
	}
	request["planDigest"] = sha256Bytes(canonicalJSON(map[string]any{
		"actionType":          request["actionType"],
		"agentId":             request["agentId"],
		"tenantId":            request["tenantId"],
		"pluginId":            request["pluginId"],
		"pluginVersionId":     request["pluginVersion"],
		"capability":          request["capability"],
		"paths":               request["paths"],
		"discoverySpec":       request["discoverySpec"],
		"refreshWebInventory": true,
	}))
	if err := validateAgentWebDiscoveryPlanDigest(request); err != nil {
		t.Fatalf("合法 profile 的 planDigest 不应被拒绝: %v", err)
	}
	request["discoverySpec"].(map[string]any)["profiles"].([]map[string]any)[0]["processNames"] = []string{"evil.exe"}
	if err := validateAgentWebDiscoveryPlanDigest(request); err == nil {
		t.Fatal("被篡改的 discoverySpec 必须因 planDigest 不匹配而失败")
	}
}

func TestConfigCertificateReferenceExtractionResolvesRelativeWindowsPaths(t *testing.T) {
	spec := sanitizeAgentDiscoverySpec(agentDiscoverySpecV1{
		SpecVersion: "gcac.agent-web-discovery/v1",
		Profiles: []agentDiscoveryProfileV1{{
			PluginID: "app.tomcat", FrameworkType: "app.tomcat",
			CertificateFileExtensions: []string{".p12", ".pem"},
		}},
	})
	paths := windowsCertificateReferencesFromConfigContent(
		spec,
		`F:\runtime\Tomcat\conf\server.xml`,
		`<Connector><SSLHostConfig><Certificate certificateKeystoreFile="localhost-rsa.p12" certificateFile="F:\certs\leaf.pem" /></SSLHostConfig></Connector>`,
	)
	if !containsWindowsPath(paths, `F:\runtime\Tomcat\conf\localhost-rsa.p12`) {
		t.Fatalf("Tomcat 相对 keystore 路径未按配置目录解析: %#v", paths)
	}
	if !containsWindowsPath(paths, `F:\certs\leaf.pem`) {
		t.Fatalf("绝对证书路径未保留: %#v", paths)
	}
}

func TestParseWindowsRegistryDiscoveryArgumentsKeepsOnlyDiscoveryArgs(t *testing.T) {
	output := `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\GCAC-Lab-Apache\Parameters
    ConfigArgs    REG_SZ    -d "E:\apps\Apache24" -f conf\httpd-gcac.conf
    Password      REG_SZ    should-not-appear
HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Services\GCAC-Lab-Tomcat\Parameters\Java
    Options    REG_MULTI_SZ    -Dcatalina.base=F:\runtime\Tomcat\0-Djavax.net.ssl.keyStorePassword=changeit
`
	args := strings.Join(parseWindowsRegistryDiscoveryArguments(output), " ")
	if !strings.Contains(args, `-f conf\httpd-gcac.conf`) || !strings.Contains(args, `-Dcatalina.base=F:\runtime\Tomcat`) {
		t.Fatalf("注册表发现参数未保留配置入口: %q", args)
	}
	if strings.Contains(args, "changeit") || strings.Contains(args, "should-not-appear") {
		t.Fatalf("注册表发现参数不应保留敏感值: %q", args)
	}
}

func TestParseWindowsScQueryServicesKeepsServiceNameDisplayNameAndStatus(t *testing.T) {
	output := `SERVICE_NAME: GCAC-Lab-Apache
DISPLAY_NAME: GCAC Lab Apache
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 4  RUNNING

SERVICE_NAME: GCAC-Lab-Tomcat
DISPLAY_NAME: GCAC Lab Tomcat
        TYPE               : 10  WIN32_OWN_PROCESS
        STATE              : 1  STOPPED
`
	services := parseWindowsScQueryServices(output)
	if len(services) != 2 {
		t.Fatalf("sc.exe 服务枚举解析数量错误: %#v", services)
	}
	if services[0]["name"] != "GCAC-Lab-Apache" || services[0]["displayName"] != "GCAC Lab Apache" || services[0]["status"] != "running" {
		t.Fatalf("Apache 服务解析错误: %#v", services[0])
	}
	if services[1]["name"] != "GCAC-Lab-Tomcat" || services[1]["status"] != "stopped" {
		t.Fatalf("Tomcat 服务解析错误: %#v", services[1])
	}
}

func TestWindowsExecutableFromCommandLinePreservesUnquotedPathWithSpaces(t *testing.T) {
	executable := windowsExecutableFromCommandLine(`C:\Program Files\Apache24\bin\httpd.exe -k runservice`)
	if executable != `C:\Program Files\Apache24\bin\httpd.exe` {
		t.Fatalf("未从未加引号的服务 ImagePath 提取 exe: %q", executable)
	}
}

func TestWebInventoryFromFactEnvelopeConvertsGenericFacts(t *testing.T) {
	iis := `<configuration><system.applicationHost><sites><site name="Default Web Site"><bindings><binding protocol="https" bindingInformation="*:443:portal.example.test" /></bindings></site></sites></system.applicationHost></configuration>`
	inventory := webInventoryFromFactEnvelope(map[string]any{"facts": []map[string]any{{
		"kind": "file_content", "path": `C:\Windows\System32\inetsrv\config\applicationHost.config`,
		"contentBase64": base64.StdEncoding.EncodeToString([]byte(iis)),
	}, {
		"kind": "listening_port", "address": "0.0.0.0", "port": 443, "protocol": "tcp",
	}}})
	if len(inventory["configFiles"].([]map[string]any)) != 1 || len(inventory["listeningPorts"].([]map[string]any)) != 1 {
		t.Fatalf("事实中的配置或监听端口未保留: %#v", inventory)
	}
	if len(inventory["frameworks"].([]map[string]any)) != 0 || len(inventory["sites"].([]map[string]any)) != 0 {
		t.Fatalf("Agent Core 不应硬编码产品解析: %#v", inventory)
	}
}

func TestWebInventoryFromFactEnvelopePreservesProcessAndPortAssociation(t *testing.T) {
	inventory := webInventoryFromFactEnvelope(map[string]any{"facts": []map[string]any{
		{"kind": "process", "pid": 4321, "executablePath": `D:\\services\\nginx\\nginx.exe`},
		{"kind": "listening_port", "address": "0.0.0.0", "port": 9443, "protocol": "tcp", "pid": 4321},
	}})
	processes := inventory["processes"].([]map[string]any)
	ports := inventory["listeningPorts"].([]map[string]any)
	if len(processes) != 1 || processes[0]["pid"] != 4321 {
		t.Fatalf("进程事实未保留: %#v", inventory)
	}
	if len(ports) != 1 || ports[0]["pid"] != 4321 {
		t.Fatalf("监听端口与进程 PID 关联未保留: %#v", inventory)
	}
}

func TestWebInventoryFromFactEnvelopeConvertsWindowsCertificateStoreFacts(t *testing.T) {
	inventory := webInventoryFromFactEnvelope(map[string]any{"facts": []map[string]any{{
		"kind": "certificate_store", "store": "My", "storeLocation": "LocalMachine", "thumbprint": "a1 b2 c3 d4 e5 f6 07 08", "subject": "CN=portal.example.test",
	}}})
	certificates := inventory["certificateFiles"].([]map[string]any)
	if len(certificates) != 1 || certificates[0]["thumbprint"] != "A1B2C3D4E5F60708" {
		t.Fatalf("Windows 证书库事实未转换为通用证书文件: %#v", certificates)
	}
}

func TestWebInventoryFromFactEnvelopeConvertsCertificateFileFacts(t *testing.T) {
	inventory := webInventoryFromFactEnvelope(map[string]any{"facts": []map[string]any{{
		"kind": "certificate_file", "path": `C:\nginx\conf\site.crt`, "thumbprint": "11223344556677889900AABBCCDDEEFF00112233", "sha256Fingerprint": strings.Repeat("a", 64), "subject": "CN=site.example.test",
	}}})
	certificates := inventory["certificateFiles"].([]map[string]any)
	if len(certificates) != 1 || certificates[0]["path"] != "C:/nginx/conf/site.crt" || certificates[0]["thumbprint"] != "11223344556677889900AABBCCDDEEFF00112233" {
		t.Fatalf("证书文件事实未转换: %#v", certificates)
	}
}

func TestWebInventoryFromFactEnvelopeConvertsHTTPsysCertificateBindings(t *testing.T) {
	inventory := webInventoryFromFactEnvelope(map[string]any{"facts": []map[string]any{{
		"kind": "ssl_certificate_binding", "address": "0.0.0.0", "port": 443, "thumbprint": "a1 b2 c3 d4 e5 f6 07 08", "store": "MY",
	}}})
	bindings := inventory["sslCertificateBindings"].([]map[string]any)
	if len(bindings) != 1 || bindings[0]["thumbprint"] != "A1B2C3D4E5F60708" {
		t.Fatalf("HTTP.sys SSL 绑定事实未转换: %#v", inventory)
	}
}

func containsWindowsPath(paths []string, expected string) bool {
	expected = strings.ToLower(strings.ReplaceAll(expected, "/", `\`))
	for _, path := range paths {
		if strings.ToLower(strings.ReplaceAll(path, "/", `\`)) == expected {
			return true
		}
	}
	return false
}
