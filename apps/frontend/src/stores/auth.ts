import { ref, computed} from 'vue'
import { defineStore } from "pinia"
import apiClient from "@/api/axios"
import { Role } from "@wmanager/shared-types"


interface JwtPayload {
    sub: string
    email: string
    role: Role
    exp?: number
}


function parseJwt(token: string): JwtPayload | null {
    try {
      const base64Payload = token.split('.')[1]
      if(!base64Payload) return null
      
      const decoded = atob(base64Payload)
      return JSON.parse(decoded)
    } catch {
      return null
    }
  }

  export const useAuthStore = defineStore('auth', () => {
    const token = ref<string | null>(localStorage.getItem('token'))


    const user = computed<JwtPayload | null>(() => {
        if (!token.value) return null
        return parseJwt(token.value)
    })


    const isAuthenticated = computed(() => !!token.value && !!user.value)


    async function login(email:string, password: string) {
        
        const response = await apiClient.post<{ accessToken: string}>('/auth/login',{
            email,
            password,
        })


        token.value = response.data.accessToken
        localStorage.setItem('token', response.data.accessToken)
    }

    function logout() {
        token.value = null
        localStorage.removeItem('token')
    }

    return {
        token,
        user,
        isAuthenticated,
        login,
        logout,
    }
  })