<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';
import { Role } from '@wmanager/shared-types';
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from 'primevue/button'
import Tag from 'primevue/tag'
import { useSearchStore } from '@/stores/search';
import GlobalProductSearch from '@/components/common/GlobalProductSearch.vue';

const searchStore = useSearchStore()
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
  <!-- Fő háttér: Nagyon világos, törtfehér/szürke (bg-slate-50), hogy a fehér kártyák kiugorjanak -->
  <div class="min-h-screen bg-slate-50 text-slate-800 flex">
    
    <!-- BAL OLDALI MENÜ: Tiszta fehér, vékony szegéllyel -->
    <aside class="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0 z-10 shadow-[4px_0_24px_rgba(0,0,0,0.02)]">
      <!-- Logó -->
      <div class="h-20 px-6 flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-orange-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/20">
          <i class="pi pi-box text-xl"></i>
        </div>
        <div>
          <span class="font-bold text-xl tracking-tight text-slate-900">WManager</span>
        </div>
      </div>

      <!-- Navigáció -->
      <nav class="flex-1 overflow-y-auto p-4 space-y-6">
        <div v-for="group in visibleMenuGroups" :key="group.title">
          <p class="px-3 mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
            {{ group.title }}
          </p>
          <ul class="space-y-1">
            <li v-for="item in group.items" :key="item.to">
              <RouterLink
                :to="item.to"
                class="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all"
                :class="
                  route.path === item.to
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'
                "
              >
                <i :class="[item.icon, 'text-lg', route.path === item.to ? 'text-orange-400' : '']"></i>
                <span>{{ item.label }}</span>
              </RouterLink>
            </li>
          </ul>
        </div>
      </nav>
    </aside>

    <!-- JOBB OLDALI TARTALOM -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- Fejléc: Fehér, finom alsó szegéllyel, keresővel (mint a képen) -->
      <header class="h-20 bg-white border-b border-slate-200 px-8 flex items-center justify-between">
        <div class="flex items-center gap-4 w-96">
          <div class="relative w-full">
            <div class="flex items-center gap-4 w-96">
  <div 
    class="relative w-full cursor-text group"
    @click="searchStore.openSearch()"
  >
    <i class="pi pi-search absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-hover:text-orange-500 transition-colors"></i>
    <div class="w-full bg-slate-100 border border-transparent rounded-full py-2.5 pl-10 pr-4 text-sm text-slate-500 group-hover:border-orange-200 transition-all flex justify-between items-center">
      <span>Keresés (Cikkszám, vonalkód)...</span>
      <span class="text-[10px] font-mono bg-white px-2 py-0.5 rounded text-slate-400 shadow-sm border border-slate-200">Ctrl K</span>
    </div>
  </div>
</div>
          </div>
        </div>

        <div class="flex items-center gap-6">
          <Tag :value="authStore.user?.role" class="bg-orange-100 text-orange-700 font-bold px-3 py-1 rounded-full" />
          <div class="flex items-center gap-3 border-l border-slate-200 pl-6">
            <div class="text-right">
              <p class="text-sm font-bold text-slate-900">{{ authStore.user?.email }}</p>
            </div>
            <div class="w-10 h-10 rounded-full bg-slate-200 border-2 border-white shadow-sm overflow-hidden flex justify-center items-center cursor-pointer" @click="handleLogout" title="Kijelentkezés">
              <i class="pi pi-user text-slate-500"></i>
            </div>
          </div>
        </div>
      </header>

      <!-- Munkaterület -->
      <main class="flex-1 p-8 overflow-y-auto">
        <RouterView />
      </main>
    </div>
    <GlobalProductSearch />
  </div>
</template>