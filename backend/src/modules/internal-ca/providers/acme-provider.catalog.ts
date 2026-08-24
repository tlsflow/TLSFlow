import type { AcmeChallengeType } from '../schema/acme.schema.js';
import {
  acmeProviderProfileKeys,
  getAcmeProviderProfile,
  isAcmeProviderProfileKey,
  listAcmeProviderProfiles,
  type AcmeProviderProfileCategory,
  type AcmeProviderProfileKey,
} from './acme-provider-profiles.js';

export const acmeProviderPresetKeys = acmeProviderProfileKeys;

export type AcmeProviderPresetKey = AcmeProviderProfileKey;
export type AcmeProviderPresetCategory = AcmeProviderProfileCategory;

export interface AcmeProviderPreset {
  key: AcmeProviderPresetKey;
  category: AcmeProviderPresetCategory;
  defaultDirectoryUrl?: string;
  defaultAllowedChallenges: AcmeChallengeType[];
  requiresEab: boolean;
  profileVersion: string;
}

export function listAcmeProviderPresets(): AcmeProviderPreset[] {
  return listAcmeProviderProfiles().map(profileToPreset);
}

export function getAcmeProviderPreset(value: unknown): AcmeProviderPreset | undefined {
  const profile = getAcmeProviderProfile(value);
  return profile ? profileToPreset(profile) : undefined;
}

export function isAcmeProviderPresetKey(value: unknown): value is AcmeProviderPresetKey {
  return isAcmeProviderProfileKey(value);
}

function profileToPreset(profile: ReturnType<typeof listAcmeProviderProfiles>[number]): AcmeProviderPreset {
  return {
    key: profile.key,
    category: profile.category === 'custom' ? 'private' : profile.category,
    defaultDirectoryUrl: profile.directory.defaultUrl,
    defaultAllowedChallenges: [...profile.allowedChallenges],
    requiresEab: profile.account.eab === 'required',
    profileVersion: profile.version,
  };
}
