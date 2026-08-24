package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

type windowsExecutionHost struct {
	timeout time.Duration
}

type windowsAdapterSnapshot struct {
	PowerShell struct {
		Available bool   `json:"available"`
		Path      string `json:"path,omitempty"`
	} `json:"powerShell"`
	OS *windowsOSDetail `json:"os,omitempty"`
	CertStore struct {
		LocalMachineMy []windowsCertificateStoreItem `json:"localMachineMy,omitempty"`
	} `json:"certStore"`
	IIS *windowsIISDetail `json:"iis,omitempty"`
}

type windowsOSDetail struct {
	ProductName    string `json:"productName,omitempty"`
	DisplayVersion string `json:"displayVersion,omitempty"`
	ReleaseID      string `json:"releaseId,omitempty"`
	CurrentBuild   string `json:"currentBuild,omitempty"`
	BuildRevision  string `json:"buildRevision,omitempty"`
	Version        string `json:"version,omitempty"`
}

type windowsCertificateStoreItem struct {
	StoreLocation string `json:"storeLocation"`
	StoreName     string `json:"storeName"`
	Thumbprint    string `json:"thumbprint"`
	Subject       string `json:"subject"`
	Issuer        string `json:"issuer,omitempty"`
	NotBefore     string `json:"notBefore,omitempty"`
	NotAfter      string `json:"notAfter,omitempty"`
	HasPrivateKey bool   `json:"hasPrivateKey"`
}

type windowsIISDetail struct {
	Installed     bool             `json:"installed"`
	VersionString string           `json:"versionString,omitempty"`
	Sites         []windowsIISSite `json:"sites,omitempty"`
}

type windowsIISSite struct {
	ID              int64               `json:"id"`
	Name            string              `json:"name"`
	AppPool         string              `json:"appPool,omitempty"`
	State           string              `json:"state,omitempty"`
	ServerAutoStart bool                `json:"serverAutoStart"`
	PhysicalPath    string              `json:"physicalPath,omitempty"`
	Bindings        []windowsIISBinding `json:"bindings,omitempty"`
}

type windowsIISBinding struct {
	Protocol              string                    `json:"protocol"`
	BindingInformation    string                    `json:"bindingInformation"`
	IPAddress             string                    `json:"ipAddress,omitempty"`
	Port                  int                       `json:"port,omitempty"`
	HostHeader            string                    `json:"hostHeader,omitempty"`
	CertificateStoreName  string                    `json:"certificateStoreName,omitempty"`
	CertificateThumbprint string                    `json:"certificateThumbprint,omitempty"`
	SslFlags              int                       `json:"sslFlags,omitempty"`
	Certificate           *windowsCertificateDetail `json:"certificate,omitempty"`
}

type windowsCertificateDetail struct {
	Thumbprint string `json:"thumbprint"`
	StoreName  string `json:"storeName"`
	Subject    string `json:"subject,omitempty"`
	Issuer     string `json:"issuer,omitempty"`
	NotBefore  string `json:"notBefore,omitempty"`
	NotAfter   string `json:"notAfter,omitempty"`
}

type windowsIISDetailWire struct {
	Installed     bool            `json:"installed"`
	VersionString string          `json:"versionString,omitempty"`
	Sites         json.RawMessage `json:"sites,omitempty"`
}

type windowsIISSiteWire struct {
	ID              int64           `json:"id"`
	Name            string          `json:"name"`
	AppPool         string          `json:"appPool,omitempty"`
	State           string          `json:"state,omitempty"`
	ServerAutoStart bool            `json:"serverAutoStart"`
	PhysicalPath    string          `json:"physicalPath,omitempty"`
	Bindings        json.RawMessage `json:"bindings,omitempty"`
}

