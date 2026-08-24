import { AppError } from '../../../common/errors/app-error.js';
import type {
  CloudAccountAsset,
  ProviderCapabilityPlugin,
  ProviderDefinition,
  ProviderExtensionDescriptor,
  ProviderOperationResult,
  ProviderScope,
} from '../dto/providers.dto.js';

export interface ProviderContext {
  tenantId: string;
  asset: CloudAccountAsset;
  requestId?: string;
}

export interface ProviderTargetRef {
  frameworkType: string;
  resourceId: string;
  domain?: string;
  listenerId?: string;
  certificateId?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderExtension {
  readonly descriptor: ProviderExtensionDescriptor;
  testConnection(context: ProviderContext): Promise<{ reachable: boolean; accountId?: string; details?: Record<string, unknown> }>;
  discover(context: ProviderContext, frameworkTypes?: string[]): Promise<Record<string, unknown>>;
  execute(
    operationKey: string,
    context: ProviderContext,
    target: ProviderTargetRef,
    input: Record<string, unknown>,
  ): Promise<ProviderOperationResult>;
}

export class ProviderExtensionRegistry {
  private readonly definitions = new Map<string, ProviderDefinition>();
  private readonly extensions = new Map<string, ProviderExtension>();
  private readonly capabilities = new Map<string, ProviderCapabilityPlugin>();

  registerDefinition(definition: ProviderDefinition): this {
    if (this.definitions.has(definition.providerKey)) {
      throw new AppError('RESOURCE_VERSION_CONFLICT', 'Provider 已注册', { providerKey: definition.providerKey });
    }
    this.definitions.set(definition.providerKey, structuredClone(definition));
    return this;
  }

  registerExtension(extension: ProviderExtension): this {
    const { descriptor } = extension;
    const definition = this.definitions.get(descriptor.providerKey);
    if (!definition) throw new AppError('PROVIDER_NOT_FOUND', 'Provider 未注册', { providerKey: descriptor.providerKey });
    if (definition.providerExtensionKey !== descriptor.extensionKey || definition.providerExtensionVersion !== descriptor.version) {
      throw new AppError('PROVIDER_EXTENSION_UNAVAILABLE', 'Provider Extension 版本与 Provider 定义不匹配', {
        providerKey: descriptor.providerKey,
        extensionKey: descriptor.extensionKey,
        extensionVersion: descriptor.version,
      });
    }
    this.extensions.set(descriptor.providerKey, extension);
    return this;
  }

  registerCapability(capability: ProviderCapabilityPlugin): this {
    const definition = this.definitions.get(capability.providerKey);
    if (!definition) throw new AppError('PROVIDER_NOT_FOUND', 'Provider 未注册', { providerKey: capability.providerKey });
    if (!definition.supportedProducts.includes(capability.frameworkType)) {
      throw new AppError('PROVIDER_OPERATION_UNSUPPORTED', 'Provider 不支持该产品', {
        providerKey: capability.providerKey,
        frameworkType: capability.frameworkType,
      });
    }
    if (!definition.supportedOperations.includes(capability.operationKey)) {
      throw new AppError('PROVIDER_OPERATION_UNSUPPORTED', 'Provider 不支持该操作', {
        providerKey: capability.providerKey,
        operationKey: capability.operationKey,
      });
    }
    this.capabilities.set(capabilityKey(capability), structuredClone(capability));
    return this;
  }

  listDefinitions(): ProviderDefinition[] {
    return [...this.definitions.values()].map((item) => structuredClone(item));
  }

  listExtensions(): ProviderExtensionDescriptor[] {
    return [...this.extensions.values()].map((item) => structuredClone(item.descriptor));
  }

  listCapabilities(filter: { providerKey?: string; frameworkType?: string; operationKey?: string } = {}): ProviderCapabilityPlugin[] {
    return [...this.capabilities.values()]
      .filter((item) => !filter.providerKey || item.providerKey === filter.providerKey)
      .filter((item) => !filter.frameworkType || item.frameworkType === filter.frameworkType)
      .filter((item) => !filter.operationKey || item.operationKey === filter.operationKey)
      .map((item) => structuredClone(item));
  }

  requireDefinition(providerKey: string): ProviderDefinition {
    const definition = this.definitions.get(providerKey);
    if (!definition) throw new AppError('PROVIDER_NOT_FOUND', 'Provider 未注册', { providerKey });
    return structuredClone(definition);
  }

  requireExtension(providerKey: string): ProviderExtension {
    const extension = this.extensions.get(providerKey);
    if (!extension) throw new AppError('PROVIDER_EXTENSION_UNAVAILABLE', 'Provider Extension 未安装或未启用', { providerKey });
    return extension;
  }

  requireCapability(providerKey: string, frameworkType: string, operationKey: string): ProviderCapabilityPlugin {
    const capability = this.capabilities.get(capabilityKey({ providerKey, frameworkType, operationKey }));
    if (!capability || !capability.enabled) {
      throw new AppError('PROVIDER_OPERATION_UNSUPPORTED', 'Provider 产品能力未启用', { providerKey, frameworkType, operationKey });
    }
    return structuredClone(capability);
  }

  async testConnection(context: ProviderContext): Promise<{ reachable: boolean; accountId?: string; details?: Record<string, unknown> }> {
    return this.requireExtension(context.asset.providerKey).testConnection(context);
  }

  async execute(
    providerKey: string,
    frameworkType: string,
    operationKey: string,
    context: ProviderContext,
    target: ProviderTargetRef,
    input: Record<string, unknown>,
  ): Promise<ProviderOperationResult> {
    this.requireCapability(providerKey, frameworkType, operationKey);
    return this.requireExtension(providerKey).execute(operationKey, context, target, input);
  }
}

export function capabilityKey(input: Pick<ProviderCapabilityPlugin, 'providerKey' | 'frameworkType' | 'operationKey'>): string {
  return `${input.providerKey}:${input.frameworkType}:${input.operationKey}`;
}

export function stableScopeHash(scope: ProviderScope): string {
  return stableJson(scope);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
