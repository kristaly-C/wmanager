<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import {
  LocationType,
  PickTaskStatus,
  Role,
  SalesOrderStatus,
  SlotMode,
} from '@wmanager/shared-types'
import { locationApi, type LocationItem } from '@/api/locations'
import {
  pickTasksApi,
  type DropoffPickTaskPayload,
  type PickTaskDetail,
  type PickTaskListItem,
} from '@/api/pickTasks'
import {
  salesOrdersApi,
  type SalesOrderListItem,
  type SalesOrderPickTaskSummary,
} from '@/api/salesOrders'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime } from '@/utils/formatters'
import { extractApiError, getLocationPath, LOCATION_TYPE_META } from '@/utils/locationMeta'
import {
  canCompleteSalesOrder,
  canOperatePickTasks,
  PICK_TASK_STATUS_META,
  PICK_TASK_STATUS_OPTIONS,
  SALES_CHANNEL_META,
} from '@/utils/salesOrderMeta'
import Column from 'primevue/column'
import DataTable, { type DataTablePageEvent } from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import { useToast } from 'primevue/usetoast'

const PAGE_SIZE = 10
const READY_PAGE_SIZE = 10

const authStore = useAuthStore()
const toast = useToast()

// Szerepkörök és jogosultságok
const userRole = computed(() => authStore.user?.role ?? null)
const currentUserId = computed(() => authStore.user?.userId ?? authStore.user?.id ?? '')

const canOperate = computed(() => canOperatePickTasks(userRole.value))
const canCompleteOrder = computed(() => canCompleteSalesOrder(userRole.value))

const isManager = computed(() => {
  const role = userRole.value
  return (
    role === Role.BOSS ||
    role === Role.ADMIN ||
    role === Role.WAREHOUSE_MANAGER ||
    role === Role.STORE_MANAGER
  )
})

// Törzsadatok: lokációk
const allLocations = ref<LocationItem[]>([])
const loadingLocations = ref(false)
const locationById = computed(() => new Map(allLocations.value.map((loc) => [loc.id, loc])))

