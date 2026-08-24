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

function defaultT(key: string, params?: Record<string, string | number>): string {
  return i18n.global.t(key, params ?? {})
}

export function createImportMethodOptions(t: I18nTranslate = defaultT): ReadonlyArray<{ key: ImportMethod; label: string; hint: string }> {
  return [
    { key: 'file', label: t('certificates.import.methods.file.label'), hint: t('certificates.import.methods.file.hint') },
    { key: 'text', label: t('certificates.import.methods.text.label'), hint: t('certificates.import.methods.text.hint') },
  ]
}

export function createCertificateFormatOptions(t: I18nTranslate = defaultT): ImportFormatOption[] {
  return [
    {
      key: 'PEM',
      label: 'PEM + KEY',
      supported: true,
      hint: t('certificates.import.formats.pem.hint'),
    },
    {
      key: 'PFX',
      label: 'PFX / PKCS#12',
      supported: true,
      hint: t('certificates.import.formats.pfx.hint'),
    },
  ]
}

export const importMethodOptions = createImportMethodOptions()
export const certificateFormatOptions = createCertificateFormatOptions()

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
import { i18n } from '@/i18n'
import type { I18nTranslate } from '@/composables/useBusinessPage'
