package main

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"encoding/xml"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"

	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

type windowsDiscoveryWarning struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Path    string `json:"path,omitempty"`
}

type windowsCertificateSummary struct {
	FingerprintSHA256 string `json:"fingerprintSha256,omitempty"`
	Subject           string `json:"subject,omitempty"`
	Issuer            string `json:"issuer,omitempty"`
	NotBefore         string `json:"notBefore,omitempty"`
	NotAfter          string `json:"notAfter,omitempty"`
}

type windowsRuntimeListener struct {
	Address              string                     `json:"address,omitempty"`
	Port                 int                        `json:"port"`
	Protocol             string                     `json:"protocol,omitempty"`
	HostHeader           string                     `json:"hostHeader,omitempty"`
	BindingInformation   string                     `json:"bindingInformation,omitempty"`
	CertificatePath      string                     `json:"certificatePath,omitempty"`
	CertificateKeyPath   string                     `json:"certificateKeyPath,omitempty"`
	CertificateChainPath string                     `json:"certificateChainPath,omitempty"`
	KeystorePath         string                     `json:"keystorePath,omitempty"`
	KeystoreType         string                     `json:"keystoreType,omitempty"`
	KeyAlias             string                     `json:"keyAlias,omitempty"`
	ConfigFingerprint    string                     `json:"configFingerprint,omitempty"`
	Certificate          *windowsCertificateSummary `json:"certificate,omitempty"`
}

type windowsRuntimeSite struct {
	ID                string                   `json:"id,omitempty"`
	Name              string                   `json:"name"`
	ServerNames       []string                 `json:"serverNames,omitempty"`
	SitePath          string                   `json:"sitePath,omitempty"`
	Listen            []windowsRuntimeListener `json:"listen,omitempty"`
	ConfigFiles       []string                 `json:"configFiles,omitempty"`
	ConfigFingerprint string                   `json:"configFingerprint,omitempty"`
}

type windowsNginxDetail struct {
	Installed         bool                      `json:"installed"`
	Running           bool                      `json:"running"`
	Version           string                    `json:"version,omitempty"`
	BinaryPath        string                    `json:"binaryPath,omitempty"`
	ConfigRoot        string                    `json:"configRoot,omitempty"`
	ConfigPath        string                    `json:"configPath,omitempty"`
	IncludeFiles      []string                  `json:"includeFiles,omitempty"`
	Sites             []windowsRuntimeSite      `json:"sites,omitempty"`
	ConfigFingerprint string                    `json:"configFingerprint,omitempty"`
	Warnings          []windowsDiscoveryWarning `json:"warnings,omitempty"`
}

type windowsApacheDetail struct {
	Installed         bool                      `json:"installed"`
	Running           bool                      `json:"running"`
	Version           string                    `json:"version,omitempty"`
	BinaryPath        string                    `json:"binaryPath,omitempty"`
	ServerRoot        string                    `json:"serverRoot,omitempty"`
	ConfigPath        string                    `json:"configPath,omitempty"`
	ServiceName       string                    `json:"serviceName,omitempty"`
	ServiceStatus     string                    `json:"serviceStatus,omitempty"`
	IncludeFiles      []string                  `json:"includeFiles,omitempty"`
	Sites             []windowsRuntimeSite      `json:"sites,omitempty"`
	ConfigFingerprint string                    `json:"configFingerprint,omitempty"`
	Warnings          []windowsDiscoveryWarning `json:"warnings,omitempty"`
}

type windowsTomcatDetail struct {
	Installed         bool                      `json:"installed"`
	Running           bool                      `json:"running"`
	Version           string                    `json:"version,omitempty"`
	JavaPath          string                    `json:"javaPath,omitempty"`
	TomcatPath        string                    `json:"tomcatPath,omitempty"`
	ServiceName       string                    `json:"serviceName,omitempty"`
	ServiceStatus     string                    `json:"serviceStatus,omitempty"`
	ConfigPath        string                    `json:"configPath,omitempty"`
	Connectors        []windowsRuntimeListener  `json:"connectors,omitempty"`
	Hosts             []string                  `json:"hosts,omitempty"`
	ConfigFingerprint string                    `json:"configFingerprint,omitempty"`
	Warnings          []windowsDiscoveryWarning `json:"warnings,omitempty"`
}

type windowsRuntimeProcessFact struct {
	Name           string `json:"name,omitempty"`
	ExecutablePath string `json:"executablePath,omitempty"`
	CommandLine    string `json:"commandLine,omitempty"`
	Version        string `json:"version,omitempty"`
}

type windowsRuntimeServiceFact struct {
	Name           string   `json:"name,omitempty"`
	DisplayName    string   `json:"displayName,omitempty"`
	State          string   `json:"state,omitempty"`
	PathName       string   `json:"pathName,omitempty"`
	ExecutablePath string   `json:"executablePath,omitempty"`
	Version        string   `json:"version,omitempty"`
	RegistryArgs   []string `json:"registryArgs,omitempty"`
}

type windowsRuntimeFactSnapshot struct {
	Processes []windowsRuntimeProcessFact `json:"processes,omitempty"`
	Services  []windowsRuntimeServiceFact `json:"services,omitempty"`
}

type windowsRuntimeFactWire struct {
	Processes json.RawMessage `json:"processes"`
	Services  json.RawMessage `json:"services"`
}

type windowsNginxParserState struct {
	Sites    []windowsRuntimeSite
	Warnings []windowsDiscoveryWarning
	Files    map[string]struct{}
	Visited  map[string]struct{}
	Prefix   string
}

type windowsNginxContext struct {
	kind      string
	siteIndex int
}

type windowsApacheParserState struct {
	Sites         []windowsRuntimeSite
	Warnings      []windowsDiscoveryWarning
	Files         map[string]struct{}
	Visited       map[string]struct{}
	ServerRoot    string
	ListenDefault []windowsRuntimeListener
	MainSite      windowsRuntimeSite
	MainTemplate  windowsRuntimeListener
	HasMainSite   bool
}

type windowsApacheContext struct {
	kind      string
	siteIndex int
}

func inspectWindowsRuntimeDiscovery(host windowsExecutionHost) (windowsNginxDetail, windowsApacheDetail, windowsTomcatDetail, error) {
	var wire windowsRuntimeFactWire
	if err := host.runPowerShellJSON(windowsRuntimeFactScript, &wire); err != nil {
		return windowsNginxDetail{}, windowsApacheDetail{}, windowsTomcatDetail{}, err
	}

	processes, err := parseWindowsRuntimeProcesses(wire.Processes)
	if err != nil {
		return windowsNginxDetail{}, windowsApacheDetail{}, windowsTomcatDetail{}, fmt.Errorf("解析 Windows 运行时进程事实失败: %w", err)
	}
	services, err := parseWindowsRuntimeServices(wire.Services)
	if err != nil {
		return windowsNginxDetail{}, windowsApacheDetail{}, windowsTomcatDetail{}, fmt.Errorf("解析 Windows 服务事实失败: %w", err)
	}
	facts := windowsRuntimeFactSnapshot{Processes: processes, Services: services}
	attachWindowsApacheRegistryArgs(host, &facts)
	nginx, apache, tomcat := discoverWindowsRuntimeFacts(facts)
	return nginx, apache, tomcat, nil
}

func attachWindowsApacheRegistryArgs(host windowsExecutionHost, facts *windowsRuntimeFactSnapshot) {
	if facts == nil {
		return
	}
	for index := range facts.Services {
		service := &facts.Services[index]
		if len(service.RegistryArgs) > 0 {
			continue
		}
		if !windowsRuntimeNameMatches(service.Name, "apache", "httpd") &&
			!windowsRuntimeNameMatches(service.DisplayName, "apache", "httpd") &&
			!windowsRuntimeNameMatches(filepath.Base(service.ExecutablePath), "apache", "httpd") &&
			!strings.Contains(strings.ToLower(service.PathName), "httpd") {
			continue
		}
		args, err := host.inspectWindowsServiceRegistryArgs(service.Name)
		if err == nil && len(args) > 0 {
			service.RegistryArgs = args
		}
	}
}

func discoverWindowsRuntimeFacts(facts windowsRuntimeFactSnapshot) (windowsNginxDetail, windowsApacheDetail, windowsTomcatDetail) {
	nginx := discoverWindowsNginx(facts)
	apache := discoverWindowsApache(facts)
	tomcat := discoverWindowsTomcat(facts)
	return nginx, apache, tomcat
}

func discoverWindowsNginx(facts windowsRuntimeFactSnapshot) windowsNginxDetail {
	process := firstWindowsRuntimeProcess(facts.Processes, "nginx")
	if process == nil {
		for _, service := range facts.Services {
			if windowsRuntimeNameMatches(service.Name, "nginx") || windowsRuntimeNameMatches(service.DisplayName, "nginx") {
				process = &windowsRuntimeProcessFact{
					ExecutablePath: firstNonEmpty(service.ExecutablePath, extractWindowsExecutablePath(service.PathName)),
					Version:        service.Version,
				}
				break
			}
		}
	}
	if process == nil {
		return windowsNginxDetail{}
	}

	detail := windowsNginxDetail{
		Installed:  strings.TrimSpace(process.ExecutablePath) != "",
		Running:    firstWindowsRuntimeProcess(facts.Processes, "nginx") != nil,
		Version:    process.Version,
		BinaryPath: strings.TrimSpace(process.ExecutablePath),
	}
	prefix := windowsCommandArgument(process.CommandLine, "-p")
	if prefix == "" {
		prefix = filepath.Dir(filepath.Dir(detail.BinaryPath))
	}
	detail.ConfigRoot = windowsCleanPath(prefix)
	configPath := windowsCommandArgument(process.CommandLine, "-c")
	if configPath == "" {
		configPath = filepath.Join(detail.ConfigRoot, "conf", "nginx.conf")
	} else {
		configPath = resolveWindowsRuntimePath(detail.ConfigRoot, "", configPath)
	}
	detail.ConfigPath = configPath
	detail.Sites, detail.IncludeFiles, detail.ConfigFingerprint, detail.Warnings = parseWindowsNginxConfigTree(configPath, detail.ConfigRoot)
	return detail
}

