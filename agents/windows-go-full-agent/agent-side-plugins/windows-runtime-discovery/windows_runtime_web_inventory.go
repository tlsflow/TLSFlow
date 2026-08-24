package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"strings"
)

// collectWindowsMatureWebInventory 只把已解析的有效运行态配置转换为 Web 库存。
// 不扫描候选目录，不猜测证书，也不把 TLS 握手结果当成发现资产。
func collectWindowsMatureWebInventory(ctx context.Context, logger *runtimeLogger) map[string]any {
	inventory := map[string]any{
		"scope":            fullWebDiscoveryScope,
		"frameworks":       []map[string]any{},
		"sites":            []map[string]any{},
		"certificateFiles": []map[string]any{},
		"configFiles":      []map[string]any{},
		"warnings":         []map[string]any{},
		"diagnostics": map[string]any{
			"scanner": "windows-runtime-discovery",
			"source":  "runtime-effective-config",
		},
	}

	host := windowsRuntimeDiscoveryHost{ctx: ctx, timeout: windowsDiscoveryScanTimeout}
	iis, iisErr := inspectWindowsIISRuntime(host)
	if iisErr != nil {
		appendWindowsMatureWarning(inventory, windowsDiscoveryWarning{
			Code:    "IIS_RUNTIME_DISCOVERY_FAILED",
			Message: iisErr.Error(),
		})
		if logger != nil {
			logger.Warn("mature Windows IIS runtime discovery failed: %v", iisErr)
		}
	} else {
		appendWindowsMatureRuntimeDetail(inventory, "web.iis", "IIS", iis.Installed, iis.Version, windowsSystem32Directory+`\inetsrv`, iis.ConfigPath, "", windowsSystem32Directory+`\inetsrv`, iis.Sites, iis.Warnings)
	}
	nginx, apache, tomcat, err := inspectWindowsRuntimeDiscovery(host)
	if err != nil {
		appendWindowsMatureWarning(inventory, windowsDiscoveryWarning{Code: "RUNTIME_DISCOVERY_FAILED", Message: err.Error()})
		if logger != nil {
			logger.Warn("mature Windows runtime discovery failed: %v", err)
		}
	} else {
		appendWindowsMatureRuntimeDetailWithService(inventory, "web.nginx", "Nginx", nginx.Installed, nginx.Version, nginx.BinaryPath, nginx.ServiceName, nginx.ConfigPath, nginx.ConfigFingerprint, nginx.ConfigRoot, nginx.Sites, nginx.Warnings)
		appendWindowsMatureRuntimeDetailWithService(inventory, "web.apache", "Apache", apache.Installed, apache.Version, apache.BinaryPath, apache.ServiceName, apache.ConfigPath, apache.ConfigFingerprint, apache.ServerRoot, apache.Sites, apache.Warnings)
		appendWindowsMatureRuntimeDetailWithService(inventory, "app.tomcat", "Tomcat", tomcat.Installed, tomcat.Version, tomcat.JavaPath, tomcat.ServiceName, tomcat.ConfigPath, tomcat.ConfigFingerprint, tomcat.TomcatPath, windowsTomcatSite(tomcat), tomcat.Warnings)
	}

	if logger != nil {
		logger.Info(
			"mature Windows runtime discovery completed frameworks=%d sites=%d certificates=%d warnings=%d",
			len(inventory["frameworks"].([]map[string]any)),
			len(inventory["sites"].([]map[string]any)),
			len(inventory["certificateFiles"].([]map[string]any)),
			len(inventory["warnings"].([]map[string]any)),
		)
	}
	return inventory
}

func appendWindowsMatureRuntimeDetail(
	inventory map[string]any,
	frameworkType string,
	displayName string,
	installed bool,
	version string,
	programPath string,
	configPath string,
	configFingerprint string,
	workingDirectory string,
	sites []windowsRuntimeSite,
	warnings []windowsDiscoveryWarning,
) {
	appendWindowsMatureRuntimeDetailWithService(inventory, frameworkType, displayName, installed, version, programPath, "", configPath, configFingerprint, workingDirectory, sites, warnings)
}

