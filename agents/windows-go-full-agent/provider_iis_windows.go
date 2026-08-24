package main

import (
	"crypto/sha1"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/crypto/pkcs12"
)

type windowsIISDeploymentInput struct {
	SiteName                  string          `json:"siteName"`
	BindingSelector           bindingSelector `json:"bindingSelector"`
	PFXPath                   string          `json:"pfxPath"`
	PFXBase64                 string          `json:"pfxBase64"`
	PFXPassword               string          `json:"pfxPassword"`
	ExpectedThumbprint        string          `json:"expectedThumbprint"`
	ExpectedCertificateSHA256 string          `json:"expectedCertificateFingerprintSha256"`
	ExpectedDomains           []string        `json:"expectedDomains"`
}

type bindingSelector struct {
	IP                 string `json:"ip"`
	Port               int    `json:"port"`
	HostHeader         string `json:"hostHeader"`
	BindingInformation string `json:"bindingInformation"`
}

type windowsPowerShellResult struct {
	Success bool           `json:"success"`
	Error   string         `json:"error,omitempty"`
	Detail  map[string]any `json:"detail,omitempty"`
}

type windowsImportPFXResult struct {
	Thumbprint string `json:"thumbprint"`
	Subject    string `json:"subject,omitempty"`
	NotAfter   string `json:"notAfter,omitempty"`
}

type windowsInspectPFXResult struct {
	Thumbprint           string            `json:"thumbprint"`
	Subject              string            `json:"subject,omitempty"`
	NotAfter             string            `json:"notAfter,omitempty"`
	DNSNames             []string          `json:"dnsNames,omitempty"`
	CommonName           string            `json:"commonName,omitempty"`
	PFXSHA256            string            `json:"pfxSha256,omitempty"`
	PFXSize              int               `json:"pfxSize,omitempty"`
	RawCertificateBase64 string            `json:"rawCertificateBase64,omitempty"`
	Certificate          *x509.Certificate `json:"-"`
}

func findTargetBinding(host windowsExecutionHost, input windowsIISDeploymentInput) (windowsIISSite, windowsIISBinding, error) {
	detail, err := host.inspectIIS()
	if err != nil {
		return windowsIISSite{}, windowsIISBinding{}, err
	}
	for _, site := range detail.Sites {
		if !strings.EqualFold(strings.TrimSpace(site.Name), input.SiteName) {
			continue
		}
		for _, binding := range site.Bindings {
			if !strings.EqualFold(binding.Protocol, "https") {
				continue
			}
			if bindingMatchesSelector(binding, input.BindingSelector) {
				return site, binding, nil
			}
		}
		return windowsIISSite{}, windowsIISBinding{}, fmt.Errorf("站点 %s 未找到匹配的 HTTPS Binding", input.SiteName)
	}
	return windowsIISSite{}, windowsIISBinding{}, fmt.Errorf("未找到 IIS 站点 %s", input.SiteName)
}

func bindingMatchesSelector(binding windowsIISBinding, selector bindingSelector) bool {
	if strings.TrimSpace(selector.BindingInformation) != "" {
		return strings.EqualFold(strings.TrimSpace(binding.BindingInformation), strings.TrimSpace(selector.BindingInformation))
	}
	if selector.Port > 0 && binding.Port != selector.Port {
		return false
	}
	if selector.HostHeader != "" && !strings.EqualFold(strings.TrimSpace(binding.HostHeader), strings.TrimSpace(selector.HostHeader)) {
		return false
	}
	selectorIP := normalizeBindingIP(selector.IP)
	bindingIP := normalizeBindingIP(binding.IPAddress)
	if selectorIP != "" && selectorIP != "*" && bindingIP != selectorIP {
		return false
	}
	return true
}

