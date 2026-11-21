<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Role, LocationType } from '@wmanager/shared-types'
import { useAuthStore } from '@/stores/auth'
import { userApi, type UserItem } from '@/api/users'
import { locationApi, type LocationItem } from '@/api/locations'
import { extractApiError } from '@/utils/locationMeta'
import { useToast } from 'primevue/usetoast'
import StatKpiCard from '@/components/common/StatKpiCard.vue'
import ConfirmDeleteDialog from '@/components/common/ConfirmDeleteDialog.vue'
import UserDetailPanel, { type RoleMetaItem } from '@/components/users/UserDetailPanel.vue'
import UserFormModal, {
  type CreateUserSubmitPayload,
  type EditUserSubmitPayload,
} from '@/components/users/UserFormModal.vue'

const authStore = useAuthStore()
const toast = useToast()

const users = ref<UserItem[]>([])
const rootLocations = ref<LocationItem[]>([])
const loading = ref(false)
const actionLoading = ref(false)

// Szűrők és lapozás
const searchQuery = ref('')
const roleFilter = ref<string>('ALL')
const statusFilter = ref<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL')
const currentPage = ref(1)
const pageSize = ref(7)

// Kiválasztott felhasználó a jobb oldali kártyához
const selectedUserId = ref<string>('')

// Modal állapotok
const isFormModalOpen = ref(false)
const formModalMode = ref<'create' | 'edit'>('create')
const isDeleteConfirmOpen = ref(false)

// Szerepkörök magyar elnevezése és jogosultság-leírása
const ROLE_META: Record<Role, RoleMetaItem> = {
  [Role.BOSS]: {
    label: 'Tulajdonos / Ügyvezető',
    isUnbound: true,
    permissions: [
      'Teljes hozzáférés minden raktárhoz és üzlethez',
      'Adminisztrátori és vezetői fiókok kezelése',
      'Készletkezelés, leltár jóváhagyás és pénzügyi KPI-ok',
    ],
  },
  [Role.ADMIN]: {
    label: 'Rendszergazda',
    isUnbound: true,
    permissions: [
      'Teljes hozzáférés minden raktárhoz és üzlethez',
      'Felhasználói fiókok és munkahely-hozzárendelések kezelése',
      'Törzsadatok, katalógus és leltárak felügyelete',
    ],
  },
  [Role.WAREHOUSE_MANAGER]: {
    label: 'Raktárvezető',
    isUnbound: false,
    permissions: [
      'Készletkezelés és leltározás a hozzárendelt raktárban',
      'Leltár-eltérések jóváhagyása és leltárfeladatok kiírása',
      'Zónák, polcok és rekeszek struktúrájának kezelése',
    ],
  },
  [Role.STORE_MANAGER]: {
    label: 'Üzletvezető',
    isUnbound: false,
    permissions: [
      'Bolti készletkezelés és leltár jóváhagyása a saját üzletben',
      'Bolti zónák és polcok kialakítása',
      'Visszáru (RMA) és rendelések felügyelete',
    ],
  },
  [Role.WAREHOUSE_STAFF]: {
    label: 'Raktáros',
    isUnbound: false,
    permissions: [
      'PDA-s árumozgatás és készletfeltöltés a saját raktárban',
      'Kiadott leltárfeladatok felvétele és vakleltár számolás',
      'Kiszedési és bevételezési műveletek végrehajtása',
    ],
  },
  [Role.STORE_STAFF]: {
    label: 'Bolti eladó',
    isUnbound: false,
    permissions: [
      'Bolti készletmozgások és értékesítés rögzítése',
      'Bolti leltárfeladatok elvégzése (vakleltár módban)',
      'Termék- és szabadkészlet-információk lekérdezése',
    ],
  },
  [Role.ORDER_CLERK]: {
    label: 'Rendelésfeldolgozó / Iroda',
    isUnbound: true,
    permissions: [
      'Katalógus és termékvariánsok áttekintése minden raktárban',
      'Beszerzési és vevői rendelések kezelése',
      'Raktárközi áruszétosztások indítása',
    ],
  },
  [Role.RMA_CLERK]: {
    label: 'RMA / Ügyfélszolgálat',
    isUnbound: true,
    permissions: [
      'Visszáru és garanciális esetek (RMA) rögzítése és bírálata',
      'Országos készletinformációk megtekintése',
      'Vevői rendelés-hivatkozások ellenőrzése',
    ],
  },
}

