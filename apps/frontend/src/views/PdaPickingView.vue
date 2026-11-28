<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import {
  LocationType,
  MovementType,
  PickTaskStatus,
  Role,
  SalesOrderStatus,
} from '@wmanager/shared-types'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import { useToast } from 'primevue/usetoast'
import { locationApi, type LocationItem } from '@/api/locations'
import {
  pickTasksApi,
  type AvailableShelfOption,
  type DropoffPickTaskPayload,
  type DropoffResponse,
  type MyRouteItem,
  type MyRouteResponse,
  type PickItemPayload,
  type PickResponse,
  type PickTaskListItem,
  type PickTaskRouteTask,
} from '@/api/pickTasks'
import type { SalesOrderMovementDto, SalesOrderVariantInfo } from '@/api/salesOrders'
import {
  hasHttpResponse,
  isNetworkError,
  useOfflinePickingQueue,
  type QueuedPickingItem,
} from '@/composables/useOfflinePickingQueue'
import { useAuthStore } from '@/stores/auth'
import { matchesBarcodeOrSku, normalizeScannedBarcode } from '@/utils/barcodeScanner'
import { formatDateTime } from '@/utils/formatters'
import {
  extractApiError,
  getLocationPath,
  LOCATION_TYPE_META,
  SLOT_MODE_META,
} from '@/utils/locationMeta'
import { PICK_TASK_STATUS_META, SALES_CHANNEL_META } from '@/utils/salesOrderMeta'

type PickingTab = 'open' | 'route' | 'dropoff'

interface ZoneFilterChip {
  key: string
  label: string
  count: number
}

interface DropoffShelfOption {
  id: string
  name: string
  pathLabel: string
  typeLabel: string
  slotModeLabel: string | null
  slotModeBadgeClass: string | null
  searchText: string
}

interface StatusBanner {
  kind: 'success' | 'ready' | 'offline' | 'info' | 'error'
  title: string
  detail: string
  actionTab?: PickingTab
  actionLabel?: string
}

const LOCATIONS_CACHE_KEY = 'xstorage_pda_locations_cache_v1'
const ROUTE_CACHE_KEY = 'xstorage_pda_picking_route_cache_v1'
const QUICK_SCAN_PREF_KEY = 'xstorage_pda_picking_quick_scan_v1'
const NO_ZONE_KEY = '__NO_ZONE__'
const POLL_INTERVAL_MS = 20_000

const STAFF_SELF_UNDO_ROLES: readonly Role[] = [Role.WAREHOUSE_STAFF, Role.STORE_STAFF]

const SHORTAGE_QUICK_REASONS: readonly string[] = [
  'A polc üres',
  'Kevesebb darab található a polcon',
  'Sérült / hiányos csomagolás',
  'Más termék van a polcon',
]

const router = useRouter()
const toast = useToast()
const authStore = useAuthStore()

const {
  queue,
  isOnline,
  isFlushing,
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
} = useOfflinePickingQueue()

const currentUserId = computed<string | null>(
  () => authStore.user?.userId ?? authStore.user?.id ?? null,
)
const currentUserRole = computed<Role | null>(() => authStore.user?.role ?? null)

// Fő navigációs állapot
const activeTab = ref<PickingTab>('open')
const hasUserSwitchedTab = ref(false)
const banner = ref<StatusBanner | null>(null)
const readyOrderBanner = ref<{ orderNumber: string; taskNumber: string } | null>(null)

// Lokációk és telephely választó
const allLocations = ref<LocationItem[]>(loadCachedLocations())
const selectedSiteId = ref<string | null>(null)
const loadingLocations = ref(false)

// Adatforrások
const openTasks = ref<PickTaskListItem[]>([])
const routeData = ref<MyRouteResponse>(loadCachedRoute())
const loadingOpen = ref(false)
const loadingRoute = ref(false)
const refreshing = ref(false)
const lastRefreshedAt = ref<string | null>(null)

// 1. fül: OPEN feladattábla állapot
const selectedZoneKey = ref<string>('ALL')
const selectedOpenTaskIds = ref<string[]>([])
const claimToteInput = ref('')
const claimingBatch = ref(false)

// 2. fül: Szedőkör állapot
const activeTasksExpanded = ref(false)
const editingToteTaskId = ref<string | null>(null)
const editingToteValue = ref('')
const savingToteTaskId = ref<string | null>(null)
const releasingTaskId = ref<string | null>(null)

const scannerInputRef = ref<HTMLInputElement | null>(null)
const routeScanInput = ref('')
const quickScanPlusOne = ref<boolean>(loadQuickScanPref())
const highlightedItemId = ref<string | null>(null)
const matchedItemIds = ref<string[]>([])

const selectedShelfByItem = ref<Record<string, string | null>>({})
const customShelfOpenByItem = ref<Record<string, boolean>>({})
const customShelfNameByItem = ref<Record<string, string>>({})
const pickQtyByItem = ref<Record<string, number>>({})
const pickingItemId = ref<string | null>(null)
const undoingTaskKey = ref<string | null>(null)
const brokenImageUrls = ref<Record<string, boolean>>({})

// Polchiány dialógus állapot
const shortageDialogVisible = ref(false)
const shortageTargetItem = ref<MyRouteItem | null>(null)
const shortageLocationId = ref<string | null>(null)
const shortageFoundQuantity = ref<number>(0)
const shortageReason = ref('')
const submittingShortage = ref(false)

// 3. fül: Lerakás állapot
const dropoffCodeByTask = ref<Record<string, string>>({})
const dropoffLocationIdByTask = ref<Record<string, string | null>>({})
const droppingTaskId = ref<string | null>(null)

// Offline sor szinkron állapot
const retryingLocalId = ref<string | null>(null)
const isManualFlushing = ref(false)

let openAbortController: AbortController | null = null
let routeAbortController: AbortController | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let highlightClearTimer: ReturnType<typeof setTimeout> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

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
    // Storage quota esetén nem állítjuk meg a futást
  }
}

function emptyRoute(): MyRouteResponse {
  return {
    tasks: [],
    inProgressTasks: [],
    awaitingDropTasks: [],
    routeItems: [],
  }
}

function loadCachedRoute(): MyRouteResponse {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return emptyRoute()
  }
  try {
    const raw = localStorage.getItem(ROUTE_CACHE_KEY)
    if (!raw) return emptyRoute()
    const parsed: unknown = JSON.parse(raw)
    if (
      !isRecord(parsed) ||
      !Array.isArray(parsed.tasks) ||
      !Array.isArray(parsed.inProgressTasks) ||
      !Array.isArray(parsed.awaitingDropTasks) ||
      !Array.isArray(parsed.routeItems)
    ) {
      return emptyRoute()
    }
    return parsed as unknown as MyRouteResponse
  } catch {
    return emptyRoute()
  }
}

function saveCachedRoute(data: MyRouteResponse): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return
  }
  try {
    localStorage.setItem(ROUTE_CACHE_KEY, JSON.stringify(data))
  } catch {
    // Storage quota esetén nem blokkoljuk a működést
  }
}

function loadQuickScanPref(): boolean {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return false
  }
  try {
    return localStorage.getItem(QUICK_SCAN_PREF_KEY) === '1'
  } catch {
    return false
  }
}

function saveQuickScanPref(enabled: boolean): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return
  }
  try {
    localStorage.setItem(QUICK_SCAN_PREF_KEY, enabled ? '1' : '0')
  } catch {
    // Nem blokkoljuk a működést
  }
}

// Helyszín segédek
const locationsById = computed<Map<string, LocationItem>>(() => {
  const map = new Map<string, LocationItem>()
  for (const loc of allLocations.value) {
    map.set(loc.id, loc)
  }
  return map
})

const assignedSites = computed<LocationItem[]>(() =>
  allLocations.value
    .filter(
      (loc) =>
        loc.isActive &&
        (loc.type === LocationType.WAREHOUSE || loc.type === LocationType.STORE) &&
        loc.isAssigned !== false,
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'hu', { numeric: true })),
)

const isSingleSite = computed<boolean>(() => assignedSites.value.length === 1)

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

function getDropoffOptionsForSite(sourceLocationId: string): DropoffShelfOption[] {
  const map = locationsById.value
  const typeOrder: Record<LocationType, number> = {
    [LocationType.BIN]: 0,
    [LocationType.SHELF]: 1,
    [LocationType.ZONE]: 2,
    [LocationType.WAREHOUSE]: 3,
    [LocationType.STORE]: 3,
  }

  return allLocations.value
    .filter((loc) => loc.isActive && isDescendantOrSelf(loc.id, sourceLocationId))
    .sort((a, b) => {
      const orderDiff = typeOrder[a.type] - typeOrder[b.type]
      if (orderDiff !== 0) return orderDiff
      return a.name.localeCompare(b.name, 'hu', { numeric: true })
    })
    .map((loc) => {
      const path = getLocationPath(loc.id, map)
      const pathLabel = path.map((node) => node.name).join(' › ')
      const typeMeta = LOCATION_TYPE_META[loc.type]
      const slotMeta = loc.slotMode ? SLOT_MODE_META[loc.slotMode] : null
      return {
        id: loc.id,
        name: loc.name,
        pathLabel,
        typeLabel: typeMeta.label,
        slotModeLabel: slotMeta?.shortLabel ?? null,
        slotModeBadgeClass: slotMeta?.badgeClass ?? null,
        searchText: `${loc.name} ${pathLabel} ${loc.id}`.toLowerCase(),
      }
    })
}

// Offline sor nézetek
const failedQueueItems = computed<QueuedPickingItem[]>(() =>
  queue.value.filter((item) => item.status === 'FAILED'),
)
const pendingQueueItems = computed<QueuedPickingItem[]>(() =>
  queue.value.filter((item) => item.status === 'PENDING' || item.status === 'SENDING'),
)

// Szedőkör nézetek
const inProgressTasks = computed<PickTaskRouteTask[]>(() => routeData.value.inProgressTasks)
const awaitingDropTasks = computed<PickTaskRouteTask[]>(() => routeData.value.awaitingDropTasks)
const routeItems = computed<MyRouteItem[]>(() => routeData.value.routeItems)

const totalRemainingRouteQty = computed<number>(() =>
  routeItems.value.reduce((sum, item) => sum + item.remainingQuantity, 0),
)

// 1. fül: Zóna szűrő chipek és szűrt OPEN feladatok
const zoneFilterChips = computed<ZoneFilterChip[]>(() => {
  const counts = new Map<string, { label: string; count: number }>()

  // A választott telephely (vagy hozzárendelt telephelyek) aktív zónáit felvesszük
  const relevantSiteIds = selectedSiteId.value
    ? new Set<string>([selectedSiteId.value])
    : new Set<string>(assignedSites.value.map((s) => s.id))

  for (const loc of allLocations.value) {
    if (
      loc.isActive &&
      loc.type === LocationType.ZONE &&
      loc.parentId &&
      relevantSiteIds.has(loc.parentId)
    ) {
      counts.set(loc.id, { label: loc.name, count: 0 })
    }
  }

  for (const task of openTasks.value) {
    const key = task.zoneId ?? NO_ZONE_KEY
    const label = task.zone?.name ?? 'Zóna nélkül'
    const existing = counts.get(key)
    if (existing) {
      existing.count += 1
    } else {
      counts.set(key, { label, count: 1 })
    }
  }

  const zoneEntries = Array.from(counts.entries())
    .map(([key, info]) => ({ key, label: info.label, count: info.count }))
    .filter((entry) => entry.count > 0 || (selectedSiteId.value !== null && entry.key !== NO_ZONE_KEY))
    .sort((a, b) => {
      if (a.key === NO_ZONE_KEY && b.key !== NO_ZONE_KEY) return 1
      if (a.key !== NO_ZONE_KEY && b.key === NO_ZONE_KEY) return -1
      return a.label.localeCompare(b.label, 'hu', { numeric: true })
    })

  return [{ key: 'ALL', label: 'Összes', count: openTasks.value.length }, ...zoneEntries]
})

const filteredOpenTasks = computed<PickTaskListItem[]>(() => {
  if (selectedZoneKey.value === 'ALL') return openTasks.value
  if (selectedZoneKey.value === NO_ZONE_KEY) {
    return openTasks.value.filter((task) => !task.zoneId)
  }
  return openTasks.value.filter((task) => task.zoneId === selectedZoneKey.value)
})

const selectedOpenTasksSummary = computed<{ count: number; totalItems: number; totalQty: number }>(
  () => {
    const selectedSet = new Set(selectedOpenTaskIds.value)
    let totalItems = 0
    let totalQty = 0
    let count = 0
    for (const task of openTasks.value) {
      if (selectedSet.has(task.id)) {
        count += 1
        totalItems += task.items.length
        totalQty += getTaskRemainingQty(task)
      }
    }
    return { count, totalItems, totalQty }
  },
)

const areAllFilteredOpenSelected = computed<boolean>(() => {
  if (filteredOpenTasks.value.length === 0) return false
  const selectedSet = new Set(selectedOpenTaskIds.value)
  return filteredOpenTasks.value.every((task) => selectedSet.has(task.id))
})

// Segédfüggvények megjelenítéshez
function getVariantImageUrl(variant: SalesOrderVariantInfo): string | null {
  const candidates = [variant.imageUrls?.[0], variant.product?.imageUrls?.[0]]
  for (const url of candidates) {
    if (url && !brokenImageUrls.value[url]) {
      return url
    }
  }
  return null
}

function handleImageError(url: string) {
  brokenImageUrls.value = { ...brokenImageUrls.value, [url]: true }
}

function getVariantProductName(variant: SalesOrderVariantInfo): string {
  return variant.product?.name ?? variant.sku
}

function formatVariantAttributes(variant: SalesOrderVariantInfo): string {
  const parts: string[] = []
  if (variant.colors && variant.colors.length > 0) {
    parts.push(variant.colors.join('/'))
  }
  if (variant.size) {
    parts.push(variant.size)
  }
  return parts.join(' · ')
}

function getTaskRequiredQty(task: PickTaskListItem | PickTaskRouteTask): number {
  return task.items.reduce((sum, item) => sum + item.requiredQuantity, 0)
}

function getTaskPickedQty(task: PickTaskListItem | PickTaskRouteTask): number {
  return task.items.reduce((sum, item) => sum + item.pickedQuantity, 0)
}

