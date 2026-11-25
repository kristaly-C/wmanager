<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  GoodsReceiptStatus,
  LocationType,
  MovementType,
  Role,
} from '@wmanager/shared-types'
import Select from 'primevue/select'
import { useToast } from 'primevue/usetoast'
import {
  goodsReceiptsApi,
  type GoodsReceiptDetail,
  type GoodsReceiptItemDto,
  type GoodsReceiptMovementDto,
  type PutawayPayload,
} from '@/api/goodsReceipts'
import { locationApi, type LocationItem } from '@/api/locations'
import {
  hasHttpResponse,
  isNetworkError,
  useOfflinePutawayQueue,
  type QueuedPutawayItem,
} from '@/composables/useOfflinePutawayQueue'
import { useAuthStore } from '@/stores/auth'
import {
  getBarcodeCandidates,
  matchesBarcodeExact,
  matchesBarcodeOrSku,
  normalizeScannedBarcode,
} from '@/utils/barcodeScanner'
import { formatDateTime } from '@/utils/formatters'
import {
  extractApiError,
  getLocationPath,
  LOCATION_TYPE_META,
  SLOT_MODE_META,
} from '@/utils/locationMeta'
import { GOODS_RECEIPT_STATUS_META } from '@/utils/procurementMeta'

interface ExpectedItemOption {
  variantId: string
  label: string
  productName: string
  sku: string
  attributesText: string
  expectedQuantity: number
  receivedQuantity: number
  remainingQuantity: number
  isUnexpected: boolean
  expectedLocationId: string | null
  expectedLocationName: string | null
  searchText: string
}

interface ShelfOption {
  id: string
  name: string
  pathLabel: string
  type: LocationType
  typeLabel: string
  slotModeLabel: string | null
  slotModeBadgeClass: string | null
  searchText: string
}

interface FeedbackBanner {
  kind: 'success' | 'offline' | 'error'
  title: string
  detail: string
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LOCATIONS_CACHE_KEY = 'xstorage_pda_locations_cache_v1'
const POLL_INTERVAL_MS = 10_000

const MANAGER_UNDO_ROLES: readonly Role[] = [
  Role.BOSS,
  Role.ADMIN,
  Role.WAREHOUSE_MANAGER,
  Role.STORE_MANAGER,
]

const STAFF_SELF_UNDO_ROLES: readonly Role[] = [Role.WAREHOUSE_STAFF, Role.STORE_STAFF]

const route = useRoute()
const router = useRouter()
const toast = useToast()
const authStore = useAuthStore()

const {
  isOnline,
  isFlushing,
  lastSyncEvent,
  enqueue,
  flushQueue,
  retryItem,
  removeItem,
  getItemsForReceipt,
} = useOfflinePutawayQueue()

const receiptId = computed<string>(() => String(route.params.id ?? ''))
const currentUserId = computed<string | null>(
  () => authStore.user?.userId ?? authStore.user?.id ?? null,
)
const currentUserRole = computed<Role | null>(() => authStore.user?.role ?? null)

const receipt = ref<GoodsReceiptDetail | null>(null)
const allLocations = ref<LocationItem[]>(loadCachedLocations())
const loading = ref(true)
const refreshing = ref(false)
const loadError = ref<string | null>(null)
const lastRefreshedAt = ref<string | null>(null)

// Szkennelő űrlap állapot
const productInputRef = ref<HTMLInputElement | null>(null)
const shelfInputRef = ref<HTMLInputElement | null>(null)
const productScanInput = ref('')
const selectedVariantId = ref<string | null>(null)
const quantity = ref<number>(1)
const shelfScanInput = ref('')
const selectedShelfId = ref<string | null>(null)
const lockShelf = ref(false)
const submitting = ref(false)
const feedback = ref<FeedbackBanner | null>(null)

// Alsó fül (Tételek / Legutóbbi elrakások)
const activeBottomTab = ref<'items' | 'movements'>('items')

// Sztornó műveletek állapota
const undoingMovementId = ref<string | null>(null)
const failedUndoMap = ref<Record<string, string>>({})

// Offline sor művelet töltésjelző
const retryingLocalId = ref<string | null>(null)

let pollTimer: ReturnType<typeof setInterval> | null = null
let activeAbortController: AbortController | null = null

function loadCachedLocations(): LocationItem[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return []
  }
  try {
    const raw = localStorage.getItem(LOCATIONS_CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as LocationItem[]) : []
  } catch {
    return []
  }
}

function saveCachedLocations(locations: LocationItem[]): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return
  }
  try {
    localStorage.setItem(LOCATIONS_CACHE_KEY, JSON.stringify(locations))
  } catch {
    // Storage quota esetén nem blokkoljuk a működést
  }
}

function formatVariantAttributes(item: GoodsReceiptItemDto): string {
  const parts: string[] = []
  if (item.variant.colors && item.variant.colors.length > 0) {
    parts.push(item.variant.colors.join('/'))
  }
  if (item.variant.size) {
    parts.push(item.variant.size)
  }
  return parts.join(' · ')
}

function getItemProductName(item: GoodsReceiptItemDto): string {
  return item.variant.product?.name ?? item.variant.sku
}

function getMovementProductName(movement: GoodsReceiptMovementDto): string {
  return movement.variant.product?.name ?? movement.variant.sku
}

const isReceiptEditableForPutaway = computed<boolean>(() => {
  if (!receipt.value) return false
  return (
    receipt.value.status === GoodsReceiptStatus.OPEN ||
    receipt.value.status === GoodsReceiptStatus.IN_PROGRESS
  )
})

const canUndoInCurrentStatus = computed<boolean>(() => {
  if (!receipt.value) return false
  return (
    receipt.value.status === GoodsReceiptStatus.IN_PROGRESS ||
    receipt.value.status === GoodsReceiptStatus.WAITING_FOR_APPROVAL
  )
})

// Offline sor elemek ehhez a bevételezéshez
const receiptQueueItems = computed<QueuedPutawayItem[]>(() =>
  getItemsForReceipt(receiptId.value),
)
const failedQueueItems = computed<QueuedPutawayItem[]>(() =>
  receiptQueueItems.value.filter((item) => item.status === 'FAILED'),
)
const pendingQueueItems = computed<QueuedPutawayItem[]>(() =>
  receiptQueueItems.value.filter(
    (item) => item.status === 'PENDING' || item.status === 'SENDING',
  ),
)

// Helyszín-fa (célhelyszín és leszármazottai)
const locationsById = computed<Map<string, LocationItem>>(() => {
  const map = new Map<string, LocationItem>()
  for (const loc of allLocations.value) {
    map.set(loc.id, loc)
  }
  return map
})

function isDescendantOrSelf(locationId: string, rootId: string): boolean {
  if (locationId === rootId) return true
  const map = locationsById.value
  const visited = new Set<string>()
  let current = map.get(locationId)
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    if (current.id === rootId) return true
    current = current.parentId ? map.get(current.parentId) : undefined
  }
  return false
}

const subtreeLocations = computed<LocationItem[]>(() => {
  const rootId = receipt.value?.targetLocationId
  if (!rootId) return []

  const filtered = allLocations.value.filter(
    (loc) => loc.isActive && isDescendantOrSelf(loc.id, rootId),
  )

  const typeOrder: Record<LocationType, number> = {
    [LocationType.BIN]: 0,
    [LocationType.SHELF]: 1,
    [LocationType.ZONE]: 2,
    [LocationType.WAREHOUSE]: 3,
    [LocationType.STORE]: 3,
  }

  return [...filtered].sort((a, b) => {
    const orderDiff = typeOrder[a.type] - typeOrder[b.type]
    if (orderDiff !== 0) return orderDiff
    return a.name.localeCompare(b.name, 'hu')
  })
})

