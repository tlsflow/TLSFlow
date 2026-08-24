const LDAP_FILTER_ESCAPE_MAP: Record<string, string> = {
  '\\': '\\5c',
  '*': '\\2a',
  '(': '\\28',
  ')': '\\29',
  '\0': '\\00',
};

export function escapeLdapFilterValue(input: string): string {
  return input.replace(/[\\*()\0]/g, (char) => LDAP_FILTER_ESCAPE_MAP[char] ?? char);
}

export function escapeLdapDnValue(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/,/g, '\\,')
    .replace(/\+/g, '\\+')
    .replace(/"/g, '\\"')
    .replace(/</g, '\\<')
    .replace(/>/g, '\\>')
    .replace(/;/g, '\\;')
    .replace(/=/g, '\\=')
    .replace(/^ /g, '\\ ')
    .replace(/ $/g, '\\ ');
}

export function renderLdapTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => values[key] ?? '');
}
