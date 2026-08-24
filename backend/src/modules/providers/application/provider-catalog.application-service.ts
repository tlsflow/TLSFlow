import { AppError } from '../../../common/errors/app-error.js';

/**
 * Provider 目录旁路已清退。
 * 云账号资产仍保留不透明 providerKey，但宿主不再据此选择厂商实现或产品能力。
 */
export class ProviderCatalogApplicationService {
  // app.module.ts 仍会传入旧装配参数；保留参数位只为避免扩大本次清退范围。
  constructor(_legacyCatalog?: unknown) {}

  async listProviders(_tenantId = 'SYSTEM'): Promise<never[]> {
    throw providerCatalogDisabled();
  }

  async requireProvider(_tenantId: string, _providerKey: string): Promise<never> {
    throw providerCatalogDisabled();
  }

  async listCapabilities(_tenantId = 'SYSTEM', _filter?: unknown): Promise<never[]> {
    throw providerCatalogDisabled();
  }

  async requireDefinition(_providerKey: string): Promise<never> {
    throw providerCatalogDisabled();
  }
}

function providerCatalogDisabled(): AppError {
  return new AppError('PLUGIN_CAPABILITY_EXECUTION_FAILED', '宿主 Provider 目录已清退，必须提交固定 PluginVersion 并经 Runner 执行');
}
