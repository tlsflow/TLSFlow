import type { NetscalerNitroClient } from './netscaler-nitro.client.js';
import { discoverNetscaler, type NetscalerDiscoveryResult } from './netscaler-nitro.discovery.js';

export class NetscalerProvider {
  constructor(private readonly client: NetscalerNitroClient) {}

  discover(): Promise<NetscalerDiscoveryResult> {
    return discoverNetscaler(this.client);
  }
}
