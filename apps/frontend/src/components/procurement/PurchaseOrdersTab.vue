<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PurchaseOrderStatus } from '@wmanager/shared-types'
import DataTable, { type DataTablePageEvent, type DataTableRowClickEvent } from 'primevue/datatable'
import Column from 'primevue/column'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'
import {
  purchaseOrdersApi,
  type PurchaseOrderDetail,
  type PurchaseOrderListItem,
} from '@/api/purchaseOrders'
import { supplierApi, type SupplierItem } from '@/api/suppliers'
import ConfirmDeleteDialog from '@/components/common/ConfirmDeleteDialog.vue'
import PurchaseOrderConfirmModal from '@/components/procurement/PurchaseOrderConfirmModal.vue'
import PurchaseOrderFormModal from '@/components/procurement/PurchaseOrderFormModal.vue'
import { formatDateTime } from '@/utils/formatters'
import { extractApiError } from '@/utils/locationMeta'
import {
  formatCurrency,
  GOODS_RECEIPT_STATUS_META,
  PURCHASE_ORDER_STATUS_META,
  PURCHASE_ORDER_STATUS_OPTIONS,
} from '@/utils/procurementMeta'

const emit = defineEmits<{
  (e: 'create-receipt-from-po', po: PurchaseOrderDetail): void
  (e: 'open-receipt', receiptId: string): void
}>()

const toast = useToast()

// Lista állapot
const orders = ref<PurchaseOrderListItem[]>([])
const totalRecords = ref(0)
const loadingList = ref(false)
const suppliers = ref<SupplierItem[]>([])

// Szűrők és lapozás
const searchInput = ref('')
const debouncedSearch = ref('')
const statusFilter = ref<PurchaseOrderStatus | ''>('')
const supplierFilter = ref('')
const currentPage = ref(1)
const pageSize = 15

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let listAbortController: AbortController | null = null
let detailAbortController: AbortController | null = null

// Részletpanel állapot
const selectedPoId = ref<string>('')
const selectedPoDetail = ref<PurchaseOrderDetail | null>(null)
const loadingDetail = ref(false)
const actionLoading = ref(false)
const creatingReceiptLoading = ref(false)

// Modálok
const isFormModalOpen = ref(false)
const formModalMode = ref<'create' | 'edit'>('create')
const isConfirmModalOpen = ref(false)
const isCloseDialogOpen = ref(false)
const isCancelDialogOpen = ref(false)

const sortedSuppliers = computed(() =>
  [...suppliers.value].sort((a, b) => a.name.localeCompare(b.name, 'hu')),
)

const hasActiveFilters = computed(
  () =>
    debouncedSearch.value.length > 0 ||
    statusFilter.value.length > 0 ||
    supplierFilter.value.length > 0,
)

const canEditSelected = computed(
  () => selectedPoDetail.value?.status === PurchaseOrderStatus.DRAFT,
)

const canOrderSelected = computed(
  () => selectedPoDetail.value?.status === PurchaseOrderStatus.DRAFT,
)

const canConfirmSelected = computed(() => {
  const status = selectedPoDetail.value?.status
  return status === PurchaseOrderStatus.ORDERED || status === PurchaseOrderStatus.CONFIRMED
})

const canReceiveSelected = computed(() => {
  const status = selectedPoDetail.value?.status
  return (
    status === PurchaseOrderStatus.ORDERED ||
    status === PurchaseOrderStatus.CONFIRMED ||
    status === PurchaseOrderStatus.PARTIALLY_RECEIVED
  )
})

const canCloseSelected = computed(() => {
  const status = selectedPoDetail.value?.status
  return (
    status === PurchaseOrderStatus.CONFIRMED ||
    status === PurchaseOrderStatus.PARTIALLY_RECEIVED
  )
})

const canCancelSelected = computed(() => {
  const status = selectedPoDetail.value?.status
  return (
    status === PurchaseOrderStatus.DRAFT ||
    status === PurchaseOrderStatus.ORDERED ||
    status === PurchaseOrderStatus.CONFIRMED
  )
})

const detailTotalAmount = computed(() => {
  const po = selectedPoDetail.value
  if (!po) return 0
  return po.items.reduce((sum, item) => {
    const qty = item.confirmedQuantity ?? item.orderedQuantity
    return sum + qty * (Number(item.unitCost) || 0)
  }, 0)
})

