<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { LocationType, Role } from '@wmanager/shared-types'
import ToggleSwitch from 'primevue/toggleswitch'
import { useToast } from 'primevue/usetoast'
import { locationApi, type LocationItem } from '@/api/locations'
import { useAuthStore } from '@/stores/auth'
import { extractApiError, LOCATION_TYPE_META } from '@/utils/locationMeta'

interface SiteRoutingRow {
  id: string
  name: string
  type: LocationType
  canFulfillWebshop: boolean
  fulfillmentPriority: number
  priorityInput: number
}

const authStore = useAuthStore()
const toast = useToast()

const isBossOrAdmin = computed(() => {
  const role = authStore.user?.role
  return role === Role.BOSS || role === Role.ADMIN
})

const sites = ref<SiteRoutingRow[]>([])
const loading = ref(false)
const savingId = ref<string | null>(null)

function sortSiteRows(rows: SiteRoutingRow[]): SiteRoutingRow[] {
  return [...rows].sort((a, b) => {
    if (a.fulfillmentPriority !== b.fulfillmentPriority) {
      return a.fulfillmentPriority - b.fulfillmentPriority
    }
    const typeA = a.type === LocationType.WAREHOUSE ? 0 : 1
    const typeB = b.type === LocationType.WAREHOUSE ? 0 : 1
    if (typeA !== typeB) return typeA - typeB
    return a.name.localeCompare(b.name, 'hu')
  })
}

const primaryWebshopSiteId = computed(
  () => sites.value.find((site) => site.canFulfillWebshop)?.id ?? null,
)

async function loadSites() {
  if (!isBossOrAdmin.value) return
  loading.value = true
  try {
    const res = await locationApi.getAll()
    const mapped: SiteRoutingRow[] = res.data
      .filter(
        (loc: LocationItem) =>
          loc.isActive &&
          (loc.type === LocationType.WAREHOUSE || loc.type === LocationType.STORE),
      )
      .map((loc: LocationItem) => {
        const defaultPriority = loc.type === LocationType.WAREHOUSE ? 10 : 100
        const prio =
          typeof loc.fulfillmentPriority === 'number' && loc.fulfillmentPriority >= 1
            ? loc.fulfillmentPriority
            : defaultPriority
        return {
          id: loc.id,
          name: loc.name,
          type: loc.type,
          canFulfillWebshop: loc.canFulfillWebshop ?? true,
          fulfillmentPriority: prio,
          priorityInput: prio,
        }
      })

    sites.value = sortSiteRows(mapped)
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a telephelyek prioritását.'),
      life: 4500,
    })
  } finally {
    loading.value = false
  }
}

async function onToggleWebshop(site: SiteRoutingRow, nextValue: boolean) {
  if (!isBossOrAdmin.value || savingId.value) return
  const prevValue = site.canFulfillWebshop
  site.canFulfillWebshop = nextValue
  savingId.value = site.id
  try {
    const res = await locationApi.update(site.id, { canFulfillWebshop: nextValue })
    site.canFulfillWebshop = res.data.canFulfillWebshop ?? nextValue
    toast.add({
      severity: 'success',
      summary: 'Teljesítési beállítás mentve',
      detail: `${site.name}: webshopos teljesítés ${site.canFulfillWebshop ? 'engedélyezve' : 'letiltva'}.`,
      life: 3000,
    })
  } catch (err) {
    site.canFulfillWebshop = prevValue
    toast.add({
      severity: 'error',
      summary: 'Mentési hiba',
      detail: extractApiError(err, 'Nem sikerült menteni a webshop teljesítési beállítást.'),
      life: 4500,
    })
  } finally {
    savingId.value = null
  }
}

async function savePriority(site: SiteRoutingRow) {
  if (!isBossOrAdmin.value || savingId.value) return
  const parsed = Math.trunc(Number(site.priorityInput))
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 9999) {
    site.priorityInput = site.fulfillmentPriority
    toast.add({
      severity: 'warn',
      summary: 'Érvénytelen prioritás',
      detail: 'A prioritási szám 1 és 9999 közötti egész szám lehet (kisebb szám = magasabb prioritás).',
      life: 3500,
    })
    return
  }

  if (parsed === site.fulfillmentPriority) return

  const prev = site.fulfillmentPriority
  savingId.value = site.id
  try {
    const res = await locationApi.update(site.id, { fulfillmentPriority: parsed })
    const saved = res.data.fulfillmentPriority ?? parsed
    site.fulfillmentPriority = saved
    site.priorityInput = saved
    sites.value = sortSiteRows(sites.value)
    toast.add({
      severity: 'success',
      summary: 'Prioritás mentve',
      detail: `${site.name}: #${saved} prioritás.`,
      life: 3000,
    })
  } catch (err) {
    site.fulfillmentPriority = prev
    site.priorityInput = prev
    toast.add({
      severity: 'error',
      summary: 'Mentési hiba',
      detail: extractApiError(err, 'Nem sikerült menteni a prioritást.'),
      life: 4500,
    })
  } finally {
    savingId.value = null
  }
}