func discoverWindowsApache(facts windowsRuntimeFactSnapshot) windowsApacheDetail {
	process := firstWindowsRuntimeProcess(facts.Processes, "httpd", "apache2", "apache")
	service := firstWindowsRuntimeService(facts.Services, "apache", "httpd")
	if process == nil && service == nil {
		return windowsApacheDetail{}
	}
	if process == nil {
		process = &windowsRuntimeProcessFact{
			ExecutablePath: firstNonEmpty(service.ExecutablePath, extractWindowsExecutablePath(service.PathName)),
			CommandLine:    service.PathName,
			Version:        service.Version,
		}
	}
	detail := windowsApacheDetail{
		Installed:   strings.TrimSpace(process.ExecutablePath) != "",
		Running:     firstWindowsRuntimeProcess(facts.Processes, "httpd", "apache2", "apache") != nil,
		Version:     firstNonEmpty(process.Version, serviceVersion(service)),
		BinaryPath:  strings.TrimSpace(process.ExecutablePath),
		ServiceName: serviceName(service),
	}
	detail.ServiceStatus = serviceState(service)
	serviceCommandLine := ""
	if service != nil {
		serviceCommandLine = service.PathName
	}
	serverRoot := firstNonEmpty(
		windowsServiceArgument(service, "-d"),
		windowsCommandArgument(process.CommandLine, "-d"),
		windowsCommandArgument(serviceCommandLine, "-d"),
	)
	if serverRoot == "" {
		serverRoot = filepath.Dir(filepath.Dir(detail.BinaryPath))
	}
	detail.ServerRoot = windowsCleanPath(serverRoot)
	configPath := firstNonEmpty(
		windowsServiceArgument(service, "-f"),
		windowsCommandArgument(process.CommandLine, "-f"),
		windowsCommandArgument(serviceCommandLine, "-f"),
	)
	if configPath == "" {
		configPath = filepath.Join(detail.ServerRoot, "conf", "httpd.conf")
	} else {
		configPath = resolveWindowsRuntimePath(detail.ServerRoot, "", configPath)
	}
	detail.ConfigPath = configPath
	detail.Sites, detail.IncludeFiles, detail.ConfigFingerprint, detail.Warnings = parseWindowsApacheConfigTree(configPath, detail.ServerRoot)
	return detail
}

func discoverWindowsTomcat(facts windowsRuntimeFactSnapshot) windowsTomcatDetail {
	process := firstWindowsTomcatProcess(facts.Processes)
	service := firstWindowsRuntimeService(facts.Services, "tomcat", "prunsrv")
	if process == nil && service == nil {
		return windowsTomcatDetail{}
	}
	if process == nil {
		process = &windowsRuntimeProcessFact{
			ExecutablePath: firstNonEmpty(service.ExecutablePath, extractWindowsExecutablePath(service.PathName)),
			CommandLine:    service.PathName,
			Version:        service.Version,
		}
	}
	detail := windowsTomcatDetail{
		Installed:     strings.TrimSpace(process.ExecutablePath) != "",
		Running:       firstWindowsRuntimeProcess(facts.Processes, "java", "tomcat", "tomcat9", "tomcat10", "prunsrv") != nil,
		JavaPath:      strings.TrimSpace(process.ExecutablePath),
		ServiceName:   serviceName(service),
		ServiceStatus: serviceState(service),
	}
	detail.TomcatPath = firstNonEmpty(
		windowsCommandArgument(process.CommandLine, "-Dcatalina.base"),
		windowsCommandArgument(process.CommandLine, "-Dcatalina.home"),
		tomcatPathFromExecutable(service),
	)
	detail.TomcatPath = windowsCleanPath(detail.TomcatPath)
	detail.ConfigPath = filepath.Join(detail.TomcatPath, "conf", "server.xml")
	detail.Version = detectWindowsTomcatVersion(detail.TomcatPath)
	detail.Connectors, detail.Hosts, detail.ConfigFingerprint, detail.Warnings = parseWindowsTomcatServerXML(detail.ConfigPath, detail.TomcatPath)
	return detail
}

func firstWindowsTomcatProcess(processes []windowsRuntimeProcessFact) *windowsRuntimeProcessFact {
	var fallback *windowsRuntimeProcessFact
	for index := range processes {
		process := &processes[index]
		if !windowsRuntimeNameMatches(process.Name, "java", "tomcat", "tomcat9", "tomcat10", "prunsrv") {
			continue
		}
		if windowsCommandArgument(process.CommandLine, "-Dcatalina.base") != "" ||
			windowsCommandArgument(process.CommandLine, "-Dcatalina.home") != "" ||
			strings.Contains(strings.ToLower(process.CommandLine), "org.apache.catalina") {
			return process
		}
		if fallback == nil && windowsRuntimeNameMatches(process.Name, "tomcat", "tomcat9", "tomcat10", "prunsrv") {
			fallback = process
		}
	}
	return fallback
}

func parseWindowsRuntimeProcesses(raw json.RawMessage) ([]windowsRuntimeProcessFact, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var many []windowsRuntimeProcessFact
	if err := json.Unmarshal(raw, &many); err == nil {
		return many, nil
	}
	var single windowsRuntimeProcessFact
	if err := json.Unmarshal(raw, &single); err == nil && single.Name != "" {
		return []windowsRuntimeProcessFact{single}, nil
	}
	return nil, errors.New("processes 不是数组或对象")
}

func parseWindowsRuntimeServices(raw json.RawMessage) ([]windowsRuntimeServiceFact, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}
	var many []windowsRuntimeServiceFact
	if err := json.Unmarshal(raw, &many); err == nil {
		return many, nil
	}
	var single windowsRuntimeServiceFact
	if err := json.Unmarshal(raw, &single); err == nil && single.Name != "" {
		return []windowsRuntimeServiceFact{single}, nil
	}
	return nil, errors.New("services 不是数组或对象")
}

func firstWindowsRuntimeProcess(processes []windowsRuntimeProcessFact, names ...string) *windowsRuntimeProcessFact {
	for index := range processes {
		if windowsRuntimeNameMatches(processes[index].Name, names...) {
			return &processes[index]
		}
	}
	return nil
}

func firstWindowsRuntimeService(services []windowsRuntimeServiceFact, names ...string) *windowsRuntimeServiceFact {
	for index := range services {
		if windowsRuntimeNameMatches(services[index].Name, names...) || windowsRuntimeNameMatches(services[index].DisplayName, names...) || windowsRuntimeNameMatches(filepath.Base(services[index].ExecutablePath), names...) {
			return &services[index]
		}
	}
	return nil
}

func windowsRuntimeNameMatches(value string, names ...string) bool {
	lower := strings.ToLower(strings.TrimSpace(value))
	lower = strings.TrimSuffix(lower, ".exe")
	for _, name := range names {
		expected := strings.ToLower(strings.TrimSpace(name))
		if lower == expected || strings.Contains(lower, expected) {
			return true
		}
	}
	return false
}

func serviceName(service *windowsRuntimeServiceFact) string {
	if service == nil {
		return ""
	}
	return strings.TrimSpace(service.Name)
}

func serviceState(service *windowsRuntimeServiceFact) string {
	if service == nil {
		return ""
	}
	return strings.TrimSpace(service.State)
}

func serviceVersion(service *windowsRuntimeServiceFact) string {
	if service == nil {
		return ""
	}
	return strings.TrimSpace(service.Version)
}

func tomcatPathFromExecutable(service *windowsRuntimeServiceFact) string {
	if service == nil {
		return ""
	}
	executable := strings.TrimSpace(firstNonEmpty(service.ExecutablePath, extractWindowsExecutablePath(service.PathName)))
	if executable == "" {
		return ""
	}
	binDir := filepath.Dir(executable)
	if strings.EqualFold(filepath.Base(binDir), "bin") {
		return filepath.Dir(binDir)
	}
	return filepath.Dir(binDir)
}

func extractWindowsExecutablePath(commandLine string) string {
	tokens := parseWindowsCommandLine(commandLine)
	if len(tokens) == 0 {
		return ""
	}
	return strings.TrimSpace(tokens[0])
}

func windowsCommandArgument(commandLine string, key string) string {
	tokens := parseWindowsCommandLine(commandLine)
	return windowsArgumentListValue(tokens, key)
}

func windowsArgumentListValue(tokens []string, key string) string {
	for index, token := range tokens {
		if token == key && index+1 < len(tokens) {
			return strings.Trim(tokens[index+1], "\"'")
		}
		if strings.HasPrefix(token, key+"=") {
			return strings.Trim(strings.TrimPrefix(token, key+"="), "\"'")
		}
		if strings.HasPrefix(token, key) && len(token) > len(key) {
			// Windows 程序常把短参数和路径直接拼接，例如 -fC:\Apache\conf\httpd.conf。
			return strings.Trim(token[len(key):], "\"'")
		}
	}
	return ""
}

func windowsServiceArgument(service *windowsRuntimeServiceFact, key string) string {
	if service == nil {
		return ""
	}
	return windowsArgumentListValue(service.RegistryArgs, key)
}

