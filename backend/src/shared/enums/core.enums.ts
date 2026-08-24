// 002 跨 Spec 共享枚举。枚举值只能新增，不能改旧含义。
export const OsTypes = ['WINDOWS', 'LINUX', 'UNIX', 'NETWORK_DEVICE', 'UNKNOWN'] as const;
export type OsType = (typeof OsTypes)[number];

export const ManagementModes = ['AGENT', 'LEGACY_AGENT', 'GATEWAY', 'AGENTLESS', 'SCRIPT_PACKAGE', 'MONITOR_ONLY'] as const;
export type ManagementMode = (typeof ManagementModes)[number];

export const CompatibilityLevels = ['L1', 'L2', 'L3', 'L4', 'L5'] as const;
export type CompatibilityLevel = (typeof CompatibilityLevels)[number];

export const CapabilityRiskLevels = ['low', 'medium', 'high', 'critical'] as const;
export type CapabilityRiskLevel = (typeof CapabilityRiskLevels)[number];

export const CapabilityValueTypes = ['boolean', 'string', 'number', 'string_array', 'number_array', 'object'] as const;
export type CapabilityValueType = (typeof CapabilityValueTypes)[number];

export const CapabilityDeclarationSources = ['agent_report', 'auto_probe', 'gateway_probe', 'agentless_probe', 'manual', 'plugin_manifest', 'inferred'] as const;
export type CapabilityDeclarationSource = (typeof CapabilityDeclarationSources)[number];

export const CapabilityDeclarationStatuses = ['active', 'expired', 'conflicted', 'revoked', 'pending_approval'] as const;
export type CapabilityDeclarationStatus = (typeof CapabilityDeclarationStatuses)[number];

export const CapabilityTargetTypes = ['host', 'service_instance', 'execution_target', 'agent', 'plugin'] as const;
export type CapabilityTargetType = (typeof CapabilityTargetTypes)[number];

export const CapabilityOwnerTypes = ['provider_action', 'executor_action', 'workflow_step', 'plugin_action'] as const;
export type CapabilityOwnerType = (typeof CapabilityOwnerTypes)[number];

export const CapabilityConstraintOperators = ['exists', 'equals', 'contains', 'gte', 'lte', 'matches', 'path_writable', 'format_supported'] as const;
export type CapabilityConstraintOperator = (typeof CapabilityConstraintOperators)[number];

export const CapabilityMatchStatuses = ['matched', 'degraded', 'blocked', 'manual_required', 'unknown'] as const;
export type CapabilityMatchStatus = (typeof CapabilityMatchStatuses)[number];

export const CapabilitySuggestionTypes = ['use_full_agent', 'use_legacy_agent', 'use_gateway', 'use_ssh', 'use_winrm', 'generate_script_package', 'manual_confirm', 'monitor_only'] as const;
export type CapabilitySuggestionType = (typeof CapabilitySuggestionTypes)[number];

export const ProviderTypes = ['NGINX', 'APACHE', 'TOMCAT', 'IIS', 'WINDOWS_CERT_STORE', 'CUSTOM', 'DEVICE_TEMPLATE'] as const;
export type ProviderType = (typeof ProviderTypes)[number];

export const BindingTypes = ['FILE_PATH', 'WINDOWS_CERT_STORE', 'KEYSTORE', 'DEVICE_API', 'CUSTOM'] as const;
export type BindingType = (typeof BindingTypes)[number];

export const ExecutionTargetKinds = ['AGENT', 'GATEWAY_FORWARD', 'SSH', 'WINRM', 'SMB_WMI', 'CURL', 'WORKFLOW', 'SCRIPT_PACKAGE'] as const;
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
