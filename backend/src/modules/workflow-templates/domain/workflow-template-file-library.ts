import { readdir, readFile, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../../common/errors/app-error.js';
import type { WorkflowDslV1, WorkflowFileTemplate } from '../dto/workflow-templates.dto.js';
import { workflowTemplatesSchemaRegistry } from '../schema/workflow-templates.schema.js';

interface LoadedWorkflowFileTemplate {
  readonly entry: WorkflowFileTemplate;
  readonly content?: WorkflowDslV1;
}

const WORKFLOW_TEMPLATE_FILE_EXTENSIONS = new Set(['.json', '.dsl']);

export class WorkflowTemplateFileLibrary {
  constructor(
    private readonly rootDir = fileURLToPath(new URL('../../../../../data/workflows/', import.meta.url)),
  ) {}

  async list(): Promise<WorkflowFileTemplate[]> {
    const files = await this.collectFiles(this.rootDir);
    const loaded = await Promise.all(files.map(async (filePath) => await this.loadFile(filePath)));
    return loaded
      .map((item) => item.entry)
      .sort((left, right) => Number(right.valid) - Number(left.valid) || left.relativePath.localeCompare(right.relativePath));
  }

  async getValidContent(fileTemplateId: string): Promise<WorkflowDslV1> {
    const filePath = this.resolveTemplateFilePath(fileTemplateId);
    let loaded: LoadedWorkflowFileTemplate;
    try {
      loaded = await this.loadFile(filePath);
    } catch (error) {
      if (isMissingPath(error)) {
        throw new AppError('RESOURCE_NOT_FOUND', '工作流模板文件不存在', { fileTemplateId });
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

  private async loadFile(filePath: string): Promise<LoadedWorkflowFileTemplate> {
    const fileStat = await stat(filePath);
    const relativePath = normalizeRelativePath(relative(this.rootDir, filePath));
    const fileName = relativePath.split('/').at(-1) ?? relativePath;
    try {
      const raw = stripUtf8Bom(await readFile(filePath, 'utf8'));
      const parsed = JSON.parse(raw) as unknown;
      const content = workflowTemplatesSchemaRegistry.validate(parsed);
      return {
        entry: {
          id: relativePath,
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
          id: relativePath,
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

  private resolveTemplateFilePath(fileTemplateId: string): string {
    const normalized = normalizeRelativePath(fileTemplateId);
    if (!normalized || normalized.startsWith('../') || normalized.includes('/../')) {
      throw new AppError('VALIDATION_FAILED', '模板文件路径不合法', { fileTemplateId });
    }
    return join(this.rootDir, normalized);
  }
}

function stripUtf8Bom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function normalizeRelativePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function isMissingPath(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'ENOENT');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
