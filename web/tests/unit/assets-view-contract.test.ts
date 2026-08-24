import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/views/assets/AssetsView.vue'), 'utf8')

describe('应用资产卡片契约', () => {
  it('使用证书卡片的 285px 最小宽度令牌', () => {
    expect(source).toContain('grid-template-columns: repeat(auto-fill, minmax(var(--gc-size-certificate-card-min), 1fr));')
  })

  it('兼容读取资产元数据中的当前证书', () => {
    expect(source).toContain("'metadata.currentCertificate.notAfter'")
    expect(source).toContain("'metadata.currentCertificate.commonName'")
  })

  it('按 CertFlow 卡片布局提供多选和双栏证书事实区', () => {
    expect(source).toContain('class="asset-page__card-certificate-remaining"')
    expect(source).toContain('class="asset-page__card-certificate-state"')
    expect(source).toContain("value === true")
    expect(source).toContain("return 'updateAvailable'")
    expect(source).toContain('class="asset-page__card-select"')
    expect(source).toContain('class="asset-page__card-url"')
    expect(source).toContain('function assetCardUrl(asset: ApiRecord)')
    expect(source).toContain('width: var(--gc-size-icon-sm)')
    expect(source).not.toContain('class="asset-page__card-select-control"')
    expect(source).toContain('v-if="selectedAssetCount > 0"')
    expect(source).toContain("function assetCertificateNeedsUpdate(certificate: AssetCardCertificate): boolean")
    expect(source).toContain("certificate.lifecycle === 'updateAvailable' || certificate.lifecycle === 'expired'")
    expect(source).toContain("'asset-page__card-deploy-button--update'")
    expect(source).toContain("'assets.actions.updateCertificate'")
    expect(source).toContain('trigger-variant="icon"')
    expect(source).toContain('class="asset-page__card-icon-action"')
    expect(source).toContain('height: var(--gc-control-height-card-action)')
    expect(source).toContain('width: var(--gc-control-height-card-action)')
    expect(source).toContain('display: none')
    expect(source).toContain(':selected="isAssetSelected(card.id)"')
    expect(source).not.toContain('<p>{{ card.address }}</p>')
    expect(source).not.toContain('asset-page__card-lifecycle')
    expect(source).not.toContain('asset-page__card-meta')
    expect(source).not.toContain('assetCertificateLifecycleProgress')
  })

  it('资产部署入口不复用手工草稿，并按资产打开部署上下文', () => {
    expect(source).toContain('reuseDraft: false')
    expect(source).toContain('async function loadAssetContext(row: ViewRow)')
    expect(source).toContain('openDeploymentDialog(userAssetRow(asset))')
  })

  it('资产证书更新使用单页版本选择并在发起后回到任务列表', () => {
    expect(source).toContain('GcCertificateDeploymentForm')
    expect(source).not.toContain('<GcDeploymentWizard')
    expect(source).toContain('selectionMode: selection.selectionMode')
    expect(source).toContain("selection: { selectionMode: 'EXPLICIT' | 'LATEST_AUTO'; certificateVersionId: string }")
    expect(source).toContain('targetCertificateVersionId: selection.certificateVersionId')
    expect(source).toContain("'certificateAssetId',\n    'certificateId'")
    expect(source).toContain("'deploymentStrategy.workflow.target.siteName'")
    expect(source).toContain(':preflight-checks="deploymentDryRunChecks"')
    expect(source).not.toContain('const blockingChecks')
    expect(source).toContain('deploymentDialogOpen.value = false')
    expect(source).toContain("'deploymentPlans.feedback.executeTaskPendingApproval'")
    expect(source).toContain("'deploymentPlans.feedback.executeTaskStarted'")
  })
})
