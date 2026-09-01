package main

// 本文件只负责 Linux Agent 侧的 Web 运行事实发现。它不执行部署写操作，也不读取私钥内容。

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type linuxWebDiscoveryState struct {
	frameworks   []map[string]any
	sites        []map[string]any
	certificates []map[string]any
	configs      []map[string]any
	warnings     []map[string]any
	certSeen     map[string]map[string]any
	configSeen   map[string]struct{}
}

type linuxWebRuntime struct {
	frameworkType     string
	displayName       string
	version           string
	programPath       string
	executionPath     string
	programSha256     string
	serviceName       string
	workingDirectory  string
	configPath        string
	configFingerprint string
	configCheckArgs   []string
}

// collectLinuxAuthoritativeWebInventory 只在至少发现一个真实运行框架且成功解析其有效配置时返回。
// 这样旧 Agent 仍可走宿主兼容解析，但不会把空扫描结果当成权威事实。
func collectLinuxAuthoritativeWebInventory() map[string]any {
	state := &linuxWebDiscoveryState{
		frameworks: []map[string]any{}, sites: []map[string]any{}, certificates: []map[string]any{}, configs: []map[string]any{}, warnings: []map[string]any{},
		certSeen: make(map[string]map[string]any), configSeen: make(map[string]struct{}),
	}
	seen := make(map[string]struct{})
	for _, process := range collectLinuxProcesses() {
		executable, _ := process["executablePath"].(string)
		commandLine, _ := process["commandLine"].(string)
		kind := linuxWebProcessKind(executable, commandLine)
		if kind == "nginx" && strings.Contains(strings.ToLower(commandLine), "worker process") && strings.Contains(strings.ToLower(commandLine), "nginx:") {
			continue
		}
		if kind == "" || executable == "" {
			continue
		}
		key := kind + "|" + executable
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		var discovered bool
		switch kind {
		case "apache":
			discovered = discoverLinuxApache(state, process)
		case "nginx":
			discovered = discoverLinuxNginx(state, process)
		case "tomcat":
			discovered = discoverLinuxTomcat(state, process)
		}
		if !discovered {
			delete(seen, key)
		}
	}
	if len(state.frameworks) == 0 || len(state.sites) == 0 {
		return nil
	}
	return map[string]any{
		"scope":            fullWebDiscoveryScope,
		"schemaVersion":    "gcac.web.inventory/v2",
		"frameworks":       state.frameworks,
		"sites":            state.sites,
		"certificateFiles": state.certificates,
		"configFiles":      state.configs,
		"warnings":         state.warnings,
		"diagnostics":      map[string]any{"scanner": "linux-runtime-discovery", "source": "runtime-effective-config"},
	}
}

func linuxWebProcessKind(executablePath, commandLine string) string {
	base := strings.ToLower(filepath.Base(strings.TrimSuffix(executablePath, " (deleted)")))
	switch {
	case base == "apache2" || strings.HasPrefix(base, "httpd") || strings.Contains(base, "apache"):
		return "apache"
	case base == "nginx" || strings.Contains(base, "nginx"):
		return "nginx"
	case (base == "java" || strings.Contains(base, "java")) && strings.Contains(strings.ToLower(commandLine), "org.apache.catalina"):
		return "tomcat"
	}
	fields := strings.Fields(commandLine)
	if len(fields) == 0 {
		return ""
	}
	commandBase := strings.ToLower(filepath.Base(strings.TrimSuffix(fields[0], " (deleted)")))
	if commandBase == "apache2" || strings.HasPrefix(commandBase, "httpd") || strings.Contains(commandBase, "apache") {
		return "apache"
	}
	if commandBase == "nginx" || strings.Contains(commandBase, "nginx") {
		return "nginx"
	}
	return ""
}

func discoverLinuxApache(state *linuxWebDiscoveryState, process map[string]any) bool {
	runtime, root, configPath, args, warning := linuxApacheRuntime(process)
	if warning != "" {
		appendLinuxDiscoveryWarning(state, "APACHE_RUNTIME_DISCOVERY_FAILED", warning, configPath)
		return false
	}
	files, sites, fingerprint, warnings := parseLinuxApacheConfigTree(configPath, root)
	for _, warning := range warnings {
		appendLinuxDiscoveryWarning(state, warning.code, warning.message, warning.path)
	}
	if len(files) == 0 || len(sites) == 0 || fingerprint == "" {
		return false
	}
	runtime.configPath, runtime.configFingerprint, runtime.configCheckArgs = configPath, fingerprint, args
	appendLinuxRuntime(state, runtime, files)
	for _, site := range sites {
		appendLinuxSite(state, runtime, site)
	}
	return true
}

func discoverLinuxNginx(state *linuxWebDiscoveryState, process map[string]any) bool {
	runtime, prefix, configPath, args, warning := linuxNginxRuntime(process)
	if warning != "" {
		appendLinuxDiscoveryWarning(state, "NGINX_RUNTIME_DISCOVERY_FAILED", warning, configPath)
		return false
	}
	files, sites, fingerprint, warnings := parseLinuxNginxConfigTree(configPath, prefix)
	for _, warning := range warnings {
		appendLinuxDiscoveryWarning(state, warning.code, warning.message, warning.path)
	}
	if len(files) == 0 || len(sites) == 0 || fingerprint == "" {
		return false
	}
	runtime.configPath, runtime.configFingerprint, runtime.configCheckArgs = configPath, fingerprint, args
	appendLinuxRuntime(state, runtime, files)
	for _, site := range sites {
		appendLinuxSite(state, runtime, site)
	}
	return true
}

