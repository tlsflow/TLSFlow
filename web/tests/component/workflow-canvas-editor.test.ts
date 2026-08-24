import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { getCredential, listCredentials } from '@/api/modules/credentials.api'
import { compileWorkflowCanvas, testWorkflowTemplateStep, validateWorkflowCanvasOnBackend } from '@/api/modules/workflow-templates.api'
import WorkflowCanvasEditor from '@/views/workflows/WorkflowCanvasEditor.vue'
import { createDefaultWorkflowCanvas } from '@/views/workflows/workflow-canvas.model'

vi.mock('@/api/modules/credentials.api', () => ({
  listCredentials: vi.fn(),
  getCredential: vi.fn(),
}))

vi.mock('@/api/modules/workflow-templates.api', () => ({
  compileWorkflowCanvas: vi.fn(),
  validateWorkflowCanvasOnBackend: vi.fn(),
  testWorkflowTemplateStep: vi.fn(),
}))

describe('WorkflowCanvasEditor', () => {
  beforeEach(() => {
    vi.mocked(compileWorkflowCanvas).mockReset()
    vi.mocked(validateWorkflowCanvasOnBackend).mockReset()
    vi.mocked(testWorkflowTemplateStep).mockReset()
    vi.mocked(listCredentials).mockReset()
    vi.mocked(getCredential).mockReset()
    mockWorkflowCredentialSecrets([])
    mockCompileWorkflowCanvas()
  })

  it('渲染节点库、画布、属性面板、变量面板和校验面板', () => {
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: createDefaultWorkflowCanvas() },
    })

    expect(wrapper.text()).toContain('节点库')
    expect(wrapper.text()).toContain('保存草稿')
    expect(wrapper.text()).toContain('属性面板')
    expect(wrapper.text()).toContain('校验')
    expect(wrapper.find('[aria-label="变量面板"]').exists()).toBe(false)
  })

  it('底部控制面板支持向下折叠并通过 tab 自动展开', async () => {
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: createDefaultWorkflowCanvas() },
    })

    expect(wrapper.find('.workflow-canvas-editor__bottom').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[aria-label="校验面板"]').exists()).toBe(true)

    await wrapper.findAll('button').find((button) => button.text() === '向下折叠')!.trigger('click')

    expect(wrapper.find('.workflow-canvas-editor__bottom').classes()).toContain('workflow-canvas-editor__bottom--collapsed')
    expect(wrapper.find('.workflow-canvas-editor__bottom').attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('[aria-label="校验面板"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('展开面板')

    await wrapper.findAll('.workflow-canvas-editor__tabs button').find((button) => button.text() === '变量')!.trigger('click')

    expect(wrapper.find('.workflow-canvas-editor__bottom').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[aria-label="变量面板"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('向下折叠')
  })

  it('支持添加、复制、粘贴和删除节点', async () => {
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: createDefaultWorkflowCanvas() },
    })

    await wrapper.findAll('.workflow-canvas-editor__palette-item').find((button) => button.text().includes('等待'))!.trigger('click')
    const afterAdd = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    expect(afterAdd.nodes.some((node) => node.type === 'wait')).toBe(true)

    await wrapper.setProps({ modelValue: afterAdd })
    await wrapper.findAll('button').find((button) => button.text() === '复制')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '粘贴')!.trigger('click')
    const afterPaste = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    expect(afterPaste.nodes.length).toBe(afterAdd.nodes.length + 1)

    await wrapper.setProps({ modelValue: afterPaste })
    await wrapper.findAll('button').find((button) => button.text() === '删除')!.trigger('click')
    const afterDelete = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    expect(afterDelete.nodes.length).toBe(afterPaste.nodes.length - 1)
  })

  it('按阶段新增节点并自动生成流程线，保存 DSL 草稿', async () => {
    const onSave = vi.fn()
    const canvas = createDefaultWorkflowCanvas()
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: canvas, onSave },
    })

    await wrapper.find('.workflow-canvas-editor__stage-picker select').setValue('verify')
    await wrapper.findAll('.workflow-canvas-editor__palette-item').find((button) => button.text().includes('等待'))!.trigger('click')

    const afterAdd = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    expect(afterAdd.nodes.at(-1)?.ui?.stage).toBe('verify')
    expect(afterAdd.edges).toHaveLength(afterAdd.nodes.length - 1)

    await wrapper.setProps({ modelValue: afterAdd })
    await wrapper.findAll('button').find((button) => button.text() === '保存草稿')!.trigger('click')

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      canvas: expect.objectContaining({ schemaVersion: 'gcac.workflow.canvas/v1' }),
    }))
  })

  it('HTTP 节点通过 Credential Slot 表达式引用凭据', async () => {
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: createDefaultWorkflowCanvas() },
    })
    const authTypeSelect = wrapper.findAll('.workflow-canvas-editor__properties select').find((item) => item.text().includes('bearer'))!
    await authTypeSelect.setValue('bearer')
    const afterAuthType = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    await wrapper.setProps({ modelValue: afterAuthType })
    const credentialInput = wrapper.findAll('.workflow-canvas-editor__properties input').find((item) => item.attributes('placeholder') === '{{credentials.apiCredential}}')!
    await credentialInput.setValue('{{credentials.sshCredential}}')

    const updated = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    expect(updated.nodes[0]?.config.authCredential).toBe('{{credentials.sshCredential}}')
  })

  it('HTTP 节点支持 Basic 和 API Key 的 Slot 引用表单', async () => {
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: createDefaultWorkflowCanvas() },
    })
    const authTypeSelect = wrapper.findAll('.workflow-canvas-editor__properties select').find((item) => item.text().includes('basic'))!
    await authTypeSelect.setValue('basic')
    let updated = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    await wrapper.setProps({ modelValue: updated })
    let inputs = wrapper.findAll('.workflow-canvas-editor__properties input')
    await inputs.find((item) => item.attributes('placeholder') === '{{credentials.apiCredential}}')!.setValue('{{credentials.sshCredential}}')
    updated = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    await wrapper.setProps({ modelValue: updated })
    inputs = wrapper.findAll('.workflow-canvas-editor__properties input')
    await inputs.find((item) => item.element.previousElementSibling?.textContent?.includes('用户名'))!.setValue('{{connections.targetSsh.username}}')

    updated = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    expect(updated.nodes[0]?.config.authType).toBe('basic')
    expect(updated.nodes[0]?.config.authCredential).toBe('{{credentials.sshCredential}}')
    expect(updated.nodes[0]?.config.authUsername).toBe('{{connections.targetSsh.username}}')

    await wrapper.setProps({ modelValue: updated })
    const nextAuthTypeSelect = wrapper.findAll('.workflow-canvas-editor__properties select').find((item) => item.text().includes('basic'))!
    await nextAuthTypeSelect.setValue('api_key')
    updated = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    updated = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    expect(updated.nodes[0]?.config.authType).toBe('api_key')
  })

  it('支持对当前节点发起单节点模拟运行并展示结果', async () => {
    vi.mocked(testWorkflowTemplateStep).mockResolvedValue({
      data: {
        id: 'wfstep_1',
        mode: 'mock',
        plannedOnly: false,
        renderedStep: { name: 'http_1_HTTP_CURL', type: 'http', preview: { executor: '017.CURL_HTTP' } },
        stepResult: { name: 'http_1_HTTP_CURL', type: 'http', status: 'success', attempts: 1, plan: { executor: '017.CURL_HTTP' }, logs: ['step:http_1_HTTP_CURL:attempt:1:status:success'] },
        logs: ['step:http_1_HTTP_CURL:attempt:1:status:success'],
      },
      requestId: 'req_step_test',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: createDefaultWorkflowCanvas() },
    })

    await wrapper.findAll('button').find((button) => button.text() === '仅模拟当前节点')!.trigger('click')
    await flushPromises()

    expect(testWorkflowTemplateStep).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'mock',
      stepName: expect.stringContaining('http_'),
      content: expect.objectContaining({ apiVersion: 'gcac.workflow/v1' }),
      resolvedInput: expect.objectContaining({
        variables: expect.objectContaining({ verifyUrl: 'https://mock-device.local/health' }),
        connections: expect.objectContaining({ targetSsh: expect.objectContaining({ transport: 'ssh' }) }),
      }),
    }))
    expect(wrapper.text()).toContain('模拟运行完成。')
    expect(wrapper.text()).toContain('http / success / attempts 1')
    expect(wrapper.text()).toContain('017.CURL_HTTP')
  })

  it('单节点模拟运行会优先带入变量默认值和枚举值', async () => {
    vi.mocked(testWorkflowTemplateStep).mockResolvedValue({
      data: {
        id: 'wfstep_2',
        mode: 'mock',
        plannedOnly: false,
        renderedStep: { name: 'http_1_HTTP_CURL', type: 'http' },
        stepResult: { name: 'http_1_HTTP_CURL', type: 'http', status: 'success', attempts: 1, logs: [] },
        logs: [],
      },
      requestId: 'req_step_test_enum',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    const canvas = createDefaultWorkflowCanvas()
    const wrapper = mount(WorkflowCanvasEditor, {
      props: {
        modelValue: {
          ...canvas,
          inputContract: {
            ...canvas.inputContract,
            variables: {
              ...canvas.inputContract.variables,
              targetPlatform: {
                type: 'enum',
                required: true,
                configurationMode: 'advanced',
                source: { kind: 'default' },
                lifecycle: 'pre_execution',
                bindingPolicy: 'default_overridable',
                default: 'linux',
                enum: ['linux'],
              },
            },
          },
        },
      },
    })

    await wrapper.findAll('button').find((button) => button.text() === '仅模拟当前节点')!.trigger('click')
    await flushPromises()

    expect(testWorkflowTemplateStep).toHaveBeenCalledWith(expect.objectContaining({
      resolvedInput: expect.objectContaining({ variables: expect.objectContaining({ targetPlatform: 'linux' }) }),
    }))
  })

  it('支持对当前 SSH 节点发起真实试跑并带入运行时变量和凭据绑定', async () => {
    vi.mocked(testWorkflowTemplateStep).mockResolvedValue({
      data: {
        id: 'wfstep_3',
        mode: 'real_test',
        plannedOnly: false,
        renderedStep: { name: 'ssh_3_SSH_COMMAND', type: 'ssh', preview: { executor: '015.SSH' } },
        stepResult: { name: 'ssh_3_SSH_COMMAND', type: 'ssh', status: 'success', attempts: 1, plan: { executor: '015.SSH' }, logs: ['ssh:mode:real_ssh'] },
        stepOutput: { stdout: 'real ssh ok', stderr: '', exitCode: 0 },
        logs: ['ssh:stdout:real ssh ok'],
      },
      requestId: 'req_step_test_real',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    mockWorkflowCredentialSecrets([
      {
        id: 'sec_real',
        name: 'real ssh',
        kind: 'username_password',
        type: 'password',
        username: 'deploy',
        createdAt: '2026-07-04T00:00:00.000Z',
      },
    ])
    const canvas = createDefaultWorkflowCanvas()
    const modelValue = {
      ...canvas,
      inputContract: {
        ...canvas.inputContract,
        connections: {
          ...canvas.inputContract.connections,
          targetSsh: {
            ...canvas.inputContract.connections.targetSsh!,
            host: { type: 'string' as const, required: true, configurationMode: 'advanced' as const, source: { kind: 'default' as const }, lifecycle: 'pre_execution' as const, bindingPolicy: 'default_overridable' as const, default: 'edge-01.example.com' },
            username: { type: 'string' as const, required: true, configurationMode: 'advanced' as const, source: { kind: 'default' as const }, lifecycle: 'pre_execution' as const, bindingPolicy: 'default_overridable' as const, default: 'deploy' },
          },
        },
      },
    }
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue },
    })
    await flushPromises()

    await wrapper.findAll('.workflow-canvas-editor__node').find((node) => node.attributes('data-node-type') === 'ssh')!.trigger('click')
    await wrapper.findAll('.workflow-canvas-editor__tabs button').find((button) => button.text() === '运行态')!.trigger('click')
    await wrapper.findAll('[aria-label="运行态面板"] select').find((item) => item.text().includes('real ssh'))!.setValue('sec_real')

    await wrapper.findAll('button').find((button) => button.text() === '真实 SSH 执行当前节点')!.trigger('click')
    await flushPromises()

    const payload = vi.mocked(testWorkflowTemplateStep).mock.calls[0]?.[0] as Record<string, any>
    expect(payload.mode).toBe('real_test')
    expect(payload.resolvedInput).toEqual(expect.objectContaining({
      connections: expect.objectContaining({ targetSsh: expect.objectContaining({ host: 'edge-01.example.com', username: 'deploy' }) }),
      credentials: expect.objectContaining({ sshCredential: expect.objectContaining({
        credentialId: 'sec_real',
        kind: 'USERNAME_PASSWORD',
        username: 'deploy',
        secretRefs: { password: 'secret://credential/sec_real/password#current' },
      }) }),
    }))
    expect(payload.secretRefs).toBeUndefined()
    const sshStep = payload.content.steps.find((step: Record<string, any>) => step.type === 'ssh')
    expect(sshStep?.ssh?.connectionRef).toBe('targetSsh')
    expect(wrapper.text()).toContain('真实试跑完成。')
    expect(wrapper.text()).toContain('ssh / success / attempts 1')
    expect(wrapper.text()).toContain('退出码')
    expect(wrapper.text()).toContain('real ssh ok')
  })

  it('真实试跑 SSH 连接失败时展示目标、原因和建议', async () => {
    vi.mocked(testWorkflowTemplateStep).mockResolvedValue({
      data: {
        id: 'wfstep_failed',
        mode: 'real_test',
        plannedOnly: false,
        renderedStep: { name: 'ssh_3_SSH_COMMAND', type: 'ssh', preview: { executor: '015.SSH' } },
        stepResult: {
          name: 'ssh_3_SSH_COMMAND',
          type: 'ssh',
          status: 'failed',
          attempts: 1,
          errorCode: 'SSH_CONNECT_FAILED',
          errorMessage: 'SSH 连接失败',
          plan: { executor: '015.SSH' },
          logs: ['ssh:error:SSH 连接失败', 'ssh:target:10.255.0.127:22'],
        },
        stepOutput: {
          success: false,
          exitCode: 1,
          errorCode: 'SSH_CONNECT_FAILED',
          errorMessage: 'SSH 连接失败',
          body: {
            errorCode: 'SSH_CONNECT_FAILED',
            errorMessage: 'SSH 连接失败',
            detail: {
              stage: 'connect',
              target: '10.255.0.127:22',
              category: 'network',
              cause: 'connect ECONNREFUSED 10.255.0.127:22',
              suggestion: '检查网络、端口、防火墙和 SSH 服务端配置',
            },
          },
        },
        logs: ['ssh:cause:connect ECONNREFUSED 10.255.0.127:22'],
      },
      requestId: 'req_step_test_failed',
      timestamp: '2026-07-03T00:00:00.000Z',
    })
    const canvas = createDefaultWorkflowCanvas()
    const wrapper = mount(WorkflowCanvasEditor, {
      props: {
        modelValue: {
          ...canvas,
          inputContract: {
            ...canvas.inputContract,
            connections: {
              ...canvas.inputContract.connections,
              targetSsh: {
                ...canvas.inputContract.connections.targetSsh!,
                host: { type: 'string', required: true, configurationMode: 'advanced', source: { kind: 'default' }, lifecycle: 'pre_execution', bindingPolicy: 'default_overridable', default: '10.255.0.127' },
              },
            },
          },
        },
      },
    })

    await wrapper.findAll('.workflow-canvas-editor__node').find((node) => node.attributes('data-node-type') === 'ssh')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '真实 SSH 执行当前节点')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('真实试跑失败。')
    expect(wrapper.text()).toContain('ssh / failed / attempts 1')
    expect(wrapper.text()).toContain('SSH 连接失败')
    expect(wrapper.text()).toContain('失败详情')
    expect(wrapper.text()).toContain('SSH_CONNECT_FAILED')
    expect(wrapper.text()).toContain('10.255.0.127:22')
    expect(wrapper.text()).toContain('connect ECONNREFUSED 10.255.0.127:22')
    expect(wrapper.text()).toContain('检查网络、端口、防火墙和 SSH 服务端配置')
  })

  it('变量面板支持新增运行变量配置', async () => {
    const canvas = createDefaultWorkflowCanvas()
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: canvas },
    })

    await wrapper.findAll('.workflow-canvas-editor__tabs button').find((button) => button.text() === '变量')!.trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === '添加变量')!.trigger('click')

    const updated = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    const addedName = Object.keys(updated.inputContract.variables).find((name) => !(name in canvas.inputContract.variables))
    expect(addedName).toMatch(/^variable\d+$/)
    expect(updated.inputContract.variables[addedName!]).toEqual(expect.objectContaining({
      type: 'string',
      required: false,
      source: { kind: 'default' },
    }))
  })

  it('凭据使用独立 Credential Slot 在运行态绑定', async () => {
    mockWorkflowCredentialSecrets([
      {
        id: 'sec-variable-1',
        name: 'workflow login',
        kind: 'username_password',
        type: 'password',
        username: 'root',
        createdAt: '2026-07-04T00:00:00.000Z',
      },
    ])
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: createDefaultWorkflowCanvas() },
    })
    await flushPromises()

    await wrapper.findAll('.workflow-canvas-editor__tabs button').find((button) => button.text() === '运行态')!.trigger('click')
    const credentialSelect = wrapper.findAll('[aria-label=\"运行态面板\"] select').find((item) => item.text().includes('workflow login'))!
    await credentialSelect.setValue('sec-variable-1')

    const canvas = createDefaultWorkflowCanvas()
    expect(canvas.inputContract.variables).not.toHaveProperty('credential')
    expect(canvas.inputContract.credentials).toHaveProperty('sshCredential')
  })

  it('DSL 面板支持导入 JSON 并覆盖当前画布', async () => {
    const wrapper = mount(WorkflowCanvasEditor, {
      props: { modelValue: createDefaultWorkflowCanvas() },
    })

    await wrapper.findAll('.workflow-canvas-editor__tabs button').find((button) => button.text() === 'DSL')!.trigger('click')
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
            url: 'https://{{connections.management.host}}/login',
            timeoutSeconds: 30,
          },
          assert: [{ type: 'statusCode', equals: 200 }],
        },
        {
          name: 'verify_result',
          type: 'http',
          stage: 'verify',
          request: {
            method: 'GET',
            connectionRef: 'management',
            url: '{{variables.verifyUrl}}',
            timeoutSeconds: 20,
          },
          assert: [{ type: 'statusCode', equals: 200 }],
        },
      ],
      rollback: [
        {
          name: 'rollback_manual',
          type: 'manual',
          instruction: '恢复到导入前版本',
        },
      ],
    }

    await wrapper.find('.workflow-canvas-editor__dsl-editor').setValue(JSON.stringify(importedDsl, null, 2))
    await wrapper.findAll('button').find((button) => button.text() === '导入 DSL 覆盖画布')!.trigger('click')

    const updated = wrapper.emitted('update:modelValue')!.at(-1)![0] as ReturnType<typeof createDefaultWorkflowCanvas>
    expect(updated.metadata.name).toBe('imported_workflow')
    expect(updated.nodes).toHaveLength(2)
    expect(updated.nodes.map((node) => node.ui?.stage)).toEqual(['prepare', 'verify'])
    expect(updated.draftState?.importedRollback).toEqual(importedDsl.rollback)
    expect(wrapper.text()).toContain('DSL 已导入并覆盖当前画布')
  })
})

