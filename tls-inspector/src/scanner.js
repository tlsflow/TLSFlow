import { spawn } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { rootCertificates } from 'node:tls'
import { promises as fs } from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { clientProfiles, clientProfileCatalogVersion } from './catalog/client-profiles.js'

const CERT_BLOCK_PATTERN = /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g

const PROTOCOL_SPECS = [
  { id: 'tls1_3', label: 'TLS 1.3', opensslFlag: '-tls1_3' },
  { id: 'tls1_2', label: 'TLS 1.2', opensslFlag: '-tls1_2' },
  { id: 'tls1_1', label: 'TLS 1.1', opensslFlag: '-tls1_1' },
  { id: 'tls1_0', label: 'TLS 1.0', opensslFlag: '-tls1' },
  { id: 'ssl3', label: 'SSL 3.0', opensslFlag: '-ssl3' },
]

const CIPHER_CATALOG = {
  'TLS 1.3': [
    { opensslName: 'TLS_AES_128_GCM_SHA256', standardName: 'TLS_AES_128_GCM_SHA256', strength: 128, tags: ['modern'] },
    { opensslName: 'TLS_AES_256_GCM_SHA384', standardName: 'TLS_AES_256_GCM_SHA384', strength: 256, tags: ['modern'] },
    { opensslName: 'TLS_CHACHA20_POLY1305_SHA256', standardName: 'TLS_CHACHA20_POLY1305_SHA256', strength: 256, tags: ['modern'] },
  ],
  'TLS 1.2': [
    { opensslName: 'ECDHE-RSA-AES128-GCM-SHA256', standardName: 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256', strength: 128, tags: ['modern', 'fs'] },
    { opensslName: 'ECDHE-ECDSA-AES128-GCM-SHA256', standardName: 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256', strength: 128, tags: ['modern', 'fs'] },
    { opensslName: 'ECDHE-RSA-AES256-GCM-SHA384', standardName: 'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384', strength: 256, tags: ['modern', 'fs'] },
    { opensslName: 'ECDHE-ECDSA-AES256-GCM-SHA384', standardName: 'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384', strength: 256, tags: ['modern', 'fs'] },
    { opensslName: 'ECDHE-RSA-CHACHA20-POLY1305', standardName: 'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256', strength: 256, tags: ['modern', 'fs'] },
    { opensslName: 'ECDHE-ECDSA-CHACHA20-POLY1305', standardName: 'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256', strength: 256, tags: ['modern', 'fs'] },
    { opensslName: 'ECDHE-RSA-AES128-SHA', standardName: 'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA', strength: 128, tags: ['weak', 'fs', 'cbc'] },
    { opensslName: 'ECDHE-ECDSA-AES128-SHA', standardName: 'TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA', strength: 128, tags: ['weak', 'fs', 'cbc'] },
    { opensslName: 'ECDHE-RSA-AES256-SHA', standardName: 'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA', strength: 256, tags: ['weak', 'fs', 'cbc'] },
    { opensslName: 'ECDHE-ECDSA-AES256-SHA', standardName: 'TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA', strength: 256, tags: ['weak', 'fs', 'cbc'] },
    { opensslName: 'AES128-SHA', standardName: 'TLS_RSA_WITH_AES_128_CBC_SHA', strength: 128, tags: ['weak', 'rsa', 'cbc'] },
    { opensslName: 'AES256-SHA', standardName: 'TLS_RSA_WITH_AES_256_CBC_SHA', strength: 256, tags: ['weak', 'rsa', 'cbc'] },
    { opensslName: 'RC4-SHA', standardName: 'TLS_RSA_WITH_RC4_128_SHA', strength: 128, tags: ['insecure', 'rsa', 'rc4'] },
    { opensslName: 'ECDHE-RSA-RC4-SHA', standardName: 'TLS_ECDHE_RSA_WITH_RC4_128_SHA', strength: 128, tags: ['insecure', 'fs', 'rc4'] },
    { opensslName: 'ECDHE-ECDSA-RC4-SHA', standardName: 'TLS_ECDHE_ECDSA_WITH_RC4_128_SHA', strength: 128, tags: ['insecure', 'fs', 'rc4'] },
  ],
  'TLS 1.1': [
    { opensslName: 'ECDHE-RSA-AES128-SHA', standardName: 'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA', strength: 128, tags: ['weak', 'fs', 'cbc'] },
    { opensslName: 'ECDHE-ECDSA-AES128-SHA', standardName: 'TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA', strength: 128, tags: ['weak', 'fs', 'cbc'] },
    { opensslName: 'AES128-SHA', standardName: 'TLS_RSA_WITH_AES_128_CBC_SHA', strength: 128, tags: ['weak', 'rsa', 'cbc'] },
  ],
  'TLS 1.0': [
    { opensslName: 'ECDHE-RSA-AES128-SHA', standardName: 'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA', strength: 128, tags: ['weak', 'fs', 'cbc'] },
    { opensslName: 'ECDHE-ECDSA-AES128-SHA', standardName: 'TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA', strength: 128, tags: ['weak', 'fs', 'cbc'] },
    { opensslName: 'AES128-SHA', standardName: 'TLS_RSA_WITH_AES_128_CBC_SHA', strength: 128, tags: ['weak', 'rsa', 'cbc'] },
    { opensslName: 'RC4-SHA', standardName: 'TLS_RSA_WITH_RC4_128_SHA', strength: 128, tags: ['insecure', 'rsa', 'rc4'] },
    { opensslName: 'ECDHE-RSA-RC4-SHA', standardName: 'TLS_ECDHE_RSA_WITH_RC4_128_SHA', strength: 128, tags: ['insecure', 'fs', 'rc4'] },
    { opensslName: 'ECDHE-ECDSA-RC4-SHA', standardName: 'TLS_ECDHE_ECDSA_WITH_RC4_128_SHA', strength: 128, tags: ['insecure', 'fs', 'rc4'] },
  ],
  'SSL 3.0': [
    { opensslName: 'RC4-SHA', standardName: 'TLS_RSA_WITH_RC4_128_SHA', strength: 128, tags: ['insecure', 'rsa', 'rc4'] },
    { opensslName: 'AES128-SHA', standardName: 'TLS_RSA_WITH_AES_128_CBC_SHA', strength: 128, tags: ['weak', 'rsa', 'cbc'] },
  ],
}

export const trustCatalogVersion = '2026.08.07'

export async function inspectTarget(target, options = {}) {
  const startedAt = new Date().toISOString()
  const timeoutMs = Number(options.timeoutMs ?? 20_000)
  const baseHandshake = await handshake(target, {}, timeoutMs)
  const sectionErrors = []

  if (!baseHandshake.success || !baseHandshake.certificates.length) {
    return {
      tenantId: target.tenantId,
      targetId: target.id,
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'failed',
      summary: {
        endpoint: `${target.host}:${target.port}`,
        lastInspectedAt: new Date().toISOString(),
      },
      certificate: null,
      trustPaths: buildUnsupportedTrustPaths('无法建立基础 TLS 握手'),
      protocols: [],
      cipherSuites: [],
      simulations: [],
      protocolDetails: {},
      riskSummary: {
        legacyProtocolEnabled: false,
        weakCipherDetected: false,
        tls13Supported: false,
        hstsTooShort: false,
        trustPathIssueCount: 5,
        simulationFailedCount: 0,
        boundaryNotes: ['基础握手失败，无法产出深度结果。'],
      },
      implementationVersion: '2026.08.07',
      profileCatalogVersion: clientProfileCatalogVersion,
      trustCatalogVersion,
      errors: [
        {
          code: 'TLS_NEGOTIATION_FAILED',
          message: baseHandshake.errorMessage ?? '基础 TLS 握手失败',
        },
      ],
    }
  }

  const certificate = buildCertificateSection(baseHandshake.certificates)

  const protocols = await inspectProtocols(target, timeoutMs, sectionErrors)
  const cipherSuites = await inspectCipherSuites(target, protocols.filter((item) => item.supported).map((item) => item.label), timeoutMs, sectionErrors)
  const protocolDetails = await inspectProtocolDetails(target, baseHandshake, protocols, cipherSuites, timeoutMs, sectionErrors)
  const trustPaths = await inspectTrustPaths(certificate, sectionErrors)
  const simulations = simulateClients(protocols, cipherSuites, protocolDetails, certificate)
  const riskSummary = buildRiskSummary(protocols, cipherSuites, protocolDetails, trustPaths, simulations, sectionErrors)

  return {
    tenantId: target.tenantId,
    targetId: target.id,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: sectionErrors.length === 0 ? 'succeeded' : 'partial',
    summary: {
      endpoint: `${target.host}:${target.port}`,
      lastInspectedAt: new Date().toISOString(),
      certificateSubject: certificate.subject,
      expiresAt: certificate.notAfter,
      tls13Supported: riskSummary.tls13Supported,
      legacyProtocolEnabled: riskSummary.legacyProtocolEnabled,
      weakCipherDetected: riskSummary.weakCipherDetected,
      trustPathIssueCount: riskSummary.trustPathIssueCount,
      simulationFailedCount: riskSummary.simulationFailedCount,
    },
    certificate,
    trustPaths,
    protocols,
    cipherSuites,
    simulations,
    protocolDetails,
    riskSummary,
    implementationVersion: '2026.08.07',
    profileCatalogVersion: clientProfileCatalogVersion,
    trustCatalogVersion,
    errors: sectionErrors,
  }
}

async function inspectProtocols(target, timeoutMs, sectionErrors) {
  const results = []
  for (const spec of PROTOCOL_SPECS) {
    try {
      const result = await handshake(target, { protocolFlag: spec.opensslFlag }, timeoutMs)
      results.push({
        id: spec.id,
        label: spec.label,
        supported: result.success,
        negotiatedProtocol: result.protocol ?? null,
        negotiatedCipherSuite: result.cipherSuite ?? null,
        errorMessage: result.success ? null : result.errorMessage,
      })
    } catch (error) {
      sectionErrors.push({
        code: 'INSPECTION_TIMEOUT',
        message: `${spec.label} 协议探测失败：${error instanceof Error ? error.message : '未知错误'}`,
      })
      results.push({
        id: spec.id,
        label: spec.label,
        supported: false,
        negotiatedProtocol: null,
        negotiatedCipherSuite: null,
        errorMessage: error instanceof Error ? error.message : '未知错误',
      })
    }
  }
  return results
}

async function inspectCipherSuites(target, supportedProtocols, timeoutMs, sectionErrors) {
  const results = []
  for (const protocolLabel of supportedProtocols) {
    const catalog = CIPHER_CATALOG[protocolLabel] ?? []
    const protocolSpec = PROTOCOL_SPECS.find((item) => item.label === protocolLabel)
    if (!protocolSpec) continue
    for (const entry of catalog) {
      try {
        const handshakeResult = await handshake(target, {
          protocolFlag: protocolSpec.opensslFlag,
          cipher: protocolLabel === 'TLS 1.3' ? undefined : entry.opensslName,
          cipherSuite: protocolLabel === 'TLS 1.3' ? entry.opensslName : undefined,
        }, timeoutMs)
        if (!handshakeResult.success) continue
        results.push({
          protocol: protocolLabel,
          opensslName: entry.opensslName,
          standardName: entry.standardName,
          negotiatedName: handshakeResult.cipherSuite ?? entry.standardName,
          strengthBits: entry.strength,
          tags: entry.tags,
          forwardSecrecy: entry.tags.includes('fs'),
          insecure: entry.tags.includes('insecure'),
          weak: entry.tags.includes('weak'),
        })
      } catch (error) {
        sectionErrors.push({
          code: 'TLS_NEGOTIATION_FAILED',
          message: `${protocolLabel} 套件探测失败：${error instanceof Error ? error.message : '未知错误'}`,
        })
      }
    }
  }
  return dedupeCipherSuites(results)
}

async function inspectProtocolDetails(target, baseHandshake, protocols, cipherSuites, timeoutMs, sectionErrors) {
  const httpResult = await fetchHttpsMetadata(target)
  const detail = {
    secureRenegotiation: parseSupportFlag(baseHandshake.output, /Secure Renegotiation IS supported/i),
    insecureClientRenegotiation: false,
    alpn: baseHandshake.alpn ?? httpResult.alpn ?? null,
    serverNameRequired: Boolean(target.serverName),
    npn: false,
    ocspStapling: parseOcspStapling(baseHandshake.output),
    sessionResumptionTickets: /TLS session ticket/i.test(baseHandshake.output),
    compression: parseSupportFlag(baseHandshake.output, /Compression:\s+NONE/i) ? false : null,
    forwardSecrecy: cipherSuites.some((item) => item.forwardSecrecy),
    pqcSupported: false,
    supportedNamedGroups: collectNamedGroups(baseHandshake.output),
    hsts: parseHsts(httpResult.headers['strict-transport-security']),
    httpStatus: httpResult.statusCode ?? null,
    httpProtocol: httpResult.httpProtocol ?? null,
    serverHeader: httpResult.headers.server ?? null,
    certificateTransparency: true,
    boundaryNotes: [
      '协议细节主要来自 OpenSSL 握手输出和 HTTPS 响应头，属于服务端事实归纳，不是终端实测。',
    ],
  }

  if (httpResult.error) {
    sectionErrors.push({
      code: 'INSPECTOR_UNAVAILABLE',
      message: `HTTPS 元数据读取失败：${httpResult.error}`,
    })
  }

  if (!protocols.some((item) => item.supported)) {
    sectionErrors.push({
      code: 'TLS_NEGOTIATION_FAILED',
      message: '没有探测到可协商协议，协议细节可能不完整。',
    })
  }

  if (!cipherSuites.length) {
    sectionErrors.push({
      code: 'TLS_NEGOTIATION_FAILED',
      message: '没有探测到可协商套件，协议细节中的弱套件/FS 结论可能不完整。',
    })
  }

  if (timeoutMs <= 0) {
    sectionErrors.push({
      code: 'INSPECTION_TIMEOUT',
      message: '协议细节探测超时设置无效。',
    })
  }

  return detail
}

async function inspectTrustPaths(certificate, sectionErrors) {
  const leafPem = certificate.chain[0]?.pem
  const intermediates = certificate.chain.slice(1).map((item) => item.pem)
  const presentedPath = certificate.chain.map((item, index) => ({
    position: index + 1,
    source: 'server',
    subject: item.subject,
    issuer: item.issuer,
    fingerprintSha256: item.fingerprintSha256,
    selfSigned: item.subject === item.issuer,
  }))

  const views = [
    { id: 'mozilla', label: 'Mozilla', loader: loadMozillaRoots },
    { id: 'apple', label: 'Apple', loader: async () => unsupportedBundle('当前版本未内置 Apple 根证书快照') },
    { id: 'android', label: 'Android', loader: async () => unsupportedBundle('当前版本未内置 Android 根证书快照') },
    { id: 'java', label: 'Java', loader: loadJavaRoots },
    { id: 'windows', label: 'Windows', loader: loadWindowsRoots },
  ]

  const results = []
  for (const view of views) {
    try {
      const bundle = await view.loader()
      if (bundle.status === 'unsupported') {
        results.push({
          view: view.id,
          viewLabel: view.label,
          status: 'unsupported',
          path: presentedPath,
          errorCode: 'TRUST_VIEW_UNSUPPORTED',
          errorMessage: bundle.reason,
          catalogVersion: trustCatalogVersion,
          boundaryNote: bundle.reason,
        })
        continue
      }
      const verification = await verifyAgainstBundle(leafPem, intermediates, bundle.pemBlocks)
      results.push({
        view: view.id,
        viewLabel: view.label,
        status: verification.status,
        path: [...presentedPath, ...resolveTrustAnchorPath(certificate, bundle.certificates)],
        errorCode: verification.status === 'trusted' ? null : verification.errorCode,
        errorMessage: verification.errorMessage,
        catalogVersion: trustCatalogVersion,
        boundaryNote: bundle.note,
      })
    } catch (error) {
      sectionErrors.push({
        code: 'TRUST_VIEW_UNSUPPORTED',
        message: `${view.label} 认证路径分析失败：${error instanceof Error ? error.message : '未知错误'}`,
      })
      results.push({
        view: view.id,
        viewLabel: view.label,
        status: 'unsupported',
        path: presentedPath,
        errorCode: 'TRUST_VIEW_UNSUPPORTED',
        errorMessage: error instanceof Error ? error.message : '未知错误',
        catalogVersion: trustCatalogVersion,
        boundaryNote: `${view.label} 根证书来源不可用。`,
      })
    }
  }
  return results
}

function simulateClients(protocols, cipherSuites, protocolDetails, certificate) {
  const supportedProtocols = protocols.filter((item) => item.supported).map((item) => item.label)
  const serverCertificate = formatServerCertificateLabel(certificate)
  return clientProfiles.map((profile) => {
    const protocol = selectHighestCommonProtocol(profile, supportedProtocols)
    if (!protocol) {
      return {
        profileId: profile.id,
        profileName: profile.name,
        profileVersion: clientProfileCatalogVersion,
        reference: profile.reference,
        capabilityNotes: buildCapabilityNotes(profile),
        serverCertificate,
        status: 'failed',
        protocol: null,
        protocolDisplay: null,
        cipherSuite: null,
        keyExchange: null,
        resultFlags: [],
        forwardSecrecy: null,
        failureReason: 'no_common_protocol',
        explanation: '客户端画像与当前站点没有共同可协商协议。',
        boundaryNote: '该结果来自版本化画像匹配，不等价于真实终端握手。'
      }
    }
    if (!profile.supportsSni && protocolDetails?.serverNameRequired) {
      return {
        profileId: profile.id,
        profileName: profile.name,
        profileVersion: clientProfileCatalogVersion,
        reference: profile.reference,
        capabilityNotes: buildCapabilityNotes(profile),
        serverCertificate,
        status: 'failed',
        protocol: null,
        protocolDisplay: null,
        cipherSuite: null,
        keyExchange: null,
        resultFlags: [],
        forwardSecrecy: null,
        failureReason: 'sni_required',
        explanation: '客户端不支持 SNI，站点要求 SNI 才能协商到正确证书。',
        boundaryNote: '该结果来自版本化画像匹配，不等价于真实终端握手。'
      }
    }
    const negotiated = findNegotiatedCipher(profile, protocol, cipherSuites)
    if (!negotiated) {
      return {
        profileId: profile.id,
        profileName: profile.name,
        profileVersion: clientProfileCatalogVersion,
        reference: profile.reference,
        capabilityNotes: buildCapabilityNotes(profile),
        serverCertificate,
        status: 'failed',
        protocol,
        protocolDisplay: buildSimulationProtocolDisplay(profile, protocol, protocolDetails),
        cipherSuite: null,
        keyExchange: null,
        resultFlags: [],
        forwardSecrecy: null,
        failureReason: 'no_shared_cipher',
        explanation: '客户端画像与站点在该协议下没有共同密码套件。',
        boundaryNote: '该结果来自版本化画像匹配，不等价于真实终端握手。'
      }
    }
    return {
      profileId: profile.id,
      profileName: profile.name,
      profileVersion: clientProfileCatalogVersion,
      reference: profile.reference,
      capabilityNotes: buildCapabilityNotes(profile),
      serverCertificate,
      status: 'succeeded',
      protocol,
      protocolDisplay: buildSimulationProtocolDisplay(profile, protocol, protocolDetails),
      cipherSuite: negotiated.standardName,
      keyExchange: buildSimulationKeyExchangeLabel(negotiated.standardName, protocolDetails),
      resultFlags: buildSimulationResultFlags(profile, negotiated),
      forwardSecrecy: negotiated?.forwardSecrecy ?? false,
      failureReason: null,
      explanation: buildSimulationSuccessExplanation(profile, protocol, negotiated, protocolDetails),
      boundaryNote: '该结果来自版本化画像匹配，不等价于真实终端握手。'
    }
  })
}

function findNegotiatedCipher(profile, protocol, cipherSuites) {
  const protocolSuites = cipherSuites.filter((item) => item.protocol === protocol)
  for (const family of profile.suiteFamilies ?? []) {
    const match = protocolSuites.find((item) => matchesSuiteFamily(item.standardName, family))
    if (match) return match
  }
  return null
}

function matchesSuiteFamily(standardName, family) {
  switch (family) {
    case 'TLS13_AES_128_GCM':
      return standardName === 'TLS_AES_128_GCM_SHA256'
    case 'TLS13_AES_256_GCM':
      return standardName === 'TLS_AES_256_GCM_SHA384'
    case 'TLS13_CHACHA20':
      return standardName === 'TLS_CHACHA20_POLY1305_SHA256'
    case 'ECDHE_GCM_128':
      return /^TLS_ECDHE_(RSA|ECDSA)_WITH_AES_128_GCM_SHA256$/.test(standardName)
    case 'ECDHE_GCM_256':
      return /^TLS_ECDHE_(RSA|ECDSA)_WITH_AES_256_GCM_SHA384$/.test(standardName)
    case 'ECDHE_CHACHA20':
      return /^TLS_ECDHE_(RSA|ECDSA)_WITH_CHACHA20_POLY1305_SHA256$/.test(standardName)
    case 'ECDHE_CBC_128':
      return /^TLS_ECDHE_(RSA|ECDSA)_WITH_AES_128_CBC_SHA$/.test(standardName)
    case 'ECDHE_CBC_256':
      return /^TLS_ECDHE_(RSA|ECDSA)_WITH_AES_256_CBC_SHA$/.test(standardName)
    case 'ECDHE_RC4':
      return /^TLS_ECDHE_(RSA|ECDSA)_WITH_RC4_128_SHA$/.test(standardName)
    case 'RSA_CBC_128':
      return standardName === 'TLS_RSA_WITH_AES_128_CBC_SHA'
    case 'RSA_CBC_256':
      return standardName === 'TLS_RSA_WITH_AES_256_CBC_SHA'
    case 'RSA_RC4':
      return standardName === 'TLS_RSA_WITH_RC4_128_SHA'
    default:
      return false
  }
}

function buildCapabilityNotes(profile) {
  const notes = []
  if (!profile.supportsForwardSecrecy) notes.push('No FS')
  if (!profile.supportsSni) notes.push('No SNI')
  return notes
}

function buildSimulationResultFlags(profile, negotiated) {
  const flags = []
  if (negotiated.forwardSecrecy) flags.push('FS')
  else if (!profile.supportsForwardSecrecy || /_RSA_WITH_/.test(negotiated.standardName)) flags.push('No FS')
  if (negotiated.tags?.includes('rc4')) flags.push('RC4')
  if (negotiated.tags?.includes('cbc') && !negotiated.tags?.includes('rc4')) flags.push('CBC')
  return flags
}

function buildSimulationProtocolDisplay(profile, protocol, protocolDetails) {
  if (profile.supportsAlpnHttp11 && protocolDetails?.alpn === 'http/1.1') {
    return `${protocol} > http/1.1`
  }
  return protocol
}

function buildSimulationKeyExchangeLabel(standardName, protocolDetails) {
  if (!/^TLS_(ECDHE|ECDH)_/.test(standardName) && !standardName.startsWith('TLS_AES_') && !standardName.startsWith('TLS_CHACHA20_')) {
    return null
  }
  const group = normalizeNamedGroupLabel(protocolDetails?.supportedNamedGroups?.[0] ?? '')
  if (!group) return 'ECDH'
  return `ECDH ${group}`
}

function buildSimulationSuccessExplanation(profile, negotiated, protocolDetails) {
  const protocolLabel = buildSimulationProtocolDisplay(profile, negotiated.protocol ?? '', protocolDetails)
  if (negotiated.tags?.includes('rc4')) {
    return `${protocolLabel} 可协商，但落到 RC4 旧套件。`
  }
  if (!negotiated.forwardSecrecy) {
    return `${protocolLabel} 可协商，但不具备前向保密。`
  }
  return `${protocolLabel} 可协商，结果来自版本化画像近似推导。`
}

function formatServerCertificateLabel(certificate) {
  if (!certificate) return 'Unknown'
  const keyAlgorithm = String(certificate.keyAlgorithm ?? '').toLowerCase()
  const keyLabel = keyAlgorithm === 'rsa'
    ? `RSA ${certificate.keySize ?? 'Unknown'}`
    : keyAlgorithm === 'ec'
      ? `ECDSA ${normalizeNamedGroupLabel(String(certificate.keySize ?? 'Unknown'))}`
      : String(certificate.keyAlgorithm ?? 'Unknown').toUpperCase()
  const hash = extractSignatureHash(certificate.signatureAlgorithm)
  return hash ? `${keyLabel} (${hash})` : keyLabel
}

function extractSignatureHash(signatureAlgorithm) {
  const raw = String(signatureAlgorithm ?? '')
  const sha = raw.match(/sha(?:-|_)?(\d{1,3})/i)?.[1]
  return sha ? `SHA${sha}` : null
}

function normalizeNamedGroupLabel(rawValue) {
  const raw = String(rawValue ?? '').trim()
  if (!raw) return ''
  const compact = raw.replace(/,.*$/, '')
  switch (compact.toLowerCase()) {
    case 'prime256v1':
      return 'secp256r1'
    case 'secp384r1':
      return 'secp384r1'
    case 'x25519':
      return 'X25519'
    default:
      return compact
  }
}

function buildRiskSummary(protocols, cipherSuites, protocolDetails, trustPaths, simulations, sectionErrors) {
  const legacyProtocolEnabled = protocols.some((item) => item.supported && ['TLS 1.1', 'TLS 1.0', 'SSL 3.0'].includes(item.label))
  const weakCipherDetected = cipherSuites.some((item) => item.insecure || item.weak)
  const hstsTooShort = protocolDetails.hsts?.maxAge !== null && Number(protocolDetails.hsts?.maxAge ?? 0) < 15_552_000
  return {
    legacyProtocolEnabled,
    weakCipherDetected,
    tls13Supported: protocols.some((item) => item.label === 'TLS 1.3' && item.supported),
    hstsTooShort,
    trustPathIssueCount: trustPaths.filter((item) => item.status !== 'trusted').length,
    simulationFailedCount: simulations.filter((item) => item.status !== 'succeeded').length,
    boundaryNotes: [
      '兼容性模拟不是 SSL Labs 私有评分器复刻版。',
      'Apple 与 Android 视角当前明确返回结构化 unsupported。',
      ...sectionErrors.map((item) => item.message),
    ],
  }
}

function buildCertificateSection(certificates) {
  const chain = certificates.map((pem) => certificateFromPem(pem))
  const leaf = chain[0]
  return {
    subject: leaf.subject,
    issuer: leaf.issuer,
    commonName: leaf.commonName,
    fingerprintSha256: leaf.fingerprintSha256,
    pinSha256: leaf.pinSha256,
    serialNumber: leaf.serialNumber,
    notBefore: leaf.notBefore,
    notAfter: leaf.notAfter,
    signatureAlgorithm: leaf.signatureAlgorithm,
    keyAlgorithm: leaf.keyAlgorithm,
    keySize: leaf.keySize,
    subjectAltNames: leaf.subjectAltNames,
    chain: chain.map((item) => ({
      ...item,
      pem: item.pem,
    })),
  }
}

function certificateFromPem(pem) {
  const x509 = new X509Certificate(pem)
  const publicKey = x509.publicKey
  return {
    pem,
    subject: x509.subject,
    issuer: x509.issuer,
    commonName: extractCommonName(x509.subject),
    fingerprintSha256: x509.fingerprint256.replaceAll(':', '').toLowerCase(),
    pinSha256: publicKey ? publicKey.export({ type: 'spki', format: 'der' }).toString('base64') : null,
    serialNumber: x509.serialNumber,
    notBefore: new Date(x509.validFrom).toISOString(),
    notAfter: new Date(x509.validTo).toISOString(),
    signatureAlgorithm: x509.signatureAlgorithm ?? null,
    keyAlgorithm: publicKey?.asymmetricKeyType ?? null,
    keySize: publicKey?.asymmetricKeyDetails?.modulusLength ?? publicKey?.asymmetricKeyDetails?.namedCurve ?? null,
    subjectAltNames: parseSubjectAltNames(x509.subjectAltName),
  }
}

async function handshake(target, options, timeoutMs) {
  const args = [
    's_client',
    '-connect',
    `${target.host}:${target.port}`,
    '-showcerts',
    '-status',
    '-alpn',
    'h2,http/1.1',
  ]
  if (target.serverName) {
    args.push('-servername', target.serverName)
  }
  if (options.protocolFlag) {
    args.push(options.protocolFlag)
  }
  if (options.cipher) {
    args.push('-cipher', `${options.cipher}:@SECLEVEL=0`)
  } else if ((options.protocolFlag ?? '').startsWith('-tls1') || options.protocolFlag === '-ssl3') {
    args.push('-cipher', 'ALL:@SECLEVEL=0')
  }
  if (options.cipherSuite) {
    args.push('-ciphersuites', options.cipherSuite)
  }
  const result = await runProcess('openssl', args, timeoutMs)
  const output = `${result.stdout}\n${result.stderr}`
  const protocol = parseProtocol(output)
  const cipherSuite = parseCipherSuite(output)
  const certificates = output.match(CERT_BLOCK_PATTERN) ?? []
  const success = Boolean(protocol || cipherSuite || certificates.length)
  return {
    success,
    output,
    protocol,
    cipherSuite,
    certificates,
    alpn: parseAlpn(output),
    errorMessage: success ? null : parseHandshakeError(output),
  }
}

async function runProcess(command, args, timeoutMs) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new Error(`命令超时：${command} ${args.join(' ')}`))
    }, timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ stdout, stderr, exitCode: exitCode ?? -1 })
    })
    child.stdin.end('\n')
  })
}

