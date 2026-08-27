package main

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"encoding/pem"
	"math/big"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	keystore "github.com/pavlo-v-chernykh/keystore-go/v4"
	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

func TestWindowsCertificateMaterialValidatesJKSAndPKCS12(t *testing.T) {
	leaf, privateKey := newWindowsKeyStoreTestCertificate(t, "tomcat.example.test")
	jks := newWindowsTestJKS(t, privateKey, leaf, "server", "changeit")
	pkcs12Bytes := newWindowsTestPKCS12(t, privateKey, leaf, "changeit")

	for _, testCase := range []struct {
		name    string
		format  string
		content []byte
	}{
		{name: "JKS", format: "JKS", content: jks},
		{name: "PKCS12", format: "PKCS12", content: pkcs12Bytes},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			result, err := executeWindowsKeyStoreMaterialValidation(t, testCase.format, testCase.content, "server", "changeit", "")
			if err != nil {
				t.Fatalf("%s 正确密码和 Alias 必须通过: %v", testCase.format, err)
			}
			certificateCount, _ := result["certificateCount"].(int)
			if result["keystoreType"] != testCase.format || result["keyAlias"] != "server" || result["hasPrivateKey"] != true || certificateCount < 1 {
				t.Fatalf("%s 校验结果不完整: %#v", testCase.format, result)
			}
			if result["certificateFingerprintSha256"] == "" {
				t.Fatalf("%s 必须返回证书 SHA-256 指纹: %#v", testCase.format, result)
			}
		})
	}

	t.Run("JKS 自动发现唯一私钥 Alias", func(t *testing.T) {
		result, err := executeWindowsKeyStoreMaterialValidation(t, "JKS", jks, "", "changeit", "")
		if err != nil {
			t.Fatalf("省略 Alias 时应自动发现唯一私钥条目: %v", err)
		}
		if result["keyAlias"] != "server" {
			t.Fatalf("自动发现的 Alias 不正确: %#v", result)
		}
	})
}

func TestWindowsCertificateMaterialRejectsInvalidKeyStoreInputs(t *testing.T) {
	leaf, privateKey := newWindowsKeyStoreTestCertificate(t, "tomcat.example.test")
	otherLeaf, _ := newWindowsKeyStoreTestCertificate(t, "other.example.test")
	jks := newWindowsTestJKS(t, privateKey, leaf, "server", "changeit")
	mismatchedJKS := newWindowsTestJKS(t, privateKey, otherLeaf, "server", "changeit")
	pkcs12Bytes := newWindowsTestPKCS12(t, privateKey, leaf, "changeit")
	mismatchedPKCS12 := newWindowsTestPKCS12(t, privateKey, otherLeaf, "changeit")

	testCases := []struct {
		name    string
		format  string
		content []byte
		alias   string
		pass    string
		want    string
	}{
		{name: "JKS 错误密码", format: "JKS", content: jks, alias: "server", pass: "wrong", want: "密码错误或文件损坏"},
		{name: "JKS 错误 Alias", format: "JKS", content: jks, alias: "missing", pass: "changeit", want: "alias 不存在"},
		{name: "JKS 格式损坏", format: "JKS", content: []byte("not-a-keystore"), alias: "server", pass: "changeit", want: "解析失败"},
		{name: "JKS 证书不匹配", format: "JKS", content: mismatchedJKS, alias: "server", pass: "changeit", want: "公钥不匹配"},
		{name: "PKCS12 错误密码", format: "PKCS12", content: pkcs12Bytes, alias: "server", pass: "wrong", want: "密码错误或文件损坏"},
		{name: "PKCS12 格式损坏", format: "PKCS12", content: []byte("not-a-keystore"), alias: "server", pass: "changeit", want: "解析失败"},
		{name: "PKCS12 证书不匹配", format: "PKCS12", content: mismatchedPKCS12, alias: "server", pass: "changeit", want: "公钥不匹配"},
	}
	for _, testCase := range testCases {
		t.Run(testCase.name, func(t *testing.T) {
			_, err := executeWindowsKeyStoreMaterialValidation(t, testCase.format, testCase.content, testCase.alias, testCase.pass, "")
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("必须拒绝 %s: err=%v", testCase.name, err)
			}
			if strings.Contains(err.Error(), "wrong") || strings.Contains(err.Error(), "changeit") {
				t.Fatalf("错误信息不得泄露密码: %v", err)
			}
		})
	}

	t.Run("PKCS12 错误 Alias", func(t *testing.T) {
		p12 := newWindowsTestPKCS12WithOpenSSL(t, privateKey, leaf, "server", "changeit")
		_, err := executeWindowsKeyStoreMaterialValidation(t, "PKCS12", p12, "missing", "changeit", "")
		if err == nil || !strings.Contains(err.Error(), "alias 不存在") {
			t.Fatalf("PKCS12 错误 Alias 必须拒绝: %v", err)
		}
	})
}

