import { newId } from '../../shared/id.js';
import type { CredentialIssueRequest, CredentialSession } from './gateway-agent.types.js';

const defaultAllowedActions = ['read', 'write', 'exec', 'upload'];

export class MockCredentialBroker {
  private readonly sessions = new Map<string, CredentialSession>();

  issue(request: CredentialIssueRequest): CredentialSession {
    const now = request.now ?? new Date();
    const requestedActions = [...new Set(request.requestedActions)];
    const denied = requestedActions.filter((action) => !defaultAllowedActions.includes(action));
    if (denied.length > 0) throw new Error(`凭据动作超范围: ${denied.join(',')}`);

    const session: CredentialSession = {
      id: newId('cred_sess'),
      taskId: request.taskId,
      secretRef: { ref: request.secretRef },
      grantRef: { ref: newId('grant') },
      gatewayId: request.gatewayId,
      targetId: request.targetId,
      protocol: request.protocol,
      allowedActions: requestedActions,
      remainingUses: request.maxUses ?? 1,
      expiresAt: new Date(now.getTime() + (request.ttlSeconds ?? 300) * 1000).toISOString(),
      status: 'active',
      createdAt: now.toISOString(),
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(sessionId: string, now = new Date()): CredentialSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;
    if (session.status === 'active' && new Date(session.expiresAt).getTime() <= now.getTime()) {
      const expired: CredentialSession = { ...session, status: 'expired' };
      this.sessions.set(sessionId, expired);
      return expired;
    }
    return session;
  }

  use(sessionId: string, action: string, now = new Date()): CredentialSession {
    const session = this.get(sessionId, now);
    if (!session) throw new Error('凭据会话不存在');
    if (session.status !== 'active') throw new Error(`凭据会话不可用: ${session.status}`);
    if (!session.allowedActions.includes(action)) throw new Error(`凭据动作未授权: ${action}`);
    const updated: CredentialSession = {
      ...session,
      remainingUses: Math.max(session.remainingUses - 1, 0),
      status: session.remainingUses <= 1 ? 'used' : 'active',
    };
    this.sessions.set(sessionId, updated);
    return updated;
  }

  revoke(sessionId: string, now = new Date()): CredentialSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error('凭据会话不存在');
    const revoked: CredentialSession = { ...session, status: 'revoked', revokedAt: now.toISOString() };
    this.sessions.set(sessionId, revoked);
    return revoked;
  }

  list(): CredentialSession[] {
    return [...this.sessions.values()];
  }
}
