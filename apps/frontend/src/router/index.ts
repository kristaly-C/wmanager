import MainLayout from '@/layouts/MainLayout.vue'
import PdaLayout from '@/layouts/PdaLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { isPdaOrMobileDevice } from '@/utils/device'
import CatalogView from '@/views/CatalogView.vue'
import DashboardView from '@/views/DashboardView.vue'
import LoginView from '@/views/LoginView.vue'
import PdaHomeView from '@/views/PdaHomeView.vue'
import UsersView from '@/views/UsersView.vue'
import { Role } from '@wmanager/shared-types'
import { createRouter, createWebHistory } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    requiresAuth?: boolean
    requiresGuest?: boolean
    allowedRoles?: Role[]
  }
}

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { requiresGuest: true },
    },
    {
      path: '/',
      component: MainLayout,
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'dashboard',
          component: DashboardView,
        },
        {
          path: 'catalog',
          name: 'catalog',
          component: CatalogView,
          meta: {
            allowedRoles: [
              Role.ADMIN,
              Role.BOSS,
              Role.ORDER_CLERK,
              Role.WAREHOUSE_MANAGER,
              Role.STORE_MANAGER,
            ],
          },
        },
        {
          path: 'users',
          name: 'users',
          component: UsersView,
          meta: {
            allowedRoles: [
              Role.ADMIN,
              Role.BOSS,
              Role.WAREHOUSE_MANAGER,
              Role.STORE_MANAGER,
            ],
          },
        },
      ],
    },
    {
      path: '/pda',
      component: PdaLayout,
      meta: { requiresAuth: true },
      children: [
        {
          path: '',
          name: 'pda-home',
          component: PdaHomeView,
        },
      ],
    },
  ],
})

router.beforeEach(async (to) => {
  const authStore = useAuthStore()

  if (!authStore.isInitialized) {
    await authStore.fetchMe()
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { name: 'login' }
  }

  if (to.meta.requiresGuest && authStore.isAuthenticated) {
    return isPdaOrMobileDevice() ? { path: '/pda' } : { name: 'dashboard' }
  }

  // Szerepkör-alapú (RBAC) útvonalvédelem
  const allowedRoles = to.meta.allowedRoles
  if (allowedRoles && allowedRoles.length > 0) {
    const userRole = authStore.user?.role
    if (!userRole || !allowedRoles.includes(userRole)) {
      return isPdaOrMobileDevice() ? { path: '/pda' } : { name: 'dashboard' }
    }
  }

  if (to.path === '/' && isPdaOrMobileDevice()) {
    return { path: '/pda' }
  }
})

export default router
