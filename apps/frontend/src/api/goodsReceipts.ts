import type {
  GoodsReceiptStatus,
  MovementType,
  PurchaseOrderStatus,
  Role,
} from '@wmanager/shared-types'
import apiClient from './axios'
import type { LocationItem } from './locations'
import type { ProductListItem } from './products'
import type { SupplierItem } from './suppliers'
import type { VariantBarcodeItem } from './variants'

export interface GoodsReceiptUserRef {
  id: string
  name: string
  email: string
  role: Role
}

export interface GoodsReceiptPurchaseOrderRef {
  id: string
  orderNumber: string
  status: PurchaseOrderStatus
  currency?: string
  exchangeRate?: number | string
  supplierReference?: string | null
}

export interface GoodsReceiptPurchaseOrderItemRef {
  id: string
  purchaseOrderId: string
  variantId: string
  orderedQuantity: number
  confirmedQuantity?: number | null
  receivedQuantity: number
  unitCost?: number | string
  note?: string | null
  createdAt: string
  updatedAt: string
}

export interface GoodsReceiptVariantInfo {
  id: string
  productId: string
  sku: string
  colors: string[]
  size?: string | null
  weight?: number | string | null
  netWeight?: number | string | null
  volume?: number | string | null
  imageUrls?: string[]
  netPrice: number | string
  grossPrice: number | string
  costPrice?: number | string
  costCurrency?: string
  lastPurchasePrice?: number | string | null
  lastPurchaseAt?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
  product?: ProductListItem
  variantBarcodes?: VariantBarcodeItem[]
}

export interface GoodsReceiptItemDto {
  id: string
  goodsReceiptId: string
  purchaseOrderItemId?: string | null
  variantId: string
  expectedQuantity: number
  receivedQuantity: number
  unitCost?: number | string
  unitCostHuf?: number | string
  expectedLocationId?: string | null
  isUnexpected: boolean
  note?: string | null
  createdAt: string
  updatedAt: string
  expectedLocation?: LocationItem | null
  purchaseOrderItem?: GoodsReceiptPurchaseOrderItemRef | null
  variant: GoodsReceiptVariantInfo
}

export interface GoodsReceiptMovementReversalRef {
  id: string
  createdAt: string
  createdByUserId: string
}

export interface GoodsReceiptMovementDto {
  id: string
  variantId: string
  locationId: string
  quantity: number
  type: MovementType
  purchaseOrderId?: string | null
  goodsReceiptId?: string | null
  salesOrderId?: string | null
  stocktakeSessionId?: string | null
  stockTransferId?: string | null
  returnCaseId?: string | null
  unitCostHuf?: number | string | null
  unitPriceHuf?: number | string | null
  reversedMovementId?: string | null
  note?: string | null
  createdByUserId: string
  createdAt: string
  location: LocationItem
  variant: GoodsReceiptVariantInfo
  createdByUser?: GoodsReceiptUserRef
  reversedBy?: GoodsReceiptMovementReversalRef | null
  reversedMovement?: GoodsReceiptMovementReversalRef | null
}

export interface GoodsReceiptListItem {
  id: string
  receiptNumber: string
  purchaseOrderId?: string | null
  supplierId?: string | null
  targetLocationId: string
  invoiceNumber?: string | null
  currency?: string
  exchangeRate?: number | string
  status: GoodsReceiptStatus
  discrepancyNote?: string | null
  note?: string | null
  createdByUserId: string
  approvedByUserId?: string | null
  approvedAt?: string | null
  completedAt?: string | null
  createdAt: string
  updatedAt: string
  targetLocation: LocationItem
  supplier?: SupplierItem | null
  purchaseOrder?: GoodsReceiptPurchaseOrderRef | null
  createdByUser: GoodsReceiptUserRef
  approvedByUser?: GoodsReceiptUserRef | null
  items: GoodsReceiptItemDto[]
}

export interface GoodsReceiptDetail extends GoodsReceiptListItem {
  stockMovements: GoodsReceiptMovementDto[]
}

export interface GoodsReceiptStockItemRef {
  id: string
  locationId: string
  variantId: string
  quantity: number
  reservedQuantity: number
  minStockLevel?: number | null
  maxStockLevel?: number | null
  createdAt: string
  updatedAt: string
}

export interface PutawayResponse extends GoodsReceiptDetail {
  lastMovement: GoodsReceiptMovementDto
  stockItem: GoodsReceiptStockItemRef
}

export interface UndoPutawayResponse extends GoodsReceiptDetail {
  lastMovement: GoodsReceiptMovementDto
}

export interface GoodsReceiptListResponse {
  items: GoodsReceiptListItem[]
  total: number
}

export interface FindGoodsReceiptsQuery {
  status?: GoodsReceiptStatus
  locationId?: string
  purchaseOrderId?: string
  supplierId?: string
  search?: string
  skip?: number
  take?: number
}

export interface CreateGoodsReceiptItemPayload {
  variantId: string
  purchaseOrderItemId?: string
  expectedQuantity: number
  unitCost: number
  expectedLocationId?: string
  note?: string
}

export interface CreateGoodsReceiptPayload {
  targetLocationId: string
  purchaseOrderId?: string
  supplierId?: string
  invoiceNumber?: string
  currency?: string
  exchangeRate?: number
  note?: string
  items?: CreateGoodsReceiptItemPayload[]
}

export interface AddGoodsReceiptItemPayload {
  variantId: string
  purchaseOrderItemId?: string
  expectedQuantity: number
  unitCost: number
  expectedLocationId?: string
  note?: string
}

export interface PutawayPayload {
  variantId?: string
  barcode?: string
  sku?: string
  locationId?: string
  locationName?: string
  quantity: number
  note?: string
}

export interface GoodsReceiptItemCostOverridePayload {
  goodsReceiptItemId: string
  unitCost: number
}

export interface ApproveGoodsReceiptPayload {
  discrepancyNote?: string
  itemCostOverrides?: GoodsReceiptItemCostOverridePayload[]
}

export const goodsReceiptsApi = {
  list: (params?: FindGoodsReceiptsQuery, signal?: AbortSignal) =>
    apiClient.get<GoodsReceiptListResponse>('/goods-receipts', { params, signal }),
  getOne: (id: string, signal?: AbortSignal) =>
    apiClient.get<GoodsReceiptDetail>(`/goods-receipts/${id}`, { signal }),
  create: (data: CreateGoodsReceiptPayload) =>
    apiClient.post<GoodsReceiptDetail>('/goods-receipts', data),
  addItem: (id: string, data: AddGoodsReceiptItemPayload) =>
    apiClient.post<GoodsReceiptDetail>(`/goods-receipts/${id}/items`, data),
  start: (id: string) => apiClient.post<GoodsReceiptDetail>(`/goods-receipts/${id}/start`),
  putaway: (id: string, data: PutawayPayload) =>
    apiClient.post<PutawayResponse>(`/goods-receipts/${id}/putaway`, data),
  undoPutaway: (id: string, movementId: string) =>
    apiClient.post<UndoPutawayResponse>(`/goods-receipts/${id}/putaway/${movementId}/undo`),
  finish: (id: string) => apiClient.post<GoodsReceiptDetail>(`/goods-receipts/${id}/finish`),
  approve: (id: string, data?: ApproveGoodsReceiptPayload) =>
    apiClient.post<GoodsReceiptDetail>(`/goods-receipts/${id}/approve`, data ?? {}),
  cancel: (id: string) => apiClient.post<GoodsReceiptDetail>(`/goods-receipts/${id}/cancel`),
}