const detailTotalHuf = computed(() => {
  const po = selectedPoDetail.value
  if (!po) return 0
  const rate = Number(po.exchangeRate) || 1
  return detailTotalAmount.value * rate
})

function isCanceledError(err: unknown): boolean {
  const e = err as { code?: string; name?: string }
  return e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || e?.name === 'AbortError'
}

function formatDateOnly(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

function calcListOrderTotal(po: PurchaseOrderListItem): number {
  return po.items.reduce((sum, item) => {
    const qty = item.confirmedQuantity ?? item.orderedQuantity
    return sum + qty * (Number(item.unitCost) || 0)
  }, 0)
}

function calcListReceivedSummary(po: PurchaseOrderListItem): { received: number; target: number } {
  return po.items.reduce(
    (acc, item) => ({
      received: acc.received + item.receivedQuantity,
      target: acc.target + (item.confirmedQuantity ?? item.orderedQuantity),
    }),
    { received: 0, target: 0 },
  )
}

async function loadSuppliers() {
  try {
    const res = await supplierApi.getAll()
    suppliers.value = res.data
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a beszállítókat.'),
      life: 4000,
    })
  }
}

async function loadOrders(preserveSelection = true) {
  if (listAbortController) listAbortController.abort()
  const controller = new AbortController()
  listAbortController = controller

  loadingList.value = true
  try {
    const skip = (currentPage.value - 1) * pageSize
    const res = await purchaseOrdersApi.list(
      {
        search: debouncedSearch.value || undefined,
        status: statusFilter.value || undefined,
        supplierId: supplierFilter.value || undefined,
        skip,
        take: pageSize,
      },
      controller.signal,
    )
    orders.value = res.data.items
    totalRecords.value = res.data.total

    if (res.data.items.length === 0) {
      selectedPoId.value = ''
      selectedPoDetail.value = null
      return
    }

    const stillInList = preserveSelection && res.data.items.some((item) => item.id === selectedPoId.value)
    if (!stillInList) {
      const first = res.data.items[0]
      if (first) {
        selectedPoId.value = first.id
        await loadDetail(first.id)
      }
    } else if (selectedPoId.value && !selectedPoDetail.value) {
      await loadDetail(selectedPoId.value)
    }
  } catch (err) {
    if (isCanceledError(err)) return
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a beszerzési rendeléseket.'),
      life: 5000,
    })
  } finally {
    if (listAbortController === controller) {
      loadingList.value = false
    }
  }
}

async function loadDetail(id: string) {
  if (!id) {
    selectedPoDetail.value = null
    return
  }
  if (detailAbortController) detailAbortController.abort()
  const controller = new AbortController()
  detailAbortController = controller

  loadingDetail.value = true
  try {
    const res = await purchaseOrdersApi.getOne(id, controller.signal)
    selectedPoDetail.value = res.data
  } catch (err) {
    if (isCanceledError(err)) return
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a beszerzési rendelés részleteit.'),
      life: 5000,
    })
  } finally {
    if (detailAbortController === controller) {
      loadingDetail.value = false
    }
  }
}

function selectOrder(id: string) {
  if (selectedPoId.value === id && selectedPoDetail.value?.id === id) return
  selectedPoId.value = id
  void loadDetail(id)
}

function onRowClick(event: DataTableRowClickEvent) {
  const row = event.data as PurchaseOrderListItem | undefined
  if (row?.id) {
    selectOrder(row.id)
  }
}

watch(searchInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const trimmed = val.trim()
    if (debouncedSearch.value !== trimmed) {
      debouncedSearch.value = trimmed
      currentPage.value = 1
      void loadOrders(false)
    }
  }, 300)
})

function triggerImmediateSearch() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debouncedSearch.value = searchInput.value.trim()
  currentPage.value = 1
  void loadOrders(false)
}

watch([statusFilter, supplierFilter], () => {
  currentPage.value = 1
  void loadOrders(false)
})

function onPage(event: DataTablePageEvent) {
  currentPage.value = event.page + 1
  void loadOrders(false)
}

