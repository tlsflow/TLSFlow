import DeviceCertificatesTab from './tabs/DeviceCertificatesTab.vue'
import DeviceLogsTab from './tabs/DeviceLogsTab.vue'
import DeviceOverviewTab from './tabs/DeviceOverviewTab.vue'
import DeviceSitesTab from './tabs/DeviceSitesTab.vue'
import { DeviceDetailTabRegistry } from './device-detail.registry'
import type { DeviceDetailContext, DeviceDetailTabDescriptor, DeviceFrameworkView, DeviceSiteView } from './device-detail.model'

const overview: DeviceDetailTabDescriptor = {
  key: 'overview', labelKey: 'devices.unifiedDetail.tabs.overview', order: 100, component: DeviceOverviewTab,
  isVisible: () => true,
  buildProps: context => ({ sections: context.overviewSections }),
}

const logs: DeviceDetailTabDescriptor = {
  key: 'logs', labelKey: 'devices.unifiedDetail.tabs.logs', order: 900, component: DeviceLogsTab,
  isVisible: () => true,
  buildProps: context => ({ logs: context.logs }),
}

const certificates: DeviceDetailTabDescriptor = {
  key: 'certificates', labelKey: 'devices.unifiedDetail.tabs.certificates', order: 800, component: DeviceCertificatesTab,
  isVisible: hasCertificateSource,
  buildProps: context => ({ certificates: context.certificates }),
}

const sites: DeviceDetailTabDescriptor = {
  key: 'sites', labelKey: 'devices.unifiedDetail.tabs.sites', order: 300, component: DeviceSitesTab,
  isVisible: context => context.sites.length > 0 || context.resourceCounts.sites > 0,
  buildProps: context => ({ sites: context.sites }),
}

export const deviceDetailTabRegistry = new DeviceDetailTabRegistry([{
  key: 'default', supports: () => true, getTabs: () => [overview, logs],
}, {
  key: 'frameworks', supports: context => context.frameworks.length > 0,
  getTabs: context => buildFrameworkTabs(context.frameworks),
}, {
  key: 'certificates', supports: hasCertificateSource,
  getTabs: () => [certificates],
}, {
  // 没有框架实例的历史或异常数据，保留通用站点入口作为兼容回退。
  key: 'sites', supports: context => context.frameworks.length === 0 && (context.sites.length > 0 || context.resourceCounts.sites > 0),
  getTabs: context => context.sites.length > 0 ? buildSiteTabs(context) : [sites],
}])

function hasCertificateSource(context: DeviceDetailContext): boolean {
  return context.certificates.length > 0
    || context.frameworks.length > 0
    || context.sites.length > 0
    || context.resourceCounts.certificates > 0
    || context.resourceCounts.frameworks > 0
    || context.resourceCounts.sites > 0
}

function buildFrameworkTabs(frameworks: readonly DeviceFrameworkView[]): DeviceDetailTabDescriptor[] {
  return frameworks.map((framework, index) => ({
    key: `framework:${framework.id}`,
    labelKey: 'devices.unifiedDetail.tabs.frameworks',
    label: framework.name,
    order: 200 + index,
    component: DeviceSitesTab,
    isVisible: () => true,
    buildProps: context => ({ sites: context.sites.filter(site => site.frameworkInstanceId === framework.id) }),
  }))
}

function buildSiteTabs(context: DeviceDetailContext): DeviceDetailTabDescriptor[] {
  const groups = new Map<string, { label?: string; labelKey?: string; sites: DeviceSiteView[] }>()
  for (const site of context.sites) {
    const groupKey = site.presentation?.groupKey || site.frameworkType || site.kind
    const current = groups.get(groupKey)
    const labelKey = site.presentation?.groupLabelKey || builtinFrameworkGroupLabelKey(groupKey)
    const label = site.presentation?.groupLabel || current?.label || (!labelKey ? groupKey : undefined)
    groups.set(groupKey, {
      label,
      labelKey: current?.labelKey || labelKey,
      sites: [...(current?.sites ?? []), site],
    })
  }
  return [...groups.entries()].map(([groupKey, group], index) => ({
    key: 'sites:' + groupKey,
    labelKey: group.labelKey || 'devices.unifiedDetail.tabs.sites',
    label: group.label,
    order: 300 + index,
    component: DeviceSitesTab,
    isVisible: () => group.sites.length > 0,
    buildProps: () => ({ sites: group.sites }),
  }))
}

function builtinFrameworkGroupLabelKey(groupKey: string): string | undefined {
  switch (groupKey) {
    case 'web.iis':
      return 'devices.unifiedDetail.tabs.iis'
    case 'web.nginx':
      return 'devices.unifiedDetail.tabs.nginx'
    case 'web.apache':
      return 'devices.unifiedDetail.tabs.apache'
    case 'app.tomcat':
      return 'devices.unifiedDetail.tabs.tomcat'
    default:
      return undefined
  }
}
