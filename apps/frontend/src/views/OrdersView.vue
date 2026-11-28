<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { LocationType, SalesChannel, SalesOrderStatus } from '@wmanager/shared-types'
import Column from 'primevue/column'
import DataTable, { type DataTablePageEvent, type DataTableRowClickEvent } from 'primevue/datatable'
import Select from 'primevue/select'
import { useToast } from 'primevue/usetoast'
import { locationApi, type LocationItem } from '@/api/locations'
import {
  salesOrdersApi,
  type SalesOrderDetail,
  type SalesOrderListItem,
} from '@/api/salesOrders'
import PageHeader from '@/components/common/PageHeader.vue'
import OrderCreateModal from '@/components/orders/OrderCreateModal.vue'
import OrderDetailDrawer from '@/components/orders/OrderDetailDrawer.vue'
import { useAuthStore } from '@/stores/auth'
import { normalizeScannedBarcode } from '@/utils/barcodeScanner'
import { formatDateTime, formatPrice } from '@/utils/formatters'
import { extractApiError, LOCATION_TYPE_META } from '@/utils/locationMeta'
import {
  canCreateSalesOrder,
  PICK_TASK_STATUS_META,
  SALES_CHANNEL_META,
  SALES_CHANNEL_OPTIONS,
  SALES_ORDER_STATUS_META,
  SALES_ORDER_STATUS_OPTIONS,
} from '@/utils/salesOrderMeta'

interface SelectOption<T> {
  label: string
  value: T
}

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const toast = useToast()

// Lista állapot
const orders = ref<SalesOrderListItem[]>([])
const totalRecords = ref(0)
const onHoldCount = ref(0)
const loadingList = ref(false)
const locations = ref<LocationItem[]>([])

// Szűrők és lapozás
const searchInput = ref('')
const debouncedSearch = ref('')
const statusFilter = ref<SalesOrderStatus | ''>('')
const channelFilter = ref<SalesChannel | ''>('')
const locationFilter = ref<string>('')
const onlyProblems = ref(false)
const currentPage = ref(1)
const pageSize = 15

// Modálok és Drawer
const isCreateModalOpen = ref(false)
const isDetailDrawerOpen = ref(false)
const selectedOrderId = ref<string | null>(null)

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let listAbortController: AbortController | null = null

const canCreate = computed(() => canCreateSalesOrder(authStore.user?.role))

const statusSelectOptions = computed<Array<SelectOption<SalesOrderStatus | ''>>>(() => [
  { label: 'Összes státusz', value: '' },
  ...SALES_ORDER_STATUS_OPTIONS,
])

const channelSelectOptions = computed<Array<SelectOption<SalesChannel | ''>>>(() => [
  { label: 'Összes csatorna', value: '' },
  ...SALES_CHANNEL_OPTIONS,
])

const siteSelectOptions = computed<Array<SelectOption<string>>>(() => {
  const activeSites = locations.value.filter(
    (loc) =>
      loc.isActive &&
      (loc.type === LocationType.WAREHOUSE || loc.type === LocationType.STORE),
  )
  const assigned = activeSites.filter((loc) => loc.isAssigned !== false)
  const list = assigned.length > 0 ? assigned : activeSites
  return [
    { label: 'Összes telephely', value: '' },
    ...[...list]
      .sort((a, b) => a.name.localeCompare(b.name, 'hu'))
      .map((loc) => ({
        label: `${loc.name} (${LOCATION_TYPE_META[loc.type].label})`,
        value: loc.id,
      })),
  ]
})

const hasActiveFilters = computed(
  () =>
    debouncedSearch.value.length > 0 ||
    statusFilter.value !== '' ||
    channelFilter.value !== '' ||
    locationFilter.value !== '' ||
    onlyProblems.value,
)

function isCanceledError(err: unknown): boolean {
  const e = err as { code?: string; name?: string }
  return e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || e?.name === 'AbortError'
}

function normalizeSearchQuery(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (!/\s/.test(trimmed) && /\d/.test(trimmed) && /[öÖüÜ]/.test(trimmed)) {
    return normalizeScannedBarcode(trimmed)
  }
  return trimmed
}

function calcOrderGrossTotal(order: SalesOrderListItem): number {
  return order.items.reduce(
    (sum, item) => sum + item.orderedQuantity * (Number(item.unitGrossPrice) || 0),
    0,
  )
}

