<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, withBase } from "vitepress";
import versionManifest from "../../versions.json";

const props = defineProps<{
  name: string;
  alt: string;
  width?: number | string;
  height?: number | string;
}>();

const route = useRoute();
const failed = ref(false);
const version = computed(() => route.path.match(/^\/(v\d+\.\d+\.\d+)/)?.[1] ?? versionManifest.current);
const locale = computed(() => route.path.match(/^\/v\d+\.\d+\.\d+\/en(?:\/|$)/) ? "en-US" : "zh-CN");
const imageUrl = computed(() => withBase(`/assets/${version.value}/${locale.value}/${props.name}`));
const fallbackUrl = computed(() => withBase(`/assets/${version.value}/zh-CN/${props.name}`));

function useFallback() {
  if (locale.value !== "zh-CN") failed.value = true;
}
</script>

<template>
  <figure class="localized-image">
    <img
      :src="failed ? fallbackUrl : imageUrl"
      :alt="props.alt"
      :width="props.width"
      :height="props.height"
      loading="lazy"
      @error="useFallback"
    >
    <figcaption>{{ props.alt }}</figcaption>
  </figure>
</template>

<style scoped>
.localized-image {
  margin: 24px 0;
  text-align: center;
}

img {
  display: inline-block;
  max-width: 100%;
  height: auto;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
}

figcaption {
  margin-top: 8px;
  color: var(--vp-c-text-2);
  font-size: 13px;
}
</style>
