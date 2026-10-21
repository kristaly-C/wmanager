<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

// PrimeVue komponensek importálása
import InputText from 'primevue/inputtext'
import Password from 'primevue/password'
import Button from 'primevue/button'
import Message from 'primevue/message'

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
    // Ha a backend 401-et dob ('Invalid credentials'), kiírjuk magyarul
    if (error.response?.status === 401) {
      errorMessage.value = 'Hibás e-mail cím vagy jelszó (vagy inaktív fiók).'
    } else {
      errorMessage.value = 'Nem sikerült csatlakozni a szerverhez.'
    }
  } finally {
    isLoading.value = false
  }
}
</script>

<template>
  <div class="min-h-screen bg-slate-950 flex items-center justify-center p-4">
    <!-- Bejelentkező kártya -->
    <div class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
      
      <!-- Fejléc / Logó -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10 text-emerald-400 mb-4">
          <i class="pi pi-box text-2xl"></i>
        </div>
        <h1 class="text-2xl font-bold text-white">WManager</h1>
        <p class="text-slate-400 text-sm mt-1">Jelentkezz be a raktárkezelő rendszerbe</p>
      </div>

      <!-- Hibaüzenet, ha elrontotta a jelszót -->
      <Message v-if="errorMessage" severity="error" :closable="false" class="mb-6">
        {{ errorMessage }}
      </Message>

      <!-- Bejelentkező űrlap -->
      <form @submit.prevent="handleLogin" class="flex flex-col gap-5">
        <div class="flex flex-col gap-2">
          <label for="email" class="text-sm font-medium text-slate-300">E-mail cím</label>
          <InputText
            id="email"
            v-model="email"
            type="email"
            placeholder="pelda@wmanager.hu"
            required
            fluid
          />
        </div>

        <div class="flex flex-col gap-2">
          <label for="password" class="text-sm font-medium text-slate-300">Jelszó</label>
          <Password
            inputId="password"
            v-model="password"
            :feedback="false"
            toggleMask
            placeholder="••••••••"
            required
            fluid
          />
        </div>

        <Button
          type="submit"
          label="Bejelentkezés"
          icon="pi pi-sign-in"
          :loading="isLoading"
          class="mt-2 w-full"
        />
      </form>
    </div>
  </div>
</template>