func (h windowsExecutionHost) importPFX(input windowsIISDeploymentInput) (*windowsImportPFXResult, error) {
	pfxPath := input.PFXPath
	tempPath := ""
	if pfxPath == "" {
		decoded, err := base64.StdEncoding.DecodeString(input.PFXBase64)
		if err != nil {
			return nil, fmt.Errorf("解码 pfxBase64 失败: %w", err)
		}
		tempDir := filepath.Join(os.TempDir(), "gcac-agent")
		if err := os.MkdirAll(tempDir, 0o700); err != nil {
			return nil, fmt.Errorf("创建 PFX 临时目录失败: %w", err)
		}
		tempPath = filepath.Join(tempDir, fmt.Sprintf("task-%d.pfx", time.Now().UnixNano()))
		if err := os.WriteFile(tempPath, decoded, 0o600); err != nil {
			return nil, fmt.Errorf("写入临时 PFX 文件失败: %w", err)
		}
		defer os.Remove(tempPath)
		pfxPath = tempPath
	}

	script := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
$secure = ConvertTo-SecureString %s -AsPlainText -Force
$certificate = Import-PfxCertificate -FilePath %s -Password $secure -CertStoreLocation 'Cert:\LocalMachine\My' -Exportable
if ($null -eq $certificate) { throw 'Import-PfxCertificate returned null' }
[pscustomobject]@{
  thumbprint = [string]$certificate.Thumbprint
  subject = [string]$certificate.Subject
  notAfter = $certificate.NotAfter.ToString('o')
} | ConvertTo-Json -Depth 4 -Compress
`, psSingleQuoted(input.PFXPassword), psSingleQuoted(pfxPath))

	var result windowsImportPFXResult
	if err := h.runPowerShellJSON(script, &result); err != nil {
		return nil, err
	}
	result.Thumbprint = normalizeThumbprint(result.Thumbprint)
	if result.Thumbprint == "" {
		return nil, errors.New("PFX 导入后未返回 thumbprint")
	}
	if input.ExpectedThumbprint != "" && !strings.EqualFold(input.ExpectedThumbprint, result.Thumbprint) {
		return nil, fmt.Errorf("导入证书 thumbprint 不匹配 expected=%s actual=%s", input.ExpectedThumbprint, result.Thumbprint)
	}
	return &result, nil
}

func (h windowsExecutionHost) inspectPFX(input windowsIISDeploymentInput) (*windowsInspectPFXResult, error) {
	pfxPath := input.PFXPath
	tempPath := ""
	var localBytes []byte
	if pfxPath == "" {
		decoded, err := base64.StdEncoding.DecodeString(input.PFXBase64)
		if err != nil {
			return nil, fmt.Errorf("解码 pfxBase64 失败: %w", err)
		}
		localBytes = decoded
		tempDir := filepath.Join(os.TempDir(), "gcac-agent")
		if err := os.MkdirAll(tempDir, 0o700); err != nil {
			return nil, fmt.Errorf("创建 PFX 临时目录失败: %w", err)
		}
		tempPath = filepath.Join(tempDir, fmt.Sprintf("inspect-%d.pfx", time.Now().UnixNano()))
		if err := os.WriteFile(tempPath, decoded, 0o600); err != nil {
			return nil, fmt.Errorf("写入临时 PFX 文件失败: %w", err)
		}
		defer os.Remove(tempPath)
		pfxPath = tempPath
	}
	if len(localBytes) == 0 && strings.TrimSpace(pfxPath) != "" {
		loaded, readErr := os.ReadFile(pfxPath)
		if readErr != nil {
			return nil, fmt.Errorf("读取 PFX 文件失败: %w", readErr)
		}
		localBytes = loaded
	}
	pfxDigest := sha256.Sum256(localBytes)
	pfxSHA256 := hex.EncodeToString(pfxDigest[:])
	pfxSize := len(localBytes)
	script := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
$flags = [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::Exportable -bor [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new(%s, %s, $flags)
if ($null -eq $certificate) { throw 'X509Certificate2 returned null' }
[pscustomobject]@{
  thumbprint = [string]$certificate.Thumbprint
  subject = [string]$certificate.Subject
  notAfter = $certificate.NotAfter.ToString('o')
  commonName = [string]$certificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  rawCertificateBase64 = [Convert]::ToBase64String($certificate.RawData)
} | ConvertTo-Json -Depth 6 -Compress
`, psSingleQuoted(pfxPath), psSingleQuoted(input.PFXPassword))

	var result windowsInspectPFXResult
	if err := h.runPowerShellJSON(script, &result); err != nil {
		if len(localBytes) > 0 {
			if localInspect, localErr := inspectPFXLocally(localBytes, input.PFXPassword); localErr == nil {
				return localInspect, fmt.Errorf("Windows 无法检查 PFX，Go 本地检查成功，请检查 Windows PKCS#12 兼容性: %w", err)
			}
		}
		return nil, fmt.Errorf("Windows 与 Go 均无法检查 PFX，请确认 PFX 格式和密码: %w", err)
	}
	result.Thumbprint = normalizeThumbprint(result.Thumbprint)
	if result.Thumbprint == "" {
		return nil, errors.New("PFX 检查未返回 thumbprint")
	}
	if strings.TrimSpace(result.RawCertificateBase64) == "" {
		return nil, errors.New("PFX 检查未返回证书内容")
	}
	rawCertificate, err := base64.StdEncoding.DecodeString(result.RawCertificateBase64)
	if err != nil {
		return nil, fmt.Errorf("解码 PFX 证书内容失败: %w", err)
	}
	certificate, err := x509.ParseCertificate(rawCertificate)
	if err != nil {
		return nil, fmt.Errorf("解析 PFX 证书内容失败: %w", err)
	}
	result.Certificate = certificate
	result.Subject = certificate.Subject.String()
	result.NotAfter = certificate.NotAfter.Format(time.RFC3339)
	result.DNSNames = append([]string(nil), certificate.DNSNames...)
	result.CommonName = certificate.Subject.CommonName
	result.PFXSHA256 = pfxSHA256
	result.PFXSize = pfxSize
	result.RawCertificateBase64 = ""
	return &result, nil
}

