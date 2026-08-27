import type { CaProviderEntity, CertificateAuthorityEntity } from '../schema/internal-ca.schema.js';

/**
 * 判断两个外部 AD CS Authority 是否代表同一个本地 CA。
 * caConfig 是最强身份；旧记录缺少 caConfig 时，允许通过同一 Provider
 * 或相同 Agent 身份接管，避免删除后重建产生无法查询的孤儿 Authority。
 */
export function sameAdcsAuthorityIdentity(
  left: CertificateAuthorityEntity,
  right: CertificateAuthorityEntity,
  providers: Map<string, CaProviderEntity>,
): boolean {
  const leftProvider = providers.get(left.providerId);
  const rightProvider = providers.get(right.providerId);
  const leftConfig = authorityCaConfig(left, leftProvider);
  const rightConfig = authorityCaConfig(right, rightProvider);
  if (leftConfig && rightConfig) return leftConfig === rightConfig;

  const leftAgentId = authorityIdentityValue(left, leftProvider, 'agentId');
  const rightAgentId = authorityIdentityValue(right, rightProvider, 'agentId');
  if (leftAgentId && rightAgentId && leftAgentId !== rightAgentId) return false;
  const leftAgentKey = authorityIdentityValue(left, leftProvider, 'agentKey');
  const rightAgentKey = authorityIdentityValue(right, rightProvider, 'agentKey');
  if (leftAgentKey && rightAgentKey && leftAgentKey !== rightAgentKey) return false;

  // 同一 Provider 下，只有一侧保存了新 caConfig 的历史记录也应归并。
  if (left.providerId === right.providerId) return true;
  if (leftConfig !== rightConfig) return false;
  if (leftAgentId && rightAgentId) return leftAgentId === rightAgentId;
  if (leftAgentKey && rightAgentKey) return leftAgentKey === rightAgentKey;

  const leftName = left.name.trim().toLowerCase();
  const rightName = right.name.trim().toLowerCase();
  const leftProviderName = leftProvider?.name.trim().toLowerCase();
  const rightProviderName = rightProvider?.name.trim().toLowerCase();
  return leftName === rightName && leftProviderName === rightProviderName;
}

export function allSameAdcsAuthorityIdentity(
  authorities: CertificateAuthorityEntity[],
  providers: Map<string, CaProviderEntity>,
): boolean {
  const [first, ...rest] = authorities;
  return Boolean(first) && rest.every((authority) => sameAdcsAuthorityIdentity(first!, authority, providers));
}

export function authorityCaConfig(
  authority: CertificateAuthorityEntity,
  provider?: CaProviderEntity,
): string | undefined {
  return normalizeIdentity(authority.configuration?.caConfig) ?? normalizeIdentity(provider?.configuration.caConfig);
}

function authorityIdentityValue(
  authority: CertificateAuthorityEntity,
  provider: CaProviderEntity | undefined,
  key: 'agentId' | 'agentKey',
): string | undefined {
  return normalizeIdentity(authority.configuration?.[key]) ?? normalizeIdentity(provider?.configuration[key]);
}

function normalizeIdentity(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : undefined;
}