func discoverLinuxTomcat(state *linuxWebDiscoveryState, process map[string]any) bool {
	runtime, base, configPath, args, warning := linuxTomcatRuntime(process)
	if warning != "" {
		appendLinuxDiscoveryWarning(state, "TOMCAT_RUNTIME_DISCOVERY_FAILED", warning, configPath)
		return false
	}
	content, err := os.ReadFile(configPath)
	if err != nil {
		appendLinuxDiscoveryWarning(state, "CONFIG_UNREADABLE", "Tomcat server.xml 不可读", configPath)
		return false
	}
	files, sites, warnings := parseLinuxTomcatServerXML(configPath, base, content)
	for _, warning := range warnings {
		appendLinuxDiscoveryWarning(state, warning.code, warning.message, warning.path)
	}
	if len(sites) == 0 {
		return false
	}
	fingerprint := linuxConfigFingerprint([]string{configPath})
	if fingerprint == "" {
		return false
	}
	runtime.configPath, runtime.configFingerprint, runtime.configCheckArgs = configPath, fingerprint, args
	appendLinuxRuntime(state, runtime, files)
	for _, site := range sites {
		appendLinuxSite(state, runtime, site)
	}
	return true
}

func appendLinuxRuntime(state *linuxWebDiscoveryState, runtime linuxWebRuntime, files []string) {
	metadata := map[string]any{"source": "runtime-effective-config", "configPath": runtime.configPath, "configFingerprint": runtime.configFingerprint, "configCheckArgs": append([]string(nil), runtime.configCheckArgs...), "configCheckArgsTemplate": append([]string(nil), runtime.configCheckArgs...)}
	if runtime.programPath != "" {
		metadata["programPath"] = runtime.programPath
	}
	if runtime.programSha256 != "" {
		metadata["programSha256"] = runtime.programSha256
	}
	if runtime.serviceName != "" {
		metadata["serviceName"] = runtime.serviceName
	}
	if runtime.workingDirectory != "" {
		metadata["workingDirectory"] = runtime.workingDirectory
	}
	state.frameworks = append(state.frameworks, map[string]any{"frameworkType": runtime.frameworkType, "displayName": runtime.displayName, "version": runtime.version, "metadata": metadata})
	for _, file := range files {
		appendLinuxConfig(state, file)
	}
}

func appendLinuxSite(state *linuxWebDiscoveryState, runtime linuxWebRuntime, site map[string]any) {
	metadata, _ := site["metadata"].(map[string]any)
	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata["source"] = "runtime-effective-config"
	metadata["configPath"] = runtime.configPath
	metadata["configFingerprint"] = runtime.configFingerprint
	metadata["programPath"] = runtime.programPath
	metadata["programSha256"] = runtime.programSha256
	metadata["serviceName"] = runtime.serviceName
	metadata["workingDirectory"] = runtime.workingDirectory
	metadata["configCheckArgs"] = append([]string(nil), runtime.configCheckArgs...)
	metadata["configCheckArgsTemplate"] = append([]string(nil), runtime.configCheckArgs...)
	site["metadata"] = metadata
	if name, _ := site["name"].(string); strings.TrimSpace(name) == "" {
		site["name"] = runtime.frameworkType
	}
	state.sites = append(state.sites, site)
	if listeners, ok := metadata["listeners"].([]map[string]any); ok {
		for _, listener := range listeners {
			for key, value := range map[string]any{"serviceName": runtime.serviceName, "programPath": runtime.programPath, "programSha256": runtime.programSha256, "workingDirectory": runtime.workingDirectory, "sourceConfigPath": runtime.configPath, "configFingerprint": runtime.configFingerprint, "configCheckArgs": append([]string(nil), runtime.configCheckArgs...), "configCheckArgsTemplate": append([]string(nil), runtime.configCheckArgs...)} {
				if _, exists := listener[key]; !exists && value != "" {
					listener[key] = value
				}
			}
			if protocol, _ := listener["protocol"].(string); strings.EqualFold(protocol, "HTTPS") {
				appendLinuxListenerCertificate(state, listener)
				if _, ok := listener["keyAlias"].(string); !ok {
					if alias, discovered, ambiguous := discoverLinuxKeyStoreAlias(
						stringFromMap(listener, "keystorePath"),
						stringSlice(listener["keystorePasswords"]),
					); discovered {
						listener["keyAlias"] = alias
					} else if ambiguous {
						listener["keyAliasDiscovery"] = "AMBIGUOUS"
					}
				}
			}
			delete(listener, "keystorePasswords")
		}
	}
}

func appendLinuxListenerCertificate(state *linuxWebDiscoveryState, listener map[string]any) {
	for _, key := range []string{"certificatePath", "keystorePath"} {
		path, _ := listener[key].(string)
		if path == "" {
			continue
		}
		certificate := readLinuxPublicCertificateWithPasswords(path, stringSlice(listener["keystorePasswords"]))
		if certificate == nil {
			continue
		}
		certificate["source"] = "runtime-effective-config"
		certificate["configuredPaths"] = []string{path}
		fingerprint, _ := certificate["sha256Fingerprint"].(string)
		if fingerprint == "" {
			continue
		}
		if existing := state.certSeen[fingerprint]; existing != nil {
			configured, _ := existing["configuredPaths"].([]string)
			if !containsString(configured, path) {
				existing["configuredPaths"] = append(configured, path)
			}
			continue
		}
		state.certSeen[fingerprint] = certificate
		state.certificates = append(state.certificates, certificate)
		listener["certificatePath"] = path
		return
	}
}