func appendWindowsMatureRuntimeDetailWithService(
	inventory map[string]any,
	frameworkType string,
	displayName string,
	installed bool,
	version string,
	programPath string,
	serviceName string,
	configPath string,
	configFingerprint string,
	workingDirectory string,
	sites []windowsRuntimeSite,
	warnings []windowsDiscoveryWarning,
) {
	for _, warning := range warnings {
		appendWindowsMatureWarning(inventory, warning)
	}
	if !installed {
		return
	}

	frameworks := inventory["frameworks"].([]map[string]any)
	frameworkMetadata := map[string]any{
		"source": "runtime-effective-config",
	}
	if path := normalizeWindowsRuntimeInventoryPath(programPath); path != "" {
		frameworkMetadata["programPath"] = path
	}
	if path := normalizeWindowsRuntimeInventoryPath(configPath); path != "" {
		frameworkMetadata["configPath"] = path
	}
	if strings.TrimSpace(serviceName) != "" {
		frameworkMetadata["serviceName"] = strings.TrimSpace(serviceName)
	}
	if strings.TrimSpace(configFingerprint) != "" {
		frameworkMetadata["configFingerprint"] = strings.TrimSpace(configFingerprint)
	}
	if path := normalizeWindowsRuntimeInventoryPath(workingDirectory); path != "" {
		frameworkMetadata["workingDirectory"] = path
	}
	configCheckArgs := windowsRuntimeConfigCheckArgs(frameworkType, configPath, workingDirectory)
	if len(configCheckArgs) > 0 {
		frameworkMetadata["configCheckArgs"] = configCheckArgs
		frameworkMetadata["configCheckArgsTemplate"] = append([]string(nil), configCheckArgs...)
	}
	programSha256, programWarning := sha256WindowsRuntimeProgram(programPath)
	if programWarning != nil {
		appendWindowsMatureWarning(inventory, *programWarning)
	}
	if programSha256 != "" {
		frameworkMetadata["programSha256"] = programSha256
	}
	frameworks = append(frameworks, map[string]any{
		"frameworkType": frameworkType,
		"displayName":   displayName,
		"version":       version,
		"metadata":      frameworkMetadata,
	})
	inventory["frameworks"] = frameworks
	appendWindowsMatureConfigFile(inventory, configPath)

	for _, site := range sites {
		appendWindowsMatureSite(inventory, frameworkType, site, programPath, programSha256, serviceName, configPath, configFingerprint, workingDirectory, configCheckArgs)
	}
}

