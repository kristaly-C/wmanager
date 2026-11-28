<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { PickTaskStatus, SalesChannel, SalesOrderStatus } from '@wmanager/shared-types'
import Dialog from 'primevue/dialog'
import Drawer from 'primevue/drawer'
import Select from 'primevue/select'
import { useToast } from 'primevue/usetoast'
import { locationApi, type LocationItem } from '@/api/locations'
import {
  salesOrdersApi,
  type SalesOrderAvailabilityResponse,
  type SalesOrderDetail,
} from '@/api/salesOrders'
import ConfirmDeleteDialog from '@/components/common/ConfirmDeleteDialog.vue'
import { useAuthStore } from '@/stores/auth'
import { formatDateTime, formatPrice } from '@/utils/formatters'
import { extractApiError, LOCATION_TYPE_META } from '@/utils/locationMeta'
import {
  canCancelPickedSalesOrder,
  canCompleteSalesOrder,
  canManageSalesOrder,
  PICK_TASK_STATUS_META,
  SALES_CHANNEL_META,
  SALES_CHANNEL_OPTIONS,
  SALES_ORDER_STATUS_META,
} from '@/utils/salesOrderMeta'

const props = defineProps<{
  visible: boolean
  orderId: string | null
  locations?: LocationItem[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'updated', order: SalesOrderDetail): void
}>()

const authStore = useAuthStore()
const toast = useToast()

const order = ref<SalesOrderDetail | null>(null)
const loading = ref(false)
const actionLoading = ref(false)
const localLocations = ref<LocationItem[]>([])

// Hálózati készletmátrix ON_HOLD rendeléshez
const availability = ref<SalesOrderAvailabilityResponse | null>(null)
const loadingAvailability = ref(false)
const transferFromId = ref('')
const transferReason = ref('')
const transferNote = ref('')
const reassignTargetId = ref('')

// Inline szerkesztés állapot
const isEditing = ref(false)
const editChannel = ref<SalesChannel>(SalesChannel.WEBSHOP)
const editExternalOrderRef = ref('')
const editCustomerName = ref('')
const editCustomerPhone = ref('')
const editCustomerEmail = ref('')
const editShippingAddress = ref('')
const editNote = ref('')

// Megerősítő dialógusok
const isCompleteDialogOpen = ref(false)
const completeInstantMode = ref(false)
const isCancelDialogOpen = ref(false)

let detailAbortController: AbortController | null = null
let availabilityAbortController: AbortController | null = null

const userRole = computed(() => authStore.user?.role)

const canManage = computed(() => canManageSalesOrder(userRole.value))
const canComplete = computed(() => canCompleteSalesOrder(userRole.value))

const hasPickedItems = computed(
  () => order.value?.items.some((item) => item.pickedQuantity > 0) ?? false,
)

const hasStartedPickTasks = computed(
  () =>
    order.value?.pickTasks.some(
      (task) =>
        task.status === PickTaskStatus.IN_PROGRESS ||
        task.status === PickTaskStatus.AWAITING_DROP ||
        task.status === PickTaskStatus.COMPLETED,
    ) ?? false,
)

const canEditOrder = computed(() => {
  if (!order.value || !canManage.value) return false
  return (
    (order.value.status === SalesOrderStatus.ON_HOLD ||
      order.value.status === SalesOrderStatus.PENDING) &&
    !hasPickedItems.value
  )
})

const canReassignOrder = computed(() => canEditOrder.value && !hasStartedPickTasks.value)

const canCancelOrder = computed(() => {
  if (!order.value) return false
  if (
    order.value.status === SalesOrderStatus.COMPLETED ||
    order.value.status === SalesOrderStatus.CANCELLED
  ) {
    return false
  }
  return hasPickedItems.value
    ? canCancelPickedSalesOrder(userRole.value)
    : canManageSalesOrder(userRole.value)
})

const canDirectComplete = computed(() => {
  if (!order.value || !canComplete.value) return false
  if (order.value.status === SalesOrderStatus.READY) return true
  if (order.value.items.length > 0 && order.value.items.every((i) => i.pickedQuantity === i.orderedQuantity)) {
    return order.value.status !== SalesOrderStatus.COMPLETED && order.value.status !== SalesOrderStatus.CANCELLED && order.value.status !== SalesOrderStatus.ON_HOLD
  }
  return false
})

const canInstantShelfComplete = computed(() => {
  if (!order.value || !canComplete.value) return false
  return order.value.status === SalesOrderStatus.PENDING && !hasStartedPickTasks.value
})

const netTotal = computed(() => {
  if (!order.value) return 0
  return order.value.items.reduce(
    (sum, item) => sum + item.orderedQuantity * (Number(item.unitNetPrice) || 0),
    0,
  )
})

const grossTotal = computed(() => {
  if (!order.value) return 0
  return order.value.items.reduce(
    (sum, item) => sum + item.orderedQuantity * (Number(item.unitGrossPrice) || 0),
    0,
  )
})