const currentActorId = computed(() => authStore.user?.userId ?? authStore.user?.id ?? '')

// Létrehozáskor választható szerepkörök (BOSS-t seed hozza létre, ADMIN-t csak BOSS kezelhet)
const assignableRoles = computed(() => {
  const actorRole = authStore.user?.role
  const allRoles = Object.values(Role).filter((r) => r !== Role.BOSS)
  if (actorRole === Role.BOSS) {
    return allRoles
  }
  return allRoles.filter((r) => r !== Role.ADMIN)
})

function canActorManageUser(target: UserItem): boolean {
  const actor = authStore.user
  if (!actor) return false
  if (actor.role !== Role.BOSS && (target.role === Role.BOSS || target.role === Role.ADMIN)) {
    return false
  }
  return actor.role === Role.BOSS || actor.role === Role.ADMIN
}

// 4 Felső Mutató (KPI)
const totalUsersCount = computed(() => users.value.length)
const newUsersThisMonth = computed(() => {
  const now = new Date()
  return users.value.filter((u) => {
    const d = new Date(u.createdAt)
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
  }).length
})
const activeUsersCount = computed(() => users.value.filter((u) => u.isActive).length)
const activePercentage = computed(() => {
  if (users.value.length === 0) return '0%'
  return `${((activeUsersCount.value / users.value.length) * 100).toFixed(1).replace('.', ',')}%`
})
const locationBoundUsersCount = computed(
  () => users.value.filter((u) => !ROLE_META[u.role]?.isUnbound).length,
)
const distinctRolesCount = computed(() => new Set(users.value.map((u) => u.role)).size)

// Szűrt lista
const filteredUsers = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return users.value.filter((u) => {
    const matchesSearch =
      !q ||
      u.name.toLowerCase().includes(q) ||
      u.email.toLowerCase().includes(q) ||
      ROLE_META[u.role]?.label.toLowerCase().includes(q)

    const matchesRole = roleFilter.value === 'ALL' || u.role === roleFilter.value
    const matchesStatus =
      statusFilter.value === 'ALL' ||
      (statusFilter.value === 'ACTIVE' && u.isActive) ||
      (statusFilter.value === 'INACTIVE' && !u.isActive)

    return matchesSearch && matchesRole && matchesStatus
  })
})

const totalPages = computed(() =>
  Math.max(1, Math.ceil(filteredUsers.value.length / pageSize.value)),
)

const paginatedUsers = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredUsers.value.slice(start, start + pageSize.value)
})

const paginationRangeText = computed(() => {
  const total = filteredUsers.value.length
  if (total === 0) return '0 felhasználó'
  const start = (currentPage.value - 1) * pageSize.value + 1
  const end = Math.min(total, currentPage.value * pageSize.value)
  return `${start}–${end} / ${total} felhasználó`
})

const selectedUser = computed(() => {
  return users.value.find((u) => u.id === selectedUserId.value) ?? filteredUsers.value[0] ?? null
})

// A kiválasztott userhez még nem hozzárendelt raktárak/boltok
const availableLocationsForSelectedUser = computed(() => {
  if (!selectedUser.value) return []
  const assignedIds = new Set(
    (selectedUser.value.userLocations ?? []).map((ul) => ul.locationId),
  )
  return rootLocations.value.filter((loc) => !assignedIds.has(loc.id))
})

function formatUserLocationsLabel(user: UserItem): string {
  if (ROLE_META[user.role]?.isUnbound) {
    return 'Minden raktár'
  }
  const locs = user.userLocations?.map((ul) => ul.location?.name).filter(Boolean) ?? []
  if (locs.length === 0) return 'Nincs hozzárendelve'
  return locs.join(', ')
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  const now = new Date()
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()

  const timeStr = date.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
  if (isToday) {
    return `Ma, ${timeStr}`
  }
  const datePart = date.toLocaleDateString('hu-HU', { month: 'short', day: '2-digit' })
  return `${datePart} ${timeStr}`
}

function showFeedback(type: 'success' | 'error', msg: string) {
  toast.add({
    severity: type,
    summary: type === 'success' ? 'Sikeres művelet' : 'Hiba történt',
    detail: msg,
    life: type === 'success' ? 3500 : 5000,
  })
}

