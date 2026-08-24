<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  DeploymentArtifactOption,
  DeploymentArtifactProjectionV1,
  DeploymentCredentialOption,
  DeploymentInputBindingsV1,
  DeploymentInputFieldProjectionV1,
  DeploymentInputProjectionV1,
} from './DeploymentInputForm.types'

const model = defineModel<DeploymentInputBindingsV1>({ required: true })
const props = withDefaults(defineProps<{
  projection: DeploymentInputProjectionV1
  credentialOptions?: DeploymentCredentialOption[]
  artifactOptions?: Record<string, DeploymentArtifactOption[]>
  disabled?: boolean
  loading?: boolean
}>(), {
  credentialOptions: () => [],
  artifactOptions: () => ({}),
  disabled: false,
  loading: false,
})

const { t } = useI18n()
const advancedExpanded = ref(false)
const advancedConnections = computed(() => props.projection.connections.filter((item) =>
  Object.values(item.fields).every((field) => field.configurationMode !== 'required')))
const requiredConnections = computed(() => props.projection.connections.filter((item) =>
  Object.values(item.fields).some((field) => field.configurationMode === 'required')))
const advancedCredentials = computed(() => props.projection.credentials.filter((item) => item.configurationMode === 'advanced'))
const requiredCredentials = computed(() => props.projection.credentials.filter((item) => item.configurationMode === 'required'))
const advancedArtifacts = computed(() => props.projection.artifacts.filter((item) => item.configurationMode === 'advanced'))
const requiredArtifacts = computed(() => props.projection.artifacts.filter((item) => item.configurationMode === 'required'))
const hasAdvanced = computed(() => props.projection.advancedVariables.length > 0
  || advancedConnections.value.length > 0
  || advancedCredentials.value.length > 0
  || advancedArtifacts.value.length > 0)

function label(slot: string, item?: { ui?: { labelKey?: string }; descriptionKey?: string }): string {
  const key = item?.ui?.labelKey ?? item?.descriptionKey
  return key ? t(key) : slot
}

function help(item: { ui?: { helpKey?: string }; descriptionKey?: string }): string {
  const key = item.ui?.helpKey ?? item.descriptionKey
  return key ? t(key) : ''
}

function sourceLabel(item: DeploymentInputFieldProjectionV1): string {
  return t('deploymentInputs.source', { source: item.source.kind })
}

function variableValue(item: DeploymentInputFieldProjectionV1): unknown {
  return Object.prototype.hasOwnProperty.call(model.value.variables, item.slot)
    ? model.value.variables[item.slot]
    : item.value ?? item.default
}

function updateVariable(item: DeploymentInputFieldProjectionV1, value: unknown): void {
  const variables = { ...model.value.variables }
  if (value === '' || value === undefined) delete variables[item.slot]
  else variables[item.slot] = normalizeFieldValue(item.type, value)
  model.value = { ...model.value, variables }
}

function connectionValue(slot: string, path: string, item: DeploymentInputFieldProjectionV1): unknown {
  return readPath(model.value.connections[slot], path) ?? item.value ?? item.default
}

function updateConnection(slot: string, path: string, item: DeploymentInputFieldProjectionV1, value: unknown): void {
  const current = structuredClone(model.value.connections[slot] ?? {}) as Record<string, unknown>
  writePath(current, path, value === '' ? undefined : normalizeFieldValue(item.type, value))
  const connections = { ...model.value.connections }
  if (hasValues(current)) connections[slot] = current
  else delete connections[slot]
  model.value = { ...model.value, connections }
}

function updateCredential(slot: string, credentialId: string): void {
  const credentials = { ...model.value.credentials }
  if (credentialId) credentials[slot] = { credentialId }
  else delete credentials[slot]
  model.value = { ...model.value, credentials }
}

function selectedCredential(slot: string, projected?: string): string {
  return model.value.credentials[slot]?.credentialId ?? projected ?? ''
}

function updateArtifactFormat(item: DeploymentArtifactProjectionV1, certificateFormatId: string): void {
  const artifacts = { ...model.value.artifacts }
  if (!certificateFormatId) delete artifacts[item.slot]
  else artifacts[item.slot] = { certificateFormatId, outputBindings: {} }
  model.value = { ...model.value, artifacts }
}

function updateArtifactOutput(slot: string, outputSlot: string, outputKey: string): void {
  const current = model.value.artifacts[slot]
  if (!current) return
  const outputBindings = { ...current.outputBindings }
  if (outputKey) outputBindings[outputSlot] = outputKey
  else delete outputBindings[outputSlot]
  model.value = {
    ...model.value,
    artifacts: { ...model.value.artifacts, [slot]: { ...current, outputBindings } },
  }
}

function artifactBinding(item: DeploymentArtifactProjectionV1) {
  return model.value.artifacts[item.slot] ?? item.binding
}

