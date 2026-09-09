import type { HttpRequest } from '../../common/http/http-types.js';
import type { Router } from '../../common/http/router.js';
import type { RouteContract } from '../../common/openapi/route-contract.js';
import { validateObject } from '../../common/validation/schema-validation.js';
import type { SecurityServices } from '../security/security.controller.js';
import {
  assertRouteAction,
  requestSecurityContext,
  requireRouteSecurity,
} from '../security/security-route-helpers.js';
import { assertSettingsVersion, assertUpdateChannel, SystemUpdateService } from './system-update.service.js';

export class SystemUpdateController {
  constructor(
    private readonly service: SystemUpdateService,
    private readonly security?: SecurityServices,
  ) {}

  register(router: Router): void {
    router.get('/api/v1/system/update-channel', '查询系统更新通道', ['System'], (request) => this.getChannel(request));
    router.put('/api/v1/system/update-channel', '更新系统更新通道', ['System'], (request) => this.updateChannel(request));
    router.get('/api/v1/system/update-check', '检查系统更新', ['System'], (request) => this.check(request));
  }

  private async getChannel(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'settings.read', 'system_setting');
    return this.service.getSettings();
  }

  private async updateChannel(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'settings.system.write', 'system_setting');
    const body = validateObject(request.body, {
      channel: { type: 'string', required: true, enum: ['stable', 'dev'] },
      version: { type: 'number', required: true },
    });
    assertSettingsVersion(body.version);
    return this.service.updateChannel({
      channel: assertUpdateChannel(body.channel),
      version: body.version,
      actorId: security.subject.id,
      context: requestSecurityContext(security),
    });
  }

  private async check(request: HttpRequest) {
    const security = requireRouteSecurity(request, this.security);
    await assertRouteAction(security, 'settings.read', 'system_setting');
    const raw = request.query.channel;
    const channel = Array.isArray(raw) ? raw[0] : raw;
    return this.service.check(channel === undefined || channel === '' ? undefined : assertUpdateChannel(channel));
  }
}

export function getSystemUpdateRouteContracts(): RouteContract[] {
  const settingsSchema = {
    type: 'object',
    required: ['id', 'channel', 'version', 'createdAt', 'updatedAt'],
    properties: {
      id: { type: 'string' },
      channel: { type: 'string', enum: ['stable', 'dev'] },
      version: { type: 'number' },
      updatedBy: { type: 'string' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
    },
  };
  return [
    { method: 'GET', path: '/api/v1/system/update-channel', operationId: 'getSystemUpdateChannel', summary: '查询系统更新通道', tags: ['System'], responseSchema: settingsSchema },
    { method: 'PUT', path: '/api/v1/system/update-channel', operationId: 'updateSystemUpdateChannel', summary: '更新系统更新通道', tags: ['System'], requestSchema: { type: 'object', required: ['channel', 'version'], properties: { channel: { type: 'string', enum: ['stable', 'dev'] }, version: { type: 'number' } } }, responseSchema: settingsSchema },
    {
      method: 'GET',
      path: '/api/v1/system/update-check',
      operationId: 'checkSystemUpdate',
      summary: '检查系统更新',
      tags: ['System'],
      responseSchema: {
        type: 'object',
        required: ['channel', 'currentVersion', 'targetVersion', 'updateAvailable', 'relation', 'publishedAt', 'releaseNotes', 'commands', 'checkedAt'],
        properties: {
          channel: { type: 'string', enum: ['stable', 'dev'] },
          currentVersion: { type: 'string' },
          targetVersion: { type: 'string' },
          updateAvailable: { type: 'boolean' },
          relation: { type: 'string', enum: ['current', 'upgrade', 'downgrade', 'channel_switch'] },
          publishedAt: { type: 'string', format: 'date-time' },
          releaseNotes: { type: 'string' },
          commands: {
            type: 'object',
            required: ['installScript', 'compose'],
            properties: {
              installScript: { type: 'string' },
              compose: { type: 'string' },
            },
          },
          checkedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  ];
}
