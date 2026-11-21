import axios from 'axios'
import { computed, ref } from 'vue'
import {
  goodsReceiptsApi,
  type PutawayPayload,
  type PutawayResponse,
} from '@/api/goodsReceipts'
import { extractApiError } from '@/utils/locationMeta'

export const OFFLINE_PUTAWAY_QUEUE_STORAGE_KEY = 'xstorage_offline_putaway_queue_v1'

export type QueuedPutawayStatus = 'PENDING' | 'SENDING' | 'FAILED'

export interface QueuedPutawayItem {
  localId: string
  goodsReceiptId: string
  payload: PutawayPayload
  productLabel: string
  locationLabel: string
  createdAt: string
  status: QueuedPutawayStatus
  lastError?: string
}

export interface EnqueuePutawayInput {
  goodsReceiptId: string
  payload: PutawayPayload
  productLabel: string
  locationLabel: string
}

export interface FlushQueueResult {
  syncedCount: number
  failedCount: number
  stoppedOffline: boolean
}

export interface OfflineQueueSyncEvent {
  goodsReceiptId?: string
  syncedCount: number
  failedCount: number
  stoppedOffline: boolean
  timestamp: number
}

function generateLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `putaway-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isValidQueuedItem(value: unknown): value is QueuedPutawayItem {
  if (!isRecord(value)) return false
  if (
    typeof value.localId !== 'string' ||
    typeof value.goodsReceiptId !== 'string' ||
    typeof value.productLabel !== 'string' ||
    typeof value.locationLabel !== 'string' ||
    typeof value.createdAt !== 'string' ||
    !isRecord(value.payload) ||
    typeof value.payload.quantity !== 'number'
  ) {
    return false
  }
  return value.status === 'PENDING' || value.status === 'SENDING' || value.status === 'FAILED'
}

function loadFromStorage(): QueuedPutawayItem[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return []
  }
  try {
    const raw = localStorage.getItem(OFFLINE_PUTAWAY_QUEUE_STORAGE_KEY)
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

function saveToStorage(items: QueuedPutawayItem[]): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return
  }
  try {
    localStorage.setItem(OFFLINE_PUTAWAY_QUEUE_STORAGE_KEY, JSON.stringify(items))
  } catch {
    // Storage quota vagy tiltott localStorage esetén nem állítjuk meg a futást
  }
}

export function hasHttpResponse(err: unknown): boolean {
  if (axios.isAxiosError(err)) {
    return err.response !== undefined
  }
  if (isRecord(err) && 'response' in err) {
    return err.response !== undefined
  }
  return false
}

export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true
  }
  if (axios.isAxiosError(err)) {
    if (err.code === 'ERR_CANCELED') {
      return false
    }
    if (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return true
    }
    return err.response === undefined
  }
  if (isRecord(err)) {
    if (err.code === 'ERR_CANCELED') {
      return false
    }
    if (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
      return true
    }
    if ('response' in err) {
      return err.response === undefined
    }
  }
  return false
}

// Modul-szintű reaktív singleton állapot
const queue = ref<QueuedPutawayItem[]>(loadFromStorage())
const isOnline = ref<boolean>(typeof navigator !== 'undefined' ? navigator.onLine : true)
const isFlushing = ref<boolean>(false)
const lastSyncedAt = ref<string | null>(null)
const lastSyncEvent = ref<OfflineQueueSyncEvent | null>(null)

let activeFlushPromise: Promise<FlushQueueResult> | null = null
let listenersInitialized = false

const totalPendingCount = computed(
  () => queue.value.filter((item) => item.status === 'PENDING' || item.status === 'SENDING').length,
)

const totalFailedCount = computed(
  () => queue.value.filter((item) => item.status === 'FAILED').length,
)

function enqueue(input: EnqueuePutawayInput): QueuedPutawayItem {
  const entry: QueuedPutawayItem = {
    localId: generateLocalId(),
    goodsReceiptId: input.goodsReceiptId,
    payload: { ...input.payload },
    productLabel: input.productLabel,
    locationLabel: input.locationLabel,
    createdAt: new Date().toISOString(),
    status: 'PENDING',
  }
  queue.value = [...queue.value, entry]
  saveToStorage(queue.value)
  return entry
}

async function flushQueue(
  goodsReceiptId?: string,
  onSuccess?: (item: QueuedPutawayItem, response: PutawayResponse) => void,
): Promise<FlushQueueResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    isOnline.value = false
    return { syncedCount: 0, failedCount: 0, stoppedOffline: true }
  }

  if (activeFlushPromise) {
    return activeFlushPromise
  }

  const run = async (): Promise<FlushQueueResult> => {
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
            entry.status === 'PENDING' &&
            (!goodsReceiptId || entry.goodsReceiptId === goodsReceiptId),
        )
        if (!nextItem) {
          break
        }

        nextItem.status = 'SENDING'

        try {
          const response = await goodsReceiptsApi.putaway(nextItem.goodsReceiptId, nextItem.payload)
          isOnline.value = true
          queue.value = queue.value.filter((entry) => entry.localId !== nextItem.localId)
          saveToStorage(queue.value)
          syncedCount += 1
          lastSyncedAt.value = new Date().toISOString()
          if (onSuccess) {
            onSuccess(nextItem, response.data)
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
            'Sikertelen elrakás – a szerver elutasította a műveletet',
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
        goodsReceiptId,
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

async function retryItem(localId: string): Promise<FlushQueueResult> {
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

  return flushQueue(target.goodsReceiptId)
}

function removeItem(localId: string): void {
  const target = queue.value.find((entry) => entry.localId === localId)
  if (!target || target.status === 'SENDING') {
    return
  }
  queue.value = queue.value.filter((entry) => entry.localId !== localId)
  saveToStorage(queue.value)
}

function getItemsForReceipt(goodsReceiptId: string): QueuedPutawayItem[] {
  return queue.value.filter((entry) => entry.goodsReceiptId === goodsReceiptId)
}

function getPendingCount(goodsReceiptId?: string): number {
  return queue.value.filter(
    (entry) =>
      (entry.status === 'PENDING' || entry.status === 'SENDING') &&
      (!goodsReceiptId || entry.goodsReceiptId === goodsReceiptId),
  ).length
}

function getFailedCount(goodsReceiptId?: string): number {
  return queue.value.filter(
    (entry) =>
      entry.status === 'FAILED' && (!goodsReceiptId || entry.goodsReceiptId === goodsReceiptId),
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
    if (event.key === OFFLINE_PUTAWAY_QUEUE_STORAGE_KEY && !isFlushing.value) {
      queue.value = loadFromStorage()
    }
  })
}

export function useOfflinePutawayQueue() {
  initNetworkListeners()

  return {
    queue,
    isOnline,
    isFlushing,
    lastSyncedAt,
    lastSyncEvent,
    totalPendingCount,
    totalFailedCount,
    enqueue,
    flushQueue,
    retryItem,
    removeItem,
    getItemsForReceipt,
    getPendingCount,
    getFailedCount,
  }
}
