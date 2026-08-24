<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiClientError } from '@/api/client'
import {
  importCertificate,
  listCertificates,
  listCertificateVersions,
  validateCertificateImport,
} from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'
import {
  GcEmptyState,
  GcModal,
  GcPermissionButton,
} from '@/design-system/components'
import CertificateDetailPanel from './CertificateDetailPanel.vue'
import CertificateImportForm from './CertificateImportForm.vue'
import {
  buildCertificateImportPayload,
  type CertificateImportValidationResult,
  createCertificateImportDraft,
  isMaterialReady,
  resetCertificateImportDraft,
} from './certificate-import.shared'
import { readString, toErrorState, type CertificatePageError } from './certificate-view-utils'

interface CertificateVersionRow {
  readonly id: string
  readonly assetId: string
  readonly certificateName: string
  readonly validity: string
  readonly issuer: string
  readonly subject: string
  readonly status: string
}

const route = useRoute()
const router = useRouter()
const initialQuery = route.query ?? {}
const filters = reactive<Record<string, string>>({
  keyword: typeof initialQuery.keyword === 'string' ? initialQuery.keyword : '',
  primaryDomain: typeof initialQuery.primaryDomain === 'string' ? initialQuery.primaryDomain : '',
  status: typeof initialQuery.status === 'string' ? initialQuery.status : '',
})

const assetsLoading = ref(false)
const versionsLoading = ref(false)
const assetsError = ref<CertificatePageError | null>(null)
const versionsError = ref<CertificatePageError | null>(null)
const assets = ref<ApiRecord[]>([])
const versions = ref<ApiRecord[]>([])
const selectedAssetId = ref('')

const importDialogOpen = ref(false)
const detailDialogOpen = ref(false)
const importLoading = ref(false)
const importValidating = ref(false)
const importError = ref('')
const importResultId = ref('')
const importValidationResult = ref<CertificateImportValidationResult | null>(null)
const detailVersionId = ref('')
const detailAssetId = ref('')
const draft = reactive(createCertificateImportDraft())

const selectedAsset = computed(() => assets.value.find((item) => readId(item) === selectedAssetId.value) ?? null)
const selectedDomainName = computed(() => (selectedAsset.value ? readAssetName(selectedAsset.value) : '未选择域名'))
const assetCount = computed(() => assets.value.length)
const versionRows = computed<CertificateVersionRow[]>(() =>
  versions.value.map((record, index) => {
    const id = readString(record, ['id', 'certificateVersionId'], `certver-${index + 1}`)
    const notBefore = readString(record, ['notBefore'], '未知')
    const notAfter = readString(record, ['notAfter'], '未知')
    return {
      id,
      assetId: readString(record, ['certificateAssetId'], selectedAssetId.value || 'unknown-asset'),
      certificateName: readString(record, ['commonName', 'subject.commonName', 'name'], id),
      validity: `${notBefore} 至 ${notAfter}`,
      issuer: readString(record, ['issuer.commonName', 'issuer.organization', 'issuer.raw'], '未知颁发者'),
      subject: readString(record, ['subject.commonName', 'subject.organization', 'subject.raw'], '未知使用者'),
      status: readString(record, ['status', 'state'], 'MANAGED'),
    }
  }),
)

const hasCertificateMaterial = computed(() => isMaterialReady(draft))

watch(selectedAssetId, async (assetId) => {
  if (!assetId) {
    versions.value = []
    versionsError.value = null
    return
  }
  await loadVersions(assetId)
})

watch(
  () => [
    draft.format,
    draft.importMethod,
    draft.certificatePem,
    draft.pfxBase64,
    draft.pfxPassword,
    draft.privateKeyPem,
    draft.name,
  ],
  () => {
    importValidationResult.value = null
    if (!importLoading.value && !importValidating.value) {
      importError.value = ''
    }
  },
)

onMounted(async () => {
  await loadAssets()
})

function readId(record: ApiRecord) {
  return readString(record, ['id', 'certificateId'], '')
}

function readAssetName(record: ApiRecord) {
  return readString(record, ['primaryDomain', 'name', 'commonName'], '未命名域名')
}

function readAssetSubtitle(record: ApiRecord) {
  return readString(record, ['sourceType', 'currentVersion.notAfter', 'updatedAt'], '暂无补充信息')
}

