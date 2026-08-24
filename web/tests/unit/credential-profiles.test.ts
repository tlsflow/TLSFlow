import { describe, expect, it } from 'vitest'
import { isProxy, reactive } from 'vue'
import { credentialProfileBinding, type CredentialProfileOption } from '@/views/workflows/credential-profiles'

describe('credentialProfileBinding', () => {
  it('可以从 Vue 响应式凭据创建普通运行时绑定', () => {
    const credential = reactive<CredentialProfileOption>({
      id: 'credential-1',
      credentialId: 'credential-1',
      name: 'SSH 凭据',
      kind: 'SSH_KEY',
      username: 'root',
      secretRefs: { privateKey: 'secret://credential-1/privateKey' },
      createdAt: '2026-07-29T00:00:00.000Z',
    })

    const binding = credentialProfileBinding(credential)

    expect(binding).toEqual({
      credentialId: 'credential-1',
      kind: 'SSH_KEY',
      username: 'root',
      delivery: undefined,
      secretRefs: { privateKey: 'secret://credential-1/privateKey' },
    })
    expect(isProxy(binding.secretRefs)).toBe(false)
  })
})
