import type { CapabilityDeclaration } from '../../../shared/contracts/capability-contracts.js';
import type { AdapterResolutionResult } from '../../../shared/contracts/adapter-contracts.js';
import type { CompatibilityProfile } from '../../../shared/contracts/compatibility-profile-contracts.js';
import { CapabilitiesDomainService } from '../../capabilities/domain/capabilities.domain-service.js';
import { AdapterResolver } from './adapter-resolver.js';

export interface CompatibilityCatalogResolution {
  profile: CompatibilityProfile;
  resolution: AdapterResolutionResult;
}

export class CompatibilityCatalogResolver {
  constructor(
    private readonly adapterResolver: AdapterResolver,
    private readonly capabilities = new CapabilitiesDomainService(),
  ) {}

  resolve(profile: CompatibilityProfile, declarations: CapabilityDeclaration[], actionSchemaVersion: string): CompatibilityCatalogResolution {
    if (profile.status === 'unsupported') {
      return {
        profile,
        resolution: blocked('COMPATIBILITY_PROFILE_UNSUPPORTED', 'Compatibility Profile 明确标记为 unsupported'),
      };
    }

    const profileMatch = this.capabilities.matchRequirement(profile.match, declarations);
    if (profileMatch.status !== 'matched') {
      return {
        profile,
        resolution: {
          ...blocked('CAPABILITY_REQUIREMENT_UNSATISFIED', `Profile 能力匹配状态为 ${profileMatch.status}`),
          missingCapabilities: profileMatch.missingCapabilities,
          fallbackSuggestions: profileMatch.degradationSuggestions,
          evidence: [{
            code: 'COMPATIBILITY_PROFILE_BLOCKED',
            message: `Profile ${profile.profileId}@${profile.version} 不满足目标能力`,
            capabilityMatch: profileMatch,
          }],
        },
      };
    }

    return {
      profile,
      resolution: this.adapterResolver.resolve({
        actionSchemaVersion,
        declarations,
        requiredKinds: Object.keys(profile.composition) as Array<keyof typeof profile.composition>,
        composition: profile.composition,
      }),
    };
  }
}

function blocked(code: string, message: string): AdapterResolutionResult {
  return {
    status: 'blocked',
    selected: {},
    missingCapabilities: [],
    conflicts: [],
    evidence: [{ code, message }],
    fallbackSuggestions: [],
  };
}
