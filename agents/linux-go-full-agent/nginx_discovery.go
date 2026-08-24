package main

import (
	"crypto/sha1"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

type nginxDetail struct {
	Installed  bool              `json:"installed"`
	Running    bool              `json:"running"`
	Version    string            `json:"version,omitempty"`
	BinaryPath string            `json:"binaryPath,omitempty"`
	ConfigPath string            `json:"configPath,omitempty"`
	Prefix     string            `json:"prefix,omitempty"`
	Service    string            `json:"serviceName,omitempty"`
	Sites      []nginxSiteDetail `json:"sites,omitempty"`
}

type nginxSiteDetail struct {
	Name         string               `json:"name"`
	SiteMode     string               `json:"siteMode,omitempty"`
	ServerNames  []string             `json:"serverNames,omitempty"`
	SitePath     string               `json:"sitePath,omitempty"`
	ProxyTargets []string             `json:"proxyTargets,omitempty"`
	Listen       []nginxBindingDetail `json:"listen,omitempty"`
	ConfigFiles  []string             `json:"configFiles,omitempty"`

	serverCertificatePath    string
	serverCertificateKeyPath string
}

type nginxBindingDetail struct {
	Address            string                  `json:"address,omitempty"`
	Port               int                     `json:"port"`
	Protocol           string                  `json:"protocol,omitempty"`
	CertificateName    string                  `json:"certificateName,omitempty"`
	CertificatePath    string                  `json:"certificatePath,omitempty"`
	CertificateKeyPath string                  `json:"certificateKeyPath,omitempty"`
	Permission         map[string]any          `json:"permission,omitempty"`
	TestCommand        string                  `json:"testCommand,omitempty"`
	ReloadCommand      string                  `json:"reloadCommand,omitempty"`
	Certificate        *linuxCertificateDetail `json:"certificate,omitempty"`
}

type nginxContextFrame struct {
	kind      string
	siteIndex int
}

func detectNginxDetail() *nginxDetail {
	binaryPath := findNginxBinaryPath()
	running := processRunning("nginx")
	if binaryPath == "" && !running {
		return nil
	}

	detail := &nginxDetail{
		Installed:  binaryPath != "",
		Running:    running,
		BinaryPath: binaryPath,
		Service:    "nginx",
	}
	if binaryPath == "" {
		return detail
	}

	versionOutput, _ := captureCombinedCommand(binaryPath, "-V")
	detail.Version = parseNginxVersion(versionOutput)
	detail.ConfigPath = parseNginxBuildArgument(versionOutput, "--conf-path")
	detail.Prefix = parseNginxBuildArgument(versionOutput, "--prefix")

	configDump, dumpErr := captureCombinedCommand(binaryPath, "-T")
	sites := make([]nginxSiteDetail, 0)
	if strings.TrimSpace(configDump) != "" {
		sites = parseNginxConfigDump(configDump)
	}
	if len(sites) == 0 && detail.ConfigPath != "" && fileExists(detail.ConfigPath) {
		sites = parseNginxConfigTree(detail.ConfigPath, detail.Prefix)
	}
	if dumpErr != nil && len(sites) == 0 {
		return detail
	}
	for index := range sites {
		enrichNginxSiteCertificates(&sites[index], detail.BinaryPath, detail.Service)
	}
	detail.Sites = sites
	return detail
}

func findNginxBinaryPath() string {
	if path, err := exec.LookPath("nginx"); err == nil {
		return path
	}
	for _, candidate := range []string{
		"/usr/sbin/nginx",
		"/usr/bin/nginx",
		"/usr/local/sbin/nginx",
		"/usr/local/nginx/sbin/nginx",
	} {
		if fileExists(candidate) {
			return candidate
		}
	}
	return ""
}

func processRunning(name string) bool {
	output, err := captureCommand("ps", "-eo", "comm=")
	if err != nil {
		return false
	}
	for _, line := range strings.Split(output, "\n") {
		if strings.TrimSpace(line) == name {
			return true
		}
	}
	return false
}

func parseNginxVersion(output string) string {
	marker := "nginx version: nginx/"
	index := strings.Index(output, marker)
	if index < 0 {
		return ""
	}
	value := output[index+len(marker):]
	if end := strings.IndexAny(value, " \r\n\t"); end >= 0 {
		value = value[:end]
	}
	return strings.TrimSpace(value)
}

func parseNginxBuildArgument(output string, key string) string {
	marker := key + "="
	index := strings.Index(output, marker)
	if index < 0 {
		return ""
	}
	value := output[index+len(marker):]
	if strings.HasPrefix(value, "\"") {
		value = strings.TrimPrefix(value, "\"")
		if end := strings.Index(value, "\""); end >= 0 {
			return strings.TrimSpace(value[:end])
		}
	}
	if end := strings.IndexAny(value, " \r\n\t"); end >= 0 {
		value = value[:end]
	}
	return strings.TrimSpace(value)
}

func parseNginxConfigDump(dump string) []nginxSiteDetail {
	lines := strings.Split(dump, "\n")
	sites := make([]nginxSiteDetail, 0)
	stack := make([]nginxContextFrame, 0, 8)
	currentFile := ""

	for _, rawLine := range lines {
		trimmedLine := strings.TrimSpace(rawLine)
		if strings.HasPrefix(trimmedLine, "# configuration file ") && strings.HasSuffix(trimmedLine, ":") {
			currentFile = strings.TrimSuffix(strings.TrimPrefix(trimmedLine, "# configuration file "), ":")
			continue
		}

		line := stripNginxInlineComment(rawLine)
		for {
			trimmed := strings.TrimSpace(line)
			if trimmed == "" {
				break
			}
			if strings.HasPrefix(trimmed, "}") {
				if len(stack) > 0 {
					stack = stack[:len(stack)-1]
				}
				line = strings.TrimSpace(strings.TrimPrefix(trimmed, "}"))
				continue
			}
			if openIndex := strings.Index(trimmed, "{"); openIndex >= 0 && (strings.Index(trimmed, ";") == -1 || openIndex < strings.Index(trimmed, ";")) {
				statement := strings.TrimSpace(trimmed[:openIndex])
				kind := firstToken(statement)
				siteIndex := activeSiteIndex(stack)
				if kind == "server" {
					sites = append(sites, nginxSiteDetail{})
					siteIndex = len(sites) - 1
					addSiteConfigFile(&sites[siteIndex], currentFile)
				}
				stack = append(stack, nginxContextFrame{kind: kind, siteIndex: siteIndex})
				line = strings.TrimSpace(trimmed[openIndex+1:])
				continue
			}
			semicolonIndex := strings.Index(trimmed, ";")
			if semicolonIndex < 0 {
				break
			}
			statement := strings.TrimSpace(trimmed[:semicolonIndex])
			siteIndex := activeSiteIndex(stack)
			if siteIndex >= 0 && siteIndex < len(sites) {
				applyNginxDirective(&sites[siteIndex], statement, currentFile)
			}
			line = strings.TrimSpace(trimmed[semicolonIndex+1:])
		}
	}

	for index := range sites {
		finalizeNginxSite(&sites[index], index)
	}

	filtered := make([]nginxSiteDetail, 0, len(sites))
	for _, site := range sites {
		if len(site.Listen) == 0 && len(site.ServerNames) == 0 && site.SitePath == "" && len(site.ProxyTargets) == 0 {
			continue
		}
		filtered = append(filtered, site)
	}
	return filtered
}

func parseNginxConfigTree(configPath string, prefix string) []nginxSiteDetail {
	files := collectNginxConfigFiles(configPath, prefix, map[string]struct{}{})
	sites := make([]nginxSiteDetail, 0)
	for _, filePath := range files {
		content, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}
		dump := fmt.Sprintf("# configuration file %s:\n%s\n", filePath, string(content))
		sites = append(sites, parseNginxConfigDump(dump)...)
	}
	return uniqueNginxSites(sites)
}

