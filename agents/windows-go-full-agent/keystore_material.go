package main

import (
	"bytes"
	"crypto"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"regexp"
	"strings"

	keystore "github.com/pavlo-v-chernykh/keystore-go/v4"
	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

type windowsKeyStoreMaterialDetails struct {
	Format                 string
	Alias                  string
	CertificateCount       int
	CertificateFingerprint string
	CertificatePublicKey   []byte
	PrivateKeyPublicKey    []byte
	AliasVerified          bool
}

func validateWindowsKeyStoreMaterial(input map[string]any, path string, content []byte) (windowsKeyStoreMaterialDetails, error) {
	keystoreType := strings.ToUpper(strings.TrimSpace(stringValue(input, "keystoreType")))
	if keystoreType != "JKS" && keystoreType != "PKCS12" {
		return windowsKeyStoreMaterialDetails{}, errors.New("KeyStore 类型必须是 JKS 或 PKCS12")
	}
	alias := strings.TrimSpace(stringValue(input, "keyAlias"))
	if alias == "" {
		return windowsKeyStoreMaterialDetails{}, errors.New("KeyStore 必须提供 keyAlias")
	}
	password, err := resolveWindowsKeyStorePassword(input)
	if err != nil {
		return windowsKeyStoreMaterialDetails{}, err
	}
	if keystoreType == "JKS" {
		return parseWindowsJKSKeyStore(content, password, alias)
	}
	return parseWindowsPKCS12KeyStore(content, password, alias)
}

func resolveWindowsKeyStorePassword(input map[string]any) (string, error) {
	if password := stringValue(input, "keystorePassword"); password != "" {
		return password, nil
	}
	configPath := stringValue(input, "configPath")
	if configPath == "" {
		return "", errors.New("KeyStore 密码不可用：需要 keystorePassword 或 configPath")
	}
	if !isSafeWindowsAbsolutePath(configPath) {
		return "", errors.New("Tomcat configPath 必须是安全绝对路径")
	}
	content, err := os.ReadFile(configPath)
	if err != nil {
		return "", errors.New("Tomcat 配置不可读，无法取得 KeyStore 密码")
	}
	passwords := extractWindowsTomcatKeystorePasswords(string(content))
	if len(passwords) == 0 {
		return "", errors.New("Tomcat 配置未声明 KeyStore 密码")
	}
	return passwords[0], nil
}

func parseWindowsJKSKeyStore(content []byte, password, alias string) (windowsKeyStoreMaterialDetails, error) {
	store := keystore.New()
	if err := store.Load(bytes.NewReader(content), []byte(password)); err != nil {
		return windowsKeyStoreMaterialDetails{}, errors.New("JKS 解析失败：密码错误或文件损坏")
	}
	if !store.IsPrivateKeyEntry(alias) {
		for _, candidate := range store.Aliases() {
			if strings.EqualFold(candidate, alias) {
				return windowsKeyStoreMaterialDetails{}, errors.New("JKS alias 不包含私钥条目")
			}
		}
		return windowsKeyStoreMaterialDetails{}, errors.New("JKS alias 不存在")
	}
	chain, err := store.GetPrivateKeyEntryCertificateChain(alias)
	if err != nil || len(chain) == 0 {
		return windowsKeyStoreMaterialDetails{}, errors.New("JKS 私钥条目不包含证书链")
	}
	entry, err := store.GetPrivateKeyEntry(alias, []byte(password))
	if err != nil {
		return windowsKeyStoreMaterialDetails{}, errors.New("JKS 私钥解密失败：密码错误或私钥损坏")
	}
	privateKey, err := parseWindowsKeyStorePrivateKey(entry.PrivateKey)
	if err != nil {
		return windowsKeyStoreMaterialDetails{}, errors.New("JKS 私钥条目无法解析")
	}
	privatePublicKey, err := marshalWindowsPrivatePublicKey(privateKey)
	if err != nil {
		return windowsKeyStoreMaterialDetails{}, errors.New("JKS 私钥公钥无法计算")
	}
	details := windowsKeyStoreMaterialDetails{
		Format:              "JKS",
		Alias:               alias,
		CertificateCount:    len(chain),
		AliasVerified:       true,
		PrivateKeyPublicKey: privatePublicKey,
	}
	for index, certificate := range chain {
		parsed, parseErr := x509.ParseCertificate(certificate.Content)
		if parseErr != nil {
			return windowsKeyStoreMaterialDetails{}, fmt.Errorf("JKS 证书链第 %d 项无法解析", index+1)
		}
		if index == 0 {
			details.CertificatePublicKey, err = marshalWindowsPublicKey(parsed.PublicKey)
			if err != nil {
				return windowsKeyStoreMaterialDetails{}, errors.New("JKS 叶子证书公钥无法计算")
			}
			fingerprint := sha256.Sum256(parsed.Raw)
			details.CertificateFingerprint = hex.EncodeToString(fingerprint[:])
		}
	}
	if !bytes.Equal(details.CertificatePublicKey, details.PrivateKeyPublicKey) {
		return windowsKeyStoreMaterialDetails{}, errors.New("证书与私钥公钥不匹配")
	}
	return details, nil
}

func parseWindowsPKCS12KeyStore(content []byte, password, alias string) (windowsKeyStoreMaterialDetails, error) {
	privateKey, leaf, chain, err := pkcs12.DecodeChain(content, password)
	if err != nil || leaf == nil {
		return windowsKeyStoreMaterialDetails{}, errors.New("PKCS12 解析失败：密码错误或文件损坏")
	}
	privatePublicKey, err := marshalWindowsPrivatePublicKey(privateKey)
	if err != nil {
		return windowsKeyStoreMaterialDetails{}, errors.New("PKCS12 私钥无法解析")
	}
	certificatePublicKey, err := marshalWindowsPublicKey(leaf.PublicKey)
	if err != nil {
		return windowsKeyStoreMaterialDetails{}, errors.New("PKCS12 叶子证书公钥无法计算")
	}
	aliasVerified := false
	blocks, pemErr := pkcs12.ToPEM(content, password)
	if pemErr == nil {
		friendlyNames := make([]string, 0, len(blocks))
		for _, block := range blocks {
			if block == nil {
				continue
			}
			if name := strings.TrimSpace(block.Headers["friendlyName"]); name != "" {
				friendlyNames = append(friendlyNames, name)
			}
		}
		if len(friendlyNames) > 0 {
			for _, name := range friendlyNames {
				if strings.EqualFold(name, alias) {
					aliasVerified = true
					break
				}
			}
			if !aliasVerified {
				return windowsKeyStoreMaterialDetails{}, errors.New("PKCS12 alias 不存在")
			}
		}
	}
	if !bytes.Equal(certificatePublicKey, privatePublicKey) {
		return windowsKeyStoreMaterialDetails{}, errors.New("证书与私钥公钥不匹配")
	}
	fingerprint := sha256.Sum256(leaf.Raw)
	return windowsKeyStoreMaterialDetails{
		Format:                 "PKCS12",
		Alias:                  alias,
		CertificateCount:       len(chain) + 1,
		CertificateFingerprint: hex.EncodeToString(fingerprint[:]),
		CertificatePublicKey:   certificatePublicKey,
		PrivateKeyPublicKey:    privatePublicKey,
		AliasVerified:          aliasVerified,
	}, nil
}

func parseWindowsKeyStorePrivateKey(content []byte) (crypto.PrivateKey, error) {
	if key, err := x509.ParsePKCS8PrivateKey(content); err == nil {
		return key, nil
	}
	if key, err := x509.ParsePKCS1PrivateKey(content); err == nil {
		return key, nil
	}
	if key, err := x509.ParseECPrivateKey(content); err == nil {
		return key, nil
	}
	return nil, errors.New("unsupported private key")
}

func marshalWindowsPublicKey(publicKey crypto.PublicKey) ([]byte, error) {
	return x509.MarshalPKIXPublicKey(publicKey)
}

func marshalWindowsPrivatePublicKey(privateKey crypto.PrivateKey) ([]byte, error) {
	publicProvider, ok := privateKey.(interface{ Public() crypto.PublicKey })
	if !ok {
		return nil, errors.New("private key does not expose public key")
	}
	return marshalWindowsPublicKey(publicProvider.Public())
}

var windowsTomcatKeystorePasswordPattern = regexp.MustCompile(`(?i)(?:certificateKeystorePassword|keystorePass|keystorePassword)\s*=\s*["']([^"']*)["']`)

func extractWindowsTomcatKeystorePasswords(content string) []string {
	passwords := make([]string, 0, 2)
	for _, match := range windowsTomcatKeystorePasswordPattern.FindAllStringSubmatch(content, -1) {
		if len(match) > 1 && match[1] != "" && !containsString(passwords, match[1]) {
			passwords = append(passwords, match[1])
		}
	}
	return passwords
}
