package main

import (
	"strings"
	"testing"
)

func TestWindowsCSRInfUsesNonExportableCNGKey(t *testing.T) {
	content := windowsCSRInf("oa.example.com", []string{"oa.example.com"}, "GCAC-test")
	for _, expected := range []string{"Exportable=FALSE", "MachineKeySet=TRUE", "Microsoft Software Key Storage Provider", "KeyContainer=\"GCAC-test\""} {
		if !strings.Contains(content, expected) {
			t.Fatalf("missing CNG protection setting: %s", expected)
		}
	}
}

func TestWindowsCertificateHandlersRegistered(t *testing.T) {
	registry := mustBuildWindowsActionHandlerRegistry()
	for _, actionType := range []string{"certificate.key.create_csr", "certificate.install_issued", "certificate.key.retire", "certificate.trust.install", "certificate.trust.rollback"} {
		if _, err := registry.Resolve(map[string]any{"type": actionType, "actionSchemaVersion": "1.0"}); err != nil {
			t.Fatalf("handler %s not registered: %v", actionType, err)
		}
	}
}
