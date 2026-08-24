package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	keystore "github.com/pavlo-v-chernykh/keystore-go/v4"
	pkcs12 "software.sslmate.com/src/go-pkcs12"
)

func TestCollectLinuxWebCertificateFilesReadsTomcatPKCS12AndPreservesConfiguredPath(t *testing.T) {
	certificate, privateKey := testCertificate(t)
	root := t.TempDir()
	configPath := filepath.Join(root, "tomcat", "conf", "server.xml")
	keystorePath := filepath.Join(root, "tomcat", "conf", "localhost-rsa.p12")
	if err := os.MkdirAll(filepath.Dir(configPath), 0o755); err != nil {
		t.Fatal(err)
	}
	content, err := pkcs12.Modern2023.Encode(privateKey, certificate, nil, "changeit")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keystorePath, content, 0o600); err != nil {
		t.Fatal(err)
	}

	previousRoots := webDiscoveryRoots
	webDiscoveryRoots = []string{root}
	t.Cleanup(func() { webDiscoveryRoots = previousRoots })
	files := collectLinuxWebCertificateFiles([]map[string]any{{
		"path":    configPath,
		"content": `<Connector port="8445" scheme="https" certificateKeystoreFile="localhost-rsa.p12" certificateKeystorePassword="changeit"/>`,
	}})

	if len(files) != 1 {
		t.Fatalf("Tomcat PKCS12 必须发现一张证书，实际: %#v", files)
	}
	if files[0]["path"] != keystorePath {
		t.Fatalf("必须上报实际 keystore 路径: %#v", files[0])
	}
	if configuredPaths, ok := files[0]["configuredPaths"].([]string); !ok || len(configuredPaths) != 1 || configuredPaths[0] != "localhost-rsa.p12" {
		t.Fatalf("必须保留 server.xml 的配置路径别名: %#v", files[0])
	}
	if got := sanitizeLinuxWebConfigFiles([]map[string]any{{"content": `<Connector certificateKeystorePassword="changeit"/>`}})[0]["content"]; got != `<Connector certificateKeystorePassword="***"/>` {
		t.Fatalf("keystore 密码不得进入能力快照: %v", got)
	}
}

func TestReadLinuxPublicCertificateReadsTomcatJKS(t *testing.T) {
	certificate, _ := testCertificate(t)
	root := t.TempDir()
	path := filepath.Join(root, "server.store")
	store := keystore.New()
	if err := store.SetTrustedCertificateEntry("tomcat", keystore.TrustedCertificateEntry{
		CreationTime: time.Now(),
		Certificate:  keystore.Certificate{Type: "X509", Content: certificate.Raw},
	}); err != nil {
		t.Fatal(err)
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Store(file, []byte("changeit")); err != nil {
		_ = file.Close()
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}

	previousRoots := webDiscoveryRoots
	webDiscoveryRoots = []string{root}
	t.Cleanup(func() { webDiscoveryRoots = previousRoots })
	metadata := readLinuxPublicCertificateWithPasswords(path, []string{"changeit"})
	if metadata == nil || metadata["name"] != "tomcat.example.test" {
		t.Fatalf("Tomcat JKS 必须读取叶子证书: %#v", metadata)
	}
}

func testCertificate(t *testing.T) (*x509.Certificate, *rsa.PrivateKey) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "tomcat.example.test"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
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
