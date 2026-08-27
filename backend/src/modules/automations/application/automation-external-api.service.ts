import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';
import { newId } from '../../../shared/id.js';
import type { AutomationExternalExecutionMode } from '../dto/automations.dto.js';
import type { AutomationExternalApiKeyEntity } from '../schema/automations.schema.js';
import { AutomationExternalApiKeyRepository } from '../repository/automation-external-api-key.repository.js';

export interface IssuedAutomationExternalApiKey {
  id: string;
  key: string;
  keyPrefix: string;
  executionMode: AutomationExternalExecutionMode;
  createdAt: string;
}

export class AutomationExternalApiService {
  constructor(
    private readonly repository = new AutomationExternalApiKeyRepository(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async issue(input: {
    tenantId: string;
    automationId: string;
    createdBy: string;
    executionMode: AutomationExternalExecutionMode;
  }): Promise<IssuedAutomationExternalApiKey> {
    const plaintext = `ak_${randomBytes(32).toString('base64url')}`;
    const keyPrefix = plaintext.slice(0, 11);
    const createdAt = this.clock().toISOString();
    const entity: AutomationExternalApiKeyEntity = {
      id: newId('aek'),
      tenantId: input.tenantId,
      automationId: input.automationId,
      keyPrefix,
      keyHash: hashKey(plaintext),
      createdBy: input.createdBy,
      createdAt,
    };
    await this.repository.transaction(async (repository) => {
      await repository.revokeActive(input.tenantId, input.automationId, createdAt);
      await repository.create(entity);
    });
    return { id: entity.id, key: plaintext, keyPrefix, executionMode: input.executionMode, createdAt };
  }

  async authenticate(rawKey: string | undefined): Promise<AutomationExternalApiKeyEntity> {
    const key = rawKey?.trim();
    if (!key || key.length < 16 || key.length > 256) throw new AppError('AUTH_UNAUTHENTICATED', '自动化 API Key 无效');
    const entity = await this.repository.findActiveByHash(hashKey(key));
    if (!entity) throw new AppError('AUTH_UNAUTHENTICATED', '自动化 API Key 无效');
    return entity;
  }

  async revoke(tenantId: string, automationId: string): Promise<void> {
    await this.repository.revokeActive(tenantId, automationId, this.clock().toISOString());
  }
}

function hashKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}