func parseWindowsCommandLine(commandLine string) []string {
	var tokens []string
	var builder strings.Builder
	inQuotes := false
	tokenStarted := false
	flush := func() {
		if tokenStarted {
			tokens = append(tokens, builder.String())
			builder.Reset()
			tokenStarted = false
		}
	}

	runes := []rune(commandLine)
	for index := 0; index < len(runes); {
		char := runes[index]
		if char == '\\' {
			slashStart := index
			for index < len(runes) && runes[index] == '\\' {
				index++
			}
			slashCount := index - slashStart
			if index < len(runes) && runes[index] == '"' {
				for slashIndex := 0; slashIndex < slashCount/2; slashIndex++ {
					builder.WriteRune('\\')
				}
				tokenStarted = true
				if slashCount%2 == 1 {
					builder.WriteRune('"')
					index++
					continue
				}
				inQuotes = !inQuotes
				index++
				continue
			}
			for slashIndex := 0; slashIndex < slashCount; slashIndex++ {
				builder.WriteRune('\\')
			}
			tokenStarted = true
			continue
		}
		if char == '"' {
			inQuotes = !inQuotes
			tokenStarted = true
			index++
			continue
		}
		if (char == ' ' || char == '\t') && !inQuotes {
			flush()
			index++
			continue
		}
		builder.WriteRune(char)
		tokenStarted = true
		index++
	}
	flush()
	return tokens
}

func resolveWindowsRuntimePath(root string, baseDir string, value string) string {
	value = strings.TrimSpace(strings.Trim(value, "\"'"))
	if value == "" {
		return ""
	}
	if filepath.IsAbs(value) {
		return windowsCleanPath(value)
	}
	if baseDir != "" {
		return windowsCleanPath(filepath.Join(baseDir, value))
	}
	if root != "" {
		return windowsCleanPath(filepath.Join(root, value))
	}
	return windowsCleanPath(value)
}

func windowsCleanPath(value string) string {
	if strings.TrimSpace(value) == "" {
		return ""
	}
	return filepath.Clean(strings.TrimSpace(strings.Trim(value, "\"'")))
}

func parseWindowsNginxConfigTree(configPath string, prefix string) ([]windowsRuntimeSite, []string, string, []windowsDiscoveryWarning) {
	state := &windowsNginxParserState{
		Sites:   make([]windowsRuntimeSite, 0),
		Files:   map[string]struct{}{},
		Visited: map[string]struct{}{},
		Prefix:  prefix,
	}
	parseWindowsNginxFile(configPath, state, nil)
	for index := range state.Sites {
		finalizeWindowsRuntimeSite(&state.Sites[index], index, "nginx")
		state.Warnings = append(state.Warnings, windowsRuntimeSiteWarnings(state.Sites[index])...)
	}
	files := sortedWindowsPaths(state.Files)
	fingerprint, fingerprintWarnings := fingerprintWindowsConfigFiles(files)
	for index := range state.Sites {
		state.Sites[index].ConfigFingerprint = fingerprint
		for listenerIndex := range state.Sites[index].Listen {
			state.Sites[index].Listen[listenerIndex].ConfigFingerprint = fingerprint
		}
	}
	state.Warnings = append(state.Warnings, fingerprintWarnings...)
	return state.Sites, files, fingerprint, uniqueWindowsDiscoveryWarnings(state.Warnings)
}

func parseWindowsNginxFile(configPath string, state *windowsNginxParserState, parentStack []windowsNginxContext) {
	path := windowsCleanPath(configPath)
	if path == "" {
		return
	}
	if _, exists := state.Visited[path]; exists {
		return
	}
	state.Visited[path] = struct{}{}
	content, err := os.ReadFile(path)
	if err != nil {
		state.Warnings = append(state.Warnings, windowsDiscoveryWarning{Code: "CONFIG_UNREADABLE", Message: "NGINX 配置文件不可读", Path: path})
		return
	}
	state.Files[path] = struct{}{}
	stack := append([]windowsNginxContext(nil), parentStack...)
	for _, rawLine := range strings.Split(string(content), "\n") {
		line := stripWindowsConfigComment(rawLine)
		for strings.TrimSpace(line) != "" {
			trimmed := strings.TrimSpace(line)
			if strings.HasPrefix(trimmed, "}") {
				if len(stack) > 0 {
					stack = stack[:len(stack)-1]
				}
				line = strings.TrimSpace(strings.TrimPrefix(trimmed, "}"))
				continue
			}
			openIndex := strings.Index(trimmed, "{")
			semicolonIndex := strings.Index(trimmed, ";")
			if openIndex >= 0 && (semicolonIndex < 0 || openIndex < semicolonIndex) {
				statement := strings.TrimSpace(trimmed[:openIndex])
				kind := firstWindowsToken(statement)
				siteIndex := windowsActiveSiteIndex(stack)
				if kind == "server" {
					state.Sites = append(state.Sites, windowsRuntimeSite{})
					siteIndex = len(state.Sites) - 1
					state.Sites[siteIndex].ConfigFiles = append(state.Sites[siteIndex].ConfigFiles, path)
				}
				stack = append(stack, windowsNginxContext{kind: kind, siteIndex: siteIndex})
				line = strings.TrimSpace(trimmed[openIndex+1:])
				continue
			}
			if semicolonIndex < 0 {
				break
			}
			statement := strings.TrimSpace(trimmed[:semicolonIndex])
			siteIndex := windowsActiveSiteIndex(stack)
			args := splitWindowsDirectiveArgs(statement)
			if len(args) > 0 && strings.EqualFold(args[0], "include") && len(args) > 1 {
				for _, includePath := range resolveWindowsIncludePaths(filepath.Dir(path), state.Prefix, args[1]) {
					parseWindowsNginxFile(includePath, state, stack)
				}
			} else if siteIndex >= 0 && siteIndex < len(state.Sites) {
				applyWindowsNginxDirective(&state.Sites[siteIndex], args, path, filepath.Dir(path), state.Prefix)
			}
			line = strings.TrimSpace(trimmed[semicolonIndex+1:])
		}
	}
}

func applyWindowsNginxDirective(site *windowsRuntimeSite, args []string, configPath string, baseDir string, prefix string) {
	if len(args) == 0 {
		return
	}
	directive := strings.ToLower(args[0])
	values := args[1:]
	if !containsWindowsPath(site.ConfigFiles, configPath) {
		site.ConfigFiles = append(site.ConfigFiles, configPath)
	}
	switch directive {
	case "listen":
		if listener, ok := parseWindowsListen(values); ok {
			site.Listen = append(site.Listen, listener)
		}
	case "server_name":
		site.ServerNames = append(site.ServerNames, values...)
	case "root":
		if len(values) > 0 {
			site.SitePath = resolveWindowsNginxPath(prefix, baseDir, values[0])
		}
	case "ssl_certificate":
		if len(values) > 0 {
			path := resolveWindowsNginxPath(prefix, baseDir, values[0])
			for index := range site.Listen {
				if site.Listen[index].Protocol == "HTTPS" || site.Listen[index].Port == 443 || site.Listen[index].Port == 8443 {
					site.Listen[index].CertificatePath = path
				}
			}
			if len(site.Listen) == 0 {
				site.Listen = append(site.Listen, windowsRuntimeListener{Address: "*", Port: 443, Protocol: "HTTPS", CertificatePath: path})
			}
			for index := range site.Listen {
				if site.Listen[index].CertificatePath == "" {
					site.Listen[index].CertificatePath = path
				}
			}
		}
	case "ssl_certificate_key":
		if len(values) > 0 {
			path := resolveWindowsNginxPath(prefix, baseDir, values[0])
			for index := range site.Listen {
				if site.Listen[index].Protocol == "HTTPS" || site.Listen[index].Port == 443 || site.Listen[index].Port == 8443 {
					site.Listen[index].CertificateKeyPath = path
				}
			}
			if len(site.Listen) == 0 {
				site.Listen = append(site.Listen, windowsRuntimeListener{Address: "*", Port: 443, Protocol: "HTTPS", CertificateKeyPath: path})
			}
			for index := range site.Listen {
				if site.Listen[index].CertificateKeyPath == "" {
					site.Listen[index].CertificateKeyPath = path
				}
			}
		}
	case "ssl_certificate_chain":
		if len(values) > 0 {
			path := resolveWindowsNginxPath(prefix, baseDir, values[0])
			for index := range site.Listen {
				if site.Listen[index].Protocol == "HTTPS" || site.Listen[index].Port == 443 || site.Listen[index].Port == 8443 {
					site.Listen[index].CertificateChainPath = path
				}
			}
		}
	}
}

func resolveWindowsNginxPath(prefix string, baseDir string, value string) string {
	value = strings.TrimSpace(strings.Trim(value, "\"'"))
	if value == "" {
		return ""
	}
	if filepath.IsAbs(value) {
		return windowsCleanPath(value)
	}
	if prefix != "" {
		return windowsCleanPath(filepath.Join(prefix, value))
	}
	return windowsCleanPath(filepath.Join(baseDir, value))
}

func parseWindowsApacheConfigTree(configPath string, serverRoot string) ([]windowsRuntimeSite, []string, string, []windowsDiscoveryWarning) {
	state := &windowsApacheParserState{
		Sites:      make([]windowsRuntimeSite, 0),
		Files:      map[string]struct{}{},
		Visited:    map[string]struct{}{},
		ServerRoot: serverRoot,
	}
	parseWindowsApacheFile(configPath, state, nil)
	if state.HasMainSite && shouldMaterializeWindowsApacheMainSite(state.MainSite, len(state.Sites) == 0) {
		state.Sites = append(state.Sites, state.MainSite)
	}
	for index := range state.Sites {
		if len(state.Sites[index].Listen) == 0 && len(state.ListenDefault) > 0 {
			state.Sites[index].Listen = append(state.Sites[index].Listen, state.ListenDefault...)
		}
		finalizeWindowsRuntimeSite(&state.Sites[index], index, "apache")
		state.Warnings = append(state.Warnings, windowsRuntimeSiteWarnings(state.Sites[index])...)
	}
	files := sortedWindowsPaths(state.Files)
	fingerprint, fingerprintWarnings := fingerprintWindowsConfigFiles(files)
	for index := range state.Sites {
		state.Sites[index].ConfigFingerprint = fingerprint
		for listenerIndex := range state.Sites[index].Listen {
			state.Sites[index].Listen[listenerIndex].ConfigFingerprint = fingerprint
		}
	}
	state.Warnings = append(state.Warnings, fingerprintWarnings...)
	return state.Sites, files, fingerprint, uniqueWindowsDiscoveryWarnings(state.Warnings)
}

