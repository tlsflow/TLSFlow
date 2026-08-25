package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// AD CS 动作只在 Windows Agent 上执行。控制面传入 CSR、请求号和公开路径，私钥始终由本机证书请求携带的密钥容器持有。
func validateCertificateAuthorityOperationInput(operationType string, input map[string]any) error {
	if input == nil || stringValue(input, "caConfig") == "" {
		return errors.New("AD CS operation requires caConfig")
	}
	switch operationType {
	case "ca.certificate.issue", "ca.certificate.renew":
		if stringValue(input, "csrPem") == "" {
			return errors.New("AD CS issue requires csrPem")
		}
		if path := stringValue(input, "certificateOutputPath"); path != "" && !filepath.IsAbs(path) {
			return errors.New("AD CS certificateOutputPath must be absolute")
		}
	case "ca.certificate.query":
		if stringValue(input, "providerRequestId") == "" {
			return errors.New("AD CS query requires providerRequestId")
		}
		if path := stringValue(input, "certificateOutputPath"); path != "" && !filepath.IsAbs(path) {
			return errors.New("AD CS certificateOutputPath must be absolute")
		}
	case "ca.certificate.revoke":
		if stringValue(input, "serialNumber") == "" || stringValue(input, "reason") == "" {
			return errors.New("AD CS revoke requires serialNumber and reason")
		}
	case "ca.revocation.evidence":
		if stringValue(input, "serialNumber") == "" || !filepath.IsAbs(stringValue(input, "certificatePath")) {
			return errors.New("AD CS revocation evidence requires serialNumber and absolute certificatePath")
		}
	default:
		return fmt.Errorf("unsupported AD CS operation: %s", operationType)
	}
	return nil
}

func executeCertificateAuthorityOperation(ctx context.Context, _ agentPlanV2, operation agentPlanAction) (map[string]any, error) {
	if err := validateCertificateAuthorityOperationInput(operation.OperationType, operation.Input); err != nil {
		return nil, err
	}
	if err := agentContextError(ctx); err != nil {
		return nil, err
	}
	caConfig := stringValue(operation.Input, "caConfig")
	switch operation.OperationType {
	case "ca.certificate.issue", "ca.certificate.renew":
		return executeAdcsSubmit(ctx, operation, caConfig)
	case "ca.certificate.query":
		return executeAdcsRetrieve(ctx, operation, caConfig)
	case "ca.certificate.revoke":
		return executeAdcsRevoke(ctx, operation, caConfig)
	case "ca.revocation.evidence":
		return executeAdcsRevocationEvidence(ctx, operation)
	default:
		return nil, fmt.Errorf("unsupported AD CS operation: %s", operation.OperationType)
	}
}

func executeAdcsSubmit(ctx context.Context, operation agentPlanAction, caConfig string) (map[string]any, error) {
	requestFile, err := os.CreateTemp("", "gcac-adcs-*.csr")
	if err != nil {
		return nil, err
	}
	requestPath := requestFile.Name()
	defer os.Remove(requestPath)
	if err := requestFile.Chmod(0o600); err != nil {
		requestFile.Close()
		return nil, err
	}
	if _, err := requestFile.WriteString(stringValue(operation.Input, "csrPem")); err != nil {
		requestFile.Close()
		return nil, err
	}
	if err := requestFile.Close(); err != nil {
		return nil, err
	}
	certificatePath := stringValue(operation.Input, "certificateOutputPath")
	if certificatePath == "" {
		certificateFile, createErr := os.CreateTemp("", "gcac-adcs-*.cer")
		if createErr != nil {
			return nil, createErr
		}
		certificatePath = certificateFile.Name()
		certificateFile.Close()
		defer os.Remove(certificatePath)
	}
	args := []string{"-submit", "-config", caConfig}
	if template := stringValue(operation.Input, "templateId"); template != "" {
		args = append(args, "-attrib", "CertificateTemplate:"+template)
	}
	args = append(args, requestPath, certificatePath)
	output, err := runWindowsCertificateCommand(ctx, "certreq.exe", args...)
	if err != nil {
		return nil, err
	}
	requestID := parseAdcsRequestID(output)
	if requestID == "" {
		return nil, errors.New("AD CS submit did not return a request ID")
	}
	result := map[string]any{"providerRequestId": requestID, "requestId": requestID, "caConfig": caConfig}
	if certificate, readErr := os.ReadFile(certificatePath); readErr == nil && len(certificate) > 0 {
		result["status"] = "issued"
		result["certificatePem"] = string(certificate)
	} else {
		result["status"] = "pending"
	}
	return result, nil
}