func collectNginxConfigFiles(configPath string, prefix string, visited map[string]struct{}) []string {
	resolvedPath := resolveNginxPath("", prefix, configPath)
	if resolvedPath == "" {
		return nil
	}
	if _, seen := visited[resolvedPath]; seen {
		return nil
	}
	visited[resolvedPath] = struct{}{}

	content, err := os.ReadFile(resolvedPath)
	if err != nil {
		return nil
	}

	files := []string{resolvedPath}
	baseDir := filepath.Dir(resolvedPath)
	for _, includePattern := range parseNginxIncludePatterns(string(content)) {
		for _, includePath := range resolveNginxIncludePaths(baseDir, prefix, includePattern) {
			files = append(files, collectNginxConfigFiles(includePath, prefix, visited)...)
		}
	}
	return files
}

func parseNginxIncludePatterns(content string) []string {
	patterns := make([]string, 0)
	for _, rawLine := range strings.Split(content, "\n") {
		line := stripNginxInlineComment(rawLine)
		for _, statement := range splitNginxStatements(line) {
			fields := strings.Fields(statement)
			if len(fields) >= 2 && fields[0] == "include" {
				pattern := strings.TrimSpace(strings.Trim(fields[1], "\"'"))
				if pattern != "" {
					patterns = append(patterns, pattern)
				}
			}
		}
	}
	return uniqueStrings(patterns)
}