const siteFilterOptions = computed(() =>
  allLocations.value
    .filter(
      (loc) =>
        loc.isActive &&
        loc.isAssigned !== false &&
        (loc.type === LocationType.WAREHOUSE || loc.type === LocationType.STORE),
    )
    .map((loc) => ({
      id: loc.id,
      label: `${loc.name} (${LOCATION_TYPE_META[loc.type].label})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'hu', { numeric: true })),
)

// 1. szekció: Zónás kiszedési feladattábla állapot
const pickTasks = ref<PickTaskListItem[]>([])
const totalPickTasks = ref(0)
const tasksLoading = ref(false)
const pickPage = ref(1)

const siteFilter = ref<string | null>(null)
const zoneFilter = ref<string | null>(null)
const statusFilter = ref<PickTaskStatus | null>(null)
const assignedToMeFilter = ref(false)
const searchInput = ref('')
const debouncedSearch = ref('')

const zoneFilterOptions = computed(() => {
  if (!siteFilter.value) return []
  const zones = allLocations.value
    .filter(
      (loc) =>
        loc.isActive &&
        loc.type === LocationType.ZONE &&
        loc.parentId === siteFilter.value,
    )
    .map((loc) => ({
      id: loc.id,
      label: loc.name,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'hu', { numeric: true }))

  return [...zones, { id: 'NONE', label: 'Általános (zóna nélkül)' }]
})

const hasActiveTaskFilters = computed(
  () =>
    siteFilter.value !== null ||
    zoneFilter.value !== null ||
    statusFilter.value !== null ||
    assignedToMeFilter.value ||
    debouncedSearch.value.length > 0,
)

// Tömeges felvétel (claimBatch) kijelölés
const selectedOpenTaskIds = ref<string[]>([])
const batchToteCode = ref('')
const batchClaimSubmitting = ref(false)
const rowActionTaskId = ref<string | null>(null)

// Részletek / Lerakás dialógus állapot
const isDetailDialogOpen = ref(false)
const selectedTaskDetail = ref<PickTaskDetail | null>(null)
const detailLoading = ref(false)
const detailToteInput = ref('')
const detailToteSaving = ref(false)

const dropoffHandoverAtCounter = ref(false)
const dropoffLocationId = ref<string | null>(null)
const dropoffCodeInput = ref('')
const dropoffNoteInput = ref('')
const dropoffSubmitting = ref(false)

// 2. szekció: READY rendelések állapot
const readyOrders = ref<SalesOrderListItem[]>([])
const readyTotal = ref(0)
const readyLoading = ref(false)
const readyPage = ref(1)

// Kiadás / Teljesítés megerősítő dialógus
const orderToComplete = ref<SalesOrderListItem | null>(null)
const completeNoteInput = ref('')
const completeSubmitting = ref(false)

// Időzítők és AbortControllerek
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null
let tasksAbortController: AbortController | null = null
let detailAbortController: AbortController | null = null
let readyOrdersAbortController: AbortController | null = null

function isCanceledError(err: unknown): boolean {
  const e = err as { code?: string; name?: string }
  return e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || e?.name === 'AbortError'
}

function isOrderPickable(status: SalesOrderStatus): boolean {
  return (
    status !== SalesOrderStatus.ON_HOLD &&
    status !== SalesOrderStatus.CANCELLED &&
    status !== SalesOrderStatus.COMPLETED
  )
}

function isTaskSelectableForClaim(task: PickTaskListItem): boolean {
  return (
    canOperate.value &&
    task.status === PickTaskStatus.OPEN &&
    isOrderPickable(task.salesOrder.status)
  )
}

function getTaskRequiredSum(task: PickTaskListItem): number {
  return task.items.reduce((sum, item) => sum + item.requiredQuantity, 0)
}

function getTaskPickedSum(task: PickTaskListItem): number {
  return task.items.reduce((sum, item) => sum + item.pickedQuantity, 0)
}

function getProgressPercent(picked: number, required: number): number {
  if (required <= 0) return picked > 0 ? 100 : 0
  return Math.min(100, Math.round((picked / required) * 100))
}

function canReleaseTask(task: PickTaskListItem): boolean {
  if (!canOperate.value) return false
  if (task.status !== PickTaskStatus.IN_PROGRESS) return false
  if (getTaskPickedSum(task) !== 0) return false
  return isManager.value || task.assignedToUserId === currentUserId.value
}

function canModifyTask(task: PickTaskDetail): boolean {
  if (!canOperate.value) return false
  if (isManager.value) return true
  return !task.assignedToUserId || task.assignedToUserId === currentUserId.value
}

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

const detailDropoffShelfOptions = computed(() => {
  const detail = selectedTaskDetail.value
  if (!detail) return []
  const rootId = detail.sourceLocationId
  return allLocations.value
    .filter(
      (loc) =>
        loc.isActive &&
        loc.isAssigned !== false &&
        loc.id !== rootId &&
        isLocationInSubtree(loc.id, rootId),
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
})

const selectableOpenTasksOnPage = computed(() =>
  pickTasks.value.filter((task) => isTaskSelectableForClaim(task)),
)

const isAllSelectableOnPageChecked = computed(() => {
  const selectable = selectableOpenTasksOnPage.value
  if (selectable.length === 0) return false
  const selectedSet = new Set(selectedOpenTaskIds.value)
  return selectable.every((task) => selectedSet.has(task.id))
})

function toggleSelectAllOpenOnPage() {
  const selectableIds = selectableOpenTasksOnPage.value.map((t) => t.id)
  if (selectableIds.length === 0) return
  if (isAllSelectableOnPageChecked.value) {
    const pageSet = new Set(selectableIds)
    selectedOpenTaskIds.value = selectedOpenTaskIds.value.filter((id) => !pageSet.has(id))
  } else {
    const merged = new Set([...selectedOpenTaskIds.value, ...selectableIds])
    selectedOpenTaskIds.value = Array.from(merged)
  }
}

function toggleTaskSelection(task: PickTaskListItem) {
  if (!isTaskSelectableForClaim(task)) return
  if (selectedOpenTaskIds.value.includes(task.id)) {
    selectedOpenTaskIds.value = selectedOpenTaskIds.value.filter((id) => id !== task.id)
  } else {
    selectedOpenTaskIds.value = [...selectedOpenTaskIds.value, task.id]
  }
}

function getOrderTotalOrderedQty(order: SalesOrderListItem): number {
  return order.items.reduce((sum, item) => sum + item.orderedQuantity, 0)
}

function getActiveOrderPickTasks(order: SalesOrderListItem): SalesOrderPickTaskSummary[] {
  return order.pickTasks.filter((t) => t.status !== PickTaskStatus.CANCELLED)
}

function getDropoffDisplay(task: {
  dropoffLocation?: LocationItem | null
  dropoffCode?: string | null
}): string {
  return task.dropoffLocation?.name || task.dropoffCode || '—'
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
      summary: 'Telephelyek betöltése sikertelen',
      detail: extractApiError(err, 'Nem sikerült betölteni a telephelyeket és zónákat.'),
      life: 4000,
    })
  } finally {
    loadingLocations.value = false
  }
}

async function loadPickTasks() {
  if (tasksAbortController) {
    tasksAbortController.abort()
  }
  const controller = new AbortController()
  tasksAbortController = controller
  tasksLoading.value = true

  try {
    const skip = (pickPage.value - 1) * PAGE_SIZE
    const res = await pickTasksApi.list(
      {
        sourceLocationId: siteFilter.value ?? undefined,
        zoneId: zoneFilter.value ?? undefined,
        status: statusFilter.value ?? undefined,
        assignedToMe: assignedToMeFilter.value || undefined,
        search: debouncedSearch.value || undefined,
        skip,
        take: PAGE_SIZE,
      },
      controller.signal,
    )
    pickTasks.value = res.data.items
    totalPickTasks.value = res.data.total

    // Csak a jelenleg is felvehető OPEN feladatokat tartsuk meg kijelölve
    const validIds = new Set(
      res.data.items.filter((t) => isTaskSelectableForClaim(t)).map((t) => t.id),
    )
    selectedOpenTaskIds.value = selectedOpenTaskIds.value.filter((id) => validIds.has(id))
  } catch (err) {
    if (isCanceledError(err)) return
    toast.add({
      severity: 'error',
      summary: 'Feladatok betöltése sikertelen',
      detail: extractApiError(err, 'Nem sikerült betölteni a zónás kiszedési feladatokat.'),
      life: 5000,
    })
  } finally {
    if (tasksAbortController === controller) {
      tasksLoading.value = false
    }
  }
}

async function loadReadyOrders() {
  if (readyOrdersAbortController) {
    readyOrdersAbortController.abort()
  }
  const controller = new AbortController()
  readyOrdersAbortController = controller
  readyLoading.value = true

  try {
    const skip = (readyPage.value - 1) * READY_PAGE_SIZE
    const res = await salesOrdersApi.list(
      {
        status: SalesOrderStatus.READY,
        sourceLocationId: siteFilter.value ?? undefined,
        skip,
        take: READY_PAGE_SIZE,
      },
      controller.signal,
    )
    readyOrders.value = res.data.items
    readyTotal.value = res.data.total
  } catch (err) {
    if (isCanceledError(err)) return
    toast.add({
      severity: 'error',
      summary: 'Kész rendelések betöltése sikertelen',
      detail: extractApiError(err, 'Nem sikerült betölteni a kiadásra kész rendeléseket.'),
      life: 5000,
    })
  } finally {
    if (readyOrdersAbortController === controller) {
      readyLoading.value = false
    }
  }
}

function resetDropoffForm(detail: PickTaskDetail) {
  detailToteInput.value = detail.toteCode ?? ''
  dropoffHandoverAtCounter.value = false
  dropoffLocationId.value = detail.dropoffLocationId ?? null
  dropoffCodeInput.value = detail.dropoffCode ?? ''
  dropoffNoteInput.value = ''
}

async function openTaskDetail(taskId: string) {
  if (detailAbortController) {
    detailAbortController.abort()
  }
  const controller = new AbortController()
  detailAbortController = controller

  isDetailDialogOpen.value = true
  selectedTaskDetail.value = null
  detailLoading.value = true

  try {
    const res = await pickTasksApi.getOne(taskId, controller.signal)
    selectedTaskDetail.value = res.data
    resetDropoffForm(res.data)
  } catch (err) {
    if (isCanceledError(err)) return
    isDetailDialogOpen.value = false
    toast.add({
      severity: 'error',
      summary: 'Részletek betöltése sikertelen',
      detail: extractApiError(err, 'Nem sikerült betölteni a kiszedési feladat részleteit.'),
      life: 5000,
    })
  } finally {
    if (detailAbortController === controller) {
      detailLoading.value = false
    }
  }
}

async function handleClaimSingle(task: PickTaskListItem) {
  if (!canOperate.value || rowActionTaskId.value) return
  rowActionTaskId.value = task.id
  try {
    const res = await pickTasksApi.claim(task.id)
    toast.add({
      severity: 'success',
      summary: 'Feladat felvéve',
      detail: `${res.data.taskNumber} sikeresen hozzárendelve.`,
      life: 3500,
    })
    if (selectedTaskDetail.value?.id === task.id) {
      selectedTaskDetail.value = res.data
      resetDropoffForm(res.data)
    }
    await loadPickTasks()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Felvételi hiba',
      detail: extractApiError(err, 'Nem sikerült felvenni a kiszedési feladatot.'),
      life: 5000,
    })
  } finally {
    rowActionTaskId.value = null
  }
}

async function handleClaimBatch() {
  if (!canOperate.value || selectedOpenTaskIds.value.length === 0 || batchClaimSubmitting.value) {
    return
  }
  batchClaimSubmitting.value = true
  try {
    const trimmedTote = batchToteCode.value.trim()
    const res = await pickTasksApi.claimBatch({
      pickTaskIds: selectedOpenTaskIds.value,
      toteCode: trimmedTote || undefined,
    })
    toast.add({
      severity: 'success',
      summary: 'Tömeges felvétel sikeres',
      detail: `${res.data.tasks.length} kiszedési feladat felvéve.`,
      life: 3500,
    })
    selectedOpenTaskIds.value = []
    batchToteCode.value = ''
    await loadPickTasks()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Tömeges felvételi hiba',
      detail: extractApiError(err, 'Nem sikerült felvenni a kijelölt feladatokat.'),
      life: 5000,
    })
  } finally {
    batchClaimSubmitting.value = false
  }
}

async function handleReleaseTask(taskId: string, taskNumber: string) {
  if (!canOperate.value || rowActionTaskId.value) return
  rowActionTaskId.value = taskId
  try {
    const res = await pickTasksApi.release(taskId)
    toast.add({
      severity: 'info',
      summary: 'Feladat visszaadva',
      detail: `${taskNumber} visszakerült szabad státuszba.`,
      life: 3500,
    })
    if (selectedTaskDetail.value?.id === taskId) {
      selectedTaskDetail.value = res.data
      resetDropoffForm(res.data)
    }
    await loadPickTasks()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Visszaadási hiba',
      detail: extractApiError(err, 'Nem sikerült visszaadni a kiszedési feladatot.'),
      life: 5000,
    })
  } finally {
    rowActionTaskId.value = null
  }
}

async function handleSaveDetailTote() {
  const detail = selectedTaskDetail.value
  if (!detail || detailToteSaving.value) return
  detailToteSaving.value = true
  try {
    const nextCode = detailToteInput.value.trim() || null
    const res = await pickTasksApi.updateTote(detail.id, nextCode)
    selectedTaskDetail.value = res.data
    detailToteInput.value = res.data.toteCode ?? ''
    toast.add({
      severity: 'success',
      summary: 'Kocsi / láda kód frissítve',
      detail: nextCode ? `Beállítva: ${nextCode}` : 'Kocsi kód törölve.',
      life: 3000,
    })
    await loadPickTasks()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Kocsi módosítási hiba',
      detail: extractApiError(err, 'Nem sikerült frissíteni a kocsi / láda kódot.'),
      life: 5000,
    })
  } finally {
    detailToteSaving.value = false
  }
}

async function handleDetailDropoff() {
  const detail = selectedTaskDetail.value
  if (!detail || dropoffSubmitting.value) return

  const trimmedCode = dropoffCodeInput.value.trim()
  const payload: DropoffPickTaskPayload = dropoffHandoverAtCounter.value
    ? {
        handoverAtCounter: true,
        note: dropoffNoteInput.value.trim() || undefined,
      }
    : {
        dropoffLocationId: dropoffLocationId.value ?? undefined,
        dropoffCode: trimmedCode || undefined,
        note: dropoffNoteInput.value.trim() || undefined,
      }

  if (!payload.handoverAtCounter && !payload.dropoffLocationId && !payload.dropoffCode) {
    toast.add({
      severity: 'warn',
      summary: 'Hiányzó leadási adat',
      detail: 'Válassz lerakópolcot, adj meg kódot, vagy jelöld be a pultnál átadást!',
      life: 4000,
    })
    return
  }

  dropoffSubmitting.value = true
  try {
    const res = await pickTasksApi.dropoff(detail.id, payload)
    selectedTaskDetail.value = res.data
    resetDropoffForm(res.data)
    toast.add({
      severity: 'success',
      summary: 'Lerakás rögzítve',
      detail: `${res.data.taskNumber} leadva (${getDropoffDisplay(res.data)}).`,
      life: 3500,
    })
    await Promise.all([loadPickTasks(), loadReadyOrders()])
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Lerakási hiba',
      detail: extractApiError(err, 'Nem sikerült rögzíteni a lerakást.'),
      life: 5000,
    })
  } finally {
    dropoffSubmitting.value = false
  }
}

function openCompleteConfirm(order: SalesOrderListItem) {
  orderToComplete.value = order
  completeNoteInput.value = ''
}

async function handleConfirmCompleteOrder() {
  const order = orderToComplete.value
  if (!order || !canCompleteOrder.value || completeSubmitting.value) return
  completeSubmitting.value = true
  try {
    const trimmedNote = completeNoteInput.value.trim()
    await salesOrdersApi.complete(order.id, trimmedNote ? { note: trimmedNote } : undefined)
    toast.add({
      severity: 'success',
      summary: 'Rendelés kiadva / teljesítve',
      detail: `${order.orderNumber} (${order.customerName}) sikeresen teljesítve.`,
      life: 4000,
    })
    orderToComplete.value = null
    completeNoteInput.value = ''
    await Promise.all([loadReadyOrders(), loadPickTasks()])
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Teljesítési hiba',
      detail: extractApiError(err, 'Nem sikerült teljesíteni a rendelést.'),
      life: 5000,
    })
  } finally {
    completeSubmitting.value = false
  }
}

// Szűrés és lapozás események
function onPickPage(event: DataTablePageEvent) {
  pickPage.value = event.page + 1
  void loadPickTasks()
}

function onReadyPage(event: DataTablePageEvent) {
  readyPage.value = event.page + 1
  void loadReadyOrders()
}

function triggerImmediateSearch() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  debouncedSearch.value = searchInput.value.trim()
  pickPage.value = 1
  void loadPickTasks()
}

function resetTaskFilters() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  siteFilter.value = null
  zoneFilter.value = null
  statusFilter.value = null
  assignedToMeFilter.value = false
  searchInput.value = ''
  debouncedSearch.value = ''
  pickPage.value = 1
  readyPage.value = 1
  void Promise.all([loadPickTasks(), loadReadyOrders()])
}

watch(searchInput, (val) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    const next = val.trim()
    if (next === debouncedSearch.value) return
    debouncedSearch.value = next
    pickPage.value = 1
    void loadPickTasks()
  }, 300)
})

watch(siteFilter, (newSite) => {
  if (!newSite) {
    zoneFilter.value = null
  } else if (zoneFilter.value && zoneFilter.value !== 'NONE') {
    const stillValid = allLocations.value.some(
      (loc) =>
        loc.id === zoneFilter.value &&
        loc.type === LocationType.ZONE &&
        loc.parentId === newSite,
    )
    if (!stillValid) {
      zoneFilter.value = null
    }
  }
  pickPage.value = 1
  readyPage.value = 1
  void Promise.all([loadPickTasks(), loadReadyOrders()])
})

watch([zoneFilter, statusFilter, assignedToMeFilter], () => {
  pickPage.value = 1
  void loadPickTasks()
})

onMounted(() => {
  void loadLocations()
  void Promise.all([loadPickTasks(), loadReadyOrders()])
})

onBeforeUnmount(() => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  if (tasksAbortController) tasksAbortController.abort()
  if (detailAbortController) detailAbortController.abort()
  if (readyOrdersAbortController) readyOrdersAbortController.abort()
})
</script>

<template>
  <div class="space-y-5 text-[#171918]">
    <!-- Felső címsor -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 class="text-[24px] font-semibold tracking-[-0.32px] text-[#171918] leading-tight">
          Kiszállítás &amp; Zónás Kiszedési Feladattábla
        </h2>
        <p class="text-[13px] text-[#686f6a] mt-1">
          Zónák szerinti kiszedési feladatok felvétele, PC lerakás és a csomagolásra kész rendelések
          kiadása.
        </p>
      </div>

      <div class="flex items-center gap-2.5">
        <RouterLink
          v-if="canOperate"
          to="/pda/picking"
          class="bg-[#f46714] hover:bg-[#dc580c] border border-white h-[40px] px-4 rounded-[12px] text-[13px] font-semibold text-white inline-flex items-center gap-2 shadow-xs transition no-underline"
        >
          <i class="pi pi-mobile text-xs"></i>
          <span>PDA Kiszedés megnyitása</span>
        </RouterLink>
      </div>
    </div>

    <!-- 1. SZEKCIÓ: ZÓNÁS KISZEDÉSI FELADATTÁBLA -->
    <section class="bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#e8eae6]">
        <div class="flex items-center gap-2.5">
          <span
            class="w-8 h-8 rounded-[10px] bg-white border border-[#e5e8e2] text-[#171918] inline-flex items-center justify-center"
          >
            <i class="pi pi-list-check text-xs"></i>
          </span>
          <div>
            <h3 class="text-base font-bold text-[#171918] leading-tight">
              Zónás Kiszedési Feladattábla
            </h3>
            <p class="text-[11px] text-[#686f6a]">
              Vegyél fel szabad feladatokat egyszerre vagy egyenként, majd rögzítsd a lerakást.
            </p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <span
            class="bg-[#e9ece7] text-[#171918] text-[11px] font-medium px-2.5 py-1 rounded-[7px]"
          >
            {{ totalPickTasks }} feladat
          </span>

          <button
            v-if="hasActiveTaskFilters"
            type="button"
            @click="resetTaskFilters"
            class="text-xs text-[#f46714] hover:underline font-medium cursor-pointer"
          >
            Szűrők törlése
          </button>

          <button
            type="button"
            @click="loadPickTasks()"
            class="text-xs text-[#686f6a] hover:text-[#171918] flex items-center gap-1.5 cursor-pointer transition"
          >
            <i :class="['pi pi-refresh text-xs', tasksLoading ? 'animate-spin' : '']"></i>
            <span>Frissítés</span>
          </button>
        </div>
      </div>

      <!-- Szűrősáv -->
      <div class="flex flex-wrap items-center gap-2.5">
        <div class="relative flex-1 min-w-[220px] max-w-sm">
          <i
            class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"
          ></i>
          <input
            v-model="searchInput"
            type="text"
            placeholder="Feladatszám, rendelés, vevő, kocsi, SKU..."
            @keydown.enter.prevent="triggerImmediateSearch"
            class="w-full h-[38px] bg-white border border-[#e5e8e2] rounded-[10px] pl-9 pr-3 text-[12px] text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]/50 transition"
          />
        </div>

        <Select
          v-model="siteFilter"
          :options="siteFilterOptions"
          optionLabel="label"
          optionValue="id"
          :loading="loadingLocations"
          placeholder="Minden telephely"
          filter
          showClear
          class="min-w-[200px] text-xs"
        />

        <Select
          v-model="zoneFilter"
          :options="zoneFilterOptions"
          optionLabel="label"
          optionValue="id"
          :disabled="!siteFilter"
          :placeholder="siteFilter ? 'Minden zóna' : 'Zóna (válassz telephelyet)'"
          showClear
          class="min-w-[190px] text-xs"
        />

        <Select
          v-model="statusFilter"
          :options="PICK_TASK_STATUS_OPTIONS"
          optionLabel="label"
          optionValue="value"
          placeholder="Összes státusz"
          showClear
          class="min-w-[175px] text-xs"
        />

        <button
          type="button"
          @click="assignedToMeFilter = !assignedToMeFilter"
          class="h-[38px] px-3.5 rounded-[10px] text-xs font-semibold inline-flex items-center gap-1.5 border transition cursor-pointer"
          :class="
            assignedToMeFilter
              ? 'bg-[#171918] text-white border-[#171918] shadow-xs'
              : 'bg-white text-[#4c534e] border-[#e5e8e2] hover:border-[#171918] hover:text-[#171918]'
          "
        >
          <i class="pi pi-user text-[11px]"></i>
          <span>Csak a saját feladataim</span>
        </button>
      </div>

      <!-- Tömeges felvétel sáv (ha van kijelölt OPEN feladat) -->
      <div
        v-if="canOperate && selectedOpenTaskIds.length > 0"
        class="flex flex-wrap items-center justify-between gap-3 rounded-[12px] bg-[#fff0e5] border border-[#f46714]/30 px-4 py-3"
      >
        <div class="flex items-center gap-2 text-xs font-semibold text-[#171918]">
          <span
            class="inline-flex items-center justify-center min-w-[24px] h-[24px] px-1.5 rounded-lg bg-[#f46714] text-white font-bold"
          >
            {{ selectedOpenTaskIds.length }}
          </span>
          <span>szabad kiszedési feladat kijelölve tömeges felvételhez</span>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <input
            v-model="batchToteCode"
            type="text"
            maxlength="80"
            placeholder="Kocsi / láda kód (opcionális)"
            class="h-[34px] w-[210px] rounded-[9px] bg-white border border-[#dce0d8] px-3 font-mono text-xs text-[#171918] outline-none focus:border-[#f46714]"
          />

          <button
            type="button"
            :disabled="batchClaimSubmitting"
            @click="handleClaimBatch"
            class="h-[34px] px-4 rounded-[9px] bg-[#171918] hover:bg-[#2a2d2b] text-xs font-semibold text-white inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
          >
            <i
              :class="batchClaimSubmitting ? 'pi pi-spin pi-spinner text-xs' : 'pi pi-check text-xs'"
            ></i>
            <span>Kiválasztottak felvétele</span>
          </button>

          <button
            type="button"
            @click="selectedOpenTaskIds = []"
            class="h-[34px] px-2.5 rounded-[9px] bg-white border border-[#dce0d8] hover:bg-slate-50 text-xs font-medium text-[#4c534e] transition cursor-pointer"
          >
            Kijelölés törlése
          </button>
        </div>
      </div>

      <!-- Szerveroldali Lazy DataTable -->
      <DataTable
        :value="pickTasks"
        :lazy="true"
        :paginator="true"
        :rows="PAGE_SIZE"
        :totalRecords="totalPickTasks"
        :first="(pickPage - 1) * PAGE_SIZE"
        :loading="tasksLoading"
        dataKey="id"
        responsiveLayout="scroll"
        class="text-[13px]"
        @page="onPickPage"
      >
        <template #empty>
          <div class="py-10 text-center text-sm text-[#686f6a]">
            Nincs a szűrésnek megfelelő kiszedési feladat.
          </div>
        </template>

        <Column v-if="canOperate" style="width: 44px">
          <template #header>
            <input
              type="checkbox"
              :checked="isAllSelectableOnPageChecked"
              :disabled="selectableOpenTasksOnPage.length === 0"
              aria-label="Összes szabad feladat kijelölése ezen az oldalon"
              class="w-4 h-4 accent-[#f46714] rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              @change="toggleSelectAllOpenOnPage"
            />
          </template>
          <template #body="{ data }: { data: PickTaskListItem }">
            <input
              v-if="data.status === PickTaskStatus.OPEN"
              type="checkbox"
              :checked="selectedOpenTaskIds.includes(data.id)"
              :disabled="!isTaskSelectableForClaim(data)"
              :title="
                isOrderPickable(data.salesOrder.status)
                  ? 'Kijelölés tömeges felvételhez'
                  : 'A rendelés jelenleg nem kiszedhető státuszban van'
              "
              class="w-4 h-4 accent-[#f46714] rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              @change="toggleTaskSelection(data)"
            />
          </template>
        </Column>

        <Column header="Feladatszám">
          <template #body="{ data }: { data: PickTaskListItem }">
            <div class="min-w-[130px]">
              <p class="font-mono text-xs font-bold text-[#171918]">
                {{ data.taskNumber }}
              </p>
              <p class="text-[10px] text-[#686f6a]">
                {{ formatDateTime(data.createdAt) }}
              </p>
            </div>
          </template>
        </Column>

        <Column header="Rendelés / Vevő">
          <template #body="{ data }: { data: PickTaskListItem }">
            <div class="min-w-[165px]">
              <div class="flex items-center gap-1.5">
                <RouterLink
                  :to="{ path: '/orders', query: { orderId: data.salesOrderId } }"
                  class="font-mono text-xs font-bold text-[#f46714] hover:underline"
                >
                  {{ data.salesOrder.orderNumber }}
                </RouterLink>
                <span
                  v-if="data.salesOrder.status === SalesOrderStatus.ON_HOLD"
                  class="px-1.5 py-0.5 rounded bg-orange-100 text-orange-800 text-[10px] font-bold"
                >
                  Felfüggesztve
                </span>
              </div>
              <p class="text-xs text-[#171918] font-medium truncate max-w-[200px]">
                {{ data.salesOrder.customerName }}
              </p>
            </div>
          </template>
        </Column>

        <Column header="Telephely / Zóna">
          <template #body="{ data }: { data: PickTaskListItem }">
            <div class="min-w-[140px] space-y-1">
              <p class="text-xs font-medium text-[#171918] whitespace-nowrap">
                {{ data.sourceLocation.name }}
              </p>
              <span
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold"
                :class="
                  data.zone
                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                "
              >
                <i class="pi pi-th-large text-[9px]"></i>
                <span>{{ data.zone?.name || 'Általános' }}</span>
              </span>
            </div>
          </template>
        </Column>

        <Column header="Tételek / Haladás">
          <template #body="{ data }: { data: PickTaskListItem }">
            <div class="min-w-[130px] space-y-1">
              <div class="flex items-center justify-between text-[11px]">
                <span class="font-semibold text-[#171918]">
                  {{ getTaskPickedSum(data) }} / {{ getTaskRequiredSum(data) }} db
                </span>
                <span class="text-[#686f6a]">{{ data.items.length }} tétel</span>
              </div>
              <div class="h-1.5 w-full rounded-full bg-[#e4e8e1] overflow-hidden">
                <div
                  class="h-full rounded-full transition-all"
                  :class="
                    getTaskPickedSum(data) >= getTaskRequiredSum(data) &&
                    getTaskRequiredSum(data) > 0
                      ? 'bg-emerald-500'
                      : 'bg-[#171918]'
                  "
                  :style="{
                    width: `${getProgressPercent(getTaskPickedSum(data), getTaskRequiredSum(data))}%`,
                  }"
                ></div>
              </div>
            </div>
          </template>
        </Column>

        <Column header="Felelős">
          <template #body="{ data }: { data: PickTaskListItem }">
            <span class="text-xs text-[#171918] whitespace-nowrap">
              {{ data.assignedToUser?.name ?? '—' }}
            </span>
          </template>
        </Column>

        <Column header="Kocsi">
          <template #body="{ data }: { data: PickTaskListItem }">
            <span
              v-if="data.toteCode"
              class="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 border border-slate-200 font-mono text-[11px] font-semibold text-[#171918]"
            >
              {{ data.toteCode }}
            </span>
            <span v-else class="text-xs text-[#686f6a]">—</span>
          </template>
        </Column>

        <Column header="Lerakópolc">
          <template #body="{ data }: { data: PickTaskListItem }">
            <span
              v-if="data.dropoffLocation?.name || data.dropoffCode"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-50 border border-indigo-200 text-[11px] font-semibold text-indigo-700 whitespace-nowrap"
            >
              <i class="pi pi-map-marker text-[9px]"></i>
              <span>{{ getDropoffDisplay(data) }}</span>
            </span>
            <span v-else class="text-xs text-[#686f6a]">—</span>
          </template>
        </Column>

        <Column header="Státusz">
          <template #body="{ data }: { data: PickTaskListItem }">
            <span
              :class="[
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap',
                PICK_TASK_STATUS_META[data.status].badgeClass,
              ]"
            >
              <i :class="[PICK_TASK_STATUS_META[data.status].icon, 'text-[10px]']"></i>
              <span>{{ PICK_TASK_STATUS_META[data.status].label }}</span>
            </span>
          </template>
        </Column>

        <Column header="Műveletek" style="width: 1%">
          <template #body="{ data }: { data: PickTaskListItem }">
            <div class="flex items-center justify-end gap-1.5 whitespace-nowrap">
              <button
                v-if="canOperate && data.status === PickTaskStatus.OPEN"
                type="button"
                :disabled="!isOrderPickable(data.salesOrder.status) || rowActionTaskId === data.id"
                @click="handleClaimSingle(data)"
                class="h-[30px] px-2.5 rounded-[8px] bg-[#171918] hover:bg-[#2a2d2b] text-[11px] font-semibold text-white inline-flex items-center gap-1 transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <i
                  :class="
                    rowActionTaskId === data.id
                      ? 'pi pi-spin pi-spinner text-[10px]'
                      : 'pi pi-hand-point-up text-[10px]'
                  "
                ></i>
                <span>Felvétel</span>
              </button>

              <button
                v-if="canReleaseTask(data)"
                type="button"
                :disabled="rowActionTaskId === data.id"
                @click="handleReleaseTask(data.id, data.taskNumber)"
                class="h-[30px] px-2.5 rounded-[8px] bg-white border border-amber-300 hover:bg-amber-50 text-[11px] font-semibold text-amber-800 inline-flex items-center gap-1 transition cursor-pointer disabled:opacity-40"
              >
                <i class="pi pi-undo text-[10px]"></i>
                <span>Visszaadás</span>
              </button>

              <button
                type="button"
                @click="openTaskDetail(data.id)"
                class="h-[30px] px-2.5 rounded-[8px] text-[11px] font-semibold inline-flex items-center gap-1 transition cursor-pointer"
                :class="
                  data.status === PickTaskStatus.AWAITING_DROP && canOperate
                    ? 'bg-[#f46714] hover:bg-[#dc580c] text-white'
                    : 'bg-white border border-[#dce0d8] hover:border-[#171918] text-[#171918]'
                "
              >
                <i
                  :class="
                    data.status === PickTaskStatus.AWAITING_DROP && canOperate
                      ? 'pi pi-map-marker text-[10px]'
                      : 'pi pi-eye text-[10px]'
                  "
                ></i>
                <span>
                  {{
                    data.status === PickTaskStatus.AWAITING_DROP && canOperate
                      ? 'Lerakás'
                      : 'Részletek'
                  }}
                </span>
              </button>
            </div>
          </template>
        </Column>
      </DataTable>
    </section>

    <!-- 2. SZEKCIÓ: CSOMAGOLÁSRA ÉS KIADÁSRA KÉSZ (READY) RENDELÉSEK -->
    <section class="bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#e8eae6]">
        <div class="flex items-center gap-2.5">
          <span
            class="w-8 h-8 rounded-[10px] bg-indigo-50 border border-indigo-200 text-indigo-700 inline-flex items-center justify-center"
          >
            <i class="pi pi-box text-xs"></i>
          </span>
          <div>
            <div class="flex items-center gap-2">
              <h3 class="text-base font-bold text-[#171918] leading-tight">
                Csomagolásra és Kiadásra kész rendelések
              </h3>
              <span
                class="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200"
              >
                READY
              </span>
            </div>
            <p class="text-[11px] text-[#686f6a]">
              Minden zónából leadott rendelések összeszedési polcai és végső kiadása.
            </p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <span
            class="bg-[#e9ece7] text-[#171918] text-[11px] font-medium px-2.5 py-1 rounded-[7px]"
          >
            {{ readyTotal }} kész rendelés
          </span>

          <button
            type="button"
            @click="loadReadyOrders()"
            class="text-xs text-[#686f6a] hover:text-[#171918] flex items-center gap-1.5 cursor-pointer transition"
          >
            <i :class="['pi pi-refresh text-xs', readyLoading ? 'animate-spin' : '']"></i>
            <span>Frissítés</span>
          </button>
        </div>
      </div>

      <DataTable
        :value="readyOrders"
        :lazy="true"
        :paginator="true"
        :rows="READY_PAGE_SIZE"
        :totalRecords="readyTotal"
        :first="(readyPage - 1) * READY_PAGE_SIZE"
        :loading="readyLoading"
        dataKey="id"
        responsiveLayout="scroll"
        class="text-[13px]"
        @page="onReadyPage"
      >
        <template #empty>
          <div class="py-10 text-center text-sm text-[#686f6a]">
            Jelenleg nincs csomagolásra vagy kiadásra váró READY rendelés.
          </div>
        </template>

        <Column header="Rendelés">
          <template #body="{ data }: { data: SalesOrderListItem }">
            <div class="min-w-[155px] space-y-1">
              <div class="flex items-center gap-1.5">
                <RouterLink
                  :to="{ path: '/orders', query: { orderId: data.id } }"
                  class="font-mono text-xs font-bold text-[#f46714] hover:underline"
                >
                  {{ data.orderNumber }}
                </RouterLink>
                <span
                  :class="[
                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold',
                    SALES_CHANNEL_META[data.channel].badgeClass,
                  ]"
                >
                  <i :class="[SALES_CHANNEL_META[data.channel].icon, 'text-[9px]']"></i>
                  <span>{{ SALES_CHANNEL_META[data.channel].label }}</span>
                </span>
              </div>
              <p v-if="data.externalOrderRef" class="text-[11px] font-mono text-[#686f6a]">
                Ref: {{ data.externalOrderRef }}
              </p>
              <p class="text-[10px] text-[#686f6a]">
                {{ formatDateTime(data.createdAt) }}
              </p>
            </div>
          </template>
        </Column>

        <Column header="Vevő">
          <template #body="{ data }: { data: SalesOrderListItem }">
            <div class="min-w-[160px]">
              <p class="text-xs font-semibold text-[#171918]">
                {{ data.customerName }}
              </p>
              <p v-if="data.customerPhone" class="text-[11px] text-[#686f6a]">
                {{ data.customerPhone }}
              </p>
              <p
                v-if="data.shippingAddress"
                class="text-[11px] text-[#686f6a] truncate max-w-[220px]"
                :title="data.shippingAddress"
              >
                {{ data.shippingAddress }}
              </p>
            </div>
          </template>
        </Column>

        <Column header="Telephely / Tételek">
          <template #body="{ data }: { data: SalesOrderListItem }">
            <div class="min-w-[130px]">
              <p class="text-xs font-medium text-[#171918]">
                {{ data.sourceLocation.name }}
              </p>
              <p class="text-[11px] text-[#686f6a]">
                {{ data.items.length }} tétel · {{ getOrderTotalOrderedQty(data) }} db
              </p>
            </div>
          </template>
        </Column>

        <Column header="Zónák &amp; Lerakópolc kódok">
          <template #body="{ data }: { data: SalesOrderListItem }">
            <div class="flex flex-wrap gap-1.5 min-w-[240px]">
              <div
                v-for="task in getActiveOrderPickTasks(data)"
                :key="task.id"
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-indigo-200 text-[11px]"
              >
                <span class="font-semibold text-[#4c534e]">
                  {{ task.zone?.name || 'Általános' }}:
                </span>
                <span class="inline-flex items-center gap-1 font-bold text-indigo-700 font-mono">
                  <i class="pi pi-map-marker text-[9px]"></i>
                  {{ getDropoffDisplay(task) }}
                </span>
                <span v-if="task.toteCode" class="text-[10px] font-mono text-[#686f6a]">
                  ({{ task.toteCode }})
                </span>
              </div>
              <span
                v-if="getActiveOrderPickTasks(data).length === 0"
                class="text-xs text-[#686f6a]"
              >
                —
              </span>
            </div>
          </template>
        </Column>

        <Column header="Műveletek" style="width: 1%">
          <template #body="{ data }: { data: SalesOrderListItem }">
            <div class="flex items-center justify-end gap-2 whitespace-nowrap">
              <RouterLink
                :to="{ path: '/orders', query: { orderId: data.id } }"
                class="h-[32px] px-3 rounded-[9px] bg-white border border-[#dce0d8] hover:border-[#171918] text-xs font-semibold text-[#171918] inline-flex items-center gap-1.5 transition no-underline"
              >
                <i class="pi pi-external-link text-[10px]"></i>
                <span>Rendelés</span>
              </RouterLink>

              <button
                v-if="canCompleteOrder"
                type="button"
                @click="openCompleteConfirm(data)"
                class="h-[32px] px-3.5 rounded-[9px] bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                <i class="pi pi-check-circle text-xs"></i>
                <span>Kiadás / Teljesítés</span>
              </button>
            </div>
          </template>
        </Column>
      </DataTable>
    </section>

    <!-- RÉSZLETEK / LERAKÁS DIALÓGUS -->
    <Dialog
      v-model:visible="isDetailDialogOpen"
      modal
      :header="
        selectedTaskDetail
          ? `Kiszedési feladat — ${selectedTaskDetail.taskNumber}`
          : 'Kiszedési feladat részletei'
      "
      :style="{ width: 'min(94vw, 840px)' }"
    >
      <div v-if="detailLoading" class="py-12 text-center text-sm text-[#686f6a]">
        <i class="pi pi-spin pi-spinner mr-2"></i>
        Feladat részleteinek betöltése...
      </div>

      <div v-else-if="selectedTaskDetail" class="space-y-5 text-[#171918]">
        <!-- Fejléc metaadatok -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="rounded-[12px] bg-[#f8f9f7] border border-[#e8eae6] p-3 space-y-1">
            <p class="text-[11px] font-medium text-[#686f6a]">Rendelés &amp; Vevő</p>
            <RouterLink
              :to="{ path: '/orders', query: { orderId: selectedTaskDetail.salesOrderId } }"
              class="font-mono text-sm font-bold text-[#f46714] hover:underline inline-block"
            >
              {{ selectedTaskDetail.salesOrder.orderNumber }}
            </RouterLink>
            <p class="text-xs text-[#171918] font-medium">
              {{ selectedTaskDetail.salesOrder.customerName }}
            </p>
          </div>

          <div class="rounded-[12px] bg-[#f8f9f7] border border-[#e8eae6] p-3 space-y-1">
            <p class="text-[11px] font-medium text-[#686f6a]">Telephely &amp; Zóna</p>
            <p class="text-sm font-bold text-[#171918]">
              {{ selectedTaskDetail.sourceLocation.name }}
            </p>
            <p class="text-xs text-[#4c534e]">
              Zóna:
              <span class="font-semibold">{{ selectedTaskDetail.zone?.name || 'Általános' }}</span>
            </p>
          </div>

          <div class="rounded-[12px] bg-[#f8f9f7] border border-[#e8eae6] p-3 space-y-1">
            <p class="text-[11px] font-medium text-[#686f6a]">Státusz &amp; Felelős</p>
            <div>
              <span
                :class="[
                  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold',
                  PICK_TASK_STATUS_META[selectedTaskDetail.status].badgeClass,
                ]"
              >
                <i
                  :class="[PICK_TASK_STATUS_META[selectedTaskDetail.status].icon, 'text-[10px]']"
                ></i>
                <span>{{ PICK_TASK_STATUS_META[selectedTaskDetail.status].label }}</span>
              </span>
            </div>
            <p class="text-xs text-[#4c534e]">
              Felelős:
              <span class="font-semibold text-[#171918]">
                {{ selectedTaskDetail.assignedToUser?.name ?? 'Nincs kijelölve' }}
              </span>
            </p>
          </div>
        </div>

        <!-- Kocsi / láda kód szerkesztése (IN_PROGRESS) -->
        <div
          v-if="
            selectedTaskDetail.status === PickTaskStatus.IN_PROGRESS &&
            canModifyTask(selectedTaskDetail)
          "
          class="rounded-[12px] bg-white border border-[#dce0d8] p-4 space-y-2.5"
        >
          <div class="flex items-center justify-between">
            <h4 class="text-xs font-bold uppercase tracking-wide text-[#4c534e]">
              Kocsi / Láda azonosító módosítása
            </h4>
            <span v-if="selectedTaskDetail.toteCode" class="text-[11px] font-mono text-[#686f6a]">
              Jelenlegi: {{ selectedTaskDetail.toteCode }}
            </span>
          </div>

          <form class="flex flex-wrap items-center gap-2" @submit.prevent="handleSaveDetailTote">
            <input
              v-model="detailToteInput"
              type="text"
              maxlength="80"
              placeholder="Pl. KOCSI-02 vagy LADA-A1..."
              class="flex-1 min-w-[200px] h-[36px] rounded-[9px] bg-[#f8f9f7] border border-[#dce0d8] px-3 font-mono text-xs text-[#171918] outline-none focus:bg-white focus:border-[#f46714]"
            />
            <button
              type="submit"
              :disabled="detailToteSaving"
              class="h-[36px] px-4 rounded-[9px] bg-[#171918] hover:bg-[#2a2d2b] text-xs font-semibold text-white inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
            >
              <i
                :class="detailToteSaving ? 'pi pi-spin pi-spinner text-xs' : 'pi pi-save text-xs'"
              ></i>
              <span>Kocsi mentése</span>
            </button>
          </form>
        </div>

        <!-- PC-ről rögzíthető lerakás (AWAITING_DROP) -->
        <div
          v-if="
            selectedTaskDetail.status === PickTaskStatus.AWAITING_DROP &&
            canModifyTask(selectedTaskDetail)
          "
          class="rounded-[12px] bg-violet-50/70 border border-violet-200 p-4 space-y-3"
        >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 class="text-sm font-bold text-violet-950">
                Lerakás rögzítése PC-ről (Awaiting Drop)
              </h4>
              <p class="text-[11px] text-violet-800">
                Válaszd ki a csomagoló / átadó polcot, adj meg lerakókódot, vagy jelöld be a
                pultnál történő átadást.
              </p>
            </div>
          </div>

          <form class="space-y-3" @submit.prevent="handleDetailDropoff">
            <label class="inline-flex items-center gap-2 text-xs font-semibold text-[#171918] cursor-pointer">
              <input
                v-model="dropoffHandoverAtCounter"
                type="checkbox"
                class="w-4 h-4 accent-[#f46714] rounded cursor-pointer"
              />
              <span>Pultnál történő azonnali átadás (PULT / AZONNALI ÁTADÁS)</span>
            </label>

            <div
              v-if="!dropoffHandoverAtCounter"
              class="grid grid-cols-1 md:grid-cols-2 gap-3"
            >
              <div class="space-y-1">
                <label class="block text-[11px] font-semibold text-[#4c534e]">
                  Lerakópolc kiválasztása
                </label>
                <Select
                  v-model="dropoffLocationId"
                  :options="detailDropoffShelfOptions"
                  optionLabel="label"
                  optionValue="id"
                  placeholder="Válassz polcot / rekeszt..."
                  filter
                  showClear
                  class="w-full text-xs"
                />
              </div>

              <div class="space-y-1">
                <label for="pc-dropoff-code" class="block text-[11px] font-semibold text-[#4c534e]">
                  Vagy lerakópolc / zóna kód
                </label>
                <input
                  id="pc-dropoff-code"
                  v-model="dropoffCodeInput"
                  type="text"
                  maxlength="120"
                  placeholder="Pl. CSOMAGOLO-1 vagy polckód..."
                  class="w-full h-[38px] rounded-[10px] bg-white border border-[#dce0d8] px-3 font-mono text-xs text-[#171918] outline-none focus:border-[#f46714]"
                />
              </div>
            </div>

            <div class="flex flex-wrap items-center justify-between gap-2">
              <input
                v-model="dropoffNoteInput"
                type="text"
                maxlength="500"
                placeholder="Opcionális megjegyzés a lerakáshoz..."
                class="flex-1 min-w-[200px] h-[36px] rounded-[9px] bg-white border border-[#dce0d8] px-3 text-xs text-[#171918] outline-none focus:border-[#f46714]"
              />

              <button
                type="submit"
                :disabled="dropoffSubmitting"
                class="h-[36px] px-4 rounded-[9px] bg-[#f46714] hover:bg-[#dc580c] text-xs font-semibold text-white inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              >
                <i
                  :class="
                    dropoffSubmitting ? 'pi pi-spin pi-spinner text-xs' : 'pi pi-map-marker text-xs'
                  "
                ></i>
                <span>Lerakás rögzítése</span>
              </button>
            </div>
          </form>
        </div>

        <!-- Rögzített lerakási infó COMPLETED esetén -->
        <div
          v-else-if="selectedTaskDetail.status === PickTaskStatus.COMPLETED"
          class="rounded-[12px] bg-emerald-50 border border-emerald-200 px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
        >
          <div class="flex items-center gap-2 text-emerald-900">
            <i class="pi pi-check-circle text-emerald-600"></i>
            <span>
              Leadva:
              <strong class="font-mono">{{ getDropoffDisplay(selectedTaskDetail) }}</strong>
            </span>
          </div>
          <span class="text-emerald-800">
            {{ formatDateTime(selectedTaskDetail.droppedAt ?? selectedTaskDetail.completedAt) }}
          </span>
        </div>

        <!-- Zóna tételei -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-bold text-[#171918]">Zóna kiszedési tételei</h4>
            <span class="text-[11px] text-[#686f6a]">
              {{ selectedTaskDetail.items.length }} tétel
            </span>
          </div>

          <div class="bg-white border border-[#e8eae6] rounded-[12px] overflow-x-auto">
            <table class="w-full text-left border-collapse text-xs">
              <thead class="bg-[#eff1ed] text-[#686f6a]">
                <tr>
                  <th class="px-3.5 py-2.5 font-semibold">SKU &amp; Termék</th>
                  <th class="px-3 py-2.5 font-semibold">Ajánlott polc útvonal</th>
                  <th class="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                    Kiszedett / Szükséges
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-[#e8eae6]">
                <tr v-for="item in selectedTaskDetail.items" :key="item.id">
                  <td class="px-3.5 py-2.5">
                    <p class="font-mono font-bold text-[#171918]">
                      {{ item.variant.sku }}
                    </p>
                    <p class="text-[11px] text-[#4c534e]">
                      {{ item.variant.product?.name ?? 'Ismeretlen termék' }}
                      <template v-if="item.variant.size"> · {{ item.variant.size }}</template>
                    </p>
                  </td>
                  <td class="px-3 py-2.5">
                    <p class="font-medium text-[#171918]">
                      {{ item.suggestedLocationPath || item.suggestedLocation?.name || '—' }}
                    </p>
                    <p
                      v-if="item.availableShelves && item.availableShelves.length > 0"
                      class="text-[10px] text-[#686f6a] mt-0.5"
                    >
                      Elérhető polcok:
                      {{
                        item.availableShelves
                          .slice(0, 3)
                          .map((s) => `${s.locationName} (${s.quantity} db)`)
                          .join(', ')
                      }}
                    </p>
                  </td>
                  <td class="px-3 py-2.5 text-right whitespace-nowrap">
                    <span
                      class="inline-flex items-center px-2 py-0.5 rounded-md font-mono font-bold"
                      :class="
                        item.pickedQuantity >= item.requiredQuantity
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      "
                    >
                      {{ item.pickedQuantity }} / {{ item.requiredQuantity }} db
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex flex-wrap items-center justify-between w-full gap-2">
          <RouterLink
            v-if="selectedTaskDetail"
            :to="{ path: '/orders', query: { orderId: selectedTaskDetail.salesOrderId } }"
            class="text-xs font-semibold text-[#f46714] hover:underline inline-flex items-center gap-1"
          >
            <i class="pi pi-external-link text-[10px]"></i>
            <span>Rendelés megnyitása</span>
          </RouterLink>
          <span v-else></span>

          <button
            type="button"
            @click="isDetailDialogOpen = false"
            class="h-[34px] px-4 rounded-[9px] bg-[#171918] text-xs font-semibold text-white cursor-pointer"
          >
            Bezárás
          </button>
        </div>
      </template>
    </Dialog>

    <!-- KIADÁS / TELJESÍTÉS MEGERŐSÍTŐ DIALÓGUS -->
    <Dialog
      :visible="orderToComplete !== null"
      modal
      header="Rendelés kiadása és teljesítése"
      :style="{ width: 'min(92vw, 480px)' }"
      @update:visible="(val: boolean) => { if (!val) orderToComplete = null }"
    >
      <div v-if="orderToComplete" class="space-y-4 text-xs text-[#171918]">
        <p class="text-sm text-[#4c534e]">
          Biztosan kiadottnak / teljesítettnek jelölöd a(z)
          <strong class="font-mono text-[#171918]">{{ orderToComplete.orderNumber }}</strong>
          számú rendelést (<strong>{{ orderToComplete.customerName }}</strong
          >)?
        </p>

        <div
          v-if="getActiveOrderPickTasks(orderToComplete).length > 0"
          class="rounded-[10px] bg-[#f8f9f7] border border-[#e8eae6] p-3 space-y-1.5"
        >
          <p class="text-[11px] font-semibold text-[#686f6a]">Összeszedendő lerakópolcok:</p>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="task in getActiveOrderPickTasks(orderToComplete)"
              :key="task.id"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white border border-indigo-200 text-[11px] font-semibold text-indigo-700"
            >
              <span>{{ task.zone?.name || 'Általános' }}:</span>
              <span class="font-mono">{{ getDropoffDisplay(task) }}</span>
            </span>
          </div>
        </div>

        <div class="space-y-1">
          <label for="complete-order-note" class="block text-[11px] font-semibold text-[#4c534e]">
            Kiadási megjegyzés (opcionális)
          </label>
          <input
            id="complete-order-note"
            v-model="completeNoteInput"
            type="text"
            maxlength="500"
            placeholder="Pl. Futárnak átadva / Csomagolva..."
            class="w-full h-[36px] rounded-[9px] bg-[#f8f9f7] border border-[#dce0d8] px-3 text-xs text-[#171918] outline-none focus:bg-white focus:border-[#f46714]"
          />
        </div>
      </div>

      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <button
            type="button"
            :disabled="completeSubmitting"
            @click="orderToComplete = null"
            class="h-[34px] px-3.5 rounded-[9px] bg-white border border-[#dce0d8] text-xs font-semibold text-[#4c534e] cursor-pointer disabled:opacity-50"
          >
            Mégsem
          </button>
          <button
            type="button"
            :disabled="completeSubmitting"
            @click="handleConfirmCompleteOrder"
            class="h-[34px] px-4 rounded-[9px] bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <i
              :class="completeSubmitting ? 'pi pi-spin pi-spinner text-xs' : 'pi pi-check text-xs'"
            ></i>
            <span>Kiadás megerősítése</span>
          </button>
        </div>
      </template>
    </Dialog>
  </div>
</template>
