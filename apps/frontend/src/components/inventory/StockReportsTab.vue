<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Role } from '@wmanager/shared-types'
import { useAuthStore } from '@/stores/auth'
import type { LocationItem } from '@/api/locations'
import {
  stockApi,
  type StockReportEntry,
  type StockReportStatusType,
} from '@/api/stock'
import { extractApiError, getLocationPath } from '@/utils/locationMeta'
import DataTable from 'primevue/datatable'
import Column from 'primevue/column'
import { useToast } from 'primevue/usetoast'

type StatusFilter = 'PENDING' | 'ALL'

const props = defineProps<{
  allLocations: LocationItem[]
}>()

const emit = defineEmits<{
  (e: 'resolved', report: StockReportEntry): void
}>()

const authStore = useAuthStore()
const toast = useToast()

const reports = ref<StockReportEntry[]>([])
const loading = ref(false)
const resolvingId = ref<string | null>(null)
const statusFilter = ref<StatusFilter>('PENDING')
const searchInput = ref('')
const debouncedSearch = ref('')
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

const isManager = computed(() => {
  const role = authStore.user?.role
  return (
    role === Role.BOSS ||
    role === Role.ADMIN ||
    role === Role.WAREHOUSE_MANAGER ||
    role === Role.STORE_MANAGER
  )
})

const locationById = computed(() => new Map(props.allLocations.map((l) => [l.id, l])))

const STATUS_META: Record<
  StockReportStatusType,
  { label: string; badgeClass: string }
> = {
  PENDING: {
    label: 'Függőben',
    badgeClass: 'bg-amber-50 text-amber-800 border border-amber-200',
  },
  APPROVED: {
    label: 'Jóváhagyva',
    badgeClass: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  },
  REJECTED: {
    label: 'Elutasítva',
    badgeClass: 'bg-rose-50 text-rose-700 border border-rose-200',
  },
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

function formatLocationPath(report: StockReportEntry): string {
  const path = getLocationPath(report.locationId, locationById.value)
  if (path.length > 0) {
    return path.map((p) => p.name).join(' › ')
  }
  return report.location?.name ?? '—'
}

function formatDiff(report: StockReportEntry): string {
  const diff = report.foundQuantity - report.expectedQuantity
  return diff > 0 ? `+${diff} db` : `${diff} db`
}

async function loadReports() {
  loading.value = true
  try {
    const res = await stockApi.getReports({
      ...(statusFilter.value === 'PENDING' ? { status: 'PENDING' } : {}),
      ...(debouncedSearch.value ? { search: debouncedSearch.value } : {}),
    })
    reports.value = res.data
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni az eltérés-jelentéseket.'),
      life: 5000,
    })
  } finally {
    loading.value = false
  }
}

async function resolveReport(report: StockReportEntry, action: 'APPROVE' | 'REJECT') {
  resolvingId.value = report.id
  try {
    const res = await stockApi.resolveReport(report.id, { action })
    toast.add({
      severity: 'success',
      summary: action === 'APPROVE' ? 'Jelentés jóváhagyva' : 'Jelentés elutasítva',
      detail:
        action === 'APPROVE'
          ? `${report.variant.sku} készlete frissítve (${report.foundQuantity} db).`
          : `${report.variant.sku} jelentése elutasítva, a készlet változatlan maradt.`,
      life: 4500,
    })
    emit('resolved', res.data)
    await loadReports()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Elbírálási hiba',
      detail: extractApiError(err, 'Nem sikerült elbírálni az eltérés-jelentést.'),
      life: 5000,
    })
  } finally {
    resolvingId.value = null
  }
}

watch(statusFilter, () => {
  void loadReports()
})

watch(searchInput, (val) => {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = setTimeout(() => {
    const trimmed = val.trim()
    if (debouncedSearch.value !== trimmed) {
      debouncedSearch.value = trimmed
      void loadReports()
    }
  }, 300)
})

