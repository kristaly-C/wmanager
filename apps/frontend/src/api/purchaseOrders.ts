import type { GoodsReceiptStatus, LocationType, PurchaseOrderStatus, Role } from '@wmanager/shared-types'
import apiClient from './axios'
import type { ProductListItem } from './products'
import type { SupplierItem } from './suppliers'
import type { VariantBarcodeItem } from './variants'

export interface PurchaseOrderUserRef {
  id: string
  name: string
  email: string
  role: Role
}

export interface PurchaseOrderItemSummary {
  id: string
  variantId: string
  orderedQuantity: number
  confirmedQuantity: number | null
  receivedQuantity: number
  unitCost: number | string
}

export interface PurchaseOrderVariantInfo {
  id: string
  productId: string
  sku: string
  colors: string[]
  size?: string | null
  weight?: number | string | null
  netWeight?: number | string | null
  volume?: number | string | null
  imageUrls: string[]
  netPrice: number | string
  grossPrice: number | string
  costPrice?: number | string
  costCurrency?: string
  lastPurchasePrice?: number | string | null
  lastPurchaseAt?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  product: ProductListItem
  variantBarcodes: VariantBarcodeItem[]
}

export interface PurchaseOrderDetailItem {
  id: string
  purchaseOrderId: string
  variantId: string
  orderedQuantity: number
  confirmedQuantity: number | null
  receivedQuantity: number
  unitCost: number | string
  note: string | null
  createdAt: string
  updatedAt: string
  variant: PurchaseOrderVariantInfo
}

export interface PurchaseOrderReceiptSummary {
  id: string
  receiptNumber: string
  status: GoodsReceiptStatus
  targetLocationId: string
  completedAt: string | null
  createdAt: string
}

export interface PurchaseOrderDetailReceipt {
  id: string
  receiptNumber: string
  status: GoodsReceiptStatus
  targetLocationId: string
  targetLocation: {
    id: string
    name: string
    type: LocationType
  }
  invoiceNumber: string | null
  createdByUser: PurchaseOrderUserRef | null
  approvedByUser: PurchaseOrderUserRef | null
  approvedAt: string | null
  completedAt: string | null
  createdAt: string
  _count: {
    items: number
  }
}

export interface PurchaseOrderBase {
  id: string
  orderNumber: string
  supplierId: string
  status: PurchaseOrderStatus
  currency: string
  exchangeRate: number | string
  supplierReference: string | null
  orderedAt: string | null
  confirmedAt: string | null
  expectedDeliveryDate: string | null
  note: string | null
  createdByUserId: string | null
  createdAt: string
  updatedAt: string
  supplier: SupplierItem
  createdByUser: PurchaseOrderUserRef | null
  _count: {
    items: number
    goodsReceipts: number
  }
}

export interface PurchaseOrderListItem extends PurchaseOrderBase {
  items: PurchaseOrderItemSummary[]
  goodsReceipts: PurchaseOrderReceiptSummary[]
}

export interface PurchaseOrderDetail extends PurchaseOrderBase {
  items: PurchaseOrderDetailItem[]
  goodsReceipts: PurchaseOrderDetailReceipt[]
}

export interface PurchaseOrderListResponse {
  items: PurchaseOrderListItem[]
  total: number
}

export interface FindPurchaseOrdersQuery {
  skip?: number
  take?: number
  status?: PurchaseOrderStatus
  supplierId?: string
  search?: string
}

export interface CreatePurchaseOrderItemPayload {
  variantId: string
  orderedQuantity: number
  unitCost: number
  note?: string | null
}

export interface CreatePurchaseOrderPayload {
  supplierId: string
  currency?: string
  exchangeRate?: number
  supplierReference?: string | null
  expectedDeliveryDate?: string | null
  note?: string | null
  items?: CreatePurchaseOrderItemPayload[]
}

export interface UpdatePurchaseOrderPayload {
  supplierId?: string
  currency?: string
  exchangeRate?: number
  supplierReference?: string | null
  expectedDeliveryDate?: string | null
  note?: string | null
  items?: CreatePurchaseOrderItemPayload[]
}

export interface ConfirmPurchaseOrderItemPayload {
  itemId?: string
  variantId?: string
  confirmedQuantity: number
  unitCost?: number
  note?: string | null
}

export interface ConfirmPurchaseOrderPayload {
  expectedDeliveryDate?: string | null
  supplierReference?: string | null
  note?: string | null
  items?: ConfirmPurchaseOrderItemPayload[]
}

export const purchaseOrdersApi = {
  list: (params?: FindPurchaseOrdersQuery, signal?: AbortSignal) =>
    apiClient.get<PurchaseOrderListResponse>('/purchase-orders', { params, signal }),
  getOne: (id: string, signal?: AbortSignal) =>
    apiClient.get<PurchaseOrderDetail>(`/purchase-orders/${id}`, { signal }),
  create: (data: CreatePurchaseOrderPayload) =>
    apiClient.post<PurchaseOrderDetail>('/purchase-orders', data),
  update: (id: string, data: UpdatePurchaseOrderPayload) =>
    apiClient.patch<PurchaseOrderDetail>(`/purchase-orders/${id}`, data),
  order: (id: string) => apiClient.post<PurchaseOrderDetail>(`/purchase-orders/${id}/order`),
  confirm: (id: string, data: ConfirmPurchaseOrderPayload) =>
    apiClient.post<PurchaseOrderDetail>(`/purchase-orders/${id}/confirm`, data),
  close: (id: string) => apiClient.post<PurchaseOrderDetail>(`/purchase-orders/${id}/close`),
  cancel: (id: string) => apiClient.post<PurchaseOrderDetail>(`/purchase-orders/${id}/cancel`),
}
