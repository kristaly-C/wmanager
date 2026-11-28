import type {
  LocationType,
  MovementType,
  PickTaskStatus,
  Role,
  SalesChannel,
  SalesOrderStatus,
} from '@wmanager/shared-types'
import apiClient from './axios'
import type { LocationItem } from './locations'
import type { ProductListItem } from './products'
import type { VariantBarcodeItem } from './variants'

export interface SalesOrderUserRef {
  id: string
  name: string
  email: string
  role: Role
}

export interface SalesOrderVariantInfo {
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
  product?: ProductListItem
  variantBarcodes?: VariantBarcodeItem[]
}

export interface SalesOrderItemDetail {
  id: string
  salesOrderId: string
  variantId: string
  orderedQuantity: number
  reservedQuantity: number
  pickedQuantity: number
  unitNetPrice: number | string
  unitGrossPrice: number | string
  vatRate: number | string
  discountPercent?: number | string | null
  note?: string | null
  createdAt: string
  updatedAt: string
  variant: SalesOrderVariantInfo
}

export interface SalesOrderPickTaskItemRef {
  id: string
  pickTaskId: string
  salesOrderItemId: string
  variantId: string
  suggestedLocationId?: string | null
  requiredQuantity: number
  pickedQuantity: number
  createdAt: string
  updatedAt: string
  suggestedLocation?: LocationItem | null
  variant: SalesOrderVariantInfo
}

export interface SalesOrderPickTaskSummary {
  id: string
  taskNumber: string
  salesOrderId: string
  sourceLocationId: string
  zoneId?: string | null
  status: PickTaskStatus
  assignedToUserId?: string | null
  toteCode?: string | null
  dropoffLocationId?: string | null
  dropoffCode?: string | null
  startedAt?: string | null
  droppedAt?: string | null
  completedAt?: string | null
  createdAt: string
  updatedAt: string
  zone?: LocationItem | null
  assignedToUser?: SalesOrderUserRef | null
  dropoffLocation?: LocationItem | null
  _count?: {
    items: number
  }
  items?: SalesOrderPickTaskItemRef[]
}

export interface SalesOrderPickTaskDetail extends SalesOrderPickTaskSummary {
  items: SalesOrderPickTaskItemRef[]
}

export interface SalesOrderMovementReversalRef {
  id: string
  createdAt: string
  createdByUserId: string
}

export interface SalesOrderMovementDto {
  id: string
  variantId: string
  locationId: string
  quantity: number
  type: MovementType
  purchaseOrderId?: string | null
  goodsReceiptId?: string | null
  salesOrderId?: string | null
  pickTaskId?: string | null
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
  variant: SalesOrderVariantInfo
  createdByUser?: SalesOrderUserRef
  reversedBy?: SalesOrderMovementReversalRef | null
  reversedMovement?: SalesOrderMovementReversalRef | null
}

export interface SalesOrderListItem {
  id: string
  orderNumber: string
  externalOrderRef?: string | null
  channel: SalesChannel
  isPickup?: boolean
  status: SalesOrderStatus
  sourceLocationId: string
  transferRequestedFromLocationId?: string | null
  holdReason?: string | null
  customerName: string
  customerEmail?: string | null
  customerPhone?: string | null
  shippingAddress?: string | null
  note?: string | null
  createdByUserId?: string | null
  completedByUserId?: string | null
  completedAt?: string | null
  cancelledAt?: string | null
  createdAt: string
  updatedAt: string
  sourceLocation: LocationItem
  transferRequestedFromLocation?: LocationItem | null
  createdByUser?: SalesOrderUserRef | null
  completedByUser?: SalesOrderUserRef | null
  items: SalesOrderItemDetail[]
  pickTasks: SalesOrderPickTaskSummary[]
}

export interface SalesOrderDetail extends SalesOrderListItem {
  pickTasks: SalesOrderPickTaskDetail[]
  stockMovements: SalesOrderMovementDto[]
}

export interface SalesOrderListResponse {
  items: SalesOrderListItem[]
  total: number
  onHoldCount: number
}

export interface FindSalesOrdersQuery {
  skip?: number
  take?: number
  status?: SalesOrderStatus
  channel?: SalesChannel
  sourceLocationId?: string
  onlyProblems?: boolean
  search?: string
}

export interface SalesOrderVariantAvailabilityRow {
  locationId: string
  locationName: string
  locationType: LocationType
  variantId: string
  totalQty: number
  reservedQty: number
  availableQty: number
}

export interface SalesOrderLocationAvailability {
  locationId: string
  locationName: string
  locationType: LocationType
  canFulfillWebshop?: boolean
  fulfillmentPriority?: number
  dispatchHubLocationId?: string | null
  clusterMemberNames?: string[]
  coveredQty: number
  missingQty: number
  totalOrderedQty: number
  canFulfillAll: boolean
  clusterCoveredQty?: number
  clusterMissingQty?: number
  clusterCanFulfillAll?: boolean
  variants: SalesOrderVariantAvailabilityRow[]
}

export interface SalesOrderFlatAvailabilityItem extends SalesOrderVariantAvailabilityRow {
  canFulfillAll: boolean
}

export interface SalesOrderAvailabilityResponse {
  variantIds: string[]
  totalOrderedQty: number
  recommendedLocationId: string | null
  recommendationReason: string | null
  locations: SalesOrderLocationAvailability[]
  items: SalesOrderFlatAvailabilityItem[]
}

