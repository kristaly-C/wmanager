<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  GoodsReceiptStatus,
  LocationType,
  MovementType,
  Role,
  SlotMode,
} from '@wmanager/shared-types'
import { useAuthStore } from '@/stores/auth'
import {
  goodsReceiptsApi,
  type AddGoodsReceiptItemPayload,
  type GoodsReceiptDetail,
  type GoodsReceiptItemDto,
  type GoodsReceiptListItem,
  type GoodsReceiptMovementDto,
  type PutawayPayload,
} from '@/api/goodsReceipts'
import { locationApi, type LocationItem } from '@/api/locations'
import type { PurchaseOrderDetail } from '@/api/purchaseOrders'
import { variantApi, type VariantItem } from '@/api/variants'
import { isNetworkError } from '@/composables/useOfflinePutawayQueue'
import { formatDateTime, formatSignedQuantity } from '@/utils/formatters'
import { getBarcodeCandidates, normalizeScannedBarcode } from '@/utils/barcodeScanner'
import { extractApiError, getLocationPath, LOCATION_TYPE_META } from '@/utils/locationMeta'
import {
  canSeeCostPrice,
  formatCurrency,
  GOODS_RECEIPT_STATUS_META,
  GOODS_RECEIPT_STATUS_OPTIONS,
} from '@/utils/procurementMeta'
import GoodsReceiptApproveModal from './GoodsReceiptApproveModal.vue'
import GoodsReceiptFormModal from './GoodsReceiptFormModal.vue'
import Column from 'primevue/column'
import DataTable, {
  type DataTablePageEvent,
  type DataTableRowClickEvent,
} from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import { useToast } from 'primevue/usetoast'

const TWO_MINUTES_MS = 2 * 60 * 1000
const SILENT_SYNC_INTERVAL_MS = 10_000

const ACTIVE_SYNC_STATUSES: readonly GoodsReceiptStatus[] = [
  GoodsReceiptStatus.OPEN,
  GoodsReceiptStatus.IN_PROGRESS,
  GoodsReceiptStatus.WAITING_FOR_APPROVAL,
]

const props = defineProps<{
  initialReceiptId?: string | null
  preselectedPoForCreate?: PurchaseOrderDetail | null
}>()

const emit = defineEmits<{
  'clear-preselected-po': []
}>()

const authStore = useAuthStore()
const toast = useToast()

// Szerepkörök és jogosultságok
const userRole = computed(() => authStore.user?.role ?? null)
const currentUserId = computed(() => authStore.user?.userId ?? authStore.user?.id ?? '')

const showCostPrices = computed(() => canSeeCostPrice(userRole.value))
const canCreateReceipt = computed(() => showCostPrices.value)
const canAddExpectedItem = computed(() => showCostPrices.value)

const isManager = computed(() => {
  const role = userRole.value
  return (
    role === Role.BOSS ||
    role === Role.ADMIN ||
    role === Role.WAREHOUSE_MANAGER ||
    role === Role.STORE_MANAGER
  )
})

const isStaffSelfUndoOnly = computed(() => {
  const role = userRole.value
  return role === Role.WAREHOUSE_STAFF || role === Role.STORE_STAFF
})

const canPerformPutaway = computed(() => isManager.value || isStaffSelfUndoOnly.value)

// Törzsadatok: lokációk
const allLocations = ref<LocationItem[]>([])
const loadingLocations = ref(false)

// Lista állapot (szerveroldali lapozás & szűrés)
const receipts = ref<GoodsReceiptListItem[]>([])
const totalRecords = ref(0)
const listLoading = ref(false)
const searchInput = ref('')
const debouncedSearch = ref('')
const statusFilter = ref<GoodsReceiptStatus | null>(null)
const locationFilter = ref<string | null>(null)
const currentPage = ref(1)
const pageSize = 10

// Kiválasztott bevételezés részletei
const selectedReceiptId = ref<string | null>(null)
const selectedReceipt = ref<GoodsReceiptDetail | null>(null)
const detailLoading = ref(false)
const silentRefreshing = ref(false)
const actionLoading = ref(false)

// Online / csendes szinkron állapot
const isOfflineOrDisconnected = ref(
  typeof navigator !== 'undefined' ? !navigator.onLine : false,
)
const lastSyncedAt = ref<string | null>(null)
const nowMs = ref(Date.now())

// Modálok
const isCreateModalOpen = ref(false)
const formPreselectedPo = ref<PurchaseOrderDetail | null>(null)
const isApproveModalOpen = ref(false)

// Megerősítő dialógusok
const isFinishConfirmOpen = ref(false)
const isCancelConfirmOpen = ref(false)
const undoConfirmMovement = ref<GoodsReceiptMovementDto | null>(null)

// PC elrakás (putaway) gyorsűrlap állapot
const putawaySelectedVariantId = ref<string | null>(null)
const putawayCodeInput = ref('')
const putawayLocationId = ref<string | null>(null)
const putawayQuantity = ref<number>(1)
const putawayNote = ref('')
const putawaySubmitting = ref(false)

// Várt tétel hozzáadása (addItem) dialógus állapot
const isAddItemDialogOpen = ref(false)
const addItemSearchInput = ref('')
const addItemVariantResults = ref<VariantItem[]>([])
const addItemLoadingVariants = ref(false)
const addItemSelectedVariant = ref<VariantItem | null>(null)
const addItemExpectedQty = ref<number>(1)
const addItemUnitCost = ref<number>(0)
const addItemExpectedLocationId = ref<string | null>(null)
const addItemNote = ref('')
const addItemSubmitting = ref(false)

// Időzítők és AbortControllerek
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
let addItemSearchTimer: ReturnType<typeof setTimeout> | null = null
let listAbortController: AbortController | null = null
let detailAbortController: AbortController | null = null
let syncIntervalId: ReturnType<typeof setInterval> | null = null
let clockIntervalId: ReturnType<typeof setInterval> | null = null
let latestAddItemSearchSeq = 0

