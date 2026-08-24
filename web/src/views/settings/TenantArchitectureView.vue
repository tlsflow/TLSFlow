<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  createTenant,
  createTenantMembership,
  getTenantArchitecture,
  getTenantModeSummary,
  rollbackTenantMode,
  revokeTenantMembership,
  runTenantModePreflight,
  enableTenantMode,
  updateTenantStatus,
  type TenantArchitectureNode,
  type TenantModeSummaryResponse,
} from '@/api/modules/security.api'
import { usePermissionStore } from '@/stores/permission.store'
import { useTenantStore } from '@/stores/tenant.store'

const { t } = useI18n()
const permissionStore = usePermissionStore()
const tenantStore = useTenantStore()
const summary = ref<TenantModeSummaryResponse | null>(null)
const roots = ref<readonly TenantArchitectureNode[]>([])
const loading = ref(false)
const action = ref<'preflight' | 'enable' | 'rollback' | 'create' | 'membership' | 'revoke' | 'status' | null>(null)
const errorMessage = ref('')
const successMessage = ref('')
interface PreflightItem {
  readonly id: string
  readonly title: string
  readonly message: string
  readonly status: 'passed' | 'warning' | 'blocked'
}

interface PreflightResult {
  readonly batchId: string
  readonly blockers: number
  readonly items: readonly PreflightItem[]
}

const preflight = ref<PreflightResult | null>(null)
const companyForm = ref({ name: '', code: '', parentId: '' })
const administratorForm = ref({ tenantId: '', subjectId: '' })

const canManageMode = computed(() => permissionStore.hasPermission('tenant.mode.manage', { explicitOnly: true }))
const canManageTenants = computed(() => permissionStore.hasPermission('tenant.manage', { explicitOnly: true }))
const hierarchical = computed(() => summary.value?.state.mode === 'hierarchical')
const modeTransitioning = computed(() => summary.value?.state.lifecycleState === 'MIGRATING' || summary.value?.state.lifecycleState === 'ROLLING_BACK')
const recentBatches = computed(() => [
  summary.value?.lastPreflightBatch,
  summary.value?.lastEnableBatch,
  summary.value?.lastRollbackBatch,
].filter((item): item is Record<string, unknown> => Boolean(item)))
const passedPreflightItems = computed(() => preflight.value?.items.filter((item) => item.status === 'passed') ?? [])
const attentionPreflightItems = computed(() => preflight.value?.items.filter((item) => item.status !== 'passed') ?? [])
const selectedParentId = computed(() => companyForm.value.parentId || roots.value.find((node) => node.type === 'GROUP')?.id || tenantStore.currentTenantId)

function localTime(value?: unknown): string {
  if (typeof value !== 'string' || !value) return t('common.notAvailable')
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? t('common.notAvailable') : parsed.toLocaleString()
}

function batchKind(batch: Record<string, unknown>): string {
  return typeof batch.kind === 'string' ? batch.kind : 'PREFLIGHT'
}

function batchStatus(batch: Record<string, unknown>): string {
  return typeof batch.status === 'string' ? batch.status : 'FAILED'
}

function batchTone(batch: Record<string, unknown>): 'success' | 'warning' | 'danger' {
  const status = batchStatus(batch)
  if (status === 'FAILED') return 'danger'
  return status === 'RUNNING' ? 'warning' : 'success'
}

function batchTime(batch: Record<string, unknown>): string {
  return localTime(batch.finishedAt ?? batch.startedAt)
}

async function loadPage(): Promise<void> {
  loading.value = true
  errorMessage.value = ''
  try {
    const modeResult = await getTenantModeSummary()
    if (!modeResult.data) throw new Error(t('tenantArchitecture.errors.emptyMode'))
    summary.value = modeResult.data
    tenantStore.mode = modeResult.data.state.mode
    if (modeResult.data.state.mode === 'hierarchical' && canManageTenants.value) {
      const architectureResult = await getTenantArchitecture()
      roots.value = architectureResult.data?.roots ?? []
      if (architectureResult.data?.contextVersion) tenantStore.contextVersion = architectureResult.data.contextVersion
    } else {
      roots.value = []
    }
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : t('tenantArchitecture.errors.loadFailed')
  } finally {
    loading.value = false
  }
}