func parseWindowsApacheFile(configPath string, state *windowsApacheParserState, parentStack []windowsApacheContext) {
	path := windowsCleanPath(configPath)
	if path == "" {
		return
	}
	if _, exists := state.Visited[path]; exists {
		return
	}
	state.Visited[path] = struct{}{}
	content, err := os.ReadFile(path)
	if err != nil {
		state.Warnings = append(state.Warnings, windowsDiscoveryWarning{Code: "CONFIG_UNREADABLE", Message: "Apache 配置文件不可读", Path: path})
		return
	}
	state.Files[path] = struct{}{}
	stack := append([]windowsApacheContext(nil), parentStack...)
	for _, rawLine := range strings.Split(string(content), "\n") {
		line := stripWindowsConfigComment(rawLine)
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		lower := strings.ToLower(trimmed)
		if strings.HasPrefix(lower, "<virtualhost") && strings.HasSuffix(trimmed, ">") {
			value := strings.TrimSpace(trimmed[len("<VirtualHost") : len(trimmed)-1])
			site := windowsRuntimeSite{Listen: parseWindowsApacheVirtualHostBindings(value), ConfigFiles: []string{path}}
			state.Sites = append(state.Sites, site)
			stack = append(stack, windowsApacheContext{kind: "virtualhost", siteIndex: len(state.Sites) - 1})
			continue
		}
		if strings.HasPrefix(lower, "</virtualhost") {
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
			continue
		}
		args := splitWindowsDirectiveArgs(trimmed)
		if len(args) == 0 {
			continue
		}
		directive := strings.ToLower(args[0])
		siteIndex := windowsActiveApacheSiteIndex(stack)
		switch directive {
		case "include", "includeoptional":
			if len(args) > 1 {
				for _, includePath := range resolveWindowsIncludePaths(filepath.Dir(path), state.ServerRoot, args[1]) {
					parseWindowsApacheFile(includePath, state, stack)
				}
			}
		case "listen":
			if listener, ok := parseWindowsListen(args[1:]); ok {
				state.ListenDefault = append(state.ListenDefault, listener)
				if siteIndex >= 0 && siteIndex < len(state.Sites) {
					state.Sites[siteIndex].Listen = append(state.Sites[siteIndex].Listen, listener)
				} else {
					mainSite := ensureWindowsApacheMainSite(state, path)
					mainSite.Listen = append(mainSite.Listen, windowsApacheApplyListenerTemplate(listener, state.MainTemplate))
				}
			}
		case "servername":
			if len(args) <= 1 {
				continue
			}
			serverName := normalizeWindowsServerName(args[1])
			if serverName == "" {
				continue
			}
			if siteIndex >= 0 && siteIndex < len(state.Sites) {
				state.Sites[siteIndex].ServerNames = append(state.Sites[siteIndex].ServerNames, serverName)
			} else {
				mainSite := ensureWindowsApacheMainSite(state, path)
				mainSite.ServerNames = append(mainSite.ServerNames, serverName)
			}
		case "serveralias":
			aliases := make([]string, 0, len(args)-1)
			for _, rawAlias := range args[1:] {
				alias := normalizeWindowsServerName(rawAlias)
				if alias != "" {
					aliases = append(aliases, alias)
				}
			}
			if len(aliases) == 0 {
				continue
			}
			if siteIndex >= 0 && siteIndex < len(state.Sites) {
				state.Sites[siteIndex].ServerNames = append(state.Sites[siteIndex].ServerNames, aliases...)
			} else {
				mainSite := ensureWindowsApacheMainSite(state, path)
				mainSite.ServerNames = append(mainSite.ServerNames, aliases...)
			}
		case "documentroot":
			if len(args) <= 1 {
				continue
			}
			sitePath := resolveWindowsRuntimePath(state.ServerRoot, "", args[1])
			if siteIndex >= 0 && siteIndex < len(state.Sites) {
				state.Sites[siteIndex].SitePath = sitePath
			} else {
				mainSite := ensureWindowsApacheMainSite(state, path)
				mainSite.SitePath = sitePath
			}
		case "sslcertificatefile":
			if len(args) <= 1 {
				continue
			}
			certificatePath := resolveWindowsRuntimePath(state.ServerRoot, "", args[1])
			if siteIndex >= 0 && siteIndex < len(state.Sites) {
				windowsApacheSetCertificatePath(&state.Sites[siteIndex], certificatePath)
			} else {
				mainSite := ensureWindowsApacheMainSite(state, path)
				state.MainTemplate.CertificatePath = certificatePath
				state.MainTemplate.Protocol = "HTTPS"
				windowsApacheSetCertificatePath(mainSite, certificatePath)
			}
		case "sslcertificatekeyfile":
			if len(args) <= 1 {
				continue
			}
			keyPath := resolveWindowsRuntimePath(state.ServerRoot, "", args[1])
			if siteIndex >= 0 && siteIndex < len(state.Sites) {
				windowsApacheSetCertificateKeyPath(&state.Sites[siteIndex], keyPath)
			} else {
				mainSite := ensureWindowsApacheMainSite(state, path)
				state.MainTemplate.CertificateKeyPath = keyPath
				state.MainTemplate.Protocol = "HTTPS"
				windowsApacheSetCertificateKeyPath(mainSite, keyPath)
			}
		case "sslcertificatechainfile":
			if len(args) <= 1 {
				continue
			}
			chainPath := resolveWindowsRuntimePath(state.ServerRoot, "", args[1])
			if siteIndex >= 0 && siteIndex < len(state.Sites) {
				windowsApacheSetCertificateChainPath(&state.Sites[siteIndex], chainPath)
			} else {
				mainSite := ensureWindowsApacheMainSite(state, path)
				state.MainTemplate.CertificateChainPath = chainPath
				state.MainTemplate.Protocol = "HTTPS"
				windowsApacheSetCertificateChainPath(mainSite, chainPath)
			}
		case "sslengine":
			if len(args) <= 1 || !strings.EqualFold(args[1], "on") {
				continue
			}
			if siteIndex >= 0 && siteIndex < len(state.Sites) {
				windowsApacheMarkSiteTLS(&state.Sites[siteIndex])
			} else {
				mainSite := ensureWindowsApacheMainSite(state, path)
				state.MainTemplate.Protocol = "HTTPS"
				windowsApacheMarkSiteTLS(mainSite)
			}
		}
		if siteIndex >= 0 && siteIndex < len(state.Sites) {
			if !containsWindowsPath(state.Sites[siteIndex].ConfigFiles, path) {
				state.Sites[siteIndex].ConfigFiles = append(state.Sites[siteIndex].ConfigFiles, path)
			}
		} else if state.HasMainSite && !containsWindowsPath(state.MainSite.ConfigFiles, path) {
			state.MainSite.ConfigFiles = append(state.MainSite.ConfigFiles, path)
		}
	}
}

func parseWindowsTomcatServerXML(configPath string, tomcatPath string) ([]windowsRuntimeListener, []string, string, []windowsDiscoveryWarning) {
	content, err := os.ReadFile(configPath)
	if err != nil {
		warnings := []windowsDiscoveryWarning{{Code: "CONFIG_UNREADABLE", Message: "Tomcat server.xml 不可读", Path: configPath}}
		return nil, nil, "", warnings
	}
	var document windowsTomcatServerXML
	if err := xml.Unmarshal(content, &document); err != nil {
		return nil, nil, "", []windowsDiscoveryWarning{{Code: "CONFIG_PARSE_FAILED", Message: "Tomcat server.xml 解析失败", Path: configPath}}
	}

	fingerprint, fingerprintWarnings := fingerprintWindowsConfigFiles([]string{configPath})
	listeners := make([]windowsRuntimeListener, 0)
	hosts := make([]string, 0)
	warnings := append([]windowsDiscoveryWarning{}, fingerprintWarnings...)
	for _, service := range document.Services {
		for _, host := range service.Engine.Hosts {
			if strings.TrimSpace(host.Name) != "" {
				hosts = append(hosts, strings.TrimSpace(host.Name))
			}
		}
		for _, connector := range service.Connectors {
			if connector.Port <= 0 {
				continue
			}
			configurations := connector.SSLHostConfigs
			if len(configurations) == 0 {
				configurations = []windowsTomcatSSLHostConfig{{}}
			}
			for _, sslHost := range configurations {
				certificates := sslHost.Certificates
				if len(certificates) == 0 {
					certificates = []windowsTomcatCertificate{{}}
				}
				certificate := certificates[0]
				listener := windowsRuntimeListener{
					Address:              firstNonEmpty(strings.TrimSpace(connector.Address), "*"),
					Port:                 connector.Port,
					Protocol:             windowsTomcatProtocol(connector),
					HostHeader:           strings.TrimSpace(sslHost.HostName),
					CertificatePath:      resolveWindowsRuntimePath(tomcatPath, "", firstNonEmpty(certificate.CertificateFile, connector.CertificateFile)),
					CertificateKeyPath:   resolveWindowsRuntimePath(tomcatPath, "", firstNonEmpty(certificate.CertificateKeyFile, connector.CertificateKeyFile)),
					CertificateChainPath: resolveWindowsRuntimePath(tomcatPath, "", firstNonEmpty(certificate.CertificateChainFile, connector.CertificateChainFile)),
					KeystorePath:         resolveWindowsRuntimePath(tomcatPath, "", firstNonEmpty(certificate.CertificateKeystoreFile, connector.CertificateKeystoreFile)),
					KeystoreType:         firstNonEmpty(certificate.CertificateKeystoreType, sslHost.CertificateKeystoreType, connector.CertificateKeystoreType),
					KeyAlias:             firstNonEmpty(certificate.CertificateKeyAlias, connector.CertificateKeyAlias),
					ConfigFingerprint:    fingerprint,
				}
				if listener.KeystoreType == "" && listener.KeystorePath != "" {
					if strings.HasSuffix(strings.ToLower(listener.KeystorePath), ".p12") || strings.HasSuffix(strings.ToLower(listener.KeystorePath), ".pfx") {
						listener.KeystoreType = "PKCS12"
					} else {
						listener.KeystoreType = "JKS"
					}
				}
				if listener.Protocol == "HTTPS" && listener.CertificatePath != "" {
					listener.Certificate = readWindowsCertificateSummary(listener.CertificatePath)
					if listener.Certificate == nil {
						warnings = append(warnings, windowsDiscoveryWarning{Code: "CERTIFICATE_READ_FAILED", Message: "Tomcat PEM 证书不可读或格式无效", Path: listener.CertificatePath})
					}
				}
				if listener.Protocol == "HTTPS" && listener.Certificate == nil && listener.KeystorePath != "" {
					password := firstNonEmpty(
						certificate.CertificateKeystorePassword,
						certificate.KeystorePass,
						sslHost.CertificateKeystorePassword,
						sslHost.KeystorePass,
						connector.SSLHostConfigPassword,
						connector.CertificateKeystorePassword,
					)
					listener.Certificate = readWindowsPKCS12CertificateSummary(listener.KeystorePath, password)
					if listener.Certificate == nil {
						warnings = append(warnings, windowsDiscoveryWarning{Code: "KEYSTORE_CERTIFICATE_READ_FAILED", Message: "Tomcat KeyStore 公开证书不可读", Path: listener.KeystorePath})
					}
				}
				warnings = append(warnings, windowsPathWarnings(listener)...)
				listeners = append(listeners, listener)
			}
		}
	}
	return listeners, uniqueWindowsStrings(hosts), fingerprint, uniqueWindowsDiscoveryWarnings(warnings)
}