async function loadData() {
  loading.value = true
  try {
    const [usersRes, locsRes] = await Promise.all([
      userApi.getAll(),
      locationApi.getAll().catch(() => ({ data: [] as LocationItem[] })),
    ])
    users.value = usersRes.data
    rootLocations.value = locsRes.data.filter(
      (l) => l.type === LocationType.WAREHOUSE || l.type === LocationType.STORE,
    )
    if (!selectedUserId.value && users.value.length > 0) {
      selectedUserId.value = users.value[0]!.id
    }
  } catch (err) {
    showFeedback('error', extractApiError(err, 'Nem sikerült betölteni a felhasználókat.'))
  } finally {
    loading.value = false
  }
}

function openCreateModal() {
  formModalMode.value = 'create'
  isFormModalOpen.value = true
}

function openEditModal(user?: UserItem) {
  const target = user ?? selectedUser.value
  if (!target) return
  selectedUserId.value = target.id
  formModalMode.value = 'edit'
  isFormModalOpen.value = true
}

async function handleCreateUser(payload: CreateUserSubmitPayload) {
  actionLoading.value = true
  try {
    const res = await userApi.create({
      name: payload.name,
      email: payload.email,
      role: payload.role,
      password: payload.password,
    })
    const createdUser = res.data

    // Ha helyhez kötött szerepkör és választott kezdő raktárat/üzletet, rögtön hozzárendeljük
    const isBound = !ROLE_META[createdUser.role]?.isUnbound
    if (isBound && payload.initialLocationId) {
      const locRes = await userApi.assignLocation(createdUser.id, payload.initialLocationId)
      createdUser.userLocations = [locRes.data]
    }

    users.value.unshift(createdUser)
    selectedUserId.value = createdUser.id
    isFormModalOpen.value = false
    showFeedback('success', `${createdUser.name} sikeresen létrehozva!`)
  } catch (err) {
    showFeedback('error', extractApiError(err, 'Hiba történt a felhasználó létrehozásakor.'))
  } finally {
    actionLoading.value = false
  }
}

async function handleUpdateUser(payload: EditUserSubmitPayload) {
  actionLoading.value = true
  try {
    const res = await userApi.update(payload.id, {
      name: payload.name,
      email: payload.email,
      role: payload.role,
      isActive: payload.isActive,
    })
    const idx = users.value.findIndex((u) => u.id === payload.id)
    if (idx !== -1) {
      users.value[idx] = res.data
    }
    isFormModalOpen.value = false
    showFeedback('success', 'A felhasználó adatai és hozzáférése frissítve!')
  } catch (err) {
    showFeedback('error', extractApiError(err, 'Nem sikerült módosítani a felhasználót.'))
  } finally {
    actionLoading.value = false
  }
}

async function handleAssignLocation(locationId: string) {
  if (!selectedUser.value || !locationId) return
  actionLoading.value = true
  try {
    const res = await userApi.assignLocation(selectedUser.value.id, locationId)
    if (!selectedUser.value.userLocations) {
      selectedUser.value.userLocations = []
    }
    selectedUser.value.userLocations.push(res.data)
    showFeedback('success', 'Raktár / üzlet sikeresen hozzárendelve!')
  } catch (err) {
    showFeedback('error', extractApiError(err, 'Nem sikerült hozzárendelni a helyszínt.'))
  } finally {
    actionLoading.value = false
  }
}

async function handleUnassignLocation(locationId: string) {
  if (!selectedUser.value) return
  actionLoading.value = true
  try {
    await userApi.unassignLocation(selectedUser.value.id, locationId)
    selectedUser.value.userLocations = (selectedUser.value.userLocations ?? []).filter(
      (ul) => ul.locationId !== locationId,
    )
    showFeedback('success', 'Helyszín-hozzárendelés eltávolítva.')
  } catch (err) {
    showFeedback('error', extractApiError(err, 'Nem sikerült eltávolítani a helyszínt.'))
  } finally {
    actionLoading.value = false
  }
}

async function handleToggleActive(user: UserItem) {
  actionLoading.value = true
  try {
    const res = await userApi.update(user.id, { isActive: !user.isActive })
    const idx = users.value.findIndex((u) => u.id === user.id)
    if (idx !== -1) {
      users.value[idx] = res.data
    }
    showFeedback(
      'success',
      `${res.data.name} fiókja ${res.data.isActive ? 'aktiválva' : 'felfüggesztve'}.`,
    )
  } catch (err) {
    showFeedback('error', extractApiError(err, 'Nem sikerült módosítani a fiók állapotát.'))
  } finally {
    actionLoading.value = false
  }
}

