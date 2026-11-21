<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { LocationType, Role } from '@wmanager/shared-types'
import { useAuthStore } from '@/stores/auth'
import { locationApi, type BulkCreateLocationsResult, type LocationItem } from '@/api/locations'
import { stockApi } from '@/api/stock'
import { LOCATION_TYPE_META, extractApiError } from '@/utils/locationMeta'
import LocationsTreeTab from '@/components/inventory/LocationsTreeTab.vue'
import LocationFormModal from '@/components/inventory/LocationFormModal.vue'
import LocationBulkModal from '@/components/inventory/LocationBulkModal.vue'
import StockItemsTab from '@/components/inventory/StockItemsTab.vue'
import StockMovementsTab from '@/components/inventory/StockMovementsTab.vue'
import StockReportsTab from '@/components/inventory/StockReportsTab.vue'
import StockAdjustModal from '@/components/inventory/StockAdjustModal.vue'
import { useToast } from 'primevue/usetoast'

type InventoryTab = 'locations' | 'stock' | 'movements' | 'reports'

const authStore = useAuthStore()
const toast = useToast()

const activeTab = ref<InventoryTab>('locations')
const tabs: { id: InventoryTab; label: string; icon: string }[] = [
  { id: 'locations', label: 'Pozíciók & Térkép', icon: 'pi pi-sitemap' },
  { id: 'stock', label: 'Készlet áttekintés', icon: 'pi pi-box' },
  { id: 'movements', label: 'Mozgási napló', icon: 'pi pi-history' },
  { id: 'reports', label: 'Eltérés-jelentések', icon: 'pi pi-exclamation-triangle' },
]

const pendingReportsCount = ref(0)

const locations = ref<LocationItem[]>([])
const loading = ref(false)

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

const isStockAdjustModalOpen = ref(false)
const stockAdjustInitialLocationId = ref<string | null>(null)

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

const canAdjustStock = computed(() => {
  const role = authStore.user?.role
  return (
    role === Role.ADMIN ||
    role === Role.BOSS ||
    role === Role.WAREHOUSE_MANAGER ||
    role === Role.STORE_MANAGER ||
    role === Role.WAREHOUSE_STAFF ||
    role === Role.STORE_STAFF
  )
})

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
      const firstRoot =
        res.data.find((l) => l.parentId === null && l.isAssigned !== false) ??
        res.data.find((l) => l.parentId === null) ??
        res.data[0]
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

function openBulkModal(parent: LocationItem | null = null) {
  const target =
    parent ?? locations.value.find((l) => l.id === selectedLocationId.value) ?? null
  if (
    target &&
    target.isAssigned !== false &&
    LOCATION_TYPE_META[target.type].childType !== null
  ) {
    bulkInitialParentId.value = target.id
  } else {
    bulkInitialParentId.value = null
  }
  isBulkModalOpen.value = true
}

function openStockAdjustForLocation(locationId: string) {
  stockAdjustInitialLocationId.value = locationId
  isStockAdjustModalOpen.value = true
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

async function onLocationDeleted(parentId: string | null) {
  selectedLocationId.value = parentId ?? ''
  await loadLocations()
}

async function loadPendingReportsCount() {
  const role = authStore.user?.role
  if (role === Role.ORDER_CLERK || role === Role.RMA_CLERK) {
    pendingReportsCount.value = 0
    return
  }
  try {
    const res = await stockApi.getReports({ status: 'PENDING' })
    pendingReportsCount.value = res.data.length
  } catch {
    pendingReportsCount.value = 0
  }
}

onMounted(() => {
  void loadLocations()
  void loadPendingReportsCount()
})
</script>

<template>
  <div class="space-y-5">
    <!-- FELSŐ AL-NAVIGÁCIÓ (Kapszula váltó) -->
    <div class="flex items-center justify-between">
      <div class="inline-flex items-center bg-white border border-white rounded-2xl p-1 shadow-sm gap-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          @click="activeTab = tab.id"
          class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all cursor-pointer"
          :class="
            activeTab === tab.id
              ? 'bg-slate-900 text-white shadow-sm'
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
          "
        >
          <i :class="[tab.icon, 'text-xs']"></i>
          <span>{{ tab.label }}</span>
          <span
            v-if="tab.id === 'reports' && pendingReportsCount > 0"
            class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold"
            :class="
              activeTab === tab.id
                ? 'bg-[#f46714] text-white'
                : 'bg-amber-100 text-amber-800'
            "
          >
            {{ pendingReportsCount }}
          </span>
        </button>
      </div>
    </div>

    <LocationsTreeTab
      v-if="activeTab === 'locations'"
      v-model:selectedLocationId="selectedLocationId"
      v-model:expandedIds="expandedIds"
      :locations="locations"
      :loading="loading"
      :canCreateRoot="canCreateRoot"
      :canManageLocations="canManageLocations"
      :canAdjustStock="canAdjustStock"
      @refresh="loadLocations"
      @openCreateRoot="openCreateRootModal"
      @openQuickCreateChild="openQuickCreateChildModal"
      @openEdit="openEditModal"
      @openBulk="openBulkModal"
      @openStockAdjust="openStockAdjustForLocation"
      @deleted="onLocationDeleted"
    />

    <StockItemsTab
      v-else-if="activeTab === 'stock'"
      :allLocations="locations"
      :canAdjustStock="canAdjustStock"
      @report-created="loadPendingReportsCount"
    />

    <StockMovementsTab
      v-else-if="activeTab === 'movements'"
      :allLocations="locations"
    />

    <StockReportsTab
      v-else-if="activeTab === 'reports'"
      :allLocations="locations"
      @resolved="loadPendingReportsCount"
    />

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

    <StockAdjustModal
      v-model:visible="isStockAdjustModalOpen"
      :initialLocationId="stockAdjustInitialLocationId"
      :allLocations="locations"
    />
  </div>
</template>
