import { AppError } from '../errors/app-error.js';

export type PrimitiveSchemaType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface FieldRule {
  type: PrimitiveSchemaType;
  required?: boolean;
  enum?: readonly string[];
}

export type ObjectValidationSchema = Record<string, FieldRule>;

// 轻量校验器只负责基础工程显式校验。复杂 DTO 后续可替换为 Zod/class-validator，但 Controller 不能裸收请求。
export function validateObject(input: unknown, schema: ObjectValidationSchema): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AppError('VALIDATION_FAILED', '请求体必须是对象');
  }
  const value = input as Record<string, unknown>;
  for (const [field, rule] of Object.entries(schema)) {
    const fieldValue = value[field];
    if (rule.required && (fieldValue === undefined || fieldValue === null || fieldValue === '')) {
      throw new AppError('VALIDATION_FAILED', '字段不能为空', { field });
    }
    if (fieldValue === undefined || fieldValue === null) continue;
    if (!matchesType(fieldValue, rule.type)) {
      throw new AppError('VALIDATION_FAILED', '字段类型不正确', { field, expected: rule.type });
    }
    if (rule.enum && typeof fieldValue === 'string' && !rule.enum.includes(fieldValue)) {
      throw new AppError('VALIDATION_FAILED', '枚举值不合法', { field, allowedValues: rule.enum });
    }
  }
  return value;
}

function matchesType(value: unknown, type: PrimitiveSchemaType): boolean {
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return typeof value === 'object' && value !== null && !Array.isArray(value);
  return typeof value === type;
}
