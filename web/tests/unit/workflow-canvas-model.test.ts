import { describe, expect, it } from 'vitest'
import {
  createDefaultWorkflowCanvas,
  isWorkflowDslCanvasImportable,
  isWorkflowDslV1,
  workflowDslToCanvas,
} from '@/views/workflows/workflow-canvas.model'

describe('workflow canvas model', () => {
  it('默认草稿包含完整证书更换流程骨架', () => {
    const canvas = createDefaultWorkflowCanvas('device-cert-workflow')

    expect(canvas.nodes.map((node) => node.type)).toEqual(['http', 'ssh', 'sftp', 'scp', 'ssh', 'verify'])
    expect(canvas.nodes.map((node) => node.ui?.stage)).toEqual(['prepare', 'backup', 'install', 'install', 'refresh', 'verify'])
    expect(new Set(canvas.nodes.map((node) => node.position.x)).size).toBe(1)
    expect(canvas.nodes.every((node, index, nodes) => index === 0 || node.position.y > nodes[index - 1]!.position.y)).toBe(true)
    expect(canvas.inputContract.variables.certificatePaths).toEqual(expect.objectContaining({
      type: 'object',
      required: true,
      default: expect.objectContaining({
        certPath: '/etc/ssl/certs/site.pem',
        keyPath: '/etc/ssl/private/site.key',
        tempCertPath: '/tmp/gcac-certs/site.pem',
        tempKeyPath: '/tmp/gcac-certs/site.key',
        backupDir: '/var/backups/gcac-certs',
      }),
    }))
    expect(String(canvas.nodes[1]?.config.command)).toContain('{{variables.certificatePaths.backupDir}}')
  })

  it('导入 DSL 后会把高级字段保留在 rawStep 并记录 rollback', () => {
    const importedDsl = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: {
        name: 'imported_workflow',
        displayName: '导入工作流',
        category: 'deployment',
        tags: ['import'],
      },
      inputContract: createDefaultWorkflowCanvas().inputContract,
      steps: [
        {
          name: 'prepare_auth',
          type: 'http',
          stage: 'prepare',
          request: {
            method: 'POST',
            connectionRef: 'management',
            url: 'https://{{connections.management.host}}/api/login',
            headers: { 'X-Trace-Id': 'trace-1' },
            auth: { type: 'bearer', credential: '{{credentials.sshCredential}}' },
            body: { username: 'api-user' },
            timeoutSeconds: 45,
          },
          retry: { count: 2, intervalSeconds: 3 },
          extract: [{ name: 'accessToken', type: 'firstOf', paths: ['$.body.token', '$.body.access_token', '$.body.data.token'], sensitive: true }],
          assert: [{ type: 'statusCode', equals: 200 }],
        },
      ],
      rollback: [
        {
          name: 'rollback_manual',
          type: 'manual',
          stage: 'backup',
          instruction: '恢复到导入前版本',
        },
      ],
    } as const

    expect(isWorkflowDslV1(importedDsl)).toBe(true)

    const canvas = workflowDslToCanvas(importedDsl)
    const node = canvas.nodes[0]
    const rawStep = node?.ui?.rawStep as typeof importedDsl.steps[number] | undefined

    expect(node?.type).toBe('http')
    expect(node?.config.url).toBe('https://{{connections.management.host}}/api/login')
    expect(rawStep?.type).toBe('http')
    expect(rawStep?.type === 'http' ? rawStep.request.headers : undefined).toEqual({ 'X-Trace-Id': 'trace-1' })
    expect(rawStep?.type === 'http' ? rawStep.retry : undefined).toEqual({ count: 2, intervalSeconds: 3 })
    expect(rawStep?.type === 'http' ? rawStep.extract : undefined).toEqual([{ name: 'accessToken', type: 'firstOf', paths: ['$.body.token', '$.body.access_token', '$.body.data.token'], sensitive: true }])
    expect(canvas.draftState?.importedRollback).toEqual(importedDsl.rollback)
  })

  it('导入 SSH script 节点时会映射脚本内容和原始节点名称', () => {
    const importedDsl = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'apache_script_workflow', displayName: 'Apache 脚本工作流' },
      inputContract: createDefaultWorkflowCanvas().inputContract,
      steps: [
        {
          name: 'prepare_validate_staged_certificate_files',
          type: 'ssh',
          stage: 'prepare',
          ssh: {
            mode: 'script',
            connectionRef: 'targetSsh',
            script: "set -eu\nsite_conf='{{apacheSiteConfigPath}}'\ntest -f \"$site_conf\"\nprintf 'OK\\n'",
            timeoutSeconds: 120,
          },
          extract: [{ name: 'ok', type: 'regex', pattern: 'OK' }],
        },
      ],
    } as const

    const canvas = workflowDslToCanvas(importedDsl)
    const node = canvas.nodes[0]
    const rawStep = node?.ui?.rawStep as typeof importedDsl.steps[number] | undefined

    expect(node?.label).toBe('prepare_validate_staged_certificate_files')
    expect(node?.config.command).toContain("site_conf='{{apacheSiteConfigPath}}'")
    expect(rawStep?.type).toBe('ssh')
    expect(rawStep?.type === 'ssh' ? rawStep.ssh.mode : undefined).toBe('script')
    expect(rawStep?.type === 'ssh' ? rawStep.ssh.connectionRef : undefined).toBe('targetSsh')
    expect(rawStep?.type === 'ssh' ? rawStep.ssh.script : undefined).toContain("site_conf='{{apacheSiteConfigPath}}'")
    expect(rawStep?.type === 'ssh' ? rawStep.extract : undefined).toEqual([{ name: 'ok', type: 'regex', pattern: 'OK' }])
  })

  it('导入正式 SFTP 和 SCP step 后再导出会保留文件传输字段', () => {
    const importedDsl = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'file_transfer_workflow', displayName: '文件传输工作流' },
      inputContract: createDefaultWorkflowCanvas().inputContract,
      steps: [
        {
          name: 'install_certificate_pem',
          type: 'sftp',
          stage: 'install',
          sftp: {
            direction: 'upload',
            connectionRef: 'targetSsh',
            remotePath: '/etc/gcac-test/certs/test.crt',
            temporaryPath: '/tmp/gcac-test/certs/test.crt',
            contentRef: '{{artifacts.serverCert.outputs.certFile.content}}',
            mode: '0644',
            timeoutSeconds: 90,
          },
          extract: [{ name: 'certHash', type: 'outputPath', path: '$.body.transferResults[0].hash' }],
        },
        {
          name: 'install_private_key',
          type: 'scp',
          stage: 'install',
          scp: {
            direction: 'upload',
            connectionRef: 'targetSsh',
            remotePath: '/etc/gcac-test/certs/test.key',
            temporaryPath: '/tmp/gcac-test/certs/test.key',
            contentRef: '{{artifacts.serverCert.outputs.keyFile.content}}',
            mode: '0600',
            timeoutSeconds: 90,
          },
        },
      ],
    } as const

    expect(isWorkflowDslV1(importedDsl)).toBe(true)

    const canvas = workflowDslToCanvas(importedDsl)

    expect(canvas.nodes.map((node) => node.type)).toEqual(['sftp', 'scp'])
    expect(canvas.nodes[0]?.ui?.rawStep).toEqual(expect.objectContaining({
      name: 'install_certificate_pem',
      type: 'sftp',
      sftp: expect.objectContaining({
        connectionRef: 'targetSsh',
        remotePath: '/etc/gcac-test/certs/test.crt',
        temporaryPath: '/tmp/gcac-test/certs/test.crt',
        contentRef: '{{artifacts.serverCert.outputs.certFile.content}}',
        mode: '0644',
      }),
      extract: [{ name: 'certHash', type: 'outputPath', path: '$.body.transferResults[0].hash' }],
    }))
    expect(canvas.nodes[1]?.ui?.rawStep).toEqual(expect.objectContaining({
      name: 'install_private_key',
      type: 'scp',
      scp: expect.objectContaining({
        connectionRef: 'targetSsh',
        remotePath: '/etc/gcac-test/certs/test.key',
        temporaryPath: '/tmp/gcac-test/certs/test.key',
        contentRef: '{{artifacts.serverCert.outputs.keyFile.content}}',
        mode: '0600',
      }),
    }))
  })

  it('导入 transform step 后会保留原始 DSL 配置', () => {
    const importedDsl = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'transform_workflow', displayName: '转换工作流' },
      inputContract: createDefaultWorkflowCanvas().inputContract,
      steps: [
        {
          name: 'build_service_bindings',
          type: 'transform',
          stage: 'refresh',
          transform: {
            engine: 'jsonata',
            input: {
              certificates: '{{certificateList}}',
              description: 'GCAC active certificate',
            },
            outputs: {
              newCertificateId: {
                expression: '$filter(certificates, function($c){$c.desc = description})[0].id',
              },
              serviceBindingsJson: {
                expression: '[{"service":"DSM","id":newCertificateId}]',
                format: 'jsonString',
              },
            },
            timeoutMs: 200,
            maxInputBytes: 1048576,
            maxOutputBytes: 1048576,
          },
        },
      ],
    } as const

    expect(isWorkflowDslV1(importedDsl)).toBe(true)

    const canvas = workflowDslToCanvas(importedDsl)
    const node = canvas.nodes[0]
    const rawStep = node?.ui?.rawStep as typeof importedDsl.steps[number] | undefined

    expect(node?.type).toBe('transform')
    expect(node?.label).toBe('build_service_bindings')
    expect(node?.config.expression).toBe('$filter(certificates, function($c){$c.desc = description})[0].id')
    expect(node?.ui?.stage).toBe('refresh')
    expect(rawStep?.type).toBe('transform')
    expect(rawStep?.type === 'transform' ? rawStep.transform.outputs.serviceBindingsJson?.format : undefined).toBe('jsonString')
    expect(rawStep?.type === 'transform' ? rawStep.transform.maxInputBytes : undefined).toBe(1048576)
  })

  it('旧 DSL 也会被兼容导入，而不是回退到默认 nginx 骨架', () => {
    const legacyDsl = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: {
        name: 'legacy-apache',
        displayName: '旧版 Apache 工作流',
      },
      variables: {
        verifyUrl: {
          type: 'string',
          source: { kind: 'asset_ssl', path: 'target.verifyUrl' },
          default: 'https://127.0.0.1:8444/',
          required: true,
          lifecycle: 'pre_execution',
          bindingPolicy: 'fixed',
          configurationMode: 'required',
        },
        serverCert: {
          type: 'certificate',
          source: { kind: 'certificate' },
          required: true,
          lifecycle: 'runtime_injected',
          artifactContract: {
            outputs: {
              certFile: { role: 'public_certificate', required: true, format: 'pem', encoding: 'utf8' },
              keyFile: { role: 'private_key', required: true, format: 'pem', encoding: 'utf8', sensitive: true },
            },
          },
          configurationMode: 'runtime',
        },
      },
      connections: {
        targetSsh: {
          protocol: 'ssh',
          host: { source: 'binding', configurationMode: 'required' },
          port: { source: 'dsl_default', default: 22, configurationMode: 'advanced' },
          username: { source: 'binding', configurationMode: 'required' },
          credential: { slot: 'sshCredential', source: 'credential', configurationMode: 'required' },
          hostKey: { policy: 'trust_on_first_use', configurationMode: 'advanced' },
        },
      },
      steps: [
        {
          name: 'prepare_validate_apache_site',
          type: 'ssh',
          stage: 'prepare',
          ssh: {
            mode: 'script',
            connectionRef: 'targetSsh',
            script: "set -eu\nprintf 'legacy apache\\n'",
            timeoutSeconds: 120,
          },
        },
        {
          name: 'verify_backend_https_response',
          type: 'http',
          stage: 'verify',
          request: {
            method: 'GET',
            url: '{{verifyUrl}}',
            timeoutSeconds: 30,
          },
          assert: [{ type: 'statusCode', equals: 200 }],
        },
      ],
    } as const

    expect(isWorkflowDslV1(legacyDsl)).toBe(false)
    expect(isWorkflowDslCanvasImportable(legacyDsl)).toBe(true)

    const canvas = workflowDslToCanvas(legacyDsl)

    expect(canvas.metadata.name).toBe('legacy-apache')
    expect(canvas.nodes.map((node) => node.label)).toEqual([
      'prepare_validate_apache_site',
      'verify_backend_https_response',
    ])
    expect(canvas.nodes.map((node) => node.type)).toEqual(['ssh', 'verify'])
    expect(canvas.inputContract.connections.targetSsh.transport).toBe('ssh')
    expect(canvas.inputContract.credentials.sshCredential.allowedKinds).toContain('SSH_KEY')
    expect(canvas.inputContract.artifacts.serverCert.artifactContract.outputs.keyFile?.role).toBe('private_key')
  })
})
