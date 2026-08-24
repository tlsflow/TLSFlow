import DeviceLogsTab from './tabs/DeviceLogsTab.vue'
import DeviceOverviewTab from './tabs/DeviceOverviewTab.vue'
import DeviceSitesTab from './tabs/DeviceSitesTab.vue'
import { DeviceDetailTabRegistry } from './device-detail.registry'
import type { DeviceDetailContext, DeviceDetailTabDescriptor, DeviceSiteKind } from './device-detail.model'

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

function siteTab(key: string, labelKey: string, order: number, kind: DeviceSiteKind): DeviceDetailTabDescriptor {
  return {
    key, labelKey, order, component: DeviceSitesTab,
    isVisible: context => context.sites.some(site => site.kind === kind),
    buildProps: context => ({ sites: context.sites.filter(site => site.kind === kind) }),
  }
}

export const deviceDetailTabRegistry = new DeviceDetailTabRegistry([{
  key: 'default', supports: () => true, getTabs: () => [overview, logs],
}, {
  key: 'sites', supports: context => context.sites.length > 0,
  getTabs: () => [
    siteTab('iis', 'devices.unifiedDetail.tabs.iis', 300, 'IIS'),
    siteTab('nginx', 'devices.unifiedDetail.tabs.nginx', 310, 'NGINX'),
    siteTab('apache', 'devices.unifiedDetail.tabs.apache', 320, 'APACHE'),
    siteTab('tomcat', 'devices.unifiedDetail.tabs.tomcat', 330, 'TOMCAT'),
    siteTab('lb', 'devices.unifiedDetail.tabs.lb', 400, 'LB'),
    siteTab('vpn', 'devices.unifiedDetail.tabs.vpn', 410, 'VPN'),
  ],
}])
