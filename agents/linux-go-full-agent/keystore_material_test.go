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
	"errors"
	"maps"
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

func TestLinuxCertificateMaterialValidatesJKSAndPKCS12(t *testing.T) {
	leaf, privateKey := newLinuxKeyStoreTestCertificate(t, "tomcat.example.test")
	jks := newLinuxTestJKS(t, privateKey, leaf, "server", "changeit")
	pkcs12Bytes := newLinuxTestPKCS12(t, privateKey, leaf, "server", "changeit")

	for _, testCase := range []struct {
		name    string
		format  string
		content []byte
	}{
		{name: "JKS", format: "JKS", content: jks},
		{name: "PKCS12", format: "PKCS12", content: pkcs12Bytes},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			result, err := executeLinuxKeyStoreMaterialValidation(t, testCase.format, testCase.content, "server", "changeit", "")
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
		result, err := executeLinuxKeyStoreMaterialValidation(t, "JKS", jks, "", "changeit", "")
		if err != nil {
			t.Fatalf("省略 Alias 时应自动发现唯一私钥条目: %v", err)
		}
		if result["keyAlias"] != "server" {
			t.Fatalf("自动发现的 Alias 不正确: %#v", result)
		}
	})
}

func TestLinuxCertificateMaterialRejectsInvalidKeyStoreInputs(t *testing.T) {
	leaf, privateKey := newLinuxKeyStoreTestCertificate(t, "tomcat.example.test")
	otherLeaf, _ := newLinuxKeyStoreTestCertificate(t, "other.example.test")
	jks := newLinuxTestJKS(t, privateKey, leaf, "server", "changeit")
	mismatchedJKS := newLinuxTestJKS(t, privateKey, otherLeaf, "server", "changeit")
	pkcs12Bytes := newLinuxTestPKCS12(t, privateKey, leaf, "server", "changeit")
	mismatchedPKCS12 := newLinuxTestPKCS12(t, privateKey, otherLeaf, "server", "changeit")

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
			_, err := executeLinuxKeyStoreMaterialValidation(t, testCase.format, testCase.content, testCase.alias, testCase.pass, "")
			if err == nil || !strings.Contains(err.Error(), testCase.want) {
				t.Fatalf("必须拒绝 %s: err=%v", testCase.name, err)
			}
			if strings.Contains(err.Error(), "wrong") || strings.Contains(err.Error(), "changeit") {
				t.Fatalf("错误信息不得泄露密码: %v", err)
			}
		})
	}

	t.Run("PKCS12 错误 Alias", func(t *testing.T) {
		p12 := newLinuxTestPKCS12WithOpenSSL(t, privateKey, leaf, "server", "changeit")
		_, err := executeLinuxKeyStoreMaterialValidation(t, "PKCS12", p12, "missing", "changeit", "")
		if err == nil || !strings.Contains(err.Error(), "alias 不存在") {
			t.Fatalf("PKCS12 错误 Alias 必须拒绝: %v", err)
		}
	})
}

func TestLinuxCertificateMaterialReadsTomcatPasswordFromConfigPath(t *testing.T) {
	leaf, privateKey := newLinuxKeyStoreTestCertificate(t, "tomcat.example.test")
	jks := newLinuxTestJKS(t, privateKey, leaf, "server", "changeit")
	configPath := filepath.Join(t.TempDir(), "server.xml")
	if err := os.WriteFile(configPath, []byte(`<Connector certificateKeystorePassword="changeit"/>`), 0o600); err != nil {
		t.Fatal(err)
	}
	result, err := executeLinuxKeyStoreMaterialValidation(t, "JKS", jks, "server", "", configPath)
	if err != nil {
		t.Fatalf("应从 Tomcat server.xml 读取 KeyStore 密码: %v", err)
	}
	if result["aliasVerified"] != true {
		t.Fatalf("从配置读取密码时仍必须完成 Alias/条目校验: %#v", result)
	}
	_, err = executeLinuxKeyStoreMaterialValidation(t, "JKS", jks, "server", "wrong-explicit-password", configPath)
	if err == nil || !strings.Contains(err.Error(), "密码错误或文件损坏") {
		t.Fatalf("显式密码错误时必须优先失败，不能回退到配置自动读取: %v", err)
	}
	if strings.Contains(err.Error(), "wrong-explicit-password") || strings.Contains(err.Error(), "changeit") {
		t.Fatalf("显式密码失败信息不得泄露密码: %v", err)
	}
}

