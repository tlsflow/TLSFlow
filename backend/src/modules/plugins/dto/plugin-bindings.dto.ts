import type { InputBindingsV1 } from '../../deployment-inputs/dto/input-bindings.dto.js';

export interface PluginBindingV1 {
  id: string;
  tenantId: string;
  pluginVersionId: string;
  mode: 'MANAGED' | 'STANDALONE';
  inputBindings: InputBindingsV1;
  managedContext?: {
    hostId: string;
    managedTargetId?: string;
  };
  status: 'ACTIVE' | 'DISABLED' | 'MIGRATING' | 'ERROR';
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface CapabilityAssignmentV1 {
  id: string;
  tenantId: string;
  ownerType: 'DEVICE' | 'MANAGED_TARGET' | 'APPLICATION_ASSET';
  ownerId: string;
  capabilityKey: string;
  pluginVersionId: string;
  pluginBindingId: string;
  precedence: 'DEVICE_DEFAULT' | 'TARGET_OVERRIDE' | 'ASSET_OVERRIDE';
  status: 'ACTIVE' | 'DISABLED' | 'MIGRATING';
  createdAt: string;
  updatedAt: string;
}