async function fetchHttpsMetadata(target) {
  return await new Promise((resolve) => {
    const request = https.request({
      host: target.host,
      port: target.port,
      servername: target.serverName || target.host,
      method: 'GET',
      path: '/',
      rejectUnauthorized: false,
      ALPNProtocols: ['h2', 'http/1.1'],
      timeout: 10_000,
    }, (response) => {
      response.resume()
      resolve({
        statusCode: response.statusCode ?? null,
        headers: normalizeHeaders(response.headers),
        alpn: response.socket.alpnProtocol || null,
        httpProtocol: response.httpVersion ? `HTTP/${response.httpVersion}` : null,
      })
    })
    request.on('timeout', () => {
      request.destroy(new Error('HTTPS 请求超时'))
    })
    request.on('error', (error) => {
      resolve({
        statusCode: null,
        headers: {},
        alpn: null,
        httpProtocol: null,
        error: error.message,
      })
    })
    request.end()
  })
}

async function loadMozillaRoots() {
  return {
    status: 'supported',
    pemBlocks: [...rootCertificates],
    certificates: rootCertificates.map((pem) => certificateFromPem(pem)),
    note: 'Mozilla 视角当前使用 Node/OpenSSL 自带可信根快照进行近似分析。',
  }
}

async function loadJavaRoots() {
  try {
    const result = await runProcess('keytool', ['-list', '-cacerts', '-rfc', '-storepass', 'changeit'], 30_000)
    const pemBlocks = (`${result.stdout}\n${result.stderr}`).match(CERT_BLOCK_PATTERN) ?? []
    if (!pemBlocks.length) {
      return unsupportedBundle('运行环境未导出到 Java cacerts 内容')
    }
    return {
      status: 'supported',
      pemBlocks,
      certificates: pemBlocks.map((pem) => certificateFromPem(pem)),
      note: 'Java 视角来自本机 keytool -cacerts 导出的可信根快照。',
    }
  } catch {
    return unsupportedBundle('当前运行环境没有可用的 keytool/cacerts')
  }
}

