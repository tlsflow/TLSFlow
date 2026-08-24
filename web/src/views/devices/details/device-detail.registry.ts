import type { DeviceDetailContext, DeviceDetailTabDescriptor, DeviceDetailTabProvider } from './device-detail.model'

export class DeviceDetailTabRegistry {
  constructor(private readonly providers: readonly DeviceDetailTabProvider[] = []) {}

  register(provider: DeviceDetailTabProvider): DeviceDetailTabRegistry {
    return new DeviceDetailTabRegistry([...this.providers.filter(item => item.key !== provider.key), provider])
  }

  resolve(context: DeviceDetailContext): DeviceDetailTabDescriptor[] {
    const descriptors = this.providers
      .filter(provider => provider.supports(context))
      .flatMap(provider => provider.getTabs(context))
      .filter(tab => tab.isVisible(context))
      .sort((left, right) => left.order - right.order || left.key.localeCompare(right.key))
    return [...new Map(descriptors.map(tab => [tab.key, tab])).values()]
  }
}
