<script setup lang="ts">
import { computed, ref } from 'vue'
import { LocationType, SlotMode } from '@wmanager/shared-types'
import { locationApi, type LocationItem } from '@/api/locations'
import {
  LOCATION_TYPE_META,
  SLOT_MODE_META,
  extractApiError,
  getLocationPath,
  supportsSlotMode,
} from '@/utils/locationMeta'
import { formatDateTime } from '@/utils/formatters'
import StatKpiCard from '@/components/common/StatKpiCard.vue'
import ConfirmDeleteDialog from '@/components/common/ConfirmDeleteDialog.vue'
import { useToast } from 'primevue/usetoast'

interface FlatTreeRow {
  location: LocationItem
  depth: number
  hasChildren: boolean
  directChildCount: number
  isExpanded: boolean
  isDirectMatch: boolean
}

const props = defineProps<{
  locations: LocationItem[]
  loading: boolean
  canCreateRoot: boolean
  canManageLocations: boolean
  canAdjustStock: boolean
  selectedLocationId: string
  expandedIds: Set<string>
}>()

const emit = defineEmits<{
  (e: 'update:selectedLocationId', value: string): void
  (e: 'update:expandedIds', value: Set<string>): void
  (e: 'refresh'): void
  (e: 'openCreateRoot'): void
  (e: 'openQuickCreateChild', loc: LocationItem): void
  (e: 'openEdit', loc: LocationItem): void
  (e: 'openBulk', parent: LocationItem | null): void
  (e: 'openStockAdjust', locationId: string): void
  (e: 'deleted', parentId: string | null): void
}>()

const toast = useToast()

const actionLoading = ref(false)
const isDeleteConfirmOpen = ref(false)

// Szűrők
const searchQuery = ref('')
const typeFilter = ref<'ALL' | LocationType>('ALL')
const statusFilter = ref<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL')
const slotModeFilter = ref<'ALL' | SlotMode>('ALL')

const locationById = computed(() => new Map(props.locations.map((l) => [l.id, l])))

const childrenByParentId = computed(() => {
  const map = new Map<string | null, LocationItem[]>()
  for (const loc of props.locations) {
    const key = loc.parentId ?? null
    const list = map.get(key)
    if (list) {
      list.push(loc)
    } else {
      map.set(key, [loc])
    }
  }
  for (const list of map.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, 'hu', { numeric: true }))
  }
  return map
})

const hasActiveFilters = computed(
  () =>
    searchQuery.value.trim().length > 0 ||
    typeFilter.value !== 'ALL' ||
    statusFilter.value !== 'ALL' ||
    slotModeFilter.value !== 'ALL',
)

const filterSets = computed(() => {
  if (!hasActiveFilters.value) {
    return null
  }
  const q = searchQuery.value.trim().toLowerCase()
  const directMatches = new Set<string>()
  const visibleWithAncestors = new Set<string>()

  for (const loc of props.locations) {
    const matchesSearch =
      !q ||
      loc.name.toLowerCase().includes(q) ||
      (loc.description?.toLowerCase().includes(q) ?? false)
    const matchesType = typeFilter.value === 'ALL' || loc.type === typeFilter.value
    const matchesStatus =
      statusFilter.value === 'ALL' ||
      (statusFilter.value === 'ACTIVE' && loc.isActive) ||
      (statusFilter.value === 'INACTIVE' && !loc.isActive)
    const matchesSlot = slotModeFilter.value === 'ALL' || loc.slotMode === slotModeFilter.value

    if (matchesSearch && matchesType && matchesStatus && matchesSlot) {
      directMatches.add(loc.id)
      let current: LocationItem | undefined = loc
      const seen = new Set<string>()
      while (current && !seen.has(current.id)) {
        seen.add(current.id)
        visibleWithAncestors.add(current.id)
        current = current.parentId ? locationById.value.get(current.parentId) : undefined
      }
    }
  }

  return { directMatches, visibleWithAncestors }
})

