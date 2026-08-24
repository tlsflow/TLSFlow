import { createHash } from 'node:crypto';

export type DeviceCategoryCode = 'load_balancer' | 'firewall' | 'waf' | 'gateway' | 'custom';
export type TemplateProtocol = 'http' | 'ssh' | 'mixed';
export type CertFormat = 'PEM' | 'PFX' | 'JKS' | 'CHAIN';
export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type VerificationStatus = 'official_verified' | 'community_verified' | 'community_unverified' | 'example_only' | 'draft';
export type CompatibilityVerificationStatus = 'official_verified' | 'community_verified' | 'community_unverified' | 'draft';
export type ConflictStrategy = 'skip' | 'new_version' | 'rename';
export type ContributionStatus = 'submitted' | 'under_review' | 'accepted' | 'rejected';

export interface DeviceCategory {
  id: string;
  code: DeviceCategoryCode;
  name: string;
  description: string;
}

export interface TemplateCatalogItem {
  id: string;
  workflowTemplateId: string;
  version: string;
  name: string;
  categoryId: string;
  categoryCode: DeviceCategoryCode;
  vendor: string;
  model: string;
  protocols: TemplateProtocol[];
  authMethods: string[];
  interactive: boolean;
  riskLevel: RiskLevel;
  status: VerificationStatus;
  supportedCertFormats: CertFormat[];
  tags: string[];
  dsl: TemplateDsl;
  rollbackDescription?: string;
  source: 'default' | 'custom' | 'imported' | 'contribution';
}

export interface CompatibilityMatrixEntry {
  id: string;
  catalogItemId: string;
  vendor: string;
  modelPattern: string;
  firmwareRange?: string;
  protocols: TemplateProtocol[];
  limitations: string[];
  verificationStatus: CompatibilityVerificationStatus;
  testedAt?: string;
}

export interface TemplateDslStep {
  id: string;
  type: 'http' | 'ssh' | 'assert' | 'rollback' | string;
  command?: string;
  url?: string;
  body?: string;
  uses?: string[];
}

export interface TemplateDsl {
  schemaVersion: string;
  variables: Array<{ name: string; type: 'string' | 'secret' | 'certificate' | 'path' }>;
  steps: TemplateDslStep[];
  rollback?: TemplateDslStep[];
}

export interface TemplateBundle {
  bundleVersion: string;
  exportedAt: string;
  templates: TemplateCatalogItem[];
  compatibility: CompatibilityMatrixEntry[];
  docs?: Record<string, string>;
  tests?: Record<string, unknown>;
  signature?: string;
  hash?: string;
}

export interface ImportTemplateResult {
  templateId: string;
  action: 'imported' | 'skipped' | 'new_version' | 'renamed' | 'rejected';
  reason?: string;
}

export interface ImportReport {
  accepted: boolean;
  hash: string;
  signatureValid: boolean;
  results: ImportTemplateResult[];
  failures: string[];
}

export interface QualityRuleResult {
  rule: string;
  passed: boolean;
  severity: RiskLevel;
  message: string;
}

export interface QualityReport {
  id: string;
  templateId: string;
  passed: boolean;
  riskLevel: RiskLevel;
  failedRules: string[];
  rules: QualityRuleResult[];
  createdAt: string;
}

export interface TemplateContribution {
  id: string;
  template: TemplateCatalogItem;
  compatibility: CompatibilityMatrixEntry[];
  contributorId: string;
  summary: string;
  status: ContributionStatus;
  submittedAt: string;
  reviewer?: string;
  reason?: string;
  qualityReport: QualityReport;
}

export interface CatalogQuery {
  category?: DeviceCategoryCode;
  vendor?: string;
  model?: string;
  protocol?: TemplateProtocol;
  certFormat?: CertFormat;
  riskLevel?: RiskLevel;
  status?: VerificationStatus;
}

export interface CompatibilityQuery {
  vendor: string;
  model: string;
  firmware?: string;
  protocol?: TemplateProtocol;
}