func splitNginxStatements(line string) []string {
	statements := make([]string, 0)
	rest := line
	for {
		trimmed := strings.TrimSpace(rest)
		if trimmed == "" {
			return statements
		}
		semicolonIndex := strings.Index(trimmed, ";")
		if semicolonIndex < 0 {
			return statements
		}
		statement := strings.TrimSpace(trimmed[:semicolonIndex])
		if statement != "" {
			statements = append(statements, statement)
		}
		rest = strings.TrimSpace(trimmed[semicolonIndex+1:])
	}
}

func resolveNginxIncludePaths(baseDir string, prefix string, includePattern string) []string {
	includePattern = strings.TrimSpace(strings.Trim(includePattern, "\"'"))
	if includePattern == "" || strings.Contains(includePattern, "$") {
		return nil
	}
	candidates := make([]string, 0, 2)
	if filepath.IsAbs(includePattern) {
		candidates = append(candidates, filepath.Clean(includePattern))
	} else {
		if baseDir != "" {
			candidates = append(candidates, filepath.Clean(filepath.Join(baseDir, includePattern)))
		}
		if prefix != "" {
			candidates = append(candidates, filepath.Clean(filepath.Join(prefix, includePattern)))
		}
	}

	results := make([]string, 0)
	seen := map[string]struct{}{}
	for _, candidate := range candidates {
		matches, err := filepath.Glob(candidate)
		if err == nil && len(matches) > 0 {
			for _, match := range matches {
				if _, exists := seen[match]; exists {
					continue
				}
				seen[match] = struct{}{}
				results = append(results, match)
			}
			continue
		}
		if fileExists(candidate) {
			if _, exists := seen[candidate]; exists {
				continue
			}
			seen[candidate] = struct{}{}
			results = append(results, candidate)
		}
	}
	return results
}

func resolveNginxPath(baseDir string, prefix string, value string) string {
	value = strings.TrimSpace(strings.Trim(value, "\"'"))
	if value == "" {
		return ""
	}
	if filepath.IsAbs(value) {
		return filepath.Clean(value)
	}
	if baseDir != "" {
		return filepath.Clean(filepath.Join(baseDir, value))
	}
	if prefix != "" {
		return filepath.Clean(filepath.Join(prefix, value))
	}
	return filepath.Clean(value)
}

func uniqueNginxSites(items []nginxSiteDetail) []nginxSiteDetail {
	seen := make(map[string]struct{}, len(items))
	results := make([]nginxSiteDetail, 0, len(items))
	for _, item := range items {
		key := item.Name + "\n" + item.SitePath + "\n" + strings.Join(item.ServerNames, ",") + "\n" + strings.Join(item.ConfigFiles, ",")
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		results = append(results, item)
	}
	return results
}

func stripNginxInlineComment(line string) string {
	inSingle := false
	inDouble := false
	for index, char := range line {
		switch char {
		case '\'':
			if !inDouble {
				inSingle = !inSingle
			}
		case '"':
			if !inSingle {
				inDouble = !inDouble
			}
		case '#':
			if !inSingle && !inDouble {
				return line[:index]
			}
		}
	}
	return line
}

