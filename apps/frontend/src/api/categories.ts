import apiClient from './axios'

export interface Category {
  id: string
  name: string
  parentId?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export const categoryApi = {
  getAll: () => apiClient.get<Category[]>('/categories'),
  getOne: (id: string) => apiClient.get<Category>(`/categories/${id}`),
  create: (data: { name: string; parentId?: string; isActive?: boolean }) =>
    apiClient.post<Category>('/categories', data),
  update: (
    id: string,
    data: { name?: string; parentId?: string | null; isActive?: boolean },
  ) => apiClient.patch<Category>(`/categories/${id}`, data),
  remove: (id: string) => apiClient.delete(`/categories/${id}`),
}
