import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SSHExecutor } from './ssh.executor.js';

describe('spec015 SSH/SFTP/SCP 无代理执行器', () => {
  it('校验 SecretRef、路径和 dry-run 计划，返回 010 可消费结果', () => {
    const executor = new SSHExecutor();
    const result = executor.execute({
      idempotencyKey: 'idem_ssh_1',
      dryRun: true,
      connection: { host: 'web-01', username: 'deploy', credentialSecretRef: 'secret://ssh/web-01#current', expectedHostKeyFingerprint: 'aabbccddeeff0011' },
      command: 'nginx -t',
      sftp: [{ direction: 'upload', localPath: '/artifact/cert.pem', remotePath: '/etc/nginx/cert.pem' }],
      backup: [{ remotePath: '/etc/nginx/cert.pem', backupRef: 'backup://cert.pem' }],
    });
    assert.equal(result.success, true);
    assert.equal(result.dryRun, true);
    assert.deepEqual(result.plannedActions, ['hostkey:verified', 'exec:nginx -t', 'sftp:upload:/etc/nginx/cert.pem', 'backup:/etc/nginx/cert.pem:backup://cert.pem']);
    assert.equal(result.hostKeyDecision, 'verified');
    assert.deepEqual(result.backupManifest, [{ remotePath: '/etc/nginx/cert.pem', backupRef: 'backup://cert.pem' }]);
    assert.deepEqual(executor.getRequiredCapabilities(), ['ssh.connect', 'ssh.hostkey.verify', 'ssh.exec', 'ssh.sftp', 'ssh.scp', 'ssh.sudo', 'file.write', 'file.backup', 'file.rollback']);
  });

  it('拒绝明文凭据、危险命令、非法路径和重复幂等键', () => {
    const executor = new SSHExecutor();
    assert.throws(() => executor.execute({ idempotencyKey: 'bad_cred', connection: { host: 'h', username: 'u', credentialSecretRef: 'password=123' }, command: 'true' }), /SecretRef/);
    assert.throws(() => executor.execute({ idempotencyKey: 'bad_hostkey', connection: { host: 'h', username: 'u', credentialSecretRef: 'secret://ssh/current' }, command: 'true' }), /Host Key/);
    assert.throws(() => executor.execute({ idempotencyKey: 'bad_cmd', connection: { host: 'h', username: 'u', credentialSecretRef: 'secret://ssh/current', expectedHostKeyFingerprint: 'aabbccddeeff0011' }, command: 'rm -rf /' }), /危险/);
    assert.throws(() => executor.execute({ idempotencyKey: 'bad_path', connection: { host: 'h', username: 'u', credentialSecretRef: 'secret://ssh/current', expectedHostKeyFingerprint: 'aabbccddeeff0011' }, sftp: [{ direction: 'upload', localPath: '../x', remotePath: '/tmp/x' }] }), /路径/);
    executor.execute({ idempotencyKey: 'idem_ssh_once', connection: { host: 'h', username: 'u', credentialSecretRef: 'secret://ssh/current', expectedHostKeyFingerprint: 'aabbccddeeff0011' }, command: 'true' });
    assert.throws(() => executor.execute({ idempotencyKey: 'idem_ssh_once', connection: { host: 'h', username: 'u', credentialSecretRef: 'secret://ssh/current', expectedHostKeyFingerprint: 'aabbccddeeff0011' }, command: 'true' }), /幂等键/);
  });

  it('支持 HostKey 策略、sudo SecretRef、Windows OpenSSH 限制和能力探测', () => {
    const executor = new SSHExecutor();
    const tof = executor.execute({
      idempotencyKey: 'idem_ssh_tofu',
      dryRun: true,
      connection: { host: 'web-02', username: 'deploy', credentialSecretRef: 'secret://ssh/web-02', hostKeyPolicy: 'trust_on_first_use' },
      command: 'true',
      sudo: { enabled: true, passwordSecretRef: 'secret://sudo/web-02' },
      rollback: [{ backupRef: 'backup://old-cert', remotePath: '/etc/nginx/cert.pem' }],
    });
    assert.equal(tof.hostKeyDecision, 'trust_on_first_use');
    assert.ok(tof.plannedActions.includes('rollback:backup://old-cert:/etc/nginx/cert.pem'));
    assert.throws(() => executor.execute({
      idempotencyKey: 'idem_win_bad',
      connection: { host: 'win', username: 'deploy', credentialSecretRef: 'secret://ssh/win', expectedHostKeyFingerprint: 'aabbccddeeff0011', platform: 'WINDOWS_OPENSSH' },
      command: 'systemctl reload nginx',
    }), /Windows OpenSSH/);

    const probe = executor.probeCapabilities({ host: 'win', username: 'deploy', credentialSecretRef: 'secret://ssh/win', expectedHostKeyFingerprint: 'aabbccddeeff0011', platform: 'WINDOWS_OPENSSH' });
    assert.equal(probe.declarations.some((item) => item.capabilityKey === 'os.windows_openssh' && item.value === true), true);
    assert.equal(probe.compatibilityWarnings.length, 1);
  });
});
