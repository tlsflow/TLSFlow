import { NetscalerNitroError } from './netscaler-nitro.errors.js';
import type { NetscalerCapabilityProfile, NetscalerSupportedVersion, NetscalerVersion } from './netscaler.types.js';

const fullDiscovery = {
  sslCertKey: true,
  lbVirtualServer: true,
  csVirtualServer: true,
  vpnVirtualServer: true,
  gslbVirtualServer: true,
  sslBindings: true,
};

const fullDeployment = {
  systemFileUpload: true,
  updateSslCertKey: true,
  addSslCertKey: true,
  bindSslCertKey: true,
  unbindSslCertKey: true,
  saveConfig: true,
};

const profiles: Record<NetscalerSupportedVersion, NetscalerCapabilityProfile> = {
  '10.5': profile('COMPATIBLE', '10.5', {
    sslCertKey: true,
    lbVirtualServer: true,
    csVirtualServer: false,
    vpnVirtualServer: false,
    gslbVirtualServer: false,
    sslBindings: true,
  }, {
    systemFileUpload: true,
    updateSslCertKey: true,
    addSslCertKey: false,
    bindSslCertKey: false,
    unbindSslCertKey: false,
    saveConfig: true,
  }, [
    'NETSCALER_10_5_DISCOVERY_LIMITED',
    'NETSCALER_10_5_CREATE_AND_REBIND_DISABLED',
  ]),
  '11.1': profile('COMPATIBLE', '11.1', {
    sslCertKey: true,
    lbVirtualServer: true,
    csVirtualServer: true,
    vpnVirtualServer: false,
    gslbVirtualServer: false,
    sslBindings: true,
  }, fullDeployment, ['NETSCALER_11_1_VPN_GSLB_DISCOVERY_DISABLED']),
  '12.1': profile('SUPPORTED', '12.1', fullDiscovery, fullDeployment),
  '13.0': profile('SUPPORTED', '13.0', fullDiscovery, fullDeployment),
  '13.1': profile('SUPPORTED', '13.1', fullDiscovery, fullDeployment),
  '14.1': profile('SUPPORTED', '14.1', fullDiscovery, fullDeployment),
};

export function getNetscalerCapabilityProfile(version: NetscalerVersion): NetscalerCapabilityProfile {
  if (version.normalized) return structuredClone(profiles[version.normalized]);
  return profile('READ_ONLY', 'unknown', {
    sslCertKey: false,
    lbVirtualServer: false,
    csVirtualServer: false,
    vpnVirtualServer: false,
    gslbVirtualServer: false,
    sslBindings: false,
  }, {
    systemFileUpload: false,
    updateSslCertKey: false,
    addSslCertKey: false,
    bindSslCertKey: false,
    unbindSslCertKey: false,
    saveConfig: false,
  }, ['NETSCALER_UNKNOWN_VERSION_READ_ONLY']);
}

export function assertNetscalerCapability(
  profileValue: NetscalerCapabilityProfile,
  area: 'auth' | 'discovery' | 'deployment',
  capability: string,
): void {
  const capabilities = profileValue[area] as Record<string, boolean>;
  if (capabilities[capability]) return;
  throw new NetscalerNitroError('NETSCALER_CAPABILITY_MISSING', '当前 NetScaler 版本不支持所需能力', {
    area,
    capability,
    supportTier: profileValue.supportTier,
    limitations: profileValue.limitations,
  });
}

function profile(
  supportTier: NetscalerCapabilityProfile['supportTier'],
  fieldMappingVersion: string,
  discovery: NetscalerCapabilityProfile['discovery'],
  deployment: NetscalerCapabilityProfile['deployment'],
  limitations: string[] = [],
): NetscalerCapabilityProfile {
  return {
    supportTier,
    auth: { session: true, perRequestHeaders: true },
    discovery: { ...discovery },
    deployment: { ...deployment },
    fieldMappingVersion,
    limitations: [...limitations],
  };
}