function mockWorkflowCredentialSecrets(items: Array<{
  id: string
  name: string
  kind: 'username_password' | 'ssh_key' | 'curl_bearer' | 'curl_api_key'
  type?: 'ssh_key' | 'password' | 'api_token'
  username?: string
  apiKeyName?: string
  apiKeyIn?: 'header' | 'query'
  createdAt: string
}>) {
  const kindMap = {
    username_password: 'USERNAME_PASSWORD',
    ssh_key: 'SSH_KEY',
    curl_bearer: 'BEARER_TOKEN',
    curl_api_key: 'API_KEY',
  } as const
  vi.mocked(listCredentials).mockResolvedValue({
    data: {
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        kind: kindMap[item.kind],
        scopeType: 'global',
        status: 'active',
        version: 1,
        updatedAt: item.createdAt,
        username: item.username,
      })),
      page: 1,
      pageSize: 200,
      total: items.length,
    },
    requestId: 'req_credentials',
    timestamp: '2026-07-04T00:00:00.000Z',
  })
  vi.mocked(getCredential).mockImplementation(async (id: string) => {
    const item = items.find((candidate) => candidate.id === id)!
    const secretSlot = item.kind === 'username_password'
      ? 'password'
      : item.kind === 'ssh_key'
        ? 'privateKey'
        : item.kind === 'curl_api_key'
          ? 'apiKey'
          : 'token'
    return {
      data: {
        id: item.id,
        name: item.name,
        kind: kindMap[item.kind],
        scopeType: 'global',
        status: 'active',
        version: 1,
        updatedAt: item.createdAt,
        createdAt: item.createdAt,
        username: item.username,
        delivery: item.apiKeyName
          ? { location: item.apiKeyIn ?? 'header', name: item.apiKeyName }
          : undefined,
        secretSlots: { [secretSlot]: `secret://credential/${item.id}/${secretSlot}#current` },
        metadata: {},
      },
      requestId: 'req_credential_detail',
      timestamp: '2026-07-04T00:00:00.000Z',
    }
  })
}