const shelfOptions = computed<ShelfOption[]>(() => {
  const map = locationsById.value
  return subtreeLocations.value.map((loc) => {
    const path = getLocationPath(loc.id, map)
    const pathLabel = path.map((node) => node.name).join(' › ')
    const typeMeta = LOCATION_TYPE_META[loc.type]
    const slotMeta = loc.slotMode ? SLOT_MODE_META[loc.slotMode] : null
    return {
      id: loc.id,
      name: loc.name,
      pathLabel,
      type: loc.type,
      typeLabel: typeMeta.label,
      slotModeLabel: slotMeta?.shortLabel ?? null,
      slotModeBadgeClass: slotMeta?.badgeClass ?? null,
      searchText: `${loc.name} ${pathLabel} ${loc.id}`.toLowerCase(),
    }
  })
})

const expectedItemOptions = computed<ExpectedItemOption[]>(() => {
  if (!receipt.value) return []
  return receipt.value.items.map((item) => {
    const productName = getItemProductName(item)
    const attrs = formatVariantAttributes(item)
    const remaining = Math.max(0, item.expectedQuantity - item.receivedQuantity)
    const barcodes = (item.variant.variantBarcodes ?? [])
      .flatMap((b) => getBarcodeCandidates(b.barcode))
      .join(' ')
    const skuCandidates = getBarcodeCandidates(item.variant.sku).join(' ')
    return {
      variantId: item.variantId,
      label: attrs ? `${productName} (${attrs})` : productName,
      productName,
      sku: item.variant.sku,
      attributesText: attrs,
      expectedQuantity: item.expectedQuantity,
      receivedQuantity: item.receivedQuantity,
      remainingQuantity: remaining,
      isUnexpected: item.isUnexpected,
      expectedLocationId: item.expectedLocationId ?? null,
      expectedLocationName: item.expectedLocation?.name ?? null,
      searchText: `${productName} ${item.variant.sku} ${skuCandidates} ${attrs} ${barcodes}`.toLowerCase(),
    }
  })
})

// Termék azonosítása a szkennelt inputból vagy a lenyíló választóból
const matchedReceiptItem = computed<GoodsReceiptItemDto | null>(() => {
  if (!receipt.value) return null

  if (selectedVariantId.value) {
    return receipt.value.items.find((i) => i.variantId === selectedVariantId.value) ?? null
  }

  const code = productScanInput.value.trim()
  if (!code) return null

  // Először pontos vonalkód egyezés, majd SKU / szkenner-normalizált egyezés
  const byBarcode = receipt.value.items.find((item) =>
    matchesBarcodeExact(code, item.variant.variantBarcodes),
  )
  if (byBarcode) return byBarcode

  return (
    receipt.value.items.find((item) =>
      matchesBarcodeOrSku(code, item.variant.sku, item.variant.variantBarcodes),
    ) ?? null
  )
})

// Célpolc azonosítása a szkennelt inputból vagy a lenyíló választóból
const resolvedShelfLocation = computed<LocationItem | null>(() => {
  if (selectedShelfId.value) {
    return locationsById.value.get(selectedShelfId.value) ?? null
  }
  const raw = shelfScanInput.value.trim()
  if (!raw) return null

  const byId = subtreeLocations.value.find((loc) => loc.id.toLowerCase() === raw.toLowerCase())
  if (byId) return byId

  const byName = subtreeLocations.value.find((loc) => loc.name.toLowerCase() === raw.toLowerCase())
  if (byName) return byName

  return null
})

const hasProductValue = computed<boolean>(
  () => Boolean(selectedVariantId.value || productScanInput.value.trim()),
)

const hasShelfValue = computed<boolean>(
  () => Boolean(selectedShelfId.value || shelfScanInput.value.trim()),
)

const canSubmitPutaway = computed<boolean>(
  () =>
    isReceiptEditableForPutaway.value &&
    !submitting.value &&
    hasProductValue.value &&
    hasShelfValue.value &&
    quantity.value >= 1,
)

const totalReceivedQty = computed<number>(() =>
  (receipt.value?.items ?? []).reduce((sum, item) => sum + item.receivedQuantity, 0),
)

const totalExpectedQty = computed<number>(() =>
  (receipt.value?.items ?? []).reduce((sum, item) => sum + item.expectedQuantity, 0),
)

const overallProgressPercent = computed<number>(() => {
  if (totalExpectedQty.value <= 0) {
    return totalReceivedQty.value > 0 ? 100 : 0
  }
  return Math.min(100, Math.round((totalReceivedQty.value / totalExpectedQty.value) * 100))
})

// Pozitív PURCHASE_RECEIPT mozgások a Legutóbbi elrakások fülhöz
const recentPutawayMovements = computed<GoodsReceiptMovementDto[]>(() => {
  const movements = receipt.value?.stockMovements ?? []
  return movements.filter(
    (m) =>
      m.type === MovementType.PURCHASE_RECEIPT &&
      m.quantity > 0 &&
      !m.reversedMovementId,
  )
})

function canUndoMovement(movement: GoodsReceiptMovementDto): boolean {
  if (movement.reversedBy) return false
  if (!canUndoInCurrentStatus.value) return false
  const role = currentUserRole.value
  if (!role) return false
  if (MANAGER_UNDO_ROLES.includes(role)) return true
  if (STAFF_SELF_UNDO_ROLES.includes(role)) {
    return Boolean(currentUserId.value && movement.createdByUserId === currentUserId.value)
  }
  return false
}

function getItemProgressBadge(item: GoodsReceiptItemDto): {
  label: string
  badgeClass: string
  barClass: string
} {
  if (item.isUnexpected) {
    return {
      label: 'Váratlan',
      badgeClass: 'bg-orange-50 text-orange-700 border border-orange-200',
      barClass: 'bg-orange-500',
    }
  }
  if (item.expectedQuantity > 0 && item.receivedQuantity === item.expectedQuantity) {
    return {
      label: 'Teljes',
      badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
      barClass: 'bg-emerald-500',
    }
  }
  if (item.receivedQuantity > item.expectedQuantity) {
    return {
      label: `+${item.receivedQuantity - item.expectedQuantity} túlszállítás`,
      badgeClass: 'bg-orange-50 text-orange-700 border border-orange-200',
      barClass: 'bg-orange-500',
    }
  }
  const missing = Math.max(0, item.expectedQuantity - item.receivedQuantity)
  return {
    label: `Hiány: ${missing} db`,
    badgeClass: 'bg-amber-50 text-amber-800 border border-amber-200',
    barClass: item.receivedQuantity > 0 ? 'bg-blue-500' : 'bg-slate-300',
  }
}

function getItemProgressPercent(item: GoodsReceiptItemDto): number {
  if (item.expectedQuantity <= 0) {
    return item.receivedQuantity > 0 ? 100 : 0
  }
  return Math.min(100, Math.round((item.receivedQuantity / item.expectedQuantity) * 100))
}

async function fetchLocations() {
  if (!isOnline.value) return
  try {
    const res = await locationApi.getAll()
    allLocations.value = res.data
    saveCachedLocations(res.data)
  } catch {
    // Hálózati hiba esetén megtartjuk a helyi gyorsítótárazott helyszíneket
  }
}

