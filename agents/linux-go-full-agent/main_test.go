package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	coreRegistry "gcac/linux-go-full-agent/internal/core/registry"
)

func TestCapabilityRescanDefaultsRemainEnabledForLegacyConfigs(t *testing.T) {
	config := &AgentConfig{}
	if seconds := effectiveCapabilityRescanSeconds(config); seconds != 300 {
		t.Fatalf("旧配置的能力重扫间隔应默认为 300 秒，实际为 %d", seconds)
	}
	if !effectiveCapabilityRescanEnabled(config) {
		t.Fatal("旧配置应默认启用能力重扫")
	}

	disabled := false
	config.CapabilityRescanEnabled = &disabled
	if effectiveCapabilityRescanEnabled(config) {
		t.Fatal("显式关闭能力重扫时不应自动启用")
	}
}

func TestParseNginxConfigTreeCollectsIncludedSites(t *testing.T) {
	tempDir := t.TempDir()
	nginxRoot := filepath.Join(tempDir, "nginx")
	sitesDir := filepath.Join(nginxRoot, "sites-enabled")
	if err := os.MkdirAll(sitesDir, 0o755); err != nil {
		t.Fatalf("mkdir sites-enabled failed: %v", err)
	}

	mainConfig := filepath.Join(nginxRoot, "nginx.conf")
	siteConfig := filepath.Join(sitesDir, "gcac.conf")
	if err := os.WriteFile(mainConfig, []byte(`
events {}
http {
  include sites-enabled/*.conf;
}
`), 0o644); err != nil {
		t.Fatalf("write nginx.conf failed: %v", err)
	}
	if err := os.WriteFile(siteConfig, []byte(`
server {
  listen 443 ssl;
  server_name test.local www.test.local;
  root /srv/www/nginx-test;
  ssl_certificate /etc/gcac-test/certs/test.crt;
  ssl_certificate_key /etc/gcac-test/certs/test.key;
}
`), 0o644); err != nil {
		t.Fatalf("write site config failed: %v", err)
	}

	sites := parseNginxConfigTree(mainConfig, nginxRoot)
	if len(sites) != 1 {
		t.Fatalf("expected 1 nginx site, got %d", len(sites))
	}
	if sites[0].Name != "test.local" {
		t.Fatalf("expected site name test.local, got %q", sites[0].Name)
	}
	if sites[0].SitePath != "/srv/www/nginx-test" {
		t.Fatalf("expected site path /srv/www/nginx-test, got %q", sites[0].SitePath)
	}
	if len(sites[0].Listen) != 1 || sites[0].Listen[0].Port != 443 {
		t.Fatalf("expected https listen on 443, got %+v", sites[0].Listen)
	}
	if sites[0].Listen[0].CertificatePath != "/etc/gcac-test/certs/test.crt" {
		t.Fatalf("expected cert path to be discovered, got %q", sites[0].Listen[0].CertificatePath)
	}
}