func firstToken(statement string) string {
	fields := strings.Fields(statement)
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

func activeSiteIndex(stack []nginxContextFrame) int {
	for index := len(stack) - 1; index >= 0; index-- {
		if stack[index].siteIndex >= 0 {
			return stack[index].siteIndex
		}
	}
	return -1
}

func applyNginxDirective(site *nginxSiteDetail, statement string, currentFile string) {
	fields := strings.Fields(statement)
	if len(fields) == 0 {
		return
	}
	addSiteConfigFile(site, currentFile)
	directive := fields[0]
	args := fields[1:]
	switch directive {
	case "listen":
		if binding, ok := parseNginxListen(args); ok {
			site.Listen = append(site.Listen, binding)
		}
	case "server_name":
		for _, name := range args {
			if trimmed := strings.TrimSpace(name); trimmed != "" {
				site.ServerNames = append(site.ServerNames, trimmed)
			}
		}
	case "root":
		if site.SitePath == "" && len(args) > 0 {
			site.SitePath = strings.TrimSpace(args[0])
		}
	case "ssl_certificate":
		site.serverCertificatePath = strings.TrimSpace(firstArgument(args))
	case "ssl_certificate_key":
		site.serverCertificateKeyPath = strings.TrimSpace(firstArgument(args))
	case "proxy_pass":
		target := strings.TrimSpace(firstArgument(args))
		if target != "" {
			site.ProxyTargets = append(site.ProxyTargets, target)
		}
	}
}

func firstArgument(args []string) string {
	if len(args) == 0 {
		return ""
	}
	return strings.Trim(args[0], "\"'")
}

func parseNginxListen(args []string) (nginxBindingDetail, bool) {
	binding := nginxBindingDetail{Address: "*", Protocol: "http"}
	if len(args) == 0 {
		return binding, false
	}
	for _, arg := range args {
		value := strings.TrimSpace(strings.Trim(arg, "\"'"))
		if value == "" {
			continue
		}
		if value == "ssl" {
			binding.Protocol = "https"
			continue
		}
		if strings.ContainsAny(value, "[]:.") || isNumeric(value) {
			address, port := splitListenAddress(value)
			if port > 0 {
				if address != "" {
					binding.Address = address
				}
				binding.Port = port
				if port == 443 {
					binding.Protocol = "https"
				}
			}
		}
	}
	return binding, binding.Port > 0
}

func splitListenAddress(value string) (string, int) {
	if isNumeric(value) {
		return "*", atoiSafe(value)
	}
	if strings.HasPrefix(value, "unix:") {
		return "", 0
	}
	lastColon := strings.LastIndex(value, ":")
	if lastColon < 0 {
		return value, 0
	}
	address := value[:lastColon]
	address = strings.Trim(address, "[]")
	port := atoiSafe(value[lastColon+1:])
	return address, port
}

func isNumeric(value string) bool {
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

func atoiSafe(value string) int {
	result := 0
	for _, char := range value {
		if char < '0' || char > '9' {
			return 0
		}
		result = result*10 + int(char-'0')
	}
	return result
}

func addSiteConfigFile(site *nginxSiteDetail, path string) {
	path = strings.TrimSpace(path)
	if path == "" {
		return
	}
	for _, existing := range site.ConfigFiles {
		if existing == path {
			return
		}
	}
	site.ConfigFiles = append(site.ConfigFiles, path)
}

func finalizeNginxSite(site *nginxSiteDetail, index int) {
	site.ServerNames = uniqueStrings(site.ServerNames)
	site.ProxyTargets = uniqueStrings(site.ProxyTargets)
	site.ConfigFiles = uniqueStrings(site.ConfigFiles)
	applyNginxServerCertificate(site)
	if site.Name == "" {
		if len(site.ServerNames) > 0 {
			site.Name = site.ServerNames[0]
		} else {
			site.Name = fmt.Sprintf("server-%d", index+1)
		}
	}
	if site.SitePath != "" {
		site.SiteMode = "static_root"
	} else if len(site.ProxyTargets) > 0 {
		site.SiteMode = "reverse_proxy"
	} else {
		site.SiteMode = "unknown"
	}
}

func applyNginxServerCertificate(site *nginxSiteDetail) {
	if site.serverCertificatePath == "" && site.serverCertificateKeyPath == "" {
		return
	}
	if len(site.Listen) == 0 {
		site.Listen = append(site.Listen, nginxBindingDetail{Address: "*", Port: 443, Protocol: "https"})
	}
	for index := range site.Listen {
		if site.Listen[index].Protocol == "" {
			site.Listen[index].Protocol = "http"
		}
		if site.Listen[index].Protocol != "https" && site.Listen[index].Port != 443 && site.Listen[index].Port != 8443 {
			continue
		}
		site.Listen[index].Protocol = "https"
		if site.Listen[index].CertificatePath == "" {
			site.Listen[index].CertificatePath = site.serverCertificatePath
		}
		if site.Listen[index].CertificateKeyPath == "" {
			site.Listen[index].CertificateKeyPath = site.serverCertificateKeyPath
		}
	}
}

func enrichNginxSiteCertificates(site *nginxSiteDetail, binaryPath string, serviceName string) {
	for index := range site.Listen {
		if site.Listen[index].CertificatePath == "" && site.Listen[index].Protocol != "https" {
			continue
		}
		site.Listen[index].Certificate = readNginxLiveCertificateDetail(site.Listen[index], site.ServerNames)
		if site.Listen[index].Certificate == nil && site.Listen[index].CertificatePath != "" {
			site.Listen[index].Certificate = readCertificateDetail(site.Listen[index].CertificatePath)
		}
		if site.Listen[index].Certificate != nil {
			site.Listen[index].CertificateName = site.Listen[index].Certificate.Subject
		}
		site.Listen[index].TestCommand = defaultNginxTestCommand(binaryPath)
		site.Listen[index].ReloadCommand = defaultNginxReloadCommand(binaryPath, serviceName)
		site.Listen[index].Permission = inspectNginxBindingPermission(site.Listen[index], site.Listen[index].TestCommand, site.Listen[index].ReloadCommand)
	}
}

func defaultNginxTestCommand(binaryPath string) string {
	path := strings.TrimSpace(binaryPath)
	if path == "" {
		return "nginx -t"
	}
	return fmt.Sprintf("%s -t", path)
}

func defaultNginxReloadCommand(binaryPath string, serviceName string) string {
	trimmedService := strings.TrimSpace(serviceName)
	if trimmedService != "" && lookPath("systemctl") {
		return fmt.Sprintf("systemctl reload %s", trimmedService)
	}
	path := strings.TrimSpace(binaryPath)
	if path == "" {
		return "nginx -s reload"
	}
	return fmt.Sprintf("%s -s reload", path)
}

func readCertificateDetail(path string) *linuxCertificateDetail {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil
	}
	return readCertificateDetailFromPEMBytes(content, "FILE_PATH")
}

func readNginxLiveCertificateDetail(binding nginxBindingDetail, serverNames []string) *linuxCertificateDetail {
	if binding.Port <= 0 {
		return nil
	}
	if binding.Protocol != "https" && binding.Port != 443 && binding.Port != 8443 {
		return nil
	}
	address := nginxTLSProbeAddress(binding)
	if address == "" {
		return nil
	}
	for _, serverName := range nginxTLSProbeServerNames(binding, serverNames) {
		dialer := &net.Dialer{Timeout: 2 * time.Second}
		config := &tls.Config{InsecureSkipVerify: true}
		if serverName != "" {
			config.ServerName = serverName
		}
		conn, err := tls.DialWithDialer(dialer, "tcp", address, config)
		if err != nil {
			continue
		}
		state := conn.ConnectionState()
		_ = conn.Close()
		if len(state.PeerCertificates) == 0 {
			continue
		}
		return buildLinuxCertificateDetail(state.PeerCertificates[0], "TLS_CONNECT")
	}
	return nil
}

func nginxTLSProbeAddress(binding nginxBindingDetail) string {
	host := strings.TrimSpace(binding.Address)
	if host == "" || host == "*" || host == "0.0.0.0" || host == "::" || host == "[::]" || strings.EqualFold(host, "default_server") {
		host = "127.0.0.1"
	}
	host = strings.Trim(host, "[]")
	if strings.HasPrefix(host, "unix:") || strings.Contains(host, "$") {
		return ""
	}
	return net.JoinHostPort(host, fmt.Sprintf("%d", binding.Port))
}

func nginxTLSProbeServerNames(binding nginxBindingDetail, serverNames []string) []string {
	candidates := make([]string, 0, len(serverNames)+2)
	for _, name := range serverNames {
		trimmed := strings.TrimSpace(strings.Trim(name, "\"'"))
		if trimmed == "" || trimmed == "_" || strings.Contains(trimmed, "$") || strings.Contains(trimmed, "*") {
			continue
		}
		candidates = append(candidates, trimmed)
	}
	address := strings.Trim(strings.TrimSpace(binding.Address), "[]")
	if address != "" && address != "*" && address != "0.0.0.0" && address != "::" && net.ParseIP(address) == nil && !strings.Contains(address, "$") {
		candidates = append(candidates, address)
	}
	candidates = append(candidates, "")
	return uniqueStrings(candidates)
}

func readCertificateSubject(path string) string {
	detail := readCertificateDetail(path)
	if detail == nil {
		return ""
	}
	return detail.Subject
}

func readCertificateDetailFromPEMBytes(content []byte, storeName string) *linuxCertificateDetail {
	for {
		block, rest := pem.Decode(content)
		if block == nil {
			return nil
		}
		if block.Type == "CERTIFICATE" {
			certificate, err := x509.ParseCertificate(block.Bytes)
			if err == nil {
				return buildLinuxCertificateDetail(certificate, storeName)
			}
		}
		content = rest
	}
}

func buildLinuxCertificateDetail(certificate *x509.Certificate, storeName string) *linuxCertificateDetail {
	if certificate == nil {
		return nil
	}
	sum := sha1.Sum(certificate.Raw)
	thumbprint := strings.ToUpper(hex.EncodeToString(sum[:]))
	sha256Sum := sha256.Sum256(certificate.Raw)
	return &linuxCertificateDetail{
		Subject:           certificate.Subject.String(),
		Issuer:            certificate.Issuer.String(),
		NotBefore:         certificate.NotBefore.UTC().Format(time.RFC3339),
		NotAfter:          certificate.NotAfter.UTC().Format(time.RFC3339),
		Thumbprint:        thumbprint,
		FingerprintSHA256: strings.ToLower(hex.EncodeToString(sha256Sum[:])),
		StoreName:         storeName,
	}
}

func readPKCS12CertificateSubject(path string, password string) string {
	detail := readPKCS12CertificateDetail(path, password)
	if detail == nil {
		return ""
	}
	return detail.Subject
}

func readPKCS12CertificateDetail(path string, password string) *linuxCertificateDetail {
	if !fileExists(path) || !lookPath("openssl") {
		return nil
	}
	args := []string{"pkcs12", "-in", path, "-clcerts", "-nokeys", "-passin", "pass:" + password}
	output, err := captureCombinedCommand("openssl", args...)
	if err != nil {
		return nil
	}
	return readCertificateDetailFromPEM(output, path)
}

func readCertificateSubjectFromPEM(content string) string {
	detail := readCertificateDetailFromPEM(content, "FILE_PATH")
	if detail == nil {
		return ""
	}
	return detail.Subject
}

func readCertificateDetailFromPEM(content string, storeName string) *linuxCertificateDetail {
	remaining := []byte(content)
	for {
		block, rest := pem.Decode(remaining)
		if block == nil {
			return nil
		}
		if block.Type == "CERTIFICATE" {
			certificate, err := x509.ParseCertificate(block.Bytes)
			if err == nil {
				return buildLinuxCertificateDetail(certificate, storeName)
			}
		}
		remaining = rest
	}
}

func uniqueStrings(items []string) []string {
	seen := make(map[string]struct{}, len(items))
	result := make([]string, 0, len(items))
	for _, item := range items {
		trimmed := strings.TrimSpace(item)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}
