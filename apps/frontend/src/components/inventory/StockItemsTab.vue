<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { SlotMode } from '@wmanager/shared-types'
import type { LocationItem } from '@/api/locations'
import { stockApi, type StockItemEntry } from '@/api/stock'
import {
  extractApiError,
  getLocationPath,
  LOCATION_TYPE_META,
  SLOT_MODE_META,
} from '@/utils/locationMeta'
import StockAdjustModal from './StockAdjustModal.vue'
import StockReportModal from './StockReportModal.vue'
import DataTable, { type DataTablePageEvent } from 'primevue/datatable'
import Column from 'primevue/column'
import { useToast } from 'primevue/usetoast'

const props = defineProps<{
  allLocations: LocationItem[]
  canAdjustStock: boolean
}>()

const emit = defineEmits<{
  (e: 'report-created'): void
}>()

const toast = useToast()

const items = ref<StockItemEntry[]>([])
const totalRecords = ref(0)
const loading = ref(false)

const searchInput = ref('')
const debouncedSearch = ref('')
const locationFilter = ref('')
const currentPage = ref(1)
const pageSize = 20

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let activeAbortController: AbortController | null = null

const isAdjustModalOpen = ref(false)
const adjustInitialLocationId = ref<string | null>(null)
const adjustInitialVariantId = ref<string | null>(null)

const isReportModalOpen = ref(false)
const reportInitialLocationId = ref<string | null>(null)
const reportInitialVariantId = ref<string | null>(null)
const reportInitialExpectedQty = ref<number | null>(null)

const locationById = computed(() => new Map(props.allLocations.map((l) => [l.id, l])))

const locationFilterOptions = computed(() => {
  return props.allLocations
    .map((loc) => {
      const pathNames = getLocationPath(loc.id, locationById.value).map((p) => p.name)
      const pathLabel = pathNames.length > 0 ? pathNames.join(' › ') : loc.name
      return {
        id: loc.id,
        label: `${pathLabel} (${LOCATION_TYPE_META[loc.type].label})`,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'hu', { numeric: true }))
})

const hasActiveFilters = computed(
  () => debouncedSearch.value.length > 0 || locationFilter.value.length > 0,
)

function isCanceledError(err: unknown): boolean {
  const e = err as { code?: string; name?: string }
  return e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || e?.name === 'AbortError'
}

function formatLocationPath(item: StockItemEntry): string {
  const path = getLocationPath(item.locationId, locationById.value)
  if (path.length > 0) {
    return path.map((p) => p.name).join(' › ')
  }
  return item.location.name
}

function getPrimaryBarcode(item: StockItemEntry): string | null {
  const list = item.variant.variantBarcodes ?? []
  const primary = list.find((b) => b.isPrimary) ?? list[0]
  return primary?.barcode ?? null
}

function getAvailableQuantity(item: StockItemEntry): number {
  return item.quantity - item.reservedQuantity
}

function isExternalRow(item: StockItemEntry): boolean {
  return item.isExternalLocation === true || item.location?.isAssigned === false
}

async function loadStockItems() {
  if (activeAbortController) {
    activeAbortController.abort()
  }
  const controller = new AbortController()
  activeAbortController = controller

  loading.value = true
  try {
    const skip = (currentPage.value - 1) * pageSize
    const res = await stockApi.getAll(
      {
        search: debouncedSearch.value || undefined,
        locationId: locationFilter.value || undefined,
        skip,
        take: pageSize,
      },
      controller.signal,
    )
    items.value = res.data.items
    totalRecords.value = res.data.total
  } catch (err) {
    if (isCanceledError(err)) return
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a készletlistát.'),
      life: 5000,
    })
  } finally {
    if (activeAbortController === controller) {
      loading.value = false
    }
  }
}

watch(searchInput, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const trimmed = val.trim()
    if (debouncedSearch.value !== trimmed) {
      debouncedSearch.value = trimmed
      currentPage.value = 1
      void loadStockItems()
    }
  }, 300)
})

function triggerImmediateSearch() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debouncedSearch.value = searchInput.value.trim()
  currentPage.value = 1
  void loadStockItems()
}

watch(locationFilter, () => {
  currentPage.value = 1
  void loadStockItems()
})

function onPage(event: DataTablePageEvent) {
  currentPage.value = event.page + 1
  void loadStockItems()
}

function resetFilters() {
  if (debounceTimer) clearTimeout(debounceTimer)
  searchInput.value = ''
  debouncedSearch.value = ''
  locationFilter.value = ''
  currentPage.value = 1
  void loadStockItems()
}

