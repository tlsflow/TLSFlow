import { describe, expect, it } from 'vitest'
import {
  createInputBindingsV1,
  projectInputBindingsV1,
  readInputBindingsV1,
} from '@/views/assets/asset-input-bindings.model'

describe('应用资产统一输入绑定', () => {
  it('始终生成完整的 InputBindingsV1 四命名空间', () => {
    expect(createInputBindingsV1({ variables: { verifyUrl: 'https://example.com' } })).toEqual({
      apiVersion: 'gcac.input-bindings/v1',
      variables: { verifyUrl: 'https://example.com' },
      connections: {},
      credentials: {},
      artifacts: {},
    })
  })

  it('只接受严格版本化的 V1 输入，不兼容读取旧字段', () => {
    expect(readInputBindingsV1({
      apiVersion: 'gcac.input-bindings/v1',
      variables: {},
      connections: {},
      credentials: {},
      artifacts: {},
    })).not.toBeNull()
    expect(readInputBindingsV1({ variableBindings: { host: 'legacy.example.com' } })).toBeNull()
    expect(readInputBindingsV1({
      apiVersion: 'gcac.input-bindings/v1',
      variables: {},
      connections: {},
      credentials: {},
    })).toBeNull()
  })

  it('直接从标准 Contract 投影变量、凭据和连接，不产生旧 Binding 字段', () => {
    const bindings = createInputBindingsV1({
      variables: { backupRoot: '/var/backups' },
      connections: { management: { host: '192.0.2.10', port: 22, username: 'deployer', hostKey: { expectedFingerprint: 'SHA256:test' } } },
      credentials: { sshCredential: { credentialId: 'credential-1' } },
    })
    const projection = projectInputBindingsV1({
      variables: {
        assetHost: { type: 'string', configurationMode: 'required', bindingPolicy: 'fixed', source: { kind: 'asset', path: 'asset.address' } },
        backupRoot: { type: 'string', configurationMode: 'advanced', bindingPolicy: 'default_overridable', source: { kind: 'binding' } },
      },
      credentials: {
        sshCredential: { configurationMode: 'required' },
      },
      connections: {
        management: {
          transport: 'ssh',
          credentialSlot: 'sshCredential',
          host: { configurationMode: 'required', bindingPolicy: 'required_binding' },
          port: { configurationMode: 'advanced', bindingPolicy: 'default_overridable' },
          username: { configurationMode: 'required', bindingPolicy: 'required_binding' },
          hostKey: { expectedFingerprint: { configurationMode: 'advanced', bindingPolicy: 'default_overridable' } },
        },
      },
    }, bindings)

    expect(projection.required.map((item) => item.name)).toEqual(['sshCredential'])
    expect(projection.advanced.map((item) => item.name)).toEqual(['backupRoot'])
    expect(projection.basicConnections[0]).toMatchObject({
      name: 'management',
      credentialSlot: 'sshCredential',
      status: 'resolved',
      hostKey: { expectedFingerprint: 'SHA256:test' },
    })
    expect(projection.basicConnections[0]).not.toHaveProperty('credentialRef')
    expect(projection.basicConnections[0]).not.toHaveProperty('expectedHostKeyFingerprint')
  })
})