async function loadAssets() {
  assetsLoading.value = true
  assetsError.value = null
  try {
    const result = await listCertificates({
      page: 1,
      pageSize: 100,
      sort: 'updatedAt:desc',
      keyword: filters.keyword,
      filters: {
        primaryDomain: filters.primaryDomain,
        status: filters.status,
      },
    })
    assets.value = [...(result.data?.items ?? [])]
    const nextSelectedId = assets.value.some((item) => readId(item) === selectedAssetId.value)
      ? selectedAssetId.value
      : readId(assets.value[0] as ApiRecord)
    selectedAssetId.value = nextSelectedId
  } catch (cause) {
    assetsError.value = toErrorState(cause)
    assets.value = []
    selectedAssetId.value = ''
  } finally {
    assetsLoading.value = false
  }
}

async function loadVersions(assetId: string) {
  versionsLoading.value = true
  versionsError.value = null
  try {
    const result = await listCertificateVersions({
      page: 1,
      pageSize: 100,
      sort: 'createdAt:desc',
      filters: {
        certificateAssetId: assetId,
      },
    })
    versions.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    versionsError.value = toErrorState(cause)
    versions.value = []
  } finally {
    versionsLoading.value = false
  }
}

function updateFilters() {
  const query = Object.fromEntries(Object.entries(filters).filter(([, value]) => value))
  void router.replace({ path: '/certificates', query })
  void loadAssets()
}

function clearFilters() {
  filters.keyword = ''
  filters.primaryDomain = ''
  filters.status = ''
  updateFilters()
}

function selectAsset(assetId: string) {
  if (!assetId || assetId === selectedAssetId.value) return
  selectedAssetId.value = assetId
}

function openImportDialog() {
  importError.value = ''
  importResultId.value = ''
  importValidationResult.value = null
  resetCertificateImportDraft(draft)
  importDialogOpen.value = true
}

function closeImportDialog() {
  if (importLoading.value) return
  importDialogOpen.value = false
}

async function submitImport() {
  if (!hasCertificateMaterial.value) {
    importError.value = '必须提供当前格式对应的证书材料。'
    return
  }
  if (!importValidationResult.value?.importable) {
    importError.value = '请先完成第 3 步校验，并确保校验通过后再导入。'
    return
  }
  importLoading.value = true
  importError.value = ''
  importResultId.value = ''
  try {
    const result = await importCertificate(buildCertificateImportPayload(draft))
    importResultId.value = String(result.data?.id ?? result.data?.certificateId ?? result.data?.certificateAssetId ?? '')
    importDialogOpen.value = false
    importValidationResult.value = null
    resetCertificateImportDraft(draft)
    await loadAssets()
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      importError.value = `${cause.message}（${cause.errorCode}）`
      return
    }
    importError.value = cause instanceof Error ? cause.message : '导入失败，请检查输入材料。'
  } finally {
    importLoading.value = false
  }
}

async function validateImportDraft() {
  if (!hasCertificateMaterial.value) {
    importError.value = '必须先完成导入材料填写，才能开始校验。'
    importValidationResult.value = null
    return
  }
  importValidating.value = true
  importError.value = ''
  importValidationResult.value = null
  try {
    const result = await validateCertificateImport(buildCertificateImportPayload(draft))
    importValidationResult.value = result.data as unknown as CertificateImportValidationResult
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      importError.value = `${cause.message}（${cause.errorCode}）`
      return
    }
    importError.value = cause instanceof Error ? cause.message : '校验失败，请检查输入材料。'
  } finally {
    importValidating.value = false
  }
}

function readAssetLifecycleStatus(record: ApiRecord | null) {
  if (!record) return '未知'
  const expiry = readString(record, ['currentVersion.notAfter', 'expiresAt', 'notAfter'], '')
  if (!expiry) return '未知'
  return new Date(expiry).getTime() >= Date.now() ? '有效' : '过期'
}

function readVersionLifecycleStatus(status: string, validity: string) {
  const expiry = validity.split(' 至 ')[1] ?? ''
  if (!expiry) return status === 'EXPIRED' ? '过期' : '有效'
  return new Date(expiry).getTime() >= Date.now() ? '有效' : '过期'
}

function openDetailDialog(row: CertificateVersionRow) {
  detailAssetId.value = row.assetId
  detailVersionId.value = row.id
  detailDialogOpen.value = true
}
</script>

