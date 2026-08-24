import { describe, expect, it } from 'vitest'
import {
  addNode,
  connectNodes,
  createDefaultWorkflowCanvas,
  getWorkflowDslStepName,
  setNodeConfigValue,
  validateWorkflowCanvas,
  workflowCanvasToDsl,
} from '@/views/workflows/workflow-canvas.model'

describe('workflow canvas model', () => {
  it('默认草稿包含 HTTP、SSH、SFTP 和 VERIFY 节点并能转成 DSL v1', () => {
    const canvas = createDefaultWorkflowCanvas('device-cert-workflow')
    const dsl = workflowCanvasToDsl(canvas)

    expect(canvas.nodes.map((node) => node.type)).toEqual(['http', 'sftp', 'ssh', 'verify'])
    expect(canvas.nodes.map((node) => node.ui?.stage)).toEqual(['prepare', 'install', 'refresh', 'verify'])
    expect(new Set(canvas.nodes.map((node) => node.position.x)).size).toBe(1)
    expect(canvas.nodes.every((node, index, nodes) => index === 0 || node.position.y > nodes[index - 1]!.position.y)).toBe(true)
    expect(dsl.apiVersion).toBe('gcac.workflow/v1')
    expect(dsl.steps).toHaveLength(4)
    expect(dsl.steps.map((step) => step.type)).toEqual(['http', 'ssh', 'ssh', 'http'])
    expect(dsl.steps.map((step) => step.stage)).toEqual(['prepare', 'install', 'refresh', 'verify'])
    expect(JSON.stringify(dsl)).toContain('SFTP_UPLOAD')
  })

  it('默认 HTTP 认证保留 SecretRef，不生成未声明变量引用', () => {
    const canvas = createDefaultWorkflowCanvas()
    const dsl = workflowCanvasToDsl(canvas)
    const firstStep = dsl.steps[0]
    const payload = JSON.stringify(dsl)

    expect(firstStep?.type).toBe('http')
    expect(firstStep?.type === 'http' ? firstStep.request.auth : undefined).toEqual({
      type: 'bearer',
      secretRef: 'secret://workflow/device-api',
    })
    expect(payload).not.toContain('{{secret_workflow_device_api}}')
  })

  it('保存 DSL 不包含明文 Secret', () => {
    const canvas = createDefaultWorkflowCanvas()
    const dsl = workflowCanvasToDsl(canvas)
    const payload = JSON.stringify(dsl)

    expect(payload).toContain('secret://workflow/ssh')
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
    const sshNode = canvas.nodes.find((node) => node.type === 'ssh')!
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
    const broken = setNodeConfigValue(canvas, sshNode.id, 'credentialSecretRef', 'plain-password')
    const issues = validateWorkflowCanvas(broken)

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        targetType: 'field',
        nodeId: sshNode.id,
        field: 'credentialSecretRef',
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
})
