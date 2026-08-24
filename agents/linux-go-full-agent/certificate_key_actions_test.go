package main

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
	"runtime"
	"testing"
	"time"

	coreRegistry "gcac/linux-go-full-agent/internal/core/registry"
)

func TestLinuxCreateCertificateCSRUsesProtectedFile(t *testing.T) {
	directory := t.TempDir()
	result := linuxCreateCertificateCSR(context.Background(), coreRegistry.Request{Payload: map[string]any{
		"commonName": "oa.example.com", "sans": []any{"oa.example.com"}, "keyDirectory": directory,
	}})
	if !result.Success {
		t.Fatalf("create CSR failed: %s", result.ErrorMessage)
	}
	keyPath := result.Detail["localKeyRef"].(string)
	info, err := os.Stat(keyPath)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("unexpected private key mode: %o", info.Mode().Perm())
	}
	if filepath.Dir(keyPath) != directory {
		t.Fatalf("unexpected key directory: %s", keyPath)
	}
	if result.Detail["exportability"] != "exportable" {
		t.Fatalf("linux file key must not be marked non-exportable")
	}
}

func TestLinuxCertificateTrustInstallAndRollback(t *testing.T) {
	directory := t.TempDir()
	trustPath := filepath.Join(directory, "gcac-root.crt")
	certificatePEM := createTestCACertificate(t)
	installed := linuxInstallCertificateTrust(context.Background(), coreRegistry.Request{Payload: map[string]any{
		"certificatePem": certificatePEM, "trustStorePath": trustPath,
	}})
	if !installed.Success {
		t.Fatalf("trust install failed: %s", installed.ErrorMessage)
	}
	rolledBack := linuxRollbackCertificateTrust(context.Background(), coreRegistry.Request{Payload: installed.Detail})
	if !rolledBack.Success {
		t.Fatalf("trust rollback failed: %s", rolledBack.ErrorMessage)
	}
	content, err := os.ReadFile(trustPath)
	if !os.IsNotExist(err) || len(content) != 0 {
		t.Fatalf("trust anchor file should be removed on rollback, err=%v content=%q", err, content)
	}
}

func TestLinuxCertificateTrustInspectReadsManagedAnchor(t *testing.T) {
	directory := t.TempDir()
	trustPath := filepath.Join(directory, "gcac-root.crt")
	certificatePEM := createTestCACertificate(t)
	installed := linuxInstallCertificateTrust(context.Background(), coreRegistry.Request{Payload: map[string]any{
		"certificatePem": certificatePEM, "trustStorePath": trustPath,
	}})
	if !installed.Success {
		t.Fatalf("trust install failed: %s", installed.ErrorMessage)
	}
	fingerprint := installed.Detail["fingerprintSha256"].(string)
	inspection := linuxInspectCertificateTrust(context.Background(), coreRegistry.Request{Payload: map[string]any{
		"fingerprintSha256": fingerprint, "trustStorePath": trustPath,
	}})
	if !inspection.Success {
		t.Fatalf("trust inspect failed: %s", inspection.ErrorMessage)
	}
	if inspection.Detail["status"] != "found" {
		t.Fatalf("unexpected inspect detail: %+v", inspection.Detail)
	}
}

func createTestCACertificate(t *testing.T) string {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "GCAC Test Root"},
		NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &privateKey.PublicKey, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
}
