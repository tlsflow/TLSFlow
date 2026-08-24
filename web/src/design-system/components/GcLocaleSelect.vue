<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { localeLabels, supportedLocales, type SupportedLocale } from '@/i18n'
import { useAppStore } from '@/stores/app.store'

const appStore = useAppStore()
const { t } = useI18n()

const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)

const currentLabel = computed(() => localeLabels[appStore.locale])

function toggleMenu() {
  open.value = !open.value
}

function closeMenu() {
  open.value = false
}

async function selectLocale(locale: SupportedLocale) {
  if (locale !== appStore.locale) {
    await appStore.setLocale(locale)
  }
  closeMenu()
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null
  if (!target) return
  if (rootRef.value?.contains(target)) return
  closeMenu()
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
}

watch(open, async (value) => {
  if (!value) return
  await nextTick()
  menuRef.value?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus()
})

onMounted(() => {
  document.addEventListener('pointerdown', onDocumentPointerDown)
  document.addEventListener('keydown', onDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocumentPointerDown)
  document.removeEventListener('keydown', onDocumentKeydown)
})
</script>

<template>
  <div ref="rootRef" class="gc-locale-select" :class="{ 'gc-locale-select--open': open }">
    <button
      class="gc-locale-select__trigger"
      type="button"
      :aria-label="t('preferences.languageSelect')"
      :aria-expanded="open"
      aria-haspopup="menu"
      :title="currentLabel"
      @click="toggleMenu"
    >
      <span class="gc-locale-select__glow" aria-hidden="true"></span>
      <span class="gc-locale-select__icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6" />
          <path d="M3 12h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
          <path
            d="M12 3c2.4 2.6 3.6 5.6 3.6 9s-1.2 6.4-3.6 9c-2.4-2.6-3.6-5.6-3.6-9S9.6 5.6 12 3Z"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linejoin="round"
          />
        </svg>
      </span>
      <span class="gc-locale-select__code">{{ appStore.locale.split('-')[0].toUpperCase() }}</span>
      <span class="gc-locale-select__chevron" aria-hidden="true">
        <svg viewBox="0 0 16 16" fill="none">
          <path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
    </button>

    <div
      v-if="open"
      ref="menuRef"
      class="gc-locale-select__menu"
      role="menu"
      :aria-label="t('preferences.languageSelect')"
    >
      <button
        v-for="item in supportedLocales"
        :key="item"
        class="gc-locale-select__option"
        :class="{ 'gc-locale-select__option--active': item === appStore.locale }"
        type="button"
        role="menuitemradio"
        :aria-checked="item === appStore.locale"
        @click="selectLocale(item)"
      >
        <span class="gc-locale-select__option-code">{{ item.split('-')[0].toUpperCase() }}</span>
        <span class="gc-locale-select__option-label">{{ localeLabels[item] }}</span>
        <span v-if="item === appStore.locale" class="gc-locale-select__check" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none">
            <path d="M3.5 8.2 6.6 11.2 12.5 4.8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.gc-locale-select {
  position: relative;
  display: inline-flex;
}

.gc-locale-select__trigger {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-2);
  min-height: var(--gc-space-10);
  padding: 0 var(--gc-space-3) 0 var(--gc-space-control);
  overflow: hidden;
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  color: var(--gc-color-text);
  background:
    linear-gradient(160deg, var(--gc-color-surface-overlay), var(--gc-color-surface-soft));
  box-shadow:
    var(--gc-shadow-sm),
    inset 0 var(--gc-border-width-default) 0 var(--gc-color-surface-solid);
  cursor: pointer;
  transition:
    border-color .2s ease,
    box-shadow .2s ease,
    transform .2s ease,
    color .2s ease,
    background .2s ease;
}

.gc-locale-select__glow {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 20% 20%, var(--gc-color-info-soft), transparent 55%),
    radial-gradient(circle at 80% 80%, var(--gc-color-primary-weak), transparent 60%);
  opacity: .45;
  pointer-events: none;
  transition: opacity .2s ease;
}

.gc-locale-select__icon,
.gc-locale-select__code,
.gc-locale-select__chevron {
  position: relative;
  z-index: 1;
}

.gc-locale-select__icon {
  display: grid;
  place-items: center;
  width: var(--gc-space-5);
  height: var(--gc-space-5);
  color: var(--gc-color-info);
}