const skuByVariantId = computed(() => {
  const map = new Map<string, string>()
  for (const item of order.value?.items ?? []) {
    map.set(item.variantId, item.variant.sku)
  }
  return map
})

const requiredByVariantId = computed(() => {
  const map = new Map<string, number>()
  for (const item of order.value?.items ?? []) {
    map.set(item.variantId, Math.max(1, item.orderedQuantity - item.pickedQuantity))
  }
  return map
})

const effectiveLocations = computed(() =>
  props.locations && props.locations.length > 0 ? props.locations : localLocations.value,
)

const otherSiteOptions = computed(() => {
  const currentSiteId = order.value?.sourceLocationId
  if (availability.value) {
    return availability.value.locations
      .filter((loc) => loc.locationId !== currentSiteId)
      .map((loc) => ({
        id: loc.locationId,
        label: `${loc.locationName} (${LOCATION_TYPE_META[loc.locationType].label})`,
      }))
  }
  return effectiveLocations.value
    .filter(
      (loc) =>
        loc.isActive &&
        (loc.type === 'WAREHOUSE' || loc.type === 'STORE') &&
        loc.id !== currentSiteId,
    )
    .sort((a, b) => a.name.localeCompare(b.name, 'hu'))
    .map((loc) => ({
      id: loc.id,
      label: `${loc.name} (${LOCATION_TYPE_META[loc.type].label})`,
    }))
})

function isCanceledError(err: unknown): boolean {
  const e = err as { code?: string; name?: string }
  return e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || e?.name === 'AbortError'
}

async function ensureLocationsLoaded() {
  if ((props.locations && props.locations.length > 0) || localLocations.value.length > 0) return
  try {
    const res = await locationApi.getAll()
    localLocations.value = res.data
  } catch {
    // Ha az availability válasz megérkezik, onnan is megkapjuk az aktív telephelyeket
  }
}

async function loadOrder(id: string) {
  if (detailAbortController) detailAbortController.abort()
  const controller = new AbortController()
  detailAbortController = controller

  loading.value = true
  isEditing.value = false
  try {
    const res = await salesOrdersApi.getOne(id, controller.signal)
    order.value = res.data
    initHoldControls(res.data)
    if (res.data.status === SalesOrderStatus.ON_HOLD) {
      void loadAvailability(res.data)
    } else {
      availability.value = null
    }
  } catch (err) {
    if (isCanceledError(err)) return
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a rendelés részleteit.'),
      life: 5000,
    })
  } finally {
    if (detailAbortController === controller) {
      loading.value = false
    }
  }
}

function initHoldControls(detail: SalesOrderDetail) {
  transferFromId.value = detail.transferRequestedFromLocationId ?? ''
  transferReason.value = ''
  transferNote.value = ''
  reassignTargetId.value = ''
}

async function loadAvailability(detail: SalesOrderDetail) {
  if (availabilityAbortController) availabilityAbortController.abort()
  const variantIds = Array.from(new Set(detail.items.map((item) => item.variantId)))
  if (variantIds.length === 0) {
    availability.value = null
    return
  }

  const controller = new AbortController()
  availabilityAbortController = controller
  loadingAvailability.value = true

  try {
    const quantities: Record<string, number> = {}
    for (const item of detail.items) {
      quantities[item.variantId] = Math.max(1, item.orderedQuantity - item.pickedQuantity)
    }
    const res = await salesOrdersApi.getAvailability(variantIds, quantities, controller.signal)
    availability.value = res.data

    if (!transferFromId.value) {
      const candidate = res.data.locations.find(
        (loc) => loc.locationId !== detail.sourceLocationId && loc.canFulfillAll,
      )
      if (candidate) {
        transferFromId.value = candidate.locationId
        reassignTargetId.value = candidate.locationId
      }
    }
  } catch (err) {
    if (isCanceledError(err)) return
    toast.add({
      severity: 'error',
      summary: 'Készletmátrix hiba',
      detail: extractApiError(err, 'Nem sikerült lekérdezni a hálózati készletet.'),
      life: 4000,
    })
  } finally {
    if (availabilityAbortController === controller) {
      loadingAvailability.value = false
    }
  }
}

watch(
  () => [props.visible, props.orderId] as const,
  ([isVisible, id]) => {
    if (isVisible && id) {
      void ensureLocationsLoaded()
      void loadOrder(id)
    } else if (!isVisible) {
      isEditing.value = false
    }
  },
  { immediate: true },
)

function startEdit() {
  if (!order.value || !canEditOrder.value) return
  editChannel.value = order.value.channel
  editExternalOrderRef.value = order.value.externalOrderRef ?? ''
  editCustomerName.value = order.value.customerName
  editCustomerPhone.value = order.value.customerPhone ?? ''
  editCustomerEmail.value = order.value.customerEmail ?? ''
  editShippingAddress.value = order.value.shippingAddress ?? ''
  editNote.value = order.value.note ?? ''
  isEditing.value = true
}

