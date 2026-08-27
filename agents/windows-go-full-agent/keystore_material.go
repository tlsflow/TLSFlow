package main

import (
	"bytes"
	"crypto"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/hex"
	"errors"
	"fmt"
	"math/big"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode/utf16"

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
	password, err := resolveWindowsKeyStorePassword(input)
	if err != nil {
		return windowsKeyStoreMaterialDetails{}, err
	}
	if keystoreType == "JKS" {
		return parseWindowsJKSKeyStore(content, password, alias)
	}
	return parseWindowsPKCS12KeyStore(content, password, alias)
}

// validateWindowsKeyStoreMaterialWithPassword 只使用调用方已解析的密码校验容器。
// 源制品密码和目标 Tomcat 密码是两个不同的安全对象，不能再让调用方把它们混成同一个字段。
func validateWindowsKeyStoreMaterialWithPassword(keystoreType, alias, password string, content []byte) (windowsKeyStoreMaterialDetails, error) {
	switch strings.ToUpper(strings.TrimSpace(keystoreType)) {
	case "JKS":
		return parseWindowsJKSKeyStore(content, password, alias)
	case "PKCS12":
		return parseWindowsPKCS12KeyStore(content, password, alias)
	default:
		return windowsKeyStoreMaterialDetails{}, errors.New("KeyStore 类型必须是 JKS 或 PKCS12")
	}
}

// prepareWindowsKeyStoreContent 用目标当前密码重封装平台制品。没有 sourceKeyStorePassword
// 的历史计划仍走原有路径；新计划只有在源密码与目标密码不同时才需要本地重封装。
func prepareWindowsKeyStoreContent(input map[string]any, content []byte) ([]byte, error) {
	keystoreType := strings.ToUpper(strings.TrimSpace(stringValue(input, "keystoreType")))
	alias := strings.TrimSpace(stringValue(input, "keyAlias"))
	targetPassword, err := resolveWindowsKeyStorePassword(input)
	if err != nil {
		return nil, err
	}
	sourcePassword := stringValue(input, "sourceKeyStorePassword")
	if sourcePassword == "" {
		// 兼容旧计划：过去的内容被要求直接使用目标密码。
		sourcePassword = targetPassword
	}
	if _, err := validateWindowsKeyStoreMaterialWithPassword(keystoreType, alias, sourcePassword, content); err != nil {
		return nil, err
	}
	if sourcePassword == targetPassword {
		return content, nil
	}
	if keystoreType == "JKS" {
		return repackageWindowsJKS(content, sourcePassword, targetPassword, alias)
	}
	return repackageWindowsPKCS12(content, sourcePassword, targetPassword, alias)
}

func repackageWindowsJKS(content []byte, sourcePassword, targetPassword, alias string) ([]byte, error) {
	store := keystore.New()
	if err := store.Load(bytes.NewReader(content), []byte(sourcePassword)); err != nil {
		return nil, errors.New("JKS 解析失败：密码错误或文件损坏")
	}
	if alias == "" {
		aliases := make([]string, 0, 1)
		for _, candidate := range store.Aliases() {
			if store.IsPrivateKeyEntry(candidate) {
				aliases = append(aliases, candidate)
			}
		}
		if len(aliases) != 1 {
			return nil, errors.New("JKS 包含多个或没有私钥条目，无法自动重封装")
		}
		alias = aliases[0]
	}
	entry, err := store.GetPrivateKeyEntry(alias, []byte(sourcePassword))
	if err != nil {
		return nil, errors.New("JKS 私钥解密失败：密码错误或私钥损坏")
	}
	output := keystore.New()
	entry.CreationTime = time.Now()
	if err := output.SetPrivateKeyEntry(alias, entry, []byte(targetPassword)); err != nil {
		return nil, errors.New("JKS 无法使用目标 Tomcat 密码重封装")
	}
	var buffer bytes.Buffer
	if err := output.Store(&buffer, []byte(targetPassword)); err != nil {
		return nil, errors.New("JKS 重封装失败")
	}
	return buffer.Bytes(), nil
}

