import { createHash, createPrivateKey, randomBytes } from 'node:crypto';
import { X509Certificate } from 'node:crypto';
import { AppError } from '../../../common/errors/app-error.js';

const JKS_MAGIC = 0xfeedfeed;
const JKS_VERSION = 2;
const PRIVATE_KEY_ENTRY = 1;
const TRUSTED_CERT_ENTRY = 2;
const JKS_KEY_PROTECTION_OID = '1.3.6.1.4.1.42.2.17.1.1';
const JKS_STORE_MAGIC = Buffer.from('Mighty Aphrodite', 'utf8');

export interface ParsedJksEntry {
  alias: string;
  certificateDers: Buffer[];
  privateKeyPem?: string;
}

export interface GenerateJksInput {
  alias: string;
  password: string;
  privateKeyPem: string;
  certificateDers: Buffer[];
}

export function parseJksKeystore(content: Buffer, password: string, alias?: string): ParsedJksEntry {
  const body = content.subarray(0, content.length - 20);
  const checksum = content.subarray(content.length - 20);
  if (content.length < 32 || !jksStoreDigest(password, body).equals(checksum)) {
    throw new AppError('CERT_PARSE_FAILED', 'JKS 完整性校验失败：密码错误或文件损坏', { format: 'jks' }, false);
  }

  const reader = new BinaryReader(body);
  if (reader.u32() !== JKS_MAGIC) throw new AppError('CERT_PARSE_FAILED', 'JKS magic 不合法', { format: 'jks' }, false);
  const version = reader.u32();
  if (version !== JKS_VERSION && version !== 1) throw new AppError('CERT_PARSE_FAILED', 'JKS version 不受支持', { version }, false);
  const count = reader.u32();
  const entries: ParsedJksEntry[] = [];

  for (let index = 0; index < count; index += 1) {
    const tag = reader.u32();
    const entryAlias = reader.utf();
    reader.i64();
    if (tag === PRIVATE_KEY_ENTRY) {
      const encrypted = reader.bytes(reader.u32());
      const chainCount = reader.u32();
      const certificateDers: Buffer[] = [];
      for (let chainIndex = 0; chainIndex < chainCount; chainIndex += 1) {
        const certType = reader.utf();
        const cert = reader.bytes(reader.u32());
        if (certType.toUpperCase() !== 'X.509') throw new AppError('CERT_PARSE_FAILED', 'JKS 证书类型不受支持', { certType }, false);
        certificateDers.push(cert);
      }
      entries.push({ alias: entryAlias, certificateDers, privateKeyPem: decryptJksPrivateKey(encrypted, password) });
    } else if (tag === TRUSTED_CERT_ENTRY) {
      const certType = reader.utf();
      const cert = reader.bytes(reader.u32());
      if (certType.toUpperCase() !== 'X.509') throw new AppError('CERT_PARSE_FAILED', 'JKS 证书类型不受支持', { certType }, false);
      entries.push({ alias: entryAlias, certificateDers: [cert] });
    } else {
      throw new AppError('CERT_PARSE_FAILED', 'JKS entry tag 不受支持', { tag }, false);
    }
  }

  const matched = alias ? entries.find((entry) => entry.alias === alias) : entries.find((entry) => entry.privateKeyPem) ?? entries[0];
  if (!matched) throw new AppError('CERT_PARSE_FAILED', 'JKS 中没有可用证书条目', { format: 'jks' }, false);
  if (alias && !matched) throw new AppError('CERT_PARSE_FAILED', 'JKS alias 不存在', { alias }, false);
  return matched;
}