async function fetchReceipt(options?: { silent?: boolean; initial?: boolean }) {
  const id = receiptId.value
  if (!id) return

  if (options?.silent) {
    if (
      !isOnline.value ||
      (typeof navigator !== 'undefined' && !navigator.onLine) ||
      (typeof document !== 'undefined' && document.visibilityState !== 'visible')
    ) {
      return
    }
  }

  if (!isOnline.value && !options?.silent) {
    if (!receipt.value) {
      loadError.value = 'Offline mód – a bevételezés első megnyitásához aktív hálózat szükséges.'
      loading.value = false
    } else {
      toast.add({
        severity: 'warn',
        summary: 'Offline állapot',
        detail: 'A frissítéshez várd meg, amíg visszatér a Wi-Fi kapcsolat.',
        life: 3000,
      })
    }
    return
  }

  if (activeAbortController) {
    activeAbortController.abort()
  }
  const controller = new AbortController()
  activeAbortController = controller

  if (options?.initial) {
    loading.value = true
    loadError.value = null
  } else if (!options?.silent) {
    refreshing.value = true
  }

  try {
    const res = await goodsReceiptsApi.getOne(id, controller.signal)
    receipt.value = res.data
    loadError.value = null
    lastRefreshedAt.value = new Date().toISOString()
  } catch (err: unknown) {
    const maybeErr = err as { code?: string; name?: string }
    if (maybeErr?.code === 'ERR_CANCELED' || maybeErr?.name === 'CanceledError') {
      return
    }

    // Csendes háttér-frissítésnél hálózati vagy átmeneti hibára SOHA nem dobunk piros toastot
    if (options?.silent) {
      return
    }

    if (isNetworkError(err)) {
      if (!receipt.value) {
        loadError.value = 'Nincs hálózati kapcsolat a szállítmány betöltéséhez.'
      } else {
        toast.add({
          severity: 'warn',
          summary: 'Offline állapot',
          detail: 'Nem sikerült elérni a szervert, a helyben betöltött adatokkal folytathatod.',
          life: 3500,
        })
      }
      return
    }

    const message = extractApiError(err, 'Nem sikerült betölteni a bevételezés adatait.')
    if (!receipt.value) {
      loadError.value = message
    } else {
      toast.add({
        severity: 'error',
        summary: 'Frissítési hiba',
        detail: message,
        life: 4000,
      })
    }
  } finally {
    if (activeAbortController === controller) {
      activeAbortController = null
    }
    if (options?.initial) {
      loading.value = false
    }
    refreshing.value = false
  }
}

function focusProductInput() {
  void nextTick(() => {
    productInputRef.value?.focus()
  })
}

function focusShelfInput(selectExisting = false) {
  void nextTick(() => {
    shelfInputRef.value?.focus()
    if (selectExisting) {
      shelfInputRef.value?.select()
    }
  })
}

function handleProductInputChange() {
  if (selectedVariantId.value) {
    selectedVariantId.value = null
  }
}

function handleSelectExpectedItem(variantId: string | null) {
  selectedVariantId.value = variantId
  if (variantId) {
    productScanInput.value = ''
    if (!hasShelfValue.value) {
      focusShelfInput()
    }
  }
}

function handleShelfInputChange() {
  if (selectedShelfId.value) {
    selectedShelfId.value = null
  }
}

function handleSelectShelf(locationId: string | null) {
  selectedShelfId.value = locationId
  if (locationId) {
    shelfScanInput.value = ''
  }
}

function applySuggestedShelf(locationId: string) {
  selectedShelfId.value = locationId
  shelfScanInput.value = ''
}

function adjustQuantity(delta: number) {
  const current = Number.isFinite(quantity.value) ? Math.floor(quantity.value) : 1
  quantity.value = Math.max(1, current + delta)
}

function normalizeQuantityInput() {
  const parsed = Number(quantity.value)
  if (!Number.isFinite(parsed) || parsed < 1) {
    quantity.value = 1
  } else {
    quantity.value = Math.floor(parsed)
  }
}

function handleProductEnter() {
  if (!hasProductValue.value) {
    return
  }

  // Ha a polc rögzítve (Lock) van és meg is van adva, Enterre azonnal rögzíthető!
  if (lockShelf.value && hasShelfValue.value) {
    void handleSubmitPutaway()
    return
  }

  // Ha üres a polc (vagy nincs Lock), ugorjon a polc mezőre!
  focusShelfInput(hasShelfValue.value)
}

function handleShelfEnter() {
  if (!hasShelfValue.value) {
    toast.add({
      severity: 'warn',
      summary: 'Hiányzó célpolc',
      detail: 'Csippants le vagy válassz ki egy célpolcot az elrakáshoz!',
      life: 2500,
    })
    focusShelfInput()
    return
  }

  if (!hasProductValue.value) {
    toast.add({
      severity: 'warn',
      summary: 'Hiányzó termék',
      detail: 'Előbb csippantsd le vagy válaszd ki a terméket!',
      life: 2500,
    })
    focusProductInput()
    return
  }

  void handleSubmitPutaway()
}

function buildPutawayRequest(): {
  payload: PutawayPayload
  productLabel: string
  locationLabel: string
} | null {
  normalizeQuantityInput()
  const qty = Math.max(1, Math.floor(quantity.value))

  const payload: PutawayPayload = {
    quantity: qty,
  }

  let productLabel = ''
  const matched = matchedReceiptItem.value
  const scannedCode = productScanInput.value.trim()

  if (selectedVariantId.value && matched) {
    payload.variantId = selectedVariantId.value
    productLabel = `${getItemProductName(matched)} (${matched.variant.sku})`
  } else if (scannedCode) {
    if (matched) {
      payload.variantId = matched.variantId
      productLabel = `${getItemProductName(matched)} (${matched.variant.sku})`
    } else {
      const normalizedCode = normalizeScannedBarcode(scannedCode)
      payload.barcode = normalizedCode
      productLabel = `Vonalkód/SKU: ${normalizedCode}`
    }
  } else {
    return null
  }

  let locationLabel = ''
  const shelfLoc = resolvedShelfLocation.value
  const rawShelf = shelfScanInput.value.trim()

  if (shelfLoc) {
    payload.locationId = shelfLoc.id
    locationLabel = shelfLoc.name
  } else if (selectedShelfId.value) {
    payload.locationId = selectedShelfId.value
    locationLabel = selectedShelfId.value
  } else if (rawShelf) {
    if (UUID_REGEX.test(rawShelf)) {
      payload.locationId = rawShelf
    } else {
      payload.locationName = rawShelf
    }
    locationLabel = rawShelf
  } else {
    return null
  }

  return { payload, productLabel, locationLabel }
}

function resetAfterPutaway() {
  productScanInput.value = ''
  selectedVariantId.value = null
  quantity.value = 1

  if (!lockShelf.value) {
    shelfScanInput.value = ''
    selectedShelfId.value = null
  }

  focusProductInput()
}

