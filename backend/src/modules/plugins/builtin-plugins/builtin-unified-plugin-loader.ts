import { access, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import type { UnifiedPluginsApplicationService } from '../application/unified-plugins.application-service.js';
import { builtinAgentPluginManifests } from './agent-recipes.js';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export class BuiltinUnifiedPluginLoader {
  constructor(private readonly configuredRootDirectory?: string) {}

  async loadPackages(): Promise<Array<{ manifest: unknown; resources: Record<string, string>; packageContent: string }>> {
    const rootDirectory = this.configuredRootDirectory ?? await resolveBuiltinRootDirectory();
    const entries = await readdir(rootDirectory, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const packageDirectories = [];
    for (const directory of directories) {
      try {
        await access(join(rootDirectory, directory, 'manifest.json'));
        packageDirectories.push(directory);
      } catch {
        // 非插件资源目录不参与包扫描。
      }
    }
    const nativePackages = await Promise.all(packageDirectories.map((directory) => this.loadPackage(join(rootDirectory, directory))));
    if (this.configuredRootDirectory) return nativePackages;
    const localeResources = await loadBuiltinLocaleResources(rootDirectory);
    return [...nativePackages, ...await loadBuiltinWorkflowPackages(localeResources), ...loadBuiltinAgentPackages(localeResources)];
  }

  async installAll(tenantId: string, service: UnifiedPluginsApplicationService): Promise<UnifiedPluginVersionRecord[]> {
    const packages = await this.loadPackages();
    const installed: UnifiedPluginVersionRecord[] = [];
    for (const pluginPackage of packages) {
      const imported = await service.importVersion(tenantId, pluginPackage, 'BUILTIN');
      const approved = imported.permissionApprovalStatus === 'APPROVED'
        ? imported
        : await service.approvePermissions(imported.id, imported.manifest.permissions);
      installed.push(approved.status === 'ENABLED' ? approved : await service.enableVersion(approved.id));
    }
    return installed;
  }

  private async loadPackage(directory: string): Promise<{ manifest: unknown; resources: Record<string, string>; packageContent: string }> {
    const manifestPath = join(directory, 'manifest.json');
    const manifestContent = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestContent) as { resources?: Record<string, Record<string, string>> };
    const resourcePaths = [...new Set(Object.values(manifest.resources ?? {}).flatMap((mapping) => Object.values(mapping ?? {})))].sort();
    const resources = Object.fromEntries(await Promise.all(resourcePaths.map(async (resourcePath) => [
      resourcePath,
      await readFile(resolve(directory, resourcePath), 'utf8'),
    ])));
    return {
      manifest,
      resources,
      packageContent: JSON.stringify({ directory: basename(directory), manifest, resources }),
    };
  }
}

async function resolveBuiltinRootDirectory(): Promise<string> {
  const candidates = [
    moduleDirectory,
    resolve(process.cwd(), 'src/modules/plugins/builtin-plugins'),
    resolve(process.cwd(), 'backend/src/modules/plugins/builtin-plugins'),
  ];
  for (const candidate of candidates) {
    try {
      await access(join(candidate, 'citrix-adc', 'manifest.json'));
      return candidate;
    } catch {
      // 继续检查源码目录或部署目录。
    }
  }
  return moduleDirectory;
}

async function loadBuiltinWorkflowPackages(localeResources: BuiltinLocaleResources): Promise<Array<{ manifest: unknown; resources: Record<string, string>; packageContent: string }>> {
  const workflowDirectory = await resolveBuiltinWorkflowDirectory();
  return Promise.all([
    'apache-8444-cert-switch.json',
    'synology-dsm-cert-import.json',
  ].map(async (fileName) => {
    const content = await readFile(join(workflowDirectory, fileName), 'utf8');
    const workflow = JSON.parse(content) as { metadata: { name: string; version: string; logoUrl?: string; platforms?: string[] } };
    const resourcePath = `workflows/${fileName}`;
    const pluginId = `builtin.workflow.${workflow.metadata.name}`;
    const localeKey = builtinLocaleKey(pluginId);
    const manifest = {
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId,
      version: workflowPluginVersion(pluginId, workflow.metadata.version),
      displayNameKey: `${localeKey}.name`,
      descriptionKey: `${localeKey}.description`,
      logoUrl: workflow.metadata.logoUrl,
      defaultLocale: 'zh-CN',
      publisher: 'GCAC',
      runtime: 'WORKFLOW_DSL',
      source: 'BUILTIN',
      scope: 'BOTH',
      trust: 'OFFICIAL_SIGNED',
      support: 'OFFICIAL',
      capabilities: [
        capability('certificate.deploy', 'certificate.deploy.v1', 'HIGH', ['CONTROL_PLANE', 'GATEWAY']),
        capability('certificate.rollback', 'certificate.rollback.v1', 'HIGH', ['CONTROL_PLANE', 'GATEWAY']),
      ],
      permissions: ['secret.read', 'artifact.read', 'network.connect'],
      compatibility: {
        managementMethods: ['AGENT', 'PLUGIN', 'MANUAL'],
        executionLocations: ['CONTROL_PLANE', 'GATEWAY'],
        artifactContracts: ['certificate.deploy.v1'],
      },
      resources: {
        workflows: { 'certificate.deploy': resourcePath, 'certificate.rollback': resourcePath },
        locales: localeResources.paths,
      },
    };
    const resources = { [resourcePath]: content, ...localeResources.contents };
    return { manifest, resources, packageContent: JSON.stringify({ manifest, resources }) };
  }));
}

function loadBuiltinAgentPackages(localeResources: BuiltinLocaleResources): Array<{ manifest: unknown; resources: Record<string, string>; packageContent: string }> {
  return builtinAgentPluginManifests.map((agentManifest) => {
    const resourcePath = `agent-recipes/${agentManifest.pluginId}.json`;
    const recipe = JSON.stringify(agentManifest);
    const localeKey = builtinLocaleKey(agentManifest.pluginId);
    const manifest = {
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId: agentManifest.pluginId,
      version: hasHistoricalActionAlias(agentManifest.pluginId)
        ? incrementPatchVersion(incrementPatchVersion(agentManifest.version))
        : incrementPatchVersion(agentManifest.version),
      displayNameKey: `${localeKey}.name`,
      descriptionKey: `${localeKey}.description`,
      logoUrl: agentManifest.metadata?.logoUrl,
      defaultLocale: 'zh-CN',
      publisher: agentManifest.publisher,
      runtime: 'AGENT_ATOMIC',
      source: 'BUILTIN',
      scope: 'MANAGED',
      trust: 'OFFICIAL_SIGNED',
      support: 'OFFICIAL',
      minGcacVersion: agentManifest.minGcacVersion,
      capabilities: [
        capability('certificate.deploy', 'certificate.deploy.v1', 'HIGH', ['AGENT']),
        capability('certificate.rollback', 'certificate.rollback.v1', 'HIGH', ['AGENT']),
      ],
      permissions: agentManifest.permissions.map((permission) => permission.name),
      compatibility: {
        productFamilies: agentManifest.compatibility.platforms.map((platform) => `${platform}_SERVER`),
        frameworkTypes: (agentManifest.compatibility.frameworks ?? []).map(normalizeAgentFrameworkType),
        targetTypes: ['tls.binding', 'tls.file'],
        managementMethods: ['AGENT'],
        executionLocations: ['AGENT'],
        artifactContracts: ['certificate.deploy.v1'],
      },
      resources: {
        agentRecipes: { 'certificate.deploy': resourcePath, 'certificate.rollback': resourcePath },
        ...(hasHistoricalActionAlias(agentManifest.pluginId) ? { actionAliases: { certificateDeploy: 'action-aliases/certificate-deploy.json' } } : {}),
        locales: localeResources.paths,
      },
    };
    const aliasResource = agentManifest.pluginId === 'builtin.linux.nginx.pem'
      ? { apiVersion: 'gcac.plugin-action-aliases/v1', kind: 'PluginActionAliases', aliases: [{ actionType: 'linux.nginx.deploy_certificate', capabilityKey: 'certificate.deploy', inputContract: 'certificate.deploy.v1' }] }
      : agentManifest.pluginId === 'builtin.windows.iis.pfx'
        ? { apiVersion: 'gcac.plugin-action-aliases/v1', kind: 'PluginActionAliases', aliases: [{ actionType: 'windows.iis.deploy_certificate', capabilityKey: 'certificate.deploy', inputContract: 'certificate.deploy.v1' }] }
        : undefined;
    const resources = { [resourcePath]: recipe, ...(aliasResource ? { 'action-aliases/certificate-deploy.json': JSON.stringify(aliasResource) } : {}), ...localeResources.contents };
    return { manifest, resources, packageContent: JSON.stringify({ manifest, resources }) };
  });
}

function hasHistoricalActionAlias(pluginId: string): boolean {
  return pluginId === 'builtin.linux.nginx.pem' || pluginId === 'builtin.windows.iis.pfx';
}

interface BuiltinLocaleResources {
  paths: Record<string, string>;
  contents: Record<string, string>;
}

function normalizeAgentFrameworkType(framework: string): string {
  const types: Record<string, string> = { IIS: 'web.iis', NGINX: 'web.nginx', APACHE: 'web.apache', TOMCAT: 'app.tomcat', CUSTOM: 'custom.runtime' };
  return types[framework] ?? framework.toLowerCase();
}

async function loadBuiltinLocaleResources(rootDirectory: string): Promise<BuiltinLocaleResources> {
  const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'ko-KR', 'fr-FR', 'ru-RU', 'pt-BR'];
  const paths = Object.fromEntries(locales.map((locale) => [locale, `locales/${locale}.json`]));
  const contents = Object.fromEntries(await Promise.all(locales.map(async (locale) => [
    `locales/${locale}.json`,
    await readFile(join(rootDirectory, 'locales', `${locale}.json`), 'utf8'),
  ])));
  return { paths, contents };
}

