package tomcat

import (
	"context"
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

func TestHandlerDeploysTomcatPEM(t *testing.T) {
	root := t.TempDir()
	filesystem, _ := linuxfs.New([]string{root})
	result := New(filesystem, &serviceStub{}, securityStub{}).Deploy(context.Background(), Input{
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
	result := New(filesystem, &serviceStub{}, securityStub{}).Deploy(context.Background(), Input{
		Mode: ModeKeystore, KeystorePath: filepath.Join(root, "server.p12"), KeystoreContent: []byte("pkcs12-fixture"), BackupDirectory: filepath.Join(root, "backup"),
	})
	if !result.Success {
		t.Fatalf("Tomcat keystore 部署失败: %#v", result)
	}
}
