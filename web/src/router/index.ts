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
            title: '登录',
            module: 'auth',
            requiresAuth: false,
            hiddenInMenu: true,
            breadcrumb: ['登录']
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
            title: '无权限',
            module: 'error',
            requiresAuth: false,
            hiddenInMenu: true,
            breadcrumb: ['无权限']
          }
        },
        {
          path: '/:pathMatch(.*)*',
          name: 'error.notFound',
          component: () => import('@/views/errors/NotFoundView.vue'),
          meta: {
            title: '页面不存在',
            module: 'error',
            requiresAuth: false,
            hiddenInMenu: true,
            breadcrumb: ['页面不存在']
          }
        }
      ]
    }
  ],
  scrollBehavior: () => ({ top: 0 })
})

registerRouterGuards(router)