const RISK_WEIGHT: Record<RiskLevel, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export class DeviceCategoryService {
  private readonly categories = new Map<string, DeviceCategory>();

  constructor(categories = defaultCategories()) {
    for (const category of categories) {
      this.categories.set(category.id, category);
    }
  }

  list(): DeviceCategory[] {
    return [...this.categories.values()];
  }

  findByCode(code: DeviceCategoryCode): DeviceCategory | undefined {
    return this.list().find((category) => category.code === code);
  }
}

export class TemplateCatalogService {
  private readonly items = new Map<string, TemplateCatalogItem>();

  constructor(items = defaultCatalogItems()) {
    for (const item of items) {
      this.upsert(item);
    }
  }

  list(query: CatalogQuery = {}): TemplateCatalogItem[] {
    return [...this.items.values()].filter((item) => matchesCatalogQuery(item, query));
  }

  get(id: string): TemplateCatalogItem | undefined {
    return this.items.get(id);
  }

  upsert(item: TemplateCatalogItem): TemplateCatalogItem {
    this.items.set(item.id, clone(item));
    return item;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }
}

export class CompatibilityMatrixService {
  private readonly entries = new Map<string, CompatibilityMatrixEntry>();

  constructor(entries = defaultCompatibilityMatrix()) {
    for (const entry of entries) {
      this.upsert(entry);
    }
  }

  upsert(entry: CompatibilityMatrixEntry): CompatibilityMatrixEntry {
    const verificationStatus = entry.testedAt ? entry.verificationStatus : toUnverifiedStatus(entry.verificationStatus);
    this.entries.set(entry.id, clone({ ...entry, verificationStatus }));
    return entry;
  }

  listByCatalogItem(catalogItemId: string): CompatibilityMatrixEntry[] {
    return [...this.entries.values()].filter((entry) => entry.catalogItemId === catalogItemId);
  }

  match(query: CompatibilityQuery): CompatibilityMatrixEntry[] {
    return [...this.entries.values()].filter((entry) => {
      if (!sameText(entry.vendor, query.vendor)) return false;
      if (!wildcardMatch(entry.modelPattern, query.model)) return false;
      if (query.protocol && !entry.protocols.includes(query.protocol)) return false;
      if (query.firmware && entry.firmwareRange && !versionInRange(query.firmware, entry.firmwareRange)) return false;
      return true;
    });
  }
}

export class BundleVerifier {
  verify(bundle: TemplateBundle): { hash: string; signatureValid: boolean; failures: string[] } {
    const failures = validateBundleStructure(bundle);
    const hash = calculateBundleHash(bundle);
    const expectedSignature = mockSignature(hash);
    const signatureValid = bundle.signature === undefined || bundle.signature === expectedSignature;
    if (!signatureValid) {
      failures.push('签名校验失败');
    }
    if (bundle.hash && bundle.hash !== hash) {
      failures.push('hash 不匹配');
    }
    return { hash, signatureValid, failures };
  }
}

export class TemplateBundleService {
  constructor(
    private readonly catalog = new TemplateCatalogService(),
    private readonly compatibility = new CompatibilityMatrixService(),
    private readonly qualityGate = new TemplateQualityGate(),
    private readonly verifier = new BundleVerifier(),
  ) {}

  exportBundle(templateIds: string[], options: { includeSignature?: boolean } = {}): TemplateBundle {
    const templates = templateIds.map((id) => this.catalog.get(id)).filter((item): item is TemplateCatalogItem => item !== undefined);
    const bundle: TemplateBundle = {
      bundleVersion: '1.0',
      exportedAt: new Date(0).toISOString(),
      templates: clone(templates),
      compatibility: templates.flatMap((template) => this.compatibility.listByCatalogItem(template.id)),
      docs: {},
      tests: {},
    };
    const hash = calculateBundleHash(bundle);
    return { ...bundle, hash, signature: options.includeSignature ? mockSignature(hash) : undefined };
  }