func TestWindowsCertificateMaterialReadsTomcatPasswordFromConfigPath(t *testing.T) {
	leaf, privateKey := newWindowsKeyStoreTestCertificate(t, "tomcat.example.test")
	jks := newWindowsTestJKS(t, privateKey, leaf, "server", "changeit")
	configPath := filepath.Join(t.TempDir(), "server.xml")
	if err := os.WriteFile(configPath, []byte(`<Connector certificateKeystorePassword="changeit"/>`), 0o600); err != nil {
		t.Fatal(err)
	}
	result, err := executeWindowsKeyStoreMaterialValidation(t, "JKS", jks, "server", "", configPath)
	if err != nil {
		t.Fatalf("应从 Tomcat server.xml 读取 KeyStore 密码: %v", err)
	}
	if result["aliasVerified"] != true {
		t.Fatalf("从配置读取密码时仍必须完成 Alias/条目校验: %#v", result)
	}
	_, err = executeWindowsKeyStoreMaterialValidation(t, "JKS", jks, "server", "wrong-explicit-password", configPath)
	if err == nil || !strings.Contains(err.Error(), "密码错误或文件损坏") {
		t.Fatalf("显式密码错误时必须优先失败，不能回退到配置自动读取: %v", err)
	}
	if strings.Contains(err.Error(), "wrong-explicit-password") || strings.Contains(err.Error(), "changeit") {
		t.Fatalf("显式密码失败信息不得泄露密码: %v", err)
	}
}

func TestWindowsCertificateMaterialRejectsPasswordDifferentFromCurrentKeyStore(t *testing.T) {
	leaf, privateKey := newWindowsKeyStoreTestCertificate(t, "tomcat.example.test")
	currentStore := newWindowsTestJKS(t, privateKey, leaf, "server", "current-password")
	newLeaf, newPrivateKey := newWindowsKeyStoreTestCertificate(t, "tomcat-new.example.test")
	newStore := newWindowsTestJKS(t, newPrivateKey, newLeaf, "server", "new-password")
	target := filepath.Join(t.TempDir(), "tomcat.jks")
	if err := os.WriteFile(target, currentStore, 0o600); err != nil {
		t.Fatal(err)
	}
	input := map[string]any{
		"path":                          target,
		"contentBase64":                 base64.StdEncoding.EncodeToString(newStore),
		"storageKind":                   "KEYSTORE",
		"keystoreType":                  "JKS",
		"keyAlias":                      "server",
		"keystorePassword":              "new-password",
		"verifyCurrentKeyStorePassword": true,
	}
	_, err := executeCertificateMaterialValidate(context.Background(), agentPlanAction{
		OperationID: "validate", OperationType: "certificate.material.validate", Stage: "prepare", Input: input,
	})
	if err == nil || !strings.Contains(err.Error(), "当前 KeyStore 密码或格式校验失败") {
		t.Fatalf("目标 KeyStore 当前密码不一致时必须失败关闭: %v", err)
	}
	if strings.Contains(err.Error(), "current-password") || strings.Contains(err.Error(), "new-password") {
		t.Fatalf("密码不应出现在错误信息中: %v", err)
	}
}

func TestWindowsTomcatKeyStoreReplacementRollbackAndReceipt(t *testing.T) {
	leaf, privateKey := newWindowsKeyStoreTestCertificate(t, "tomcat.example.test")
	oldStore := newWindowsTestJKS(t, privateKey, leaf, "server", "changeit")
	newLeaf, newPrivateKey := newWindowsKeyStoreTestCertificate(t, "tomcat-new.example.test")
	newStore := newWindowsTestJKS(t, newPrivateKey, newLeaf, "server", "changeit")
	fixture := newWindowsV2TestFixture(t)
	target := filepath.Join(fixture.Root, "tomcat.keystore")
	if err := os.WriteFile(target, oldStore, 0o600); err != nil {
		t.Fatal(err)
	}
	fixture.Plan.Operations = []agentPlanAction{
		{OperationID: "backup-tomcat", OperationType: "filesystem.backup", Stage: "execute", Input: map[string]any{
			"path": target, "ledgerRef": "execution-recovery-ledger",
		}, IdempotencyKey: "backup-tomcat", TimeoutSeconds: 30},
		{OperationID: "replace-tomcat", OperationType: "filesystem.atomic_replace", Stage: "execute", Input: map[string]any{
			"path": target, "contentBase64": base64.StdEncoding.EncodeToString(newStore),
		}, DependsOn: []string{"backup-tomcat"}, IdempotencyKey: "replace-tomcat", TimeoutSeconds: 30},
	}
	digest, err := computeAgentPlanDigest(fixture.Plan)
	if err != nil {
		t.Fatal(err)
	}
	fixture.Plan.PlanDigest = digest
	fixture.Token.PlanDigest = digest
	receiptPrivate, err := base64.StdEncoding.DecodeString(os.Getenv("GCAC_AGENT_RECEIPT_SIGNING_KEY_BASE64"))
	if err != nil {
		t.Fatal(err)
	}
	success, code, message, detail := executeAgentPlan(context.Background(), fixture.Plan, fixture.Token, agentReceiptSigner{
		KeyID: "agent-receipt-key", PrivateKey: ed25519.PrivateKey(receiptPrivate),
	})
	if !success || code != "" {
		t.Fatalf("Tomcat KeyStore 原子替换应成功: success=%v code=%s message=%s detail=%+v", success, code, message, detail)
	}
	replaced, err := os.ReadFile(target)
	if err != nil || !bytes.Equal(replaced, newStore) {
		t.Fatalf("替换后目标 KeyStore 不正确: err=%v", err)
	}
	receipt, ok := detail["receipt"].(AgentExecutionReceiptV1)
	if !ok || receipt.Status != "SUCCESS" || receipt.Digest == "" {
		t.Fatalf("替换必须生成签名 SUCCESS Receipt: %#v", detail)
	}
	operationResults, ok := detail["operationResults"].([]map[string]any)
	if !ok || len(operationResults) < 1 {
		t.Fatalf("Receipt 必须保留备份操作结果: %#v", detail)
	}
	checkpoint, ok := operationResults[0]["checkpoint"]
	if !ok {
		t.Fatalf("备份结果必须包含回滚 checkpoint: %#v", operationResults[0])
	}
	if _, err := executeFilesystemRestore(context.Background(), agentPlanAction{
		OperationID: "rollback-tomcat", OperationType: "filesystem.restore", Stage: "compensate",
		Input: map[string]any{"path": target, "checkpoint": checkpoint},
	}); err != nil {
		t.Fatalf("Tomcat KeyStore 回滚失败: %v", err)
	}
	restored, err := os.ReadFile(target)
	if err != nil || !bytes.Equal(restored, oldStore) {
		t.Fatalf("回滚后目标 KeyStore 未恢复: err=%v", err)
	}
}

