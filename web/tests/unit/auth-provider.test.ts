import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/api/client'
import { ApiAuthProvider } from '@/providers/auth.provider'
import { getCurrentUser } from '@/api/modules/security.api'

vi.mock('@/api/modules/security.api', () => ({
  getCurrentUser: vi.fn(),
  login: vi.fn(),
  logout: vi.fn()
}))

describe('ApiAuthProvider', () => {
  beforeEach(() => {
    vi.mocked(getCurrentUser).mockReset()
  })

  it('启动登录态探测遇到未认证时返回空会话', async () => {
    vi.mocked(getCurrentUser).mockRejectedValue(
      new ApiClientError('缺少 actor 上下文', {
        errorCode: 'AUTH_UNAUTHENTICATED',
        requestId: 'req_bootstrap',
        status: 401
      })
    )

    await expect(new ApiAuthProvider().bootstrapSession()).resolves.toBeNull()
  })

  it('启动登录态探测遇到非认证错误时继续抛出', async () => {
    const error = new ApiClientError('服务异常', {
      errorCode: 'HTTP_500',
      requestId: 'req_bootstrap_failed',
      status: 500
    })
    vi.mocked(getCurrentUser).mockRejectedValue(error)

    await expect(new ApiAuthProvider().bootstrapSession()).rejects.toBe(error)
  })
})
