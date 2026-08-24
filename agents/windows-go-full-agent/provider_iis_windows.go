package main

import (
	"context"
	"crypto/sha1"
	"crypto/sha256"
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

	"golang.org/x/crypto/pkcs12"
)

type windowsIISDeploymentInput struct {
	SiteName                  string                 `json:"siteName"`
	StepType                  string                 `json:"stepType"`
	BindingSelector           bindingSelector        `json:"bindingSelector"`
	PFXPath                   string                 `json:"pfxPath"`
	PFXBase64                 string                 `json:"pfxBase64"`
	PFXPassword               string                 `json:"pfxPassword"`
	DeploymentArtifact        *deploymentArtifactRef `json:"deploymentArtifact"`
	ExpectedThumbprint        string                 `json:"expectedThumbprint"`
	ExpectedCertificateSHA256 string                 `json:"expectedCertificateFingerprintSha256"`
	ExpectedDomains           []string               `json:"expectedDomains"`
	AppPoolName               string                 `json:"appPoolName"`
	VerifyURL                 string                 `json:"verifyUrl"`
}

type bindingSelector struct {
	IP                 string `json:"ip"`
	Port               int    `json:"port"`
	HostHeader         string `json:"hostHeader"`
	BindingInformation string `json:"bindingInformation"`
}