export interface VariantSalesHistoryOrderRef {
  id: string
  orderNumber: string
  externalOrderRef?: string | null
  channel: SalesChannel
  isPickup?: boolean
  status: SalesOrderStatus
  customerName: string
  sourceLocationId: string
  sourceLocation: {
    id: string
    name: string
    type: LocationType
  }
  completedAt?: string | null
  completedByUser?: SalesOrderUserRef | null
  createdAt: string
}

export interface VariantSalesHistoryItem {
  id: string
  salesOrderId: string
  variantId: string
  orderedQuantity: number
  reservedQuantity: number
  pickedQuantity: number
  unitNetPrice: number | string
  unitGrossPrice: number | string
  vatRate: number | string
  discountPercent?: number | string | null
  note?: string | null
  createdAt: string
  updatedAt: string
  salesOrder: VariantSalesHistoryOrderRef
  lineNetTotalHuf: number
  lineGrossTotalHuf: number
}

export interface VariantSalesMonthlyStat {
  id: string
  variantId: string
  productId: string
  year: number
  month: number
  purchasedQty: number
  purchasedTotalCostHuf: number | string
  soldQty: number
  soldRevenueHuf: number
  soldCogsHuf: number
  returnedQty: number
  adjustmentQty: number
  updatedAt: string
  marginHuf: number
  marginPercent: number | null
}

export interface VariantSalesHistorySummary {
  totalSoldQty: number
  totalSoldRevenueHuf: number
  totalSoldCogsHuf: number
  totalMarginHuf: number
  totalMarginPercent: number | null
}

export interface VariantSalesHistoryResponse {
  variant: SalesOrderVariantInfo
  items: VariantSalesHistoryItem[]
  total: number
  monthlyStats: VariantSalesMonthlyStat[]
  summary: VariantSalesHistorySummary
}

export interface FindVariantSalesHistoryQuery {
  skip?: number
  take?: number
}

export interface CreateSalesOrderItemPayload {
  variantId: string
  orderedQuantity: number
  unitNetPrice?: number
  unitGrossPrice?: number
  vatRate?: number
  discountPercent?: number
  note?: string
}

export interface CreateSalesOrderPayload {
  sourceLocationId?: string
  channel?: SalesChannel
  isPickup?: boolean
  externalOrderRef?: string
  customerName: string
  customerEmail?: string
  customerPhone?: string
  shippingAddress?: string
  note?: string
  instantComplete?: boolean
  items: CreateSalesOrderItemPayload[]
}

export interface UpdateSalesOrderPayload {
  channel?: SalesChannel
  isPickup?: boolean
  externalOrderRef?: string
  customerName?: string
  customerEmail?: string
  customerPhone?: string
  shippingAddress?: string
  note?: string
  holdReason?: string
  items?: CreateSalesOrderItemPayload[]
}

export interface ReassignSalesOrderLocationPayload {
  sourceLocationId: string
  note?: string
}

export interface RequestSalesOrderTransferPayload {
  transferRequestedFromLocationId: string
  holdReason?: string
  note?: string
}

export interface CompleteSalesOrderPayload {
  instantFromShelf?: boolean
  note?: string
}

function buildAvailabilityParams(
  variantIds: string[],
  quantities?: Record<string, number>,
): { variantIds: string; quantities?: string } {
  const params: { variantIds: string; quantities?: string } = {
    variantIds: variantIds.join(','),
  }
  if (quantities) {
    const formatted = Object.entries(quantities)
      .filter(([, qty]) => Number.isFinite(qty) && qty >= 1)
      .map(([variantId, qty]) => `${variantId}:${Math.floor(qty)}`)
      .join(',')
    if (formatted) {
      params.quantities = formatted
    }
  }
  return params
}

export const salesOrdersApi = {
  list: (params?: FindSalesOrdersQuery, signal?: AbortSignal) =>
    apiClient.get<SalesOrderListResponse>('/sales-orders', { params, signal }),
  getOne: (id: string, signal?: AbortSignal) =>
    apiClient.get<SalesOrderDetail>(`/sales-orders/${id}`, { signal }),
  getAvailability: (
    variantIds: string[],
    quantities?: Record<string, number>,
    signal?: AbortSignal,
  ) =>
    apiClient.get<SalesOrderAvailabilityResponse>('/sales-orders/availability', {
      params: buildAvailabilityParams(variantIds, quantities),
      signal,
    }),
  getVariantHistory: (
    variantId: string,
    params?: FindVariantSalesHistoryQuery,
    signal?: AbortSignal,
  ) =>
    apiClient.get<VariantSalesHistoryResponse>(`/sales-orders/variant-history/${variantId}`, {
      params,
      signal,
    }),
  create: (payload: CreateSalesOrderPayload) =>
    apiClient.post<SalesOrderDetail>('/sales-orders', payload),
  update: (id: string, payload: UpdateSalesOrderPayload) =>
    apiClient.patch<SalesOrderDetail>(`/sales-orders/${id}`, payload),
  reassignLocation: (id: string, payload: ReassignSalesOrderLocationPayload) =>
    apiClient.post<SalesOrderDetail>(`/sales-orders/${id}/reassign-location`, payload),
  requestTransfer: (id: string, payload: RequestSalesOrderTransferPayload) =>
    apiClient.post<SalesOrderDetail>(`/sales-orders/${id}/request-transfer`, payload),
  recheckStock: (id: string) =>
    apiClient.post<SalesOrderDetail>(`/sales-orders/${id}/recheck-stock`),
  complete: (id: string, payload?: CompleteSalesOrderPayload) =>
    apiClient.post<SalesOrderDetail>(`/sales-orders/${id}/complete`, payload ?? {}),
  cancel: (id: string) => apiClient.post<SalesOrderDetail>(`/sales-orders/${id}/cancel`),
}
