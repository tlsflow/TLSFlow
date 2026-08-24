<script setup lang="ts">
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { GcLocaleSelect, GcThemeToggle } from '@/design-system/components'

const { t } = useI18n()

const cards = [
  { titleKey: 'nav.users', path: '/settings/users', descriptionKey: 'nav.usersDesc' },
  { titleKey: 'nav.roles', path: '/settings/roles', descriptionKey: 'nav.rolesDesc' },
  { titleKey: 'nav.identitySources', path: '/settings/identity-sources', descriptionKey: 'nav.identitySourcesDesc' }
]
</script>

<template>
  <section class="gc-page settings-overview">
    <section class="settings-overview__preferences" :aria-label="t('preferences.title')">
      <div>
        <h2>{{ t('preferences.title') }}</h2>
        <p>{{ t('preferences.description') }}</p>
      </div>
      <div class="settings-overview__preference-actions">
        <GcThemeToggle />
        <GcLocaleSelect />
      </div>
    </section>

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
.settings-overview__preferences {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--gc-space-4);
  padding: 20px 22px;
  border: 1px solid var(--gc-color-border);
  border-radius: 8px;
  background: var(--gc-color-surface);
  box-shadow: var(--gc-shadow-sm);
}
.settings-overview__preferences h2 { margin: 0; color: var(--gc-color-text); font-size: 18px; letter-spacing: 0; }
.settings-overview__preferences p { margin: 6px 0 0; color: var(--gc-color-text-muted); font-size: var(--gc-font-size-sm); font-weight: 650; line-height: 1.6; }
.settings-overview__preference-actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
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
@media (max-width: 760px) {
  .settings-overview__preferences { align-items: stretch; flex-direction: column; }
}
</style>