async function preflightMode(): Promise<void> {
  action.value = 'preflight'
  errorMessage.value = ''
  successMessage.value = ''
  try {
    const result = await runTenantModePreflight({ confirmation: 'tenant-architecture-preflight' })
    const body = result.data as { batch?: { id?: string }; report?: { blockers?: number; items?: readonly PreflightItem[] } } | undefined
    preflight.value = {
      batchId: String(body?.batch?.id ?? ''),
      blockers: Number(body?.report?.blockers ?? 0),
      items: body?.report?.items ?? [],
    }
    await loadPage()
    if (preflight.value.blockers > 0) errorMessage.value = t('tenantArchitecture.preflight.blocked.description')
    else successMessage.value = t('tenantArchitecture.messages.preflightCompleted')
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : t('tenantArchitecture.errors.preflightFailed')
  } finally {
    action.value = null
  }
}

async function enableMode(): Promise<void> {
  if (!preflight.value?.batchId || preflight.value.blockers > 0) return
  if (!window.confirm(t('tenantArchitecture.confirm.enable'))) return
  action.value = 'enable'
  errorMessage.value = ''
  try {
    await enableTenantMode({ preflightBatchId: preflight.value.batchId, confirmation: 'tenant-architecture-enable' })
    successMessage.value = t('tenantArchitecture.messages.enabled')
    preflight.value = null
    await loadPage()
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : t('tenantArchitecture.errors.enableFailed')
  } finally {
    action.value = null
  }
}

async function rollbackMode(): Promise<void> {
  if (!window.confirm(t('tenantArchitecture.confirm.rollback'))) return
  action.value = 'rollback'
  errorMessage.value = ''
  try {
    await rollbackTenantMode({ confirmation: 'tenant-architecture-rollback' })
    successMessage.value = t('tenantArchitecture.messages.rolledBack')
    await loadPage()
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : t('tenantArchitecture.errors.rollbackFailed')
  } finally {
    action.value = null
  }
}

async function submitCompany(): Promise<void> {
  const name = companyForm.value.name.trim()
  const code = companyForm.value.code.trim()
  if (!name || !code) return
  action.value = 'create'
  errorMessage.value = ''
  try {
    await createTenant({ name, code, type: 'COMPANY', parentId: selectedParentId.value })
    companyForm.value = { name: '', code: '', parentId: selectedParentId.value }
    successMessage.value = t('tenantArchitecture.messages.companyCreated')
    await loadPage()
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : t('tenantArchitecture.errors.companyCreateFailed')
  } finally {
    action.value = null
  }
}

async function submitAdministrator(): Promise<void> {
  const tenantId = administratorForm.value.tenantId
  const subjectId = administratorForm.value.subjectId.trim()
  if (!tenantId || !subjectId) return
  action.value = 'membership'
  errorMessage.value = ''
  try {
    await createTenantMembership({ tenantId, subjectType: 'user', subjectId, membershipType: 'admin' })
    administratorForm.value.subjectId = ''
    successMessage.value = t('tenantArchitecture.messages.administratorAdded')
    await loadPage()
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : t('tenantArchitecture.errors.administratorFailed')
  } finally {
    action.value = null
  }
}

async function revokeAdministrator(membershipId: string): Promise<void> {
  if (!window.confirm(t('tenantArchitecture.confirm.revokeAdministrator'))) return
  action.value = 'revoke'
  errorMessage.value = ''
  try {
    await revokeTenantMembership(membershipId)
    successMessage.value = t('tenantArchitecture.messages.administratorRevoked')
    await loadPage()
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : t('tenantArchitecture.errors.administratorRevokeFailed')
  } finally {
    action.value = null
  }
}

