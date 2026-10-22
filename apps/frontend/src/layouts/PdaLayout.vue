<script setup lang="ts">
import { RouterView, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import Button from 'primevue/button'
import Tag from 'primevue/tag'
const authStore = useAuthStore()
const router = useRouter()

function switchToDesktopMode() {
  localStorage.setItem('preferredViewMode', 'desktop')
  router.push('/')
}

function handleLogout() {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <!-- PDA méretre optimalizált, középütt elhelyezkedő mobil keret -->
  <div class="min-h-screen bg-slate-950 text-white flex flex-col max-w-md mx-auto border-x border-slate-800 shadow-2xl">
    <!-- Kompakt PDA fejléc -->
    <header class="bg-slate-900 border-b border-slate-800 px-4 py-3 flex items-center justify-between">
      <div class="flex items-center gap-2" @click="router.push('/pda')" role="button">
        <i class="pi pi-qrcode text-emerald-400 text-xl"></i>
        <div>
          <span class="font-bold text-sm block leading-none">WManager PDA</span>
          <span class="text-[11px] text-slate-400">{{ authStore.user?.email }}</span>
        </div>
      </div>

      <div class="flex items-center gap-1">
        <Button
          icon="pi pi-desktop"
          severity="secondary"
          text
          rounded
          size="small"
          title="Asztali (PC) nézet"
          @click="switchToDesktopMode"
        />
        <Button
          icon="pi pi-sign-out"
          severity="danger"
          text
          rounded
          size="small"
          title="Kilépés"
          @click="handleLogout"
        />
      </div>
    </header>

    <!-- PDA tartalom -->
    <main class="flex-1 p-4 overflow-y-auto">
      <RouterView />
    </main>
  </div>
</template>