package main

import (
	"crypto/rand"
	"crypto/rsa"
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
	crossTarget := cloneInput(install.Input)
	crossTarget["targetId"] = "target-2"
	if _, err := executeIssuedCertificateInstall(t.Context(), plan, agentPlanAction{OperationType: "certificate.install_issued", Input: crossTarget}); err == nil {
		t.Fatal("绑定 target-1 的 localKeyRef 不得用于 target-2")
	}
	legacy := cloneInput(install.Input)
	legacy["localKeyRef"] = linuxLegacyLocalKeyRef(plan.AgentID, keyPath, first["publicKeyFingerprintSha256"].(string))
	legacy["path"] = filepath.Join(directory, "legacy-certificate.pem")
	if _, err := executeIssuedCertificateInstall(t.Context(), plan, agentPlanAction{OperationType: "certificate.install_issued", Input: legacy}); err != nil {
		t.Fatalf("旧版未绑定 targetId 的 localKeyRef 应保持安装兼容: %v", err)
	}
}

func TestLinuxKeyStoreInstallRequiresLocalConfigPassword(t *testing.T) {
	base := map[string]any{
		"path":                               filepath.Join(t.TempDir(), "server.p12"),
		"keyPath":                            filepath.Join(t.TempDir(), "private.key.pem"),
		"targetId":                           "target-1",
		"localKeyRef":                        "local-key:" + strings.Repeat("a", 64),
		"expectedPublicKeyFingerprintSha256": strings.Repeat("b", 64),
		"certificatePem":                     "-----BEGIN CERTIFICATE-----\npublic\n-----END CERTIFICATE-----",
		"certificateChainPem":                "-----BEGIN CERTIFICATE-----\nchain\n-----END CERTIFICATE-----",
		"format":                             "pkcs12",
	}
	if err := validateIssuedCertificateInstallInput(base); err == nil {
		t.Fatal("PKCS12 安装缺少本机配置密码来源时必须失败关闭")
	}
	base["configPath"] = filepath.Join(t.TempDir(), "server.xml")
	if err := validateIssuedCertificateInstallInput(base); err != nil {
		t.Fatalf("提供安全 configPath 后输入应通过基础校验: %v", err)
	}
}

func TestLinuxIssuedCertificateInstallBuildsTomcatKeyStores(t *testing.T) {
	directory := t.TempDir()
	keyPath := filepath.Join(directory, "private.key.pem")
	plan := agentPlanV2{AgentID: "agent-linux-tomcat"}
	generated, err := executeLocalKeyGenerate(t.Context(), plan, agentPlanAction{OperationType: "key.generate_csr", Input: map[string]any{
		"path": keyPath, "targetId": "tomcat-target", "commonName": "tomcat.example.test", "sans": []any{"tomcat.example.test"}, "algorithm": "rsa", "storageMode": "file_pem",
	}})
	if err != nil {
		t.Fatal(err)
	}
	keyBytes, err := os.ReadFile(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	privateKey, err := parseLinuxSigner(keyBytes)
	if err != nil {
		t.Fatal(err)
	}
	caKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	caDer, err := x509.CreateCertificate(rand.Reader, &x509.Certificate{
		SerialNumber: newSerialNumber(t), Subject: pkix.Name{CommonName: "Tomcat Test CA"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(48 * time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
	}, &x509.Certificate{SerialNumber: newSerialNumber(t), Subject: pkix.Name{CommonName: "Tomcat Test CA"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(48 * time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	caCert, err := x509.ParseCertificate(caDer)
	if err != nil {
		t.Fatal(err)
	}
	leafDer, err := x509.CreateCertificate(rand.Reader, &x509.Certificate{
		SerialNumber: newSerialNumber(t), Subject: pkix.Name{CommonName: "tomcat.example.test"}, DNSNames: []string{"tomcat.example.test"}, NotBefore: now.Add(-time.Minute), NotAfter: now.Add(24 * time.Hour), KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, BasicConstraintsValid: true,
	}, caCert, privateKey.Public(), caKey)
	if err != nil {
		t.Fatal(err)
	}
	leafCert, err := x509.ParseCertificate(leafDer)
	if err != nil {
		t.Fatal(err)
	}
	leafPem := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafCert.Raw}))
	chainPem := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caCert.Raw}))
	configPath := filepath.Join(directory, "server.xml")
	if err := os.WriteFile(configPath, []byte(`<Connector certificateKeystorePassword="tomcat-pass"/>`), 0o600); err != nil {
		t.Fatal(err)
	}
	fingerprint := generated["publicKeyFingerprintSha256"].(string)
	for _, format := range []string{"pkcs12", "jks"} {
		t.Run(format, func(t *testing.T) {
			path := filepath.Join(directory, format+".keystore")
			result, err := executeIssuedCertificateInstall(t.Context(), plan, agentPlanAction{OperationType: "certificate.install_issued", Input: map[string]any{
				"path": path, "keyPath": keyPath, "targetId": "tomcat-target", "localKeyRef": generated["localKeyRef"], "expectedPublicKeyFingerprintSha256": fingerprint,
				"certificatePem": leafPem, "certificateChainPem": chainPem, "format": format, "alias": "server", "configPath": configPath, "storageMode": "file_pem",
			}})
			if err != nil {
				t.Fatalf("%s 直装必须成功: %v", format, err)
			}
			if result["privateKeyTransported"] != false || result["protectionLevel"] != "software_controlled" {
				t.Fatalf("%s 回执保护字段不正确: %#v", format, result)
			}
			content, err := os.ReadFile(path)
			if err != nil {
				t.Fatal(err)
			}
			material, err := validateLinuxKeyStoreMaterialWithPassword(strings.ToUpper(format), "server", "tomcat-pass", content)
			if err != nil || !material.AliasVerified || material.CertificateCount < 2 {
				t.Fatalf("%s 必须能用 Tomcat 配置密码和 Alias 导入: material=%#v err=%v", format, material, err)
			}
		})
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
