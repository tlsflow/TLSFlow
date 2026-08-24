import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { i18n } from '@/i18n'
import zhCN from '@/i18n/zh-CN'
import zhTW from '@/i18n/zh-TW'
import enUS from '@/i18n/en-US'
import jaJP from '@/i18n/ja-JP'
import frFR from '@/i18n/fr-FR'
import ruRU from '@/i18n/ru-RU'
import ptBR from '@/i18n/pt-BR'
import koKR from '@/i18n/ko-KR'
import IdentitySourcesView from '@/views/settings/IdentitySourcesView.vue'

const securityApiMocks = vi.hoisted(() => ({
  listIdentitySources: vi.fn(),
  listRoles: vi.fn(),
  createIdentitySource: vi.fn(),
  createSecret: vi.fn(),
  updateIdentitySource: vi.fn(),
  deleteIdentitySource: vi.fn(),
  testIdentitySource: vi.fn(),
}))

vi.mock('@/api/modules/security.api', () => securityApiMocks)

vi.mock('@/design-system/components', () => ({
  GcModal: defineComponent({
    name: 'GcModalStub',
    props: {
      open: { type: Boolean, default: false },
      title: { type: String, default: '' },
      description: { type: String, default: '' },
    },
    emits: ['update:open'],
    setup(props, { slots }) {
      return () => props.open
        ? h('div', { class: 'gc-modal-stub' }, [
            h('h2', props.title),
            h('p', props.description),
            slots.default?.(),
            slots.actions?.(),
          ])
        : null
    },
  }),
  GcConfirmAction: defineComponent({
    name: 'GcConfirmActionStub',
    template: '<button type="button"><slot /></button>',
  }),
  GcPageToolbar: defineComponent({
    name: 'GcPageToolbarStub',
    template: '<div class="gc-page-toolbar-stub"><slot name="actions" /><slot name="primary" /></div>',
  }),
}))

function mountView() {
  const localI18n = createI18n({
    legacy: false,
    locale: 'zh-CN',
    fallbackLocale: 'zh-CN',
    messages: {
      'zh-CN': i18n.global.getLocaleMessage('zh-CN'),
    },
  })
  return mount(IdentitySourcesView, {
    global: {
      plugins: [localI18n],
    },
  })
}

describe('IdentitySourcesView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    securityApiMocks.listIdentitySources.mockResolvedValue({
      data: {
        items: [{
          id: 'ids_existing',
          name: '企业 LDAP',
          type: 'ldap',
          url: 'ldap://ldap.example.test:389',
          baseDn: 'dc=example,dc=test',
          bindDn: 'cn=svc,dc=example,dc=test',
          userFilter: '(uid={{username}})',
          groupFilter: '(member={{userDn}})',
          syncUserFilter: '(uid=*)',
          requireGroupMapping: false,
          enabled: true,
        }],
      },
    })
    securityApiMocks.listRoles.mockResolvedValue({ data: { items: [] } })
    securityApiMocks.updateIdentitySource.mockResolvedValue({ data: {} })
    securityApiMocks.testIdentitySource.mockResolvedValue({
      data: {
        ok: true,
        code: 'OK',
        message: 'LDAP connection checks passed',
        checks: [
          { key: 'dns', status: 'passed', code: 'DNS_RESOLVED', message: 'DNS resolved successfully', details: { lookupRequired: false, addresses: ['10.255.0.78'] } },
          { key: 'port', status: 'passed', code: 'LDAP_PORT_REACHABLE', message: 'LDAP authentication port is reachable', details: { protocol: 'ldap', port: 389 } },
          { key: 'bind', status: 'passed', code: 'LDAP_BIND_OK', message: 'LDAP BIND succeeded', details: { bindDnConfigured: true } },
        ],
      },
    })
  })

  it('编辑已有 LDAP 记录时可以渲染双大括号模板，并且不清空原密码 SecretRef', async () => {
    const wrapper = mountView()
    await flushPromises()

    expect(wrapper.find('section.gc-page.identity-sources').exists()).toBe(true)
    const editButton = wrapper.findAll('button').find((button) => button.text().trim() === '编辑')
    expect(editButton).toBeTruthy()
    await editButton!.trigger('click')
    await flushPromises()

    expect(wrapper.find('input[placeholder="例如：(uid={{username}})"]').exists()).toBe(true)
    expect(wrapper.find('input[placeholder="例如：(member={{userDn}})"]').exists()).toBe(true)

    const saveButton = wrapper.findAll('button').find((button) => button.text().trim() === '保存修改')
    expect(saveButton).toBeTruthy()
    await saveButton!.trigger('click')
    await flushPromises()

    expect(securityApiMocks.createSecret).not.toHaveBeenCalled()
    expect(securityApiMocks.updateIdentitySource).toHaveBeenCalledWith(expect.objectContaining({
      id: 'ids_existing',
      userFilter: '(uid={{username}})',
      groupFilter: '(member={{userDn}})',
    }))
    expect(securityApiMocks.updateIdentitySource.mock.calls[0][0]).not.toHaveProperty('bindPasswordSecretRef')
  })

  it('所有语言包都能编译 LDAP 示例模板并还原原始双大括号', () => {
    const locales = {
      'zh-CN': zhCN,
      'zh-TW': zhTW,
      'en-US': enUS,
      'ja-JP': jaJP,
      'fr-FR': frFR,
      'ru-RU': ruRU,
      'pt-BR': ptBR,
      'ko-KR': koKR,
    }

    for (const [locale, messages] of Object.entries(locales)) {
      const localI18n = createI18n({
        legacy: false,
        locale,
        messages: { [locale]: messages },
        missingWarn: false,
        fallbackWarn: false,
      })
      expect(localI18n.global.t('settings.identitySources.placeholders.userFilter')).toContain('{{username}}')
      expect(localI18n.global.t('settings.identitySources.placeholders.groupFilter')).toContain('{{userDn}}')
      expect(localI18n.global.t('settings.identitySources.test.messages.summaryPassed')).not.toBe('settings.identitySources.test.messages.summaryPassed')
      expect(localI18n.global.t('common.close')).not.toBe('common.close')
    }
  })

  it('测试连通性按钮调用接口并按 DNS、端口、BIND 顺序显示结果', async () => {
    const wrapper = mountView()
    await flushPromises()

    const testButton = wrapper.findAll('button').find((button) => button.text().trim() === '测试连通性')
    expect(testButton).toBeTruthy()
    await testButton!.trigger('click')
    await flushPromises()

    expect(securityApiMocks.testIdentitySource).toHaveBeenCalledWith('ids_existing')
    expect(wrapper.text()).toContain('测试身份源连通性')
    expect(wrapper.text()).toContain('检查 DNS 解析')
    expect(wrapper.text()).toContain('检查 LDAP 认证端口')
    expect(wrapper.text()).toContain('检查 LDAP BIND')
    expect(wrapper.text()).toContain('LDAP 连通性检测全部通过')
    expect(wrapper.text()).toContain('目标是 IP 地址，无需进行 DNS 查询')
    expect(wrapper.text()).toContain('LDAP 认证端口 389 可连通')
    expect(wrapper.text()).toContain('LDAP 服务账号 BIND 和 Base DN 查询成功')
    expect(wrapper.text()).toContain('关闭')
    expect(wrapper.text()).not.toContain('designSystem.confirm.close')
    expect(wrapper.text()).not.toContain('LDAP connection checks passed')
    expect(wrapper.findAll('.identity-source-test__check--passed')).toHaveLength(3)
  })
})
