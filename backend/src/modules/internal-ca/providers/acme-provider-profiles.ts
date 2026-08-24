import { AppError } from '../../../common/errors/app-error.js';
import type { AcmeChallengeType, AcmeProviderConfiguration } from '../schema/acme.schema.js';

export const acmeProviderProfileKeys = [
  'letsencrypt',
  'zerossl',
  'google-trust-services',
  'digicert',
  'sectigo',
  'ssl-com',
  'step-ca',
  'ejbca',
  'custom',
] as const;

export type AcmeProviderProfileKey = (typeof acmeProviderProfileKeys)[number];
export type AcmeProviderProfileCategory = 'public' | 'enterprise' | 'private' | 'custom';
export type AcmeProviderEabPolicy = 'required' | 'not_required' | 'discover';
export type AcmeProviderPreconfigurationSource =
  | 'none'
  | 'zerossl_console'
  | 'google_cloud'
  | 'digicert_console'
  | 'sectigo_console'
  | 'sslcom_console'
  | 'step_ca_admin'
  | 'ejbca_admin'
  | 'custom_ca_admin';
export type AcmeProviderVerificationLevel =
  | 'unconfigured'
  | 'directory_reachable'
  | 'account_active'
  | 'issuance_verified'
  | 'blocked'
  | 'reverification_required';

export interface AcmeProviderProfile {
  key: AcmeProviderProfileKey;
  version: string;
  category: AcmeProviderProfileCategory;
  displayName: string;
  directory: {
    defaultUrl?: string;
    userInputRequired: boolean;
    allowOverride: boolean;
  };
  account: {
    eab: AcmeProviderEabPolicy;
    allowAutomaticAccountPreparation: boolean;
  };
  preconfiguration: {
    required: boolean;
    source: AcmeProviderPreconfigurationSource;
  };
  allowedChallenges: AcmeChallengeType[];
  form: {
    providerFields: Array<'profileKey' | 'displayName' | 'directoryUrl' | 'isDefault'>;
    accountFields: Array<'contactEmail' | 'eabSecretRef' | 'trustBundleSecretRef'>;
    hiddenFields: string[];
  };
}

export interface NormalizeAcmeProviderProfileInput {
  name?: string;
  displayName?: string;
  profileKey?: AcmeProviderProfileKey;
  preset?: AcmeProviderProfileKey;
  directoryUrl?: string;
  isDefault?: boolean;
  trustBundleSecretRef?: string;
}

const hiddenProviderFields = [
  'termsOfServiceUrl',
  'allowedChallenges',
  'requestTimeoutMs',
  'verifyTls',
  'userAgent',
  'accountKeySecretRef',
  'eabKeyIdSecretRef',
  'eabHmacSecretRef',
  'productId',
  'organizationId',
  'approvalWorkflow',
  'provisionerName',
  'caName',
  'certificateProfile',
];

const profiles: readonly AcmeProviderProfile[] = [
  profile({
    key: 'letsencrypt',
    category: 'public',
    displayName: "Let's Encrypt",
    defaultUrl: 'https://acme-v02.api.letsencrypt.org/directory',
    eab: 'not_required',
    automaticAccount: true,
    preconfiguration: { required: false, source: 'none' },
  }),
  profile({
    key: 'zerossl',
    category: 'public',
    displayName: 'ZeroSSL',
    defaultUrl: 'https://acme.zerossl.com/v2/DV90',
    eab: 'required',
    preconfiguration: { required: true, source: 'zerossl_console' },
  }),
  profile({
    key: 'google-trust-services',
    category: 'enterprise',
    displayName: 'Google Trust Services',
    defaultUrl: 'https://dv.acme-v02.api.pki.goog/directory',
    eab: 'required',
    preconfiguration: { required: true, source: 'google_cloud' },
  }),
  profile({ key: 'digicert', category: 'enterprise', displayName: 'DigiCert', eab: 'discover', preconfiguration: { required: true, source: 'digicert_console' } }),
  profile({ key: 'sectigo', category: 'enterprise', displayName: 'Sectigo', eab: 'discover', preconfiguration: { required: true, source: 'sectigo_console' } }),
  profile({ key: 'ssl-com', category: 'enterprise', displayName: 'SSL.com', eab: 'discover', preconfiguration: { required: true, source: 'sslcom_console' } }),
  profile({ key: 'step-ca', category: 'private', displayName: 'step-ca', eab: 'discover', privateTrust: true, preconfiguration: { required: true, source: 'step_ca_admin' } }),
  profile({ key: 'ejbca', category: 'private', displayName: 'EJBCA', eab: 'discover', privateTrust: true, preconfiguration: { required: true, source: 'ejbca_admin' } }),
  profile({ key: 'custom', category: 'custom', displayName: '自定义 ACME CA', eab: 'discover', privateTrust: true, preconfiguration: { required: true, source: 'custom_ca_admin' } }),
];

export function listAcmeProviderProfiles(): AcmeProviderProfile[] {
  return profiles.map(cloneProfile);
}

export function getAcmeProviderProfile(value: unknown): AcmeProviderProfile | undefined {
  const key = normalizeProfileKey(value);
  return profiles.find((item) => item.key === key);
}

export function isAcmeProviderProfileKey(value: unknown): value is AcmeProviderProfileKey {
  return normalizeProfileKey(value) !== undefined;
}

