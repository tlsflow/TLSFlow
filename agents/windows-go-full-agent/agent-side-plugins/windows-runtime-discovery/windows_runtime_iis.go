package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// windowsIISRuntimeDetail 只承载 ServerManager 返回的实际 IIS 站点和 Binding。
// IIS 的证书绑定必须从 Binding.CertificateHash 解析，不能按监听端口猜测。
type windowsIISRuntimeDetail struct {
	Installed         bool
	Version           string
	ProgramPath       string
	ConfigPath        string
	ConfigFingerprint string
	Sites             []windowsRuntimeSite
	Warnings          []windowsDiscoveryWarning
}

type windowsIISRuntimeWire struct {
	Installed     bool            `json:"installed"`
	VersionString string          `json:"versionString,omitempty"`
	Sites         json.RawMessage `json:"sites,omitempty"`
}

type windowsIISRuntimeSiteWire struct {
	ID           int64           `json:"id"`
	Name         string          `json:"name"`
	PhysicalPath string          `json:"physicalPath,omitempty"`
	Bindings     json.RawMessage `json:"bindings,omitempty"`
}

type windowsIISRuntimeBindingWire struct {
	Protocol              string                        `json:"protocol"`
	BindingInformation    string                        `json:"bindingInformation"`
	IPAddress             string                        `json:"ipAddress,omitempty"`
	Port                  int                           `json:"port,omitempty"`
	HostHeader            string                        `json:"hostHeader,omitempty"`
	CertificateStoreName  string                        `json:"certificateStoreName,omitempty"`
	CertificateThumbprint string                        `json:"certificateThumbprint,omitempty"`
	Certificate           *windowsIISRuntimeCertificate `json:"certificate,omitempty"`
}

type windowsIISRuntimeCertificate struct {
	Thumbprint        string `json:"thumbprint,omitempty"`
	FingerprintSHA256 string `json:"fingerprintSha256,omitempty"`
	StoreName         string `json:"storeName,omitempty"`
	Subject           string `json:"subject,omitempty"`
	Issuer            string `json:"issuer,omitempty"`
	NotBefore         string `json:"notBefore,omitempty"`
	NotAfter          string `json:"notAfter,omitempty"`
}

func inspectWindowsIISRuntime(host windowsRuntimeDiscoveryHost) (windowsIISRuntimeDetail, error) {
	var wire windowsIISRuntimeWire
	if err := host.runPowerShellJSON(windowsIISRuntimeInspectScript, &wire); err != nil {
		return windowsIISRuntimeDetail{}, err
	}

	detail := windowsIISRuntimeDetail{
		Installed:   wire.Installed,
		Version:     strings.TrimSpace(wire.VersionString),
		ProgramPath: windowsSystem32Directory + `\inetsrv\appcmd.exe`,
		ConfigPath:  windowsSystem32Directory + `\inetsrv\config\applicationHost.config`,
		Sites:       []windowsRuntimeSite{},
		Warnings:    []windowsDiscoveryWarning{},
	}
	if !detail.Installed {
		return detail, nil
	}
	if digest, warning := sha256IISFile(detail.ConfigPath); warning != nil {
		detail.Warnings = append(detail.Warnings, *warning)
	} else {
		detail.ConfigFingerprint = digest
	}
	sites, err := parseWindowsIISRuntimeSites(wire.Sites, detail.ConfigPath)
	if err != nil {
		return windowsIISRuntimeDetail{}, err
	}
	detail.Sites = sites
	return detail, nil
}

func sha256IISFile(path string) (string, *windowsDiscoveryWarning) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", &windowsDiscoveryWarning{Code: "IIS_CONFIG_SHA256_UNAVAILABLE", Message: fmt.Sprintf("无法读取 IIS applicationHost.config 并计算 SHA-256: %v", err), Path: path}
	}
	digest := sha256.Sum256(content)
	return hex.EncodeToString(digest[:]), nil
}

func parseWindowsIISRuntimeSites(raw json.RawMessage, configPath string) ([]windowsRuntimeSite, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return []windowsRuntimeSite{}, nil
	}
	var many []windowsIISRuntimeSiteWire
	if err := json.Unmarshal(raw, &many); err != nil {
		var single windowsIISRuntimeSiteWire
		if singleErr := json.Unmarshal(raw, &single); singleErr != nil || strings.TrimSpace(single.Name) == "" {
			return nil, fmt.Errorf("IIS sites JSON 解析失败: %w", err)
		}
		many = []windowsIISRuntimeSiteWire{single}
	}

	sites := make([]windowsRuntimeSite, 0, len(many))
	for _, item := range many {
		site, err := windowsRuntimeSiteFromIIS(item, configPath)
		if err != nil {
			return nil, err
		}
		if strings.TrimSpace(site.Name) != "" {
			sites = append(sites, site)
		}
	}
	return sites, nil
}

