import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import apiClient from '@/api/axios'
import { Role } from '@wmanager/shared-types'

// A /auth/me által visszaadott felhasználói adatok típusa
export interface AuthUser {
  userId?: string
  id?: string
  email: string
  name?: string
  role: Role
}

export const useAuthStore = defineStore('auth', () => {
  // 1. STATE
  const token = ref<string | null>(localStorage.getItem('token'))
  const user = ref<AuthUser | null>(null)
  const isInitialized = ref(false) // Jelzi, hogy ellenőriztük-e már a tokent induláskor

  // 2. GETTERS
  const isAuthenticated = computed(() => !!token.value && !!user.value)

  // 3. ACTIONS
  async function fetchMe() {
    if (!token.value) {
      user.value = null
      isInitialized.value = true
      return
    }

    try {
      const response = await apiClient.get<AuthUser>('/auth/me')
      user.value = response.data
    } catch {
      // Ha a token lejárt vagy a usert letiltották, kitakarítjuk
      logout()
    } finally {
      isInitialized.value = true
    }
  }

  async function login(email: string, password: string) {
    const response = await apiClient.post<{ accessToken: string }>('/auth/login', {
      email,
      password,
    })

    token.value = response.data.accessToken
    localStorage.setItem('token', response.data.accessToken)

    // Belépés után rögtön lekérjük a friss felhasználói profilt a backendtől!
    await fetchMe()
  }

  function logout() {
    token.value = null
    user.value = null
    localStorage.removeItem('token')
  }

  async function verifyQrToken(qrToken:string) {
    const response = await apiClient.post<{ accessToken: string; user: AuthUser }>(
      '/auth/qr-login',
      {qrToken},
    )
    return response.data
  }

  function applySession(newToken: string, newUser: AuthUser){
    token.value = newToken
    localStorage.setItem('token', newToken)
    user.value = newUser
  }

  async function loginWithQr(qrToken: string) {
    const data = await verifyQrToken(qrToken)
    applySession(data.accessToken, data.user)
    return data.user
  }

  return {
    token,
    user,
    isInitialized,
    isAuthenticated,
    fetchMe,
    login,
    logout,
    verifyQrToken,
    applySession,
    loginWithQr,
  }
})