func repackageWindowsPKCS12(content []byte, sourcePassword, targetPassword, alias string) ([]byte, error) {
	privateKey, leaf, chain, err := pkcs12.DecodeChain(content, sourcePassword)
	if err != nil || leaf == nil {
		return nil, errors.New("PKCS12 解析失败：密码错误或文件损坏")
	}
	output, err := pkcs12.LegacyDES.WithRand(rand.Reader).Encode(privateKey, leaf, chain, targetPassword)
	if err != nil {
		return nil, errors.New("PKCS12 无法使用目标 Tomcat 密码重封装")
	}
	if alias != "" {
		output, err = setWindowsPKCS12KeyAlias(output, targetPassword, alias)
		if err != nil {
			return nil, errors.New("PKCS12 重封装后无法保留 keyAlias")
		}
	}
	return output, nil
}

var (
	windowsPKCS12DataContentType = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 7, 1}
	windowsPKCS12KeyBagType      = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 12, 10, 1, 2}
	windowsPKCS12FriendlyName    = asn1.ObjectIdentifier{1, 2, 840, 113549, 1, 9, 20}
	windowsPKCS12SHA1            = asn1.ObjectIdentifier{1, 3, 14, 3, 2, 26}
)

// setWindowsPKCS12KeyAlias 在本地重封装 P12 的私钥袋写入 friendlyName。
// Tomcat 的 certificateKeyAlias 读取该标准属性。公开库未提供此写入能力，
// 因此只改未加密私钥袋，并重算整个 PFX 的 MAC，证书安全袋保持不变。
func setWindowsPKCS12KeyAlias(content []byte, password, alias string) ([]byte, error) {
	var pfx windowsPKCS12PFX
	if trailing, err := asn1.Unmarshal(content, &pfx); err != nil || len(trailing) != 0 || pfx.Version != 3 || !pfx.AuthSafe.ContentType.Equal(windowsPKCS12DataContentType) {
		return nil, errors.New("invalid PKCS12")
	}
	var authenticatedSafeBytes []byte
	if trailing, err := asn1.Unmarshal(pfx.AuthSafe.Content.Bytes, &authenticatedSafeBytes); err != nil || len(trailing) != 0 {
		return nil, errors.New("invalid authenticated safe")
	}
	var authenticatedSafe []windowsPKCS12ContentInfo
	if trailing, err := asn1.Unmarshal(authenticatedSafeBytes, &authenticatedSafe); err != nil || len(trailing) != 0 {
		return nil, errors.New("invalid safe contents")
	}
	friendlyName, err := windowsPKCS12FriendlyNameAttribute(alias)
	if err != nil {
		return nil, err
	}
	foundPrivateKey := false
	for index := range authenticatedSafe {
		contentInfo := &authenticatedSafe[index]
		if !contentInfo.ContentType.Equal(windowsPKCS12DataContentType) {
			continue
		}
		var safeContentsBytes []byte
		if trailing, err := asn1.Unmarshal(contentInfo.Content.Bytes, &safeContentsBytes); err != nil || len(trailing) != 0 {
			return nil, errors.New("invalid private key safe")
		}
		var bags []windowsPKCS12SafeBag
		if trailing, err := asn1.Unmarshal(safeContentsBytes, &bags); err != nil || len(trailing) != 0 {
			return nil, errors.New("invalid private key bags")
		}
		for bagIndex := range bags {
			if !bags[bagIndex].ID.Equal(windowsPKCS12KeyBagType) {
				continue
			}
			attributes := bags[bagIndex].Attributes[:0]
			for _, attribute := range bags[bagIndex].Attributes {
				if !attribute.ID.Equal(windowsPKCS12FriendlyName) {
					attributes = append(attributes, attribute)
				}
			}
			bags[bagIndex].Attributes = append(attributes, friendlyName)
			foundPrivateKey = true
		}
		if !foundPrivateKey {
			continue
		}
		encodedBags, err := asn1.Marshal(bags)
		if err != nil {
			return nil, err
		}
		wrappedBags, err := asn1.Marshal(encodedBags)
		if err != nil {
			return nil, err
		}
		contentInfo.Content = asn1.RawValue{Class: 2, Tag: 0, IsCompound: true, Bytes: wrappedBags}
	}
	if !foundPrivateKey {
		return nil, errors.New("PKCS12 private key bag not found")
	}
	updatedAuthenticatedSafe, err := asn1.Marshal(authenticatedSafe)
	if err != nil {
		return nil, err
	}
	encodedPassword, err := windowsPKCS12BMPString(password, true)
	if err != nil {
		return nil, err
	}
	if !pfx.MacData.Mac.Algorithm.Algorithm.Equal(windowsPKCS12SHA1) {
		return nil, errors.New("unsupported PKCS12 MAC")
	}
	iterations := pfx.MacData.Iterations
	if iterations < 1 {
		iterations = 1
	}
	key := windowsPKCS12DeriveSHA1(pfx.MacData.MacSalt, encodedPassword, iterations, 3, sha1.Size)
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(updatedAuthenticatedSafe)
	pfx.MacData.Mac.Digest = mac.Sum(nil)
	wrappedAuthenticatedSafe, err := asn1.Marshal(updatedAuthenticatedSafe)
	if err != nil {
		return nil, err
	}
	pfx.AuthSafe.Content = asn1.RawValue{Class: 2, Tag: 0, IsCompound: true, Bytes: wrappedAuthenticatedSafe}
	return asn1.Marshal(pfx)
}

