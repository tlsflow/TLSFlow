import { AppError } from '../../../common/errors/app-error.js';

export const LINUX_AGENT_RELEASE_VERSION = '0.1.10' as const;
export const AGENT_RELEASE_SIGNING_KEY_ID = 'gcac-agent-release-v1' as const;

export interface LinuxAgentArtifactReference {
  platform: 'linux_go';
  arch: 'amd64' | 'arm64';
  artifactRef: string;
  version: string;
  digest: string;
  signature: string;
  signatureAlgorithm: 'Ed25519';
  signingKeyId: string;
}

// 安装接口只暴露发布系统登记的不可变引用，不读取产物文件，也不生成压缩包或执行入口。
const pinnedLinuxArtifacts: Readonly<Record<'amd64' | 'arm64', LinuxAgentArtifactReference>> = Object.freeze({
  amd64: Object.freeze({
    platform: 'linux_go',
    arch: 'amd64',
    artifactRef: 'artifact://gcac/agents/linux-go-full-agent/0.1.10/linux-amd64/gcac-linux-agent',
    version: LINUX_AGENT_RELEASE_VERSION,
    digest: '379ac1133101c3e823d24fcbbf44d6a51195cc068b5bf61a5e3be1896b326413',
    signature: 'artifact://gcac/signatures/agents/linux-go-full-agent/0.1.10/linux-amd64.sig',
    signatureAlgorithm: 'Ed25519',
    signingKeyId: AGENT_RELEASE_SIGNING_KEY_ID,
  }),
  arm64: Object.freeze({
    platform: 'linux_go',
    arch: 'arm64',
    artifactRef: 'artifact://gcac/agents/linux-go-full-agent/0.1.10/linux-arm64/gcac-linux-agent',
    version: LINUX_AGENT_RELEASE_VERSION,
    digest: 'f451609b0223caf9919200fff8cbe165701f6507fee67d3683f608d1c3e3fcbb',
    signature: 'artifact://gcac/signatures/agents/linux-go-full-agent/0.1.10/linux-arm64.sig',
    signatureAlgorithm: 'Ed25519',
    signingKeyId: AGENT_RELEASE_SIGNING_KEY_ID,
  }),
});

export function getLinuxAgentInstallMaterials(arch = releaseArchitecture()): LinuxAgentArtifactReference[] {
  const artifact = pinnedLinuxArtifacts[arch];
  if (!artifact) {
    throw new AppError('VALIDATION_FAILED', '当前运行架构没有固定版本的 Linux Agent Artifact 引用', { arch });
  }
  return [structuredClone(artifact)];
}

function releaseArchitecture(): 'amd64' | 'arm64' {
  if (process.arch === 'x64') return 'amd64';
  if (process.arch === 'arm64') return 'arm64';
  throw new AppError('VALIDATION_FAILED', '当前 Node 运行架构没有 Agent Release 映射', { nodeArch: process.arch });
}
