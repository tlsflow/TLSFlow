import { createHash } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { PluginCapabilityRegistry } from '../../plugins/capabilities/plugin-capability.registry.js';
import { PluginLocaleService } from '../../plugins/locales/plugin-locale.service.js';
import type { UnifiedPluginVersionRecord } from '../../plugins/dto/unified-plugins.dto.js';
import {
  type ApplicationOnboardingRecipeV1,
  type LoadedApplicationOnboardingRecipe,
} from './application-onboarding-recipe.dto.js';
import { validateApplicationOnboardingRecipe } from './application-onboarding-recipe.schema.js';

export type ApplicationOnboardingRecipeSource = Pick<
  UnifiedPluginVersionRecord,
  'id' | 'pluginId' | 'version' | 'manifest' | 'resources'
> & {
  /** 运行时固定版本会提供状态和资源摘要；测试或发布预检可省略。 */
  status?: UnifiedPluginVersionRecord['status'];
  resourceSha256?: Record<string, string>;
};

/**
 * 从固定 PluginVersion 读取接入配方，并把资源哈希绑定到返回值。
 * 该 Loader 不接受前端传入的文件路径，也不执行插件资源中的代码。
 */
export class ApplicationOnboardingRecipeLoader {
  constructor(
    private readonly capabilityRegistry = new PluginCapabilityRegistry(),
    private readonly locales = new PluginLocaleService(),
  ) {}

  load(source: ApplicationOnboardingRecipeSource): LoadedApplicationOnboardingRecipe {
    const recipes = this.loadAll(source);
    if (recipes.length !== 1) {
      throw invalid('插件声明了多个接入配方，调用方必须按平台枚举', { recipeCount: recipes.length });
    }
    return recipes[0]!;
  }

  loadAll(source: ApplicationOnboardingRecipeSource): LoadedApplicationOnboardingRecipe[] {
    if (source.status !== undefined && source.status !== 'ENABLED') {
      throw unavailable(source, '只有已启用的插件版本可以提供接入配方');
    }
    const resourcePaths = onboardingResourcePaths(source);
    if (resourcePaths.length === 0) {
      throw unavailable(source, '插件 Manifest 未声明接入配方资源');
    }
    const recipes = resourcePaths.map((resourcePath) => this.loadResource(source, resourcePath));
    const duplicatePlatformKey = recipes.find((recipe, index) => recipes.findIndex((item) => item.recipe.platformKey === recipe.recipe.platformKey) !== index)?.recipe.platformKey;
    if (duplicatePlatformKey) {
      throw invalid('同一插件版本不能声明重复的平台键', { pluginVersionId: source.id, platformKey: duplicatePlatformKey });
    }
    return recipes;
  }

  private loadResource(source: ApplicationOnboardingRecipeSource, resourcePath: string): LoadedApplicationOnboardingRecipe {
    const content = source.resources[resourcePath];
    if (content === undefined) {
      throw invalid('配方资源不存在', { resourcePath });
    }
    const recipeHash = sha256(content);
    const declaredHash = source.resourceSha256?.[resourcePath];
    if (declaredHash !== undefined && declaredHash !== recipeHash) {
      throw invalid('配方资源摘要不匹配', { resourcePath, expectedHash: declaredHash, actualHash: recipeHash });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw invalid('配方资源不是合法 JSON', { resourcePath });
    }
    const recipe = validateApplicationOnboardingRecipe(parsed, { manifest: source.manifest }, this.capabilityRegistry);
    for (const formPath of Object.values(recipe.forms)) {
      if (formPath !== undefined && source.resources[formPath] === undefined) {
        throw invalid('表单资源不存在', { resourcePath: formPath });
      }
    }
    // 平台名称与业务接入说明都必须来自插件 Locale，避免目录出现不可翻译或不完整的平台卡片。
    const localeBundle = this.locales.validate(source.manifest, source.resources, onboardingLocaleKeys(recipe));
    if (!localeBundle) invalid('插件未提供包含配方展示名称的 Locale 资源', { displayNameKey: recipe.displayNameKey });
    return {
      pluginVersionId: source.id,
      pluginId: source.pluginId,
      pluginVersion: source.version,
      resourcePath,
      recipeHash,
      recipe,
    };
  }

  loadOptional(source: ApplicationOnboardingRecipeSource): LoadedApplicationOnboardingRecipe[] | undefined {
    return onboardingResourcePaths(source).length === 0 ? undefined : this.loadAll(source);
  }
}

function onboardingLocaleKeys(recipe: ApplicationOnboardingRecipeV1): string[] {
  return [
    recipe.displayNameKey,
    ...(recipe.platformMetadata?.compatibilityKeys ?? []),
    ...(recipe.platformMetadata?.requiredInformationKeys ?? []),
  ];
}

function onboardingResourcePaths(source: ApplicationOnboardingRecipeSource): string[] {
  const onboarding = source.manifest.resources.onboarding;
  if (!onboarding) return [];
  return [
    ...(onboarding.applicationAsset ? [onboarding.applicationAsset] : []),
    ...Object.values(onboarding.applicationAssets ?? {}),
  ];
}

export function cloneApplicationOnboardingRecipe(recipe: LoadedApplicationOnboardingRecipe): LoadedApplicationOnboardingRecipe {
  return structuredClone(recipe);
}

function sha256(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function unavailable(source: ApplicationOnboardingRecipeSource, message: string): AppError {
  return new AppError('VALIDATION_FAILED', `接入配方不可用：${message}`, {
    code: 'ONBOARDING_RECIPE_UNAVAILABLE',
    pluginId: source.pluginId,
    pluginVersionId: source.id,
  });
}

function invalid(message: string, details: Record<string, unknown>): AppError {
  return new AppError('VALIDATION_FAILED', `接入配方无效：${message}`, {
    code: 'ONBOARDING_RECIPE_INVALID',
    ...details,
  });
}

export type { ApplicationOnboardingRecipeV1 };
