package productruntime

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"gcac/linux-go-full-agent/internal/compatibility"
	productregistry "gcac/linux-go-full-agent/internal/handlers/registry"
	"gcac/linux-go-full-agent/internal/platform/linux/command"
)

type runnerStub struct{}

func (runnerStub) Run(context.Context, command.Spec) (command.Result, error) {
	return command.Result{}, nil
}

func TestApacheHandlerCompletesLocalDeployment(t *testing.T) {
	root := t.TempDir()
	certificate, privateKey := generateCertificateMaterial(t)
	registry := productregistry.New()
	if err := Register(registry, runnerStub{}); err != nil {
		t.Fatal(err)
	}
	result := registry.Execute(context.Background(), productregistry.Request{
		TaskID: "apache-task",
		Input: map[string]any{
			"serviceName": "apache2", "certificatePath": filepath.Join(root, "cert.pem"), "privateKeyPath": filepath.Join(root, "key.pem"),
			"certificatePem": string(certificate), "privateKeyPem": string(privateKey), "backupDirectory": filepath.Join(root, "backup"),
			"recoveryLedgerPath": filepath.Join(root, "recovery", "apache.json"), "validationCommand": map[string]any{"name": "apachectl", "args": []string{"configtest"}},
		},
		Capabilities: runtimeCapabilities(),
		Resolution:   compatibility.Resolution{ProductAdapterID: compatibility.ProductApache, ArtifactCodecID: compatibility.CodecPEM},
	})
	if !result.Success {
		t.Fatalf("Apache 本地闭环失败: %#v", result)
	}
	assertFileExists(t, filepath.Join(root, "cert.pem"))
	assertFileExists(t, filepath.Join(root, "recovery", "apache.json"))
}

func TestTomcatHandlerCompletesKeystoreDeployment(t *testing.T) {
	root := t.TempDir()
	registry := productregistry.New()
	if err := Register(registry, runnerStub{}); err != nil {
		t.Fatal(err)
	}
	result := registry.Execute(context.Background(), productregistry.Request{
		TaskID: "tomcat-task",
		Input: map[string]any{
			"serviceName": "tomcat", "keystorePath": filepath.Join(root, "server.p12"), "keystoreContent": "keystore-fixture",
			"backupDirectory": filepath.Join(root, "backup"), "recoveryLedgerPath": filepath.Join(root, "recovery", "tomcat.json"),
			"validationCommand": map[string]any{"name": "java", "args": []string{"-version"}},
		},
		Capabilities: runtimeCapabilities(),
		Resolution:   compatibility.Resolution{ProductAdapterID: compatibility.ProductTomcat, ArtifactCodecID: compatibility.CodecPKCS12},
	})
	if !result.Success {
		t.Fatalf("Tomcat 本地闭环失败: %#v", result)
	}
	content, err := os.ReadFile(filepath.Join(root, "server.p12"))
	if err != nil || string(content) != "keystore-fixture" {
		t.Fatalf("Tomcat keystore 未写入: content=%q err=%v", content, err)
	}
}

func runtimeCapabilities() map[string]bool {
	return map[string]bool{
		compatibility.CapabilityPrivilegeRoot: true,
		compatibility.CapabilitySystemd:       true,
		compatibility.CapabilitySecurityNone:  true,
	}
}

func generateCertificateMaterial(t *testing.T) ([]byte, []byte) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "localhost"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		KeyUsage:    x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, DNSNames: []string{"localhost"},
	}
	der, err := x509.CreateCertificate(rand.Reader, &template, &template, &privateKey.PublicKey, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	certificatePEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	privateKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey)})
	return certificatePEM, privateKeyPEM
}

func assertFileExists(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("文件不存在 %s: %v", path, err)
	}
}
