import { CompatibilityCatalogError } from '../../../shared/contracts/adapter-contracts.js';
import type { CapabilityDeclaration, CapabilityMatchResult } from '../../../shared/contracts/capability-contracts.js';
import type { ExecutionRecipe } from '../../../shared/contracts/compatibility-governance-contracts.js';
import { CapabilitiesDomainService } from '../../capabilities/domain/capabilities.domain-service.js';
import { CompatibilityGovernanceRegistry } from './compatibility-governance-registry.js';

export interface ExecutionRecipeResolution {
  recipe: ExecutionRecipe;
  capabilityMatch: CapabilityMatchResult;
}

export class ExecutionRecipeResolver {
  constructor(
    private readonly registry: CompatibilityGovernanceRegistry,
    private readonly capabilities = new CapabilitiesDomainService(),
  ) {}

  resolve(actionType: string, operationSchemaVersion: string, declarations: CapabilityDeclaration[]): ExecutionRecipeResolution {
    const evaluated = this.registry.listRecipes()
      .filter((recipe) => recipe.actionType === actionType && recipe.operationSchemaVersion === operationSchemaVersion)
      .map((recipe) => ({ recipe, capabilityMatch: this.capabilities.matchRequirement(recipe.requires, declarations) }))
      .filter((candidate) => candidate.capabilityMatch.status === 'matched')
      .sort((left, right) => `${left.recipe.recipeId}@${left.recipe.version}`.localeCompare(`${right.recipe.recipeId}@${right.recipe.version}`));

    if (evaluated.length === 0) {
      throw new CompatibilityCatalogError('COMPATIBILITY_RECIPE_NOT_FOUND', '没有 Execution Recipe 满足动作和能力要求', {
        actionType,
        operationSchemaVersion,
      });
    }
    if (evaluated.length > 1) {
      throw new CompatibilityCatalogError('COMPATIBILITY_RECIPE_AMBIGUOUS', '多个 Execution Recipe 同时满足动作和能力要求', {
        actionType,
        operationSchemaVersion,
        candidates: evaluated.map((candidate) => `${candidate.recipe.recipeId}@${candidate.recipe.version}`),
      });
    }
    return evaluated[0];
  }
}
