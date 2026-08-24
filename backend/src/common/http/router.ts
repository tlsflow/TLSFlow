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

  match(method: string, path: string): RouteDefinition | undefined {
    return this.routes.get(this.createKey(method.toUpperCase(), path));
  }

  listRoutes(): RouteDefinition[] {
    return [...this.routes.values()];
  }

  private createKey(method: string, path: string): string {
    return `${method.toUpperCase()} ${path}`;
  }
}
