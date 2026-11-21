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
  size?: string | null
  weight?: number | string | null
  netWeight?: number | string | null
  volume?: number | string | null
  netPrice: number | string
  grossPrice: number | string
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

export type StockReportStatusType = 'PENDING' | 'APPROVED' | 'REJECTED'

export interface StockSettingsResponse {
  initialStockEnabled: boolean
}

export interface RelocateStockPayload {
  variantId: string
  fromLocationId: string
  toLocationId: string
  quantity: number
  note?: string
}

export interface StockReportEntry {
  id: string
  variantId: string
  locationId: string
  expectedQuantity: number
  foundQuantity: number
  reason: string
  status: StockReportStatusType
  reportedByUserId: string
  resolvedByUserId?: string | null
  resolutionNote?: string | null
  resolvedAt?: string | null
  createdAt: string
  updatedAt: string
  location: LocationItem
  variant: StockVariantInfo
  reportedByUser?: { id: string; name: string; email: string; role: string }
  resolvedByUser?: { id: string; name: string; email: string; role: string } | null
}

export interface CreateStockReportPayload {
  variantId: string
  locationId: string
  foundQuantity: number
  reason: string
}

export interface ResolveStockReportPayload {
  action: 'APPROVE' | 'REJECT'
  resolutionNote?: string
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
  relocate: (data: RelocateStockPayload) =>
    apiClient.post('/stock/relocate', data),
  getSettings: () =>
    apiClient.get<StockSettingsResponse>('/stock/settings'),
  updateSettings: (data: { initialStockEnabled: boolean }) =>
    apiClient.patch<StockSettingsResponse>('/stock/settings', data),
  getReports: (params?: { status?: StockReportStatusType; locationId?: string }) =>
    apiClient.get<StockReportEntry[]>('/stock/reports', { params }),
  createReport: (data: CreateStockReportPayload) =>
    apiClient.post<StockReportEntry>('/stock/reports', data),
  resolveReport: (id: string, data: ResolveStockReportPayload) =>
    apiClient.post<StockReportEntry>(`/stock/reports/${id}/resolve`, data),
}