type windowsTomcatServerXML struct {
	Services []windowsTomcatService `xml:"Service"`
}

type windowsTomcatService struct {
	Connectors []windowsTomcatConnector `xml:"Connector"`
	Engine     windowsTomcatEngine      `xml:"Engine"`
}

type windowsTomcatEngine struct {
	Hosts []windowsTomcatHost `xml:"Host"`
}

type windowsTomcatHost struct {
	Name string `xml:"name,attr"`
}

type windowsTomcatConnector struct {
	Port                        int                          `xml:"port,attr"`
	Address                     string                       `xml:"address,attr"`
	Protocol                    string                       `xml:"protocol,attr"`
	SSLEnabled                  string                       `xml:"SSLEnabled,attr"`
	Scheme                      string                       `xml:"scheme,attr"`
	Secure                      string                       `xml:"secure,attr"`
	CertificateFile             string                       `xml:"certificateFile,attr"`
	CertificateKeyFile          string                       `xml:"certificateKeyFile,attr"`
	CertificateChainFile        string                       `xml:"certificateChainFile,attr"`
	CertificateKeystoreFile     string                       `xml:"certificateKeystoreFile,attr"`
	CertificateKeystoreType     string                       `xml:"certificateKeystoreType,attr"`
	CertificateKeystorePassword string                       `xml:"keystorePass,attr"`
	CertificateKeyAlias         string                       `xml:"certificateKeyAlias,attr"`
	SSLHostConfigPassword       string                       `xml:"certificateKeystorePassword,attr"`
	SSLHostConfigs              []windowsTomcatSSLHostConfig `xml:"SSLHostConfig"`
}

type windowsTomcatSSLHostConfig struct {
	HostName                    string                     `xml:"hostName,attr"`
	CertificateKeystoreFile     string                     `xml:"certificateKeystoreFile,attr"`
	CertificateKeystoreType     string                     `xml:"certificateKeystoreType,attr"`
	CertificateKeystorePassword string                     `xml:"certificateKeystorePassword,attr"`
	KeystorePass                string                     `xml:"keystorePass,attr"`
	Certificates                []windowsTomcatCertificate `xml:"Certificate"`
}

type windowsTomcatCertificate struct {
	CertificateFile             string `xml:"certificateFile,attr"`
	CertificateKeyFile          string `xml:"certificateKeyFile,attr"`
	CertificateChainFile        string `xml:"certificateChainFile,attr"`
	CertificateKeystoreFile     string `xml:"certificateKeystoreFile,attr"`
	CertificateKeystoreType     string `xml:"certificateKeystoreType,attr"`
	CertificateKeystorePassword string `xml:"certificateKeystorePassword,attr"`
	KeystorePass                string `xml:"keystorePass,attr"`
	CertificateKeyAlias         string `xml:"certificateKeyAlias,attr"`
	Type                        string `xml:"type,attr"`
}

func windowsTomcatProtocol(connector windowsTomcatConnector) string {
	if strings.EqualFold(connector.SSLEnabled, "true") || strings.EqualFold(connector.Scheme, "https") || strings.EqualFold(connector.Secure, "true") || connector.Port == 443 || connector.Port == 8443 || len(connector.SSLHostConfigs) > 0 {
		return "HTTPS"
	}
	return "HTTP"
}

func finalizeWindowsRuntimeSite(site *windowsRuntimeSite, index int, product string) {
	site.ServerNames = uniqueWindowsStrings(site.ServerNames)
	site.ConfigFiles = uniqueWindowsPaths(site.ConfigFiles)
	if site.Name == "" {
		if len(site.ServerNames) > 0 {
			site.Name = site.ServerNames[0]
		} else {
			site.Name = fmt.Sprintf("%s-site-%d", product, index+1)
		}
	}
	if site.ID == "" {
		site.ID = windowsStableToken(product, strings.Join(site.ConfigFiles, "|"), site.Name, strings.Join(site.ServerNames, "|"), strconv.Itoa(index))
	}
	if site.ConfigFingerprint == "" {
		files := site.ConfigFiles
		site.ConfigFingerprint, _ = fingerprintWindowsConfigFiles(files)
	}
	for index := range site.Listen {
		if site.Listen[index].Protocol == "" {
			site.Listen[index].Protocol = "HTTP"
		}
		site.Listen[index].ConfigFingerprint = site.ConfigFingerprint
		if site.Listen[index].Protocol == "HTTPS" || site.Listen[index].CertificatePath != "" || site.Listen[index].KeystorePath != "" {
			site.Listen[index].Certificate = firstNonNilWindowsCertificate(
				site.Listen[index].Certificate,
				readWindowsCertificateSummary(site.Listen[index].CertificatePath),
				readWindowsPKCS12CertificateSummary(site.Listen[index].KeystorePath, ""),
			)
			site.Listen[index].ConfigFingerprint = site.ConfigFingerprint
			site.Listen[index].BindingInformation = windowsBindingInformation(site.Name, site.Listen[index])
		}
	}
}

func firstNonNilWindowsCertificate(values ...*windowsCertificateSummary) *windowsCertificateSummary {
	for _, value := range values {
		if value != nil {
			return value
		}
	}
	return nil
}

func parseWindowsListen(values []string) (windowsRuntimeListener, bool) {
	if len(values) == 0 {
		return windowsRuntimeListener{}, false
	}
	value := strings.Trim(values[0], "\"'")
	address := "*"
	port := 0
	if isWindowsNumeric(value) {
		port = windowsAtoi(value)
	} else if strings.HasPrefix(value, "[") {
		if end := strings.Index(value, "]:"); end >= 0 {
			address = strings.Trim(value[1:end], "[]")
			port = windowsAtoi(value[end+2:])
		}
	} else if colon := strings.LastIndex(value, ":"); colon >= 0 {
		address = strings.Trim(value[:colon], "[]")
		port = windowsAtoi(value[colon+1:])
	} else {
		port = windowsAtoi(value)
	}
	if port <= 0 || port > 65535 {
		return windowsRuntimeListener{}, false
	}
	protocol := "HTTP"
	for _, item := range values[1:] {
		if strings.EqualFold(strings.Trim(item, "\"'"), "ssl") {
			protocol = "HTTPS"
		}
	}
	if port == 443 || port == 8443 {
		protocol = "HTTPS"
	}
	return windowsRuntimeListener{Address: firstNonEmpty(address, "*"), Port: port, Protocol: protocol}, true
}

func parseWindowsApacheVirtualHostBindings(value string) []windowsRuntimeListener {
	var result []windowsRuntimeListener
	for _, item := range splitWindowsDirectiveArgs(value) {
		if listener, ok := parseWindowsListen([]string{item}); ok {
			result = append(result, listener)
		}
	}
	return result
}

func windowsTomcatSite(detail windowsTomcatDetail) []windowsRuntimeSite {
	sites := make([]windowsRuntimeSite, 0, len(detail.Connectors))
	for index, connector := range detail.Connectors {
		hostHeader := connector.HostHeader
		if hostHeader == "" && len(detail.Hosts) > 0 {
			hostHeader = detail.Hosts[minWindowsInt(index, len(detail.Hosts)-1)]
		}
		connector.HostHeader = hostHeader
		name := firstNonEmpty(hostHeader, certificateSubject(connector.Certificate), fmt.Sprintf("tomcat-site-%d", index+1))
		sites = append(sites, windowsRuntimeSite{
			ID:                windowsStableToken(detail.ConfigPath, name, strconv.Itoa(connector.Port), connector.KeystorePath, connector.CertificatePath),
			Name:              name,
			ServerNames:       nonEmptyStrings(hostHeader),
			Listen:            []windowsRuntimeListener{connector},
			ConfigFiles:       []string{detail.ConfigPath},
			ConfigFingerprint: detail.ConfigFingerprint,
		})
	}
	return sites
}

