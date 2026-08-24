package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
	"time"
)

func successCommand() string {
	if runtime.GOOS == "windows" {
		return "ver > nul"
	}
	return "true"
}

func withLinuxPrivilegeStubs(t *testing.T, setup func()) {
	t.Helper()
	originalExecuteShellCommandFunc := executeShellCommandFunc
	originalExecuteCommandWithSudoFunc := executeCommandWithSudoFunc
	originalExecuteHelperCommandFunc := executeHelperCommandFunc
	originalProbeSudoNoPasswordFunc := probeSudoNoPasswordFunc
	originalCurrentEUIDFunc := currentEUIDFunc
	originalLookPathFunc := lookPathFunc
	originalCanReadPathFunc := canReadPathFunc
	originalCanWritePathFunc := canWritePathFunc
	originalCanWriteDirFunc := canWriteDirFunc
	originalAtomicWritePEMFileFunc := atomicWritePEMFileFunc
	originalReadFileWithHelperFunc := readFileWithHelperFunc
	originalReadFileWithSudoFunc := readFileWithSudoFunc
	originalRemoveFileWithHelperFunc := removeFileWithHelperFunc
	originalRemoveFileWithSudoFunc := removeFileWithSudoFunc
	originalPathExistsWithHelperFunc := pathExistsWithHelperFunc
	originalPathExistsWithSudoFunc := pathExistsWithSudoFunc
	t.Cleanup(func() {
		executeShellCommandFunc = originalExecuteShellCommandFunc
		executeCommandWithSudoFunc = originalExecuteCommandWithSudoFunc
		executeHelperCommandFunc = originalExecuteHelperCommandFunc
		probeSudoNoPasswordFunc = originalProbeSudoNoPasswordFunc
		currentEUIDFunc = originalCurrentEUIDFunc
		lookPathFunc = originalLookPathFunc
		canReadPathFunc = originalCanReadPathFunc
		canWritePathFunc = originalCanWritePathFunc
		canWriteDirFunc = originalCanWriteDirFunc
		atomicWritePEMFileFunc = originalAtomicWritePEMFileFunc
		readFileWithHelperFunc = originalReadFileWithHelperFunc
		readFileWithSudoFunc = originalReadFileWithSudoFunc
		removeFileWithHelperFunc = originalRemoveFileWithHelperFunc
		removeFileWithSudoFunc = originalRemoveFileWithSudoFunc
		pathExistsWithHelperFunc = originalPathExistsWithHelperFunc
		pathExistsWithSudoFunc = originalPathExistsWithSudoFunc
	})
	if setup != nil {
		setup()
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

func TestExecuteLinuxTaskPayloadDryRunSuccess(t *testing.T) {
	tempDir := t.TempDir()
	certPEM, keyPEM, fingerprint := generateTestPEMMaterial(t)
	payload := map[string]any{
		"type":         "linux.nginx.deploy_certificate",
		"providerType": "NGINX",
		"operation":    "dryRun",
		"bindingSelector": map[string]any{
			"certPath":    filepath.Join(tempDir, "tls", "site.crt"),
			"keyPath":     filepath.Join(tempDir, "tls", "site.key"),
			"listenPort":  443,
			"serverNames": []string{"test.local"},
			"sourceFile":  "/etc/nginx/conf.d/test.conf",
		},
		"artifact": map[string]any{
			"certificatePem":          certPEM,
			"privateKeyPem":           keyPEM,
			"targetFingerprintSha256": fingerprint,
		},
		"executionPolicy": map[string]any{
			"testCommand":   successCommand(),
			"reloadCommand": successCommand(),
			"verifyHost":    "test.local",
			"verifyPort":    443,
			"hostHeader":    "test.local",
			"verifyUrl":     "https://test.local:443",
		},
	}
	if err := os.MkdirAll(filepath.Join(tempDir, "tls"), 0o755); err != nil {
		t.Fatalf("mkdir tls failed: %v", err)
	}

	success, errorCode, errorMessage, detail := executeLinuxTaskPayload("task_dry_run_success", payload)
	if !success {
		t.Fatalf("expected dry-run success, got code=%s message=%s detail=%v", errorCode, errorMessage, detail)
	}
	if detail["mode"] != "nginx_dry_run_preflight" {
		t.Fatalf("expected nginx_dry_run_preflight mode, got %v", detail["mode"])
	}
	summary, ok := detail["dryRunSummary"].(map[string]int)
	if !ok {
		t.Fatalf("expected dryRunSummary, got %#v", detail["dryRunSummary"])
	}
	if summary["failed"] != 0 {
		t.Fatalf("expected no failed dry-run checks, got %+v", summary)
	}
	privilege, ok := detail["privilegeAssessment"].(map[string]any)
	if !ok {
		t.Fatalf("expected privilegeAssessment, got %#v", detail["privilegeAssessment"])
	}
	if privilege["certPath"] == nil || privilege["keyPath"] == nil {
		t.Fatalf("expected cert/key privilege state, got %#v", privilege)
	}
}

func TestInspectNginxBindingPermissionIncludesFileAndCommandState(t *testing.T) {
	tempDir := t.TempDir()
	targetDir := filepath.Join(tempDir, "tls")
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		t.Fatalf("mkdir target dir failed: %v", err)
	}
	permission := inspectNginxBindingPermission(nginxBindingDetail{
		CertificatePath:    filepath.Join(targetDir, "site.crt"),
		CertificateKeyPath: filepath.Join(targetDir, "site.key"),
	}, successCommand(), successCommand())
	if permission["certPath"] == nil {
		t.Fatalf("expected certPath state")
	}
	if permission["keyPath"] == nil {
		t.Fatalf("expected keyPath state")
	}
	if permission["testCommand"] == nil || permission["reloadCommand"] == nil {
		t.Fatalf("expected command privilege summaries, got %#v", permission)
	}
	if _, ok := permission["privilegeMode"].(string); !ok {
		t.Fatalf("expected privilegeMode string, got %#v", permission["privilegeMode"])
	}
}

func TestProbeSudoNoPasswordSkipsWhenRunningAsRoot(t *testing.T) {
	withLinuxPrivilegeStubs(t, func() {
		currentEUIDFunc = func() int { return 0 }
	})

	available, detail := probeSudoNoPassword()
	if available {
		t.Fatalf("expected sudo to be skipped for root")
	}
	if detail["skipped"] != true {
		t.Fatalf("expected skipped sudo detail for root, got %#v", detail)
	}
}

func TestEvaluateCommandExecutionPrivilegeDoesNotRequireSudoForRootFailure(t *testing.T) {
	withLinuxPrivilegeStubs(t, func() {
		currentEUIDFunc = func() int { return 0 }
		executeShellCommandFunc = func(command string, timeout time.Duration) (*CommandResult, error) {
			return &CommandResult{
				Command:  "/bin/sh",
				Args:     []string{"-lc", command},
				ExitCode: 1,
				Success:  false,
				Stderr:   "nginx: [emerg] invalid config",
			}, errors.New("exit status 1")
		}
		executeCommandWithSudoFunc = func(command string, withTimeout bool) (*CommandResult, string, error) {
			t.Fatalf("root command check must not invoke sudo")
			return nil, "", nil
		}
	})

	check, privilege := evaluateCommandExecutionPrivilege("test_command_execution", "NGINX 测试命令权限", "nginx -t", false)
	if check["status"] != "failed" {
		t.Fatalf("expected failed command check, got %#v", check)
	}
	if privilege["needsPrivilege"] != false {
		t.Fatalf("root command failure must not be marked as privilege-required, got %#v", privilege)
	}
	if privilege["mode"] != "direct" {
		t.Fatalf("expected direct root execution mode, got %#v", privilege)
	}
}

func TestEvaluateCommandExecutionPrivilegeAttemptsCommandSpecificSudoWhenGenericProbeUnavailable(t *testing.T) {
	withLinuxPrivilegeStubs(t, func() {
		currentEUIDFunc = func() int { return 1000 }
		lookPathFunc = func(name string) bool { return name == "sudo" }
		executeShellCommandFunc = func(command string, timeout time.Duration) (*CommandResult, error) {
			return &CommandResult{
				Command:  "/bin/sh",
				Args:     []string{"-lc", command},
				ExitCode: 1,
				Success:  false,
				Stderr:   "permission denied",
			}, errors.New("exit status 1")
		}
		executeCommandWithSudoFunc = func(command string, withTimeout bool) (*CommandResult, string, error) {
			if command != "/usr/sbin/nginx -t" {
				t.Fatalf("unexpected sudo command: %s", command)
			}
			return &CommandResult{
				Command:  "sudo",
				Args:     []string{"-n", "--", "/usr/sbin/nginx", "-t"},
				ExitCode: 0,
				Success:  true,
			}, "sudo", nil
		}
	})

	check, privilege := evaluateCommandExecutionPrivilege("test_command_execution", "NGINX 测试命令权限", "/usr/sbin/nginx -t", false)
	if check["status"] != "warning" {
		t.Fatalf("expected warning command check, got %#v", check)
	}
	if privilege["needsPrivilege"] != true {
		t.Fatalf("expected sudo-required privilege, got %#v", privilege)
	}
	if privilege["mode"] != "sudo" {
		t.Fatalf("expected sudo mode, got %#v", privilege)
	}
}

func TestEvaluateLinuxNginxPrivilegeChecksTreatsCommandScopedSudoAsReady(t *testing.T) {
	tempDir := t.TempDir()
	certPath := filepath.Join(tempDir, "site.crt")
	keyPath := filepath.Join(tempDir, "site.key")
	if err := os.WriteFile(certPath, []byte("cert"), 0o644); err != nil {
		t.Fatalf("write cert failed: %v", err)
	}
	if err := os.WriteFile(keyPath, []byte("key"), 0o600); err != nil {
		t.Fatalf("write key failed: %v", err)
	}

	withLinuxPrivilegeStubs(t, func() {
		currentEUIDFunc = func() int { return 1000 }
		probeSudoNoPasswordFunc = func() (bool, map[string]any) {
			return false, map[string]any{"available": false, "reason": "command-scoped whitelist only"}
		}
		lookPathFunc = func(name string) bool { return name == "sudo" }
		canReadPathFunc = func(path string) bool { return true }
		canWritePathFunc = func(path string) bool { return true }
		canWriteDirFunc = func(path string) bool { return true }
		executeShellCommandFunc = func(command string, timeout time.Duration) (*CommandResult, error) {
			return &CommandResult{
				Command:  "/bin/sh",
				Args:     []string{"-lc", command},
				ExitCode: 1,
				Success:  false,
				Stderr:   "permission denied",
			}, errors.New("exit status 1")
		}
		executeCommandWithSudoFunc = func(command string, withTimeout bool) (*CommandResult, string, error) {
			if command != "/usr/sbin/nginx -t" && command != "/usr/bin/systemctl reload nginx" {
				t.Fatalf("unexpected sudo command: %s", command)
			}
			return &CommandResult{
				Command:  "sudo",
				Args:     []string{"-n", "--"},
				ExitCode: 0,
				Success:  true,
			}, "sudo", nil
		}
	})

	privilege, checks := evaluateLinuxNginxPrivilegeChecks(linuxNginxDeployInput{
		BindingSelector: linuxNginxBindingSelector{
			CertPath: certPath,
			KeyPath:  keyPath,
		},
		ExecutionPolicy: linuxNginxExecutionPolicy{
			TestCommand:   "/usr/sbin/nginx -t",
			ReloadCommand: "/usr/bin/systemctl reload nginx",
		},
	})

	if privilege["privilegeMode"] != "sudo-n" {
		t.Fatalf("expected sudo-n privilegeMode, got %#v", privilege)
	}
	if privilege["helperRequired"] != false {
		t.Fatalf("command-scoped sudo should not require helper, got %#v", privilege)
	}

	var sudoCheck map[string]any
	var helperCheck map[string]any
	for _, check := range checks {
		if check["key"] == "sudo_non_interactive_available" {
			sudoCheck = check
		}
		if check["key"] == "helper_command_available" {
			helperCheck = check
		}
	}
	if sudoCheck == nil || sudoCheck["status"] != "passed" {
		t.Fatalf("expected sudo availability check to pass for command-scoped whitelist, got %#v", sudoCheck)
	}
	if helperCheck == nil || helperCheck["status"] != "passed" {
		t.Fatalf("expected helper check to be informational pass when helper is unused, got %#v", helperCheck)
	}
}

func TestEvaluateWriteTargetCheckUsesRealAccessInsteadOfModeBits(t *testing.T) {
	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "site.key")
	if err := os.WriteFile(targetPath, []byte("key"), 0o666); err != nil {
		t.Fatalf("write target failed: %v", err)
	}

	withLinuxPrivilegeStubs(t, func() {
		canReadPathFunc = func(path string) bool { return true }
		canWritePathFunc = func(path string) bool { return false }
		canWriteDirFunc = func(path string) bool { return true }
	})

	check := evaluateWriteTargetCheck("key_path_access", "私钥文件写入权限", targetPath, nil)
	if check["status"] != "failed" {
		t.Fatalf("expected failed write check when direct write probe fails, got %#v", check)
	}
}

