package main

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

// IIS 的 CNG 路径把密钥留在 LocalMachine KSP；文件 PEM 路径仅保留既有兼容部署能力。
func validateLocalKeyGenerateInput(input map[string]any) error {
	path := v2StringValue(input, "path")
	if path == "" || !filepath.IsAbs(path) || v2StringValue(input, "targetId") == "" || v2StringValue(input, "commonName") == "" {
		return errors.New("key.generate_csr requires an absolute path, targetId and commonName")
	}
	if _, err := stringArrayValue(input, "sans"); err != nil {
		return errors.New("key.generate_csr sans must be an array")
	}
	if algorithm := v2StringValue(input, "algorithm"); algorithm != "rsa" && algorithm != "ec" {
		return errors.New("key.generate_csr algorithm must be rsa or ec")
	}
	if mode := v2StringValue(input, "storageMode"); mode != "" && mode != "file_pem" && mode != "windows_cng" {
		return errors.New("key.generate_csr storageMode is invalid")
	}
	return nil
}

func executeLocalKeyGenerate(ctx context.Context, plan agentPlanV2, operation agentPlanAction) (map[string]any, error) {
	if err := validateLocalKeyGenerateInput(operation.Input); err != nil {
		return nil, err
	}
	path := filepath.Clean(v2StringValue(operation.Input, "path"))
	sans, _ := stringArrayValue(operation.Input, "sans")
	if v2StringValue(operation.Input, "storageMode") == "windows_cng" {
		return createWindowsCngCsr(ctx, plan, path, v2StringValue(operation.Input, "commonName"), sans, v2StringValue(operation.Input, "algorithm"))
	}
	privateKey, alreadyCurrent, err := loadOrGenerateWindowsFileKey(path, v2StringValue(operation.Input, "algorithm"), operation.Input)
	if err != nil {
		return nil, err
	}
	csrPem, publicKeyFingerprint, err := createWindowsCsr(privateKey, v2StringValue(operation.Input, "commonName"), sans)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"localKeyRef":                windowsLocalKeyRef(plan.AgentID, "file_pem", path, publicKeyFingerprint),
		"csrPem":                     string(csrPem),
		"csrSha256":                  windowsSha256Hex(csrPem),
		"publicKeyFingerprintSha256": publicKeyFingerprint,
		"protectionLevel":            "software_controlled",
		"keyBackend":                 "file",
		"exportability":              "exportable",
		"keyStoragePath":             path,
		"alreadyCurrent":             alreadyCurrent,
		"privateKeyTransported":      false,
	}, agentContextError(ctx)
}

func validateIssuedCertificateInstallInput(input map[string]any) error {
	path := v2StringValue(input, "path")
	keyPath := v2StringValue(input, "keyPath")
	if path == "" || !filepath.IsAbs(path) || keyPath == "" || !filepath.IsAbs(keyPath) {
		return errors.New("certificate.install_issued requires absolute path and keyPath")
	}
	if v2StringValue(input, "targetId") == "" || v2StringValue(input, "localKeyRef") == "" || v2StringValue(input, "expectedPublicKeyFingerprintSha256") == "" {
		return errors.New("certificate.install_issued requires targetId, localKeyRef and expected public key fingerprint")
	}
	if !strings.Contains(v2StringValue(input, "certificatePem"), "BEGIN CERTIFICATE") || !strings.Contains(v2StringValue(input, "certificateChainPem"), "BEGIN CERTIFICATE") {
		return errors.New("certificate.install_issued requires certificate PEM and chain PEM")
	}
	if format := v2StringValue(input, "format"); format != "pem" && format != "pkcs12" && format != "jks" {
		return errors.New("certificate.install_issued format must be pem, pkcs12 or jks")
	}
	if mode := v2StringValue(input, "storageMode"); mode != "" && mode != "file_pem" && mode != "windows_cng" {
		return errors.New("certificate.install_issued storageMode is invalid")
	}
	return nil
}