func minWindowsInt(left, right int) int {
	if left < right {
		return left
	}
	return right
}

func certificateSubject(certificate *windowsCertificateSummary) string {
	if certificate == nil {
		return ""
	}
	return certificate.Subject
}

func windowsBindingInformation(siteName string, listener windowsRuntimeListener) string {
	if listener.BindingInformation != "" {
		return listener.BindingInformation
	}
	return strings.Join([]string{firstNonEmpty(listener.Address, "*"), strconv.Itoa(listener.Port), firstNonEmpty(listener.HostHeader, siteName)}, ":")
}

func readWindowsCertificateSummary(path string) *windowsCertificateSummary {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	for remaining := content; len(remaining) > 0; {
		block, rest := pem.Decode(remaining)
		if block == nil {
			return nil
		}
		remaining = rest
		if block.Type != "CERTIFICATE" {
			continue
		}
		certificate, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			return nil
		}
		sum := sha256.Sum256(certificate.Raw)
		return &windowsCertificateSummary{
			FingerprintSHA256: hex.EncodeToString(sum[:]),
			Subject:           certificate.Subject.String(),
			Issuer:            certificate.Issuer.String(),
			NotBefore:         certificate.NotBefore.Format("2006-01-02T15:04:05Z07:00"),
			NotAfter:          certificate.NotAfter.Format("2006-01-02T15:04:05Z07:00"),
		}
	}
	return nil
}

func readWindowsPKCS12CertificateSummary(path string, password string) *windowsCertificateSummary {
	if strings.TrimSpace(path) == "" {
		return nil
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	certificate := readWindowsPKCS12Certificate(content, password)
	if certificate == nil {
		return nil
	}
	sum := sha256.Sum256(certificate.Raw)
	return &windowsCertificateSummary{
		FingerprintSHA256: hex.EncodeToString(sum[:]),
		Subject:           certificate.Subject.String(),
		Issuer:            certificate.Issuer.String(),
		NotBefore:         certificate.NotBefore.Format("2006-01-02T15:04:05Z07:00"),
		NotAfter:          certificate.NotAfter.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func readWindowsPKCS12Certificate(content []byte, password string) *x509.Certificate {
	_, certificate, err := pkcs12.Decode(content, password)
	if err == nil && certificate != nil {
		return certificate
	}
	blocks, err := pkcs12.ToPEM(content, password)
	if err != nil {
		return nil
	}
	for _, block := range blocks {
		if block == nil || block.Type != "CERTIFICATE" {
			continue
		}
		certificate, parseErr := x509.ParseCertificate(block.Bytes)
		if parseErr == nil {
			return certificate
		}
	}
	return nil
}

func windowsPathWarnings(listener windowsRuntimeListener) []windowsDiscoveryWarning {
	var warnings []windowsDiscoveryWarning
	paths := []struct {
		code string
		path string
	}{
		{"CERTIFICATE_PATH_MISSING", listener.CertificatePath},
		{"PRIVATE_KEY_PATH_MISSING", listener.CertificateKeyPath},
		{"CERTIFICATE_CHAIN_PATH_MISSING", listener.CertificateChainPath},
		{"KEYSTORE_PATH_MISSING", listener.KeystorePath},
	}
	for _, item := range paths {
		if item.path == "" {
			continue
		}
		if _, err := os.Stat(item.path); err != nil {
			warnings = append(warnings, windowsDiscoveryWarning{Code: item.code, Message: "证书材料路径不存在", Path: item.path})
		}
	}
	return warnings
}

func windowsRuntimeSiteWarnings(site windowsRuntimeSite) []windowsDiscoveryWarning {
	var warnings []windowsDiscoveryWarning
	for _, listener := range site.Listen {
		warnings = append(warnings, windowsPathWarnings(listener)...)
		if listener.CertificatePath != "" {
			if _, err := os.Stat(listener.CertificatePath); err == nil && listener.Certificate == nil {
				warnings = append(warnings, windowsDiscoveryWarning{
					Code:    "CERTIFICATE_READ_FAILED",
					Message: "证书文件不可读或格式无效",
					Path:    listener.CertificatePath,
				})
			}
		}
	}
	return warnings
}

func ensureWindowsApacheMainSite(state *windowsApacheParserState, path string) *windowsRuntimeSite {
	if !state.HasMainSite {
		state.HasMainSite = true
		state.MainSite = windowsRuntimeSite{ConfigFiles: []string{path}}
		return &state.MainSite
	}
	if !containsWindowsPath(state.MainSite.ConfigFiles, path) {
		state.MainSite.ConfigFiles = append(state.MainSite.ConfigFiles, path)
	}
	return &state.MainSite
}

func shouldMaterializeWindowsApacheMainSite(site windowsRuntimeSite, noVirtualHosts bool) bool {
	if len(site.Listen) == 0 {
		return false
	}
	if windowsApacheSiteHasTLS(site) {
		return true
	}
	return noVirtualHosts && (len(site.ServerNames) > 0 || strings.TrimSpace(site.SitePath) != "")
}

func windowsApacheSiteHasTLS(site windowsRuntimeSite) bool {
	for _, listener := range site.Listen {
		if listener.Protocol == "HTTPS" ||
			listener.CertificatePath != "" ||
			listener.CertificateKeyPath != "" ||
			listener.CertificateChainPath != "" {
			return true
		}
	}
	return false
}

func windowsApacheApplyListenerTemplate(listener windowsRuntimeListener, template windowsRuntimeListener) windowsRuntimeListener {
	if template.Protocol == "HTTPS" {
		listener.Protocol = "HTTPS"
	}
	if template.CertificatePath != "" {
		listener.CertificatePath = template.CertificatePath
	}
	if template.CertificateKeyPath != "" {
		listener.CertificateKeyPath = template.CertificateKeyPath
	}
	if template.CertificateChainPath != "" {
		listener.CertificateChainPath = template.CertificateChainPath
	}
	return listener
}

func windowsApacheMarkSiteTLS(site *windowsRuntimeSite) {
	for index := range site.Listen {
		site.Listen[index].Protocol = "HTTPS"
	}
}

func windowsApacheSetCertificatePath(site *windowsRuntimeSite, certificatePath string) {
	for index := range site.Listen {
		site.Listen[index].Protocol = "HTTPS"
		site.Listen[index].CertificatePath = certificatePath
	}
}

func windowsApacheSetCertificateKeyPath(site *windowsRuntimeSite, keyPath string) {
	for index := range site.Listen {
		site.Listen[index].Protocol = "HTTPS"
		site.Listen[index].CertificateKeyPath = keyPath
	}
}

func windowsApacheSetCertificateChainPath(site *windowsRuntimeSite, chainPath string) {
	for index := range site.Listen {
		site.Listen[index].Protocol = "HTTPS"
		site.Listen[index].CertificateChainPath = chainPath
	}
}

func normalizeWindowsServerName(value string) string {
	value = strings.TrimSpace(strings.Trim(value, "\"'"))
	if value == "" {
		return ""
	}
	if strings.HasPrefix(value, "[") {
		if end := strings.Index(value, "]"); end > 0 {
			return value[1:end]
		}
		return value
	}
	if colon := strings.LastIndex(value, ":"); colon > 0 && isWindowsNumeric(value[colon+1:]) {
		return value[:colon]
	}
	return value
}

func fingerprintWindowsConfigFiles(files []string) (string, []windowsDiscoveryWarning) {
	if len(files) == 0 {
		return "", nil
	}
	paths := uniqueWindowsPaths(files)
	sort.Strings(paths)
	hash := sha256.New()
	var warnings []windowsDiscoveryWarning
	readable := 0
	for _, path := range paths {
		content, err := os.ReadFile(path)
		if err != nil {
			warnings = append(warnings, windowsDiscoveryWarning{Code: "CONFIG_UNREADABLE", Message: "配置文件不可读，无法计算完整配置指纹", Path: path})
			continue
		}
		readable++
		fileHash := sha256.Sum256(content)
		_, _ = hash.Write([]byte(path))
		_, _ = hash.Write([]byte{0})
		_, _ = hash.Write(fileHash[:])
	}
	if readable == 0 {
		return "", warnings
	}
	return hex.EncodeToString(hash.Sum(nil)), warnings
}

func resolveWindowsIncludePaths(baseDir string, root string, pattern string) []string {
	pattern = strings.TrimSpace(strings.Trim(pattern, "\"'"))
	if pattern == "" || strings.Contains(pattern, "$") {
		return nil
	}
	candidates := []string{}
	if filepath.IsAbs(pattern) {
		candidates = append(candidates, windowsCleanPath(pattern))
	} else {
		if root != "" {
			candidates = append(candidates, windowsCleanPath(filepath.Join(root, pattern)))
		}
		if baseDir != "" {
			candidates = append(candidates, windowsCleanPath(filepath.Join(baseDir, pattern)))
		}
	}
	var result []string
	seen := map[string]struct{}{}
	for _, candidate := range candidates {
		matches, err := filepath.Glob(candidate)
		if err == nil && len(matches) > 0 {
			for _, match := range matches {
				if _, exists := seen[match]; !exists {
					seen[match] = struct{}{}
					result = append(result, windowsCleanPath(match))
				}
			}
			continue
		}
		if _, err := os.Stat(candidate); err == nil {
			if _, exists := seen[candidate]; !exists {
				seen[candidate] = struct{}{}
				result = append(result, candidate)
			}
		}
	}
	return result
}

func splitWindowsDirectiveArgs(value string) []string {
	var result []string
	var builder strings.Builder
	inQuotes := false
	for _, char := range value {
		switch char {
		case '"':
			inQuotes = !inQuotes
		case ' ', '\t', '\r':
			if inQuotes {
				builder.WriteRune(char)
			} else if builder.Len() > 0 {
				result = append(result, builder.String())
				builder.Reset()
			}
		default:
			builder.WriteRune(char)
		}
	}
	if builder.Len() > 0 {
		result = append(result, builder.String())
	}
	return result
}

func stripWindowsConfigComment(line string) string {
	inQuotes := false
	for index, char := range line {
		switch char {
		case '"':
			inQuotes = !inQuotes
		case '#':
			if !inQuotes {
				return line[:index]
			}
		}
	}
	return line
}

func firstWindowsToken(value string) string {
	args := splitWindowsDirectiveArgs(value)
	if len(args) == 0 {
		return ""
	}
	return strings.ToLower(args[0])
}

func windowsActiveSiteIndex(stack []windowsNginxContext) int {
	for index := len(stack) - 1; index >= 0; index-- {
		if stack[index].siteIndex >= 0 {
			return stack[index].siteIndex
		}
	}
	return -1
}

func windowsActiveApacheSiteIndex(stack []windowsApacheContext) int {
	for index := len(stack) - 1; index >= 0; index-- {
		if stack[index].siteIndex >= 0 {
			return stack[index].siteIndex
		}
	}
	return -1
}

func containsWindowsPath(paths []string, expected string) bool {
	expected = windowsCleanPath(expected)
	for _, path := range paths {
		if windowsCleanPath(path) == expected {
			return true
		}
	}
	return false
}

func sortedWindowsPaths(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, windowsCleanPath(value))
	}
	sort.Strings(result)
	return result
}

func uniqueWindowsPaths(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		cleaned := windowsCleanPath(value)
		if cleaned == "" {
			continue
		}
		if _, exists := seen[cleaned]; exists {
			continue
		}
		seen[cleaned] = struct{}{}
		result = append(result, cleaned)
	}
	sort.Strings(result)
	return result
}

