<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MovementType } from '@wmanager/shared-types'
import type { LocationItem } from '@/api/locations'
import { stockApi, type StockMovementEntry } from '@/api/stock'
import { extractApiError, getLocationPath, LOCATION_TYPE_META } from '@/utils/locationMeta'
import DataTable, { type DataTablePageEvent } from 'primevue/datatable'
import Column from 'primevue/column'
import { useToast } from 'primevue/usetoast'

const props = defineProps<{
  allLocations: LocationItem[]
}>()

const toast = useToast()

const movements = ref<StockMovementEntry[]>([])
const totalRecords = ref(0)
const loading = ref(false)

const searchInput = ref('')
const debouncedSearch = ref('')
const locationFilter = ref('')
const typeFilter = ref<'' | MovementType>('')
const currentPage = ref(1)
const pageSize = 25

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let activeAbortController: AbortController | null = null

const MOVEMENT_TYPE_META: Record<MovementType, { label: string; badgeClass: string }> = {
  [MovementType.INITIAL_STOCK]: {
    label: 'Kezdeti készlet',
    badgeClass: 'bg-sky-50 text-sky-700 border border-sky-200',
  },
  [MovementType.PURCHASE_RECEIPT]: {
    label: 'Bevételezés',
    badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  },
  [MovementType.SALE]: {
    label: 'Eladás',
    badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200',
  },
  [MovementType.TRANSFER_IN]: {
    label: 'Transzfer be',
    badgeClass: 'bg-indigo-50 text-indigo-700 border border-indigo-200',
  },
  [MovementType.TRANSFER_OUT]: {
    label: 'Transzfer ki',
    badgeClass: 'bg-orange-50 text-orange-700 border border-orange-200',
  },
  [MovementType.STOCKTAKE_ADJUSTMENT]: {
    label: 'Leltárkorrekció',
    badgeClass: 'bg-purple-50 text-purple-700 border border-purple-200',
  },
  [MovementType.RETURN_RESTOCK]: {
    label: 'Visszáru visszavét',
    badgeClass: 'bg-teal-50 text-teal-700 border border-teal-200',
  },
  [MovementType.MANUAL_CORRECTION]: {
    label: 'Kézi korrekció',
    badgeClass: 'bg-amber-50 text-amber-700 border border-amber-200',
  },
}

const movementTypeOptions: { value: MovementType; label: string }[] = Object.values(
  MovementType,
).map((value) => ({
  value,
  label: MOVEMENT_TYPE_META[value].label,
}))

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
  () =>
    debouncedSearch.value.length > 0 ||
    locationFilter.value.length > 0 ||
    typeFilter.value.length > 0,
)

function isCanceledError(err: unknown): boolean {
  const e = err as { code?: string; name?: string }
  return e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || e?.name === 'AbortError'
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('hu-HU', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatLocationPath(item: StockMovementEntry): string {
  const path = getLocationPath(item.locationId, locationById.value)
  if (path.length > 0) {
    return path.map((p) => p.name).join(' › ')
  }
  return item.location.name
}

function formatSignedQty(qty: number): string {
  return qty > 0 ? `+${qty} db` : `${qty} db`
}

async function loadMovements() {
  if (activeAbortController) {
    activeAbortController.abort()
  }
  const controller = new AbortController()
  activeAbortController = controller

  loading.value = true
  try {
    const skip = (currentPage.value - 1) * pageSize
    const res = await stockApi.getMovements(
      {
        search: debouncedSearch.value || undefined,
        locationId: locationFilter.value || undefined,
        type: typeFilter.value || undefined,
        skip,
        take: pageSize,
      },
      controller.signal,
    )
    movements.value = res.data.items
    totalRecords.value = res.data.total
  } catch (err) {
    if (isCanceledError(err)) return
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a készletmozgási naplót.'),
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
      void loadMovements()
    }
  }, 300)
})

function triggerImmediateSearch() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debouncedSearch.value = searchInput.value.trim()
  currentPage.value = 1
  void loadMovements()
}

watch([locationFilter, typeFilter], () => {
  currentPage.value = 1
  void loadMovements()
})

function onPage(event: DataTablePageEvent) {
  currentPage.value = event.page + 1
  void loadMovements()
}

function resetFilters() {
  if (debounceTimer) clearTimeout(debounceTimer)
  searchInput.value = ''
  debouncedSearch.value = ''
  locationFilter.value = ''
  typeFilter.value = ''
  currentPage.value = 1
  void loadMovements()
}

onMounted(() => {
  void loadMovements()
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (activeAbortController) activeAbortController.abort()
})
</script>