async function handleDeleteUser() {
  if (!selectedUser.value) return
  actionLoading.value = true
  try {
    const deletedName = selectedUser.value.name
    const deletedId = selectedUser.value.id
    await userApi.remove(deletedId)
    users.value = users.value.filter((u) => u.id !== deletedId)
    selectedUserId.value = users.value[0]?.id ?? ''
    isDeleteConfirmOpen.value = false
    isFormModalOpen.value = false
    showFeedback('success', `${deletedName} véglegesen törölve.`)
  } catch (err) {
    showFeedback('error', extractApiError(err, 'Nem sikerült törölni a felhasználót.'))
  } finally {
    actionLoading.value = false
  }
}

function exportCsv() {
  const header = ['Név', 'E-mail', 'Szerepkör', 'Raktár / Üzlet', 'Állapot', 'Létrehozva']
  const rows = filteredUsers.value.map((u) => [
    `"${u.name.replace(/"/g, '""')}"`,
    `"${u.email}"`,
    `"${ROLE_META[u.role]?.label ?? u.role}"`,
    `"${formatUserLocationsLabel(u)}"`,
    `"${u.isActive ? 'Aktív' : 'Inaktív'}"`,
    `"${new Date(u.createdAt).toLocaleDateString('hu-HU')}"`,
  ])
  const csvContent =
    '\uFEFF' + [header.join(';'), ...rows.map((r) => r.join(';'))].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `felhasznalok_${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(() => {
  loadData()
})
</script>

<template>
  <div class="space-y-6 text-[#171918]">
    <!-- 1. OLDALFEJLÉC -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-[30px] font-semibold tracking-[-0.42px] text-[#171918] leading-tight">
          Felhasználók
        </h1>
        <p class="text-[14px] text-[#686f6a] mt-1 tracking-[-0.196px]">
          A megfelelő hozzáférés. A megfelelő embereknek.
        </p>
      </div>

      <div class="flex items-center gap-3">
        <button
          type="button"
          @click="exportCsv"
          class="bg-white hover:bg-[#f8f9f7] border border-white h-[42px] px-4 rounded-[12px] text-[13px] font-medium text-[#171918] flex items-center gap-2.5 shadow-xs transition cursor-pointer"
        >
          <i class="pi pi-download text-sm text-[#171918]"></i>
          <span>Exportálás</span>
        </button>

        <button
          v-if="authStore.user?.role === Role.ADMIN || authStore.user?.role === Role.BOSS"
          type="button"
          @click="openCreateModal"
          class="bg-[#171918] hover:bg-[#2a2d2b] border border-white h-[42px] px-4 rounded-[12px] text-[13px] font-medium text-white flex items-center gap-2.5 shadow-xs transition cursor-pointer"
        >
          <i class="pi pi-plus text-sm text-white"></i>
          <span>Új felhasználó</span>
        </button>
      </div>
    </div>

    <!-- 2. NÉGY MUTATÓ KÁRTYA -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
      <StatKpiCard
        label="Összes felhasználó"
        :value="totalUsersCount"
        :subtext="`+${newUsersThisMonth} ebben a hónapban`"
        subtext-class="text-[#298653]"
        icon="pi pi-users"
      />
      <StatKpiCard
        label="Aktív felhasználók"
        :value="activeUsersCount"
        :subtext="`${activePercentage} aktív`"
        icon="pi pi-check"
        icon-class="text-[#298653]"
      />
      <StatKpiCard
        label="Raktárhoz / bolthoz kötött"
        :value="locationBoundUsersCount"
        :subtext="`${rootLocations.length} aktív raktár és üzlet`"
        icon="pi pi-building"
        icon-class="text-[#f46714]"
      />
      <StatKpiCard
        label="Szerepkörök"
        :value="distinctRolesCount"
        subtext="Szerepkör- és raktáralapú védelem"
        icon="pi pi-shield"
      />
    </div>

    <!-- 3. FŐ MUNKATERÜLET: Bal 8 oszlop (Csapattagok táblázat), Jobb 4 oszlop (Részletpanel) -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <!-- BAL OLDAL: Csapattagok lista -->
      <div class="lg:col-span-8 bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs flex flex-col min-h-[640px]">
        <!-- Fejléc -->
        <div class="flex items-center justify-between pb-4 border-b border-[#e8eae6]">
          <div class="flex items-center gap-2.5">
            <h2 class="text-[19px] font-semibold text-[#171918] tracking-[-0.209px]">
              Csapattagok
            </h2>
            <span class="bg-[#e9ece7] text-[#171918] text-[11px] font-medium px-2.5 py-1 rounded-[7px]">
              {{ filteredUsers.length }}
            </span>
          </div>

          <button
            type="button"
            @click="loadData"
            class="text-xs text-[#686f6a] hover:text-[#171918] flex items-center gap-1.5 cursor-pointer transition"
            title="Lista frissítése"
          >
            <i :class="['pi pi-refresh text-xs', loading ? 'animate-spin' : '']"></i>
            <span>Frissítés</span>
          </button>
        </div>

        <!-- Kereső és szűrősáv -->
        <div class="flex flex-wrap items-center gap-3 my-4">
          <div class="relative flex-1 min-w-[220px]">
            <i class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"></i>
            <input
              v-model="searchQuery"
              @input="currentPage = 1"
              type="text"
              placeholder="Keresés név vagy e-mail alapján..."
              class="w-full h-[40px] bg-white border border-white rounded-[10px] pl-9 pr-3 text-[12px] text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]/40 transition"
            />
          </div>

          <select
            v-model="roleFilter"
            @change="currentPage = 1"
            class="h-[40px] bg-white border border-white rounded-[10px] px-3 text-[12px] text-[#171918] outline-none cursor-pointer"
          >
            <option value="ALL">Összes szerepkör</option>
            <option v-for="(meta, rKey) in ROLE_META" :key="rKey" :value="rKey">
              {{ meta.label }}
            </option>
          </select>

          <select
            v-model="statusFilter"
            @change="currentPage = 1"
            class="h-[40px] bg-white border border-white rounded-[10px] px-3 text-[12px] text-[#171918] outline-none cursor-pointer"
          >
            <option value="ALL">Összes állapot</option>
            <option value="ACTIVE">Csak aktív</option>
            <option value="INACTIVE">Csak inaktív</option>
          </select>
        </div>

        <!-- Táblázat fejléc -->
        <div class="bg-[#eff1ed] h-[36px] rounded-[8px] px-4 grid grid-cols-12 items-center text-[11px] font-medium text-[#686f6a]">
          <div class="col-span-4">Név és e-mail</div>
          <div class="col-span-3">Szerepkör</div>
          <div class="col-span-2">Raktár / Üzlet</div>
          <div class="col-span-1">Állapot</div>
          <div class="col-span-2 text-right">Létrehozva</div>
        </div>

        <!-- Táblázat sorok -->
        <div class="flex-1 divide-y divide-[#e8eae6] mt-1">
          <div v-if="loading" class="py-16 text-center text-sm text-[#686f6a]">
            Felhasználók betöltése...
          </div>
          <div
            v-else-if="paginatedUsers.length === 0"
            class="py-16 text-center text-sm text-[#686f6a]"
          >
            Nincs a szűrésnek megfelelő felhasználó.
          </div>

          <div
            v-for="user in paginatedUsers"
            :key="user.id"
            @click="selectedUserId = user.id"
            class="relative h-[56px] px-4 grid grid-cols-12 items-center rounded-[8px] cursor-pointer transition-all"
            :class="
              selectedUser?.id === user.id
                ? 'bg-[#fff0e5]'
                : 'hover:bg-white/60'
            "
          >
            <!-- Bal oldali narancssárga kijelölő csík -->
            <div
              v-if="selectedUser?.id === user.id"
              class="absolute left-0 top-[9px] h-[38px] w-[3px] bg-[#f46714] rounded-[2px]"
            ></div>

            <!-- Név és e-mail -->
            <div class="col-span-4 min-w-0 pr-2">
              <p class="text-[13px] font-medium text-[#171918] truncate">{{ user.name }}</p>
              <p class="text-[10px] text-[#686f6a] truncate">{{ user.email }}</p>
            </div>

            <!-- Szerepkör -->
            <div class="col-span-3 text-[11px] text-[#171918] truncate pr-2">
              {{ ROLE_META[user.role]?.label ?? user.role }}
            </div>

            <!-- Raktár -->
            <div class="col-span-2 text-[11px] text-[#686f6a] truncate pr-2">
              {{ formatUserLocationsLabel(user) }}
            </div>

            <!-- Állapot Badge -->
            <div class="col-span-1">
              <span
                class="inline-flex items-center px-2.5 py-1 rounded-[7px] text-[11px] font-medium"
                :class="
                  user.isActive
                    ? 'bg-[#e5f0e8] text-[#298653]'
                    : 'bg-[#eaeee8] text-[#686f6a]'
                "
              >
                {{ user.isActive ? 'Aktív' : 'Inaktív' }}
              </span>
            </div>

            <!-- Létrehozva + Művelet ikon -->
            <div class="col-span-2 flex items-center justify-end gap-3 text-right">
              <span class="text-[10px] text-[#686f6a]">
                {{ formatDate(user.createdAt) }}
              </span>
              <button
                v-if="canActorManageUser(user)"
                type="button"
                @click.stop="openEditModal(user)"
                class="text-[#686f6a] hover:text-[#171918] p-1 cursor-pointer"
                title="Szerkesztés"
              >
                <i class="pi pi-ellipsis-h text-xs"></i>
              </button>
            </div>
          </div>
        </div>

        <!-- Alsó lapozó -->
        <div class="pt-4 mt-4 border-t border-[#e8eae6] flex flex-wrap items-center justify-between gap-3 text-[11px] text-[#686f6a]">
          <span>{{ paginationRangeText }}</span>

          <div class="flex items-center gap-4">
            <span>Oldalanként: {{ pageSize }}</span>

            <div class="flex items-center gap-1.5">
              <button
                v-for="p in totalPages"
                :key="p"
                type="button"
                @click="currentPage = p"
                class="h-[26px] min-w-[28px] px-2 rounded-[7px] text-[11px] font-medium cursor-pointer transition"
                :class="
                  currentPage === p
                    ? 'bg-[#171918] text-white'
                    : 'text-[#686f6a] hover:bg-[#e9ece7]'
                "
              >
                {{ p }}
              </button>
              <button
                v-if="currentPage < totalPages"
                type="button"
                @click="currentPage++"
                class="p-1 text-[#686f6a] hover:text-[#171918] cursor-pointer"
              >
                <i class="pi pi-arrow-right text-xs"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- JOBB OLDAL: Felhasználó részletei és jogosultságok -->
      <UserDetailPanel
        v-if="selectedUser"
        class="lg:col-span-4"
        :user="selectedUser"
        :role-meta="ROLE_META"
        :available-locations="availableLocationsForSelectedUser"
        :can-manage="canActorManageUser(selectedUser)"
        :is-self="selectedUser.id === currentActorId"
        :loading="actionLoading"
        @edit="openEditModal"
        @toggle-active="handleToggleActive"
        @request-delete="isDeleteConfirmOpen = true"
        @assign-location="handleAssignLocation"
        @unassign-location="handleUnassignLocation"
      />
    </div>

    <!-- 4. MODAL: ÚJ FELHASZNÁLÓ LÉTREHOZÁSA / SZERKESZTÉSE -->
    <UserFormModal
      v-model:visible="isFormModalOpen"
      :mode="formModalMode"
      :editing-user="selectedUser"
      :assignable-roles="assignableRoles"
      :root-locations="rootLocations"
      :role-meta="ROLE_META"
      :is-self="selectedUser?.id === currentActorId"
      :loading="actionLoading"
      @submit-create="handleCreateUser"
      @submit-edit="handleUpdateUser"
    />

    <!-- 5. MODAL: TÖRLÉS MEGERŐSÍTÉSE -->
    <ConfirmDeleteDialog
      v-model:visible="isDeleteConfirmOpen"
      header="Felhasználó törlése"
      confirm-label="Végleges törlés"
      :loading="actionLoading"
      @confirm="handleDeleteUser"
    >
      <p v-if="selectedUser" class="text-sm text-slate-600">
        Biztosan törölni szeretnéd <b>{{ selectedUser.name }}</b> ({{ selectedUser.email }}) fiókját?
      </p>
    </ConfirmDeleteDialog>
  </div>
</template>
