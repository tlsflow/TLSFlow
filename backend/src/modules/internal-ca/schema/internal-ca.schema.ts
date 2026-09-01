/**
 * ACME 是宿主内置协议能力；plugin 只表示需要由外部插件执行的 CA。
 * 不再把 Lets Encrypt、DNS Solver 或 OpenSSL CA 伪装成 PluginVersion。
 */
export const caProviderTypes = ['gcac_builtin', 'acme', 'plugin'] as const;
export const caDeploymentModes = ['builtin', 'external'] as const;
export const caRuntimePlatforms = ['embedded', 'windows', 'linux', 'external'] as const;
export const caAvailabilityModes = ['offline', 'single', 'active_standby', 'active_active'] as const;
export const caTopologyModes = ['root_only', 'root_with_intermediate', 'external_managed'] as const;
export const caRoles = ['root', 'intermediate'] as const;
export const caStatuses = ['draft', 'pending_activation', 'active', 'suspended', 'retiring', 'retired', 'compromised'] as const;
export const caTrustDomainStatuses = ['draft', 'active', 'rotating', 'retiring', 'retired', 'compromised'] as const;
export const caTrustDomainIsolationLevels = ['standard', 'strict', 'regulated'] as const;
export const providerActionBindingStatuses = ['draft', 'active', 'revalidation_required', 'disabled'] as const;
export const providerActionExecutionLocations = ['control_plane', 'agent'] as const;
export const certificatePolicyStatuses = ['active', 'disabled'] as const;
export const certificateProfilePurposes = ['https_server'] as const;
export const certificateProfileProviderTypes = ['acme', 'internal_ca'] as const;
export const keyCustodyModes = ['local_agent', 'managed_secret', 'external_key', 'device_local'] as const;
export const keyBackendTypes = ['file', 'secret', 'cng', 'tpm', 'hsm', 'kms', 'pkcs11', 'device'] as const;
export const keyExportabilities = ['non_exportable', 'exportable', 'unknown'] as const;
export const certificateRequestStatuses = ['draft', 'pending_key', 'pending_csr', 'pending_approval', 'approved', 'issuing', 'issued', 'deploying', 'active', 'rejected', 'issue_failed', 'deploy_failed', 'cancelled', 'revoked', 'expired'] as const;
export const certificateRotationStatuses = ['requested', 'key_csr_pending', 'issuing', 'install_pending', 'deploying', 'cutover_verified', 'revoke_pending', 'completed', 'failed', 'unknown'] as const;

export type CaProviderType = typeof caProviderTypes[number];
export type CaDeploymentMode = typeof caDeploymentModes[number];
export type CaRuntimePlatform = typeof caRuntimePlatforms[number];
export type CaAvailabilityMode = typeof caAvailabilityModes[number];
export type CaTopologyMode = typeof caTopologyModes[number];
export type CaRole = typeof caRoles[number];
export type CaStatus = typeof caStatuses[number];
export type CaTrustDomainStatus = typeof caTrustDomainStatuses[number];
export type CaTrustDomainIsolationLevel = typeof caTrustDomainIsolationLevels[number];
export type ProviderActionBindingStatus = typeof providerActionBindingStatuses[number];
export type ProviderActionExecutionLocation = typeof providerActionExecutionLocations[number];
export type CertificatePolicyStatus = typeof certificatePolicyStatuses[number];
export type CertificateProfilePurpose = typeof certificateProfilePurposes[number];
export type CertificateProfileProviderType = typeof certificateProfileProviderTypes[number];
export type KeyCustodyMode = typeof keyCustodyModes[number];
export type KeyBackendType = typeof keyBackendTypes[number];
export type KeyExportability = typeof keyExportabilities[number];
export type CertificateRequestStatus = typeof certificateRequestStatuses[number];
export type CertificateRotationStatus = typeof certificateRotationStatuses[number];
export type CaCapabilityOwnerType = 'provider';
export type CaCapabilityState = 'declared' | 'discovered' | 'verified' | 'unavailable';
export type CaIssuanceStatus = 'reserved' | 'issued' | 'revoked' | 'expired' | 'failed';
export type CaIssuanceRecordOrigin = 'native' | 'historical_backfill' | 'external';
export type CaOperationObjectType = 'request' | 'issuance' | 'revocation' | 'template';
export type CaOperationNormalizedStatus = 'pending' | 'issued' | 'rejected' | 'revoked' | 'failed' | 'unknown';
export type CaTemplateMappingStatus = 'active' | 'stale' | 'invalid' | 'disabled';

export interface CaProviderCapabilities {
  discoverHierarchy: boolean;
  createRoot: boolean;
  createIntermediate: boolean;
  signCsr: boolean;
  queryIssuance: boolean;
  revokeCertificate: boolean;
  publishCrl: boolean;
  ocsp: boolean;
  listProfiles: boolean;
  deviceLocalCsr: boolean;
  hardwareBackedKey: boolean;
  highAvailability: boolean;
}