func TestParseTomcatServerXMLDiscoversConnectorsAndWebapps(t *testing.T) {
	tempDir := t.TempDir()
	catalinaBase := filepath.Join(tempDir, "var", "lib", "tomcat9")
	configDir := filepath.Join(tempDir, "etc", "tomcat9")
	webappsDir := filepath.Join(catalinaBase, "webapps")
	if err := os.MkdirAll(webappsDir, 0o755); err != nil {
		t.Fatalf("mkdir webapps failed: %v", err)
	}
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		t.Fatalf("mkdir config dir failed: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(webappsDir, "gcac-test"), 0o755); err != nil {
		t.Fatalf("mkdir app dir failed: %v", err)
	}
	if err := os.WriteFile(filepath.Join(webappsDir, "demo.war"), []byte("war"), 0o644); err != nil {
		t.Fatalf("write demo.war failed: %v", err)
	}

	serverXML := filepath.Join(configDir, "server.xml")
	if err := os.WriteFile(serverXML, []byte(`
<Server>
  <Service name="Catalina">
    <Connector port="8082" protocol="HTTP/1.1" redirectPort="8445" />
    <Connector port="8445" protocol="org.apache.coyote.http11.Http11NioProtocol" SSLEnabled="true" scheme="https" secure="true" keystoreFile="/etc/gcac-test/certs/test.p12" />
    <Engine name="Catalina" defaultHost="localhost">
      <Host name="localhost" appBase="webapps" />
    </Engine>
  </Service>
</Server>
`), 0o644); err != nil {
		t.Fatalf("write server.xml failed: %v", err)
	}

	connectors, apps := parseTomcatServerXML(serverXML, catalinaBase)
	if len(connectors) != 2 {
		t.Fatalf("expected 2 connectors, got %d", len(connectors))
	}
	if connectors[1].Port != 8445 || connectors[1].TLS != true {
		t.Fatalf("expected TLS connector on 8445, got %+v", connectors[1])
	}
	if connectors[1].KeystorePath != "/etc/gcac-test/certs/test.p12" {
		t.Fatalf("expected keystore path to be discovered, got %q", connectors[1].KeystorePath)
	}
	if len(apps) < 2 {
		t.Fatalf("expected at least 2 apps from webapps scan, got %d", len(apps))
	}
	contexts := make(map[string]struct{}, len(apps))
	for _, app := range apps {
		contexts[app.ContextPath] = struct{}{}
	}
	if _, ok := contexts["/gcac-test"]; !ok {
		t.Fatalf("expected /gcac-test to be discovered, got %+v", apps)
	}
	if _, ok := contexts["/demo"]; !ok {
		t.Fatalf("expected /demo to be discovered from war, got %+v", apps)
	}
}

func TestReadCertificateSubjectFromPEMParsesSubject(t *testing.T) {
	subject := readCertificateSubjectFromPEM(`Bag Attributes
    localKeyID: 38 9F 55 A7 3E E3 0A 67 54 29 25 C8 6E 06 51 DE 21 3C EF 76
subject=C = CN, ST = Test, L = Test, O = GCAC, OU = QA, CN = test.local
issuer=C = CN, ST = Test, L = Test, O = GCAC, OU = QA, CN = test.local
-----BEGIN CERTIFICATE-----
MIIDmTCCAoGgAwIBAgIUOSDZx6KQy/NjlHsB/5iiMW8hqhYwDQYJKoZIhvcNAQEL
BQAwXDELMAkGA1UEBhMCQ04xDTALBgNVBAgMBFRlc3QxDTALBgNVBAcMBFRlc3Qx
DTALBgNVBAoMBEdDQUMxCzAJBgNVBAsMAlFBMRMwEQYDVQQDDAp0ZXN0LmxvY2Fs
MB4XDTI2MDYyMzA2NDA0NloXDTI3MDYyMzA2NDA0NlowXDELMAkGA1UEBhMCQ04x
DTALBgNVBAgMBFRlc3QxDTALBgNVBAcMBFRlc3QxDTALBgNVBAoMBEdDQUMxCzAJ
BgNVBAsMAlFBMRMwEQYDVQQDDAp0ZXN0LmxvY2FsMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAw93+hV03R+hQ2gyrMyu8r4Vm9mTffAvfy5oi3OGyKqGv
ntAa6Vdcpk4J+lFZJ+XAF5M05GkkzvJjxu77lHIX05vGtqi9BvJv2Nk4T/4QnlG5
5KjpnXweMz29OMp65KhACcnKA5vy6ee+GV0VMzNlEbm/XFcKAUoXDFfHSCST+5zo
hHq8Rl2Bcd2o5oqrLCu6eVfnnzZ/mkN3afuLVWCwALY55M2OPElD5YgiarZHuabo
fHZuPauhWrj2JL+RoiZbsnFhl8GGM9ot42wzya7oFm8HM7sUuKe+JnHwC/6sqal+
jcRC6qNkKsmdRJV3VoK7cNBzEK4kfafn1PHzV8Z+GQIDAQABo1MwUTAdBgNVHQ4E
FgQUUlCrPU3TIh3k33OIihCzqPK7bZ4wHwYDVR0jBBgwFoAUUlCrPU3TIh3k33OI
ihCzqPK7bZ4wDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAZQup
vt3jbvP2fCziPSBEgZjZPHTmxCu+/QdnatYqOSla9zs13DnXkbafGht32eriytiw
1X/B7IrllAcz3KS3ephSlCU6OggYPAn70Fry0R2Wu8/x/gxQzgiJSzqmiOmGr4B6
eR5chjR+A/JbGc/qY4TpQD3XcDP6gJDMUUx+2bE81DXvKqRYgbzgEWwAGk4FbwtB
8d8pkoR/o/nTagSGSdnt2yJD+iDGfslBP9AjYxaLcOhDAQUMf0tAtCFaXAuY9bRG
EH+wa3M/IyzPZDYF85KvPBbuMHqii21QveLH9We511LepJJmr6PU+SNR9Y56lxuo
C3viH2HINICyGHzVyA==
-----END CERTIFICATE-----`)
	if subject == "" {
		t.Fatalf("expected PEM subject to be parsed")
	}
}

