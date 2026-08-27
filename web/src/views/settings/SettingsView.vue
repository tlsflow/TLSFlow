<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { usePermissionStore } from '@/stores/permission.store'

const { t } = useI18n()
const permissionStore = usePermissionStore()

interface SettingsCard {
  titleKey: string
  descriptionKey: string
  path: string
  permission: string
  icon: string
}

const cards: SettingsCard[] = [
  {
    titleKey: 'tenantArchitecture.nav',
    path: '/settings/tenant-architecture',
    descriptionKey: 'tenantArchitecture.description',
    permission: 'settings.read',
    icon: 'M6 5h4v4H6V5Zm8 10h4v4h-4v-4ZM8 9v1.5a2.5 2.5 0 0 0 2.5 2.5h3A2.5 2.5 0 0 0 16 10.5V9M12 13v2',
  },
  {
    titleKey: 'nav.users',
    path: '/settings/users',
    descriptionKey: 'nav.usersDesc',
    permission: 'security.user.read',
    icon: 'M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm8 14v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  },
  {
    titleKey: 'nav.roles',
    path: '/settings/roles',
    descriptionKey: 'nav.rolesDesc',
    permission: 'security.role.read',
    icon: 'M12 3.5 19 7v5c0 4-2.4 7.5-7 9-4.6-1.5-7-5-7-9V7l7-3.5Zm-2.5 8 1.7 1.7 3.8-3.8',
  },
  {
    titleKey: 'credentials.title',
    path: '/settings/credentials',
    descriptionKey: 'credentials.description',
    permission: 'credential.read',
    icon: 'M7 10.5V8a5 5 0 0 1 10 0v2.5M5.5 10.5h13v8h-13v-8Z',
  },
  {
    titleKey: 'notifications.title',
    path: '/settings/notifications',
    descriptionKey: 'notifications.description',
    permission: 'notification.channel.read',
    icon: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  },
  {
    titleKey: 'settings.deploymentTasks.title',
    path: '/settings/deployment-tasks',
    descriptionKey: 'settings.deploymentTasks.description',
    permission: 'settings.read',
    icon: 'M9 2h6v4H9V2ZM16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2m1 7 2 2 4-4',
  },
  {
    titleKey: 'settings.licensing.title',
    path: '/settings/licensing',
    descriptionKey: 'settings.licensing.description',
    permission: 'settings.read',
    icon: 'M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 17.5v-11ZM4.5 9h15M9 12.5h2.5M9 16h4',
  },
  {
    titleKey: 'settings.version.title',
    path: '/settings/version',
    descriptionKey: 'settings.version.description',
    permission: 'settings.read',
    icon: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17ZM12 11v5M12 8v.01',
  },
]

const visibleCards = computed(() => cards.filter((card) => permissionStore.hasPermission(card.permission)))
</script>

<template>
  <section class="gc-page settings-overview">
    <section class="settings-overview__cards" :aria-label="t('settings.securityLabel')">
      <RouterLink v-for="card in visibleCards" :key="card.path" class="settings-overview__card" :to="card.path">
        <header class="settings-overview__card-header">
          <span class="settings-overview__card-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path :d="card.icon" /></svg>
          </span>
          <h2>{{ t(card.titleKey) }}</h2>
        </header>
        <p class="settings-overview__card-description">{{ t(card.descriptionKey) }}</p>
        <span class="settings-overview__card-action">
          {{ t('common.enter') }}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
        </span>
      </RouterLink>
    </section>
  </section>
</template>

<style scoped>
.settings-overview { display: grid; gap: var(--gc-space-5); }
.settings-overview__cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(calc(var(--gc-space-10) * 6), 1fr)); gap: var(--gc-space-4); }
.settings-overview__card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--gc-space-4);
  min-height: var(--gc-size-card-min);
  padding: var(--gc-space-6);
  color: inherit;
  text-decoration: none;
  border: var(--gc-border-width-default) solid var(--gc-color-border-subtle);
  border-radius: var(--gc-radius-xl);
  background: var(--gc-color-surface-workspace-glass);
  box-shadow: var(--gc-shadow-card);
  backdrop-filter: blur(var(--gc-space-4));
  -webkit-backdrop-filter: blur(var(--gc-space-4));
  transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease, background .16s ease;
}
.settings-overview__card-header { display: flex; align-items: center; gap: var(--gc-space-3); min-width: 0; }
.settings-overview__card-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: var(--gc-space-10);
  height: var(--gc-space-10);
  border-radius: var(--gc-radius-md);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
  transition: color .16s ease, background .16s ease;
}
.settings-overview__card-icon svg {
  width: var(--gc-size-icon-md);
  height: var(--gc-size-icon-md);
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: var(--gc-border-width-thick);
}
.settings-overview__card h2 {
  margin: 0;
  min-width: 0;
  color: var(--gc-color-text-strong);
  font-size: var(--gc-font-size-body-lg);
  font-weight: 800;
  letter-spacing: 0;
}
.settings-overview__card-description {
  margin: 0;
  color: var(--gc-color-text-muted);
  font-size: var(--gc-font-size-sm);
  line-height: var(--gc-line-height-relaxed);
  font-weight: 600;
}
.settings-overview__card-action {
  align-self: flex-start;
  margin-top: auto;
  display: inline-flex;
  align-items: center;
  gap: var(--gc-space-2);
  min-height: var(--gc-control-height-sm);
  padding: 0 var(--gc-space-4);
  border: var(--gc-border-width-default) solid var(--gc-color-primary-border);
  border-radius: var(--gc-radius-pill);
  color: var(--gc-color-primary);
  background: var(--gc-color-primary-soft);
  font-size: var(--gc-font-size-sm);
  font-weight: 700;
  transition: color .16s ease, background .16s ease, border-color .16s ease, box-shadow .16s ease;
}
.settings-overview__card-action svg {
  width: var(--gc-size-icon-sm);
  height: var(--gc-size-icon-sm);
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: var(--gc-border-width-thick);
  transition: transform .16s ease;
}
.settings-overview__card:hover {
  border-color: var(--gc-color-primary-border-strong);
  box-shadow: var(--gc-shadow-md);
  transform: translateY(calc(var(--gc-space-hairline) * -2));
}
.settings-overview__card:hover .settings-overview__card-icon {
  color: var(--gc-color-primary-hover);
  background: var(--gc-color-primary-bg);
}
.settings-overview__card:hover .settings-overview__card-action {
  color: var(--gc-color-surface-solid);
  border-color: var(--gc-color-primary-strong);
  background: var(--gc-color-primary-strong);
  box-shadow: var(--gc-shadow-primary);
}
.settings-overview__card:hover .settings-overview__card-action svg { transform: translateX(var(--gc-space-1)); }
.settings-overview__card:focus-visible {
  outline: none;
  border-color: var(--gc-color-primary-border-strong);
  box-shadow: var(--gc-shadow-focus);
}
@media (prefers-reduced-motion: reduce) {
  .settings-overview__card,
  .settings-overview__card-icon,
  .settings-overview__card-action,
  .settings-overview__card-action svg { transition: none; }
}
</style>
