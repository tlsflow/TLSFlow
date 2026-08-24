import { access, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UnifiedPluginVersionRecord } from '../dto/unified-plugins.dto.js';
import type { UnifiedPluginsApplicationService } from '../application/unified-plugins.application-service.js';
import { builtinAgentPluginManifests } from '../builtin-agent-plugins/builtin-agent-plugins.js';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export class BuiltinUnifiedPluginLoader {
  constructor(private readonly configuredRootDirectory?: string) {}

  async loadPackages(): Promise<Array<{ manifest: unknown; resources: Record<string, string>; packageContent: string }>> {
    const rootDirectory = this.configuredRootDirectory ?? await resolveBuiltinRootDirectory();
    const entries = await readdir(rootDirectory, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
    const nativePackages = await Promise.all(directories.map((directory) => this.loadPackage(join(rootDirectory, directory))));
    if (this.configuredRootDirectory) return nativePackages;
    return [...nativePackages, ...await loadWorkflowCompatibilityPackages(), ...loadAgentCompatibilityPackages()];
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

async function loadWorkflowCompatibilityPackages(): Promise<Array<{ manifest: unknown; resources: Record<string, string>; packageContent: string }>> {
  const workflowDirectory = await resolveBuiltinWorkflowDirectory();
  return Promise.all([
    'apache-8444-cert-switch.json',
    'synology-dsm-cert-import.json',
  ].map(async (fileName) => {
    const content = await readFile(join(workflowDirectory, fileName), 'utf8');
    const workflow = JSON.parse(content) as { metadata: { name: string; version: string; platforms?: string[] } };
    const resourcePath = `workflows/${fileName}`;
    const manifest = {
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId: `builtin.workflow.${workflow.metadata.name}`,
      version: workflow.metadata.version,
      displayNameKey: `plugins.compatibility.${workflow.metadata.name}.name`,
      descriptionKey: `plugins.compatibility.${workflow.metadata.name}.description`,
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
      compatibility: { products: [workflow.metadata.name], platforms: workflow.metadata.platforms ?? [] },
      resources: { workflows: { 'certificate.deploy': resourcePath, 'certificate.rollback': resourcePath } },
    };
    return { manifest, resources: { [resourcePath]: content }, packageContent: JSON.stringify({ manifest, workflowSha256Source: content }) };
  }));
}

function loadAgentCompatibilityPackages(): Array<{ manifest: unknown; resources: Record<string, string>; packageContent: string }> {
  return builtinAgentPluginManifests.map((agentManifest) => {
    const resourcePath = `agent-recipes/${agentManifest.pluginId}.json`;
    const recipe = JSON.stringify(agentManifest);
    const manifest = {
      apiVersion: 'gcac.plugin-manifest/v1',
      kind: 'GcacPlugin',
      pluginId: agentManifest.pluginId,
      version: agentManifest.version,
      displayNameKey: `plugins.compatibility.${agentManifest.pluginId}.name`,
      descriptionKey: `plugins.compatibility.${agentManifest.pluginId}.description`,
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
        products: agentManifest.compatibility.frameworks,
        platforms: agentManifest.compatibility.platforms,
        versions: agentManifest.compatibility.architectures,
      },
      resources: { agentRecipes: { 'certificate.deploy': resourcePath, 'certificate.rollback': resourcePath } },
    };
    return { manifest, resources: { [resourcePath]: recipe }, packageContent: JSON.stringify({ manifest, recipe }) };
  });
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
