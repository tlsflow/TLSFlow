import { AppError } from '../errors/app-error.js';

/**
 * IPC 和 Agent 合同只使用这一组 JSON Schema 关键字。
 * 这里不实现任意脚本式校验，避免把 Schema 门禁变成不可审计的回调集合。
 */
export interface JsonSchema {
  $schema?: string;
  $id?: string;
  $ref?: string;
  title?: string;
  description?: string;
  type?: string | string[];
  const?: unknown;
  enum?: readonly unknown[];
  properties?: Record<string, JsonSchema>;
  required?: readonly string[];
  additionalProperties?: boolean | JsonSchema;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minProperties?: number;
  maxProperties?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
  oneOf?: readonly JsonSchema[];
  anyOf?: readonly JsonSchema[];
  allOf?: readonly JsonSchema[];
  format?: 'date-time' | 'uri' | 'hostname';
  $defs?: Record<string, JsonSchema>;
}

export interface JsonSchemaValidationError {
  path: string;
  keyword: string;
  message: string;
}

export interface JsonSchemaValidationResult {
  valid: boolean;
  errors: JsonSchemaValidationError[];
}

export interface JsonSchemaValidationOptions {
  maxDepth?: number;
  maxArrayItems?: number;
  maxObjectProperties?: number;
}

const defaultOptions: Required<JsonSchemaValidationOptions> = {
  maxDepth: 16,
  maxArrayItems: 100,
  maxObjectProperties: 200,
};

export function validateJsonSchema(
  input: unknown,
  schema: JsonSchema,
  options: JsonSchemaValidationOptions = {},
): JsonSchemaValidationResult {
  const resolvedOptions = { ...defaultOptions, ...options };
  const errors: JsonSchemaValidationError[] = [];
  validateValue(input, schema, '$', 0, schema, resolvedOptions, errors);
  return { valid: errors.length === 0, errors };
}

export function assertJsonSchema(
  input: unknown,
  schema: JsonSchema,
  label: string,
  options?: JsonSchemaValidationOptions,
): void {
  const result = validateJsonSchema(input, schema, options);
  if (!result.valid) {
    throw new AppError('VALIDATION_FAILED', `${label} 不符合 JSON Schema`, {
      errors: result.errors.slice(0, 20),
    });
  }
}

function validateValue(
  input: unknown,
  schema: JsonSchema,
  path: string,
  depth: number,
  rootSchema: JsonSchema,
  options: Required<JsonSchemaValidationOptions>,
  errors: JsonSchemaValidationError[],
): void {
  if (depth > options.maxDepth) {
    addError(errors, path, 'maxDepth', `递归深度超过 ${options.maxDepth}`);
    return;
  }
  if (schema.$ref) {
    const target = resolveLocalReference(rootSchema, schema.$ref);
    if (!target) {
      addError(errors, path, '$ref', `无法解析引用 ${schema.$ref}`);
      return;
    }
    validateValue(input, target, path, depth, rootSchema, options, errors);
    return;
  }
  if (schema.allOf) {
    schema.allOf.forEach((item) => validateValue(input, item, path, depth + 1, rootSchema, options, errors));
  }
  if (schema.oneOf || schema.anyOf) {
    const branches = schema.oneOf ?? schema.anyOf ?? [];
    const matches = branches.filter((branch) => {
      const branchErrors: JsonSchemaValidationError[] = [];
      validateValue(input, branch, path, depth + 1, rootSchema, options, branchErrors);
      return branchErrors.length === 0;
    }).length;
    const expected = schema.oneOf ? 1 : 1;
    if (matches !== expected) {
      addError(errors, path, schema.oneOf ? 'oneOf' : 'anyOf', schema.oneOf ? '必须且只能匹配一个分支' : '必须匹配至少一个分支');
      return;
    }
  }
  if (schema.const !== undefined && !deepEqual(input, schema.const)) {
    addError(errors, path, 'const', '值不等于固定值');
  }
  if (schema.enum && !schema.enum.some((item) => deepEqual(input, item))) {
    addError(errors, path, 'enum', '值不在枚举范围内');
  }
  if (schema.type && !matchesType(input, schema.type)) {
    addError(errors, path, 'type', `类型必须是 ${Array.isArray(schema.type) ? schema.type.join('、') : schema.type}`);
    return;
  }
  if (typeof input === 'string') validateString(input, schema, path, errors);
  if (typeof input === 'number') validateNumber(input, schema, path, errors);
  if (Array.isArray(input)) validateArray(input, schema, path, depth, rootSchema, options, errors);
  if (isRecord(input)) validateObject(input, schema, path, depth, rootSchema, options, errors);
}

