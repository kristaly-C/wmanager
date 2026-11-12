<script setup lang="ts">
import { useAuthStore } from '@/stores/auth';
import { ref, watch } from 'vue';
import QRCode from 'qrcode'
import apiClient from '@/api/axios';


const visible = defineModel<boolean>('visible', { default: false })
const authStore = useAuthStore()


const qrToken = ref('')
const qrImageUrl = ref('')
const isLoading = ref(false)
const errorMessage = ref('')

async function renderQr(token: string) {
    qrToken.value = token
    qrImageUrl.value = await QRCode.toDataURL(token, {
        width: 260,
        margin: 2,
        color: { dark: '#0f172a', light: '#ffffff' },
    })
}

async function loadMyQr() {
    errorMessage.value = ''
    isLoading.value = true
    try{
        const res = await apiClient.get<{ qrToken: string }>('/auth/my-qr')
        await renderQr(res.data.qrToken)
    }catch(err: any) {
        errorMessage.value = err.response?.data?.message || 'Nem sikerült betölteni a QR-kódot.'
    }finally {
        isLoading.value = false
    }
}

async function handleRegenerate() {
    if (!confirm('Biztosan új QR-kódot kérsz? A régi nyomtatott kártyád ezután nem fog működni!')) {
    return
  }
  errorMessage.value = ''
  isLoading.value = true
  try {
    const res = await apiClient.post<{ qrToken: string }>('/auth/my-qr/regenerate')
    await renderQr(res.data.qrToken)
  }catch(err: any) {
    errorMessage.value = err.response?.data?.message || 'Hiba az újragenerálás során.'
  }finally {
    isLoading.value = false
  }
}

function handlePrint(){
    window.print()
}

watch(visible, (isOpen) => {
    if(isOpen){
        loadMyQr()
    }
})


</script>

<template>
    <Dialog
      v-model:visible="visible"
      modal
      header="Saját belépő QR-kód"
      :style="{ width: '22rem' }"
    >
      <div class="flex flex-col items-center text-center gap-4 py-2">
        <Message v-if="errorMessage" severity="error" :closable="false" class="w-full">
          {{ errorMessage }}
        </Message>
        <template v-else>
          <!-- Fehér kártya a maximális kontraszthoz (hogy a kézi olvasó kijelzőről is könnyen olvassa) -->
          <div class="bg-white p-4 rounded-2xl border-2 border-slate-200 shadow-inner flex flex-col items-center">
            <img
              v-if="qrImageUrl"
              :src="qrImageUrl"
              alt="Belépő QR-kód"
              class="w-56 h-56 object-contain"
            />
            <div class="mt-2 text-slate-900 font-bold text-base">
              {{ authStore.user?.name || authStore.user?.email }}
            </div>
            <div class="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              {{ authStore.user?.role }}
            </div>
          </div>
          <p class="text-xs text-slate-400">
            Tartsd ezt a kódot a raktári PC olvasója elé az azonnali belépéshez vagy átjelentkezéshez.
          </p>
          <div class="flex gap-2 w-full mt-2">
            <Button
              label="Nyomtatás"
              icon="pi pi-print"
              severity="secondary"
              outlined
              class="flex-1"
              @click="handlePrint"
            />
            <Button
              label="Új kód"
              icon="pi pi-refresh"
              severity="warn"
              outlined
              class="flex-1"
              :loading="isLoading"
              @click="handleRegenerate"
            />
          </div>
        </template>
      </div>
    </Dialog>
  </template>