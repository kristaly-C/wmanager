<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSearchStore } from '@/stores/search'
import { useWorkspaceStore, type WorkspaceId } from '@/stores/workspace'
import GlobalProductSearch from '@/components/common/GlobalProductSearch.vue'
import Select from 'primevue/select'
import Tag from 'primevue/tag'

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const searchStore = useSearchStore()
const workspaceStore = useWorkspaceStore()

// Amikor a felhasználó munkaterületet vált a legördülőben
function onWorkspaceChange(newId: WorkspaceId) {
  workspaceStore.setWorkspace(newId)
  // Átnavigálunk az adott munkaterület első menüpontjára (Dashboardra)
  const firstNav = workspaceStore.activeWorkspace?.navItems[0]
  if (firstNav) {
    router.push(firstNav.to)
  }
}

function handleLogout() {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <!-- Világosszürke háttér, hogy a fehér Bento-kártyák kiugorjanak (mint a képen) -->
  <div class="min-h-screen bg-[#F3F4F6] text-slate-800 flex flex-col">
    
    <!-- FELSŐ NAVIGÁCIÓS SÁV (FleetTrack stílusban) -->
    <header class="w-full max-w-[1440px] mx-auto px-4 sm:px-6 pt-4 pb-2 flex flex-wrap xl:grid xl:grid-cols-3 items-center justify-between gap-3">
      
      <!-- 1. BAL OLDAL: Logó + Munkaterület-választó -->
      <div class="flex items-center gap-2.5 shrink-0 order-1">
        <div class="w-10 h-10 rounded-2xl bg-orange-500 text-white flex items-center justify-center shadow-lg shadow-orange-500/25 shrink-0">
          <i class="pi pi-box text-lg"></i>
        </div>
        <span class="font-bold text-xl tracking-tight text-slate-900 hidden sm:inline">WManager</span>

        <!-- Munkaterület-váltó (Select), ha több munkaterülethez is van joga -->
        <Select
          v-if="workspaceStore.availableWorkspaces.length > 1"
          :modelValue="workspaceStore.activeWorkspace?.id"
          @update:modelValue="onWorkspaceChange"
          :options="workspaceStore.availableWorkspaces"
          optionLabel="label"
          optionValue="id"
          class="ml-1 !rounded-xl !border-slate-200 !bg-white !text-xs font-semibold shadow-sm"
        />
        <!-- Ha csak 1 munkaterülethez van joga, sima címkeként írjuk ki -->
        <span
          v-else-if="workspaceStore.activeWorkspace"
          class="ml-1 px-3 py-1.5 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-600 shadow-sm whitespace-nowrap"
        >
          {{ workspaceStore.activeWorkspace.label }}
        </span>
      </div>

      <div
        v-if="workspaceStore.activeWorkspace"
        class="order-3 xl:order-2 w-full xl:w-auto flex justify-center xl:justify-self-center"
      >
      <!-- 2. KÖZÉPSŐ RÉSZ: Lebegő Kapszula-menü (Top Pill Bar) -->
      <nav
        v-if="workspaceStore.activeWorkspace"
        class="bg-white/90 backdrop-blur-md border border-white rounded-2xl p-1.5 shadow-sm flex items-center gap-1 overflow-x-auto max-w-full"
      >
        <RouterLink
          v-for="item in workspaceStore.activeWorkspace.navItems"
          :key="item.to"
          :to="item.to"
          :title="item.label"
          class="flex items-center gap-2 rounded-xl text-sm font-semibold transition-all duration-200 whitespace-nowrap shrink-0"
          :class="
            route.path === item.to
              ? 'bg-slate-900 text-white px-4 py-2 shadow-md'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100 px-3 py-2'
          "
        >
          <i :class="[item.icon, 'text-base']"></i>
          <!-- Csak az aktív menüpont szövegét írjuk ki, ahogy a referencia képen! -->
          <span v-if="route.path === item.to">{{ item.label }}</span>
        </RouterLink>
      </nav>
    </div>


      <!-- 3. JOBB OLDAL: Kereső kapszula + Értesítés + Profil -->
      <div class="flex items-center gap-2.5 shrink-0 order-2 xl:order-3 xl:justify-self-end">
        <!-- Kereső gomb (Ctrl + K) -->
        <button
          type="button"
          @click="searchStore.openSearch()"
          class="w-10 h-10 md:w-44 xl:w-60 bg-white border border-white rounded-2xl md:py-2 md:px-3.5 text-sm text-slate-400 hover:border-orange-200 shadow-sm transition-all flex justify-center md:justify-between items-center cursor-pointer md:cursor-text group shrink-0"
          title="Keresés (Ctrl + K)"
          >
          <span class="flex items-center gap-2">
            <i class="pi pi-search text-slate-500 md:text-slate-400 group-hover:text-orange-500 transition-colors"></i>
            <span class="hidden md:inline truncate">Keresés...</span>
          </span>
          <span class="hidden xl:inline text-[10px] font-mono bg-slate-100 px-2 py-0.5 rounded-md text-slate-500 shrink-0">
            Ctrl K
          </span>
        </button>

        <!-- Szerepkör jelvény -->
        <Tag
          :value="authStore.user?.role"
          class="!hidden sm:!inline-flex !bg-white !text-slate-700 !border !border-slate-200 !font-bold !px-3 !py-2 !rounded-2xl shadow-sm whitespace-nowrap text-xs"
        />

        <!-- Profil / Kijelentkezés gomb -->
        <button
          type="button"
          @click="handleLogout"
          :title="`Kijelentkezés (${authStore.user?.email})`"
          class="w-10 h-10 rounded-2xl bg-slate-900 text-white hover:bg-orange-500 transition-colors shadow-sm flex justify-center items-center cursor-pointer shrink-0"
        >
          <i class="pi pi-user text-sm"></i>
        </button>
      </div>
    </header>

    <!-- FŐ TARTALOM (Bento-grid munkaterület) -->
    <main class="flex-1 w-full max-w-[1440px] mx-auto px-6 py-6">
      <RouterView />
    </main>

    <!-- Globális kereső Drawer -->
    <GlobalProductSearch />
  </div>
</template>