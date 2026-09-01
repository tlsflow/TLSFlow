import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'src/views/applications/ApplicationsView.vue'), 'utf8')
const assetsViewSource = readFileSync(resolve(process.cwd(), 'src/views/assets/AssetsView.vue'), 'utf8')

describe('应用资产卡片契约', () => {
  it('使用证书卡片的 285px 最小宽度令牌', () => {
    expect(source).toContain('grid-template-columns: repeat(auto-fill, minmax(var(--gc-size-certificate-card-min), 1fr));')
  })

  it('兼容读取资产元数据中的当前证书', () => {
    expect(source).toContain("'metadata.currentCertificate.notAfter'")
    expect(source).toContain("'metadata.currentCertificate.commonName'")
  })

  it('按 CertFlow 卡片布局提供多选和三栏证书事实区', () => {
    expect(source).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));')
    expect(source).toContain('padding: var(--gc-space-1);')
    expect(source).toContain('v-auto-fit-card-fact-text')
    expect(source).toContain("element.style.whiteSpace = 'nowrap'")
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
    expect(source).toContain("'asset-page__card-deploy-button--latest'")
    expect(source).toContain("'asset-page__card-deploy-button--update'")
    expect(source).toContain("'assets.card.actions.upToDate'")
    expect(source).toContain("'assets.card.actions.deployUpdate'")
    expect(source).toContain('border-color: var(--gc-color-success)')
    expect(source).toContain('border-color: var(--gc-color-primary)')
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

  it('证书有效期状态行不参与自动字号调整，避免 ResizeObserver 反馈抖动', () => {
    expect(source).not.toContain('v-auto-fit-card-fact-text class="asset-page__card-fact-value asset-page__card-certificate-status"')
    expect(source).toContain('const cardFactTextObservedWidths = new WeakMap<HTMLElement, number>()')
    expect(source).toContain('entry?.contentRect.width')
    expect(source).toContain('overflow: hidden;')
    expect(source).toContain('text-overflow: ellipsis;')
  })

  it('为多选资产提供删除和同域名证书批量更新入口', () => {
    expect(source).toContain('data-testid="asset-selection-actions"')
    expect(source).toContain("t('assets.selection.actions.bulkDelete')")
    expect(source).toContain("t('assets.selection.actions.bulkUpdateCertificate')")
    expect(source).toContain('const canBatchUpdateCertificates = computed')
    expect(source).toContain('function assetCertificateDomain(asset: ApiRecord)')
    expect(source).toContain('bulkCertificateUpdateAssetIds')
    expect(source).toContain('Promise.allSettled(targetIds.map((assetId) => deleteServiceAsset(assetId)))')
  })

  it('资产部署入口不复用手工草稿，并按资产打开部署上下文', () => {
    expect(source).toContain('reuseDraft: false')
    expect(source).toContain('async function loadApplicationAssetContext(row: ViewRow)')
    expect(source).toContain('openDeploymentDialog(userAssetRow(asset))')
  })

  it('资产证书更新使用单页版本选择并在发起后回到任务列表', () => {
    expect(source).toContain('GcCertificateDeploymentForm')
    expect(source).not.toContain('<GcDeploymentWizard')
    expect(source).toContain('selectionMode: selection.selectionMode')
    expect(source).toContain("type CertificateDeploymentSelection = { certificateAssetId: string; selectionMode: 'EXPLICIT' | 'LATEST_AUTO'; certificateVersionId: string; reapply?: boolean }")
    expect(source).toContain('let certificateAssetId = selection.certificateAssetId')
    expect(source).toContain('targetCertificateVersionId: certificateVersionId')
    expect(source).toContain(':certificate-asset-id="deploymentCertificateAssetId"')
    expect(source).toContain(':certificate-versions="deploymentCertificateVersions"')
    expect(source).toContain("'certificateAssetId',\n    'certificateId'")
    expect(source).toContain("'deploymentStrategy.workflow.target.siteName'")
    expect(source).toContain(':preflight-checks="deploymentDryRunChecks"')
    expect(source).not.toContain('const blockingChecks')
    expect(source).toContain('deploymentDialogOpen.value = false')
    expect(source).toContain("'deploymentPlans.feedback.executeTaskStarted'")
  })

  it('编辑入口先打开模态框，再异步加载轻量详情', () => {
    expect(source).toContain('createDialogOpen.value = true\n  editInitializationLoading.value = true')
    expect(source).toContain("getApplicationEditDetail(editingServiceAssetId.value)")
    expect(source).toContain('v-if="editInitializationLoading"')
    expect(source).toContain('v-else-if="editInitializationError"')
    expect(source).toContain('Promise.all([')
    expect(source).toContain('loadServiceInstances(assetDraft.deviceId)')
    expect(source).toContain('loadManagedTargets(assetDraft.siteAssetId, contextManagedTarget ?? undefined)')
  })

  it('编辑初始化期间 watcher 不重复发起关联投影请求', () => {
    expect(source).toContain('if (editInitializationLoading.value || targetSelectionInitializing.value) return')
    expect(source).toContain('function closeCreateDialog()')
    expect(source).toContain('editInitializationError.value = \'\'')
  })
})

describe('统一资产中心入口契约', () => {
  it('只通过统一资产列表读取，不在页面拼接设备和云服务列表', () => {
    expect(assetsViewSource).toContain('listAssets(')
    expect(assetsViewSource).not.toContain('listCloudServiceAssets(')
    expect(assetsViewSource).not.toContain('listDevices(')
    expect(assetsViewSource).not.toContain('listServiceAssets(')
  })
})