func TestReadCertificateDetailFromPEMParsesMetadata(t *testing.T) {
	detail := readCertificateDetailFromPEM(`Bag Attributes
subject=C = CN, ST = Test, L = Test, O = GCAC, OU = QA, CN = test.local
issuer=C = CN, ST = Test, L = Test, O = GCAC, OU = QA, CN = test.local
-----BEGIN CERTIFICATE-----
MIIDmTCCAoGgAwIBAgIUOSDZx6KQy/NjlHsB/5iiMW8hqhYwDQYJKoZIhvcNAQEL
BQAwXDELMAkGA1UEBhMCQ04xDTALBgNVBAgMBFRlc3QxDTALBgNVBAcMBFRlc3Qx
DTALBgNVBAoMBEdDQUMxCzAJBgNVBAsMAlFBMRMwEQYDVQQDDAp0ZXN0LmxvY2Fs
MB4XDTI2MDYyMzA2NDA0NloXDTI3MDYyMzA2NDA0NlowXDELMAkGA1UEBhMCQ04x
DTALBgNVBAgMBFRlc3QxDTALBgNVBAcMBFRlc3QxDTALBgNVBAoMBEdDQUMxCzAJ
BgNVBAsMAlFBMRMwEQYDVQQDDAp0ZXN0LmxvY2FsMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEAw93+hV03R+hQ2gyrMyu8r4Vm9mTffAvfy5oi3OGyKqGv
ntAa6Vdcpk4J+lFZJ+XAF5M05GkkzvJjxu77lHIX05vGtqi9BvJv2Nk4T/4QnlG5
5KjpnXweMz29OMp65KhACcnKA5vy6ee+GV0VMzNlEbm/XFcKAUoXDFfHSCST+5zo
hHq8Rl2Bcd2o5oqrLCu6eVfnnzZ/mkN3afuLVWCwALY55M2OPElD5YgiarZHuabo
fHZuPauhWrj2JL+RoiZbsnFhl8GGM9ot42wzya7oFm8HM7sUuKe+JnHwC/6sqal+
jcRC6qNkKsmdRJV3VoK7cNBzEK4kfafn1PHzV8Z+GQIDAQABo1MwUTAdBgNVHQ4E
FgQUUlCrPU3TIh3k33OIihCzqPK7bZ4wHwYDVR0jBBgwFoAUUlCrPU3TIh3k33OI
ihCzqPK7bZ4wDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAZQup
vt3jbvP2fCziPSBEgZjZPHTmxCu+/QdnatYqOSla9zs13DnXkbafGht32eriytiw
1X/B7IrllAcz3KS3ephSlCU6OggYPAn70Fry0R2Wu8/x/gxQzgiJSzqmiOmGr4B6
eR5chjR+A/JbGc/qY4TpQD3XcDP6gJDMUUx+2bE81DXvKqRYgbzgEWwAGk4FbwtB
8d8pkoR/o/nTagSGSdnt2yJD+iDGfslBP9AjYxaLcOhDAQUMf0tAtCFaXAuY9bRG
EH+wa3M/IyzPZDYF85KvPBbuMHqii21QveLH9We511LepJJmr6PU+SNR9Y56lxuo
C3viH2HINICyGHzVyA==
-----END CERTIFICATE-----`, "FILE_PATH")
	if detail == nil {
		t.Fatalf("expected certificate detail")
	}
	if detail.Subject == "" || detail.Issuer == "" || detail.NotBefore == "" || detail.NotAfter == "" || detail.Thumbprint == "" {
		t.Fatalf("expected complete certificate metadata, got %+v", detail)
	}
	if detail.FingerprintSHA256 == "" {
		t.Fatalf("expected SHA-256 fingerprint, got %+v", detail)
	}
}

