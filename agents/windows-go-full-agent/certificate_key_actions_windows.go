package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

func windowsCertificateCreateCSRHandler() actionHandler {
	return actionHandlerFunc{
		descriptor: actionHandlerDescriptor{ActionType: "certificate.key.create_csr", SchemaVersions: []string{"1.0"}},
		execute: func(execution *taskExecutionContext) actionExecutionResult {
			return createWindowsCertificateCSR(execution.ctx, execution.task.Payload)
		},
	}
}

func windowsCertificateInstallIssuedHandler() actionHandler {
	return actionHandlerFunc{
		descriptor: actionHandlerDescriptor{ActionType: "certificate.install_issued", SchemaVersions: []string{"1.0"}},
		execute: func(execution *taskExecutionContext) actionExecutionResult {
			return installWindowsIssuedCertificate(execution.ctx, execution.task.Payload)
		},
	}
}

func windowsCertificateRetireKeyHandler() actionHandler {
	return actionHandlerFunc{
		descriptor: actionHandlerDescriptor{ActionType: "certificate.key.retire", SchemaVersions: []string{"1.0"}},
		execute: func(execution *taskExecutionContext) actionExecutionResult {
			return retireWindowsCertificateKey(execution.ctx, execution.task.Payload)
		},
	}
}

func windowsCertificateTrustInstallHandler() actionHandler {
	return actionHandlerFunc{
		descriptor: actionHandlerDescriptor{ActionType: "certificate.trust.install", SchemaVersions: []string{"1.0"}},
		execute: func(execution *taskExecutionContext) actionExecutionResult {
			return installWindowsCertificateTrust(execution.ctx, execution.task.Payload)
		},
	}
}

func windowsCertificateTrustRollbackHandler() actionHandler {
	return actionHandlerFunc{
		descriptor: actionHandlerDescriptor{ActionType: "certificate.trust.rollback", SchemaVersions: []string{"1.0"}},
		execute: func(execution *taskExecutionContext) actionExecutionResult {
			return rollbackWindowsCertificateTrust(execution.ctx, execution.task.Payload)
		},
	}
}

func createWindowsCertificateCSR(ctx context.Context, payload map[string]any) actionExecutionResult {
	commonName := strings.TrimSpace(stringFromMap(payload, "commonName"))
	if commonName == "" {
		return windowsCertificateActionError("TASK_PAYLOAD_INVALID", errors.New("commonName is required"))
	}
	container, err := newWindowsKeyContainer()
	if err != nil {
		return windowsCertificateActionError("LOCAL_KEY_CREATE_FAILED", err)
	}
	directory, err := os.MkdirTemp("", "gcac-cng-csr-")
	if err != nil {
		return windowsCertificateActionError("LOCAL_KEY_CREATE_FAILED", err)
	}
	defer os.RemoveAll(directory)
	infPath := filepath.Join(directory, "request.inf")
	csrPath := filepath.Join(directory, "request.req")
	if err := os.WriteFile(infPath, []byte(windowsCSRInf(commonName, windowsStringSlice(payload, "sans"), container)), 0o600); err != nil {
		return windowsCertificateActionError("LOCAL_KEY_CREATE_FAILED", err)
	}
	if output, err := exec.CommandContext(ctx, "certreq.exe", "-new", "-machine", infPath, csrPath).CombinedOutput(); err != nil {
		return windowsCertificateActionError("LOCAL_KEY_CREATE_FAILED", fmt.Errorf("certreq failed: %s", strings.TrimSpace(string(output))))
	}
	csrPEM, err := os.ReadFile(csrPath)
	if err != nil {
		return windowsCertificateActionError("CSR_CREATE_FAILED", err)
	}
	fingerprint, err := csrPublicKeyFingerprint(csrPEM)
	if err != nil {
		return windowsCertificateActionError("CSR_CREATE_FAILED", err)
	}
	return actionExecutionResult{Success: true, Detail: map[string]any{
		"csrPem": string(csrPEM), "publicKeyFingerprintSha256": fingerprint,
		"localKeyRef": fmt.Sprintf("cng:%s:%s", container, fingerprint),
		"keyBackend":  "cng", "exportability": "non_exportable", "protectionLevel": "os_protected",
		"protectionEvidence": map[string]any{
			"provider": "Microsoft Software Key Storage Provider", "machineKeySet": true,
			"exportable": false, "privateKeyTransported": false, "platform": "windows",
		},
	}}
}

