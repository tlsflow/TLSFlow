import { describe, expect, it } from 'vitest'
import {
  filterCertificateDeploymentWorkflows,
  isCertificateDeploymentWorkflow,
  normalizeWorkflowTemplateOrigin,
} from '@/views/workflows/workflow-template-selection'

describe('工作流选择筛选', () => {
  it('只把声明 certificate.deploy 的插件工作流作为证书部署候选', () => {
    const deployment = { id: 'deploy', origin: 'plugin_internal', capabilities: ['certificate.deploy', 'certificate.rollback'] }
    const connectionTest = { id: 'connection-test', origin: 'plugin_internal', capabilities: ['device.connection.test'] }
    const userWorkflow = { id: 'custom', origin: 'user', capabilities: [] }

    expect(isCertificateDeploymentWorkflow(deployment)).toBe(true)
    expect(isCertificateDeploymentWorkflow(connectionTest)).toBe(false)
    expect(isCertificateDeploymentWorkflow(userWorkflow)).toBe(true)
    expect(filterCertificateDeploymentWorkflows([deployment, connectionTest, userWorkflow]).map((item) => item.id)).toEqual(['deploy', 'custom'])
  })

  it('编辑旧资产时保留当前绑定的非部署工作流，避免选择值丢失', () => {
    const connectionTest = { id: 'connection-test', origin: 'plugin_internal', capabilities: ['device.connection.test'] }
    const deployment = { id: 'deploy', origin: 'plugin_internal', capabilities: ['certificate.deploy'] }

    expect(filterCertificateDeploymentWorkflows([connectionTest, deployment], { preserveWorkflowId: 'connection-test' }).map((item) => item.id))
      .toEqual(['connection-test', 'deploy'])
    expect(filterCertificateDeploymentWorkflows([connectionTest, deployment], { preserveWorkflowId: 'missing' }).map((item) => item.id))
      .toEqual(['deploy'])
  })

  it('兼容接口来源的大小写和短横线写法', () => {
    expect(normalizeWorkflowTemplateOrigin('PLUGIN-INTERNAL')).toBe('plugin_internal')
    expect(normalizeWorkflowTemplateOrigin('legacy')).toBe('user')
  })
})