func TestEnrichNginxSiteCertificatesPrefersLiveTLSCertificate(t *testing.T) {
	tempDir := t.TempDir()
	now := time.Now().UTC()
	fileCertPEM, _, _, _ := generateTestPEMMaterialForHostWithValidity(t, "test.local", now.Add(-time.Hour), now.Add(24*time.Hour))
	liveCertPEM, liveKeyPEM, _, liveCert := generateTestPEMMaterialForHostWithValidity(t, "test.local", now.Add(-time.Hour), now.Add(72*time.Hour))

	certPath := filepath.Join(tempDir, "site.crt")
	if err := os.WriteFile(certPath, []byte(fileCertPEM), 0o644); err != nil {
		t.Fatalf("write file certificate failed: %v", err)
	}

	tlsCertificate, err := tls.X509KeyPair([]byte(liveCertPEM), []byte(liveKeyPEM))
	if err != nil {
		t.Fatalf("load live TLS certificate failed: %v", err)
	}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		response.WriteHeader(http.StatusNoContent)
	}))
	server.TLS = &tls.Config{Certificates: []tls.Certificate{tlsCertificate}}
	server.StartTLS()
	defer server.Close()

	_, portText, err := net.SplitHostPort(strings.TrimPrefix(server.URL, "https://"))
	if err != nil {
		t.Fatalf("split TLS server address failed: %v", err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatalf("parse TLS server port failed: %v", err)
	}

	site := nginxSiteDetail{
		Name:        "test.local",
		ServerNames: []string{"test.local"},
		Listen: []nginxBindingDetail{{
			Address:         "127.0.0.1",
			Port:            port,
			Protocol:        "https",
			CertificatePath: certPath,
		}},
	}

	enrichNginxSiteCertificates(&site, "", "")

	if site.Listen[0].Certificate == nil {
		t.Fatalf("expected certificate detail")
	}
	if site.Listen[0].Certificate.StoreName != "TLS_CONNECT" {
		t.Fatalf("expected live TLS certificate source, got %+v", site.Listen[0].Certificate)
	}
	expectedNotAfter := liveCert.NotAfter.UTC().Format(time.RFC3339)
	if site.Listen[0].Certificate.NotAfter != expectedNotAfter {
		t.Fatalf("expected live TLS NotAfter %s, got %s", expectedNotAfter, site.Listen[0].Certificate.NotAfter)
	}
}