  importBundle(bundle: TemplateBundle, strategy: ConflictStrategy): ImportReport {
    const verification = this.verifier.verify(bundle);
    const results: ImportTemplateResult[] = [];
    if (verification.failures.length > 0) {
      return { accepted: false, hash: verification.hash, signatureValid: verification.signatureValid, results, failures: verification.failures };
    }

    for (const template of bundle.templates) {
      const report = this.qualityGate.evaluate(template);
      if (!report.passed) {
        results.push({ templateId: template.id, action: 'rejected', reason: `质量门禁失败：${report.failedRules.join(',')}` });
        continue;
      }
      const existing = this.catalog.get(template.id);
      if (!existing) {
        this.catalog.upsert({ ...template, source: 'imported' });
        results.push({ templateId: template.id, action: 'imported' });
        continue;
      }
      if (strategy === 'skip') {
        results.push({ templateId: template.id, action: 'skipped', reason: '模板 ID 已存在' });
        continue;
      }
      if (strategy === 'new_version') {
        const next = { ...template, version: nextPatchVersion(existing.version), source: 'imported' as const };
        this.catalog.upsert(next);
        results.push({ templateId: next.id, action: 'new_version' });
        continue;
      }
      const renamed = { ...template, id: uniqueId(`${template.id}-imported`, (id) => this.catalog.has(id)), source: 'imported' as const };
      this.catalog.upsert(renamed);
      results.push({ templateId: renamed.id, action: 'renamed' });
    }

    for (const entry of bundle.compatibility) {
      const importedTemplateIds = new Set(results.filter((result) => result.action !== 'skipped' && result.action !== 'rejected').map((result) => result.templateId));
      if (importedTemplateIds.has(entry.catalogItemId) || this.catalog.has(entry.catalogItemId)) {
        this.compatibility.upsert(entry);
      }
    }

    return { accepted: results.some((result) => result.action !== 'skipped' && result.action !== 'rejected'), hash: verification.hash, signatureValid: verification.signatureValid, results, failures: [] };
  }
}

export class TemplateQualityGate {
  evaluate(template: TemplateCatalogItem): QualityReport {
    const rules = [
      checkDslSchema(template),
      checkVariableReferences(template),
      checkPlainSecret(template),
      checkDangerousSsh(template),
      checkRollbackDescription(template),
    ];
    const failed = rules.filter((rule) => !rule.passed);
    return {
      id: `qr_${template.id}_${template.version}`,
      templateId: template.id,
      passed: failed.length === 0,
      riskLevel: failed.reduce<RiskLevel>((risk, rule) => higherRisk(risk, rule.severity), template.riskLevel),
      failedRules: failed.map((rule) => rule.rule),
      rules,
      createdAt: new Date(0).toISOString(),
    };
  }
}

export class TemplateContributionService {
  private readonly contributions = new Map<string, TemplateContribution>();

  constructor(private readonly qualityGate = new TemplateQualityGate()) {}

  submit(input: { template: TemplateCatalogItem; compatibility: CompatibilityMatrixEntry[]; contributorId: string; summary: string }): TemplateContribution {
    const qualityReport = this.qualityGate.evaluate(input.template);
    const contribution: TemplateContribution = {
      id: `contrib_${input.template.id}_${this.contributions.size + 1}`,
      template: clone(input.template),
      compatibility: clone(input.compatibility),
      contributorId: input.contributorId,
      summary: input.summary,
      status: 'submitted',
      submittedAt: new Date(0).toISOString(),
      qualityReport,
    };
    this.contributions.set(contribution.id, contribution);
    return contribution;
  }

  get(id: string): TemplateContribution | undefined {
    return this.contributions.get(id);
  }

  save(contribution: TemplateContribution): void {
    this.contributions.set(contribution.id, contribution);
  }
}

export class TemplateReviewService {
  constructor(
    private readonly contributions: TemplateContributionService,
    private readonly catalog = new TemplateCatalogService(),
    private readonly compatibility = new CompatibilityMatrixService(),
  ) {}

  startReview(contributionId: string, reviewer: string): TemplateContribution {
    const contribution = this.mustGet(contributionId);
    if (contribution.status !== 'submitted') {
      throw new Error('只有 submitted 状态可以进入审核');
    }
    const next = { ...contribution, status: 'under_review' as const, reviewer };
    this.contributions.save(next);
    return next;
  }