func installWindowsIssuedCertificate(ctx context.Context, payload map[string]any) actionExecutionResult {
	localKeyRef := strings.TrimSpace(stringFromMap(payload, "localKeyRef"))
	certificatePEM := strings.TrimSpace(stringFromMap(payload, "certificatePem"))
	_, expectedFingerprint, err := parseWindowsLocalKeyRef(localKeyRef)
	if err != nil || certificatePEM == "" {
		return windowsCertificateActionError("TASK_PAYLOAD_INVALID", errors.New("valid localKeyRef and certificatePem are required"))
	}
	actualFingerprint, thumbprint, err := certificatePublicKeyFingerprint([]byte(certificatePEM))
	if err != nil {
		return windowsCertificateActionError("CERTIFICATE_INVALID", err)
	}
	if !strings.EqualFold(actualFingerprint, expectedFingerprint) {
		return windowsCertificateActionError("PUBLIC_KEY_MISMATCH", errors.New("issued certificate public key does not match CNG key"))
	}
	directory, err := os.MkdirTemp("", "gcac-cng-install-")
	if err != nil {
		return windowsCertificateActionError("CERTIFICATE_INSTALL_FAILED", err)
	}
	defer os.RemoveAll(directory)
	certificatePath := filepath.Join(directory, "issued.cer")
	if err := os.WriteFile(certificatePath, []byte(certificatePEM+"\n"), 0o600); err != nil {
		return windowsCertificateActionError("CERTIFICATE_INSTALL_FAILED", err)
	}
	if output, err := exec.CommandContext(ctx, "certreq.exe", "-accept", "-machine", certificatePath).CombinedOutput(); err != nil {
		return windowsCertificateActionError("CERTIFICATE_INSTALL_FAILED", fmt.Errorf("certreq accept failed: %s", strings.TrimSpace(string(output))))
	}
	return actionExecutionResult{Success: true, Detail: map[string]any{
		"localKeyRef": localKeyRef, "storeLocation": "LocalMachine", "storeName": "My", "thumbprint": thumbprint, "verified": true,
	}}
}

func retireWindowsCertificateKey(ctx context.Context, payload map[string]any) actionExecutionResult {
	localKeyRef := strings.TrimSpace(stringFromMap(payload, "localKeyRef"))
	container, _, err := parseWindowsLocalKeyRef(localKeyRef)
	if err != nil {
		return windowsCertificateActionError("TASK_PAYLOAD_INVALID", err)
	}
	output, err := exec.CommandContext(ctx, "certutil.exe", "-f", "-csp", "Microsoft Software Key Storage Provider", "-delkey", container).CombinedOutput()
	if err != nil {
		return windowsCertificateActionError("LOCAL_KEY_RETIRE_FAILED", fmt.Errorf("certutil delkey failed: %s", strings.TrimSpace(string(output))))
	}
	return actionExecutionResult{Success: true, Detail: map[string]any{"localKeyRef": localKeyRef, "retired": true}}
}

func installWindowsCertificateTrust(ctx context.Context, payload map[string]any) actionExecutionResult {
	certificatePEM := strings.TrimSpace(stringFromMap(payload, "certificatePem"))
	certificate, err := parseWindowsCertificate([]byte(certificatePEM))
	if err != nil || !certificate.IsCA {
		return windowsCertificateActionError("TRUST_CERTIFICATE_INVALID", errors.New("certificatePem must contain a valid CA certificate"))
	}
	directory, err := os.MkdirTemp("", "gcac-trust-install-")
	if err != nil {
		return windowsCertificateActionError("TRUST_INSTALL_FAILED", err)
	}
	defer os.RemoveAll(directory)
	certificatePath := filepath.Join(directory, "ca.cer")
	if err := os.WriteFile(certificatePath, []byte(certificatePEM+"\n"), 0o600); err != nil {
		return windowsCertificateActionError("TRUST_INSTALL_FAILED", err)
	}
	if output, err := exec.CommandContext(ctx, "certutil.exe", "-f", "-addstore", "Root", certificatePath).CombinedOutput(); err != nil {
		return windowsCertificateActionError("TRUST_INSTALL_FAILED", fmt.Errorf("certutil addstore failed: %s", strings.TrimSpace(string(output))))
	}
	thumbprint := strings.ToUpper(certificateFingerprintHex(certificate))
	return actionExecutionResult{Success: true, Detail: map[string]any{
		"storeLocation": "LocalMachine", "storeName": "Root", "thumbprint": thumbprint, "verified": true,
	}}
}