export function generateJksKeystore(input: GenerateJksInput): Buffer {
  if (input.certificateDers.length === 0) throw new AppError('CERT_EXPORT_FAILED', 'JKS 导出缺少证书链材料', { format: 'jks' });
  const privateKeyDer = Buffer.from(createPrivateKey(input.privateKeyPem).export({ type: 'pkcs8', format: 'der' }) as Buffer);
  const protectedKey = encryptJksPrivateKey(privateKeyDer, input.password);
  const writer = new BinaryWriter();
  writer.u32(JKS_MAGIC);
  writer.u32(JKS_VERSION);
  writer.u32(1);
  writer.u32(PRIVATE_KEY_ENTRY);
  writer.utf(input.alias);
  writer.i64(Date.now());
  writer.u32(protectedKey.length);
  writer.raw(protectedKey);
  writer.u32(input.certificateDers.length);
  for (const cert of input.certificateDers) {
    writer.utf('X.509');
    writer.u32(cert.length);
    writer.raw(cert);
  }
  const body = writer.toBuffer();
  return Buffer.concat([body, jksStoreDigest(input.password, body)]);
}

function decryptJksPrivateKey(encryptedPrivateKeyInfo: Buffer, password: string): string {
  const encrypted = readEncryptedPrivateKeyOctets(encryptedPrivateKeyInfo);
  if (encrypted.length < 40) throw new AppError('CERT_PARSE_FAILED', 'JKS 私钥密文不合法', { format: 'jks' }, false);
  const salt = encrypted.subarray(0, 20);
  const encryptedKey = encrypted.subarray(20, encrypted.length - 20);
  const expectedDigest = encrypted.subarray(encrypted.length - 20);
  const keyDer = xorJksKeyStream(encryptedKey, password, salt);
  const actualDigest = createHash('sha1').update(jksPasswordBytes(password)).update(keyDer).digest();
  if (!actualDigest.equals(expectedDigest)) throw new AppError('CERT_PARSE_FAILED', 'JKS 私钥解密失败：密码错误或私钥损坏', { format: 'jks' }, false);
  return createPrivateKey({ key: keyDer, format: 'der', type: 'pkcs8' }).export({ type: 'pkcs8', format: 'pem' }).toString();
}

function encryptJksPrivateKey(privateKeyDer: Buffer, password: string): Buffer {
  const salt = randomBytes(20);
  const encryptedKey = xorJksKeyStream(privateKeyDer, password, salt);
  const digest = createHash('sha1').update(jksPasswordBytes(password)).update(privateKeyDer).digest();
  return encodeEncryptedPrivateKeyInfo(Buffer.concat([salt, encryptedKey, digest]));
}

function xorJksKeyStream(input: Buffer, password: string, salt: Buffer): Buffer {
  const passwordBytes = jksPasswordBytes(password);
  const output = Buffer.alloc(input.length);
  let previous = Buffer.from(salt);
  let offset = 0;
  while (offset < input.length) {
    const digest = createHash('sha1').update(passwordBytes).update(previous).digest();
    const length = Math.min(digest.length, input.length - offset);
    for (let index = 0; index < length; index += 1) output[offset + index] = input[offset + index] ^ digest[index]!;
    previous = digest;
    offset += length;
  }
  return output;
}

function jksStoreDigest(password: string, body: Buffer): Buffer {
  return createHash('sha1').update(jksPasswordBytes(password)).update(JKS_STORE_MAGIC).update(body).digest();
}

function jksPasswordBytes(password: string): Buffer {
  const output = Buffer.alloc(password.length * 2);
  for (let index = 0; index < password.length; index += 1) output.writeUInt16BE(password.charCodeAt(index), index * 2);
  return output;
}

function encodeEncryptedPrivateKeyInfo(encrypted: Buffer): Buffer {
  return derSequence(
    derSequence(derOid(JKS_KEY_PROTECTION_OID)),
    derOctetString(encrypted),
  );
}

function readEncryptedPrivateKeyOctets(der: Buffer): Buffer {
  const reader = new DerReader(der);
  reader.expect(0x30);
  const end = reader.readLengthEnd();
  reader.expect(0x30);
  const algEnd = reader.readLengthEnd();
  reader.expect(0x06);
  const oid = reader.oid(reader.length());
  if (oid !== JKS_KEY_PROTECTION_OID) throw new AppError('CERT_PARSE_FAILED', 'JKS 私钥保护算法不受支持', { oid }, false);
  // JKS 生成的 AlgorithmIdentifier 可能带 NULL/参数。这里不要假设只有 OID，
  // 直接跳到算法序列末尾，否则会把参数字节错当成 encryptedData 的 OCTET STRING。
  reader.seek(algEnd);
  reader.expect(0x04);
  const encrypted = reader.bytes(reader.length());
  reader.seek(end);
  return encrypted;
}