func TestEvaluateWriteTargetCheckPassesWhenHelperProvidesEffectiveWrite(t *testing.T) {
	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "site.key")
	if err := os.WriteFile(targetPath, []byte("key"), 0o600); err != nil {
		t.Fatalf("write target failed: %v", err)
	}

	withLinuxPrivilegeStubs(t, func() {
		canReadPathFunc = func(path string) bool { return true }
		canWritePathFunc = func(path string) bool { return false }
		canWriteDirFunc = func(path string) bool { return false }
	})

	check := evaluateWriteTargetCheck("key_path_access", "私钥文件写入权限", targetPath, map[string]any{
		"filePrivilege": map[string]any{
			"filePrivilegeMode": "helper",
		},
	})
	if check["status"] != "passed" {
		t.Fatalf("expected passed write check when helper can write, got %#v", check)
	}
}

func TestEvaluateBackupPreconditionCheckPassesWhenHelperProvidesEffectiveWrite(t *testing.T) {
	state := linuxNginxTargetFileState{
		path:              "/etc/gcac-test/certs/site.key",
		parentDir:         "/etc/gcac-test/certs",
		parentDirWritable: false,
	}
	check := evaluateBackupPreconditionCheck("key_backup_precondition", "私钥文件备份前置条件", state, map[string]any{
		"filePrivilege": map[string]any{
			"filePrivilegeMode": "helper",
		},
	})
	if check["status"] != "passed" {
		t.Fatalf("expected passed backup precondition when helper can write, got %#v", check)
	}
}