func TestLinuxPKCS12RepackagesSourcePasswordWithTomcatAlias(t *testing.T) {
	leaf, privateKey := newLinuxKeyStoreTestCertificate(t, "tomcat.example.test")
	source := newLinuxTestPKCS12(t, privateKey, leaf, "server", "artifact-password")
	input := map[string]any{
		"path":                   filepath.Join(t.TempDir(), "tomcat.p12"),
		"contentBase64":          base64.StdEncoding.EncodeToString(source),
		"storageKind":            "KEYSTORE",
		"keystoreType":           "PKCS12",
		"keyAlias":               "server",
		"keystorePassword":       "tomcat-current-password",
		"sourceKeyStorePassword": "artifact-password",
	}
	prepared, err := prepareLinuxKeyStoreContent(input, source)
	if err != nil {
		t.Fatalf("P12 源密码与 Tomcat 密码不同时必须可重封装: %v", err)
	}
	material, err := validateLinuxKeyStoreMaterialWithPassword("PKCS12", "server", "tomcat-current-password", prepared)
	if err != nil || !material.AliasVerified {
		t.Fatalf("重封装后的 P12 必须能用目标密码和 Alias 打开: material=%#v err=%v", material, err)
	}
	if _, err := validateLinuxKeyStoreMaterialWithPassword("PKCS12", "server", "artifact-password", prepared); err == nil {
		t.Fatal("重封装后的 P12 不得继续接受源制品密码")
	}
	assertLinuxPKCS12AliasWithKeytool(t, prepared, "tomcat-current-password", "server")
	previous := newLinuxTestPKCS12(t, privateKey, leaf, "server", "tomcat-current-password")
	if err := os.WriteFile(input["path"].(string), previous, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := executeFileReplace(context.Background(), agentPlanAction{OperationID: "replace", OperationType: "filesystem.atomic_replace", Input: input}); err != nil {
		t.Fatalf("P12 原子替换必须重封装并写入: %v", err)
	}
	replaced, err := os.ReadFile(input["path"].(string))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := validateLinuxKeyStoreMaterialWithPassword("PKCS12", "server", "tomcat-current-password", replaced); err != nil {
		t.Fatalf("原子替换后的 P12 必须能被 Tomcat 当前密码读取: %v", err)
	}
	wrongSource := maps.Clone(input)
	wrongSource["sourceKeyStorePassword"] = "wrong-source-password"
	if _, err := prepareLinuxKeyStoreContent(wrongSource, source); err == nil || !strings.Contains(err.Error(), "密码错误或文件损坏") {
		t.Fatalf("错误源制品密码必须在写前失败: %v", err)
	}
}

func assertLinuxPKCS12AliasWithKeytool(t *testing.T, content []byte, password, alias string) {
	t.Helper()
	keytool, err := exec.LookPath("keytool")
	if err != nil {
		t.Skip("当前环境没有 keytool，跳过 Java KeyStore 兼容性校验")
	}
	path := filepath.Join(t.TempDir(), "tomcat.p12")
	if err := os.WriteFile(path, content, 0o600); err != nil {
		t.Fatal(err)
	}
	output, err := exec.Command(keytool, "-list", "-storetype", "PKCS12", "-keystore", path, "-storepass", password, "-alias", alias).CombinedOutput()
	if err != nil {
		// macOS 可能只有 /usr/bin/keytool 包装命令而未安装 JRE；这属于
		// 验证环境缺失，不应把生产实现误报为失败。真正可执行的 keytool
		// 仍然必须通过下面的兼容性校验。
		if strings.Contains(string(output), "Unable to locate a Java Runtime") || strings.Contains(string(output), "No Java runtime present") {
			t.Skip("当前环境没有可用 Java Runtime，跳过 keytool 兼容性校验")
		}
		t.Fatalf("JDK keytool 必须能以目标密码和 Alias 打开重封装 P12: %v: %s", err, strings.TrimSpace(string(output)))
	}
}

func TestLinuxCertificateMaterialPairSkipsKeyStoreBinary(t *testing.T) {
	leaf, privateKey := newLinuxKeyStoreTestCertificate(t, "tomcat.example.test")
	content := newLinuxTestJKS(t, privateKey, leaf, "server", "changeit")
	operations := []agentPlanAction{{
		OperationType: "certificate.material.validate",
		Input: map[string]any{
			"storageKind":   "KEYSTORE",
			"contentBase64": base64.StdEncoding.EncodeToString(content),
			"path":          filepath.Join(t.TempDir(), "tomcat.jks"),
		},
	}}
	if err := validateLinuxCertificateMaterialPair(operations); err != nil {
		t.Fatalf("KEYSTORE 二进制不应进入 PEM 成对校验: %v", err)
	}
}

func TestLinuxCertificateMaterialRejectsPasswordDifferentFromCurrentKeyStore(t *testing.T) {
	leaf, privateKey := newLinuxKeyStoreTestCertificate(t, "tomcat.example.test")
	currentStore := newLinuxTestJKS(t, privateKey, leaf, "server", "current-password")
	newLeaf, newPrivateKey := newLinuxKeyStoreTestCertificate(t, "tomcat-new.example.test")
	newStore := newLinuxTestJKS(t, newPrivateKey, newLeaf, "server", "new-password")
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

func TestLinuxTomcatKeyStoreReplacementRollbackAndReceipt(t *testing.T) {
	leaf, privateKey := newLinuxKeyStoreTestCertificate(t, "tomcat.example.test")
	oldStore := newLinuxTestJKS(t, privateKey, leaf, "server", "changeit")
	newLeaf, newPrivateKey := newLinuxKeyStoreTestCertificate(t, "tomcat-new.example.test")
	newStore := newLinuxTestJKS(t, newPrivateKey, newLeaf, "server", "changeit")
	fixture := newLinuxV2TestFixture(t)
	target := filepath.Join(fixture.Root, "tomcat.keystore")
	if err := os.WriteFile(target, oldStore, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(target, 0o640); err != nil {
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
	receiptPrivate := mustReceiptPrivateKey(t)
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
	if info, err := os.Stat(target); err != nil || info.Mode().Perm() != 0o640 {
		t.Fatalf("替换后必须保留目标权限 0640: info=%v err=%v", info, err)
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
	if info, err := os.Stat(target); err != nil || info.Mode().Perm() != 0o640 {
		t.Fatalf("回滚后必须保留目标权限 0640: info=%v err=%v", info, err)
	}
}

func executeLinuxKeyStoreMaterialValidation(t *testing.T, format string, content []byte, alias, password, configPath string) (map[string]any, error) {
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

func newLinuxKeyStoreTestCertificate(t *testing.T, commonName string) (*x509.Certificate, *rsa.PrivateKey) {
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

func newLinuxTestJKS(t *testing.T, privateKey *rsa.PrivateKey, leaf *x509.Certificate, alias, password string) []byte {
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

func newLinuxTestPKCS12(t *testing.T, privateKey *rsa.PrivateKey, leaf *x509.Certificate, alias, password string) []byte {
	t.Helper()
	content, err := pkcs12.Modern2023.Encode(privateKey, leaf, nil, password)
	if err != nil {
		t.Fatal(err)
	}
	return content
}

func newLinuxTestPKCS12WithOpenSSL(t *testing.T, privateKey *rsa.PrivateKey, leaf *x509.Certificate, alias, password string) []byte {
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

func mustReceiptPrivateKey(t *testing.T) []byte {
	t.Helper()
	encoded := os.Getenv("GCAC_AGENT_RECEIPT_SIGNING_KEY_BASE64")
	value, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil || len(value) == 0 {
		t.Fatal(errors.New("测试 Receipt 签名私钥不可用"))
	}
	return value
}
