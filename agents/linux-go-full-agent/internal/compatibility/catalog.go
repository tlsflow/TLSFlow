package compatibility

import (
	"sort"
)

const (
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
)

func PublicCapabilityKeys() []string {
	keys := []string{
		CapabilityAgentOnline, CapabilityTaskReceive,
		CapabilityRollbackRestore, CapabilityFileAtomicReplace, CapabilityFileBackup, CapabilityFileRestore,
		CapabilityServiceReload, CapabilityServiceRestart, CapabilityPOSIXFilesystem,
	}
	sort.Strings(keys)
	return keys
}

func PublicAdapterIDs() []string {
	items := []string{
		StorePOSIXFilesystem,
		CodecPEM, CodecPKCS12, CodecJKS,
		VerifierTLSRemote,
		RollbackPOSIXFiles, RollbackJavaKeystore,
		ServiceSystemd, ServiceSysV, ServiceOpenRC,
	}
	sort.Strings(items)
	return items
}
