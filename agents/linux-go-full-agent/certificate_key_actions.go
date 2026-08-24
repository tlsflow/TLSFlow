package main

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"

	coreRegistry "gcac/linux-go-full-agent/internal/core/registry"
)

func linuxCreateCertificateCSR(_ context.Context, request coreRegistry.Request) coreRegistry.Result {
	commonName := strings.TrimSpace(stringValue(request.Payload, "commonName"))
	if commonName == "" {
		return linuxCertificateActionError("TASK_PAYLOAD_INVALID", errors.New("commonName is required"))
	}
	keyDirectory := strings.TrimSpace(stringValue(request.Payload, "keyDirectory"))
	if keyDirectory == "" {
		keyDirectory = filepath.Join(os.TempDir(), "gcac-agent-keys")
	}
	if err := os.MkdirAll(keyDirectory, 0o700); err != nil {
		return linuxCertificateActionError("LOCAL_KEY_CREATE_FAILED", err)
	}
	privateKey, err := rsa.GenerateKey(rand.Reader, 3072)
	if err != nil {
		return linuxCertificateActionError("LOCAL_KEY_CREATE_FAILED", err)
	}
	csrTemplate := &x509.CertificateRequest{Subject: pkix.Name{CommonName: commonName}}
	for _, san := range stringSliceValue(request.Payload, "sans") {
		if ip := net.ParseIP(san); ip != nil {
			csrTemplate.IPAddresses = append(csrTemplate.IPAddresses, ip)
		} else {
			csrTemplate.DNSNames = append(csrTemplate.DNSNames, san)
		}
	}
	csrDER, err := x509.CreateCertificateRequest(rand.Reader, csrTemplate, privateKey)
	if err != nil {
		return linuxCertificateActionError("CSR_CREATE_FAILED", err)
	}
	publicDER, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		return linuxCertificateActionError("CSR_CREATE_FAILED", err)
	}
	fingerprint := sha256.Sum256(publicDER)
	localKeyRef := filepath.Join(keyDirectory, fmt.Sprintf("%s-%s.key.pem", sanitizeFilePart(commonName), hex.EncodeToString(fingerprint[:8])))
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey)})
	if err := atomicWriteFile(localKeyRef, keyPEM, 0o600); err != nil {
		return linuxCertificateActionError("LOCAL_KEY_CREATE_FAILED", err)
	}
	return coreRegistry.Result{Success: true, Detail: map[string]any{
		"csrPem":                     string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csrDER})),
		"publicKeyFingerprintSha256": hex.EncodeToString(fingerprint[:]),
		"localKeyRef":                localKeyRef,
		"keyBackend":                 "file",
		"exportability":              "exportable",
		"protectionLevel":            "software_controlled",
		"protectionEvidence": map[string]any{
			"fileMode": "0600", "privateKeyTransported": false, "platform": "linux",
		},
	}}
}

func linuxInstallIssuedCertificate(_ context.Context, request coreRegistry.Request) coreRegistry.Result {
	localKeyRef := strings.TrimSpace(stringValue(request.Payload, "localKeyRef"))
	certificatePEM := strings.TrimSpace(stringValue(request.Payload, "certificatePem"))
	installPath := strings.TrimSpace(stringValue(request.Payload, "installPath"))
	if localKeyRef == "" || certificatePEM == "" || installPath == "" {
		return linuxCertificateActionError("TASK_PAYLOAD_INVALID", errors.New("localKeyRef, certificatePem and installPath are required"))
	}
	keyData, err := os.ReadFile(localKeyRef)
	if err != nil {
		return linuxCertificateActionError("LOCAL_KEY_NOT_FOUND", err)
	}
	privateKey, err := parseRSAPrivateKey(keyData)
	if err != nil {
		return linuxCertificateActionError("LOCAL_KEY_INVALID", err)
	}
	certificate, err := parseCertificate([]byte(certificatePEM))
	if err != nil {
		return linuxCertificateActionError("CERTIFICATE_INVALID", err)
	}
	if !certificateActionPublicKeysEqual(&privateKey.PublicKey, certificate.PublicKey) {
		return linuxCertificateActionError("PUBLIC_KEY_MISMATCH", errors.New("issued certificate public key does not match local private key"))
	}
	chainPEM := strings.TrimSpace(stringValue(request.Payload, "certificateChainPem"))
	content := []byte(certificatePEM + "\n")
	if chainPEM != "" && chainPEM != certificatePEM {
		content = []byte(certificatePEM + "\n" + chainPEM + "\n")
	}
	if err := atomicWriteFile(installPath, content, 0o644); err != nil {
		return linuxCertificateActionError("CERTIFICATE_INSTALL_FAILED", err)
	}
	return coreRegistry.Result{Success: true, Detail: map[string]any{
		"localKeyRef": localKeyRef, "installPath": installPath, "verified": true,
	}}
}

func linuxRetireCertificateKey(_ context.Context, request coreRegistry.Request) coreRegistry.Result {
	localKeyRef := strings.TrimSpace(stringValue(request.Payload, "localKeyRef"))
	if localKeyRef == "" {
		return linuxCertificateActionError("TASK_PAYLOAD_INVALID", errors.New("localKeyRef is required"))
	}
	if err := os.Remove(localKeyRef); err != nil && !errors.Is(err, os.ErrNotExist) {
		return linuxCertificateActionError("LOCAL_KEY_RETIRE_FAILED", err)
	}
	return coreRegistry.Result{Success: true, Detail: map[string]any{"localKeyRef": localKeyRef, "retired": true}}
}

