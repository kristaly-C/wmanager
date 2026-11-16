import type { LocationType } from '@wmanager/shared-types'
import apiClient from './axios'
import type { ProductListItem } from './products'

export interface VariantBarcodeItem {
  id: string
  variantId: string
  barcode: string
  isPrimary: boolean
  note?: string | null
  createdAt: string
  updatedAt: string
}

export interface VariantStockItem {
  id: string
  locationId: string
  quantity: number
  reservedQuantity: number
  isExternalLocation?: boolean
  location?: {
    id: string
    name: string
    type: LocationType
    parentId: string | null
  }
}

export interface VariantItem {
  id: string
  productId: string
  sku: string
  colors: string[]
  size: string
  weight: number | string
  price: number | string
  costPrice?: number | string
  imageUrls?: string[]
  isActive: boolean
  createdAt: string
  updatedAt: string
  variantBarcodes?: VariantBarcodeItem[]
  product?: ProductListItem
  stockItems?: VariantStockItem[]
}

export interface CreateVariantPayload {
  productId: string
  sku: string
  colors: string[]
  size: string
  weight: number
  price: number
  costPrice: number
  imageUrls?: string[]
  isActive?: boolean
}

export type UpdateVariantPayload = Partial<Omit<CreateVariantPayload, 'productId'>>

export interface BulkVariantItemPayload {
  sku: string
  colors: string[]
  size: string
  weight: number
  price: number
  costPrice: number
  imageUrls?: string[]
  isActive?: boolean
  primaryBarcode?: string
}

export interface BulkCreateVariantsPayload {
  productId: string
  items: BulkVariantItemPayload[]
}

export interface BulkCreateVariantsResult {
  createdCount: number
  items: VariantItem[]
}

export const variantApi = {
  getAll: (params?: {
    search?: string
    productId?: string
    skip?: number
    take?: number
  }) => apiClient.get<VariantItem[]>('/variants', { params }),
  getOne: (id: string) => apiClient.get<VariantItem>(`/variants/${id}`),
  create: (data: CreateVariantPayload) =>
    apiClient.post<VariantItem>('/variants', data),
  bulkCreate: (data: BulkCreateVariantsPayload) =>
    apiClient.post<BulkCreateVariantsResult>('/variants/bulk', data),
  update: (id: string, data: UpdateVariantPayload) =>
    apiClient.patch<VariantItem>(`/variants/${id}`, data),
  remove: (id: string) => apiClient.delete(`/variants/${id}`),
  getBarcodes: (variantId: string) =>
    apiClient.get<VariantBarcodeItem[]>(`/variants/${variantId}/barcodes`),
  createBarcode: (
    variantId: string,
    data: { barcode: string; isPrimary?: boolean; note?: string },
  ) =>
    apiClient.post<VariantBarcodeItem>(`/variants/${variantId}/barcodes`, data),
  updateBarcode: (
    variantId: string,
    barcodeId: string,
    data: { barcode?: string; isPrimary?: boolean; note?: string },
  ) =>
    apiClient.patch<VariantBarcodeItem>(
      `/variants/${variantId}/barcodes/${barcodeId}`,
      data,
    ),
  removeBarcode: (variantId: string, barcodeId: string) =>
    apiClient.delete(`/variants/${variantId}/barcodes/${barcodeId}`),
}