func uniqueWindowsDiscoveryWarnings(values []windowsDiscoveryWarning) []windowsDiscoveryWarning {
	seen := map[string]struct{}{}
	result := make([]windowsDiscoveryWarning, 0, len(values))
	for _, value := range values {
		key := value.Code + "\x00" + value.Path + "\x00" + value.Message
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		result = append(result, value)
	}
	sort.Slice(result, func(left, right int) bool {
		if result[left].Code != result[right].Code {
			return result[left].Code < result[right].Code
		}
		return result[left].Path < result[right].Path
	})
	return result
}

func windowsStableToken(parts ...string) string {
	hash := sha256.New()
	for index, part := range parts {
		if index > 0 {
			_, _ = hash.Write([]byte{0})
		}
		_, _ = hash.Write([]byte(strings.TrimSpace(part)))
	}
	return hex.EncodeToString(hash.Sum(nil))[:20]
}

func isWindowsNumeric(value string) bool {
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

func windowsAtoi(value string) int {
	result, _ := strconv.Atoi(value)
	return result
}

func nonEmptyStrings(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result = append(result, strings.TrimSpace(value))
		}
	}
	return result
}

func uniqueWindowsStrings(values []string) []string {
	seen := map[string]struct{}{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	sort.Strings(result)
	return result
}

func detectWindowsTomcatVersion(tomcatPath string) string {
	if strings.TrimSpace(tomcatPath) == "" {
		return ""
	}
	content, err := os.ReadFile(filepath.Join(tomcatPath, "RELEASE-NOTES"))
	if err != nil {
		return ""
	}
	match := regexp.MustCompile(`(?i)Apache Tomcat Version\s+([0-9.]+)`).FindStringSubmatch(string(content))
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func appendWindowsRuntimeDiscovery(payload map[string]any, hostname string, detail any, providerType string, serviceName string, includeBindings bool) {
	if detail == nil {
		return
	}
	detailMap, ok := windowsAnyToMap(detail)
	if !ok {
		return
	}
	appendWindowsDiscoveryWarnings(payload, providerType, windowsReadObjects(detailMap, "warnings", "Warnings"))
	if !windowsReadBool(detailMap, "installed", "Installed") {
		return
	}
	frameworkKey := "framework:" + windowsStableToken(providerType, windowsReadString(detailMap, "configPath", "ConfigPath", "serverRoot", "ServerRoot"))
	services := payload["services"].([]map[string]any)
	services = append(services, map[string]any{
		"hostname":          hostname,
		"providerType":      providerType,
		"serviceName":       firstNonEmpty(windowsReadString(detailMap, "serviceName", "ServiceName"), serviceName),
		"displayName":       serviceName,
		"frameworkKey":      frameworkKey,
		"configPath":        windowsReadString(detailMap, "configPath", "ConfigPath"),
		"programPath":       windowsReadString(detailMap, "binaryPath", "BinaryPath", "javaPath", "JavaPath"),
		"configFingerprint": windowsReadString(detailMap, "configFingerprint", "ConfigFingerprint"),
		"discoverySource":   "AGENT",
		"status":            "ACTIVE",
		"rawFacts":          detail,
	})
	payload["services"] = services
	sites := windowsReadObjects(detailMap, "sites", "Sites")
	appendWindowsSiteRecords(payload, hostname, providerType, serviceName, frameworkKey, detail, sites, includeBindings)
}

func appendWindowsTomcatDiscovery(payload map[string]any, hostname string, detail *windowsTomcatDetail, includeBindings bool) {
	if detail == nil {
		return
	}
	appendWindowsDiscoveryWarnings(payload, "TOMCAT", windowsReadObjectsFromValue(detail.Warnings))
	if !detail.Installed {
		return
	}
	frameworkKey := "framework:" + windowsStableToken("TOMCAT", detail.ConfigPath, detail.TomcatPath)
	services := payload["services"].([]map[string]any)
	services = append(services, map[string]any{
		"hostname":          hostname,
		"providerType":      "TOMCAT",
		"serviceName":       detail.ServiceName,
		"displayName":       "tomcat",
		"frameworkKey":      frameworkKey,
		"configPath":        detail.ConfigPath,
		"programPath":       detail.JavaPath,
		"tomcatPath":        detail.TomcatPath,
		"configFingerprint": detail.ConfigFingerprint,
		"discoverySource":   "AGENT",
		"status":            "ACTIVE",
		"rawFacts":          detail,
	})
	payload["services"] = services
	sites := make([]map[string]any, 0, len(detail.Connectors))
	for index := range detail.Connectors {
		site, _ := windowsAnyToMap(windowsTomcatSite(*detail)[index])
		sites = append(sites, site)
	}
	appendWindowsSiteRecords(payload, hostname, "TOMCAT", firstNonEmpty(detail.ServiceName, "tomcat"), frameworkKey, detail, sites, includeBindings)
}

func appendWindowsSiteRecords(payload map[string]any, hostname, providerType, serviceName, frameworkKey string, detail any, sites []map[string]any, includeBindings bool) {
	serviceAssets := payload["serviceAssets"].([]map[string]any)
	siteAssets := payload["siteAssets"].([]map[string]any)
	bindings := payload["bindings"].([]map[string]any)
	for siteIndex, site := range sites {
		siteName := firstNonEmpty(windowsReadString(site, "name", "Name"), fmt.Sprintf("%s-site-%d", strings.ToLower(providerType), siteIndex+1))
		siteIdentity := firstNonEmpty(windowsReadString(site, "id", "ID", "siteKey"), strings.Join(windowsReadStrings(site, "configFiles", "ConfigFiles"), "|"), strconv.Itoa(siteIndex))
		listeners := windowsReadObjects(site, "listen", "Listen")
		for listenerIndex, listener := range listeners {
			port := windowsReadInt(listener, "port", "Port")
			if port <= 0 || port > 65535 {
				continue
			}
			protocol := strings.ToUpper(windowsReadString(listener, "protocol", "Protocol"))
			if protocol == "" {
				protocol = "HTTP"
			}
			address := firstNonEmpty(
				windowsReadString(listener, "hostHeader", "HostHeader"),
				firstString(windowsReadStrings(site, "serverNames", "ServerNames")),
				windowsReadString(listener, "address", "Address", "IPAddress"),
				hostname,
			)
			bindingInformation := firstNonEmpty(
				windowsReadString(listener, "bindingInformation", "BindingInformation"),
				strings.Join([]string{firstNonEmpty(windowsReadString(listener, "address", "Address"), "*"), strconv.Itoa(port), windowsReadString(listener, "hostHeader", "HostHeader")}, ":"),
			)
			siteStableKey := "site:" + windowsStableToken(hostname, providerType, windowsReadString(site, "configFingerprint", "ConfigFingerprint"), siteIdentity, siteName, bindingInformation, strconv.Itoa(listenerIndex))
			serviceAssetRef := "service-asset:" + windowsStableToken(hostname, providerType, frameworkKey, address, strconv.Itoa(port), protocol)
			siteAssetRef := "site-asset:" + windowsStableToken(hostname, siteStableKey)
			serviceAssets = append(serviceAssets, map[string]any{
				"serviceAssetRef": serviceAssetRef,
				"frameworkKey":    frameworkKey,
				"hostname":        hostname,
				"providerType":    providerType,
				"serviceName":     serviceName,
				"address":         address,
				"port":            port,
				"protocol":        protocol,
				"sniName":         windowsReadString(listener, "hostHeader", "HostHeader"),
				"displayName":     siteName,
				"metadata": map[string]any{
					"configPath":        firstString(windowsReadStrings(site, "configFiles", "ConfigFiles")),
					"configFingerprint": windowsReadString(listener, "configFingerprint", "ConfigFingerprint"),
					"siteStableKey":     siteStableKey,
				},
			})
			siteAssets = append(siteAssets, map[string]any{
				"siteAssetRef":       siteAssetRef,
				"serviceAssetRef":    serviceAssetRef,
				"frameworkKey":       frameworkKey,
				"hostname":           hostname,
				"providerType":       providerType,
				"serviceName":        serviceName,
				"siteType":           "WEB_SITE",
				"siteName":           siteName,
				"siteKey":            siteStableKey,
				"bindingInformation": bindingInformation,
				"hostHeader":         windowsReadString(listener, "hostHeader", "HostHeader"),
				"listenIp":           windowsReadString(listener, "address", "Address", "IPAddress"),
				"port":               port,
				"protocol":           protocol,
				"configPath":         firstString(windowsReadStrings(site, "configFiles", "ConfigFiles")),
				"configFingerprint":  windowsReadString(listener, "configFingerprint", "ConfigFingerprint"),
			})
			if !includeBindings || !windowsIsTLSListener(listener) {
				continue
			}
			certificate := windowsReadMap(listener, "certificate", "Certificate")
			bindingType := "FILE_PATH"
			storageKind := "PEM_FILES"
			if windowsReadString(listener, "keystorePath", "KeystorePath") != "" {
				bindingType = "KEYSTORE"
				storageKind = "KEYSTORE"
			}
			programPath := windowsReadString(windowsMustMap(detail), "binaryPath", "BinaryPath", "javaPath", "JavaPath")
			bindingKey := "binding:" + windowsStableToken(siteStableKey, bindingInformation, windowsReadString(listener, "certificatePath", "CertificatePath", "keystorePath", "KeystorePath"), windowsReadString(listener, "configFingerprint", "ConfigFingerprint"))
			bindings = append(bindings, map[string]any{
				"bindingKey":        bindingKey,
				"siteAssetRef":      siteAssetRef,
				"serviceAssetRef":   serviceAssetRef,
				"frameworkKey":      frameworkKey,
				"hostname":          hostname,
				"providerType":      providerType,
				"serviceName":       serviceName,
				"domainName":        windowsReadString(listener, "hostHeader", "HostHeader"),
				"port":              port,
				"protocol":          protocol,
				"bindingType":       bindingType,
				"certPath":          windowsReadString(listener, "certificatePath", "CertificatePath"),
				"keyPath":           windowsReadString(listener, "certificateKeyPath", "CertificateKeyPath"),
				"chainPath":         windowsReadString(listener, "certificateChainPath", "CertificateChainPath"),
				"keystorePath":      windowsReadString(listener, "keystorePath", "KeystorePath"),
				"keystoreType":      windowsReadString(listener, "keystoreType", "KeystoreType"),
				"configPath":        firstString(windowsReadStrings(site, "configFiles", "ConfigFiles")),
				"configFingerprint": windowsReadString(listener, "configFingerprint", "ConfigFingerprint"),
				"certificate":       certificate,
				"verifyMethod":      "TLS_CONNECT",
				"metadata": map[string]any{
					"certificateLocation": map[string]any{
						"apiVersion":        "gcac.certificate-location/v1",
						"storageKind":       storageKind,
						"certificatePath":   windowsReadString(listener, "certificatePath", "CertificatePath"),
						"privateKeyPath":    windowsReadString(listener, "certificateKeyPath", "CertificateKeyPath"),
						"chainPath":         windowsReadString(listener, "certificateChainPath", "CertificateChainPath"),
						"keystorePath":      windowsReadString(listener, "keystorePath", "KeystorePath"),
						"keystoreType":      windowsReadString(listener, "keystoreType", "KeystoreType"),
						"sourceConfigPath":  firstString(windowsReadStrings(site, "configFiles", "ConfigFiles")),
						"serviceName":       serviceName,
						"programPath":       programPath,
						"configFingerprint": windowsReadString(listener, "configFingerprint", "ConfigFingerprint"),
						"confidence":        "EXACT",
					},
				},
			})
		}
	}
	payload["serviceAssets"] = serviceAssets
	payload["siteAssets"] = siteAssets
	payload["bindings"] = bindings
}

func appendWindowsDiscoveryWarnings(payload map[string]any, providerType string, warnings []map[string]any) {
	if len(warnings) == 0 {
		return
	}
	current, ok := payload["warnings"].([]map[string]any)
	if !ok {
		current = make([]map[string]any, 0)
	}
	for _, warning := range warnings {
		code := windowsReadString(warning, "code", "Code")
		if code == "" {
			continue
		}
		current = append(current, map[string]any{
			"providerType": providerType,
			"code":         code,
			"message":      windowsReadString(warning, "message", "Message"),
			"path":         windowsReadString(warning, "path", "Path"),
		})
	}
	payload["warnings"] = current
}

func windowsReadObjectsFromValue(value any) []map[string]any {
	converted, ok := windowsAnyToMap(value)
	if ok {
		return windowsReadObjects(converted, "warnings", "Warnings")
	}
	if values, ok := value.([]windowsDiscoveryWarning); ok {
		result := make([]map[string]any, 0, len(values))
		for _, warning := range values {
			result = append(result, map[string]any{
				"code":    warning.Code,
				"message": warning.Message,
				"path":    warning.Path,
			})
		}
		return result
	}
	return nil
}

func windowsAnyToMap(value any) (map[string]any, bool) {
	raw, err := json.Marshal(value)
	if err != nil {
		return nil, false
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, false
	}
	return result, true
}

func windowsMustMap(value any) map[string]any {
	result, _ := windowsAnyToMap(value)
	return result
}

func windowsReadMap(value map[string]any, keys ...string) map[string]any {
	for _, key := range keys {
		if result, ok := value[key].(map[string]any); ok {
			return result
		}
	}
	return map[string]any{}
}

func windowsReadObjects(value map[string]any, keys ...string) []map[string]any {
	for _, key := range keys {
		raw, ok := value[key]
		if !ok {
			continue
		}
		if items, ok := raw.([]any); ok {
			result := make([]map[string]any, 0, len(items))
			for _, item := range items {
				if record, ok := item.(map[string]any); ok {
					result = append(result, record)
				}
			}
			return result
		}
	}
	return nil
}

func windowsReadString(value map[string]any, keys ...string) string {
	for _, key := range keys {
		if text, ok := value[key].(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	}
	return ""
}

func windowsReadStrings(value map[string]any, keys ...string) []string {
	for _, key := range keys {
		if items, ok := value[key].([]any); ok {
			result := make([]string, 0, len(items))
			for _, item := range items {
				if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
					result = append(result, strings.TrimSpace(text))
				}
			}
			return result
		}
	}
	return nil
}

func windowsReadInt(value map[string]any, keys ...string) int {
	for _, key := range keys {
		switch raw := value[key].(type) {
		case float64:
			return int(raw)
		case int:
			return raw
		}
	}
	return 0
}

func windowsReadBool(value map[string]any, keys ...string) bool {
	for _, key := range keys {
		if result, ok := value[key].(bool); ok {
			return result
		}
	}
	return false
}

func windowsIsTLSListener(value map[string]any) bool {
	protocol := strings.ToUpper(windowsReadString(value, "protocol", "Protocol"))
	return protocol == "HTTPS" || windowsReadString(value, "certificatePath", "CertificatePath", "keystorePath", "KeystorePath") != ""
}

func firstString(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}

const windowsRuntimeFactScript = `
$ErrorActionPreference = 'Stop'

function Get-SafeCommandLine {
  param([string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) { return $null }
  $safe = $Value
  $safe = [regex]::Replace($safe, '(?i)(keystorePass|certificateKeystorePassword|password|passwd|secret)(\s*=\s*|\s+)(?:"[^"]*"|\S+)', '$1=<redacted>')
  return $safe
}

function Get-FileVersion {
  param([string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path)) { return $null }
  try {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
      $version = (Get-Item -LiteralPath $Path -ErrorAction Stop).VersionInfo.ProductVersion
      if (-not [string]::IsNullOrWhiteSpace([string]$version)) { return [string]$version }
    }
  } catch {}
  return $null
}

$processes = @(
  Get-CimInstance Win32_Process -ErrorAction Stop |
    Where-Object { [regex]::IsMatch([string]$_.Name, '(?i)^(nginx|httpd|apache2|apache|java|tomcat|tomcat9|tomcat10|prunsrv)(\.exe)?$') } |
    ForEach-Object {
      [pscustomobject]@{
        name = [string]$_.Name
        executablePath = [string]$_.ExecutablePath
        commandLine = Get-SafeCommandLine ([string]$_.CommandLine)
        version = Get-FileVersion ([string]$_.ExecutablePath)
      }
    }
)

$services = @(
  Get-CimInstance Win32_Service -ErrorAction Stop |
    Where-Object {
      [regex]::IsMatch(([string]$_.Name + ' ' + [string]$_.DisplayName + ' ' + [string]$_.PathName), '(?i)(nginx|apache|httpd|tomcat|prunsrv)')
    } |
    ForEach-Object {
      $pathName = Get-SafeCommandLine ([string]$_.PathName)
      $executablePath = $null
      try {
        $match = [regex]::Match($pathName, '^\s*"([^"]+)"')
        if ($match.Success) { $executablePath = $match.Groups[1].Value }
        elseif ($pathName -match '^\s*([^\s]+)') { $executablePath = $Matches[1] }
      } catch {}
      [pscustomobject]@{
        name = [string]$_.Name
        displayName = [string]$_.DisplayName
        state = [string]$_.State
        pathName = $pathName
        executablePath = $executablePath
        version = Get-FileVersion $executablePath
      }
    }
)

[pscustomobject]@{
  processes = $processes
  services = $services
} | ConvertTo-Json -Depth 8 -Compress
`