func executeIssuedCertificateInstall(ctx context.Context, plan agentPlanV2, operation agentPlanAction) (map[string]any, error) {
	if err := validateIssuedCertificateInstallInput(operation.Input); err != nil {
		return nil, err
	}
	leaf, chain, err := parseWindowsCertificateChain(v2StringValue(operation.Input, "certificatePem"), v2StringValue(operation.Input, "certificateChainPem"))
	if err != nil {
		return nil, err
	}
	publicKeyFingerprint, err := windowsPublicKeyFingerprint(leaf.PublicKey)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(publicKeyFingerprint, v2StringValue(operation.Input, "expectedPublicKeyFingerprintSha256")) {
		return nil, errors.New("issued certificate public key does not match expected key")
	}
	path := filepath.Clean(v2StringValue(operation.Input, "path"))
	keyPath := filepath.Clean(v2StringValue(operation.Input, "keyPath"))
	storageMode := v2StringValue(operation.Input, "storageMode")
	if storageMode == "windows_cng" {
		return installWindowsCngCertificate(ctx, plan, operation, leaf, publicKeyFingerprint, path, keyPath)
	}
	privateKey, err := loadWindowsFileKey(keyPath)
	if err != nil {
		return nil, err
	}
	localKeyRef := windowsLocalKeyRef(plan.AgentID, "file_pem", keyPath, publicKeyFingerprint)
	if v2StringValue(operation.Input, "localKeyRef") != localKeyRef {
		return nil, errors.New("certificate localKeyRef does not belong to this Agent key")
	}
	format := v2StringValue(operation.Input, "format")
	if format == "jks" {
		return nil, errors.New("windows certificate.install_issued does not support JKS; use the Linux Tomcat Agent path")
	}
	if format == "pem" {
		if err := atomicWriteFile(path, []byte(windowsAppendPemChain(v2StringValue(operation.Input, "certificatePem"), v2StringValue(operation.Input, "certificateChainPem"))), 0o644); err != nil {
			return nil, err
		}
	} else {
		content, err := pkcs12.Modern2023.Encode(privateKey, leaf, chain, "changeit")
		if err != nil {
			return nil, fmt.Errorf("PKCS12 生成失败: %w", err)
		}
		if err := atomicWriteFile(path, content, 0o600); err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"localKeyRef":                  localKeyRef,
		"certificateFingerprintSha256": windowsSha256Hex(leaf.Raw),
		"publicKeyFingerprintSha256":   publicKeyFingerprint,
		"format":                       format,
		"storagePath":                  path,
		"protectionLevel":              "software_controlled",
		"privateKeyTransported":        false,
	}, agentContextError(ctx)
}

func createWindowsCngCsr(ctx context.Context, plan agentPlanV2, csrPath, commonName string, sans []string, algorithm string) (map[string]any, error) {
	if err := os.MkdirAll(filepath.Dir(csrPath), 0o700); err != nil {
		return nil, err
	}
	if content, err := os.ReadFile(csrPath); err == nil {
		request, parseErr := parseWindowsCsr(content)
		if parseErr != nil {
			return nil, parseErr
		}
		fingerprint, fingerprintErr := windowsPublicKeyFingerprint(request.PublicKey)
		if fingerprintErr != nil {
			return nil, fingerprintErr
		}
		return windowsCngCsrResult(plan.AgentID, csrPath, content, fingerprint, true), nil
	}
	infPath := csrPath + ".inf"
	inf := windowsCertreqInf(commonName, sans, algorithm)
	if err := atomicWriteFile(infPath, []byte(inf), 0o600); err != nil {
		return nil, err
	}
	defer os.Remove(infPath)
	command := exec.CommandContext(ctx, "certreq.exe", "-new", infPath, csrPath)
	if output, err := command.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("certreq -new failed: %s", strings.TrimSpace(string(output)))
	}
	content, err := os.ReadFile(csrPath)
	if err != nil {
		return nil, err
	}
	request, err := parseWindowsCsr(content)
	if err != nil {
		return nil, err
	}
	fingerprint, err := windowsPublicKeyFingerprint(request.PublicKey)
	if err != nil {
		return nil, err
	}
	return windowsCngCsrResult(plan.AgentID, csrPath, content, fingerprint, false), nil
}

