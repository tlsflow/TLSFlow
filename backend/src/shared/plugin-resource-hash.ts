import { createHash } from 'node:crypto';

/** 中文说明：资源摘要必须按路径排序后再计算，Runner 与注册表使用同一算法。 */
export function canonicalResourceHash(resourceSha256: Record<string, string>): string {
  const serialized = JSON.stringify(Object.fromEntries(Object.entries(resourceSha256).sort(([left], [right]) => left.localeCompare(right))));
  return `sha256:${createHash('sha256').update(serialized, 'utf8').digest('hex')}`;
}
