package compatibility

import (
	"sort"
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