  accept(contributionId: string, reviewer: string, reason: string): TemplateContribution {
    const contribution = this.mustGet(contributionId);
    if (contribution.status !== 'under_review') {
      throw new Error('只有 under_review 状态可以接受');
    }
    if (!contribution.qualityReport.passed) {
      throw new Error('质量门禁未通过，不能接受贡献');
    }
    this.catalog.upsert({ ...contribution.template, source: 'contribution' });
    for (const entry of contribution.compatibility) {
      this.compatibility.upsert(entry);
    }
    const next = { ...contribution, status: 'accepted' as const, reviewer, reason };
    this.contributions.save(next);
    return next;
  }

  reject(contributionId: string, reviewer: string, reason: string): TemplateContribution {
    const contribution = this.mustGet(contributionId);
    if (contribution.status !== 'under_review') {
      throw new Error('只有 under_review 状态可以拒绝');
    }
    const next = { ...contribution, status: 'rejected' as const, reviewer, reason };
    this.contributions.save(next);
    return next;
  }

  private mustGet(id: string): TemplateContribution {
    const contribution = this.contributions.get(id);
    if (!contribution) {
      throw new Error('贡献不存在');
    }
    return contribution;
  }
}

export function defaultCategories(): DeviceCategory[] {
  return [
    { id: 'cat_load_balancer', code: 'load_balancer', name: '负载均衡', description: 'HTTP API 优先的证书部署模板目录' },
    { id: 'cat_firewall', code: 'firewall', name: '防火墙', description: '防火墙证书导入和配置保存样例目录' },
    { id: 'cat_waf', code: 'waf', name: 'WAF', description: 'Web 应用防火墙证书绑定样例目录' },
    { id: 'cat_gateway', code: 'gateway', name: '网关', description: 'API 网关和边界网关证书部署样例目录' },
    { id: 'cat_custom', code: 'custom', name: '自定义', description: '用户自定义网络设备模板目录' },
  ];
}

export function defaultCatalogItems(): TemplateCatalogItem[] {
  return [
    sampleTemplate('tpl_lb_http', 'cat_load_balancer', 'load_balancer', 'GenericLB', 'LB-HTTP-*', ['http'], ['PEM'], 'medium'),
    sampleTemplate('tpl_firewall_ssh', 'cat_firewall', 'firewall', 'GenericFirewall', 'FW-CLI-*', ['ssh'], ['PEM', 'PFX'], 'high', true),
    sampleTemplate('tpl_waf_http', 'cat_waf', 'waf', 'GenericWAF', 'WAF-API-*', ['http'], ['PEM', 'CHAIN'], 'medium'),
    sampleTemplate('tpl_gateway_mixed', 'cat_gateway', 'gateway', 'GenericGateway', 'GW-MIXED-*', ['mixed', 'http', 'ssh'], ['PEM', 'JKS'], 'high', true),
  ];
}

export function defaultCompatibilityMatrix(): CompatibilityMatrixEntry[] {
  return [
    sampleCompatibility('cmp_lb_http', 'tpl_lb_http', 'GenericLB', 'LB-HTTP-*', '>=1.0.0 <2.0.0', ['http'], ['示意矩阵，未声明真实厂商兼容'], 'draft'),
    sampleCompatibility('cmp_firewall_ssh', 'tpl_firewall_ssh', 'GenericFirewall', 'FW-CLI-*', '>=10.0.0 <11.0.0', ['ssh'], ['CLI 保存配置需要人工确认交互风险'], 'community_unverified'),
    sampleCompatibility('cmp_waf_http', 'tpl_waf_http', 'GenericWAF', 'WAF-API-*', '>=3.1.0 <4.0.0', ['http'], ['链证书顺序由设备侧约束决定'], 'draft'),
    sampleCompatibility('cmp_gateway_mixed', 'tpl_gateway_mixed', 'GenericGateway', 'GW-MIXED-*', '>=2.0.0 <3.0.0', ['mixed', 'http', 'ssh'], ['SSH 回退路径需要人工复核'], 'community_unverified'),
  ];
}