func TestApplyApacheSiteCertificateMarksNonStandardTlsPortAsHttps(t *testing.T) {
	site := &apacheSiteDetail{
		Name:                     "test.local",
		serverCertificatePath:    "/etc/gcac-test/certs/test.crt",
		serverCertificateKeyPath: "/etc/gcac-test/certs/test.key",
		Listen: []apacheBindingDetail{
			{Address: "*", Port: 8444, Protocol: "http"},
		},
	}

	applyApacheSiteCertificate(site)

	if len(site.Listen) != 1 {
		t.Fatalf("expected 1 apache listen entry, got %d", len(site.Listen))
	}
	if site.Listen[0].Protocol != "https" {
		t.Fatalf("expected protocol https, got %q", site.Listen[0].Protocol)
	}
	if site.Listen[0].CertificatePath != "/etc/gcac-test/certs/test.crt" {
		t.Fatalf("expected cert path to be preserved, got %q", site.Listen[0].CertificatePath)
	}
	if site.Listen[0].CertificateKeyPath != "/etc/gcac-test/certs/test.key" {
		t.Fatalf("expected key path to be preserved, got %q", site.Listen[0].CertificateKeyPath)
	}
}

func TestDirectControlExecuteActionUsesDeclaredAtomicPlanSchemaVersion(t *testing.T) {
	response, statusCode := executeDirectControlAction(directActionExecuteRequest{
		ActionType: "agent.atomic_plan.execute",
		RequestID:  "req_atomic_schema",
		Inputs: map[string]any{
			"actionSchemaVersion": "1.0",
		},
	})

	if statusCode != http.StatusBadRequest {
		t.Fatalf("expected atomic handler validation failure, got status=%d response=%v", statusCode, response)
	}
	if response["errorCode"] == "ACTION_HANDLER_NOT_REGISTERED" {
		t.Fatalf("expected request to enter atomic handler, got response=%v", response)
	}
	if response["errorCode"] != "AGENT_ATOMIC_OPERATION_FAILED" {
		t.Fatalf("expected AGENT_ATOMIC_OPERATION_FAILED, got response=%v", response)
	}
}

func TestResolveActionSchemaVersion(t *testing.T) {
	tests := []struct {
		name       string
		actionType string
		payload    map[string]any
		expected   string
	}{
		{name: "uses payload declaration", actionType: "agent.atomic_plan.execute", payload: map[string]any{"actionSchemaVersion": "1.0"}, expected: "1.0"},
		{name: "historical certificate action has no schema exception", actionType: "certificate.deploy", payload: map[string]any{}, expected: coreRegistry.DefaultSchemaVersion},
		{name: "uses registry default", actionType: "agent.self_test", payload: map[string]any{}, expected: coreRegistry.DefaultSchemaVersion},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := resolveActionSchemaVersion(test.actionType, test.payload); actual != test.expected {
				t.Fatalf("expected %s, got %s", test.expected, actual)
			}
		})
	}
}

func TestHistoricalProductActionIsRejectedBeforeExecution(t *testing.T) {
	success, code, _, detail := executeLinuxTaskPayload("task_historical_product", map[string]any{
		"type": "linux.nginx.deploy_certificate",
	})
	if success || code != "ACTION_HANDLER_NOT_REGISTERED" {
		t.Fatalf("expected historical product action rejection, got success=%v code=%s detail=%v", success, code, detail)
	}
}

func generateTestPEMMaterialForHostWithValidity(t *testing.T, host string, notBefore time.Time, notAfter time.Time) (string, string, string, *x509.Certificate) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate private key failed: %v", err)
	}
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName:   host,
			Organization: []string{"GCAC"},
		},
		NotBefore:             notBefore,
		NotAfter:              notAfter,
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{host},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &privateKey.PublicKey, privateKey)
	if err != nil {
		t.Fatalf("create certificate failed: %v", err)
	}
	certPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))
	keyPEM := string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(privateKey)}))
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatalf("parse certificate failed: %v", err)
	}
	sum := sha256.Sum256(cert.Raw)
	return certPEM, keyPEM, fmt.Sprintf("%x", sum[:]), cert
}