func TestInspectPrivateKeyFileStateFallsBackToHelperRead(t *testing.T) {
	tempDir := t.TempDir()
	_, keyPEM, _ := generateTestPEMMaterial(t)
	keyPath := filepath.Join(tempDir, "site.key")
	if err := os.WriteFile(keyPath, []byte(keyPEM), 0o600); err != nil {
		t.Fatalf("write key failed: %v", err)
	}

	withLinuxPrivilegeStubs(t, func() {
		canReadPathFunc = func(path string) bool { return false }
		canWritePathFunc = func(path string) bool { return false }
		canWriteDirFunc = func(path string) bool { return true }
		readFileWithHelperFunc = func(path string, helperCommand string) ([]byte, error) {
			if path != keyPath {
				t.Fatalf("unexpected helper read path: %s", path)
			}
			if helperCommand != "/usr/local/libexec/gcac-nginx-helper" {
				t.Fatalf("unexpected helper command: %s", helperCommand)
			}
			return []byte(keyPEM), nil
		}
	})

	state := inspectPrivateKeyFileState(keyPath, nil, "/usr/local/libexec/gcac-nginx-helper")
	if !state.readable {
		t.Fatalf("expected helper read to mark file readable")
	}
	if state.directReadable {
		t.Fatalf("expected directReadable=false when helper fallback is used")
	}
	if state.privateKeyType == "" {
		t.Fatalf("expected privateKeyType to be parsed via helper fallback")
	}
}

func TestWriteFileWithHelperUsesSudoHelper(t *testing.T) {
	targetPath := "/etc/gcac-test/certs/site.key"
	withLinuxPrivilegeStubs(t, func() {
		executeHelperCommandFunc = func(helperCommand string, helperArgs []string, stdin []byte, timeout time.Duration) (*CommandResult, error) {
			if helperCommand != "/usr/local/libexec/gcac-nginx-helper" {
				t.Fatalf("unexpected helper command: %s", helperCommand)
			}
			expectedArgs := []string{"write-file", filepath.Clean(targetPath), "600"}
			if len(helperArgs) != len(expectedArgs) {
				t.Fatalf("unexpected helper args: %#v", helperArgs)
			}
			for index := range expectedArgs {
				if helperArgs[index] != expectedArgs[index] {
					t.Fatalf("unexpected helper args: %#v", helperArgs)
				}
			}
			if string(stdin) != "PRIVATE-KEY" {
				t.Fatalf("unexpected helper stdin: %q", string(stdin))
			}
			return &CommandResult{Command: "sudo", ExitCode: 0, Success: true}, nil
		}
	})

	mode, err := writeFileWithHelper(targetPath, []byte("PRIVATE-KEY"), "/usr/local/libexec/gcac-nginx-helper")
	if err != nil {
		t.Fatalf("expected helper write success, got %v", err)
	}
	if mode != "helper" {
		t.Fatalf("expected helper mode, got %s", mode)
	}
}

func TestBackupTargetFileFallsBackToHelperRead(t *testing.T) {
	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "tls", "site.key")
	backupDir := filepath.Join(tempDir, "backup")
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		t.Fatalf("mkdir backup dir failed: %v", err)
	}

	withLinuxPrivilegeStubs(t, func() {
		pathExistsWithHelperFunc = func(path string, helperCommand string) (bool, error) {
			if path != targetPath {
				t.Fatalf("unexpected helper exists path: %s", path)
			}
			return true, nil
		}
		readFileWithHelperFunc = func(path string, helperCommand string) ([]byte, error) {
			if path != targetPath {
				t.Fatalf("unexpected helper read path: %s", path)
			}
			return []byte("PRIVATE-KEY"), nil
		}
	})

	ref, err := backupTargetFile(backupDir, targetPath, "key", "/usr/local/libexec/gcac-nginx-helper")
	if err != nil {
		t.Fatalf("expected helper backup success, got %v", err)
	}
	if ref.UsedPrivilege != "helper" {
		t.Fatalf("expected helper backup privilege, got %s", ref.UsedPrivilege)
	}
	if !ref.Existed || ref.BackupPath == "" {
		t.Fatalf("expected helper backup file to be created, got %#v", ref)
	}
}

