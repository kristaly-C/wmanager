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

const isBossOrAdmin = computed(() => {
  const role = authStore.user?.role
  return role === Role.BOSS || role === Role.ADMIN
})

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

// Nyitókészlet felvitel mód (INITIAL_STOCK) állapota
const initialStockEnabled = ref(false)
const loadingSettings = ref(false)
const togglingSettings = ref(false)

// Nyitott hiány / eltérés-jelentések
const pendingReports = ref<StockReportEntry[]>([])
const loadingReports = ref(false)
const resolvingReportId = ref<string | null>(null)

const latestPendingReports = computed(() => pendingReports.value.slice(0, 5))

async function loadSettings() {
  loadingSettings.value = true
  try {
    const res = await stockApi.getSettings()
    initialStockEnabled.value = res.data.initialStockEnabled
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Beállítások betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült lekérni a készletfelviteli módot.'),
      life: 4000,
    })
  } finally {
    loadingSettings.value = false
  }
}

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

async function toggleInitialStockMode() {
  if (!isBossOrAdmin.value || togglingSettings.value) return
  togglingSettings.value = true
  const nextValue = !initialStockEnabled.value
  try {
    const res = await stockApi.updateSettings({ initialStockEnabled: nextValue })
    initialStockEnabled.value = res.data.initialStockEnabled
    toast.add({
      severity: res.data.initialStockEnabled ? 'warn' : 'success',
      summary: res.data.initialStockEnabled
        ? 'Nyitókészlet felvitel aktiválva'
        : 'Nyitókészlet felvitel kikapcsolva',
      detail: res.data.initialStockEnabled
        ? 'A dolgozók mostantól rögzíthetnek kezdeti készletet (INITIAL_STOCK).'
        : 'Normál üzemmód: a készlet csak bevételezéssel, áthelyezéssel vagy jóváhagyott korrekcióval módosítható.',
      life: 4000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Módosítás sikertelen',
      detail: extractApiError(err, 'Nem sikerült módosítani a nyitókészlet felviteli módot.'),
      life: 4500,
    })
  } finally {
    togglingSettings.value = false
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
  const tasks: Promise<void>[] = [loadSettings()]
  if (canViewReports.value) {
    tasks.push(loadPendingReports())
  }
  await Promise.all(tasks)
})

// Moduláris widget adatok (ezeket később adatbázisból is lekérhetjük)
const kpiStats = [
  { label: 'Aktív Rendelések', value: '58', trend: '+2.5%', isUp: true, icon: 'pi pi-box' },
  { label: 'Függő Bevételezés', value: '10', trend: '+1.5%', isUp: true, icon: 'pi pi-truck' },
  { label: 'Raktár Telítettség', value: '86%', trend: '-3.5%', isUp: false, icon: 'pi pi-chart-pie' },
  { label: 'Kiszállítás Alatt', value: '130', trend: '+2.0%', isUp: true, icon: 'pi pi-send' },
]
</script>