async function loadWindowsRoots() {
  if (os.platform() !== 'win32') {
    return unsupportedBundle('当前运行环境不是 Windows，无法读取 Windows 根证书库')
  }
  const script = [
    '$roots = Get-ChildItem Cert:\\LocalMachine\\Root',
    'foreach ($root in $roots) { [Convert]::ToBase64String($root.RawData) }',
  ].join('; ')
  try {
    const result = await runProcess('powershell.exe', ['-NoProfile', '-Command', script], 30_000)
    const pemBlocks = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => derBase64ToPem(line))
    if (!pemBlocks.length) {
      return unsupportedBundle('Windows 根证书库为空或当前进程无权访问')
    }
    return {
      status: 'supported',
      pemBlocks,
      certificates: pemBlocks.map((pem) => certificateFromPem(pem)),
      note: 'Windows 视角来自 LocalMachine Root 证书库快照。',
    }
  } catch {
    return unsupportedBundle('读取 Windows 根证书库失败')
  }
}

function unsupportedBundle(reason) {
  return {
    status: 'unsupported',
    reason,
  }
}

async function verifyAgainstBundle(leafPem, intermediates, pemBlocks) {
  const tempBase = await fs.mkdtemp(path.join(tmpdir(), 'gcac-tls-inspector-'))
  try {
    const leafPath = path.join(tempBase, 'leaf.pem')
    const intermediatePath = path.join(tempBase, 'intermediates.pem')
    const caPath = path.join(tempBase, 'ca.pem')
    await fs.writeFile(leafPath, leafPem, 'utf8')
    await fs.writeFile(intermediatePath, intermediates.join('\n'), 'utf8')
    await fs.writeFile(caPath, pemBlocks.join('\n'), 'utf8')
    const args = ['verify', '-CAfile', caPath]
    if (intermediates.length) {
      args.push('-untrusted', intermediatePath)
    }
    args.push(leafPath)
    const result = await runProcess('openssl', args, 20_000)
    const output = `${result.stdout}\n${result.stderr}`
    if (result.exitCode === 0 && /:\s*OK/i.test(output)) {
      return { status: 'trusted', errorCode: null, errorMessage: null }
    }
    if (/unable to get local issuer certificate|unable to verify the first certificate/i.test(output)) {
      return { status: 'incomplete', errorCode: 'CHAIN_INCOMPLETE', errorMessage: output.trim() }
    }
    return { status: 'untrusted', errorCode: 'CHAIN_UNTRUSTED', errorMessage: output.trim() }
  } finally {
    await fs.rm(tempBase, { recursive: true, force: true })
  }
}

