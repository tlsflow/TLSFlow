package apache

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

type serviceStub struct {
	verifyFailure bool
	restarts      int
}

func (service *serviceStub) Validate(context.Context) error { return nil }
func (service *serviceStub) Reload(context.Context) error   { return nil }
func (service *serviceStub) Restart(context.Context) error  { service.restarts++; return nil }

type securityStub struct{}

func (securityStub) RestoreFileContext(context.Context, string) error { return nil }

type verifierStub struct{ err error }

func (verifier verifierStub) Verify(context.Context) error { return verifier.err }

func TestHandlerDeploysApachePEM(t *testing.T) {
	root := t.TempDir()
	filesystem, _ := linuxfs.New([]string{root})
	service := &serviceStub{}
	handler := New(filesystem, service, securityStub{}, verifierStub{})
	result := handler.Deploy(context.Background(), apacheInput(root))
	if !result.Success {
		t.Fatalf("Apache 部署失败: %#v", result)
	}
}

func TestHandlerRestoresFilesWhenVerificationFails(t *testing.T) {
	root := t.TempDir()
	input := apacheInput(root)
	if err := os.WriteFile(input.CertificatePath, []byte("old-cert"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(input.PrivateKeyPath, []byte("old-key"), 0o600); err != nil {
		t.Fatal(err)
	}
	filesystem, _ := linuxfs.New([]string{root})
	service := &serviceStub{}
	result := New(filesystem, service, securityStub{}, verifierStub{err: errors.New("fingerprint mismatch")}).Deploy(context.Background(), input)
	if result.ErrorCode != "APACHE_VERIFY_FAILED" || service.restarts != 1 {
		t.Fatalf("Apache 恢复语义错误: %#v", result)
	}
	content, _ := os.ReadFile(input.CertificatePath)
	if string(content) != "old-cert" {
		t.Fatalf("证书未恢复: %s", content)
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
