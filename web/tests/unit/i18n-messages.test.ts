import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import enUS from '@/i18n/en-US'
import frFR from '@/i18n/fr-FR'
import jaJP from '@/i18n/ja-JP'
import koKR from '@/i18n/ko-KR'
import ptBR from '@/i18n/pt-BR'
import ruRU from '@/i18n/ru-RU'
import zhCN from '@/i18n/zh-CN'
import zhTW from '@/i18n/zh-TW'
import { localeLabels, normalizeLocale, supportedLocales, type SupportedLocale } from '@/i18n'
import { i18n } from '@/i18n'

function flattenKeys(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key
    return flattenKeys(child, nextPrefix)
  })
}

const localeMessages: Record<SupportedLocale, Record<string, unknown>> = {
  'zh-CN': zhCN,
  'zh-TW': zhTW,
  'en-US': enUS,
  'ja-JP': jaJP,
  'fr-FR': frFR,
  'ru-RU': ruRU,
  'pt-BR': ptBR,
  'ko-KR': koKR
}

function getMessage(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[key]
  }, value)
}

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectSourceFiles(filePath)
    return /\.(ts|tsx|vue|js|jsx)$/.test(entry.name) ? [filePath] : []
  })
}

function collectStaticTranslationKeys(): string[] {
  const sourceRoot = path.resolve(process.cwd(), 'src')
  const i18nDirectory = `${path.sep}i18n${path.sep}`
  const callPattern = /(?:\$t|\$te|\bt|\bte|i18n\.global\.t|i18n\.global\.te)\s*\(\s*(['"])([A-Za-z][A-Za-z0-9_.-]*)\1/g
  const keys = new Set<string>()

  for (const filePath of collectSourceFiles(sourceRoot)) {
    if (filePath.includes(i18nDirectory)) continue
    const source = readFileSync(filePath, 'utf8')
    callPattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = callPattern.exec(source)) !== null) keys.add(match[2])
  }

  return [...keys].sort()
}

describe('i18n 消息字典', () => {
  it('8 个 Locale 文件都能独立加载并提供核心文案', () => {
    const requiredKeys = [
      'app.versionLabel',
      'settings.version.title',
      'settings.version.description',
      'settings.version.currentVersion',
      'preferences.language',
      'preferences.theme',
      'shell.sidebarCollapse',
      'shell.sidebarExpand',
      'userMenu.changePassword',
      'password.submit',
      'dashboard.resources.host',
      'dashboard.statusBlock.detail.certificateRemaining',
      'agents.statusBlock.detail.certificateRemaining',
      'deploymentInputs.source',
      'deploymentInputs.sourceKinds.binding',
      'deploymentInputs.issues.DEPLOYMENT_INPUT_REQUIRED',
      'deploymentPlans.detail.workflowIdentityTitle',
      'deploymentPlans.detail.inputSourcesTitle',
      'deploymentPlans.detail.workflowDslVersion'
    ]
    for (const locale of supportedLocales) {
      expect(localeLabels[locale]).toBeTruthy()
      for (const key of requiredKeys) {
        expect(getMessage(localeMessages[locale], key), `${locale}.${key}`).toBeTruthy()
      }
    }
  })

  it('兼容旧版本短 locale 并统一到正式语言代码', () => {
    expect(normalizeLocale('zh')).toBe('zh-CN')
    expect(normalizeLocale('en')).toBe('en-US')
    expect(normalizeLocale('zh-CN')).toBe('zh-CN')
    expect(normalizeLocale('de')).toBe('zh-CN')
  })

  it('兼容旧 bundle 的证书剩余时间 key', () => {
    expect(i18n.global.t('agents.statusBlock.detail.certificateRemaining', { name: 'example.com', days: '剩余 3 天' })).toContain('example.com')
  })

  it('内置插件能力和权限在 8 种语言中保持完整', () => {
    const requiredCatalogKeys = [
      'plugins.capabilityKeys.application_discover',
      'plugins.capabilityKeys.ca_account_manage',
      'plugins.capabilityKeys.ca_order_manage',
      'plugins.capabilityKeys.ca_challenge_orchestrate',
      'plugins.capabilityKeys.ca_challenge_dns_solver',
      'plugins.capabilityKeys.ca_certificate_issue',
      'plugins.capabilityKeys.ca_certificate_renew',
      'plugins.capabilityKeys.ca_certificate_revoke',
      'plugins.capabilityKeys.cloud_service_connection_test',
      'plugins.capabilityKeys.cloud_service_discover',
      'plugins.permissionKeys.agent_execution_receipt',
      'plugins.permissionKeys.agent_fact_collect',
      'plugins.permissionKeys.agent_plan_execute',
      'plugins.permissionKeys.agent_plan_validate',
      'plugins.permissionKeys.audit_append',
      'plugins.permissionKeys.cloud_service_get',
      'plugins.permissionKeys.execution_cancel_read',
      'plugins.permissionKeys.execution_checkpoint',
      'plugins.permissionKeys.execution_checkpoint_read',
      'plugins.permissionKeys.execution_checkpoint_write',
      'plugins.permissionKeys.execution_progress',
      'plugins.permissionKeys.execution_progress_write',
      'plugins.permissionKeys.resource_lock',
      'plugins.permissionKeys.secret_resolve',
      'plugins.unknownCatalogValue',
    ]

    for (const locale of supportedLocales) {
      for (const key of requiredCatalogKeys) {
        expect(getMessage(localeMessages[locale], key), `${locale}.${key}`).toBeTruthy()
      }
    }
  })

  it('默认语言和英文语言都提供报表文案', () => {
    for (const locale of supportedLocales) {
      expect(getMessage(localeMessages[locale], 'nav.reports')).toBeTruthy()
      expect(getMessage(localeMessages[locale], 'reports.incidentWindow.title')).toBeTruthy()
      expect(getMessage(localeMessages[locale], 'reports.riskResponse.title')).toBeTruthy()
      expect(getMessage(localeMessages[locale], 'reports.automationEffectiveness.title')).toBeTruthy()
      expect(getMessage(localeMessages[locale], 'reports.export.csv')).toBeTruthy()
      expect(getMessage(localeMessages[locale], 'reports.aria.reportPage')).toBeTruthy()
    }
  })

  it('其余语言包覆盖默认语言的完整 key 集合', () => {
    const referenceKeys = flattenKeys(localeMessages['zh-CN']).filter(Boolean)
    for (const locale of supportedLocales) {
      const missingKeys = referenceKeys.filter((key) => getMessage(localeMessages[locale], key) === undefined)
      expect(missingKeys, `${locale} 缺少默认语言 key`).toEqual([])
    }
  })

  it('源码中的静态翻译调用在全部语言包中都有 key', () => {
    const staticKeys = collectStaticTranslationKeys()
    expect(staticKeys.length).toBeGreaterThan(0)

    for (const locale of supportedLocales) {
      const missingKeys = staticKeys.filter((key) => getMessage(localeMessages[locale], key) === undefined)
      expect(missingKeys, `${locale} 缺少静态调用 key`).toEqual([])
    }
  })

  it('语言文件中的翻译 key 可以被独立展开检查', () => {
    expect(flattenKeys(localeMessages['zh-CN'])).toContain('app.versionLabel')
    expect(flattenKeys(localeMessages['en-US'])).toContain('reports.export.csv')
  })

  it('监控主页和 TLS 深度检测在 8 种语言中保持完整且相互独立', () => {
    const referenceKeys = flattenKeys(localeMessages['zh-CN'].monitoring)

    for (const locale of supportedLocales) {
      const monitoring = getMessage(localeMessages[locale], 'monitoring')
      expect(monitoring, `${locale}.monitoring`).toBeTruthy()
      expect(flattenKeys(monitoring), `${locale} monitoring keys`).toEqual(referenceKeys)

      for (const key of referenceKeys) {
        const value = getMessage(monitoring, key.replace(/^monitoring\./, ''))
        expect(value, `${locale}.monitoring.${key}`).toBeTruthy()
      }
    }

    for (const locale of supportedLocales.filter((item) => item !== 'zh-CN' && item !== 'en-US')) {
      const localizedTls = getMessage(localeMessages[locale], 'monitoring.tls') as object | undefined
      const englishTls = getMessage(localeMessages['en-US'], 'monitoring.tls') as object | undefined
      expect(localizedTls).not.toBe(englishTls)
      expect(getMessage(localeMessages[locale], 'monitoring.tls.report.handshakeSimulationTitle')).not.toBe('Handshake Simulation')
      expect(getMessage(localeMessages[locale], 'monitoring.tls.messages.loadFailed')).not.toBe('Failed to load TLS inspection details')
    }

    const requiredTlsKeys = [
      'monitoring.tls.detailTitle',
      'monitoring.tls.actions.openDetail',
      'monitoring.tls.tabs.simulations',
      'monitoring.tls.labels.simulationFailures',
      'monitoring.tls.report.gradeScaleAria',
      'monitoring.tls.report.simulationFootnoteNoFs',
      'monitoring.tls.report.simulationFootnoteNoSni',
      'monitoring.tls.report.simulationFootnoteReference',
      'monitoring.tls.report.simulationFootnoteDefaults',
      'monitoring.tls.report.simulationFootnoteTrust',
      'monitoring.tls.messages.inspectorUnavailable',
    ]

    for (const locale of supportedLocales) {
      for (const key of requiredTlsKeys) {
        expect(getMessage(localeMessages[locale], key), `${locale}.${key}`).toBeTruthy()
      }
    }
  })
})
