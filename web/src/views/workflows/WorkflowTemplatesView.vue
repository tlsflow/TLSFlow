<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ApiRecord } from '@/api/modules/common'
import {
  createWorkflowTemplate,
  createWorkflowTemplateVersion,
  listWorkflowTemplateVersions,
  listWorkflowTemplates,
  publishWorkflowTemplateVersion,
} from '@/api/modules/workflow-templates.api'
import { GcModal, GcStatusTag } from '@/design-system/components'
import { readString, type ViewRow } from '@/composables/useBusinessPage'
import type { BusinessPageConfig } from '@/views/business-page.types'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'

const pageRef = ref<InstanceType<typeof BusinessResourcePage> | null>(null)
const detailModalOpen = ref(false)
const detailRow = ref<ViewRow | null>(null)
const versionItems = ref<ApiRecord[]>([])
const versionLoading = ref(false)
const versionError = ref('')
const publishLoading = ref(false)
const publishMessage = ref('')
const activeTab = ref<'summary' | 'versions'>('summary')

const config: BusinessPageConfig = {
  title: '工作流模板',
  description: '按模板清单管理 CURL/SSH 工作流版本、发布状态与变更记录。',
  readPermission: 'workflow.template.read',
  primaryPermission: 'workflow.template.write',
  primaryActionLabel: '新建模板',
  primaryAction: async () => {
    await createWorkflowTemplate({
      content: createDefaultTemplate(),
      changeSummary: '前端快速创建模板草稿',
    })
    await pageRef.value?.reload()
  },
  moduleName: 'workflow-templates',
  resourceName: '工作流模板',
  defaultStatus: 'draft',
  defaultRisk: 'MEDIUM',
  showDetailPanel: false,
  showActionPanel: false,
  columns: [
    { key: 'name', title: '模板名称', candidates: ['name'] },
    { key: 'status', title: '状态', candidates: ['status'] },
    { key: 'currentVersionId', title: '当前版本', candidates: ['currentVersionId'] },
    { key: 'updatedAt', title: '更新时间', candidates: ['updatedAt', 'createdAt'], kind: 'date' },
    { key: 'actions', title: '操作', candidates: [] },
  ],
  metrics: [
    { title: '模板总数', description: '已登记的工作流模板。', status: 'READY', risk: 'MEDIUM' },
    { title: '待发布草稿', description: '仍处于 draft 的模板。', status: 'PENDING_APPROVAL', risk: 'MEDIUM' },
  ],
  detailFields: [
    { label: '模板 ID', candidates: ['id'] },
    { label: '模板名称', candidates: ['name'] },
    { label: '当前状态', candidates: ['status'] },
    { label: '当前版本 ID', candidates: ['currentVersionId'] },
    { label: '创建时间', candidates: ['createdAt'] },
    { label: '更新时间', candidates: ['updatedAt'] },
  ],
  emptyTitle: '暂无工作流模板',
  emptyDescription: '先创建模板草稿，再基于版本发布到正式链路。',
  load: () => listWorkflowTemplates({ page: 1, pageSize: 50, sort: 'updatedAt:desc' }),
  actions: [],
  rowActions: [
    {
      label: '详情',
      permission: 'workflow.template.read',
      reloadAfterRun: false,
      run: async (row) => {
        await openDetail(row)
      },
    },
    {
      label: '新增版本',
      permission: 'workflow.template.write',
      reloadAfterRun: true,
      run: async (row) => {
        await createWorkflowTemplateVersion({
          templateId: readString(row.raw, ['id']),
          content: createDefaultTemplate(readString(row.raw, ['name'], 'workflow-template')),
          changeSummary: '前端快速创建新版本草稿',
        })
      },
    },
  ],
}

const publishedVersionLabel = computed(() => {
  const published = versionItems.value.find((item) => readString(item, ['status']) === 'published')
  return published ? `v${readString(published, ['version'])}` : '—'
})

async function openDetail(row: ViewRow) {
  detailRow.value = row
  detailModalOpen.value = true
  activeTab.value = 'summary'
  publishMessage.value = ''
  await loadVersions(row)
}

async function loadVersions(row: ViewRow) {
  versionLoading.value = true
  versionError.value = ''
  try {
    const result = await listWorkflowTemplateVersions(readString(row.raw, ['id']))
    versionItems.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    versionItems.value = []
    versionError.value = cause instanceof Error ? cause.message : '加载模板版本失败'
  } finally {
    versionLoading.value = false
  }
}

