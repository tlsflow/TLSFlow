export function toYaml(value: unknown, indent = 0): string {
  const space = ' '.repeat(indent);
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value.map((item) => `${space}-${nestedSeparator(item)}${formatNested(item, indent + 2)}`).join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries.map(([key, item]) => `${space}${key}:${nestedSeparator(item)}${formatNested(item, indent + 2)}`).join('\n');
  }
  return JSON.stringify(value);
}

function formatNested(value: unknown, indent: number): string {
  if (value && typeof value === 'object') return `\n${toYaml(value, indent)}`;
  return toYaml(value, indent);
}

function nestedSeparator(value: unknown): string {
  return value && typeof value === 'object' ? '' : ' ';
}