function builtinLocaleKey(pluginId: string): string {
  const keys: Record<string, string> = {
    'builtin.workflow.apache-8444-cert-switch': 'plugin.builtin.apache',
    'builtin.workflow.synology-dsm-cert-import': 'plugin.builtin.synology',
    'builtin.linux.nginx.pem': 'plugin.builtin.nginx',
    'builtin.windows.iis.pfx': 'plugin.builtin.iis',
    'builtin.rabbitmq.pem': 'plugin.builtin.rabbitmq',
    'builtin.java.pkcs12': 'plugin.builtin.java',
    'builtin.windows-service.certificate-file': 'plugin.builtin.windowsService',
  };
  const key = keys[pluginId];
  if (!key) throw new Error(`内置插件缺少 Locale key 映射: ${pluginId}`);
  return key;
}

function workflowPluginVersion(pluginId: string, sourceVersion: string): string {
  if (pluginId === 'builtin.workflow.apache-8444-cert-switch') return '1.1.6';
  if (pluginId === 'builtin.workflow.synology-dsm-cert-import') return '1.1.6';
  return incrementPatchVersion(sourceVersion);
}

function incrementPatchVersion(version: string): string {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error(`内置插件版本不是标准 SemVer: ${version}`);
  return `${match[1]}.${match[2]}.${Number(match[3]) + 1}`;
}

function capability(key: string, actionContractId: string, riskLevel: 'HIGH', executionLocations: Array<'AGENT' | 'CONTROL_PLANE' | 'GATEWAY'>) {
  return { key, contractVersion: 'v1', actionContractId, riskLevel, executionLocations };
}

async function resolveBuiltinWorkflowDirectory(): Promise<string> {
  const candidates = [
    resolve(moduleDirectory, '../../../workflow-templates/builtin-workflows'),
    resolve(process.cwd(), 'src/modules/workflow-templates/builtin-workflows'),
    resolve(process.cwd(), 'backend/src/modules/workflow-templates/builtin-workflows'),
  ];
  for (const candidate of candidates) {
    try {
      await access(join(candidate, 'apache-8444-cert-switch.json'));
      return candidate;
    } catch {
      // 继续检查源码目录或部署目录。
    }
  }
  throw new Error('找不到内置 Workflow 模板目录');
}