func sha256WindowsRuntimeProgram(path string) (string, *windowsDiscoveryWarning) {
	path = strings.TrimSpace(strings.Trim(path, "\"'"))
	if path == "" {
		return "", nil
	}
	file, err := os.Open(path)
	if err != nil {
		return "", &windowsDiscoveryWarning{
			Code:    "PROGRAM_SHA256_UNAVAILABLE",
			Message: fmt.Sprintf("无法读取已确认的运行程序并计算 SHA-256: %v", err),
			Path:    path,
		}
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return "", &windowsDiscoveryWarning{
			Code:    "PROGRAM_SHA256_UNAVAILABLE",
			Message: fmt.Sprintf("无法读取已确认的运行程序文件属性并计算 SHA-256: %v", err),
			Path:    path,
		}
	}
	if !info.Mode().IsRegular() {
		return "", &windowsDiscoveryWarning{
			Code:    "PROGRAM_SHA256_UNAVAILABLE",
			Message: "已确认的运行程序路径不是常规文件，无法计算 SHA-256",
			Path:    path,
		}
	}

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", &windowsDiscoveryWarning{
			Code:    "PROGRAM_SHA256_UNAVAILABLE",
			Message: fmt.Sprintf("读取已确认的运行程序内容并计算 SHA-256 失败: %v", err),
			Path:    path,
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func appendWindowsMatureSite(
	inventory map[string]any,
	frameworkType string,
	site windowsRuntimeSite,
	programPath string,
	programSha256 string,
	serviceName string,
	fallbackConfigPath string,
	fallbackConfigFingerprint string,
	workingDirectory string,
	configCheckArgs []string,
) {
	listeners := make([]map[string]any, 0, len(site.Listen))
	for _, listener := range site.Listen {
		protocol := strings.ToUpper(strings.TrimSpace(listener.Protocol))
		if protocol != "HTTP" && protocol != "HTTPS" {
			continue
		}
		sourceConfigPath := firstNonEmpty(firstWindowsRuntimePath(site.ConfigFiles), fallbackConfigPath)
		listenerRecord := map[string]any{
			"address":            normalizeWindowsRuntimeInventoryAddress(listener.Address),
			"port":               listener.Port,
			"protocol":           protocol,
			"host":               firstNonEmpty(listener.HostHeader, firstWindowsRuntimePath(site.ServerNames)),
			"bindingInformation": listener.BindingInformation,
			"sourceConfigPath":   normalizeWindowsRuntimeInventoryPath(sourceConfigPath),
		}
		if fingerprint := firstNonEmpty(listener.ConfigFingerprint, site.ConfigFingerprint, fallbackConfigFingerprint); fingerprint != "" {
			listenerRecord["configFingerprint"] = fingerprint
		}
		if path := normalizeWindowsRuntimeInventoryPath(programPath); path != "" {
			listenerRecord["programPath"] = path
		}
		if strings.TrimSpace(programSha256) != "" {
			listenerRecord["programSha256"] = strings.TrimSpace(programSha256)
		}
		if strings.TrimSpace(serviceName) != "" {
			listenerRecord["serviceName"] = strings.TrimSpace(serviceName)
		}
		if path := normalizeWindowsRuntimeInventoryPath(workingDirectory); path != "" {
			listenerRecord["workingDirectory"] = path
		}
		if len(configCheckArgs) > 0 {
			listenerRecord["configCheckArgs"] = append([]string(nil), configCheckArgs...)
			listenerRecord["configCheckArgsTemplate"] = append([]string(nil), configCheckArgs...)
		}
		appendWindowsMatureListenerPaths(listenerRecord, listener)
		listeners = append(listeners, listenerRecord)
		if protocol == "HTTPS" {
			appendWindowsMatureCertificate(inventory, listener)
		}
	}
	if len(listeners) == 0 {
		return
	}

	primaryListener := listeners[0]
	for _, listener := range listeners {
		if stringFromMap(listener, "protocol") == "HTTPS" {
			primaryListener = listener
			break
		}
	}
	addresses := make([]string, 0, len(site.ServerNames)+len(listeners))
	addresses = append(addresses, site.ServerNames...)
	for _, listener := range listeners {
		addresses = append(addresses, stringFromMap(listener, "host"), stringFromMap(listener, "address"))
	}
	sites := inventory["sites"].([]map[string]any)
	siteMetadata := map[string]any{
		"siteId":      site.ID,
		"sitePath":    normalizeWindowsRuntimeInventoryPath(site.SitePath),
		"configPath":  normalizeWindowsRuntimeInventoryPath(firstNonEmpty(firstWindowsRuntimePath(site.ConfigFiles), fallbackConfigPath)),
		"configFiles": normalizeWindowsRuntimeInventoryPaths(site.ConfigFiles),
		"listeners":   listeners,
		"source":      "runtime-effective-config",
	}
	if fingerprint := firstNonEmpty(site.ConfigFingerprint, fallbackConfigFingerprint); fingerprint != "" {
		siteMetadata["configFingerprint"] = fingerprint
	}
	if path := normalizeWindowsRuntimeInventoryPath(programPath); path != "" {
		siteMetadata["programPath"] = path
	}
	if strings.TrimSpace(programSha256) != "" {
		siteMetadata["programSha256"] = strings.TrimSpace(programSha256)
	}
	if strings.TrimSpace(serviceName) != "" {
		siteMetadata["serviceName"] = strings.TrimSpace(serviceName)
	}
	if path := normalizeWindowsRuntimeInventoryPath(workingDirectory); path != "" {
		siteMetadata["workingDirectory"] = path
	}
	sites = append(sites, map[string]any{
		"frameworkType": frameworkType,
		"name":          site.Name,
		"serverNames":   uniqueWindowsStrings(site.ServerNames),
		"addresses":     uniqueWindowsStrings(addresses),
		"port":          primaryListener["port"],
		"protocol":      "HTTPS",
		"metadata":      siteMetadata,
	})
	inventory["sites"] = sites
}

func windowsRuntimeConfigCheckArgs(frameworkType string, configPath string, workingDirectory string) []string {
	configPath = normalizeWindowsRuntimeInventoryPath(configPath)
	workingDirectory = normalizeWindowsRuntimeInventoryPath(workingDirectory)
	switch frameworkType {
	case "web.apache":
		if configPath == "" {
			return nil
		}
		args := []string{"-t"}
		if workingDirectory != "" {
			args = append(args, "-d", workingDirectory)
		}
		return append(args, "-f", configPath)
	case "web.nginx":
		if configPath == "" {
			return nil
		}
		args := []string{"-t"}
		if workingDirectory != "" {
			args = append(args, "-p", workingDirectory)
		}
		return append(args, "-c", configPath)
	case "app.tomcat":
		if workingDirectory == "" {
			return nil
		}
		root := strings.TrimRight(workingDirectory, `/\\`)
		return []string{
			"-Dcatalina.base=" + workingDirectory,
			"-Dcatalina.home=" + workingDirectory,
			"-cp",
			root + `/bin/bootstrap.jar`,
			"org.apache.catalina.startup.Bootstrap",
			"configtest",
		}
	default:
		return nil
	}
}

func appendWindowsMatureConfigFile(inventory map[string]any, path string) {
	path = normalizeWindowsRuntimeInventoryPath(path)
	if path == "" {
		return
	}
	files := inventory["configFiles"].([]map[string]any)
	for _, file := range files {
		if strings.EqualFold(stringFromMap(file, "path"), path) {
			return
		}
	}
	files = append(files, map[string]any{"path": path, "source": "runtime-effective-config"})
	inventory["configFiles"] = files
}

func appendWindowsMatureListenerPaths(record map[string]any, listener windowsRuntimeListener) {
	if path := normalizeWindowsRuntimeInventoryPath(listener.CertificatePath); path != "" {
		record["certificatePath"] = path
	}
	if path := normalizeWindowsRuntimeInventoryPath(listener.CertificateKeyPath); path != "" {
		record["certificateKeyPath"] = path
	}
	if path := normalizeWindowsRuntimeInventoryPath(listener.CertificateChainPath); path != "" {
		record["certificateChainPath"] = path
	}
	if path := normalizeWindowsRuntimeInventoryPath(listener.KeystorePath); path != "" {
		record["keystorePath"] = path
	}
	if listener.KeystoreType != "" {
		record["keystoreType"] = listener.KeystoreType
	}
	if listener.KeyAlias != "" {
		record["keyAlias"] = listener.KeyAlias
	}
	if listener.CertificateStoreName != "" {
		record["certificateStoreName"] = listener.CertificateStoreName
	}
	if listener.CertificateStoreLocation != "" {
		record["certificateStoreLocation"] = listener.CertificateStoreLocation
	}
	if listener.CertificateThumbprint != "" {
		record["certificateThumbprint"] = listener.CertificateThumbprint
	}
}

func appendWindowsMatureCertificate(inventory map[string]any, listener windowsRuntimeListener) {
	if listener.Certificate == nil || strings.TrimSpace(listener.Certificate.FingerprintSHA256) == "" {
		return
	}
	path := normalizeWindowsRuntimeInventoryPath(windowsMatureCertificatePath(listener))
	if path == "" {
		return
	}
	certificates := inventory["certificateFiles"].([]map[string]any)
	fingerprint := strings.ToUpper(strings.TrimSpace(listener.Certificate.FingerprintSHA256))
	for _, certificate := range certificates {
		if normalizeWindowsRuntimeInventoryPath(stringFromMap(certificate, "path")) == path && strings.EqualFold(stringFromMap(certificate, "sha256Fingerprint"), fingerprint) {
			return
		}
	}
	certificates = append(certificates, map[string]any{
		"path":              path,
		"configuredPaths":   []string{path},
		"sha256Fingerprint": fingerprint,
		"subject":           listener.Certificate.Subject,
		"issuer":            listener.Certificate.Issuer,
		"notBefore":         listener.Certificate.NotBefore,
		"notAfter":          listener.Certificate.NotAfter,
		"source":            "runtime-effective-config",
		"thumbprint":        listener.CertificateThumbprint,
		"store":             listener.CertificateStoreName,
		"storeLocation":     listener.CertificateStoreLocation,
	})
	inventory["certificateFiles"] = certificates
}

func windowsMatureCertificatePath(listener windowsRuntimeListener) string {
	if path := firstNonEmpty(listener.CertificatePath, listener.KeystorePath); path != "" {
		return path
	}
	thumbprint := strings.TrimSpace(listener.CertificateThumbprint)
	if thumbprint == "" {
		return ""
	}
	store := firstNonEmpty(listener.CertificateStoreName, "My")
	location := firstNonEmpty(listener.CertificateStoreLocation, "LocalMachine")
	return "windows-certstore://" + location + "/" + store + "/" + thumbprint
}

func appendWindowsMatureWarning(inventory map[string]any, warning windowsDiscoveryWarning) {
	warnings := inventory["warnings"].([]map[string]any)
	for _, existing := range warnings {
		if stringFromMap(existing, "code") == warning.Code && stringFromMap(existing, "path") == normalizeWindowsRuntimeInventoryPath(warning.Path) {
			return
		}
	}
	warnings = append(warnings, map[string]any{
		"code":    warning.Code,
		"message": warning.Message,
		"path":    normalizeWindowsRuntimeInventoryPath(warning.Path),
	})
	inventory["warnings"] = warnings
}

func firstWindowsRuntimePath(values []string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func normalizeWindowsRuntimeInventoryPaths(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		normalized := normalizeWindowsRuntimeInventoryPath(value)
		if normalized == "" {
			continue
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		result = append(result, normalized)
	}
	return result
}

func normalizeWindowsRuntimeInventoryPath(value string) string {
	return strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
}

func normalizeWindowsRuntimeInventoryAddress(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || value == "0.0.0.0" || value == "::" {
		return "*"
	}
	return value
}
