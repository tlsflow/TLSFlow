<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

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
.settings-overview__cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(calc(var(--gc-space-10) * 6), 1fr)); gap: var(--gc-space-4); }
.settings-overview__card {
  position: relative;
  display: grid;
  gap: var(--gc-space-3);
  min-height: var(--gc-size-card-min);
  padding: var(--gc-space-6);
  overflow: hidden;
  color: inherit;
  text-decoration: none;
  border-color: var(--gc-color-border-soft);
  background: var(--gc-color-surface-glass);
  transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease;
}
.settings-overview__card::before {
  content: "";
  position: absolute;
  inset: 0 0 auto;
  height: var(--gc-space-1);
  background: var(--gc-gradient-brand);
}
.settings-overview__card:hover { transform: translateY(calc(var(--gc-space-hairline) * -2)); border-color: var(--gc-color-primary); box-shadow: var(--gc-shadow-md); }
.settings-overview__card:focus-visible { outline: var(--gc-border-width-thick) solid var(--gc-color-primary-weak); outline-offset: var(--gc-space-1); }
.settings-overview__card h2 { margin: 0; color: var(--gc-color-text); font-size: var(--gc-font-size-lg); letter-spacing: 0; }
.settings-overview__card span { color: var(--gc-color-text-muted); line-height: 1.6; font-weight: 650; }
.settings-overview__card strong {
  align-self: end;
  justify-self: start;
  display: inline-flex;
  align-items: center;
  min-height: var(--gc-control-height-sm);
  padding: 0 var(--gc-space-4);
  border-radius: var(--gc-radius-pill);
  color: var(--gc-color-surface-solid);
  background: var(--gc-color-primary-strong);
  box-shadow: var(--gc-shadow-primary);
  font-size: var(--gc-font-size-sm);
  font-weight: 850;
}
.settings-overview__card:hover strong { background: var(--gc-color-primary-strong); }
</style>
