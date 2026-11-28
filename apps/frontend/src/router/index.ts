import MainLayout from '@/layouts/MainLayout.vue'
import PdaLayout from '@/layouts/PdaLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { isPdaOrMobileDevice } from '@/utils/device'
import CatalogView from '@/views/CatalogView.vue'
import ControlPanelView from '@/views/ControlPanelView.vue'
import DashboardView from '@/views/DashboardView.vue'
import InventoryView from '@/views/InventoryView.vue'
import LoginView from '@/views/LoginView.vue'
import PdaHomeView from '@/views/PdaHomeView.vue'
import StockMovementsView from '@/views/StockMovementsView.vue'
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
          path: 'inventory',
          name: 'inventory',
          component: InventoryView,
          meta: {
            allowedRoles: [
              Role.ADMIN,
              Role.BOSS,
              Role.WAREHOUSE_MANAGER,
              Role.STORE_MANAGER,
              Role.WAREHOUSE_STAFF,
              Role.STORE_STAFF,
              Role.ORDER_CLERK,
            ],
          },
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
        {
          path: 'movements',
          name: 'movements',
          component: StockMovementsView,
          meta: {
            allowedRoles: [
              Role.ADMIN,
              Role.BOSS,
              Role.WAREHOUSE_MANAGER,
              Role.STORE_MANAGER,
            ],
          },
        },
        {
          path: 'stock-lookup',
          redirect: '/inventory',
        },
        {
          path: 'purchase-orders',
          name: 'purchase-orders',
          component: () => import('@/views/PurchaseOrdersView.vue'),
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
          path: 'orders',
          name: 'orders',
          component: () => import('@/views/OrdersView.vue'),
          meta: {
            allowedRoles: [
              Role.ADMIN,
              Role.BOSS,
              Role.ORDER_CLERK,
              Role.WAREHOUSE_MANAGER,
              Role.STORE_MANAGER,
              Role.WAREHOUSE_STAFF,
              Role.STORE_STAFF,
            ],
          },
        },
        {
          path: 'shipments',
          name: 'shipments',
          component: () => import('@/views/ShipmentsView.vue'),
          meta: {
            allowedRoles: [
              Role.ADMIN,
              Role.BOSS,
              Role.WAREHOUSE_MANAGER,
              Role.STORE_MANAGER,
              Role.WAREHOUSE_STAFF,
              Role.STORE_STAFF,
              Role.ORDER_CLERK,
            ],
          },
        },
        {
          path: 'analytics',
          name: 'analytics',
          component: () => import('@/views/AnalyticsView.vue'),
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
          path: 'control-panel',
          name: 'control-panel',
          component: ControlPanelView,
          meta: {
            allowedRoles: [Role.ADMIN, Role.BOSS],
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
        {
          path: 'receiving',
          name: 'pda-receiving',
          component: () => import('@/views/PdaReceivingListView.vue'),
          meta: {
            allowedRoles: [
              Role.ADMIN,
              Role.BOSS,
              Role.WAREHOUSE_MANAGER,
              Role.STORE_MANAGER,
              Role.WAREHOUSE_STAFF,
              Role.STORE_STAFF,
            ],
          },
        },
        {
          path: 'receiving/:id',
          name: 'pda-putaway',
          component: () => import('@/views/PdaPutawayView.vue'),
          meta: {
            allowedRoles: [
              Role.ADMIN,
              Role.BOSS,
              Role.WAREHOUSE_MANAGER,
              Role.STORE_MANAGER,
              Role.WAREHOUSE_STAFF,
              Role.STORE_STAFF,
            ],
          },
        },
        {
          path: 'picking',
          name: 'pda-picking',
          component: () => import('@/views/PdaPickingView.vue'),
          meta: {
            allowedRoles: [
              Role.ADMIN,
              Role.BOSS,
              Role.WAREHOUSE_MANAGER,
              Role.STORE_MANAGER,
              Role.WAREHOUSE_STAFF,
              Role.STORE_STAFF,
            ],
          },
        },
      ],
    },
    {
      path: '/:pathMatch(.*)*',
      redirect: '/',
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
