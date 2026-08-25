package main

import (
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLocalKeyGenerateAndIssuedCertificateInstall(t *testing.T) {
	directory := t.TempDir()
	keyPath := filepath.Join(directory, "private.key.pem")
	certificatePath := filepath.Join(directory, "certificate.pem")
	plan := agentPlanV2{AgentID: "agent-linux-1"}
	operation := agentPlanAction{OperationType: "key.generate_csr", Input: map[string]any{
		"path": keyPath, "targetId": "target-1", "commonName": "app.example.com", "sans": []any{"app.example.com"}, "algorithm": "rsa", "storageMode": "file_pem",
	}}
	first, err := executeLocalKeyGenerate(t.Context(), plan, operation)
	if err != nil {
		t.Fatal(err)
	}
	second, err := executeLocalKeyGenerate(t.Context(), plan, operation)
	if err != nil {
		t.Fatal(err)
	}
	if second["alreadyCurrent"] != true || first["localKeyRef"] != second["localKeyRef"] {
		t.Fatalf("CSR 重复调用未保持幂等：first=%v second=%v", first, second)
	}
	keyBytes, err := os.ReadFile(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	key, err := parseLinuxSigner(keyBytes)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	certificateDer, err := x509.CreateCertificate(rand.Reader, &x509.Certificate{
		SerialNumber:          newSerialNumber(t),
		Subject:               pkix.Name{CommonName: "app.example.com"},
		DNSNames:              []string{"app.example.com"},
		NotBefore:             now.Add(-time.Minute),
		NotAfter:              now.Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}, &x509.Certificate{SerialNumber: newSerialNumber(t), Subject: pkix.Name{CommonName: "Test Issuer"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(48 * time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}, key.Public(), key)
	if err != nil {
		t.Fatal(err)
	}
	certificatePem := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: certificateDer}))
	install := agentPlanAction{OperationType: "certificate.install_issued", Input: map[string]any{
		"path": certificatePath, "keyPath": keyPath, "targetId": "target-1", "localKeyRef": first["localKeyRef"],
		"expectedPublicKeyFingerprintSha256": first["publicKeyFingerprintSha256"], "certificatePem": certificatePem, "certificateChainPem": certificatePem,
		"format": "pem", "storageMode": "file_pem",
	}}
	result, err := executeIssuedCertificateInstall(t.Context(), plan, install)
	if err != nil {
		t.Fatal(err)
	}
	if result["privateKeyTransported"] != false {
		t.Fatalf("Receipt 暴露了私钥传输状态：%v", result)
	}
	bad := install
	bad.Input = cloneInput(install.Input)
	bad.Input["expectedPublicKeyFingerprintSha256"] = strings.Repeat("0", 64)
	if _, err := executeIssuedCertificateInstall(t.Context(), plan, bad); err == nil {
		t.Fatal("公钥不匹配时应拒绝证书导入")
	}
}

func newSerialNumber(t *testing.T) *big.Int {
	t.Helper()
	return big.NewInt(int64(time.Now().UnixNano()))
}

func cloneInput(input map[string]any) map[string]any {
	copy := make(map[string]any, len(input))
	for key, value := range input {
		copy[key] = value
	}
	return copy
}