func windowsRuntimeSiteFromIIS(item windowsIISRuntimeSiteWire, configPath string) (windowsRuntimeSite, error) {
	bindings, err := parseWindowsIISRuntimeBindings(item.Bindings)
	if err != nil {
		return windowsRuntimeSite{}, fmt.Errorf("IIS site=%s bindings JSON 解析失败: %w", item.Name, err)
	}
	site := windowsRuntimeSite{
		ID:          fmt.Sprintf("iis:%d", item.ID),
		Name:        strings.TrimSpace(item.Name),
		SitePath:    strings.TrimSpace(item.PhysicalPath),
		ConfigFiles: []string{configPath},
		Listen:      []windowsRuntimeListener{},
	}
	for _, binding := range bindings {
		protocol := strings.ToUpper(strings.TrimSpace(binding.Protocol))
		if protocol != "HTTP" && protocol != "HTTPS" || binding.Port <= 0 || binding.Port > 65535 {
			continue
		}
		listener := windowsRuntimeListener{
			Address:            strings.TrimSpace(binding.IPAddress),
			Port:               binding.Port,
			Protocol:           protocol,
			HostHeader:         strings.TrimSpace(binding.HostHeader),
			BindingInformation: strings.TrimSpace(binding.BindingInformation),
		}
		if protocol == "HTTPS" {
			listener.CertificateThumbprint = normalizeWindowsIISCertificateThumbprint(firstNonEmpty(binding.CertificateThumbprint, certificateThumbprintFromIIS(binding.Certificate)))
			listener.CertificateStoreName = firstNonEmpty(strings.TrimSpace(binding.CertificateStoreName), certificateStoreNameFromIIS(binding.Certificate), "My")
			listener.CertificateStoreLocation = "LocalMachine"
			listener.Certificate = certificateSummaryFromIIS(binding.Certificate)
		}
		site.Listen = append(site.Listen, listener)
		if listener.HostHeader != "" {
			site.ServerNames = append(site.ServerNames, listener.HostHeader)
		}
	}
	site.ServerNames = uniqueWindowsStrings(site.ServerNames)
	return site, nil
}

func parseWindowsIISRuntimeBindings(raw json.RawMessage) ([]windowsIISRuntimeBindingWire, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return []windowsIISRuntimeBindingWire{}, nil
	}
	var many []windowsIISRuntimeBindingWire
	if err := json.Unmarshal(raw, &many); err == nil {
		return many, nil
	}
	var single windowsIISRuntimeBindingWire
	if err := json.Unmarshal(raw, &single); err != nil || strings.TrimSpace(single.Protocol) == "" {
		return nil, fmt.Errorf("IIS bindings JSON 不是数组或对象")
	}
	return []windowsIISRuntimeBindingWire{single}, nil
}

func certificateSummaryFromIIS(certificate *windowsIISRuntimeCertificate) *windowsCertificateSummary {
	if certificate == nil {
		return nil
	}
	fingerprint := normalizeWindowsIISFingerprint(certificate.FingerprintSHA256)
	if fingerprint == "" {
		return nil
	}
	return &windowsCertificateSummary{
		FingerprintSHA256: fingerprint,
		Subject:           strings.TrimSpace(certificate.Subject),
		Issuer:            strings.TrimSpace(certificate.Issuer),
		NotBefore:         strings.TrimSpace(certificate.NotBefore),
		NotAfter:          strings.TrimSpace(certificate.NotAfter),
	}
}

func certificateThumbprintFromIIS(certificate *windowsIISRuntimeCertificate) string {
	if certificate == nil {
		return ""
	}
	return certificate.Thumbprint
}

func certificateStoreNameFromIIS(certificate *windowsIISRuntimeCertificate) string {
	if certificate == nil {
		return ""
	}
	return strings.TrimSpace(certificate.StoreName)
}

func normalizeWindowsIISCertificateThumbprint(value string) string {
	compact := strings.Map(func(character rune) rune {
		if character >= '0' && character <= '9' || character >= 'a' && character <= 'f' || character >= 'A' && character <= 'F' {
			return character
		}
		return -1
	}, value)
	if len(compact) < 8 || len(compact)%2 != 0 {
		return ""
	}
	return strings.ToUpper(compact)
}

func normalizeWindowsIISFingerprint(value string) string {
	compact := normalizeWindowsIISCertificateThumbprint(value)
	if len(compact) != 64 {
		return ""
	}
	return compact
}