func windowsCngCsrResult(agentID, csrPath string, csrPem []byte, fingerprint string, alreadyCurrent bool) map[string]any {
	return map[string]any{
		"localKeyRef":                windowsLocalKeyRef(agentID, "windows_cng", csrPath, fingerprint),
		"csrPem":                     string(csrPem),
		"csrSha256":                  windowsSha256Hex(csrPem),
		"publicKeyFingerprintSha256": fingerprint,
		"protectionLevel":            "os_protected",
		"keyBackend":                 "cng",
		"exportability":              "non_exportable",
		"keyStoragePath":             "Cert:\\LocalMachine\\My",
		"alreadyCurrent":             alreadyCurrent,
		"privateKeyTransported":      false,
	}
}

func installWindowsCngCertificate(ctx context.Context, plan agentPlanV2, operation agentPlanAction, leaf *x509.Certificate, fingerprint, certificatePath, csrPath string) (map[string]any, error) {
	if v2StringValue(operation.Input, "format") != "pem" {
		return nil, errors.New("windows_cng certificate installation only accepts PEM certificate material")
	}
	if v2StringValue(operation.Input, "localKeyRef") != windowsLocalKeyRef(plan.AgentID, "windows_cng", csrPath, fingerprint) {
		return nil, errors.New("certificate localKeyRef does not belong to this Agent CNG key")
	}
	if err := atomicWriteFile(certificatePath, []byte(windowsAppendPemChain(v2StringValue(operation.Input, "certificatePem"), v2StringValue(operation.Input, "certificateChainPem"))), 0o600); err != nil {
		return nil, err
	}
	command := exec.CommandContext(ctx, "certreq.exe", "-accept", certificatePath)
	if output, err := command.CombinedOutput(); err != nil {
		return nil, fmt.Errorf("certreq -accept failed: %s", strings.TrimSpace(string(output)))
	}
	thumbprint := windowsSha1Hex(leaf.Raw)
	return map[string]any{
		"localKeyRef":                  v2StringValue(operation.Input, "localKeyRef"),
		"certificateFingerprintSha256": windowsSha256Hex(leaf.Raw),
		"publicKeyFingerprintSha256":   fingerprint,
		"certificateThumbprint":        thumbprint,
		"storeName":                    "My",
		"storeLocation":                "LocalMachine",
		"protectionLevel":              "os_protected",
		"exportability":                "non_exportable",
		"privateKeyTransported":        false,
	}, agentContextError(ctx)
}

func loadOrGenerateWindowsFileKey(path, algorithm string, input map[string]any) (crypto.Signer, bool, error) {
	if content, err := os.ReadFile(path); err == nil {
		key, err := parseWindowsSigner(content)
		return key, true, err
	} else if !os.IsNotExist(err) {
		return nil, false, err
	}
	var key crypto.Signer
	var err error
	if algorithm == "ec" {
		key, err = ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	} else {
		bits := 2048
		if raw, ok := input["rsaBits"].(float64); ok && raw >= 2048 && raw <= 8192 {
			bits = int(raw)
		}
		key, err = rsa.GenerateKey(rand.Reader, bits)
	}
	if err != nil {
		return nil, false, err
	}
	encoded, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, false, err
	}
	if err := atomicWriteFile(path, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: encoded}), 0o600); err != nil {
		return nil, false, err
	}
	return key, false, nil
}

func loadWindowsFileKey(path string) (crypto.Signer, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return parseWindowsSigner(content)
}

func parseWindowsSigner(content []byte) (crypto.Signer, error) {
	block, _ := pem.Decode(content)
	if block == nil {
		return nil, errors.New("local key PEM is invalid")
	}
	if value, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		if key, ok := value.(crypto.Signer); ok {
			return key, nil
		}
	}
	if key, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	if key, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
		return key, nil
	}
	return nil, errors.New("local key PEM does not contain a supported private key")
}

func createWindowsCsr(key crypto.Signer, commonName string, sans []string) ([]byte, string, error) {
	template := &x509.CertificateRequest{Subject: pkix.Name{CommonName: commonName}}
	for _, value := range sans {
		value = strings.TrimSpace(value)
		if address := net.ParseIP(value); address != nil {
			template.IPAddresses = append(template.IPAddresses, address)
		} else if value != "" {
			template.DNSNames = append(template.DNSNames, value)
		}
	}
	der, err := x509.CreateCertificateRequest(rand.Reader, template, key)
	if err != nil {
		return nil, "", err
	}
	fingerprint, err := windowsPublicKeyFingerprint(key.Public())
	if err != nil {
		return nil, "", err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: der}), fingerprint, nil
}