type windowsPKCS12PFX struct {
	Version  int
	AuthSafe windowsPKCS12ContentInfo
	MacData  windowsPKCS12MacData `asn1:"optional"`
}

type windowsPKCS12ContentInfo struct {
	ContentType asn1.ObjectIdentifier
	Content     asn1.RawValue `asn1:"tag:0,explicit,optional"`
}

type windowsPKCS12MacData struct {
	Mac        windowsPKCS12DigestInfo
	MacSalt    []byte
	Iterations int `asn1:"optional,default:1"`
}

type windowsPKCS12DigestInfo struct {
	Algorithm pkix.AlgorithmIdentifier
	Digest    []byte
}

type windowsPKCS12SafeBag struct {
	ID         asn1.ObjectIdentifier
	Value      asn1.RawValue            `asn1:"tag:0,explicit"`
	Attributes []windowsPKCS12Attribute `asn1:"set,optional"`
}

type windowsPKCS12Attribute struct {
	ID    asn1.ObjectIdentifier
	Value asn1.RawValue `asn1:"set"`
}

func windowsPKCS12FriendlyNameAttribute(alias string) (windowsPKCS12Attribute, error) {
	bmp, err := windowsPKCS12BMPString(alias, false)
	if err != nil {
		return windowsPKCS12Attribute{}, err
	}
	encodedName, err := asn1.Marshal(asn1.RawValue{Class: 0, Tag: 30, Bytes: bmp})
	if err != nil {
		return windowsPKCS12Attribute{}, err
	}
	return windowsPKCS12Attribute{
		ID:    windowsPKCS12FriendlyName,
		Value: asn1.RawValue{Class: 0, Tag: 17, IsCompound: true, Bytes: encodedName},
	}, nil
}

func windowsPKCS12BMPString(value string, terminated bool) ([]byte, error) {
	units := utf16.Encode([]rune(value))
	for _, unit := range units {
		if unit == 0 || (unit >= 0xd800 && unit <= 0xdfff) {
			return nil, errors.New("invalid BMP string")
		}
	}
	if terminated {
		units = append(units, 0)
	}
	output := make([]byte, len(units)*2)
	for index, unit := range units {
		output[index*2] = byte(unit >> 8)
		output[index*2+1] = byte(unit)
	}
	return output, nil
}

