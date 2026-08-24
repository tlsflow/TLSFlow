import { describe, expect, it } from 'vitest'
import {
  createInputBindingsV1,
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

  it('完整保留统一 Binding 的变量、连接、凭据和 Artifact 命名空间', () => {
    const bindings = createInputBindingsV1({
      variables: { backupRoot: '/var/backups' },
      connections: { management: { host: '192.0.2.10', port: 22, username: 'deployer', hostKey: { expectedFingerprint: 'SHA256:test' } } },
      credentials: { sshCredential: { credentialId: 'credential-1' } },
      artifacts: { certificate: { certificateFormatId: 'format-1', outputBindings: { certificate: 'fullchain' } } },
    })

    expect(readInputBindingsV1(bindings)).toEqual(bindings)
    expect(bindings.credentials.sshCredential).toEqual({ credentialId: 'credential-1' })
    expect(bindings.artifacts.certificate).toEqual({ certificateFormatId: 'format-1', outputBindings: { certificate: 'fullchain' } })
    expect(bindings).not.toHaveProperty('variableBindings')
    expect(bindings).not.toHaveProperty('certificateArtifactBindings')
  })
})
