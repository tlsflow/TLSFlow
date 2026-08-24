package tlsverifier

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/hex"
	"errors"
	"net"
	"strings"
	"time"
)

type Verifier struct {
	Address             string
	ServerName          string
	ExpectedFingerprint string
	Timeout             time.Duration
}

func (verifier Verifier) Verify(ctx context.Context) error {
	if strings.TrimSpace(verifier.Address) == "" {
		return errors.New("TLS verification address is required")
	}
	timeout := verifier.Timeout
	if timeout <= 0 {
		timeout = 5 * time.Second
	}
	dialer := &net.Dialer{Timeout: timeout}
	connection, err := tls.DialWithDialer(dialer, "tcp", verifier.Address, &tls.Config{
		InsecureSkipVerify: true,
		ServerName:         strings.TrimSpace(verifier.ServerName),
	})
	if err != nil {
		return err
	}
	defer connection.Close()
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	certificates := connection.ConnectionState().PeerCertificates
	if len(certificates) == 0 {
		return errors.New("TLS peer certificate is missing")
	}
	expected := normalize(verifier.ExpectedFingerprint)
	if expected == "" {
		return nil
	}
	actual := sha256.Sum256(certificates[0].Raw)
	if hex.EncodeToString(actual[:]) != expected {
		return errors.New("TLS certificate fingerprint mismatch")
	}
	return nil
}

func normalize(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	value = strings.ReplaceAll(value, ":", "")
	value = strings.ReplaceAll(value, " ", "")
	return value
}
