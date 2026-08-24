package apache

import (
	"context"
	"path/filepath"
	"testing"

	linuxfs "gcac/linux-go-full-agent/internal/platform/linux/filesystem"
)

var testCertificate = []byte("-----BEGIN CERTIFICATE-----\nY2VydA==\n-----END CERTIFICATE-----\n")
var testPrivateKey = []byte("-----BEGIN PRIVATE KEY-----\na2V5\n-----END PRIVATE KEY-----\n")

type serviceStub struct {
	restarts int
}

func (service *serviceStub) Validate(context.Context) error { return nil }
func (service *serviceStub) Reload(context.Context) error   { return nil }
func (service *serviceStub) Restart(context.Context) error  { service.restarts++; return nil }

type securityStub struct{}

func (securityStub) RestoreFileContext(context.Context, string) error { return nil }

func TestHandlerDeploysApachePEM(t *testing.T) {
	root := t.TempDir()
	filesystem, _ := linuxfs.New([]string{root})
	service := &serviceStub{}
	handler := New(filesystem, service, securityStub{})
	result := handler.Deploy(context.Background(), apacheInput(root))
	if !result.Success {
		t.Fatalf("Apache 部署失败: %#v", result)
	}
}

func apacheInput(root string) Input {
	return Input{
		CertificatePath: filepath.Join(root, "cert.pem"),
		PrivateKeyPath:  filepath.Join(root, "key.pem"),
		CertificatePEM:  testCertificate,
		PrivateKeyPEM:   testPrivateKey,
		BackupDirectory: filepath.Join(root, "backup"),
	}
}