func collectWindowsAdapterSnapshot(logger *runtimeLogger) windowsAdapterSnapshot {
	snapshot := windowsAdapterSnapshot{}
	host := windowsExecutionHost{timeout: 20 * time.Second}

	if path, err := exec.LookPath("powershell.exe"); err == nil {
		snapshot.PowerShell.Available = true
		snapshot.PowerShell.Path = path
	} else {
		logger.Warn("powershell.exe not found: %v", err)
		return snapshot
	}

	if osDetail, err := host.inspectOS(); err != nil {
		logger.Warn("inspect windows os failed: %v", err)
	} else {
		snapshot.OS = osDetail
	}

	if certs, err := host.inspectLocalMachineMy(); err != nil {
		logger.Warn("inspect cert store failed: %v", err)
	} else {
		snapshot.CertStore.LocalMachineMy = certs
	}

	if iis, err := host.inspectIIS(); err != nil {
		logger.Warn("inspect IIS failed: %v", err)
	} else {
		snapshot.IIS = iis
	}

	return snapshot
}

func debugInspectWindowsIIS() map[string]any {
	host := windowsExecutionHost{timeout: 20 * time.Second}
	raw, err := host.runPowerShell(windowsIISInspectScript)
	if err != nil {
		return map[string]any{
			"success": false,
			"stage":   "powershell",
			"error":   err.Error(),
		}
	}

	detail, err := parseWindowsIISDetailJSON(raw)
	if err != nil {
		return map[string]any{
			"success": false,
			"stage":   "parse",
			"error":   err.Error(),
			"raw":     raw,
		}
	}

	return map[string]any{
		"success": true,
		"raw":     raw,
		"parsed":  detail,
	}
}

func (h windowsExecutionHost) inspectOS() (*windowsOSDetail, error) {
	const script = `
$ErrorActionPreference = 'Stop'
$currentVersion = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
$os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
[pscustomobject]@{
  productName = [string]$currentVersion.ProductName
  displayVersion = [string]$currentVersion.DisplayVersion
  releaseId = [string]$currentVersion.ReleaseId
  currentBuild = [string]$currentVersion.CurrentBuild
  buildRevision = if ($null -ne $currentVersion.UBR) { ("{0}.{1}" -f [string]$currentVersion.CurrentBuild, [string]$currentVersion.UBR) } else { [string]$currentVersion.CurrentBuild }
  version = [string]$os.Version
} | ConvertTo-Json -Depth 4 -Compress
`

	var detail windowsOSDetail
	if err := h.runPowerShellJSON(script, &detail); err != nil {
		return nil, err
	}
	return &detail, nil
}

func (h windowsExecutionHost) inspectLocalMachineMy() ([]windowsCertificateStoreItem, error) {
	const script = `
$ErrorActionPreference = 'Stop'
$items = Get-ChildItem -Path Cert:\LocalMachine\My | Sort-Object Thumbprint | ForEach-Object {
  [pscustomobject]@{
    storeLocation = 'LocalMachine'
    storeName = 'My'
    thumbprint = $_.Thumbprint
    subject = $_.Subject
    issuer = $_.Issuer
    notBefore = $_.NotBefore.ToString('o')
    notAfter = $_.NotAfter.ToString('o')
    hasPrivateKey = [bool]$_.HasPrivateKey
  }
}
$items | ConvertTo-Json -Depth 4 -Compress
`

	var items []windowsCertificateStoreItem
	if err := h.runPowerShellJSON(script, &items); err == nil {
		return items, nil
	}

	var single windowsCertificateStoreItem
	if err := h.runPowerShellJSON(script, &single); err == nil && strings.TrimSpace(single.Thumbprint) != "" {
		return []windowsCertificateStoreItem{single}, nil
	}
	return nil, fmt.Errorf("无法读取 LocalMachine\\My")
}

func (h windowsExecutionHost) inspectIIS() (*windowsIISDetail, error) {
	output, err := h.runPowerShell(windowsIISInspectScript)
	if err != nil {
		return nil, err
	}
	return parseWindowsIISDetailJSON(output)
}

