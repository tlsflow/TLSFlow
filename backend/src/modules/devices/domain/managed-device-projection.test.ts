import assert from 'node:assert/strict';
import test from 'node:test';
import type { ManagedDeviceSummaryDto } from '../dto/devices.dto.js';
import {
  AgentManagedDeviceProjectionAdapter,
  PluginManagedDeviceProjectionAdapter,
  ManagedDeviceProjectionRegistry,
  mapAgentHealth,
  mapNetworkDeviceHealth,
  type ManagedDeviceProjectionAdapter,
  type ManagedDeviceProjectionSource,
} from './managed-device-projection.js';

const commonSource: ManagedDeviceProjectionSource = {
  id: 'host_projection',
  displayName: '投影测试设备',
  osType: 'UNKNOWN',
  managementMode: 'AGENT',
  hostStatus: 'ACTIVE',
  applicationAssetCount: 2,
};

test('统一设备投影为 Windows Agent 输出系统版本而非 Agent 版本', () => {
  const now = new Date();
  const result = new AgentManagedDeviceProjectionAdapter().project({
    ...commonSource,
    osType: 'WINDOWS',
    osVersion: 'Windows Server 2022 21H2',
    agent: {
      lastHeartbeatAt: now.toISOString(),
      payload: {
        status: 'ONLINE',
        descriptor: {
          osType: 'WINDOWS',
          version: '1.2.3',
          osVersion: 'Windows Server 2022 21H2',
        },
      },
      capabilitySnapshot: {},
    },
  });

  assert.equal(result.softwareVersion, 'Windows Server 2022 21H2');
  assert.equal(result.controlVersion, '1.2.3');
  assert.notEqual(result.softwareVersion, '1.2.3');
  assert.equal(result.health, 'HEALTHY');
  assert.equal(result.applicationAssetCount, 2);
});

test('统一设备投影不把历史 Windows_NT 占位值当作系统版本', () => {
  const result = new AgentManagedDeviceProjectionAdapter().project({
    ...commonSource,
    osType: 'WINDOWS',
    osName: 'Windows Server',
    osVersion: 'Windows_NT',
    agent: {
      payload: {
        descriptor: {
          osType: 'WINDOWS',
          version: '1.2.3',
        },
      },
      capabilitySnapshot: {},
    },
  });

  assert.equal(result.softwareVersion, 'Windows Server');
});

test('统一设备投影为 Linux Agent 合并发行版和系统版本', () => {
  const result = new AgentManagedDeviceProjectionAdapter().project({
    ...commonSource,
    osType: 'LINUX',
    agent: {
      payload: {
        descriptor: {
          osType: 'LINUX',
          version: '2.0.0',
          linuxDistribution: 'Ubuntu',
          osVersion: '24.04',
        },
      },
      capabilitySnapshot: {},
    },
  });

  assert.equal(result.softwareVersion, 'Ubuntu 24.04');
});

test('统一设备投影从 Windows 能力快照兼容读取存量系统版本', () => {
  const result = new AgentManagedDeviceProjectionAdapter().project({
    ...commonSource,
    osType: 'WINDOWS',
    agent: {
      payload: {
        descriptor: {
          osType: 'WINDOWS',
          version: '1.2.3',
        },
      },
      capabilitySnapshot: {
        capabilities: [{
          capabilityKey: 'windows.os.detail',
          value: {
            ProductName: 'Windows Server 2022 Datacenter',
            DisplayVersion: '21H2',
            BuildRevision: '20348.2402',
          },
        }],
      },
    },
  });

  assert.equal(result.softwareVersion, 'Windows Server 2022 Datacenter 21H2');
});

test('统一设备投影为 Citrix ADC 输出固件版本和 Build', () => {
  const lastDiscoveredAt = new Date().toISOString();
  const result = new PluginManagedDeviceProjectionAdapter().project({
    ...commonSource,
    managementMode: 'API',
    networkAppliance: {
      deviceFamily: 'NETSCALER_ADC',
      softwareVersion: '13.1',
      softwareBuild: '55.29.nc',
      pluginVersion: '1.1.8',
      capabilityProfile: { certificateDeploy: true },
      lastDiscoveredAt,
    },
  });

  assert.equal(result.softwareVersion, '13.1 55.29.nc');
  assert.equal(result.controlVersion, '1.1.8');
  assert.equal(result.health, 'HEALTHY');
  assert.deepEqual(result.capabilities, ['certificateDeploy']);
});

test('Agent 注册状态在线但心跳过期时统一投影为不可达', () => {
  const result = mapAgentHealth(
    'ONLINE',
    '2026-07-25T07:55:00.000Z',
    new Date('2026-07-25T08:00:00.000Z'),
  );

  assert.equal(result, 'UNREACHABLE');
});

test('Agent 注册更新时间不能冒充最后心跳', () => {
  const result = new AgentManagedDeviceProjectionAdapter().project({
    ...commonSource,
    agent: {
      payload: {
        status: 'ONLINE',
        updatedAt: new Date().toISOString(),
        descriptor: { osType: 'WINDOWS', version: '0.1.1' },
      },
      capabilitySnapshot: {},
    },
  });

  assert.equal(result.lastContactAt, undefined);
  assert.equal(result.healthStatus, 'UNKNOWN');
});

