import type { LocationType, PurchaseOrderStatus } from '@wmanager/shared-types'
import apiClient from './axios'

export interface VariantSupplierRef {
  id: string
  name: string
  email?: string | null
  phone?: string | null
}

export interface VariantSupplierItem {
  id: string
  variantId: string
  supplierId: string
  supplierSku?: string | null
  supplierProductName?: string | null
  purchasePrice?: number
  currency?: string
  discountPercent?: number | null
  orderUnit?: string | null
  isPrimary: boolean
  note?: string | null
  createdAt: string
  updatedAt: string
  supplier: VariantSupplierRef
}

export interface CreateVariantSupplierPayload {
  supplierId: string
  supplierSku?: string
  supplierProductName?: string
  purchasePrice: number
  currency?: string
  discountPercent?: number
  orderUnit?: string
  isPrimary?: boolean
  note?: string
}

export type UpdateVariantSupplierPayload = Partial<
  Omit<CreateVariantSupplierPayload, 'supplierId'>
>

export interface VariantPurchaseHistoryVariant {
  id: string
  sku: string
  costPrice: number
  costCurrency: string
  lastPurchasePrice: number | null
  lastPurchaseAt: string | null
}

export interface VariantPurchaseHistoryEntry {
  id: string
  goodsReceiptId: string
  receiptNumber: string
  invoiceNumber: string | null
  supplierId: string | null
  supplier: {
    id: string
    name: string
  } | null
  purchaseOrderId: string | null
  purchaseOrder: {
    id: string
    orderNumber: string
    status: PurchaseOrderStatus
  } | null
  targetLocation: {
    id: string
    name: string
    type: LocationType
  }
  expectedQuantity: number
  receivedQuantity: number
  unitCost: number
  currency: string
  exchangeRate: number
  unitCostHuf: number
  isUnexpected: boolean
  completedAt: string | null
}

export interface VariantMonthlyStatItem {
  id: string
  variantId: string
  productId: string
  year: number
  month: number
  purchasedQty: number
  purchasedTotalCostHuf: number
  soldQty: number
  soldRevenueHuf: number
  soldCogsHuf: number
  returnedQty: number
  adjustmentQty: number
  updatedAt: string
}

export interface VariantPurchaseHistoryResponse {
  variant: VariantPurchaseHistoryVariant
  history: VariantPurchaseHistoryEntry[]
  monthlyStats: VariantMonthlyStatItem[]
}

export const variantSuppliersApi = {
  list: (variantId: string) =>
    apiClient.get<VariantSupplierItem[]>(`/variants/${variantId}/suppliers`),
  create: (variantId: string, data: CreateVariantSupplierPayload) =>
    apiClient.post<VariantSupplierItem>(`/variants/${variantId}/suppliers`, data),
  update: (variantId: string, id: string, data: UpdateVariantSupplierPayload) =>
    apiClient.patch<VariantSupplierItem>(`/variants/${variantId}/suppliers/${id}`, data),
  remove: (variantId: string, id: string) =>
    apiClient.delete<Omit<VariantSupplierItem, 'supplier'>>(`/variants/${variantId}/suppliers/${id}`),
  getPurchaseHistory: (variantId: string) =>
    apiClient.get<VariantPurchaseHistoryResponse>(`/variants/${variantId}/purchase-history`),
}