function resolveTrustAnchorPath(certificate, bundleCertificates) {
  const lastPresented = certificate.chain.at(-1)
  if (!lastPresented) return []
  const anchor = bundleCertificates.find((item) => item.subject === lastPresented.issuer || item.subject === lastPresented.subject)
  if (!anchor) return []
  return [{
    position: certificate.chain.length + 1,
    source: 'trustStore',
    subject: anchor.subject,
    issuer: anchor.issuer,
    fingerprintSha256: anchor.fingerprintSha256,
    selfSigned: anchor.subject === anchor.issuer,
  }]
}

function dedupeCipherSuites(items) {
  const map = new Map()
  for (const item of items) {
    map.set(`${item.protocol}:${item.standardName}`, item)
  }
  return [...map.values()]
}

function buildUnsupportedTrustPaths(reason) {
  return ['mozilla', 'apple', 'android', 'java', 'windows'].map((view) => ({
    view,
    viewLabel: view,
    status: 'unsupported',
    path: [],
    errorCode: 'TRUST_VIEW_UNSUPPORTED',
    errorMessage: reason,
    catalogVersion: trustCatalogVersion,
    boundaryNote: reason,
  }))
}

function selectHighestCommonProtocol(profile, supportedProtocols) {
  const order = ['SSL 3.0', 'TLS 1.0', 'TLS 1.1', 'TLS 1.2', 'TLS 1.3']
  const minIndex = order.indexOf(profile.lowestProtocol)
  const maxIndex = order.indexOf(profile.highestProtocol)
  return [...supportedProtocols]
    .filter((item) => {
      const index = order.indexOf(item)
      return index >= minIndex && index <= maxIndex
    })
    .sort((left, right) => order.indexOf(right) - order.indexOf(left))[0] ?? null
}

