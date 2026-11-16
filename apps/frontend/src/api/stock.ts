import { MovementType } from '@wmanager/shared-types'
import apiClient from './axios'
import type { LocationItem } from './locations'
import type { ProductListItem } from './products'
import type { VariantBarcodeItem } from './variants'

export interface StockVariantInfo {
  id: string
  productId: string
  sku: string
  colors: string[]
  size: string
  weight: number | string
  price: number | string
  costPrice?: number | string
  isActive: boolean
  product?: ProductListItem
  variantBarcodes?: VariantBarcodeItem[]
}

export interface StockItemEntry {
  id: string
  locationId: string
  variantId: string
  quantity: number
  reservedQuantity: number
  minStockLevel?: number | null
  maxStockLevel?: number | null
  createdAt: string
  updatedAt: string
  location: LocationItem
  variant: StockVariantInfo
  isExternalLocation?: boolean
}

export interface StockListResponse {
  items: StockItemEntry[]
  total: number
}

export interface StockMovementEntry {
  id: string
  variantId: string
  locationId: string
  quantity: number
  type: MovementType
  purchaseOrderId?: string | null
  salesOrderId?: string | null
  stocktakeSessionId?: string | null
  stockTransferId?: string | null
  returnCaseId?: string | null
  note?: string | null
  createdByUserId: string
  createdAt: string
  location: LocationItem
  variant: StockVariantInfo
  createdByUser?: {
    id: string
    name: string
    email: string
    role: string
  }
}

export interface StockMovementListResponse {
  items: StockMovementEntry[]
  total: number
}

export interface AdjustStockPayload {
  variantId: string
  locationId: string
  quantityChange: number
  type: MovementType.INITIAL_STOCK | MovementType.MANUAL_CORRECTION
  note?: string
}

export interface AdjustStockResult {
  stockItem: StockItemEntry
  movement: StockMovementEntry
}

export const stockApi = {
  getAll: (
    params?: {
      locationId?: string
      variantId?: string
      productId?: string
      search?: string
      skip?: number
      take?: number
    },
    signal?: AbortSignal,
  ) => apiClient.get<StockListResponse>('/stock', { params, signal }),
  getMovements: (
    params?: {
      locationId?: string
      variantId?: string
      productId?: string
      type?: MovementType
      search?: string
      skip?: number
      take?: number
    },
    signal?: AbortSignal,
  ) => apiClient.get<StockMovementListResponse>('/stock/movements', { params, signal }),
  adjust: (data: AdjustStockPayload) =>
    apiClient.post<AdjustStockResult>('/stock/adjust', data),
}
