package compatibility

import (
	"errors"
	"fmt"
	"sort"
	"strings"
)

const (
	ActionContractVersion = "gcac.action/v1"
	ActionSchemaVersion   = "1.0"
	CanonicalDeployAction = "certificate.deploy"

	ProductNginx  = "product.nginx"
	ProductApache = "product.apache"
	ProductTomcat = "product.tomcat"

	StorePOSIXFilesystem = "certificate-store.posix-filesystem"
	CodecPEM             = "artifact-codec.pem"
	CodecPKCS12          = "artifact-codec.pkcs12"
	CodecJKS             = "artifact-codec.jks"
	VerifierTLSRemote    = "verifier.tls-remote"
	RollbackPOSIXFiles   = "rollback.posix-certificate-files"
	RollbackJavaKeystore = "rollback.java-keystore"
	ServiceSystemd       = "service-controller.systemd"
	ServiceSysV          = "service-controller.sysv"
	ServiceOpenRC        = "service-controller.openrc"
)

const (
	CapabilityAgentOnline       = "agent.full.online"
	CapabilityTaskReceive       = "agent.task.receive"
	CapabilityTLSLocalVerify    = "tls.local_verify"
	CapabilityTLSRemoteProbe    = "tls.remote_probe"
	CapabilityRollbackRestore   = "rollback.restore"
	CapabilityFileAtomicReplace = "file.atomic_replace"
	CapabilityFileBackup        = "file.backup"
	CapabilityFileRestore       = "file.restore"
	CapabilityServiceReload     = "service.reload"
	CapabilityServiceRestart    = "service.restart"
	CapabilityPOSIXFilesystem   = "linux.filesystem.posix-atomic.v1"
	CapabilitySELinux           = "linux.security.selinux.v1"
	CapabilityAppArmor          = "linux.security.apparmor.v1"
	CapabilitySecurityNone      = "linux.security.none.v1"
	CapabilitySystemd           = "linux.systemd.v1"
	CapabilitySysV              = "linux.sysv.v1"
	CapabilityOpenRC            = "linux.openrc.v1"
	CapabilityPrivilegeRoot     = "linux.privilege.root.v1"
	CapabilityPrivilegeSudo     = "linux.privilege.sudo-noninteractive.v1"
	CapabilityPrivilegeDoas     = "linux.privilege.doas-noninteractive.v1"
	CapabilityNginxDiscover     = "nginx.discover"
	CapabilityNginxConfigParse  = "nginx.config_parse"
	CapabilityNginxInstall      = "nginx.cert.install"
	CapabilityNginxConfigTest   = "nginx.config_test"
	CapabilityApacheDiscover    = "apache.discover"
	CapabilityApacheConfigParse = "apache.config_parse"
	CapabilityApacheInstall     = "apache.cert.install"
	CapabilityApacheConfigTest  = "apache.config_test"
	CapabilityTomcatDiscover    = "tomcat.discover"
	CapabilityTomcatServerXML   = "tomcat.server_xml.parse"
	CapabilityTomcatKeystore    = "tomcat.keystore.replace"
	CapabilityTomcatVerify      = "tomcat.connector.verify"
)

type Product struct {
	AdapterID            string
	Aliases              []string
	ArtifactCodecs       []string
	RequiredCapabilities []string
}

var products = []Product{
	{
		AdapterID:            ProductNginx,
		Aliases:              []string{"nginx", "linux.nginx.deploy_certificate"},
		ArtifactCodecs:       []string{CodecPEM},
		RequiredCapabilities: []string{CapabilityNginxConfigParse, CapabilityNginxInstall, CapabilityPOSIXFilesystem, CapabilityServiceReload, CapabilityTLSLocalVerify, CapabilityTLSRemoteProbe, CapabilityRollbackRestore},
	},
	{
		AdapterID:            ProductApache,
		Aliases:              []string{"apache", "linux.apache.deploy_certificate"},
		ArtifactCodecs:       []string{CodecPEM},
		RequiredCapabilities: []string{CapabilityApacheConfigParse, CapabilityApacheInstall, CapabilityPOSIXFilesystem, CapabilityServiceReload, CapabilityTLSLocalVerify, CapabilityTLSRemoteProbe, CapabilityRollbackRestore},
	},
	{
		AdapterID:            ProductTomcat,
		Aliases:              []string{"tomcat", "linux.tomcat.deploy_certificate"},
		ArtifactCodecs:       []string{CodecPEM, CodecPKCS12, CodecJKS},
		RequiredCapabilities: []string{CapabilityTomcatServerXML, CapabilityTomcatKeystore, CapabilityPOSIXFilesystem, CapabilityServiceRestart, CapabilityTLSLocalVerify, CapabilityTLSRemoteProbe, CapabilityRollbackRestore},
	},
}