function availableArtifactOutputs(item: DeploymentArtifactProjectionV1): Array<{ key: string; label: string }> {
  const selectedId = artifactBinding(item)?.certificateFormatId
  return props.artifactOptions[item.slot]?.find((option) => option.id === selectedId)?.outputs ?? []
}

function normalizeFieldValue(type: string, value: unknown): unknown {
  if (type === 'number' || type === 'integer') return Number(value)
  if (type === 'boolean') return value === true || value === 'true'
  return value
}

function readPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => current && typeof current === 'object'
    ? (current as Record<string, unknown>)[segment]
    : undefined, value)
}

function writePath(target: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split('.')
  const leaf = segments.pop()
  if (!leaf) return
  let current = target
  for (const segment of segments) {
    const child = current[segment]
    current[segment] = child && typeof child === 'object' && !Array.isArray(child) ? child : {}
    current = current[segment] as Record<string, unknown>
  }
  if (value === undefined) delete current[leaf]
  else current[leaf] = value
}

function hasValues(value: Record<string, unknown>): boolean {
  return Object.values(value).some((item) => item && typeof item === 'object' && !Array.isArray(item)
    ? hasValues(item as Record<string, unknown>)
    : item !== undefined && item !== '')
}
</script>

<template>
  <section class="deployment-input-form" :aria-label="t('deploymentInputs.title')">
    <header class="deployment-input-form__header">
      <div>
        <h3>{{ t('deploymentInputs.title') }}</h3>
        <p>{{ t('deploymentInputs.description') }}</p>
      </div>
      <span>{{ t('deploymentInputs.contractVersion', { version: projection.contractVersion }) }}</span>
    </header>

    <p v-if="loading" class="deployment-input-form__empty">{{ t('common.loading') }}</p>

    <template v-else>
      <section v-if="projection.issues.length" class="deployment-input-form__issues" :aria-label="t('deploymentInputs.issues.title')">
        <article v-for="issue in projection.issues" :key="`${issue.code}:${issue.slot ?? ''}:${issue.path ?? ''}`" :class="['deployment-input-form__issue', `deployment-input-form__issue--${issue.severity.toLowerCase()}`]">
          <strong>{{ t(issue.messageKey, issue.params ?? {}) }}</strong>
          <small>{{ [issue.slot, issue.path, issue.bindingLayer].filter(Boolean).join(' · ') }}</small>
        </article>
      </section>

      <section v-if="projection.requiredVariables.length || requiredConnections.length || requiredCredentials.length || requiredArtifacts.length" class="deployment-input-form__section">
        <header><h4>{{ t('deploymentInputs.groups.required') }}</h4></header>
        <div class="deployment-input-form__grid">
          <label v-for="item in projection.requiredVariables" :key="`variable:${item.slot}`" class="deployment-input-form__field">
            <span>{{ label(item.slot, item) }} *</span>
            <select v-if="item.enum" :value="variableValue(item)" :disabled="disabled" @change="updateVariable(item, ($event.target as HTMLSelectElement).value)">
              <option value="">{{ t('deploymentInputs.placeholders.select') }}</option>
              <option v-for="option in item.enum" :key="String(option)" :value="String(option)">{{ String(option) }}</option>
            </select>
            <select v-else-if="item.type === 'boolean'" :value="String(variableValue(item) ?? '')" :disabled="disabled" @change="updateVariable(item, ($event.target as HTMLSelectElement).value)">
              <option value="">{{ t('deploymentInputs.placeholders.select') }}</option><option value="true">true</option><option value="false">false</option>
            </select>
            <input v-else :type="item.type === 'number' || item.type === 'integer' ? 'number' : 'text'" :value="String(variableValue(item) ?? '')" :disabled="disabled" autocomplete="off" @input="updateVariable(item, ($event.target as HTMLInputElement).value)">
            <small v-if="help(item)">{{ help(item) }}</small>
            <small>{{ sourceLabel(item) }}</small>
          </label>
        </div>
      </section>

      <section v-for="connection in requiredConnections" :key="`connection:${connection.slot}`" class="deployment-input-form__section">
        <header><h4>{{ label(connection.slot, connection) }}</h4><span>{{ connection.transport.toUpperCase() }}</span></header>
        <div class="deployment-input-form__grid">
          <label v-for="(field, path) in connection.fields" :key="`${connection.slot}:${path}`" class="deployment-input-form__field">
            <span>{{ label(String(path), field) }}{{ field.required ? ' *' : '' }}</span>
            <select v-if="field.type === 'boolean'" :value="String(connectionValue(connection.slot, String(path), field) ?? '')" :disabled="disabled" @change="updateConnection(connection.slot, String(path), field, ($event.target as HTMLSelectElement).value)">
              <option value="">{{ t('deploymentInputs.placeholders.select') }}</option><option value="true">true</option><option value="false">false</option>
            </select>
            <input v-else :type="field.type === 'number' ? 'number' : 'text'" :value="String(connectionValue(connection.slot, String(path), field) ?? '')" :disabled="disabled" autocomplete="off" @input="updateConnection(connection.slot, String(path), field, ($event.target as HTMLInputElement).value)">
            <small>{{ sourceLabel(field) }}</small>
          </label>
        </div>
      </section>

      <div v-for="item in requiredCredentials" :key="`credential:${item.slot}`" class="deployment-input-form__field">
        <label><span>{{ label(item.slot, item) }}{{ item.required ? ' *' : '' }}</span>
          <select :value="selectedCredential(item.slot, item.selectedCredentialId)" :disabled="disabled" @change="updateCredential(item.slot, ($event.target as HTMLSelectElement).value)">
            <option value="">{{ t('deploymentInputs.placeholders.credential') }}</option>
            <option v-for="option in credentialOptions.filter((candidate) => !candidate.kind || item.allowedKinds.includes(candidate.kind))" :key="option.id" :value="option.id">{{ option.label }}</option>
          </select>
        </label>
      </div>

      <section v-for="item in requiredArtifacts" :key="`artifact:${item.slot}`" class="deployment-input-form__section">
        <header><h4>{{ label(item.slot, item) }}</h4></header>
        <div class="deployment-input-form__grid">
          <label class="deployment-input-form__field"><span>{{ t('deploymentInputs.artifacts.format') }} *</span>
            <select :value="artifactBinding(item)?.certificateFormatId ?? ''" :disabled="disabled" @change="updateArtifactFormat(item, ($event.target as HTMLSelectElement).value)">
              <option value="">{{ t('deploymentInputs.placeholders.artifact') }}</option>
              <option v-for="option in artifactOptions[item.slot] ?? []" :key="option.id" :value="option.id">{{ option.label }}</option>
            </select>
          </label>
          <label v-for="(output, outputSlot) in item.outputs" :key="`${item.slot}:${outputSlot}`" class="deployment-input-form__field">
            <span>{{ output.descriptionKey ? t(output.descriptionKey) : outputSlot }}{{ output.required ? ' *' : '' }}</span>
            <select :value="artifactBinding(item)?.outputBindings[outputSlot] ?? ''" :disabled="disabled || !artifactBinding(item)?.certificateFormatId" @change="updateArtifactOutput(item.slot, String(outputSlot), ($event.target as HTMLSelectElement).value)">
              <option value="">{{ t('deploymentInputs.placeholders.output') }}</option>
              <option v-for="option in availableArtifactOutputs(item)" :key="option.key" :value="option.key">{{ option.label }}</option>
            </select>
          </label>
        </div>
      </section>

      <section v-if="hasAdvanced" class="deployment-input-form__section">
        <header><h4>{{ t('deploymentInputs.groups.advanced') }}</h4><button class="gc-button gc-button--ghost" type="button" @click="advancedExpanded = !advancedExpanded">{{ advancedExpanded ? t('deploymentInputs.actions.collapse') : t('deploymentInputs.actions.expand') }}</button></header>
        <div v-if="advancedExpanded" class="deployment-input-form__grid">
          <label v-for="item in projection.advancedVariables" :key="`advanced-variable:${item.slot}`" class="deployment-input-form__field"><span>{{ label(item.slot, item) }}</span><input :value="String(variableValue(item) ?? '')" :disabled="disabled" autocomplete="off" @input="updateVariable(item, ($event.target as HTMLInputElement).value)"></label>
          <template v-for="connection in advancedConnections" :key="`advanced-connection:${connection.slot}`"><label v-for="(field, path) in connection.fields" :key="`${connection.slot}:${path}`" class="deployment-input-form__field"><span>{{ label(connection.slot, connection) }} · {{ label(String(path), field) }}</span><input :value="String(connectionValue(connection.slot, String(path), field) ?? '')" :disabled="disabled" autocomplete="off" @input="updateConnection(connection.slot, String(path), field, ($event.target as HTMLInputElement).value)"></label></template>
          <label v-for="item in advancedCredentials" :key="`advanced-credential:${item.slot}`" class="deployment-input-form__field"><span>{{ label(item.slot, item) }}</span><select :value="selectedCredential(item.slot, item.selectedCredentialId)" :disabled="disabled" @change="updateCredential(item.slot, ($event.target as HTMLSelectElement).value)"><option value="">{{ t('deploymentInputs.placeholders.credential') }}</option><option v-for="option in credentialOptions.filter((candidate) => !candidate.kind || item.allowedKinds.includes(candidate.kind))" :key="option.id" :value="option.id">{{ option.label }}</option></select></label>
          <template v-for="item in advancedArtifacts" :key="`advanced-artifact:${item.slot}`">
            <label class="deployment-input-form__field"><span>{{ label(item.slot, item) }} · {{ t('deploymentInputs.artifacts.format') }}</span><select :value="artifactBinding(item)?.certificateFormatId ?? ''" :disabled="disabled" @change="updateArtifactFormat(item, ($event.target as HTMLSelectElement).value)"><option value="">{{ t('deploymentInputs.placeholders.artifact') }}</option><option v-for="option in artifactOptions[item.slot] ?? []" :key="option.id" :value="option.id">{{ option.label }}</option></select></label>
            <label v-for="(output, outputSlot) in item.outputs" :key="`${item.slot}:${outputSlot}`" class="deployment-input-form__field"><span>{{ output.descriptionKey ? t(output.descriptionKey) : outputSlot }}</span><select :value="artifactBinding(item)?.outputBindings[outputSlot] ?? ''" :disabled="disabled || !artifactBinding(item)?.certificateFormatId" @change="updateArtifactOutput(item.slot, String(outputSlot), ($event.target as HTMLSelectElement).value)"><option value="">{{ t('deploymentInputs.placeholders.output') }}</option><option v-for="option in availableArtifactOutputs(item)" :key="option.key" :value="option.key">{{ option.label }}</option></select></label>
          </template>
        </div>
      </section>

      <section v-if="projection.fixedValues.length || projection.runtimeValues.length" class="deployment-input-form__section">
        <header><h4>{{ t('deploymentInputs.groups.readonly') }}</h4></header>
        <dl class="deployment-input-form__readonly">
          <div v-for="item in projection.fixedValues" :key="`fixed:${item.slot}`"><dt>{{ item.slot }}</dt><dd>{{ String(item.value) }}</dd></div>
          <div v-for="item in projection.runtimeValues" :key="`runtime:${item.slot}`"><dt>{{ item.slot }}</dt><dd>{{ t('deploymentInputs.runtimeValue', { source: item.source.kind }) }}</dd></div>
        </dl>
      </section>
    </template>
  </section>
