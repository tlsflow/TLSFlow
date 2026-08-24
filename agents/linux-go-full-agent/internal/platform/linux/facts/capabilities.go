package facts

import (
	"sort"
	"strings"

	"gcac/linux-go-full-agent/internal/compatibility"
)

type Capability struct {
	Key        string         `json:"capabilityKey"`
	Value      any            `json:"value"`
	Confidence float64        `json:"confidence"`
	Evidence   map[string]any `json:"evidence,omitempty"`
}

func Capabilities(snapshot Snapshot) []Capability {
	values := map[string]Capability{}
	declare := func(key string, value bool, collector string) {
		if value {
			values[key] = Capability{Key: key, Value: true, Confidence: 0.95, Evidence: evidence(collector, snapshot)}
		}
	}
	declare(compatibility.CapabilityAgentOnline, true, "runtime")
	declare(compatibility.CapabilityTaskReceive, true, "runtime")
	declare(compatibility.CapabilityRollbackRestore, true, "filesystem")
	declare(compatibility.CapabilityFileAtomicReplace, boolFact(snapshot, "filesystem", "atomicRename"), "filesystem")
	declare(compatibility.CapabilityFileBackup, boolFact(snapshot, "filesystem", "posixPermissions"), "filesystem")
	declare(compatibility.CapabilityFileRestore, boolFact(snapshot, "filesystem", "posixPermissions"), "filesystem")
	declare(compatibility.CapabilityPOSIXFilesystem, boolFact(snapshot, "filesystem", "atomicRename"), "filesystem")
	declare(compatibility.CapabilitySystemd, nestedBoolFact(snapshot, "service", "systemd", "available"), "service")
	declare(compatibility.CapabilitySysV, nestedBoolFact(snapshot, "service", "sysv", "available"), "service")
	declare(compatibility.CapabilityOpenRC, nestedBoolFact(snapshot, "service", "openrc", "available"), "service")
	declare(compatibility.CapabilityServiceReload, hasAny(values, compatibility.CapabilitySystemd, compatibility.CapabilitySysV, compatibility.CapabilityOpenRC), "service")
	declare(compatibility.CapabilityServiceRestart, hasAny(values, compatibility.CapabilitySystemd, compatibility.CapabilitySysV, compatibility.CapabilityOpenRC), "service")
	declare(compatibility.CapabilityPrivilegeRoot, boolFact(snapshot, "privilege", "root"), "privilege")
	declare(compatibility.CapabilityPrivilegeSudo, boolFact(snapshot, "privilege", "sudo"), "privilege")
	declare(compatibility.CapabilityPrivilegeDoas, boolFact(snapshot, "privilege", "doas"), "privilege")
	declare(compatibility.CapabilitySELinux, nestedBoolFact(snapshot, "security", "selinux", "available"), "security")
	declare(compatibility.CapabilityAppArmor, nestedBoolFact(snapshot, "security", "apparmor", "available"), "security")
	declare(compatibility.CapabilitySecurityNone, !hasAny(values, compatibility.CapabilitySELinux, compatibility.CapabilityAppArmor), "security")
	declareProduct(values, snapshot, "nginx", []string{compatibility.CapabilityNginxDiscover, compatibility.CapabilityNginxConfigParse, compatibility.CapabilityNginxInstall, compatibility.CapabilityNginxConfigTest})
	declareProduct(values, snapshot, "apache", []string{compatibility.CapabilityApacheDiscover, compatibility.CapabilityApacheConfigParse, compatibility.CapabilityApacheInstall, compatibility.CapabilityApacheConfigTest})
	declareProduct(values, snapshot, "tomcat", []string{compatibility.CapabilityTomcatDiscover, compatibility.CapabilityTomcatServerXML, compatibility.CapabilityTomcatKeystore, compatibility.CapabilityTomcatVerify})
	items := make([]Capability, 0, len(values))
	for _, item := range values {
		items = append(items, item)
	}
	sort.Slice(items, func(left, right int) bool { return items[left].Key < items[right].Key })
	return items
}

func CapabilityMap(snapshot Snapshot) map[string]bool {
	result := map[string]bool{}
	for _, capability := range Capabilities(snapshot) {
		if value, ok := capability.Value.(bool); ok && value {
			result[capability.Key] = true
		}
	}
	return result
}

func declareProduct(values map[string]Capability, snapshot Snapshot, product string, keys []string) {
	for _, key := range keys {
		values[key] = Capability{Key: key, Value: true, Confidence: 1, Evidence: map[string]any{
			"source":    "linux-agent-handler-registry",
			"product":   product,
			"installed": nestedBoolFact(snapshot, "products", product, "installed"),
		}}
	}
}

func boolFact(snapshot Snapshot, collector, key string) bool {
	value, _ := snapshot.Facts[collector].(map[string]any)
	result, _ := value[key].(bool)
	return result
}

func nestedBoolFact(snapshot Snapshot, collector, section, key string) bool {
	value, _ := snapshot.Facts[collector].(map[string]any)
	nested, _ := value[section].(map[string]any)
	result, _ := nested[key].(bool)
	return result
}

func hasAny(values map[string]Capability, keys ...string) bool {
	for _, key := range keys {
		if _, exists := values[key]; exists {
			return true
		}
	}
	return false
}

func evidence(collector string, snapshot Snapshot) map[string]any {
	return map[string]any{"source": "linux-fact-registry", "collector": strings.TrimSpace(collector), "collectedAt": snapshot.CollectedAt}
}
