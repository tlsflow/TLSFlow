import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertLinuxAmd64Elf, getLinuxAgentInstallMaterials } from './application/linux-agent-bundle.js';

describe('Linux Agent 安装材料', () => {
  it('拒绝 macOS 和 arm64 二进制，避免错误平台 bundle 到远端', () => {
    assert.throws(() => assertLinuxAmd64Elf(Buffer.from('cffaedfe', 'hex')), /必须是 little-endian ELF64/);
    const arm64Elf = Buffer.alloc(20);
    arm64Elf.writeUInt32BE(0x7f454c46, 0);
    arm64Elf[4] = 2;
    arm64Elf[5] = 1;
    arm64Elf.writeUInt16LE(0xb7, 18);
    assert.throws(() => assertLinuxAmd64Elf(arm64Elf), /架构不匹配/);
  });

  it('只返回固定版本、摘要、签名和受控 Artifact 引用', () => {
    const materials = getLinuxAgentInstallMaterials('amd64');

    assert.equal(materials.length, 1);
    const material = materials[0]!;
    assert.equal(material.platform, 'linux_go');
    assert.equal(material.arch, 'amd64');
    assert.equal(material.version, '0.1.14');
    assert.match(material.artifactRef, /^artifact:\/\/gcac\/agents\/linux-go-full-agent\/0\.1\.13\//);
    assert.match(material.digest, /^[a-f0-9]{64}$/);
    assert.match(material.signature, /^artifact:\/\/gcac\/signatures\/agents\/linux-go-full-agent\/0\.1\.13\//);
    assert.equal(material.signatureAlgorithm, 'Ed25519');
    assert.equal(material.signingKeyId, 'gcac-agent-release-v1');
    assert.doesNotMatch(JSON.stringify(material), /(?:https?:|script|shell|powershell|cmd|exec|command)/i);
  });

  it('不同架构仍只能映射到预登记的固定 Artifact', () => {
    const materials = getLinuxAgentInstallMaterials('arm64');
    assert.equal(materials[0]?.arch, 'arm64');
    assert.equal(materials[0]?.version, '0.1.14');
    assert.match(materials[0]?.artifactRef ?? '', /^artifact:\/\/gcac\//);
    assert.throws(() => getLinuxAgentInstallMaterials('x64' as never), /没有固定版本/);
  });
});
