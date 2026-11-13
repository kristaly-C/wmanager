<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { LocationType, Role, SlotMode } from '@wmanager/shared-types'
import { useAuthStore } from '@/stores/auth'
import { locationApi, type BulkCreateLocationsResult, type LocationItem } from '@/api/locations'
import {
  LOCATION_TYPE_META,
  SLOT_MODE_META,
  extractApiError,
  getLocationPath,
  supportsSlotMode,
} from '@/utils/locationMeta'
import LocationFormModal from '@/components/inventory/LocationFormModal.vue'
import LocationBulkModal from '@/components/inventory/LocationBulkModal.vue'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'

interface FlatTreeRow {
  location: LocationItem
  depth: number
  hasChildren: boolean
  directChildCount: number
  isExpanded: boolean
  isDirectMatch: boolean
}

const authStore = useAuthStore()
const toast = useToast()

const locations = ref<LocationItem[]>([])
const loading = ref(false)
const actionLoading = ref(false)

// Szűrők
const searchQuery = ref('')
const typeFilter = ref<'ALL' | LocationType>('ALL')
const statusFilter = ref<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL')
const slotModeFilter = ref<'ALL' | SlotMode>('ALL')

// Fa állapot és kijelölés
const expandedIds = ref<Set<string>>(new Set())
const selectedLocationId = ref<string>('')

// Modal állapotok
const isFormModalOpen = ref(false)
const formModalMode = ref<'create' | 'edit'>('create')
const formInitialType = ref<LocationType>(LocationType.WAREHOUSE)
const formInitialParentId = ref<string | null>(null)
const formEditingLocation = ref<LocationItem | null>(null)

const isBulkModalOpen = ref(false)
const bulkInitialParentId = ref<string | null>(null)

const isDeleteConfirmOpen = ref(false)

// Jogosultságok (backend LocationController + LOCATION_UNBOUND_ROLES szerint)
const canCreateRoot = computed(() => {
  const role = authStore.user?.role
  return role === Role.ADMIN || role === Role.BOSS
})

const canManageLocations = computed(() => {
  const role = authStore.user?.role
  return (
    role === Role.ADMIN ||
    role === Role.BOSS ||
    role === Role.WAREHOUSE_MANAGER ||
    role === Role.STORE_MANAGER
  )
})

const locationById = computed(() => new Map(locations.value.map((l) => [l.id, l])))

