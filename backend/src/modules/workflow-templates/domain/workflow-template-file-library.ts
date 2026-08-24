import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../../common/errors/app-error.js';
import type { WorkflowDslV1, WorkflowFileTemplate, WorkflowFileTemplateSource } from '../dto/workflow-templates.dto.js';
import { workflowTemplatesSchemaRegistry } from '../schema/workflow-templates.schema.js';

interface LoadedWorkflowFileTemplate {
  readonly entry: WorkflowFileTemplate;
  readonly content?: WorkflowDslV1;
}

interface WorkflowTemplateFileRoot {
  readonly source: WorkflowFileTemplateSource;
  readonly rootDir: string;
}

interface ResolvedWorkflowTemplateFile extends WorkflowTemplateFileRoot {
  readonly filePath: string;
}

export interface WorkflowTemplateFileLibraryOptions {
  readonly builtinRootDir?: string;
  readonly userRootDir?: string;
}

const WORKFLOW_TEMPLATE_FILE_EXTENSIONS = new Set(['.json', '.dsl']);
const WORKFLOW_TEMPLATE_FILE_SOURCES: WorkflowFileTemplateSource[] = ['builtin', 'user'];
// 编译后代码位于 dist，内置模板仍保留在 src 下以便 Git 跟踪。
const DEFAULT_BUILTIN_WORKFLOW_TEMPLATE_DIR = fileURLToPath(new URL(import.meta.url.includes('/dist/') ? '../../../../src/modules/workflow-templates/builtin-workflows/' : '../builtin-workflows/', import.meta.url));
const DEFAULT_USER_WORKFLOW_TEMPLATE_DIR = fileURLToPath(new URL('../../../../../data/workflows/', import.meta.url));

export class WorkflowTemplateFileLibrary {
  private readonly roots: WorkflowTemplateFileRoot[];

  constructor(options: WorkflowTemplateFileLibraryOptions | string = {}) {
    if (typeof options === 'string') {
      this.roots = [{ source: 'user', rootDir: options }];
      return;
    }
    this.roots = [
      { source: 'builtin', rootDir: options.builtinRootDir ?? DEFAULT_BUILTIN_WORKFLOW_TEMPLATE_DIR },
      { source: 'user', rootDir: options.userRootDir ?? DEFAULT_USER_WORKFLOW_TEMPLATE_DIR },
    ];
  }

  async list(): Promise<WorkflowFileTemplate[]> {
    const files = (await Promise.all(this.roots.map(async (root) => {
      const paths = await this.collectFiles(root.rootDir);
      return paths.map((filePath) => ({ ...root, filePath }));
    }))).flat();
    const loaded = await Promise.all(files.map(async (file) => await this.loadFile(file.source, file.rootDir, file.filePath)));
    return loaded
      .map((item) => item.entry)
      .sort((left, right) => Number(right.valid) - Number(left.valid) || sourceOrder(left.source) - sourceOrder(right.source) || left.relativePath.localeCompare(right.relativePath));
  }

  async getValidContent(fileTemplateId: string): Promise<WorkflowDslV1> {
    const candidates = this.resolveTemplateFilePaths(fileTemplateId);
    let lastMissingPath: unknown;
    for (const candidate of candidates) {
      let loaded: LoadedWorkflowFileTemplate;
      try {
        loaded = await this.loadFile(candidate.source, candidate.rootDir, candidate.filePath);
      } catch (error) {
        if (isMissingPath(error)) {
          lastMissingPath = error;
          continue;
        }
        throw error;
      }
      if (!loaded.entry.valid || !loaded.content) {
        throw new AppError('VALIDATION_FAILED', '工作流模板文件无效，不能用于创建或覆盖工作流', {
          fileTemplateId,
          error: loaded.entry.error,
        });
      }
      return clone(loaded.content);
    }
    if (lastMissingPath) throw new AppError('RESOURCE_NOT_FOUND', '工作流模板文件不存在', { fileTemplateId });
    throw new AppError('RESOURCE_NOT_FOUND', '工作流模板文件不存在', { fileTemplateId });
  }

