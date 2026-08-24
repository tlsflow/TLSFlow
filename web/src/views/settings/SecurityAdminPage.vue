<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ApiClientError } from '@/api/client'
import type { ApiPageResult, ApiRecord } from '@/api/modules/common'
import { GcModal } from '@/design-system/components'

export interface SecurityFormField {
  readonly key: string
  readonly label: string
  readonly placeholder?: string
  readonly type?: 'text' | 'password' | 'textarea' | 'select'
  readonly options?: readonly { label: string; value: string }[]
}

export interface SecurityAdminConfig {
  readonly title: string
  readonly description: string
  readonly eyebrow: string
  readonly resourceName: string
  readonly columns: readonly { key: string; title: string }[]
  readonly load: () => Promise<ApiPageResult>
  readonly create?: (body: Record<string, unknown>) => Promise<unknown>
  readonly fields?: readonly SecurityFormField[]
  readonly submitLabel?: string
}

const props = defineProps<{ config: SecurityAdminConfig }>()

const loading = ref(false)
const saving = ref(false)
const error = ref('')
const requestId = ref('尚未请求')
const rows = ref<ApiRecord[]>([])
const form = ref<Record<string, string>>({})
const createModalOpen = ref(false)

function valueOf(row: ApiRecord, key: string): string {
  const value = key.split('.').reduce<unknown>((current, part) => {
    if (!current || typeof current !== 'object') return undefined
    return (current as Record<string, unknown>)[part]
  }, row)
  if (Array.isArray(value)) return value.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(', ')
  if (value && typeof value === 'object') return JSON.stringify(value)
  return value === undefined || value === null || value === '' ? '—' : String(value)
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    const result = await props.config.load()
    requestId.value = result.requestId
    rows.value = [...(result.data?.items ?? [])]
  } catch (cause) {
    if (cause instanceof ApiClientError) error.value = `${cause.message}（${cause.errorCode}，requestId：${cause.requestId}）`
    else error.value = cause instanceof Error ? cause.message : '加载失败'
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (!props.config.create || saving.value) return
  saving.value = true
  error.value = ''
  try {
    await props.config.create({ ...form.value })
    createModalOpen.value = false
    form.value = {}
    await load()
  } catch (cause) {
    if (cause instanceof ApiClientError) error.value = `${cause.message}（${cause.errorCode}，requestId：${cause.requestId}）`
    else error.value = cause instanceof Error ? cause.message : '提交失败'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="gc-page security-admin">
    <header class="security-admin__header">
      <div>
        <p>{{ config.eyebrow }}</p>
        <h1>{{ config.title }}</h1>
        <span>{{ config.description }}</span>
      </div>
      <div class="security-admin__actions">
        <button
          v-if="config.create && config.fields?.length"
          class="gc-button gc-button--primary"
          type="button"
          @click="createModalOpen = true"
        >
          {{ config.submitLabel ?? `新增${config.resourceName}` }}
        </button>
        <button class="gc-button" type="button" @click="load">刷新</button>
      </div>
    </header>

    <p v-if="error" class="security-admin__error" role="alert">{{ error }}</p>

    <GcModal
      v-if="config.create && config.fields?.length"
      v-model:open="createModalOpen"
      :title="config.submitLabel ?? `新增${config.resourceName}`"
      :description="`填写以下字段后创建${config.resourceName}`"
      size="lg"
    >
      <form id="security-admin-create-form" class="security-admin__form" @submit.prevent="submit">
        <label v-for="field in config.fields" :key="field.key">
          <span>{{ field.label }}</span>
          <select v-if="field.type === 'select'" v-model="form[field.key]" required>
            <option value="" disabled>{{ field.placeholder ?? `请选择${field.label}` }}</option>
            <option v-for="option in field.options" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
          <textarea v-else-if="field.type === 'textarea'" v-model="form[field.key]" :placeholder="field.placeholder" />
          <input v-else v-model="form[field.key]" :type="field.type ?? 'text'" :placeholder="field.placeholder" required />
        </label>
      </form>

      <template #actions>
        <button class="gc-button" type="button" :disabled="saving" @click="createModalOpen = false">取消</button>
        <button class="gc-button gc-button--primary" type="submit" form="security-admin-create-form" :disabled="saving">
          {{ saving ? '提交中…' : config.submitLabel ?? `新增${config.resourceName}` }}
        </button>
      </template>
    </GcModal>

    <section class="gc-card security-admin__table" aria-label="管理列表">
      <div class="security-admin__table-head">
        <strong>{{ config.resourceName }}列表</strong>
        <span>共 {{ rows.length }} 条 · requestId {{ requestId }}</span>
      </div>
      <div class="security-admin__table-scroll">
        <table>
          <thead><tr><th v-for="column in config.columns" :key="column.key">{{ column.title }}</th></tr></thead>
          <tbody>
            <tr v-if="loading"><td :colspan="config.columns.length">加载中…</td></tr>
            <tr v-else-if="rows.length === 0"><td :colspan="config.columns.length">暂无数据</td></tr>
            <tr v-for="row in rows" v-else :key="String(row.id ?? JSON.stringify(row))">
              <td v-for="column in config.columns" :key="column.key">{{ valueOf(row, column.key) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<style scoped>
.security-admin { display: grid; gap: var(--gc-space-5); }
.security-admin__header { display: flex; justify-content: space-between; gap: var(--gc-space-4); align-items: flex-start; }
.security-admin__actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--gc-space-2); }
.security-admin__header p { margin: 0 0 8px; color: var(--gc-color-primary); font-size: 12px; font-weight: 950; letter-spacing: .18em; }
.security-admin__header h1 { margin: 0; font-size: 34px; letter-spacing: -0.055em; }
.security-admin__header span { display: block; max-width: 760px; margin-top: 10px; color: var(--gc-color-text-muted); line-height: 1.65; font-weight: 650; }
.security-admin__error { margin: 0; border: 1px solid #fecaca; border-radius: 14px; padding: 12px 14px; color: var(--gc-color-danger); background: var(--gc-color-danger-bg); font-weight: 750; }
.security-admin__form { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: var(--gc-space-4); align-items: end; }
.security-admin__form label { display: grid; gap: 7px; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 850; }
.security-admin__form input, .security-admin__form select, .security-admin__form textarea { width: 100%; min-height: 42px; border: 1px solid var(--gc-color-border); border-radius: 12px; padding: 10px 12px; background: var(--gc-color-surface-muted); outline: none; }
.security-admin__form textarea { min-height: 42px; resize: vertical; }
.security-admin__form input:focus, .security-admin__form select:focus, .security-admin__form textarea:focus { border-color: #60a5fa; box-shadow: 0 0 0 4px rgb(96 165 250 / 14%); background: #fff; }
.security-admin__table { overflow: hidden; padding: 0; }
.security-admin__table-head { display: flex; justify-content: space-between; gap: var(--gc-space-3); padding: 18px 20px; border-bottom: 1px solid var(--gc-color-border); }
.security-admin__table-head strong { font-size: 17px; }
.security-admin__table-head span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 700; }
.security-admin__table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; min-width: 760px; }
th, td { padding: 14px 16px; border-bottom: 1px solid var(--gc-color-border); text-align: left; vertical-align: top; }
th { color: var(--gc-color-text-muted); background: var(--gc-color-surface-muted); font-size: var(--gc-font-size-xs); letter-spacing: .06em; text-transform: uppercase; }
td { font-size: var(--gc-font-size-sm); font-weight: 650; overflow-wrap: anywhere; }
</style>
