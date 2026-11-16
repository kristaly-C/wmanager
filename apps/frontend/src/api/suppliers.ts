import apiClient from './axios'

export interface SupplierItem {
  id: string
  name: string
  description?: string | null
  phone?: string | null
  email?: string | null
  createdAt: string
  updatedAt: string
}

export const supplierApi = {
  getAll: () => apiClient.get<SupplierItem[]>('/suppliers'),
  getOne: (id: string) => apiClient.get<SupplierItem>(`/suppliers/${id}`),
  create: (data: {
    name: string
    description?: string
    phone?: string
    email?: string
  }) => apiClient.post<SupplierItem>('/suppliers', data),
  update: (
    id: string,
    data: {
      name?: string
      description?: string
      phone?: string
      email?: string
    },
  ) => apiClient.patch<SupplierItem>(`/suppliers/${id}`, data),
  remove: (id: string) => apiClient.delete(`/suppliers/${id}`),
}