type Resolution struct {
	ProductAdapterID string
	ArtifactCodecID  string
	StoreAdapterID   string
	VerifierID       string
	RollbackID       string
	ServiceID        string
}

func ResolveProduct(productAdapterID, legacyActionType, artifactFormat string, capabilities map[string]bool) (Resolution, error) {
	product, err := findProduct(productAdapterID, legacyActionType)
	if err != nil {
		return Resolution{}, err
	}
	codec := codecForFormat(artifactFormat)
	if codec == "" || !contains(product.ArtifactCodecs, codec) {
		return Resolution{}, fmt.Errorf("artifact codec not supported by %s: %s", product.AdapterID, artifactFormat)
	}
	missing := make([]string, 0)
	for _, capability := range product.RequiredCapabilities {
		if !capabilities[capability] {
			missing = append(missing, capability)
		}
	}
	if len(missing) > 0 {
		sort.Strings(missing)
		return Resolution{}, fmt.Errorf("adapter capabilities missing: %s", strings.Join(missing, ","))
	}
	rollbackID := RollbackPOSIXFiles
	if product.AdapterID == ProductTomcat && codec != CodecPEM {
		rollbackID = RollbackJavaKeystore
	}
	return Resolution{
		ProductAdapterID: product.AdapterID,
		ArtifactCodecID:  codec,
		StoreAdapterID:   StorePOSIXFilesystem,
		VerifierID:       VerifierTLSRemote,
		RollbackID:       rollbackID,
		ServiceID:        resolveServiceID(capabilities),
	}, nil
}

func PublicCapabilityKeys() []string {
	keys := []string{
		CapabilityAgentOnline, CapabilityTaskReceive, CapabilityTLSLocalVerify, CapabilityTLSRemoteProbe,
		CapabilityRollbackRestore, CapabilityFileAtomicReplace, CapabilityFileBackup, CapabilityFileRestore,
		CapabilityServiceReload, CapabilityServiceRestart, CapabilityPOSIXFilesystem,
		CapabilityNginxDiscover, CapabilityNginxConfigParse, CapabilityNginxInstall, CapabilityNginxConfigTest,
		CapabilityApacheDiscover, CapabilityApacheConfigParse, CapabilityApacheInstall, CapabilityApacheConfigTest,
		CapabilityTomcatDiscover, CapabilityTomcatServerXML, CapabilityTomcatKeystore, CapabilityTomcatVerify,
	}
	sort.Strings(keys)
	return keys
}

func PublicAdapterIDs() []string {
	items := []string{
		ProductNginx, ProductApache, ProductTomcat,
		StorePOSIXFilesystem,
		CodecPEM, CodecPKCS12, CodecJKS,
		VerifierTLSRemote,
		RollbackPOSIXFiles, RollbackJavaKeystore,
		ServiceSystemd, ServiceSysV, ServiceOpenRC,
	}
	sort.Strings(items)
	return items
}

func resolveServiceID(capabilities map[string]bool) string {
	candidates := []struct {
		capability string
		adapterID  string
	}{
		{CapabilitySystemd, ServiceSystemd},
		{CapabilitySysV, ServiceSysV},
		{CapabilityOpenRC, ServiceOpenRC},
	}
	selected := ""
	for _, candidate := range candidates {
		if !capabilities[candidate.capability] {
			continue
		}
		if selected != "" {
			return ""
		}
		selected = candidate.adapterID
	}
	return selected
}

func findProduct(adapterID, legacyActionType string) (Product, error) {
	requested := strings.ToLower(strings.TrimSpace(adapterID))
	legacy := strings.ToLower(strings.TrimSpace(legacyActionType))
	for _, product := range products {
		if requested == product.AdapterID || contains(product.Aliases, requested) || contains(product.Aliases, legacy) {
			return product, nil
		}
	}
	return Product{}, errors.New("product adapter not resolved")
}

func codecForFormat(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "", "pem":
		return CodecPEM
	case "pkcs12", "p12", "pfx":
		return CodecPKCS12
	case "jks":
		return CodecJKS
	default:
		return ""
	}
}

func contains(items []string, value string) bool {
	for _, item := range items {
		if strings.EqualFold(item, value) {
			return true
		}
	}
	return false
}
