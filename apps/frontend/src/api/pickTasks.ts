import type {
  PickTaskStatus,
  SalesChannel,
  SalesOrderStatus,
  SlotMode,
  StockReportStatus,
} from '@wmanager/shared-types'
import apiClient from './axios'
import type { LocationItem } from './locations'
import type {
  SalesOrderMovementDto,
  SalesOrderUserRef,
  SalesOrderVariantInfo,
} from './salesOrders'

export interface AvailableShelfOption {
  locationId: string
  locationName: string
  locationPath: string
  zoneId: string | null
  zoneName: string | null
  slotMode: SlotMode | null
  quantity: number
  isInTaskZone: boolean
}

export interface PickTaskSalesOrderRef {
  id: string
  orderNumber: string
  externalOrderRef?: string | null
  channel: SalesChannel
  status: SalesOrderStatus
  customerName: string
  holdReason?: string | null
  note?: string | null
  createdAt: string
}

export interface PickTaskItemSummary {
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

export interface PickTaskItemDetail extends PickTaskItemSummary {
  suggestedLocationPath: string
  availableShelves: AvailableShelfOption[]
}

export interface PickTaskListItem {
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
  salesOrder: PickTaskSalesOrderRef
  sourceLocation: LocationItem
  zone?: LocationItem | null
  assignedToUser?: SalesOrderUserRef | null
  dropoffLocation?: LocationItem | null
  items: PickTaskItemSummary[]
}

export interface PickTaskRouteTask extends PickTaskListItem {
  items: PickTaskItemDetail[]
}

export interface PickTaskDetail extends PickTaskRouteTask {
  stockMovements: SalesOrderMovementDto[]
}

export interface PickTaskListResponse {
  items: PickTaskListItem[]
  total: number
}

export interface FindPickTasksQuery {
  sourceLocationId?: string
  zoneId?: string
  status?: PickTaskStatus
  assignedToMe?: boolean
  salesOrderId?: string
  search?: string
  skip?: number
  take?: number
}

export interface MyRouteItem {
  pickTaskId: string
  taskNumber: string
  salesOrderId: string
  orderNumber: string
  externalOrderRef: string | null
  customerName: string
  toteCode: string | null
  sourceLocationId: string
  sourceLocationName: string
  zoneId: string | null
  zoneName: string | null
  pickTaskItemId: string
  salesOrderItemId: string
  variantId: string
  variant: SalesOrderVariantInfo
  suggestedLocationId: string | null
  suggestedLocationName: string | null
  suggestedLocationPath: string
  requiredQuantity: number
  pickedQuantity: number
  remainingQuantity: number
  availableShelves: AvailableShelfOption[]
}

export interface MyRouteResponse {
  tasks: PickTaskRouteTask[]
  inProgressTasks: PickTaskRouteTask[]
  awaitingDropTasks: PickTaskRouteTask[]
  routeItems: MyRouteItem[]
}

export interface ClaimPickTaskPayload {
  toteCode?: string
}

export interface ClaimPickTaskEntryPayload {
  pickTaskId: string
  toteCode?: string
}

export interface ClaimPickTasksBatchPayload {
  pickTaskIds?: string[]
  toteCode?: string
  tasks?: ClaimPickTaskEntryPayload[]
}

export interface ClaimBatchResponse {
  tasks: PickTaskDetail[]
}

export interface PickItemPayload {
  pickTaskItemId?: string
  variantId?: string
  barcode?: string
  sku?: string
  locationId?: string
  locationName?: string
  quantity: number
  note?: string
}

export interface PickTaskStockItemRef {
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

export interface PickResponse extends PickTaskDetail {
  lastMovement: SalesOrderMovementDto
  stockItem: PickTaskStockItemRef
}

export interface DropoffPickTaskPayload {
  dropoffLocationId?: string
  dropoffCode?: string
  handoverAtCounter?: boolean
  note?: string
}

export type DropoffResponse = PickTaskDetail

export interface UndoPickResponse extends PickTaskDetail {
  lastMovement: SalesOrderMovementDto
}

export interface ReportPickShortagePayload {
  variantId: string
  locationId: string
  foundQuantity: number
  reason?: string
}

export interface PickShortageReportDto {
  id: string
  variantId: string
  locationId: string
  expectedQuantity: number
  foundQuantity: number
  reason: string
  status: StockReportStatus
  reportedByUserId: string
  resolvedByUserId?: string | null
  resolutionNote?: string | null
  resolvedAt?: string | null
  createdAt: string
  updatedAt: string
  location: LocationItem
  variant: SalesOrderVariantInfo
  reportedByUser: SalesOrderUserRef
}

export interface ReportShortageResponse {
  task: PickTaskDetail
  stockReport: PickShortageReportDto
}

export const pickTasksApi = {
  list: (params?: FindPickTasksQuery, signal?: AbortSignal) =>
    apiClient.get<PickTaskListResponse>('/pick-tasks', { params, signal }),
  getMyRoute: (sourceLocationId?: string, signal?: AbortSignal) =>
    apiClient.get<MyRouteResponse>('/pick-tasks/my-route', {
      params: sourceLocationId ? { sourceLocationId } : undefined,
      signal,
    }),
  getOne: (id: string, signal?: AbortSignal) =>
    apiClient.get<PickTaskDetail>(`/pick-tasks/${id}`, { signal }),
  claim: (id: string, payload?: ClaimPickTaskPayload) =>
    apiClient.post<PickTaskDetail>(`/pick-tasks/${id}/claim`, payload ?? {}),
  claimBatch: (payload: ClaimPickTasksBatchPayload) =>
    apiClient.post<ClaimBatchResponse>('/pick-tasks/claim-batch', payload),
  release: (id: string) => apiClient.post<PickTaskDetail>(`/pick-tasks/${id}/release`),
  updateTote: (id: string, toteCode: string | null) =>
    apiClient.patch<PickTaskDetail>(`/pick-tasks/${id}/tote`, { toteCode }),
  pick: (id: string, payload: PickItemPayload) =>
    apiClient.post<PickResponse>(`/pick-tasks/${id}/pick`, payload),
  dropoff: (id: string, payload: DropoffPickTaskPayload) =>
    apiClient.post<DropoffResponse>(`/pick-tasks/${id}/dropoff`, payload),
  undoPick: (id: string, movementId: string) =>
    apiClient.post<UndoPickResponse>(`/pick-tasks/${id}/pick/${movementId}/undo`),
  reportShortage: (id: string, payload: ReportPickShortagePayload) =>
    apiClient.post<ReportShortageResponse>(`/pick-tasks/${id}/report-shortage`, payload),
}