func rollbackWindowsCertificateTrust(ctx context.Context, payload map[string]any) actionExecutionResult {
	thumbprint := strings.TrimSpace(stringFromMap(payload, "thumbprint"))
	if thumbprint == "" {
		return windowsCertificateActionError("TASK_PAYLOAD_INVALID", errors.New("thumbprint is required"))
	}
	if output, err := exec.CommandContext(ctx, "certutil.exe", "-delstore", "Root", thumbprint).CombinedOutput(); err != nil {
		return windowsCertificateActionError("TRUST_ROLLBACK_FAILED", fmt.Errorf("certutil delstore failed: %s", strings.TrimSpace(string(output))))
	}
	return actionExecutionResult{Success: true, Detail: map[string]any{"thumbprint": thumbprint, "rolledBack": true}}
}

func parseWindowsCertificate(data []byte) (*x509.Certificate, error) {
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, errors.New("certificate PEM is invalid")
	}
	return x509.ParseCertificate(block.Bytes)
}

func certificateFingerprintHex(certificate *x509.Certificate) string {
	sum := sha256.Sum256(certificate.Raw)
	return hex.EncodeToString(sum[:])
}

func windowsCSRInf(commonName string, sans []string, container string) string {
	var extensions string
	if len(sans) > 0 {
		parts := make([]string, 0, len(sans))
		for _, san := range sans {
			parts = append(parts, "dns="+strings.TrimSpace(san))
		}
		extensions = "\r\n[Extensions]\r\n2.5.29.17 = \"{text}" + strings.Join(parts, "&") + "\"\r\n"
	}
	return fmt.Sprintf("[Version]\r\nSignature=\"$Windows NT$\"\r\n[NewRequest]\r\nSubject=\"CN=%s\"\r\nKeyLength=3072\r\nExportable=FALSE\r\nMachineKeySet=TRUE\r\nProviderName=\"Microsoft Software Key Storage Provider\"\r\nKeyContainer=\"%s\"\r\nRequestType=PKCS10\r\nKeyUsage=0xa0\r\nHashAlgorithm=sha256\r\n%s", strings.ReplaceAll(commonName, "\"", ""), container, extensions)
}

func newWindowsKeyContainer() (string, error) {
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		return "", err
	}
	return "GCAC-" + hex.EncodeToString(random), nil
}

func csrPublicKeyFingerprint(data []byte) (string, error) {
	block, _ := pem.Decode(data)
	if block == nil {
		return "", errors.New("CSR PEM is invalid")
	}
	request, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil {
		return "", err
	}
	if err := request.CheckSignature(); err != nil {
		return "", err
	}
	der, err := x509.MarshalPKIXPublicKey(request.PublicKey)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(der)
	return hex.EncodeToString(sum[:]), nil
}

func certificatePublicKeyFingerprint(data []byte) (string, string, error) {
	block, _ := pem.Decode(data)
	if block == nil {
		return "", "", errors.New("certificate PEM is invalid")
	}
	certificate, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return "", "", err
	}
	der, err := x509.MarshalPKIXPublicKey(certificate.PublicKey)
	if err != nil {
		return "", "", err
	}
	publicSum := sha256.Sum256(der)
	certificateSum := sha256.Sum256(certificate.Raw)
	return hex.EncodeToString(publicSum[:]), strings.ToUpper(hex.EncodeToString(certificateSum[:])), nil
}

func parseWindowsLocalKeyRef(value string) (string, string, error) {
	parts := strings.Split(value, ":")
	if len(parts) != 3 || parts[0] != "cng" || parts[1] == "" || len(parts[2]) != 64 {
		return "", "", errors.New("localKeyRef is invalid")
	}
	return parts[1], parts[2], nil
}

func windowsStringSlice(payload map[string]any, key string) []string {
	values, _ := payload[key].([]any)
	result := make([]string, 0, len(values))
	for _, value := range values {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			result = append(result, strings.TrimSpace(text))
		}
	}
	if direct, ok := payload[key].([]string); ok {
		return direct
	}
	return result
}

func windowsCertificateActionError(code string, err error) actionExecutionResult {
	return actionExecutionResult{Success: false, ErrorCode: code, ErrorMessage: err.Error()}
}
