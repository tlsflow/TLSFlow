import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ChannelSelector, WindowsCapabilityProbe, WindowsRemoteExecutor, type WindowsConnectionProfile, type WindowsRemoteRequest } from './windows.executor.js';

const modernProfile: WindowsConnectionProfile = {
  host: 'iis-01',
  username: 'Administrator',
  credentialSecretRef: 'secret://windows/iis-01#current',
  osVersion: 'Windows Server 2019',
  winrm: { transport: 'https', tlsVerify: true },
  smb: { tempDirectory: 'C:\\Windows\\Temp\\gcac', useAdminShare: true },
};

describe('spec016 WinRM/SMB/WMI 无代理执行器基础模型', () => {
  it('ChannelSelector 优先 WinRM，并在文件复制需求下选择 SMB+WMI', () => {
    const probe = new WindowsCapabilityProbe();
    const selector = new ChannelSelector();
    const report = probe.probe(modernProfile);

    const winrm = selector.select({
      connection: modernProfile,
      steps: [{ id: 'import-cert', kind: 'cert_store', script: 'Import-PfxCertificate -FilePath C:\\certs\\site.pfx' }],
    }, report);
    assert.equal(winrm.channel, 'winrm');
    assert.equal(winrm.limitations.length, 0);

    const smbWmi = selector.select({
      connection: modernProfile,
      steps: [{
        id: 'copy-cert',
        kind: 'file_copy',
        copies: [{ direction: 'upload', sourcePath: 'artifact://cert/site.pfx', destinationPath: 'C:\\certs\\site.pfx' }],
      }],
    }, report);
    assert.equal(smbWmi.channel, 'smb_wmi');
    assert.ok(smbWmi.limitations.includes('wmi_exit_code_limited'));
  });

  it('WindowsCapabilityProbe 输出通用 Windows 能力声明', () => {
    const report = new WindowsCapabilityProbe().probe(modernProfile);
    const values = new Map(report.declarations.map((item) => [item.capabilityKey, item.value]));
    assert.equal(values.get('winrm.available'), true);
    assert.equal(values.get('powershell.available'), true);
    assert.equal(values.get('smb.available'), true);
    assert.equal(values.get('wmi.available'), true);
    assert.equal(values.get('windows.cert_store'), true);
    assert.deepEqual(report.suggestions, ['use_winrm']);
  });

  it('ChannelSelector 只消费插件贡献的产品能力声明', () => {
    const selector = new ChannelSelector();
    const probe = new WindowsCapabilityProbe();
    const request = {
      connection: modernProfile,
      steps: [{ id: 'plugin-operation', kind: 'powershell' as const, script: 'Write-Host ok', requires: ['plugin.binding.update'] }],
    };

    const unsupported = selector.select(request, probe.probe(modernProfile));
    assert.equal(unsupported.channel, 'script_package');

    const supported = selector.select(request, probe.probe(modernProfile, {
      declarations: [{ capabilityKey: 'plugin.binding.update', value: true, confidence: 1, evidence: { source: 'plugin' } }],
    }));
    assert.equal(supported.channel, 'winrm');
    assert.deepEqual(supported.requiredCapabilities, ['plugin.binding.update', 'winrm', 'powershell']);
  });

  it('插件能力声明不得覆盖宿主探测事实', () => {
    assert.throws(() => new WindowsCapabilityProbe().probe(modernProfile, {
      declarations: [{ capabilityKey: 'winrm.available', value: false, confidence: 1, evidence: { source: 'plugin' } }],
    }), /不得覆盖宿主探测事实/);
  });

  it('拒绝明文敏感字段、不安全 TLS 策略和非法 Windows 路径', () => {
    const executor = new WindowsRemoteExecutor();
    assert.throws(() => executor.execute({
      idempotencyKey: 'bad_secret',
      connection: { ...modernProfile, credentialSecretRef: 'password=123456' },
      steps: [{ id: 'noop', kind: 'powershell', script: 'Write-Host ok' }],
    }), /SecretRef/);
    assert.throws(() => executor.execute({
      idempotencyKey: 'bad_tls',
      connection: { ...modernProfile, winrm: { transport: 'https', tlsVerify: false } },
      steps: [{ id: 'noop', kind: 'powershell', script: 'Write-Host ok' }],
    }), /TLS/);
    assert.throws(() => executor.execute({
      idempotencyKey: 'bad_plain_secret',
      connection: modernProfile,
      steps: [{ id: 'leak', kind: 'powershell', script: '$password = "123456"' }],
    }), /敏感/);
    assert.throws(() => executor.execute({
      idempotencyKey: 'bad_path',
      connection: modernProfile,
      steps: [{
        id: 'copy',
        kind: 'file_copy',
        copies: [{ direction: 'upload', sourcePath: 'artifact://cert/site.pfx', destinationPath: 'C:\\certs\\..\\site.pfx' }],
      }],
    }), /路径/);
  });

  it('mock execute 不连接真实 Windows，输出 plannedActions、channel、limitations 和备份计划', () => {
    const executor = new WindowsRemoteExecutor();
    const request: WindowsRemoteRequest = {
      idempotencyKey: 'win_mock_1',
      dryRun: true,
      connection: modernProfile,
      steps: [{
        id: 'deploy-cert',
        kind: 'file_copy',
        copies: [{ direction: 'upload', sourcePath: 'artifact://cert/site.pfx', destinationPath: 'C:\\certs\\site.pfx' }],
        backups: [{ remotePath: 'C:\\inetpub\\certs\\site.pfx', backupRef: 'backup://iis/site.pfx', beforeOverwrite: true }],
      }],
    };

    const result = executor.execute(request);
    assert.equal(result.success, true);
    assert.equal(result.dryRun, true);
    assert.equal(result.channel, 'smb_wmi');
    assert.ok(result.plannedActions.includes('channel:smb_wmi'));
    assert.ok(result.plannedActions.includes('smb:upload:artifact://cert/site.pfx->C:\\certs\\site.pfx'));
    assert.ok(result.plannedActions.includes('smb_backup:C:\\inetpub\\certs\\site.pfx:backup://iis/site.pfx'));
    assert.ok(result.limitations.includes('polling_file_observability'));
  });

  it('旧 Windows 降级为脚本包，并明确 WMI 限制', () => {
    const executor = new WindowsRemoteExecutor();
    const legacyProfile: WindowsConnectionProfile = {
      host: 'legacy-2003',
      username: 'Administrator',
      credentialSecretRef: 'secret://windows/legacy-2003',
      osVersion: 'Windows Server 2003',
      preferredChannels: ['winrm', 'smb_wmi', 'script_package'],
    };
    const result = executor.execute({
      idempotencyKey: 'legacy_pkg_1',
      dryRun: true,
      connection: legacyProfile,
      capabilities: {
        winrm: { available: false, https: false, http: false },
        powershell: { available: false },
        smb: { available: false, adminShare: false },
        wmi: { available: false, remoteProcess: false },
      },
      steps: [{ id: 'manual-script', kind: 'powershell', script: 'Write-Host install' }],
    });
    assert.equal(result.channel, 'script_package');
    assert.ok(result.limitations.includes('manual_execution_required'));
    assert.ok(result.scriptPackage?.manifest.manifestHash?.startsWith('sha256:'));
    assert.equal(result.capabilityDeclarations.some((item) => item.capabilityKey === 'risk.legacyWindows' && item.value === true), true);

    const wmiReport = executor.probeCapabilities({ ...legacyProfile, osVersion: 'Windows Server 2008 R2' }, {
      winrm: { available: false, https: false, http: false },
      powershell: { available: false },
      smb: { available: true, adminShare: true },
      wmi: { available: true, remoteProcess: true },
    });
    assert.ok(wmiReport.compatibilityWarnings.some((item) => item.includes('WMI 输出采集')));
  });
});
