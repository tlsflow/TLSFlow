import { describe, expect, it } from 'vitest'
import {
  addNode,
  connectNodes,
  createDefaultWorkflowCanvas,
  getWorkflowDslStepName,
  isWorkflowDslV1,
  setNodeConfigValue,
  validateWorkflowCanvas,
  workflowCanvasToDsl,
  workflowDslToCanvas,
} from '@/views/workflows/workflow-canvas.model'

describe('workflow canvas model', () => {
  it('默认草稿包含完整证书更换流程骨架并能转成 DSL v1', () => {
    const canvas = createDefaultWorkflowCanvas('device-cert-workflow')
    const dsl = workflowCanvasToDsl(canvas)

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
    expect(dsl.apiVersion).toBe('gcac.workflow/v1')
    expect(dsl.steps).toHaveLength(6)
    expect(dsl.steps.map((step) => step.type)).toEqual(['http', 'ssh', 'sftp', 'scp', 'ssh', 'http'])
    expect(dsl.steps.map((step) => step.stage)).toEqual(['prepare', 'backup', 'install', 'install', 'refresh', 'verify'])
    expect(JSON.stringify(dsl)).not.toContain('SFTP_UPLOAD')
    expect(dsl.steps[1]?.type === 'ssh' ? dsl.steps[1].ssh.connection.hostKeyPolicy : undefined).toBe('trust_on_first_use')
    expect(dsl.steps[2]?.type === 'sftp' ? dsl.steps[2].sftp.connection.hostKeyPolicy : undefined).toBe('trust_on_first_use')
    expect(dsl.steps[3]?.type === 'scp' ? dsl.steps[3].scp.connection.hostKeyPolicy : undefined).toBe('trust_on_first_use')
    expect(dsl.steps[4]?.type === 'ssh' ? dsl.steps[4].ssh.commands : undefined).toEqual(['nginx -t', 'systemctl reload nginx'])
    expect(dsl.steps[2]).toEqual(expect.objectContaining({
      type: 'sftp',
      sftp: expect.objectContaining({
        direction: 'upload',
        contentRef: '{{certificate.pem}}',
        remotePath: '{{certificatePaths.certPath}}',
        temporaryPath: '{{certificatePaths.tempCertPath}}',
      }),
    }))
    expect(dsl.steps[3]).toEqual(expect.objectContaining({
      type: 'scp',
      scp: expect.objectContaining({
        direction: 'upload',
        contentRef: '{{certificate.privateKey}}',
        remotePath: '{{certificatePaths.keyPath}}',
        temporaryPath: '{{certificatePaths.tempKeyPath}}',
      }),
    }))
  })

  it('默认 HTTP 认证不生成未声明变量引用', () => {
    const canvas = createDefaultWorkflowCanvas()
    const dsl = workflowCanvasToDsl(canvas)
    const firstStep = dsl.steps[0]
    const payload = JSON.stringify(dsl)

    expect(firstStep?.type).toBe('http')
    expect(firstStep?.type === 'http' ? firstStep.request.auth : undefined).toEqual({
      type: 'none',
    })
    expect(payload).not.toContain('{{secret_workflow_device_api}}')
  })

  it('保存 DSL 不包含明文密钥', () => {
    const canvas = createDefaultWorkflowCanvas()
    const dsl = workflowCanvasToDsl(canvas)
    const payload = JSON.stringify(dsl)

    expect(payload).toContain('{{credential}}')
    expect(payload).not.toMatch(/password\s*[:=]/i)
    expect(payload).not.toContain('-----BEGIN PRIVATE KEY-----')
  })

  it('分支判断节点会转成 condition DSL，并复用同一套 stepName 规则', () => {
    const withCondition = addNode(createDefaultWorkflowCanvas(), 'condition', 'refresh')
    const conditionNode = withCondition.nodes.find((node) => node.type === 'condition')!
    const withVariable = setNodeConfigValue(withCondition, conditionNode.id, 'variable', 'deviceOs')
    const withOperator = setNodeConfigValue(withVariable, conditionNode.id, 'operator', 'equals')
    const configured = setNodeConfigValue(withOperator, conditionNode.id, 'expected', 'linux')
    const dsl = workflowCanvasToDsl(configured)
    const conditionStep = dsl.steps.find((step) => step.type === 'condition')

    expect(conditionStep).toEqual(expect.objectContaining({
      name: getWorkflowDslStepName(configured, conditionNode.id),
      type: 'condition',
      condition: { variable: 'deviceOs', equals: 'linux' },
    }))
  })

  it('SSH 节点多行命令保存为 commands 数组', () => {
    const canvas = createDefaultWorkflowCanvas()
    const sshNode = canvas.nodes.find((node) => node.type === 'ssh' && node.ui?.stage === 'refresh')!
    const configured = setNodeConfigValue(canvas, sshNode.id, 'command', 'nginx -t\nsystemctl reload nginx')
    const dsl = workflowCanvasToDsl(configured)
    const sshStep = dsl.steps.find((step) => step.type === 'ssh' && step.stage === 'refresh')

    expect(sshStep?.type).toBe('ssh')
    expect(sshStep?.type === 'ssh' ? sshStep.ssh.commands : undefined).toEqual(['nginx -t', 'systemctl reload nginx'])
    expect(sshStep?.type === 'ssh' ? sshStep.ssh.command : undefined).toBeUndefined()
  })

  it('校验错误能定位到节点字段', () => {
    const canvas = createDefaultWorkflowCanvas()
    const sshNode = canvas.nodes.find((node) => node.type === 'ssh')!
    const broken = setNodeConfigValue(canvas, sshNode.id, 'credential', '')
    const issues = validateWorkflowCanvas(broken)

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetType: 'field',
        nodeId: sshNode.id,
        field: 'credential',
        severity: 'error',
      }),
    ]))
  })

  it('循环依赖会被阻断校验', () => {
    const canvas = createDefaultWorkflowCanvas()
    const first = canvas.nodes[0]!
    const last = canvas.nodes[canvas.nodes.length - 1]!
    const cyclic = connectNodes(canvas, last.id, first.id)

    expect(validateWorkflowCanvas(cyclic)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'graph-cycle', severity: 'error' }),
    ]))
  })

  it('导入 DSL 后再导出会保留高级字段和 rollback', () => {
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
    const roundtrip = workflowCanvasToDsl(canvas)
    const step = roundtrip.steps[0]

    expect(step?.type).toBe('http')
    expect(step?.type === 'http' ? step.request.headers : undefined).toEqual({ 'X-Trace-Id': 'trace-1' })
    expect(step?.type === 'http' ? step.request.auth : undefined).toEqual({ type: 'bearer', credential: '{{apiCredential}}' })
    expect(step?.type === 'http' ? step.retry : undefined).toEqual({ count: 2, intervalSeconds: 3 })
    expect(step?.type === 'http' ? step.extract : undefined).toEqual([{ name: 'accessToken', type: 'firstOf', paths: ['$.body.token', '$.body.access_token', '$.body.data.token'], sensitive: true }])
    expect(roundtrip.rollback).toEqual(importedDsl.rollback)
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
    const roundtrip = workflowCanvasToDsl(canvas)
    const step = roundtrip.steps[0]

    expect(node?.label).toBe('prepare_validate_staged_certificate_files')
    expect(node?.config.command).toContain("site_conf='{{apacheSiteConfigPath}}'")
    expect(step?.type).toBe('ssh')
    expect(step?.type === 'ssh' ? step.ssh.mode : undefined).toBe('script')
    expect(step?.type === 'ssh' ? step.ssh.connection.hostKeyPolicy : undefined).toBe('manual_approval_required')
    expect(step?.type === 'ssh' ? step.ssh.script : undefined).toContain("site_conf='{{apacheSiteConfigPath}}'")
    expect(step?.type === 'ssh' ? step.extract : undefined).toEqual([{ name: 'ok', type: 'regex', pattern: 'OK' }])
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
    const roundtrip = workflowCanvasToDsl(canvas)

    expect(canvas.nodes.map((node) => node.type)).toEqual(['sftp', 'scp'])
    expect(roundtrip.steps[0]).toEqual(expect.objectContaining({
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
    expect(roundtrip.steps[1]).toEqual(expect.objectContaining({
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
