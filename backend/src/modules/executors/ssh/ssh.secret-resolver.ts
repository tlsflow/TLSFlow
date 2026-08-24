import type { SecretService } from '../../secrets/secret.service.js';
import type { ResolvedSshCredential, SSHConnectionProfile, SshSecretResolver, SshSecretResolverContext } from './ssh.types.js';

export class SecretServiceSshResolver implements SshSecretResolver {
  constructor(private readonly secrets: SecretService) {}

  async resolveSecret(secretRef: string, purpose: string, context: SshSecretResolverContext = {}): Promise<string> {
    const resolved = await this.secrets.resolveForService({
      secretRef,
      tenantId: context.tenantId,
      purpose,
      actorId: context.actorId ?? 'ssh-executor',
      context,
    });
    return resolved.plainText;
  }
}

export class StaticSshSecretResolver implements SshSecretResolver {
  constructor(private readonly secrets: Record<string, string>) {}

  async resolveSecret(secretRef: string): Promise<string> {
    const value = this.secrets[secretRef];
    if (value === undefined) throw new Error(`SecretRef 未配置：${secretRef}`);
    return value;
  }
}

export async function resolveSshCredential(
  connection: SSHConnectionProfile,
  resolver: SshSecretResolver,
  context: SshSecretResolverContext = {},
): Promise<ResolvedSshCredential> {
  const primary = await resolver.resolveSecret(connection.credentialSecretRef, 'ssh.authentication', context);
  const passphrase = connection.privateKeyPassphraseSecretRef
    ? await resolver.resolveSecret(connection.privateKeyPassphraseSecretRef, 'ssh.private_key.passphrase', context)
    : undefined;
  const looksLikePrivateKey = /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(primary);
  return {
    kind: looksLikePrivateKey ? 'private_key' : 'password',
    username: connection.username,
    password: looksLikePrivateKey ? undefined : primary,
    privateKey: looksLikePrivateKey ? primary : undefined,
    passphrase,
    secretRefs: [connection.credentialSecretRef, ...(connection.privateKeyPassphraseSecretRef ? [connection.privateKeyPassphraseSecretRef] : [])],
  };
}
