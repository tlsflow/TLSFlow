import { AppError } from '../../../common/errors/app-error.js';
import type { DeviceOnboardingPlatformDescriptor } from '../dto/devices.dto.js';

const agentFields = [] as const;
const platforms: DeviceOnboardingPlatformDescriptor[] = [
  descriptor('windows-server-2008-r2', 'devices.platforms.windowsServer2008R2', 'Windows Server', 'AGENT_COMPATIBILITY', 'AGENT', 'AGENT_INSTALL', 'SUPPORTED', agentFields, 'WINDOWS_COMPATIBILITY', 'WINDOWS_POWERSHELL_2'),
  descriptor('windows-server-2012-r2', 'devices.platforms.windowsServer2012R2', 'Windows Server', 'AGENT_COMPATIBILITY', 'AGENT', 'AGENT_INSTALL', 'SUPPORTED', agentFields, 'WINDOWS_COMPATIBILITY'),
  descriptor('windows-server-2016-plus', 'devices.platforms.windowsServer2016Plus', 'Windows Server', 'AGENT', 'AGENT', 'AGENT_INSTALL', 'SUPPORTED', agentFields, 'WINDOWS_GO'),
  descriptor('linux-red-hat', 'devices.platforms.linuxRedHat', 'Linux Server', 'AGENT', 'AGENT', 'AGENT_INSTALL', 'SUPPORTED', agentFields, 'LINUX_GO', undefined, 'devices.platforms.linuxRedHatDescription', 'red-hat'),
  descriptor('linux-debian-ubuntu', 'devices.platforms.linuxDebianUbuntu', 'Linux Server', 'AGENT', 'AGENT', 'AGENT_INSTALL', 'SUPPORTED', agentFields, 'LINUX_GO', undefined, 'devices.platforms.linuxDebianUbuntuDescription', 'debian-ubuntu'),
  descriptor('linux-kylin', 'devices.platforms.linuxKylin', 'Linux Server', 'AGENT', 'AGENT', 'AGENT_INSTALL', 'SUPPORTED', agentFields, 'LINUX_GO', undefined, 'devices.platforms.linuxKylinDescription', 'kylin'),
  descriptor('linux-uos', 'devices.platforms.linuxUos', 'Linux Server', 'AGENT', 'AGENT', 'AGENT_INSTALL', 'SUPPORTED', agentFields, 'LINUX_GO', undefined, 'devices.platforms.linuxUosDescription', 'uos'),
];

const legacyPlatformAliases: Readonly<Record<string, string>> = {
  windows: 'windows-server-2016-plus',
  'windows-compatibility': 'windows-server-2012-r2',
  linux: 'linux-red-hat',
};

export class DevicePlatformRegistry {
  list(): DeviceOnboardingPlatformDescriptor[] {
    return structuredClone(platforms);
  }

  requireSupported(key: string): DeviceOnboardingPlatformDescriptor {
    const canonicalKey = legacyPlatformAliases[key] ?? key;
    const platform = platforms.find((item) => item.key === canonicalKey);
    if (!platform) throw new AppError('RESOURCE_NOT_FOUND', '设备平台不存在', { platformKey: key });
    if (platform.supportStatus !== 'SUPPORTED' || !platform.handlerKey) {
      throw new AppError('VALIDATION_FAILED', '设备平台尚未支持添加', { platformKey: key, supportStatus: platform.supportStatus });
    }
    return structuredClone(platform);
  }
}

function descriptor(
  key: string,
  displayNameKey: string,
  productFamily: string,
  managementMethod: string,
  group: DeviceOnboardingPlatformDescriptor['group'],
  onboardingKind: DeviceOnboardingPlatformDescriptor['onboardingKind'],
  supportStatus: DeviceOnboardingPlatformDescriptor['supportStatus'],
  formSchema: readonly DeviceOnboardingPlatformDescriptor['formSchema'][number][],
  handlerKey?: string,
  installCommandProfile?: DeviceOnboardingPlatformDescriptor['installCommandProfile'],
  supportDescriptionKey?: string,
  platformFamily?: DeviceOnboardingPlatformDescriptor['platformFamily'],
): DeviceOnboardingPlatformDescriptor {
  return {
    key,
    displayNameKey,
    supportDescriptionKey,
    productFamily,
    managementMethod,
    group,
    onboardingKind,
    supportStatus,
    formSchema: [...formSchema],
    handlerKey,
    installCommandProfile,
    platformFamily,
  };
}
