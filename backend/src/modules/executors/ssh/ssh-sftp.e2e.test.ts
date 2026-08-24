import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { SSHExecutor } from './ssh.executor.js';
import { StaticSshSecretResolver } from './ssh.secret-resolver.js';

const requiredEnv = [
  'GCAC_E2E_SSH_HOST',
  'GCAC_E2E_SSH_USER',
  'GCAC_E2E_SSH_SECRET',
  'GCAC_E2E_SSH_HOST_KEY_FINGERPRINT',
  'GCAC_E2E_SFTP_REMOTE_DIR',
] as const;

const missingEnv = requiredEnv.filter((key) => !process.env[key]?.trim());

test('真实 SSH/SFTP 目标闭环：执行结构化服务动作并通过 SFTP 上传校验文件', { skip: missingEnv.length > 0 ? `缺少真实目标环境变量：${missingEnv.join(', ')}` : false }, async () => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const remoteDir = process.env.GCAC_E2E_SFTP_REMOTE_DIR!.replace(/\/+$/, '');
  const remotePath = `${remoteDir}/gcac-e2e-${suffix}.txt`;
  const content = `gcac ssh sftp e2e ${suffix}\n`;
  const executor = new SSHExecutor({
    secretResolver: new StaticSshSecretResolver({
      'secret://e2e/ssh': process.env.GCAC_E2E_SSH_SECRET!,
    }),
  });

  const result = await executor.execute({
    idempotencyKey: `ssh-sftp-e2e-${suffix}`,
    connection: {
      host: process.env.GCAC_E2E_SSH_HOST!,
      port: process.env.GCAC_E2E_SSH_PORT ? Number(process.env.GCAC_E2E_SSH_PORT) : 22,
      username: process.env.GCAC_E2E_SSH_USER!,
      credentialSecretRef: 'secret://e2e/ssh',
      expectedHostKeyFingerprint: process.env.GCAC_E2E_SSH_HOST_KEY_FINGERPRINT!,
      platform: 'LINUX',
      connectTimeoutMs: 10_000,
    },
    program: 'systemctl',
    args: ['service-main'],
    argumentTemplate: 'systemctl.reload',
    timeoutMs: 10_000,
    backup: [{ remotePath, backupRef: `${remoteDir}/.gcac-e2e-${suffix}.backup` }],
    sftp: [{
      direction: 'upload',
      localPath: `/tmp/gcac-e2e-${suffix}.txt`,
      remotePath,
      content,
      mode: '0600',
    }],
    fileTransferCapabilities: { sftp: true, scp: false },
  });

  assert.equal(result.success, true, JSON.stringify(result));
  assert.equal(result.commandResult?.audit?.program, 'systemctl');
  assert.equal(result.commandResult?.audit?.argumentTemplate, 'systemctl.reload');
  assert.equal(result.transferResults?.[0]?.protocol, 'sftp');
  assert.equal(result.transferResults?.[0]?.remotePath, remotePath);
  assert.ok(result.generatedBackupManifest);

  const cleanup = await executor.execute({
    idempotencyKey: `ssh-sftp-e2e-cleanup-${suffix}`,
    connection: {
      host: process.env.GCAC_E2E_SSH_HOST!,
      port: process.env.GCAC_E2E_SSH_PORT ? Number(process.env.GCAC_E2E_SSH_PORT) : 22,
      username: process.env.GCAC_E2E_SSH_USER!,
      credentialSecretRef: 'secret://e2e/ssh',
      expectedHostKeyFingerprint: process.env.GCAC_E2E_SSH_HOST_KEY_FINGERPRINT!,
      platform: 'LINUX',
      connectTimeoutMs: 10_000,
    },
    timeoutMs: 10_000,
    backupManifest: result.generatedBackupManifest,
    rollback: [{ backupRef: result.generatedBackupManifest.items[0]!.backupRef, remotePath }],
  });
  assert.equal(cleanup.success, true, JSON.stringify(cleanup));
  assert.equal(cleanup.rollbackResult?.items[0]?.action, 'deleted_new_file');
});