func appendLinuxConfig(state *linuxWebDiscoveryState, path string) {
	path = filepath.Clean(path)
	if _, exists := state.configSeen[path]; exists {
		return
	}
	state.configSeen[path] = struct{}{}
	state.configs = append(state.configs, map[string]any{"path": path, "source": "runtime-effective-config"})
}

type linuxDiscoveryWarning struct{ code, message, path string }

func appendLinuxDiscoveryWarning(state *linuxWebDiscoveryState, code, message, path string) {
	for _, existing := range state.warnings {
		if existing["code"] == code && existing["path"] == path {
			return
		}
	}
	state.warnings = append(state.warnings, map[string]any{"code": code, "message": message, "path": path})
}

func linuxProcessRuntime(process map[string]any) linuxWebRuntime {
	executable, _ := process["executablePath"].(string)
	pid, _ := process["pid"].(int)
	executionPath := executable
	if !fileExists(executionPath) {
		if procPath, ok := process["procExecutablePath"].(string); ok && isLinuxProcExecutablePath(procPath) {
			executionPath = procPath
		}
	}
	workingDirectory := ""
	serviceName := ""
	if pid > 0 {
		workingDirectory, _ = os.Readlink(filepath.Join("/proc", strconv.Itoa(pid), "cwd"))
		serviceName = linuxServiceNameForPID(pid)
	}
	programSha256, _ := sha256FileDigest(executionPath)
	return linuxWebRuntime{programPath: executable, executionPath: executionPath, programSha256: programSha256, workingDirectory: filepath.Clean(workingDirectory), serviceName: serviceName}
}

func linuxServiceNameForPID(pid int) string {
	content, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "cgroup"))
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(content), "\n") {
		for _, part := range strings.Split(line, "/") {
			if strings.HasSuffix(part, ".service") && validLinuxServiceName(part) {
				return part
			}
		}
	}
	return ""
}

func runLinuxProgram(path string, env []string, args ...string) (string, error) {
	if !filepath.IsAbs(path) || (!fileExists(path) && !isLinuxProcExecutablePath(path)) {
		return "", errors.New("运行程序路径不可用")
	}
	command := exec.Command(path, args...)
	command.Dir = "/"
	command.Env = append(os.Environ(), env...)
	output, err := command.CombinedOutput()
	return strings.TrimSpace(string(output)), err
}

func isLinuxProcExecutablePath(path string) bool {
	if !strings.HasPrefix(filepath.Clean(path), "/proc/") || !strings.HasSuffix(path, "/exe") {
		return false
	}
	parts := strings.Split(filepath.Clean(path), "/")
	return len(parts) == 4 && parts[2] != "" && isDecimalString(parts[2])
}

func isDecimalString(value string) bool {
	if value == "" {
		return false
	}
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func linuxApacheRuntime(process map[string]any) (linuxWebRuntime, string, string, []string, string) {
	runtime := linuxProcessRuntime(process)
	runtime.frameworkType = "web.apache"
	runtime.displayName = "Apache"
	environment := linuxApacheEnv()
	version, err := runLinuxProgram(runtime.executionPath, environment, "-V")
	if err != nil && version == "" {
		return runtime, "", "", nil, fmt.Sprintf("Apache -V 失败: %v", err)
	}
	runtime.version = linuxApacheVersion(version)
	root, configPath := linuxApachePaths(version, stringFromMap(process, "commandLine"), runtime.workingDirectory)
	if root == "" || configPath == "" {
		return runtime, root, "", nil, "Apache -V 未提供 HTTPD_ROOT/SERVER_CONFIG_FILE"
	}
	return runtime, filepath.Clean(root), filepath.Clean(configPath), []string{"-t", "-d", filepath.Clean(root), "-f", filepath.Clean(configPath)}, ""
}

// linuxApachePaths 合并编译默认值与运行进程的 -d/-f 覆盖，保证解析的是实际生效配置。
// Apache 的相对 -f 路径以有效 ServerRoot 为基准；相对 -d 路径以进程工作目录为基准。
func linuxApachePaths(output, commandLine, workingDirectory string) (string, string) {
	root := linuxApacheDefine(output, "HTTPD_ROOT")
	if root == "" {
		root = linuxApacheDefine(output, "SERVER_ROOT")
	}
	if override := linuxCommandLineArg(commandLine, "-d"); override != "" {
		if filepath.IsAbs(override) {
			root = override
		} else if filepath.IsAbs(workingDirectory) {
			root = filepath.Join(workingDirectory, override)
		}
	}
	if root != "" {
		root = filepath.Clean(root)
	}
	configName := linuxApacheDefine(output, "SERVER_CONFIG_FILE")
	if override := linuxCommandLineArg(commandLine, "-f"); override != "" {
		configName = override
	}
	if configName == "" {
		return root, ""
	}
	if filepath.IsAbs(configName) {
		return root, filepath.Clean(configName)
	}
	return root, filepath.Clean(filepath.Join(root, configName))
}

func linuxApacheDefine(output, name string) string {
	pattern := regexp.MustCompile(`-D\s+` + regexp.QuoteMeta(name) + `="([^"]+)"`)
	match := pattern.FindStringSubmatch(output)
	if len(match) > 1 {
		return strings.TrimSpace(match[1])
	}
	return ""
}

func linuxApacheEnv() []string {
	values := make([]string, 0, 8)
	for _, path := range []string{"/etc/apache2/envvars", "/etc/httpd/envvars"} {
		content, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		for _, line := range strings.Split(string(content), "\n") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
			parts := strings.SplitN(line, "=", 2)
			if len(parts) != 2 || !regexp.MustCompile(`^[A-Z][A-Z0-9_]*$`).MatchString(parts[0]) {
				continue
			}
			value := strings.Trim(strings.TrimSpace(parts[1]), "\"'")
			if value != "" && !strings.Contains(value, "${") {
				values = append(values, parts[0]+"="+value)
			}
		}
		break
	}
	return values
}

