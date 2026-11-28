import axios from 'axios'
import { computed, ref } from 'vue'
import {
  pickTasksApi,
  type DropoffPickTaskPayload,
  type DropoffResponse,
  type PickItemPayload,
  type PickResponse,
} from '@/api/pickTasks'
import { hasHttpResponse, isNetworkError } from '@/composables/useOfflinePutawayQueue'
import { extractApiError } from '@/utils/locationMeta'

export { hasHttpResponse, isNetworkError }

export const OFFLINE_PICKING_QUEUE_STORAGE_KEY = 'xstorage_offline_picking_queue_v1'

export type QueuedPickingStatus = 'PENDING' | 'SENDING' | 'FAILED'

export type QueuedPickingOperationType = 'pick' | 'dropoff'

interface QueuedPickingItemBase {
  localId: string
  pickTaskId: string
  taskNumber?: string
  label: string
  detailLabel?: string
  createdAt: string
  status: QueuedPickingStatus
  lastError?: string
}

export interface QueuedPickItem extends QueuedPickingItemBase {
  type: 'pick'
  payload: PickItemPayload
}

export interface QueuedDropoffItem extends QueuedPickingItemBase {
  type: 'dropoff'
  payload: DropoffPickTaskPayload
}

export type QueuedPickingItem = QueuedPickItem | QueuedDropoffItem

export interface EnqueuePickInput {
  pickTaskId: string
  taskNumber?: string
  payload: PickItemPayload
  label: string
  detailLabel?: string
}

export interface EnqueueDropoffInput {
  pickTaskId: string
  taskNumber?: string
  payload: DropoffPickTaskPayload
  label: string
  detailLabel?: string
}

export interface PickingFlushQueueResult {
  syncedCount: number
  failedCount: number
  stoppedOffline: boolean
}

export interface OfflinePickingSyncEvent {
  pickTaskId?: string
  syncedCount: number
  failedCount: number
  stoppedOffline: boolean
  timestamp: number
}

export type OfflinePickingSyncSuccessCallback = (
  item: QueuedPickingItem,
  response: PickResponse | DropoffResponse,
) => void

function generateLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `picking-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isValidQueuedItem(value: unknown): value is QueuedPickingItem {
  if (!isRecord(value)) return false
  if (
    typeof value.localId !== 'string' ||
    typeof value.pickTaskId !== 'string' ||
    typeof value.label !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !isRecord(value.payload)
  ) {
    return false
  }
  if (value.status !== 'PENDING' && value.status !== 'SENDING' && value.status !== 'FAILED') {
    return false
  }
  if (value.type === 'pick') {
    return typeof value.payload.quantity === 'number'
  }
  if (value.type === 'dropoff') {
    return true
  }
  return false
}

function loadFromStorage(): QueuedPickingItem[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return []
  }
  try {
    const raw = localStorage.getItem(OFFLINE_PICKING_QUEUE_STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidQueuedItem).map((item) => ({
      ...item,
      // Ha az előző munkamenet küldés közben megszakadt, visszaállítjuk PENDING-re
      status: item.status === 'SENDING' ? 'PENDING' : item.status,
    }))
  } catch {
    return []
  }
}

function saveToStorage(items: QueuedPickingItem[]): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return
  }
  try {
    localStorage.setItem(OFFLINE_PICKING_QUEUE_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // Storage quota vagy tiltott localStorage esetén nem állítjuk meg a futást
  }
}

// Modul-szintű reaktív singleton állapot
const queue = ref<QueuedPickingItem[]>(loadFromStorage())
const isOnline = ref<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true)
const isFlushing = ref<boolean>(false)
const lastSyncedAt = ref<string | null>(null)
const lastSyncEvent = ref<OfflinePickingSyncEvent | null>(null)

let activeFlushPromise: Promise<PickingFlushQueueResult> | null = null
let listenersInitialized = false

const totalPendingCount = computed(
  () => queue.value.filter((item) => item.status === 'PENDING' || item.status === 'SENDING').length,
)

const totalFailedCount = computed(
  () => queue.value.filter((item) => item.status === 'FAILED').length,
)

export function enqueuePick(input: EnqueuePickInput): QueuedPickItem {
  const entry: QueuedPickItem = {
    localId: generateLocalId(),
    type: 'pick',
    pickTaskId: input.pickTaskId,
    taskNumber: input.taskNumber,
    payload: { ...input.payload },
    label: input.label,
    detailLabel: input.detailLabel,
    createdAt: new Date().toISOString(),
    status: 'PENDING',
  }
  queue.value = [...queue.value, entry]
  saveToStorage(queue.value)
  return entry
}

export function enqueueDropoff(input: EnqueueDropoffInput): QueuedDropoffItem {
  const entry: QueuedDropoffItem = {
    localId: generateLocalId(),
    type: 'dropoff',
    pickTaskId: input.pickTaskId,
    taskNumber: input.taskNumber,
    payload: { ...input.payload },
    label: input.label,
    detailLabel: input.detailLabel,
    createdAt: new Date().toISOString(),
    status: 'PENDING',
  }
  queue.value = [...queue.value, entry]
  saveToStorage(queue.value)
  return entry
}

export async function flushQueue(
  pickTaskId?: string,
  onSuccess?: OfflinePickingSyncSuccessCallback,
): Promise<PickingFlushQueueResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    isOnline.value = false
    return { syncedCount: 0, failedCount: 0, stoppedOffline: true }
  }

  if (activeFlushPromise) {
    return activeFlushPromise
  }

  const run = async (): Promise<PickingFlushQueueResult> => {
    isFlushing.value = true
    let syncedCount = 0
    let failedCount = 0
    let stoppedOffline = false

    try {
      while (true) {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          isOnline.value = false
          stoppedOffline = true
          break
        }

        const nextItem = queue.value.find(
          (entry) =>
            entry.status === 'PENDING' && (!pickTaskId || entry.pickTaskId === pickTaskId),
        )
        if (!nextItem) {
          break
        }

        nextItem.status = 'SENDING'

        try {
          let responseData: PickResponse | DropoffResponse
          if (nextItem.type === 'pick') {
            const response = await pickTasksApi.pick(nextItem.pickTaskId, nextItem.payload)
            responseData = response.data
          } else {
            const response = await pickTasksApi.dropoff(nextItem.pickTaskId, nextItem.payload)
            responseData = response.data
          }

          isOnline.value = true
          queue.value = queue.value.filter((entry) => entry.localId !== nextItem.localId)
          saveToStorage(queue.value)
          syncedCount += 1
          lastSyncedAt.value = new Date().toISOString()
          if (onSuccess) {
            onSuccess(nextItem, responseData)
          }
        } catch (err: unknown) {
          const httpStatus = axios.isAxiosError(err) ? err.response?.status : undefined
          const isTransientHttpError =
            httpStatus === 401 ||
            httpStatus === 408 ||
            httpStatus === 429 ||
            httpStatus === 502 ||
            httpStatus === 503 ||
            httpStatus === 504

          if (isNetworkError(err) || !hasHttpResponse(err) || isTransientHttpError) {
            nextItem.status = 'PENDING'
            nextItem.lastError = undefined
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
              isOnline.value = false
            }
            saveToStorage(queue.value)
            stoppedOffline = true
            break
          }

          isOnline.value = true
          nextItem.status = 'FAILED'
          nextItem.lastError = extractApiError(
            err,
            nextItem.type === 'pick'
              ? 'Sikertelen kiszedés – a szerver elutasította a műveletet'
              : 'Sikertelen leadás – a szerver elutasította a műveletet',
          )
          saveToStorage(queue.value)
          failedCount += 1
        }
      }
    } finally {
      isFlushing.value = false
      activeFlushPromise = null
    }

    if (syncedCount > 0 || failedCount > 0) {
      lastSyncEvent.value = {
        pickTaskId,
        syncedCount,
        failedCount,
        stoppedOffline,
        timestamp: Date.now(),
      }
    }

    return { syncedCount, failedCount, stoppedOffline }
  }

  activeFlushPromise = run()
  return activeFlushPromise
}

export async function retryItem(localId: string): Promise<PickingFlushQueueResult> {
  const target = queue.value.find((entry) => entry.localId === localId)
  if (!target || target.status === 'SENDING') {
    return { syncedCount: 0, failedCount: 0, stoppedOffline: false }
  }

  target.status = 'PENDING'
  target.lastError = undefined
  saveToStorage(queue.value)

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    isOnline.value = false
    return { syncedCount: 0, failedCount: 0, stoppedOffline: true }
  }

  return flushQueue(target.pickTaskId)
}

export function removeItem(localId: string): void {
  const target = queue.value.find((entry) => entry.localId === localId)
  if (!target || target.status === 'SENDING') {
    return
  }
  queue.value = queue.value.filter((entry) => entry.localId !== localId)
  saveToStorage(queue.value)
}

export function clearFailed(pickTaskId?: string): void {
  queue.value = queue.value.filter(
    (entry) =>
      !(entry.status === 'FAILED' && (!pickTaskId || entry.pickTaskId === pickTaskId)),
  )
  saveToStorage(queue.value)
}

export function getItemsForTask(pickTaskId: string): QueuedPickingItem[] {
  return queue.value.filter((entry) => entry.pickTaskId === pickTaskId)
}

export function getPendingCount(pickTaskId?: string): number {
  return queue.value.filter(
    (entry) =>
      (entry.status === 'PENDING' || entry.status === 'SENDING') &&
      (!pickTaskId || entry.pickTaskId === pickTaskId),
  ).length
}

export function getFailedCount(pickTaskId?: string): number {
  return queue.value.filter(
    (entry) =>
      entry.status === 'FAILED' && (!pickTaskId || entry.pickTaskId === pickTaskId),
  ).length
}

function initNetworkListeners(): void {
  if (listenersInitialized || typeof window === 'undefined') {
    return
  }
  listenersInitialized = true

  window.addEventListener('online', () => {
    isOnline.value = true
    void flushQueue()
  })

  window.addEventListener('offline', () => {
    isOnline.value = false
  })

  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key === OFFLINE_PICKING_QUEUE_STORAGE_KEY && !isFlushing.value) {
      queue.value = loadFromStorage()
    }
  })
}

export function useOfflinePickingQueue() {
  initNetworkListeners()

  return {
    queue,
    isOnline,
    isFlushing,
    lastSyncedAt,
    lastSyncEvent,
    totalPendingCount,
    totalFailedCount,
    enqueuePick,
    enqueueDropoff,
    flushQueue,
    retryItem,
    removeItem,
    clearFailed,
    getItemsForTask,
    getPendingCount,
    getFailedCount,
  }
}