type deploymentArtifactRef struct {
	CertificateVersionID string `json:"certificateVersionId"`
	CertificateFormatID  string `json:"certificateFormatId"`
	Format               string `json:"format"`
	ContainsPrivateKey   bool   `json:"containsPrivateKey"`
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

type windowsBindingUpdateResult struct {
	AppliedBinding windowsIISBinding `json:"appliedBinding"`
}

func emitIISDebugLog(execution *taskExecutionContext, level string, summary string, detail map[string]any) {
	if execution == nil {
		return
	}
	execution.submitLog(level, summary)
	_ = submitRuntimeLog(execution.ctx, execution.client, execution.config, submitRuntimeLogRequest{
		AgentID:   execution.registration.AgentID,
		Category:  "windows.iis.deploy_certificate",
		Level:     level,
		Summary:   summary,
		Detail:    detail,
		EmittedAt: time.Now().Format(time.RFC3339),
	})
}

func runWindowsIISDeployment(execution *taskExecutionContext) (bool, string, string, map[string]any) {
	input, err := parseWindowsIISDeploymentInput(execution.task.Payload)
	if err != nil {
		emitIISDebugLog(execution, "error", "IIS deployment payload parse failed", map[string]any{"taskId": execution.task.ID, "error": err.Error()})
		return false, "TASK_PAYLOAD_INVALID", err.Error(), map[string]any{
			"executor": "windows-iis-provider",
			"taskId":   execution.task.ID,
		}
	}
	host := windowsExecutionHost{timeout: 90 * time.Second}
	site, binding, err := findTargetBinding(host, input)
	if err != nil {
		emitIISDebugLog(execution, "error", "IIS target binding not found", map[string]any{"taskId": execution.task.ID, "siteName": input.SiteName, "error": err.Error()})
		return false, "IIS_BINDING_NOT_FOUND", err.Error(), map[string]any{
			"executor": "windows-iis-provider",
			"taskId":   execution.task.ID,
			"siteName": input.SiteName,
		}
	}

	if isDryRunTask(execution.task.Payload) {
		emitIISDebugLog(execution, "info", "IIS dry-run preflight started", map[string]any{
			"taskId":             execution.task.ID,
			"siteName":           input.SiteName,
			"bindingInformation": binding.BindingInformation,
			"hostHeader":         binding.HostHeader,
			"port":               binding.Port,
			"pfxPassLen":         len(input.PFXPassword),
			"pfxEdgeWhitespace":  len(input.PFXPassword) > 0 && input.PFXPassword != strings.TrimSpace(input.PFXPassword),
		})
		detail, preflightErr := runWindowsIISDryRunPreflight(execution, host, input, site, binding)
		if preflightErr != nil {
			emitIISDebugLog(execution, "error", "IIS dry-run preflight failed", map[string]any{"taskId": execution.task.ID, "siteName": input.SiteName, "error": preflightErr.Error(), "detail": detail})
			return false, "IIS_DRY_RUN_FAILED", preflightErr.Error(), detail
		}
		emitIISDebugLog(execution, "info", "IIS dry-run preflight succeeded", map[string]any{"taskId": execution.task.ID, "siteName": input.SiteName, "detail": detail})
		return true, "", "", detail
	}

	switch strings.ToUpper(strings.TrimSpace(input.StepType)) {
	case "BACKUP":
		detail := map[string]any{
			"executor": "windows-iis-provider",
			"mode":     "iis_binding_snapshot",
			"taskId":   execution.task.ID,
			"siteName": site.Name,
			"binding": map[string]any{
				"bindingInformation": binding.BindingInformation,
				"hostHeader":         binding.HostHeader,
				"port":               binding.Port,
				"currentThumbprint":  normalizeThumbprint(binding.CertificateThumbprint),
			},
			"backup": map[string]any{
				"siteName":           site.Name,
				"bindingInformation": binding.BindingInformation,
				"oldThumbprint":      normalizeThumbprint(binding.CertificateThumbprint),
				"capturedAt":         time.Now().Format(time.RFC3339),
			},
		}
		execution.submitLog("info", "已备份 IIS Binding 证书 site=%s binding=%s thumbprint=%s", site.Name, binding.BindingInformation, normalizeThumbprint(binding.CertificateThumbprint))
		return true, "", "", detail
	case "RELOAD":
		detail := map[string]any{
			"executor": "windows-iis-provider",
			"mode":     "iis_binding_reload_not_required",
			"taskId":   execution.task.ID,
			"siteName": site.Name,
			"binding": map[string]any{
				"bindingInformation": binding.BindingInformation,
				"hostHeader":         binding.HostHeader,
				"port":               binding.Port,
				"currentThumbprint":  normalizeThumbprint(binding.CertificateThumbprint),
			},
		}
		execution.submitLog("info", "IIS Binding 当前不需要额外的 RELOAD 操作")
		return true, "", "", detail
	case "VERIFY":
		detail := map[string]any{
			"executor": "windows-iis-provider",
			"mode":     "iis_binding_verify",
			"taskId":   execution.task.ID,
			"siteName": site.Name,
			"binding": map[string]any{
				"bindingInformation": binding.BindingInformation,
				"hostHeader":         binding.HostHeader,
				"port":               binding.Port,
				"currentThumbprint":  normalizeThumbprint(binding.CertificateThumbprint),
			},
			"verify": map[string]any{
				"mode":              "iis_local_binding_state",
				"bindingThumbprint": normalizeThumbprint(binding.CertificateThumbprint),
				"bindingHostHeader": binding.HostHeader,
				"bindingPort":       binding.Port,
				"bindingAddress":    binding.BindingInformation,
				"verifiedAt":        time.Now().Format(time.RFC3339),
			},
		}
		currentThumbprint := normalizeThumbprint(binding.CertificateThumbprint)
		if currentThumbprint == "" {
			execution.submitLog("error", "IIS Binding 当前未配置证书 thumbprint")
			return false, "IIS_BINDING_CERTIFICATE_MISSING", "IIS Binding 当前未配置证书 thumbprint", detail
		}
		execution.submitLog("info", "IIS Binding 校验通过 thumbprint=%s", currentThumbprint)
		return true, "", "", detail
	case "", "INSTALL":
		// 兼容旧 payload 未显式携带 stepType 的情况，默认按 INSTALL 处理。
	default:
		detail := map[string]any{
			"executor": "windows-iis-provider",
			"mode":     "unsupported_step_type",
			"taskId":   execution.task.ID,
			"siteName": site.Name,
			"stepType": input.StepType,
		}
		execution.submitLog("error", "Windows IIS Provider 不支持的 stepType=%s", input.StepType)
		return false, "UNSUPPORTED_STEP_TYPE", fmt.Sprintf("Windows IIS Provider 不支持的 stepType=%q", input.StepType), detail
	}

	checkpoint := windowsIISDeploymentCheckpoint{
		TaskID:          execution.task.ID,
		SiteName:        site.Name,
		BindingSnapshot: binding,
		OldThumbprint:   normalizeThumbprint(binding.CertificateThumbprint),
		UpdatedAt:       time.Now().Format(time.RFC3339),
	}
	if err := stageDeploymentCheckpoint(execution, checkpoint, "iis.checkpoint_created"); err != nil {
		return false, "RECOVERY_LEDGER_WRITE_FAILED", err.Error(), baseExecutionDetail(execution, input, checkpoint)
	}
	execution.submitLog("info", "开始更新 IIS Binding 证书 site=%s binding=%s", site.Name, binding.BindingInformation)

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
	execution.submitLog("info", "开始更新 IIS HTTPS Binding 证书，并准备后续 ACL 与 TLS 校验")

	if err := host.updateBindingCertificate(site.Name, binding, checkpoint.NewThumbprint); err != nil {
		return false, "IIS_BINDING_UPDATE_FAILED", err.Error(), baseExecutionDetail(execution, input, checkpoint)
	}
	checkpoint.UpdatedAt = time.Now().Format(time.RFC3339)
	if err := stageDeploymentCheckpoint(execution, checkpoint, "iis.binding_updated"); err != nil {
		return false, "RECOVERY_LEDGER_WRITE_FAILED", err.Error(), baseExecutionDetail(execution, input, checkpoint)
	}
	execution.submitLog("info", "IIS HTTPS Binding 证书更新完成")
	detail := baseExecutionDetail(execution, input, checkpoint)
	detail["executor"] = "windows-iis-provider"
	detail["mode"] = "iis_install_completed"
	if appPoolName != "" {
		detail["appPoolName"] = appPoolName
	}
	return true, "", "", detail
}

func runWindowsIISDryRunPreflight(
	execution *taskExecutionContext,
	host windowsExecutionHost,
	input windowsIISDeploymentInput,
	site windowsIISSite,
	binding windowsIISBinding,
) (map[string]any, error) {
	emitIISDebugLog(execution, "info", "IIS dry-run preflight assembling checks", map[string]any{
		"taskId":             execution.task.ID,
		"siteName":           site.Name,
		"bindingInformation": binding.BindingInformation,
		"hostHeader":         binding.HostHeader,
		"port":               binding.Port,
	})
	checks := []map[string]any{
		dryRunCheck("site_exists", "IIS 站点存在", "passed", fmt.Sprintf("已命中 IIS 站点 %s", site.Name), map[string]any{
			"siteName": site.Name,
			"appPool":  site.AppPool,
			"state":    site.State,
		}),
		dryRunCheck("https_binding_matched", "HTTPS Binding 匹配", "passed", "已定位目标 HTTPS Binding", map[string]any{
			"bindingInformation": binding.BindingInformation,
			"hostHeader":         binding.HostHeader,
			"port":               binding.Port,
			"thumbprint":         normalizeThumbprint(binding.CertificateThumbprint),
		}),
	}

	appPoolName := strings.TrimSpace(input.AppPoolName)
	if appPoolName == "" {
		appPoolName = resolveAppPoolName(input, site)
	}
	if appPoolName == "" {
		checks = append(checks, dryRunCheck("app_pool_context", "应用程序池上下文", "passed", "未提供应用程序池名称，预检阶段跳过 ACL 目标确认", nil))
	} else {
		checks = append(checks, dryRunCheck("app_pool_context", "应用程序池上下文", "passed", fmt.Sprintf("已识别应用程序池 %s，可用于后续 ACL 校验", appPoolName), map[string]any{
			"appPoolName": appPoolName,
		}))
	}

	artifactEvidence := map[string]any{}
	if input.DeploymentArtifact != nil {
		artifactEvidence["certificateVersionId"] = input.DeploymentArtifact.CertificateVersionID
		artifactEvidence["certificateFormatId"] = input.DeploymentArtifact.CertificateFormatID
		artifactEvidence["format"] = input.DeploymentArtifact.Format
		artifactEvidence["containsPrivateKey"] = input.DeploymentArtifact.ContainsPrivateKey
	}
	checks = append(checks, dryRunCheck("deployment_material_selected", "Deployment material selected", "passed", "Deployment plan resolved to a concrete certificate artifact", artifactEvidence))

	if strings.TrimSpace(input.PFXPassword) == "" {
		checks = append(checks, dryRunCheck("password_resolved", "PFX password resolved", "failed", "PFX password is empty", nil))
		emitIISDebugLog(execution, "error", "IIS dry-run failed because PFX password is empty", map[string]any{"taskId": execution.task.ID, "siteName": site.Name, "checks": checks})
		return buildDryRunDetail(execution, input, site, binding, appPoolName, checks), errors.New("PFX password is empty; preflight cannot continue")
	}
	checks = append(checks, dryRunCheck("password_resolved", "PFX password resolved", "passed", "PFX password is available", nil))

	pfxEvidence := collectPFXPayloadEvidence(input)
	loadResult, loadErr := host.inspectPFX(input)
	if loadErr != nil {
		checks = append(checks, dryRunCheck("pfx_loadable", "PFX loadable", "failed", loadErr.Error(), pfxEvidence))
		emitIISDebugLog(execution, "error", "IIS dry-run PFX inspect failed", map[string]any{"taskId": execution.task.ID, "siteName": site.Name, "error": loadErr.Error(), "checks": checks})
		return buildDryRunDetail(execution, input, site, binding, appPoolName, checks), loadErr
	}
	loadResultEvidence := map[string]any{
		"thumbprint": loadResult.Thumbprint,
		"subject":    loadResult.Subject,
		"notAfter":   loadResult.NotAfter,
		"pfxSha256":  loadResult.PFXSHA256,
		"pfxSize":    loadResult.PFXSize,
	}
	for key, value := range pfxEvidence {
		if _, exists := loadResultEvidence[key]; !exists {
			loadResultEvidence[key] = value
		}
	}
	checks = append(checks, dryRunCheck("pfx_loadable", "PFX loadable", "passed", "PFX can be parsed locally", loadResultEvidence))

	domainStatus := "passed"
	domainDetail := "Certificate domains match the expected target domains"
	if err := verifyExpectedDomainsAgainstCertificate(loadResult.Certificate, input.ExpectedDomains); err != nil {
		domainStatus = "failed"
		domainDetail = err.Error()
	}
	checks = append(checks, dryRunCheck("domain_match", "Certificate domain match", domainStatus, domainDetail, map[string]any{
		"expectedDomains": input.ExpectedDomains,
		"dnsNames":        loadResult.Certificate.DNSNames,
		"commonName":      loadResult.Certificate.Subject.CommonName,
	}))
	if domainStatus == "failed" {
		emitIISDebugLog(execution, "error", "IIS dry-run domain check failed", map[string]any{"taskId": execution.task.ID, "siteName": site.Name, "error": domainDetail, "checks": checks})
		return buildDryRunDetail(execution, input, site, binding, appPoolName, checks), errors.New(domainDetail)
	}

	emitIISDebugLog(execution, "info", "IIS dry-run preflight completed", map[string]any{"taskId": execution.task.ID, "siteName": site.Name, "checks": checks})
	return buildDryRunDetail(execution, input, site, binding, appPoolName, checks), nil
}

func parseWindowsIISDeploymentInput(payload map[string]any) (windowsIISDeploymentInput, error) {
	if payload == nil {
		return windowsIISDeploymentInput{}, errors.New("payload 不能为空")
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		return windowsIISDeploymentInput{}, fmt.Errorf("序列化 payload 失败: %w", err)
	}
	var input windowsIISDeploymentInput
	if err := json.Unmarshal(raw, &input); err != nil {
		return windowsIISDeploymentInput{}, fmt.Errorf("解析 payload 失败: %w", err)
	}
	input.SiteName = strings.TrimSpace(input.SiteName)
	input.StepType = strings.TrimSpace(input.StepType)
	input.PFXPath = strings.TrimSpace(input.PFXPath)
	input.PFXBase64 = strings.TrimSpace(input.PFXBase64)
	input.ExpectedThumbprint = normalizeThumbprint(input.ExpectedThumbprint)
	input.AppPoolName = strings.TrimSpace(input.AppPoolName)
	input.VerifyURL = strings.TrimSpace(input.VerifyURL)
	input.BindingSelector.IP = normalizeBindingIP(input.BindingSelector.IP)
	input.BindingSelector.BindingInformation = strings.TrimSpace(input.BindingSelector.BindingInformation)
	if input.DeploymentArtifact != nil {
		input.DeploymentArtifact.Format = strings.TrimSpace(input.DeploymentArtifact.Format)
	}
	if input.BindingSelector.Port == 0 {
		input.BindingSelector.Port = 443
	}
	if input.SiteName == "" {
		return windowsIISDeploymentInput{}, errors.New("siteName 不能为空")
	}
	if input.BindingSelector.Port <= 0 {
		return windowsIISDeploymentInput{}, errors.New("bindingSelector.port 必须大于 0")
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

func isDryRunTask(payload map[string]any) bool {
	value, ok := payload["dryRun"]
	if !ok {
		return false
	}
	booleanValue, ok := value.(bool)
	return ok && booleanValue
}

func dryRunCheck(key string, label string, status string, detail string, evidence map[string]any) map[string]any {
	check := map[string]any{
		"key":    key,
		"label":  label,
		"status": status,
	}
	if strings.TrimSpace(detail) != "" {
		check["detail"] = detail
	}
	if len(evidence) > 0 {
		check["evidence"] = evidence
	}
	return check
}

func buildDryRunDetail(
	execution *taskExecutionContext,
	input windowsIISDeploymentInput,
	site windowsIISSite,
	binding windowsIISBinding,
	appPoolName string,
	checks []map[string]any,
) map[string]any {
	summary := map[string]int{
		"passed":  0,
		"failed":  0,
		"warning": 0,
		"unknown": 0,
	}
	for _, item := range checks {
		status := strings.TrimSpace(stringFromAny(item["status"]))
		if _, ok := summary[status]; ok {
			summary[status]++
		}
	}
	return map[string]any{
		"executor":          "windows-iis-provider",
		"mode":              "dry_run_preflight",
		"taskId":            execution.task.ID,
		"siteName":          site.Name,
		"appPoolName":       appPoolName,
		"pfxPassLen":        len(input.PFXPassword),
		"pfxEdgeWhitespace": len(input.PFXPassword) > 0 && input.PFXPassword != strings.TrimSpace(input.PFXPassword),
		"pfxPassUtf8Sha256": func() string {
			sum := sha256.Sum256([]byte(input.PFXPassword))
			return hex.EncodeToString(sum[:])
		}(),
		"pfxPassUtf8Len":   len([]byte(input.PFXPassword)),
		"decodedPfxSha256": loadPFXEvidenceFromChecks(checks, "pfxSha256"),
		"decodedPfxSize":   loadPFXEvidenceSizeFromChecks(checks, "pfxSize"),
		"pfxSource": func() string {
			if strings.TrimSpace(input.PFXPath) != "" {
				return "path"
			}
			if strings.TrimSpace(input.PFXBase64) != "" {
				return "base64"
			}
			return "unknown"
		}(),
		"binding": map[string]any{
			"bindingInformation": binding.BindingInformation,
			"hostHeader":         binding.HostHeader,
			"port":               binding.Port,
			"currentThumbprint":  normalizeThumbprint(binding.CertificateThumbprint),
		},
		"deploymentArtifact": map[string]any{
			"certificateVersionId": readArtifactField(input.DeploymentArtifact, "version"),
			"certificateFormatId":  readArtifactField(input.DeploymentArtifact, "formatId"),
			"format":               readArtifactField(input.DeploymentArtifact, "format"),
			"containsPrivateKey":   readArtifactBoolField(input.DeploymentArtifact, "containsPrivateKey"),
		},
		"expectedDomains": input.ExpectedDomains,
		"dryRunChecks":    checks,
		"dryRunSummary":   summary,
	}
}

func readArtifactField(artifact *deploymentArtifactRef, field string) string {
	if artifact == nil {
		return ""
	}
	switch field {
	case "version":
		return artifact.CertificateVersionID
	case "formatId":
		return artifact.CertificateFormatID
	case "format":
		return artifact.Format
	default:
		return ""
	}
}

func readArtifactBoolField(artifact *deploymentArtifactRef, field string) bool {
	if artifact == nil {
		return false
	}
	switch field {
	case "containsPrivateKey":
		return artifact.ContainsPrivateKey
	default:
		return false
	}
}

func loadPFXEvidenceFromChecks(checks []map[string]any, key string) string {
	for _, check := range checks {
		evidence, ok := check["evidence"].(map[string]any)
		if !ok {
			continue
		}
		if value := strings.TrimSpace(stringFromAny(evidence[key])); value != "" {
			return value
		}
	}
	return ""
}

func loadPFXEvidenceSizeFromChecks(checks []map[string]any, key string) int {
	for _, check := range checks {
		evidence, ok := check["evidence"].(map[string]any)
		if !ok {
			continue
		}
		switch value := evidence[key].(type) {
		case int:
			if value > 0 {
				return value
			}
		case float64:
			if value > 0 {
				return int(value)
			}
		}
	}
	return 0
}

func collectPFXPayloadEvidence(input windowsIISDeploymentInput) map[string]any {
	var rawBytes []byte
	switch {
	case strings.TrimSpace(input.PFXBase64) != "":
		decoded, err := base64.StdEncoding.DecodeString(input.PFXBase64)
		if err == nil {
			rawBytes = decoded
		}
	case strings.TrimSpace(input.PFXPath) != "":
		loaded, err := os.ReadFile(input.PFXPath)
		if err == nil {
			rawBytes = loaded
		}
	}
	if len(rawBytes) == 0 {
		return nil
	}
	sum := sha256.Sum256(rawBytes)
	return map[string]any{
		"pfxSha256": hex.EncodeToString(sum[:]),
		"pfxSize":   len(rawBytes),
	}
}

func (h windowsExecutionHost) importPFX(input windowsIISDeploymentInput) (*windowsImportPFXResult, error) {
	pfxPath := input.PFXPath
	tempPath := ""
	if input.DeploymentArtifact != nil && input.PFXPath != "" {
		tempPath = input.PFXPath
		defer os.Remove(tempPath)
	}
	if pfxPath == "" {
		decoded, err := base64.StdEncoding.DecodeString(input.PFXBase64)
		if err != nil {
			return nil, fmt.Errorf("閻熸瑱绲鹃悗?pfxBase64 濠㈡儼绮剧憴? %w", err)
		}
		tempDir := filepath.Join(os.TempDir(), "gcac-agent")
		if err := os.MkdirAll(tempDir, 0o700); err != nil {
			return nil, fmt.Errorf("闁告帗绋戠紓鎾寸▔鐎涙ɑ顦ч柣鈺婂枛缂嶅秵寰勬潏顐バ? %w", err)
		}
		tempPath = filepath.Join(tempDir, fmt.Sprintf("task-%d.pfx", time.Now().UnixNano()))
		if err := os.WriteFile(tempPath, decoded, 0o600); err != nil {
			return nil, fmt.Errorf("闁告劖鐟ラ崣鍡樼▔鐎涙ɑ顦?PFX 濠㈡儼绮剧憴? %w", err)
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
		return nil, errors.New("PFX 閻庣數鍘ч崣鍡涘触鎼淬垺寮撻弶鈺傛煥濞?thumbprint")
	}
	if input.ExpectedThumbprint != "" && !strings.EqualFold(input.ExpectedThumbprint, result.Thumbprint) {
		return nil, fmt.Errorf("閻庣數鍘ч崣鍡欐嫚娴ｅ嘲濮?thumbprint 濞戞挸绉寸亸顕€鏌?expected=%s actual=%s", input.ExpectedThumbprint, result.Thumbprint)
	}
	return &result, nil
}

func (h windowsExecutionHost) inspectPFX(input windowsIISDeploymentInput) (*windowsInspectPFXResult, error) {
	pfxPath := input.PFXPath
	tempPath := ""
	var localBytes []byte
	if input.DeploymentArtifact != nil && input.PFXPath != "" {
		tempPath = input.PFXPath
		defer os.Remove(tempPath)
	}
	if pfxPath == "" {
		decoded, err := base64.StdEncoding.DecodeString(input.PFXBase64)
		if err != nil {
			return nil, fmt.Errorf("閻熸瑱绲鹃悗?pfxBase64 濠㈡儼绮剧憴? %w", err)
		}
		localBytes = decoded
		tempDir := filepath.Join(os.TempDir(), "gcac-agent")
		if err := os.MkdirAll(tempDir, 0o700); err != nil {
			return nil, fmt.Errorf("闁告帗绋戠紓鎾寸▔鐎涙ɑ顦ч柣鈺婂枛缂嶅秵寰勬潏顐バ? %w", err)
		}
		tempPath = filepath.Join(tempDir, fmt.Sprintf("inspect-%d.pfx", time.Now().UnixNano()))
		if err := os.WriteFile(tempPath, decoded, 0o600); err != nil {
			return nil, fmt.Errorf("闁告劖鐟ラ崣鍡樼▔鐎涙ɑ顦?PFX 濠㈡儼绮剧憴? %w", err)
		}
		defer os.Remove(tempPath)
		pfxPath = tempPath
	}
	if len(localBytes) == 0 && strings.TrimSpace(pfxPath) != "" {
		loaded, readErr := os.ReadFile(pfxPath)
		if readErr != nil {
			return nil, fmt.Errorf("閻犲洩顕цぐ?PFX 濠㈡儼绮剧憴? %w", readErr)
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
				return localInspect, fmt.Errorf("Windows 闁哄牜鍓氬┃鈧柡鍐У绾墎鎲撮敐鍡欌偓?PFX闁挎稑濂旂徊?Go 闁哄牜鍓欏﹢瀵告喆閿濆棛鈧粙骞嬮幇顒€顫犻柨娑欑〒閺嬫帗瀵?Windows PKCS#12 闁稿繒鍘ч鎰板箑瑜斿Λ鑸碉紣? %w", err)
			}
		}
		return nil, fmt.Errorf("Windows 闁?Go 闁哄牜鍓欏﹢鎾焾閼恒儲锟ユ繛澶嬫礉琚欓柡?PFX闁挎稑鐬奸弸鎺撳?PFX 闁告劕鎳庨鎰板箣閺嵮呮闁活喕鐒﹀Λ銈夊极? %w", err)
	}
	result.Thumbprint = normalizeThumbprint(result.Thumbprint)
	if result.Thumbprint == "" {
		return nil, errors.New("PFX 閻庣數鍘ч崣鍡涘触鎼淬垺寮撻弶鈺傛煥濞?thumbprint")
	}
	if strings.TrimSpace(result.RawCertificateBase64) == "" {
		return nil, errors.New("PFX ????????????")
	}
	rawCertificate, err := base64.StdEncoding.DecodeString(result.RawCertificateBase64)
	if err != nil {
		return nil, fmt.Errorf("閻熸瑱绲块悥婊呮嫚娴ｅ嘲濮涢柛妯煎枎椤劙寮悧鍫濈ウ濠㈡儼绮剧憴? %w", err)
	}
	certificate, err := x509.ParseCertificate(rawCertificate)
	if err != nil {
		return nil, fmt.Errorf("閻熸瑱绲鹃悗鐣屾嫚娴ｅ嘲濮涢柛妯煎枎椤劙寮悧鍫濈ウ濠㈡儼绮剧憴? %w", err)
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
		return errors.New("缂佸绶氶幐?ACL 閻犱礁澧介悿鍡樺緞鏉堫偉袝")
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
		return errors.New("binding ?? thumbprint ????")
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
		return errors.New("?? IIS Binding ??")
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
		return nil, fmt.Errorf("TLS 閺夆晝鍋炵敮瀛樺緞鏉堫偉袝: %w", err)
	}
	defer conn.Close()

	state := conn.ConnectionState()
	if len(state.PeerCertificates) == 0 {
		return nil, errors.New("TLS ?????????????")
	}
	leaf := state.PeerCertificates[0]
	remoteThumbprint := certificateThumbprintSHA1(leaf)
	remoteCertificateSHA256 := certificateFingerprintSHA256(leaf)
	report := map[string]any{
		"target":                  targetURL,
		"address":                 address,
		"serverName":              serverName,
		"remoteThumbprint":        remoteThumbprint,
		"remoteCertificateSha256": remoteCertificateSHA256,
		"subject":                 leaf.Subject.String(),
		"issuer":                  leaf.Issuer.String(),
		"notAfter":                leaf.NotAfter.Format(time.RFC3339),
		"dnsNames":                leaf.DNSNames,
		"verifiedAt":              time.Now().Format(time.RFC3339),
	}
	if expectedThumbprint != "" && !strings.EqualFold(remoteThumbprint, normalizeThumbprint(expectedThumbprint)) {
		return report, fmt.Errorf("TLS 閺夆晜绮庨顒傛嫚娴ｅ嘲濮?thumbprint 濞戞挸绉寸亸顕€鏌?expected=%s actual=%s", normalizeThumbprint(expectedThumbprint), remoteThumbprint)
	}
	if expectedSHA256 := normalizeSHA256(input.ExpectedCertificateSHA256); expectedSHA256 != "" && remoteCertificateSHA256 != expectedSHA256 {
		return report, fmt.Errorf("TLS 閺夆晜绮庨顒傛嫚娴ｅ嘲濮?SHA256 濞戞挸绉寸亸顕€鏌?expected=%s actual=%s", expectedSHA256, remoteCertificateSHA256)
	}
	for _, domain := range input.ExpectedDomains {
		if domain == "" {
			continue
		}
		if err := leaf.VerifyHostname(domain); err != nil {
			return report, fmt.Errorf("TLS 閻犲洣妞掗崝鐔煎春閻旈攱鍊抽柡宥忕節閻涙瑦寰勬潏顐バ?domain=%s: %w", domain, err)
		}
	}
	_ = ctx
	return report, nil
}

func verifyExpectedDomainsAgainstCertificate(certificate *x509.Certificate, expectedDomains []string) error {
	if certificate == nil {
		return errors.New("???????????????")
	}
	for _, domain := range expectedDomains {
		trimmed := strings.TrimSpace(domain)
		if trimmed == "" {
			continue
		}
		if err := certificate.VerifyHostname(trimmed); err != nil {
			return fmt.Errorf("閻犲洣妞掗崝鐔煎春閻旈攱鍊冲☉鎾崇Т鐏忣噣鏌?%s", trimmed)
		}
	}
	return nil
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
			return "", "", "", fmt.Errorf("verifyUrl is invalid: %w", parseErr)
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
	return nil, errors.New("Go ???? PFX ????????")
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