async function handleSubmitPutaway() {
  if (submitting.value) return
  if (!isReceiptEditableForPutaway.value) return

  const built = buildPutawayRequest()
  if (!built) {
    toast.add({
      severity: 'warn',
      summary: 'Hiányos adatok',
      detail: 'Add meg a terméket és a célpolcot is az elrakáshoz!',
      life: 2500,
    })
    return
  }

  const { payload, productLabel, locationLabel } = built
  const isCurrentlyOffline =
    !isOnline.value || (typeof navigator !== 'undefined' && !navigator.onLine)

  if (isCurrentlyOffline) {
    enqueue({
      goodsReceiptId: receiptId.value,
      payload,
      productLabel,
      locationLabel,
    })
    feedback.value = {
      kind: 'offline',
      title: 'Offline – helyi sorba mentve',
      detail: `+${payload.quantity} db · ${productLabel} → ${locationLabel}. Automatikusan beküldjük amint visszajön a Wi-Fi.`,
    }
    toast.add({
      severity: 'warn',
      summary: 'Offline sorba mentve',
      detail: 'Automatikusan beküldjük, amint visszajön a Wi-Fi.',
      life: 3500,
    })
    resetAfterPutaway()
    return
  }

  submitting.value = true
  try {
    const res = await goodsReceiptsApi.putaway(receiptId.value, payload)
    receipt.value = res.data
    lastRefreshedAt.value = new Date().toISOString()

    const confirmedShelf = res.data.lastMovement?.location?.name ?? locationLabel
    const confirmedProduct = res.data.lastMovement
      ? `${getMovementProductName(res.data.lastMovement)} (${res.data.lastMovement.variant.sku})`
      : productLabel

    feedback.value = {
      kind: 'success',
      title: `Elrakva (+${payload.quantity} db)`,
      detail: `${confirmedProduct} → ${confirmedShelf}`,
    }
    toast.add({
      severity: 'success',
      summary: 'Elrakás rögzítve',
      detail: `+${payload.quantity} db → ${confirmedShelf}`,
      life: 2200,
    })
    resetAfterPutaway()
  } catch (err: unknown) {
    if (isNetworkError(err) || !hasHttpResponse(err)) {
      enqueue({
        goodsReceiptId: receiptId.value,
        payload,
        productLabel,
        locationLabel,
      })
      feedback.value = {
        kind: 'offline',
        title: 'Offline – helyi sorba mentve',
        detail: `+${payload.quantity} db · ${productLabel} → ${locationLabel}. Automatikusan beküldjük amint visszajön a Wi-Fi.`,
      }
      toast.add({
        severity: 'warn',
        summary: 'Hálózati hiba – helyi sorba mentve',
        detail: 'Automatikusan beküldjük, amint visszajön a Wi-Fi.',
        life: 4000,
      })
      resetAfterPutaway()
      return
    }

    const errorMessage = extractApiError(err, 'Sikertelen elrakás – ellenőrizd az adatokat!')
    feedback.value = {
      kind: 'error',
      title: 'Sikertelen elrakás',
      detail: errorMessage,
    }
    toast.add({
      severity: 'error',
      summary: 'Elrakási hiba',
      detail: errorMessage,
      life: 5000,
    })
  } finally {
    submitting.value = false
  }
}

async function handleFlushReceiptQueue() {
  if (!isOnline.value) {
    toast.add({
      severity: 'warn',
      summary: 'Offline állapot',
      detail: 'Várd meg, amíg visszajön a Wi-Fi kapcsolat!',
      life: 3000,
    })
    return
  }

  const result = await flushQueue(receiptId.value, (_item, updatedDetail) => {
    receipt.value = updatedDetail
    lastRefreshedAt.value = new Date().toISOString()
  })

  if (result.syncedCount > 0) {
    toast.add({
      severity: 'success',
      summary: 'Szinkronizálás kész',
      detail: `${result.syncedCount} offline tétel sikeresen elrakva.`,
      life: 3000,
    })
    void fetchReceipt({ silent: true })
  }
  if (result.failedCount > 0) {
    toast.add({
      severity: 'error',
      summary: 'Sikertelen szinkronizálás',
      detail: `${result.failedCount} tétel hibára futott – ellenőrizd a piros figyelmeztetést!`,
      life: 5000,
    })
  } else if (result.stoppedOffline) {
    toast.add({
      severity: 'warn',
      summary: 'Hálózat megszakadt',
      detail: 'A fennmaradó tételek a helyi sorban maradtak.',
      life: 3500,
    })
  }
}

async function handleRetryQueueItem(localId: string) {
  if (!isOnline.value) {
    toast.add({
      severity: 'warn',
      summary: 'Offline állapot',
      detail: 'Újrapróbáláshoz aktív hálózati kapcsolat szükséges.',
      life: 3000,
    })
    return
  }

  retryingLocalId.value = localId
  try {
    const result = await retryItem(localId)
    if (result.syncedCount > 0) {
      toast.add({
        severity: 'success',
        summary: 'Sikeres újrapróbálás',
        detail: 'A tétel elrakása sikeresen rögzítésre került.',
        life: 3000,
      })
      void fetchReceipt({ silent: true })
    } else if (result.failedCount > 0) {
      toast.add({
        severity: 'error',
        summary: 'Továbbra is sikertelen',
        detail: 'A szerver ismét elutasította a tételt – lásd a hibaüzenetet.',
        life: 4500,
      })
    } else if (result.stoppedOffline) {
      toast.add({
        severity: 'warn',
        summary: 'Hálózat megszakadt',
        detail: 'A tétel visszakerült a függő sorba.',
        life: 3000,
      })
    }
  } finally {
    retryingLocalId.value = null
  }
}

function handleRemoveQueueItem(localId: string) {
  removeItem(localId)
  toast.add({
    severity: 'info',
    summary: 'Tétel eltávolítva',
    detail: 'A sikertelen csippantás törölve lett a helyi sorból.',
    life: 2500,
  })
}

function handlePickItemCard(item: GoodsReceiptItemDto) {
  if (!isReceiptEditableForPutaway.value) return
  selectedVariantId.value = item.variantId
  productScanInput.value = ''
  if (!lockShelf.value && item.expectedLocationId && !hasShelfValue.value) {
    selectedShelfId.value = item.expectedLocationId
    shelfScanInput.value = ''
  }
  window.scrollTo({ top: 0, behavior: 'smooth' })
  if (!hasShelfValue.value) {
    focusShelfInput()
  }
}

async function handleUndoMovement(movement: GoodsReceiptMovementDto) {
  if (undoingMovementId.value) return
  if (!canUndoMovement(movement)) return

  const isCurrentlyOffline =
    !isOnline.value || (typeof navigator !== 'undefined' && !navigator.onLine)

  if (isCurrentlyOffline) {
    failedUndoMap.value = {
      ...failedUndoMap.value,
      [movement.id]: 'Offline – a sztornózáshoz aktív Wi-Fi kapcsolat szükséges.',
    }
    toast.add({
      severity: 'error',
      summary: 'Sztornó FAILED (Offline)',
      detail: 'Kapcsolat nélkül a sztornózás nem hajtható végre.',
      life: 4000,
    })
    return
  }

  undoingMovementId.value = movement.id
  try {
    const res = await goodsReceiptsApi.undoPutaway(receiptId.value, movement.id)
    receipt.value = res.data
    lastRefreshedAt.value = new Date().toISOString()

    const nextFailed = { ...failedUndoMap.value }
    delete nextFailed[movement.id]
    failedUndoMap.value = nextFailed

    toast.add({
      severity: 'success',
      summary: 'Elrakás sztornózva',
      detail: `-${movement.quantity} db (${movement.location.name}) visszavéve.`,
      life: 3000,
    })
  } catch (err: unknown) {
    const errMsg = isNetworkError(err) || !hasHttpResponse(err)
      ? 'Offline – a hálózat megszakadt sztornózás közben.'
      : extractApiError(err, 'A sztornózás nem hajtható végre.')

    failedUndoMap.value = {
      ...failedUndoMap.value,
      [movement.id]: errMsg,
    }
    toast.add({
      severity: 'error',
      summary: 'Sztornó FAILED',
      detail: errMsg,
      life: 4500,
    })
  } finally {
    undoingMovementId.value = null
  }
}

function handleVisibilityChange() {
  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    isOnline.value &&
    !loading.value &&
    !submitting.value
  ) {
    void fetchReceipt({ silent: true })
  }
}

watch(lastSyncEvent, (evt) => {
  if (!evt) return
  if (evt.goodsReceiptId && evt.goodsReceiptId !== receiptId.value) return
  if (evt.syncedCount > 0) {
    toast.add({
      severity: 'success',
      summary: 'Offline sor szinkronizálva',
      detail: `${evt.syncedCount} várakozó elrakás automatikusan beküldve.`,
      life: 3500,
    })
    void fetchReceipt({ silent: true })
  }
  if (evt.failedCount > 0) {
    toast.add({
      severity: 'error',
      summary: 'Sikertelen szinkronizálás',
      detail: `${evt.failedCount} tétel hibára futott – ellenőrizd a piros figyelmeztető kártyát!`,
      life: 5000,
    })
  }
})

watch(isOnline, (online, wasOnline) => {
  if (online && !wasOnline) {
    void fetchLocations()
    void fetchReceipt({ silent: true })
  }
})