function parseProtocol(output) {
  const direct = output.match(/(?:^|\r?\n)Protocol version:\s*(TLSv1\.3|TLSv1\.2|TLSv1\.1|TLSv1|SSLv3)\b/i)?.[1]
  if (direct) return normalizeProtocolLabel(direct)
  const legacy = output.match(/(?:^|\r?\n)New,\s*(TLSv1(?:\.\d)?|SSLv3)\b/i)?.[1]
  if (legacy) return normalizeProtocolLabel(legacy)
  return null
}

function parseCipherSuite(output) {
  return output.match(/Ciphersuite:\s*([A-Z0-9_\-]+)/i)?.[1]
    ?? output.match(/Cipher is\s+([A-Z0-9_\-]+)/i)?.[1]
    ?? null
}

function parseAlpn(output) {
  return output.match(/ALPN protocol:\s*([^\r\n]+)/i)?.[1]?.trim() ?? null
}

function parseOcspStapling(output) {
  if (/OCSP response: no response sent/i.test(output)) return false
  if (/OCSP Response Data:/i.test(output)) return true
  return null
}

function parseHsts(headerValue) {
  if (!headerValue) return { enabled: false, maxAge: null, raw: null }
  const raw = Array.isArray(headerValue) ? headerValue.join('; ') : String(headerValue)
  const maxAge = Number(raw.match(/max-age=(\d+)/i)?.[1] ?? NaN)
  return {
    enabled: true,
    maxAge: Number.isFinite(maxAge) ? maxAge : null,
    raw,
    preload: /preload/i.test(raw),
    includeSubDomains: /includesubdomains/i.test(raw),
  }
}

