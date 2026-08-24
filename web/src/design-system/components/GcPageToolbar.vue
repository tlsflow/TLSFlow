<template>
  <div class="gc-page-toolbar">
    <div v-if="$slots.tabs" class="gc-page-toolbar__tabs">
      <slot name="tabs" />
    </div>
    <div v-if="$slots.actions" class="gc-page-toolbar__actions">
      <slot name="actions" />
    </div>
    <div v-if="$slots.primary" class="gc-page-toolbar__primary">
      <slot name="primary" />
    </div>
  </div>
</template>

<style scoped>
.gc-page-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gc-space-3);
}

.gc-page-toolbar__actions {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gc-space-2);
  min-width: 0;
}

.gc-page-toolbar__primary {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--gc-space-2);
  margin-left: auto;
}

.gc-page-toolbar__tabs {
  display: flex;
  flex: 0 0 auto;
  justify-content: flex-start;
  min-width: 0;
}

@media (max-width: 640px) {
  .gc-page-toolbar__actions,
  .gc-page-toolbar__primary,
  .gc-page-toolbar__tabs {
    flex-basis: 100%;
    justify-content: flex-start;
    margin-left: 0;
  }
}
</style>
