<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PluginFormCondition, PluginFormField, PluginFormSchema } from './GcPluginForm.types'
import GcSecretInput from './GcSecretInput.vue'
import GcCredentialSelect from './GcCredentialSelect.vue'

const model = defineModel<Record<string, unknown>>({ default: () => ({}) })
const props = withDefaults(defineProps<{
  schema: PluginFormSchema
  pluginMessages?: Record<string, string>
  readonly?: boolean
}>(), {
  pluginMessages: () => ({}),
  readonly: false,
})

const emit = defineEmits<{
  requestOptions: [payload: { actionContractId: string; fieldKey: string }]
}>()

const { t } = useI18n()
const sections = computed(() => props.schema.sections.map((section) => ({
  ...section,
  fields: section.fields.filter((field) => evaluate(field.visibleWhen)),
})))

function label(key: string | undefined): string {
  if (!key) return ''
  return props.pluginMessages[key] ?? t(key)
}

function evaluate(condition: PluginFormCondition | undefined): boolean {
  if (!condition) return true
  const current = model.value[condition.field]
  if (condition.operator === 'truthy') return Boolean(current)
  if (condition.operator === 'falsy') return !current
  if (condition.operator === 'equals') return current === condition.value
  if (condition.operator === 'not_equals') return current !== condition.value
  const values = Array.isArray(condition.value) ? condition.value : []
  if (condition.operator === 'in') return values.includes(current)
  return !values.includes(current)
}

function disabled(field: PluginFormField): boolean {
  return props.readonly || !evaluate(field.enabledWhen)
}

function update(key: string, value: unknown): void {
  model.value = { ...model.value, [key]: value }
}

function stringValue(field: PluginFormField): string {
  const value = model.value[field.key] ?? field.defaultValue
  return typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)
}

function numberValue(field: PluginFormField): number | undefined {
  const value = model.value[field.key] ?? field.defaultValue
  return typeof value === 'number' ? value : value === '' || value === undefined ? undefined : Number(value)
}

function booleanValue(field: PluginFormField): boolean {
  return Boolean(model.value[field.key] ?? field.defaultValue)
}

function arrayValue(field: PluginFormField): string[] {
  const value = model.value[field.key] ?? field.defaultValue
  return Array.isArray(value) ? value.map(String) : []
}

function toggleArray(field: PluginFormField, value: string, checked: boolean): void {
  const current = new Set(arrayValue(field))
  if (checked) current.add(value)
  else current.delete(value)
  update(field.key, [...current])
}
</script>

