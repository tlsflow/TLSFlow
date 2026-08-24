<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { disablePlugin, listPlugins } from '@/api/modules/plugins.api'
import { GcModal, GcStatusTag } from '@/design-system/components'
import { readString, type ViewRow } from '@/composables/useBusinessPage'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import type { BusinessPageConfig } from '@/views/business-page.types'

const detailModalOpen = ref(false)
const detailRow = ref<ViewRow | null>(null)
const { t } = useI18n()

const config = computed<BusinessPageConfig>(() => ({
  title: t('plugins.title'),
  description: t('plugins.description'),
  readPermission: 'plugin.read',
  primaryPermission: 'plugin.write',
  primaryActionLabel: t('plugins.actions.install'),
  primaryAction: async () => {},
  moduleName: 'plugins',
  resourceName: t('plugins.resourceName'),
  defaultStatus: 'READY',
  defaultRisk: 'HIGH',
  showDetailPanel: false,
  showActionPanel: false,
  columns: [
    { key: 'name', title: t('plugins.columns.name'), candidates: ['name', 'displayName', 'pluginName'] },
    { key: 'status', title: t('plugins.columns.status'), candidates: ['status', 'sandboxStatus', 'state'] },
    { key: 'risk', title: t('plugins.columns.risk'), candidates: ['risk', 'riskLevel', 'permissionRisk'] },
    { key: 'version', title: t('plugins.columns.version'), candidates: ['version', 'currentVersion'] },
    { key: 'signature', title: t('plugins.columns.signature'), candidates: ['signatureStatus', 'signature.status'] }
  ],
  metrics: [
    { title: t('plugins.metrics.total.title'), description: t('plugins.metrics.total.description'), status: 'READY', risk: 'HIGH', kind: 'total' },
    { title: t('plugins.metrics.risky.title'), description: t('plugins.metrics.risky.description'), status: 'ERROR', risk: 'CRITICAL' }
  ],
  emptyTitle: t('plugins.empty.title'),
  emptyDescription: t('plugins.empty.description'),
  load: () => listPlugins({ page: 1, pageSize: 20, sort: 'updatedAt:desc' }),
  rowActions: [
    {
      label: t('plugins.actions.detail'),
      permission: 'plugin.read',
      reloadAfterRun: false,
      run: async (row) => {
        detailRow.value = row
        detailModalOpen.value = true
      },
    },
  ],
  actions: [
    { label: t('plugins.actions.disable'), permission: 'plugin.write', danger: true, confirmText: 'DISABLE', riskText: t('plugins.actions.disableRisk'), requiresSelection: true, run: (row) => disablePlugin(row?.id ?? '', { dryRun: true }) }
  ]
}))
</script>

<template>
  <section class="plugins-page">
    <BusinessResourcePage :config="config" />

    <GcModal
      v-model:open="detailModalOpen"
      :title="detailRow ? t('plugins.detail.titleWithName', { name: readString(detailRow.raw, ['name', 'displayName', 'pluginName'], detailRow.id) }) : t('plugins.detail.title')"
      :description="t('plugins.detail.description')"
      size="lg"
      width="min(980px, calc(100vw - 32px))"
    >
      <section v-if="detailRow" class="plugin-detail">
        <section class="plugin-detail__hero">
          <div class="plugin-detail__hero-copy">
            <p class="plugin-detail__eyebrow">Plugin Package</p>
            <h2>{{ readString(detailRow.raw, ['name', 'displayName', 'pluginName'], detailRow.id) }}</h2>
            <span>{{ t('plugins.detail.versionLabel', { version: readString(detailRow.raw, ['version', 'currentVersion']) }) }}</span>
          </div>
          <div class="plugin-detail__hero-side">
            <GcStatusTag :status="readString(detailRow.raw, ['status', 'sandboxStatus', 'state'])" />
            <div class="plugin-detail__spotlight">
              <small>{{ t('plugins.fields.signatureStatus') }}</small>
              <strong>{{ readString(detailRow.raw, ['signatureStatus', 'signature.status']) }}</strong>
            </div>
          </div>
        </section>

        <section class="plugin-detail__section">
          <dl class="plugin-detail__facts">
            <div><dt>{{ t('plugins.fields.pluginId') }}</dt><dd>{{ readString(detailRow.raw, ['id']) }}</dd></div>
            <div><dt>{{ t('plugins.fields.name') }}</dt><dd>{{ readString(detailRow.raw, ['name', 'displayName', 'pluginName']) }}</dd></div>
            <div><dt>{{ t('plugins.fields.currentStatus') }}</dt><dd>{{ readString(detailRow.raw, ['status', 'sandboxStatus', 'state']) }}</dd></div>
            <div><dt>{{ t('plugins.fields.version') }}</dt><dd>{{ readString(detailRow.raw, ['version', 'currentVersion']) }}</dd></div>
            <div><dt>{{ t('plugins.fields.signatureStatus') }}</dt><dd>{{ readString(detailRow.raw, ['signatureStatus', 'signature.status']) }}</dd></div>
            <div><dt>{{ t('plugins.fields.riskLevel') }}</dt><dd>{{ readString(detailRow.raw, ['risk', 'riskLevel', 'permissionRisk']) }}</dd></div>
          </dl>
        </section>
      </section>

      <template #actions>
        <button class="gc-button" type="button" @click="detailModalOpen = false">{{ t('designSystem.dryRunResult.close') }}</button>
      </template>
    </GcModal>
  </section>
