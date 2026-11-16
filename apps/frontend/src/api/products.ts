import apiClient from './axios'

export interface ProductListItem {
  id: string
  name: string
  brandId: string
  categoryId: string
  primarySupplierId: string
  gender: string
  usageArea?: string | null
  material?: string | null
  model: string
  manufacturerCode: string
  functionality?: string | null
  description?: string | null
  vatRate: number | string
  imageUrls: string[]
  attributes?: Record<string, string> | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  brand?: { id: string; name: string }
  category?: { id: string; name: string }
  primarySupplier?: { id: string; name: string }
  _count?: { variants: number }
}

export interface ProductListResponse {
  items: ProductListItem[]
  total: number
}

export interface CreateProductPayload {
  name: string
  brandId: string
  categoryId: string
  primarySupplierId: string
  gender: string
  usageArea?: string
  material?: string
  model: string
  manufacturerCode: string
  functionality?: string
  description?: string
  vatRate: number
  imageUrls: string[]
  attributes?: Record<string, string>
  isActive?: boolean
}

export type UpdateProductPayload = Partial<CreateProductPayload>

export const productApi = {
  getAll: (
    params?: {
      search?: string
      categoryId?: string
      brandId?: string
      skip?: number
      take?: number
    },
    signal?: AbortSignal,
  ) => apiClient.get<ProductListResponse>('/products', { params, signal }),
  getOne: (id: string) => apiClient.get<ProductListItem>(`/products/${id}`),
  create: (data: CreateProductPayload) =>
    apiClient.post<ProductListItem>('/products', data),
  update: (id: string, data: UpdateProductPayload) =>
    apiClient.patch<ProductListItem>(`/products/${id}`, data),
  remove: (id: string) => apiClient.delete(`/products/${id}`),
}
