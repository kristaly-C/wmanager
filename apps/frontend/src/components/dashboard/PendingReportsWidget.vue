<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { Role } from '@wmanager/shared-types'
import { useAuthStore } from '@/stores/auth'
import { stockApi, type StockReportEntry } from '@/api/stock'
import { extractApiError } from '@/utils/locationMeta'
import { useToast } from 'primevue/usetoast'

const authStore = useAuthStore()
const toast = useToast()

const isManager = computed(() => {
  const role = authStore.user?.role
  return (
    role === Role.BOSS ||
    role === Role.ADMIN ||
    role === Role.WAREHOUSE_MANAGER ||
    role === Role.STORE_MANAGER
  )
})

const canViewReports = computed(() => {
  const role = authStore.user?.role
  return Boolean(role && role !== Role.ORDER_CLERK && role !== Role.RMA_CLERK)
})

// Nyitott hiány / eltérés-jelentések
const pendingReports = ref<StockReportEntry[]>([])
const loadingReports = ref(false)
const resolvingReportId = ref<string | null>(null)

const latestPendingReports = computed(() => pendingReports.value.slice(0, 5))

async function loadPendingReports() {
  if (!canViewReports.value) return
  loadingReports.value = true
  try {
    const res = await stockApi.getReports({ status: 'PENDING' })
    pendingReports.value = res.data
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Eltérés-jelentések hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a nyitott eltérés-jelentéseket.'),
      life: 4000,
    })
  } finally {
    loadingReports.value = false
  }
}

async function resolveReport(report: StockReportEntry, action: 'APPROVE' | 'REJECT') {
  if (!isManager.value || resolvingReportId.value) return
  resolvingReportId.value = report.id
  try {
    await stockApi.resolveReport(report.id, { action })
    toast.add({
      severity: action === 'APPROVE' ? 'success' : 'info',
      summary: action === 'APPROVE' ? 'Jelentés jóváhagyva' : 'Jelentés elutasítva',
      detail:
        action === 'APPROVE'
          ? `A készlet frissítve lett (${report.foundQuantity} db) a(z) ${report.location?.name ?? 'pozíción'}.`
          : `A jelentés elutasítva, a készlet (${report.expectedQuantity} db) változatlan maradt.`,
      life: 4000,
    })
    await loadPendingReports()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Feldolgozási hiba',
      detail: extractApiError(err, 'Nem sikerült feldolgozni az eltérés-jelentést.'),
      life: 4500,
    })
  } finally {
    resolvingReportId.value = null
  }
}

function formatReportDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('hu-HU', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

onMounted(async () => {
  if (canViewReports.value) {
    await loadPendingReports()
  }
})
</script>

<template>
  <!-- NYITOTT HIÁNY / ELTÉRÉS-JELENTÉSEK WIDGET -->
  <div
    v-if="canViewReports"
    class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 space-y-4"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center">
          <i class="pi pi-exclamation-triangle text-base"></i>
        </div>
        <div>
          <div class="flex items-center gap-2">
            <h2 class="font-bold text-slate-900">Nyitott Hiány / Eltérés-jelentések</h2>
            <span
              class="text-xs font-extrabold px-2.5 py-0.5 rounded-full"
              :class="
                pendingReports.length > 0
                  ? 'bg-amber-100 text-amber-800 border border-amber-200'
                  : 'bg-slate-100 text-slate-600'
              "
            >
              {{ pendingReports.length }} függőben
            </span>
          </div>
          <p class="text-xs text-slate-500">
            Dolgozók által jelzett polchi hiányok és készleteltérések (legutóbbi 5 nyitott tétel)
          </p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <button
          type="button"
          :disabled="loadingReports"
          @click="loadPendingReports"
          class="h-9 px-3 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-600 flex items-center gap-1.5 cursor-pointer transition"
        >
          <i :class="['pi pi-refresh text-xs', loadingReports ? 'animate-spin' : '']"></i>
          <span>Frissítés</span>
        </button>
        <RouterLink
          to="/inventory"
          class="h-9 px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold flex items-center gap-1.5 transition"
        >
          <span>Összes megtekintése</span>
          <i class="pi pi-arrow-right text-[11px]"></i>
        </RouterLink>
      </div>
    </div>

    <div v-if="loadingReports && pendingReports.length === 0" class="py-8 text-center text-xs text-slate-400">
      <i class="pi pi-spin pi-spinner mr-1.5"></i> Jelentések betöltése...
    </div>

    <div
      v-else-if="latestPendingReports.length === 0"
      class="py-8 px-4 text-center rounded-2xl bg-slate-50/70 border border-dashed border-slate-200 text-xs text-slate-500"
    >
      <i class="pi pi-check-circle text-xl text-emerald-500 block mb-1.5"></i>
      Jelenleg nincs függőben lévő hiány- vagy eltérés-jelentés.
    </div>

    <div v-else class="divide-y divide-slate-100">
      <div
        v-for="report in latestPendingReports"
        :key="report.id"
        class="py-3.5 first:pt-1 last:pb-1 flex flex-col lg:flex-row lg:items-center justify-between gap-3"
      >
        <div class="space-y-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-bold text-sm text-slate-900">
              {{ report.variant?.product?.name ?? report.variant?.sku ?? 'Termék' }}
            </span>
            <span class="text-xs font-mono px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
              {{ report.variant?.sku }}
            </span>
            <span
              v-if="report.variant?.size"
              class="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600"
            >
              {{ report.variant.size }}
            </span>
            <span class="text-xs font-semibold px-2 py-0.5 rounded-md bg-orange-50 text-orange-700 border border-orange-200">
              <i class="pi pi-map-marker text-[10px] mr-1"></i>{{ report.location?.name ?? report.locationId }}
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            <span class="font-semibold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
              Várt: {{ report.expectedQuantity }} db → Talált: {{ report.foundQuantity }} db
            </span>
            <span class="text-slate-700">„{{ report.reason }}”</span>
            <span class="text-slate-400">
              Jelentette: <b class="text-slate-600">{{ report.reportedByUser?.name ?? '—' }}</b> · {{ formatReportDate(report.createdAt) }}
            </span>
          </div>
        </div>

        <div v-if="isManager" class="flex items-center gap-2 shrink-0 self-end lg:self-center">
          <button
            type="button"
            :disabled="resolvingReportId === report.id"
            @click="resolveReport(report, 'APPROVE')"
            class="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition"
          >
            <i
              :class="
                resolvingReportId === report.id
                  ? 'pi pi-spin pi-spinner text-[11px]'
                  : 'pi pi-check text-[11px]'
              "
            ></i>
            <span>Jóváhagyás</span>
          </button>
          <button
            type="button"
            :disabled="resolvingReportId === report.id"
            @click="resolveReport(report, 'REJECT')"
            class="h-8 px-3 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 disabled:opacity-60 text-rose-600 text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition"
          >
            <i class="pi pi-times text-[11px]"></i>
            <span>Elutasítás</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
