import DeviceCertificatesTab from './tabs/DeviceCertificatesTab.vue'
import DeviceFrameworksTab from './tabs/DeviceFrameworksTab.vue'
import DeviceLogsTab from './tabs/DeviceLogsTab.vue'
import DeviceOverviewTab from './tabs/DeviceOverviewTab.vue'
import DeviceSitesTab from './tabs/DeviceSitesTab.vue'
import { DeviceDetailTabRegistry } from './device-detail.registry'
import type { DeviceDetailContext, DeviceDetailTabDescriptor, DeviceSiteView } from './device-detail.model'

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

const frameworks: DeviceDetailTabDescriptor = {
  key: 'frameworks', labelKey: 'devices.unifiedDetail.tabs.frameworks', order: 200, component: DeviceFrameworksTab,
  isVisible: context => context.frameworks.length > 0,
  buildProps: context => ({ frameworks: context.frameworks }),
}

const certificates: DeviceDetailTabDescriptor = {
  key: 'certificates', labelKey: 'devices.unifiedDetail.tabs.certificates', order: 800, component: DeviceCertificatesTab,
  isVisible: context => context.certificates.length > 0,
  buildProps: context => ({ certificates: context.certificates }),
}

export const deviceDetailTabRegistry = new DeviceDetailTabRegistry([{
  key: 'default', supports: () => true, getTabs: () => [overview, logs],
}, {
  key: 'resources', supports: context => context.frameworks.length > 0 || context.certificates.length > 0,
  getTabs: () => [frameworks, certificates],
}, {
  key: 'sites', supports: context => context.sites.length > 0,
  getTabs: context => buildSiteTabs(context),
}])

function buildSiteTabs(context: DeviceDetailContext): DeviceDetailTabDescriptor[] {
  const groups = new Map<string, { label: string; sites: DeviceSiteView[] }>()
  for (const site of context.sites) {
    const groupKey = site.presentation?.groupKey || site.frameworkType || site.kind
    const current = groups.get(groupKey)
    groups.set(groupKey, {
      label: site.presentation?.groupLabel || groupKey,
      sites: [...(current?.sites ?? []), site],
    })
  }
  return [...groups.entries()].map(([groupKey, group], index) => ({
    key: 'sites:' + groupKey,
    labelKey: 'devices.unifiedDetail.tabs.sites',
    label: group.label,
    order: 300 + index,
    component: DeviceSitesTab,
    isVisible: () => group.sites.length > 0,
    buildProps: () => ({ sites: group.sites }),
  }))
}
