<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// PrimeVue komponensek importálása
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Message from 'primevue/message'

import { useQrBadgeScanner } from '@/composables/useQrBadgeScanner'
import { isPdaOrMobileDevice } from '@/utils/device'

const router = useRouter()
const authStore = useAuthStore()

// Űrlap mezők reaktív változói
const email = ref('')
const password = ref('')
const errorMessage = ref('')
const isLoading = ref(false)

async function handleLogin() {
  errorMessage.value = ''
  isLoading.value = true

  try {
    await authStore.login(email.value, password.value)
    // Ha sikeres a belépés, átirányítjuk a főoldalra (Dashboard)
    router.push('/')
  } catch (error: any) {
    const status = error.response?.status
    if (status === 401) {
      errorMessage.value = 'Hibás e-mail cím vagy jelszó (vagy inaktív fiók).'
    } else if (status === 429) {
      errorMessage.value = 'Túl sok sikertelen próbálkozás. Kérlek, várj 1 percet, majd próbáld újra!'
    } else {
      errorMessage.value = 'Nem sikerült csatlakozni a szerverhez.'
    }
  } finally {
    isLoading.value = false
  }
}


useQrBadgeScanner(async (qrToken) => {
  errorMessage.value = ''
  isLoading.value = true

  try{
    await authStore.loginWithQr(qrToken)
    router.push(isPdaOrMobileDevice() ? '/pda' : '/')
  }catch ( error: any) {
    errorMessage.value = error.response?.data?.message || 'Érvénytelen vagy nem engedélyezett QR-kód.'
  }finally {
    isLoading.value = false
  }

})
</script>

<template>
  <div class="min-h-screen bg-[#F3F4F6] flex items-center justify-center p-4">
    <!-- Bejelentkező kártya (Bento fehér stílusban) -->
    <div class="w-full max-w-md bg-white border border-white rounded-3xl p-8 sm:p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
      
      <!-- Fejléc / Logó -->
      <div class="text-center mb-8">
        <img src="/logo.png" alt="xStorage" class="h-9 w-auto mx-auto mb-3 object-contain" />
        <p class="text-slate-400 text-sm">Jelentkezz be a raktárkezelő rendszerbe</p>
      </div>

      <!-- Hibaüzenet -->
      <Message v-if="errorMessage" severity="error" :closable="false" class="mb-6">
        {{ errorMessage }}
      </Message>

      <!-- Bejelentkező űrlap -->
      <form @submit.prevent="handleLogin" class="flex flex-col gap-5">
        <div class="flex flex-col gap-2">
          <label for="email" class="text-xs font-bold uppercase tracking-wider text-slate-500">E-mail cím</label>
          <InputText
            id="email"
            v-model="email"
            type="email"
            placeholder="pelda@shox.hu"
            autofocus
            required
            fluid
            class="!rounded-xl"
          />
        </div>

        <div class="flex flex-col gap-2">
          <label for="password" class="text-xs font-bold uppercase tracking-wider text-slate-500">Jelszó</label>
          <Password
            inputId="password"
            v-model="password"
            :feedback="false"
            toggleMask
            placeholder="••••••••"
            required
            fluid
            inputClass="!rounded-xl"
          />
        </div>

        <Button
          type="submit"
          label="Bejelentkezés"
          icon="pi pi-sign-in"
          :loading="isLoading"
          class="mt-2 w-full !bg-slate-900 hover:!bg-slate-800 !border-none !rounded-xl !py-3 !text-white font-semibold shadow-md"
        />
      </form>
    </div>
  </div>
</template>