<template>
  <section class="gc-page certificate-page">
    <section class="certificate-page__toolbar">
      <section class="gc-card certificate-page__filters">
        <label class="certificate-page__filter">
          <span class="certificate-page__filter-label">关键字</span>
          <input v-model="filters.keyword" placeholder="域名 / SAN / 指纹" @change="updateFilters" />
        </label>
        <label class="certificate-page__filter">
          <span class="certificate-page__filter-label">域名</span>
          <input v-model="filters.primaryDomain" placeholder="example.com" @change="updateFilters" />
        </label>
        <label class="certificate-page__filter">
          <span class="certificate-page__filter-label">状态</span>
          <select v-model="filters.status" @change="updateFilters">
            <option value="">全部</option>
            <option value="MANAGED">MANAGED</option>
            <option value="EXPIRED">EXPIRED</option>
            <option value="REVOKED">REVOKED</option>
          </select>
        </label>
        <div class="certificate-page__filter-actions">
          <button class="gc-button" type="button" @click="clearFilters">清空筛选</button>
        </div>
      </section>

      <div class="certificate-page__toolbar-actions">
        <GcPermissionButton class="certificate-page__import-button" permission="certificate.import" @click="openImportDialog">
          导入证书
        </GcPermissionButton>
      </div>
    </section>

    <section class="certificate-page__workspace">
      <aside class="certificate-page__assets">
        <header class="certificate-page__panel-header">
          <div>
            <h2>域名列表</h2>
            <p>左侧显示逻辑证书域名列表，名称统一展示为域名。</p>
          </div>
          <span>总数 {{ assetCount }}</span>
        </header>

        <GcEmptyState v-if="assetsError" class="certificate-page__empty-state" title="域名列表加载失败" :description="assetsError.message">
          <p>错误码：{{ assetsError.errorCode }}</p>
          <button class="gc-button" type="button" @click="loadAssets">重试</button>
        </GcEmptyState>

        <div v-else-if="assetsLoading" class="certificate-page__state">加载中...</div>

        <GcEmptyState
          v-else-if="assets.length === 0"
          class="certificate-page__empty-state"
          title="暂无域名列表"
        />

        <div v-else class="certificate-page__asset-list">
          <button
            v-for="asset in assets"
            :key="readId(asset)"
            class="certificate-page__asset-item"
            :class="{ 'certificate-page__asset-item--active': readId(asset) === selectedAssetId }"
            type="button"
            @click="selectAsset(readId(asset))"
          >
            <div class="certificate-page__asset-main">
              <strong>{{ readAssetName(asset) }}</strong>
              <span>{{ readAssetSubtitle(asset) }}</span>
            </div>
            <div class="certificate-page__asset-side">
              <span class="certificate-page__lifecycle">{{ readAssetLifecycleStatus(asset) }}</span>
            </div>
          </button>
        </div>
      </aside>

      <section class="certificate-page__versions">
        <header class="certificate-page__panel-header">
          <div>
            <h2>{{ selectedAsset ? `${selectedDomainName} 的 SSL 证书列表` : 'SSL 证书列表' }}</h2>
            <p>右侧显示当前域名下的 SSL 证书列表，包含证书名称、有效期、颁发者和使用者信息。</p>
          </div>
        </header>

        <div class="certificate-page__versions-body">
          <GcEmptyState v-if="versionsError" class="certificate-page__empty-state" title="SSL 证书列表加载失败" :description="versionsError.message">
            <p>错误码：{{ versionsError.errorCode }}</p>
            <button class="gc-button" type="button" @click="selectedAssetId && loadVersions(selectedAssetId)">重试</button>
          </GcEmptyState>

          <div v-else-if="versionsLoading" class="certificate-page__state">加载中...</div>

          <GcEmptyState
            v-else-if="!selectedAsset"
            class="certificate-page__empty-state"
            title="未选择域名"
            description="请先在左侧选择一个逻辑证书域名。"
          />

          <GcEmptyState
            v-else-if="versionRows.length === 0"
            class="certificate-page__empty-state"
            title="该域名下暂无 SSL 证书"
            description="可以通过筛选栏右侧的导入证书按钮补充该域名的证书版本。"
          />

          <div v-else class="certificate-page__version-list">
            <article v-for="row in versionRows" :key="row.id" class="certificate-page__version-card">
              <header>
                <div>
                  <h3>{{ row.certificateName }}</h3>
                  <p>{{ row.validity }}</p>
                </div>
                <div class="certificate-page__version-badges">
                  <span class="certificate-page__lifecycle">{{ readVersionLifecycleStatus(row.status, row.validity) }}</span>
                </div>
              </header>

              <dl>
                <div>
                  <dt>颁发者</dt>
                  <dd>{{ row.issuer }}</dd>
                </div>
                <div>
                  <dt>使用者</dt>
                  <dd>{{ row.subject }}</dd>
                </div>
                <div>
                  <dt>关联资产</dt>
                  <dd>{{ selectedDomainName }}</dd>
                </div>
                <div>
                  <dt>证书版本 ID</dt>
                  <dd>{{ row.id }}</dd>
                </div>
              </dl>

              <footer>
                <button class="gc-button" type="button" @click="openDetailDialog(row)">详情</button>
              </footer>
            </article>
          </div>
        </div>
      </section>
    </section>

    <GcModal
      v-model:open="detailDialogOpen"
      title="证书详情"
      description="详情标签展示证书字段与格式产物，关联资产标签展示证书使用位置。"
      size="xxl"
    >
      <CertificateDetailPanel :asset-id="detailAssetId" :version-id="detailVersionId" />
    </GcModal>

    <GcModal
      v-model:open="importDialogOpen"
      title="导入证书"
      description="当前仅支持 PEM + KEY 和 PFX；每次导入都必须包含服务器证书、完整中间证书链和私钥。私钥只保存到后端 Secret，不会在响应中回显。"
      size="xxl"
    >
      <CertificateImportForm
        :draft="draft"
        :loading="importLoading"
        :validating="importValidating"
        :error="importError"
        :result-id="importResultId"
        :validation-result="importValidationResult"
        @validate="validateImportDraft"
        @submit="submitImport"
        @cancel="closeImportDialog"
      />
    </GcModal>
  </section>
