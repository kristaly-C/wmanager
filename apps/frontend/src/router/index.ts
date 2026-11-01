import MainLayout from '@/layouts/MainLayout.vue'
import PdaLayout from '@/layouts/PdaLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { isPdaOrMobileDevice } from '@/utils/device'
import CategoriesView from '@/views/CategoriesView.vue'
import DashboardView from '@/views/DashboardView.vue'
import LoginView from '@/views/LoginView.vue'
import PdaHomeView from '@/views/PdaHomeView.vue'
import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: LoginView,
      meta: { requiresGuest: true }
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
          path: 'categories',
          name: 'categories',
          component: CategoriesView,
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
        }
      ]
    }
  ],
})


router.beforeEach(async(to) => {
  const authStore = useAuthStore()


  if(!authStore.isInitialized) {
    await authStore.fetchMe()
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return { name: 'login' }
  }

  if (to.meta.requiresGuest && authStore.isAuthenticated) {
    return isPdaOrMobileDevice() ? {path:'/pda'} : {name: 'dashboard'}
  }

  if(to.path === '/' && isPdaOrMobileDevice()) {
    return {path: '/pda'}
  }
})

export default router