function isCanceledError(err: unknown): boolean {
  const e = err as { code?: string; name?: string }
  return e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || e?.name === 'AbortError'
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

// Lokáció segédek
const locationById = computed(() => new Map(allLocations.value.map((loc) => [loc.id, loc])))

const locationFilterOptions = computed(() => {
  const roots = allLocations.value.filter(
    (loc) =>
      loc.isAssigned !== false &&
      (loc.type === LocationType.WAREHOUSE || loc.type === LocationType.STORE),
  )
  const source = roots.length > 0 ? roots : allLocations.value.filter((loc) => loc.isAssigned !== false)
  return source
    .map((loc) => ({
      id: loc.id,
      label: `${loc.name} (${LOCATION_TYPE_META[loc.type].label})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'hu', { numeric: true }))
})

function isLocationInSubtree(locationId: string, rootId: string): boolean {
  let current: LocationItem | undefined = locationById.value.get(locationId)
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    if (current.id === rootId) return true
    visited.add(current.id)
    current = current.parentId ? locationById.value.get(current.parentId) : undefined
  }
  return false
}

function formatLocationPath(locationId: string, fallbackName?: string): string {
  const path = getLocationPath(locationId, locationById.value)
  if (path.length > 0) return path.map((p) => p.name).join(' › ')
  return fallbackName ?? '—'
}

const targetSubtreeShelfOptions = computed(() => {
  const receipt = selectedReceipt.value
  if (!receipt) return []
  const rootId = receipt.targetLocationId
  const options = allLocations.value
    .filter(
      (loc) => loc.isActive && loc.isAssigned !== false && isLocationInSubtree(loc.id, rootId),
    )
    .map((loc) => {
      const pathLabel = formatLocationPath(loc.id, loc.name)
      const dedicatedSuffix = loc.slotMode === SlotMode.DEDICATED ? ' · DEDICATED' : ''
      return {
        id: loc.id,
        label: `${pathLabel} (${LOCATION_TYPE_META[loc.type].label}${dedicatedSuffix})`,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'hu', { numeric: true }))

  if (options.length === 0) {
    return [
      {
        id: receipt.targetLocation.id,
        label: `${receipt.targetLocation.name} (${LOCATION_TYPE_META[receipt.targetLocation.type].label})`,
      },
    ]
  }
  return options
})

// Kiválasztott bevételezés származtatott állapotai
const isSelectedEditable = computed(() => {
  const status = selectedReceipt.value?.status
  return status === GoodsReceiptStatus.OPEN || status === GoodsReceiptStatus.IN_PROGRESS
})

const isSelectedSyncEligible = computed(() => {
  const status = selectedReceipt.value?.status
  return Boolean(status && ACTIVE_SYNC_STATUSES.includes(status))
})

const totalExpectedQty = computed(() =>
  (selectedReceipt.value?.items ?? []).reduce((sum, item) => sum + item.expectedQuantity, 0),
)

const totalReceivedQty = computed(() =>
  (selectedReceipt.value?.items ?? []).reduce((sum, item) => sum + item.receivedQuantity, 0),
)

const hasDiscrepancies = computed(() =>
  (selectedReceipt.value?.items ?? []).some(
    (item) => item.isUnexpected || item.receivedQuantity !== item.expectedQuantity,
  ),
)

const discrepancyItemCount = computed(
  () =>
    (selectedReceipt.value?.items ?? []).filter(
      (item) => item.isUnexpected || item.receivedQuantity !== item.expectedQuantity,
    ).length,
)

const totalReceivedValueHuf = computed(() =>
  round2(
    (selectedReceipt.value?.items ?? []).reduce(
      (sum, item) => sum + item.receivedQuantity * Number(item.unitCostHuf ?? 0),
      0,
    ),
  ),
)

const canFinishReceipt = computed(
  () =>
    canPerformPutaway.value &&
    isSelectedEditable.value &&
    (selectedReceipt.value?.items.length ?? 0) > 0,
)

const canApproveReceipt = computed(
  () => isManager.value && selectedReceipt.value?.status === GoodsReceiptStatus.WAITING_FOR_APPROVAL,
)

const canCancelReceipt = computed(() => {
  const receipt = selectedReceipt.value
  if (!isManager.value || !receipt) return false
  if (
    receipt.status === GoodsReceiptStatus.COMPLETED ||
    receipt.status === GoodsReceiptStatus.CANCELLED
  ) {
    return false
  }
  return totalReceivedQty.value === 0
})

// Utolsó PURCHASE_RECEIPT aktivitás figyelés
const lastPurchaseReceiptMovement = computed<GoodsReceiptMovementDto | null>(() => {
  const movements = selectedReceipt.value?.stockMovements ?? []
  if (movements.length === 0) return null
  return (
    movements.find((m) => m.type === MovementType.PURCHASE_RECEIPT) ?? movements[0] ?? null
  )
})

function formatRelativeTimeHu(iso: string, currentMs: number): string {
  const ts = new Date(iso).getTime()
  if (Number.isNaN(ts)) return '—'
  const diffSec = Math.max(0, Math.floor((currentMs - ts) / 1000))
  if (diffSec < 5) return 'épp most'
  if (diffSec < 60) return `${diffSec} mp-e`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} perce`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours} órája`
  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays} napja`
}

const lastActivityUserName = computed(
  () => lastPurchaseReceiptMovement.value?.createdByUser?.name ?? 'Ismeretlen munkatárs',
)

const lastActivityRelativeText = computed(() => {
  const movement = lastPurchaseReceiptMovement.value
  if (!movement) return null
  return formatRelativeTimeHu(movement.createdAt, nowMs.value)
})

const isLastActivityWithinTwoMinutes = computed(() => {
  const movement = lastPurchaseReceiptMovement.value
  if (!movement) return false
  const ts = new Date(movement.createdAt).getTime()
  if (Number.isNaN(ts)) return false
  return nowMs.value - ts < TWO_MINUTES_MS
})

// PC Elrakás tétel választó opciók
const putawayItemOptions = computed(() => {
  const items = selectedReceipt.value?.items ?? []
  return [...items]
    .sort((a, b) => {
      const remA = a.expectedQuantity - a.receivedQuantity
      const remB = b.expectedQuantity - b.receivedQuantity
      if (remA > 0 && remB <= 0) return -1
      if (remA <= 0 && remB > 0) return 1
      return a.variant.sku.localeCompare(b.variant.sku, 'hu')
    })
    .map((item) => {
      const productName = item.variant.product?.name ?? 'Ismeretlen termék'
      const sizeStr = item.variant.size ? ` · ${item.variant.size}` : ''
      const remaining = Math.max(0, item.expectedQuantity - item.receivedQuantity)
      const barcodes = (item.variant.variantBarcodes ?? [])
        .flatMap((b) => getBarcodeCandidates(b.barcode))
        .join(' ')
      const skuCandidates = getBarcodeCandidates(item.variant.sku).join(' ')
      return {
        variantId: item.variantId,
        expectedLocationId: item.expectedLocationId ?? null,
        remaining,
        label: `${item.variant.sku} — ${productName}${sizeStr} (${item.receivedQuantity}/${item.expectedQuantity} db)`,
        searchText: `${item.variant.sku} ${skuCandidates} ${productName} ${sizeStr} ${barcodes}`.toLowerCase(),
      }
    })
})

const selectedPutawayOption = computed(() =>
  putawayItemOptions.value.find((opt) => opt.variantId === putawaySelectedVariantId.value) ?? null,
)

const hasActiveFilters = computed(
  () =>
    debouncedSearch.value.length > 0 ||
    statusFilter.value !== null ||
    locationFilter.value !== null,
)

function getListExpectedSum(receipt: GoodsReceiptListItem): number {
  return receipt.items.reduce((sum, item) => sum + item.expectedQuantity, 0)
}

function getListReceivedSum(receipt: GoodsReceiptListItem): number {
  return receipt.items.reduce((sum, item) => sum + item.receivedQuantity, 0)
}

function getListUnexpectedCount(receipt: GoodsReceiptListItem): number {
  return receipt.items.filter((item) => item.isUnexpected).length
}

function getProgressPercent(received: number, expected: number): number {
  if (expected <= 0) return received > 0 ? 100 : 0
  return Math.min(100, Math.round((received / expected) * 100))
}

function getItemDiff(item: GoodsReceiptItemDto): number {
  return item.receivedQuantity - item.expectedQuantity
}

function canUndoMovement(movement: GoodsReceiptMovementDto): boolean {
  const receipt = selectedReceipt.value
  if (!receipt) return false
  if (
    receipt.status !== GoodsReceiptStatus.IN_PROGRESS &&
    receipt.status !== GoodsReceiptStatus.WAITING_FOR_APPROVAL
  ) {
    return false
  }
  if (
    movement.type !== MovementType.PURCHASE_RECEIPT ||
    movement.quantity <= 0 ||
    movement.reversedMovementId !== null && movement.reversedMovementId !== undefined ||
    Boolean(movement.reversedBy)
  ) {
    return false
  }
  if (isManager.value) return true
  if (isStaffSelfUndoOnly.value) {
    return movement.createdByUserId === currentUserId.value
  }
  return false
}

function syncReceiptInList(detail: GoodsReceiptDetail) {
  const idx = receipts.value.findIndex((r) => r.id === detail.id)
  if (idx !== -1) {
    const updated = [...receipts.value]
    updated[idx] = detail
    receipts.value = updated
  }
}

// API hívások
async function loadLocations() {
  loadingLocations.value = true
  try {
    const res = await locationApi.getAll()
    allLocations.value = res.data
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Helyszínek betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a raktárak/üzletek listáját.'),
      life: 4000,
    })
  } finally {
    loadingLocations.value = false
  }
}

async function loadReceipts(silent = false) {
  if (listAbortController) {
    listAbortController.abort()
  }
  const controller = new AbortController()
  listAbortController = controller

  if (!silent) {
    listLoading.value = true
  }

  try {
    const skip = (currentPage.value - 1) * pageSize
    const res = await goodsReceiptsApi.list(
      {
        search: debouncedSearch.value || undefined,
        status: statusFilter.value ?? undefined,
        locationId: locationFilter.value ?? undefined,
        skip,
        take: pageSize,
      },
      controller.signal,
    )
    receipts.value = res.data.items
    totalRecords.value = res.data.total
    isOfflineOrDisconnected.value = false

    if (!selectedReceiptId.value && res.data.items.length > 0 && res.data.items[0]) {
      const firstId = res.data.items[0].id
      selectedReceiptId.value = firstId
      void loadReceiptDetail(firstId)
    }
  } catch (err) {
    if (isCanceledError(err)) return
    if (isNetworkError(err)) {
      isOfflineOrDisconnected.value = true
      if (silent) return
    }
    if (!silent) {
      toast.add({
        severity: 'error',
        summary: 'Betöltési hiba',
        detail: extractApiError(err, 'Nem sikerült betölteni a bevételezéseket.'),
        life: 5000,
      })
    }
  } finally {
    if (listAbortController === controller) {
      listLoading.value = false
    }
  }
}

async function loadReceiptDetail(id: string) {
  if (detailAbortController) {
    detailAbortController.abort()
  }
  const controller = new AbortController()
  detailAbortController = controller

  detailLoading.value = true
  try {
    const res = await goodsReceiptsApi.getOne(id, controller.signal)
    selectedReceipt.value = res.data
    syncReceiptInList(res.data)
    isOfflineOrDisconnected.value = false
    lastSyncedAt.value = new Date().toISOString()
    resetPutawayLocationForReceipt(res.data)
  } catch (err) {
    if (isCanceledError(err)) return
    if (isNetworkError(err)) {
      isOfflineOrDisconnected.value = true
    }
    toast.add({
      severity: 'error',
      summary: 'Részletek betöltése sikertelen',
      detail: extractApiError(err, 'Nem sikerült betölteni a kiválasztott bevételezést.'),
      life: 5000,
    })
  } finally {
    if (detailAbortController === controller) {
      detailLoading.value = false
    }
  }
}

async function refreshSelected(silent = false) {
  const id = selectedReceiptId.value
  if (!id) return

  if (silent) {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      isOfflineOrDisconnected.value = true
      return
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return
    }
    if (silentRefreshing.value || detailLoading.value) {
      return
    }
  }

  if (silent) {
    silentRefreshing.value = true
  } else {
    detailLoading.value = true
  }

  try {
    const res = await goodsReceiptsApi.getOne(id)
    if (selectedReceiptId.value !== id) return
    selectedReceipt.value = res.data
    syncReceiptInList(res.data)
    isOfflineOrDisconnected.value = false
    lastSyncedAt.value = new Date().toISOString()
  } catch (err) {
    if (isCanceledError(err)) return
    if (silent) {
      if (isNetworkError(err) || (typeof navigator !== 'undefined' && !navigator.onLine)) {
        isOfflineOrDisconnected.value = true
      }
      return
    }
    if (isNetworkError(err)) {
      isOfflineOrDisconnected.value = true
    }
    toast.add({
      severity: 'error',
      summary: 'Frissítési hiba',
      detail: extractApiError(err, 'Nem sikerült frissíteni a bevételezés adatait.'),
      life: 4500,
    })
  } finally {
    if (silent) {
      silentRefreshing.value = false
    } else {
      detailLoading.value = false
    }
  }
}

function resetPutawayLocationForReceipt(receipt: GoodsReceiptDetail) {
  putawaySelectedVariantId.value = null
  putawayCodeInput.value = ''
  putawayQuantity.value = 1
  putawayNote.value = ''
  putawayLocationId.value = receipt.targetLocationId
}

function selectReceipt(id: string) {
  if (selectedReceiptId.value === id && selectedReceipt.value?.id === id) {
    return
  }
  selectedReceiptId.value = id
  void loadReceiptDetail(id)
}

function onRowClick(event: DataTableRowClickEvent) {
  const row = event.data as GoodsReceiptListItem | undefined
  if (row?.id) {
    selectReceipt(row.id)
  }
}

function onPage(event: DataTablePageEvent) {
  currentPage.value = event.page + 1
  void loadReceipts()
}

function triggerImmediateSearch() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  debouncedSearch.value = searchInput.value.trim()
  currentPage.value = 1
  void loadReceipts()
}