  private async loadFile(source: WorkflowFileTemplateSource, rootDir: string, filePath: string): Promise<LoadedWorkflowFileTemplate> {
    const fileStat = await stat(filePath);
    const relativePath = normalizeRelativePath(relative(rootDir, filePath));
    const fileName = relativePath.split('/').at(-1) ?? relativePath;
    try {
      const raw = stripUtf8Bom(await readFile(filePath, 'utf8'));
      const parsed = JSON.parse(raw) as unknown;
      const content = workflowTemplatesSchemaRegistry.validate(parsed);
      return {
        entry: {
          id: `${source}/${relativePath}`,
          source,
          fileName,
          relativePath,
          valid: true,
          updatedAt: fileStat.mtime.toISOString(),
          metadata: clone(content.metadata),
          stepCount: content.steps.length,
          rollbackCount: content.rollback?.length ?? 0,
        },
        content,
      };
    } catch (error) {
      return {
        entry: {
          id: `${source}/${relativePath}`,
          source,
          fileName,
          relativePath,
          valid: false,
          updatedAt: fileStat.mtime.toISOString(),
          error: error instanceof Error ? error.message : '未知解析错误',
        },
      };
    }
  }

  private async collectFiles(dirPath: string): Promise<string[]> {
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      const files = await Promise.all(entries.map(async (entry) => {
        const absolutePath = join(dirPath, entry.name);
        if (entry.isDirectory()) return await this.collectFiles(absolutePath);
        if (!entry.isFile() || !WORKFLOW_TEMPLATE_FILE_EXTENSIONS.has(extname(entry.name).toLowerCase())) return [];
        return [absolutePath];
      }));
      return files.flat();
    } catch (error) {
      if (isMissingPath(error)) return [];
      throw error;
    }
  }

  private resolveTemplateFilePaths(fileTemplateId: string): ResolvedWorkflowTemplateFile[] {
    const normalized = normalizeRelativePath(fileTemplateId);
    if (!normalized || normalized.startsWith('../') || normalized.includes('/../')) {
      throw new AppError('VALIDATION_FAILED', '模板文件路径不合法', { fileTemplateId });
    }
    const [maybeSource, ...pathParts] = normalized.split('/');
    if (isWorkflowTemplateFileSource(maybeSource) && pathParts.length > 0) {
      const relativePath = pathParts.join('/');
      validateRelativeTemplatePath(relativePath, fileTemplateId);
      const root = this.rootBySource(maybeSource);
      return [{ ...root, filePath: join(root.rootDir, relativePath) }];
    }

    validateRelativeTemplatePath(normalized, fileTemplateId);
    return this.roots
      .filter((root) => root.source === 'user' || root.source === 'builtin')
      .sort((left, right) => sourceOrderForLegacyLookup(left.source) - sourceOrderForLegacyLookup(right.source))
      .map((root) => ({ ...root, filePath: join(root.rootDir, normalized) }));
  }

  private rootBySource(source: WorkflowFileTemplateSource): WorkflowTemplateFileRoot {
    const root = this.roots.find((item) => item.source === source);
    if (!root) throw new AppError('RESOURCE_NOT_FOUND', '工作流模板来源不存在', { source });
    return root;
  }
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function validateRelativeTemplatePath(relativePath: string, fileTemplateId: string): void {
  if (!relativePath || relativePath.startsWith('../') || relativePath.includes('/../')) {
    throw new AppError('VALIDATION_FAILED', '模板文件路径不合法', { fileTemplateId });
  }
}

function isWorkflowTemplateFileSource(value: string | undefined): value is WorkflowFileTemplateSource {
  return WORKFLOW_TEMPLATE_FILE_SOURCES.includes(value as WorkflowFileTemplateSource);
}

function sourceOrder(source: WorkflowFileTemplateSource): number {
  return source === 'builtin' ? 0 : 1;
}

function sourceOrderForLegacyLookup(source: WorkflowFileTemplateSource): number {
  return source === 'user' ? 0 : 1;
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