function derSequence(...parts: Buffer[]): Buffer { return der(0x30, Buffer.concat(parts)); }
function derOctetString(value: Buffer): Buffer { return der(0x04, value); }
function der(tag: number, value: Buffer): Buffer { return Buffer.concat([Buffer.from([tag]), derLength(value.length), value]); }
function derLength(length: number): Buffer {
  if (length < 0x80) return Buffer.from([length]);
  const bytes: number[] = [];
  let value = length;
  while (value > 0) { bytes.unshift(value & 0xff); value >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
function derOid(oid: string): Buffer {
  const parts = oid.split('.').map(Number);
  const bytes = [parts[0]! * 40 + parts[1]!];
  for (const part of parts.slice(2)) {
    const stack = [part & 0x7f];
    let value = part >> 7;
    while (value > 0) { stack.unshift((value & 0x7f) | 0x80); value >>= 7; }
    bytes.push(...stack);
  }
  return der(0x06, Buffer.from(bytes));
}

class BinaryReader {
  private offset = 0;
  constructor(private readonly buffer: Buffer) {}
  u32(): number { const value = this.buffer.readUInt32BE(this.offset); this.offset += 4; return value; }
  i64(): bigint { const value = this.buffer.readBigInt64BE(this.offset); this.offset += 8; return value; }
  utf(): string { const length = this.buffer.readUInt16BE(this.offset); this.offset += 2; return this.bytes(length).toString('utf8'); }
  bytes(length: number): Buffer { const value = this.buffer.subarray(this.offset, this.offset + length); this.offset += length; return Buffer.from(value); }
}

class BinaryWriter {
  private readonly chunks: Buffer[] = [];
  u32(value: number): void { const buffer = Buffer.alloc(4); buffer.writeUInt32BE(value); this.chunks.push(buffer); }
  i64(value: number): void { const buffer = Buffer.alloc(8); buffer.writeBigInt64BE(BigInt(value)); this.chunks.push(buffer); }
  utf(value: string): void { const buffer = Buffer.from(value, 'utf8'); const length = Buffer.alloc(2); length.writeUInt16BE(buffer.length); this.chunks.push(length, buffer); }
  raw(value: Buffer): void { this.chunks.push(Buffer.from(value)); }
  toBuffer(): Buffer { return Buffer.concat(this.chunks); }
}

class DerReader {
  private offset = 0;
  constructor(private readonly buffer: Buffer) {}
  expect(tag: number): void { if (this.buffer[this.offset++] !== tag) throw new Error('bad der tag'); }
  length(): number {
    const first = this.buffer[this.offset++]!;
    if (first < 0x80) return first;
    const count = first & 0x7f;
    let length = 0;
    for (let index = 0; index < count; index += 1) length = (length << 8) | this.buffer[this.offset++]!;
    return length;
  }
  readLengthEnd(): number {
    const length = this.length();
    return this.offset + length;
  }
  bytes(length: number): Buffer { const value = this.buffer.subarray(this.offset, this.offset + length); this.offset += length; return Buffer.from(value); }
  seek(offset: number): void { this.offset = offset; }
  oid(length: number): string {
    const bytes = this.bytes(length);
    const parts = [Math.floor(bytes[0]! / 40), bytes[0]! % 40];
    let value = 0;
    for (const byte of bytes.subarray(1)) {
      value = (value << 7) | (byte & 0x7f);
      if ((byte & 0x80) === 0) { parts.push(value); value = 0; }
    }
    return parts.join('.');
  }
}

export function derToCertificatePem(der: Buffer): string {
  return new X509Certificate(der).toString();
}
