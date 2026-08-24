import { AppError } from '../../common/errors/app-error.js';
import type { HttpRequest } from '../../common/http/http-types.js';
import type { Router } from '../../common/http/router.js';
import type { RouteContract } from '../../common/openapi/route-contract.js';
import { validateObject } from '../../common/validation/schema-validation.js';
import type { SupportedLocale, ThemeMode } from '../../persistence/entities/rbac.entity.js';
import { SystemInitializationService } from './system-initialization.service.js';

const themes = ['light', 'dark'] as const;
const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'fr-FR', 'ru-RU', 'pt-BR', 'ko-KR'] as const;

export class SystemInitializationController {
  constructor(private readonly service: SystemInitializationService) {}

  register(router: Router): void {
    router.get('/api/v1/system/initialization', '查询系统初始化状态', ['System'], () => this.service.getStatus());
    router.post('/api/v1/system/initialization', '完成系统初始化', ['System'], (request) => this.initialize(request));
  }

  private async initialize(request: HttpRequest) {
    const body = validateObject(request.body, {
      username: { type: 'string', required: true },
      displayName: { type: 'string', required: true },
      password: { type: 'string', required: true },
      passwordConfirmation: { type: 'string', required: true },
      locale: { type: 'string', required: true, enum: locales },
      theme: { type: 'string', required: true, enum: themes },
    });
    const username = String(body.username).trim();
    const displayName = String(body.displayName).trim();
    const password = String(body.password);
    const passwordConfirmation = String(body.passwordConfirmation);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/.test(username)) {
      throw new AppError('VALIDATION_FAILED', 'Admin 用户名必须为 2 到 64 位字母、数字、点、下划线或短横线');
    }
    if (displayName.length < 1 || displayName.length > 100) {
      throw new AppError('VALIDATION_FAILED', 'Admin 显示名长度必须为 1 到 100 位');
    }
    if (password.length < 8) throw new AppError('VALIDATION_FAILED', 'Admin 密码长度不能少于 8 位');
    if (password !== passwordConfirmation) throw new AppError('VALIDATION_FAILED', '两次输入的密码不一致');
    const result = await this.service.initialize({
      username,
      displayName,
      password,
      passwordConfirmation,
      locale: body.locale as SupportedLocale,
      theme: body.theme as ThemeMode,
    }, request.context);
    return {
      headers: { 'Set-Cookie': this.service.buildSessionSetCookie(result.cookie) },
      body: {
        initialized: result.initialized,
        session: result.session,
      },
    };
  }
}

export function getSystemInitializationRouteContracts(): RouteContract[] {
  return [
    { method: 'GET', path: '/api/v1/system/initialization', operationId: 'getSystemInitializationStatus', summary: '查询系统初始化状态', tags: ['System'], responseSchema: { type: 'object', additionalProperties: true } },
    { method: 'POST', path: '/api/v1/system/initialization', operationId: 'initializeSystem', summary: '完成系统初始化', tags: ['System'], responseSchema: { type: 'object', additionalProperties: true } },
  ];
}