func (h windowsExecutionHost) grantPrivateKeyACL(thumbprint string, appPoolName string) error {
	script := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
$thumbprint = %s
$account = %s
$certificate = Get-Item -LiteralPath ("Cert:\LocalMachine\My\" + $thumbprint)
if ($null -eq $certificate) { throw 'certificate not found' }
$privateKey = $certificate.PrivateKey
if ($null -eq $privateKey) { throw 'certificate private key missing' }
$containerName = $privateKey.CspKeyContainerInfo.UniqueKeyContainerName
if ([string]::IsNullOrWhiteSpace($containerName)) { throw 'key container name missing' }
$machineKeyPath = Join-Path $env:ProgramData ("Microsoft\Crypto\RSA\MachineKeys\" + $containerName)
if (-not (Test-Path -LiteralPath $machineKeyPath)) { throw ('machine key file not found: ' + $machineKeyPath) }
$acl = Get-Acl -LiteralPath $machineKeyPath
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($account, 'Read', 'Allow')
$acl.SetAccessRule($rule)
Set-Acl -LiteralPath $machineKeyPath -AclObject $acl
[pscustomobject]@{ success = $true } | ConvertTo-Json -Compress
`, psSingleQuoted(thumbprint), psSingleQuoted("IIS AppPool\\"+appPoolName))
	var result windowsPowerShellResult
	if err := h.runPowerShellJSON(script, &result); err != nil {
		return err
	}
	if !result.Success {
		return errors.New("私钥 ACL 设置失败")
	}
	return nil
}

func (h windowsExecutionHost) updateBindingCertificate(siteName string, binding windowsIISBinding, thumbprint string) error {
	return h.applyBindingCertificate(siteName, binding, thumbprint)
}

func (h windowsExecutionHost) restoreBindingCertificate(siteName string, binding windowsIISBinding) error {
	return h.applyBindingCertificate(siteName, binding, normalizeThumbprint(binding.CertificateThumbprint))
}

func (h windowsExecutionHost) applyBindingCertificate(siteName string, binding windowsIISBinding, thumbprint string) error {
	if thumbprint == "" {
		return errors.New("binding 证书 thumbprint 不能为空")
	}
	script := fmt.Sprintf(`
$ErrorActionPreference = 'Stop'
Import-Module WebAdministration -ErrorAction Stop | Out-Null
$siteName = %s
$protocol = %s
$bindingInformation = %s
$thumbprint = %s
$binding = Get-WebBinding -Name $siteName -Protocol $protocol | Where-Object { $_.bindingInformation -eq $bindingInformation } | Select-Object -First 1
if ($null -eq $binding) { throw 'binding not found' }
$binding.AddSslCertificate($thumbprint, 'My')
[pscustomobject]@{ success = $true } | ConvertTo-Json -Compress
`, psSingleQuoted(siteName), psSingleQuoted(binding.Protocol), psSingleQuoted(binding.BindingInformation), psSingleQuoted(thumbprint))

	var result windowsPowerShellResult
	if err := h.runPowerShellJSON(script, &result); err != nil {
		return err
	}
	if !result.Success {
		return errors.New("更新 IIS Binding 失败")
	}
	return nil
}

func verifyExpectedDomainsAgainstCertificate(certificate *x509.Certificate, expectedDomains []string) error {
	if certificate == nil {
		return errors.New("证书不能为空")
	}
	for _, domain := range expectedDomains {
		trimmed := strings.TrimSpace(domain)
		if trimmed == "" {
			continue
		}
		if err := certificate.VerifyHostname(trimmed); err != nil {
			return fmt.Errorf("证书不匹配预期域名 %s", trimmed)
		}
	}
	return nil
}

func certificateThumbprintSHA1(certificate *x509.Certificate) string {
	sum := sha1.Sum(certificate.Raw)
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

func certificateFingerprintSHA256(certificate *x509.Certificate) string {
	sum := sha256.Sum256(certificate.Raw)
	return strings.ToLower(hex.EncodeToString(sum[:]))
}

func inspectPFXLocally(pfxBytes []byte, password string) (*windowsInspectPFXResult, error) {
	blocks, err := pkcs12.ToPEM(pfxBytes, password)
	if err != nil {
		return nil, err
	}
	for _, block := range blocks {
		if block == nil || block.Type != "CERTIFICATE" {
			continue
		}
		certificate, parseErr := x509.ParseCertificate(block.Bytes)
		if parseErr != nil {
			return nil, parseErr
		}
		return &windowsInspectPFXResult{
			Thumbprint:  normalizeThumbprint(certificateThumbprintSHA1(certificate)),
			Subject:     certificate.Subject.String(),
			NotAfter:    certificate.NotAfter.Format(time.RFC3339),
			DNSNames:    append([]string(nil), certificate.DNSNames...),
			CommonName:  certificate.Subject.CommonName,
			Certificate: certificate,
		}, nil
	}
	return nil, errors.New("Go 无法从 PFX 中解析证书")
}

func normalizeThumbprint(value string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(value), " ", ""), ":", ""))
}

func normalizeSHA256(value string) string {
	return strings.ToLower(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(value), " ", ""), ":", ""))
}

func normalizeBindingIP(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "*"
	}
	if trimmed == "0.0.0.0" {
		return "*"
	}
	return trimmed
}

func stringFromAny(value any) string {
	text, _ := value.(string)
	return text
}

func psSingleQuoted(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