export function calculateBundleHash(bundle: TemplateBundle): string {
  const stable = JSON.stringify({
    bundleVersion: bundle.bundleVersion,
    exportedAt: bundle.exportedAt,
    templates: bundle.templates,
    compatibility: bundle.compatibility,
    docs: bundle.docs ?? {},
    tests: bundle.tests ?? {},
  });
  return createHash('sha256').update(stable).digest('hex');
}

export function mockSignature(hash: string): string {
  return `mock-signature:${hash}`;
}

function sampleTemplate(id: string, categoryId: string, categoryCode: DeviceCategoryCode, vendor: string, model: string, protocols: TemplateProtocol[], certFormats: CertFormat[], riskLevel: RiskLevel, interactive = false): TemplateCatalogItem {
  return {
    id,
    workflowTemplateId: `wf_${id}`,
    version: '1.0.0',
    name: `${vendor} ${model} 证书部署示意模板`,
    categoryId,
    categoryCode,
    vendor,
    model,
    protocols,
    authMethods: protocols.includes('ssh') ? ['ssh_key'] : ['api_token'],
    interactive,
    riskLevel,
    status: 'example_only',
    supportedCertFormats: certFormats,
    tags: [categoryCode, 'mock-safe', 'example-only'],
    dsl: {
      schemaVersion: '025.mock',
      variables: [
        { name: 'certPath', type: 'certificate' },
        { name: 'keyPath', type: 'path' },
        { name: 'deviceTokenRef', type: 'secret' },
      ],
      steps: protocols.includes('ssh')
        ? [{ id: 'deploy', type: 'ssh', command: 'device-cli import-cert --cert {{ certPath }} --key {{ keyPath }}' }]
        : [{ id: 'deploy', type: 'http', url: 'https://device.example.local/api/certificates', body: '{"cert":"{{ certPath }}"}' }],
      rollback: [{ id: 'rollback', type: 'rollback', command: 'restore previous certificate binding' }],
    },
    rollbackDescription: '回滚到设备上一次证书绑定配置；样例不执行真实设备命令。',
    source: 'default',
  };
}

function sampleCompatibility(id: string, catalogItemId: string, vendor: string, modelPattern: string, firmwareRange: string, protocols: TemplateProtocol[], limitations: string[], verificationStatus: CompatibilityVerificationStatus): CompatibilityMatrixEntry {
  return { id, catalogItemId, vendor, modelPattern, firmwareRange, protocols, limitations, verificationStatus };
}

function matchesCatalogQuery(item: TemplateCatalogItem, query: CatalogQuery): boolean {
  if (query.category && item.categoryCode !== query.category) return false;
  if (query.vendor && !sameText(item.vendor, query.vendor)) return false;
  if (query.model && !wildcardMatch(item.model, query.model) && !wildcardMatch(query.model, item.model)) return false;
  if (query.protocol && !item.protocols.includes(query.protocol)) return false;
  if (query.certFormat && !item.supportedCertFormats.includes(query.certFormat)) return false;
  if (query.riskLevel && item.riskLevel !== query.riskLevel) return false;
  if (query.status && item.status !== query.status) return false;
  return true;
}

function validateBundleStructure(bundle: TemplateBundle): string[] {
  const failures: string[] = [];
  if (!bundle.bundleVersion) failures.push('缺少 bundleVersion');
  if (!Array.isArray(bundle.templates)) failures.push('templates 必须是数组');
  if (!Array.isArray(bundle.compatibility)) failures.push('compatibility 必须是数组');
  for (const template of bundle.templates ?? []) {
    if (!template.id || !template.workflowTemplateId || !template.categoryCode || !template.vendor || !template.dsl) {
      failures.push(`模板结构不完整：${template.id ?? 'unknown'}`);
    }
  }
  return failures;
}

function checkDslSchema(template: TemplateCatalogItem): QualityRuleResult {
  const dsl = template.dsl;
  const passed = Boolean(dsl.schemaVersion && Array.isArray(dsl.variables) && Array.isArray(dsl.steps) && dsl.steps.length > 0);
  return rule('dsl_schema', passed, 'critical', passed ? 'DSL 基础结构有效' : 'DSL 缺少 schemaVersion、variables 或 steps');
}

