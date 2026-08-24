import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CompatibilityMatrixService,
  DeviceCategoryService,
  TemplateBundleService,
  TemplateCatalogService,
  TemplateContributionService,
  TemplateQualityGate,
  TemplateReviewService,
  calculateBundleHash,
  defaultCatalogItems,
  defaultCompatibilityMatrix,
  mockSignature,
  type TemplateBundle,
  type TemplateCatalogItem,
} from './index.js';

describe('spec026 网络设备模板样例库 mock-safe 闭环', () => {
  it('内置五类设备分类，并覆盖四类默认目录', () => {
    const categories = new DeviceCategoryService().list();
    assert.deepEqual(categories.map((category) => category.code), ['load_balancer', 'firewall', 'waf', 'gateway', 'custom']);

    const catalog = new TemplateCatalogService();
    assert.equal(catalog.list({ category: 'load_balancer' }).length, 1);
    assert.equal(catalog.list({ category: 'firewall' }).length, 1);
    assert.equal(catalog.list({ category: 'waf' }).length, 1);
    assert.equal(catalog.list({ category: 'gateway' }).length, 1);
  });

  it('目录查询支持类别、vendor、model、protocol、certFormat、risk/status 过滤', () => {
    const catalog = new TemplateCatalogService();
    assert.equal(catalog.list({ vendor: 'genericlb', protocol: 'http', certFormat: 'PEM' })[0]?.id, 'tpl_lb_http');
    assert.equal(catalog.list({ model: 'FW-CLI-2000', protocol: 'ssh', riskLevel: 'high' })[0]?.id, 'tpl_firewall_ssh');
    assert.equal(catalog.list({ category: 'waf', certFormat: 'CHAIN', status: 'example_only' })[0]?.id, 'tpl_waf_http');
    assert.equal(catalog.list({ category: 'custom' }).length, 0);
  });

  it('兼容矩阵按 vendor/model/firmware/protocol 匹配，并把未测试项标为未验证或草稿', () => {
    const matrix = new CompatibilityMatrixService();
    const matches = matrix.match({ vendor: 'GenericFirewall', model: 'FW-CLI-9000', firmware: '10.5.0', protocol: 'ssh' });
    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.catalogItemId, 'tpl_firewall_ssh');
    assert.deepEqual(matches[0]?.limitations, ['CLI 保存配置需要人工确认交互风险']);
    assert.equal(matches[0]?.verificationStatus, 'community_unverified');

    const outOfRange = matrix.match({ vendor: 'GenericFirewall', model: 'FW-CLI-9000', firmware: '12.0.0', protocol: 'ssh' });
    assert.equal(outOfRange.length, 0);

    const defaultStatuses = defaultCompatibilityMatrix().map((entry) => new CompatibilityMatrixService([entry]).match({ vendor: entry.vendor, model: entry.modelPattern.replace('*', '1000') })[0]?.verificationStatus);
    assert.equal(defaultStatuses.every((status) => status === 'community_unverified' || status === 'draft'), true);
  });

  it('bundle 导出包含 hash 和 mock signature，导入会校验结构、签名和质量门禁', () => {
    const catalog = new TemplateCatalogService();
    const bundleService = new TemplateBundleService(catalog, new CompatibilityMatrixService());
    const bundle = bundleService.exportBundle(['tpl_lb_http'], { includeSignature: true });
    assert.equal(bundle.hash, calculateBundleHash(bundle));
    assert.equal(bundle.signature, mockSignature(bundle.hash!));

    const freshCatalog = new TemplateCatalogService([]);
    const importService = new TemplateBundleService(freshCatalog, new CompatibilityMatrixService([]));
    const report = importService.importBundle(bundle, 'skip');
    assert.equal(report.accepted, true);
    assert.equal(report.signatureValid, true);
    assert.equal(report.results[0]?.action, 'imported');
    assert.equal(freshCatalog.get('tpl_lb_http')?.source, 'imported');

    const badSignature: TemplateBundle = { ...bundle, signature: 'bad' };
    const badReport = importService.importBundle(badSignature, 'skip');
    assert.equal(badReport.accepted, false);
    assert.match(badReport.failures.join(','), /签名校验失败/);
  });

  it('bundle 冲突策略支持 skip、new_version、rename', () => {
    const existing = new TemplateCatalogService([defaultCatalogItems()[0]!]);
    const bundle = new TemplateBundleService(existing, new CompatibilityMatrixService()).exportBundle(['tpl_lb_http'], { includeSignature: true });

    const skip = new TemplateBundleService(new TemplateCatalogService([defaultCatalogItems()[0]!]), new CompatibilityMatrixService([])).importBundle(bundle, 'skip');
    assert.equal(skip.results[0]?.action, 'skipped');

    const newVersionCatalog = new TemplateCatalogService([defaultCatalogItems()[0]!]);
    const newVersion = new TemplateBundleService(newVersionCatalog, new CompatibilityMatrixService([])).importBundle(bundle, 'new_version');
    assert.equal(newVersion.results[0]?.action, 'new_version');
    assert.equal(newVersionCatalog.get('tpl_lb_http')?.version, '1.0.1');

    const renameCatalog = new TemplateCatalogService([defaultCatalogItems()[0]!]);
    const rename = new TemplateBundleService(renameCatalog, new CompatibilityMatrixService([])).importBundle(bundle, 'rename');
    assert.equal(rename.results[0]?.action, 'renamed');
    assert.equal(renameCatalog.has('tpl_lb_http-imported'), true);
  });

  it('QualityGate 输出 DSL、变量、Secret、高危 SSH、缺 rollback 的失败规则和风险等级', () => {
    const badTemplate: TemplateCatalogItem = {
      ...defaultCatalogItems()[1]!,
      id: 'tpl_bad',
      version: '0.1.0',
      rollbackDescription: undefined,
      dsl: {
        schemaVersion: '025.mock',
        variables: [{ name: 'certPath', type: 'certificate' }],
        steps: [{ id: 'deploy', type: 'ssh', command: 'reboot && device-cli password=plain123 --cert {{ missingVar }}' }],
      },
    };

    const report = new TemplateQualityGate().evaluate(badTemplate);
    assert.equal(report.passed, false);
    assert.equal(report.riskLevel, 'critical');
    assert.deepEqual(report.failedRules.sort(), ['dangerous_ssh_command', 'plain_secret_scan', 'rollback_description', 'variable_references']);
  });

  it('贡献审核流程 submit -> under_review -> accepted/rejected，并保留 reviewer/reason/quality report', () => {
    const contributions = new TemplateContributionService();
    const catalog = new TemplateCatalogService([]);
    const matrix = new CompatibilityMatrixService([]);
    const review = new TemplateReviewService(contributions, catalog, matrix);
    const template = { ...defaultCatalogItems()[0]!, id: 'tpl_contrib' };
    const compatibility = [{ ...defaultCompatibilityMatrix()[0]!, id: 'cmp_contrib', catalogItemId: 'tpl_contrib' }];

    const submitted = contributions.submit({ template, compatibility, contributorId: 'user_1', summary: '新增示意模板' });
    assert.equal(submitted.status, 'submitted');
    assert.equal(submitted.qualityReport.passed, true);

    const underReview = review.startReview(submitted.id, 'reviewer_1');
    assert.equal(underReview.status, 'under_review');
    assert.equal(underReview.reviewer, 'reviewer_1');

    const accepted = review.accept(submitted.id, 'reviewer_1', '质量门禁通过，允许入库');
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.reason, '质量门禁通过，允许入库');
    assert.equal(catalog.has('tpl_contrib'), true);

    const rejectedDraft = contributions.submit({ template: { ...template, id: 'tpl_reject' }, compatibility: [], contributorId: 'user_2', summary: '拒绝样例' });
    review.startReview(rejectedDraft.id, 'reviewer_2');
    const rejected = review.reject(rejectedDraft.id, 'reviewer_2', '缺少真实测试记录');
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.reviewer, 'reviewer_2');
    assert.equal(rejected.reason, '缺少真实测试记录');
    assert.equal(rejected.qualityReport.templateId, 'tpl_reject');
  });

  it('质量失败贡献不能被接受', () => {
    const contributions = new TemplateContributionService();
    const review = new TemplateReviewService(contributions, new TemplateCatalogService([]), new CompatibilityMatrixService([]));
    const badTemplate = {
      ...defaultCatalogItems()[0]!,
      id: 'tpl_quality_failed',
      rollbackDescription: undefined,
      dsl: { schemaVersion: '', variables: [], steps: [] },
    };
    const submitted = contributions.submit({ template: badTemplate, compatibility: [], contributorId: 'user_3', summary: '坏模板' });
    review.startReview(submitted.id, 'reviewer_3');
    assert.throws(() => review.accept(submitted.id, 'reviewer_3', '不能通过'), /质量门禁未通过/);
  });
});
