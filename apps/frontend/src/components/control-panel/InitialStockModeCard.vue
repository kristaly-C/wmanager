<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Role } from '@wmanager/shared-types'
import { useAuthStore } from '@/stores/auth'
import { stockApi } from '@/api/stock'
import { extractApiError } from '@/utils/locationMeta'
import { useToast } from 'primevue/usetoast'

const authStore = useAuthStore()
const toast = useToast()

const isBossOrAdmin = computed(() => {
  const role = authStore.user?.role
  return role === Role.BOSS || role === Role.ADMIN
})

// Nyitókészlet felvitel mód (INITIAL_STOCK) állapota
const initialStockEnabled = ref(false)
const loadingSettings = ref(false)
const togglingSettings = ref(false)

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

onMounted(async () => {
  if (isBossOrAdmin.value) {
    await loadSettings()
  }
})
</script>

<template>
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
</template>