func linuxNginxRuntime(process map[string]any) (linuxWebRuntime, string, string, []string, string) {
	runtime := linuxProcessRuntime(process)
	runtime.frameworkType = "web.nginx"
	runtime.displayName = "NGINX"
	version, err := runLinuxProgram(runtime.executionPath, nil, "-V")
	if err != nil && version == "" {
		return runtime, "", "", nil, fmt.Sprintf("NGINX -V 失败: %v", err)
	}
	runtime.version = linuxNginxVersion(version)
	prefix := linuxNginxDefine(version, `--prefix=`)
	configPath := linuxNginxDefine(version, `--conf-path=`)
	commandLine, _ := process["commandLine"].(string)
	if value := linuxCommandLineArg(commandLine, "-p"); value != "" {
		prefix = value
	}
	if value := linuxCommandLineArg(commandLine, "-c"); value != "" {
		configPath = value
	}
	if prefix == "" || configPath == "" {
		return runtime, prefix, configPath, nil, "NGINX -V 未提供 --prefix/--conf-path"
	}
	if !filepath.IsAbs(configPath) {
		configPath = filepath.Join(prefix, configPath)
	}
	return runtime, filepath.Clean(prefix), filepath.Clean(configPath), []string{"-t", "-p", filepath.Clean(prefix), "-c", filepath.Clean(configPath)}, ""
}

func linuxNginxDefine(output, prefix string) string {
	for _, line := range strings.Fields(output) {
		if strings.HasPrefix(line, prefix) {
			return strings.Trim(strings.TrimPrefix(line, prefix), "\"'")
		}
	}
	return ""
}

func linuxCommandLineArg(commandLine, name string) string {
	fields := strings.Fields(commandLine)
	for index, field := range fields {
		if field == name && index+1 < len(fields) {
			return strings.Trim(fields[index+1], "\"'")
		}
		if strings.HasPrefix(field, name) && len(field) > len(name) {
			return strings.TrimPrefix(strings.Trim(field, "\"'"), name)
		}
	}
	return ""
}

func linuxTomcatRuntime(process map[string]any) (linuxWebRuntime, string, string, []string, string) {
	runtime := linuxProcessRuntime(process)
	runtime.frameworkType = "app.tomcat"
	runtime.displayName = "Tomcat"
	commandLine, _ := process["commandLine"].(string)
	base := linuxJavaProperty(commandLine, "catalina.base")
	if base == "" {
		base = linuxJavaProperty(commandLine, "catalina.home")
	}
	if base == "" || !filepath.IsAbs(base) {
		return runtime, base, "", nil, "Tomcat 运行参数未提供绝对 catalina.base/home"
	}
	home := linuxJavaProperty(commandLine, "catalina.home")
	if home == "" {
		home = base
	}
	runtime.version = linuxTomcatVersion(runtime.executionPath, home)
	configPath := filepath.Join(base, "conf", "server.xml")
	return runtime, filepath.Clean(base), configPath, []string{"-Dcatalina.base=" + filepath.Clean(base), "-Dcatalina.home=" + filepath.Clean(home), "-cp", filepath.Join(filepath.Clean(home), "bin", "bootstrap.jar"), "org.apache.catalina.startup.Bootstrap", "configtest"}, ""
}

// 版本号必须来自正在运行程序的真实输出；无法取得时保留空值，禁止猜测。
func linuxApacheVersion(output string) string {
	return firstLinuxVersion(output, `(?i)Apache/([0-9]+(?:\.[0-9]+)+)`)
}

func linuxNginxVersion(output string) string {
	return firstLinuxVersion(output, `(?i)nginx/([0-9]+(?:\.[0-9]+)+)`)
}

func linuxTomcatVersion(javaPath, home string) string {
	if !filepath.IsAbs(home) {
		return ""
	}
	jar := filepath.Join(home, "lib", "catalina.jar")
	output, err := runLinuxProgram(javaPath, nil, "-cp", jar, "org.apache.catalina.util.ServerInfo")
	if err != nil && output == "" {
		return ""
	}
	return firstLinuxVersion(output, `(?i)Apache\s+Tomcat/([0-9]+(?:\.[0-9]+)+)`)
}

func firstLinuxVersion(output, pattern string) string {
	match := regexp.MustCompile(pattern).FindStringSubmatch(output)
	if len(match) < 2 {
		return ""
	}
	return strings.TrimSpace(match[1])
}

func linuxJavaProperty(commandLine, name string) string {
	prefix := "-D" + name + "="
	for _, field := range strings.Fields(commandLine) {
		if strings.HasPrefix(field, prefix) {
			return strings.Trim(strings.TrimPrefix(field, prefix), "\"'")
		}
	}
	return ""
}

func stringSlice(value any) []string {
	items, ok := value.([]string)
	if ok {
		return items
	}
	array, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(array))
	for _, item := range array {
		if text, ok := item.(string); ok {
			result = append(result, text)
		}
	}
	return result
}

