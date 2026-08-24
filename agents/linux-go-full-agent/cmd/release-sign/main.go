package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"os"
	"strings"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) == 0 {
		return errors.New("usage: release-sign keygen|sign|verify")
	}
	switch args[0] {
	case "keygen":
		if len(args) != 3 {
			return errors.New("usage: release-sign keygen <private-key> <public-key>")
		}
		return keygen(args[1], args[2])
	case "sign":
		if len(args) != 4 {
			return errors.New("usage: release-sign sign <private-key> <artifact> <signature>")
		}
		return sign(args[1], args[2], args[3])
	case "verify":
		if len(args) != 4 {
			return errors.New("usage: release-sign verify <public-key> <artifact> <signature>")
		}
		return verify(args[1], args[2], args[3])
	default:
		return fmt.Errorf("unknown command: %s", args[0])
	}
}

func keygen(privatePath, publicPath string) error {
	publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	if err := writeEncoded(privatePath, privateKey, 0o600); err != nil {
		return err
	}
	return writeEncoded(publicPath, publicKey, 0o644)
}

func sign(privatePath, artifactPath, signaturePath string) error {
	privateKey, err := readEncoded(privatePath, ed25519.PrivateKeySize)
	if err != nil {
		return err
	}
	artifact, err := os.ReadFile(artifactPath)
	if err != nil {
		return err
	}
	signature := ed25519.Sign(ed25519.PrivateKey(privateKey), artifact)
	return writeEncoded(signaturePath, signature, 0o644)
}

func verify(publicPath, artifactPath, signaturePath string) error {
	publicKey, err := readEncoded(publicPath, ed25519.PublicKeySize)
	if err != nil {
		return err
	}
	signature, err := readEncoded(signaturePath, ed25519.SignatureSize)
	if err != nil {
		return err
	}
	artifact, err := os.ReadFile(artifactPath)
	if err != nil {
		return err
	}
	if !ed25519.Verify(ed25519.PublicKey(publicKey), artifact, signature) {
		return errors.New("release signature verification failed")
	}
	return nil
}

func readEncoded(path string, expected int) ([]byte, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(content)))
	if err != nil {
		return nil, err
	}
	if len(decoded) != expected {
		return nil, fmt.Errorf("invalid key or signature length: %d", len(decoded))
	}
	return decoded, nil
}

func writeEncoded(path string, content []byte, mode os.FileMode) error {
	return os.WriteFile(path, []byte(base64.StdEncoding.EncodeToString(content)+"\n"), mode)
}
