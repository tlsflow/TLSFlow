package main

import (
	"context"
	"crypto/sha1"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type windowsIISDeploymentInput struct {
	SiteName           string          `json:"siteName"`
	BindingSelector    bindingSelector `json:"bindingSelector"`
	PFXPath            string          `json:"pfxPath"`
	PFXBase64          string          `json:"pfxBase64"`
	PFXPassword        string          `json:"pfxPassword"`
	ExpectedThumbprint string          `json:"expectedThumbprint"`
	ExpectedDomains    []string        `json:"expectedDomains"`
	AppPoolName        string          `json:"appPoolName"`
	VerifyURL          string          `json:"verifyUrl"`
}

type bindingSelector struct {
	IP         string `json:"ip"`
	Port       int    `json:"port"`
	HostHeader string `json:"hostHeader"`
}

type windowsIISDeploymentCheckpoint struct {
	TaskID          string            `json:"taskId"`
	SiteName        string            `json:"siteName"`
	BindingSelector bindingSelector   `json:"bindingSelector"`
	BindingSnapshot windowsIISBinding `json:"bindingSnapshot"`
	OldThumbprint   string            `json:"oldThumbprint,omitempty"`
	NewThumbprint   string            `json:"newThumbprint,omitempty"`
	ACLApplied      bool              `json:"aclApplied"`
	VerifyReport    map[string]any    `json:"verifyReport,omitempty"`
	RolledBack      bool              `json:"rolledBack"`
	ManualIntervene bool              `json:"manualInterventionRequired"`
	UpdatedAt       string            `json:"updatedAt"`
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

type windowsBindingUpdateResult struct {
	AppliedBinding windowsIISBinding `json:"appliedBinding"`
}

func isWindowsIISDeploymentTask(task agentTaskEnvelope) bool {
	payload := task.Payload
	if payload == nil {
		return false
	}
	taskType, _ := payload["type"].(string)
	if strings.EqualFold(strings.TrimSpace(taskType), "windows.iis.deploy_certificate") {
		return true
	}
	providerType, _ := payload["providerType"].(string)
	if strings.EqualFold(strings.TrimSpace(providerType), "IIS") {
		return true
	}
	stepAction, _ := payload["action"].(string)
	return strings.EqualFold(strings.TrimSpace(stepAction), "INSTALL_CERTIFICATE")
}

func runWindowsIISDeployment(execution *taskExecutionContext) (bool, string, string, map[string]any) {
	input, err := parseWindowsIISDeploymentInput(execution.task.Payload)
	if err != nil {
		return false, "TASK_PAYLOAD_INVALID", err.Error(), map[string]any{
			"executor": "windows-iis-provider",
			"taskId":   execution.task.ID,
		}
	}

	host := windowsExecutionHost{timeout: 90 * time.Second}
	site, binding, err := findTargetBinding(host, input)
	if err != nil {
		return false, "IIS_BINDING_NOT_FOUND", err.Error(), map[string]any{
			"executor": "windows-iis-provider",
			"taskId":   execution.task.ID,
			"siteName": input.SiteName,
		}
	}

	checkpoint := windowsIISDeploymentCheckpoint{
		TaskID:          execution.task.ID,
		SiteName:        site.Name,
		BindingSelector: input.BindingSelector,
		BindingSnapshot: binding,
		OldThumbprint:   normalizeThumbprint(binding.CertificateThumbprint),
		UpdatedAt:       time.Now().Format(time.RFC3339),
	}
	if err := stageDeploymentCheckpoint(execution, checkpoint, "iis.checkpoint_created"); err != nil {
		return false, "RECOVERY_LEDGER_WRITE_FAILED", err.Error(), baseExecutionDetail(execution, input, checkpoint)
	}
	execution.submitLog("info", "已建立 IIS Binding 快照 site=%s binding=%s", site.Name, binding.BindingInformation)

	importResult, err := host.importPFX(input)
	if err != nil {
		return false, "PFX_IMPORT_FAILED", err.Error(), baseExecutionDetail(execution, input, checkpoint)
	}
	checkpoint.NewThumbprint = importResult.Thumbprint
	checkpoint.UpdatedAt = time.Now().Format(time.RFC3339)
	if err := stageDeploymentCheckpoint(execution, checkpoint, "iis.pfx_imported"); err != nil {
		return false, "RECOVERY_LEDGER_WRITE_FAILED", err.Error(), baseExecutionDetail(execution, input, checkpoint)
	}
	execution.submitLog("info", "PFX 已导入 LocalMachine\\My thumbprint=%s", checkpoint.NewThumbprint)

	appPoolName := strings.TrimSpace(input.AppPoolName)
	if appPoolName == "" {
		appPoolName = resolveAppPoolName(input, site)
	}
	if strings.TrimSpace(appPoolName) == "" {
		return false, "PRIVATE_KEY_ACL_FAILED", "无法确定 IIS 应用池名称，不能继续设置私钥 ACL", baseExecutionDetail(execution, input, checkpoint)
	}
	if err := host.grantPrivateKeyACL(checkpoint.NewThumbprint, appPoolName); err != nil {
		return false, "PRIVATE_KEY_ACL_FAILED", err.Error(), baseExecutionDetail(execution, input, checkpoint)
	}
	checkpoint.ACLApplied = true
	checkpoint.UpdatedAt = time.Now().Format(time.RFC3339)
	if err := stageDeploymentCheckpoint(execution, checkpoint, "iis.private_key_acl_applied"); err != nil {
		return false, "RECOVERY_LEDGER_WRITE_FAILED", err.Error(), baseExecutionDetail(execution, input, checkpoint)
	}
	execution.submitLog("info", "私钥 ACL 已授予应用池 identity=%s", "IIS AppPool\\"+appPoolName)

	if err := host.updateBindingCertificate(site.Name, binding, checkpoint.NewThumbprint); err != nil {
		return false, "IIS_BINDING_UPDATE_FAILED", err.Error(), baseExecutionDetail(execution, input, checkpoint)
	}
	checkpoint.UpdatedAt = time.Now().Format(time.RFC3339)
	if err := stageDeploymentCheckpoint(execution, checkpoint, "iis.binding_updated"); err != nil {
		return false, "RECOVERY_LEDGER_WRITE_FAILED", err.Error(), baseExecutionDetail(execution, input, checkpoint)
	}
	execution.submitLog("info", "IIS HTTPS Binding 已切到新证书")

	verifyReport, verifyErr := verifyTLSBinding(context.Background(), input, checkpoint.NewThumbprint)
	checkpoint.VerifyReport = verifyReport
	checkpoint.UpdatedAt = time.Now().Format(time.RFC3339)
	if verifyErr == nil {
		if err := stageDeploymentCheckpoint(execution, checkpoint, "iis.verify_succeeded"); err != nil {
			return false, "RECOVERY_LEDGER_WRITE_FAILED", err.Error(), baseExecutionDetail(execution, input, checkpoint)
		}
		execution.submitLog("info", "TLS 验证通过 remoteThumbprint=%s", stringFromAny(verifyReport["remoteThumbprint"]))
		detail := baseExecutionDetail(execution, input, checkpoint)
		detail["verify"] = verifyReport
		detail["executor"] = "windows-iis-provider"
		detail["appPoolName"] = appPoolName
		return true, "", "", detail
	}

	execution.submitLog("warn", "TLS 验证失败，开始自动回滚: %v", verifyErr)
	if err := stageDeploymentCheckpoint(execution, checkpoint, "iis.verify_failed"); err != nil {
		return false, "RECOVERY_LEDGER_WRITE_FAILED", err.Error(), baseExecutionDetail(execution, input, checkpoint)
	}
	rollbackErr := host.restoreBindingCertificate(site.Name, checkpoint.BindingSnapshot)
	if rollbackErr != nil {
		checkpoint.ManualIntervene = true
		checkpoint.UpdatedAt = time.Now().Format(time.RFC3339)
		_ = stageDeploymentCheckpoint(execution, checkpoint, "iis.rollback_failed")
		detail := baseExecutionDetail(execution, input, checkpoint)
		detail["verify"] = verifyReport
		detail["rollbackError"] = rollbackErr.Error()
		return false, "ROLLBACK_FAILED", fmt.Sprintf("TLS 验证失败且回滚失败: %v; %v", verifyErr, rollbackErr), detail
	}
	checkpoint.RolledBack = true
	checkpoint.UpdatedAt = time.Now().Format(time.RFC3339)
	if err := stageDeploymentCheckpoint(execution, checkpoint, "iis.rollback_succeeded"); err != nil {
		return false, "RECOVERY_LEDGER_WRITE_FAILED", err.Error(), baseExecutionDetail(execution, input, checkpoint)
	}
	detail := baseExecutionDetail(execution, input, checkpoint)
	detail["verify"] = verifyReport
	return false, "TLS_VERIFY_FAILED", verifyErr.Error(), detail
}

func parseWindowsIISDeploymentInput(payload map[string]any) (windowsIISDeploymentInput, error) {
	if payload == nil {
		return windowsIISDeploymentInput{}, errors.New("任务 payload 为空")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return windowsIISDeploymentInput{}, fmt.Errorf("编码 payload 失败: %w", err)
	}
	var input windowsIISDeploymentInput
	if err := json.Unmarshal(raw, &input); err != nil {
		return windowsIISDeploymentInput{}, fmt.Errorf("解析 payload 失败: %w", err)
	}
	input.SiteName = strings.TrimSpace(input.SiteName)
	input.PFXPath = strings.TrimSpace(input.PFXPath)
	input.PFXBase64 = strings.TrimSpace(input.PFXBase64)
	input.PFXPassword = strings.TrimSpace(input.PFXPassword)
	input.ExpectedThumbprint = normalizeThumbprint(input.ExpectedThumbprint)
	input.AppPoolName = strings.TrimSpace(input.AppPoolName)
	input.VerifyURL = strings.TrimSpace(input.VerifyURL)
	input.BindingSelector.IP = normalizeBindingIP(input.BindingSelector.IP)
	if input.BindingSelector.Port == 0 {
		input.BindingSelector.Port = 443
	}
	if input.SiteName == "" {
		return windowsIISDeploymentInput{}, errors.New("siteName 不能为空")
	}
	if input.BindingSelector.Port <= 0 {
		return windowsIISDeploymentInput{}, errors.New("bindingSelector.port 非法")
	}
	if input.PFXPath == "" && input.PFXBase64 == "" {
		return windowsIISDeploymentInput{}, errors.New("必须提供 pfxPath 或 pfxBase64")
	}
	if input.PFXPassword == "" {
		return windowsIISDeploymentInput{}, errors.New("pfxPassword 不能为空")
	}
	return input, nil
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
		return windowsIISSite{}, windowsIISBinding{}, fmt.Errorf("站点 %s 存在，但未找到匹配的 HTTPS Binding", input.SiteName)
	}
	return windowsIISSite{}, windowsIISBinding{}, fmt.Errorf("未找到 IIS 站点 %s", input.SiteName)
}

func bindingMatchesSelector(binding windowsIISBinding, selector bindingSelector) bool {
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

func resolveAppPoolName(input windowsIISDeploymentInput, site windowsIISSite) string {
	if input.AppPoolName != "" {
		return input.AppPoolName
	}
	return strings.TrimSpace(site.AppPool)
}

func stageDeploymentCheckpoint(execution *taskExecutionContext, checkpoint windowsIISDeploymentCheckpoint, step string) error {
	detail := map[string]any{
		"provider":    "windows.iis",
		"checkpoint":  checkpoint,
		"taskId":      execution.task.ID,
		"leaseId":     execution.leaseID,
		"stepVersion": "v1",
	}
	return execution.deps.recoveryLedger.record(execution.task.ID, "windows.iis.deployment", taskStatusRunning, step, detail)
}

func baseExecutionDetail(execution *taskExecutionContext, input windowsIISDeploymentInput, checkpoint windowsIISDeploymentCheckpoint) map[string]any {
	detail := map[string]any{
		"executor":       "windows-iis-provider",
		"taskId":         execution.task.ID,
		"siteName":       checkpoint.SiteName,
		"binding":        checkpoint.BindingSnapshot,
		"oldThumbprint":  checkpoint.OldThumbprint,
		"newThumbprint":  checkpoint.NewThumbprint,
		"aclApplied":     checkpoint.ACLApplied,
		"rolledBack":     checkpoint.RolledBack,
		"manualRequired": checkpoint.ManualIntervene,
	}
	if len(input.ExpectedDomains) > 0 {
		detail["expectedDomains"] = input.ExpectedDomains
	}
	return detail
}

func (h windowsExecutionHost) importPFX(input windowsIISDeploymentInput) (*windowsImportPFXResult, error) {
	pfxPath := input.PFXPath
	tempPath := ""
	if pfxPath == "" {
		decoded, err := base64.StdEncoding.DecodeString(input.PFXBase64)
		if err != nil {
			return nil, fmt.Errorf("解析 pfxBase64 失败: %w", err)
		}
		tempDir := filepath.Join(os.TempDir(), "gcac-agent")
		if err := os.MkdirAll(tempDir, 0o700); err != nil {
			return nil, fmt.Errorf("创建临时目录失败: %w", err)
		}
		tempPath = filepath.Join(tempDir, fmt.Sprintf("task-%d.pfx", time.Now().UnixNano()))
		if err := os.WriteFile(tempPath, decoded, 0o600); err != nil {
			return nil, fmt.Errorf("写入临时 PFX 失败: %w", err)
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

func verifyTLSBinding(ctx context.Context, input windowsIISDeploymentInput, expectedThumbprint string) (map[string]any, error) {
	address, serverName, targetURL, err := resolveVerifyTarget(input)
	if err != nil {
		return nil, err
	}
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	conn, err := tls.DialWithDialer(dialer, "tcp", address, &tls.Config{
		ServerName:         serverName,
		InsecureSkipVerify: true,
		MinVersion:         tls.VersionTLS12,
	})
	if err != nil {
		return nil, fmt.Errorf("TLS 连接失败: %w", err)
	}
	defer conn.Close()

	state := conn.ConnectionState()
	if len(state.PeerCertificates) == 0 {
		return nil, errors.New("TLS 握手成功但未返回服务端证书")
	}
	leaf := state.PeerCertificates[0]
	remoteThumbprint := certificateThumbprintSHA1(leaf)
	report := map[string]any{
		"target":           targetURL,
		"address":          address,
		"serverName":       serverName,
		"remoteThumbprint": remoteThumbprint,
		"subject":          leaf.Subject.String(),
		"issuer":           leaf.Issuer.String(),
		"notAfter":         leaf.NotAfter.Format(time.RFC3339),
		"dnsNames":         leaf.DNSNames,
		"verifiedAt":       time.Now().Format(time.RFC3339),
	}
	if expectedThumbprint != "" && !strings.EqualFold(remoteThumbprint, normalizeThumbprint(expectedThumbprint)) {
		return report, fmt.Errorf("TLS 远端证书 thumbprint 不匹配 expected=%s actual=%s", normalizeThumbprint(expectedThumbprint), remoteThumbprint)
	}
	for _, domain := range input.ExpectedDomains {
		if domain == "" {
			continue
		}
		if err := leaf.VerifyHostname(domain); err != nil {
			return report, fmt.Errorf("TLS 证书域名校验失败 domain=%s: %w", domain, err)
		}
	}
	_ = ctx
	return report, nil
}

func resolveVerifyTarget(input windowsIISDeploymentInput) (address string, serverName string, targetURL string, err error) {
	host := strings.TrimSpace(input.BindingSelector.HostHeader)
	port := input.BindingSelector.Port
	if port == 0 {
		port = 443
	}
	if input.VerifyURL != "" {
		parsed, parseErr := url.Parse(input.VerifyURL)
		if parseErr != nil {
			return "", "", "", fmt.Errorf("verifyUrl 非法: %w", parseErr)
		}
		serverName = parsed.Hostname()
		targetPort := parsed.Port()
		if targetPort == "" {
			targetPort = strconv.Itoa(port)
		}
		return net.JoinHostPort(parsed.Hostname(), targetPort), serverName, input.VerifyURL, nil
	}
	verifyHost := host
	if verifyHost == "" || verifyHost == "*" {
		verifyHost = "127.0.0.1"
	}
	targetURL = fmt.Sprintf("https://%s:%d", verifyHost, port)
	serverName = host
	if serverName == "" || serverName == "*" {
		serverName = verifyHost
	}
	return net.JoinHostPort(verifyHost, strconv.Itoa(port)), serverName, targetURL, nil
}

func certificateThumbprintSHA1(certificate *x509.Certificate) string {
	sum := sha1.Sum(certificate.Raw)
	return strings.ToUpper(hex.EncodeToString(sum[:]))
}

func normalizeThumbprint(value string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(strings.TrimSpace(value), " ", ""), ":", ""))
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
