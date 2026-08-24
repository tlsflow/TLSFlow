<script setup lang="ts">
import { ref } from 'vue'
import AgentsView from '@/views/agents/AgentsView.vue'

const agentView = ref<{ openAgentDetailById: (agentId: string) => Promise<void> } | null>(null)

async function open(agentId: string) {
  await agentView.value?.openAgentDetailById(agentId)
}

defineExpose({ open })
</script>

<template>
  <AgentsView
    ref="agentView"
    detail-only
  />
</template>