function openCreateAdjustModal() {
  const selectedLoc = locationFilter.value ? locationById.value.get(locationFilter.value) : undefined
  adjustInitialLocationId.value =
    selectedLoc && selectedLoc.isAssigned !== false ? selectedLoc.id : null
  adjustInitialVariantId.value = null
  isAdjustModalOpen.value = true
}

function openRowAdjustModal(item: StockItemEntry) {
  adjustInitialLocationId.value = item.locationId
  adjustInitialVariantId.value = item.variantId
  isAdjustModalOpen.value = true
}

function openRowReportModal(item: StockItemEntry) {
  reportInitialLocationId.value = item.locationId
  reportInitialVariantId.value = item.variantId
  reportInitialExpectedQty.value = item.quantity
  isReportModalOpen.value = true
}

function onStockSaved() {
  void loadStockItems()
}

function onReportSaved() {
  emit('report-created')
}

onMounted(() => {
  void loadStockItems()
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (activeAbortController) activeAbortController.abort()
})
</script>

<template>
  <div class="space-y-5 text-[#171918]">
    <!-- Felső sáv -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 class="text-[24px] font-semibold tracking-[-0.32px] text-[#171918] leading-tight">
          Készlet áttekintés
        </h2>
        <p class="text-[13px] text-[#686f6a] mt-1">
          Pozíciónkénti és termékenkénti aktuális raktár- és bolti készletek.
        </p>
      </div>

      <div class="flex items-center gap-2.5">
        <button
          v-if="canAdjustStock"
          type="button"
          @click="openCreateAdjustModal"
          class="bg-[#171918] hover:bg-[#2a2d2b] border border-white h-[40px] px-4 rounded-[12px] text-[13px] font-medium text-white flex items-center gap-2 shadow-xs transition cursor-pointer"
        >
          <i class="pi pi-arrow-right-arrow-left text-xs"></i>
          <span>Készlet áthelyezése / kezelése</span>
        </button>
      </div>
    </div>

    <!-- Kártya: Szűrők + Lazy DataTable -->
    <div class="bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#e8eae6]">
        <div class="flex flex-wrap items-center gap-2.5 flex-1">
          <div class="relative flex-1 min-w-[230px] max-w-md">
            <i class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"></i>
            <input
              v-model="searchInput"
              type="text"
              placeholder="Terméknév, SKU, vonalkód vagy pozíció..."
              @keydown.enter.prevent="triggerImmediateSearch"
              class="w-full h-[38px] bg-white border border-white rounded-[10px] pl-9 pr-3 text-[12px] text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]/40 transition"
            />
          </div>

          <select
            v-model="locationFilter"
            class="h-[38px] max-w-xs bg-white border border-white rounded-[10px] px-3 text-[12px] text-[#171918] outline-none cursor-pointer"
          >
            <option value="">Minden pozíció (teljes hozzáférés)</option>
            <option v-for="opt in locationFilterOptions" :key="opt.id" :value="opt.id">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="flex items-center gap-3">
          <span class="bg-[#e9ece7] text-[#171918] text-[11px] font-medium px-2.5 py-1 rounded-[7px]">
            {{ totalRecords }} tétel
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
            @click="loadStockItems"
            class="text-xs text-[#686f6a] hover:text-[#171918] flex items-center gap-1.5 cursor-pointer transition"
          >
            <i :class="['pi pi-refresh text-xs', loading ? 'animate-spin' : '']"></i>
            <span>Frissítés</span>
          </button>
        </div>
      </div>

      <DataTable
        :value="items"
        :lazy="true"
        :paginator="true"
        :rows="pageSize"
        :totalRecords="totalRecords"
        :first="(currentPage - 1) * pageSize"
        :loading="loading"
        dataKey="id"
        responsiveLayout="scroll"
        class="text-[13px]"
        @page="onPage"
      >
        <template #empty>
          <div class="py-12 text-center text-sm text-[#686f6a]">
            Nincs a szűrésnek megfelelő készlettétel.
          </div>
        </template>

        <Column header="Termék & Variáns">
          <template #body="{ data }: { data: StockItemEntry }">
            <div class="min-w-[190px]">
              <p class="font-semibold text-[#171918]">
                {{ data.variant.product?.name ?? 'Ismeretlen termék' }}
              </p>
              <div
                v-if="data.variant.size || data.variant.colors.length > 0"
                class="flex flex-wrap items-center gap-1.5 text-[11px] text-[#686f6a] mt-0.5"
              >
                <span
                  v-if="data.variant.size"
                  class="bg-[#eff1ed] text-[#171918] font-semibold px-1.5 py-0.5 rounded"
                >
                  {{ data.variant.size }}
                </span>
                <span v-if="data.variant.colors.length > 0">
                  {{ data.variant.colors.join(', ') }}
                </span>
              </div>
            </div>
          </template>
        </Column>

        <Column header="SKU / Vonalkód">
          <template #body="{ data }: { data: StockItemEntry }">
            <div class="space-y-0.5">
              <p class="font-mono text-xs font-semibold text-[#171918]">
                {{ data.variant.sku }}
              </p>
              <p v-if="getPrimaryBarcode(data)" class="font-mono text-[11px] text-[#686f6a]">
                {{ getPrimaryBarcode(data) }}
              </p>
              <p v-else class="text-[11px] text-[#9aa197]">—</p>
            </div>
          </template>
        </Column>

        <Column header="Pozíció">
          <template #body="{ data }: { data: StockItemEntry }">
            <div class="space-y-1 min-w-[200px]">
              <p class="text-xs font-medium text-[#171918]">
                {{ formatLocationPath(data) }}
              </p>
              <div class="flex flex-wrap items-center gap-1.5">
                <span
                  :class="[
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded-md',
                    LOCATION_TYPE_META[data.location.type].badgeClass,
                  ]"
                >
                  {{ LOCATION_TYPE_META[data.location.type].label }}
                </span>
                <span
                  v-if="data.location.slotMode === SlotMode.DEDICATED"
                  :class="[
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded-md',
                    SLOT_MODE_META[SlotMode.DEDICATED].badgeClass,
                  ]"
                >
                  DEDICATED
                </span>
                <span
                  v-if="isExternalRow(data)"
                  class="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200"
                >
                  Másik telephely (összesített)
                </span>
              </div>
            </div>
          </template>
        </Column>

        <Column header="Összes">
          <template #body="{ data }: { data: StockItemEntry }">
            <span class="font-semibold text-[#171918] whitespace-nowrap">
              {{ data.quantity }} db
            </span>
          </template>
        </Column>

        <Column header="Foglalt">
          <template #body="{ data }: { data: StockItemEntry }">
            <span
              class="whitespace-nowrap font-medium"
              :class="data.reservedQuantity > 0 ? 'text-amber-700' : 'text-[#686f6a]'"
            >
              {{ data.reservedQuantity }} db
            </span>
          </template>
        </Column>

        <Column header="Elérhető">
          <template #body="{ data }: { data: StockItemEntry }">
            <span
              class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap"
              :class="
                getAvailableQuantity(data) > 0
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-rose-50 text-rose-600 border border-rose-200'
              "
            >
              {{ getAvailableQuantity(data) }} db
            </span>
          </template>
        </Column>

        <Column v-if="canAdjustStock" header="Művelet" bodyClass="text-right" headerClass="text-right">
          <template #body="{ data }: { data: StockItemEntry }">
            <div v-if="!isExternalRow(data)" class="inline-flex items-center justify-end gap-1.5">
              <button
                type="button"
                @click="openRowAdjustModal(data)"
                class="h-[30px] px-2.5 rounded-[8px] bg-white border border-[#dce0d8] hover:border-[#171918] hover:bg-[#171918] text-[#171918] hover:text-white text-[11px] font-semibold transition cursor-pointer whitespace-nowrap"
              >
                Áthelyezés
              </button>
              <button
                type="button"
                @click="openRowReportModal(data)"
                class="h-[30px] px-2.5 rounded-[8px] bg-white border border-amber-200 hover:bg-amber-50 text-amber-800 text-[11px] font-semibold inline-flex items-center gap-1 transition cursor-pointer whitespace-nowrap"
                title="Hiány vagy eltérés jelentése erről a pozícióról"
              >
                <i class="pi pi-exclamation-triangle text-[10px] text-amber-600"></i>
                <span>Hiány jelentése</span>
              </button>
            </div>
          </template>
        </Column>
      </DataTable>
    </div>

    <StockAdjustModal
      v-model:visible="isAdjustModalOpen"
      :initialLocationId="adjustInitialLocationId"
      :initialVariantId="adjustInitialVariantId"
      :allLocations="allLocations"
      @saved="onStockSaved"
    />

    <StockReportModal
      v-model:visible="isReportModalOpen"
      :initialLocationId="reportInitialLocationId"
      :initialVariantId="reportInitialVariantId"
      :initialExpectedQty="reportInitialExpectedQty"
      :allLocations="allLocations"
      @saved="onReportSaved"
    />
  </div>
</template>