async function moveSite(index: number, delta: -1 | 1) {
  if (!isBossOrAdmin.value || savingId.value) return
  const targetIndex = index + delta
  if (targetIndex < 0 || targetIndex >= sites.value.length) return

  const reordered = [...sites.value]
  const current = reordered[index]!
  const neighbor = reordered[targetIndex]!
  reordered[index] = neighbor
  reordered[targetIndex] = current

  // Tiszta 10-es lépésközű sorrend minden aktív telephelyre, így egyértelmű lesz a rangsor
  const updates = reordered.map((row, idx) => ({
    row,
    nextPriority: (idx + 1) * 10,
  }))

  savingId.value = current.id
  try {
    await Promise.all(
      updates
        .filter((u) => u.row.fulfillmentPriority !== u.nextPriority)
        .map((u) =>
          locationApi.update(u.row.id, { fulfillmentPriority: u.nextPriority }),
        ),
    )

    sites.value = updates.map((u) => ({
      ...u.row,
      fulfillmentPriority: u.nextPriority,
      priorityInput: u.nextPriority,
    }))

    toast.add({
      severity: 'success',
      summary: 'Sorrend frissítve',
      detail: 'A webshop teljesítési prioritás mentésre került.',
      life: 3000,
    })
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Átrendezés sikertelen',
      detail: extractApiError(err, 'Nem sikerült módosítani a telephelyek sorrendjét.'),
      life: 4500,
    })
    await loadSites()
  } finally {
    savingId.value = null
  }
}

onMounted(() => {
  void loadSites()
})
</script>

<template>
  <div
    v-if="isBossOrAdmin"
    class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-7 space-y-4"
  >
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="flex items-start gap-4 min-w-0">
        <div
          class="w-12 h-12 rounded-2xl bg-sky-50 border border-sky-200 text-sky-600 flex items-center justify-center shrink-0"
        >
          <i class="pi pi-sitemap text-xl"></i>
        </div>
        <div class="space-y-1">
          <h2 class="text-base font-bold text-[#171918]">
            Webshop teljesítési sorrend & útválasztás
          </h2>
          <p class="text-xs sm:text-sm text-[#686f6a] max-w-3xl leading-relaxed">
            Központi raktár az elsődleges; bolt csak személyes átvételnél vagy akkor teljesít, ha
            kevesebb terméket kell hozzá elküldeni, mint amennyit neki kellene visszaküldenie.
            Rendelést nem bontunk ketté (split nincs). Kisebb prioritási szám = magasabb elsőbbség.
          </p>
        </div>
      </div>

      <button
        type="button"
        :disabled="loading"
        @click="loadSites"
        class="h-9 px-3.5 rounded-xl bg-[#f6f7f5] hover:bg-[#eff1ed] border border-[#e8eae6] text-xs font-semibold text-[#171918] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition shrink-0"
      >
        <i :class="['pi pi-refresh text-xs', loading ? 'animate-spin' : '']"></i>
        <span>Frissítés</span>
      </button>
    </div>

    <div v-if="loading && sites.length === 0" class="py-8 text-center text-xs text-[#686f6a]">
      <i class="pi pi-spin pi-spinner mr-2"></i>
      Telephelyek betöltése...
    </div>

    <div
      v-else-if="sites.length === 0"
      class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 p-6 text-center text-xs text-slate-500"
    >
      Nincs aktív raktár vagy üzlet rögzítve.
    </div>

    <div v-else class="divide-y divide-[#eff1ed] border border-[#e8eae6] rounded-2xl overflow-hidden">
      <div
        v-for="(site, index) in sites"
        :key="site.id"
        class="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white hover:bg-[#fafbf9] transition"
      >
        <div class="flex items-center gap-3 min-w-0">
          <div class="flex flex-col gap-0.5 shrink-0">
            <button
              type="button"
              :disabled="index === 0 || savingId !== null"
              @click="moveSite(index, -1)"
              title="Előrébb sorolás"
              class="w-6 h-5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <i class="pi pi-chevron-up text-[10px]"></i>
            </button>
            <button
              type="button"
              :disabled="index === sites.length - 1 || savingId !== null"
              @click="moveSite(index, 1)"
              title="Hátrébb sorolás"
              class="w-6 h-5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center justify-center cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed transition"
            >
              <i class="pi pi-chevron-down text-[10px]"></i>
            </button>
          </div>

          <div class="min-w-0 space-y-0.5">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold text-sm text-[#171918]">{{ site.name }}</span>
              <span
                class="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200"
              >
                {{ LOCATION_TYPE_META[site.type].label }}
              </span>
              <span
                v-if="site.id === primaryWebshopSiteId"
                class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200"
              >
                #1 Elsődleges
              </span>
              <span
                v-else-if="!site.canFulfillWebshop"
                class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200"
              >
                Csak személyes átvétel
              </span>
            </div>
            <p class="text-[11px] text-[#686f6a]">
              Aktuális prioritás: <span class="font-mono font-semibold text-[#171918]">#{{ site.fulfillmentPriority }}</span>
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-4 shrink-0">
          <div class="flex items-center gap-2">
            <ToggleSwitch
              :modelValue="site.canFulfillWebshop"
              :disabled="savingId !== null"
              :inputId="`webshop-fulfill-${site.id}`"
              @update:modelValue="onToggleWebshop(site, $event)"
            />
            <label
              :for="`webshop-fulfill-${site.id}`"
              class="text-xs font-medium text-[#171918] cursor-pointer select-none"
            >
              Webshop csomagküldés
            </label>
          </div>

          <div class="flex items-center gap-1.5">
            <label class="text-[11px] font-semibold text-[#686f6a]">Prioritás:</label>
            <input
              v-model.number="site.priorityInput"
              type="number"
              min="1"
              max="9999"
              step="1"
              :disabled="savingId !== null"
              @keydown.enter.prevent="savePriority(site)"
              class="w-20 h-8 rounded-lg border border-[#dce0d8] px-2 text-xs font-mono font-semibold text-center outline-none focus:border-[#f46714]"
            />
            <button
              type="button"
              :disabled="savingId !== null || site.priorityInput === site.fulfillmentPriority"
              @click="savePriority(site)"
              class="h-8 px-2.5 rounded-lg bg-[#171918] hover:bg-[#2a2d2b] text-white text-[11px] font-semibold cursor-pointer disabled:opacity-40 transition"
            >
              Mentés
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