// 该脚本来自插件化之前的成熟实现。ServerManager 读取的是 IIS 实际生效的
// Binding，而 Convert-CertSummary 只按该 Binding 的 hash 精确查证书库。
const windowsIISRuntimeInspectScript = `
$ErrorActionPreference = 'Stop'
$inetStpPath = 'HKLM:\SOFTWARE\Microsoft\InetStp'
if (-not (Test-Path -LiteralPath $inetStpPath)) {
  [pscustomobject]@{ installed = $false; versionString = $null; sites = @() } | ConvertTo-Json -Depth 8 -Compress
  exit 0
}
$versionString = $null
try {
  $inet = Get-ItemProperty -Path $inetStpPath -ErrorAction Stop
  if ($null -ne $inet.VersionString) { $versionString = [string]$inet.VersionString }
} catch {}

$assemblyPath = Join-Path $env:WinDir 'System32\inetsrv\Microsoft.Web.Administration.dll'
if (Test-Path -LiteralPath $assemblyPath) {
  Add-Type -Path $assemblyPath -ErrorAction Stop
} else {
  Add-Type -AssemblyName 'Microsoft.Web.Administration' -ErrorAction Stop
}

function Convert-CertSummary {
  param(
    [string]$StoreName,
    [object]$CertificateHash
  )
  if ($null -eq $CertificateHash) { return $null }
  $thumbprint = if ($CertificateHash -is [byte[]]) {
    ([System.BitConverter]::ToString($CertificateHash)).Replace('-', '')
  } else {
    ([string]$CertificateHash).Replace(' ', '').Replace(':', '').ToUpperInvariant()
  }
  if ([string]::IsNullOrWhiteSpace($thumbprint)) { return $null }
  $resolvedStoreName = if ([string]::IsNullOrWhiteSpace($StoreName)) { 'My' } else { $StoreName }
  $certificate = $null
  try {
    $certificatePath = Join-Path -Path (Join-Path -Path 'Cert:\LocalMachine' -ChildPath $resolvedStoreName) -ChildPath $thumbprint
    $certificate = Get-Item -LiteralPath $certificatePath -ErrorAction Stop
  } catch {}
  $fingerprintSha256 = $null
  if ($null -ne $certificate) {
    try {
      $sha256 = [System.Security.Cryptography.SHA256]::Create()
      try {
        $fingerprintSha256 = ([System.BitConverter]::ToString($sha256.ComputeHash($certificate.RawData))).Replace('-', '').ToLowerInvariant()
      } finally {
        $sha256.Dispose()
      }
    } catch {}
  }
  [pscustomobject]@{
    thumbprint = $thumbprint
    fingerprintSha256 = $fingerprintSha256
    storeName = $resolvedStoreName
    subject = if ($null -ne $certificate) { [string]$certificate.Subject } else { $null }
    issuer = if ($null -ne $certificate) { [string]$certificate.Issuer } else { $null }
    notBefore = if ($null -ne $certificate) { $certificate.NotBefore.ToString('o') } else { $null }
    notAfter = if ($null -ne $certificate) { $certificate.NotAfter.ToString('o') } else { $null }
  }
}

$serverManager = New-Object Microsoft.Web.Administration.ServerManager
try {
  $sites = foreach ($site in $serverManager.Sites) {
    $bindings = foreach ($binding in $site.Bindings) {
      $bindingInformation = [string]$binding.BindingInformation
      $parts = $bindingInformation.Split(':', 3)
      $ipAddress = if ($parts.Length -ge 1) { [string]$parts[0] } else { $null }
      $port = if ($parts.Length -ge 2 -and $parts[1] -match '^\d+$') { [int]$parts[1] } else { $null }
      $hostHeader = if ($parts.Length -ge 3) { [string]$parts[2] } else { $null }
      $cert = if ([string]$binding.Protocol -eq 'https') { Convert-CertSummary -StoreName ([string]$binding.CertificateStoreName) -CertificateHash $binding.CertificateHash } else { $null }
      [pscustomobject]@{
        protocol = [string]$binding.Protocol
        bindingInformation = $bindingInformation
        ipAddress = $ipAddress
        port = $port
        hostHeader = $hostHeader
        certificateStoreName = if ($null -ne $cert) { [string]$cert.storeName } else { [string]$binding.CertificateStoreName }
        certificateThumbprint = if ($null -ne $cert) { [string]$cert.thumbprint } else { $null }
        certificate = $cert
      }
    }
    $physicalPath = $null
    try {
      $rootApp = $site.Applications['/']
      if ($null -ne $rootApp) {
        $rootVdir = $rootApp.VirtualDirectories['/']
        if ($null -ne $rootVdir) { $physicalPath = [string]$rootVdir.PhysicalPath }
      }
    } catch {}
    [pscustomobject]@{
      id = [int64]$site.Id
      name = [string]$site.Name
      physicalPath = $physicalPath
      bindings = @($bindings)
    }
  }
  [pscustomobject]@{
    installed = $true
    versionString = $versionString
    sites = @($sites)
  } | ConvertTo-Json -Depth 10 -Compress
} finally {
  if ($null -ne $serverManager) { $serverManager.Dispose() }
}
`
