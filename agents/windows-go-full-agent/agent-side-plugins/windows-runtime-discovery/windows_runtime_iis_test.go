package main

import (
	"encoding/json"
	"testing"
)

func TestParseWindowsIISRuntimeSitesKeepsBindingCertificate(t *testing.T) {
	raw := json.RawMessage(`[
  {
    "id": 7,
    "name": "Portal",
    "physicalPath": "D:\\sites\\portal",
    "bindings": [
      {"protocol":"http","bindingInformation":"*:80:portal.example.test","ipAddress":"*","port":80,"hostHeader":"portal.example.test"},
      {"protocol":"https","bindingInformation":"*:443:portal.example.test","ipAddress":"*","port":443,"hostHeader":"portal.example.test","certificateStoreName":"My","certificateThumbprint":"00 11 22 33 44 55 66 77","certificate":{"thumbprint":"0011223344556677","fingerprintSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","storeName":"My","subject":"CN=portal.example.test","issuer":"CN=GCAC Test CA","notBefore":"2026-08-01T00:00:00Z","notAfter":"2027-08-01T00:00:00Z"}}
    ]
  }
]`)
	sites, err := parseWindowsIISRuntimeSites(raw, `C:\Windows\System32\inetsrv\config\applicationHost.config`)
	if err != nil {
		t.Fatalf("IIS sites 解析失败: %v", err)
	}
	if len(sites) != 1 || sites[0].Name != "Portal" || len(sites[0].Listen) != 2 {
		t.Fatalf("IIS 站点或监听器解析错误: %#v", sites)
	}
	https := sites[0].Listen[1]
	if https.Protocol != "HTTPS" || https.CertificateThumbprint != "0011223344556677" || https.CertificateStoreName != "My" {
		t.Fatalf("IIS HTTPS Binding 未保留精确证书引用: %#v", https)
	}
	if https.Certificate == nil || https.Certificate.FingerprintSHA256 != "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" {
		t.Fatalf("IIS Binding 没有关联到实际证书库中的证书: %#v", https.Certificate)
	}
}

func TestMatureIISInventoryProducesOneConfiguredCertificate(t *testing.T) {
	inventory := map[string]any{
		"frameworks":       []map[string]any{},
		"sites":            []map[string]any{},
		"certificateFiles": []map[string]any{},
		"configFiles":      []map[string]any{},
		"warnings":         []map[string]any{},
	}
	site := windowsRuntimeSite{
		ID:          "iis:7",
		Name:        "Portal",
		ServerNames: []string{"portal.example.test"},
		ConfigFiles: []string{`C:\Windows\System32\inetsrv\config\applicationHost.config`},
		Listen: []windowsRuntimeListener{
			{Address: "*", Port: 80, Protocol: "HTTP", HostHeader: "portal.example.test"},
			{
				Address:                  "*",
				Port:                     443,
				Protocol:                 "HTTPS",
				HostHeader:               "portal.example.test",
				CertificateStoreName:     "My",
				CertificateStoreLocation: "LocalMachine",
				CertificateThumbprint:    "0011223344556677",
				Certificate: &windowsCertificateSummary{
					FingerprintSHA256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
					Subject:           "CN=portal.example.test",
					Issuer:            "CN=GCAC Test CA",
					NotBefore:         "2026-08-01T00:00:00Z",
					NotAfter:          "2027-08-01T00:00:00Z",
				},
			},
		},
	}
	appendWindowsMatureRuntimeDetail(inventory, "web.iis", "IIS", true, "10.0", `C:\Windows\System32\inetsrv`, `C:\Windows\System32\inetsrv\config\applicationHost.config`, "", `C:\Windows\System32\inetsrv`, []windowsRuntimeSite{site}, nil)

	sites := inventory["sites"].([]map[string]any)
	certificates := inventory["certificateFiles"].([]map[string]any)
	if len(sites) != 1 || len(sites[0]["metadata"].(map[string]any)["listeners"].([]map[string]any)) != 2 {
		t.Fatalf("HTTP 和 HTTPS 监听器必须属于同一 IIS 站点: %#v", sites)
	}
	if len(certificates) != 1 {
		t.Fatalf("IIS 只能上报 Binding 实际关联的一张证书: %#v", certificates)
	}
	if certificates[0]["path"] != "windows-certstore://LocalMachine/My/0011223344556677" || certificates[0]["sha256Fingerprint"] != "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" {
		t.Fatalf("IIS 证书库存不应由端口或默认站点推断: %#v", certificates[0])
	}
}
