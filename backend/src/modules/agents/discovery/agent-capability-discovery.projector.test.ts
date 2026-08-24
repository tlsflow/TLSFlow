import assert from 'node:assert/strict';
import test from 'node:test';

import type { DatabasePort } from '../../../database/database-port.js';
import type { StandardDeviceDiscoveryV2 } from '../../plugins/discovery/device-discovery.dto.js';
import type { StandardDeviceDiscoveryProjector } from '../../plugins/discovery/standard-device-discovery.projector.js';
import type { AgentCapabilitySnapshot, AgentRegistration } from '../schema/agents.schema.js';
import { AgentCapabilityDiscoveryProjector } from './agent-capability-discovery.projector.js';

test('Go Agent 小写 IIS bindings 会生成带端口的站点和 HTTPS 受管目标', async () => {
  let projected: StandardDeviceDiscoveryV2 | undefined;
  const database = {
    query: async () => ({ rows: [{ id: 'host-1', hostname: 'iis-host', display_name: 'IIS Host', primary_ip: '10.0.0.10' }], rowCount: 1 }),
  } as unknown as DatabasePort;
  const projector = {
    project: async (_context: unknown, discovery: StandardDeviceDiscoveryV2) => {
      projected = discovery;
      return {};
    },
  } as unknown as StandardDeviceDiscoveryProjector;
  const service = new AgentCapabilityDiscoveryProjector(database, projector);

  await service.project({
    id: 'agent-1',
    descriptor: { hostname: 'iis-host', osVersion: 'Windows Server 2022', ipAddress: '10.0.0.10' },
  } as AgentRegistration, {
    id: 'snapshot-1',
    tenantId: 'tenant-1',
    reportedAt: '2026-07-29T00:00:00.000Z',
    capabilities: [{
      capabilityKey: 'windows.iis.detail',
      confidence: 1,
      value: {
        installed: true,
        versionString: '10.0',
        sites: [{
          id: 1,
          name: 'TEST',
          bindings: [
            { protocol: 'http', ipAddress: '*', port: 80, hostHeader: '', bindingInformation: '*:80:' },
            { protocol: 'https', ipAddress: '*', port: 4433, hostHeader: '', bindingInformation: '*:4433:', certificateStoreName: 'My' },
          ],
        }],
      },
    }],
  } as AgentCapabilitySnapshot);

  assert.ok(projected);
  assert.equal(projected.sites.length, 1);
  assert.equal(projected.sites[0]?.displayName, 'TEST');
  assert.equal(projected.sites[0]?.port, 4433);
  assert.equal(projected.sites[0]?.metadata?.bindingInformation, '*:4433:');
  assert.equal(projected.sites[0]?.metadata?.hostHeader, undefined);
  assert.deepEqual(projected.sites[0]?.addresses, ['*']);
  assert.equal(projected.managedTargets.length, 1);
  assert.equal(projected.managedTargets[0]?.bindingKey, '*:4433:');
  assert.equal(projected.managedTargets[0]?.targetType, 'tls.binding');
});