func TestEvaluateLinuxNginxPrivilegeChecksTreatsRootAsPrivilegedReady(t *testing.T) {
	tempDir := t.TempDir()
	certPath := filepath.Join(tempDir, "site.crt")
	keyPath := filepath.Join(tempDir, "site.key")
	if err := os.WriteFile(certPath, []byte("old-cert"), 0o600); err != nil {
		t.Fatalf("write cert failed: %v", err)
	}
	if err := os.WriteFile(keyPath, []byte("old-key"), 0o600); err != nil {
		t.Fatalf("write key failed: %v", err)
	}

	withLinuxPrivilegeStubs(t, func() {
		currentEUIDFunc = func() int { return 0 }
		probeSudoNoPasswordFunc = func() (bool, map[string]any) {
			return false, map[string]any{"skipped": true}
		}
		executeShellCommandFunc = func(command string, timeout time.Duration) (*CommandResult, error) {
			return &CommandResult{
				Command:  "/bin/sh",
				Args:     []string{"-lc", command},
				ExitCode: 1,
				Success:  false,
				Stderr:   "nginx: [emerg] invalid config",
			}, errors.New("exit status 1")
		}
		executeCommandWithSudoFunc = func(command string, withTimeout bool) (*CommandResult, string, error) {
			t.Fatalf("root privilege assessment must not invoke sudo")
			return nil, "", nil
		}
	})

	privilege, checks := evaluateLinuxNginxPrivilegeChecks(linuxNginxDeployInput{
		BindingSelector: linuxNginxBindingSelector{
			CertPath: certPath,
			KeyPath:  keyPath,
		},
		ExecutionPolicy: linuxNginxExecutionPolicy{
			TestCommand:   "nginx -t",
			ReloadCommand: "systemctl reload nginx",
		},
	})

	if privilege["privilegeMode"] == "helper-required" {
		t.Fatalf("root must not be reported as helper-required, got %#v", privilege)
	}
	if privilege["helperRequired"] != false {
		t.Fatalf("root must not require helper, got %#v", privilege)
	}
	if len(checks) == 0 {
		t.Fatalf("expected dry-run checks")
	}
	var sudoCheck map[string]any
	for _, check := range checks {
		if check["key"] == "sudo_non_interactive_available" {
			sudoCheck = check
			break
		}
	}
	if sudoCheck == nil || sudoCheck["status"] != "passed" {
		t.Fatalf("expected root sudo check to pass, got %#v", sudoCheck)
	}
}

func TestBuildSudoCommandArgsUsesDirectExecForSimpleCommand(t *testing.T) {
	args, err := buildSudoCommandArgs("/usr/sbin/nginx -t")
	if err != nil {
		t.Fatalf("build sudo args failed: %v", err)
	}
	expected := []string{"sudo", "-n", "--", "/usr/sbin/nginx", "-t"}
	if len(args) != len(expected) {
		t.Fatalf("unexpected args length: %#v", args)
	}
	for index := range expected {
		if args[index] != expected[index] {
			t.Fatalf("unexpected sudo args: %#v", args)
		}
	}
}

func TestExecuteLinuxTaskPayloadDryRunReportsBlockers(t *testing.T) {
	payload := map[string]any{
		"type":         "linux.nginx.deploy_certificate",
		"providerType": "NGINX",
		"operation":    "dryRun",
		"bindingSelector": map[string]any{
			"certPath":   "relative/site.crt",
			"keyPath":    "",
			"listenPort": 0,
		},
		"artifact": map[string]any{
			"certificatePem": "bad-cert",
			"privateKeyPem":  "bad-key",
		},
		"executionPolicy": map[string]any{
			"testCommand":   "",
			"reloadCommand": "",
		},
	}

	success, errorCode, _, detail := executeLinuxTaskPayload("task_dry_run_failed", payload)
	if success {
		t.Fatalf("expected dry-run failure, got success detail=%v", detail)
	}
	if errorCode != "NGINX_DRY_RUN_FAILED" {
		t.Fatalf("expected NGINX_DRY_RUN_FAILED, got %s", errorCode)
	}
	blockers, ok := detail["blockers"].([]map[string]any)
	if ok {
		if len(blockers) == 0 {
			t.Fatalf("expected blockers to be populated")
		}
	} else {
		raw, castOK := detail["blockers"].([]any)
		if !castOK || len(raw) == 0 {
			t.Fatalf("expected blockers to be populated, got %#v", detail["blockers"])
		}
	}
}

func TestDirectControlExecuteActionSupportsLinuxNginxDryRun(t *testing.T) {
	tempDir := t.TempDir()
	certPEM, keyPEM, fingerprint := generateTestPEMMaterial(t)
	requestBody := map[string]any{
		"actionType": "linux.nginx.deploy_certificate",
		"requestId":  "req_nginx_direct",
		"inputs": map[string]any{
			"type":         "linux.nginx.deploy_certificate",
			"providerType": "NGINX",
			"operation":    "dryRun",
			"bindingSelector": map[string]any{
				"certPath":    filepath.Join(tempDir, "tls", "site.crt"),
				"keyPath":     filepath.Join(tempDir, "tls", "site.key"),
				"listenPort":  443,
				"serverNames": []string{"direct.local"},
			},
			"artifact": map[string]any{
				"certificatePem":          certPEM,
				"privateKeyPem":           keyPEM,
				"targetFingerprintSha256": fingerprint,
			},
			"executionPolicy": map[string]any{
				"testCommand":   successCommand(),
				"reloadCommand": successCommand(),
				"verifyHost":    "direct.local",
				"verifyPort":    443,
			},
		},
	}
	if err := os.MkdirAll(filepath.Join(tempDir, "tls"), 0o755); err != nil {
		t.Fatalf("mkdir tls failed: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/v1/control/actions/execute", func(w http.ResponseWriter, r *http.Request) {
		var request directActionExecuteRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatalf("decode request failed: %v", err)
		}
		response, statusCode := executeDirectControlAction(request)
		w.WriteHeader(statusCode)
		if err := json.NewEncoder(w).Encode(response); err != nil {
			t.Fatalf("encode response failed: %v", err)
		}
	})

	server := httptest.NewServer(mux)
	defer server.Close()

	response, err := http.Post(server.URL+"/api/v1/control/actions/execute", "application/json", strings.NewReader(mustMarshalJSON(t, requestBody)))
	if err != nil {
		t.Fatalf("post direct action failed: %v", err)
	}
	defer response.Body.Close()

	var body map[string]any
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode response body failed: %v", err)
	}
	if response.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d body=%v", response.StatusCode, body)
	}
	if body["success"] != true {
		t.Fatalf("expected success=true, got body=%v", body)
	}
	if body["actionType"] != "linux.nginx.deploy_certificate" {
		t.Fatalf("unexpected actionType: %v", body["actionType"])
	}
}