async function saveEdit() {
  if (!order.value) return
  if (!editCustomerName.value.trim()) {
    toast.add({
      severity: 'warn',
      summary: 'Hiányzó adat',
      detail: 'A vevő neve nem lehet üres.',
      life: 3500,
    })
    return
  }

  actionLoading.value = true
  try {
    const res = await salesOrdersApi.update(order.value.id, {
      channel: editChannel.value,
      externalOrderRef: editExternalOrderRef.value.trim() || undefined,
      customerName: editCustomerName.value.trim(),
      customerPhone: editCustomerPhone.value.trim() || undefined,
      customerEmail: editCustomerEmail.value.trim() || undefined,
      shippingAddress: editShippingAddress.value.trim() || undefined,
      note: editNote.value.trim() || undefined,
    })
    order.value = res.data
    isEditing.value = false
    toast.add({
      severity: 'success',
      summary: 'Rendelés frissítve',
      detail: `${res.data.orderNumber} adatai mentve.`,
      life: 3500,
    })
    emit('updated', res.data)
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Mentési hiba',
      detail: extractApiError(err, 'Nem sikerült módosítani a rendelést.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

async function handleReassign(targetLocationId: string) {
  if (!order.value || !targetLocationId) return
  actionLoading.value = true
  try {
    const res = await salesOrdersApi.reassignLocation(order.value.id, {
      sourceLocationId: targetLocationId,
    })
    order.value = res.data
    initHoldControls(res.data)
    if (res.data.status === SalesOrderStatus.ON_HOLD) {
      void loadAvailability(res.data)
    } else {
      availability.value = null
    }
    toast.add({
      severity: res.data.status === SalesOrderStatus.ON_HOLD ? 'warn' : 'success',
      summary: 'Telephely átirányítva',
      detail:
        res.data.status === SalesOrderStatus.ON_HOLD
          ? `${res.data.orderNumber} átkerült a(z) ${res.data.sourceLocation.name} telephelyre, de még hiányos.`
          : `${res.data.orderNumber} átirányítva (${res.data.sourceLocation.name}) és a kiszedés elindítható.`,
      life: 4500,
    })
    emit('updated', res.data)
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Átirányítás sikertelen',
      detail: extractApiError(err, 'Nem sikerült átirányítani a rendelést.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

async function handleRequestTransfer() {
  if (!order.value || !transferFromId.value) return
  actionLoading.value = true
  try {
    const res = await salesOrdersApi.requestTransfer(order.value.id, {
      transferRequestedFromLocationId: transferFromId.value,
      holdReason: transferReason.value.trim() || undefined,
      note: transferNote.value.trim() || undefined,
    })
    order.value = res.data
    toast.add({
      severity: 'success',
      summary: 'Átkérés rögzítve',
      detail: `Átkérési igény rögzítve: ${res.data.transferRequestedFromLocation?.name ?? ''}.`,
      life: 4000,
    })
    emit('updated', res.data)
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Átkérés sikertelen',
      detail: extractApiError(err, 'Nem sikerült rögzíteni az átkérést.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

async function handleRecheckStock() {
  if (!order.value) return
  actionLoading.value = true
  try {
    const res = await salesOrdersApi.recheckStock(order.value.id)
    order.value = res.data
    if (res.data.status === SalesOrderStatus.ON_HOLD) {
      void loadAvailability(res.data)
      toast.add({
        severity: 'warn',
        summary: 'Továbbra is készlethiány',
        detail: res.data.holdReason ?? 'Még nincs meg a teljes mennyiség a telephelyen.',
        life: 4500,
      })
    } else {
      availability.value = null
      toast.add({
        severity: 'success',
        summary: 'Készlet felszabadult!',
        detail: `${res.data.orderNumber} státusza frissítve: ${SALES_ORDER_STATUS_META[res.data.status].label}.`,
        life: 4500,
      })
    }
    emit('updated', res.data)
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Ellenőrzés sikertelen',
      detail: extractApiError(err, 'Nem sikerült újraellenőrizni a készletet.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

function openCompleteDialog(instantFromShelf: boolean) {
  completeInstantMode.value = instantFromShelf
  isCompleteDialogOpen.value = true
}

async function handleConfirmComplete() {
  if (!order.value) return
  actionLoading.value = true
  try {
    const res = await salesOrdersApi.complete(order.value.id, {
      instantFromShelf: completeInstantMode.value || undefined,
    })
    order.value = res.data
    isCompleteDialogOpen.value = false
    toast.add({
      severity: 'success',
      summary: 'Rendelés teljesítve',
      detail: `${res.data.orderNumber} sikeresen kiadva és lezárva.`,
      life: 4000,
    })
    emit('updated', res.data)
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Teljesítés sikertelen',
      detail: extractApiError(err, 'Nem sikerült lezárni a rendelést.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

async function handleConfirmCancel() {
  if (!order.value) return
  actionLoading.value = true
  try {
    const res = await salesOrdersApi.cancel(order.value.id)
    order.value = res.data
    isCancelDialogOpen.value = false
    toast.add({
      severity: 'success',
      summary: 'Rendelés lemondva',
      detail: `${res.data.orderNumber} lemondásra került, a foglalások/kiszedések visszavételezve.`,
      life: 4500,
    })
    emit('updated', res.data)
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Lemondás sikertelen',
      detail: extractApiError(err, 'Nem sikerült lemondani a rendelést.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

onBeforeUnmount(() => {
  if (detailAbortController) detailAbortController.abort()
  if (availabilityAbortController) availabilityAbortController.abort()
})
</script>

<template>
  <Drawer
    :visible="visible"
    position="right"
    :style="{ width: '48rem', maxWidth: '96vw' }"
    :header="order ? `Rendelés: ${order.orderNumber}` : 'Rendelés részletei'"
    @update:visible="emit('update:visible', $event)"
  >
    <div v-if="loading && !order" class="py-16 text-center text-sm text-[#686f6a]">
      <i class="pi pi-spin pi-spinner mr-2"></i>
      Rendelés adatainak betöltése...
    </div>

    <div v-else-if="order" class="space-y-5 text-[#171918] pb-6">
      <!-- Fejléc összefoglaló kártya -->
      <div class="bg-[#f8f9f7] border border-[#e8eae6] rounded-2xl p-4 space-y-3">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-mono text-lg font-bold text-[#171918]">
                {{ order.orderNumber }}
              </span>
              <span
                v-if="order.externalOrderRef"
                class="font-mono text-[11px] font-semibold bg-white border border-[#dce0d8] text-[#171918] px-2 py-0.5 rounded-lg"
              >
                Ref: {{ order.externalOrderRef }}
              </span>
              <i v-if="loading" class="pi pi-spin pi-spinner text-xs text-[#686f6a]"></i>
            </div>
            <p class="text-xs text-[#686f6a]">
              Telephely:
              <strong class="text-[#171918]">{{ order.sourceLocation.name }}</strong>
              · Létrehozva: {{ formatDateTime(order.createdAt) }}
              <span v-if="order.createdByUser"> ({{ order.createdByUser.name }})</span>
            </p>
            <p v-if="order.completedAt" class="text-xs text-emerald-700">
              Teljesítve: {{ formatDateTime(order.completedAt) }}
              <span v-if="order.completedByUser"> · {{ order.completedByUser.name }}</span>
            </p>
            <p v-if="order.cancelledAt" class="text-xs text-rose-700">
              Lemondva: {{ formatDateTime(order.cancelledAt) }}
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <span
              :class="[
                'inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg',
                SALES_CHANNEL_META[order.channel].badgeClass,
              ]"
            >
              <i :class="[SALES_CHANNEL_META[order.channel].icon, 'text-[10px]']"></i>
              <span>{{ SALES_CHANNEL_META[order.channel].label }}</span>
            </span>

            <span
              v-if="order.isPickup"
              class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200"
            >
              <i class="pi pi-map-marker text-[10px]"></i>
              <span>Személyes átvétel</span>
            </span>

            <span
              :class="[
                'inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg',
                SALES_ORDER_STATUS_META[order.status].badgeClass,
              ]"
            >
              <i :class="[SALES_ORDER_STATUS_META[order.status].icon, 'text-[10px]']"></i>
              <span>{{ SALES_ORDER_STATUS_META[order.status].label }}</span>
            </span>
          </div>
        </div>

        <!-- Vevő és végösszeg -->
        <div
          v-if="!isEditing"
          class="bg-white border border-[#e8eae6] rounded-xl p-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs"
        >
          <div>
            <p class="text-[11px] text-[#686f6a]">Vevő</p>
            <p class="font-semibold text-[#171918] mt-0.5">{{ order.customerName }}</p>
            <p v-if="order.customerPhone" class="text-[11px] text-[#686f6a] mt-0.5">
              <i class="pi pi-phone text-[10px] mr-1"></i>{{ order.customerPhone }}
            </p>
            <p v-if="order.customerEmail" class="text-[11px] text-[#686f6a] mt-0.5">
              <i class="pi pi-envelope text-[10px] mr-1"></i>{{ order.customerEmail }}
            </p>
          </div>

          <div class="sm:text-right">
            <p class="text-[11px] text-[#686f6a]">Összesítő</p>
            <p class="text-base font-bold text-[#171918] mt-0.5">
              {{ formatPrice(grossTotal) }}
            </p>
            <p class="text-[11px] text-[#686f6a]">Nettó: {{ formatPrice(netTotal) }}</p>
          </div>

          <div v-if="order.shippingAddress" class="sm:col-span-2 pt-2 border-t border-[#eff1ed]">
            <p class="text-[11px] text-[#686f6a]">Szállítási cím</p>
            <p class="text-xs text-[#171918] mt-0.5">{{ order.shippingAddress }}</p>
          </div>

          <div v-if="order.note" class="sm:col-span-2 pt-2 border-t border-[#eff1ed]">
            <p class="text-[11px] text-[#686f6a]">Megjegyzés</p>
            <p class="text-xs text-[#171918] mt-0.5 whitespace-pre-line">{{ order.note }}</p>
          </div>
        </div>

        <!-- Inline szerkesztő űrlap -->
        <form
          v-else
          @submit.prevent="saveEdit"
          class="bg-white border border-[#dce0d8] rounded-xl p-3.5 space-y-3 text-xs"
        >
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label class="block text-[11px] font-semibold text-[#686f6a] mb-1">Csatorna</label>
              <Select
                v-model="editChannel"
                :options="SALES_CHANNEL_OPTIONS"
                optionLabel="label"
                optionValue="value"
                class="w-full"
              />
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-[#686f6a] mb-1">
                Külső rendelésszám
              </label>
              <input
                v-model="editExternalOrderRef"
                type="text"
                class="w-full h-9 rounded-lg border border-[#dce0d8] px-2.5 text-xs outline-none focus:border-[#f46714]"
              />
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-[#686f6a] mb-1">
                Vevő neve <span class="text-rose-500">*</span>
              </label>
              <input
                v-model="editCustomerName"
                type="text"
                required
                class="w-full h-9 rounded-lg border border-[#dce0d8] px-2.5 text-xs outline-none focus:border-[#f46714]"
              />
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-[#686f6a] mb-1">Telefon</label>
              <input
                v-model="editCustomerPhone"
                type="text"
                class="w-full h-9 rounded-lg border border-[#dce0d8] px-2.5 text-xs outline-none focus:border-[#f46714]"
              />
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-[#686f6a] mb-1">Email</label>
              <input
                v-model="editCustomerEmail"
                type="email"
                class="w-full h-9 rounded-lg border border-[#dce0d8] px-2.5 text-xs outline-none focus:border-[#f46714]"
              />
            </div>
            <div>
              <label class="block text-[11px] font-semibold text-[#686f6a] mb-1">
                Szállítási cím
              </label>
              <input
                v-model="editShippingAddress"
                type="text"
                class="w-full h-9 rounded-lg border border-[#dce0d8] px-2.5 text-xs outline-none focus:border-[#f46714]"
              />
            </div>
            <div class="sm:col-span-2">
              <label class="block text-[11px] font-semibold text-[#686f6a] mb-1">Megjegyzés</label>
              <textarea
                v-model="editNote"
                rows="2"
                class="w-full rounded-lg border border-[#dce0d8] px-2.5 py-2 text-xs outline-none focus:border-[#f46714]"
              ></textarea>
            </div>
          </div>

          <div class="flex justify-end gap-2">
            <button
              type="button"
              @click="isEditing = false"
              class="h-8 px-3 rounded-lg bg-white border border-[#dce0d8] text-xs font-semibold text-[#171918] cursor-pointer"
            >
              Mégse
            </button>
            <button
              type="submit"
              :disabled="actionLoading"
              class="h-8 px-3.5 rounded-lg bg-[#171918] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <i v-if="actionLoading" class="pi pi-spin pi-spinner text-[11px]"></i>
              <span>Adatok mentése</span>
            </button>
          </div>
        </form>
      </div>

      <!-- ON_HOLD Problémás rendelés feloldó panel -->
      <div
        v-if="order.status === SalesOrderStatus.ON_HOLD"
        class="bg-orange-50/70 border border-orange-200 rounded-2xl p-4 space-y-4"
      >
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-1">
            <div class="flex items-center gap-2 text-orange-900">
              <i class="pi pi-exclamation-triangle text-sm text-orange-600"></i>
              <h3 class="text-sm font-bold">Felfüggesztett rendelés (Készlethiány feloldása)</h3>
            </div>
            <p class="text-xs text-orange-800">
              {{ order.holdReason || 'A forrás telephelyen nincs elegendő szabad készlet.' }}
            </p>
            <p
              v-if="order.transferRequestedFromLocation"
              class="inline-flex items-center gap-1.5 text-xs font-semibold bg-white text-orange-900 border border-orange-200 px-2.5 py-1 rounded-lg mt-1"
            >
              <i class="pi pi-truck text-[11px] text-orange-600"></i>
              <span>
                Átkérés rögzítve innen: {{ order.transferRequestedFromLocation.name }}
              </span>
            </p>
          </div>

          <button
            v-if="canManage"
            type="button"
            :disabled="actionLoading"
            @click="handleRecheckStock"
            class="h-9 px-3.5 rounded-xl bg-white border border-orange-300 hover:bg-orange-100 text-orange-900 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition"
          >
            <i :class="['pi pi-refresh text-xs', actionLoading ? 'animate-spin' : '']"></i>
            <span>Készlet újraellenőrzése</span>
          </button>
        </div>

        <!-- Élő hálózati készletmátrix -->
        <div class="bg-white border border-orange-200/80 rounded-xl overflow-hidden">
          <div class="px-3.5 py-2 bg-orange-50/60 border-b border-orange-100 flex items-center justify-between">
            <span class="text-xs font-semibold text-[#171918]">
              Hálózati készletmátrix (aktív telephelyek)
            </span>
            <i v-if="loadingAvailability" class="pi pi-spin pi-spinner text-xs text-orange-600"></i>
          </div>

          <div v-if="loadingAvailability && !availability" class="p-4 text-center text-xs text-[#686f6a]">
            Hálózati szabadkészlet lekérdezése...
          </div>

          <div v-else-if="availability" class="divide-y divide-[#eff1ed]">
            <div
              v-for="site in availability.locations"
              :key="site.locationId"
              class="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
            >
              <div class="space-y-1 min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-semibold text-[#171918]">{{ site.locationName }}</span>
                  <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                    {{ LOCATION_TYPE_META[site.locationType].label }}
                  </span>
                  <span
                    v-if="site.locationId === order.sourceLocationId"
                    class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200"
                  >
                    Jelenlegi telephely
                  </span>
                  <span
                    v-if="!order.isPickup && availability.recommendedLocationId === site.locationId"
                    class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 border border-orange-300"
                  >
                    Ajánlott
                  </span>
                  <span
                    class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700"
                  >
                    {{ site.coveredQty }}/{{ site.totalOrderedQty }} db helyben
                  </span>
                  <span
                    :class="[
                      'text-[10px] font-semibold px-2 py-0.5 rounded-full',
                      site.canFulfillAll
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-rose-50 text-rose-700 border border-rose-200',
                    ]"
                  >
                    {{ site.canFulfillAll ? 'Teljesíthető' : 'Hiányos' }}
                  </span>
                </div>

                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-for="v in site.variants"
                    :key="v.variantId"
                    :class="[
                      'font-mono text-[11px] px-2 py-0.5 rounded border',
                      v.availableQty >= (requiredByVariantId.get(v.variantId) ?? 1)
                        ? 'bg-emerald-50/70 text-emerald-800 border-emerald-200'
                        : 'bg-rose-50/70 text-rose-800 border-rose-200',
                    ]"
                  >
                    {{ skuByVariantId.get(v.variantId) ?? v.variantId }}:
                    <strong>{{ v.availableQty }}</strong>/{{ requiredByVariantId.get(v.variantId) ?? 1 }} db
                  </span>
                </div>
              </div>

              <div
                v-if="canReassignOrder && site.locationId !== order.sourceLocationId"
                class="shrink-0"
              >
                <button
                  type="button"
                  :disabled="actionLoading"
                  @click="handleReassign(site.locationId)"
                  :class="[
                    'h-8 px-3 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition',
                    site.canFulfillAll
                      ? 'bg-[#171918] hover:bg-[#2a2d2b] text-white'
                      : 'bg-white border border-[#dce0d8] hover:bg-slate-50 text-[#171918]',
                  ]"
                >
                  <i class="pi pi-arrow-right-arrow-left text-[10px]"></i>
                  <span>Átirányítás ide</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Átkérés rögzítése másik telephelyről -->
        <div
          v-if="canManage && otherSiteOptions.length > 0"
          class="bg-white border border-orange-200/80 rounded-xl p-3 space-y-2.5 text-xs"
        >
          <p class="font-semibold text-[#171918]">Átkérés rögzítése (ha marad a jelenlegi telephelyen)</p>
          <div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
            <div class="sm:col-span-5">
              <Select
                v-model="transferFromId"
                :options="otherSiteOptions"
                optionLabel="label"
                optionValue="id"
                placeholder="Forrás telephely..."
                class="w-full"
              />
            </div>
            <div class="sm:col-span-4">
              <input
                v-model="transferReason"
                type="text"
                placeholder="Indok / üzenet (opc.)"
                class="w-full h-10 rounded-lg border border-[#dce0d8] px-2.5 text-xs outline-none focus:border-[#f46714]"
              />
            </div>
            <div class="sm:col-span-3">
              <button
                type="button"
                :disabled="actionLoading || !transferFromId"
                @click="handleRequestTransfer"
                class="w-full h-10 px-3 rounded-lg bg-[#f46714] hover:bg-[#dc580b] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 transition"
              >
                <i class="pi pi-send text-[11px]"></i>
                <span>Átkérés rögzítése</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Tételek táblázata -->
      <div class="bg-white border border-[#e8eae6] rounded-2xl overflow-hidden">
        <div class="bg-[#f8f9f7] px-4 py-2.5 border-b border-[#e8eae6] flex items-center justify-between">
          <h3 class="text-xs font-semibold text-[#171918]">
            Rendelt tételek ({{ order.items.length }} sor)
          </h3>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="bg-[#eff1ed] text-[#686f6a] text-[11px]">
                <th class="py-2 px-3 font-medium">SKU & Termék</th>
                <th class="py-2 px-2.5 font-medium text-right">Rendelt</th>
                <th class="py-2 px-2.5 font-medium text-right">Foglalt</th>
                <th class="py-2 px-2.5 font-medium text-right">Kiszedve</th>
                <th class="py-2 px-2.5 font-medium text-right">Kedv.</th>
                <th class="py-2 px-2.5 font-medium text-right">Egységár</th>
                <th class="py-2 px-3 font-medium text-right">Bruttó sor</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#eff1ed]">
              <tr v-for="item in order.items" :key="item.id" class="hover:bg-[#fafbf9]">
                <td class="py-2.5 px-3 align-top">
                  <p class="font-semibold text-[#171918]">
                    {{ item.variant.product?.name ?? 'Ismeretlen termék' }}
                  </p>
                  <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-[#686f6a] mt-0.5">
                    <span class="font-mono font-semibold text-[#171918]">
                      {{ item.variant.sku }}
                    </span>
                    <span v-if="item.variant.size" class="bg-[#eff1ed] px-1.5 py-0.5 rounded">
                      {{ item.variant.size }}
                    </span>
                    <span v-if="item.variant.colors.length > 0">
                      {{ item.variant.colors.join(', ') }}
                    </span>
                  </div>
                </td>
                <td class="py-2.5 px-2.5 text-right font-semibold text-[#171918]">
                  {{ item.orderedQuantity }} db
                </td>
                <td class="py-2.5 px-2.5 text-right text-[#686f6a]">
                  {{ item.reservedQuantity }} db
                </td>
                <td class="py-2.5 px-2.5 text-right">
                  <span
                    :class="[
                      'font-semibold',
                      item.pickedQuantity >= item.orderedQuantity
                        ? 'text-emerald-700'
                        : item.pickedQuantity > 0
                          ? 'text-amber-700'
                          : 'text-[#686f6a]',
                    ]"
                  >
                    {{ item.pickedQuantity }} db
                  </span>
                </td>
                <td class="py-2.5 px-2.5 text-right text-[#686f6a]">
                  {{ item.discountPercent ? `${item.discountPercent}%` : '—' }}
                </td>
                <td class="py-2.5 px-2.5 text-right whitespace-nowrap">
                  <p class="font-medium text-[#171918]">{{ formatPrice(item.unitGrossPrice) }}</p>
                  <p class="text-[10px] text-[#686f6a]">
                    nettó: {{ formatPrice(item.unitNetPrice) }}
                  </p>
                </td>
                <td class="py-2.5 px-3 text-right font-bold text-[#171918] whitespace-nowrap">
                  {{ formatPrice(item.orderedQuantity * (Number(item.unitGrossPrice) || 0)) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Zónás kiszedési feladatok (pickTasks) -->
      <div class="bg-white border border-[#e8eae6] rounded-2xl overflow-hidden">
        <div class="bg-[#f8f9f7] px-4 py-2.5 border-b border-[#e8eae6] flex items-center justify-between">
          <h3 class="text-xs font-semibold text-[#171918]">
            Zónás kiszedési feladatok ({{ order.pickTasks.length }} db)
          </h3>
        </div>

        <div v-if="order.pickTasks.length === 0" class="p-4 text-xs text-[#686f6a] text-center">
          Nincs rögzített kiszedési feladat ehhez a rendeléshez.
        </div>

        <div v-else class="divide-y divide-[#eff1ed]">
          <div
            v-for="task in order.pickTasks"
            :key="task.id"
            class="p-3.5 space-y-2.5 text-xs"
          >
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono font-bold text-[#171918]">{{ task.taskNumber }}</span>
                <span class="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-semibold">
                  {{ task.zone?.name || 'Általános zóna' }}
                </span>
                <span
                  :class="[
                    'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg',
                    PICK_TASK_STATUS_META[task.status].badgeClass,
                  ]"
                >
                  <i :class="[PICK_TASK_STATUS_META[task.status].icon, 'text-[10px]']"></i>
                  <span>{{ PICK_TASK_STATUS_META[task.status].label }}</span>
                </span>
              </div>

              <!-- Lerakópolc kiemelés a csomagoláshoz -->
              <div
                v-if="task.dropoffLocation?.name || task.dropoffCode"
                class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200 font-bold text-xs"
              >
                <i class="pi pi-map-marker text-indigo-600 text-[11px]"></i>
                <span>
                  Lerakópolc: {{ task.dropoffLocation?.name || task.dropoffCode }}
                </span>
              </div>
            </div>

            <div class="flex flex-wrap items-center gap-4 text-[11px] text-[#686f6a]">
              <span>
                Kiszedő:
                <strong class="text-[#171918]">
                  {{ task.assignedToUser?.name || 'Nincs még felvéve' }}
                </strong>
              </span>
              <span v-if="task.toteCode">
                Kocsi / Láda:
                <strong class="font-mono text-[#171918]">{{ task.toteCode }}</strong>
              </span>
              <span v-if="task.droppedAt">
                Leadva: {{ formatDateTime(task.droppedAt) }}
              </span>
            </div>

            <div
              v-if="task.items && task.items.length > 0"
              class="bg-[#f8f9f7] rounded-xl p-2.5 flex flex-wrap gap-2"
            >
              <span
                v-for="tItem in task.items"
                :key="tItem.id"
                class="inline-flex items-center gap-1.5 text-[11px] bg-white border border-[#e8eae6] px-2 py-1 rounded-lg"
              >
                <span class="font-mono font-semibold text-[#171918]">
                  {{ tItem.variant.sku }}
                </span>
                <span
                  :class="
                    tItem.pickedQuantity >= tItem.requiredQuantity
                      ? 'text-emerald-700 font-semibold'
                      : 'text-[#686f6a]'
                  "
                >
                  {{ tItem.pickedQuantity }}/{{ tItem.requiredQuantity }} db
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Alsó műveleti sáv -->
      <div
        class="sticky bottom-0 bg-white/95 backdrop-blur border-t border-[#e8eae6] pt-3.5 pb-1 flex flex-wrap items-center justify-between gap-2.5"
      >
        <div class="flex flex-wrap items-center gap-2">
          <button
            v-if="canEditOrder && !isEditing"
            type="button"
            :disabled="actionLoading"
            @click="startEdit"
            class="h-9 px-3.5 rounded-xl bg-white border border-[#dce0d8] hover:border-[#171918] text-xs font-semibold text-[#171918] inline-flex items-center gap-1.5 cursor-pointer transition"
          >
            <i class="pi pi-pencil text-[11px]"></i>
            <span>Adatok szerkesztése</span>
          </button>

          <button
            v-if="canCancelOrder"
            type="button"
            :disabled="actionLoading"
            @click="isCancelDialogOpen = true"
            class="h-9 px-3.5 rounded-xl bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition"
          >
            <i class="pi pi-times text-[11px]"></i>
            <span>Rendelés lemondása</span>
          </button>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            v-if="canDirectComplete"
            type="button"
            :disabled="actionLoading"
            @click="openCompleteDialog(false)"
            class="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition"
          >
            <i class="pi pi-check-circle text-xs"></i>
            <span>Kiadás / Teljesítés</span>
          </button>

          <button
            v-else-if="canInstantShelfComplete"
            type="button"
            :disabled="actionLoading"
            @click="openCompleteDialog(true)"
            class="h-9 px-4 rounded-xl bg-[#f46714] hover:bg-[#dc580b] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition"
          >
            <i class="pi pi-bolt text-xs"></i>
            <span>Azonnali kiadás polcról</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Teljesítés megerősítése -->
    <Dialog
      :visible="isCompleteDialogOpen"
      modal
      :header="completeInstantMode ? 'Azonnali kiadás polcról' : 'Rendelés kiadása és teljesítése'"
      :style="{ width: '28rem', maxWidth: '95vw' }"
      @update:visible="isCompleteDialogOpen = $event"
    >
      <div class="space-y-3 py-1 text-xs text-[#686f6a]">
        <p v-if="completeInstantMode">
          Biztosan teljesíted a(z)
          <strong class="text-[#171918]">{{ order?.orderNumber }}</strong>
          rendelést közvetlenül a polcról? A rendszer azonnal levonja a tételeket a telephely
          polckészletéből és lezárja a nyitott kiszedési feladatokat.
        </p>
        <p v-else>
          Biztosan kiadottnak és teljesítettnek jelölöd a(z)
          <strong class="text-[#171918]">{{ order?.orderNumber }}</strong>
          rendelést?
        </p>

        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            @click="isCompleteDialogOpen = false"
            class="h-9 px-4 rounded-xl bg-white border border-[#dce0d8] text-xs font-semibold text-[#171918] cursor-pointer"
          >
            Mégse
          </button>
          <button
            type="button"
            :disabled="actionLoading"
            @click="handleConfirmComplete"
            class="h-9 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <i v-if="actionLoading" class="pi pi-spin pi-spinner text-xs"></i>
            <span>Megerősítés</span>
          </button>
        </div>
      </div>
    </Dialog>

    <!-- Lemondás megerősítése -->
    <ConfirmDeleteDialog
      v-model:visible="isCancelDialogOpen"
      header="Rendelés lemondása"
      :message="`Biztosan lemondod a(z) ${order?.orderNumber ?? ''} rendelést?`"
      :warning-note="
        hasPickedItems
          ? 'A már kiszedett tételek visszavételezésre kerülnek a forráspolcokra, a nyitott foglalások felszabadulnak.'
          : 'A lefoglalt készlet és a kapcsolódó nyitott kiszedési feladatok törlésre/felszabadításra kerülnek.'
      "
      confirm-label="Rendelés lemondása"
      :loading="actionLoading"
      @confirm="handleConfirmCancel"
    />
  </Drawer>
</template>