async function toggleCompany(node: TenantArchitectureNode): Promise<void> {
  action.value = 'status'
  errorMessage.value = ''
  try {
    await updateTenantStatus({ tenantId: node.id, status: node.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' })
    successMessage.value = t('tenantArchitecture.messages.statusUpdated')
    await loadPage()
  } catch (cause) {
    errorMessage.value = cause instanceof Error ? cause.message : t('tenantArchitecture.errors.statusFailed')
  } finally {
    action.value = null
  }
}

function isBusy(kind?: typeof action.value): boolean {
  return Boolean(action.value && (!kind || action.value === kind))
}

onMounted(() => { void loadPage() })
</script>

<template>
  <section class="gc-page tenant-architecture-page">
    <header class="tenant-architecture-page__header">
      <div>
        <span class="tenant-architecture-page__eyebrow">{{ t('tenantArchitecture.eyebrow') }}</span>
        <h2>{{ t('tenantArchitecture.title') }}</h2>
        <p>{{ t('tenantArchitecture.description') }}</p>
      </div>
      <button class="gc-button" type="button" :disabled="loading" @click="loadPage">{{ t('common.refresh') }}</button>
    </header>

    <p v-if="errorMessage" class="gc-form-error" role="alert">{{ errorMessage }}</p>
    <p v-if="successMessage" class="gc-form-success" role="status">{{ successMessage }}</p>
    <div v-if="loading" class="gc-card tenant-architecture-page__state">{{ t('common.loading') }}</div>

    <template v-else-if="summary">
      <section class="gc-card tenant-architecture-page__mode" :aria-label="t('tenantArchitecture.mode.aria')">
        <div>
          <strong>{{ t('tenantArchitecture.mode.label') }}</strong>
          <span>{{ hierarchical ? t('tenantArchitecture.mode.hierarchical') : t('tenantArchitecture.mode.single') }}</span>
          <small>{{ t('tenantArchitecture.mode.updated', { time: localTime(summary.state.updatedAt) }) }}</small>
        </div>
        <div v-if="canManageMode" class="tenant-architecture-page__mode-actions">
          <button v-if="!hierarchical" class="gc-button gc-button--primary" type="button" :disabled="isBusy() || modeTransitioning" @click="preflightMode">{{ isBusy('preflight') ? t('tenantArchitecture.actions.checking') : t('tenantArchitecture.actions.preflight') }}</button>
          <button v-if="!hierarchical" class="gc-button" type="button" :disabled="isBusy() || modeTransitioning || !preflight || preflight.blockers > 0" @click="enableMode">{{ isBusy('enable') ? t('tenantArchitecture.actions.enabling') : t('tenantArchitecture.actions.enable') }}</button>
          <button v-if="hierarchical" class="gc-button gc-button--danger" type="button" :disabled="isBusy() || modeTransitioning" @click="rollbackMode">{{ isBusy('rollback') ? t('tenantArchitecture.actions.rollingBack') : t('tenantArchitecture.actions.rollback') }}</button>
        </div>
      </section>

      <section v-if="preflight" :class="['gc-card', 'tenant-architecture-page__preflight', preflight.blockers > 0 ? 'tenant-architecture-page__preflight--blocked' : 'tenant-architecture-page__preflight--passed']" :aria-label="t('tenantArchitecture.preflight.title')">
        <header class="tenant-architecture-page__preflight-header">
          <div>
            <span class="tenant-architecture-page__preflight-eyebrow">{{ preflight.blockers > 0 ? t('tenantArchitecture.preflight.blocked.title') : t('tenantArchitecture.preflight.passed.title') }}</span>
            <h3>{{ t('tenantArchitecture.preflight.title') }}</h3>
          </div>
          <span :class="preflight.blockers > 0 ? 'tenant-architecture-page__status tenant-architecture-page__status--danger' : 'tenant-architecture-page__status tenant-architecture-page__status--success'">{{ t('tenantArchitecture.preflight.summary', { blockers: preflight.blockers }) }}</span>
        </header>
        <div class="tenant-architecture-page__preflight-results">
          <section v-if="passedPreflightItems.length" class="tenant-architecture-page__preflight-result tenant-architecture-page__preflight-result--passed">
            <header><div><strong>{{ t('tenantArchitecture.preflight.passed.title') }}</strong><span>{{ t('tenantArchitecture.preflight.passed.summary', { count: passedPreflightItems.length }) }}</span></div></header>
            <ul><li v-for="item in passedPreflightItems" :key="item.id"><span class="tenant-architecture-page__preflight-marker tenant-architecture-page__preflight-marker--passed" role="img" :aria-label="t('tenantArchitecture.preflight.passed.title')">✅</span><div><strong>{{ item.title }}</strong><p>{{ item.message }}</p></div></li></ul>
          </section>
          <section v-if="attentionPreflightItems.length" class="tenant-architecture-page__preflight-result tenant-architecture-page__preflight-result--blocked">
            <header><div><strong>{{ t('tenantArchitecture.preflight.blocked.title') }}</strong><span>{{ t('tenantArchitecture.preflight.blocked.summary', { count: attentionPreflightItems.length }) }}</span></div></header>
            <p class="tenant-architecture-page__preflight-description">{{ t('tenantArchitecture.preflight.blocked.description') }}</p>
            <ul><li v-for="item in attentionPreflightItems" :key="item.id"><span class="tenant-architecture-page__preflight-marker tenant-architecture-page__preflight-marker--blocked" role="img" :aria-label="t('tenantArchitecture.preflight.blocked.title')">❌</span><div><strong>{{ item.title }}</strong><p>{{ item.message }}</p></div></li></ul>
          </section>
        </div>
      </section>

      <section v-if="recentBatches.length" class="gc-card tenant-architecture-page__history" :aria-label="t('tenantArchitecture.history.aria')">
        <strong>{{ t('tenantArchitecture.history.title') }}</strong>
        <ul><li v-for="batch in recentBatches" :key="String(batch.id)"><span>{{ t(`tenantArchitecture.history.kind.${batchKind(batch)}`) }}</span><span :class="['tenant-architecture-page__status', `tenant-architecture-page__status--${batchTone(batch)}`]">{{ t(`tenantArchitecture.history.status.${batchStatus(batch)}`) }}</span><time>{{ batchTime(batch) }}</time></li></ul>
      </section>

      <template v-if="hierarchical && canManageTenants">
        <section class="tenant-architecture-page__forms">
          <form class="gc-card tenant-architecture-page__form" @submit.prevent="submitCompany">
            <h3>{{ t('tenantArchitecture.company.title') }}</h3>
            <label><span>{{ t('tenantArchitecture.company.name') }}</span><input v-model="companyForm.name" required :placeholder="t('tenantArchitecture.company.namePlaceholder')"></label>
            <label><span>{{ t('tenantArchitecture.company.code') }}</span><input v-model="companyForm.code" required :placeholder="t('tenantArchitecture.company.codePlaceholder')"></label>
            <button class="gc-button gc-button--primary" type="submit" :disabled="isBusy()">{{ isBusy('create') ? t('common.saving') : t('tenantArchitecture.company.submit') }}</button>
          </form>
          <form class="gc-card tenant-architecture-page__form" @submit.prevent="submitAdministrator">
            <h3>{{ t('tenantArchitecture.administrator.title') }}</h3>
            <label><span>{{ t('tenantArchitecture.administrator.tenant') }}</span><select v-model="administratorForm.tenantId" required><option value="" disabled>{{ t('tenantArchitecture.administrator.tenantPlaceholder') }}</option><template v-for="root in roots" :key="root.id"><option v-for="child in root.children" :key="child.id" :value="child.id">{{ child.name }} ({{ child.code }})</option></template></select></label>
            <label><span>{{ t('tenantArchitecture.administrator.subjectId') }}</span><input v-model="administratorForm.subjectId" required :placeholder="t('tenantArchitecture.administrator.subjectPlaceholder')"></label>
            <button class="gc-button gc-button--primary" type="submit" :disabled="isBusy()">{{ isBusy('membership') ? t('common.saving') : t('tenantArchitecture.administrator.submit') }}</button>
          </form>
        </section>

        <section class="tenant-architecture-page__tree" :aria-label="t('tenantArchitecture.tree.aria')">
          <article v-for="root in roots" :key="root.id" class="gc-card tenant-architecture-page__node">
            <header><div><strong>{{ root.name }}</strong><small>{{ root.code }} · {{ t(`tenantArchitecture.types.${root.type}`) }} · {{ t(`tenantArchitecture.status.${root.status}`) }}<template v-if="root.current"> · {{ t('tenantSwitcher.current') }}</template></small></div><span class="gc-status gc-status--success">{{ t(`tenantArchitecture.status.${root.status}`) }}</span></header>
            <ul class="tenant-architecture-page__admins"><li v-for="administrator in root.administrators" :key="administrator.membershipId">{{ administrator.displayName }} · {{ t(`tenantArchitecture.membership.${administrator.membershipType}`) }}</li></ul>
            <div class="tenant-architecture-page__children"><article v-for="child in root.children" :key="child.id" class="tenant-architecture-page__child"><header><div><strong>{{ child.name }}</strong><small>{{ child.code }} · {{ t(`tenantArchitecture.types.${child.type}`) }} · {{ t(`tenantArchitecture.status.${child.status}`) }}<template v-if="child.current"> · {{ t('tenantSwitcher.current') }}</template></small></div><button class="gc-button" type="button" :disabled="isBusy()" @click="toggleCompany(child)">{{ child.status === 'ACTIVE' ? t('tenantArchitecture.actions.suspend') : t('tenantArchitecture.actions.resume') }}</button></header><ul class="tenant-architecture-page__admins"><li v-for="administrator in child.administrators" :key="administrator.membershipId"><span>{{ administrator.displayName }} · {{ t(`tenantArchitecture.membership.${administrator.membershipType}`) }}</span><button class="gc-button tenant-architecture-page__revoke" type="button" :disabled="isBusy()" @click="revokeAdministrator(administrator.membershipId)">{{ t('tenantArchitecture.actions.revokeAdministrator') }}</button></li><li v-if="child.administrators.length === 0">{{ t('tenantArchitecture.administrator.empty') }}</li></ul></article></div>
          </article>
          <div v-if="roots.length === 0" class="gc-card tenant-architecture-page__state">{{ t('tenantArchitecture.tree.empty') }}</div>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.tenant-architecture-page { display: grid; gap: var(--gc-space-5); }
.tenant-architecture-page__header, .tenant-architecture-page__mode, .tenant-architecture-page__mode-actions, .tenant-architecture-page__forms, .tenant-architecture-page__tree, .tenant-architecture-page__node header, .tenant-architecture-page__child header { display: flex; gap: var(--gc-space-4); align-items: center; justify-content: space-between; }
.tenant-architecture-page__header h2, .tenant-architecture-page__header p, .tenant-architecture-page__mode strong, .tenant-architecture-page__mode span, .tenant-architecture-page__mode small, .tenant-architecture-page__form h3, .tenant-architecture-page__preflight h3, .tenant-architecture-page__preflight p { margin: 0; }
.tenant-architecture-page__header p, .tenant-architecture-page__mode small, .tenant-architecture-page__node small, .tenant-architecture-page__child small { display: block; color: var(--gc-color-text-muted); }
.tenant-architecture-page__eyebrow { color: var(--gc-color-primary); font-size: var(--gc-font-size-sm); font-weight: var(--gc-font-weight-semibold); }
.tenant-architecture-page__mode { padding: var(--gc-space-5); }
.tenant-architecture-page__mode > div:first-child { display: grid; gap: var(--gc-space-2); }
.tenant-architecture-page__mode-actions { justify-content: flex-end; flex-wrap: wrap; }
.tenant-architecture-page__preflight { display: grid; gap: var(--gc-space-5); padding: var(--gc-space-5); border-color: var(--gc-color-border); }
.tenant-architecture-page__preflight--passed { border-color: var(--gc-color-success-border); background: var(--gc-color-success-soft); }
.tenant-architecture-page__preflight--blocked { border-color: var(--gc-color-danger-border); background: var(--gc-color-danger-soft); }
.tenant-architecture-page__preflight-header, .tenant-architecture-page__preflight-result header { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); }
.tenant-architecture-page__preflight-header > div { display: grid; gap: var(--gc-space-1); }
.tenant-architecture-page__preflight-eyebrow { font-size: var(--gc-font-size-label); font-weight: var(--gc-font-weight-semibold); }
.tenant-architecture-page__preflight--passed .tenant-architecture-page__preflight-eyebrow { color: var(--gc-color-success); }
.tenant-architecture-page__preflight--blocked .tenant-architecture-page__preflight-eyebrow { color: var(--gc-color-danger); }
.tenant-architecture-page__preflight-results { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); gap: var(--gc-space-4); }
.tenant-architecture-page__preflight-result { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-4); border-left: var(--gc-border-width-thin) solid var(--gc-color-border); background: var(--gc-color-surface); }
.tenant-architecture-page__preflight-result--passed { border-color: var(--gc-color-success); background: var(--gc-color-success-bg); }
.tenant-architecture-page__preflight-result--blocked { border-color: var(--gc-color-danger); background: var(--gc-color-danger-bg); }
.tenant-architecture-page__preflight-result header div { display: grid; gap: var(--gc-space-1); }
.tenant-architecture-page__preflight-result--passed header span { color: var(--gc-color-success); }
.tenant-architecture-page__preflight-result--blocked header span, .tenant-architecture-page__preflight-description { color: var(--gc-color-danger); }
.tenant-architecture-page__preflight-result--passed li { color: var(--gc-color-text); }
.tenant-architecture-page__preflight-result--blocked li { color: var(--gc-color-text); }
.tenant-architecture-page__preflight-result ul { display: grid; gap: var(--gc-space-3); margin: 0; padding: 0; list-style: none; }
.tenant-architecture-page__preflight-result li { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--gc-space-2); align-items: start; color: var(--gc-color-text-muted); }
.tenant-architecture-page__preflight-result li div { display: grid; gap: var(--gc-space-1); }
.tenant-architecture-page__preflight-marker { display: inline-grid; width: var(--gc-size-icon-md); height: var(--gc-size-icon-md); margin-top: var(--gc-space-compact); place-items: center; font-size: var(--gc-font-size-md); line-height: var(--gc-line-height-tight); }
.tenant-architecture-page__preflight-marker--passed { color: var(--gc-color-success); }
.tenant-architecture-page__preflight-marker--blocked { color: var(--gc-color-danger); }
.tenant-architecture-page__admins { margin: 0; padding-left: var(--gc-space-5); color: var(--gc-color-text-muted); }
.tenant-architecture-page__history { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-5); }
.tenant-architecture-page__history ul { display: grid; gap: var(--gc-space-2); margin: 0; padding: 0; list-style: none; }
.tenant-architecture-page__history li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: var(--gc-space-3); align-items: center; color: var(--gc-color-text-muted); }
.tenant-architecture-page__status { display: inline-flex; align-items: center; min-height: var(--gc-control-height-sm); padding: 0 var(--gc-space-3); border: var(--gc-border-width-thin) solid transparent; border-radius: var(--gc-radius-full); font-size: var(--gc-font-size-label); font-weight: var(--gc-font-weight-semibold); white-space: nowrap; }
.tenant-architecture-page__status--success { color: var(--gc-color-success); border-color: var(--gc-color-success-border); background: var(--gc-color-success-bg); }
.tenant-architecture-page__status--warning { color: var(--gc-color-warning); border-color: var(--gc-color-warning-border); background: var(--gc-color-warning-bg); }
.tenant-architecture-page__status--danger { color: var(--gc-color-danger); border-color: var(--gc-color-danger-border); background: var(--gc-color-danger-bg); }
.tenant-architecture-page__admins li { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-2); }
.tenant-architecture-page__revoke { min-height: var(--gc-control-height-sm); }
.tenant-architecture-page__forms { align-items: stretch; }
.tenant-architecture-page__form { display: grid; gap: var(--gc-space-3); flex: 1; padding: var(--gc-space-5); }
.tenant-architecture-page__form label { display: grid; gap: var(--gc-space-2); }
.tenant-architecture-page__form input, .tenant-architecture-page__form select { min-height: var(--gc-control-height-md); padding: 0 var(--gc-space-3); color: var(--gc-color-text); border: var(--gc-border-width-thin) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface); }
.tenant-architecture-page__tree { align-items: stretch; flex-direction: column; }
.tenant-architecture-page__node { display: grid; gap: var(--gc-space-4); padding: var(--gc-space-5); }
.tenant-architecture-page__children { display: grid; grid-template-columns: repeat(auto-fit, minmax(calc(var(--gc-space-10) * 8), 1fr)); gap: var(--gc-space-3); }
.tenant-architecture-page__child { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-4); border: var(--gc-border-width-thin) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface-subtle); }
.tenant-architecture-page__state { padding: var(--gc-space-6); color: var(--gc-color-text-muted); }
@media (max-width: 48rem) { .tenant-architecture-page__header, .tenant-architecture-page__mode, .tenant-architecture-page__forms, .tenant-architecture-page__preflight-header { align-items: stretch; flex-direction: column; } .tenant-architecture-page__history li { grid-template-columns: minmax(0, 1fr) auto; } .tenant-architecture-page__history time { grid-column: 1 / -1; } }
</style>