</template>

<style scoped>
.certificate-page {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.certificate-page__toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: stretch;
}

.certificate-page__filters {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(180px, 220px) auto;
  gap: 8px;
  align-items: center;
  padding: 0;
  border-radius: 16px;
}

.certificate-page__filter {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .01em;
}

.certificate-page__filter-label {
  flex: 0 0 auto;
  white-space: nowrap;
}

.certificate-page__filter input,
.certificate-page__filter select {
  flex: 1;
  width: auto;
  border: 1px solid var(--gc-color-border);
  border-radius: 12px;
  min-height: 32px;
  padding: 6px 10px;
  color: var(--gc-color-text);
  background: rgb(255 255 255 / 76%);
}

.certificate-page__filter-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  min-height: 32px;
}

.certificate-page__toolbar-actions {
  display: flex;
  align-items: stretch;
}

.certificate-page__import-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 100%;
  padding: 0 18px;
  border: 0;
  border-radius: 16px;
  color: #fff;
  background: linear-gradient(180deg, #1783ff, #0a6bff);
  box-shadow: 0 10px 24px rgb(10 107 255 / 22%);
  font-weight: 700;
  white-space: nowrap;
}

.certificate-page__import-button:hover {
  background: linear-gradient(180deg, #2a8eff, #1678ff);
}

.certificate-page__import-button:focus-visible {
  outline: 2px solid rgb(10 107 255 / 28%);
  outline-offset: 2px;
}

.certificate-page__workspace {
  display: grid;
  grid-template-columns: minmax(260px, 320px) minmax(0, 1fr);
  gap: 0;
  align-items: stretch;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.certificate-page__assets,
.certificate-page__versions {
  display: grid;
  gap: 12px;
  min-height: 0;
  overflow: hidden;
  background: transparent;
}

.certificate-page__panel-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 10px;
  padding: 4px 0 10px;
  border-bottom: 1px solid rgb(15 23 42 / 6%);
}

.certificate-page__panel-header h2,
.certificate-page__panel-header p {
  margin: 0;
}

.certificate-page__panel-header h2 {
  color: var(--gc-color-text);
  font-size: 17px;
  font-weight: 650;
  letter-spacing: -0.04em;
}

.certificate-page__panel-header p,
.certificate-page__panel-header span {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  line-height: 1.5;
}

.certificate-page__asset-list,
.certificate-page__version-list {
  display: grid;
  gap: 6px;
  align-content: start;
  min-height: 0;
  overflow: auto;
  padding-right: 6px;
}

.certificate-page__asset-list {
  padding-right: 10px;
}

.certificate-page__asset-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  border: 1px solid transparent;
  border-radius: 12px;
  padding: 10px 11px;
  background: rgb(255 255 255 / 30%);
  text-align: left;
  cursor: pointer;
  transition: border-color .16s ease, background .16s ease, box-shadow .16s ease;
}

.certificate-page__asset-item:hover {
  border-color: rgb(15 23 42 / 8%);
  background: rgb(255 255 255 / 56%);
  box-shadow: 0 4px 14px rgb(15 23 42 / 4%);
}

.certificate-page__asset-item--active {
  border-color: rgb(10 132 255 / 26%);
  box-shadow: inset 0 0 0 1px rgb(10 132 255 / 18%);
  background: linear-gradient(180deg, rgb(255 255 255 / 80%), rgb(242 247 255 / 78%));
}

.certificate-page__asset-main {
  display: grid;
  gap: 4px;
  min-width: 0;
}