export interface CaCapabilityRecordEntity {
  id: string;
  tenantId: string;
  ownerType: CaCapabilityOwnerType;
  ownerId: string;
  capabilityKey: keyof CaProviderCapabilities;
  state: CaCapabilityState;
  source: string;
  evidence: Record<string, unknown>;
  verifiedAt?: string;
  expiresAt?: string;
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaIssuanceRecordEntity {
  id: string;
  tenantId: string;
  caId: string;
  serialNumber: string;
  certificateRequestId?: string;
  certificateVersionId?: string;
  applicationAssetId?: string;
  status: CaIssuanceStatus;
  recordOrigin: CaIssuanceRecordOrigin;
  subjectCommonName?: string;
  sans: string[];
  certificateFingerprintSha256?: string;
  publicKeyFingerprintSha256?: string;
  notBefore?: string;
  notAfter?: string;
  issuedAt?: string;
  revocationReason?: string;
  revokedAt?: string;
  invalidityDate?: string;
  observedAt: string;
  createdAt: string;
  updatedAt: string;
}

/** 内置 CA 每次 CRL 发布的不可变制品与传播回读证据。 */
export interface CaCrlPublicationEntity {
  id: string;
  tenantId: string;
  caId: string;
  crlNumber: number;
  thisUpdate: string;
  nextUpdate: string;
  distributionPoint?: string;
  crlPem: string;
  crlDerBase64: string;
  crlFingerprintSha256: string;
  revokedSerialNumbers: string[];
  publicationStatus: 'published' | 'failed' | 'unknown';
  verification: {
    signatureVerified: boolean;
    issuerFingerprintSha256?: string;
    serialsVerified: boolean;
    source: 'openssl' | 'external';
  };
  errorCode?: string;
  errorMessage?: string;
  createdAt: string;
}

export interface ExternalCaObservationEntity {
  id: string;
  tenantId: string;
  providerId: string;
  caId: string;
  objectType: CaOperationObjectType;
  externalObjectId: string;
  externalParentId?: string;
  normalizedStatus: CaOperationNormalizedStatus;
  sourceStatus?: string;
  sourceRevision?: string;
  subjectCommonName?: string;
  serialNumber?: string;
  templateExternalId?: string;
  requestedByDisplay?: string;
  submittedAt?: string;
  issuedAt?: string;
  revokedAt?: string;
  notBefore?: string;
  notAfter?: string;
  rawSummary: Record<string, string | number | boolean | null>;
  observedAt: string;
  firstObservedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaTemplateMappingEntity {
  id: string;
  tenantId: string;
  providerId: string;
  caId: string;
  profileVersionId: string;
  externalTemplateId: string;
  status: CaTemplateMappingStatus;
  validationSummary: Record<string, string | number | boolean | null>;
  version: number;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CaTrustDomainEntity {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  purpose: string;
  status: CaTrustDomainStatus;
  isDefault: boolean;
  isolationLevel: CaTrustDomainIsolationLevel;
  rootPolicy: Record<string, unknown>;
  trustPolicy: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CaProviderEntity {
  id: string;
  tenantId: string;
  name: string;
  type: CaProviderType;
  deploymentMode: CaDeploymentMode;
  runtimePlatform: CaRuntimePlatform;
  availabilityMode: CaAvailabilityMode;
  endpoint?: string;
  credentialSecretRef?: string;
  capabilities: CaProviderCapabilities;
  capabilityRecords?: CaCapabilityRecordEntity[];
  status: 'active' | 'disabled' | 'degraded';
  configuration: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * 外部 CA 的唯一动作入口。动作版本固定后，后续插件升级不会改变正在执行的申请。
 * Schema 与能力证据只表达就绪状态，首期不把它们作为调用前置条件。
 */
export interface ProviderActionReference {
  actionId: string;
  actionVersion: string;
  inputSchemaDigest?: string;
  outputSchemaDigest?: string;
}

export interface ProviderActionBindingEntity {
  id: string;
  tenantId: string;
  providerId: string;
  pluginVersionId: string;
  executionLocation: ProviderActionExecutionLocation;
  issueAction: ProviderActionReference;
  queryAction?: ProviderActionReference;
  revokeAction?: ProviderActionReference;
  revocationEvidenceAction?: ProviderActionReference;
  approvalMode: 'none' | 'gcac_before_submit' | 'external_ca_after_submit';
  capabilityEvidence: Record<string, unknown>;
  status: ProviderActionBindingStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateAuthorityEntity {
  id: string;
  tenantId: string;
  name: string;
  role: CaRole;
  parentCaId?: string;
  topologyMode: CaTopologyMode;
  providerId: string;
  trustDomainId?: string;
  keyReferenceId?: string;
  privateKeySecretRef?: string;
  certificateVersionId?: string;
  certificatePem?: string;
  certificateChainPem?: string;
  securityDomain: string;
  status: CaStatus;
  pathLengthConstraint?: number;
  subjectCommonName: string;
  notBefore?: string;
  notAfter?: string;
  fingerprintSha256?: string;
  crlDistributionPoint?: string;
  /** 绑定到具体 CA 的外部 Provider 参数，避免多个 CA 共用 Agent 时互相覆盖。 */
  configuration?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface KeyReferenceEntity {
  id: string;
  tenantId: string;
  ownerType: 'ca' | 'application_certificate';
  ownerId: string;
  custodyMode: KeyCustodyMode;
  backendType: KeyBackendType;
  opaqueReference?: string;
  secretRef?: string;
  publicKeyFingerprintSha256: string;
  exportability: KeyExportability;
  protectionLevel: 'software_controlled' | 'os_protected' | 'hardware_backed';
  status: 'active' | 'retiring' | 'retired' | 'compromised' | 'deleted';
  rotatedFromKeyId?: string;
  evidence: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateProfileRules {
  commonNamePattern?: string;
  allowedDnsSuffixes: string[];
  allowedIpCidrs: string[];
  allowedSanTypes: Array<'dns' | 'ip' | 'uri' | 'email'>;
  keyAlgorithms: Array<'rsa' | 'ec'>;
  minimumRsaBits: number;
  maximumValidityDays: number;
  renewalWindowDays: number;
  rotateKeyOnRenewal: boolean;
  allowWildcard: boolean;
  requireApproval: boolean;
  extendedKeyUsages: string[];
}

export interface CertificateProfileEntity {
  id: string;
  tenantId: string;
  name: string;
  /** 证书用途；首期专注 HTTPS 服务端证书。 */
  purpose: CertificateProfilePurpose;
  /** 由后端自动选择的签发来源。 */
  providerType: CertificateProfileProviderType;
  providerId?: string;
  certificateAuthorityId?: string;
  /** ACME Provider 使用的目录预设，保存到 Profile 选择快照。 */
  acmeProviderProfileId?: string;
  /** ACME DNS-01 使用的 DNS Provider。 */
  dnsProviderId?: string;
  /** 仅保存 SecretRef，不保存凭据明文。 */
  credentialRef?: string;
  securityDomain: string;
  trustDomainId?: string;
  /** 空数组表示匹配所有域名；支持精确域名和 *.example.com。 */
  domainPatterns: string[];
  /** 目标必须声明的能力；空数组表示不限制。 */
  targetCapabilities: string[];
  /** 无显式 Provider/CA 时，仅默认 Profile 参与自动解析。 */
  isDefault: boolean;
  /** 仅用于管理员整理候选，不用于隐式挑选。 */
  priority: number;
  status: 'active' | 'disabled';
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateProfileVersionEntity {
  id: string;
  profileId: string;
  versionNo: number;
  rules: CertificateProfileRules;
  createdBy: string;
  createdAt: string;
}

/** 首期默认兼容策略；严格模式由租户管理员后续显式开启。 */
export interface CertificatePolicyRules {
  defaultValidityDays: number;
  maximumValidityDays: number;
  renewalWindowDays: number;
  rotateKeyOnRenewal: boolean;
  minimumProtectionLevel: KeyReferenceEntity['protectionLevel'];
  issueApprovalRequired: boolean;
  deploymentApprovalRequired: boolean;
  revocationApprovalRequired: boolean;
  requireCrlOrOcspEvidence: boolean;
  strictEnforcement: boolean;
}

export interface CertificatePolicyEntity {
  id: string;
  tenantId: string;
  status: CertificatePolicyStatus;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface CertificatePolicyVersionEntity {
  id: string;
  policyId: string;
  versionNo: number;
  rules: CertificatePolicyRules;
  createdBy: string;
  createdAt: string;
}

export interface EffectiveCertificatePolicySnapshot {
  policyVersionId: string;
  providerActionBindingId?: string;
  rules: CertificatePolicyRules;
  effectiveValidityDays: number;
  requiresApproval: boolean;
  warnings: string[];
}

export interface CertificateRequestEntity {
  id: string;
  tenantId: string;
  /** 全局历史 ACME 申请没有应用归属；专属申请和所有应用级申请必须填写。 */
  applicationAssetId?: string;
  /** 证书资产 ID，与应用资产 ID 严格分离；专属申请必须显式绑定。 */
  certificateAssetId?: string;
  /** 应用证书供应策略版本 ID，用于把申请固定到不可变策略快照。 */
  applicationCertificatePolicyVersionId?: string;
  caId: string;
  trustDomainId?: string;
  profileVersionId: string;
  certificatePolicyVersionId?: string;
  providerActionBindingId?: string;
  effectivePolicySnapshot?: EffectiveCertificatePolicySnapshot;
  keyReferenceId: string;
  csrPem: string;
  csrSha256: string;
  publicKeyFingerprintSha256: string;
  idempotencyKey: string;
  status: CertificateRequestStatus;
  requestedBy: string;
  approvedBy?: string;
  approvalId?: string;
  deferIssuance?: boolean;
  providerRequestId?: string;
  certificateVersionId?: string;
  failureCode?: string;
  failureMessage?: string;
  /** Agent 安装/部署回执的脱敏摘要；不保存证书、私钥或凭据明文。 */
  deploymentEvidence?: Record<string, unknown>;
  /** 签发后的自动部署结果；仅保存计划引用和脱敏状态，不保存证书/私钥材料。 */
  deploymentPlanId?: string;
  deploymentPlanStatus?: string;
  deploymentPlanCertificateVersionId?: string;
  deploymentWarnings?: string[];
  subjectCommonName: string;
  sans: string[];
  requestedValidityDays: number;
  /** 本机持钥任务的非敏感目标上下文，用于签发后生成安装任务。 */
  agentContext?: {
    agentId: string;
    targetId: string;
    keyPath: string;
    certificatePath: string;
    /** Tomcat 配置文件绝对路径；密码留在 Agent 本机解析。 */
    configPath?: string;
    storageMode?: 'file_pem' | 'windows_cng';
    format: 'pem' | 'pkcs12' | 'jks';
    alias?: string;
    pluginId?: string;
    pluginVersionId?: string;
  };
  /** 列表接口返回的密钥公开摘要，禁止包含 SecretRef 或私钥材料。 */
  keyReferenceSummary?: {
    custodyMode: KeyCustodyMode;
    backendType: KeyBackendType;
    exportability: KeyExportability;
    protectionLevel: KeyReferenceEntity['protectionLevel'];
    publicKeyFingerprintSha256?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CertificateRenewalJobEntity {
  id: string;
  tenantId: string;
  certificateVersionId: string;
  renewalWindowKey: string;
  status: 'scheduled' | 'key_pending' | 'csr_pending' | 'issuing' | 'deploying' | 'verifying' | 'completed' | 'failed' | 'rollback_required';
  certificateRequestId?: string;
  scheduledAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateRevocationEntity {
  id: string;
  tenantId: string;
  certificateVersionId: string;
  caId: string;
  trustDomainId?: string;
  reason: string;
  status: 'pending_approval' | 'approved' | 'revoking' | 'revoked' | 'revoked_unpublished' | 'unknown' | 'failed';
  requestedBy: string;
  approvalId?: string;
  warnings?: string[];
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** 证书换钥轮换账本。旧证书只有在新版本 TLS 验证后才允许进入撤销阶段。 */
export interface CertificateRotationEntity {
  id: string;
  tenantId: string;
  applicationAssetId: string;
  sourceCertificateVersionId: string;
  sourceKeyReferenceId?: string;
  targetKeyReferenceId?: string;
  targetCertificateRequestId?: string;
  targetCertificateVersionId?: string;
  policyVersionId?: string;
  idempotencyKey: string;
  status: CertificateRotationStatus;
  evidence: Record<string, unknown>;
  warnings: string[];
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TrustDistributionEntity {
  id: string;
  tenantId: string;
  caId: string;
  trustDomainId?: string;
  targetScope: Record<string, unknown>;
  status: 'draft' | 'pending_approval' | 'approved' | 'deploying' | 'verified' | 'rollback_required' | 'failed';
  requestedBy: string;
  approvalId?: string;
  verification?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CaRiskPreview {
  topologyMode: CaTopologyMode;
  deploymentMode: CaDeploymentMode;
  runtimePlatform: CaRuntimePlatform;
  availabilityMode: CaAvailabilityMode;
  keyBackend: KeyBackendType;
  overallRecommendation: 'recommended' | 'acceptable_with_risk' | 'not_recommended';
  warnings: string[];
  blockers: string[];
  requiresApproval: boolean;
  confirmationToken: string;
}

export interface CertificateReuseRisk {
  id: string;
  riskType: 'certificate_fingerprint_reuse' | 'public_key_reuse';
  severity: 'warning' | 'high' | 'critical';
  fingerprintSha256: string;
  certificateVersionIds: string[];
  applicationAssets: Array<{
    id: string;
    displayName: string;
    environment?: string;
    securityDomain: string;
    logicalApplicationId?: string;
  }>;
  bindingCount: number;
  redundantInstanceOnly: boolean;
  wildcard: boolean;
  crossSecurityDomain: boolean;
  trustDomainIds: string[];
  trustDomainNames: string[];
  crossTrustDomain: boolean;
  explanation: string;
  remediation: string;
}