async function publishVersion(versionId: string) {
  publishLoading.value = true
  publishMessage.value = ''
  try {
    await publishWorkflowTemplateVersion(versionId)
    publishMessage.value = `版本 ${versionId} 已发布。`
    if (detailRow.value) {
      await loadVersions(detailRow.value)
    }
    await pageRef.value?.reload()
  } catch (cause) {
    publishMessage.value = cause instanceof Error ? cause.message : '发布模板版本失败'
  } finally {
    publishLoading.value = false
  }
}

function createDefaultTemplate(name = 'workflow-template') {
  return {
    apiVersion: 'gcac.workflow/v1',
    kind: 'CurlSshWorkflow',
    metadata: {
      name,
      displayName: `${name} 模板`,
      category: 'deployment',
      tags: ['ssl', 'workflow'],
    },
    variables: {
      domainName: { type: 'string', required: true, description: '目标域名' },
      verifyUrl: { type: 'string', required: false, description: '验证 URL' },
      certificateSecretRef: { type: 'secret', required: true, description: '证书 SecretRef' },
    },
    steps: [
      {
        name: 'verify_target',
        type: 'http',
        request: {
          method: 'GET',
          url: '{{verifyUrl}}',
          timeoutSeconds: 30,
        },
        assert: [{ type: 'statusCode', equals: 200 }],
      },
    ],
    rollback: [
      {
        name: 'manual_rollback',
        type: 'manual',
        instruction: '回滚到上一个稳定证书版本',
      },
    ],
  }
}
</script>

<template>
  <section class="workflow-templates-page">
    <BusinessResourcePage ref="pageRef" :config="config" />

    <GcModal
      v-model:open="detailModalOpen"
      :title="detailRow ? `工作流模板 ${readString(detailRow.raw, ['name'], detailRow.id)}` : '工作流模板详情'"
      description="模板详情与版本清单全部收口到模态框里，主页面只保留紧凑列表。"
      size="xl"
      width="min(1100px, calc(100vw - 32px))"
    >
      <section v-if="detailRow" class="workflow-template-detail">
        <section class="workflow-template-detail__hero">
          <div class="workflow-template-detail__hero-copy">
            <p class="workflow-template-detail__eyebrow">Workflow Template</p>
            <h2>{{ readString(detailRow.raw, ['name'], detailRow.id) }}</h2>
            <span>当前发布版本 {{ publishedVersionLabel }}</span>
          </div>
          <div class="workflow-template-detail__hero-side">
            <GcStatusTag :status="readString(detailRow.raw, ['status'])" />
            <div class="workflow-template-detail__spotlight">
              <small>当前版本 ID</small>
              <strong>{{ readString(detailRow.raw, ['currentVersionId']) }}</strong>
            </div>
          </div>
        </section>

        <div class="workflow-template-detail__tabs">
          <button class="workflow-template-detail__tab" type="button" :data-active="activeTab === 'summary'" @click="activeTab = 'summary'">概览</button>
          <button class="workflow-template-detail__tab" type="button" :data-active="activeTab === 'versions'" @click="activeTab = 'versions'">版本</button>
        </div>

        <section v-if="activeTab === 'summary'" class="workflow-template-detail__section">
          <dl class="workflow-template-detail__facts">
            <div><dt>模板 ID</dt><dd>{{ readString(detailRow.raw, ['id']) }}</dd></div>
            <div><dt>模板名称</dt><dd>{{ readString(detailRow.raw, ['name']) }}</dd></div>
            <div><dt>当前状态</dt><dd>{{ readString(detailRow.raw, ['status']) }}</dd></div>
            <div><dt>当前版本 ID</dt><dd>{{ readString(detailRow.raw, ['currentVersionId']) }}</dd></div>
            <div><dt>创建时间</dt><dd>{{ readString(detailRow.raw, ['createdAt']) }}</dd></div>
            <div><dt>更新时间</dt><dd>{{ readString(detailRow.raw, ['updatedAt']) }}</dd></div>
          </dl>
        </section>

        <section v-else class="workflow-template-detail__section">
          <p v-if="publishMessage" class="workflow-template-detail__message">{{ publishMessage }}</p>
          <p v-if="versionLoading" class="workflow-template-detail__loading">正在加载版本...</p>
          <p v-else-if="versionError" class="workflow-template-detail__error">{{ versionError }}</p>
          <ul v-else-if="versionItems.length" class="workflow-template-detail__list">
            <li v-for="item in versionItems" :key="readString(item, ['id'])" class="workflow-template-detail__list-item">
              <div class="workflow-template-detail__list-head">
                <strong>v{{ readString(item, ['version']) }}</strong>
                <GcStatusTag :status="readString(item, ['status'])" />
              </div>
              <p>{{ readString(item, ['changeSummary'], '没有变更说明。') }}</p>
              <small>{{ readString(item, ['createdAt']) }}</small>
              <button
                v-if="readString(item, ['status']) !== 'published'"
                class="gc-button"
                type="button"
                :disabled="publishLoading"
                @click="publishVersion(readString(item, ['id']))"
              >
                {{ publishLoading ? '发布中...' : '发布版本' }}
              </button>
            </li>
          </ul>
          <p v-else class="workflow-template-detail__loading">暂无版本。</p>
        </section>
      </section>

      <template #actions>
        <button class="gc-button" type="button" @click="detailModalOpen = false">关闭</button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.workflow-templates-page {
  display: grid;
  gap: var(--gc-space-4);
}