func linuxConfigFingerprint(paths []string) string {
	unique := make(map[string]struct{})
	for _, path := range paths {
		if path != "" {
			unique[filepath.Clean(path)] = struct{}{}
		}
	}
	ordered := make([]string, 0, len(unique))
	for path := range unique {
		ordered = append(ordered, path)
	}
	sort.Strings(ordered)
	hash := sha256.New()
	for _, path := range ordered {
		content, err := os.ReadFile(path)
		if err != nil {
			return ""
		}
		_, _ = hash.Write([]byte(path))
		_, _ = hash.Write([]byte{0})
		_, _ = hash.Write(content)
		_, _ = hash.Write([]byte{0})
	}
	return hex.EncodeToString(hash.Sum(nil))
}

type linuxApacheState struct {
	files     []string
	sites     []map[string]any
	visited   map[string]struct{}
	root      string
	warnings  []linuxDiscoveryWarning
	listeners []map[string]any
	template  map[string]any
}

func parseLinuxApacheConfigTree(configPath, root string) ([]string, []map[string]any, string, []linuxDiscoveryWarning) {
	// 全局 Apache 指令也会复用指令解析器；必须提供完整的站点结构，
	// 否则真实配置中的 ServerName、SSLProtocol 等全局指令会写入 nil metadata 并使 Agent 崩溃。
	state := &linuxApacheState{
		visited:   map[string]struct{}{},
		root:      root,
		listeners: []map[string]any{},
		template:  linuxApacheSite("apache-global", nil, configPath),
	}
	parseLinuxApacheFile(filepath.Clean(configPath), state, -1)
	if len(state.sites) == 0 && len(state.listeners) > 0 {
		state.sites = append(state.sites, linuxApacheSite("apache-main", state.listeners, configPath))
	}
	if len(state.sites) == 0 {
		return state.files, nil, "", state.warnings
	}
	for _, site := range state.sites {
		listeners, _ := site["metadata"].(map[string]any)
		_ = listeners
	}
	return state.files, state.sites, linuxConfigFingerprint(state.files), state.warnings
}

func parseLinuxApacheFile(path string, state *linuxApacheState, activeSite int) {
	path = filepath.Clean(path)
	visitKey := fmt.Sprintf("%s|%d", path, activeSite)
	if _, exists := state.visited[visitKey]; exists {
		return
	}
	state.visited[visitKey] = struct{}{}
	content, err := os.ReadFile(path)
	if err != nil {
		state.warnings = append(state.warnings, linuxDiscoveryWarning{"CONFIG_UNREADABLE", "Apache 配置文件不可读", path})
		return
	}
	state.files = appendUniqueString(state.files, path)
	current := activeSite
	for _, raw := range strings.Split(string(content), "\n") {
		line := strings.TrimSpace(stripLinuxConfigComment(raw))
		if line == "" {
			continue
		}
		fields := strings.Fields(strings.TrimSuffix(line, ";"))
		if len(fields) == 0 {
			continue
		}
		directive := strings.ToLower(fields[0])
		if strings.HasPrefix(strings.ToLower(line), "<virtualhost") {
			arguments := strings.TrimSpace(strings.TrimSuffix(line[len("<VirtualHost"):], ">"))
			site := linuxApacheSite(arguments, nil, path)
			state.sites = append(state.sites, site)
			current = len(state.sites) - 1
			for _, value := range strings.Fields(arguments) {
				state.sites[current]["metadata"].(map[string]any)["listeners"] = append(state.sites[current]["metadata"].(map[string]any)["listeners"].([]map[string]any), linuxApacheListener(value, path))
			}
			continue
		}
		if strings.HasPrefix(line, "</virtualhost") {
			current = activeSite
			continue
		}
		if directive == "include" || directive == "includeoptional" {
			if len(fields) > 1 {
				include := strings.Trim(fields[1], "\"'")
				matches := linuxIncludeMatches(include, filepath.Dir(path), state.root)
				if len(matches) == 0 && directive == "include" {
					state.warnings = append(state.warnings, linuxDiscoveryWarning{code: "INCLUDE_UNRESOLVED", message: "Apache Include 未解析到文件", path: include})
				}
				for _, match := range matches {
					parseLinuxApacheFile(match, state, current)
				}
			}
			continue
		}
		if current >= 0 && current < len(state.sites) {
			applyLinuxApacheDirective(state.sites[current], directive, fields[1:], path)
		} else {
			applyLinuxApacheGlobal(state, directive, fields[1:], path)
		}
	}
}

func linuxApacheSite(name string, listeners []map[string]any, path string) map[string]any {
	if listeners == nil {
		listeners = []map[string]any{}
	}
	return map[string]any{"frameworkType": "web.apache", "name": strings.TrimSpace(name), "serverNames": []string{}, "addresses": []string{}, "port": 0, "protocol": "HTTP", "metadata": map[string]any{"configPath": path, "configFiles": []string{path}, "listeners": listeners}}
}

func linuxApacheListener(value, path string) map[string]any {
	address, port := "*", 80
	value = strings.TrimSpace(value)
	if index := strings.LastIndex(value, ":"); index >= 0 {
		address = strings.Trim(value[:index], "[]")
		if parsed, err := strconv.Atoi(value[index+1:]); err == nil {
			port = parsed
		}
	} else if parsed, err := strconv.Atoi(value); err == nil {
		port = parsed
	}
	return map[string]any{"address": address, "port": port, "protocol": "HTTP", "host": "", "sourceConfigPath": path}
}

