package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSignAndVerify(t *testing.T) {
	root := t.TempDir()
	privateKey := filepath.Join(root, "private.key")
	publicKey := filepath.Join(root, "public.key")
	artifact := filepath.Join(root, "agent")
	signature := filepath.Join(root, "agent.sig")
	if err := os.WriteFile(artifact, []byte("release-artifact"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := keygen(privateKey, publicKey); err != nil {
		t.Fatal(err)
	}
	if err := sign(privateKey, artifact, signature); err != nil {
		t.Fatal(err)
	}
	if err := verify(publicKey, artifact, signature); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(artifact, []byte("tampered"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := verify(publicKey, artifact, signature); err == nil {
		t.Fatal("篡改产物必须验签失败")
	}
}