func TestExecuteLinuxTaskPayloadDryRunDetectsCurrentFilesMatchTarget(t *testing.T) {
	tempDir := t.TempDir()
	certPEM, keyPEM, fingerprint := generateTestPEMMaterial(t)
	targetDir := filepath.Join(tempDir, "tls")
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		t.Fatalf("mkdir target dir failed: %v", err)
	}
	certPath := filepath.Join(targetDir, "site.crt")
	keyPath := filepath.Join(targetDir, "site.key")
	if err := os.WriteFile(certPath, []byte(certPEM), 0o644); err != nil {
		t.Fatalf("write cert failed: %v", err)
	}
	if err := os.WriteFile(keyPath, []byte(keyPEM), 0o600); err != nil {
		t.Fatalf("write key failed: %v", err)
	}

	payload := map[string]any{
		"type":         "linux.nginx.deploy_certificate",
		"providerType": "NGINX",
		"operation":    "dryRun",
		"bindingSelector": map[string]any{
			"certPath":    certPath,
			"keyPath":     keyPath,
			"listenPort":  443,
			"serverNames": []string{"match.local"},
			"sourceFile":  filepath.Join(tempDir, "nginx.conf"),
		},
		"artifact": map[string]any{
			"certificatePem":          certPEM,
			"privateKeyPem":           keyPEM,
			"targetFingerprintSha256": fingerprint,
		},
		"executionPolicy": map[string]any{
			"testCommand":   successCommand(),
			"reloadCommand": successCommand(),
			"verifyHost":    "match.local",
			"verifyPort":    443,
		},
	}
	if err := os.WriteFile(filepath.Join(tempDir, "nginx.conf"), []byte("server {}"), 0o644); err != nil {
		t.Fatalf("write source file failed: %v", err)
	}

	success, _, _, detail := executeLinuxTaskPayload("task_dry_run_current_match", payload)
	if !success {
		t.Fatalf("expected dry-run success, got detail=%v", detail)
	}
	currentState, ok := detail["currentState"].(map[string]any)
	if !ok {
		t.Fatalf("expected currentState, got %#v", detail["currentState"])
	}
	certFile, ok := currentState["certFile"].(map[string]any)
	if !ok || certFile["matchesTarget"] != true {
		t.Fatalf("expected certFile.matchesTarget=true, got %#v", currentState["certFile"])
	}
	keyFile, ok := currentState["keyFile"].(map[string]any)
	if !ok || keyFile["matchesTarget"] != true {
		t.Fatalf("expected keyFile.matchesTarget=true, got %#v", currentState["keyFile"])
	}
}

func TestExecuteLinuxTaskPayloadDryRunWarnsWhenSourceFileMissing(t *testing.T) {
	tempDir := t.TempDir()
	certPEM, keyPEM, fingerprint := generateTestPEMMaterial(t)
	targetDir := filepath.Join(tempDir, "tls")
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		t.Fatalf("mkdir target dir failed: %v", err)
	}

	payload := map[string]any{
		"type":         "linux.nginx.deploy_certificate",
		"providerType": "NGINX",
		"operation":    "dryRun",
		"bindingSelector": map[string]any{
			"certPath":    filepath.Join(targetDir, "site.crt"),
			"keyPath":     filepath.Join(targetDir, "site.key"),
			"listenPort":  443,
			"serverNames": []string{"warn.local"},
			"sourceFile":  filepath.Join(tempDir, "missing.conf"),
		},
		"artifact": map[string]any{
			"certificatePem":          certPEM,
			"privateKeyPem":           keyPEM,
			"targetFingerprintSha256": fingerprint,
		},
		"executionPolicy": map[string]any{
			"testCommand":   successCommand(),
			"reloadCommand": successCommand(),
			"verifyHost":    "warn.local",
			"verifyPort":    443,
		},
	}

	success, _, _, detail := executeLinuxTaskPayload("task_dry_run_source_warning", payload)
	if !success {
		t.Fatalf("expected dry-run success with warning, got detail=%v", detail)
	}
	warnings, ok := detail["warnings"].([]map[string]any)
	if ok {
		if len(warnings) == 0 {
			t.Fatalf("expected warnings to be populated")
		}
		return
	}
	raw, castOK := detail["warnings"].([]any)
	if !castOK || len(raw) == 0 {
		t.Fatalf("expected warnings to be populated, got %#v", detail["warnings"])
	}
}