func executeAdcsRetrieve(ctx context.Context, operation agentPlanAction, caConfig string) (map[string]any, error) {
	certificateFile, err := os.CreateTemp("", "gcac-adcs-*.cer")
	if err != nil {
		return nil, err
	}
	certificatePath := certificateFile.Name()
	certificateFile.Close()
	defer os.Remove(certificatePath)
	output, err := runWindowsCertificateCommand(ctx, "certreq.exe", "-retrieve", "-config", caConfig, stringValue(operation.Input, "providerRequestId"), certificatePath)
	if err != nil {
		return nil, err
	}
	result := map[string]any{"providerRequestId": stringValue(operation.Input, "providerRequestId"), "caConfig": caConfig}
	if certificate, readErr := os.ReadFile(certificatePath); readErr == nil && len(certificate) > 0 {
		result["status"] = "issued"
		result["certificatePem"] = string(certificate)
	} else if strings.Contains(strings.ToLower(output), "pending") || strings.Contains(strings.ToLower(output), "pending approval") {
		result["status"] = "pending"
	} else {
		result["status"] = "unknown"
	}
	return result, nil
}

func executeAdcsRevoke(ctx context.Context, operation agentPlanAction, caConfig string) (map[string]any, error) {
	reason := adcsRevocationReason(stringValue(operation.Input, "reason"))
	if _, err := runWindowsCertificateCommand(ctx, "certutil.exe", "-config", caConfig, "-revoke", stringValue(operation.Input, "serialNumber"), strconv.Itoa(reason)); err != nil {
		return nil, err
	}
	return map[string]any{
		"status":       "revoked",
		"serialNumber": strings.ToUpper(stringValue(operation.Input, "serialNumber")),
		"revokedAt":    time.Now().UTC().Format(time.RFC3339Nano),
	}, nil
}

func executeAdcsRevocationEvidence(ctx context.Context, operation agentPlanAction) (map[string]any, error) {
	output, err := runWindowsCertificateCommand(ctx, "certutil.exe", "-verify", "-urlfetch", stringValue(operation.Input, "certificatePath"))
	if err != nil {
		return nil, err
	}
	lower := strings.ToLower(output)
	status := "unknown"
	if strings.Contains(lower, "revoked") || strings.Contains(lower, "revocationstatus=revoked") {
		status = "revoked"
	}
	return map[string]any{
		"status":           status,
		"revocationStatus": status,
		"serialNumber":     strings.ToUpper(stringValue(operation.Input, "serialNumber")),
		"evidenceSummary":  truncateAdcsOutput(output),
	}, nil
}

func runWindowsCertificateCommand(ctx context.Context, command string, args ...string) (string, error) {
	completed := exec.CommandContext(ctx, command, args...)
	output, err := completed.CombinedOutput()
	if err != nil {
		return "", commandExecutionError(command+" 执行失败", err)
	}
	return string(output), nil
}

func parseAdcsRequestID(output string) string {
	lower := strings.ToLower(output)
	for _, marker := range []string{"request id", "requestid", "请求 id", "请求号"} {
		index := strings.Index(lower, strings.ToLower(marker))
		if index < 0 {
			continue
		}
		value := strings.TrimLeft(output[index+len(marker):], " :#\t")
		end := 0
		for end < len(value) && value[end] >= '0' && value[end] <= '9' {
			end++
		}
		if end > 0 {
			return value[:end]
		}
	}
	return ""
}

func adcsRevocationReason(reason string) int {
	switch reason {
	case "keyCompromise":
		return 1
	case "caCompromise":
		return 2
	case "affiliationChanged":
		return 3
	case "superseded":
		return 4
	case "cessationOfOperation":
		return 5
	default:
		return 0
	}
}

func truncateAdcsOutput(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 1024 {
		return value[:1024]
	}
	return value
}
