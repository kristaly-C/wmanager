import router from '@/router'
import { useAuthStore } from '@/stores/auth'
import axios from 'axios'

const apiClient = axios.create({
    baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4001',
    headers: {
        'Content-Type': 'application/json',
    },
})

apiClient.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('token')
        if(token) {
            config.headers.Authorization = `Bearer ${token}`
        }
        return config
    },
    (error) => Promise.reject(error)
)

apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        const isLoginRequest = error.config?.url?.includes('/auth/login')

        if(error.response?.status === 401 && !isLoginRequest) {
            const authStore = useAuthStore()
            authStore.logout()
            router.push({name: 'login'})
        }

        return Promise.reject(error)
    }
)


export default apiClient