.workflow-templates-page :deep(.business-page__row-actions) {
  gap: 6px;
  flex-wrap: wrap;
}

.workflow-template-detail {
  display: grid;
  gap: 12px;
}

.workflow-template-detail__hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 14px;
  padding: 16px 18px;
  border: 1px solid #d9e5f7;
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, rgb(59 130 246 / 12%), transparent 26%),
    linear-gradient(140deg, #f7fbff 0%, #ffffff 54%, #f3f7fc 100%);
}

.workflow-template-detail__hero-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.workflow-template-detail__eyebrow {
  margin: 0;
  color: #5b6f88;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.workflow-template-detail__hero-copy h2 {
  margin: 0;
  color: #0f172a;
  font-size: 24px;
  line-height: 1.06;
  overflow-wrap: anywhere;
}

.workflow-template-detail__hero-copy span {
  color: #64748b;
  font-size: 12px;
  font-weight: 700;
}

.workflow-template-detail__hero-side {
  display: grid;
  align-content: space-between;
  justify-items: end;
  gap: 8px;
  min-width: 150px;
}

.workflow-template-detail__spotlight {
  display: grid;
  gap: 4px;
  min-width: 150px;
  padding: 10px 12px;
  border-radius: 14px;
  background: #0f172a;
  color: #fff;
}

.workflow-template-detail__spotlight small {
  color: rgb(255 255 255 / 68%);
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}

.workflow-template-detail__spotlight strong {
  font-size: 16px;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.workflow-template-detail__tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: fit-content;
  padding: 4px;
  border: 1px solid #dbe6f4;
  border-radius: 999px;
  background: #f8fbff;
}

.workflow-template-detail__tab {
  min-height: 34px;
  padding: 0 14px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #5b6f88;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

.workflow-template-detail__tab[data-active='true'] {
  background: #fff;
  color: #0f172a;
  box-shadow: 0 4px 14px rgb(15 23 42 / 10%);
}

.workflow-template-detail__section {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid #e3ebf5;
  border-radius: 16px;
  background: linear-gradient(180deg, #ffffff, #fbfdff);
}

.workflow-template-detail__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.workflow-template-detail__facts div,
.workflow-template-detail__list-item {
  display: grid;
  gap: 5px;
  padding: 10px 12px;
  border-radius: 12px;
  background: #f8fbff;
  border: 1px solid #e4edf8;
}

.workflow-template-detail__facts dt {
  color: #64748b;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.workflow-template-detail__facts dd {
  margin: 0;
  color: #0f172a;
  font-size: 13px;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.workflow-template-detail__list {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.workflow-template-detail__list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.workflow-template-detail__list-item p,
.workflow-template-detail__list-item small,
.workflow-template-detail__loading,
.workflow-template-detail__message,
.workflow-template-detail__error {
  margin: 0;
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.workflow-template-detail__error {
  color: var(--gc-color-danger);
}

@media (max-width: 900px) {
  .workflow-template-detail__hero {
    display: grid;
    grid-template-columns: 1fr;
  }

  .workflow-template-detail__facts {
    grid-template-columns: 1fr;
  }
}
</style>
