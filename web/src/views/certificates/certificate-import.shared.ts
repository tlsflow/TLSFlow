export interface CertificateImportDraft {
  format: 'PEM' | 'PFX'
  importMethod: 'file' | 'text'
  certificatePem: string
  pfxBase64: string
  pfxPassword: string
  privateKeyPem: string
  name: string
}

export type ImportFormat = CertificateImportDraft['format']
export type ImportMethod = CertificateImportDraft['importMethod']

export interface ImportFormatOption {
  key: ImportFormat
  label: string
  supported: boolean
  hint: string
}

export interface CertificateImportValidationResult {
  sourceFormat: string
  importable: boolean
  blockers: string[]
  warnings: string[]
  certificate: {
    commonName?: string
    sans: string[]
    issuer: Record<string, unknown>
    subject: Record<string, unknown>
    serialNumber: string
    notBefore: string
    notAfter: string
    fingerprintSha256: string
    publicKeyAlgorithm: string
    signatureAlgorithm: string
  }
  privateKey: {
    provided: boolean
    matched: boolean
    source: 'input' | 'container' | 'none'
  }
  chain: {
    status: string
    order: string[]
    diagnostics: string[]
    certificateCount: number
    certificates: Array<{
      fingerprintSha256: string
      displayName: string
      commonName?: string
      subject: Record<string, unknown>
      issuer: Record<string, unknown>
      role: 'leaf' | 'intermediate' | 'root'
    }>
  }
}

export const importMethodOptions: ReadonlyArray<{ key: ImportMethod; label: string; hint: string }> = [
  { key: 'file', label: '选择文件', hint: '适合已经拿到 cert / key 或 .pfx 文件的场景。' },
  { key: 'text', label: '粘贴文本', hint: '适合直接粘贴 PEM 文本，避免上传临时文件。' },
]

export const certificateFormatOptions: ImportFormatOption[] = [
  {
    key: 'PEM',
    label: 'PEM + KEY',
    supported: true,
    hint: '必须同时提供服务器证书、完整中间证书链和私钥。根证书不是强制项，缺少时会给出警告。',
  },
  {
    key: 'PFX',
    label: 'PFX / PKCS#12',
    supported: true,
    hint: '仅支持文件导入，且容器内必须包含服务器证书、完整中间证书链和私钥。根证书不是强制项，缺少时会给出警告。',
  },
]

export function createCertificateImportDraft(
  format: ImportFormat = 'PEM',
): CertificateImportDraft {
  return {
    format,
    importMethod: 'file',
    certificatePem: '',
    pfxBase64: '',
    pfxPassword: '',
    privateKeyPem: '',
    name: '',
  }
}

export function resetCertificateImportDraft(
  draft: CertificateImportDraft,
  format: ImportFormat = draft.format,
) {
  Object.assign(draft, createCertificateImportDraft(format))
}

export function buildCertificateImportPayload(draft: CertificateImportDraft) {
  return {
    declaredFormat: draft.format.toLowerCase(),
    ...(draft.certificatePem.trim() ? { certificatePem: draft.certificatePem.trim() } : {}),
    ...(draft.pfxBase64.trim() ? { pfxBase64: draft.pfxBase64.trim() } : {}),
    ...(draft.pfxPassword ? { pfxPassword: draft.pfxPassword } : {}),
    ...(draft.privateKeyPem.trim() ? { privateKeyPem: draft.privateKeyPem.trim() } : {}),
    ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
    sourceType: 'manual',
  }
}

export function isMaterialReady(draft: CertificateImportDraft) {
  if (draft.format === 'PEM') return Boolean(draft.certificatePem.trim() && draft.privateKeyPem.trim())
  return Boolean(draft.pfxBase64.trim() && draft.pfxPassword)
}