function resetFilters() {
  if (debounceTimer) clearTimeout(debounceTimer)
  searchInput.value = ''
  debouncedSearch.value = ''
  statusFilter.value = ''
  supplierFilter.value = ''
  currentPage.value = 1
  void loadOrders(false)
}

function openCreateModal() {
  formModalMode.value = 'create'
  isFormModalOpen.value = true
}

function openEditModal() {
  if (!selectedPoDetail.value || !canEditSelected.value) return
  formModalMode.value = 'edit'
  isFormModalOpen.value = true
}

function openConfirmModal() {
  if (!selectedPoDetail.value || !canConfirmSelected.value) return
  isConfirmModalOpen.value = true
}

async function onPoSaved(saved: PurchaseOrderDetail) {
  selectedPoId.value = saved.id
  selectedPoDetail.value = saved
  await loadOrders(true)
}

async function handleOrderPo() {
  const po = selectedPoDetail.value
  if (!po || !canOrderSelected.value) return
  if (po.items.length === 0) {
    toast.add({
      severity: 'warn',
      summary: 'Nincs tétel',
      detail: 'Rendelés feladásához legalább 1 tétel hozzáadása kötelező.',
      life: 4000,
    })
    return
  }

  actionLoading.value = true
  try {
    const res = await purchaseOrdersApi.order(po.id)
    selectedPoDetail.value = res.data
    toast.add({
      severity: 'success',
      summary: 'Rendelés feladva',
      detail: `${res.data.orderNumber} státusza Megrendelve állapotra váltott.`,
      life: 4000,
    })
    await loadOrders(true)
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Művelet sikertelen',
      detail: extractApiError(err, 'Nem sikerült feladni a rendelést.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

async function handleCreateReceiptFromPo() {
  const po = selectedPoDetail.value
  if (!po || !canReceiveSelected.value) return

  creatingReceiptLoading.value = true
  try {
    const res = await purchaseOrdersApi.getOne(po.id)
    selectedPoDetail.value = res.data
    emit('create-receipt-from-po', res.data)
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült lekérni a rendelés friss adatait.'),
      life: 5000,
    })
  } finally {
    creatingReceiptLoading.value = false
  }
}

async function handleClosePo() {
  const po = selectedPoDetail.value
  if (!po || !canCloseSelected.value) return

  actionLoading.value = true
  try {
    const res = await purchaseOrdersApi.close(po.id)
    selectedPoDetail.value = res.data
    isCloseDialogOpen.value = false
    toast.add({
      severity: 'success',
      summary: 'Rendelés lezárva',
      detail: `${res.data.orderNumber} sikeresen lezárva.`,
      life: 4000,
    })
    await loadOrders(true)
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Lezárási hiba',
      detail: extractApiError(err, 'Nem sikerült lezárni a rendelést.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

async function handleCancelPo() {
  const po = selectedPoDetail.value
  if (!po || !canCancelSelected.value) return

  actionLoading.value = true
  try {
    const res = await purchaseOrdersApi.cancel(po.id)
    selectedPoDetail.value = res.data
    isCancelDialogOpen.value = false
    toast.add({
      severity: 'success',
      summary: 'Rendelés törölve',
      detail: `${res.data.orderNumber} sztornózva lett.`,
      life: 4000,
    })
    await loadOrders(true)
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Törlési hiba',
      detail: extractApiError(err, 'Nem sikerült törölni a beszerzési rendelést.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

onMounted(() => {
  void loadSuppliers()
  void loadOrders(false)
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (listAbortController) listAbortController.abort()
  if (detailAbortController) detailAbortController.abort()
})
</script>

<template>
  <div class="space-y-5 text-[#171918]">
    <!-- Felső fejléc -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-[26px] font-semibold tracking-[-0.36px] text-[#171918] leading-tight">
          Beszerzési rendelések (PO)
        </h1>
        <p class="text-[13px] text-[#686f6a] mt-1">
          Beszállítói rendelések tervezése, feladása, visszaigazolása és bevételezés indítása.
        </p>
      </div>

      <button
        type="button"
        @click="openCreateModal"
        class="bg-[#171918] hover:bg-[#2a2d2b] border border-white h-[40px] px-4 rounded-[12px] text-[13px] font-medium text-white flex items-center gap-2 shadow-xs transition cursor-pointer shrink-0"
      >
        <i class="pi pi-plus text-xs"></i>
        <span>Új beszerzési rendelés</span>
      </button>
    </div>

    <!-- Bal/Jobb Bento mester-részletező nézet -->
    <div class="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
      <!-- BAL OLDAL: Szűrők + Lazy DataTable -->
      <div class="xl:col-span-7 bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#e8eae6]">
          <div class="flex flex-wrap items-center gap-2.5 flex-1">
            <div class="relative flex-1 min-w-[200px]">
              <i class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"></i>
              <input
                v-model="searchInput"
                type="text"
                placeholder="Rendelésszám, hivatkozás, beszállító, SKU vagy vonalkód..."
                @keydown.enter.prevent="triggerImmediateSearch"
                class="w-full h-[38px] bg-white border border-white rounded-[10px] pl-9 pr-3 text-[12px] text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]/40 transition"
              />
            </div>

            <select
              v-model="statusFilter"
              class="h-[38px] bg-white border border-white rounded-[10px] px-3 text-[12px] text-[#171918] outline-none cursor-pointer"
            >
              <option value="">Minden státusz</option>
              <option
                v-for="opt in PURCHASE_ORDER_STATUS_OPTIONS"
                :key="opt.value"
                :value="opt.value"
              >
                {{ opt.label }}
              </option>
            </select>

            <select
              v-model="supplierFilter"
              class="h-[38px] max-w-[190px] bg-white border border-white rounded-[10px] px-3 text-[12px] text-[#171918] outline-none cursor-pointer"
            >
              <option value="">Minden beszállító</option>
              <option v-for="sup in sortedSuppliers" :key="sup.id" :value="sup.id">
                {{ sup.name }}
              </option>
            </select>
          </div>

          <div class="flex items-center gap-2.5">
            <span class="bg-[#e9ece7] text-[#171918] text-[11px] font-medium px-2.5 py-1 rounded-[7px]">
              {{ totalRecords }} rendelés
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
              @click="loadOrders(true)"
              class="text-xs text-[#686f6a] hover:text-[#171918] flex items-center gap-1.5 cursor-pointer transition"
            >
              <i :class="['pi pi-refresh text-xs', loadingList ? 'animate-spin' : '']"></i>
            </button>
          </div>
        </div>

        <DataTable
          :value="orders"
          :lazy="true"
          :paginator="true"
          :rows="pageSize"
          :totalRecords="totalRecords"
          :first="(currentPage - 1) * pageSize"
          :loading="loadingList"
          dataKey="id"
          responsiveLayout="scroll"
          :rowClass="(row: PurchaseOrderListItem) => (row.id === selectedPoId ? '!bg-[#fff0e5] cursor-pointer' : 'cursor-pointer hover:bg-white/70')"
          class="text-[13px]"
          @page="onPage"
          @row-click="onRowClick"
        >
          <template #empty>
            <div class="py-12 text-center text-sm text-[#686f6a]">
              Nincs a szűrésnek megfelelő beszerzési rendelés.
            </div>
          </template>

          <Column header="Rendelésszám">
            <template #body="{ data }: { data: PurchaseOrderListItem }">
              <div class="min-w-[130px]">
                <p class="font-mono font-semibold text-xs text-[#171918]">
                  {{ data.orderNumber }}
                </p>
                <p class="text-[11px] text-[#686f6a] mt-0.5">
                  {{ formatDateTime(data.createdAt) }}
                </p>
              </div>
            </template>
          </Column>

          <Column header="Beszállító">
            <template #body="{ data }: { data: PurchaseOrderListItem }">
              <div class="min-w-[130px]">
                <p class="font-semibold text-xs text-[#171918]">
                  {{ data.supplier.name }}
                </p>
                <p v-if="data.supplierReference" class="text-[11px] text-[#686f6a] font-mono">
                  Ref: {{ data.supplierReference }}
                </p>
              </div>
            </template>
          </Column>

          <Column header="Státusz">
            <template #body="{ data }: { data: PurchaseOrderListItem }">
              <span
                :class="[
                  'inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap',
                  PURCHASE_ORDER_STATUS_META[data.status].badgeClass,
                ]"
              >
                <i :class="[PURCHASE_ORDER_STATUS_META[data.status].icon, 'text-[10px]']"></i>
                <span>{{ PURCHASE_ORDER_STATUS_META[data.status].label }}</span>
              </span>
            </template>
          </Column>

          <Column header="Tételek / Érték">
            <template #body="{ data }: { data: PurchaseOrderListItem }">
              <div class="whitespace-nowrap">
                <p class="text-xs font-semibold text-[#171918]">
                  {{ formatCurrency(calcListOrderTotal(data), data.currency) }}
                </p>
                <p class="text-[11px] text-[#686f6a]">
                  {{ data._count.items }} sor · {{ calcListReceivedSummary(data).received }}/{{ calcListReceivedSummary(data).target }} db
                </p>
              </div>
            </template>
          </Column>

          <Column header="Terv. kézbesítés">
            <template #body="{ data }: { data: PurchaseOrderListItem }">
              <span class="text-xs text-[#686f6a] whitespace-nowrap">
                {{ formatDateOnly(data.expectedDeliveryDate) }}
              </span>
            </template>
          </Column>
        </DataTable>
      </div>

      <!-- JOBB OLDAL: Kijelölt PO részletes adatlapja -->
      <div class="xl:col-span-5 bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs space-y-4">
        <div v-if="loadingDetail && !selectedPoDetail" class="py-16 text-center text-sm text-[#686f6a]">
          <i class="pi pi-spin pi-spinner mr-2"></i>
          Rendelés adatainak betöltése...
        </div>

        <div v-else-if="!selectedPoDetail" class="py-16 text-center space-y-2">
          <div class="size-12 rounded-2xl bg-white border border-[#e8eae6] mx-auto flex items-center justify-center text-[#686f6a]">
            <i class="pi pi-shopping-cart text-lg"></i>
          </div>
          <p class="text-sm font-semibold text-[#171918]">Válassz egy beszerzési rendelést</p>
          <p class="text-xs text-[#686f6a]">
            Kattints a bal oldali táblázat egyik sorára a részletek és műveletek megtekintéséhez.
          </p>
        </div>

        <template v-else>
          <!-- Részlet fejléc -->
          <div class="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-[#e8eae6]">
            <div>
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="font-mono text-lg font-bold text-[#171918]">
                  {{ selectedPoDetail.orderNumber }}
                </h2>
                <span
                  :class="[
                    'inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-0.5 rounded-lg',
                    PURCHASE_ORDER_STATUS_META[selectedPoDetail.status].badgeClass,
                  ]"
                >
                  <i :class="[PURCHASE_ORDER_STATUS_META[selectedPoDetail.status].icon, 'text-[10px]']"></i>
                  <span>{{ PURCHASE_ORDER_STATUS_META[selectedPoDetail.status].label }}</span>
                </span>
                <i v-if="loadingDetail" class="pi pi-spin pi-spinner text-xs text-[#686f6a]"></i>
              </div>
              <p class="text-xs text-[#686f6a] mt-1">
                Létrehozva: {{ formatDateTime(selectedPoDetail.createdAt) }}
                <span v-if="selectedPoDetail.createdByUser">
                  · {{ selectedPoDetail.createdByUser.name }}
                </span>
              </p>
            </div>
          </div>

          <!-- Műveleti gombok -->
          <div class="flex flex-wrap items-center gap-2">
            <button
              v-if="canEditSelected"
              type="button"
              :disabled="actionLoading"
              @click="openEditModal"
              class="h-9 px-3 rounded-xl bg-white border border-[#dce0d8] hover:border-[#171918] text-xs font-semibold text-[#171918] inline-flex items-center gap-1.5 cursor-pointer transition"
            >
              <i class="pi pi-pencil text-[11px]"></i>
              <span>Szerkesztés</span>
            </button>

            <button
              v-if="canOrderSelected"
              type="button"
              :disabled="actionLoading || selectedPoDetail.items.length === 0"
              @click="handleOrderPo"
              :title="selectedPoDetail.items.length === 0 ? 'Legalább 1 tétel szükséges a feladáshoz' : undefined"
              class="h-9 px-3.5 rounded-xl bg-[#171918] hover:bg-[#2a2d2b] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition"
            >
              <i v-if="actionLoading" class="pi pi-spin pi-spinner text-[11px]"></i>
              <i v-else class="pi pi-send text-[11px]"></i>
              <span>Rendelés feladása</span>
            </button>

            <button
              v-if="canConfirmSelected"
              type="button"
              :disabled="actionLoading"
              @click="openConfirmModal"
              class="h-9 px-3.5 rounded-xl bg-white border border-indigo-200 hover:bg-indigo-50 text-indigo-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition"
            >
              <i class="pi pi-verified text-[11px]"></i>
              <span>Gyártói visszaigazolás</span>
            </button>

            <button
              v-if="canReceiveSelected"
              type="button"
              :disabled="creatingReceiptLoading || actionLoading"
              @click="handleCreateReceiptFromPo"
              class="h-9 px-3.5 rounded-xl bg-[#f46714] hover:bg-[#dc580b] text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition"
            >
              <i v-if="creatingReceiptLoading" class="pi pi-spin pi-spinner text-[11px]"></i>
              <i v-else class="pi pi-inbox text-[11px]"></i>
              <span>Szállítmány bevételezése</span>
            </button>

            <button
              v-if="canCloseSelected"
              type="button"
              :disabled="actionLoading"
              @click="isCloseDialogOpen = true"
              class="h-9 px-3 rounded-xl bg-white border border-teal-200 hover:bg-teal-50 text-teal-800 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition"
            >
              <i class="pi pi-lock text-[11px]"></i>
              <span>Lezárás</span>
            </button>

            <button
              v-if="canCancelSelected"
              type="button"
              :disabled="actionLoading"
              @click="isCancelDialogOpen = true"
              class="h-9 px-3 rounded-xl bg-white border border-rose-200 hover:bg-rose-50 text-rose-700 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition"
            >
              <i class="pi pi-times text-[11px]"></i>
              <span>Törlés</span>
            </button>
          </div>

          <!-- Metaadat kártya -->
          <div class="bg-white border border-[#e8eae6] rounded-2xl p-4 grid grid-cols-2 gap-3 text-xs">
            <div>
              <p class="text-[11px] text-[#686f6a]">Beszállító</p>
              <p class="font-semibold text-[#171918] mt-0.5">{{ selectedPoDetail.supplier.name }}</p>
              <p v-if="selectedPoDetail.supplier.email" class="text-[11px] text-[#686f6a]">
                {{ selectedPoDetail.supplier.email }}
              </p>
            </div>

            <div>
              <p class="text-[11px] text-[#686f6a]">Pénznem / Árfolyam</p>
              <p class="font-semibold text-[#171918] mt-0.5">
                {{ selectedPoDetail.currency }}
                <span v-if="selectedPoDetail.currency !== 'HUF'" class="font-normal text-[#686f6a]">
                  ({{ selectedPoDetail.exchangeRate }} Ft)
                </span>
              </p>
            </div>

            <div>
              <p class="text-[11px] text-[#686f6a]">Tervezett kézbesítés</p>
              <p class="font-semibold text-[#171918] mt-0.5">
                {{ formatDateOnly(selectedPoDetail.expectedDeliveryDate) }}
              </p>
            </div>

            <div>
              <p class="text-[11px] text-[#686f6a]">Gyártói hivatkozás</p>
              <p class="font-mono font-semibold text-[#171918] mt-0.5">
                {{ selectedPoDetail.supplierReference || '—' }}
              </p>
            </div>

            <div v-if="selectedPoDetail.orderedAt">
              <p class="text-[11px] text-[#686f6a]">Megrendelve</p>
              <p class="font-medium text-[#171918] mt-0.5">
                {{ formatDateTime(selectedPoDetail.orderedAt) }}
              </p>
            </div>

            <div v-if="selectedPoDetail.confirmedAt">
              <p class="text-[11px] text-[#686f6a]">Visszaigazolva</p>
              <p class="font-medium text-[#171918] mt-0.5">
                {{ formatDateTime(selectedPoDetail.confirmedAt) }}
              </p>
            </div>

            <div v-if="selectedPoDetail.note" class="col-span-2 pt-2 border-t border-[#eff1ed]">
              <p class="text-[11px] text-[#686f6a]">Megjegyzés</p>
              <p class="text-xs text-[#171918] mt-0.5 whitespace-pre-line">{{ selectedPoDetail.note }}</p>
            </div>
          </div>

          <!-- Tételek táblázat -->
          <div class="bg-white border border-[#e8eae6] rounded-2xl overflow-hidden">
            <div class="px-4 py-2.5 bg-[#f6f7f5] border-b border-[#e8eae6] flex items-center justify-between">
              <span class="text-xs font-semibold text-[#171918]">
                Rendelési tételek ({{ selectedPoDetail.items.length }})
              </span>
              <span class="text-xs font-semibold text-[#171918]">
                {{ formatCurrency(detailTotalAmount, selectedPoDetail.currency) }}
                <span
                  v-if="selectedPoDetail.currency !== 'HUF'"
                  class="text-[11px] font-normal text-[#686f6a] ml-1"
                >
                  (≈ {{ formatCurrency(detailTotalHuf, 'HUF') }})
                </span>
              </span>
            </div>

            <div v-if="selectedPoDetail.items.length === 0" class="py-8 text-center text-xs text-[#686f6a]">
              Nincs tétel ezen a rendelésen.
            </div>

            <div v-else class="overflow-x-auto">
              <table class="w-full text-left border-collapse text-xs">
                <thead>
                  <tr class="bg-[#eff1ed] text-[#686f6a] text-[11px]">
                    <th class="py-2 px-3 font-medium">Termék / SKU</th>
                    <th class="py-2 px-2 font-medium text-right">Rendelt</th>
                    <th class="py-2 px-2 font-medium text-right">Visszaig.</th>
                    <th class="py-2 px-2 font-medium text-right">Beérkezett</th>
                    <th class="py-2 px-3 font-medium text-right">Egységár</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-[#eff1ed]">
                  <tr v-for="item in selectedPoDetail.items" :key="item.id">
                    <td class="py-2.5 px-3">
                      <p class="font-semibold text-[#171918]">
                        {{ item.variant.product?.name ?? 'Ismeretlen termék' }}
                      </p>
                      <p class="font-mono text-[11px] text-[#686f6a]">
                        {{ item.variant.sku }}
                        <span v-if="item.variant.size"> · {{ item.variant.size }}</span>
                      </p>
                    </td>
                    <td class="py-2.5 px-2 text-right font-medium text-[#171918] whitespace-nowrap">
                      {{ item.orderedQuantity }} db
                    </td>
                    <td class="py-2.5 px-2 text-right whitespace-nowrap">
                      <span
                        v-if="item.confirmedQuantity !== null"
                        class="font-medium"
                        :class="
                          item.confirmedQuantity < item.orderedQuantity
                            ? 'text-amber-700'
                            : 'text-[#171918]'
                        "
                      >
                        {{ item.confirmedQuantity }} db
                      </span>
                      <span v-else class="text-[#9aa197]">—</span>
                    </td>
                    <td class="py-2.5 px-2 text-right whitespace-nowrap">
                      <span
                        class="font-semibold"
                        :class="
                          item.receivedQuantity >= (item.confirmedQuantity ?? item.orderedQuantity)
                            ? 'text-emerald-700'
                            : item.receivedQuantity > 0
                              ? 'text-amber-700'
                              : 'text-[#686f6a]'
                        "
                      >
                        {{ item.receivedQuantity }} db
                      </span>
                    </td>
                    <td class="py-2.5 px-3 text-right font-semibold text-[#171918] whitespace-nowrap">
                      {{ formatCurrency(item.unitCost, selectedPoDetail.currency) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- Kapcsolódó szállítmányok / bevételezések -->
          <div class="bg-white border border-[#e8eae6] rounded-2xl overflow-hidden">
            <div class="px-4 py-2.5 bg-[#f6f7f5] border-b border-[#e8eae6] flex items-center justify-between">
              <span class="text-xs font-semibold text-[#171918]">
                Kapcsolódó szállítmányok ({{ selectedPoDetail.goodsReceipts.length }})
              </span>
            </div>

            <div
              v-if="selectedPoDetail.goodsReceipts.length === 0"
              class="py-6 text-center text-xs text-[#686f6a]"
            >
              Még nincs bevételezés ehhez a beszerzési rendeléshez.
            </div>

            <div v-else class="divide-y divide-[#eff1ed]">
              <button
                v-for="gr in selectedPoDetail.goodsReceipts"
                :key="gr.id"
                type="button"
                @click="emit('open-receipt', gr.id)"
                class="w-full px-4 py-3 text-left flex items-center justify-between gap-3 hover:bg-[#f8f9f7] transition cursor-pointer"
              >
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <span class="font-mono text-xs font-bold text-[#171918]">
                      {{ gr.receiptNumber }}
                    </span>
                    <span
                      :class="[
                        'inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md',
                        GOODS_RECEIPT_STATUS_META[gr.status].badgeClass,
                      ]"
                    >
                      {{ GOODS_RECEIPT_STATUS_META[gr.status].label }}
                    </span>
                  </div>
                  <p class="text-[11px] text-[#686f6a] mt-1">
                    {{ gr.targetLocation.name }}
                    <span v-if="gr.invoiceNumber"> · Számla: {{ gr.invoiceNumber }}</span>
                    · {{ gr._count.items }} tétel · {{ formatDateTime(gr.createdAt) }}
                  </p>
                </div>

                <span class="text-[11px] font-semibold text-[#f46714] inline-flex items-center gap-1 shrink-0">
                  <span>Megnyitás</span>
                  <i class="pi pi-arrow-up-right text-[10px]"></i>
                </span>
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <!-- PO Létrehozás / Szerkesztés modál -->
    <PurchaseOrderFormModal
      v-model:visible="isFormModalOpen"
      :mode="formModalMode"
      :initial-po="formModalMode === 'edit' ? selectedPoDetail : null"
      :suppliers="suppliers"
      @saved="onPoSaved"
    />

    <!-- Gyártói visszaigazolás modál -->
    <PurchaseOrderConfirmModal
      v-model:visible="isConfirmModalOpen"
      :purchase-order="selectedPoDetail"
      @saved="onPoSaved"
    />

    <!-- Lezárás megerősítő dialógus -->
    <Dialog
      v-model:visible="isCloseDialogOpen"
      modal
      header="Beszerzési rendelés lezárása"
      :style="{ width: '26rem', maxWidth: '95vw' }"
    >
      <div class="space-y-3 py-1">
        <p class="text-sm text-[#686f6a]">
          Biztosan lezárod a(z)
          <strong class="text-[#171918] font-mono">{{ selectedPoDetail?.orderNumber }}</strong>
          beszerzési rendelést?
        </p>
        <p class="text-xs text-[#686f6a] bg-[#f6f7f5] rounded-[10px] p-3 border border-[#e8eae6]">
          Lezárás után a rendeléshez már nem indítható új bevételezés, és a nem teljesített hátralék lezártnak minősül.
        </p>
        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            @click="isCloseDialogOpen = false"
            class="h-[36px] px-4 rounded-[10px] bg-white border border-[#dce0d8] text-xs font-medium text-[#171918] cursor-pointer"
          >
            Mégse
          </button>
          <button
            type="button"
            :disabled="actionLoading"
            @click="handleClosePo"
            class="h-[36px] px-4 rounded-[10px] bg-[#171918] hover:bg-[#2a2d2b] text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <i v-if="actionLoading" class="pi pi-spin pi-spinner text-xs"></i>
            <span>Rendelés lezárása</span>
          </button>
        </div>
      </div>
    </Dialog>

    <!-- Törlés (Cancel) megerősítő dialógus -->
    <ConfirmDeleteDialog
      v-model:visible="isCancelDialogOpen"
      header="Beszerzési rendelés törlése"
      :message="`Biztosan törlöd (sztornózod) a(z) ${selectedPoDetail?.orderNumber ?? ''} beszerzési rendelést?`"
      warning-note="A művelet csak akkor hajtható végre, ha a rendeléshez még nem tartozik aktív bevételezési bizonylat."
      confirm-label="Rendelés törlése"
      :loading="actionLoading"
      @confirm="handleCancelPo"
    />
  </div>
</template>
