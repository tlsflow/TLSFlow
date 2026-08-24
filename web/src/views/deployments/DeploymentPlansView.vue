<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { GcDeploymentWizard, GcEmptyState } from '@/design-system/components'
import { listBindings } from '@/api/modules/bindings.api'
import { listCertificates } from '@/api/modules/certificates.api'
import type { ApiRecord } from '@/api/modules/common'
import BusinessResourcePage from '@/views/BusinessResourcePage.vue'
import { deploymentPlanActions, deploymentPlansPageConfig } from './deployment-plan.config'
import type { DeploymentWizardPlan } from '@/design-system/components/GcDeploymentWizard.vue'

const route = useRoute()
const certificates = ref<ApiRecord[]>([])
const bindings = ref<ApiRecord[]>([])
const wizardLoading = ref(false)
const wizardError = ref('')
const dryRunRequestId = ref('')
const submitRequestId = ref('')

const initialCertificateId = computed(() => {
  const value = route.query.certificateId
  return typeof value === 'string' && value ? value : null
})

void loadWizardOptions()

async function loadWizardOptions() {
  wizardLoading.value = true
  wizardError.value = ''
  try {
    const [certificateResult, bindingResult] = await Promise.all([
      listCertificates({ page: 1, pageSize: 50, sort: 'notAfter:asc' }),
      listBindings({ page: 1, pageSize: 50, sort: 'lastVerifiedAt:desc' })
    ])
    certificates.value = [...(certificateResult.data?.items ?? [])]
    bindings.value = filterBindings(bindingResult.data?.items ?? [])
  } catch (cause) {
    wizardError.value = cause instanceof Error ? cause.message : '部署向导初始化失败'
  } finally {
    wizardLoading.value = false
  }
}

function filterBindings(items: readonly ApiRecord[]): ApiRecord[] {
  const queryBindingId = typeof route.query.bindingId === 'string' ? route.query.bindingId : ''
  const queryCertificateId = typeof route.query.certificateId === 'string' ? route.query.certificateId : ''
  const queryHostId = typeof route.query.hostId === 'string' ? route.query.hostId : ''
  return [...items].filter((item) => {
    const certificate = typeof item.certificate === 'object' && item.certificate ? (item.certificate as Record<string, unknown>) : null
    const host = typeof item.host === 'object' && item.host ? (item.host as Record<string, unknown>) : null
    if (queryBindingId && ![item.id, item.bindingId].includes(queryBindingId)) return false
    if (queryCertificateId && ![item.certificateId, certificate?.id].includes(queryCertificateId)) return false
    if (queryHostId && ![item.hostId, item.assetId, host?.id].includes(queryHostId)) return false
    return true
  })
}

async function handleDryRun(plan: DeploymentWizardPlan) {
  const result = await deploymentPlanActions.dryRunDeploymentPlan({
    certificateId: plan.certificateId,
    bindingIds: plan.bindingIds,
    targetIds: plan.bindingIds
  })
  dryRunRequestId.value = result.requestId
}

async function handleSubmit(plan: DeploymentWizardPlan) {
  const created = await deploymentPlanActions.createDeploymentPlan({
    certificateId: plan.certificateId,
    bindingIds: plan.bindingIds,
    targetIds: plan.bindingIds
  })
  const planId = String(created.data?.id ?? created.data?.planId ?? '')
  if (!planId) {
    submitRequestId.value = created.requestId
    return
  }
  const result = await deploymentPlanActions.submitDeploymentPlan(planId, {
    certificateId: plan.certificateId,
    bindingIds: plan.bindingIds
  })
  submitRequestId.value = result.requestId
}

async function handleExecute(plan: DeploymentWizardPlan) {
  const created = await deploymentPlanActions.createDeploymentPlan({
    certificateId: plan.certificateId,
    bindingIds: plan.bindingIds,
    targetIds: plan.bindingIds
  })
  const planId = String(created.data?.id ?? created.data?.planId ?? '')
  if (!planId) {
    submitRequestId.value = created.requestId
    return
  }
  const result = await deploymentPlanActions.executeDeploymentPlan(planId, {
    certificateId: plan.certificateId,
    bindingIds: plan.bindingIds
  })
  submitRequestId.value = result.requestId
}
</script>

<template>
  <section class="gc-page gc-deployment-page">
    <GcDeploymentWizard
      :certificates="certificates"
      :bindings="bindings"
      :loading="wizardLoading"
      :dry-run-request-id="dryRunRequestId"
      :submit-request-id="submitRequestId"
      :initial-certificate-id="initialCertificateId"
      @dry-run="handleDryRun"
      @submit="handleSubmit"
      @execute="handleExecute"
    />
    <GcEmptyState v-if="wizardError" title="部署向导初始化失败" :description="wizardError" />
    <BusinessResourcePage :config="deploymentPlansPageConfig" />
  </section>
</template>

<style scoped>
.gc-deployment-page { display: grid; gap: var(--gc-space-5); }
</style>
