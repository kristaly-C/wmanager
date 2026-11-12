<script setup lang="ts">
import { RouterView, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import Button from 'primevue/button'
import {ref} from 'vue'
import MyQrBadgeModal from '@/components/common/MyQrBadgeModal.vue'

const isQrModalOpen = ref(false)
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
  <!-- Külső háttér PC-n is világos, középen a PDA kerettel -->
  <div class="min-h-screen bg-[#E5E7EB]/60 flex justify-center">
    <div class="min-h-screen w-full max-w-md bg-[#F3F4F6] text-slate-800 flex flex-col border-x border-slate-200/80 shadow-lg">
      
      <!-- Kompakt, világos fehér PDA fejléc -->
      <header class="bg-white border-b border-slate-200/80 px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-2.5 cursor-pointer" @click="router.push('/pda')" role="button">
          <div>
            <div class="flex items-center gap-2">
              <img src="/logo.png" alt="xStorage" class="h-5 w-auto object-contain" />
              <span class="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                PDA
              </span>
            </div>
            <span class="text-[11px] text-slate-400 block mt-0.5">{{ authStore.user?.email }}</span>
          </div>
        </div>

        <div class="flex items-center gap-1">
          <Button
            v-if="authStore.user?.role !== 'ADMIN' && authStore.user?.role !== 'BOSS'"
            icon="pi pi-qrcode"
            severity="contrast"
            text
            rounded
            size="small"
            title="Saját belépő QR-kód"
            @click="isQrModalOpen = true"
          />
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

      <MyQrBadgeModal v-model:visible="isQrModalOpen" />
    </div>
  </div>
</template>