func parseWindowsCsr(content []byte) (*x509.CertificateRequest, error) {
	block, _ := pem.Decode(content)
	if block == nil {
		return nil, errors.New("CSR PEM is invalid")
	}
	request, err := x509.ParseCertificateRequest(block.Bytes)
	if err != nil || request.CheckSignature() != nil {
		return nil, errors.New("CSR signature is invalid")
	}
	return request, nil
}

func parseWindowsCertificateChain(certificatePem, chainPem string) (*x509.Certificate, []*x509.Certificate, error) {
	leafs, err := allWindowsCertificates(certificatePem)
	if err != nil || len(leafs) == 0 {
		return nil, nil, errors.New("certificate PEM is invalid")
	}
	all, err := allWindowsCertificates(chainPem)
	if err != nil {
		return nil, nil, err
	}
	chain := make([]*x509.Certificate, 0, len(all))
	for _, certificate := range all {
		if string(certificate.Raw) != string(leafs[0].Raw) {
			chain = append(chain, certificate)
		}
	}
	return leafs[0], chain, nil
}

func allWindowsCertificates(value string) ([]*x509.Certificate, error) {
	remaining := []byte(value)
	certificates := make([]*x509.Certificate, 0, 2)
	for {
		block, rest := pem.Decode(remaining)
		if block == nil {
			if strings.TrimSpace(string(remaining)) != "" {
				return nil, errors.New("certificate PEM contains invalid data")
			}
			break
		}
		remaining = rest
		if block.Type != "CERTIFICATE" {
			return nil, errors.New("certificate chain contains a non-certificate PEM block")
		}
		certificate, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			return nil, err
		}
		certificates = append(certificates, certificate)
	}
	if len(certificates) == 0 {
		return nil, errors.New("certificate chain is empty")
	}
	return certificates, nil
}

func windowsCertreqInf(commonName string, sans []string, algorithm string) string {
	keyAlgorithm := "RSA"
	keyLength := "2048"
	if algorithm == "ec" {
		keyAlgorithm = "ECDSA_P256"
		keyLength = "256"
	}
	subjectAlternativeNames := make([]string, 0, len(sans))
	for _, value := range sans {
		if address := net.ParseIP(strings.TrimSpace(value)); address != nil {
			subjectAlternativeNames = append(subjectAlternativeNames, "IPAddress="+address.String())
		} else if value = strings.TrimSpace(value); value != "" {
			subjectAlternativeNames = append(subjectAlternativeNames, "DNS="+value)
		}
	}
	inf := "[Version]\nSignature=\"$Windows NT$\"\n[NewRequest]\nSubject = \"CN=" + windowsInfEscape(commonName) + "\"\nKeyAlgorithm = " + keyAlgorithm + "\nKeyLength = " + keyLength + "\nMachineKeySet = TRUE\nExportable = FALSE\nProviderName = \"Microsoft Software Key Storage Provider\"\nRequestType = PKCS10\nKeyUsage = 0xa0\n"
	if len(subjectAlternativeNames) > 0 {
		inf += "[Extensions]\n2.5.29.17 = \"{text}\"\n_continue_ = \"" + strings.Join(subjectAlternativeNames, "&") + "\"\n"
	}
	return inf
}

func windowsInfEscape(value string) string {
	return strings.NewReplacer("\r", " ", "\n", " ", "\"", "'").Replace(value)
}

func windowsPublicKeyFingerprint(publicKey any) (string, error) {
	der, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		return "", err
	}
	return windowsSha256Hex(der), nil
}

func windowsLocalKeyRef(agentID, storageMode, path, fingerprint string) string {
	return "local-key:" + windowsSha256Hex([]byte(agentID+"|"+storageMode+"|"+filepath.Clean(path)+"|"+strings.ToLower(fingerprint)))
}

func windowsSha256Hex(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func windowsSha1Hex(value []byte) string {
	digest := sha1.Sum(value)
	return strings.ToUpper(hex.EncodeToString(digest[:]))
}

func windowsAppendPemChain(certificatePem, chainPem string) string {
	return strings.TrimSpace(certificatePem) + "\n" + strings.TrimSpace(chainPem) + "\n"
}
