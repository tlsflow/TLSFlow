<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { GcLocaleSelect, GcPageToolbar, GcThemeToggle } from '@/design-system/components'

const { t } = useI18n()
const shouldTeleportToolbarActions = computed(() => typeof document !== 'undefined' && Boolean(document.querySelector('#gc-shell-hero-leading')))

const cards = [
  { titleKey: 'settings.version.title', path: '/settings/version', descriptionKey: 'settings.version.description' },
  { titleKey: 'notifications.title', path: '/settings/notifications', descriptionKey: 'notifications.description' },
  { titleKey: 'nav.users', path: '/settings/users', descriptionKey: 'nav.usersDesc' },
  { titleKey: 'nav.roles', path: '/settings/roles', descriptionKey: 'nav.rolesDesc' },
  { titleKey: 'nav.identitySources', path: '/settings/identity-sources', descriptionKey: 'nav.identitySourcesDesc' }
]
</script>

<template>
  <section class="gc-page settings-overview">
    <Teleport to="#gc-shell-hero-leading" :disabled="!shouldTeleportToolbarActions">
      <GcPageToolbar>
        <template #actions>
          <GcThemeToggle />
          <GcLocaleSelect />
        </template>
      </GcPageToolbar>
    </Teleport>

    <section class="settings-overview__cards" :aria-label="t('settings.securityLabel')">
      <RouterLink v-for="card in cards" :key="card.path" class="gc-card settings-overview__card" :to="card.path">
        <h2>{{ t(card.titleKey) }}</h2>
        <span>{{ t(card.descriptionKey) }}</span>
        <strong>{{ t('common.enter') }}</strong>
      </RouterLink>
    </section>
  </section>
</template>

<style scoped>
.settings-overview { display: grid; gap: var(--gc-space-5); }
.settings-overview__cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: var(--gc-space-4); }
.settings-overview__card {
  position: relative;
  display: grid;
  gap: 12px;
  min-height: 170px;
  padding: 24px;
  overflow: hidden;
  color: inherit;
  text-decoration: none;
  border-color: var(--gc-color-border);
  background: var(--gc-color-surface);
  transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
}
.settings-overview__card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: 4px;
  background: linear-gradient(90deg, var(--gc-color-primary-strong), var(--gc-color-success));
}
.settings-overview__card:hover { transform: translateY(-2px); border-color: var(--gc-color-primary); box-shadow: var(--gc-shadow-md); }
.settings-overview__card:focus-visible { outline: 3px solid var(--gc-color-primary-weak); outline-offset: 3px; }
.settings-overview__card h2 { margin: 0; color: var(--gc-color-text); font-size: 22px; letter-spacing: 0; }
.settings-overview__card span { color: var(--gc-color-text-muted); line-height: 1.6; font-weight: 650; }
.settings-overview__card strong {
  align-self: end;
  justify-self: start;
  display: inline-flex;
  align-items: center;
  min-height: 36px;
  padding: 0 16px;
  border-radius: 999px;
  color: var(--gc-color-surface-solid);
  background: var(--gc-color-primary-strong);
  box-shadow: 0 10px 18px var(--gc-color-primary-weak);
  font-size: var(--gc-font-size-sm);
  font-weight: 850;
}
.settings-overview__card:hover strong { background: var(--gc-color-primary-strong); }
</style>