function validateString(input: string, schema: JsonSchema, path: string, errors: JsonSchemaValidationError[]): void {
  if (schema.minLength !== undefined && [...input].length < schema.minLength) addError(errors, path, 'minLength', '字符串长度过短');
  if (schema.maxLength !== undefined && [...input].length > schema.maxLength) addError(errors, path, 'maxLength', '字符串长度过长');
  if (schema.pattern && !new RegExp(schema.pattern).test(input)) addError(errors, path, 'pattern', '字符串格式不匹配');
  if (schema.format === 'date-time' && (!/T/.test(input) || Number.isNaN(Date.parse(input)))) addError(errors, path, 'format', '不是有效的 date-time');
  if (schema.format === 'uri') {
    try { new URL(input); } catch { addError(errors, path, 'format', '不是有效的 URI'); }
  }
  if (schema.format === 'hostname' && !/^[A-Za-z0-9.-]+$/.test(input)) addError(errors, path, 'format', '不是有效的 hostname');
}

function validateNumber(input: number, schema: JsonSchema, path: string, errors: JsonSchemaValidationError[]): void {
  if (!Number.isFinite(input)) addError(errors, path, 'finite', '数字必须是有限值');
  if (schema.minimum !== undefined && input < schema.minimum) addError(errors, path, 'minimum', '数字小于最小值');
  if (schema.maximum !== undefined && input > schema.maximum) addError(errors, path, 'maximum', '数字大于最大值');
}

function validateArray(
  input: unknown[],
  schema: JsonSchema,
  path: string,
  depth: number,
  rootSchema: JsonSchema,
  options: Required<JsonSchemaValidationOptions>,
  errors: JsonSchemaValidationError[],
): void {
  if (input.length > options.maxArrayItems) addError(errors, path, 'maxArrayItems', `数组元素超过 ${options.maxArrayItems}`);
  if (schema.minItems !== undefined && input.length < schema.minItems) addError(errors, path, 'minItems', '数组元素过少');
  if (schema.maxItems !== undefined && input.length > schema.maxItems) addError(errors, path, 'maxItems', '数组元素过多');
  if (schema.items) input.forEach((item, index) => validateValue(item, schema.items!, `${path}[${index}]`, depth + 1, rootSchema, options, errors));
}

function validateObject(
  input: Record<string, unknown>,
  schema: JsonSchema,
  path: string,
  depth: number,
  rootSchema: JsonSchema,
  options: Required<JsonSchemaValidationOptions>,
  errors: JsonSchemaValidationError[],
): void {
  const keys = Object.keys(input);
  if (keys.length > options.maxObjectProperties) addError(errors, path, 'maxObjectProperties', `对象字段超过 ${options.maxObjectProperties}`);
  if (schema.minProperties !== undefined && keys.length < schema.minProperties) addError(errors, path, 'minProperties', '对象字段过少');
  if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) addError(errors, path, 'maxProperties', '对象字段过多');
  for (const required of schema.required ?? []) {
    if (!(required in input)) addError(errors, `${path}.${required}`, 'required', '缺少必填字段');
  }
  const properties = schema.properties ?? {};
  for (const key of keys) {
    const propertySchema = properties[key];
    if (!propertySchema) {
      if (schema.additionalProperties === false) addError(errors, `${path}.${key}`, 'additionalProperties', '不允许未知字段');
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateValue(input[key], schema.additionalProperties, `${path}.${key}`, depth + 1, rootSchema, options, errors);
      }
      continue;
    }
    validateValue(input[key], propertySchema, `${path}.${key}`, depth + 1, rootSchema, options, errors);
  }
}

function resolveLocalReference(rootSchema: JsonSchema, reference: string): JsonSchema | undefined {
  if (!reference.startsWith('#/')) return undefined;
  const segments = reference.slice(2).split('/').map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'));
  let current: unknown = rootSchema;
  for (const segment of segments) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return isRecord(current) ? current as JsonSchema : undefined;
}

function matchesType(input: unknown, type: string | string[]): boolean {
  return (Array.isArray(type) ? type : [type]).some((candidate) => {
    if (candidate === 'null') return input === null;
    if (candidate === 'array') return Array.isArray(input);
    if (candidate === 'object') return isRecord(input);
    if (candidate === 'integer') return typeof input === 'number' && Number.isInteger(input);
    return typeof input === candidate;
  });
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input);
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(left[key], right[key]));
}

function addError(errors: JsonSchemaValidationError[], path: string, keyword: string, message: string): void {
  if (errors.length < 50) errors.push({ path, keyword, message });
}