const childrenByParentId = computed(() => {
  const map = new Map<string | null, LocationItem[]>()
  for (const loc of locations.value) {
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

  for (const loc of locations.value) {
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
      const isExpanded = filters ? hasChildren : expandedIds.value.has(loc.id)

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
  if (selectedLocationId.value) {
    const found = locationById.value.get(selectedLocationId.value)
    if (found) return found
  }
  return visibleRows.value[0]?.location ?? locations.value[0] ?? null
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
  () => locations.value.filter((l) => l.type === LocationType.WAREHOUSE).length,
)
const storesCount = computed(
  () => locations.value.filter((l) => l.type === LocationType.STORE).length,
)
const zonesAndShelvesCount = computed(
  () =>
    locations.value.filter(
      (l) => l.type === LocationType.ZONE || l.type === LocationType.SHELF,
    ).length,
)
const zonesCount = computed(
  () => locations.value.filter((l) => l.type === LocationType.ZONE).length,
)
const shelvesCount = computed(
  () => locations.value.filter((l) => l.type === LocationType.SHELF).length,
)
const binsCount = computed(
  () => locations.value.filter((l) => l.type === LocationType.BIN).length,
)
const dedicatedCount = computed(
  () => locations.value.filter((l) => l.slotMode === SlotMode.DEDICATED).length,
)
const activeCount = computed(() => locations.value.filter((l) => l.isActive).length)
const activePercentage = computed(() => {
  if (locations.value.length === 0) return '0%'
  return `${Math.round((activeCount.value / locations.value.length) * 100)}%`
})

const anyBranchParentsExist = computed(() =>
  locations.value.some((l) => LOCATION_TYPE_META[l.type].childType !== null),
)

const allExpandableExpanded = computed(() => {
  const expandable = locations.value.filter(
    (l) => (childrenByParentId.value.get(l.id)?.length ?? 0) > 0,
  )
  return expandable.length > 0 && expandable.every((l) => expandedIds.value.has(l.id))
})

function toggleExpand(id: string) {
  const next = new Set(expandedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  expandedIds.value = next
}

function toggleExpandAll() {
  if (allExpandableExpanded.value) {
    expandedIds.value = new Set()
    return
  }
  const allParents = new Set<string>()
  for (const loc of locations.value) {
    if ((childrenByParentId.value.get(loc.id)?.length ?? 0) > 0) {
      allParents.add(loc.id)
    }
  }
  expandedIds.value = allParents
}

function resetFilters() {
  searchQuery.value = ''
  typeFilter.value = 'ALL'
  statusFilter.value = 'ALL'
  slotModeFilter.value = 'ALL'
}

async function loadLocations() {
  loading.value = true
  try {
    const res = await locationApi.getAll()
    locations.value = res.data

    // Első betöltéskor nyissuk ki a gyökereket (WAREHOUSE / STORE) és az 1. szintet (ZONE)
    if (expandedIds.value.size === 0 && res.data.length > 0) {
      const initialExpanded = new Set<string>()
      for (const loc of res.data) {
        if (loc.type === LocationType.WAREHOUSE || loc.type === LocationType.STORE) {
          initialExpanded.add(loc.id)
        }
      }
      expandedIds.value = initialExpanded
    }

    if (!selectedLocationId.value && res.data.length > 0) {
      const firstRoot = res.data.find((l) => l.parentId === null) ?? res.data[0]
      if (firstRoot) selectedLocationId.value = firstRoot.id
    }
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Hiba történt',
      detail: extractApiError(err, 'Nem sikerült betölteni a lokációkat.'),
      life: 5000,
    })
  } finally {
    loading.value = false
  }
}

function openCreateRootModal() {
  formModalMode.value = 'create'
  formInitialType.value = LocationType.WAREHOUSE
  formInitialParentId.value = null
  formEditingLocation.value = null
  isFormModalOpen.value = true
}

function openQuickCreateChildModal(parent: LocationItem) {
  const childType = LOCATION_TYPE_META[parent.type].childType
  if (!childType) return
  formModalMode.value = 'create'
  formInitialType.value = childType
  formInitialParentId.value = parent.id
  formEditingLocation.value = null
  isFormModalOpen.value = true
}

function openEditModal(location: LocationItem) {
  formModalMode.value = 'edit'
  formInitialType.value = location.type
  formInitialParentId.value = location.parentId
  formEditingLocation.value = location
  isFormModalOpen.value = true
}

function openBulkModal(parent?: LocationItem | null) {
  if (parent && LOCATION_TYPE_META[parent.type].childType !== null) {
    bulkInitialParentId.value = parent.id
  } else if (
    selectedLocation.value &&
    LOCATION_TYPE_META[selectedLocation.value.type].childType !== null
  ) {
    bulkInitialParentId.value = selectedLocation.value.id
  } else {
    bulkInitialParentId.value = null
  }
  isBulkModalOpen.value = true
}

async function onFormSaved(saved: LocationItem) {
  await loadLocations()
  selectedLocationId.value = saved.id
  if (saved.parentId) {
    const next = new Set(expandedIds.value)
    next.add(saved.parentId)
    expandedIds.value = next
  }
}

async function onBulkCreated(result: BulkCreateLocationsResult) {
  const targetParentId = bulkInitialParentId.value
  await loadLocations()
  if (targetParentId) {
    const next = new Set(expandedIds.value)
    next.add(targetParentId)
    for (const item of result.created) {
      if (item.parentId) next.add(item.parentId)
    }
    expandedIds.value = next
  }
  if (result.created[0]) {
    selectedLocationId.value = result.created[0].id
  }
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
    await loadLocations()
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
    selectedLocationId.value = target.parentId ?? ''
    await loadLocations()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Nem törölhető',
      detail: extractApiError(
        err,
        'A pozíció nem törölhető, mert al-lokációk vagy készletadatok hivatkoznak rá. Használd inkább az Inaktiválást!',
      ),
      life: 6000,
    })
  } finally {
    actionLoading.value = false
  }
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString('hu-HU', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

onMounted(() => {
  loadLocations()
})
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
          @click="openBulkModal(selectedLocation)"
          class="bg-white hover:bg-[#f8f9f7] border border-white h-[42px] px-4 rounded-[12px] text-[13px] font-medium text-[#171918] flex items-center gap-2 shadow-xs transition cursor-pointer"
        >
          <i class="pi pi-table text-sm text-[#f46714]"></i>
          <span>Tömeges generálás</span>
        </button>

        <button
          v-if="canCreateRoot"
          type="button"
          @click="openCreateRootModal"
          class="bg-[#171918] hover:bg-[#2a2d2b] border border-white h-[42px] px-4 rounded-[12px] text-[13px] font-medium text-white flex items-center gap-2 shadow-xs transition cursor-pointer"
        >
          <i class="pi pi-plus text-sm text-white"></i>
          <span>Új raktár / üzlet</span>
        </button>
      </div>
    </div>

    <!-- 2. NÉGY MUTATÓ KÁRTYA -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
      <div class="bg-[#f6f7f5] border border-white rounded-[19px] h-[110px] p-4 flex items-start gap-4 shadow-2xs">
        <div class="bg-white rounded-[14px] size-[50px] flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
          <i class="pi pi-warehouse text-[20px] text-[#171918]"></i>
        </div>
        <div class="min-w-0">
          <p class="text-[12px] text-[#686f6a] tracking-[-0.168px]">Raktárak és üzletek</p>
          <p class="text-[30px] font-semibold text-[#171918] leading-tight tracking-[-0.42px]">
            {{ warehousesCount + storesCount }}
          </p>
          <p class="text-[11px] font-medium text-[#686f6a] mt-0.5">
            {{ warehousesCount }} raktár · {{ storesCount }} üzlet
          </p>
        </div>
      </div>

      <div class="bg-[#f6f7f5] border border-white rounded-[19px] h-[110px] p-4 flex items-start gap-4 shadow-2xs">
        <div class="bg-white rounded-[14px] size-[50px] flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
          <i class="pi pi-th-large text-[20px] text-blue-600"></i>
        </div>
        <div class="min-w-0">
          <p class="text-[12px] text-[#686f6a] tracking-[-0.168px]">Zónák és polcok</p>
          <p class="text-[30px] font-semibold text-[#171918] leading-tight tracking-[-0.42px]">
            {{ zonesAndShelvesCount }}
          </p>
          <p class="text-[11px] font-medium text-[#686f6a] mt-0.5">
            {{ zonesCount }} zóna · {{ shelvesCount }} polc
          </p>
        </div>
      </div>

      <div class="bg-[#f6f7f5] border border-white rounded-[19px] h-[110px] p-4 flex items-start gap-4 shadow-2xs">
        <div class="bg-white rounded-[14px] size-[50px] flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
          <i class="pi pi-inbox text-[20px] text-[#f46714]"></i>
        </div>
        <div class="min-w-0">
          <p class="text-[12px] text-[#686f6a] tracking-[-0.168px]">Tárolórekeszek (BIN)</p>
          <p class="text-[30px] font-semibold text-[#171918] leading-tight tracking-[-0.42px]">
            {{ binsCount }}
          </p>
          <p class="text-[11px] font-medium text-[#686f6a] mt-0.5">
            {{ dedicatedCount }} dedikált tárhely összesen
          </p>
        </div>
      </div>

      <div class="bg-[#f6f7f5] border border-white rounded-[19px] h-[110px] p-4 flex items-start gap-4 shadow-2xs">
        <div class="bg-white rounded-[14px] size-[50px] flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
          <i class="pi pi-check-circle text-[20px] text-[#298653]"></i>
        </div>
        <div class="min-w-0">
          <p class="text-[12px] text-[#686f6a] tracking-[-0.168px]">Aktív pozíciók</p>
          <p class="text-[30px] font-semibold text-[#171918] leading-tight tracking-[-0.42px]">
            {{ activeCount }}
          </p>
          <p class="text-[11px] font-medium text-[#298653] mt-0.5">
            {{ activePercentage }} aktív ({{ locations.length }} összesen)
          </p>
        </div>
      </div>
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
              @click="loadLocations"
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
              @click="openCreateRootModal"
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
            @click="selectedLocationId = row.location.id"
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

              <template v-if="canManageLocations && LOCATION_TYPE_META[row.location.type].childButtonLabel">
                <button
                  type="button"
                  @click.stop="openQuickCreateChildModal(row.location)"
                  class="h-[28px] px-2.5 rounded-[8px] bg-[#eff1ed] hover:bg-[#171918] text-[#171918] hover:text-white text-[11px] font-semibold transition cursor-pointer whitespace-nowrap"
                >
                  {{ LOCATION_TYPE_META[row.location.type].childButtonLabel }}
                </button>

                <button
                  type="button"
                  @click.stop="openBulkModal(row.location)"
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
                @click="selectedLocationId = step.id"
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
              <span class="text-[#171918]">{{ formatDate(selectedLocation.updatedAt) }}</span>
            </div>
          </div>

          <!-- Gyors műveletek -->
          <div v-if="canManageLocations" class="space-y-2">
            <div
              v-if="LOCATION_TYPE_META[selectedLocation.type].childButtonLabel"
              class="grid grid-cols-2 gap-2"
            >
              <button
                type="button"
                @click="openQuickCreateChildModal(selectedLocation)"
                class="h-[38px] rounded-[10px] bg-[#171918] hover:bg-[#2a2d2b] text-white text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition"
              >
                <i class="pi pi-plus text-[11px]"></i>
                <span>{{ LOCATION_TYPE_META[selectedLocation.type].childButtonLabel?.replace('+ ', '') }}</span>
              </button>

              <button
                type="button"
                @click="openBulkModal(selectedLocation)"
                class="h-[38px] rounded-[10px] bg-white hover:bg-[#eff1ed] border border-[#dce0d8] text-[#171918] text-xs font-medium flex items-center justify-center gap-1.5 cursor-pointer transition"
              >
                <i class="pi pi-table text-[11px] text-[#f46714]"></i>
                <span>Tömeges alá</span>
              </button>
            </div>

            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                @click="openEditModal(selectedLocation)"
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
              @click="selectedLocationId = child.id"
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

    <!-- Létrehozó / Szerkesztő Modal -->
    <LocationFormModal
      v-model:visible="isFormModalOpen"
      :mode="formModalMode"
      :initialType="formInitialType"
      :initialParentId="formInitialParentId"
      :editingLocation="formEditingLocation"
      :allLocations="locations"
      :canCreateRoot="canCreateRoot"
      @saved="onFormSaved"
    />

    <!-- Tömeges generátor Modal -->
    <LocationBulkModal
      v-model:visible="isBulkModalOpen"
      :initialParentId="bulkInitialParentId"
      :allLocations="locations"
      @created="onBulkCreated"
    />

    <!-- Törlés megerősítése -->
    <Dialog
      v-model:visible="isDeleteConfirmOpen"
      modal
      header="Pozíció törlése"
      :style="{ width: '26rem', maxWidth: '95vw' }"
    >
      <div class="space-y-3 py-1">
        <p class="text-sm text-[#686f6a]">
          Biztosan törlöd a(z)
          <strong class="text-[#171918]">{{ selectedLocation?.name }}</strong>
          pozíciót?
        </p>
        <p class="text-xs text-[#686f6a] bg-[#f6f7f5] rounded-[10px] p-3 border border-[#e8eae6]">
          Ha a pozíción már történt korábban készletmozgás vagy leltár, a rendszer megakadályozza a törlést az előzmények védelme érdekében — ilyen esetben használd az <strong>Inaktiválás</strong> gombot.
        </p>
        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            @click="isDeleteConfirmOpen = false"
            class="h-[36px] px-4 rounded-[10px] bg-white border border-[#dce0d8] text-xs font-medium text-[#171918] cursor-pointer"
          >
            Mégse
          </button>
          <button
            type="button"
            :disabled="actionLoading"
            @click="handleDeleteSelected"
            class="h-[36px] px-4 rounded-[10px] bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <i v-if="actionLoading" class="pi pi-spin pi-spinner text-xs"></i>
            <span>Törlés</span>
          </button>
        </div>
      </div>
    </Dialog>
  </div>
</template>
