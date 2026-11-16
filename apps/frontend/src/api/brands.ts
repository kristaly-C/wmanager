import apiClient from './axios'

export interface BrandItem {
  id: string
  name: string
  description?: string | null
  createdAt: string
  updatedAt: string
}

export const brandApi = {
  getAll: () => apiClient.get<BrandItem[]>('/brands'),
  getOne: (id: string) => apiClient.get<BrandItem>(`/brands/${id}`),
  create: (data: { name: string; description?: string }) =>
    apiClient.post<BrandItem>('/brands', data),
  update: (id: string, data: { name?: string; description?: string }) =>
    apiClient.patch<BrandItem>(`/brands/${id}`, data),
  remove: (id: string) => apiClient.delete(`/brands/${id}`),
}
