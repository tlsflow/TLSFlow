import { readFileSync } from 'node:fs';
import type { CertificateLocationV1 } from '../dto/certificate-location.dto.js';
import type { ResolvedDeploymentInputV1 } from '../dto/resolved-deployment-input.dto.js';
import type { InputValueProvenanceV1 } from '../domain/deployment-input-provenance.js';
import {
  validateCertificateUpdateInputContract,
  type CertificateUpdateArtifactKind,
  type CertificateUpdateInputContractV1,
} from './certificate-update.contract.js';
import { resolveCertificateUpdateSnapshot, type CertificateUpdateResolvedSnapshotV1 } from './certificate-update-input.service.js';

export const certificateUpdatePluginIds = [
  'web.nginx.linux',
  'web.nginx.windows',
  'web.apache.linux',
  'web.apache.windows',
  'app.tomcat.linux',
  'app.tomcat.windows',
] as const;

export type CertificateUpdateTestPluginId = typeof certificateUpdatePluginIds[number];

const fixtureRoots: Readonly<Record<'linux' | 'windows', string>> = Object.freeze({
  linux: '/opt/gcac',
  windows: 'C:/Program Files/GCAC',
});

const fixtureOsTypes: Readonly<Record<'linux' | 'windows', string>> = Object.freeze({
  linux: 'LINUX',
  windows: 'WINDOWS_SERVER_2022',
});

const fixtureProgramNames: Readonly<Record<'web.nginx' | 'web.apache' | 'app.tomcat', string>> = Object.freeze({
  'web.nginx': 'nginx',
  'web.apache': 'apache',
  'app.tomcat': 'java',
});

const fixtureConfigCheckArgs: Readonly<Record<'web.nginx' | 'web.apache' | 'app.tomcat', string[]>> = Object.freeze({
  'web.nginx': ['-t'],
  'web.apache': ['-t'],
  'app.tomcat': ['--check-config'],
});

export function loadCertificateUpdateContract(pluginId: CertificateUpdateTestPluginId, capability = 'deploy'): CertificateUpdateInputContractV1 {
  const directory = pluginId.replaceAll('.', '-');
  const content = readFileSync(new URL(`../../plugins/builtin-plugins/${directory}/contracts/${capability}.json`, import.meta.url), 'utf8');
  return validateCertificateUpdateInputContract(JSON.parse(content));
}

export function loadCertificateUpdateResource(pluginId: CertificateUpdateTestPluginId, resource: string): string {
  const directory = pluginId.replaceAll('.', '-');
  return readFileSync(new URL(`../../plugins/builtin-plugins/${directory}/${resource}`, import.meta.url), 'utf8');
}

