import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getLinuxAgentInstallMaterials } from './application/linux-agent-bundle.js';

describe('Linux Agent 安装材料', () => {
  it('只返回固定版本、摘要、签名和受控 Artifact 引用', () => {
    const materials = getLinuxAgentInstallMaterials('amd64');

    assert.equal(materials.length, 1);
    const material = materials[0]!;
    assert.equal(material.platform, 'linux_go');
    assert.equal(material.arch, 'amd64');
    assert.equal(material.version, '0.1.13');
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
    assert.equal(materials[0]?.version, '0.1.13');
    assert.match(materials[0]?.artifactRef ?? '', /^artifact:\/\/gcac\//);
    assert.throws(() => getLinuxAgentInstallMaterials('x64' as never), /没有固定版本/);
  });
});