func linuxInstallCertificateTrust(_ context.Context, request coreRegistry.Request) coreRegistry.Result {
	certificatePEM := strings.TrimSpace(stringValue(request.Payload, "certificatePem"))
	trustStorePath := strings.TrimSpace(stringValue(request.Payload, "trustStorePath"))
	if certificatePEM == "" || trustStorePath == "" {
		return linuxCertificateActionError("TASK_PAYLOAD_INVALID", errors.New("certificatePem and trustStorePath are required"))
	}
	certificate, err := parseCertificate([]byte(certificatePEM))
	if err != nil || !certificate.IsCA {
		return linuxCertificateActionError("TRUST_CERTIFICATE_INVALID", errors.New("trust certificate must be a valid CA certificate"))
	}
	backupPath := trustStorePath + ".gcac.bak"
	previous, readErr := os.ReadFile(trustStorePath)
	if readErr == nil {
		if err := atomicWriteFile(backupPath, previous, 0o644); err != nil {
			return linuxCertificateActionError("TRUST_BACKUP_FAILED", err)
		}
	} else if !errors.Is(readErr, os.ErrNotExist) {
		return linuxCertificateActionError("TRUST_BACKUP_FAILED", readErr)
	}
	if err := atomicWriteFile(trustStorePath, []byte(certificatePEM+"\n"), 0o644); err != nil {
		return linuxCertificateActionError("TRUST_INSTALL_FAILED", err)
	}
	installed, err := parseCertificateFile(trustStorePath)
	if err != nil || !installed.Equal(certificate) {
		_ = restoreTrustFile(trustStorePath, backupPath, readErr == nil)
		return linuxCertificateActionError("TRUST_VERIFY_FAILED", errors.New("installed trust certificate verification failed"))
	}
	return coreRegistry.Result{Success: true, Detail: map[string]any{
		"trustStorePath": trustStorePath, "backupPath": backupPath, "hadPrevious": readErr == nil,
		"fingerprintSha256": certificateFingerprint(certificate), "verified": true,
	}}
}

func linuxRollbackCertificateTrust(_ context.Context, request coreRegistry.Request) coreRegistry.Result {
	trustStorePath := strings.TrimSpace(stringValue(request.Payload, "trustStorePath"))
	backupPath := strings.TrimSpace(stringValue(request.Payload, "backupPath"))
	hadPrevious, _ := request.Payload["hadPrevious"].(bool)
	if trustStorePath == "" {
		return linuxCertificateActionError("TASK_PAYLOAD_INVALID", errors.New("trustStorePath is required"))
	}
	if backupPath == "" {
		backupPath = trustStorePath + ".gcac.bak"
	}
	if err := restoreTrustFile(trustStorePath, backupPath, hadPrevious); err != nil {
		return linuxCertificateActionError("TRUST_ROLLBACK_FAILED", err)
	}
	return coreRegistry.Result{Success: true, Detail: map[string]any{"trustStorePath": trustStorePath, "rolledBack": true}}
}

func parseCertificateFile(path string) (*x509.Certificate, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return parseCertificate(content)
}

func certificateFingerprint(certificate *x509.Certificate) string {
	sum := sha256.Sum256(certificate.Raw)
	return hex.EncodeToString(sum[:])
}

func restoreTrustFile(path string, backupPath string, hadPrevious bool) error {
	if !hadPrevious {
		return os.Remove(path)
	}
	content, err := os.ReadFile(backupPath)
	if err != nil {
		return err
	}
	return atomicWriteFile(path, content, 0o644)
}

func atomicWriteFile(path string, content []byte, mode os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".gcac-*")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(mode); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(content); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(temporaryPath, path)
}

func parseRSAPrivateKey(data []byte) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, errors.New("private key PEM is invalid")
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(*rsa.PrivateKey)
	if !ok {
		return nil, errors.New("private key is not RSA")
	}
	return key, nil
}

func parseCertificate(data []byte) (*x509.Certificate, error) {
	block, _ := pem.Decode(data)
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, errors.New("certificate PEM is invalid")
	}
	return x509.ParseCertificate(block.Bytes)
}

func certificateActionPublicKeysEqual(expected *rsa.PublicKey, actual any) bool {
	key, ok := actual.(*rsa.PublicKey)
	return ok && expected.E == key.E && expected.N.Cmp(key.N) == 0
}

func stringValue(payload map[string]any, key string) string {
	value, _ := payload[key].(string)
	return value
}

func stringSliceValue(payload map[string]any, key string) []string {
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

func sanitizeFilePart(value string) string {
	return strings.Map(func(character rune) rune {
		if character >= 'a' && character <= 'z' || character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || character == '-' || character == '_' || character == '.' {
			return character
		}
		return '-'
	}, value)
}

func linuxCertificateActionError(code string, err error) coreRegistry.Result {
	return coreRegistry.Result{ErrorCode: code, ErrorMessage: err.Error()}
}