const visibleRows = computed<FlatTreeRow[]>(() => {
  const rows: FlatTreeRow[] = []
  const filters = filterSets.value

  const walk = (parentId: string | null, depth: number) => {
    const children = childrenByParentId.value.get(parentId) ?? []
    for (const loc of children) {
      if (filters && !filters.visibleWithAncestors.has(loc.id)) {
        continue
      }
      const allDirectChildren = childrenByParentId.value.get(loc.id) ?? []
      const visibleChildren = filters
        ? allDirectChildren.filter((c) => filters.visibleWithAncestors.has(c.id))
        : allDirectChildren

      const hasChildren = visibleChildren.length > 0
      const isExpanded = filters ? hasChildren : props.expandedIds.has(loc.id)

      rows.push({
        location: loc,
        depth,
        hasChildren: allDirectChildren.length > 0,
        directChildCount: allDirectChildren.length,
        isExpanded,
        isDirectMatch: filters ? filters.directMatches.has(loc.id) : true,
      })

      if (hasChildren && isExpanded) {
        walk(loc.id, depth + 1)
      }
    }
  }

  walk(null, 0)
  return rows
})

const selectedLocation = computed<LocationItem | null>(() => {
  if (props.selectedLocationId) {
    const found = locationById.value.get(props.selectedLocationId)
    if (found) return found
  }
  return visibleRows.value[0]?.location ?? props.locations[0] ?? null
})

const selectedPath = computed(() => {
  if (!selectedLocation.value) return []
  return getLocationPath(selectedLocation.value.id, locationById.value)
})

const selectedDirectChildren = computed(() => {
  if (!selectedLocation.value) return []
  return childrenByParentId.value.get(selectedLocation.value.id) ?? []
})

// 4 Felső Mutató (KPI)
const warehousesCount = computed(
  () => props.locations.filter((l) => l.type === LocationType.WAREHOUSE).length,
)
const storesCount = computed(
  () => props.locations.filter((l) => l.type === LocationType.STORE).length,
)
const zonesAndShelvesCount = computed(
  () =>
    props.locations.filter(
      (l) => l.type === LocationType.ZONE || l.type === LocationType.SHELF,
    ).length,
)
const zonesCount = computed(
  () => props.locations.filter((l) => l.type === LocationType.ZONE).length,
)
const shelvesCount = computed(
  () => props.locations.filter((l) => l.type === LocationType.SHELF).length,
)
const binsCount = computed(
  () => props.locations.filter((l) => l.type === LocationType.BIN).length,
)
const dedicatedCount = computed(
  () => props.locations.filter((l) => l.slotMode === SlotMode.DEDICATED).length,
)
const activeCount = computed(() => props.locations.filter((l) => l.isActive).length)
const activePercentage = computed(() => {
  if (props.locations.length === 0) return '0%'
  return `${Math.round((activeCount.value / props.locations.length) * 100)}%`
})

const anyBranchParentsExist = computed(() =>
  props.locations.some(
    (l) => l.isAssigned !== false && LOCATION_TYPE_META[l.type].childType !== null,
  ),
)

const allExpandableExpanded = computed(() => {
  const expandable = props.locations.filter(
    (l) => (childrenByParentId.value.get(l.id)?.length ?? 0) > 0,
  )
  return expandable.length > 0 && expandable.every((l) => props.expandedIds.has(l.id))
})

function toggleExpand(id: string) {
  const next = new Set(props.expandedIds)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  emit('update:expandedIds', next)
}

function toggleExpandAll() {
  if (allExpandableExpanded.value) {
    emit('update:expandedIds', new Set())
    return
  }
  const allParents = new Set<string>()
  for (const loc of props.locations) {
    if ((childrenByParentId.value.get(loc.id)?.length ?? 0) > 0) {
      allParents.add(loc.id)
    }
  }
  emit('update:expandedIds', allParents)
}