<template>
  <div class="gc-plugin-form">
    <section v-for="section in sections" :key="section.id" class="gc-plugin-form__section">
      <header class="gc-plugin-form__section-header">
        <h3>{{ label(section.titleKey) }}</h3>
        <p v-if="section.descriptionKey">{{ label(section.descriptionKey) }}</p>
      </header>

      <div class="gc-plugin-form__grid">
        <template v-for="field in section.fields" :key="field.key">
          <hr v-if="field.type === 'divider'" class="gc-plugin-form__divider">
          <aside v-else-if="field.type === 'notice'" class="gc-plugin-form__notice" role="note">
            {{ label(field.descriptionKey ?? field.labelKey) }}
          </aside>
          <label v-else-if="field.type === 'checkbox' || field.type === 'switch'" class="gc-plugin-form__toggle">
            <input
              :checked="booleanValue(field)"
              :disabled="disabled(field)"
              type="checkbox"
              :role="field.type === 'switch' ? 'switch' : undefined"
              @change="update(field.key, ($event.target as HTMLInputElement).checked)"
            >
            <span>{{ label(field.labelKey) }}</span>
          </label>
          <GcSecretInput
            v-else-if="field.type === 'secret_ref'"
            :model-value="stringValue(field)"
            :label="label(field.labelKey)"
            :placeholder="label(field.placeholderKey)"
            :hint="label(field.descriptionKey)"
            @update:model-value="update(field.key, $event)"
          />
          <GcCredentialSelect
            v-else-if="field.type === 'credential_ref'"
            :model-value="stringValue(field)"
            :label="label(field.labelKey)"
            :hint="label(field.descriptionKey)"
            :disabled="disabled(field)"
            :required="field.required"
            :accepted-kinds="field.acceptedCredentialKinds"
            :accepted-scopes="field.acceptedScopes"
            @update:model-value="update(field.key, $event)"
          />
          <fieldset v-else-if="field.type === 'radio' || field.type === 'checkbox_group'" class="gc-plugin-form__fieldset" :disabled="disabled(field)">
            <legend>{{ label(field.labelKey) }}</legend>
            <label v-for="option in field.options ?? []" :key="option.value">
              <input
                :type="field.type === 'radio' ? 'radio' : 'checkbox'"
                :name="field.key"
                :value="option.value"
                :checked="field.type === 'radio' ? stringValue(field) === option.value : arrayValue(field).includes(option.value)"
                :disabled="option.disabled"
                @change="field.type === 'radio'
                  ? update(field.key, option.value)
                  : toggleArray(field, option.value, ($event.target as HTMLInputElement).checked)"
              >
              <span>{{ label(option.labelKey) }}</span>
            </label>
          </fieldset>
          <label v-else class="gc-plugin-form__field">
            <span>{{ label(field.labelKey) }}</span>
            <textarea
              v-if="['textarea', 'key_value', 'object_list'].includes(field.type)"
              :value="stringValue(field)"
              :placeholder="label(field.placeholderKey)"
              :required="field.required"
              :disabled="disabled(field)"
              @input="update(field.key, ($event.target as HTMLTextAreaElement).value)"
            />
            <select
              v-else-if="field.type === 'select' || field.type === 'multi_select' || field.type === 'certificate_ref'"
              :value="field.type === 'multi_select' ? arrayValue(field) : stringValue(field)"
              :multiple="field.type === 'multi_select'"
              :required="field.required"
              :disabled="disabled(field)"
              @change="update(field.key, field.type === 'multi_select'
                ? [...($event.target as HTMLSelectElement).selectedOptions].map((option) => option.value)
                : ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="option in field.options ?? []" :key="option.value" :value="option.value" :disabled="option.disabled">
                {{ label(option.labelKey) }}
              </option>
            </select>
            <input
              v-else-if="field.type === 'integer' || field.type === 'decimal'"
              :value="numberValue(field)"
              type="number"
              :step="field.type === 'integer' ? 1 : 'any'"
              :required="field.required"
              :disabled="disabled(field)"
              @input="update(field.key, ($event.target as HTMLInputElement).valueAsNumber)"
            >
            <input
              v-else
              :value="stringValue(field)"
              :type="field.type === 'date' ? 'date' : field.type === 'time' ? 'time' : field.type === 'datetime' ? 'datetime-local' : 'text'"
              :placeholder="label(field.placeholderKey)"
              :required="field.required"
              :readonly="field.type === 'readonly_text' || readonly"
              :disabled="disabled(field) && field.type !== 'readonly_text'"
              @input="update(field.key, ($event.target as HTMLInputElement).value)"
            >
            <small v-if="field.descriptionKey">{{ label(field.descriptionKey) }}</small>
            <button
              v-if="field.optionProviderAction"
              class="gc-button"
              type="button"
              :disabled="disabled(field)"
              @click.prevent="emit('requestOptions', { actionContractId: field.optionProviderAction, fieldKey: field.key })"
            >
              {{ t('plugins.forms.loadOptions') }}
            </button>
          </label>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.gc-plugin-form { display: grid; gap: var(--gc-space-4); }
.gc-plugin-form__section { display: grid; gap: var(--gc-space-4); padding: var(--gc-space-4); border: var(--gc-space-hairline) solid var(--gc-color-border-soft); border-radius: var(--gc-radius-lg); background: var(--gc-color-surface-glass); box-shadow: var(--gc-shadow-sm); }
.gc-plugin-form__section-header { display: grid; gap: var(--gc-space-1); }
.gc-plugin-form__section-header h3, .gc-plugin-form__section-header p { margin: 0; }
.gc-plugin-form__section-header p, .gc-plugin-form__field small { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.gc-plugin-form__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(var(--gc-size-card-min), 1fr)); gap: var(--gc-space-4); }
.gc-plugin-form__field, .gc-plugin-form__fieldset { display: grid; align-content: start; gap: var(--gc-space-2); min-width: 0; }
.gc-plugin-form__field input, .gc-plugin-form__field textarea, .gc-plugin-form__field select { width: 100%; min-height: var(--gc-control-height-md); padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); color: var(--gc-color-text); background: var(--gc-color-surface-field); font: inherit; box-sizing: border-box; }
.gc-plugin-form__field textarea { min-height: calc(var(--gc-control-height-md) * 2); resize: vertical; }
.gc-plugin-form__toggle, .gc-plugin-form__fieldset label { display: flex; align-items: center; gap: var(--gc-space-2); }
.gc-plugin-form__fieldset { margin: 0; padding: var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); }
.gc-plugin-form__notice { grid-column: 1 / -1; padding: var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-info-border); border-radius: var(--gc-radius-sm); color: var(--gc-color-text); background: var(--gc-color-info-bg); }
.gc-plugin-form__divider { grid-column: 1 / -1; width: 100%; margin: 0; border: 0; border-top: var(--gc-space-hairline) solid var(--gc-color-border); }
</style>