.gc-locale-select__icon svg {
  width: var(--gc-space-5);
  height: var(--gc-space-5);
}

.gc-locale-select__code {
  min-width: var(--gc-space-6);
  color: var(--gc-color-text);
  font-size: var(--gc-font-size-xs);
  font-weight: 800;
  letter-spacing: .08em;
  line-height: 1;
}

.gc-locale-select__chevron {
  display: grid;
  place-items: center;
  width: var(--gc-size-icon-sm);
  height: var(--gc-size-icon-sm);
  color: var(--gc-color-text-muted);
  transition: transform .2s ease, color .2s ease;
}

.gc-locale-select__chevron svg {
  width: var(--gc-size-icon-sm);
  height: var(--gc-size-icon-sm);
}

.gc-locale-select--open .gc-locale-select__chevron,
.gc-locale-select__trigger:hover .gc-locale-select__chevron {
  color: var(--gc-color-primary);
}

.gc-locale-select--open .gc-locale-select__chevron {
  transform: rotate(180deg);
}

.gc-locale-select__trigger:hover,
.gc-locale-select--open .gc-locale-select__trigger {
  border-color: var(--gc-color-primary-border-strong);
  background:
    linear-gradient(160deg, var(--gc-color-surface-overlay), var(--gc-color-primary-soft));
  box-shadow:
    var(--gc-shadow-hover),
    0 0 0 var(--gc-size-focus-ring) var(--gc-color-primary-weak),
    inset 0 var(--gc-border-width-default) 0 var(--gc-color-surface-solid);
  transform: translateY(calc(var(--gc-border-width-default) * -1));
}

.gc-locale-select__trigger:hover .gc-locale-select__glow,
.gc-locale-select--open .gc-locale-select__glow {
  opacity: .85;
}

.gc-locale-select__trigger:active {
  transform: translateY(0);
}

.gc-locale-select__trigger:focus-visible {
  outline: var(--gc-size-focus-ring) solid var(--gc-color-primary-weak);
  outline-offset: var(--gc-border-width-thick);
}

.gc-locale-select__menu {
  position: absolute;
  top: calc(100% + var(--gc-space-2));
  right: 0;
  z-index: 30;
  display: grid;
  gap: var(--gc-space-1);
  min-width: var(--gc-size-locale-menu-min);
  padding: var(--gc-space-2);
  border: var(--gc-border-width-default) solid var(--gc-color-border);
  border-radius: var(--gc-radius-sm);
  background: var(--gc-color-surface-overlay);
  box-shadow: var(--gc-shadow-lg);
  backdrop-filter: blur(var(--gc-space-5)) saturate(140%);
}

.gc-locale-select__option {
  display: grid;
  grid-template-columns: var(--gc-control-height-sm) minmax(0, 1fr) var(--gc-space-4);
  align-items: center;
  gap: var(--gc-space-2);
  min-height: var(--gc-size-icon-button);
  padding: 0 var(--gc-space-control);
  border: var(--gc-border-width-default) solid transparent;
  border-radius: var(--gc-radius-control);
  color: var(--gc-color-text);
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background .16s ease, border-color .16s ease, color .16s ease;
}

.gc-locale-select__option:hover,
.gc-locale-select__option:focus-visible {
  border-color: var(--gc-color-primary-border);
  background: var(--gc-color-primary-soft);
  outline: none;
}

.gc-locale-select__option--active {
  border-color: var(--gc-color-primary-border-strong);
  background: var(--gc-color-primary-weak);
  color: var(--gc-color-primary-strong);
}

.gc-locale-select__option-code {
  color: var(--gc-color-info);
  font-size: var(--gc-font-size-caption);
  font-weight: 800;
  letter-spacing: .08em;
}

.gc-locale-select__option-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--gc-font-size-sm);
  font-weight: 700;
}

.gc-locale-select__check {
  display: grid;
  place-items: center;
  width: var(--gc-space-4);
  height: var(--gc-space-4);
  color: var(--gc-color-primary);
}

.gc-locale-select__check svg {
  width: var(--gc-size-icon-sm);
  height: var(--gc-size-icon-sm);
}

@media (prefers-reduced-motion: reduce) {
  .gc-locale-select__trigger,
  .gc-locale-select__chevron,
  .gc-locale-select__option {
    transition: none;
  }
}
</style>
