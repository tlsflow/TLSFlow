import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { i18n } from '@/i18n'
import DeviceCertificateCard from '@/views/devices/details/cards/DeviceCertificateCard.vue'

describe('站点证书过期倒计时', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('在站点绑定证书中显示剩余天数和成功色', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-27T12:00:00+08:00'))

    const wrapper = mount(DeviceCertificateCard, {
      props: {
        variant: 'binding',
        certificate: { name: 'future.example.com', notAfter: '2026-07-28T11:00:00+08:00' },
      },
      global: { plugins: [i18n] },
    })

    const countdown = wrapper.get('.agent-detail-modal__certificate-expiry')
    expect(countdown.text()).toBe('到期时间：1天')
    expect(countdown.attributes('data-tone')).toBe('success')
  })

  it('在已过期站点证书中显示过期天数和危险色', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-27T12:00:00+08:00'))

    const wrapper = mount(DeviceCertificateCard, {
      props: {
        variant: 'binding',
        certificate: { name: 'expired.example.com', notAfter: '2026-07-26T13:00:00+08:00' },
      },
      global: { plugins: [i18n] },
    })

    const countdown = wrapper.get('.agent-detail-modal__certificate-expiry')
    expect(countdown.text()).toBe('已过期1天')
    expect(countdown.attributes('data-tone')).toBe('danger')
  })

  it('独立证书资源卡不显示站点倒计时', () => {
    const wrapper = mount(DeviceCertificateCard, {
      props: {
        certificate: { name: 'resource.example.com', notAfter: '2026-07-28T11:00:00+08:00' },
      },
      global: { plugins: [i18n] },
    })

    expect(wrapper.find('.agent-detail-modal__certificate-expiry').exists()).toBe(false)
  })
})
