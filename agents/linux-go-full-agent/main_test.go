package main

import (
	"os"
	"path/filepath"
	"testing"
)

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
}

func TestApplyApacheSiteCertificateMarksNonStandardTlsPortAsHttps(t *testing.T) {
	site := &apacheSiteDetail{
		Name:                  "test.local",
		serverCertificatePath: "/etc/gcac-test/certs/test.crt",
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
