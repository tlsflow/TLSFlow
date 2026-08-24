import type { DatabasePort } from '../../../database/database-port.js';
import type { SecretService } from '../../secrets/secret.service.js';
import { NetscalerNitroClient, NetscalerNitroError, NetscalerProvider, type NetscalerCredentials } from '../../providers/netscaler/index.js';
import type { DeviceAssetDto } from '../dto/device-assets.dto.js';
import { DeviceAssetsDiscoveryProjector } from './device-assets.discovery-projector.js';
import type { DeviceConnectionTester, DeviceConnectionTestResult } from './device-assets.application-service.js';

export class NetscalerDeviceConnectionTester implements DeviceConnectionTester {
  private readonly projector: DeviceAssetsDiscoveryProjector;

  constructor(private readonly db: DatabasePort, private readonly secrets: SecretService) {
    this.projector = new DeviceAssetsDiscoveryProjector(db);
  }

  async test(device: DeviceAssetDto, actorId: string): Promise<DeviceConnectionTestResult> {
    const client = new NetscalerNitroClient({
      managementAddress: device.managementAddress,
      managementPort: device.managementPort,
      credentialId: device.credentialId,
      authMode: device.authMode,
      tls: { verify: device.tlsVerify },
      context: { tenantId: device.tenantId, actorId },
      credentialResolver: {
        resolveCredentials: (credentialId, context) => this.resolveCredentials(credentialId, actorId, context.purpose),
      },
    });
    try {
      const discovery = await new NetscalerProvider(client).discover();
      await this.projector.project(device.tenantId, device.id, discovery);
      return {
        reachable: true,
        authenticated: true,
        productMatched: true,
        productName: discovery.device.productName,
        softwareVersion: discovery.device.softwareVersion,
        softwareBuild: discovery.device.softwareBuild,
        supportLevel: discovery.capabilityProfile.supportTier,
        capabilities: { ...discovery.capabilityProfile },
        warnings: discovery.warnings,
      };
    } catch (cause) {
      const errorCode = connectionErrorCode(cause);
      await this.projector.projectFailure(device.tenantId, device.id, errorCode);
      if (cause instanceof NetscalerNitroError) {
        return {
          reachable: errorCode !== 'NETSCALER_UNREACHABLE' && errorCode !== 'NETSCALER_TLS_UNTRUSTED',
          authenticated: false,
          productMatched: false,
          capabilities: {},
          warnings: [],
          errorCode,
        };
      }
      throw cause;
    } finally {
      await client.close();
    }
  }

  private async resolveCredentials(secretRef: string, actorId: string, purpose: string): Promise<NetscalerCredentials> {
    const resolved = await this.secrets.resolveForService({ secretRef, expectedType: 'password', purpose, actorId });
    const parsed = JSON.parse(resolved.plainText) as Partial<NetscalerCredentials>;
    if (!parsed.username || !parsed.password) throw new Error('NITRO 凭据格式无效');
    return { username: parsed.username, password: parsed.password };
  }
}

function connectionErrorCode(cause: unknown): string {
  if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') return cause.code;
  return 'NETSCALER_UNREACHABLE';
}
