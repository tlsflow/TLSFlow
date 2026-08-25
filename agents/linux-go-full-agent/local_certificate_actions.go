package main

import (
	"bytes"
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
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
	"time"

	keystore "github.com/pavlo-v-chernykh/keystore-go/v4"
	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

// 本地私钥只在 Agent 文件系统创建。控制面最多取得 localKeyRef、CSR 和公开 SPKI 摘要。
func validateLocalKeyGenerateInput(input map[string]any) error {
	path := v2StringValue(input, "path")
	if path == "" || !filepath.IsAbs(path) || v2StringValue(input, "targetId") == "" || v2StringValue(input, "commonName") == "" {
		return errors.New("key.generate_csr requires an absolute path, targetId and commonName")
	}
	if _, err := v2StringArray(input, "sans"); err != nil {
		return errors.New("key.generate_csr sans must be an array")
	}
	algorithm := v2StringValue(input, "algorithm")
	if algorithm != "rsa" && algorithm != "ec" {
		return errors.New("key.generate_csr algorithm must be rsa or ec")
	}
	if mode := v2StringValue(input, "storageMode"); mode != "" && mode != "file_pem" {
		return errors.New("linux key.generate_csr only supports file_pem storageMode")
	}
	return nil
}

func executeLocalKeyGenerate(ctx context.Context, plan agentPlanV2, operation agentPlanAction) (map[string]any, error) {
	if err := validateLocalKeyGenerateInput(operation.Input); err != nil {
		return nil, err
	}
	if err := agentContextError(ctx); err != nil {
		return nil, err
	}
	path := filepath.Clean(v2StringValue(operation.Input, "path"))
	sans, _ := v2StringArray(operation.Input, "sans")
	privateKey, alreadyCurrent, err := loadOrGenerateLinuxPrivateKey(path, v2StringValue(operation.Input, "algorithm"), operation.Input)
	if err != nil {
		return nil, err
	}
	csrPem, publicKeyFingerprint, err := createLinuxCsr(privateKey, v2StringValue(operation.Input, "commonName"), sans)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"localKeyRef":                linuxLocalKeyRef(plan.AgentID, path, publicKeyFingerprint),
		"csrPem":                     string(csrPem),
		"csrSha256":                  sha256Hex(csrPem),
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
	if path == "" || !filepath.IsAbs(path) || v2StringValue(input, "keyPath") == "" || !filepath.IsAbs(v2StringValue(input, "keyPath")) {
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
	if mode := v2StringValue(input, "storageMode"); mode != "" && mode != "file_pem" {
		return errors.New("linux certificate.install_issued only supports file_pem storageMode")
	}
	return nil
}

func executeIssuedCertificateInstall(ctx context.Context, plan agentPlanV2, operation agentPlanAction) (map[string]any, error) {
	if err := validateIssuedCertificateInstallInput(operation.Input); err != nil {
		return nil, err
	}
	if err := agentContextError(ctx); err != nil {
		return nil, err
	}
	keyPath := filepath.Clean(v2StringValue(operation.Input, "keyPath"))
	privateKey, err := loadLinuxPrivateKey(keyPath)
	if err != nil {
		return nil, err
	}
	publicKeyFingerprint, err := linuxPublicKeyFingerprint(privateKey.Public())
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(publicKeyFingerprint, v2StringValue(operation.Input, "expectedPublicKeyFingerprintSha256")) {
		return nil, errors.New("certificate public key does not match the local key reference")
	}
	if v2StringValue(operation.Input, "localKeyRef") != linuxLocalKeyRef(plan.AgentID, keyPath, publicKeyFingerprint) {
		return nil, errors.New("certificate localKeyRef does not belong to this Agent key")
	}
	leaf, chain, err := parseLinuxCertificateChain(v2StringValue(operation.Input, "certificatePem"), v2StringValue(operation.Input, "certificateChainPem"))
	if err != nil {
		return nil, err
	}
	leafPublicKeyFingerprint, err := linuxPublicKeyFingerprint(leaf.PublicKey)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(leafPublicKeyFingerprint, publicKeyFingerprint) {
		return nil, errors.New("issued certificate public key does not match the local private key")
	}
	path := filepath.Clean(v2StringValue(operation.Input, "path"))
	format := v2StringValue(operation.Input, "format")
	certificateContent := appendPemChain(v2StringValue(operation.Input, "certificatePem"), v2StringValue(operation.Input, "certificateChainPem"))
	if format == "pem" {
		if err := atomicWriteFile(path, []byte(certificateContent), 0o644); err != nil {
			return nil, err
		}
	} else if format == "pkcs12" {
		content, err := pkcs12.Modern2023.Encode(privateKey, leaf, chain, "changeit")
		if err != nil {
			return nil, fmt.Errorf("PKCS12 生成失败: %w", err)
		}
		if err := atomicWriteFile(path, content, 0o600); err != nil {
			return nil, err
		}
	} else {
		content, err := encodeLinuxJks(privateKey, leaf, chain, firstNonEmptyLinux(v2StringValue(operation.Input, "alias"), "tomcat"))
		if err != nil {
			return nil, err
		}
		if err := atomicWriteFile(path, content, 0o600); err != nil {
			return nil, err
		}
	}
	return map[string]any{
		"localKeyRef":                  v2StringValue(operation.Input, "localKeyRef"),
		"certificateFingerprintSha256": sha256Hex(leaf.Raw),
		"publicKeyFingerprintSha256":   publicKeyFingerprint,
		"format":                       format,
		"storagePath":                  path,
		"protectionLevel":              "software_controlled",
		"privateKeyTransported":        false,
	}, agentContextError(ctx)
}

func loadOrGenerateLinuxPrivateKey(path, algorithm string, input map[string]any) (crypto.Signer, bool, error) {
	if content, err := os.ReadFile(path); err == nil {
		key, err := parseLinuxSigner(content)
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

func loadLinuxPrivateKey(path string) (crypto.Signer, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return parseLinuxSigner(content)
}

func parseLinuxSigner(content []byte) (crypto.Signer, error) {
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

func createLinuxCsr(key crypto.Signer, commonName string, sans []string) ([]byte, string, error) {
	template := &x509.CertificateRequest{Subject: pkix.Name{CommonName: commonName}}
	for _, value := range sans {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if address := net.ParseIP(value); address != nil {
			template.IPAddresses = append(template.IPAddresses, address)
		} else {
			template.DNSNames = append(template.DNSNames, value)
		}
	}
	der, err := x509.CreateCertificateRequest(rand.Reader, template, key)
	if err != nil {
		return nil, "", err
	}
	fingerprint, err := linuxPublicKeyFingerprint(key.Public())
	if err != nil {
		return nil, "", err
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: der}), fingerprint, nil
}

func parseLinuxCertificateChain(certificatePem, chainPem string) (*x509.Certificate, []*x509.Certificate, error) {
	leaf, err := firstLinuxCertificate(certificatePem)
	if err != nil {
		return nil, nil, err
	}
	all, err := allLinuxCertificates(chainPem)
	if err != nil {
		return nil, nil, err
	}
	chain := make([]*x509.Certificate, 0, len(all))
	for _, certificate := range all {
		if !bytes.Equal(certificate.Raw, leaf.Raw) {
			chain = append(chain, certificate)
		}
	}
	return leaf, chain, nil
}

func firstLinuxCertificate(value string) (*x509.Certificate, error) {
	certificates, err := allLinuxCertificates(value)
	if err != nil || len(certificates) == 0 {
		return nil, errors.New("certificate PEM is invalid")
	}
	return certificates[0], nil
}

func allLinuxCertificates(value string) ([]*x509.Certificate, error) {
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

func encodeLinuxJks(key crypto.Signer, leaf *x509.Certificate, chain []*x509.Certificate, alias string) ([]byte, error) {
	privateKey, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return nil, err
	}
	certificateChain := []keystore.Certificate{{Type: "X509", Content: leaf.Raw}}
	for _, certificate := range chain {
		certificateChain = append(certificateChain, keystore.Certificate{Type: "X509", Content: certificate.Raw})
	}
	store := keystore.New()
	if err := store.SetPrivateKeyEntry(alias, keystore.PrivateKeyEntry{
		CreationTime: time.Now(), PrivateKey: privateKey, CertificateChain: certificateChain,
	}, []byte("changeit")); err != nil {
		return nil, err
	}
	var buffer bytes.Buffer
	if err := store.Store(&buffer, []byte("changeit")); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

func linuxPublicKeyFingerprint(publicKey any) (string, error) {
	der, err := x509.MarshalPKIXPublicKey(publicKey)
	if err != nil {
		return "", err
	}
	return sha256Hex(der), nil
}

func linuxLocalKeyRef(agentID, path, publicKeyFingerprint string) string {
	return "local-key:" + sha256Hex([]byte(agentID+"|"+filepath.Clean(path)+"|"+strings.ToLower(publicKeyFingerprint)))
}

func sha256Hex(value []byte) string {
	digest := sha256.Sum256(value)
	return hex.EncodeToString(digest[:])
}

func appendPemChain(certificatePem, chainPem string) string {
	return strings.TrimSpace(certificatePem) + "\n" + strings.TrimSpace(chainPem) + "\n"
}
