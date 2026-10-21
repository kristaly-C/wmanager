<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'
import { useRouter } from 'vue-router'
import Button from 'primevue/button'

const authStore = useAuthStore()
const router = useRouter()

function handleLogout() {
  authStore.logout()
  router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-white p-8">
    <div class="max-w-4xl mx-auto bg-slate-900 border border-slate-800 rounded-xl p-6 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-emerald-400">Sikeres belépés a WManagerbe! 🎉</h1>
        <p class="text-slate-300 mt-2">
          Bejelentkezve mint: <strong>{{ authStore.user?.email }}</strong>
        </p>
        <p class="text-slate-400 text-sm mt-1">
          Szerepkör (Role): <span class="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded text-xs">{{ authStore.user?.role }}</span>
        </p>
      </div>
      <Button label="Kijelentkezés" icon="pi pi-sign-out" severity="danger" outlined @click="handleLogout" />
    </div>
  </div>
</template>