function resetFilters() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchInput.value = ''
  debouncedSearch.value = ''
  statusFilter.value = null
  locationFilter.value = null
  currentPage.value = 1
  void loadReceipts()
}

// Új bevételezés létrehozása
function openCreateBlankModal() {
  if (!canCreateReceipt.value) return
  formPreselectedPo.value = null
  isCreateModalOpen.value = true
}

function onReceiptCreated(created: GoodsReceiptDetail) {
  selectedReceiptId.value = created.id
  selectedReceipt.value = created
  resetPutawayLocationForReceipt(created)
  currentPage.value = 1
  void loadReceipts(true)
}

// PC Elrakás (start + putaway)
function prefillPutawayFromItem(item: GoodsReceiptItemDto) {
  putawaySelectedVariantId.value = item.variantId
  putawayCodeInput.value = ''
  const remaining = Math.max(1, item.expectedQuantity - item.receivedQuantity)
  putawayQuantity.value = remaining
  putawayLocationId.value =
    item.expectedLocationId ?? selectedReceipt.value?.targetLocationId ?? null
}

watch(putawaySelectedVariantId, (variantId) => {
  if (!variantId) return
  putawayCodeInput.value = ''
  const opt = putawayItemOptions.value.find((o) => o.variantId === variantId)
  if (opt) {
    if (opt.expectedLocationId) {
      putawayLocationId.value = opt.expectedLocationId
    }
    if (opt.remaining > 0) {
      putawayQuantity.value = opt.remaining
    }
  }
})

watch(putawayCodeInput, (code) => {
  if (code.trim().length > 0 && putawaySelectedVariantId.value) {
    putawaySelectedVariantId.value = null
  }
})

async function handleStartReceipt() {
  const receipt = selectedReceipt.value
  if (!receipt || receipt.status !== GoodsReceiptStatus.OPEN || actionLoading.value) return
  actionLoading.value = true
  try {
    const res = await goodsReceiptsApi.start(receipt.id)
    selectedReceipt.value = res.data
    syncReceiptInList(res.data)
    toast.add({
      severity: 'success',
      summary: 'Bevételezés megkezdve',
      detail: `${res.data.receiptNumber} folyamatban állapotba került.`,
      life: 3500,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Indítási hiba',
      detail: extractApiError(err, 'Nem sikerült elindítani a bevételezést.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

async function handlePcPutaway() {
  const receipt = selectedReceipt.value
  if (!receipt || !canPerformPutaway.value || !isSelectedEditable.value || putawaySubmitting.value) {
    return
  }

  const trimmedCode = normalizeScannedBarcode(putawayCodeInput.value)
  const chosenVariantId = putawaySelectedVariantId.value

  if (!chosenVariantId && !trimmedCode) {
    toast.add({
      severity: 'warn',
      summary: 'Hiányzó termék',
      detail: 'Válassz egy tételt a listából vagy adj meg vonalkódot / SKU-t!',
      life: 4000,
    })
    return
  }

  const qty = Math.trunc(Number(putawayQuantity.value))
  if (!Number.isInteger(qty) || qty < 1) {
    toast.add({
      severity: 'warn',
      summary: 'Érvénytelen mennyiség',
      detail: 'Az elrakandó mennyiségnek legalább 1 egész számnak kell lennie.',
      life: 4000,
    })
    return
  }

  const payload: PutawayPayload = {
    ...(chosenVariantId ? { variantId: chosenVariantId } : { barcode: trimmedCode }),
    locationId: putawayLocationId.value || receipt.targetLocationId,
    quantity: qty,
    note: putawayNote.value.trim() || undefined,
  }

  putawaySubmitting.value = true
  try {
    if (receipt.status === GoodsReceiptStatus.OPEN) {
      await goodsReceiptsApi.start(receipt.id)
    }
    const res = await goodsReceiptsApi.putaway(receipt.id, payload)
    selectedReceipt.value = res.data
    syncReceiptInList(res.data)
    isOfflineOrDisconnected.value = false
    lastSyncedAt.value = new Date().toISOString()

    const movedSku = res.data.lastMovement?.variant?.sku ?? trimmedCode
    toast.add({
      severity: 'success',
      summary: 'Elrakás rögzítve',
      detail: `${movedSku} (+${qty} db) sikeresen elrakva.`,
      life: 3500,
    })

    putawayCodeInput.value = ''
    putawaySelectedVariantId.value = null
    putawayQuantity.value = 1
    putawayNote.value = ''
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Elrakási hiba',
      detail: extractApiError(err, 'Nem sikerült rögzíteni az elrakást.'),
      life: 5500,
    })
  } finally {
    putawaySubmitting.value = false
  }
}

// Várt tétel hozzáadása (addItem)
function openAddItemDialog() {
  if (!canAddExpectedItem.value || !selectedReceipt.value || !isSelectedEditable.value) return
  addItemSearchInput.value = ''
  addItemSelectedVariant.value = null
  addItemExpectedQty.value = 1
  addItemUnitCost.value = 0
  addItemExpectedLocationId.value = null
  addItemNote.value = ''
  isAddItemDialogOpen.value = true
  void searchVariantsForAddItem('')
}

async function searchVariantsForAddItem(query: string) {
  const seq = ++latestAddItemSearchSeq
  addItemLoadingVariants.value = true
  try {
    const res = await variantApi.getAll({
      search: query.trim() || undefined,
      take: 15,
    })
    if (seq !== latestAddItemSearchSeq) return
    addItemVariantResults.value = res.data
  } catch (err) {
    if (seq !== latestAddItemSearchSeq) return
    toast.add({
      severity: 'error',
      summary: 'Variáns keresési hiba',
      detail: extractApiError(err, 'Nem sikerült keresni a variánsok között.'),
      life: 4000,
    })
  } finally {
    if (seq === latestAddItemSearchSeq) {
      addItemLoadingVariants.value = false
    }
  }
}

function pickVariantForAddItem(variant: VariantItem) {
  addItemSelectedVariant.value = variant
  const existing = selectedReceipt.value?.items.find((i) => i.variantId === variant.id)
  if (existing) {
    addItemExpectedQty.value = existing.expectedQuantity
    addItemUnitCost.value = round2(Number(existing.unitCost ?? 0))
    addItemExpectedLocationId.value = existing.expectedLocationId ?? null
    addItemNote.value = existing.note ?? ''
  } else {
    addItemExpectedQty.value = 1
    const curr = (selectedReceipt.value?.currency || 'HUF').toUpperCase()
    addItemUnitCost.value =
      curr === 'HUF' && variant.costPrice !== undefined ? round2(Number(variant.costPrice) || 0) : 0
    addItemExpectedLocationId.value = null
    addItemNote.value = ''
  }
}

const addItemPreviewHuf = computed(() => {
  const rate = Number(selectedReceipt.value?.exchangeRate ?? 1)
  const validRate = Number.isFinite(rate) && rate > 0 ? rate : 1
  const cost = Number.isFinite(addItemUnitCost.value) ? Math.max(0, addItemUnitCost.value) : 0
  return round2(cost * validRate)
})

async function handleSubmitAddItem() {
  const receipt = selectedReceipt.value
  if (!receipt || !addItemSelectedVariant.value || addItemSubmitting.value) return

  const qty = Math.trunc(Number(addItemExpectedQty.value))
  const cost = round2(Number(addItemUnitCost.value))

  if (!Number.isInteger(qty) || qty < 0) {
    toast.add({
      severity: 'warn',
      summary: 'Érvénytelen mennyiség',
      detail: 'A várt mennyiségnek legalább 0 egész számnak kell lennie.',
      life: 4000,
    })
    return
  }
  if (!Number.isFinite(cost) || cost < 0) {
    toast.add({
      severity: 'warn',
      summary: 'Érvénytelen egységár',
      detail: 'Az egységár nem lehet negatív.',
      life: 4000,
    })
    return
  }

  const payload: AddGoodsReceiptItemPayload = {
    variantId: addItemSelectedVariant.value.id,
    expectedQuantity: qty,
    unitCost: cost,
    expectedLocationId: addItemExpectedLocationId.value || undefined,
    note: addItemNote.value.trim() || undefined,
  }

  addItemSubmitting.value = true
  try {
    const res = await goodsReceiptsApi.addItem(receipt.id, payload)
    selectedReceipt.value = res.data
    syncReceiptInList(res.data)
    toast.add({
      severity: 'success',
      summary: 'Várt tétel mentve',
      detail: `${addItemSelectedVariant.value.sku} (${qty} db) rögzítve a bevételezéshez.`,
      life: 3500,
    })
    isAddItemDialogOpen.value = false
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Mentési hiba',
      detail: extractApiError(err, 'Nem sikerült hozzáadni a várt tételt.'),
      life: 5000,
    })
  } finally {
    addItemSubmitting.value = false
  }
}

// Sztornó (undoPutaway)
function requestUndoMovement(movement: GoodsReceiptMovementDto) {
  if (!canUndoMovement(movement)) return
  undoConfirmMovement.value = movement
}

async function confirmUndoMovement() {
  const receipt = selectedReceipt.value
  const movement = undoConfirmMovement.value
  if (!receipt || !movement || actionLoading.value) return

  actionLoading.value = true
  try {
    const res = await goodsReceiptsApi.undoPutaway(receipt.id, movement.id)
    selectedReceipt.value = res.data
    syncReceiptInList(res.data)
    undoConfirmMovement.value = null
    toast.add({
      severity: 'success',
      summary: 'Elrakás sztornózva',
      detail: `${movement.variant.sku} (-${movement.quantity} db) sikeresen sztornózva.`,
      life: 4000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Sztornózási hiba',
      detail: extractApiError(err, 'Nem sikerült sztornózni az elrakási mozgást.'),
      life: 5500,
    })
  } finally {
    actionLoading.value = false
  }
}

// Elrakás befejezése (/finish)
function openFinishConfirm() {
  if (!canFinishReceipt.value) return
  nowMs.value = Date.now()
  isFinishConfirmOpen.value = true
}

async function confirmFinishReceipt() {
  const receipt = selectedReceipt.value
  if (!receipt || actionLoading.value) return

  actionLoading.value = true
  try {
    const res = await goodsReceiptsApi.finish(receipt.id)
    selectedReceipt.value = res.data
    syncReceiptInList(res.data)
    isFinishConfirmOpen.value = false

    if (res.data.status === GoodsReceiptStatus.WAITING_FOR_APPROVAL) {
      toast.add({
        severity: 'warn',
        summary: 'Jóváhagyásra küldve',
        detail: `${res.data.receiptNumber} eltérés miatt vezetői jóváhagyásra vár.`,
        life: 5000,
      })
    } else {
      toast.add({
        severity: 'success',
        summary: 'Bevételezés lezárva',
        detail: `${res.data.receiptNumber} sikeresen lezárult, a készletértékek véglegesítve.`,
        life: 4500,
      })
    }
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Befejezési hiba',
      detail: extractApiError(err, 'Nem sikerült befejezni a bevételezést.'),
      life: 5500,
    })
  } finally {
    actionLoading.value = false
  }
}