function calcOrderQuantitySummary(order: SalesOrderListItem): {
  ordered: number
  picked: number
} {
  return order.items.reduce(
    (acc, item) => ({
      ordered: acc.ordered + item.orderedQuantity,
      picked: acc.picked + item.pickedQuantity,
    }),
    { ordered: 0, picked: 0 },
  )
}

function getDropoffLabels(order: SalesOrderListItem): string[] {
  const labels = new Set<string>()
  for (const task of order.pickTasks) {
    const label = task.dropoffLocation?.name || task.dropoffCode
    if (label) labels.add(label)
  }
  return Array.from(labels)
}

async function loadLocations() {
  try {
    const res = await locationApi.getAll()
    locations.value = res.data
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a telephelyeket.'),
      life: 4000,
    })
  }
}

async function loadOrders() {
  if (listAbortController) listAbortController.abort()
  const controller = new AbortController()
  listAbortController = controller

  loadingList.value = true
  try {
    const skip = (currentPage.value - 1) * pageSize
    const res = await salesOrdersApi.list(
      {
        skip,
        take: pageSize,
        search: debouncedSearch.value || undefined,
        status: statusFilter.value || undefined,
        channel: channelFilter.value || undefined,
        sourceLocationId: locationFilter.value || undefined,
        onlyProblems: onlyProblems.value ? true : undefined,
      },
      controller.signal,
    )
    orders.value = res.data.items
    totalRecords.value = res.data.total
    onHoldCount.value = res.data.onHoldCount
  } catch (err) {
    if (isCanceledError(err)) return
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a rendeléseket.'),
      life: 5000,
    })
  } finally {
    if (listAbortController === controller) {
      loadingList.value = false
    }
  }
}

watch(searchInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const next = normalizeSearchQuery(val)
    if (debouncedSearch.value !== next) {
      debouncedSearch.value = next
      currentPage.value = 1
      void loadOrders()
    }
  }, 300)
})

function triggerImmediateSearch() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debouncedSearch.value = normalizeSearchQuery(searchInput.value)
  currentPage.value = 1
  void loadOrders()
}

watch([statusFilter, channelFilter, locationFilter, onlyProblems], () => {
  currentPage.value = 1
  void loadOrders()
})

function toggleOnlyProblems() {
  onlyProblems.value = !onlyProblems.value
}

function resetFilters() {
  if (debounceTimer) clearTimeout(debounceTimer)
  searchInput.value = ''
  debouncedSearch.value = ''
  statusFilter.value = ''
  channelFilter.value = ''
  locationFilter.value = ''
  onlyProblems.value = false
  currentPage.value = 1
  void loadOrders()
}

function onPage(event: DataTablePageEvent) {
  currentPage.value = event.page + 1
  void loadOrders()
}

function openOrderDrawer(orderId: string) {
  selectedOrderId.value = orderId
  isDetailDrawerOpen.value = true
}

function onRowClick(event: DataTableRowClickEvent) {
  const row = event.data as SalesOrderListItem | undefined
  if (row?.id) {
    openOrderDrawer(row.id)
  }
}

function onDrawerVisibleChange(nextVisible: boolean) {
  isDetailDrawerOpen.value = nextVisible
  if (!nextVisible && route.query.orderId) {
    const nextQuery = { ...route.query }
    delete nextQuery.orderId
    void router.replace({ query: nextQuery })
  }
}

async function onOrderCreated(created: SalesOrderDetail) {
  await loadOrders()
  openOrderDrawer(created.id)
}

async function onOrderUpdated() {
  await loadOrders()
}

watch(
  () => route.query.orderId,
  (orderIdParam) => {
    if (typeof orderIdParam === 'string' && orderIdParam.trim()) {
      openOrderDrawer(orderIdParam.trim())
    }
  },
  { immediate: true },
)

onMounted(() => {
  void loadLocations()
  void loadOrders()
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (listAbortController) listAbortController.abort()
})
</script>