<template>
  <div class="max-w-7xl mx-auto space-y-6">
    <!-- Fejléc és moduláris gyors-statisztikák -->
    <div class="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">Áttekintés</h1>
        <p class="text-slate-500 text-sm mt-1">Üdv újra! Itt a mai raktári összesítőd.</p>
      </div>

      <!-- KPI Kártyák (Widgetek) -->
      <div class="flex gap-4 overflow-x-auto pb-2 xl:pb-0">
        <div v-for="stat in kpiStats" :key="stat.label" class="bg-white rounded-2xl p-4 min-w-[200px] border border-slate-200 shadow-sm flex items-center gap-4">
          <div class="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
            <i :class="stat.icon"></i>
          </div>
          <div>
            <p class="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{{ stat.label }}</p>
            <div class="flex items-end gap-2 mt-1">
              <span class="text-xl font-black text-slate-900 leading-none">{{ stat.value }}</span>
              <span :class="['text-xs font-bold px-1.5 py-0.5 rounded-md', stat.isUp ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700']">
                {{ stat.trend }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- BOSS / ADMIN VEZÉRLŐ KÁRTYA: Nyitókészlet felvitel mód (INITIAL_STOCK) -->
    <div
      v-if="isBossOrAdmin"
      class="rounded-3xl border p-5 sm:p-6 shadow-sm transition-colors flex flex-col lg:flex-row lg:items-center justify-between gap-5"
      :class="
        initialStockEnabled
          ? 'bg-amber-50/70 border-amber-200'
          : 'bg-white border-slate-200'
      "
    >
      <div class="flex items-start gap-4 min-w-0">
        <div
          class="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
          :class="
            initialStockEnabled
              ? 'bg-amber-100 text-amber-700 border border-amber-200'
              : 'bg-slate-100 text-slate-600 border border-slate-200'
          "
        >
          <i class="pi pi-sliders-h text-xl"></i>
        </div>

        <div class="space-y-1.5 min-w-0">
          <div class="flex flex-wrap items-center gap-2.5">
            <h2 class="text-base font-bold text-slate-900">
              Nyitókészlet felvitel mód (<code class="font-mono text-sm">INITIAL_STOCK</code>)
            </h2>
            <span
              v-if="loadingSettings"
              class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-500"
            >
              Betöltés...
            </span>
            <span
              v-else-if="initialStockEnabled"
              class="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200"
            >
              <span class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              AKTÍV – Készletfelvitel engedélyezve
            </span>
            <span
              v-else
              class="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200"
            >
              <span class="w-2 h-2 rounded-full bg-slate-400"></span>
              KIKAPCSOLVA – Csak áthelyezés és bevételezés
            </span>
          </div>

          <p class="text-xs sm:text-sm text-slate-600 leading-relaxed max-w-3xl">
            Amikor aktív, a raktári és üzleti dolgozók rögzíthetnek kezdeti nyitókészletet
            (<code class="font-mono text-xs bg-slate-100 px-1 py-0.5 rounded">INITIAL_STOCK</code>).
            Normál napi működés során érdemes kikapcsolva tartani, hogy a készlet kizárólag bevételezéssel,
            áthelyezéssel vagy vezető által jóváhagyott korrekcióval változhasson.
          </p>
        </div>
      </div>

      <div class="shrink-0 flex items-center gap-3 self-end lg:self-center">
        <button
          type="button"
          :disabled="loadingSettings || togglingSettings"
          @click="toggleInitialStockMode"
          class="h-10 px-5 rounded-xl text-sm font-semibold flex items-center gap-2 cursor-pointer transition shadow-sm disabled:opacity-60"
          :class="
            initialStockEnabled
              ? 'bg-slate-900 hover:bg-slate-800 text-white'
              : 'bg-amber-500 hover:bg-amber-600 text-white'
          "
        >
          <i
            :class="
              togglingSettings
                ? 'pi pi-spin pi-spinner text-xs'
                : initialStockEnabled
                  ? 'pi pi-lock text-xs'
                  : 'pi pi-unlock text-xs'
            "
          ></i>
          <span>
            {{ initialStockEnabled ? 'Mód kikapcsolása' : 'Készletfelvitel engedélyezése' }}
          </span>
        </button>
      </div>
    </div>

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

    <!-- Moduláris Grid Rendszer a nagy kártyáknak -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      <!-- FŐ WIDGET (Illusztrációval) -->
      <div class="lg:col-span-2 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col relative">
        <div class="p-6 pb-0 flex justify-between items-start">
          <div>
            <h2 class="font-bold text-slate-900">Kiemelt Szállítmány / Feladat</h2>
            <p class="text-sm text-slate-500">TRK-318 azonosítójú beérkező áru</p>
          </div>
          <button class="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex justify-center items-center text-slate-600 transition">
            <i class="pi pi-ellipsis-h"></i>
          </button>
        </div>
        <!-- Illusztráció helye (később ide jöhet saját 3D render vagy grafika) -->
        <div class="relative h-64 mt-4 bg-gradient-to-br from-slate-50 to-slate-100 flex justify-center items-center">
           <!-- Placeholder egy szép 3D teherautónak vagy doboznak -->
           <img src="https://cdn3d.iconscout.com/3d/premium/thumb/delivery-truck-4993635-4161118.png" alt="Truck" class="h-56 object-contain drop-shadow-2xl z-10" />
           
           <!-- Díszítő háttérelem -->
           <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-orange-400/20 blur-3xl rounded-full"></div>
        </div>
      </div>

      <!-- JOBB OLDALI WIDGET OSZLOP -->
      <div class="space-y-6">
        <!-- Kapacitás Widget -->
        <div class="bg-white/60 rounded-3xl border border-slate-200 shadow-sm p-5 backdrop-blur-xl">
          <h3 class="font-bold text-slate-900 mb-4">Raktár Kapacitás</h3>
          <div class="flex items-center gap-6">
            <div class="relative w-24 h-24 flex items-center justify-center">
              <!-- Ide jöhet egy PrimeVue Knob vagy Chart komponens -->
              <svg class="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                <path class="text-slate-100" stroke-width="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <path class="text-orange-500" stroke-dasharray="68, 100" stroke-width="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              </svg>
              <div class="absolute text-center">
                <span class="text-xl font-black text-slate-900">68%</span>
              </div>
            </div>
            <div>
              <p class="text-xs text-slate-500 uppercase font-bold">Foglalt</p>
              <p class="text-lg font-bold text-slate-900">8.5 ezer</p>
              <p class="text-xs text-slate-500 mt-2 uppercase font-bold">Összesen</p>
              <p class="text-sm font-bold text-slate-900">12.4 ezer</p>
            </div>
          </div>
        </div>

        <!-- Munkatársak Widget -->
        <div class="bg-slate-900 rounded-3xl border border-slate-800 shadow-lg p-6 text-white relative overflow-hidden">
          <div class="absolute right-0 top-0 opacity-10 text-9xl -mt-4 -mr-4 pointer-events-none">
            <i class="pi pi-users"></i>
          </div>
          <h3 class="font-bold mb-1">Műszak Információ</h3>
          <p class="text-sm text-slate-400 mb-4">Jelenleg aktív dolgozók</p>
          <div class="flex items-center gap-3">
             <div class="flex -space-x-3">
               <div class="w-10 h-10 rounded-full border-2 border-slate-900 bg-emerald-500 flex items-center justify-center font-bold">JD</div>
               <div class="w-10 h-10 rounded-full border-2 border-slate-900 bg-blue-500 flex items-center justify-center font-bold">AB</div>
               <div class="w-10 h-10 rounded-full border-2 border-slate-900 bg-orange-500 flex items-center justify-center font-bold">KT</div>
             </div>
             <div class="w-10 h-10 rounded-full border-2 border-slate-900 bg-slate-800 flex items-center justify-center font-bold text-sm">+4</div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>