watch(receiptId, (newId, oldId) => {
  if (newId && newId !== oldId) {
    receipt.value = null
    feedback.value = null
    failedUndoMap.value = {}
    productScanInput.value = ''
    selectedVariantId.value = null
    shelfScanInput.value = ''
    selectedShelfId.value = null
    quantity.value = 1
    void fetchReceipt({ initial: true })
  }
})

onMounted(async () => {
  await Promise.all([fetchLocations(), fetchReceipt({ initial: true })])

  if (isReceiptEditableForPutaway.value) {
    focusProductInput()
  }

  pollTimer = setInterval(() => {
    if (
      isOnline.value &&
      (typeof navigator === 'undefined' || navigator.onLine) &&
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      !loading.value &&
      !refreshing.value &&
      !submitting.value
    ) {
      void fetchReceipt({ silent: true })
    }
  }, POLL_INTERVAL_MS)

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }
})

onBeforeUnmount(() => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  if (activeAbortController) {
    activeAbortController.abort()
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
})
</script>

<template>
  <div class="space-y-3.5 pb-8">
    <!-- Felső navigációs és Online / Offline / Frissítés fejléc -->
    <div class="flex items-center justify-between gap-2">
      <button
        type="button"
        @click="router.push({ name: 'pda-receiving' })"
        class="inline-flex items-center gap-1.5 min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-semibold shadow-2xs active:scale-[0.98] transition cursor-pointer"
      >
        <i class="pi pi-arrow-left text-xs"></i>
        <span>Lista</span>
      </button>

      <div class="flex items-center gap-1.5">
        <span
          :class="[
            'inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full text-xs font-bold border',
            isOnline
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-amber-100 text-amber-900 border-amber-300',
          ]"
        >
          <span
            :class="[
              'w-2 h-2 rounded-full',
              isOnline ? 'bg-emerald-500' : 'bg-amber-600 animate-pulse',
            ]"
          ></span>
          {{ isOnline ? 'Online' : 'Offline' }}
        </span>

        <button
          type="button"
          :disabled="refreshing || loading || !isOnline"
          @click="fetchReceipt({ silent: false })"
          class="inline-flex items-center gap-1.5 min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 text-slate-700 text-xs font-bold shadow-2xs active:scale-[0.97] disabled:opacity-50 transition cursor-pointer"
        >
          <i :class="['pi pi-refresh text-xs', refreshing ? 'pi-spin' : '']"></i>
          <span>Frissítés</span>
        </button>
      </div>
    </div>

    <!-- Piros figyelmeztető kártya: SIKERTELEN (FAILED) offline szinkronizálások -->
    <div
      v-if="failedQueueItems.length > 0"
      class="bg-rose-50 border-2 border-rose-400 rounded-2xl p-4 shadow-sm space-y-3"
    >
      <div class="flex items-start gap-2.5">
        <div class="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0">
          <i class="pi pi-exclamation-triangle text-base"></i>
        </div>
        <div class="min-w-0">
          <h2 class="text-sm font-extrabold text-rose-900 leading-snug">
            Sikertelen szinkronizálás – ellenőrizd vagy jelezd a vezetőnek!
          </h2>
          <p class="text-xs text-rose-700 mt-0.5">
            {{ failedQueueItems.length }} korábbi offline csippantást a szerver elutasított.
          </p>
        </div>
      </div>

      <div class="space-y-2.5">
        <div
          v-for="qItem in failedQueueItems"
          :key="qItem.localId"
          class="bg-white border border-rose-200 rounded-xl p-3 space-y-2"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-xs font-bold text-slate-900 break-words">{{ qItem.productLabel }}</p>
              <p class="text-[11px] text-slate-600 mt-0.5">
                Célpolc: <span class="font-semibold text-slate-800">{{ qItem.locationLabel }}</span>
                · {{ formatDateTime(qItem.createdAt) }}
              </p>
            </div>
            <span class="px-2 py-0.5 rounded-md bg-rose-100 text-rose-800 text-xs font-extrabold shrink-0">
              +{{ qItem.payload.quantity }} db
            </span>
          </div>

          <div class="rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-2 text-xs font-semibold text-rose-800">
            {{ qItem.lastError || 'A szerver elutasította a műveletet.' }}
          </div>

          <div class="grid grid-cols-2 gap-2 pt-0.5">
            <button
              type="button"
              :disabled="!isOnline || isFlushing || retryingLocalId === qItem.localId"
              @click="handleRetryQueueItem(qItem.localId)"
              class="min-h-[42px] px-3 rounded-xl bg-rose-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50 transition cursor-pointer"
            >
              <i
                :class="[
                  'pi text-xs',
                  retryingLocalId === qItem.localId ? 'pi-spin pi-spinner' : 'pi-replay',
                ]"
              ></i>
              <span>Újrapróbálás</span>
            </button>
            <button
              type="button"
              :disabled="retryingLocalId === qItem.localId"
              @click="handleRemoveQueueItem(qItem.localId)"
              class="min-h-[42px] px-3 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50 transition cursor-pointer"
            >
              <i class="pi pi-trash text-xs"></i>
              <span>Eltávolítás</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Sárga kártya: FÜGGŐ (PENDING / SENDING) offline sor -->
    <div
      v-if="pendingQueueItems.length > 0"
      class="bg-amber-50 border-2 border-amber-300 rounded-2xl p-4 shadow-xs space-y-2.5"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-xs font-extrabold text-amber-900 flex items-center gap-1.5">
            <i class="pi pi-cloud-upload text-amber-600 text-sm"></i>
            <span>{{ pendingQueueItems.length }} elrakás várakozik szinkronizálásra</span>
          </p>
          <p class="text-[11px] text-amber-800 mt-0.5">
            {{
              isOnline
                ? 'A Wi-Fi elérhető – indítsd a szinkronizálást vagy várd meg az automatikus beküldést.'
                : 'Offline mód – automatikusan beküldjük, amint visszajön a Wi-Fi.'
            }}
          </p>
        </div>
        <button
          type="button"
          :disabled="!isOnline || isFlushing"
          @click="handleFlushReceiptQueue"
          class="min-h-[40px] px-3 rounded-xl bg-amber-600 text-white text-xs font-bold flex items-center gap-1.5 shrink-0 active:scale-[0.98] disabled:opacity-50 transition cursor-pointer"
        >
          <i :class="['pi text-xs', isFlushing ? 'pi-spin pi-spinner' : 'pi-sync']"></i>
          <span>Szinkronizálás most</span>
        </button>
      </div>

      <div class="space-y-1.5">
        <div
          v-for="qItem in pendingQueueItems"
          :key="qItem.localId"
          class="bg-white/90 border border-amber-200 rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-xs"
        >
          <div class="min-w-0">
            <p class="font-bold text-slate-800 truncate">{{ qItem.productLabel }}</p>
            <p class="text-[11px] text-slate-500 truncate">
              → {{ qItem.locationLabel }} · {{ formatDateTime(qItem.createdAt) }}
            </p>
          </div>
          <div class="flex items-center gap-1.5 shrink-0">
            <span class="font-extrabold text-amber-900">+{{ qItem.payload.quantity }} db</span>
            <span
              class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800"
            >
              {{ qItem.status === 'SENDING' ? 'Küldés...' : 'Várakozik' }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Betöltés -->
    <div
      v-if="loading && !receipt"
      class="bg-white rounded-2xl border border-slate-200/80 p-8 text-center text-slate-500 space-y-2"
    >
      <i class="pi pi-spin pi-spinner text-2xl text-blue-500"></i>
      <p class="text-sm font-medium">Bevételezés adatainak betöltése...</p>
    </div>

    <!-- Hibaüzenet, ha nem töltődött be a bizonylat -->
    <div
      v-else-if="loadError && !receipt"
      class="bg-white rounded-2xl border border-rose-200 p-6 text-center space-y-3"
    >
      <div class="w-12 h-12 rounded-2xl bg-rose-50 text-rose-500 flex items-center justify-center mx-auto">
        <i class="pi pi-exclamation-circle text-xl"></i>
      </div>
      <p class="text-sm font-bold text-slate-900">{{ loadError }}</p>
      <button
        type="button"
        @click="fetchReceipt({ initial: true })"
        class="min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-xs font-bold cursor-pointer"
      >
        Újrapróbálás
      </button>
    </div>

    <!-- Bevételezés fő nézet -->
    <template v-else-if="receipt">
      <!-- Bizonylat fejléc kártya (árak/deviza nélkül!) -->
      <div class="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-2xs space-y-2">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h1 class="text-base font-extrabold text-slate-900 leading-tight truncate">
              {{ receipt.receiptNumber }}
            </h1>
            <p class="text-xs font-semibold text-blue-700 flex items-center gap-1 mt-0.5 truncate">
              <i class="pi pi-map-marker text-[11px]"></i>
              <span>{{ receipt.targetLocation.name }}</span>
            </p>
          </div>
          <span
            :class="[
              'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0',
              GOODS_RECEIPT_STATUS_META[receipt.status].badgeClass,
            ]"
          >
            <i :class="[GOODS_RECEIPT_STATUS_META[receipt.status].icon, 'text-[10px]']"></i>
            {{ GOODS_RECEIPT_STATUS_META[receipt.status].label }}
          </span>
        </div>

        <div class="flex items-center justify-between gap-2 text-[11px] text-slate-500 pt-1 border-t border-slate-100">
          <span class="truncate">
            <template v-if="receipt.supplier?.name">{{ receipt.supplier.name }}</template>
            <template v-if="receipt.supplier?.name && receipt.invoiceNumber"> · </template>
            <template v-if="receipt.invoiceNumber">Számla: {{ receipt.invoiceNumber }}</template>
            <template v-if="!receipt.supplier?.name && !receipt.invoiceNumber">
              Aktív elpakolás
            </template>
          </span>
          <span class="font-bold text-slate-700 shrink-0">
            <template v-if="totalExpectedQty > 0">
              {{ totalReceivedQty }} / {{ totalExpectedQty }} db
            </template>
            <template v-else>
              {{ totalReceivedQty }} db elrakva
            </template>
          </span>
        </div>

        <div class="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            :class="[
              'h-full rounded-full transition-all duration-300',
              totalExpectedQty > 0 && totalReceivedQty > totalExpectedQty
                ? 'bg-orange-500'
                : totalExpectedQty > 0 && totalReceivedQty === totalExpectedQty
                  ? 'bg-emerald-500'
                  : 'bg-blue-500',
            ]"
            :style="{ width: `${overallProgressPercent}%` }"
          ></div>
        </div>
      </div>

      <!-- Ha a bizonylat már nem OPEN / IN_PROGRESS, tájékoztató üzenet (PDA-ról nincs lezárás/módosítás) -->
      <div
        v-if="!isReceiptEditableForPutaway"
        class="bg-slate-800 text-slate-100 rounded-2xl p-4 space-y-1 shadow-xs"
      >
        <p class="text-xs font-bold flex items-center gap-1.5">
          <i class="pi pi-info-circle text-sky-400"></i>
          <span>Az elpakolás jelenleg nem aktív</span>
        </p>
        <p class="text-[11px] text-slate-300 leading-relaxed">
          A bevételezés „{{ GOODS_RECEIPT_STATUS_META[receipt.status].label }}” státuszban van, így
          PDA-ról további elrakás nem rögzíthető.
        </p>
      </div>

      <!-- Folyamatos Termék → Polc szkennelő munkafolyamat -->
      <div
        v-else
        class="bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs space-y-4"
      >
        <!-- 1. LÉPÉS: TERMÉK -->
        <div class="space-y-2">
          <div class="flex items-center justify-between gap-2">
            <label
              for="pda-product-scan"
              class="text-xs font-extrabold uppercase tracking-wide text-slate-700 flex items-center gap-1.5"
            >
              <span class="w-5 h-5 rounded-full bg-blue-600 text-white text-[11px] font-extrabold inline-flex items-center justify-center">
                1
              </span>
              <span>Termék (Vonalkód / SKU)</span>
            </label>
            <button
              v-if="hasProductValue"
              type="button"
              @click="
                () => {
                  productScanInput = ''
                  selectedVariantId = null
                  focusProductInput()
                }
              "
              class="text-[11px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
            >
              Törlés
            </button>
          </div>

          <div class="relative">
            <i class="pi pi-barcode absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-base"></i>
            <input
              id="pda-product-scan"
              ref="productInputRef"
              v-model="productScanInput"
              type="text"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="Csippantsd le a vonalkódot vagy írj SKU-t..."
              @input="handleProductInputChange"
              @keydown.enter.prevent="handleProductEnter"
              class="w-full min-h-[50px] bg-slate-50 border-2 border-slate-200 rounded-xl pl-10 pr-10 text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
            />
            <button
              v-if="productScanInput"
              type="button"
              @click="
                () => {
                  productScanInput = ''
                  focusProductInput()
                }
              "
              aria-label="Vonalkód mező törlése"
              class="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-200/70 cursor-pointer"
            >
              <i class="pi pi-times text-xs"></i>
            </button>
          </div>

          <!-- Gyors választó a bizonylat várt tételeiből -->
          <Select
            v-if="expectedItemOptions.length > 0"
            :modelValue="selectedVariantId"
            :options="expectedItemOptions"
            optionLabel="label"
            optionValue="variantId"
            filter
            :filterFields="['productName', 'sku', 'attributesText', 'searchText']"
            showClear
            placeholder="Vagy válassz a bizonylat várt tételeiből..."
            class="w-full"
            @update:modelValue="handleSelectExpectedItem"
          >
            <template #option="{ option }">
              <div class="flex items-center justify-between gap-2 w-full py-0.5">
                <div class="min-w-0">
                  <p class="text-xs font-bold text-slate-900 truncate">{{ option.productName }}</p>
                  <p class="text-[11px] text-slate-500 truncate">
                    {{ option.sku }}
                    <template v-if="option.attributesText"> · {{ option.attributesText }}</template>
                  </p>
                </div>
                <span
                  :class="[
                    'px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0',
                    option.remainingQuantity > 0
                      ? 'bg-amber-50 text-amber-800 border border-amber-200'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200',
                  ]"
                >
                  <template v-if="option.remainingQuantity > 0">
                    Még {{ option.remainingQuantity }} db
                  </template>
                  <template v-else>
                    {{ option.receivedQuantity }}/{{ option.expectedQuantity }} db
                  </template>
                </span>
              </div>
            </template>
          </Select>

          <!-- Felismert tétel előnézet -->
          <div
            v-if="matchedReceiptItem"
            class="rounded-xl bg-blue-50/80 border border-blue-200 px-3 py-2 flex items-center justify-between gap-2 text-xs"
          >
            <div class="min-w-0">
              <p class="font-bold text-slate-900 truncate">
                {{ getItemProductName(matchedReceiptItem) }}
              </p>
              <p class="text-[11px] text-slate-600 truncate">
                SKU: <span class="font-semibold">{{ matchedReceiptItem.variant.sku }}</span>
                <template v-if="formatVariantAttributes(matchedReceiptItem)">
                  · {{ formatVariantAttributes(matchedReceiptItem) }}
                </template>
              </p>
            </div>
            <span class="px-2 py-0.5 rounded-lg bg-white border border-blue-200 text-blue-800 font-extrabold shrink-0">
              {{ matchedReceiptItem.receivedQuantity }} / {{ matchedReceiptItem.expectedQuantity }} db
            </span>
          </div>
        </div>

        <!-- MENNYISÉG (nagy kesztyűbarát gombok) -->
        <div class="space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <label
              for="pda-putaway-qty"
              class="text-xs font-extrabold uppercase tracking-wide text-slate-700"
            >
              Mennyiség (db)
            </label>
            <button
              v-if="
                matchedReceiptItem &&
                matchedReceiptItem.expectedQuantity - matchedReceiptItem.receivedQuantity > 1
              "
              type="button"
              @click="
                quantity = matchedReceiptItem.expectedQuantity - matchedReceiptItem.receivedQuantity
              "
              class="text-[11px] font-bold px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 active:scale-[0.97] cursor-pointer"
            >
              Hátralévő: {{ matchedReceiptItem.expectedQuantity - matchedReceiptItem.receivedQuantity }} db
            </button>
          </div>

          <div class="grid grid-cols-5 gap-1.5">
            <button
              type="button"
              :disabled="quantity <= 1"
              @click="adjustQuantity(-1)"
              class="min-h-[48px] rounded-xl bg-slate-100 border border-slate-200 text-slate-800 text-sm font-extrabold active:scale-[0.96] disabled:opacity-40 transition cursor-pointer"
            >
              -1
            </button>
            <input
              id="pda-putaway-qty"
              v-model.number="quantity"
              type="number"
              min="1"
              inputmode="numeric"
              @blur="normalizeQuantityInput"
              class="min-h-[48px] w-full text-center bg-white border-2 border-slate-200 rounded-xl text-base font-extrabold text-slate-900 outline-none focus:border-blue-500"
            />
            <button
              type="button"
              @click="adjustQuantity(1)"
              class="min-h-[48px] rounded-xl bg-slate-100 border border-slate-200 text-slate-800 text-sm font-extrabold active:scale-[0.96] transition cursor-pointer"
            >
              +1
            </button>
            <button
              type="button"
              @click="adjustQuantity(5)"
              class="min-h-[48px] rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm font-extrabold active:scale-[0.96] transition cursor-pointer"
            >
              +5
            </button>
            <button
              type="button"
              @click="adjustQuantity(10)"
              class="min-h-[48px] rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-sm font-extrabold active:scale-[0.96] transition cursor-pointer"
            >
              +10
            </button>
          </div>
        </div>

        <!-- 2. LÉPÉS: CÉLPOLC + POLC RÖGZÍTÉSE (LOCK) -->
        <div class="space-y-2 pt-1 border-t border-slate-100">
          <div class="flex items-center justify-between gap-2">
            <label
              for="pda-shelf-scan"
              class="text-xs font-extrabold uppercase tracking-wide text-slate-700 flex items-center gap-1.5"
            >
              <span class="w-5 h-5 rounded-full bg-indigo-600 text-white text-[11px] font-extrabold inline-flex items-center justify-center">
                2
              </span>
              <span>Célpolc</span>
            </label>

            <!-- Polc rögzítése (Lock) kapcsoló -->
            <button
              type="button"
              role="switch"
              :aria-checked="lockShelf"
              @click="lockShelf = !lockShelf"
              :class="[
                'inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-xl text-xs font-bold border transition active:scale-[0.97] cursor-pointer',
                lockShelf
                  ? 'bg-indigo-600 text-white border-indigo-700 shadow-xs'
                  : 'bg-slate-100 text-slate-700 border-slate-200',
              ]"
            >
              <i :class="['pi text-xs', lockShelf ? 'pi-lock' : 'pi-lock-open']"></i>
              <span>Polc rögzítése (Lock)</span>
            </button>
          </div>

          <div class="relative">
            <i class="pi pi-qrcode absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-base"></i>
            <input
              id="pda-shelf-scan"
              ref="shelfInputRef"
              v-model="shelfScanInput"
              type="text"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="Polc QR / név / ID csippantása (Enter = rögzítés)..."
              @input="handleShelfInputChange"
              @keydown.enter.prevent="handleShelfEnter"
              class="w-full min-h-[50px] bg-slate-50 border-2 border-slate-200 rounded-xl pl-10 pr-10 text-sm font-semibold text-slate-900 placeholder-slate-400 outline-none focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition"
            />
            <button
              v-if="shelfScanInput"
              type="button"
              @click="
                () => {
                  shelfScanInput = ''
                  focusShelfInput()
                }
              "
              aria-label="Polc mező törlése"
              class="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-200/70 cursor-pointer"
            >
              <i class="pi pi-times text-xs"></i>
            </button>
          </div>

          <!-- Gyors választó a célhelyszín és leszármazottai közül -->
          <Select
            v-if="shelfOptions.length > 0"
            :modelValue="selectedShelfId"
            :options="shelfOptions"
            optionLabel="pathLabel"
            optionValue="id"
            filter
            :filterFields="['name', 'pathLabel', 'typeLabel', 'searchText']"
            showClear
            placeholder="Vagy válassz polcot / rekeszt a listából..."
            class="w-full"
            @update:modelValue="handleSelectShelf"
          >
            <template #option="{ option }">
              <div class="flex items-center justify-between gap-2 w-full py-0.5">
                <div class="min-w-0">
                  <p class="text-xs font-bold text-slate-900 truncate">{{ option.name }}</p>
                  <p class="text-[11px] text-slate-500 truncate">{{ option.pathLabel }}</p>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <span
                    v-if="option.slotModeLabel && option.slotModeBadgeClass"
                    :class="['px-1.5 py-0.5 rounded text-[10px] font-bold', option.slotModeBadgeClass]"
                  >
                    {{ option.slotModeLabel }}
                  </span>
                  <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold">
                    {{ option.typeLabel }}
                  </span>
                </div>
              </div>
            </template>
          </Select>

          <!-- Ajánlott polc gyorsgomb, ha a várt tételhez tartozik expectedLocation -->
          <button
            v-if="
              matchedReceiptItem?.expectedLocation &&
              selectedShelfId !== matchedReceiptItem.expectedLocation.id
            "
            type="button"
            @click="applySuggestedShelf(matchedReceiptItem.expectedLocation.id)"
            class="w-full min-h-[40px] px-3 py-2 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-bold flex items-center justify-between gap-2 active:scale-[0.98] cursor-pointer"
          >
            <span class="flex items-center gap-1.5 truncate">
              <i class="pi pi-compass text-xs"></i>
              <span>Ajánlott polc: {{ matchedReceiptItem.expectedLocation.name }}</span>
            </span>
            <span class="text-[11px] underline shrink-0">Kiválasztás</span>
          </button>

          <!-- Aktívan kiválasztott/felismert célpolc megerősítés -->
          <div
            v-if="resolvedShelfLocation"
            class="rounded-xl bg-indigo-50/80 border border-indigo-200 px-3 py-2 flex items-center justify-between gap-2 text-xs"
          >
            <div class="min-w-0">
              <p class="font-bold text-indigo-950 truncate">
                {{ resolvedShelfLocation.name }}
                <span v-if="lockShelf" class="text-indigo-600 font-extrabold">(Rögzítve)</span>
              </p>
              <p class="text-[11px] text-indigo-700 truncate">
                {{
                  getLocationPath(resolvedShelfLocation.id, locationsById)
                    .map((n) => n.name)
                    .join(' › ')
                }}
              </p>
            </div>
            <span
              v-if="resolvedShelfLocation.slotMode"
              :class="[
                'px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0',
                SLOT_MODE_META[resolvedShelfLocation.slotMode].badgeClass,
              ]"
            >
              {{ SLOT_MODE_META[resolvedShelfLocation.slotMode].shortLabel }}
            </span>
          </div>
        </div>

        <!-- Nagy zöld „Elrakás rögzítése” gomb (SOHA nincs Lezárás / Befejezés gomb!) -->
        <button
          type="button"
          :disabled="!canSubmitPutaway"
          @click="handleSubmitPutaway"
          class="w-full min-h-[54px] rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.985] disabled:bg-slate-300 disabled:text-slate-500 text-white font-extrabold text-base shadow-sm flex items-center justify-center gap-2 transition cursor-pointer"
        >
          <i :class="['pi text-base', submitting ? 'pi-spin pi-spinner' : 'pi-check-circle']"></i>
          <span>{{ submitting ? 'Rögzítés...' : 'Elrakás rögzítése' }}</span>
        </button>

        <!-- Legutóbbi akció visszajelző sáv -->
        <div
          v-if="feedback"
          :class="[
            'rounded-xl px-3.5 py-2.5 text-xs border space-y-0.5',
            feedback.kind === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : feedback.kind === 'offline'
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-rose-50 border-rose-300 text-rose-900',
          ]"
        >
          <p class="font-extrabold flex items-center gap-1.5">
            <i
              :class="[
                'pi text-xs',
                feedback.kind === 'success'
                  ? 'pi-check-circle text-emerald-600'
                  : feedback.kind === 'offline'
                    ? 'pi-clock text-amber-600'
                    : 'pi-times-circle text-rose-600',
              ]"
            ></i>
            <span>{{ feedback.title }}</span>
          </p>
          <p class="opacity-90 leading-snug">{{ feedback.detail }}</p>
        </div>
      </div>

      <!-- Alsó kompakt szekció: (A) Tételek | (B) Legutóbbi elrakások (Sztornó) -->
      <div class="bg-white rounded-2xl border border-slate-200/80 p-3 shadow-2xs space-y-3">
        <div class="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-100">
          <button
            type="button"
            @click="activeBottomTab = 'items'"
            :class="[
              'min-h-[42px] px-2 rounded-lg text-xs font-extrabold transition cursor-pointer',
              activeBottomTab === 'items'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900',
            ]"
          >
            Tételek ({{ receipt.items.length }})
          </button>
          <button
            type="button"
            @click="activeBottomTab = 'movements'"
            :class="[
              'min-h-[42px] px-2 rounded-lg text-xs font-extrabold transition cursor-pointer',
              activeBottomTab === 'movements'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900',
            ]"
          >
            Legutóbbi elrakások ({{ recentPutawayMovements.length }})
          </button>
        </div>

        <!-- (A) Tételek fül -->
        <div v-if="activeBottomTab === 'items'" class="space-y-2">
          <div
            v-if="receipt.items.length === 0"
            class="text-center py-6 text-xs text-slate-500"
          >
            Még nincs rögzített tétel ezen a bevételezésen. Csippants le egy terméket az induláshoz!
          </div>

          <button
            v-for="item in receipt.items"
            :key="item.id"
            type="button"
            @click="handlePickItemCard(item)"
            class="w-full text-left rounded-xl border border-slate-200/90 p-3 bg-slate-50/50 hover:bg-white hover:border-blue-300 active:scale-[0.99] transition space-y-2 cursor-pointer"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="text-xs font-extrabold text-slate-900 leading-snug break-words">
                  {{ getItemProductName(item) }}
                </p>
                <p class="text-[11px] text-slate-500 mt-0.5 truncate">
                  SKU: <span class="font-semibold text-slate-700">{{ item.variant.sku }}</span>
                  <template v-if="formatVariantAttributes(item)">
                    · {{ formatVariantAttributes(item) }}
                  </template>
                </p>
                <p
                  v-if="item.expectedLocation"
                  class="text-[11px] text-indigo-700 font-semibold mt-0.5 flex items-center gap-1"
                >
                  <i class="pi pi-map-marker text-[10px]"></i>
                  <span>Várt polc: {{ item.expectedLocation.name }}</span>
                </p>
              </div>

              <div class="flex flex-col items-end gap-1 shrink-0">
                <span class="text-xs font-extrabold text-slate-900">
                  {{ item.receivedQuantity }} / {{ item.expectedQuantity }} db
                </span>
                <span
                  :class="[
                    'px-2 py-0.5 rounded-full text-[10px] font-bold',
                    getItemProgressBadge(item).badgeClass,
                  ]"
                >
                  {{ getItemProgressBadge(item).label }}
                </span>
              </div>
            </div>

            <div class="w-full h-1.5 bg-slate-200/80 rounded-full overflow-hidden">
              <div
                :class="['h-full rounded-full transition-all', getItemProgressBadge(item).barClass]"
                :style="{ width: `${getItemProgressPercent(item)}%` }"
              ></div>
            </div>
          </button>
        </div>

        <!-- (B) Legutóbbi elrakások (Sztornó) fül -->
        <div v-else class="space-y-2">
          <div
            v-if="recentPutawayMovements.length === 0"
            class="text-center py-6 text-xs text-slate-500"
          >
            Még nem történt elrakás ezen a bevételezésen.
          </div>

          <div
            v-for="movement in recentPutawayMovements"
            :key="movement.id"
            :class="[
              'rounded-xl border p-3 space-y-2',
              movement.reversedBy
                ? 'bg-slate-50 border-slate-200/70 opacity-75'
                : 'bg-white border-slate-200',
            ]"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p
                  :class="[
                    'text-xs font-bold text-slate-900 break-words',
                    movement.reversedBy ? 'line-through text-slate-500' : '',
                  ]"
                >
                  {{ getMovementProductName(movement) }}
                </p>
                <p class="text-[11px] text-slate-500 mt-0.5">
                  SKU: {{ movement.variant.sku }} ·
                  <span class="font-semibold text-indigo-700">{{ movement.location.name }}</span>
                </p>
                <p class="text-[10px] text-slate-400 mt-0.5">
                  {{ formatDateTime(movement.createdAt) }}
                  <template v-if="movement.createdByUser?.name">
                    · {{ movement.createdByUser.name }}
                  </template>
                </p>
              </div>

              <div class="flex flex-col items-end gap-1.5 shrink-0">
                <span
                  :class="[
                    'px-2 py-0.5 rounded-md text-xs font-extrabold',
                    movement.reversedBy
                      ? 'bg-slate-200 text-slate-500 line-through'
                      : 'bg-emerald-50 text-emerald-700 border border-emerald-200',
                  ]"
                >
                  +{{ movement.quantity }} db
                </span>

                <span
                  v-if="movement.reversedBy"
                  class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-600"
                >
                  Sztornózva
                </span>

                <button
                  v-else-if="canUndoMovement(movement)"
                  type="button"
                  :disabled="undoingMovementId === movement.id"
                  @click="handleUndoMovement(movement)"
                  class="min-h-[36px] px-3 rounded-lg bg-rose-50 border border-rose-300 text-rose-700 text-xs font-bold inline-flex items-center gap-1 active:scale-[0.97] disabled:opacity-50 transition cursor-pointer"
                >
                  <i
                    :class="[
                      'pi text-[11px]',
                      undoingMovementId === movement.id ? 'pi-spin pi-spinner' : 'pi-undo',
                    ]"
                  ></i>
                  <span>Sztornó</span>
                </button>
              </div>
            </div>

            <!-- Offline / sikertelen sztornó FAILED jelzés -->
            <div
              v-if="failedUndoMap[movement.id]"
              class="rounded-lg bg-rose-50 border border-rose-300 px-2.5 py-2 flex items-start gap-2 text-[11px] text-rose-800"
            >
              <span class="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-extrabold shrink-0">
                FAILED
              </span>
              <span class="font-semibold leading-snug">{{ failedUndoMap[movement.id] }}</span>
            </div>
          </div>
        </div>
      </div>

      <p v-if="lastRefreshedAt" class="text-center text-[10px] text-slate-400">
        Utolsó frissítés: {{ formatDateTime(lastRefreshedAt) }}
      </p>
    </template>
  </div>
</template>
