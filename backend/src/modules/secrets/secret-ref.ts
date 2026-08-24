import { SECRET_TYPES, type SecretType } from '../../shared/security-types.js';
import { securityErrors } from '../../shared/security-error.js';

export interface ParsedSecretRef {
  type: SecretType;
  secretId: string;
  version: string;
}

const SECRET_REF_PATTERN = /^secret:\/\/([a-z0-9_-]+)\/([A-Za-z0-9_-]+)#([A-Za-z0-9_-]+)$/;

const allowedSecretTypes = new Set<string>(SECRET_TYPES);

export function buildSecretRef(type: SecretType, secretId: string, version: string | number): string {
  const versionPart = typeof version === 'number' ? `v${version}` : version;
  return `secret://${type}/${secretId}#${versionPart}`;
}

export function parseSecretRef(secretRef: string): ParsedSecretRef {
  const matched = SECRET_REF_PATTERN.exec(secretRef);
  if (!matched) {
    throw securityErrors.secretRefInvalid({ secretRef });
  }

  const [, type, secretId, version] = matched;
  if (!allowedSecretTypes.has(type)) {
    throw securityErrors.secretRefInvalid({ reason: 'unknown secret type', type });
  }

  if (version !== 'current' && !/^v\d+$/.test(version)) {
    throw securityErrors.secretRefInvalid({ reason: 'invalid version', version });
  }

  return { type: type as SecretType, secretId, version };
}
