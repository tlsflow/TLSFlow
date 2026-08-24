import { createRouter, createWebHistory } from 'vue-router'
import ShellLayout from '@/layouts/ShellLayout.vue'
import BlankLayout from '@/layouts/BlankLayout.vue'
import AuthLayout from '@/layouts/AuthLayout.vue'
import { businessRoutes } from './modules/business'
import { coreRoutes } from './modules/core'
import { registerRouterGuards } from './guards'

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', redirect: '/dashboard' },
    {
      path: '/',
      component: AuthLayout,
      children: [
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
