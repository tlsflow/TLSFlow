package tomcat

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	linuxfs "gcac/linux-go-full-agent/internal/platform/linux/filesystem"
)

var testCertificate = []byte("-----BEGIN CERTIFICATE-----\nY2VydA==\n-----END CERTIFICATE-----\n")
var testPrivateKey = []byte("-----BEGIN PRIVATE KEY-----\na2V5\n-----END PRIVATE KEY-----\n")

type serviceStub struct{ restarts int }

func (service *serviceStub) Validate(context.Context) error { return nil }
func (service *serviceStub) Restart(context.Context) error  { service.restarts++; return nil }

type securityStub struct{}

func (securityStub) RestoreFileContext(context.Context, string) error { return nil }

type verifierStub struct{ err error }

func (verifier verifierStub) Verify(context.Context) error { return verifier.err }

func TestHandlerDeploysTomcatPEM(t *testing.T) {
	root := t.TempDir()
	filesystem, _ := linuxfs.New([]string{root})
	result := New(filesystem, &serviceStub{}, securityStub{}, verifierStub{}).Deploy(context.Background(), Input{
		Mode: ModePEM, CertificatePath: filepath.Join(root, "cert.pem"), PrivateKeyPath: filepath.Join(root, "key.pem"),
		CertificatePEM: testCertificate, PrivateKeyPEM: testPrivateKey, BackupDirectory: filepath.Join(root, "backup"),
	})
	if !result.Success {
		t.Fatalf("Tomcat PEM 部署失败: %#v", result)
	}
}

func TestHandlerDeploysTomcatKeystore(t *testing.T) {
	root := t.TempDir()
	filesystem, _ := linuxfs.New([]string{root})
	result := New(filesystem, &serviceStub{}, securityStub{}, verifierStub{}).Deploy(context.Background(), Input{
		Mode: ModeKeystore, KeystorePath: filepath.Join(root, "server.p12"), KeystoreContent: []byte("pkcs12-fixture"), BackupDirectory: filepath.Join(root, "backup"),
	})
	if !result.Success {
		t.Fatalf("Tomcat keystore 部署失败: %#v", result)
	}
}

func TestHandlerRestoresKeystoreWhenVerificationFails(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "server.p12")
	if err := os.WriteFile(target, []byte("old-keystore"), 0o600); err != nil {
		t.Fatal(err)
	}
	filesystem, _ := linuxfs.New([]string{root})
	service := &serviceStub{}
	result := New(filesystem, service, securityStub{}, verifierStub{err: errors.New("tls mismatch")}).Deploy(context.Background(), Input{
		Mode: ModeKeystore, KeystorePath: target, KeystoreContent: []byte("new-keystore"), BackupDirectory: filepath.Join(root, "backup"),
	})
	if result.ErrorCode != "TOMCAT_VERIFY_FAILED" || service.restarts != 2 {
		t.Fatalf("Tomcat 恢复语义错误: %#v", result)
	}
	content, _ := os.ReadFile(target)
	if string(content) != "old-keystore" {
		t.Fatalf("keystore 未恢复: %s", content)
	}
}