.certificate-page__asset-main strong {
  color: var(--gc-color-text);
  font-size: 13px;
  font-weight: 650;
  overflow-wrap: anywhere;
}

.certificate-page__asset-main span {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.certificate-page__asset-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}

.certificate-page__lifecycle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 24px;
  padding: 0 10px;
  border: 1px solid rgb(15 23 42 / 8%);
  border-radius: 999px;
  background: rgb(255 255 255 / 75%);
  color: var(--gc-color-text-muted);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
}

.certificate-page__version-card {
  display: grid;
  gap: 8px;
  border: 1px solid rgb(15 23 42 / 6%);
  border-radius: 14px;
  padding: 12px;
  background: rgb(255 255 255 / 42%);
}

.certificate-page__version-card header {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
}

.certificate-page__version-card h3,
.certificate-page__version-card p {
  margin: 0;
}

.certificate-page__version-card h3 {
  color: var(--gc-color-text);
  font-size: 14px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.certificate-page__version-card p {
  color: var(--gc-color-text-muted);
  margin-top: 3px;
  font-size: 11px;
}

.certificate-page__version-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.certificate-page__version-card dl {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}

.certificate-page__version-card dl div {
  display: grid;
  gap: 3px;
}

.certificate-page__version-card dt {
  color: var(--gc-color-text-muted);
  font-size: 11px;
  font-weight: 650;
}

.certificate-page__version-card dd {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.certificate-page__version-card footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
  border-top: 1px solid rgb(15 23 42 / 6%);
}

.certificate-page__state {
  padding: 24px 12px;
  color: var(--gc-color-text-muted);
  text-align: center;
  font-size: 12px;
  font-weight: 600;
}

.certificate-page__versions-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 0;
  overflow: hidden;
}

.certificate-page__versions {
  min-width: 0;
  grid-template-rows: auto minmax(0, 1fr);
  padding-left: 20px;
}

.certificate-page__assets {
  grid-template-rows: auto minmax(0, 1fr);
  padding-right: 18px;
  border-right: 1px solid rgb(15 23 42 / 8%);
}

.certificate-page__assets > .certificate-page__state,
.certificate-page__assets > .certificate-page__empty-state,
.certificate-page__versions-body > .certificate-page__state,
.certificate-page__versions-body > .certificate-page__empty-state {
  display: grid;
  flex: 1;
  align-content: center;
  justify-items: center;
  overflow: auto;
  min-height: 0;
}

.certificate-page :deep(.certificate-page__empty-state) {
  border: 0;
  border-radius: 0;
  padding: 24px 12px;
  background: transparent;
  box-shadow: none;
  backdrop-filter: none;
}

.certificate-page__versions :deep(.gc-button) {
  width: fit-content;
}

@media (max-width: 1200px) {
  .certificate-page {
    height: auto;
    min-height: 0;
    overflow: visible;
  }

  .certificate-page__toolbar {
    grid-template-columns: 1fr;
  }

  .certificate-page__filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .certificate-page__toolbar-actions {
    justify-content: flex-end;
  }

  .certificate-page__workspace {
    grid-template-columns: 1fr;
    overflow: visible;
  }

  .certificate-page__assets {
    padding-right: 0;
    padding-bottom: 12px;
    border-right: 0;
    border-bottom: 1px solid rgb(15 23 42 / 8%);
  }

  .certificate-page__versions {
    padding-top: 12px;
    padding-left: 0;
  }

  .certificate-page__assets,
  .certificate-page__versions,
  .certificate-page__versions-body,
  .certificate-page__asset-list,
  .certificate-page__version-list {
    min-height: auto;
    overflow: visible;
  }
}

@media (max-width: 900px) {
  .certificate-page__filters,
  .certificate-page__summary,
  .certificate-page__version-card dl {
    grid-template-columns: 1fr;
  }

  .certificate-page__filter-actions {
    justify-content: flex-start;
    flex-wrap: wrap;
  }

  .certificate-page__filter {
    display: grid;
    gap: 4px;
  }

  .certificate-page__filter input,
  .certificate-page__filter select {
    width: 100%;
  }

  .certificate-page__toolbar-actions {
    justify-content: stretch;
  }

  .certificate-page__import-button {
    width: 100%;
    min-height: 44px;
  }

  .certificate-page__panel-header,
  .certificate-page__version-card header {
    flex-direction: column;
  }

  .certificate-page__version-badges {
    justify-content: flex-start;
  }

  .certificate-page__asset-side {
    align-items: flex-start;
  }
}

@media (max-width: 640px) {
  .certificate-page__filters {
    grid-template-columns: 1fr;
  }
}
</style>