// Jóváhagyás eredménye
function onReceiptApproved(updated: GoodsReceiptDetail) {
  selectedReceipt.value = updated
  syncReceiptInList(updated)
}

// Bevételezés törlése (/cancel)
async function confirmCancelReceipt() {
  const receipt = selectedReceipt.value
  if (!receipt || !canCancelReceipt.value || actionLoading.value) return

  actionLoading.value = true
  try {
    const res = await goodsReceiptsApi.cancel(receipt.id)
    selectedReceipt.value = res.data
    syncReceiptInList(res.data)
    isCancelConfirmOpen.value = false
    toast.add({
      severity: 'success',
      summary: 'Bevételezés törölve',
      detail: `${res.data.receiptNumber} törölt állapotba került.`,
      life: 4000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Törlési hiba',
      detail: extractApiError(err, 'Nem sikerült törölni a bevételezést.'),
      life: 5500,
    })
  } finally {
    actionLoading.value = false
  }
}

// Watcherek: külső propok (PurchaseOrdersView szerződés!)
watch(
  () => props.preselectedPoForCreate,
  (po) => {
    if (!po) return
    if (canCreateReceipt.value) {
      formPreselectedPo.value = po
      isCreateModalOpen.value = true
    }
    void nextTick(() => {
      emit('clear-preselected-po')
    })
  },
  { immediate: true },
)

watch(
  () => props.initialReceiptId,
  (id) => {
    if (!id) return
    selectedReceiptId.value = id
    void loadReceiptDetail(id)
  },
  { immediate: true },
)

// Szűrő és kereső watcherek
watch(searchInput, (val) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    const trimmed = val.trim()
    if (debouncedSearch.value !== trimmed) {
      debouncedSearch.value = trimmed
      currentPage.value = 1
      void loadReceipts()
    }
  }, 300)
})

watch([statusFilter, locationFilter], () => {
  currentPage.value = 1
  void loadReceipts()
})

watch(addItemSearchInput, (val) => {
  if (!isAddItemDialogOpen.value) return
  if (addItemSearchTimer) clearTimeout(addItemSearchTimer)
  addItemSearchTimer = setTimeout(() => {
    void searchVariantsForAddItem(val)
  }, 300)
})

// Hálózati és láthatósági eseménykezelők (csendes szinkron védelem)
function handleWindowOnline() {
  isOfflineOrDisconnected.value = false
  if (
    isSelectedSyncEligible.value &&
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible'
  ) {
    void refreshSelected(true)
  }
}

function handleWindowOffline() {
  isOfflineOrDisconnected.value = true
}

function handleVisibilityChange() {
  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    (typeof navigator === 'undefined' || navigator.onLine) &&
    isSelectedSyncEligible.value
  ) {
    void refreshSelected(true)
  }
}

onMounted(() => {
  void loadLocations()
  void loadReceipts()

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleWindowOnline)
    window.addEventListener('offline', handleWindowOffline)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }

  syncIntervalId = setInterval(() => {
    if (!isSelectedSyncEligible.value) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      isOfflineOrDisconnected.value = true
      return
    }
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return
    }
    void refreshSelected(true)
  }, SILENT_SYNC_INTERVAL_MS)

  clockIntervalId = setInterval(() => {
    nowMs.value = Date.now()
  }, 5000)
})

onBeforeUnmount(() => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  if (addItemSearchTimer) clearTimeout(addItemSearchTimer)
  if (listAbortController) listAbortController.abort()
  if (detailAbortController) detailAbortController.abort()
  if (syncIntervalId) clearInterval(syncIntervalId)
  if (clockIntervalId) clearInterval(clockIntervalId)

  if (typeof window !== 'undefined') {
    window.removeEventListener('online', handleWindowOnline)
    window.removeEventListener('offline', handleWindowOffline)
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
})
</script>