function mockCompileWorkflowCanvas() {
  vi.mocked(compileWorkflowCanvas).mockImplementation(async (payload: Record<string, any>) => {
    const canvas = payload.canvas as ReturnType<typeof createDefaultWorkflowCanvas>
    const stepNames = Object.fromEntries(canvas.nodes.map((node, index) => [node.id, `${node.type}_${index + 1}`]))
    return {
      data: {
        content: {
          apiVersion: 'gcac.workflow/v1',
          kind: 'CurlSshWorkflow',
          metadata: canvas.metadata,
          inputContract: canvas.inputContract,
          steps: canvas.nodes.map((node, index) => node.type === 'ssh'
            ? {
                name: stepNames[node.id],
                type: 'ssh',
                stage: node.ui?.stage,
                ssh: {
                  mode: 'command',
                  connectionRef: String(node.config.connectionRef ?? 'targetSsh'),
                  command: String(node.config.command ?? ''),
                  timeoutSeconds: Number(node.config.timeoutSeconds ?? 60),
                },
              }
            : {
                name: stepNames[node.id],
                type: 'http',
                stage: node.ui?.stage,
                request: {
                  method: 'GET',
                  connectionRef: String(node.config.connectionRef ?? 'management'),
                  url: String(node.config.url ?? node.config.inputRef ?? '{{variables.verifyUrl}}'),
                  timeoutSeconds: Number(node.config.timeoutSeconds ?? 30),
                },
              }),
        },
        stepNames,
        issues: [],
      },
      requestId: 'req_compile',
      timestamp: '2026-07-04T00:00:00.000Z',
    }
  })
  vi.mocked(validateWorkflowCanvasOnBackend).mockResolvedValue({
    data: { issues: [] },
    requestId: 'req_validate',
    timestamp: '2026-07-04T00:00:00.000Z',
  })
}
