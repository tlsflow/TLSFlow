import type { CaOperationNormalizedStatus, CaOperationObjectType } from '../schema/internal-ca.schema.js';

export const caOperationObjectTypes = ['request', 'issuance', 'revocation', 'template'] as const;
export const caOperationNormalizedStatuses = ['pending', 'issued', 'rejected', 'revoked', 'failed', 'unknown'] as const;
