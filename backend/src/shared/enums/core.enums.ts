// 002 跨 Spec 共享枚举。枚举值只能新增，不能改旧含义。
export const OsTypes = ['WINDOWS', 'LINUX', 'UNIX', 'NETWORK_DEVICE', 'UNKNOWN'] as const;
export type OsType = (typeof OsTypes)[number];

export const ManagementModes = ['AGENT', 'LEGACY_AGENT', 'GATEWAY', 'AGENTLESS', 'SCRIPT_PACKAGE', 'MONITOR_ONLY'] as const;
export type ManagementMode = (typeof ManagementModes)[number];

export const CompatibilityLevels = ['L1', 'L2', 'L3', 'L4', 'L5'] as const;
export type CompatibilityLevel = (typeof CompatibilityLevels)[number];

export const ProviderTypes = ['NGINX', 'APACHE', 'TOMCAT', 'IIS', 'WINDOWS_CERT_STORE', 'CUSTOM', 'DEVICE_TEMPLATE'] as const;
export type ProviderType = (typeof ProviderTypes)[number];

export const BindingTypes = ['FILE_PATH', 'WINDOWS_CERT_STORE', 'KEYSTORE', 'DEVICE_API', 'CUSTOM'] as const;
export type BindingType = (typeof BindingTypes)[number];

export const ExecutionTargetKinds = ['AGENT', 'GATEWAY_SSH', 'SSH', 'WINRM', 'SMB_WMI', 'CURL', 'SCRIPT_PACKAGE'] as const;
export type ExecutionTargetKind = (typeof ExecutionTargetKinds)[number];

export const CertificateFormats = ['PEM', 'PFX', 'JKS', 'DER', 'P7B'] as const;
export type CertificateFormat = (typeof CertificateFormats)[number];

export const CertificateVersionStatuses = ['VALID', 'EXPIRED', 'REVOKED', 'MALFORMED', 'ARCHIVED'] as const;
export type CertificateVersionStatus = (typeof CertificateVersionStatuses)[number];

export const CertificateBindingStatuses = ['DISCOVERED', 'MANAGED', 'DRIFTED', 'EXPIRED', 'ERROR', 'IGNORED'] as const;
export type CertificateBindingStatus = (typeof CertificateBindingStatuses)[number];

export const DeploymentPlanStatuses = ['DRAFT', 'PENDING_APPROVAL', 'READY', 'RUNNING', 'SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'CANCELLED', 'ROLLED_BACK'] as const;
export type DeploymentPlanStatus = (typeof DeploymentPlanStatuses)[number];

export const ExecutionRunStatuses = ['PENDING', 'DISPATCHED', 'RUNNING', 'SUCCESS', 'FAILED', 'TIMEOUT', 'CANCELLED', 'ROLLBACK_RUNNING', 'ROLLBACK_SUCCESS', 'ROLLBACK_FAILED'] as const;
export type ExecutionRunStatus = (typeof ExecutionRunStatuses)[number];

export const ExecutionStepStatuses = ['PENDING', 'RUNNING', 'SUCCESS', 'FAILED', 'SKIPPED', 'TIMEOUT'] as const;
export type ExecutionStepStatus = (typeof ExecutionStepStatuses)[number];

export const AgentStatuses = ['ONLINE', 'OFFLINE', 'DISABLED', 'UPGRADING', 'UNKNOWN'] as const;
export type AgentStatus = (typeof AgentStatuses)[number];

export const RiskStatuses = ['OPEN', 'ACKED', 'RESOLVED', 'IGNORED'] as const;
export type RiskStatus = (typeof RiskStatuses)[number];