func windowsPKCS12DeriveSHA1(salt, password []byte, iterations int, identifier byte, size int) []byte {
	const blockSize = 64
	fill := func(value []byte) []byte {
		if len(value) == 0 {
			return nil
		}
		length := blockSize * ((len(value) + blockSize - 1) / blockSize)
		return bytes.Repeat(value, (length+len(value)-1)/len(value))[:length]
	}
	input := append(fill(salt), fill(password)...)
	diversifier := bytes.Repeat([]byte{identifier}, blockSize)
	blocks := (size + sha1.Size - 1) / sha1.Size
	output := make([]byte, 0, blocks*sha1.Size)
	for block := 0; block < blocks; block++ {
		hashInput := append(append([]byte{}, diversifier...), input...)
		digest := sha1.Sum(hashInput)
		for round := 1; round < iterations; round++ {
			digest = sha1.Sum(digest[:])
		}
		output = append(output, digest[:]...)
		if block == blocks-1 || len(input) == 0 {
			continue
		}
		adjustment := make([]byte, blockSize)
		for index := range adjustment {
			adjustment[index] = digest[index%len(digest)]
		}
		addend := new(big.Int).SetBytes(adjustment)
		for offset := 0; offset < len(input); offset += blockSize {
			value := new(big.Int).SetBytes(input[offset : offset+blockSize])
			value.Add(value, addend)
			value.Add(value, big.NewInt(1))
			encoded := value.Bytes()
			if len(encoded) > blockSize {
				encoded = encoded[len(encoded)-blockSize:]
			}
			for index := 0; index < blockSize; index++ {
				input[offset+index] = 0
			}
			copy(input[offset+blockSize-len(encoded):offset+blockSize], encoded)
		}
	}
	return output[:size]
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

// validateWindowsCurrentKeyStore 确认目标 Tomcat 当前 KeyStore 与本次使用的密码、Alias
// 一致，防止用新密码生成的容器替换后无法被现有 Tomcat 配置打开。
func validateWindowsCurrentKeyStore(path, keystoreType, password, alias string) error {
	current, err := os.ReadFile(path)
	if err != nil {
		return errors.New("目标 Tomcat 当前 KeyStore 不可读，无法确认密码")
	}
	switch strings.ToUpper(strings.TrimSpace(keystoreType)) {
	case "JKS":
		if _, err := parseWindowsJKSKeyStore(current, password, alias); err != nil {
			return errors.New("目标 Tomcat 当前 KeyStore 密码或格式校验失败")
		}
	case "PKCS12":
		if _, err := parseWindowsPKCS12KeyStore(current, password, alias); err != nil {
			return errors.New("目标 Tomcat 当前 KeyStore 密码或格式校验失败")
		}
	default:
		return errors.New("目标 Tomcat 当前 KeyStore 类型不受支持")
	}
	return nil
}

func parseWindowsJKSKeyStore(content []byte, password, alias string) (windowsKeyStoreMaterialDetails, error) {
	store := keystore.New()
	if err := store.Load(bytes.NewReader(content), []byte(password)); err != nil {
		return windowsKeyStoreMaterialDetails{}, errors.New("JKS 解析失败：密码错误或文件损坏")
	}
	if alias == "" {
		privateAliases := make([]string, 0, 1)
		for _, candidate := range store.Aliases() {
			if store.IsPrivateKeyEntry(candidate) {
				privateAliases = append(privateAliases, candidate)
			}
		}
		if len(privateAliases) == 0 {
			return windowsKeyStoreMaterialDetails{}, errors.New("JKS 不包含私钥条目，无法自动发现 alias")
		}
		if len(privateAliases) > 1 {
			return windowsKeyStoreMaterialDetails{}, errors.New("JKS 包含多个私钥条目，无法自动确定 alias")
		}
		alias = privateAliases[0]
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
			if alias == "" && len(friendlyNames) == 1 {
				alias = friendlyNames[0]
			}
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