func applyLinuxApacheGlobal(state *linuxApacheState, directive string, args []string, path string) {
	if directive == "listen" && len(args) > 0 {
		state.listeners = append(state.listeners, linuxApacheListener(args[0], path))
		return
	}
	applyLinuxApacheDirective(state.template, directive, args, path)
}

func applyLinuxApacheDirective(site map[string]any, directive string, args []string, path string) {
	metadata, _ := site["metadata"].(map[string]any)
	listeners, _ := metadata["listeners"].([]map[string]any)
	if len(args) == 0 {
		return
	}
	switch directive {
	case "servername":
		site["name"] = args[0]
		site["serverNames"] = appendUniqueString(site["serverNames"].([]string), args[0])
	case "serveralias":
		for _, value := range args {
			site["serverNames"] = appendUniqueString(site["serverNames"].([]string), value)
		}
	case "listen":
		listeners = append(listeners, linuxApacheListener(args[0], path))
	case "sslengine":
		if strings.EqualFold(args[0], "on") {
			for _, listener := range listeners {
				listener["protocol"] = "HTTPS"
			}
		}
	case "sslcertificatefile":
		for _, listener := range listeners {
			listener["certificatePath"] = linuxResolveConfigPath(args[0], path, "")
		}
	case "sslcertificatekeyfile":
		for _, listener := range listeners {
			listener["certificateKeyPath"] = linuxResolveConfigPath(args[0], path, "")
		}
	case "sslcertificatechainfile":
		for _, listener := range listeners {
			listener["certificateChainPath"] = linuxResolveConfigPath(args[0], path, "")
		}
	}
	metadata["listeners"] = listeners
	metadata["configFiles"] = appendUniqueString(metadata["configFiles"].([]string), path)
	site["metadata"] = metadata
	for _, listener := range listeners {
		if host, _ := listener["host"].(string); host != "" {
			site["addresses"] = appendUniqueString(site["addresses"].([]string), host)
		}
	}
	if len(listeners) > 0 {
		primary := listeners[0]
		site["port"] = primary["port"]
		site["protocol"] = primary["protocol"]
	}
}

type linuxNginxState struct {
	files    []string
	sites    []map[string]any
	visited  map[string]struct{}
	prefix   string
	warnings []linuxDiscoveryWarning
}

func parseLinuxNginxConfigTree(configPath, prefix string) ([]string, []map[string]any, string, []linuxDiscoveryWarning) {
	state := &linuxNginxState{visited: map[string]struct{}{}, prefix: prefix}
	parseLinuxNginxFile(filepath.Clean(configPath), state, -1)
	return state.files, state.sites, linuxConfigFingerprint(state.files), state.warnings
}

func parseLinuxNginxFile(path string, state *linuxNginxState, activeSite int) {
	path = filepath.Clean(path)
	key := fmt.Sprintf("%s|%d", path, activeSite)
	if _, exists := state.visited[key]; exists {
		return
	}
	state.visited[key] = struct{}{}
	content, err := os.ReadFile(path)
	if err != nil {
		state.warnings = append(state.warnings, linuxDiscoveryWarning{"CONFIG_UNREADABLE", "NGINX 配置文件不可读", path})
		return
	}
	state.files = appendUniqueString(state.files, path)
	current := activeSite
	depth, siteDepth := 0, -1
	for _, raw := range strings.Split(string(content), "\n") {
		line := strings.TrimSpace(stripLinuxConfigComment(raw))
		if line == "" {
			continue
		}
		fields := strings.Fields(strings.TrimSuffix(line, ";"))
		if len(fields) == 0 {
			continue
		}
		if strings.HasPrefix(line, "server") && strings.Contains(line, "{") {
			state.sites = append(state.sites, linuxNginxSite(path))
			current = len(state.sites) - 1
			depth += strings.Count(line, "{") - strings.Count(line, "}")
			siteDepth = depth
			continue
		}
		if line == "}" || strings.HasPrefix(line, "}") {
			depth -= strings.Count(line, "}")
			if siteDepth >= 0 && depth < siteDepth {
				current, siteDepth = activeSite, -1
			}
			continue
		}
		directive := strings.ToLower(fields[0])
		if directive == "include" && len(fields) > 1 {
			include := strings.Trim(fields[1], "\"'")
			for _, match := range linuxIncludeMatches(include, filepath.Dir(path), state.prefix) {
				parseLinuxNginxFile(match, state, current)
			}
			continue
		}
		if current < 0 || current >= len(state.sites) {
			depth += strings.Count(line, "{") - strings.Count(line, "}")
			continue
		}
		applyLinuxNginxDirective(state.sites[current], directive, fields[1:], path, state.prefix)
		depth += strings.Count(line, "{") - strings.Count(line, "}")
	}
}

func linuxNginxSite(path string) map[string]any {
	return map[string]any{"frameworkType": "web.nginx", "name": "", "serverNames": []string{}, "addresses": []string{}, "port": 0, "protocol": "HTTP", "metadata": map[string]any{"configPath": path, "configFiles": []string{path}, "listeners": []map[string]any{}}}
}