<template>
  <div class="space-y-5 text-[#171918]">
    <PageHeader
      title="Rendelések"
      subtitle="Vevői rendelések felvétele, zónás kiszedés követése, készlethiányok és átadás kezelése."
    >
      <template #actions>
        <button
          v-if="canCreate"
          type="button"
          @click="isCreateModalOpen = true"
          class="bg-[#171918] hover:bg-[#2a2d2b] border border-white h-[40px] px-4 rounded-[12px] text-[13px] font-medium text-white flex items-center gap-2 shadow-xs transition cursor-pointer shrink-0"
        >
          <i class="pi pi-plus text-xs"></i>
          <span>+ Új rendelés</span>
        </button>
      </template>
    </PageHeader>

    <!-- Bento Szűrő & Táblázat kártya -->
    <div class="bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs space-y-4">
      <!-- Szűrősáv -->
      <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#e8eae6]">
        <div class="flex flex-wrap items-center gap-2.5 flex-1">
          <div class="relative flex-1 min-w-[220px] max-w-[360px]">
            <i class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"></i>
            <input
              v-model="searchInput"
              type="text"
              placeholder="Rendelésszám, vevő, SKU vagy vonalkód..."
              @keydown.enter.prevent="triggerImmediateSearch"
              class="w-full h-[38px] bg-white border border-white rounded-[10px] pl-9 pr-3 text-[12px] text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]/40 transition"
            />
          </div>

          <Select
            v-model="statusFilter"
            :options="statusSelectOptions"
            optionLabel="label"
            optionValue="value"
            class="min-w-[165px]"
          />

          <Select
            v-model="channelFilter"
            :options="channelSelectOptions"
            optionLabel="label"
            optionValue="value"
            class="min-w-[155px]"
          />

          <Select
            v-model="locationFilter"
            :options="siteSelectOptions"
            optionLabel="label"
            optionValue="value"
            class="min-w-[180px]"
          />

          <button
            type="button"
            @click="toggleOnlyProblems"
            :class="[
              'h-[38px] px-3 rounded-[10px] text-xs font-semibold inline-flex items-center gap-2 border transition cursor-pointer',
              onlyProblems
                ? 'bg-orange-600 text-white border-orange-600 shadow-xs'
                : 'bg-white text-[#171918] border-white hover:border-orange-300',
            ]"
          >
            <i class="pi pi-exclamation-triangle text-xs"></i>
            <span>Problémás (ON_HOLD)</span>
            <span
              :class="[
                'text-[11px] font-bold px-1.5 py-0.5 rounded-full leading-none',
                onlyProblems
                  ? 'bg-white text-orange-700'
                  : onHoldCount > 0
                    ? 'bg-rose-600 text-white'
                    : 'bg-slate-200 text-slate-700',
              ]"
            >
              {{ onHoldCount }}
            </span>
          </button>
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
            @click="loadOrders"
            title="Lista frissítése"
            class="text-xs text-[#686f6a] hover:text-[#171918] flex items-center gap-1.5 cursor-pointer transition"
          >
            <i :class="['pi pi-refresh text-xs', loadingList ? 'animate-spin' : '']"></i>
          </button>
        </div>
      </div>

      <!-- Szerveroldali Lazy DataTable -->
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
        :rowClass="() => 'cursor-pointer hover:bg-white/75'"
        class="text-[13px]"
        @page="onPage"
        @row-click="onRowClick"
      >
        <template #empty>
          <div class="py-12 text-center text-sm text-[#686f6a]">
            Nincs a szűrésnek megfelelő vevői rendelés.
          </div>
        </template>

        <Column header="Rendelésszám">
          <template #body="{ data }: { data: SalesOrderListItem }">
            <div class="min-w-[135px]">
              <p class="font-mono font-semibold text-xs text-[#171918]">
                {{ data.orderNumber }}
              </p>
              <p v-if="data.externalOrderRef" class="font-mono text-[11px] text-[#686f6a] mt-0.5">
                Ref: {{ data.externalOrderRef }}
              </p>
            </div>
          </template>
        </Column>

        <Column header="Csatorna">
          <template #body="{ data }: { data: SalesOrderListItem }">
            <div class="flex flex-col items-start gap-1">
              <span
                :class="[
                  'inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg whitespace-nowrap',
                  SALES_CHANNEL_META[data.channel].badgeClass,
                ]"
              >
                <i :class="[SALES_CHANNEL_META[data.channel].icon, 'text-[10px]']"></i>
                <span>{{ SALES_CHANNEL_META[data.channel].label }}</span>
              </span>
              <span
                v-if="data.isPickup"
                class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 whitespace-nowrap"
              >
                <i class="pi pi-map-marker text-[9px]"></i>
                <span>Személyes átvétel</span>
              </span>
            </div>
          </template>
        </Column>

        <Column header="Vevő">
          <template #body="{ data }: { data: SalesOrderListItem }">
            <div class="min-w-[145px]">
              <p class="font-semibold text-xs text-[#171918]">{{ data.customerName }}</p>
              <p
                v-if="data.customerPhone || data.customerEmail"
                class="text-[11px] text-[#686f6a] truncate max-w-[200px]"
              >
                {{ data.customerPhone || data.customerEmail }}
              </p>
            </div>
          </template>
        </Column>

        <Column header="Telephely">
          <template #body="{ data }: { data: SalesOrderListItem }">
            <span class="text-xs font-medium text-[#171918] whitespace-nowrap">
              {{ data.sourceLocation.name }}
            </span>
          </template>
        </Column>

        <Column header="Tételek / db">
          <template #body="{ data }: { data: SalesOrderListItem }">
            <div class="whitespace-nowrap">
              <p class="text-xs font-semibold text-[#171918]">
                {{ data.items.length }} tétel · {{ calcOrderQuantitySummary(data).ordered }} db
              </p>
              <p
                v-if="data.status === SalesOrderStatus.PICKING"
                class="text-[11px] text-amber-700"
              >
                Kiszedve: {{ calcOrderQuantitySummary(data).picked }}/{{
                  calcOrderQuantitySummary(data).ordered
                }}
              </p>
            </div>
          </template>
        </Column>

        <Column header="Bruttó végösszeg">
          <template #body="{ data }: { data: SalesOrderListItem }">
            <span class="font-bold text-xs text-[#171918] whitespace-nowrap">
              {{ formatPrice(calcOrderGrossTotal(data)) }}
            </span>
          </template>
        </Column>

        <Column header="Kiszedés & Lerakópolc">
          <template #body="{ data }: { data: SalesOrderListItem }">
            <div class="space-y-1 min-w-[160px]">
              <div v-if="data.pickTasks.length > 0" class="flex flex-wrap gap-1">
                <span
                  v-for="task in data.pickTasks"
                  :key="task.id"
                  :class="[
                    'inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded',
                    PICK_TASK_STATUS_META[task.status].badgeClass,
                  ]"
                  :title="`${task.taskNumber} (${task.zone?.name || 'Általános'})`"
                >
                  <span>{{ task.zone?.name || task.taskNumber }}</span>
                </span>
              </div>
              <span v-else class="text-[11px] text-[#686f6a]">—</span>

              <div v-if="getDropoffLabels(data).length > 0" class="flex flex-wrap gap-1">
                <span
                  v-for="drop in getDropoffLabels(data)"
                  :key="drop"
                  class="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200"
                >
                  <i class="pi pi-map-marker text-[9px]"></i>
                  <span>{{ drop }}</span>
                </span>
              </div>
            </div>
          </template>
        </Column>

        <Column header="Státusz">
          <template #body="{ data }: { data: SalesOrderListItem }">
            <span
              :class="[
                'inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap',
                SALES_ORDER_STATUS_META[data.status].badgeClass,
              ]"
            >
              <i :class="[SALES_ORDER_STATUS_META[data.status].icon, 'text-[10px]']"></i>
              <span>{{ SALES_ORDER_STATUS_META[data.status].label }}</span>
            </span>
          </template>
        </Column>

        <Column header="Létrehozva">
          <template #body="{ data }: { data: SalesOrderListItem }">
            <span class="text-xs text-[#686f6a] whitespace-nowrap">
              {{ formatDateTime(data.createdAt) }}
            </span>
          </template>
        </Column>

        <Column header="Művelet" bodyClass="text-right">
          <template #body="{ data }: { data: SalesOrderListItem }">
            <button
              type="button"
              @click.stop="openOrderDrawer(data.id)"
              class="h-8 px-3 rounded-lg bg-white border border-[#dce0d8] hover:border-[#171918] text-xs font-semibold text-[#171918] inline-flex items-center gap-1.5 cursor-pointer transition"
            >
              <span>Megnyitás</span>
              <i class="pi pi-angle-right text-[11px]"></i>
            </button>
          </template>
        </Column>
      </DataTable>
    </div>

    <!-- Új rendelés felvétele -->
    <OrderCreateModal
      v-model:visible="isCreateModalOpen"
      :locations="locations"
      @created="onOrderCreated"
    />

    <!-- Részlet Drawer -->
    <OrderDetailDrawer
      :visible="isDetailDrawerOpen"
      :order-id="selectedOrderId"
      :locations="locations"
      @update:visible="onDrawerVisibleChange"
      @updated="onOrderUpdated"
    />
  </div>
</template>
