import { createRouter, createWebHistory } from 'vue-router'
import ShellLayout from '@/layouts/ShellLayout.vue'
import BlankLayout from '@/layouts/BlankLayout.vue'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { businessRoutes } from './modules/business'
import { coreRoutes } from './modules/core'
import { registerRouterGuards } from './guards'
import { normalizeInternalRedirectPath } from './redirect'

const initializationPreviewEnabled = import.meta.env.DEV

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      redirect: (to) => normalizeInternalRedirectPath(to.query.from, '/dashboard')
    },
    {
      path: '/',
      component: AuthLayout,
      children: [
        {
          path: '/system/initialization',
          name: 'system.initialization',
          component: () => import('@/views/system-initialization/SystemInitializationView.vue'),
          meta: {
            title: 'System initialization',
            titleKey: 'systemInitialization.title',
            module: 'system',
            requiresAuth: false,
            hiddenInMenu: true,
            breadcrumbKeys: ['systemInitialization.title']
          }
        },
        ...(initializationPreviewEnabled
          ? [{
              path: '/__debug/system-initialization',
              name: 'system.initialization.preview',
              component: () => import('@/views/system-initialization/SystemInitializationView.vue'),
              meta: {
                title: 'System initialization preview',
                titleKey: 'systemInitialization.preview.title',
                module: 'system',
                requiresAuth: false,
                hiddenInMenu: true,
                initializationPreview: true,
                breadcrumbKeys: ['systemInitialization.preview.title']
              }
            }]
          : []),
        {
          path: '/login',
          name: 'login',
          component: () => import('@/views/auth/LoginView.vue'),
          meta: {
            title: 'Login',
            titleKey: 'login.welcome',
            module: 'auth',
            requiresAuth: false,
            hiddenInMenu: true,
            breadcrumbKeys: ['login.welcome']
          }
        },
      ]
    },
    {
      path: '/',
      component: ShellLayout,
      children: [...coreRoutes, ...businessRoutes]
    },
    {
      path: '/',
      component: BlankLayout,
      children: [
        {
          path: '/403',
          name: 'error.forbidden',
          component: () => import('@/views/errors/ForbiddenView.vue'),
          meta: {
            title: 'Forbidden',
            titleKey: 'errors.forbiddenTitle',
            module: 'error',
            requiresAuth: false,
            hiddenInMenu: true,
            breadcrumbKeys: ['errors.forbiddenTitle']
          }
        },
        {
          path: '/:pathMatch(.*)*',
          name: 'error.notFound',
          component: () => import('@/views/errors/NotFoundView.vue'),
          meta: {
            title: 'Not Found',
            titleKey: 'errors.notFoundTitle',
            module: 'error',
            requiresAuth: false,
            hiddenInMenu: true,
            breadcrumbKeys: ['errors.notFoundTitle']
          }
        }
      ]
    }
  ],
  scrollBehavior: () => ({ top: 0 })
})

registerRouterGuards(router)