func TestExecuteLinuxTaskPayloadInstallSuccess(t *testing.T) {
	tempDir := t.TempDir()
	certPEM, keyPEM, fingerprint := generateTestPEMMaterialForHost(t, "install.local")
	targetDir := filepath.Join(tempDir, "tls")
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		t.Fatalf("mkdir target dir failed: %v", err)
	}

	payload := map[string]any{
		"type":           "linux.nginx.deploy_certificate",
		"providerType":   "NGINX",
		"operation":      "install",
		"executionRunId": "run_install_success",
		"bindingSelector": map[string]any{
			"bindingId":   "binding-install-success",
			"certPath":    filepath.Join(targetDir, "site.crt"),
			"keyPath":     filepath.Join(targetDir, "site.key"),
			"listenPort":  443,
			"serverNames": []string{"install.local"},
		},
		"artifact": map[string]any{
			"certificatePem":          certPEM,
			"privateKeyPem":           keyPEM,
			"targetFingerprintSha256": fingerprint,
		},
		"executionPolicy": map[string]any{
			"testCommand":   successCommand(),
			"reloadCommand": successCommand(),
			"verifyHost":    "install.local",
			"verifyPort":    443,
			"hostHeader":    "install.local",
			"verifyUrl":     "https://install.local:443",
		},
	}

	success, errorCode, errorMessage, detail := executeLinuxTaskPayload("task_install_success", payload)
	if !success {
		t.Fatalf("expected install success, got code=%s message=%s detail=%v", errorCode, errorMessage, detail)
	}
	if detail["mode"] != "nginx_install_completed" {
		t.Fatalf("unexpected install mode: %#v", detail["mode"])
	}
	if !fileExists(filepath.Join(targetDir, "site.crt")) || !fileExists(filepath.Join(targetDir, "site.key")) {
		t.Fatalf("expected installed files to exist")
	}
	if detail["installedCertificateSha256"] != fingerprint {
		t.Fatalf("expected installed fingerprint %s, got %v", fingerprint, detail["installedCertificateSha256"])
	}
	installedFile, ok := detail["installedFile"].(map[string]any)
	if !ok {
		t.Fatalf("expected installedFile detail, got %#v", detail["installedFile"])
	}
	certFile, ok := installedFile["certFile"].(map[string]any)
	if !ok || certFile["certificateSha256"] != fingerprint || certFile["matchesTarget"] != true {
		t.Fatalf("expected installed cert file fingerprint match, got %#v", installedFile["certFile"])
	}
}

func TestExecuteLinuxTaskPayloadInstallBackupCanRollback(t *testing.T) {
	tempDir := t.TempDir()
	certPEM, keyPEM, fingerprint := generateTestPEMMaterialForHost(t, "mismatch.local")
	oldCertPEM, oldKeyPEM, _ := generateTestPEMMaterialForHost(t, "old.local")
	targetDir := filepath.Join(tempDir, "tls")
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		t.Fatalf("mkdir target dir failed: %v", err)
	}
	certPath := filepath.Join(targetDir, "site.crt")
	keyPath := filepath.Join(targetDir, "site.key")
	if err := os.WriteFile(certPath, []byte(oldCertPEM), 0o644); err != nil {
		t.Fatalf("write old cert failed: %v", err)
	}
	if err := os.WriteFile(keyPath, []byte(oldKeyPEM), 0o600); err != nil {
		t.Fatalf("write old key failed: %v", err)
	}

	installPayload := map[string]any{
		"type":           "linux.nginx.deploy_certificate",
		"providerType":   "NGINX",
		"operation":      "install",
		"executionRunId": "run_install_rollback",
		"bindingSelector": map[string]any{
			"bindingId":   "binding-install-rollback",
			"certPath":    certPath,
			"keyPath":     keyPath,
			"listenPort":  443,
			"serverNames": []string{"mismatch.local"},
		},
		"artifact": map[string]any{
			"certificatePem":          certPEM,
			"privateKeyPem":           keyPEM,
			"targetFingerprintSha256": fingerprint,
		},
		"executionPolicy": map[string]any{
			"testCommand":   successCommand(),
			"reloadCommand": successCommand(),
			"verifyHost":    "public.example.com",
			"verifyPort":    443,
			"hostHeader":    "mismatch.local",
			"verifyUrl":     "https://public.example.com:443",
		},
	}

	success, _, _, installDetail := executeLinuxTaskPayload("task_install_verify_fail_install", installPayload)
	if !success {
		t.Fatalf("expected install success, got detail=%v", installDetail)
	}

	rollbackPayload := map[string]any{
		"type":            "linux.nginx.deploy_certificate",
		"providerType":    "NGINX",
		"operation":       "rollback",
		"bindingSelector": installPayload["bindingSelector"],
		"artifact": map[string]any{
			"certificatePem":          oldCertPEM,
			"privateKeyPem":           oldKeyPEM,
			"targetFingerprintSha256": fingerprint,
		},
		"executionPolicy": map[string]any{
			"testCommand":   "true",
			"reloadCommand": "true",
		},
		"rollbackContext": map[string]any{
			"backupManifestPath": installDetail["backupManifestPath"],
		},
	}
	success, errorCode, errorMessage, rollbackDetail := executeLinuxTaskPayload("task_install_verify_fail_rollback", rollbackPayload)
	if !success {
		t.Fatalf("expected rollback success, got code=%s message=%s detail=%v", errorCode, errorMessage, rollbackDetail)
	}
	currentCert, err := os.ReadFile(certPath)
	if err != nil {
		t.Fatalf("read cert after rollback failed: %v", err)
	}
	if string(currentCert) != oldCertPEM {
		t.Fatalf("expected old cert restored after rollback")
	}
}