function resetFilters() {
  searchQuery.value = ''
  typeFilter.value = 'ALL'
  statusFilter.value = 'ALL'
  slotModeFilter.value = 'ALL'
}

async function handleToggleActive(location: LocationItem) {
  actionLoading.value = true
  try {
    const res = await locationApi.update(location.id, { isActive: !location.isActive })
    toast.add({
      severity: 'success',
      summary: res.data.isActive ? 'Aktiválva' : 'Inaktiválva',
      detail: `„${res.data.name}” mostantól ${res.data.isActive ? 'aktív' : 'inaktív'}.`,
      life: 3500,
    })
    emit('refresh')
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Hiba történt',
      detail: extractApiError(err, 'Nem sikerült módosítani a pozíció állapotát.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

async function handleDeleteSelected() {
  const target = selectedLocation.value
  if (!target) return
  actionLoading.value = true
  try {
    await locationApi.remove(target.id)
    isDeleteConfirmOpen.value = false
    toast.add({
      severity: 'success',
      summary: 'Törölve',
      detail: `„${target.name}” sikeresen törölve.`,
      life: 3500,
    })
    emit('deleted', target.parentId ?? null)
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Nem törölhető',
      detail: extractApiError(
        err,
        'A pozíció nem törölhető, mert al-lokációk vagy készletadatok hivatkoznak rá. Használd inkább az Inaktiválás gombot!',
      ),
      life: 6000,
    })
  } finally {
    actionLoading.value = false
  }
}
</script>

<template>
  <div class="space-y-6 text-[#171918]">
    <!-- 1. OLDALFEJLÉC -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-[30px] font-semibold tracking-[-0.42px] text-[#171918] leading-tight">
          Raktárak és pozíciók
        </h1>
        <p class="text-[14px] text-[#686f6a] mt-1 tracking-[-0.196px]">
          Raktárak, üzletek és tárolóhelyek (Zóna → Polc → Rekesz) hierarchikus kezelése.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          @click="toggleExpandAll"
          class="bg-white hover:bg-[#f8f9f7] border border-white h-[42px] px-4 rounded-[12px] text-[13px] font-medium text-[#171918] flex items-center gap-2 shadow-xs transition cursor-pointer"
        >
          <i :class="[allExpandableExpanded ? 'pi pi-minus-circle' : 'pi pi-plus-circle', 'text-sm text-[#686f6a]']"></i>
          <span>{{ allExpandableExpanded ? 'Összes becsukása' : 'Összes kinyitása' }}</span>
        </button>

        <button
          v-if="canManageLocations && anyBranchParentsExist"
          type="button"
          @click="emit('openBulk', selectedLocation)"
          class="bg-white hover:bg-[#f8f9f7] border border-white h-[42px] px-4 rounded-[12px] text-[13px] font-medium text-[#171918] flex items-center gap-2 shadow-xs transition cursor-pointer"
        >
          <i class="pi pi-table text-sm text-[#f46714]"></i>
          <span>Tömeges generálás</span>
        </button>

        <button
          v-if="canCreateRoot"
          type="button"
          @click="emit('openCreateRoot')"
          class="bg-[#171918] hover:bg-[#2a2d2b] border border-white h-[42px] px-4 rounded-[12px] text-[13px] font-medium text-white flex items-center gap-2 shadow-xs transition cursor-pointer"
        >
          <i class="pi pi-plus text-sm text-white"></i>
          <span>Új raktár / üzlet</span>
        </button>
      </div>
    </div>

    <!-- 2. NÉGY MUTATÓ KÁRTYA -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
      <StatKpiCard
        label="Raktárak és üzletek"
        :value="warehousesCount + storesCount"
        :subtext="`${warehousesCount} raktár · ${storesCount} üzlet`"
        icon="pi pi-warehouse"
        iconClass="text-[#171918]"
      />
      <StatKpiCard
        label="Zónák és polcok"
        :value="zonesAndShelvesCount"
        :subtext="`${zonesCount} zóna · ${shelvesCount} polc`"
        icon="pi pi-th-large"
        iconClass="text-blue-600"
      />
      <StatKpiCard
        label="Tárolórekeszek (BIN)"
        :value="binsCount"
        :subtext="`${dedicatedCount} dedikált tárhely összesen`"
        icon="pi pi-inbox"
        iconClass="text-[#f46714]"
      />
      <StatKpiCard
        label="Aktív pozíciók"
        :value="activeCount"
        :subtext="`${activePercentage} aktív (${locations.length} összesen)`"
        subtextClass="text-[#298653]"
        icon="pi pi-check-circle"
        iconClass="text-[#298653]"
      />
    </div>

    <!-- 3. OSZTOTT NÉZET: Bal 8 oszlop (Hierarchikus fa), Jobb 4 oszlop (Részletpanel) -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <!-- BAL OLDAL: HIERARCHIKUS LOKÁCIÓFA -->
      <div class="lg:col-span-8 bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs flex flex-col min-h-[620px]">
        <!-- Fejléc -->
        <div class="flex items-center justify-between pb-4 border-b border-[#e8eae6]">
          <div class="flex items-center gap-2.5">
            <h2 class="text-[19px] font-semibold text-[#171918] tracking-[-0.209px]">
              Lokációfa
            </h2>
            <span class="bg-[#e9ece7] text-[#171918] text-[11px] font-medium px-2.5 py-1 rounded-[7px]">
              {{ visibleRows.length }} megjelenítve
            </span>
          </div>

          <div class="flex items-center gap-3">
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
              @click="emit('refresh')"
              class="text-xs text-[#686f6a] hover:text-[#171918] flex items-center gap-1.5 cursor-pointer transition"
            >
              <i :class="['pi pi-refresh text-xs', loading ? 'animate-spin' : '']"></i>
              <span>Frissítés</span>
            </button>
          </div>
        </div>

        <!-- Kereső és szűrők (kicsi, fix lokációfa -> kliensoldali szűrés engedélyezett) -->
        <div class="flex flex-wrap items-center gap-2.5 my-4">
          <div class="relative flex-1 min-w-[200px]">
            <i class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"></i>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Keresés név vagy kód alapján (pl. A-01)..."
              class="w-full h-[38px] bg-white border border-white rounded-[10px] pl-9 pr-3 text-[12px] text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]/40 transition"
            />
          </div>

          <select
            v-model="typeFilter"
            class="h-[38px] bg-white border border-white rounded-[10px] px-3 text-[12px] text-[#171918] outline-none cursor-pointer"
          >
            <option value="ALL">Minden típus</option>
            <option v-for="(meta, tKey) in LOCATION_TYPE_META" :key="tKey" :value="tKey">
              {{ meta.label }}
            </option>
          </select>

          <select
            v-model="slotModeFilter"
            class="h-[38px] bg-white border border-white rounded-[10px] px-3 text-[12px] text-[#171918] outline-none cursor-pointer"
          >
            <option value="ALL">Minden tárhelymód</option>
            <option :value="SlotMode.MIXED">Vegyes (MIXED)</option>
            <option :value="SlotMode.DEDICATED">Dedikált (DEDICATED)</option>
          </select>

          <select
            v-model="statusFilter"
            class="h-[38px] bg-white border border-white rounded-[10px] px-3 text-[12px] text-[#171918] outline-none cursor-pointer"
          >
            <option value="ALL">Minden állapot</option>
            <option value="ACTIVE">Csak aktív</option>
            <option value="INACTIVE">Csak inaktív</option>
          </select>
        </div>

        <!-- Fa lista -->
        <div class="flex-1 space-y-1.5">
          <div v-if="loading && locations.length === 0" class="py-16 text-center text-sm text-[#686f6a]">
            Lokációk betöltése...
          </div>

          <div
            v-else-if="locations.length === 0"
            class="py-16 px-4 text-center bg-white/60 rounded-[14px] border border-dashed border-[#dce0d8]"
          >
            <i class="pi pi-warehouse text-3xl text-[#686f6a] mb-3"></i>
            <p class="text-sm font-semibold text-[#171918]">Még nincs rögzített raktár vagy üzlet</p>
            <p class="text-xs text-[#686f6a] mt-1">
              {{
                canCreateRoot
                  ? 'Hozd létre az első raktárat vagy üzletet a jobb felső gombbal!'
                  : 'Kérj meg egy adminisztrátort, hogy vegye fel a raktárat vagy üzletet.'
              }}
            </p>
            <button
              v-if="canCreateRoot"
              type="button"
              @click="emit('openCreateRoot')"
              class="mt-4 h-[38px] px-4 rounded-[10px] bg-[#171918] text-white text-xs font-medium cursor-pointer"
            >
              + Új raktár / üzlet létrehozása
            </button>
          </div>

          <div
            v-else-if="visibleRows.length === 0"
            class="py-16 text-center text-sm text-[#686f6a]"
          >
            Nincs a szűrésnek megfelelő pozíció.
          </div>

          <div
            v-for="row in visibleRows"
            :key="row.location.id"
            @click="emit('update:selectedLocationId', row.location.id)"
            class="group flex items-center justify-between gap-2 rounded-[12px] px-3 py-2 border transition cursor-pointer"
            :class="[
              selectedLocation?.id === row.location.id
                ? 'bg-white border-[#f46714]/50 shadow-xs'
                : 'bg-white/75 hover:bg-white border-transparent hover:border-[#e6e9e3]',
              !row.isDirectMatch ? 'opacity-65' : '',
            ]"
            :style="{ marginLeft: `${row.depth * 22}px` }"
          >
            <!-- Bal oldal: nyitó nyíl + ikon + név + jelvények -->
            <div class="flex items-center gap-2.5 min-w-0 flex-1">
              <button
                v-if="row.hasChildren"
                type="button"
                @click.stop="toggleExpand(row.location.id)"
                class="size-6 rounded-md hover:bg-[#eff1ed] flex items-center justify-center text-[#686f6a] shrink-0 cursor-pointer"
                :title="row.isExpanded ? 'Összecsukás' : 'Kinyitás'"
              >
                <i :class="['pi text-[11px]', row.isExpanded ? 'pi-chevron-down' : 'pi-chevron-right']"></i>
              </button>
              <span v-else class="size-6 shrink-0 flex items-center justify-center text-[#cfd4cb]">
                <span class="size-1.5 rounded-full bg-current"></span>
              </span>

              <div
                :class="[
                  'size-8 rounded-[9px] flex items-center justify-center shrink-0',
                  LOCATION_TYPE_META[row.location.type].iconBgClass,
                  !row.location.isActive ? 'opacity-50' : '',
                ]"
              >
                <i :class="[LOCATION_TYPE_META[row.location.type].icon, 'text-xs']"></i>
              </div>

              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2 flex-wrap">
                  <span
                    class="text-[13px] font-semibold truncate"
                    :class="row.location.isActive ? 'text-[#171918]' : 'text-[#686f6a] line-through'"
                  >
                    {{ row.location.name }}
                  </span>

                  <span
                    :class="[
                      'text-[10px] font-semibold px-1.5 py-0.5 rounded-md shrink-0',
                      LOCATION_TYPE_META[row.location.type].badgeClass,
                    ]"
                  >
                    {{ LOCATION_TYPE_META[row.location.type].label }}
                  </span>

                  <span
                    v-if="row.location.slotMode"
                    :class="[
                      'text-[10px] font-medium px-1.5 py-0.5 rounded-md shrink-0',
                      SLOT_MODE_META[row.location.slotMode].badgeClass,
                    ]"
                  >
                    {{ SLOT_MODE_META[row.location.slotMode].shortLabel }}
                  </span>

                  <span
                    v-if="!row.location.isActive"
                    class="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-600 border border-rose-200 shrink-0"
                  >
                    Inaktív
                  </span>

                  <span
                    v-if="row.location.isAssigned === false"
                    class="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200 shrink-0"
                  >
                    Másik telephely (csak betekintés)
                  </span>
                </div>

                <p v-if="row.location.description" class="text-[11px] text-[#686f6a] truncate">
                  {{ row.location.description }}
                </p>
              </div>
            </div>

            <!-- Jobb oldal: gyerekek száma + közvetlen gyors létrehozás (+ Zóna / + Polc / + Rekesz) -->
            <div class="flex items-center gap-1.5 shrink-0">
              <span
                v-if="row.directChildCount > 0"
                class="hidden sm:inline-block text-[11px] font-medium text-[#686f6a] bg-[#eff1ed] px-2 py-0.5 rounded-md"
              >
                {{ row.directChildCount }}
              </span>

              <template
                v-if="
                  canManageLocations &&
                  row.location.isAssigned !== false &&
                  LOCATION_TYPE_META[row.location.type].childButtonLabel
                "
              >
                <button
                  type="button"
                  @click.stop="emit('openQuickCreateChild', row.location)"
                  class="h-[28px] px-2.5 rounded-[8px] bg-[#eff1ed] hover:bg-[#171918] text-[#171918] hover:text-white text-[11px] font-semibold transition cursor-pointer whitespace-nowrap"
                >
                  {{ LOCATION_TYPE_META[row.location.type].childButtonLabel }}
                </button>

                <button
                  type="button"
                  @click.stop="emit('openBulk', row.location)"
                  class="size-[28px] rounded-[8px] bg-[#eff1ed] hover:bg-[#f46714] text-[#686f6a] hover:text-white flex items-center justify-center transition cursor-pointer"
                  title="Tömeges generálás ebbe a lokációba"
                >
                  <i class="pi pi-table text-[11px]"></i>
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- JOBB OLDAL: KIVÁLASZTOTT POZÍCIÓ RÉSZLETEI ÉS MŰVELETEK -->
      <div class="lg:col-span-4 space-y-5">
        <div v-if="selectedLocation" class="bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs space-y-4">
          <!-- Morzsaútvonal -->
          <div class="flex items-center flex-wrap gap-1 text-[11px] text-[#686f6a]">
            <template v-for="(step, idx) in selectedPath" :key="step.id">
              <button
                type="button"
                @click="emit('update:selectedLocationId', step.id)"
                class="hover:text-[#171918] transition cursor-pointer"
                :class="idx === selectedPath.length - 1 ? 'font-semibold text-[#171918]' : ''"
              >
                {{ step.name }}
              </button>
              <span v-if="idx < selectedPath.length - 1" class="text-[#b5bbb0]">›</span>
            </template>
          </div>

          <!-- Cím + státusz -->
          <div class="flex items-start gap-3">
            <div
              :class="[
                'size-11 rounded-[12px] flex items-center justify-center shrink-0',
                LOCATION_TYPE_META[selectedLocation.type].iconBgClass,
              ]"
            >
              <i :class="[LOCATION_TYPE_META[selectedLocation.type].icon, 'text-base']"></i>
            </div>
            <div class="min-w-0 flex-1">
              <h3 class="text-[18px] font-semibold text-[#171918] break-words leading-snug">
                {{ selectedLocation.name }}
              </h3>
              <div class="flex flex-wrap items-center gap-1.5 mt-1.5">
                <span
                  :class="[
                    'text-[10px] font-semibold px-2 py-0.5 rounded-md',
                    LOCATION_TYPE_META[selectedLocation.type].badgeClass,
                  ]"
                >
                  {{ LOCATION_TYPE_META[selectedLocation.type].label }}
                </span>

                <span
                  class="text-[10px] font-semibold px-2 py-0.5 rounded-md border"
                  :class="
                    selectedLocation.isActive
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-rose-50 text-rose-600 border-rose-200'
                  "
                >
                  {{ selectedLocation.isActive ? 'Aktív' : 'Inaktív' }}
                </span>

                <span
                  v-if="selectedLocation.slotMode"
                  :class="[
                    'text-[10px] font-semibold px-2 py-0.5 rounded-md',
                    SLOT_MODE_META[selectedLocation.slotMode].badgeClass,
                  ]"
                >
                  {{ SLOT_MODE_META[selectedLocation.slotMode].label }}
                </span>

                <span
                  v-if="selectedLocation.isAssigned === false"
                  class="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 border border-slate-200"
                >
                  Másik telephely (csak betekintés)
                </span>
              </div>
            </div>
          </div>

          <!-- Metaadatok -->
          <div class="bg-white rounded-[12px] border border-[#eceee9] p-3.5 space-y-2.5 text-xs">
            <div class="flex justify-between gap-2">
              <span class="text-[#686f6a]">Leírás</span>
              <span class="text-[#171918] text-right">
                {{ selectedLocation.description || '—' }}
              </span>
            </div>
            <div v-if="supportsSlotMode(selectedLocation.type)" class="flex justify-between gap-2">
              <span class="text-[#686f6a]">Tárolási mód</span>
              <span class="text-[#171918] font-medium">
                {{
                  selectedLocation.slotMode
                    ? SLOT_MODE_META[selectedLocation.slotMode].shortLabel
                    : 'Alapértelmezett'
                }}
              </span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-[#686f6a]">Közvetlen al-lokációk</span>
              <span class="text-[#171918] font-semibold">{{ selectedDirectChildren.length }} db</span>
            </div>
            <div class="flex justify-between gap-2">
              <span class="text-[#686f6a]">Módosítva</span>
              <span class="text-[#171918]">{{ formatDateTime(selectedLocation.updatedAt) }}</span>
            </div>
          </div>

          <!-- Készletművelet az adott pozícióra -->
          <div v-if="canAdjustStock && selectedLocation.isActive && selectedLocation.isAssigned !== false">
            <button
              type="button"
              @click="emit('openStockAdjust', selectedLocation.id)"
              class="w-full h-[38px] rounded-[10px] bg-[#f46714] hover:bg-[#dc590d] text-white text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition shadow-2xs"
            >
              <i class="pi pi-plus-circle text-xs"></i>
              <span>+ Készlet felvitele erre a pozícióra</span>
            </button>
          </div>

          <!-- Gyors műveletek -->
          <div v-if="canManageLocations && selectedLocation.isAssigned !== false" class="space-y-2">
            <div
              v-if="LOCATION_TYPE_META[selectedLocation.type].childButtonLabel"
              class="grid grid-cols-2 gap-2"
            >
              <button
                type="button"
                @click="emit('openQuickCreateChild', selectedLocation)"
                class="h-[38px] rounded-[10px] bg-[#171918] hover:bg-[#2a2d2b] text-white text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition"
              >
                <i class="pi pi-plus text-[11px]"></i>
                <span>{{ LOCATION_TYPE_META[selectedLocation.type].childButtonLabel?.replace('+ ', '') }}</span>
              </button>

              <button
                type="button"
                @click="emit('openBulk', selectedLocation)"
                class="h-[38px] rounded-[10px] bg-white hover:bg-[#eff1ed] border border-[#dce0d8] text-[#171918] text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition"
              >
                <i class="pi pi-table text-[11px] text-[#f46714]"></i>
                <span>Tömeges alá</span>
              </button>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                @click="emit('openEdit', selectedLocation)"
                class="h-[38px] rounded-[10px] bg-white hover:bg-[#eff1ed] border border-[#dce0d8] text-[#171918] text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition"
              >
                <i class="pi pi-pencil text-[11px]"></i>
                <span>Szerkesztés / Áthelyezés</span>
              </button>

              <button
                type="button"
                :disabled="actionLoading"
                @click="handleToggleActive(selectedLocation)"
                class="h-[38px] rounded-[10px] bg-white hover:bg-[#eff1ed] border border-[#dce0d8] text-[#171918] text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition disabled:opacity-50"
              >
                <i :class="['pi text-[11px]', selectedLocation.isActive ? 'pi-ban text-amber-600' : 'pi-check text-emerald-600']"></i>
                <span>{{ selectedLocation.isActive ? 'Inaktiválás' : 'Aktiválás' }}</span>
              </button>
            </div>

            <button
              type="button"
              :disabled="selectedDirectChildren.length > 0"
              @click="isDeleteConfirmOpen = true"
              class="w-full h-[36px] rounded-[10px] border text-xs font-medium flex items-center justify-center gap-1.5 transition"
              :class="
                selectedDirectChildren.length > 0
                  ? 'bg-[#eff1ed] border-transparent text-[#9aa197] cursor-not-allowed'
                  : 'bg-white border-rose-200 text-rose-600 hover:bg-rose-50 cursor-pointer'
              "
              :title="
                selectedDirectChildren.length > 0
                  ? 'Előbb töröld vagy helyezd át a közvetlen al-lokációkat.'
                  : 'Pozíció törlése'
              "
            >
              <i class="pi pi-trash text-[11px]"></i>
              <span>
                {{
                  selectedDirectChildren.length > 0
                    ? 'Nem törölhető (van al-lokáció)'
                    : 'Pozíció törlése'
                }}
              </span>
            </button>
          </div>
        </div>

        <!-- Közvetlen al-lokációk gyorslistája -->
        <div
          v-if="selectedLocation && selectedDirectChildren.length > 0"
          class="bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs space-y-3"
        >
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-semibold text-[#171918]">
              Al-lokációk ({{ selectedDirectChildren.length }})
            </h4>
          </div>
          <div class="max-h-[260px] overflow-y-auto space-y-1.5 pr-1">
            <button
              v-for="child in selectedDirectChildren"
              :key="child.id"
              type="button"
              @click="emit('update:selectedLocationId', child.id)"
              class="w-full flex items-center justify-between bg-white hover:border-[#f46714]/40 border border-[#eceee9] rounded-[10px] px-3 py-2 text-left transition cursor-pointer"
            >
              <div class="flex items-center gap-2 min-w-0">
                <i :class="[LOCATION_TYPE_META[child.type].icon, 'text-xs text-[#686f6a]']"></i>
                <span class="text-xs font-medium text-[#171918] truncate">{{ child.name }}</span>
              </div>
              <span
                v-if="child.slotMode"
                :class="['text-[10px] px-1.5 py-0.5 rounded-md', SLOT_MODE_META[child.slotMode].badgeClass]"
              >
                {{ SLOT_MODE_META[child.slotMode].shortLabel }}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Törlés megerősítése -->
    <ConfirmDeleteDialog
      v-model:visible="isDeleteConfirmOpen"
      header="Pozíció törlése"
      :itemName="selectedLocation?.name"
      :loading="actionLoading"
      warningNote="Ha a pozíción már történt korábban készletmozgás vagy leltár, a rendszer megakadályozza a törlést az előzmények védelme érdekében — ilyen esetben használd az Inaktiválás gombot."
      @confirm="handleDeleteSelected"
    >
      <p class="text-sm text-[#686f6a]">
        Biztosan törlöd a(z)
        <strong class="text-[#171918]">{{ selectedLocation?.name }}</strong>
        pozíciót?
      </p>
    </ConfirmDeleteDialog>
  </div>
</template>
