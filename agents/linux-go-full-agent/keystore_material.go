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
	"path/filepath"
	"strings"

	keystore "github.com/pavlo-v-chernykh/keystore-go/v4"
	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

type linuxKeyStoreMaterialDetails struct {
	Format                 string
	Alias                  string
	CertificateCount       int
	CertificateFingerprint string
	CertificatePublicKey   []byte
	PrivateKeyPublicKey    []byte
	AliasVerified          bool
}

func validateLinuxKeyStoreMaterial(input map[string]any, path string, content []byte) (linuxKeyStoreMaterialDetails, error) {
	keystoreType := strings.ToUpper(strings.TrimSpace(v2StringValue(input, "keystoreType")))
	if keystoreType != "JKS" && keystoreType != "PKCS12" {
		return linuxKeyStoreMaterialDetails{}, errors.New("KeyStore 类型必须是 JKS 或 PKCS12")
	}
	alias := strings.TrimSpace(v2StringValue(input, "keyAlias"))
	if alias == "" {
		return linuxKeyStoreMaterialDetails{}, errors.New("KeyStore 必须提供 keyAlias")
	}
	password, err := resolveLinuxKeyStorePassword(input)
	if err != nil {
		return linuxKeyStoreMaterialDetails{}, err
	}
	switch keystoreType {
	case "JKS":
		return parseLinuxJKSKeyStore(content, password, alias)
	default:
		return parseLinuxPKCS12KeyStore(content, password, alias)
	}
}

func resolveLinuxKeyStorePassword(input map[string]any) (string, error) {
	if password := v2StringValue(input, "keystorePassword"); password != "" {
		return password, nil
	}
	configPath := v2StringValue(input, "configPath")
	if configPath == "" {
		return "", errors.New("KeyStore 密码不可用：需要 keystorePassword 或 configPath")
	}
	if !filepath.IsAbs(configPath) || hasParentPathSegment(configPath) {
		return "", errors.New("Tomcat configPath 必须是安全绝对路径")
	}
	content, err := os.ReadFile(configPath)
	if err != nil {
		return "", errors.New("Tomcat 配置不可读，无法取得 KeyStore 密码")
	}
	passwords := webKeystorePasswords(string(content))
	if len(passwords) == 0 {
		return "", errors.New("Tomcat 配置未声明 KeyStore 密码")
	}
	return passwords[0], nil
}

func parseLinuxJKSKeyStore(content []byte, password, alias string) (linuxKeyStoreMaterialDetails, error) {
	store := keystore.New()
	if err := store.Load(bytes.NewReader(content), []byte(password)); err != nil {
		return linuxKeyStoreMaterialDetails{}, errors.New("JKS 解析失败：密码错误或文件损坏")
	}
	if !store.IsPrivateKeyEntry(alias) {
		for _, candidate := range store.Aliases() {
			if strings.EqualFold(candidate, alias) {
				return linuxKeyStoreMaterialDetails{}, errors.New("JKS alias 不包含私钥条目")
			}
		}
		return linuxKeyStoreMaterialDetails{}, errors.New("JKS alias 不存在")
	}
	chain, err := store.GetPrivateKeyEntryCertificateChain(alias)
	if err != nil || len(chain) == 0 {
		return linuxKeyStoreMaterialDetails{}, errors.New("JKS 私钥条目不包含证书链")
	}
	entry, err := store.GetPrivateKeyEntry(alias, []byte(password))
	if err != nil {
		return linuxKeyStoreMaterialDetails{}, errors.New("JKS 私钥解密失败：密码错误或私钥损坏")
	}
	privateKey, err := parseLinuxKeyStorePrivateKey(entry.PrivateKey)
	if err != nil {
		return linuxKeyStoreMaterialDetails{}, errors.New("JKS 私钥条目无法解析")
	}
	privatePublicKey, err := marshalLinuxPrivatePublicKey(privateKey)
	if err != nil {
		return linuxKeyStoreMaterialDetails{}, errors.New("JKS 私钥公钥无法计算")
	}
	details := linuxKeyStoreMaterialDetails{
		Format:              "JKS",
		Alias:               alias,
		CertificateCount:    len(chain),
		AliasVerified:       true,
		PrivateKeyPublicKey: privatePublicKey,
	}
	for index, certificate := range chain {
		parsed, parseErr := x509.ParseCertificate(certificate.Content)
		if parseErr != nil {
			return linuxKeyStoreMaterialDetails{}, fmt.Errorf("JKS 证书链第 %d 项无法解析", index+1)
		}
		if index == 0 {
			details.CertificatePublicKey, err = marshalLinuxPublicKey(parsed.PublicKey)
			if err != nil {
				return linuxKeyStoreMaterialDetails{}, errors.New("JKS 叶子证书公钥无法计算")
			}
			fingerprint := sha256.Sum256(parsed.Raw)
			details.CertificateFingerprint = hex.EncodeToString(fingerprint[:])
		}
	}
	if !bytes.Equal(details.CertificatePublicKey, details.PrivateKeyPublicKey) {
		return linuxKeyStoreMaterialDetails{}, errors.New("证书与私钥公钥不匹配")
	}
	return details, nil
}

func parseLinuxPKCS12KeyStore(content []byte, password, alias string) (linuxKeyStoreMaterialDetails, error) {
	privateKey, leaf, chain, err := pkcs12.DecodeChain(content, password)
	if err != nil || leaf == nil {
		return linuxKeyStoreMaterialDetails{}, errors.New("PKCS12 解析失败：密码错误或文件损坏")
	}
	privatePublicKey, err := marshalLinuxPrivatePublicKey(privateKey)
	if err != nil {
		return linuxKeyStoreMaterialDetails{}, errors.New("PKCS12 私钥无法解析")
	}
	certificatePublicKey, err := marshalLinuxPublicKey(leaf.PublicKey)
	if err != nil {
		return linuxKeyStoreMaterialDetails{}, errors.New("PKCS12 叶子证书公钥无法计算")
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
				return linuxKeyStoreMaterialDetails{}, errors.New("PKCS12 alias 不存在")
			}
		}
	}
	if !bytes.Equal(certificatePublicKey, privatePublicKey) {
		return linuxKeyStoreMaterialDetails{}, errors.New("证书与私钥公钥不匹配")
	}
	fingerprint := sha256.Sum256(leaf.Raw)
	return linuxKeyStoreMaterialDetails{
		Format:                 "PKCS12",
		Alias:                  alias,
		CertificateCount:       len(chain) + 1,
		CertificateFingerprint: hex.EncodeToString(fingerprint[:]),
		CertificatePublicKey:   certificatePublicKey,
		PrivateKeyPublicKey:    privatePublicKey,
		AliasVerified:          aliasVerified,
	}, nil
}

func parseLinuxKeyStorePrivateKey(content []byte) (crypto.PrivateKey, error) {
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