export function createResolvedCertificateUpdateInput(
  pluginId: CertificateUpdateTestPluginId,
  overrides: {
    platform?: 'linux' | 'windows';
    frameworkType?: 'web.nginx' | 'web.apache' | 'app.tomcat';
    confidence?: 'EXACT' | 'INFERRED' | 'UNKNOWN';
    configFingerprint?: string;
    secretRefs?: Record<string, string>;
    targetMetadata?: Record<string, unknown>;
    location?: Partial<CertificateLocationV1>;
  } = {},
): ResolvedDeploymentInputV1 {
  const contract = loadCertificateUpdateContract(pluginId);
  const platform = overrides.platform ?? contract.platform;
  const frameworkType = overrides.frameworkType ?? contract.frameworkType;
  const root = fixtureRoots[platform];
  const path = (name: string) => `${root}/${name}`;
  const configFingerprint = overrides.configFingerprint ?? 'a'.repeat(64);
  const productPath = frameworkType.replaceAll('.', '-');
  const locationByArtifactKind: Readonly<Record<CertificateUpdateArtifactKind, Partial<CertificateLocationV1>>> = Object.freeze({
    PEM_FILES: {
      certificatePath: path(`${productPath}/certs/server.crt`),
      privateKeyPath: path(`${productPath}/certs/server.key`),
      chainPath: path(`${productPath}/certs/chain.crt`),
    },
    KEYSTORE: {
      keystorePath: path('tomcat/conf/confirmed.keystore'),
      keystoreType: 'PKCS12',
      keyAlias: 'server',
    },
  });
  const location: CertificateLocationV1 = {
    apiVersion: 'gcac.certificate-location/v1',
    storageKind: contract.artifactKind,
    sourceConfigPath: path(`${productPath}/conf/server.conf`),
    serviceName: `${productPath}-confirmed`,
    programPath: path(`${productPath}/${fixtureProgramNames[frameworkType]}`),
    workingDirectory: root,
    configFingerprint,
    confidence: overrides.confidence ?? 'EXACT',
    observedAt: '2026-08-19T04:00:00.000Z',
    ...locationByArtifactKind[contract.artifactKind],
    ...overrides.location,
  };
  const targetMetadata = {
    frameworkType,
    bindingKey: 'tls:confirmed-binding',
    programSha256: 'b'.repeat(64),
    workingDirectory: root,
    configCheckArgs: fixtureConfigCheckArgs[frameworkType],
    configCheckArgsTemplate: fixtureConfigCheckArgs[frameworkType],
    ...overrides.targetMetadata,
  };
  const variablesByArtifactKind: Readonly<Record<CertificateUpdateArtifactKind, Record<string, unknown>>> = {
    KEYSTORE: {
      keystorePath: location.keystorePath,
      keystoreType: location.keystoreType,
      keyAlias: location.keyAlias,
      configPath: location.sourceConfigPath,
      serviceName: location.serviceName,
      programPath: location.programPath,
      configFingerprint,
    },
    PEM_FILES: {
      certificatePath: location.certificatePath,
      privateKeyPath: location.privateKeyPath,
      chainPath: location.chainPath,
      configPath: location.sourceConfigPath,
      serviceName: location.serviceName,
      programPath: location.programPath,
      configFingerprint,
    },
  };
  const variables = variablesByArtifactKind[contract.artifactKind];
  const provenance: Record<string, InputValueProvenanceV1> = Object.fromEntries(Object.keys(variables).map((name) => [
    `variables.${name}`,
    { source: 'asset', sourcePath: `target.certificateLocation.${name}` },
  ]));
  const resolved: ResolvedDeploymentInputV1 = {
    apiVersion: 'gcac.resolved-deployment-input/v1',
    contractVersion: 'gcac.deployment-input/v1',
    assetContext: {
      apiVersion: 'gcac.deployment-asset-context/v1',
      application: { id: 'asset-1', address: 'confirmed.example.test', serverName: 'confirmed.example.test', port: 443, protocol: 'HTTPS' },
      host: { id: 'host-1', hostname: 'confirmed-host', osType: fixtureOsTypes[platform] },
      site: { id: 'site-1', type: 'web.site', name: 'confirmed.example.test', metadata: {} },
      target: { id: 'target-1', type: 'tls.binding', key: 'tls:confirmed-binding', bindingKey: 'tls:confirmed-binding', certificateLocation: location, metadata: targetMetadata },
      deployment: { targets: [{ id: 'target-1', name: 'confirmed', certificateLocation: location, metadata: {} }], certificateResourceName: 'certificateArtifact' },
    },
    variables,
    connections: {},
    credentials: {
      KEYSTORE: { keystorePassword: { credentialId: 'credential-1', kind: 'USERNAME_PASSWORD' as const, secretRefs: overrides.secretRefs ?? { password: 'secret://certificate/tomcat-password' } } },
      PEM_FILES: {},
    }[contract.artifactKind],
    artifacts: {
      certificateArtifact: {
        artifactId: 'artifact-1',
        artifactSha256: `sha256:${'c'.repeat(64)}`,
        outputs: {
          KEYSTORE: { pfxBase64: 'cA==', jksBase64: 'SkVLUw==' },
          PEM_FILES: {
            leafPem: '-----BEGIN CERTIFICATE-----\nZHVtbXk=\n-----END CERTIFICATE-----',
            privateKeyPem: '-----BEGIN PRIVATE KEY-----\nZHVtbXk=\n-----END PRIVATE KEY-----',
            orderedChainPem: '-----BEGIN CERTIFICATE-----\nZHVtbXk=\n-----END CERTIFICATE-----',
          },
        }[contract.artifactKind],
      },
    },
    provenance,
    sensitivePaths: {
      KEYSTORE: ['credentials.keystorePassword'],
      PEM_FILES: ['artifacts.certificateArtifact.outputs.privateKeyPem'],
    }[contract.artifactKind],
    issues: [],
    executable: true,
    resolvedSha256: 'd'.repeat(64),
  };
  return resolved;
}

export function createCertificateUpdateSnapshot(
  pluginId: CertificateUpdateTestPluginId,
  options: Parameters<typeof createResolvedCertificateUpdateInput>[1] = {},
): CertificateUpdateResolvedSnapshotV1 {
  const contract = loadCertificateUpdateContract(pluginId);
  return resolveCertificateUpdateSnapshot(createResolvedCertificateUpdateInput(pluginId, options), contract, {
    pluginVersionId: `${pluginId}-version-1`,
    resourceHash: `sha256:${'e'.repeat(64)}`,
  });
}
