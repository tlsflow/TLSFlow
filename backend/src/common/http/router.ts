import type { HttpHandler, RouteDefinition } from './http-types.js';
import { AppError } from '../errors/app-error.js';

export class Router {
  private readonly routes = new Map<string, RouteDefinition>();

  register(route: RouteDefinition): void {
    const key = this.createKey(route.method, route.path);
    if (this.routes.has(key)) {
      throw new AppError('SYSTEM_INTERNAL_ERROR', `重复路由：${key}`);
    }
    this.routes.set(key, route);
  }

  get(path: string, summary: string, tags: string[], handler: HttpHandler, responses?: Record<string, unknown>): void {
    this.register({ method: 'GET', path, summary, tags, handler, responses });
  }

  post(path: string, summary: string, tags: string[], handler: HttpHandler, responses?: Record<string, unknown>): void {
    this.register({ method: 'POST', path, summary, tags, handler, responses });
  }

  patch(path: string, summary: string, tags: string[], handler: HttpHandler, responses?: Record<string, unknown>): void {
    this.register({ method: 'PATCH', path, summary, tags, handler, responses });
  }

  delete(path: string, summary: string, tags: string[], handler: HttpHandler, responses?: Record<string, unknown>): void {
    this.register({ method: 'DELETE', path, summary, tags, handler, responses });
  }

  match(method: string, path: string): RouteDefinition | undefined {
    const normalizedMethod = method.toUpperCase();
    const exact = this.routes.get(this.createKey(normalizedMethod, path));
    if (exact) return exact;
    return [...this.routes.values()].find((route) => route.method === normalizedMethod && matchesRoutePath(route.path, path));
  }

  listRoutes(): RouteDefinition[] {
    return [...this.routes.values()];
  }

  private createKey(method: string, path: string): string {
    return `${method.toUpperCase()} ${path}`;
  }
}

function matchesRoutePath(pattern: string, actual: string): boolean {
  if (!pattern.includes('/:')) return false;
  const patternParts = pattern.split('/').filter(Boolean);
  const actualParts = actual.split('/').filter(Boolean);
  if (patternParts.length !== actualParts.length) return false;
  return patternParts.every((part, index) => part.startsWith(':') || part === actualParts[index]);
}
