import type { LicenseQuotas } from './licensing.types.js';

export type ProductPlanCode = 'free' | 'commercial' | 'enterprise';
export type LegacyProductPlanCode = 'trial' | 'standard' | 'professional';

export interface ProductPlan {
  code: ProductPlanCode;
  aliases?: readonly LegacyProductPlanCode[];
  name: string;
  features: string[];
  quotas: LicenseQuotas;
  validityDays: number | null;
  gracePeriodDays: number;
  supportLevel: 'community_email' | 'business_5d' | 'commercial_sla';
  supportTermDays: number | null;
}

export const PRODUCT_CODE = 'gcac' as const;

export const PRODUCT_FEATURES = {
  coreAssets: 'core.assets',
  certificateOperations: 'certificate.operations',
  manualDeployment: 'deployment.manual',
  workflows: 'workflow.templates',
  monitoring: 'monitoring.basic',
  automation: 'automation',
  reports: 'reports',
  plugins: 'plugins',
  privateDeployment: 'deployment.private',
  offlineActivation: 'licensing.offline',
} as const;

export const PRODUCT_PLANS: readonly ProductPlan[] = [
  {
    code: 'free',
    aliases: ['trial'],
    name: '免费版',
    features: Object.values(PRODUCT_FEATURES),
    quotas: { managedTargets: 5, concurrentExecutions: null, plugins: null },
    validityDays: null,
    gracePeriodDays: 0,
    supportLevel: 'community_email',
    supportTermDays: null,
  },
  {
    code: 'commercial',
    aliases: ['standard', 'professional'],
    name: '商业版',
    features: Object.values(PRODUCT_FEATURES),
    quotas: { managedTargets: null, concurrentExecutions: null, plugins: null },
    validityDays: 365,
    gracePeriodDays: 30,
    supportLevel: 'business_5d',
    supportTermDays: 365,
  },
  {
    code: 'enterprise',
    name: '企业版',
    features: Object.values(PRODUCT_FEATURES),
    quotas: { managedTargets: null, concurrentExecutions: null, plugins: null },
    validityDays: null,
    gracePeriodDays: 0,
    supportLevel: 'commercial_sla',
    supportTermDays: null,
  },
] as const;

export function findPlan(code: string): ProductPlan | undefined {
  return PRODUCT_PLANS.find((plan) => plan.code === code || plan.aliases?.includes(code as LegacyProductPlanCode));
}
