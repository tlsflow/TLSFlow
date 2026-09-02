<script setup lang="ts">
import { computed } from "vue";
import { useRoute, withBase } from "vitepress";
import versionManifest from "../../versions.json";

const route = useRoute();
const versionPattern = /^\/(v\d+\.\d+\.\d+)(?=\/|$)/;

const currentVersion = computed(() => {
  const match = route.path.match(versionPattern);
  return match?.[1] ?? versionManifest.current;
});
const isEnglish = computed(() => route.path.match(/^\/v\d+\.\d+\.\d+\/en(?:\/|$)/) !== null);

function versionLink(versionId: string) {
  const suffix = route.path.replace(versionPattern, "") || "/";
  const target = suffix === "/" ? `/${versionId}/` : `/${versionId}${suffix}`;
  return withBase(target);
}
</script>

<template>
  <div class="version-selector">
    <label class="version-selector__label" for="docs-version-selector">{{ isEnglish ? "Documentation version" : "文档版本" }}</label>
    <select id="docs-version-selector" :value="currentVersion" @change="(event) => {
      const target = event.target as HTMLSelectElement;
      window.location.href = versionLink(target.value);
    }">
      <option v-for="version in versionManifest.versions" :key="version.id" :value="version.id">
        {{ version.label }}{{ version.status === "current" ? (isEnglish ? " (current)" : "（当前）") : "" }}
      </option>
    </select>
  </div>
</template>

<style scoped>
.version-selector {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: 16px;
  white-space: nowrap;
}

.version-selector__label {
  color: var(--vp-c-text-2);
  font-size: 12px;
}

select {
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 4px 24px 4px 8px;
}

select:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 2px;
}

@media (max-width: 959px) {
  .version-selector {
    margin: 16px 24px 0;
  }
}
</style>
