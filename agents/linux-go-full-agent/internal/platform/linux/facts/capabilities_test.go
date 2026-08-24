package facts

import (
	"testing"

	"gcac/linux-go-full-agent/internal/compatibility"
)

func TestCapabilitiesUsePublicVersionedKeys(t *testing.T) {
	snapshot := Snapshot{Facts: map[string]any{
		"filesystem": map[string]any{"atomicRename": true, "posixPermissions": true},
		"service":    map[string]any{"systemd": map[string]any{"available": true}},
		"privilege":  map[string]any{"root": true},
		"security":   map[string]any{"selinux": map[string]any{"available": true}},
	}}
	capabilities := CapabilityMap(snapshot)
	for _, key := range []string{compatibility.CapabilityPOSIXFilesystem, compatibility.CapabilitySystemd, compatibility.CapabilityPrivilegeRoot, compatibility.CapabilitySELinux} {
		if !capabilities[key] {
			t.Fatalf("缺少公共 Capability Key: %s", key)
		}
	}
	for _, key := range []string{"product.config.parse", "product.binding.manage", "vendor.signing.algorithm"} {
		if capabilities[key] {
			t.Fatalf("Agent 不得声明插件拥有的产品能力: %s", key)
		}
	}
}