function parseHandshakeError(output) {
  return output.match(/error[:\s]+([^\r\n]+)/i)?.[1]?.trim()
    ?? output.match(/alert ([^\r\n]+)/i)?.[1]?.trim()
    ?? output.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0]
    ?? '握手失败'
}

function parseSupportFlag(output, pattern) {
  return pattern.test(output)
}

function collectNamedGroups(output) {
  const matches = [...output.matchAll(/Server Temp Key:\s*([^\r\n]+)/gi)]
  return matches.map((item) => item[1]?.trim()).filter(Boolean)
}

function extractCommonName(subject) {
  return subject.match(/CN\s*=\s*([^,\n]+)/)?.[1]?.trim() ?? null
}

function parseSubjectAltNames(value) {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.startsWith('DNS:'))
    .map((item) => item.slice('DNS:'.length))
}

function normalizeProtocolLabel(value) {
  switch (value.toUpperCase()) {
    case 'TLSV1.3':
      return 'TLS 1.3'
    case 'TLSV1.2':
      return 'TLS 1.2'
    case 'TLSV1.1':
      return 'TLS 1.1'
    case 'TLSV1':
      return 'TLS 1.0'
    case 'SSLV3':
      return 'SSL 3.0'
    default:
      return value
  }
}

function normalizeHeaders(headers) {
  const result = {}
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      result[key] = value.join(', ')
      continue
    }
    if (typeof value === 'string') {
      result[key] = value
    }
  }
  return result
}

function derBase64ToPem(base64) {
  const wrapped = base64.match(/.{1,64}/g)?.join('\n') ?? base64
  return `-----BEGIN CERTIFICATE-----\n${wrapped}\n-----END CERTIFICATE-----\n`
}