func TestExecuteLinuxTaskPayloadRollbackRestoresBackupManifest(t *testing.T) {
	tempDir := t.TempDir()
	oldCertPEM, oldKeyPEM, _ := generateTestPEMMaterialForHost(t, "rollback-old.local")
	newCertPEM, newKeyPEM, fingerprint := generateTestPEMMaterialForHost(t, "rollback-new.local")
	targetDir := filepath.Join(tempDir, "tls")
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		t.Fatalf("mkdir target dir failed: %v", err)
	}
	certPath := filepath.Join(targetDir, "site.crt")
	keyPath := filepath.Join(targetDir, "site.key")
	if err := os.WriteFile(certPath, []byte(oldCertPEM), 0o644); err != nil {
		t.Fatalf("write old cert failed: %v", err)
	}
	if err := os.WriteFile(keyPath, []byte(oldKeyPEM), 0o600); err != nil {
		t.Fatalf("write old key failed: %v", err)
	}

	input := linuxNginxDeployInput{
		Operation: "install",
		BindingSelector: linuxNginxBindingSelector{
			BindingID:   "binding-manifest-restore",
			CertPath:    certPath,
			KeyPath:     keyPath,
			ListenPort:  443,
			ServerNames: []string{"rollback-new.local"},
		},
		Artifact: linuxNginxArtifact{
			CertificatePEM:          newCertPEM,
			PrivateKeyPEM:           newKeyPEM,
			TargetFingerprintSHA256: fingerprint,
		},
		ExecutionPolicy: linuxNginxExecutionPolicy{
			TestCommand:   successCommand(),
			ReloadCommand: successCommand(),
		},
		ExecutionRunID: "run_manifest_restore",
	}
	manifest, detail, err := createLinuxNginxBackupManifest("task_manifest_restore", input)
	if err != nil {
		t.Fatalf("create manifest failed: %v detail=%v", err, detail)
	}
	if err := os.WriteFile(certPath, []byte(newCertPEM), 0o644); err != nil {
		t.Fatalf("write new cert failed: %v", err)
	}
	if err := os.WriteFile(keyPath, []byte(newKeyPEM), 0o600); err != nil {
		t.Fatalf("write new key failed: %v", err)
	}

	payload := map[string]any{
		"type":         "linux.nginx.deploy_certificate",
		"providerType": "NGINX",
		"operation":    "rollback",
		"bindingSelector": map[string]any{
			"bindingId":   "binding-manifest-restore",
			"certPath":    certPath,
			"keyPath":     keyPath,
			"listenPort":  443,
			"serverNames": []string{"rollback-old.local"},
		},
		"artifact": map[string]any{
			"certificatePem":          oldCertPEM,
			"privateKeyPem":           oldKeyPEM,
			"targetFingerprintSha256": fingerprint,
		},
		"executionPolicy": map[string]any{
			"testCommand":   successCommand(),
			"reloadCommand": successCommand(),
		},
		"rollbackContext": map[string]any{
			"backupManifestPath": resolveManifestPathFromManifest(manifest),
		},
	}

	success, errorCode, errorMessage, detail2 := executeLinuxTaskPayload("task_rollback_restore", payload)
	if !success {
		t.Fatalf("expected rollback success, got code=%s message=%s detail=%v", errorCode, errorMessage, detail2)
	}
	currentCert, err := os.ReadFile(certPath)
	if err != nil {
		t.Fatalf("read cert after rollback failed: %v", err)
	}
	if string(currentCert) != oldCertPEM {
		t.Fatalf("expected rollback to restore original cert")
	}
}

func TestExecuteLinuxTaskPayloadRollbackDelegatesVerifyToControlPlane(t *testing.T) {
	tempDir := t.TempDir()
	oldCertPEM, oldKeyPEM, oldFingerprint := generateTestPEMMaterialForHost(t, "rollback-verify-old.local")
	newCertPEM, newKeyPEM, newFingerprint := generateTestPEMMaterialForHost(t, "rollback-verify-new.local")
	targetDir := filepath.Join(tempDir, "tls")
	if err := os.MkdirAll(targetDir, 0o755); err != nil {
		t.Fatalf("mkdir target dir failed: %v", err)
	}
	certPath := filepath.Join(targetDir, "site.crt")
	keyPath := filepath.Join(targetDir, "site.key")
	if err := os.WriteFile(certPath, []byte(oldCertPEM), 0o644); err != nil {
		t.Fatalf("write old cert failed: %v", err)
	}
	if err := os.WriteFile(keyPath, []byte(oldKeyPEM), 0o600); err != nil {
		t.Fatalf("write old key failed: %v", err)
	}

	input := linuxNginxDeployInput{
		Operation: "install",
		BindingSelector: linuxNginxBindingSelector{
			BindingID:   "binding-rollback-verify",
			CertPath:    certPath,
			KeyPath:     keyPath,
			ListenPort:  443,
			ServerNames: []string{"rollback-verify-new.local"},
		},
		Artifact: linuxNginxArtifact{
			CertificatePEM:          newCertPEM,
			PrivateKeyPEM:           newKeyPEM,
			TargetFingerprintSHA256: newFingerprint,
		},
		ExecutionPolicy: linuxNginxExecutionPolicy{
			TestCommand:   successCommand(),
			ReloadCommand: successCommand(),
		},
		ExecutionRunID: "run_rollback_verify_fingerprint",
	}
	manifest, detail, err := createLinuxNginxBackupManifest("task_rollback_verify_manifest", input)
	if err != nil {
		t.Fatalf("create manifest failed: %v detail=%v", err, detail)
	}
	if manifest.CertBackup.CertificateFingerprintSHA256 != oldFingerprint {
		t.Fatalf("expected backup cert fingerprint %s, got %s", oldFingerprint, manifest.CertBackup.CertificateFingerprintSHA256)
	}
	if err := os.WriteFile(certPath, []byte(newCertPEM), 0o644); err != nil {
		t.Fatalf("write new cert failed: %v", err)
	}
	if err := os.WriteFile(keyPath, []byte(newKeyPEM), 0o600); err != nil {
		t.Fatalf("write new key failed: %v", err)
	}

	payload := map[string]any{
		"type":         "linux.nginx.deploy_certificate",
		"providerType": "NGINX",
		"operation":    "rollback",
		"bindingSelector": map[string]any{
			"bindingId":   "binding-rollback-verify",
			"certPath":    certPath,
			"keyPath":     keyPath,
			"listenPort":  443,
			"serverNames": []string{"rollback-verify-old.local"},
		},
		"artifact": map[string]any{
			"certificatePem":          oldCertPEM,
			"privateKeyPem":           oldKeyPEM,
			"targetFingerprintSha256": newFingerprint,
		},
		"executionPolicy": map[string]any{
			"testCommand":   successCommand(),
			"reloadCommand": successCommand(),
			"verifyHost":    "public.example.com",
			"verifyPort":    443,
			"hostHeader":    "rollback-verify-old.local",
			"verifyUrl":     "https://public.example.com:443",
		},
		"rollbackContext": map[string]any{
			"backupManifestPath": resolveManifestPathFromManifest(manifest),
		},
	}

	success, errorCode, errorMessage, rollbackDetail := executeLinuxTaskPayload("task_rollback_verify_fingerprint", payload)
	if !success {
		t.Fatalf("expected rollback success, got code=%s message=%s detail=%v", errorCode, errorMessage, rollbackDetail)
	}
	verify := rollbackDetail["verify"].(map[string]any)
	if verify["delegatedTo"] != "control-plane" {
		t.Fatalf("expected rollback verify delegated to control-plane, got %v", verify["delegatedTo"])
	}
	if verify["expectedCertificateSha256"] != oldFingerprint {
		t.Fatalf("expected rollback delegated fingerprint %s, got %v", oldFingerprint, verify["expectedCertificateSha256"])
	}
}

