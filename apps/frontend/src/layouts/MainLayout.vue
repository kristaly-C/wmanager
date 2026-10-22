<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';
import { Role } from '@wmanager/shared-types';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button'
import Tag from 'primevue/tag'



const authStore = useAuthStore()
const router = useRouter()
const route = useRoute()


interface MenuItem {
    label: string
    icon: string
    to: string
    roles?: Role[]
}

interface MenuGroup {
    title: string
    items: MenuItem[]
}

const MenuGroups: MenuGroup[] = [
    {
        title: 'Áttekintés',
        items: [
            {label: 'Dashboard', icon: 'pi pi-home', to: '/'},
        ],
    },
    {
        title: 'Raktáei Műveletek (Raktári PC)',
        items: [
            {
            label: 'Aktuális készlet',
            icon: 'pi pi-box',
            to: '/inventory',
            },
            {
            label: 'Bevételezés & Rendelések',
            icon: 'pi pi-truck',
            to: '/purchase-orders',
            roles: [Role.ADMIN, Role.WAREHOUSE_MANAGER, Role.WAREHOUSE_STAFF, Role.ORDER_CLERK],
            },
            {
            label: 'Készletmozgatás',
            icon: 'pi pi-arrows-h',
            to: '/transfers',
            roles: [Role.ADMIN, Role.WAREHOUSE_MANAGER, Role.WAREHOUSE_STAFF, Role.STORE_MANAGER, Role.STORE_STAFF],
            },
            {
                label: 'Visszáru (RMA)',
                icon: 'pi pi-replay',
                to: '/returns',
                roles: [ Role.ADMIN, Role.RMA_CLERK, Role.STORE_MANAGER],
            },
        ],
    },
    {
    title: 'Törzsadatok & Iroda',
    items: [
      {
        label: 'Termékek & Variánsok',
        icon: 'pi pi-tags',
        to: '/products',
        roles: [Role.BOSS, Role.ADMIN, Role.STORE_MANAGER, Role.ORDER_CLERK, Role.WAREHOUSE_MANAGER],
      },
      {
        label: 'Kategóriák',
        icon: 'pi pi-sitemap',
        to: '/categories',
        roles: [Role.BOSS, Role.ADMIN, Role.STORE_MANAGER, Role.ORDER_CLERK],
      },
      {
        label: 'Beszállítók',
        icon: 'pi pi-building',
        to: '/suppliers',
        roles: [Role.BOSS, Role.ADMIN, Role.ORDER_CLERK, Role.WAREHOUSE_MANAGER],
      },
      {
        label: 'Raktárhelyek (Polcok)',
        icon: 'pi pi-map-marker',
        to: '/locations',
        roles: [Role.BOSS, Role.ADMIN, Role.WAREHOUSE_MANAGER],
      },
      {
        label: 'Felhasználók',
        icon: 'pi pi-users',
        to: '/users',
        roles: [Role.BOSS, Role.ADMIN],
      },
    ],
  },
]


// Kiszűrjük azokat a menüpontokat, amikhez a belépett usernek van jogosultsága
const visibleMenuGroups = computed(() => {
  const userRole = authStore.user?.role
  if (!userRole) return []

  return MenuGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || item.roles.includes(userRole)),
    }))
    .filter((group) => group.items.length > 0)
})

function switchToPdaMode() {
  localStorage.setItem('preferredViewMode', 'pda')
  router.push('/pda')
}

function handleLogout() {
  authStore.logout()
  router.push('/login')
}

</script>

<template>
    <div class="min-h-screen bg-slate-950 text-slate-100 flex">
    <!-- BAL OLDALI FIX MENÜ (SIDEBAR) -->
    <aside class="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0">
      <!-- Logó / Brand -->
      <div class="h-16 px-6 flex items-center gap-3 border-b border-slate-800">
        <div class="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
          <i class="pi pi-box text-xl"></i>
        </div>
        <div>
          <span class="font-bold text-lg tracking-tight text-white">WManager</span>
          <span class="block text-[10px] uppercase tracking-wider text-emerald-400 font-semibold">Moto WMS</span>
        </div>
      </div>

      <!-- Navigációs linkek -->
      <nav class="flex-1 overflow-y-auto p-4 space-y-6">
        <div v-for="group in visibleMenuGroups" :key="group.title">
          <p class="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            {{ group.title }}
          </p>
          <ul class="space-y-1">
            <li v-for="item in group.items" :key="item.to">
              <RouterLink
                :to="item.to"
                class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors"
                :class="
                  route.path === item.to
                    ? 'bg-emerald-500/15 text-emerald-400'
                    : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
                "
              >
                <i :class="[item.icon, 'text-base']"></i>
                <span>{{ item.label }}</span>
              </RouterLink>
            </li>
          </ul>
        </div>
      </nav>

      <!-- Alsó PDA váltó gomb -->
      <div class="p-4 border-t border-slate-800">
        <Button
          label="Váltás PDA módra"
          icon="pi pi-mobile"
          severity="secondary"
          outlined
          size="small"
          class="w-full"
          @click="switchToPdaMode"
        />
      </div>
    </aside>

    <!-- JOBB OLDALI TARTALOM (FEJLÉC + MUNKATERÜLET) -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Felső sáv (Topbar) -->
      <header class="h-16 bg-slate-900/70 backdrop-blur border-b border-slate-800 px-8 flex items-center justify-between">
        <div class="flex items-center gap-2 text-slate-400 text-sm">
          <i class="pi pi-qrcode text-emerald-400"></i>
          <span>USB Scanner készenlétben</span>
        </div>

        <div class="flex items-center gap-4">
          <div class="text-right">
            <p class="text-sm font-medium text-slate-200">{{ authStore.user?.email }}</p>
          </div>
          <Tag :value="authStore.user?.role" severity="success" />
          <Button
            icon="pi pi-sign-out"
            severity="danger"
            text
            rounded
            title="Kijelentkezés"
            @click="handleLogout"
          />
        </div>
      </header>

      <!-- Dinamikus oldal-tartalom (Ide töltődnek be a View-k!) -->
      <main class="flex-1 p-8 overflow-y-auto">
        <RouterView />
      </main>
    </div>
  </div>
</template>