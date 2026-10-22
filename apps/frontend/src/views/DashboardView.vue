<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-bold text-white">Áttekintés (Dashboard)</h1>
      <p class="text-slate-400 text-sm mt-1">
        Üdv újra a rendszerben, <span class="text-emerald-400 font-medium">{{ authStore.user?.email }}</span>!
      </p>
    </div>

    <!-- Gyors KPI kártyák helyőrzői -->
    <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <span class="text-xs uppercase tracking-wider text-slate-400">Aktív Termékek</span>
        <p class="text-3xl font-bold text-white mt-2">—</p>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <span class="text-xs uppercase tracking-wider text-slate-400">Függő Bevételezések</span>
        <p class="text-3xl font-bold text-amber-400 mt-2">—</p>
      </div>
      <div class="bg-slate-900 border border-slate-800 rounded-xl p-5">
        <span class="text-xs uppercase tracking-wider text-slate-400">Nyitott Visszáruk (RMA)</span>
        <p class="text-3xl font-bold text-rose-400 mt-2">—</p>
      </div>
    </div>
  </div>
</template>