<template>
  <div class="space-y-5 text-[#171918]">
    <!-- Felső címsor -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 class="text-[24px] font-semibold tracking-[-0.32px] text-[#171918] leading-tight">
          Bevételezések (Goods Receipt)
        </h2>
        <p class="text-[13px] text-[#686f6a] mt-1">
          Beérkező szállítmányok követése, párhuzamos PC/PDA elrakás, eltérések ellenőrzése és
          végleges lezárás.
        </p>
      </div>

      <div class="flex items-center gap-2.5">
        <button
          v-if="canCreateReceipt"
          type="button"
          @click="openCreateBlankModal"
          class="bg-[#171918] hover:bg-[#2a2d2b] border border-white h-[40px] px-4 rounded-[12px] text-[13px] font-medium text-white flex items-center gap-2 shadow-xs transition cursor-pointer"
        >
          <i class="pi pi-plus text-xs"></i>
          <span>Új bevételezés</span>
        </button>
      </div>
    </div>

    <!-- 1. BEVÉTELEZÉSEK LISTÁJA (Szerveroldali Lazy DataTable) -->
    <div class="bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#e8eae6]">
        <div class="flex flex-wrap items-center gap-2.5 flex-1">
          <div class="relative flex-1 min-w-[230px] max-w-md">
            <i
              class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"
            ></i>
            <input
              v-model="searchInput"
              type="text"
              placeholder="Bizonylatszám, számlaszám, PO, beszállító, SKU vagy vonalkód..."
              @keydown.enter.prevent="triggerImmediateSearch"
              class="w-full h-[38px] bg-white border border-[#e5e8e2] rounded-[10px] pl-9 pr-3 text-[12px] text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]/50 transition"
            />
          </div>

          <Select
            v-model="statusFilter"
            :options="GOODS_RECEIPT_STATUS_OPTIONS"
            optionLabel="label"
            optionValue="value"
            placeholder="Minden státusz"
            showClear
            class="min-w-[180px] text-xs"
          />

          <Select
            v-model="locationFilter"
            :options="locationFilterOptions"
            optionLabel="label"
            optionValue="id"
            :loading="loadingLocations"
            placeholder="Minden raktár / üzlet"
            filter
            showClear
            class="min-w-[210px] text-xs"
          />
        </div>

        <div class="flex items-center gap-3">
          <span
            class="bg-[#e9ece7] text-[#171918] text-[11px] font-medium px-2.5 py-1 rounded-[7px]"
          >
            {{ totalRecords }} bizonylat
          </span>

          <button
            v-if="hasActiveFilters"
            type="button"
            @click="resetFilters"
            class="text-xs text-[#f46714] hover:underline font-medium cursor-pointer"
          >
            Szűrők törlése
          </button>

          <button
            type="button"
            @click="loadReceipts(false)"
            class="text-xs text-[#686f6a] hover:text-[#171918] flex items-center gap-1.5 cursor-pointer transition"
          >
            <i :class="['pi pi-refresh text-xs', listLoading ? 'animate-spin' : '']"></i>
            <span>Frissítés</span>
          </button>
        </div>
      </div>

      <DataTable
        :value="receipts"
        :lazy="true"
        :paginator="true"
        :rows="pageSize"
        :totalRecords="totalRecords"
        :first="(currentPage - 1) * pageSize"
        :loading="listLoading"
        dataKey="id"
        responsiveLayout="scroll"
        class="text-[13px]"
        :rowClass="(data: GoodsReceiptListItem) => (data.id === selectedReceiptId ? 'bg-[#fff0e5]! cursor-pointer' : 'cursor-pointer hover:bg-white/70')"
        @page="onPage"
        @row-click="onRowClick"
      >
        <template #empty>
          <div class="py-10 text-center text-sm text-[#686f6a]">
            Nincs a szűrésnek megfelelő bevételezés.
          </div>
        </template>

        <Column header="Bizonylat">
          <template #body="{ data }: { data: GoodsReceiptListItem }">
            <div class="min-w-[150px]">
              <p class="font-mono text-xs font-bold text-[#171918]">
                {{ data.receiptNumber }}
              </p>
              <p v-if="data.invoiceNumber" class="text-[11px] text-[#686f6a] font-mono">
                Számla: {{ data.invoiceNumber }}
              </p>
            </div>
          </template>
        </Column>

        <Column header="Státusz">
          <template #body="{ data }: { data: GoodsReceiptListItem }">
            <span
              :class="[
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap',
                GOODS_RECEIPT_STATUS_META[data.status].badgeClass,
              ]"
            >
              <i :class="[GOODS_RECEIPT_STATUS_META[data.status].icon, 'text-[10px]']"></i>
              <span>{{ GOODS_RECEIPT_STATUS_META[data.status].label }}</span>
            </span>
          </template>
        </Column>

        <Column header="Célhelyszín">
          <template #body="{ data }: { data: GoodsReceiptListItem }">
            <span class="text-xs font-medium text-[#171918] whitespace-nowrap">
              {{ data.targetLocation.name }}
            </span>
          </template>
        </Column>

        <Column header="Beszállító / PO">
          <template #body="{ data }: { data: GoodsReceiptListItem }">
            <div class="min-w-[160px]">
              <p class="text-xs font-medium text-[#171918]">
                {{ data.supplier?.name ?? '—' }}
              </p>
              <span
                v-if="data.purchaseOrder"
                class="inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200 mt-0.5"
              >
                <i class="pi pi-link text-[9px]"></i>
                {{ data.purchaseOrder.orderNumber }}
              </span>
            </div>
          </template>
        </Column>

        <Column header="Haladás">
          <template #body="{ data }: { data: GoodsReceiptListItem }">
            <div class="min-w-[140px] space-y-1">
              <div class="flex items-center justify-between text-[11px]">
                <span class="font-semibold text-[#171918]">
                  {{ getListReceivedSum(data) }} / {{ getListExpectedSum(data) }} db
                </span>
                <span
                  v-if="getListUnexpectedCount(data) > 0"
                  class="text-[10px] font-bold text-rose-600"
                >
                  +{{ getListUnexpectedCount(data) }} váratlan
                </span>
              </div>
              <div class="h-1.5 w-full rounded-full bg-[#e4e8e1] overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  :class="
                    getListReceivedSum(data) > getListExpectedSum(data)
                      ? 'bg-orange-500'
                      : getListReceivedSum(data) === getListExpectedSum(data) &&
                          getListExpectedSum(data) > 0
                        ? 'bg-emerald-500'
                        : 'bg-[#171918]'
                  "
                  :style="{
                    width: `${getProgressPercent(getListReceivedSum(data), getListExpectedSum(data))}%`,
                  }"
                ></div>
              </div>
            </div>
          </template>
        </Column>

        <Column v-if="showCostPrices" header="Deviza">
          <template #body="{ data }: { data: GoodsReceiptListItem }">
            <span class="font-mono text-xs font-semibold text-[#4c534e]">
              {{ data.currency ?? '—' }}
            </span>
          </template>
        </Column>

        <Column header="Létrehozva">
          <template #body="{ data }: { data: GoodsReceiptListItem }">
            <div class="text-right whitespace-nowrap">
              <p class="text-xs text-[#4c534e]">{{ formatDateTime(data.createdAt) }}</p>
              <p class="text-[10px] text-[#686f6a]">{{ data.createdByUser.name }}</p>
            </div>
          </template>
        </Column>
      </DataTable>
    </div>

    <!-- 2. KIVÁLASZTOTT BEVÉTELEZÉS RÉSZLETEZŐ MUNKATERÜLET -->
    <div
      v-if="selectedReceipt"
      class="bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs space-y-5"
    >
      <!-- Részlet fejléc + Műveletsáv -->
      <div
        class="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-4 border-b border-[#e8eae6]"
      >
        <div class="space-y-2">
          <div class="flex flex-wrap items-center gap-2.5">
            <h3 class="font-mono text-xl font-bold text-[#171918]">
              {{ selectedReceipt.receiptNumber }}
            </h3>

            <span
              :class="[
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold',
                GOODS_RECEIPT_STATUS_META[selectedReceipt.status].badgeClass,
              ]"
            >
              <i :class="[GOODS_RECEIPT_STATUS_META[selectedReceipt.status].icon, 'text-[11px]']"></i>
              <span>{{ GOODS_RECEIPT_STATUS_META[selectedReceipt.status].label }}</span>
            </span>

            <!-- Diszkrét Offline / kapcsolat megszakadt jelzés -->
            <span
              v-if="isOfflineOrDisconnected"
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200"
            >
              <i class="pi pi-wifi text-[10px] text-amber-600"></i>
              <span>Offline / kapcsolat megszakadt</span>
              <button
                type="button"
                @click="refreshSelected(false)"
                class="underline hover:text-amber-950 cursor-pointer ml-1"
              >
                Újra
              </button>
            </span>

            <span
              v-else-if="isSelectedSyncEligible"
              class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-white border border-[#e5e8e2] text-[#686f6a]"
              :title="lastSyncedAt ? `Utolsó szinkron: ${formatDateTime(lastSyncedAt)}` : undefined"
            >
              <span
                class="w-2 h-2 rounded-full bg-emerald-500"
                :class="silentRefreshing ? 'animate-ping' : ''"
              ></span>
              <span>Élő szinkron (10 mp)</span>
            </span>
          </div>

          <!-- Utolsó aktivitás kiemelt jelzése -->
          <div
            class="inline-flex flex-wrap items-center gap-2 px-3 py-1.5 rounded-[10px] text-xs border"
            :class="
              isLastActivityWithinTwoMinutes
                ? 'bg-amber-50/90 border-amber-200 text-amber-900'
                : 'bg-white border-[#e5e8e2] text-[#4c534e]'
            "
          >
            <i
              class="pi pi-clock text-xs"
              :class="isLastActivityWithinTwoMinutes ? 'text-amber-600' : 'text-[#686f6a]'"
            ></i>
            <template v-if="lastPurchaseReceiptMovement && lastActivityRelativeText">
              <span>
                Utolsó aktivitás:
                <strong class="text-[#171918]">{{ lastActivityUserName }}</strong>
                ({{ lastActivityRelativeText }})
              </span>
              <span
                v-if="isLastActivityWithinTwoMinutes && isSelectedEditable"
                class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-200/70 text-amber-900 text-[10px] font-bold"
              >
                Aktív elrakás
              </span>
            </template>
            <template v-else>
              <span>Utolsó aktivitás: még nincs rögzített elrakási mozgás</span>
            </template>
          </div>
        </div>

        <!-- Műveleti gombok -->
        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            :disabled="detailLoading"
            @click="refreshSelected(false)"
            class="h-[36px] px-3 rounded-[10px] bg-white border border-[#dce0d8] hover:border-[#171918] text-xs font-semibold text-[#171918] inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <i :class="['pi pi-refresh text-xs', detailLoading ? 'animate-spin' : '']"></i>
            <span>Frissítés</span>
          </button>

          <button
            v-if="canPerformPutaway && selectedReceipt.status === GoodsReceiptStatus.OPEN"
            type="button"
            :disabled="actionLoading"
            @click="handleStartReceipt"
            class="h-[36px] px-3.5 rounded-[10px] bg-sky-600 hover:bg-sky-700 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <i class="pi pi-play text-[11px]"></i>
            <span>Elrakás megkezdése</span>
          </button>

          <button
            v-if="canFinishReceipt"
            type="button"
            :disabled="actionLoading"
            @click="openFinishConfirm"
            class="h-[36px] px-4 rounded-[10px] bg-[#171918] hover:bg-[#2a2d2b] text-xs font-semibold text-white inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <i class="pi pi-check-square text-xs"></i>
            <span>Elrakás befejezése</span>
          </button>

          <button
            v-if="canApproveReceipt"
            type="button"
            :disabled="actionLoading"
            @click="isApproveModalOpen = true"
            class="h-[36px] px-4 rounded-[10px] bg-[#f46714] hover:bg-[#dc580c] text-xs font-semibold text-white inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <i class="pi pi-verified text-xs"></i>
            <span>Eltérések jóváhagyása</span>
          </button>

          <button
            v-if="canCancelReceipt"
            type="button"
            :disabled="actionLoading"
            @click="isCancelConfirmOpen = true"
            class="h-[36px] px-3.5 rounded-[10px] bg-white border border-rose-200 hover:bg-rose-50 text-xs font-semibold text-rose-700 inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <i class="pi pi-trash text-xs"></i>
            <span>Törlés</span>
          </button>
        </div>
      </div>

      <!-- Metaadat kártyák -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="bg-white rounded-[12px] border border-[#e8eae6] p-3.5 space-y-1">
          <p class="text-[11px] font-medium text-[#686f6a]">Célhelyszín &amp; Beszállító</p>
          <p class="text-sm font-bold text-[#171918]">{{ selectedReceipt.targetLocation.name }}</p>
          <p class="text-xs text-[#686f6a]">
            {{ selectedReceipt.supplier?.name ?? 'Beszállító nincs megadva' }}
          </p>
        </div>

        <div class="bg-white rounded-[12px] border border-[#e8eae6] p-3.5 space-y-1">
          <p class="text-[11px] font-medium text-[#686f6a]">Hivatkozások</p>
          <p class="text-xs text-[#171918]">
            Számla:
            <span class="font-mono font-semibold">{{ selectedReceipt.invoiceNumber || '—' }}</span>
          </p>
          <p class="text-xs text-[#171918]">
            PO rendelés:
            <span class="font-mono font-semibold">
              {{ selectedReceipt.purchaseOrder?.orderNumber || 'Nincs' }}
            </span>
          </p>
        </div>

        <div class="bg-white rounded-[12px] border border-[#e8eae6] p-3.5 space-y-1">
          <p class="text-[11px] font-medium text-[#686f6a]">Mennyiségi összesítő</p>
          <p class="text-sm font-bold text-[#171918]">
            {{ totalReceivedQty }} / {{ totalExpectedQty }} db
          </p>
          <p
            class="text-xs font-medium"
            :class="hasDiscrepancies ? 'text-orange-700' : 'text-emerald-700'"
          >
            {{
              hasDiscrepancies
                ? `${discrepancyItemCount} eltérő / váratlan tétel`
                : 'Minden tétel egyezik'
            }}
          </p>
        </div>

        <div
          v-if="showCostPrices"
          class="bg-white rounded-[12px] border border-[#e8eae6] p-3.5 space-y-1"
        >
          <p class="text-[11px] font-medium text-[#686f6a]">Pénznem &amp; Beérkezett érték</p>
          <p class="text-sm font-bold text-[#171918]">
            {{ formatCurrency(totalReceivedValueHuf, 'HUF') }}
          </p>
          <p class="text-xs text-[#686f6a]">
            {{ selectedReceipt.currency ?? 'HUF' }} · Árfolyam:
            <span class="font-mono font-semibold text-[#171918]">
              {{ selectedReceipt.exchangeRate ?? 1 }}
            </span>
          </p>
        </div>

        <div
          v-else
          class="bg-white rounded-[12px] border border-[#e8eae6] p-3.5 space-y-1"
        >
          <p class="text-[11px] font-medium text-[#686f6a]">Rögzítette / Lezárás</p>
          <p class="text-xs font-semibold text-[#171918]">
            {{ selectedReceipt.createdByUser.name }}
          </p>
          <p class="text-[11px] text-[#686f6a]">
            {{
              selectedReceipt.completedAt
                ? `Lezárva: ${formatDateTime(selectedReceipt.completedAt)}`
                : `Létrehozva: ${formatDateTime(selectedReceipt.createdAt)}`
            }}
          </p>
        </div>
      </div>

      <!-- Megjegyzések / eltérés indoklás ha van -->
      <div
        v-if="selectedReceipt.note || selectedReceipt.discrepancyNote"
        class="grid grid-cols-1 md:grid-cols-2 gap-3"
      >
        <div
          v-if="selectedReceipt.note"
          class="rounded-[12px] bg-white border border-[#e8eae6] px-3.5 py-2.5 text-xs"
        >
          <span class="font-semibold text-[#686f6a] block mb-0.5">Bizonylat megjegyzés</span>
          <p class="text-[#171918]">{{ selectedReceipt.note }}</p>
        </div>
        <div
          v-if="selectedReceipt.discrepancyNote"
          class="rounded-[12px] bg-orange-50/70 border border-orange-200 px-3.5 py-2.5 text-xs"
        >
          <span class="font-semibold text-orange-800 block mb-0.5">
            Eltérés / vezetői jóváhagyási megjegyzés
            <template v-if="selectedReceipt.approvedByUser">
              ({{ selectedReceipt.approvedByUser.name }})
            </template>
          </span>
          <p class="text-orange-950">{{ selectedReceipt.discrepancyNote }}</p>
        </div>
      </div>

      <!-- 3. PC-S ELRAKÁS GYORSŰRLAP (OPEN / IN_PROGRESS) -->
      <div
        v-if="canPerformPutaway && isSelectedEditable"
        class="rounded-[14px] bg-white border border-[#dce0d8] p-4 space-y-3"
      >
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span
              class="w-7 h-7 rounded-lg bg-[#fff0e5] text-[#f46714] inline-flex items-center justify-center"
            >
              <i class="pi pi-box text-xs"></i>
            </span>
            <div>
              <h4 class="text-sm font-bold text-[#171918]">Elrakás (PC)</h4>
              <p class="text-[11px] text-[#686f6a]">
                Válassz várt tételt, vagy olvass be vonalkódot / SKU-t (számlán nem szereplő termék
                váratlan tételként kerül fel).
              </p>
            </div>
          </div>
        </div>

        <form class="grid grid-cols-1 md:grid-cols-12 gap-3 items-end" @submit.prevent="handlePcPutaway">
          <div class="md:col-span-4 space-y-1">
            <label class="block text-[11px] font-semibold text-[#4c534e]">
              Várt tétel kiválasztása
            </label>
            <Select
              v-model="putawaySelectedVariantId"
              :options="putawayItemOptions"
              optionLabel="label"
              optionValue="variantId"
              :filterFields="['label', 'searchText']"
              placeholder="Válassz a bevételezés tételeiből..."
              filter
              showClear
              class="w-full text-xs"
            />
          </div>

          <div class="md:col-span-3 space-y-1">
            <label for="pc-putaway-code" class="block text-[11px] font-semibold text-[#4c534e]">
              Vagy vonalkód / SKU
            </label>
            <input
              id="pc-putaway-code"
              v-model="putawayCodeInput"
              type="text"
              placeholder="Vonalkód vagy cikkszám..."
              class="w-full h-[38px] rounded-[10px] bg-[#f8f9f7] border border-[#dce0d8] px-3 font-mono text-xs text-[#171918] outline-none focus:bg-white focus:border-[#f46714]"
            />
          </div>

          <div class="md:col-span-3 space-y-1">
            <label class="block text-[11px] font-semibold text-[#4c534e]">
              Célpolc ({{ selectedReceipt.targetLocation.name }})
            </label>
            <Select
              v-model="putawayLocationId"
              :options="targetSubtreeShelfOptions"
              optionLabel="label"
              optionValue="id"
              placeholder="Célpolc választása..."
              filter
              class="w-full text-xs"
            />
          </div>

          <div class="md:col-span-2 space-y-1">
            <label for="pc-putaway-qty" class="block text-[11px] font-semibold text-[#4c534e]">
              Mennyiség (db)
            </label>
            <input
              id="pc-putaway-qty"
              v-model.number="putawayQuantity"
              type="number"
              min="1"
              step="1"
              class="w-full h-[38px] rounded-[10px] bg-[#f8f9f7] border border-[#dce0d8] px-3 text-right font-mono text-xs font-bold text-[#171918] outline-none focus:bg-white focus:border-[#f46714]"
            />
          </div>

          <div class="md:col-span-8 flex flex-wrap items-center gap-2">
            <input
              v-model="putawayNote"
              type="text"
              placeholder="Opcionális elrakási megjegyzés..."
              class="flex-1 min-w-[200px] h-[34px] rounded-[10px] bg-[#f8f9f7] border border-[#e5e8e2] px-3 text-xs text-[#171918] outline-none focus:bg-white focus:border-[#f46714]"
            />
            <button
              v-if="selectedPutawayOption && selectedPutawayOption.remaining > 0"
              type="button"
              @click="putawayQuantity = selectedPutawayOption.remaining"
              class="h-[34px] px-2.5 rounded-[8px] bg-[#eff1ed] hover:bg-[#e2e6de] text-[11px] font-semibold text-[#171918] transition cursor-pointer"
            >
              Hátralévő ({{ selectedPutawayOption.remaining }} db)
            </button>
          </div>

          <div class="md:col-span-4 flex justify-end">
            <button
              type="submit"
              :disabled="putawaySubmitting"
              class="w-full md:w-auto h-[38px] px-5 rounded-[10px] bg-[#f46714] hover:bg-[#dc580c] text-xs font-semibold text-white inline-flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
            >
              <i
                :class="putawaySubmitting ? 'pi pi-spin pi-spinner text-xs' : 'pi pi-check text-xs'"
              ></i>
              <span>Elrakás rögzítése</span>
            </button>
          </div>
        </form>
      </div>

      <!-- 4. TÉTELEK TÁBLÁZAT -->
      <div class="space-y-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <h4 class="text-sm font-bold text-[#171918]">Bevételezési tételek</h4>
            <span
              class="bg-[#e9ece7] text-[#171918] text-[11px] font-medium px-2 py-0.5 rounded-[6px]"
            >
              {{ selectedReceipt.items.length }} tétel
            </span>
          </div>

          <button
            v-if="canAddExpectedItem && isSelectedEditable"
            type="button"
            @click="openAddItemDialog"
            class="h-[32px] px-3 rounded-[9px] bg-white border border-[#dce0d8] hover:border-[#171918] hover:bg-[#171918] text-[#171918] hover:text-white text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
          >
            <i class="pi pi-plus text-[10px]"></i>
            <span>Várt tétel hozzáadása</span>
          </button>
        </div>

        <div class="bg-white border border-[#e8eae6] rounded-[14px] overflow-x-auto">
          <div
            v-if="selectedReceipt.items.length === 0"
            class="py-8 text-center text-xs text-[#686f6a]"
          >
            Még nincs tétel ezen a bevételezésen.
          </div>

          <table v-else class="w-full text-left border-collapse text-xs">
            <thead class="bg-[#eff1ed] text-[#686f6a]">
              <tr>
                <th class="px-3.5 py-2.5 font-semibold">Termék &amp; SKU</th>
                <th class="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Várt</th>
                <th class="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Beérkezett</th>
                <th class="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Eltérés</th>
                <th
                  v-if="showCostPrices"
                  class="px-3 py-2.5 font-semibold text-right whitespace-nowrap"
                >
                  Egységár ({{ selectedReceipt.currency ?? 'HUF' }})
                </th>
                <th
                  v-if="showCostPrices"
                  class="px-3 py-2.5 font-semibold text-right whitespace-nowrap"
                >
                  Egységár (HUF)
                </th>
                <th
                  v-if="canPerformPutaway && isSelectedEditable"
                  class="px-3 py-2.5 font-semibold text-right whitespace-nowrap"
                >
                  Művelet
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#e8eae6]">
              <tr
                v-for="item in selectedReceipt.items"
                :key="item.id"
                :class="
                  item.isUnexpected
                    ? 'bg-rose-50/40'
                    : getItemDiff(item) !== 0
                      ? 'bg-amber-50/35'
                      : ''
                "
              >
                <td class="px-3.5 py-2.5 min-w-[220px]">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="font-semibold text-[#171918]">
                      {{ item.variant.product?.name ?? 'Ismeretlen termék' }}
                    </span>
                    <span
                      v-if="item.isUnexpected"
                      class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200"
                    >
                      Váratlan
                    </span>
                  </div>
                  <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-[#686f6a] mt-0.5">
                    <span class="font-mono font-medium text-[#171918]">{{ item.variant.sku }}</span>
                    <span
                      v-if="item.variant.size"
                      class="bg-[#eff1ed] text-[#171918] font-semibold px-1.5 rounded"
                    >
                      {{ item.variant.size }}
                    </span>
                    <span v-if="item.variant.colors.length > 0">
                      {{ item.variant.colors.join(', ') }}
                    </span>
                    <span
                      v-if="item.expectedLocation"
                      class="inline-flex items-center gap-1 text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded"
                    >
                      <i class="pi pi-map-marker text-[9px]"></i>
                      {{ formatLocationPath(item.expectedLocation.id, item.expectedLocation.name) }}
                    </span>
                  </div>
                  <p v-if="item.note" class="text-[11px] text-[#686f6a] italic mt-0.5">
                    {{ item.note }}
                  </p>
                </td>

                <td class="px-3 py-2.5 text-right font-medium text-[#4c534e] whitespace-nowrap">
                  {{ item.expectedQuantity }} db
                </td>

                <td class="px-3 py-2.5 text-right font-bold text-[#171918] whitespace-nowrap">
                  {{ item.receivedQuantity }} db
                </td>

                <td class="px-3 py-2.5 text-right whitespace-nowrap">
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold"
                    :class="
                      getItemDiff(item) === 0 && !item.isUnexpected
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : getItemDiff(item) < 0
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-orange-50 text-orange-700 border border-orange-200'
                    "
                  >
                    {{
                      getItemDiff(item) === 0 && !item.isUnexpected
                        ? '0 db'
                        : getItemDiff(item) > 0
                          ? `+${getItemDiff(item)} db`
                          : `${getItemDiff(item)} db`
                    }}
                  </span>
                </td>

                <td
                  v-if="showCostPrices"
                  class="px-3 py-2.5 text-right font-mono text-[#171918] whitespace-nowrap"
                >
                  {{ formatCurrency(item.unitCost, selectedReceipt.currency) }}
                </td>

                <td
                  v-if="showCostPrices"
                  class="px-3 py-2.5 text-right font-mono font-semibold text-[#171918] whitespace-nowrap"
                >
                  {{ formatCurrency(item.unitCostHuf, 'HUF') }}
                </td>

                <td
                  v-if="canPerformPutaway && isSelectedEditable"
                  class="px-3 py-2.5 text-right whitespace-nowrap"
                >
                  <button
                    type="button"
                    @click="prefillPutawayFromItem(item)"
                    class="h-[28px] px-2.5 rounded-[8px] bg-[#f8f9f7] border border-[#dce0d8] hover:border-[#f46714] hover:bg-[#fff0e5] text-[#171918] text-[11px] font-semibold transition cursor-pointer"
                  >
                    Elrakás
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- 5. ELRAKÁSI MOZGÁSOK LISTÁJA & SZTORNÓ -->
      <div class="space-y-2.5">
        <div class="flex items-center gap-2">
          <h4 class="text-sm font-bold text-[#171918]">Elrakási mozgások naplója</h4>
          <span
            class="bg-[#e9ece7] text-[#171918] text-[11px] font-medium px-2 py-0.5 rounded-[6px]"
          >
            {{ selectedReceipt.stockMovements.length }} mozgás
          </span>
        </div>

        <div class="bg-white border border-[#e8eae6] rounded-[14px] overflow-x-auto">
          <div
            v-if="selectedReceipt.stockMovements.length === 0"
            class="py-8 text-center text-xs text-[#686f6a]"
          >
            Még nem történt elrakási mozgás ezen a bevételezésen.
          </div>

          <table v-else class="w-full text-left border-collapse text-xs">
            <thead class="bg-[#eff1ed] text-[#686f6a]">
              <tr>
                <th class="px-3.5 py-2.5 font-semibold whitespace-nowrap">Időpont</th>
                <th class="px-3 py-2.5 font-semibold">Termék &amp; SKU</th>
                <th class="px-3 py-2.5 font-semibold">Célpolc</th>
                <th class="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Mennyiség</th>
                <th class="px-3 py-2.5 font-semibold whitespace-nowrap">Munkatárs</th>
                <th class="px-3 py-2.5 font-semibold">Megjegyzés</th>
                <th class="px-3.5 py-2.5 font-semibold text-right whitespace-nowrap">Művelet</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#e8eae6]">
              <tr
                v-for="movement in selectedReceipt.stockMovements"
                :key="movement.id"
                :class="
                  movement.reversedBy || movement.reversedMovementId
                    ? 'bg-slate-50/70 text-[#686f6a]'
                    : ''
                "
              >
                <td class="px-3.5 py-2.5 whitespace-nowrap text-[#4c534e]">
                  {{ formatDateTime(movement.createdAt) }}
                </td>

                <td class="px-3 py-2.5 min-w-[180px]">
                  <p class="font-semibold text-[#171918]">
                    {{ movement.variant.product?.name ?? 'Ismeretlen termék' }}
                  </p>
                  <p class="font-mono text-[11px] text-[#686f6a]">{{ movement.variant.sku }}</p>
                </td>

                <td class="px-3 py-2.5 min-w-[170px] font-medium text-[#171918]">
                  {{ formatLocationPath(movement.locationId, movement.location.name) }}
                </td>

                <td class="px-3 py-2.5 text-right whitespace-nowrap">
                  <div class="inline-flex items-center gap-1.5">
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold"
                      :class="
                        movement.quantity > 0
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-rose-50 text-rose-700 border border-rose-200'
                      "
                    >
                      {{ formatSignedQuantity(movement.quantity) }}
                    </span>
                    <span
                      v-if="movement.reversedBy"
                      class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-200 text-slate-700"
                    >
                      Sztornózva
                    </span>
                    <span
                      v-else-if="movement.reversedMovementId"
                      class="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-100 text-rose-700"
                    >
                      Sztornó tétel
                    </span>
                  </div>
                </td>

                <td class="px-3 py-2.5 whitespace-nowrap">
                  {{ movement.createdByUser?.name ?? '—' }}
                </td>

                <td class="px-3 py-2.5 max-w-[200px] truncate" :title="movement.note ?? undefined">
                  {{ movement.note || '—' }}
                </td>

                <td class="px-3.5 py-2.5 text-right whitespace-nowrap">
                  <button
                    v-if="canUndoMovement(movement)"
                    type="button"
                    :disabled="actionLoading"
                    @click="requestUndoMovement(movement)"
                    class="h-[28px] px-2.5 rounded-[8px] bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 text-[11px] font-semibold inline-flex items-center gap-1 transition cursor-pointer disabled:opacity-50"
                  >
                    <i class="pi pi-undo text-[10px]"></i>
                    <span>Sztornó</span>
                  </button>
                  <span v-else class="text-[11px] text-[#9aa197]">—</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Üres részletező állapot -->
    <div
      v-else
      class="bg-[#f8f9f7] border border-white rounded-[16px] p-10 text-center text-sm text-[#686f6a]"
    >
      Válassz ki egy bevételezést a fenti listából a részletek és az elrakási műveletek
      megjelenítéséhez.
    </div>

    <!-- MODÁL 1: Új bevételezés (PO-ból vagy önállóan) -->
    <GoodsReceiptFormModal
      v-if="canCreateReceipt"
      v-model:visible="isCreateModalOpen"
      :preselected-po="formPreselectedPo"
      :all-locations="allLocations"
      @created="onReceiptCreated"
    />

    <!-- MODÁL 2: Eltérések jóváhagyása -->
    <GoodsReceiptApproveModal
      v-if="isManager"
      v-model:visible="isApproveModalOpen"
      :receipt="selectedReceipt"
      @approved="onReceiptApproved"
    />

    <!-- MODÁL 3: Várt tétel hozzáadása (addItem) -->
    <Dialog
      v-if="canAddExpectedItem"
      v-model:visible="isAddItemDialogOpen"
      modal
      header="Várt tétel hozzáadása / módosítása"
      :style="{ width: '42rem', maxWidth: '96vw' }"
    >
      <form class="space-y-4 pt-1 text-[#171918]" @submit.prevent="handleSubmitAddItem">
        <div class="space-y-2">
          <label class="block text-xs font-semibold text-[#171918]">
            Termékvariáns keresése <span class="text-rose-600">*</span>
          </label>
          <div class="relative">
            <i class="pi pi-search absolute left-3 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"></i>
            <input
              v-model="addItemSearchInput"
              type="text"
              placeholder="SKU, vonalkód vagy terméknév..."
              class="w-full h-[36px] rounded-[10px] bg-[#f8f9f7] border border-[#dce0d8] pl-9 pr-3 text-xs outline-none focus:bg-white focus:border-[#f46714]"
            />
          </div>

          <div
            v-if="addItemLoadingVariants"
            class="py-3 text-center text-xs text-[#686f6a]"
          >
            <i class="pi pi-spin pi-spinner mr-1"></i> Keresés...
          </div>

          <div
            v-else-if="addItemVariantResults.length > 0"
            class="max-h-[160px] overflow-y-auto divide-y divide-[#e8eae6] border border-[#e8eae6] rounded-[10px] bg-white"
          >
            <button
              v-for="variant in addItemVariantResults"
              :key="variant.id"
              type="button"
              @click="pickVariantForAddItem(variant)"
              class="w-full text-left px-3 py-2 flex items-center justify-between gap-2 transition cursor-pointer"
              :class="
                addItemSelectedVariant?.id === variant.id
                  ? 'bg-[#fff0e5]'
                  : 'hover:bg-[#f8f9f7]'
              "
            >
              <div class="min-w-0">
                <p class="text-xs font-semibold text-[#171918] truncate">
                  {{ variant.product?.name ?? 'Ismeretlen termék' }}
                </p>
                <p class="text-[11px] text-[#686f6a] font-mono">
                  {{ variant.sku }}
                  <span v-if="variant.size"> · {{ variant.size }}</span>
                </p>
              </div>
              <i
                v-if="addItemSelectedVariant?.id === variant.id"
                class="pi pi-check-circle text-[#f46714] text-sm"
              ></i>
            </button>
          </div>
        </div>

        <div v-if="addItemSelectedVariant" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="space-y-1">
            <label for="add-item-qty" class="block text-xs font-semibold text-[#171918]">
              Várt mennyiség (db)
            </label>
            <input
              id="add-item-qty"
              v-model.number="addItemExpectedQty"
              type="number"
              min="0"
              step="1"
              class="w-full h-[38px] rounded-[10px] border border-[#dce0d8] px-3 text-right font-mono text-xs outline-none focus:border-[#f46714]"
            />
          </div>

          <div class="space-y-1">
            <label for="add-item-cost" class="block text-xs font-semibold text-[#171918]">
              Egységár ({{ selectedReceipt?.currency ?? 'HUF' }})
            </label>
            <input
              id="add-item-cost"
              v-model.number="addItemUnitCost"
              type="number"
              min="0"
              step="0.01"
              class="w-full h-[38px] rounded-[10px] border border-[#dce0d8] px-3 text-right font-mono text-xs outline-none focus:border-[#f46714]"
            />
            <p class="text-[11px] text-[#686f6a] text-right">
              HUF érték: {{ formatCurrency(addItemPreviewHuf, 'HUF') }}
            </p>
          </div>

          <div class="space-y-1 sm:col-span-2">
            <label class="block text-xs font-semibold text-[#171918]">
              Javasolt célpolc (opcionális)
            </label>
            <Select
              v-model="addItemExpectedLocationId"
              :options="targetSubtreeShelfOptions"
              optionLabel="label"
              optionValue="id"
              placeholder="Válassz javasolt polcot..."
              filter
              showClear
              class="w-full text-xs"
            />
          </div>

          <div class="space-y-1 sm:col-span-2">
            <label for="add-item-note" class="block text-xs font-semibold text-[#171918]">
              Megjegyzés (opcionális)
            </label>
            <input
              id="add-item-note"
              v-model="addItemNote"
              type="text"
              placeholder="Pl. utólag pótolt számlatétel..."
              class="w-full h-[38px] rounded-[10px] border border-[#dce0d8] px-3 text-xs outline-none focus:border-[#f46714]"
            />
          </div>
        </div>

        <div class="flex items-center justify-end gap-2.5 pt-2 border-t border-[#e8eae6]">
          <button
            type="button"
            :disabled="addItemSubmitting"
            @click="isAddItemDialogOpen = false"
            class="h-[36px] px-4 rounded-[10px] bg-white border border-[#dce0d8] text-xs font-semibold text-[#171918] cursor-pointer"
          >
            Mégse
          </button>
          <button
            type="submit"
            :disabled="!addItemSelectedVariant || addItemSubmitting"
            class="h-[36px] px-4 rounded-[10px] bg-[#171918] hover:bg-[#2a2d2b] text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <i :class="addItemSubmitting ? 'pi pi-spin pi-spinner text-xs' : 'pi pi-check text-xs'"></i>
            <span>Tétel mentése</span>
          </button>
        </div>
      </form>
    </Dialog>

    <!-- DIALÓGUS 4: Elrakás befejezése (/finish) megerősítés -->
    <Dialog
      v-model:visible="isFinishConfirmOpen"
      modal
      header="Elrakás befejezése"
      :style="{ width: '34rem', maxWidth: '94vw' }"
    >
      <div v-if="selectedReceipt" class="space-y-4 pt-1 text-xs text-[#171918]">
        <!-- 2 percen belüli aktivitás explicit figyelmeztetés! -->
        <div
          v-if="isLastActivityWithinTwoMinutes && lastPurchaseReceiptMovement"
          class="rounded-[12px] bg-amber-50 border border-amber-300 p-3.5 text-amber-950 flex items-start gap-2.5"
        >
          <i class="pi pi-exclamation-triangle text-amber-600 text-base mt-0.5 shrink-0"></i>
          <div class="space-y-1">
            <p class="font-bold text-amber-900">
              Figyelem! Más raktáros még dolgozhat ezen a bevételezésen!
            </p>
            <p>
              Az utolsó elrakási aktivitás
              <strong>{{ lastActivityRelativeText }}</strong> történt
              (<strong>{{ lastActivityUserName }}</strong>). Győződj meg róla, hogy mindenki befejezte
              a PDA/PC elrakást, mielőtt lezárod a bizonylatot!
            </p>
          </div>
        </div>

        <p class="text-sm text-[#4c534e]">
          Biztosan befejezed a(z)
          <strong class="font-mono text-[#171918]">{{ selectedReceipt.receiptNumber }}</strong>
          bevételezés elrakását?
        </p>

        <div class="rounded-[12px] bg-[#f8f9f7] border border-[#e8eae6] p-3 space-y-1">
          <p>
            Beérkezett mennyiség:
            <strong>{{ totalReceivedQty }} / {{ totalExpectedQty }} db</strong>
          </p>
          <p v-if="hasDiscrepancies" class="text-orange-700 font-semibold">
            Eltérés található ({{ discrepancyItemCount }} tétel), ezért a bizonylat „Jóváhagyásra vár”
            státuszba kerül vezetői ellenőrzésre.
          </p>
          <p v-else class="text-emerald-700 font-semibold">
            Minden tétel pontosan egyezik — a bevételezés azonnal „Lezárva” állapotba kerül.
          </p>
        </div>

        <div class="flex items-center justify-end gap-2.5 pt-2 border-t border-[#e8eae6]">
          <button
            type="button"
            :disabled="actionLoading"
            @click="isFinishConfirmOpen = false"
            class="h-[36px] px-4 rounded-[10px] bg-white border border-[#dce0d8] text-xs font-semibold text-[#171918] cursor-pointer"
          >
            Mégse
          </button>
          <button
            type="button"
            :disabled="actionLoading"
            @click="confirmFinishReceipt"
            class="h-[36px] px-4 rounded-[10px] bg-[#171918] hover:bg-[#2a2d2b] text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <i :class="actionLoading ? 'pi pi-spin pi-spinner text-xs' : 'pi pi-check text-xs'"></i>
            <span>Igen, elrakás befejezése</span>
          </button>
        </div>
      </div>
    </Dialog>

    <!-- DIALÓGUS 5: Sztornó megerősítés -->
    <Dialog
      :visible="Boolean(undoConfirmMovement)"
      @update:visible="(val) => { if (!val) undoConfirmMovement = null }"
      modal
      header="Elrakási mozgás sztornózása"
      :style="{ width: '30rem', maxWidth: '94vw' }"
    >
      <div v-if="undoConfirmMovement" class="space-y-4 pt-1 text-xs text-[#171918]">
        <p class="text-sm text-[#4c534e]">
          Biztosan sztornózod ezt az elrakási tételt? A készlet csökken a megadott polcon, és negatív
          ellentételező mozgás jön létre.
        </p>

        <div class="rounded-[12px] bg-[#f8f9f7] border border-[#e8eae6] p-3 space-y-1">
          <p class="font-bold text-[#171918]">
            {{ undoConfirmMovement.variant.product?.name ?? 'Termék' }}
            <span class="font-mono font-normal text-[#686f6a]">
              ({{ undoConfirmMovement.variant.sku }})
            </span>
          </p>
          <p>
            Polc:
            <strong>
              {{ formatLocationPath(undoConfirmMovement.locationId, undoConfirmMovement.location.name) }}
            </strong>
          </p>
          <p>
            Mennyiség: <strong class="text-rose-700">-{{ undoConfirmMovement.quantity }} db</strong>
            · Rögzítette: {{ undoConfirmMovement.createdByUser?.name ?? '—' }}
          </p>
        </div>

        <div class="flex items-center justify-end gap-2.5 pt-2 border-t border-[#e8eae6]">
          <button
            type="button"
            :disabled="actionLoading"
            @click="undoConfirmMovement = null"
            class="h-[36px] px-4 rounded-[10px] bg-white border border-[#dce0d8] text-xs font-semibold text-[#171918] cursor-pointer"
          >
            Mégse
          </button>
          <button
            type="button"
            :disabled="actionLoading"
            @click="confirmUndoMovement"
            class="h-[36px] px-4 rounded-[10px] bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <i :class="actionLoading ? 'pi pi-spin pi-spinner text-xs' : 'pi pi-undo text-xs'"></i>
            <span>Sztornózás</span>
          </button>
        </div>
      </div>
    </Dialog>

    <!-- DIALÓGUS 6: Bevételezés törlése (/cancel) -->
    <Dialog
      v-if="isManager"
      v-model:visible="isCancelConfirmOpen"
      modal
      header="Bevételezés törlése"
      :style="{ width: '28rem', maxWidth: '94vw' }"
    >
      <div v-if="selectedReceipt" class="space-y-4 pt-1 text-xs text-[#171918]">
        <p class="text-sm text-[#4c534e]">
          Biztosan törölni szeretnéd a(z)
          <strong class="font-mono text-[#171918]">{{ selectedReceipt.receiptNumber }}</strong>
          bevételezést? Ez csak akkor lehetséges, ha még 0 db került elrakásra.
        </p>

        <div class="flex items-center justify-end gap-2.5 pt-2 border-t border-[#e8eae6]">
          <button
            type="button"
            :disabled="actionLoading"
            @click="isCancelConfirmOpen = false"
            class="h-[36px] px-4 rounded-[10px] bg-white border border-[#dce0d8] text-xs font-semibold text-[#171918] cursor-pointer"
          >
            Mégse
          </button>
          <button
            type="button"
            :disabled="actionLoading"
            @click="confirmCancelReceipt"
            class="h-[36px] px-4 rounded-[10px] bg-rose-600 hover:bg-rose-700 text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <i :class="actionLoading ? 'pi pi-spin pi-spinner text-xs' : 'pi pi-trash text-xs'"></i>
            <span>Törlés megerősítése</span>
          </button>
        </div>
      </div>
    </Dialog>
  </div>
</template>