</template>

<style scoped>
.plugins-page {
  display: grid;
  gap: var(--gc-space-4);
}

.plugin-detail {
  display: grid;
  gap: 12px;
}

.plugin-detail__hero {
  display: flex;
  justify-content: space-between;
  align-items: stretch;
  gap: 14px;
  padding: 16px 18px;
  border: 1px solid var(--gc-color-info-border);
  border-radius: 18px;
  background:
    radial-gradient(circle at top right, var(--gc-color-primary-soft), transparent 26%),
    linear-gradient(140deg, var(--gc-color-surface-hover) 0%, var(--gc-color-surface-solid) 54%, var(--gc-color-surface-subtle) 100%);
}

.plugin-detail__hero-copy {
  display: grid;
  gap: 5px;
  min-width: 0;
}

.plugin-detail__eyebrow {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.plugin-detail__hero-copy h2 {
  margin: 0;
  color: var(--gc-color-text);
  font-size: 24px;
  line-height: 1.06;
  overflow-wrap: anywhere;
}

.plugin-detail__hero-copy span {
  color: var(--gc-color-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.plugin-detail__hero-side {
  display: grid;
  align-content: space-between;
  justify-items: end;
  gap: 8px;
  min-width: 150px;
}

.plugin-detail__spotlight {
  display: grid;
  gap: 4px;
  min-width: 150px;
  padding: 10px 12px;
  border-radius: 14px;
  background: var(--gc-color-text);
  color: var(--gc-color-surface-solid);
}

.plugin-detail__spotlight small {
  color: var(--gc-color-text-inverse-muted);
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
}

.plugin-detail__spotlight strong {
  font-size: 16px;
  line-height: 1.15;
  overflow-wrap: anywhere;
}

.plugin-detail__section {
  display: grid;
  gap: 10px;
  padding: 14px 16px;
  border: 1px solid var(--gc-color-border-muted);
  border-radius: 16px;
  background: linear-gradient(180deg, var(--gc-color-surface-solid), var(--gc-color-surface-raised));
}

.plugin-detail__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 0;
}

.plugin-detail__facts div {
  display: grid;
  gap: 5px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--gc-color-surface-hover);
  border: 1px solid var(--gc-color-border-muted);
}

.plugin-detail__facts dt {
  color: var(--gc-color-text-muted);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.plugin-detail__facts dd {
  margin: 0;
  color: var(--gc-color-text);
  font-size: 13px;
  font-weight: 800;
  overflow-wrap: anywhere;
}

@media (max-width: 900px) {
  .plugin-detail__hero {
    display: grid;
    grid-template-columns: 1fr;
  }

  .plugin-detail__facts {
    grid-template-columns: 1fr;
  }
}
</style>