function getTaskRemainingQty(task: PickTaskListItem | PickTaskRouteTask): number {
  return task.items.reduce(
    (sum, item) => sum + Math.max(0, item.requiredQuantity - item.pickedQuantity),
    0,
  )
}

function getOfflinePickQtyForItem(item: MyRouteItem): number {
  const items = getItemsForTask(item.pickTaskId)
  let qty = 0
  for (const q of items) {
    if (
      q.type === 'pick' &&
      (q.status === 'PENDING' || q.status === 'SENDING') &&
      (q.payload.pickTaskItemId === item.pickTaskItemId ||
        (!q.payload.pickTaskItemId && q.payload.variantId === item.variantId))
    ) {
      qty += q.payload.quantity
    }
  }
  return qty
}

function hasPendingDropoffForTask(pickTaskId: string): boolean {
  return getItemsForTask(pickTaskId).some(
    (q) => q.type === 'dropoff' && (q.status === 'PENDING' || q.status === 'SENDING'),
  )
}

// Route item helyi állapot inicializálás / szinkronizálás
function syncRouteItemStates(items: MyRouteItem[]): void {
  const nextShelf: Record<string, string | null> = {}
  const nextQty: Record<string, number> = {}
  const nextCustomOpen: Record<string, boolean> = {}
  const nextCustomName: Record<string, string> = {}

  for (const item of items) {
    const id = item.pickTaskItemId
    const prevShelf = selectedShelfByItem.value[id]
    const prevShelfStillValid =
      prevShelf !== undefined &&
      prevShelf !== null &&
      (item.availableShelves.some((s) => s.locationId === prevShelf) ||
        prevShelf === item.suggestedLocationId)

    if (prevShelfStillValid) {
      nextShelf[id] = prevShelf
    } else if (item.suggestedLocationId) {
      nextShelf[id] = item.suggestedLocationId
    } else {
      nextShelf[id] = item.availableShelves[0]?.locationId ?? null
    }

    const prevQty = pickQtyByItem.value[id]
    if (typeof prevQty === 'number' && Number.isFinite(prevQty) && prevQty >= 1) {
      nextQty[id] = Math.min(item.remainingQuantity, Math.floor(prevQty))
    } else {
      nextQty[id] = 1
    }

    if (customShelfOpenByItem.value[id]) {
      nextCustomOpen[id] = true
    }
    if (customShelfNameByItem.value[id]) {
      nextCustomName[id] = customShelfNameByItem.value[id]
    }
  }

  selectedShelfByItem.value = nextShelf
  pickQtyByItem.value = nextQty
  customShelfOpenByItem.value = nextCustomOpen
  customShelfNameByItem.value = nextCustomName
}

function getItemPickQty(item: MyRouteItem): number {
  const val = pickQtyByItem.value[item.pickTaskItemId]
  if (typeof val !== 'number' || !Number.isFinite(val)) return 1
  return Math.max(1, Math.min(item.remainingQuantity, Math.floor(val)))
}

function setItemPickQty(item: MyRouteItem, nextValue: number): void {
  const safe = Number.isFinite(nextValue) ? Math.floor(nextValue) : 1
  pickQtyByItem.value = {
    ...pickQtyByItem.value,
    [item.pickTaskItemId]: Math.max(1, Math.min(item.remainingQuantity, safe)),
  }
}

function adjustItemPickQty(item: MyRouteItem, delta: number): void {
  setItemPickQty(item, getItemPickQty(item) + delta)
}

function handleQtyInput(item: MyRouteItem, event: Event): void {
  const target = event.target as HTMLInputElement | null
  if (!target) return
  const parsed = Number.parseInt(target.value, 10)
  if (Number.isNaN(parsed)) return
  setItemPickQty(item, parsed)
}

function selectItemShelf(item: MyRouteItem, locationId: string | null): void {
  selectedShelfByItem.value = {
    ...selectedShelfByItem.value,
    [item.pickTaskItemId]: locationId,
  }
  if (locationId) {
    customShelfNameByItem.value = {
      ...customShelfNameByItem.value,
      [item.pickTaskItemId]: '',
    }
  }
}

function toggleCustomShelfInput(itemId: string): void {
  const nextOpen = !customShelfOpenByItem.value[itemId]
  customShelfOpenByItem.value = {
    ...customShelfOpenByItem.value,
    [itemId]: nextOpen,
  }
  if (!nextOpen) {
    customShelfNameByItem.value = {
      ...customShelfNameByItem.value,
      [itemId]: '',
    }
  }
}

function getResolvedShelfForRouteItem(item: MyRouteItem): {
  locationId?: string
  locationName?: string
  label: string
} | null {
  const customRaw = customShelfNameByItem.value[item.pickTaskItemId]?.trim() ?? ''
  if (customShelfOpenByItem.value[item.pickTaskItemId] && customRaw) {
    const normalized = normalizeScannedBarcode(customRaw)
    if (normalized) {
      return { locationName: normalized, label: normalized }
    }
  }

  const chosenId =
    selectedShelfByItem.value[item.pickTaskItemId] ??
    item.suggestedLocationId ??
    item.availableShelves[0]?.locationId ??
    null

  if (!chosenId) return null

  const foundShelf = item.availableShelves.find((s) => s.locationId === chosenId)
  if (foundShelf) {
    return {
      locationId: foundShelf.locationId,
      label: foundShelf.locationPath || foundShelf.locationName,
    }
  }

  const locNode = locationsById.value.get(chosenId)
  return {
    locationId: chosenId,
    label: locNode?.name ?? item.suggestedLocationPath ?? item.suggestedLocationName ?? chosenId,
  }
}

function getSelectedShelfOption(item: MyRouteItem): AvailableShelfOption | null {
  const chosenId = selectedShelfByItem.value[item.pickTaskItemId]
  if (!chosenId) return null
  return item.availableShelves.find((s) => s.locationId === chosenId) ?? null
}

// Adatbetöltések
async function fetchLocations() {
  if (!isOnline.value) return
  loadingLocations.value = true
  try {
    const res = await locationApi.getAll()
    allLocations.value = res.data
    saveCachedLocations(res.data)
    ensureSiteSelection()
  } catch {
    // Offline/hálózati hiba esetén megtartjuk a helyi gyorsítótárat
  } finally {
    loadingLocations.value = false
  }
}

function ensureSiteSelection(): void {
  const sites = assignedSites.value
  if (sites.length === 1 && sites[0]) {
    selectedSiteId.value = sites[0].id
    return
  }
  if (selectedSiteId.value && !sites.some((s) => s.id === selectedSiteId.value)) {
    selectedSiteId.value = null
  }
}

async function fetchOpenTasks(options?: { silent?: boolean }) {
  if (!isOnline.value) return

  if (openAbortController) {
    openAbortController.abort()
  }
  const controller = new AbortController()
  openAbortController = controller

  if (!options?.silent) {
    loadingOpen.value = true
  }

  try {
    const res = await pickTasksApi.list(
      {
        status: PickTaskStatus.OPEN,
        sourceLocationId: selectedSiteId.value || undefined,
        take: 100,
      },
      controller.signal,
    )
    openTasks.value = res.data.items
    // Töröljük a már nem létező OPEN kijelöléseket
    const validIds = new Set(res.data.items.map((t) => t.id))
    selectedOpenTaskIds.value = selectedOpenTaskIds.value.filter((id) => validIds.has(id))
  } catch (err: unknown) {
    const maybeErr = err as { code?: string; name?: string }
    if (maybeErr?.code === 'ERR_CANCELED' || maybeErr?.name === 'CanceledError') {
      return
    }
    if (!options?.silent && !isNetworkError(err)) {
      toast.add({
        severity: 'error',
        summary: 'Betöltési hiba',
        detail: extractApiError(err, 'Nem sikerült betölteni a szabad kiszedési feladatokat.'),
        life: 4000,
      })
    }
  } finally {
    if (openAbortController === controller) {
      openAbortController = null
    }
    if (!options?.silent) {
      loadingOpen.value = false
    }
  }
}

async function fetchMyRoute(options?: { silent?: boolean }) {
  if (!isOnline.value) {
    syncRouteItemStates(routeData.value.routeItems)
    return
  }

  if (routeAbortController) {
    routeAbortController.abort()
  }
  const controller = new AbortController()
  routeAbortController = controller

  if (!options?.silent) {
    loadingRoute.value = true
  }

  try {
    const res = await pickTasksApi.getMyRoute(
      selectedSiteId.value || undefined,
      controller.signal,
    )
    routeData.value = res.data
    saveCachedRoute(res.data)
    syncRouteItemStates(res.data.routeItems)
    lastRefreshedAt.value = new Date().toISOString()
  } catch (err: unknown) {
    const maybeErr = err as { code?: string; name?: string }
    if (maybeErr?.code === 'ERR_CANCELED' || maybeErr?.name === 'CanceledError') {
      return
    }
    if (!options?.silent && !isNetworkError(err)) {
      toast.add({
        severity: 'error',
        summary: 'Betöltési hiba',
        detail: extractApiError(err, 'Nem sikerült betölteni a saját szedőkört.'),
        life: 4000,
      })
    }
  } finally {
    if (routeAbortController === controller) {
      routeAbortController = null
    }
    if (!options?.silent) {
      loadingRoute.value = false
    }
  }
}

async function refreshAll(options?: { silent?: boolean }) {
  if (!isOnline.value) {
    if (!options?.silent) {
      toast.add({
        severity: 'warn',
        summary: 'Offline állapot',
        detail: 'A frissítéshez aktív Wi-Fi kapcsolat szükséges.',
        life: 2800,
      })
    }
    return
  }

  if (!options?.silent) {
    refreshing.value = true
  }
  try {
    await Promise.all([fetchOpenTasks(options), fetchMyRoute(options)])
  } finally {
    if (!options?.silent) {
      refreshing.value = false
    }
  }
}

function switchTab(tab: PickingTab) {
  activeTab.value = tab
  hasUserSwitchedTab.value = true
  if (tab === 'route') {
    focusScannerInput()
  }
}

function handleSiteChange(siteId: string | null) {
  selectedSiteId.value = siteId
  selectedZoneKey.value = 'ALL'
  selectedOpenTaskIds.value = []
  void refreshAll()
}

// 1. fül műveletek: OPEN kijelölés & claimBatch
function isTaskSelected(taskId: string): boolean {
  return selectedOpenTaskIds.value.includes(taskId)
}

function toggleOpenTaskSelection(taskId: string) {
  if (selectedOpenTaskIds.value.includes(taskId)) {
    selectedOpenTaskIds.value = selectedOpenTaskIds.value.filter((id) => id !== taskId)
  } else {
    selectedOpenTaskIds.value = [...selectedOpenTaskIds.value, taskId]
  }
}

function toggleSelectAllFilteredOpen() {
  const filteredIds = filteredOpenTasks.value.map((t) => t.id)
  if (areAllFilteredOpenSelected.value) {
    const filteredSet = new Set(filteredIds)
    selectedOpenTaskIds.value = selectedOpenTaskIds.value.filter((id) => !filteredSet.has(id))
  } else {
    const merged = new Set([...selectedOpenTaskIds.value, ...filteredIds])
    selectedOpenTaskIds.value = Array.from(merged)
  }
}

function clearOpenSelection() {
  selectedOpenTaskIds.value = []
}

async function handleClaimBatch() {
  if (claimingBatch.value || selectedOpenTaskIds.value.length === 0) return

  const isCurrentlyOffline =
    !isOnline.value || (typeof navigator !== 'undefined' && !navigator.onLine)
  if (isCurrentlyOffline) {
    toast.add({
      severity: 'warn',
      summary: 'Offline mód',
      detail: 'Új feladatok felvételéhez aktív hálózati kapcsolat szükséges.',
      life: 3500,
    })
    return
  }

  const normalizedTote = normalizeScannedBarcode(claimToteInput.value)
  claimToteInput.value = normalizedTote

  claimingBatch.value = true
  try {
    const res = await pickTasksApi.claimBatch({
      pickTaskIds: [...selectedOpenTaskIds.value],
      toteCode: normalizedTote || undefined,
    })

    const count = res.data.tasks.length
    selectedOpenTaskIds.value = []
    claimToteInput.value = ''

    toast.add({
      severity: 'success',
      summary: 'Szedőkör elindítva',
      detail: `${count} kiszedési feladat felvéve${normalizedTote ? ` (${normalizedTote})` : ''}.`,
      life: 3000,
    })

    activeTab.value = 'route'
    hasUserSwitchedTab.value = true
    await Promise.all([fetchMyRoute({ silent: false }), fetchOpenTasks({ silent: true })])
    focusScannerInput()
  } catch (err: unknown) {
    toast.add({
      severity: 'error',
      summary: 'Felvételi hiba',
      detail: extractApiError(err, 'Nem sikerült felvenni a kijelölt feladatokat.'),
      life: 4500,
    })
    void fetchOpenTasks({ silent: true })
  } finally {
    claimingBatch.value = false
  }
}

// 2. fül műveletek: Aktív feladatok (toteCode módosítás & visszaadás)
function startEditTote(task: PickTaskRouteTask) {
  editingToteTaskId.value = task.id
  editingToteValue.value = task.toteCode ?? ''
}

function cancelEditTote() {
  editingToteTaskId.value = null
  editingToteValue.value = ''
}

async function saveTaskTote(task: PickTaskRouteTask) {
  if (savingToteTaskId.value) return
  const normalized = normalizeScannedBarcode(editingToteValue.value)

  savingToteTaskId.value = task.id
  try {
    await pickTasksApi.updateTote(task.id, normalized || null)
    editingToteTaskId.value = null
    editingToteValue.value = ''
    toast.add({
      severity: 'success',
      summary: 'Kocsi / Láda frissítve',
      detail: normalized
        ? `${task.taskNumber} → ${normalized}`
        : `${task.taskNumber} ládakódja törölve.`,
      life: 2500,
    })
    await fetchMyRoute({ silent: true })
  } catch (err: unknown) {
    toast.add({
      severity: 'error',
      summary: 'Mentési hiba',
      detail: extractApiError(err, 'Nem sikerült frissíteni a kocsi/láda kódját.'),
      life: 4000,
    })
  } finally {
    savingToteTaskId.value = null
  }
}