function checkVariableReferences(template: TemplateCatalogItem): QualityRuleResult {
  const declared = new Set(template.dsl.variables.map((variable) => variable.name));
  const references = collectTemplateTexts(template).flatMap((text) => [...text.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((match) => match[1]!));
  const missing = references.filter((name) => !declared.has(name));
  return rule('variable_references', missing.length === 0, 'high', missing.length === 0 ? '变量引用完整' : `未声明变量：${[...new Set(missing)].join(',')}`);
}

function checkPlainSecret(template: TemplateCatalogItem): QualityRuleResult {
  const text = collectTemplateTexts(template).join('\n');
  const hasPlainSecret = /(password|secret|token)\s*[:=]\s*['"]?[a-zA-Z0-9_\-]{6,}|BEGIN PRIVATE KEY/i.test(text);
  return rule('plain_secret_scan', !hasPlainSecret, 'critical', hasPlainSecret ? '发现疑似 Secret 明文' : '未发现 Secret 明文');
}

function checkDangerousSsh(template: TemplateCatalogItem): QualityRuleResult {
  const sshCommands = [...template.dsl.steps, ...(template.dsl.rollback ?? [])].filter((step) => step.type === 'ssh').map((step) => step.command ?? '').join('\n');
  const dangerous = /\b(rm\s+-rf|reboot|shutdown|format|mkfs|factory-reset|erase\s+startup-config)\b/i.test(sshCommands);
  return rule('dangerous_ssh_command', !dangerous, 'high', dangerous ? '发现高危 SSH 命令' : '未发现高危 SSH 命令');
}

function checkRollbackDescription(template: TemplateCatalogItem): QualityRuleResult {
  const hasRollback = Boolean(template.rollbackDescription?.trim() || (template.dsl.rollback?.length ?? 0) > 0);
  return rule('rollback_description', hasRollback, 'medium', hasRollback ? '已提供回滚说明' : '缺少回滚说明或不可回滚原因');
}

function collectTemplateTexts(template: TemplateCatalogItem): string[] {
  const steps = [...template.dsl.steps, ...(template.dsl.rollback ?? [])];
  return steps.flatMap((step) => [step.command, step.url, step.body, ...(step.uses ?? [])]).filter((text): text is string => Boolean(text));
}

function rule(ruleName: string, passed: boolean, severity: RiskLevel, message: string): QualityRuleResult {
  return { rule: ruleName, passed, severity, message };
}

function higherRisk(left: RiskLevel, right: RiskLevel): RiskLevel {
  return RISK_WEIGHT[right] > RISK_WEIGHT[left] ? right : left;
}

function toUnverifiedStatus(status: CompatibilityVerificationStatus): CompatibilityVerificationStatus {
  return status === 'official_verified' || status === 'community_verified' ? 'community_unverified' : status;
}

function versionInRange(version: string, range: string): boolean {
  const versionParts = parseVersion(version);
  return range.split(/\s+/).filter(Boolean).every((part) => {
    const match = part.match(/^(>=|>|<=|<|=)?(.+)$/);
    if (!match) return true;
    const operator = match[1] ?? '=';
    const target = parseVersion(match[2]!);
    const comparison = compareVersion(versionParts, target);
    if (operator === '>=') return comparison >= 0;
    if (operator === '>') return comparison > 0;
    if (operator === '<=') return comparison <= 0;
    if (operator === '<') return comparison < 0;
    return comparison === 0;
  });
}

function parseVersion(version: string): number[] {
  return version.split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersion(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function wildcardMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i').test(value);
}

function sameText(left: string, right: string): boolean {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0;
}

function nextPatchVersion(version: string): string {
  const parts = parseVersion(version);
  return `${parts[0] ?? 0}.${parts[1] ?? 0}.${(parts[2] ?? 0) + 1}`;
}

function uniqueId(base: string, exists: (id: string) => boolean): string {
  let suffix = 1;
  let candidate = base;
  while (exists(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
