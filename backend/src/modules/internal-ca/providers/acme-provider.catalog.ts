import type { AcmeChallengeType } from '../schema/acme.schema.js';

export const acmeProviderPresetKeys = [
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

export type AcmeProviderPresetKey = (typeof acmeProviderPresetKeys)[number];
export type AcmeProviderPresetCategory = 'public' | 'enterprise' | 'private';

export interface AcmeProviderPreset {
  key: AcmeProviderPresetKey;
  category: AcmeProviderPresetCategory;
  defaultDirectoryUrl?: string;
  defaultAllowedChallenges: AcmeChallengeType[];
  requiresEab: boolean;
}

const presets: readonly AcmeProviderPreset[] = [
  {
    key: 'letsencrypt',
    category: 'public',
    defaultDirectoryUrl: 'https://acme-v02.api.letsencrypt.org/directory',
    defaultAllowedChallenges: ['http-01', 'dns-01'],
    requiresEab: false,
  },
  {
    key: 'zerossl',
    category: 'public',
    defaultDirectoryUrl: 'https://acme.zerossl.com/v2/DV90',
    defaultAllowedChallenges: ['http-01', 'dns-01'],
    requiresEab: true,
  },
  {
    key: 'google-trust-services',
    category: 'enterprise',
    defaultDirectoryUrl: 'https://dv.acme-v02.api.pki.goog/directory',
    defaultAllowedChallenges: ['http-01', 'dns-01'],
    requiresEab: true,
  },
  {
    key: 'digicert',
    category: 'enterprise',
    defaultAllowedChallenges: ['http-01', 'dns-01'],
    requiresEab: true,
  },
  {
    key: 'sectigo',
    category: 'enterprise',
    defaultAllowedChallenges: ['http-01', 'dns-01'],
    requiresEab: true,
  },
  {
    key: 'ssl-com',
    category: 'enterprise',
    defaultAllowedChallenges: ['http-01', 'dns-01'],
    requiresEab: true,
  },
  {
    key: 'step-ca',
    category: 'private',
    defaultAllowedChallenges: ['http-01', 'dns-01'],
    requiresEab: false,
  },
  {
    key: 'ejbca',
    category: 'private',
    defaultAllowedChallenges: ['http-01', 'dns-01'],
    requiresEab: false,
  },
  {
    key: 'custom',
    category: 'private',
    defaultAllowedChallenges: ['http-01', 'dns-01'],
    requiresEab: false,
  },
];

export function listAcmeProviderPresets(): AcmeProviderPreset[] {
  return presets.map((preset) => ({
    ...preset,
    defaultAllowedChallenges: [...preset.defaultAllowedChallenges],
  }));
}

export function getAcmeProviderPreset(value: unknown): AcmeProviderPreset | undefined {
  return presets.find((preset) => preset.key === value);
}

export function isAcmeProviderPresetKey(value: unknown): value is AcmeProviderPresetKey {
  return typeof value === 'string' && acmeProviderPresetKeys.includes(value as AcmeProviderPresetKey);
}