async function handleReleaseTask(task: PickTaskRouteTask) {
  if (releasingTaskId.value) return
  if (getTaskPickedQty(task) > 0) return

  releasingTaskId.value = task.id
  try {
    await pickTasksApi.release(task.id)
    toast.add({
      severity: 'info',
      summary: 'Feladat visszaadva',
      detail: `A(z) ${task.taskNumber} feladat visszakerült az OPEN táblára.`,
      life: 3000,
    })
    await Promise.all([fetchMyRoute({ silent: true }), fetchOpenTasks({ silent: true })])
  } catch (err: unknown) {
    toast.add({
      severity: 'error',
      summary: 'Visszaadási hiba',
      detail: extractApiError(err, 'Nem sikerült visszaadni a feladatot.'),
      life: 4500,
    })
  } finally {
    releasingTaskId.value = null
  }
}

// 2. fül műveletek: Vonalkód/SKU gyors szkenner
function focusScannerInput() {
  void nextTick(() => {
    scannerInputRef.value?.focus()
  })
}

function toggleQuickScan() {
  quickScanPlusOne.value = !quickScanPlusOne.value
  saveQuickScanPref(quickScanPlusOne.value)
}

function highlightAndScrollToRouteItem(itemId: string, allMatchedIds: string[]) {
  highlightedItemId.value = itemId
  matchedItemIds.value = allMatchedIds

  if (highlightClearTimer) {
    clearTimeout(highlightClearTimer)
  }
  highlightClearTimer = setTimeout(() => {
    highlightedItemId.value = null
    matchedItemIds.value = []
  }, 5500)

  void nextTick(() => {
    const el = document.getElementById(`route-item-${itemId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.focus({ preventScroll: true })
    }
  })
}

async function handleRouteScannerEnter() {
  const normalized = normalizeScannedBarcode(routeScanInput.value)
  if (!normalized) return

  const matches = routeItems.value.filter((item) =>
    matchesBarcodeOrSku(normalized, item.variant.sku, item.variant.variantBarcodes),
  )

  if (matches.length === 0) {
    banner.value = {
      kind: 'error',
      title: 'Nincs találat a szedőkörben',
      detail: `A beolvasott kód (${normalized}) nem szerepel az aktív kiszedési tételek között.`,
    }
    toast.add({
      severity: 'warn',
      summary: 'Ismeretlen tétel',
      detail: `Nem szerepel az aktív szedőkörben: ${normalized}`,
      life: 3000,
    })
    routeScanInput.value = ''
    focusScannerInput()
    return
  }

  const firstMatch = matches[0]!
  const matchIds = matches.map((m) => m.pickTaskItemId)

  // Gyors +1 csippantás: ha be van kapcsolva, pontosan 1 egyező routeItem van, és van suggestedLocationId-ja
  if (quickScanPlusOne.value && matches.length === 1 && firstMatch.suggestedLocationId) {
    routeScanInput.value = ''
    highlightAndScrollToRouteItem(firstMatch.pickTaskItemId, matchIds)
    await executePick(firstMatch, 1, {
      locationId: firstMatch.suggestedLocationId,
      label:
        firstMatch.suggestedLocationPath ||
        firstMatch.suggestedLocationName ||
        firstMatch.suggestedLocationId,
    })
    focusScannerInput()
    return
  }

  // Különben ugorjon az első egyező kártyára és emelje ki
  routeScanInput.value = ''
  highlightAndScrollToRouteItem(firstMatch.pickTaskItemId, matchIds)

  if (matches.length > 1) {
    toast.add({
      severity: 'info',
      summary: `${matches.length} feladatban szerepel`,
      detail: `${firstMatch.variant.sku} több nyitott feladatban is megtalálható – válaszd ki a megfelelő kártyát!`,
      life: 3500,
    })
  } else if (quickScanPlusOne.value && !firstMatch.suggestedLocationId) {
    toast.add({
      severity: 'warn',
      summary: 'Polc kiválasztása szükséges',
      detail: `${firstMatch.variant.sku}: nincs alapértelmezett polcjavaslat, válaszd ki a polcot a kártyán!`,
      life: 3500,
    })
  } else {
    toast.add({
      severity: 'info',
      summary: 'Tétel megtalálva',
      detail: `${getVariantProductName(firstMatch.variant)} (${firstMatch.variant.sku})`,
      life: 2000,
    })
  }
}

// 2. fül műveletek: Kiszedés (pick + offline queue)
async function handlePickRouteItem(item: MyRouteItem) {
  const qty = getItemPickQty(item)
  const shelf = getResolvedShelfForRouteItem(item)
  if (!shelf) {
    toast.add({
      severity: 'warn',
      summary: 'Hiányzó polc',
      detail: 'Válassz polcot vagy add meg a polc kódját a kiszedéshez!',
      life: 3000,
    })
    return
  }
  await executePick(item, qty, shelf)
}

async function executePick(
  item: MyRouteItem,
  quantity: number,
  shelf: { locationId?: string; locationName?: string; label: string },
) {
  if (pickingItemId.value) return

  const safeQty = Math.max(1, Math.min(item.remainingQuantity, Math.floor(quantity)))
  const payload: PickItemPayload = {
    pickTaskItemId: item.pickTaskItemId,
    variantId: item.variantId,
    quantity: safeQty,
    ...(shelf.locationId ? { locationId: shelf.locationId } : {}),
    ...(shelf.locationName ? { locationName: shelf.locationName } : {}),
  }

  const productLabel = `${getVariantProductName(item.variant)} (${item.variant.sku})`
  const detailLabel = `+${safeQty} db · ${shelf.label} · ${item.orderNumber}`

  const isCurrentlyOffline =
    !isOnline.value || (typeof navigator !== 'undefined' && !navigator.onLine)

  if (isCurrentlyOffline) {
    enqueuePick({
      pickTaskId: item.pickTaskId,
      taskNumber: item.taskNumber,
      payload,
      label: productLabel,
      detailLabel,
    })
    banner.value = {
      kind: 'offline',
      title: 'Offline – kiszedés sorba mentve',
      detail: `${productLabel} (${detailLabel}). Automatikusan szinkronizáljuk Wi-Fi visszatérésekor.`,
    }
    toast.add({
      severity: 'warn',
      summary: 'Offline sorba mentve',
      detail: `+${safeQty} db (${item.variant.sku}) – automatikusan beküldjük online állapotban.`,
      life: 3500,
    })
    return
  }

  pickingItemId.value = item.pickTaskItemId
  try {
    const res = await pickTasksApi.pick(item.pickTaskId, payload)
    const updatedTask = res.data
    const shelfName = updatedTask.lastMovement?.location?.name ?? shelf.label

    if (updatedTask.status === PickTaskStatus.AWAITING_DROP) {
      banner.value = {
        kind: 'success',
        title: `${updatedTask.taskNumber} minden tétele kiszedve!`,
        detail: `A(z) ${updatedTask.salesOrder.orderNumber} (${updatedTask.zone?.name ?? 'Zóna nélkül'}) feladat elkészült — vidd a lerakópolchoz a Lerakás fülön!`,
        actionTab: 'dropoff',
        actionLabel: 'Irány a Lerakás fül',
      }
      toast.add({
        severity: 'success',
        summary: 'Zónafeladat kész — Lerakásra vár!',
        detail: `${updatedTask.taskNumber} (${updatedTask.salesOrder.orderNumber}) → Lerakás fül`,
        life: 4000,
      })
    } else {
      banner.value = {
        kind: 'success',
        title: `Kiszedve (+${safeQty} db)`,
        detail: `${productLabel} · ${shelfName} → ${item.toteCode ? `Láda: ${item.toteCode}` : item.orderNumber}`,
      }
      toast.add({
        severity: 'success',
        summary: 'Kiszedés rögzítve',
        detail: `+${safeQty} db · ${item.variant.sku} (${shelfName})`,
        life: 2200,
      })
    }

    // Reset custom shelf input if used
    if (customShelfOpenByItem.value[item.pickTaskItemId]) {
      customShelfNameByItem.value = {
        ...customShelfNameByItem.value,
        [item.pickTaskItemId]: '',
      }
    }

    await fetchMyRoute({ silent: true })
  } catch (err: unknown) {
    if (isNetworkError(err) || !hasHttpResponse(err)) {
      enqueuePick({
        pickTaskId: item.pickTaskId,
        taskNumber: item.taskNumber,
        payload,
        label: productLabel,
        detailLabel,
      })
      banner.value = {
        kind: 'offline',
        title: 'Hálózati hiba – offline sorba mentve',
        detail: `${productLabel} (${detailLabel}). Automatikusan szinkronizáljuk, amint helyreáll a kapcsolat.`,
      }
      toast.add({
        severity: 'warn',
        summary: 'Hálózati hiba – helyi sorba mentve',
        detail: 'Automatikusan beküldjük, amint visszajön a Wi-Fi.',
        life: 3800,
      })
      return
    }

    const message = extractApiError(err, 'Sikertelen kiszedés – ellenőrizd a készletet!')
    banner.value = {
      kind: 'error',
      title: 'Kiszedési hiba',
      detail: message,
    }
    toast.add({
      severity: 'error',
      summary: 'Kiszedési hiba',
      detail: message,
      life: 4500,
    })
  } finally {
    pickingItemId.value = null
  }
}

// 2. fül műveletek: Utolsó kiszedés visszavonása (undoPick)
function canUndoMovement(movement: SalesOrderMovementDto): boolean {
  if (movement.type !== MovementType.SALE) return false
  if (movement.quantity >= 0 || movement.reversedMovementId) return false
  if (movement.reversedBy) return false

  const role = currentUserRole.value
  if (!role) return false
  if (STAFF_SELF_UNDO_ROLES.includes(role)) {
    return Boolean(currentUserId.value && movement.createdByUserId === currentUserId.value)
  }
  return true
}

async function handleUndoLastPick(pickTaskId: string, variantId?: string) {
  const key = variantId ? `${pickTaskId}:${variantId}` : pickTaskId
  if (undoingTaskKey.value) return

  const isCurrentlyOffline =
    !isOnline.value || (typeof navigator !== 'undefined' && !navigator.onLine)
  if (isCurrentlyOffline) {
    toast.add({
      severity: 'warn',
      summary: 'Offline állapot',
      detail: 'Kiszedés visszavonásához aktív hálózati kapcsolat szükséges.',
      life: 3500,
    })
    return
  }

  undoingTaskKey.value = key
  try {
    const detailRes = await pickTasksApi.getOne(pickTaskId)
    const movements = detailRes.data.stockMovements ?? []

    const eligible = movements
      .filter((m) => canUndoMovement(m) && (!variantId || m.variantId === variantId))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    const latest = eligible[0]
    if (!latest) {
      toast.add({
        severity: 'warn',
        summary: 'Nincs visszavonható mozgás',
        detail: 'Nem található saját, még nem sztornózott kiszedési mozgás ehhez a tételhez.',
        life: 3500,
      })
      return
    }

    await pickTasksApi.undoPick(pickTaskId, latest.id)
    const qtyRestored = Math.abs(latest.quantity)
    const shelfName = latest.location?.name ?? 'polc'

    banner.value = {
      kind: 'info',
      title: `Utolsó kiszedés visszavonva (-${qtyRestored} db)`,
      detail: `${latest.variant.sku} · ${qtyRestored} db visszakerült ide: ${shelfName}.`,
    }
    toast.add({
      severity: 'success',
      summary: 'Kiszedés visszavonva',
      detail: `${qtyRestored} db (${latest.variant.sku}) visszakerült: ${shelfName}`,
      life: 3000,
    })

    await fetchMyRoute({ silent: true })
  } catch (err: unknown) {
    toast.add({
      severity: 'error',
      summary: 'Visszavonási hiba',
      detail: extractApiError(err, 'Nem sikerült visszavonni az utolsó kiszedést.'),
      life: 4500,
    })
  } finally {
    undoingTaskKey.value = null
  }
}

// 2. fül műveletek: Polchiány jelentése (reportShortage)
const shortageShelfOptions = computed<DropoffShelfOption[]>(() => {
  const item = shortageTargetItem.value
  if (!item) return []
  return getDropoffOptionsForSite(item.sourceLocationId)
})

function openShortageDialog(item: MyRouteItem) {
  shortageTargetItem.value = item
  shortageLocationId.value =
    selectedShelfByItem.value[item.pickTaskItemId] ??
    item.suggestedLocationId ??
    item.availableShelves[0]?.locationId ??
    item.sourceLocationId
  shortageFoundQuantity.value = 0
  shortageReason.value = ''
  shortageDialogVisible.value = true
}

function closeShortageDialog() {
  shortageDialogVisible.value = false
  shortageTargetItem.value = null
  shortageLocationId.value = null
  shortageFoundQuantity.value = 0
  shortageReason.value = ''
}

function adjustShortageFoundQty(delta: number) {
  const current = Number.isFinite(shortageFoundQuantity.value)
    ? Math.floor(shortageFoundQuantity.value)
    : 0
  shortageFoundQuantity.value = Math.max(0, current + delta)
}

async function handleSubmitShortage() {
  const item = shortageTargetItem.value
  if (!item || submittingShortage.value) return

  if (!shortageLocationId.value) {
    toast.add({
      severity: 'warn',
      summary: 'Hiányzó polc',
      detail: 'Válaszd ki az érintett polcot a hiány bejelentéséhez!',
      life: 3000,
    })
    return
  }

  const isCurrentlyOffline =
    !isOnline.value || (typeof navigator !== 'undefined' && !navigator.onLine)
  if (isCurrentlyOffline) {
    toast.add({
      severity: 'warn',
      summary: 'Offline állapot',
      detail: 'A polchiány jelentéséhez aktív hálózati kapcsolat szükséges.',
      life: 3500,
    })
    return
  }

  const foundQty = Number.isFinite(shortageFoundQuantity.value)
    ? Math.max(0, Math.floor(shortageFoundQuantity.value))
    : 0

  submittingShortage.value = true
  try {
    await pickTasksApi.reportShortage(item.pickTaskId, {
      variantId: item.variantId,
      locationId: shortageLocationId.value,
      foundQuantity: foundQty,
      reason: shortageReason.value.trim() || undefined,
    })

    const orderNum = item.orderNumber
    const sku = item.variant.sku
    closeShortageDialog()

    banner.value = {
      kind: 'info',
      title: `Polchiány jelentve (${sku})`,
      detail: `A(z) ${orderNum} rendelés felfüggesztésre (ON_HOLD) került, a vezetőség értesítést kapott.`,
    }
    toast.add({
      severity: 'warn',
      summary: 'Polchiány rögzítve',
      detail: `${sku} (talált: ${foundQty} db) – ${orderNum} ON_HOLD státuszba került.`,
      life: 4500,
    })

    await Promise.all([fetchMyRoute({ silent: true }), fetchOpenTasks({ silent: true })])
  } catch (err: unknown) {
    toast.add({
      severity: 'error',
      summary: 'Bejelentési hiba',
      detail: extractApiError(err, 'Nem sikerült rögzíteni a polchiányt.'),
      life: 4500,
    })
  } finally {
    submittingShortage.value = false
  }
}

// 3. fül műveletek: Lerakópolc QR & Átadás pultnál (dropoff + offline queue)
function setTaskDropoffCode(taskId: string, value: string) {
  dropoffCodeByTask.value = {
    ...dropoffCodeByTask.value,
    [taskId]: value,
  }
  if (value.trim() && dropoffLocationIdByTask.value[taskId]) {
    dropoffLocationIdByTask.value = {
      ...dropoffLocationIdByTask.value,
      [taskId]: null,
    }
  }
}

function setTaskDropoffLocation(taskId: string, locationId: string | null) {
  dropoffLocationIdByTask.value = {
    ...dropoffLocationIdByTask.value,
    [taskId]: locationId,
  }
  if (locationId) {
    dropoffCodeByTask.value = {
      ...dropoffCodeByTask.value,
      [taskId]: '',
    }
  }
}

function canDropoffToShelf(taskId: string): boolean {
  const code = dropoffCodeByTask.value[taskId]?.trim() ?? ''
  const locId = dropoffLocationIdByTask.value[taskId] ?? null
  return Boolean(code || locId)
}

function checkReadyOrderResponse(task: PickTaskRouteTask, response: DropoffResponse) {
  if (response.salesOrder?.status === SalesOrderStatus.READY) {
    const orderNumber = response.salesOrder.orderNumber || task.salesOrder.orderNumber
    readyOrderBanner.value = {
      orderNumber,
      taskNumber: response.taskNumber || task.taskNumber,
    }
    toast.add({
      severity: 'success',
      summary: 'Rendelés KÉSZ (READY)!',
      detail: `A(z) ${orderNumber} rendelés minden zónája elkészült — KÉSZ (READY)!`,
      life: 6000,
    })
  }
}

async function handleDropoffTask(task: PickTaskRouteTask, handoverAtCounter: boolean) {
  if (droppingTaskId.value) return

  let payload: DropoffPickTaskPayload
  let targetLabel = ''

  if (handoverAtCounter) {
    payload = { handoverAtCounter: true }
    targetLabel = 'Átadás pultnál'
  } else {
    const selectedLocId = dropoffLocationIdByTask.value[task.id] ?? null
    const rawCode = dropoffCodeByTask.value[task.id] ?? ''
    const normalizedCode = normalizeScannedBarcode(rawCode)

    if (selectedLocId) {
      payload = { dropoffLocationId: selectedLocId }
      const locNode = locationsById.value.get(selectedLocId)
      targetLabel = locNode?.name ?? selectedLocId
    } else if (normalizedCode) {
      dropoffCodeByTask.value = {
        ...dropoffCodeByTask.value,
        [task.id]: normalizedCode,
      }
      payload = { dropoffCode: normalizedCode }
      targetLabel = normalizedCode
    } else {
      toast.add({
        severity: 'warn',
        summary: 'Hiányzó lerakópolc',
        detail: 'Csippantsd le a lerakópolc QR-kódját vagy válassz helyszínt a listából!',
        life: 3000,
      })
      return
    }
  }

  const label = `${task.taskNumber} · ${task.salesOrder.orderNumber}`
  const detailLabel = `${targetLabel}${task.zone?.name ? ` (${task.zone.name})` : ''}`

  const isCurrentlyOffline =
    !isOnline.value || (typeof navigator !== 'undefined' && !navigator.onLine)

  if (isCurrentlyOffline) {
    enqueueDropoff({
      pickTaskId: task.id,
      taskNumber: task.taskNumber,
      payload,
      label,
      detailLabel,
    })
    setTaskDropoffCode(task.id, '')
    setTaskDropoffLocation(task.id, null)
    banner.value = {
      kind: 'offline',
      title: 'Offline – lerakás sorba mentve',
      detail: `${label} → ${targetLabel}. Wi-Fi visszatérésekor automatikusan beküldjük.`,
    }
    toast.add({
      severity: 'warn',
      summary: 'Offline sorba mentve',
      detail: `${task.taskNumber} leadása (${targetLabel}) a helyi sorba került.`,
      life: 3500,
    })
    return
  }

  droppingTaskId.value = task.id
  try {
    const res = await pickTasksApi.dropoff(task.id, payload)
    setTaskDropoffCode(task.id, '')
    setTaskDropoffLocation(task.id, null)

    if (res.data.salesOrder?.status === SalesOrderStatus.READY) {
      checkReadyOrderResponse(task, res.data)
    } else {
      const confirmedSpot =
        res.data.dropoffLocation?.name || res.data.dropoffCode || targetLabel
      banner.value = {
        kind: 'success',
        title: `Lerakva: ${task.taskNumber}`,
        detail: `${task.salesOrder.orderNumber} (${task.zone?.name ?? 'Zóna nélkül'}) → ${confirmedSpot}.`,
      }
      toast.add({
        severity: 'success',
        summary: 'Lerakás rögzítve',
        detail: `${task.taskNumber} → ${confirmedSpot}`,
        life: 3000,
      })
    }

    await fetchMyRoute({ silent: true })
  } catch (err: unknown) {
    if (isNetworkError(err) || !hasHttpResponse(err)) {
      enqueueDropoff({
        pickTaskId: task.id,
        taskNumber: task.taskNumber,
        payload,
        label,
        detailLabel,
      })
      setTaskDropoffCode(task.id, '')
      setTaskDropoffLocation(task.id, null)
      banner.value = {
        kind: 'offline',
        title: 'Hálózati hiba – lerakás sorba mentve',
        detail: `${label} → ${targetLabel}. Automatikusan szinkronizáljuk online állapotban.`,
      }
      toast.add({
        severity: 'warn',
        summary: 'Hálózati hiba – helyi sorba mentve',
        detail: 'A lerakás automatikusan beküldésre kerül, amint visszajön a Wi-Fi.',
        life: 3800,
      })
      return
    }

    toast.add({
      severity: 'error',
      summary: 'Lerakási hiba',
      detail: extractApiError(err, 'Nem sikerült rögzíteni a lerakást.'),
      life: 4500,
    })
  } finally {
    droppingTaskId.value = null
  }
}

// Offline sor szinkronizálás kezelői
function handleSyncedItemCallback(item: QueuedPickingItem, response: PickResponse | DropoffResponse) {
  if (item.type === 'dropoff' && response.salesOrder?.status === SalesOrderStatus.READY) {
    readyOrderBanner.value = {
      orderNumber: response.salesOrder.orderNumber,
      taskNumber: response.taskNumber,
    }
    toast.add({
      severity: 'success',
      summary: 'Rendelés KÉSZ (READY)!',
      detail: `A(z) ${response.salesOrder.orderNumber} rendelés minden zónája elkészült — KÉSZ (READY)!`,
      life: 6000,
    })
  }
}

async function handleFlushQueue(options?: { silent?: boolean }) {
  if (!isOnline.value) {
    if (!options?.silent) {
      toast.add({
        severity: 'warn',
        summary: 'Offline állapot',
        detail: 'Szinkronizáláshoz várd meg, amíg visszatér a Wi-Fi kapcsolat!',
        life: 3000,
      })
    }
    return
  }

  isManualFlushing.value = true
  try {
    const result = await flushQueue(undefined, handleSyncedItemCallback)
    if (result.syncedCount > 0) {
      toast.add({
        severity: 'success',
        summary: 'Offline sor szinkronizálva',
        detail: `${result.syncedCount} várakozó művelet sikeresen beküldve.`,
        life: 3200,
      })
      await refreshAll({ silent: true })
    }
    if (result.failedCount > 0) {
      toast.add({
        severity: 'error',
        summary: 'Sikertelen szinkronizálás',
        detail: `${result.failedCount} művelet hibára futott – ellenőrizd az offline sor kártyát!`,
        life: 5000,
      })
    } else if (result.stoppedOffline && !options?.silent) {
      toast.add({
        severity: 'warn',
        summary: 'Hálózat megszakadt',
        detail: 'A fennmaradó tételek a helyi sorban maradtak.',
        life: 3200,
      })
    }
  } finally {
    isManualFlushing.value = false
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
  isManualFlushing.value = true
  try {
    const result = await retryItem(localId)
    if (result.syncedCount > 0) {
      toast.add({
        severity: 'success',
        summary: 'Sikeres újrapróbálás',
        detail: 'A sorban álló művelet sikeresen rögzítésre került.',
        life: 3000,
      })
      await refreshAll({ silent: true })
    } else if (result.failedCount > 0) {
      toast.add({
        severity: 'error',
        summary: 'Továbbra is sikertelen',
        detail: 'A szerver ismét elutasította a műveletet – lásd a hibaüzenetet.',
        life: 4500,
      })
    } else if (result.stoppedOffline) {
      toast.add({
        severity: 'warn',
        summary: 'Hálózat megszakadt',
        detail: 'A művelet visszakerült a függő sorba.',
        life: 3000,
      })
    }
  } finally {
    retryingLocalId.value = null
    isManualFlushing.value = false
  }
}

function handleDiscardQueueItem(localId: string) {
  removeItem(localId)
  toast.add({
    severity: 'info',
    summary: 'Művelet elvetve',
    detail: 'A sikertelen tétel eltávolítva a helyi sorból.',
    life: 2500,
  })
}

function handleClearAllFailed() {
  clearFailed()
  toast.add({
    severity: 'info',
    summary: 'Hibás sor ürítve',
    detail: 'Az összes sikertelen offline tétel elvetésre került.',
    life: 2500,
  })
}

function handleVisibilityChange() {
  if (
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    isOnline.value &&
    !shortageDialogVisible.value &&
    !editingToteTaskId.value &&
    !pickingItemId.value &&
    !droppingTaskId.value
  ) {
    void refreshAll({ silent: true })
  }
}

// Reaktív figyelők: online visszatérés + háttér-szinkron
watch(isOnline, (online, wasOnline) => {
  if (online && !wasOnline) {
    void fetchLocations()
    if (totalPendingCount.value > 0) {
      void handleFlushQueue({ silent: true })
    } else {
      void refreshAll({ silent: true })
    }
  }
})

watch(lastSyncEvent, (evt) => {
  if (!evt || isManualFlushing.value) return
  if (evt.syncedCount > 0) {
    toast.add({
      severity: 'success',
      summary: 'Automatikus szinkron kész',
      detail: `${evt.syncedCount} offline kiszedési művelet beküldve.`,
      life: 3200,
    })
    void refreshAll({ silent: true })
  }
  if (evt.failedCount > 0) {
    toast.add({
      severity: 'error',
      summary: 'Szinkronizálási hiba',
      detail: `${evt.failedCount} offline művelet sikertelen – ellenőrizd a sor kártyáját!`,
      life: 5000,
    })
  }
})

onMounted(async () => {
  ensureSiteSelection()
  syncRouteItemStates(routeData.value.routeItems)

  if (isOnline.value) {
    await fetchLocations()
    if (totalPendingCount.value > 0) {
      await handleFlushQueue({ silent: true })
    }
    await refreshAll({ silent: false })
  }

  // Kezdő fül intelligens kiválasztása: ha már van aktív szedőkör, oda ugrunk
  if (!hasUserSwitchedTab.value) {
    if (routeItems.value.length > 0 || inProgressTasks.value.length > 0) {
      activeTab.value = 'route'
      focusScannerInput()
    } else if (awaitingDropTasks.value.length > 0) {
      activeTab.value = 'dropoff'
    } else {
      activeTab.value = 'open'
    }
  }

  pollTimer = setInterval(() => {
    if (
      isOnline.value &&
      (typeof navigator === 'undefined' || navigator.onLine) &&
      typeof document !== 'undefined' &&
      document.visibilityState === 'visible' &&
      !shortageDialogVisible.value &&
      !editingToteTaskId.value &&
      !pickingItemId.value &&
      !droppingTaskId.value &&
      !claimingBatch.value
    ) {
      void refreshAll({ silent: true })
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
  if (highlightClearTimer) {
    clearTimeout(highlightClearTimer)
    highlightClearTimer = null
  }
  if (openAbortController) {
    openAbortController.abort()
  }
  if (routeAbortController) {
    routeAbortController.abort()
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
  }
})
</script>

<template>
  <div class="space-y-3.5 pb-10">
    <!-- 1. FELSŐ PDA FEJLÉC SÁV -->
    <div class="flex items-center justify-between gap-2">
      <button
        type="button"
        @click="router.push('/pda')"
        class="inline-flex items-center gap-1.5 min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-semibold shadow-2xs active:scale-[0.98] transition cursor-pointer"
      >
        <i class="pi pi-arrow-left text-xs"></i>
        <span>Vissza</span>
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
          :disabled="refreshing || loadingOpen || loadingRoute || !isOnline"
          @click="refreshAll({ silent: false })"
          title="Adatok frissítése"
          class="inline-flex items-center justify-center w-[42px] h-[42px] rounded-xl bg-white border border-slate-200 text-slate-700 shadow-2xs active:scale-[0.97] disabled:opacity-50 transition cursor-pointer"
        >
          <i
            :class="[
              'pi pi-refresh text-sm',
              refreshing || loadingOpen || loadingRoute ? 'pi-spin' : '',
            ]"
          ></i>
        </button>
      </div>
    </div>

    <!-- Cím + Telephely választó kártya -->
    <div class="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-2xs space-y-2.5">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <h1 class="text-lg font-extrabold text-slate-900 leading-tight">Zónás Kiszedés</h1>
          <p class="text-xs text-slate-500 mt-0.5">
            Feladattábla, egyesített járási sorrend és lerakópolc QR.
          </p>
        </div>
        <span
          v-if="lastRefreshedAt"
          class="text-[10px] font-semibold text-slate-400 shrink-0 pt-0.5"
        >
          {{ formatDateTime(lastRefreshedAt).slice(-5) }}
        </span>
      </div>

      <!-- Telephely választó -->
      <div v-if="assignedSites.length > 0">
        <div
          v-if="isSingleSite && assignedSites[0]"
          class="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-200/90 text-xs"
        >
          <span class="font-bold text-slate-800 flex items-center gap-1.5 truncate">
            <i :class="[LOCATION_TYPE_META[assignedSites[0].type].icon, 'text-blue-600 text-xs']"></i>
            <span class="truncate">{{ assignedSites[0].name }}</span>
          </span>
          <span class="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-[10px] font-bold text-slate-500 shrink-0">
            {{ LOCATION_TYPE_META[assignedSites[0].type].label }}
          </span>
        </div>

        <Select
          v-else
          :modelValue="selectedSiteId"
          :options="assignedSites"
          optionLabel="name"
          optionValue="id"
          showClear
          :loading="loadingLocations"
          placeholder="Összes hozzárendelt telephely"
          class="w-full"
          @update:modelValue="handleSiteChange"
        >
          <template #option="{ option }">
            <div class="flex items-center justify-between gap-2 w-full">
              <span class="text-xs font-bold text-slate-900 truncate">{{ option.name }}</span>
              <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
                {{ LOCATION_TYPE_META[option.type as LocationType].label }}
              </span>
            </div>
          </template>
        </Select>
      </div>
    </div>

    <!-- OFFLINE SOR / SZINKRON KÁRTYA -->
    <div
      v-if="totalPendingCount > 0 || totalFailedCount > 0"
      :class="[
        'rounded-2xl border-2 p-3.5 shadow-xs space-y-2.5',
        totalFailedCount > 0
          ? 'bg-rose-50 border-rose-400 text-rose-950'
          : 'bg-amber-50 border-amber-300 text-amber-950',
      ]"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-xs font-extrabold flex items-center gap-1.5">
            <i
              :class="[
                'pi text-sm',
                totalFailedCount > 0
                  ? 'pi-exclamation-triangle text-rose-600'
                  : 'pi-cloud-upload text-amber-600',
              ]"
            ></i>
            <span>
              <template v-if="totalFailedCount > 0">
                {{ totalFailedCount }} sikertelen offline szinkron!
              </template>
              <template v-else>
                {{ totalPendingCount }} offline művelet vár szinkronra
              </template>
            </span>
          </p>
          <p class="text-[11px] opacity-85 mt-0.5 leading-snug">
            <template v-if="totalFailedCount > 0 && totalPendingCount > 0">
              További {{ totalPendingCount }} művelet várakozik a helyi sorban.
            </template>
            <template v-else-if="totalFailedCount > 0">
              Ellenőrizd az elutasított műveleteket, majd próbáld újra vagy vesd el!
            </template>
            <template v-else>
              {{
                isOnline
                  ? 'A hálózat elérhető – elindíthatod a szinkronizálást.'
                  : 'Wi-Fi visszatérésekor automatikusan beküldjük.'
              }}
            </template>
          </p>
        </div>

        <button
          v-if="totalPendingCount > 0"
          type="button"
          :disabled="!isOnline || isFlushing"
          @click="handleFlushQueue({ silent: false })"
          class="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl bg-slate-900 text-white text-xs font-bold shrink-0 active:scale-[0.98] disabled:opacity-50 transition cursor-pointer"
        >
          <i :class="['pi text-xs', isFlushing ? 'pi-spin pi-spinner' : 'pi-sync']"></i>
          <span>Szinkronizálás most</span>
        </button>
      </div>

      <!-- Sikertelen (FAILED) elemek részletezve -->
      <div v-if="failedQueueItems.length > 0" class="space-y-2 pt-1">
        <div
          v-for="qItem in failedQueueItems"
          :key="qItem.localId"
          class="bg-white border border-rose-200 rounded-xl p-3 space-y-2"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <p class="text-xs font-extrabold text-slate-900 break-words">
                <span class="uppercase text-[10px] px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 mr-1">
                  {{ qItem.type === 'pick' ? 'Kiszedés' : 'Lerakás' }}
                </span>
                {{ qItem.label }}
              </p>
              <p v-if="qItem.detailLabel" class="text-[11px] text-slate-600 mt-0.5">
                {{ qItem.detailLabel }} · {{ formatDateTime(qItem.createdAt) }}
              </p>
            </div>
          </div>

          <div class="rounded-lg bg-rose-50 border border-rose-200 px-2.5 py-1.5 text-[11px] font-semibold text-rose-800">
            {{ qItem.lastError || 'A szerver elutasította a műveletet.' }}
          </div>

          <div class="grid grid-cols-2 gap-2">
            <button
              type="button"
              :disabled="!isOnline || isFlushing || retryingLocalId === qItem.localId"
              @click="handleRetryQueueItem(qItem.localId)"
              class="min-h-[40px] px-3 rounded-xl bg-rose-600 text-white text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50 transition cursor-pointer"
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
              @click="handleDiscardQueueItem(qItem.localId)"
              class="min-h-[40px] px-3 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50 transition cursor-pointer"
            >
              <i class="pi pi-trash text-xs"></i>
              <span>Elvetés</span>
            </button>
          </div>
        </div>

        <button
          v-if="failedQueueItems.length > 1"
          type="button"
          @click="handleClearAllFailed"
          class="w-full min-h-[36px] rounded-xl bg-white/80 border border-rose-200 text-rose-700 text-[11px] font-bold active:scale-[0.98] cursor-pointer"
        >
          Összes hibás tétel elvetése ({{ failedQueueItems.length }})
        </button>
      </div>

      <!-- Függő (PENDING / SENDING) elemek kompakt listája -->
      <div v-if="pendingQueueItems.length > 0" class="space-y-1.5">
        <div
          v-for="qItem in pendingQueueItems"
          :key="qItem.localId"
          class="bg-white/90 border border-amber-200 rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-xs"
        >
          <div class="min-w-0">
            <p class="font-bold text-slate-800 truncate">{{ qItem.label }}</p>
            <p class="text-[11px] text-slate-500 truncate">
              {{ qItem.detailLabel || qItem.taskNumber || 'Offline sorban' }}
            </p>
          </div>
          <span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 shrink-0">
            {{ qItem.status === 'SENDING' ? 'Küldés...' : 'Várakozik' }}
          </span>
        </div>
      </div>
    </div>

    <!-- KIEMELT READY ÉRTESÍTŐ BANNER (ha egy rendelés minden zónája elkészült!) -->
    <div
      v-if="readyOrderBanner"
      class="rounded-2xl bg-emerald-600 text-white p-4 shadow-md space-y-2"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-start gap-2.5 min-w-0">
          <div class="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <i class="pi pi-check-circle text-lg"></i>
          </div>
          <div class="min-w-0">
            <p class="text-xs font-bold uppercase tracking-wide text-emerald-100">
              Rendelés elkészült
            </p>
            <p class="text-sm font-extrabold leading-snug">
              A(z) {{ readyOrderBanner.orderNumber }} rendelés minden zónája elkészült — KÉSZ (READY)!
            </p>
          </div>
        </div>
        <button
          type="button"
          @click="readyOrderBanner = null"
          aria-label="Értesítés bezárása"
          class="w-7 h-7 rounded-lg bg-white/15 hover:bg-white/25 flex items-center justify-center shrink-0 cursor-pointer"
        >
          <i class="pi pi-times text-xs"></i>
        </button>
      </div>
    </div>

    <!-- AKCIÓ VISSZAJELZŐ BANNER -->
    <div
      v-if="banner"
      :class="[
        'rounded-2xl px-3.5 py-3 text-xs border shadow-2xs space-y-2',
        banner.kind === 'success'
          ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
          : banner.kind === 'offline'
            ? 'bg-amber-50 border-amber-300 text-amber-950'
            : banner.kind === 'error'
              ? 'bg-rose-50 border-rose-300 text-rose-950'
              : 'bg-sky-50 border-sky-200 text-sky-950',
      ]"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0 space-y-0.5">
          <p class="font-extrabold flex items-center gap-1.5">
            <i
              :class="[
                'pi text-xs',
                banner.kind === 'success'
                  ? 'pi-check-circle text-emerald-600'
                  : banner.kind === 'offline'
                    ? 'pi-clock text-amber-600'
                    : banner.kind === 'error'
                      ? 'pi-times-circle text-rose-600'
                      : 'pi-info-circle text-sky-600',
              ]"
            ></i>
            <span>{{ banner.title }}</span>
          </p>
          <p class="opacity-90 leading-snug">{{ banner.detail }}</p>
        </div>
        <button
          type="button"
          @click="banner = null"
          aria-label="Bezárás"
          class="w-6 h-6 rounded-full flex items-center justify-center opacity-60 hover:opacity-100 shrink-0 cursor-pointer"
        >
          <i class="pi pi-times text-[10px]"></i>
        </button>
      </div>

      <button
        v-if="banner.actionTab && banner.actionLabel"
        type="button"
        @click="switchTab(banner.actionTab)"
        class="w-full min-h-[42px] rounded-xl bg-emerald-600 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 active:scale-[0.98] transition cursor-pointer"
      >
        <span>{{ banner.actionLabel }}</span>
        <i class="pi pi-arrow-right text-xs"></i>
      </button>
    </div>

    <!-- 2. 3 SZEGMENTÁLT FÜL ÉLŐ DARABSZÁMMAL -->
    <div class="grid grid-cols-3 gap-1.5 p-1.5 rounded-2xl bg-slate-200/80 border border-slate-200">
      <button
        type="button"
        @click="switchTab('open')"
        :class="[
          'min-h-[48px] px-2 py-1.5 rounded-xl text-xs font-extrabold transition flex flex-col items-center justify-center gap-0.5 cursor-pointer',
          activeTab === 'open'
            ? 'bg-white text-slate-900 shadow-xs'
            : 'text-slate-600 hover:text-slate-900',
        ]"
      >
        <span class="truncate">OPEN tábla</span>
        <span
          :class="[
            'px-2 py-0.5 rounded-full text-[10px] font-extrabold leading-none',
            activeTab === 'open' ? 'bg-sky-100 text-sky-800' : 'bg-slate-300/70 text-slate-700',
          ]"
        >
          {{ openTasks.length }}
        </span>
      </button>

      <button
        type="button"
        @click="switchTab('route')"
        :class="[
          'min-h-[48px] px-2 py-1.5 rounded-xl text-xs font-extrabold transition flex flex-col items-center justify-center gap-0.5 cursor-pointer',
          activeTab === 'route'
            ? 'bg-white text-slate-900 shadow-xs'
            : 'text-slate-600 hover:text-slate-900',
        ]"
      >
        <span class="truncate">Szedőkör</span>
        <span
          :class="[
            'px-2 py-0.5 rounded-full text-[10px] font-extrabold leading-none',
            activeTab === 'route'
              ? 'bg-emerald-100 text-emerald-800'
              : routeItems.length > 0
                ? 'bg-emerald-500 text-white'
                : 'bg-slate-300/70 text-slate-700',
          ]"
        >
          {{ routeItems.length }}
        </span>
      </button>

      <button
        type="button"
        @click="switchTab('dropoff')"
        :class="[
          'min-h-[48px] px-2 py-1.5 rounded-xl text-xs font-extrabold transition flex flex-col items-center justify-center gap-0.5 cursor-pointer',
          activeTab === 'dropoff'
            ? 'bg-white text-slate-900 shadow-xs'
            : 'text-slate-600 hover:text-slate-900',
        ]"
      >
        <span class="truncate">Lerakás</span>
        <span
          :class="[
            'px-2 py-0.5 rounded-full text-[10px] font-extrabold leading-none',
            activeTab === 'dropoff'
              ? 'bg-violet-100 text-violet-800'
              : awaitingDropTasks.length > 0
                ? 'bg-violet-600 text-white animate-pulse'
                : 'bg-slate-300/70 text-slate-700',
          ]"
        >
          {{ awaitingDropTasks.length }}
        </span>
      </button>
    </div>

    <!-- ========================================================= -->
    <!-- 1. FÜL: FELADATTÁBLA (OPEN)                               -->
    <!-- ========================================================= -->
    <div v-if="activeTab === 'open'" class="space-y-3">
      <!-- Zóna szűrő chipek -->
      <div class="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        <button
          v-for="chip in zoneFilterChips"
          :key="chip.key"
          type="button"
          @click="selectedZoneKey = chip.key"
          :class="[
            'inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-full text-xs font-bold border whitespace-nowrap shrink-0 active:scale-[0.97] transition cursor-pointer',
            selectedZoneKey === chip.key
              ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300',
          ]"
        >
          <span>{{ chip.label }}</span>
          <span
            :class="[
              'px-1.5 py-0.5 rounded-full text-[10px] font-extrabold leading-none',
              selectedZoneKey === chip.key
                ? 'bg-white/20 text-white'
                : 'bg-slate-100 text-slate-600',
            ]"
          >
            {{ chip.count }}
          </span>
        </button>
      </div>

      <!-- Gyors kijelölés sáv -->
      <div
        v-if="filteredOpenTasks.length > 1"
        class="flex items-center justify-between gap-2 px-1 text-xs"
      >
        <span class="text-slate-500 font-medium">
          {{ filteredOpenTasks.length }} szabad feladat
        </span>
        <button
          type="button"
          @click="toggleSelectAllFilteredOpen"
          class="font-bold text-blue-700 hover:text-blue-900 cursor-pointer"
        >
          {{ areAllFilteredOpenSelected ? 'Szűrt kijelölés törlése' : 'Összes szűrt kijelölése' }}
        </button>
      </div>

      <!-- Betöltés -->
      <div
        v-if="loadingOpen && openTasks.length === 0"
        class="bg-white rounded-2xl border border-slate-200/80 p-8 text-center text-slate-500 space-y-2"
      >
        <i class="pi pi-spin pi-spinner text-2xl text-blue-500"></i>
        <p class="text-sm font-medium">Szabad kiszedési feladatok betöltése...</p>
      </div>

      <!-- Üres állapot -->
      <div
        v-else-if="filteredOpenTasks.length === 0"
        class="bg-white rounded-2xl border border-slate-200/80 p-8 text-center space-y-2"
      >
        <div class="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
          <i class="pi pi-inbox text-xl"></i>
        </div>
        <p class="text-sm font-bold text-slate-800">Nincs szabad (OPEN) kiszedési feladat</p>
        <p class="text-xs text-slate-500">
          {{
            selectedZoneKey !== 'ALL'
              ? 'Ebben a zónában jelenleg nincs várakozó feladat. Próbáld az „Összes” szűrőt.'
              : 'Jelenleg minden rendelés fel van véve vagy elkészült.'
          }}
        </p>
      </div>

      <!-- Pipálható nagy feladat kártyák -->
      <div v-else class="space-y-2.5">
        <button
          v-for="task in filteredOpenTasks"
          :key="task.id"
          type="button"
          @click="toggleOpenTaskSelection(task.id)"
          :class="[
            'w-full text-left rounded-2xl border-2 p-3.5 shadow-2xs active:scale-[0.985] transition cursor-pointer space-y-2.5',
            isTaskSelected(task.id)
              ? 'bg-emerald-50/70 border-emerald-500 ring-2 ring-emerald-200/70'
              : 'bg-white border-slate-200/90 hover:border-blue-300',
          ]"
        >
          <div class="flex items-start gap-3">
            <!-- Nagy kesztyűbarát pipa négyzet -->
            <div
              :class="[
                'w-7 h-7 rounded-lg border-2 flex items-center justify-center shrink-0 mt-0.5 transition',
                isTaskSelected(task.id)
                  ? 'bg-emerald-600 border-emerald-600 text-white'
                  : 'bg-slate-50 border-slate-300 text-transparent',
              ]"
            >
              <i class="pi pi-check text-xs font-bold"></i>
            </div>

            <div class="flex-1 min-w-0 space-y-1.5">
              <!-- Feladatszám + Zóna badge -->
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0">
                  <div class="flex items-center gap-1.5 flex-wrap">
                    <span class="text-sm font-extrabold text-slate-900 tracking-tight">
                      {{ task.taskNumber }}
                    </span>
                    <span
                      :class="[
                        'inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold',
                        SALES_CHANNEL_META[task.salesOrder.channel].badgeClass,
                      ]"
                    >
                      <i :class="[SALES_CHANNEL_META[task.salesOrder.channel].icon, 'text-[9px]']"></i>
                      {{ SALES_CHANNEL_META[task.salesOrder.channel].label }}
                    </span>
                  </div>
                  <p class="text-xs font-bold text-blue-700 mt-0.5 break-all">
                    {{ task.salesOrder.orderNumber }}
                    <span
                      v-if="task.salesOrder.externalOrderRef"
                      class="text-[11px] font-semibold text-slate-500"
                    >
                      ({{ task.salesOrder.externalOrderRef }})
                    </span>
                  </p>
                </div>

                <span
                  class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-indigo-50 text-indigo-800 border border-indigo-200 shrink-0"
                >
                  <i class="pi pi-th-large text-[10px]"></i>
                  {{ task.zone?.name || 'Zóna nélkül' }}
                </span>
              </div>

              <!-- Vevő + telephely + tétel/db összeg -->
              <div class="flex items-center justify-between gap-2 text-xs text-slate-600 pt-1 border-t border-slate-100">
                <span class="truncate font-medium text-slate-700 flex items-center gap-1.5 min-w-0">
                  <i class="pi pi-user text-slate-400 text-[11px] shrink-0"></i>
                  <span class="truncate">{{ task.salesOrder.customerName }}</span>
                </span>
                <span class="font-extrabold text-slate-900 shrink-0">
                  {{ task.items.length }} tétel · {{ getTaskRemainingQty(task) }} db
                </span>
              </div>

              <p
                v-if="!selectedSiteId && assignedSites.length > 1"
                class="text-[11px] text-slate-500 flex items-center gap-1 truncate"
              >
                <i class="pi pi-map-marker text-[10px] text-slate-400"></i>
                <span class="truncate">{{ task.sourceLocation.name }}</span>
              </p>
            </div>
          </div>
        </button>
      </div>

      <!-- Alul fix/kiemelt akciósáv (ha van legalább 1 kijelölt feladat) -->
      <div
        v-if="selectedOpenTaskIds.length > 0"
        class="sticky bottom-2 z-20 rounded-2xl bg-slate-900 text-white p-3.5 shadow-xl border border-slate-700 space-y-2.5"
      >
        <div class="flex items-center justify-between gap-2 text-xs">
          <span class="font-bold text-slate-200">
            Kijelölve: <strong class="text-white">{{ selectedOpenTasksSummary.count }} feladat</strong>
            ({{ selectedOpenTasksSummary.totalItems }} tétel · {{ selectedOpenTasksSummary.totalQty }} db)
          </span>
          <button
            type="button"
            @click="clearOpenSelection"
            class="text-[11px] font-bold text-slate-300 hover:text-white underline cursor-pointer shrink-0"
          >
            Törlés
          </button>
        </div>

        <!-- Kocsi / Láda kód (toteCode) input -->
        <div class="relative">
          <i class="pi pi-box absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
          <input
            v-model="claimToteInput"
            type="text"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="Kocsi / Láda kód (opcionális, QR + Enter)..."
            @keydown.enter.prevent="handleClaimBatch"
            class="w-full min-h-[46px] rounded-xl bg-slate-800 border border-slate-600 pl-9 pr-9 text-sm font-bold text-white placeholder-slate-400 outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-400/30 transition"
          />
          <button
            v-if="claimToteInput"
            type="button"
            @click="claimToteInput = ''"
            aria-label="Kocsi kód törlése"
            class="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
          >
            <i class="pi pi-times text-xs"></i>
          </button>
        </div>

        <button
          type="button"
          :disabled="claimingBatch || !isOnline"
          @click="handleClaimBatch"
          class="w-full min-h-[52px] rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.985] disabled:opacity-50 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 shadow-sm transition cursor-pointer"
        >
          <i :class="['pi text-base', claimingBatch ? 'pi-spin pi-spinner' : 'pi-play-circle']"></i>
          <span>
            {{
              claimingBatch
                ? 'Felvétel folyamatban...'
                : `Felvétel és szedőkör indítása (${selectedOpenTaskIds.length} db)`
            }}
          </span>
        </button>
      </div>
    </div>

    <!-- ========================================================= -->
    <!-- 2. FÜL: SZEDŐKÖR (MY ROUTE)                               -->
    <!-- ========================================================= -->
    <div v-else-if="activeTab === 'route'" class="space-y-3">
      <!-- Aktív feladatok (inProgressTasks) kompakt / összecsukható sáv -->
      <div
        v-if="inProgressTasks.length > 0"
        class="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden"
      >
        <button
          type="button"
          @click="activeTasksExpanded = !activeTasksExpanded"
          class="w-full min-h-[48px] px-3.5 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-slate-50 transition cursor-pointer"
        >
          <div class="min-w-0">
            <p class="text-xs font-extrabold text-slate-900 flex items-center gap-1.5">
              <i class="pi pi-list-check text-emerald-600 text-xs"></i>
              <span>Aktív feladataim ({{ inProgressTasks.length }} db)</span>
            </p>
            <p class="text-[11px] text-slate-500 truncate mt-0.5">
              {{ routeItems.length }} megálló · még {{ totalRemainingRouteQty }} db kiszedendő
            </p>
          </div>
          <span class="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 shrink-0">
            <span>{{ activeTasksExpanded ? 'Bezár' : 'Kezelés' }}</span>
            <i :class="['pi text-xs', activeTasksExpanded ? 'pi-chevron-up' : 'pi-chevron-down']"></i>
          </span>
        </button>

        <!-- Kompakt badge sor összecsukott állapotban -->
        <div
          v-if="!activeTasksExpanded"
          class="px-3.5 pb-3 flex items-center gap-1.5 flex-wrap"
        >
          <span
            v-for="task in inProgressTasks"
            :key="task.id"
            class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-slate-800 text-[11px] font-bold"
          >
            <span>{{ task.salesOrder.orderNumber }}</span>
            <span v-if="task.toteCode" class="px-1.5 py-0.2 rounded bg-amber-200 text-amber-950 text-[10px]">
              {{ task.toteCode }}
            </span>
          </span>
        </div>

        <!-- Kinyitott aktív feladat lista: toteCode szerkesztés + Visszaadás táblára -->
        <div
          v-else
          class="border-t border-slate-100 divide-y divide-slate-100"
        >
          <div
            v-for="task in inProgressTasks"
            :key="task.id"
            class="p-3.5 space-y-2.5 bg-slate-50/40"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="text-xs font-extrabold text-slate-900">
                  {{ task.taskNumber }} ·
                  <span class="text-blue-700">{{ task.salesOrder.orderNumber }}</span>
                </p>
                <p class="text-[11px] text-slate-500 mt-0.5 truncate">
                  {{ task.zone?.name || 'Zóna nélkül' }} · {{ task.salesOrder.customerName }}
                </p>
              </div>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-50 text-amber-800 border border-amber-200 shrink-0">
                {{ getTaskPickedQty(task) }} / {{ getTaskRequiredQty(task) }} db
              </span>
            </div>

            <!-- Láda / Kocsi kód szerkesztése -->
            <div v-if="editingToteTaskId === task.id" class="flex items-center gap-1.5">
              <input
                v-model="editingToteValue"
                type="text"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                placeholder="Kocsi / Láda kód..."
                @keydown.enter.prevent="saveTaskTote(task)"
                class="flex-1 min-w-0 min-h-[40px] rounded-xl bg-white border-2 border-blue-400 px-3 text-xs font-bold text-slate-900 outline-none"
              />
              <button
                type="button"
                :disabled="savingToteTaskId === task.id || !isOnline"
                @click="saveTaskTote(task)"
                class="min-h-[40px] px-3 rounded-xl bg-emerald-600 text-white text-xs font-bold shrink-0 cursor-pointer disabled:opacity-50"
              >
                <i :class="['pi text-xs', savingToteTaskId === task.id ? 'pi-spin pi-spinner' : 'pi-check']"></i>
              </button>
              <button
                type="button"
                @click="cancelEditTote"
                class="min-h-[40px] px-2.5 rounded-xl bg-white border border-slate-200 text-slate-600 text-xs font-bold shrink-0 cursor-pointer"
              >
                <i class="pi pi-times text-xs"></i>
              </button>
            </div>

            <div v-else class="flex items-center justify-between gap-2 flex-wrap">
              <button
                type="button"
                :disabled="!isOnline"
                @click="startEditTote(task)"
                class="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-bold active:scale-[0.98] disabled:opacity-50 cursor-pointer"
              >
                <i class="pi pi-box text-[11px]"></i>
                <span>{{ task.toteCode ? `Láda: ${task.toteCode}` : 'Láda kód hozzáadása' }}</span>
                <i class="pi pi-pencil text-[10px] opacity-75"></i>
              </button>

              <button
                v-if="getTaskPickedQty(task) === 0"
                type="button"
                :disabled="releasingTaskId === task.id || !isOnline"
                @click="handleReleaseTask(task)"
                class="inline-flex items-center gap-1.5 min-h-[36px] px-2.5 rounded-xl bg-white border border-rose-200 text-rose-700 text-xs font-bold active:scale-[0.98] disabled:opacity-50 cursor-pointer"
              >
                <i
                  :class="[
                    'pi text-[11px]',
                    releasingTaskId === task.id ? 'pi-spin pi-spinner' : 'pi-undo',
                  ]"
                ></i>
                <span>Visszaadás táblára</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Gyors Vonalkód / SKU szkenner bemenet + Gyors +1 csippantás kapcsoló -->
      <div
        v-if="routeItems.length > 0"
        class="bg-white rounded-2xl border border-slate-200/90 p-3.5 shadow-2xs space-y-2.5"
      >
        <div class="flex items-center justify-between gap-2">
          <label
            for="pda-picking-scanner"
            class="text-xs font-extrabold uppercase tracking-wide text-slate-700 flex items-center gap-1.5"
          >
            <i class="pi pi-barcode text-blue-600 text-sm"></i>
            <span>Vonalkód / SKU szkenner</span>
          </label>

          <button
            type="button"
            role="switch"
            :aria-checked="quickScanPlusOne"
            @click="toggleQuickScan"
            :class="[
              'inline-flex items-center gap-1.5 min-h-[36px] px-2.5 rounded-xl text-[11px] font-extrabold border transition active:scale-[0.97] cursor-pointer',
              quickScanPlusOne
                ? 'bg-emerald-600 text-white border-emerald-700 shadow-2xs'
                : 'bg-slate-100 text-slate-700 border-slate-200',
            ]"
          >
            <i :class="['pi text-[11px]', quickScanPlusOne ? 'pi-bolt' : 'pi-search']"></i>
            <span>Gyors +1 csippantás</span>
          </button>
        </div>

        <div class="relative">
          <i class="pi pi-barcode absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-base"></i>
          <input
            id="pda-picking-scanner"
            ref="scannerInputRef"
            v-model="routeScanInput"
            type="text"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            :placeholder="
              quickScanPlusOne
                ? 'Csippantsd le a vonalkódot (Enter = azonnali +1 db)...'
                : 'Csippantsd le a vonalkódot vagy írj SKU-t (ugrás)...'
            "
            @keydown.enter.prevent="handleRouteScannerEnter"
            class="w-full min-h-[48px] bg-slate-50 border-2 border-slate-200 rounded-xl pl-10 pr-10 text-sm font-bold text-slate-900 placeholder-slate-400 outline-none focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
          />
          <button
            v-if="routeScanInput"
            type="button"
            @click="
              () => {
                routeScanInput = ''
                focusScannerInput()
              }
            "
            aria-label="Szkenner mező törlése"
            class="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-200/70 cursor-pointer"
          >
            <i class="pi pi-times text-xs"></i>
          </button>
        </div>
      </div>

      <!-- Betöltés -->
      <div
        v-if="loadingRoute && routeItems.length === 0 && awaitingDropTasks.length === 0"
        class="bg-white rounded-2xl border border-slate-200/80 p-8 text-center text-slate-500 space-y-2"
      >
        <i class="pi pi-spin pi-spinner text-2xl text-emerald-500"></i>
        <p class="text-sm font-medium">Szedőkör betöltése...</p>
      </div>

      <!-- Minden kiszedve → irány a Lerakás fül! -->
      <div
        v-else-if="routeItems.length === 0 && awaitingDropTasks.length > 0"
        class="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-6 text-center space-y-3"
      >
        <div class="w-14 h-14 rounded-2xl bg-emerald-600 text-white flex items-center justify-center mx-auto shadow-sm">
          <i class="pi pi-check-circle text-2xl"></i>
        </div>
        <div class="space-y-1">
          <p class="text-base font-extrabold text-emerald-950">Minden tétel kiszedve!</p>
          <p class="text-xs text-emerald-800">
            {{ awaitingDropTasks.length }} elkészült zónafeladat vár lerakópolchoz rendelésre.
          </p>
        </div>
        <button
          type="button"
          @click="switchTab('dropoff')"
          class="w-full min-h-[50px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-sm active:scale-[0.985] transition cursor-pointer"
        >
          <span>Tovább a Lerakás fülre ({{ awaitingDropTasks.length }})</span>
          <i class="pi pi-arrow-right text-xs"></i>
        </button>
      </div>

      <!-- Üres szedőkör -->
      <div
        v-else-if="routeItems.length === 0"
        class="bg-white rounded-2xl border border-slate-200/80 p-8 text-center space-y-3"
      >
        <div class="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
          <i class="pi pi-shopping-bag text-xl"></i>
        </div>
        <div class="space-y-1">
          <p class="text-sm font-bold text-slate-800">Nincs aktív szedőköröd</p>
          <p class="text-xs text-slate-500">
            Vegyél fel egy vagy több feladatot az OPEN tábláról a kiszedés megkezdéséhez!
          </p>
        </div>
        <button
          type="button"
          @click="switchTab('open')"
          class="min-h-[44px] px-4 rounded-xl bg-slate-900 text-white text-xs font-extrabold cursor-pointer"
        >
          Ugrás az OPEN táblára ({{ openTasks.length }})
        </button>
      </div>

      <!-- JÁRÁSI ÚTVONAL LISTA (backend szerinti sorrend megtartva!) -->
      <div v-else class="space-y-3">
        <article
          v-for="(item, index) in routeItems"
          :id="`route-item-${item.pickTaskItemId}`"
          :key="item.pickTaskItemId"
          tabindex="-1"
          :class="[
            'bg-white rounded-2xl border-2 p-3.5 shadow-xs space-y-3 outline-none transition',
            highlightedItemId === item.pickTaskItemId
              ? 'border-blue-500 ring-4 ring-blue-200/70'
              : matchedItemIds.includes(item.pickTaskItemId)
                ? 'border-blue-300 ring-2 ring-blue-100'
                : 'border-slate-200/90',
          ]"
        >
          <!-- Felső polc-útvonal & zóna fejléc -->
          <div class="flex items-start justify-between gap-2 pb-2 border-b border-slate-100">
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="w-5 h-5 rounded-full bg-slate-900 text-white text-[10px] font-extrabold inline-flex items-center justify-center shrink-0">
                  {{ index + 1 }}
                </span>
                <p class="text-sm font-extrabold text-indigo-950 leading-tight break-words">
                  {{ item.suggestedLocationPath || item.suggestedLocationName || 'Nincs polcjavaslat' }}
                </p>
              </div>
            </div>
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-indigo-50 text-indigo-800 border border-indigo-200 shrink-0">
              <i class="pi pi-th-large text-[10px]"></i>
              {{ item.zoneName || 'Zóna nélkül' }}
            </span>
          </div>

          <!-- Rendelésszám + Kocsi/Láda jelvény (párhuzamos szedésnél kritikus!) -->
          <div class="flex items-center gap-1.5 flex-wrap">
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-900 border border-blue-200 text-xs font-extrabold">
              <i class="pi pi-file text-[10px]"></i>
              {{ item.orderNumber }}
              <span v-if="item.externalOrderRef" class="font-semibold text-blue-600">
                ({{ item.externalOrderRef }})
              </span>
            </span>

            <span
              :class="[
                'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-extrabold border',
                item.toteCode
                  ? 'bg-amber-100 text-amber-950 border-amber-300'
                  : 'bg-slate-100 text-slate-600 border-slate-200',
              ]"
            >
              <i class="pi pi-box text-[10px]"></i>
              {{ item.toteCode ? `Láda: ${item.toteCode}` : 'Nincs láda' }}
            </span>

            <span
              v-if="matchedItemIds.includes(item.pickTaskItemId)"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-extrabold"
            >
              <i class="pi pi-barcode text-[9px]"></i>
              Szkennelt
            </span>

            <span
              v-if="getOfflinePickQtyForItem(item) > 0"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-extrabold"
            >
              <i class="pi pi-clock text-[9px]"></i>
              Offline sorban: +{{ getOfflinePickQtyForItem(item) }} db
            </span>
          </div>

          <!-- Termék infó + miniatűr + hátralévő db -->
          <div class="flex items-start gap-3">
            <div class="w-16 h-16 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
              <img
                v-if="getVariantImageUrl(item.variant)"
                :src="getVariantImageUrl(item.variant)!"
                :alt="getVariantProductName(item.variant)"
                class="w-full h-full object-cover"
                @error="handleImageError(getVariantImageUrl(item.variant)!)"
              />
              <i v-else class="pi pi-box text-xl text-slate-400"></i>
            </div>

            <div class="flex-1 min-w-0 space-y-1">
              <p class="text-sm font-extrabold text-slate-900 leading-snug break-words">
                {{ getVariantProductName(item.variant) }}
              </p>
              <p class="text-xs font-semibold text-slate-600 break-all">
                SKU: <span class="font-extrabold text-slate-800">{{ item.variant.sku }}</span>
              </p>
              <p v-if="formatVariantAttributes(item.variant)" class="text-xs text-slate-500">
                {{ formatVariantAttributes(item.variant) }}
              </p>

              <!-- Haladás és hátralévő mennyiség -->
              <div class="flex items-center gap-2 flex-wrap pt-0.5">
                <span class="px-2.5 py-0.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-extrabold">
                  Még {{ item.remainingQuantity }} db
                </span>
                <span class="text-xs font-bold text-slate-500">
                  ({{ item.pickedQuantity }} / {{ item.requiredQuantity }} db)
                </span>
              </div>
            </div>
          </div>

          <!-- Polcválasztó (availableShelves + opcionális manuális polc kód) -->
          <div class="space-y-1.5 pt-1 border-t border-slate-100">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                Kiszedési polc
              </span>
              <button
                type="button"
                @click="toggleCustomShelfInput(item.pickTaskItemId)"
                class="text-[11px] font-bold text-blue-700 hover:text-blue-900 cursor-pointer"
              >
                {{
                  customShelfOpenByItem[item.pickTaskItemId]
                    ? 'Vissza a listához'
                    : 'Másik polc kódja'
                }}
              </button>
            </div>

            <!-- Kézi polckód bemenet -->
            <div v-if="customShelfOpenByItem[item.pickTaskItemId]" class="relative">
              <i class="pi pi-qrcode absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs"></i>
              <input
                :value="customShelfNameByItem[item.pickTaskItemId] ?? ''"
                type="text"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                placeholder="Polc neve / kódja (pl. A-02-01)..."
                @input="
                  customShelfNameByItem = {
                    ...customShelfNameByItem,
                    [item.pickTaskItemId]: ($event.target as HTMLInputElement).value,
                  }
                "
                class="w-full min-h-[42px] bg-slate-50 border-2 border-indigo-300 rounded-xl pl-8 pr-3 text-xs font-bold text-slate-900 outline-none focus:bg-white focus:border-indigo-500"
              />
            </div>

            <!-- Kesztyűbarát polc gombok (<= 3 elérhető polc) -->
            <div
              v-else-if="item.availableShelves.length > 0 && item.availableShelves.length <= 3"
              class="grid grid-cols-1 gap-1.5"
            >
              <button
                v-for="shelf in item.availableShelves"
                :key="shelf.locationId"
                type="button"
                @click="selectItemShelf(item, shelf.locationId)"
                :class="[
                  'w-full min-h-[42px] px-3 py-2 rounded-xl border text-left flex items-center justify-between gap-2 transition active:scale-[0.99] cursor-pointer',
                  selectedShelfByItem[item.pickTaskItemId] === shelf.locationId
                    ? 'bg-indigo-50 border-indigo-500 text-indigo-950 ring-1 ring-indigo-300'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-white',
                ]"
              >
                <div class="min-w-0">
                  <p class="text-xs font-extrabold truncate">
                    {{ shelf.locationPath || shelf.locationName }}
                  </p>
                  <p class="text-[10px] text-slate-500 flex items-center gap-1 flex-wrap">
                    <span v-if="shelf.locationId === item.suggestedLocationId" class="font-bold text-indigo-700">
                      Ajánlott
                    </span>
                    <span v-if="!shelf.isInTaskZone" class="font-bold text-amber-700">
                      Másik zóna ({{ shelf.zoneName || 'Zóna nélkül' }})
                    </span>
                    <span v-if="shelf.slotMode">{{ SLOT_MODE_META[shelf.slotMode].shortLabel }}</span>
                  </p>
                </div>
                <span class="px-2 py-0.5 rounded-lg bg-white border border-slate-200 text-xs font-extrabold text-slate-800 shrink-0">
                  {{ shelf.quantity }} db
                </span>
              </button>
            </div>

            <!-- PrimeVue Select (> 3 elérhető polc) -->
            <Select
              v-else-if="item.availableShelves.length > 3"
              :modelValue="selectedShelfByItem[item.pickTaskItemId] ?? null"
              :options="item.availableShelves"
              optionLabel="locationPath"
              optionValue="locationId"
              filter
              :filterFields="['locationName', 'locationPath', 'zoneName']"
              placeholder="Válassz kiszedési polcot..."
              class="w-full"
              @update:modelValue="(val: string | null) => selectItemShelf(item, val)"
            >
              <template #option="{ option }">
                <div class="flex items-center justify-between gap-2 w-full py-0.5">
                  <div class="min-w-0">
                    <p class="text-xs font-bold text-slate-900 truncate">
                      {{ option.locationPath || option.locationName }}
                    </p>
                    <p class="text-[10px] text-slate-500">
                      {{ option.zoneName || 'Zóna nélkül' }}
                      <template v-if="option.slotMode">
                        · {{ SLOT_MODE_META[option.slotMode as keyof typeof SLOT_MODE_META].shortLabel }}
                      </template>
                    </p>
                  </div>
                  <span class="px-2 py-0.5 rounded bg-slate-100 text-xs font-extrabold text-slate-800 shrink-0">
                    {{ option.quantity }} db
                  </span>
                </div>
              </template>
            </Select>

            <!-- Ha nincs elérhető polcon készlet -->
            <div
              v-else
              class="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 font-semibold"
            >
              Nincs nyilvántartott polckészlet – használj „Másik polc kódja” megadást vagy jelents polchiányt!
            </div>

            <p
              v-if="
                !customShelfOpenByItem[item.pickTaskItemId] &&
                getSelectedShelfOption(item) &&
                getSelectedShelfOption(item)!.quantity < getItemPickQty(item)
              "
              class="text-[11px] font-bold text-amber-700 flex items-center gap-1"
            >
              <i class="pi pi-exclamation-triangle text-[11px]"></i>
              <span>
                A kiválasztott polcon csak {{ getSelectedShelfOption(item)!.quantity }} db van nyilvántartva.
              </span>
            </p>
          </div>

          <!-- Darabszám léptető (-, input, +, Mind) -->
          <div class="grid grid-cols-4 gap-1.5">
            <button
              type="button"
              :disabled="getItemPickQty(item) <= 1 || pickingItemId === item.pickTaskItemId"
              @click="adjustItemPickQty(item, -1)"
              class="min-h-[46px] rounded-xl bg-slate-100 border border-slate-200 text-slate-800 text-base font-extrabold active:scale-[0.96] disabled:opacity-40 transition cursor-pointer"
            >
              −
            </button>
            <input
              :value="getItemPickQty(item)"
              type="number"
              min="1"
              :max="item.remainingQuantity"
              inputmode="numeric"
              @input="handleQtyInput(item, $event)"
              class="min-h-[46px] w-full text-center bg-white border-2 border-slate-200 rounded-xl text-base font-extrabold text-slate-900 outline-none focus:border-emerald-500"
            />
            <button
              type="button"
              :disabled="
                getItemPickQty(item) >= item.remainingQuantity ||
                pickingItemId === item.pickTaskItemId
              "
              @click="adjustItemPickQty(item, 1)"
              class="min-h-[46px] rounded-xl bg-slate-100 border border-slate-200 text-slate-800 text-base font-extrabold active:scale-[0.96] disabled:opacity-40 transition cursor-pointer"
            >
              +
            </button>
            <button
              type="button"
              :disabled="pickingItemId === item.pickTaskItemId"
              @click="setItemPickQty(item, item.remainingQuantity)"
              class="min-h-[46px] rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs font-extrabold active:scale-[0.96] transition cursor-pointer"
            >
              Mind ({{ item.remainingQuantity }})
            </button>
          </div>

          <!-- Nagy zöld „Kiszedve (+X db)” gomb -->
          <button
            type="button"
            :disabled="pickingItemId === item.pickTaskItemId || !getResolvedShelfForRouteItem(item)"
            @click="handlePickRouteItem(item)"
            class="w-full min-h-[52px] rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.985] disabled:bg-slate-300 disabled:text-slate-500 text-white font-extrabold text-base shadow-sm flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <i
              :class="[
                'pi text-base',
                pickingItemId === item.pickTaskItemId ? 'pi-spin pi-spinner' : 'pi-check-circle',
              ]"
            ></i>
            <span>
              {{
                pickingItemId === item.pickTaskItemId
                  ? 'Rögzítés...'
                  : `Kiszedve (+${getItemPickQty(item)} db)`
              }}
            </span>
          </button>

          <!-- Kiegészítő akciók: Polchiány + Utolsó visszavonása -->
          <div class="flex items-center gap-2">
            <button
              type="button"
              :disabled="!isOnline || pickingItemId === item.pickTaskItemId"
              @click="openShortageDialog(item)"
              class="flex-1 min-h-[40px] px-3 rounded-xl bg-orange-50 border border-orange-200 text-orange-800 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50 transition cursor-pointer"
            >
              <i class="pi pi-exclamation-triangle text-xs"></i>
              <span>Polchiány</span>
            </button>

            <button
              v-if="item.pickedQuantity > 0"
              type="button"
              :disabled="
                !isOnline ||
                undoingTaskKey === `${item.pickTaskId}:${item.variantId}` ||
                pickingItemId === item.pickTaskItemId
              "
              @click="handleUndoLastPick(item.pickTaskId, item.variantId)"
              class="flex-1 min-h-[40px] px-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-bold flex items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50 transition cursor-pointer"
            >
              <i
                :class="[
                  'pi text-xs',
                  undoingTaskKey === `${item.pickTaskId}:${item.variantId}`
                    ? 'pi-spin pi-spinner'
                    : 'pi-undo',
                ]"
              ></i>
              <span>Utolsó visszavonása</span>
            </button>
          </div>
        </article>
      </div>
    </div>

    <!-- ========================================================= -->
    <!-- 3. FÜL: LERAKÁS (AWAITING_DROP)                           -->
    <!-- ========================================================= -->
    <div v-else class="space-y-3">
      <!-- Betöltés -->
      <div
        v-if="loadingRoute && awaitingDropTasks.length === 0"
        class="bg-white rounded-2xl border border-slate-200/80 p-8 text-center text-slate-500 space-y-2"
      >
        <i class="pi pi-spin pi-spinner text-2xl text-violet-500"></i>
        <p class="text-sm font-medium">Lerakásra váró feladatok betöltése...</p>
      </div>

      <!-- Üres állapot -->
      <div
        v-else-if="awaitingDropTasks.length === 0"
        class="bg-white rounded-2xl border border-slate-200/80 p-8 text-center space-y-3"
      >
        <div class="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
          <i class="pi pi-map-marker text-xl"></i>
        </div>
        <div class="space-y-1">
          <p class="text-sm font-bold text-slate-800">Nincs lerakásra váró feladat</p>
          <p class="text-xs text-slate-500">
            Amint minden tételt kiszedtél egy zónafeladatból, itt jelenik meg a lerakópolc QR-hoz.
          </p>
        </div>
        <button
          v-if="routeItems.length > 0"
          type="button"
          @click="switchTab('route')"
          class="min-h-[44px] px-4 rounded-xl bg-emerald-600 text-white text-xs font-extrabold cursor-pointer"
        >
          Vissza a Szedőkörhöz ({{ routeItems.length }})
        </button>
      </div>

      <!-- Lerakásra váró kártyák -->
      <div v-else class="space-y-3">
        <div
          v-for="task in awaitingDropTasks"
          :key="task.id"
          class="bg-white rounded-2xl border-2 border-violet-200 p-4 shadow-xs space-y-3"
        >
          <!-- Fejléc: Feladatszám, rendelésszám, zóna, láda, db -->
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 space-y-0.5">
              <div class="flex items-center gap-1.5 flex-wrap">
                <span class="text-base font-extrabold text-slate-900">{{ task.taskNumber }}</span>
                <span
                  :class="[
                    'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold',
                    PICK_TASK_STATUS_META[task.status].badgeClass,
                  ]"
                >
                  <i :class="[PICK_TASK_STATUS_META[task.status].icon, 'text-[9px]']"></i>
                  {{ PICK_TASK_STATUS_META[task.status].label }}
                </span>
              </div>
              <p class="text-xs font-extrabold text-blue-700 break-all">
                {{ task.salesOrder.orderNumber }}
                <span
                  v-if="task.salesOrder.externalOrderRef"
                  class="font-semibold text-slate-500"
                >
                  ({{ task.salesOrder.externalOrderRef }})
                </span>
              </p>
              <p class="text-xs text-slate-500 truncate">{{ task.salesOrder.customerName }}</p>
            </div>

            <div class="text-right shrink-0 space-y-1">
              <span class="inline-block px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-extrabold">
                {{ getTaskPickedQty(task) }} db
              </span>
              <p class="text-[11px] font-bold text-indigo-700">
                {{ task.zone?.name || 'Zóna nélkül' }}
              </p>
            </div>
          </div>

          <!-- Láda kód + offline sor státusz -->
          <div class="flex items-center gap-1.5 flex-wrap">
            <span
              :class="[
                'inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-extrabold border',
                task.toteCode
                  ? 'bg-amber-100 text-amber-950 border-amber-300'
                  : 'bg-slate-100 text-slate-600 border-slate-200',
              ]"
            >
              <i class="pi pi-box text-[10px]"></i>
              {{ task.toteCode ? `Láda: ${task.toteCode}` : 'Nincs ládakód' }}
            </span>

            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold">
              <i class="pi pi-map-marker text-[10px] text-slate-400"></i>
              {{ task.sourceLocation.name }}
            </span>

            <span
              v-if="hasPendingDropoffForTask(task.id)"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-extrabold"
            >
              <i class="pi pi-clock text-[9px]"></i>
              Offline leadás sorban
            </span>
            <span
              v-if="getFailedCount(task.id) > 0"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 border border-rose-300 text-[10px] font-extrabold"
            >
              <i class="pi pi-exclamation-triangle text-[9px]"></i>
              {{ getFailedCount(task.id) }} hibás szinkron
            </span>
          </div>

          <!-- Lerakópolc QR / kód szkenner bemenet -->
          <div class="space-y-2 pt-2 border-t border-slate-100">
            <label
              :for="`dropoff-code-${task.id}`"
              class="text-xs font-extrabold uppercase tracking-wide text-slate-700 flex items-center gap-1.5"
            >
              <i class="pi pi-qrcode text-violet-600 text-sm"></i>
              <span>Lerakópolc QR / kód</span>
            </label>

            <div class="relative">
              <i class="pi pi-qrcode absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-base"></i>
              <input
                :id="`dropoff-code-${task.id}`"
                :value="dropoffCodeByTask[task.id] ?? ''"
                type="text"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                placeholder="Lerakópolc QR csippantása (Enter = rögzítés)..."
                @input="setTaskDropoffCode(task.id, ($event.target as HTMLInputElement).value)"
                @keydown.enter.prevent="handleDropoffTask(task, false)"
                class="w-full min-h-[48px] bg-slate-50 border-2 border-slate-200 rounded-xl pl-10 pr-10 text-sm font-bold text-slate-900 placeholder-slate-400 outline-none focus:bg-white focus:border-violet-500 focus:ring-2 focus:ring-violet-100 transition"
              />
              <button
                v-if="dropoffCodeByTask[task.id]"
                type="button"
                @click="setTaskDropoffCode(task.id, '')"
                aria-label="Lerakópolc kód törlése"
                class="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-200/70 cursor-pointer"
              >
                <i class="pi pi-times text-xs"></i>
              </button>
            </div>

            <!-- Opcionális telephelyi polcválasztó -->
            <Select
              v-if="getDropoffOptionsForSite(task.sourceLocationId).length > 0"
              :modelValue="dropoffLocationIdByTask[task.id] ?? null"
              :options="getDropoffOptionsForSite(task.sourceLocationId)"
              optionLabel="pathLabel"
              optionValue="id"
              filter
              :filterFields="['name', 'pathLabel', 'typeLabel', 'searchText']"
              showClear
              placeholder="Vagy válassz telephelyi lerakópolcot..."
              class="w-full"
              @update:modelValue="(val: string | null) => setTaskDropoffLocation(task.id, val)"
            >
              <template #option="{ option }">
                <div class="flex items-center justify-between gap-2 w-full py-0.5">
                  <div class="min-w-0">
                    <p class="text-xs font-bold text-slate-900 truncate">{{ option.name }}</p>
                    <p class="text-[11px] text-slate-500 truncate">{{ option.pathLabel }}</p>
                  </div>
                  <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold shrink-0">
                    {{ option.typeLabel }}
                  </span>
                </div>
              </template>
            </Select>
          </div>

          <!-- Akció gombok: Lerakópolchoz rendelés + Átadás pultnál -->
          <div class="space-y-2 pt-1">
            <button
              type="button"
              :disabled="droppingTaskId === task.id || !canDropoffToShelf(task.id)"
              @click="handleDropoffTask(task, false)"
              class="w-full min-h-[52px] rounded-xl bg-violet-600 hover:bg-violet-700 active:scale-[0.985] disabled:bg-slate-300 disabled:text-slate-500 text-white font-extrabold text-sm shadow-sm flex items-center justify-center gap-2 transition cursor-pointer"
            >
              <i
                :class="[
                  'pi text-base',
                  droppingTaskId === task.id ? 'pi-spin pi-spinner' : 'pi-map-marker',
                ]"
              ></i>
              <span>
                {{
                  droppingTaskId === task.id ? 'Lerakás rögzítése...' : 'Lerakópolchoz rendelés'
                }}
              </span>
            </button>

            <div class="grid grid-cols-1 gap-2">
              <button
                type="button"
                :disabled="droppingTaskId === task.id"
                @click="handleDropoffTask(task, true)"
                class="w-full min-h-[46px] rounded-xl bg-emerald-50 hover:bg-emerald-100 border-2 border-emerald-300 text-emerald-900 font-extrabold text-xs flex items-center justify-center gap-2 active:scale-[0.985] disabled:opacity-50 transition cursor-pointer"
              >
                <i class="pi pi-shop text-sm text-emerald-700"></i>
                <span>Átadás pultnál (kiadópult)</span>
              </button>

              <button
                v-if="getTaskPickedQty(task) > 0 && isOnline"
                type="button"
                :disabled="undoingTaskKey === task.id || droppingTaskId === task.id"
                @click="handleUndoLastPick(task.id)"
                class="w-full min-h-[38px] rounded-xl bg-white border border-slate-200 text-slate-600 text-[11px] font-bold flex items-center justify-center gap-1.5 active:scale-[0.985] disabled:opacity-50 cursor-pointer"
              >
                <i
                  :class="[
                    'pi text-[11px]',
                    undoingTaskKey === task.id ? 'pi-spin pi-spinner' : 'pi-undo',
                  ]"
                ></i>
                <span>Utolsó kiszedés visszavonása</span>
              </button>
            </div>
          </div>

          <!-- Offline pending count badge if any pick is still queued -->
          <p
            v-if="getPendingCount(task.id) > 0 && !hasPendingDropoffForTask(task.id)"
            class="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5"
          >
            {{ getPendingCount(task.id) }} függő offline művelet tartozik ehhez a feladathoz.
          </p>
        </div>
      </div>
    </div>

    <!-- POLCHIÁNY DIALÓGUS -->
    <Dialog
      v-model:visible="shortageDialogVisible"
      modal
      header="Polchiány jelentése"
      :style="{ width: '25rem', maxWidth: '94vw' }"
      @hide="closeShortageDialog"
    >
      <div v-if="shortageTargetItem" class="space-y-4">
        <!-- Érintett termék -->
        <div class="rounded-xl bg-slate-50 border border-slate-200 p-3 space-y-1">
          <p class="text-xs font-extrabold text-slate-900">
            {{ getVariantProductName(shortageTargetItem.variant) }}
          </p>
          <p class="text-[11px] text-slate-600">
            SKU: <span class="font-bold">{{ shortageTargetItem.variant.sku }}</span> ·
            {{ shortageTargetItem.orderNumber }} (még {{ shortageTargetItem.remainingQuantity }} db kell)
          </p>
        </div>

        <!-- Érintett polc -->
        <div class="space-y-1.5">
          <label class="text-xs font-extrabold text-slate-700 block">Érintett polc</label>
          <Select
            v-model="shortageLocationId"
            :options="shortageShelfOptions"
            optionLabel="pathLabel"
            optionValue="id"
            filter
            :filterFields="['name', 'pathLabel', 'searchText']"
            placeholder="Válassz polcot..."
            class="w-full"
          />
        </div>

        <!-- Polcon talált mennyiség -->
        <div class="space-y-1.5">
          <label for="shortage-found-qty" class="text-xs font-extrabold text-slate-700 block">
            Polcon talált mennyiség (db)
          </label>
          <div class="grid grid-cols-4 gap-1.5">
            <button
              type="button"
              @click="shortageFoundQuantity = 0"
              class="min-h-[44px] rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-extrabold cursor-pointer"
            >
              0 db
            </button>
            <button
              type="button"
              :disabled="shortageFoundQuantity <= 0"
              @click="adjustShortageFoundQty(-1)"
              class="min-h-[44px] rounded-xl bg-slate-100 border border-slate-200 text-slate-800 text-base font-extrabold disabled:opacity-40 cursor-pointer"
            >
              −
            </button>
            <input
              id="shortage-found-qty"
              v-model.number="shortageFoundQuantity"
              type="number"
              min="0"
              inputmode="numeric"
              class="min-h-[44px] w-full text-center bg-white border-2 border-slate-200 rounded-xl text-base font-extrabold text-slate-900 outline-none focus:border-orange-500"
            />
            <button
              type="button"
              @click="adjustShortageFoundQty(1)"
              class="min-h-[44px] rounded-xl bg-slate-100 border border-slate-200 text-slate-800 text-base font-extrabold cursor-pointer"
            >
              +
            </button>
          </div>
        </div>

        <!-- Indoklás + gyors chipek -->
        <div class="space-y-1.5">
          <label for="shortage-reason" class="text-xs font-extrabold text-slate-700 block">
            Megjegyzés / ok (opcionális)
          </label>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="preset in SHORTAGE_QUICK_REASONS"
              :key="preset"
              type="button"
              @click="shortageReason = preset"
              :class="[
                'px-2.5 py-1 rounded-full text-[11px] font-bold border transition cursor-pointer',
                shortageReason === preset
                  ? 'bg-orange-600 text-white border-orange-600'
                  : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100',
              ]"
            >
              {{ preset }}
            </button>
          </div>
          <textarea
            id="shortage-reason"
            v-model="shortageReason"
            rows="2"
            placeholder="Rövid leírás a hiányról..."
            class="w-full rounded-xl bg-slate-50 border border-slate-200 p-2.5 text-xs font-medium text-slate-900 outline-none focus:bg-white focus:border-orange-500"
          ></textarea>
        </div>

        <div class="rounded-xl bg-orange-50 border border-orange-200 px-3 py-2 text-[11px] text-orange-900 leading-snug">
          <strong>Figyelem:</strong> A hiány bejelentése készletjelentést küld a vezetőségnek, és a
          rendelést <strong>ON_HOLD</strong> (felfüggesztett) állapotba teszi.
        </div>

        <div class="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            :disabled="submittingShortage"
            @click="closeShortageDialog"
            class="min-h-[46px] rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-bold cursor-pointer"
          >
            Mégse
          </button>
          <button
            type="button"
            :disabled="submittingShortage || !shortageLocationId"
            @click="handleSubmitShortage"
            class="min-h-[46px] rounded-xl bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <i :class="['pi text-xs', submittingShortage ? 'pi-spin pi-spinner' : 'pi-send']"></i>
            <span>{{ submittingShortage ? 'Küldés...' : 'Hiány jelentése' }}</span>
          </button>
        </div>
      </div>
    </Dialog>
  </div>
</template>
