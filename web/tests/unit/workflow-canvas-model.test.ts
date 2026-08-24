import { describe, expect, it } from 'vitest'
import {
  createDefaultWorkflowCanvas,
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
    expect(canvas.variables.certificatePaths).toEqual(expect.objectContaining({
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
      variables: {
        deviceHost: { type: 'string', required: true, description: '目标主机' },
        apiCredential: { type: 'credential', required: true, sensitive: true },
      },
      steps: [
        {
          name: 'prepare_auth',
          type: 'http',
          stage: 'prepare',
          request: {
            method: 'POST',
            url: 'https://{{deviceHost}}/api/login',
            headers: { 'X-Trace-Id': 'trace-1' },
            auth: { type: 'bearer', credential: '{{apiCredential}}' },
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
    expect(node?.config.url).toBe('https://{{deviceHost}}/api/login')
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
      variables: {
        deviceHost: { type: 'string', required: true },
        sshUsername: { type: 'string', required: true },
        credential: { type: 'credential', required: true, sensitive: true },
      },
      steps: [
        {
          name: 'prepare_validate_staged_certificate_files',
          type: 'ssh',
          stage: 'prepare',
          ssh: {
            mode: 'script',
            connection: {
              host: '{{deviceHost}}',
              username: '{{sshUsername}}',
              credential: '{{credential}}',
              hostKeyPolicy: 'manual_approval_required',
            },
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
    expect(rawStep?.type === 'ssh' ? rawStep.ssh.connection.hostKeyPolicy : undefined).toBe('manual_approval_required')
    expect(rawStep?.type === 'ssh' ? rawStep.ssh.script : undefined).toContain("site_conf='{{apacheSiteConfigPath}}'")
    expect(rawStep?.type === 'ssh' ? rawStep.extract : undefined).toEqual([{ name: 'ok', type: 'regex', pattern: 'OK' }])
  })

  it('导入正式 SFTP 和 SCP step 后再导出会保留文件传输字段', () => {
    const importedDsl = {
      apiVersion: 'gcac.workflow/v1',
      kind: 'CurlSshWorkflow',
      metadata: { name: 'file_transfer_workflow', displayName: '文件传输工作流' },
      variables: {
        deviceHost: { type: 'string', required: true },
        sshUsername: { type: 'string', required: true },
        credential: { type: 'credential', required: true, sensitive: true },
        certificate: { type: 'certificate', required: true, sensitive: true },
      },
      steps: [
        {
          name: 'install_certificate_pem',
          type: 'sftp',
          stage: 'install',
          sftp: {
            direction: 'upload',
            connection: {
              host: '{{deviceHost}}',
              username: '{{sshUsername}}',
              credential: '{{credential}}',
              hostKeyPolicy: 'manual_approval_required',
            },
            remotePath: '/etc/gcac-test/certs/test.crt',
            temporaryPath: '/tmp/gcac-test/certs/test.crt',
            contentRef: '{{certificate.pem}}',
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
            connection: {
              host: '{{deviceHost}}',
              username: '{{sshUsername}}',
              credential: '{{credential}}',
              hostKeyPolicy: 'manual_approval_required',
            },
            remotePath: '/etc/gcac-test/certs/test.key',
            temporaryPath: '/tmp/gcac-test/certs/test.key',
            contentRef: '{{certificate.privateKey}}',
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
        connection: expect.objectContaining({ hostKeyPolicy: 'manual_approval_required' }),
        remotePath: '/etc/gcac-test/certs/test.crt',
        temporaryPath: '/tmp/gcac-test/certs/test.crt',
        contentRef: '{{certificate.pem}}',
        mode: '0644',
      }),
      extract: [{ name: 'certHash', type: 'outputPath', path: '$.body.transferResults[0].hash' }],
    }))
    expect(canvas.nodes[1]?.ui?.rawStep).toEqual(expect.objectContaining({
      name: 'install_private_key',
      type: 'scp',
      scp: expect.objectContaining({
        connection: expect.objectContaining({ hostKeyPolicy: 'manual_approval_required' }),
        remotePath: '/etc/gcac-test/certs/test.key',
        temporaryPath: '/tmp/gcac-test/certs/test.key',
        contentRef: '{{certificate.privateKey}}',
        mode: '0600',
      }),
    }))
  })
})