function triggerImmediateSearch() {
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  debouncedSearch.value = searchInput.value.trim()
  void loadReports()
}

onMounted(() => {
  void loadReports()
})

onBeforeUnmount(() => {
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
    searchDebounceTimer = null
  }
})
</script>

<template>
  <div class="space-y-5 text-[#171918]">
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h2 class="text-[24px] font-semibold tracking-[-0.32px] text-[#171918] leading-tight">
          Hiány és eltérés-jelentések
        </h2>
        <p class="text-[13px] text-[#686f6a] mt-1">
          Dolgozók által beküldött polckészlet-eltérések listája és vezetői jóváhagyása.
        </p>
      </div>
    </div>

    <div class="bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs space-y-4">
      <!-- Szűrő sáv -->
      <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#e8eae6]">
        <div class="flex flex-wrap items-center gap-2.5 flex-1">
          <div class="inline-flex items-center bg-white border border-[#e5e8e1] rounded-[11px] p-1 gap-1">
            <button
              type="button"
              @click="statusFilter = 'PENDING'"
              class="h-[32px] px-3 rounded-[8px] text-xs font-semibold transition cursor-pointer"
              :class="
                statusFilter === 'PENDING'
                  ? 'bg-[#171918] text-white'
                  : 'text-[#686f6a] hover:text-[#171918]'
              "
            >
              Függőben (PENDING)
            </button>
            <button
              type="button"
              @click="statusFilter = 'ALL'"
              class="h-[32px] px-3 rounded-[8px] text-xs font-semibold transition cursor-pointer"
              :class="
                statusFilter === 'ALL'
                  ? 'bg-[#171918] text-white'
                  : 'text-[#686f6a] hover:text-[#171918]'
              "
            >
              Összes
            </button>
          </div>

          <div class="relative flex-1 min-w-[220px] max-w-sm">
            <i class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"></i>
            <input
              v-model="searchInput"
              type="text"
              placeholder="Termék, SKU, vonalkód, pozíció vagy ok..."
              @keydown.enter.prevent="triggerImmediateSearch"
              class="w-full h-[38px] bg-white border border-white rounded-[10px] pl-9 pr-3 text-[12px] text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]/40 transition"
            />
          </div>
        </div>

        <div class="flex items-center gap-3">
          <span class="bg-[#e9ece7] text-[#171918] text-[11px] font-medium px-2.5 py-1 rounded-[7px]">
            {{ reports.length }} jelentés
          </span>
          <button
            type="button"
            @click="loadReports"
            class="text-xs text-[#686f6a] hover:text-[#171918] flex items-center gap-1.5 cursor-pointer transition"
          >
            <i :class="['pi pi-refresh text-xs', loading ? 'animate-spin' : '']"></i>
            <span>Frissítés</span>
          </button>
        </div>
      </div>

      <DataTable
        :value="reports"
        :paginator="reports.length > 20"
        :rows="20"
        :loading="loading"
        dataKey="id"
        responsiveLayout="scroll"
        class="text-[13px]"
      >
        <template #empty>
          <div class="py-12 text-center text-sm text-[#686f6a]">
            {{
              statusFilter === 'PENDING'
                ? 'Nincs függőben lévő hiány- vagy eltérés-jelentés.'
                : 'Még nem érkezett egyetlen eltérés-jelentés sem.'
            }}
          </div>
        </template>

        <Column header="Bejelentve">
          <template #body="{ data }: { data: StockReportEntry }">
            <span class="text-xs text-[#4c534e] whitespace-nowrap">
              {{ formatDateTime(data.createdAt) }}
            </span>
          </template>
        </Column>

        <Column header="Termék & Variáns">
          <template #body="{ data }: { data: StockReportEntry }">
            <div class="min-w-[180px]">
              <p class="font-semibold text-[#171918]">
                {{ data.variant.product?.name ?? 'Ismeretlen termék' }}
              </p>
              <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-[#686f6a] mt-0.5">
                <span class="font-mono font-semibold text-[#171918]">{{ data.variant.sku }}</span>
                <template v-if="data.variant.size">
                  <span>·</span>
                  <span class="bg-[#eff1ed] text-[#171918] font-semibold px-1.5 py-0.5 rounded">
                    {{ data.variant.size }}
                  </span>
                </template>
              </div>
            </div>
          </template>
        </Column>

        <Column header="Pozíció">
          <template #body="{ data }: { data: StockReportEntry }">
            <span class="text-xs font-medium text-[#171918] min-w-[170px] block">
              {{ formatLocationPath(data) }}
            </span>
          </template>
        </Column>

        <Column header="Várt vs. Talált">
          <template #body="{ data }: { data: StockReportEntry }">
            <div class="space-y-1 whitespace-nowrap">
              <div class="text-xs text-[#4c534e]">
                Várt: <strong class="text-[#171918]">{{ data.expectedQuantity }} db</strong>
                <span class="mx-1 text-[#9aa197]">→</span>
                Talált: <strong class="text-[#171918]">{{ data.foundQuantity }} db</strong>
              </div>
              <span
                class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold"
                :class="
                  data.foundQuantity - data.expectedQuantity < 0
                    ? 'bg-rose-50 text-rose-600 border border-rose-200'
                    : data.foundQuantity - data.expectedQuantity > 0
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                      : 'bg-slate-100 text-slate-700 border border-slate-200'
                "
              >
                Eltérés: {{ formatDiff(data) }}
              </span>
            </div>
          </template>
        </Column>

        <Column header="Indoklás">
          <template #body="{ data }: { data: StockReportEntry }">
            <div class="max-w-[230px] space-y-0.5">
              <p class="text-xs text-[#171918]">{{ data.reason }}</p>
              <p v-if="data.resolutionNote" class="text-[11px] text-[#686f6a]">
                Elbírálás: {{ data.resolutionNote }}
              </p>
            </div>
          </template>
        </Column>

        <Column header="Bejelentő">
          <template #body="{ data }: { data: StockReportEntry }">
            <div class="text-xs whitespace-nowrap">
              <p class="font-medium text-[#171918]">{{ data.reportedByUser?.name ?? '—' }}</p>
              <p v-if="data.resolvedByUser" class="text-[11px] text-[#686f6a]">
                Elbírálta: {{ data.resolvedByUser.name }}
              </p>
            </div>
          </template>
        </Column>

        <Column header="Állapot">
          <template #body="{ data }: { data: StockReportEntry }">
            <span
              :class="[
                'inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap',
                STATUS_META[data.status].badgeClass,
              ]"
            >
              {{ STATUS_META[data.status].label }}
            </span>
          </template>
        </Column>

        <Column v-if="isManager" header="Elbírálás" bodyClass="text-right" headerClass="text-right">
          <template #body="{ data }: { data: StockReportEntry }">
            <div v-if="data.status === 'PENDING'" class="inline-flex items-center gap-1.5">
              <button
                type="button"
                :disabled="resolvingId === data.id"
                @click="resolveReport(data, 'APPROVE')"
                class="h-[30px] px-2.5 rounded-[8px] bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[11px] font-semibold transition cursor-pointer whitespace-nowrap"
              >
                Jóváhagyás (Készlet → {{ data.foundQuantity }} db)
              </button>
              <button
                type="button"
                :disabled="resolvingId === data.id"
                @click="resolveReport(data, 'REJECT')"
                class="h-[30px] px-2.5 rounded-[8px] bg-white border border-rose-200 hover:bg-rose-50 disabled:opacity-50 text-rose-600 text-[11px] font-semibold transition cursor-pointer whitespace-nowrap"
              >
                Elutasítás (Készlet marad)
              </button>
            </div>
            <span v-else class="text-[11px] text-[#9aa197]">—</span>
          </template>
        </Column>
      </DataTable>
    </div>
  </div>
</template>