func TestExecuteLinuxTaskPayloadVerifyDelegatesRemoteTLSCheck(t *testing.T) {
	_, _, fingerprint := generateTestPEMMaterialForHost(t, "test.local")
	payload := map[string]any{
		"type":         "linux.nginx.deploy_certificate",
		"providerType": "NGINX",
		"operation":    "verify",
		"bindingSelector": map[string]any{
			"certPath":    "/etc/nginx/test.crt",
			"keyPath":     "/etc/nginx/test.key",
			"listenPort":  443,
			"serverNames": []string{"test.local"},
		},
		"artifact": map[string]any{
			"certificatePem":          "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----\n",
			"privateKeyPem":           "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
			"targetFingerprintSha256": fingerprint,
		},
		"executionPolicy": map[string]any{
			"verifyHost": "gcac-nonexistent.invalid",
			"verifyPort": 443,
			"hostHeader": "test.local",
			"verifyUrl":  "https://gcac-nonexistent.invalid:443",
		},
	}
	success, errorCode, errorMessage, detail := executeLinuxTaskPayload("task_verify_delegated", payload)
	if !success {
		t.Fatalf("expected delegated verify success, got code=%s message=%s detail=%v", errorCode, errorMessage, detail)
	}
	verify := detail["verify"].(map[string]any)
	if verify["delegatedTo"] != "control-plane" {
		t.Fatalf("expected verify delegated to control-plane, got %v", verify["delegatedTo"])
	}
	if verify["remoteCertificateSha256"] != nil {
		t.Fatalf("agent must not return remote certificate fingerprint, got %v", verify["remoteCertificateSha256"])
	}
}

func TestAtomicWritePEMFileWithPrivilegeFallsBackToSudo(t *testing.T) {
	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "tls", "site.crt")
	withLinuxPrivilegeStubs(t, func() {
		atomicWritePEMFileFunc = func(targetPath string, content []byte) error {
			return os.ErrPermission
		}
		executeCommandWithSudoFunc = func(command string, withTimeout bool) (*CommandResult, string, error) {
			if !strings.Contains(command, "base64 -d") || !strings.Contains(command, filepath.Base(targetPath)) {
				t.Fatalf("unexpected sudo command: %s", command)
			}
			return &CommandResult{Command: "sudo", ExitCode: 0, Success: true}, "sudo", nil
		}
	})
	mode, err := atomicWritePEMFileWithPrivilege(targetPath, []byte("CERT"), linuxNginxDeployInput{})
	if err != nil {
		t.Fatalf("expected sudo fallback success, got %v", err)
	}
	if mode != "sudo" {
		t.Fatalf("expected sudo mode, got %s", mode)
	}
}

func TestBackupTargetFileFallsBackToSudoRead(t *testing.T) {
	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "tls", "site.key")
	backupDir := filepath.Join(tempDir, "backup")
	if err := os.MkdirAll(backupDir, 0o755); err != nil {
		t.Fatalf("mkdir backup dir failed: %v", err)
	}
	withLinuxPrivilegeStubs(t, func() {
		pathExistsWithSudoFunc = func(path string) (bool, error) {
			if path != targetPath {
				t.Fatalf("unexpected pathExistsWithSudo path: %s", path)
			}
			return true, nil
		}
		readFileWithSudoFunc = func(path string) ([]byte, error) {
			if path != targetPath {
				t.Fatalf("unexpected readFileWithSudo path: %s", path)
			}
			return []byte("PRIVATE-KEY"), nil
		}
	})
	ref, err := backupTargetFile(backupDir, targetPath, "key", "")
	if err != nil {
		t.Fatalf("expected backup success, got %v", err)
	}
	if ref.UsedPrivilege != "sudo" {
		t.Fatalf("expected sudo backup privilege, got %s", ref.UsedPrivilege)
	}
	if !ref.Existed || ref.BackupPath == "" {
		t.Fatalf("expected backup file to be created, got %#v", ref)
	}
	content, err := os.ReadFile(ref.BackupPath)
	if err != nil {
		t.Fatalf("read backup path failed: %v", err)
	}
	if string(content) != "PRIVATE-KEY" {
		t.Fatalf("unexpected backup content: %s", string(content))
	}
}

func TestRestoreBackupFileWithPrivilegeRemovesTargetViaSudo(t *testing.T) {
	tempDir := t.TempDir()
	targetPath := filepath.Join(tempDir, "tls", "site.key")
	withLinuxPrivilegeStubs(t, func() {
		pathExistsWithSudoFunc = func(path string) (bool, error) {
			if path != targetPath {
				t.Fatalf("unexpected pathExistsWithSudo path: %s", path)
			}
			return true, nil
		}
		removeFileWithSudoFunc = func(path string) (string, error) {
			if path != targetPath {
				t.Fatalf("unexpected removeFileWithSudo path: %s", path)
			}
			return "sudo", nil
		}
	})
	mode, err := restoreBackupFileWithPrivilege(linuxNginxBackupFileRef{
		TargetPath: targetPath,
		Existed:    false,
	}, linuxNginxDeployInput{})
	if err != nil {
		t.Fatalf("expected sudo remove success, got %v", err)
	}
	if mode != "sudo" {
		t.Fatalf("expected sudo mode, got %s", mode)
	}
}

func mustMarshalJSON(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal json failed: %v", err)
	}
	return string(raw)
}

func generateTestPEMMaterial(t *testing.T) (string, string, string) {
	return generateTestPEMMaterialForHost(t, "test.local")
}

func generateTestPEMMaterialForHost(t *testing.T, host string) (string, string, string) {
	certPEM, keyPEM, fingerprint, _ := generateTestPEMMaterialForHostWithValidity(t, host, time.Now().Add(-time.Hour), time.Now().Add(24*time.Hour))
	return certPEM, keyPEM, fingerprint
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
