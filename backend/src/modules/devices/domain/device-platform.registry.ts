import { AppError } from '../../../common/errors/app-error.js';
import type { DeviceOnboardingPlatformDescriptor } from '../dto/devices.dto.js';

const agentFields = [] as const;
const platforms: DeviceOnboardingPlatformDescriptor[] = [
  descriptor('windows', 'devices.platforms.windows', 'Windows Server', 'AGENT', 'AGENT_INSTALL', 'SUPPORTED', agentFields, 'WINDOWS_GO'),
  descriptor('windows-compatibility', 'devices.platforms.windowsCompatibility', 'Windows Server', 'AGENT_COMPATIBILITY', 'AGENT_INSTALL', 'SUPPORTED', agentFields, 'WINDOWS_COMPATIBILITY'),
  descriptor('linux', 'devices.platforms.linux', 'Linux Server', 'AGENT', 'AGENT_INSTALL', 'SUPPORTED', agentFields, 'LINUX_GO'),
];

export class DevicePlatformRegistry {
  list(): DeviceOnboardingPlatformDescriptor[] {
    return structuredClone(platforms);
  }

  requireSupported(key: string): DeviceOnboardingPlatformDescriptor {
    const platform = platforms.find((item) => item.key === key);
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
  onboardingKind: DeviceOnboardingPlatformDescriptor['onboardingKind'],
  supportStatus: DeviceOnboardingPlatformDescriptor['supportStatus'],
  formSchema: readonly DeviceOnboardingPlatformDescriptor['formSchema'][number][],
  handlerKey?: string,
): DeviceOnboardingPlatformDescriptor {
  return { key, displayNameKey, productFamily, managementMethod, onboardingKind, supportStatus, formSchema: [...formSchema], handlerKey };
}