</template>

<style scoped>
.deployment-input-form { display: grid; gap: var(--gc-space-4); }
.deployment-input-form__header, .deployment-input-form__section > header { display: flex; align-items: center; justify-content: space-between; gap: var(--gc-space-3); }
.deployment-input-form__header h3, .deployment-input-form__section h4 { margin: 0; color: var(--gc-color-text-strong); }
.deployment-input-form__header p { margin: var(--gc-space-1) 0 0; color: var(--gc-color-text-muted); }
.deployment-input-form__header > span, .deployment-input-form__section header > span { color: var(--gc-color-text-muted); font-size: var(--gc-font-size-xs); }
.deployment-input-form__section { display: grid; gap: var(--gc-space-3); padding: var(--gc-space-4); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-md); background: var(--gc-color-surface-subtle); }
.deployment-input-form__grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(0, 1fr)); gap: var(--gc-space-3); }
.deployment-input-form__field, .deployment-input-form__field label { display: grid; gap: var(--gc-space-2); }
.deployment-input-form__field span { color: var(--gc-color-text); font-size: var(--gc-font-size-sm); }
.deployment-input-form__field small { color: var(--gc-color-text-muted); }
.deployment-input-form input, .deployment-input-form select { min-height: var(--gc-control-height-md); padding: var(--gc-space-2) var(--gc-space-3); border: var(--gc-space-hairline) solid var(--gc-color-border); border-radius: var(--gc-radius-sm); background: var(--gc-color-surface-field); color: var(--gc-color-text); }
.deployment-input-form input:focus, .deployment-input-form select:focus { outline: none; border-color: var(--gc-color-primary); box-shadow: var(--gc-shadow-focus); }
.deployment-input-form__issues { display: grid; gap: var(--gc-space-2); }
.deployment-input-form__issue { display: grid; gap: var(--gc-space-1); padding: var(--gc-space-3); border: var(--gc-space-hairline) solid; border-radius: var(--gc-radius-sm); }
.deployment-input-form__issue--error { color: var(--gc-color-danger); border-color: var(--gc-color-danger-border); background: var(--gc-color-danger-soft); }
.deployment-input-form__issue--warning { color: var(--gc-color-warning); border-color: var(--gc-color-warning-border); background: var(--gc-color-warning-soft); }
.deployment-input-form__readonly { display: grid; gap: var(--gc-space-2); margin: 0; }
.deployment-input-form__readonly div { display: flex; justify-content: space-between; gap: var(--gc-space-3); }
.deployment-input-form__readonly dt { color: var(--gc-color-text-muted); }
.deployment-input-form__readonly dd { margin: 0; color: var(--gc-color-text); }
.deployment-input-form__empty { color: var(--gc-color-text-muted); }
</style>