func applyLinuxNginxDirective(site map[string]any, directive string, args []string, path, prefix string) {
	metadata := site["metadata"].(map[string]any)
	listeners := metadata["listeners"].([]map[string]any)
	switch directive {
	case "listen":
		if len(args) == 0 {
			return
		}
		value := strings.Trim(args[0], "\"'")
		address, port := "*", 80
		if index := strings.LastIndex(value, ":"); index >= 0 {
			address = strings.Trim(value[:index], "[]")
			port, _ = strconv.Atoi(value[index+1:])
		} else if parsed, err := strconv.Atoi(value); err == nil {
			port = parsed
		}
		protocol := "HTTP"
		for _, arg := range args[1:] {
			if strings.EqualFold(arg, "ssl") {
				protocol = "HTTPS"
			}
		}
		listeners = append(listeners, map[string]any{"address": address, "port": port, "protocol": protocol, "host": "", "sourceConfigPath": path})
	case "server_name":
		if len(args) > 0 {
			site["name"] = args[0]
			for _, name := range args {
				site["serverNames"] = appendUniqueString(site["serverNames"].([]string), name)
			}
		}
	case "ssl_certificate":
		if len(args) > 0 {
			for _, listener := range listeners {
				listener["certificatePath"] = linuxResolveConfigPath(args[0], path, prefix)
				listener["protocol"] = "HTTPS"
			}
		}
	case "ssl_certificate_key":
		if len(args) > 0 {
			for _, listener := range listeners {
				listener["certificateKeyPath"] = linuxResolveConfigPath(args[0], path, prefix)
			}
		}
	}
	metadata["listeners"] = listeners
	metadata["configFiles"] = appendUniqueString(metadata["configFiles"].([]string), path)
	site["metadata"] = metadata
	if len(listeners) > 0 {
		site["port"] = listeners[0]["port"]
		site["protocol"] = listeners[0]["protocol"]
	}
}

func linuxIncludeMatches(value, base, root string) []string {
	value = strings.Trim(strings.TrimSpace(value), "\"'")
	if value == "" {
		return nil
	}
	candidates := []string{value}
	if !filepath.IsAbs(value) {
		candidates = []string{filepath.Join(root, value), filepath.Join(base, value)}
	}
	seen := make(map[string]struct{})
	result := make([]string, 0)
	for _, candidate := range candidates {
		matches, _ := filepath.Glob(filepath.Clean(candidate))
		sort.Strings(matches)
		for _, match := range matches {
			match = filepath.Clean(match)
			if _, exists := seen[match]; exists {
				continue
			}
			if info, err := os.Stat(match); err == nil && info.Mode().IsRegular() {
				seen[match] = struct{}{}
				result = append(result, match)
			}
		}
	}
	return result
}

func linuxResolveConfigPath(value, source, root string) string {
	value = strings.Trim(strings.TrimSpace(value), "\"'")
	if value == "" {
		return ""
	}
	if filepath.IsAbs(value) {
		return filepath.Clean(value)
	}
	base := filepath.Dir(source)
	if root != "" && strings.HasPrefix(value, "conf/") {
		base = root
	}
	return filepath.Clean(filepath.Join(base, value))
}

func linuxResolveTomcatPath(value, source, base string) string {
	value = strings.Trim(strings.TrimSpace(value), "\"'")
	if value == "" {
		return ""
	}
	if filepath.IsAbs(value) {
		return filepath.Clean(value)
	}
	if strings.HasPrefix(filepath.ToSlash(value), "conf/") {
		return filepath.Clean(filepath.Join(base, value))
	}
	return filepath.Clean(filepath.Join(base, "conf", value))
}

func stripLinuxConfigComment(line string) string {
	if index := strings.Index(line, "#"); index >= 0 {
		return line[:index]
	}
	return line
}

func appendUniqueString(values []string, value string) []string {
	value = strings.TrimSpace(value)
	if value == "" || containsString(values, value) {
		return values
	}
	return append(values, value)
}

type linuxTomcatServerXML struct {
	Services []linuxTomcatService `xml:"Service"`
}
type linuxTomcatService struct {
	Connectors []linuxTomcatConnector `xml:"Connector"`
	Engine     linuxTomcatEngine      `xml:"Engine"`
}
type linuxTomcatEngine struct {
	Hosts []linuxTomcatHost `xml:"Host"`
}
type linuxTomcatHost struct {
	Name string `xml:"name,attr"`
}
type linuxTomcatConnector struct {
	Port                        int                        `xml:"port,attr"`
	Address                     string                     `xml:"address,attr"`
	Protocol                    string                     `xml:"protocol,attr"`
	SSLEnabled                  string                     `xml:"SSLEnabled,attr"`
	Scheme                      string                     `xml:"scheme,attr"`
	Secure                      string                     `xml:"secure,attr"`
	CertificateFile             string                     `xml:"certificateFile,attr"`
	CertificateKeyFile          string                     `xml:"certificateKeyFile,attr"`
	CertificateChainFile        string                     `xml:"certificateChainFile,attr"`
	CertificateKeystoreFile     string                     `xml:"certificateKeystoreFile,attr"`
	KeystoreFile                string                     `xml:"keystoreFile,attr"`
	CertificateKeystoreType     string                     `xml:"certificateKeystoreType,attr"`
	KeystoreType                string                     `xml:"keystoreType,attr"`
	CertificateKeystorePassword string                     `xml:"keystorePass,attr"`
	CertificateKeyAlias         string                     `xml:"certificateKeyAlias,attr"`
	SSLHostConfigs              []linuxTomcatSSLHostConfig `xml:"SSLHostConfig"`
}
type linuxTomcatSSLHostConfig struct {
	HostName                string                   `xml:"hostName,attr"`
	CertificateKeystoreType string                   `xml:"certificateKeystoreType,attr"`
	KeystoreType            string                   `xml:"keystoreType,attr"`
	KeystorePass            string                   `xml:"keystorePass,attr"`
	Certificates            []linuxTomcatCertificate `xml:"Certificate"`
}
type linuxTomcatCertificate struct {
	CertificateFile             string `xml:"certificateFile,attr"`
	CertificateKeyFile          string `xml:"certificateKeyFile,attr"`
	CertificateChainFile        string `xml:"certificateChainFile,attr"`
	CertificateKeystoreFile     string `xml:"certificateKeystoreFile,attr"`
	KeystoreFile                string `xml:"keystoreFile,attr"`
	CertificateKeystoreType     string `xml:"certificateKeystoreType,attr"`
	KeystoreType                string `xml:"keystoreType,attr"`
	CertificateKeystorePassword string `xml:"keystorePass,attr"`
	CertificateKeyAlias         string `xml:"certificateKeyAlias,attr"`
}

