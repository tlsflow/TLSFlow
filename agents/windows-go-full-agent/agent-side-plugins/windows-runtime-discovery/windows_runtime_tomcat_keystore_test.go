package main

import (
	"bytes"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/hex"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	keystore "github.com/pavlo-v-chernykh/keystore-go/v4"
)

func TestWindowsRuntimeDiscoveryReadsTomcatJKSAndKeepsPKCS12Separate(t *testing.T) {
	root := t.TempDir()
	certificate, privateKey := newWindowsRuntimeTomcatCertificate(t)
	storePath := filepath.Join(root, "server.jks")
	privateKeyBytes, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	store := keystore.New()
	if err := store.SetPrivateKeyEntry("server", keystore.PrivateKeyEntry{
		CreationTime: time.Now(),
		PrivateKey:   privateKeyBytes,
		CertificateChain: []keystore.Certificate{{
			Type: "X509", Content: certificate.Raw,
		}},
	}, []byte("changeit")); err != nil {
		t.Fatal(err)
	}
	var encoded bytes.Buffer
	if err := store.Store(&encoded, []byte("changeit")); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(storePath, encoded.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}

	summary := readWindowsKeyStoreCertificateSummary(storePath, "JKS", "changeit")
	if summary == nil {
		t.Fatal("Windows Runtime Discovery 必须解析 Tomcat JKS 叶子证书")
	}
	expected := sha256.Sum256(certificate.Raw)
	if summary.FingerprintSHA256 != hex.EncodeToString(expected[:]) || summary.Subject != certificate.Subject.String() {
		t.Fatalf("JKS 证书摘要不正确: got=%#v", summary)
	}
	if wrongFormat := readWindowsKeyStoreCertificateSummary(storePath, "PKCS12", "changeit"); wrongFormat != nil {
		t.Fatalf("JKS 不得被 PKCS12 解析器误认: %#v", wrongFormat)
	}
	if wrongPassword := readWindowsKeyStoreCertificateSummary(storePath, "JKS", "wrong"); wrongPassword != nil {
		t.Fatalf("错误密码不得返回 JKS 证书: %#v", wrongPassword)
	}
}

func TestParseWindowsTomcatServerXMLUsesJKSParser(t *testing.T) {
	root := t.TempDir()
	confDir := filepath.Join(root, "conf")
	if err := os.MkdirAll(confDir, 0o700); err != nil {
		t.Fatal(err)
	}
	certificate, privateKey := newWindowsRuntimeTomcatCertificate(t)
	store := keystore.New()
	privateKeyBytes, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetPrivateKeyEntry("server", keystore.PrivateKeyEntry{
		CreationTime: time.Now(),
		PrivateKey:   privateKeyBytes,
		CertificateChain: []keystore.Certificate{{
			Type: "X509", Content: certificate.Raw,
		}},
	}, []byte("changeit")); err != nil {
		t.Fatal(err)
	}
	var encoded bytes.Buffer
	if err := store.Store(&encoded, []byte("changeit")); err != nil {
		t.Fatal(err)
	}
	keystorePath := filepath.Join(confDir, "server.jks")
	if err := os.WriteFile(keystorePath, encoded.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(confDir, "server.xml")
	config := `<Server><Service><Connector port="8443" protocol="org.apache.coyote.http11.Http11NioProtocol" SSLEnabled="true" certificateKeystoreFile="conf/server.jks" certificateKeystoreType="JKS" keystorePass="changeit"/></Service></Server>`
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}

	listeners, _, _, warnings := parseWindowsTomcatServerXML(configPath, root)
	if len(listeners) != 1 || listeners[0].KeystoreType != "JKS" || listeners[0].Certificate == nil {
		t.Fatalf("Tomcat JKS 监听器未完成发现: listeners=%#v warnings=%#v", listeners, warnings)
	}
	if len(warnings) != 0 {
		t.Fatalf("有效 JKS 不应产生解析告警: %#v", warnings)
	}
}

func TestParseWindowsTomcatServerXMLSupportsLegacyConnectorKeystoreBinding(t *testing.T) {
	root := t.TempDir()
	confDir := filepath.Join(root, "conf")
	if err := os.MkdirAll(confDir, 0o700); err != nil {
		t.Fatal(err)
	}
	certificate, privateKey := newWindowsRuntimeTomcatCertificate(t)
	store := keystore.New()
	privateKeyBytes, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.SetPrivateKeyEntry("server", keystore.PrivateKeyEntry{
		CreationTime: time.Now(),
		PrivateKey:   privateKeyBytes,
		CertificateChain: []keystore.Certificate{{
			Type: "X509", Content: certificate.Raw,
		}},
	}, []byte("changeit")); err != nil {
		t.Fatal(err)
	}
	var encoded bytes.Buffer
	if err := store.Store(&encoded, []byte("changeit")); err != nil {
		t.Fatal(err)
	}
	keystorePath := filepath.Join(confDir, "server.jks")
	if err := os.WriteFile(keystorePath, encoded.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	configPath := filepath.Join(confDir, "server.xml")
	config := `<Server><Service><Connector port="8445" protocol="org.apache.coyote.http11.Http11NioProtocol" SSLEnabled="true" keystoreFile="conf/server.jks" keystoreType="JKS" keystorePass="changeit" keyAlias="server"/><Engine><Host name="tomcat.test.local"/></Engine></Service></Server>`
	if err := os.WriteFile(configPath, []byte(config), 0o600); err != nil {
		t.Fatal(err)
	}

	listeners, hosts, _, warnings := parseWindowsTomcatServerXML(configPath, root)
	if len(listeners) != 1 || len(hosts) != 1 {
		t.Fatalf("Tomcat 旧式 Connector 监听器或 Host 未发现: listeners=%#v hosts=%#v warnings=%#v", listeners, hosts, warnings)
	}
	listener := listeners[0]
	if listener.Protocol != "HTTPS" || listener.KeystorePath != keystorePath || listener.KeystoreType != "JKS" || listener.KeyAlias != "server" || listener.Certificate == nil {
		t.Fatalf("Tomcat 旧式 Connector 未形成完整证书事实: listener=%#v warnings=%#v", listener, warnings)
	}
	if len(warnings) != 0 {
		t.Fatalf("有效 Tomcat 旧式 Connector 不应产生解析告警: %#v", warnings)
	}
}

func newWindowsRuntimeTomcatCertificate(t *testing.T) (*x509.Certificate, *rsa.PrivateKey) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(now.UnixNano()),
		Subject:               pkix.Name{CommonName: "tomcat.example.test"},
		NotBefore:             now.Add(-time.Minute),
		NotAfter:              now.Add(time.Hour),
		KeyUsage:              x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
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