test('插件设备只有过期历史发现记录时不再伪装为健康', () => {
  const result = mapNetworkDeviceHealth(
    'ACTIVE',
    undefined,
    'FULL',
    '2026-07-25T07:50:00.000Z',
    new Date('2026-07-25T08:00:00.000Z'),
  );

  assert.equal(result, 'UNKNOWN');
});

test('插件设备管理端口在线时健康状态不再停留在未知', () => {
  const observedAt = new Date().toISOString();
  const result = new PluginManagedDeviceProjectionAdapter().project({
    ...commonSource,
    managementMode: 'API',
    livenessSignals: [{
      id: 'signal_management_tcp',
      tenantId: 'default',
      resourceType: 'DEVICE',
      resourceId: commonSource.id,
      signalType: 'MANAGEMENT_TCP',
      required: true,
      status: 'HEALTHY',
      consecutiveFailures: 0,
      lastObservedAt: observedAt,
      lastSuccessAt: observedAt,
      source: 'CONTROL_PLANE',
      createdAt: observedAt,
      updatedAt: observedAt,
    }],
    networkAppliance: {
      deviceFamily: 'NETSCALER_ADC',
      capabilityProfile: {},
      lastDiscoveredAt: '2026-07-25T07:50:00.000Z',
    },
  });

  assert.equal(result.livenessStatus, 'ONLINE');
  assert.equal(result.healthStatus, 'HEALTHY');
  assert.equal(result.health, 'HEALTHY');
});

test('云服务不消费管理 TCP 探测，也不返回设备软件版本', () => {
  const discoveredAt = new Date().toISOString();
  const result = new PluginManagedDeviceProjectionAdapter().project({
    ...commonSource,
    hostStatus: 'ACTIVE',
    managementMode: 'API',
    livenessSignals: [{
      id: 'signal_cloud_tcp_failed',
      tenantId: 'default',
      resourceType: 'DEVICE',
      resourceId: commonSource.id,
      signalType: 'MANAGEMENT_TCP',
      required: true,
      status: 'FAILED',
      consecutiveFailures: 3,
      lastObservedAt: discoveredAt,
      lastFailureAt: discoveredAt,
      reasonCode: 'TCP_DNS_FAILED',
      source: 'CONTROL_PLANE',
      createdAt: discoveredAt,
      updatedAt: discoveredAt,
    }],
    networkAppliance: {
      deviceFamily: 'cloud.aliyun.cdn',
      productName: '阿里云 CDN',
      softwareVersion: 'should-not-be-exposed',
      softwareBuild: 'should-not-be-exposed',
      capabilityProfile: {},
      lastDiscoveredAt: discoveredAt,
      managementAddress: 'cdn.cloud.aliyun-test',
      metadata: { deviceCategory: 'CLOUD', livenessMode: 'DISCOVERY' },
    },
  });

  assert.equal(result.category, 'CLOUD');
  assert.equal(result.livenessStatus, undefined);
  assert.equal(result.softwareVersion, undefined);
  assert.deepEqual(result.livenessSignals, []);
});

test('存量 cloud.* 设备即使没有新 metadata 也按云服务处理', () => {
  const result = new PluginManagedDeviceProjectionAdapter().project({
    ...commonSource,
    networkAppliance: {
      deviceFamily: 'cloud.aliyun.cdn',
      softwareVersion: 'legacy-version',
      capabilityProfile: {},
    },
  });

  assert.equal(result.category, 'CLOUD');
  assert.equal(result.livenessStatus, undefined);
  assert.equal(result.softwareVersion, undefined);
});

test('统一设备投影 Registry 支持注册新的设备类型适配器', () => {
  const f5Adapter: ManagedDeviceProjectionAdapter = {
    key: 'F5_BIG_IP',
    supports: (source) => source.networkAppliance?.deviceFamily === 'F5_BIG_IP',
    project: (source): ManagedDeviceSummaryDto => ({
      id: source.id,
      displayName: source.displayName ?? source.id,
      category: 'NETWORK_APPLIANCE',
      productFamily: 'F5 BIG-IP',
      managementMethod: 'REST_API',
      health: 'HEALTHY',
      sourceStatus: source.hostStatus,
      softwareVersion: source.networkAppliance?.softwareVersion,
      applicationAssetCount: source.applicationAssetCount,
      capabilities: [],
      extensionType: 'NETWORK_APPLIANCE',
    }),
  };
  const registry = new ManagedDeviceProjectionRegistry([
    f5Adapter,
    new AgentManagedDeviceProjectionAdapter(),
    new PluginManagedDeviceProjectionAdapter(),
  ]);

  const result = registry.project({
    ...commonSource,
    networkAppliance: {
      deviceFamily: 'F5_BIG_IP',
      softwareVersion: '17.1.1',
      capabilityProfile: {},
    },
  });

  assert.equal(result.productFamily, 'F5 BIG-IP');
  assert.equal(result.softwareVersion, '17.1.1');
});