const windowsIISInspectScript = `
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
  $certificatePath = "Cert:\LocalMachine\$resolvedStoreName\$thumbprint"
  $certificate = $null
  if (Test-Path -LiteralPath $certificatePath) {
    try { $certificate = Get-Item -LiteralPath $certificatePath -ErrorAction Stop } catch {}
  }
  [pscustomobject]@{
    thumbprint = $thumbprint
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
      $sslFlags = 0
      try {
        $sslFlags = [int]$binding.GetAttributeValue('sslFlags')
      } catch {}
      [pscustomobject]@{
        protocol = [string]$binding.Protocol
        bindingInformation = $bindingInformation
        ipAddress = $ipAddress
        port = $port
        hostHeader = $hostHeader
        certificateStoreName = if ($null -ne $cert) { [string]$cert.storeName } else { [string]$binding.CertificateStoreName }
        certificateThumbprint = if ($null -ne $cert) { [string]$cert.thumbprint } else { $null }
        sslFlags = $sslFlags
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
    $appPool = $null
    try {
      $rootApplication = $site.Applications['/']
      if ($null -ne $rootApplication) {
        $appPool = [string]$rootApplication.ApplicationPoolName
      }
    } catch {}
    [pscustomobject]@{
      id = [int64]$site.Id
      name = [string]$site.Name
      appPool = $appPool
      state = [string]$site.State
      serverAutoStart = [bool]$site.ServerAutoStart
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

func (h windowsExecutionHost) runPowerShellJSON(script string, target any) error {
	trimmed, err := h.runPowerShell(script)
	if err != nil {
		return err
	}
	if err := json.Unmarshal([]byte(trimmed), target); err != nil {
		return fmt.Errorf("powershell JSON 解析失败: %w: %s", err, trimmed)
	}
	return nil
}

func (h windowsExecutionHost) runPowerShell(script string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), h.timeout)
	defer cancel()

	command := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	output, err := command.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("powershell 执行失败: %w: %s", err, strings.TrimSpace(string(output)))
	}
	trimmed := strings.TrimSpace(string(output))
	if trimmed == "" {
		return "", fmt.Errorf("powershell 未返回 JSON")
	}
	return trimmed, nil
}

func parseWindowsIISDetailJSON(raw string) (*windowsIISDetail, error) {
	var wire windowsIISDetailWire
	if err := json.Unmarshal([]byte(raw), &wire); err != nil {
		return nil, fmt.Errorf("powershell IIS detail 解析失败: %w: %s", err, raw)
	}

	sites, err := parseWindowsIISSitesJSON(wire.Sites)
	if err != nil {
		return nil, fmt.Errorf("powershell IIS sites 解析失败: %w", err)
	}

	return &windowsIISDetail{
		Installed:     wire.Installed,
		VersionString: wire.VersionString,
		Sites:         sites,
	}, nil
}

func parseWindowsIISSitesJSON(raw json.RawMessage) ([]windowsIISSite, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}

	var many []windowsIISSiteWire
	if err := json.Unmarshal(raw, &many); err == nil {
		return normalizeWindowsIISSites(many)
	}

	var single windowsIISSiteWire
	if err := json.Unmarshal(raw, &single); err == nil && strings.TrimSpace(single.Name) != "" {
		return normalizeWindowsIISSites([]windowsIISSiteWire{single})
	}

	return nil, fmt.Errorf("无法将 sites 解析为数组或单对象: %s", string(raw))
}

func normalizeWindowsIISSites(items []windowsIISSiteWire) ([]windowsIISSite, error) {
	sites := make([]windowsIISSite, 0, len(items))
	for _, item := range items {
		bindings, err := parseWindowsIISBindingsJSON(item.Bindings)
		if err != nil {
			return nil, fmt.Errorf("site=%s bindings 解析失败: %w", item.Name, err)
		}
		sites = append(sites, windowsIISSite{
			ID:              item.ID,
			Name:            item.Name,
			AppPool:         item.AppPool,
			State:           item.State,
			ServerAutoStart: item.ServerAutoStart,
			PhysicalPath:    item.PhysicalPath,
			Bindings:        bindings,
		})
	}
	return sites, nil
}

func parseWindowsIISBindingsJSON(raw json.RawMessage) ([]windowsIISBinding, error) {
	if len(raw) == 0 || string(raw) == "null" {
		return nil, nil
	}

	var many []windowsIISBinding
	if err := json.Unmarshal(raw, &many); err == nil {
		return many, nil
	}

	var single windowsIISBinding
	if err := json.Unmarshal(raw, &single); err == nil && strings.TrimSpace(single.Protocol) != "" {
		return []windowsIISBinding{single}, nil
	}

	return nil, fmt.Errorf("无法将 bindings 解析为数组或单对象: %s", string(raw))
}
