import type { ComposerTranslation } from 'vue-i18n'

const defaultConfigNameKeys: Record<string, string> = {
  '宿主默认 DER 证书': 'bindings.defaults.derCertificate',
  '宿主默认 CER 证书': 'bindings.defaults.cerCertificate',
  '宿主默认 CRT 证书': 'bindings.defaults.crtCertificate',
  '宿主默认 PEM Bundle': 'bindings.defaults.pemBundle',
  '宿主默认 P7B 证书链': 'bindings.defaults.p7bChain',
  '宿主默认 P7C 证书链': 'bindings.defaults.p7cChain',
  '宿主默认 SPC 证书链': 'bindings.defaults.spcChain',
  '宿主默认 PFX 容器': 'bindings.defaults.pfxContainer',
  '宿主默认 P12 容器': 'bindings.defaults.p12Container',
  '宿主默认 JKS 容器': 'bindings.defaults.jksContainer',
}

/** 将宿主默认配置的稳定后端名称转换为当前界面语言。 */
export function localizeCertificateFormatName(value: string, translate: ComposerTranslation): string {
  const key = defaultConfigNameKeys[value.trim()]
  return key ? translate(key) : value
}
