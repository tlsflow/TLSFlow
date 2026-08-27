import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import { PluginLocaleService } from '../locales/plugin-locale.service.js';
import { validateCloudAccountOnboardingRecipe } from './cloud-account-onboarding-recipe.schema.js';
import type { LoadedCloudAccountOnboardingRecipe, CloudAccountOnboardingRecipeV2 } from './cloud-account-onboarding-recipe.dto.js';

export type CloudAccountOnboardingRecipeSource = Pick<UnifiedPluginVersionRecord, 'id' | 'pluginId' | 'version' | 'manifest' | 'resources'> & { status?: UnifiedPluginVersionRecord['status']; resourceSha256?: Record<string, string> };

export class CloudAccountOnboardingRecipeLoader {
  constructor(private readonly locales = new PluginLocaleService()) {}

  load(source: CloudAccountOnboardingRecipeSource): LoadedCloudAccountOnboardingRecipe {
    if (source.status !== undefined && source.status !== 'ENABLED') throw unavailable(source, '只有已启用的插件版本可以提供云账号接入配方');
    const resourcePath = source.manifest.resources.onboarding?.cloudAccount;
    if (!resourcePath) throw unavailable(source, '插件 Manifest 未声明 cloudAccount 接入配方');
    const content = source.resources[resourcePath];
    if (content === undefined) throw invalid('配方资源不存在', { resourcePath });
    const recipeHash = sha256(content);
    if (source.resourceSha256?.[resourcePath] !== undefined && source.resourceSha256[resourcePath] !== recipeHash) throw invalid('配方资源摘要不匹配', { resourcePath });
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { throw invalid('配方资源不是合法 JSON', { resourcePath }); }
    const recipe = validateCloudAccountOnboardingRecipe(parsed, { manifest: source.manifest });
    const credentialContract = parseCredentialContract(source.resources[recipe.credentialContractResource]);
    const localeKeys = [
      recipe.display.nameKey,
      ...(recipe.display.descriptionKey ? [recipe.display.descriptionKey] : []),
      ...recipe.platformMetadata.compatibilityKeys,
      ...recipe.platformMetadata.requiredInformationKeys,
    ];
    if (!this.locales.validate(source.manifest, source.resources, localeKeys)) throw invalid('插件未提供云账号配方展示 Locale', { displayNameKey: recipe.display.nameKey });
    if (credentialContract.providerKey !== source.pluginId) throw invalid('凭据合同 providerKey 与插件不一致', { providerKey: credentialContract.providerKey });
    return { pluginVersionId: source.id, pluginId: source.pluginId, pluginVersion: source.version, resourcePath, recipeHash, recipe };
  }
}

function sha256(value: string): string { return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`; }
function unavailable(source: CloudAccountOnboardingRecipeSource, message: string): AppError { return new AppError('VALIDATION_FAILED', `云账号接入配方不可用：${message}`, { code: 'CLOUD_ACCOUNT_ONBOARDING_RECIPE_UNAVAILABLE', pluginId: source.pluginId, pluginVersionId: source.id }); }
function invalid(message: string, details: Record<string, unknown>): AppError { return new AppError('VALIDATION_FAILED', `云账号接入配方无效：${message}`, { code: 'CLOUD_ACCOUNT_ONBOARDING_RECIPE_INVALID', ...details }); }

function parseCredentialContract(content: string | undefined): { providerKey: string; slots: Array<{ name: string; secretType: string; required: boolean }> } {
  if (!content) throw invalid('凭据合同资源不存在', {});
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw invalid('凭据合同资源不是合法 JSON', {}); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('凭据合同必须是对象', {});
  const record = value as Record<string, unknown>;
  if (record.apiVersion !== 'gcac.credential-contract/v1' || record.kind !== 'CloudAccountCredentialContract' || record.credentialKind !== 'CLOUD_PROVIDER') throw invalid('凭据合同版本或类型无效', {});
  if (typeof record.providerKey !== 'string' || !record.providerKey.trim()) throw invalid('凭据合同 providerKey 缺失', {});
  if (!Array.isArray(record.slots) || record.slots.length === 0) throw invalid('凭据合同至少声明一个槽位', {});
  const slots = record.slots.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw invalid('凭据槽位必须是对象', { index });
    const slot = item as Record<string, unknown>;
    if (typeof slot.name !== 'string' || !slot.name.trim() || typeof slot.secretType !== 'string' || typeof slot.required !== 'boolean') throw invalid('凭据槽位字段无效', { index });
    if (!['password', 'api_token', 'private_key', 'certificate_private_key', 'ssh_key'].includes(slot.secretType)) throw invalid('凭据槽位 secretType 不支持', { index });
    return { name: slot.name.trim(), secretType: slot.secretType, required: slot.required };
  });
  if (new Set(slots.map((slot) => slot.name)).size !== slots.length) throw invalid('凭据槽位名称重复', {});
  return { providerKey: record.providerKey.trim(), slots };
}

export type { CloudAccountOnboardingRecipeV2 };