func executeWindowsKeyStoreMaterialValidation(t *testing.T, format string, content []byte, alias, password, configPath string) (map[string]any, error) {
	t.Helper()
	input := map[string]any{
		"path":          filepath.Join(t.TempDir(), strings.ToLower(format)+".keystore"),
		"contentBase64": base64.StdEncoding.EncodeToString(content),
		"storageKind":   "KEYSTORE",
		"keystoreType":  format,
		"keyAlias":      alias,
	}
	if password != "" {
		input["keystorePassword"] = password
	}
	if configPath != "" {
		input["configPath"] = configPath
	}
	return executeCertificateMaterialValidate(context.Background(), agentPlanAction{OperationID: "validate", OperationType: "certificate.material.validate", Stage: "prepare", Input: input})
}

func newWindowsKeyStoreTestCertificate(t *testing.T, commonName string) (*x509.Certificate, *rsa.PrivateKey) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(now.UnixNano()),
		Subject:               pkix.Name{CommonName: commonName},
		DNSNames:              []string{commonName},
		NotBefore:             now.Add(-time.Minute),
		NotAfter:              now.Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &privateKey.PublicKey, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	return certificate, privateKey
}

func newWindowsTestJKS(t *testing.T, privateKey *rsa.PrivateKey, leaf *x509.Certificate, alias, password string) []byte {
	t.Helper()
	privateKeyBytes, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	store := keystore.New()
	if err := store.SetPrivateKeyEntry(alias, keystore.PrivateKeyEntry{
		CreationTime: time.Now(),
		PrivateKey:   privateKeyBytes,
		CertificateChain: []keystore.Certificate{{
			Type: "X509", Content: leaf.Raw,
		}},
	}, []byte(password)); err != nil {
		t.Fatal(err)
	}
	var buffer bytes.Buffer
	if err := store.Store(&buffer, []byte(password)); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func newWindowsTestPKCS12(t *testing.T, privateKey *rsa.PrivateKey, leaf *x509.Certificate, password string) []byte {
	t.Helper()
	content, err := pkcs12.Modern2023.Encode(privateKey, leaf, nil, password)
	if err != nil {
		t.Fatal(err)
	}
	return content
}

func newWindowsTestPKCS12WithOpenSSL(t *testing.T, privateKey *rsa.PrivateKey, leaf *x509.Certificate, alias, password string) []byte {
	t.Helper()
	openssl, err := exec.LookPath("openssl")
	if err != nil {
		t.Skip("当前环境没有 openssl，无法生成带 friendlyName 的 PKCS12 Alias 测试材料")
	}
	root := t.TempDir()
	keyBytes, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "key.pem"), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyBytes}), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "cert.pem"), pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leaf.Raw}), 0o600); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(root, "server.p12")
	command := exec.Command(openssl, "pkcs12", "-export", "-inkey", filepath.Join(root, "key.pem"), "-in", filepath.Join(root, "cert.pem"), "-out", output, "-passout", "pass:"+password, "-name", alias)
	if output, err := command.CombinedOutput(); err != nil {
		t.Skipf("当前 openssl 无法生成 PKCS12 Alias 测试材料: %v: %s", err, strings.TrimSpace(string(output)))
	}
	content, err := os.ReadFile(output)
	if err != nil {
		t.Fatal(err)
	}
	return content
}