<template>
  <div class="space-y-5 text-[#171918]">
    <!-- Kártya: Szűrők + Lazy DataTable -->
    <div class="bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#e8eae6]">
        <div class="flex flex-wrap items-center gap-2.5 flex-1">
          <div class="relative flex-1 min-w-[220px] max-w-sm">
            <i class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"></i>
            <input
              v-model="searchInput"
              type="text"
              placeholder="Termék, SKU, vonalkód, pozíció vagy megjegyzés..."
              @keydown.enter.prevent="triggerImmediateSearch"
              class="w-full h-[38px] bg-white border border-white rounded-[10px] pl-9 pr-3 text-[12px] text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]/40 transition"
            />
          </div>

          <select
            v-model="locationFilter"
            class="h-[38px] max-w-xs bg-white border border-white rounded-[10px] px-3 text-[12px] text-[#171918] outline-none cursor-pointer"
          >
            <option value="">Minden pozíció</option>
            <option v-for="opt in locationFilterOptions" :key="opt.id" :value="opt.id">
              {{ opt.label }}
            </option>
          </select>

          <select
            v-model="typeFilter"
            class="h-[38px] bg-white border border-white rounded-[10px] px-3 text-[12px] text-[#171918] outline-none cursor-pointer"
          >
            <option value="">Minden mozgástípus</option>
            <option v-for="opt in movementTypeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </div>

        <div class="flex items-center gap-3">
          <span class="bg-[#e9ece7] text-[#171918] text-[11px] font-medium px-2.5 py-1 rounded-[7px]">
            {{ totalRecords }} mozgás
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
            @click="loadMovements"
            class="text-xs text-[#686f6a] hover:text-[#171918] flex items-center gap-1.5 cursor-pointer transition"
          >
            <i :class="['pi pi-refresh text-xs', loading ? 'animate-spin' : '']"></i>
            <span>Frissítés</span>
          </button>
        </div>
      </div>

      <DataTable
        :value="movements"
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
            Nincs a szűrésnek megfelelő készletmozgás.
          </div>
        </template>

        <Column header="Időpont">
          <template #body="{ data }: { data: StockMovementEntry }">
            <span class="text-xs text-[#4c534e] whitespace-nowrap">
              {{ formatDateTime(data.createdAt) }}
            </span>
          </template>
        </Column>

        <Column header="Típus">
          <template #body="{ data }: { data: StockMovementEntry }">
            <span
              :class="[
                'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap',
                MOVEMENT_TYPE_META[data.type].badgeClass,
              ]"
            >
              {{ MOVEMENT_TYPE_META[data.type].label }}
            </span>
          </template>
        </Column>

        <Column header="Termék & Variáns">
          <template #body="{ data }: { data: StockMovementEntry }">
            <div class="min-w-[180px]">
              <p class="font-semibold text-[#171918]">
                {{ data.variant.product?.name ?? 'Ismeretlen termék' }}
              </p>
              <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-[#686f6a] mt-0.5">
                <span class="font-mono text-[#171918] font-medium">{{ data.variant.sku }}</span>
                <template v-if="data.variant.size">
                  <span>·</span>
                  <span class="bg-[#eff1ed] text-[#171918] font-semibold px-1.5 py-0.5 rounded">
                    {{ data.variant.size }}
                  </span>
                </template>
                <span v-if="data.variant.colors.length > 0">
                  {{ data.variant.colors.join(', ') }}
                </span>
              </div>
            </div>
          </template>
        </Column>

        <Column header="Pozíció">
          <template #body="{ data }: { data: StockMovementEntry }">
            <span class="text-xs font-medium text-[#171918] min-w-[180px] block">
              {{ formatLocationPath(data) }}
            </span>
          </template>
        </Column>

        <Column header="Mennyiség">
          <template #body="{ data }: { data: StockMovementEntry }">
            <span
              class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold whitespace-nowrap"
              :class="
                data.quantity > 0
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-rose-50 text-rose-600 border border-rose-200'
              "
            >
              {{ formatSignedQty(data.quantity) }}
            </span>
          </template>
        </Column>

        <Column header="Felhasználó">
          <template #body="{ data }: { data: StockMovementEntry }">
            <span class="text-xs text-[#171918] whitespace-nowrap">
              {{ data.createdByUser?.name ?? '—' }}
            </span>
          </template>
        </Column>

        <Column header="Megjegyzés">
          <template #body="{ data }: { data: StockMovementEntry }">
            <span class="text-xs text-[#686f6a] max-w-[220px] block truncate" :title="data.note ?? undefined">
              {{ data.note || '—' }}
            </span>
          </template>
        </Column>
      </DataTable>
    </div>
  </div>
</template>