func parseLinuxTomcatServerXML(configPath, base string, content []byte) ([]string, []map[string]any, []linuxDiscoveryWarning) {
	var document linuxTomcatServerXML
	if err := xml.Unmarshal(content, &document); err != nil {
		return []string{configPath}, nil, []linuxDiscoveryWarning{{"CONFIG_PARSE_FAILED", "Tomcat server.xml XML 解析失败", configPath}}
	}
	hosts := make([]string, 0)
	for _, service := range document.Services {
		for _, host := range service.Engine.Hosts {
			if strings.TrimSpace(host.Name) != "" {
				hosts = appendUniqueString(hosts, host.Name)
			}
		}
	}
	warnings := make([]linuxDiscoveryWarning, 0)
	sites := make([]map[string]any, 0)
	for _, service := range document.Services {
		for _, connector := range service.Connectors {
			if connector.Port <= 0 {
				continue
			}
			ssl := strings.EqualFold(connector.SSLEnabled, "true") || strings.EqualFold(connector.Scheme, "https") || strings.EqualFold(connector.Secure, "true") || strings.Contains(strings.ToLower(connector.Protocol), "https")
			if !ssl {
				continue
			}
			configs := connector.SSLHostConfigs
			if len(configs) == 0 {
				configs = []linuxTomcatSSLHostConfig{{}}
			}
			listeners := make([]map[string]any, 0, len(configs))
			for _, sslConfig := range configs {
				certs := sslConfig.Certificates
				if len(certs) == 0 {
					certs = []linuxTomcatCertificate{{}}
				}
				certificate := certs[0]
				listener := map[string]any{"address": firstNonEmptyLinux(connector.Address, "*"), "port": connector.Port, "protocol": "HTTPS", "host": sslConfig.HostName, "sourceConfigPath": configPath}
				certificatePath := firstNonEmptyLinux(certificate.CertificateFile, connector.CertificateFile)
				keyPath := firstNonEmptyLinux(certificate.CertificateKeyFile, connector.CertificateKeyFile)
				chainPath := firstNonEmptyLinux(certificate.CertificateChainFile, connector.CertificateChainFile)
				keystorePath := firstNonEmptyLinux(certificate.CertificateKeystoreFile, certificate.KeystoreFile, connector.CertificateKeystoreFile, connector.KeystoreFile)
				if certificatePath != "" {
					listener["certificatePath"] = linuxResolveTomcatPath(certificatePath, configPath, base)
				}
				if keyPath != "" {
					listener["certificateKeyPath"] = linuxResolveTomcatPath(keyPath, configPath, base)
				}
				if chainPath != "" {
					listener["certificateChainPath"] = linuxResolveTomcatPath(chainPath, configPath, base)
				}
				if keystorePath != "" {
					resolved := linuxResolveTomcatPath(keystorePath, configPath, base)
					listener["keystorePath"] = resolved
					keystoreType := firstNonEmptyLinux(certificate.CertificateKeystoreType, certificate.KeystoreType, sslConfig.CertificateKeystoreType, sslConfig.KeystoreType, connector.CertificateKeystoreType, connector.KeystoreType)
					if keystoreType == "" {
						keystoreType = linuxKeystoreType(resolved)
					}
					listener["keystoreType"] = keystoreType
					password := firstNonEmptyLinux(certificate.CertificateKeystorePassword, sslConfig.KeystorePass, connector.CertificateKeystorePassword)
					if password != "" {
						listener["keystorePasswords"] = []string{password}
					}
					if alias := firstNonEmptyLinux(certificate.CertificateKeyAlias, connector.CertificateKeyAlias); alias != "" {
						listener["keyAlias"] = alias
					}
				}
				listeners = append(listeners, listener)
			}
			name := firstNonEmptyLinux(sslHostName(listeners), firstNonEmptyLinuxSlice(hosts, "tomcat"))
			metadata := map[string]any{"configPath": configPath, "configFiles": []string{configPath}, "listeners": listeners}
			sites = append(sites, map[string]any{"frameworkType": "app.tomcat", "name": name, "serverNames": hosts, "addresses": []string{}, "port": connector.Port, "protocol": "HTTPS", "metadata": metadata})
		}
	}
	return []string{configPath}, sites, warnings
}

func sslHostName(listeners []map[string]any) string {
	for _, listener := range listeners {
		if value, _ := listener["host"].(string); strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
func firstNonEmptyLinux(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
func firstNonEmptyLinuxSlice(values []string, fallback string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return fallback
}
func linuxKeystoreType(path string) string {
	lower := strings.ToLower(path)
	if strings.HasSuffix(lower, ".p12") || strings.HasSuffix(lower, ".pfx") {
		return "PKCS12"
	}
	if strings.HasSuffix(lower, ".jks") || strings.HasSuffix(lower, ".keystore") {
		return "JKS"
	}
	return "UNKNOWN"
}