export function normalizeAcmeProviderProfile(
  input: NormalizeAcmeProviderProfileInput,
  current: Record<string, unknown> = {},
): AcmeProviderConfiguration {
  const profileKey = normalizeProfileKey(input.profileKey ?? input.preset ?? current.profileKey ?? current.preset) ?? 'custom';
  const profile = getRequiredAcmeProviderProfile(profileKey);
  const directoryUrl = normalizeDirectoryUrl(profile, input.directoryUrl ?? stringValue(current.directoryUrl));
  return {
    directoryUrl,
    allowedChallenges: [...profile.allowedChallenges],
    requestTimeoutMs: numberValue(current.requestTimeoutMs, 15_000),
    verifyTls: true,
    userAgent: stringValue(current.userAgent) ?? 'GCAC ACME Client',
    termsOfServiceAgreed: current.termsOfServiceAgreed === true,
    termsOfServiceUrl: stringValue(current.termsOfServiceUrl),
    preset: profile.key,
    profileKey: profile.key,
    profileVersion: profile.version,
    isDefault: input.isDefault === true,
    isBuiltIn: current.isBuiltIn === true,
    verificationLevel: normalizeVerificationLevel(current.verificationLevel) ?? 'unconfigured',
    verification: objectValue(current.verification),
    trustBundleSecretRef: profile.form.accountFields.includes('trustBundleSecretRef')
      ? stringValue(input.trustBundleSecretRef) ?? stringValue(current.trustBundleSecretRef)
      : undefined,
  };
}

export function getRequiredAcmeProviderProfile(key: AcmeProviderProfileKey): AcmeProviderProfile {
  const found = getAcmeProviderProfile(key);
  if (!found) throw new AppError('ACME_PROVIDER_CONFIG_INVALID', 'ACME Provider Profile 不存在', { profileKey: key });
  return cloneProfile(found);
}

export function normalizeProfileKey(value: unknown): AcmeProviderProfileKey | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  if (normalized === 'google') return 'google-trust-services';
  if (normalized === 'sslcom') return 'ssl-com';
  return acmeProviderProfileKeys.includes(normalized as AcmeProviderProfileKey)
    ? normalized as AcmeProviderProfileKey
    : undefined;
}

export function normalizeVerificationLevel(value: unknown): AcmeProviderVerificationLevel | undefined {
  return typeof value === 'string' && [
    'unconfigured',
    'directory_reachable',
    'account_active',
    'issuance_verified',
    'blocked',
    'reverification_required',
  ].includes(value) ? value as AcmeProviderVerificationLevel : undefined;
}

function profile(input: {
  key: AcmeProviderProfileKey;
  category: AcmeProviderProfileCategory;
  displayName: string;
  defaultUrl?: string;
  eab: AcmeProviderEabPolicy;
  automaticAccount?: boolean;
  privateTrust?: boolean;
  preconfiguration: { required: boolean; source: AcmeProviderPreconfigurationSource };
}): AcmeProviderProfile {
  const providerFields: AcmeProviderProfile['form']['providerFields'] = ['profileKey', 'displayName'];
  if (!input.defaultUrl) providerFields.push('directoryUrl');
  providerFields.push('isDefault');
  const accountFields: AcmeProviderProfile['form']['accountFields'] = ['contactEmail'];
  // discover 只有在 Directory 明确要求 EAB 后才显示，避免把 Profile 推测当成运行时事实。
  if (input.eab === 'required') accountFields.push('eabSecretRef');
  if (input.privateTrust) accountFields.push('trustBundleSecretRef');
  return {
    key: input.key,
    version: '2026-08-13.1',
    category: input.category,
    displayName: input.displayName,
    directory: {
      defaultUrl: input.defaultUrl,
      userInputRequired: !input.defaultUrl,
      allowOverride: false,
    },
    account: {
      eab: input.eab,
      allowAutomaticAccountPreparation: input.automaticAccount === true,
    },
    preconfiguration: { ...input.preconfiguration },
    allowedChallenges: ['http-01', 'dns-01'],
    form: {
      providerFields,
      accountFields,
      hiddenFields: [...hiddenProviderFields],
    },
  };
}

function normalizeDirectoryUrl(profile: AcmeProviderProfile, value: string | undefined): string {
  if (profile.directory.defaultUrl && !profile.directory.allowOverride) return profile.directory.defaultUrl;
  const candidate = value?.trim();
  if (!candidate) throw new AppError('ACME_PROVIDER_CONFIG_INVALID', 'ACME Directory 必须填写');
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new AppError('ACME_PROVIDER_CONFIG_INVALID', 'ACME Directory URL 无效');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) {
    throw new AppError('ACME_PROVIDER_CONFIG_INVALID', 'ACME Directory 必须是无凭据和片段的 HTTPS URL');
  }
  return parsed.toString();
}

function cloneProfile(profileValue: AcmeProviderProfile): AcmeProviderProfile {
  return {
    ...profileValue,
    directory: { ...profileValue.directory },
    account: { ...profileValue.account },
    preconfiguration: { ...profileValue.preconfiguration },
    allowedChallenges: [...profileValue.allowedChallenges],
    form: {
      providerFields: [...profileValue.form.providerFields],
      accountFields: [...profileValue.form.accountFields],
      hiddenFields: [...profileValue.form.hiddenFields],
    },
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...value as Record<string, unknown> } : undefined;
}
