<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Role, LocationType } from '@wmanager/shared-types'
import { useAuthStore } from '@/stores/auth'
import { userApi, type UserItem } from '@/api/users'
import { locationApi, type LocationItem } from '@/api/locations'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'

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
const isCreateModalOpen = ref(false)
const isEditModalOpen = ref(false)
const isDeleteConfirmOpen = ref(false)

// Új felhasználó űrlap
const createForm = ref({
  name: '',
  email: '',
  role: Role.WAREHOUSE_STAFF as Role,
  password: '',
  initialLocationId: '' as string,
})

// Szerkesztés űrlap
const editForm = ref({
  name: '',
  email: '',
  role: Role.WAREHOUSE_STAFF as Role,
  isActive: true,
})

// Helyszín hozzárendelés legördülő
const selectedLocationToAssign = ref<string>('')

// Szerepkörök magyar elnevezése és jogosultság-leírása
const ROLE_META: Record<
  Role,
  { label: string; isUnbound: boolean; permissions: string[] }
> = {
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

function extractApiError(err: any, fallback: string): string {
  const msg = err?.response?.data?.message
  if (Array.isArray(msg)) return msg.join(', ')
  if (typeof msg === 'string') return msg
  return fallback
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
  createForm.value = {
    name: '',
    email: '',
    role: Role.WAREHOUSE_STAFF,
    password: '',
    initialLocationId: '',
  }
  isCreateModalOpen.value = true
}

async function handleCreateUser() {
  actionLoading.value = true
  try {
    const res = await userApi.create({
      name: createForm.value.name.trim(),
      email: createForm.value.email.trim(),
      role: createForm.value.role,
      password: createForm.value.password,
    })
    const createdUser = res.data

    // Ha helyhez kötött szerepkör és választott kezdő raktárat/üzletet, rögtön hozzárendeljük
    const isBound = !ROLE_META[createdUser.role]?.isUnbound
    if (isBound && createForm.value.initialLocationId) {
      const locRes = await userApi.assignLocation(
        createdUser.id,
        createForm.value.initialLocationId,
      )
      createdUser.userLocations = [locRes.data]
    }

    users.value.unshift(createdUser)
    selectedUserId.value = createdUser.id
    isCreateModalOpen.value = false
    showFeedback('success', `${createdUser.name} sikeresen létrehozva!`)
  } catch (err) {
    showFeedback('error', extractApiError(err, 'Hiba történt a felhasználó létrehozásakor.'))
  } finally {
    actionLoading.value = false
  }
}

function openEditModal(user?: UserItem) {
  const target = user ?? selectedUser.value
  if (!target) return
  selectedUserId.value = target.id
  editForm.value = {
    name: target.name,
    email: target.email,
    role: target.role,
    isActive: target.isActive,
  }
  selectedLocationToAssign.value = ''
  isEditModalOpen.value = true
}

async function handleUpdateUser() {
  if (!selectedUser.value) return
  actionLoading.value = true
  try {
    const res = await userApi.update(selectedUser.value.id, {
      name: editForm.value.name.trim(),
      email: editForm.value.email.trim(),
      role: editForm.value.role,
      isActive: editForm.value.isActive,
    })
    const idx = users.value.findIndex((u) => u.id === selectedUser.value!.id)
    if (idx !== -1) {
      users.value[idx] = res.data
    }
    isEditModalOpen.value = false
    showFeedback('success', 'A felhasználó adatai és hozzáférése frissítve!')
  } catch (err) {
    showFeedback('error', extractApiError(err, 'Nem sikerült módosítani a felhasználót.'))
  } finally {
    actionLoading.value = false
  }
}

async function handleAssignLocation() {
  if (!selectedUser.value || !selectedLocationToAssign.value) return
  actionLoading.value = true
  try {
    const res = await userApi.assignLocation(
      selectedUser.value.id,
      selectedLocationToAssign.value,
    )
    if (!selectedUser.value.userLocations) {
      selectedUser.value.userLocations = []
    }
    selectedUser.value.userLocations.push(res.data)
    selectedLocationToAssign.value = ''
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
    isEditModalOpen.value = false
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
    <!-- 1. OLDALFEJLÉC (Figma Node 2:27) -->
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

    <!-- 2. NÉGY MUTATÓ KÁRTYA (Figma Node 2:28) -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5">
      <!-- Kártya 1: Összes felhasználó -->
      <div class="bg-[#f6f7f5] border border-white rounded-[19px] h-[110px] p-4 flex items-start gap-4 shadow-2xs">
        <div class="bg-white rounded-[14px] size-[50px] flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
          <i class="pi pi-users text-[20px] text-[#171918]"></i>
        </div>
        <div class="min-w-0">
          <p class="text-[12px] text-[#686f6a] tracking-[-0.168px]">Összes felhasználó</p>
          <p class="text-[30px] font-semibold text-[#171918] leading-tight tracking-[-0.42px]">
            {{ totalUsersCount }}
          </p>
          <p class="text-[11px] font-medium text-[#298653] mt-0.5">
            +{{ newUsersThisMonth }} ebben a hónapban
          </p>
        </div>
      </div>

      <!-- Kártya 2: Aktív felhasználók -->
      <div class="bg-[#f6f7f5] border border-white rounded-[19px] h-[110px] p-4 flex items-start gap-4 shadow-2xs">
        <div class="bg-white rounded-[14px] size-[50px] flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
          <i class="pi pi-check text-[20px] text-[#298653]"></i>
        </div>
        <div class="min-w-0">
          <p class="text-[12px] text-[#686f6a] tracking-[-0.168px]">Aktív felhasználók</p>
          <p class="text-[30px] font-semibold text-[#171918] leading-tight tracking-[-0.42px]">
            {{ activeUsersCount }}
          </p>
          <p class="text-[11px] font-medium text-[#686f6a] mt-0.5">
            {{ activePercentage }} aktív
          </p>
        </div>
      </div>

      <!-- Kártya 3: Helyhez kötött dolgozók (Raktár/Bolt) -->
      <div class="bg-[#f6f7f5] border border-white rounded-[19px] h-[110px] p-4 flex items-start gap-4 shadow-2xs">
        <div class="bg-white rounded-[14px] size-[50px] flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
          <i class="pi pi-building text-[20px] text-[#f46714]"></i>
        </div>
        <div class="min-w-0">
          <p class="text-[12px] text-[#686f6a] tracking-[-0.168px]">Raktárhoz / bolthoz kötött</p>
          <p class="text-[30px] font-semibold text-[#171918] leading-tight tracking-[-0.42px]">
            {{ locationBoundUsersCount }}
          </p>
          <p class="text-[11px] font-medium text-[#686f6a] mt-0.5">
            {{ rootLocations.length }} aktív raktár és üzlet
          </p>
        </div>
      </div>

      <!-- Kártya 4: Szerepkörök -->
      <div class="bg-[#f6f7f5] border border-white rounded-[19px] h-[110px] p-4 flex items-start gap-4 shadow-2xs">
        <div class="bg-white rounded-[14px] size-[50px] flex items-center justify-center shrink-0 mt-0.5 shadow-2xs">
          <i class="pi pi-shield text-[20px] text-[#171918]"></i>
        </div>
        <div class="min-w-0">
          <p class="text-[12px] text-[#686f6a] tracking-[-0.168px]">Szerepkörök</p>
          <p class="text-[30px] font-semibold text-[#171918] leading-tight tracking-[-0.42px]">
            {{ distinctRolesCount }}
          </p>
          <p class="text-[11px] font-medium text-[#686f6a] mt-0.5">
            Szerepkör- és raktáralapú védelem
          </p>
        </div>
      </div>
    </div>

    <!-- 3. FŐ MUNKATERÜLET: Bal 8 oszlop (Csapattagok táblázat), Jobb 4 oszlop (2 részletkártya) -->
    <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      <!-- BAL OLDAL: Csapattagok lista (Figma Node 2:300) -->
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

        <!-- Táblázat fejléc (Figma Node 2:325) -->
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
            <!-- Bal oldali narancssárga kijelölő csík (Figma Node 2:333) -->
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

        <!-- Alsó lapozó (Figma Node 2:427) -->
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

      <!-- JOBB OLDAL: 2 egymás alatti kártya (Figma Node 2:437 és 2:461) -->
      <div v-if="selectedUser" class="lg:col-span-4 space-y-4">
        <!-- 1. Kártya: Felhasználó adatai (Figma Node 2:437) -->
        <div class="bg-[#f8f9f7] border border-white rounded-[16px] p-6 shadow-xs space-y-5">
          <div class="flex items-center justify-between">
            <h3 class="text-[18px] font-semibold text-[#171918]">Felhasználó adatai</h3>

            <div v-if="canActorManageUser(selectedUser)" class="flex items-center gap-1">
              <button
                type="button"
                @click="handleToggleActive(selectedUser)"
                :disabled="actionLoading || selectedUser.id === authStore.user?.userId"
                class="text-xs px-2.5 py-1 rounded-lg border border-[#e8eae6] bg-white hover:bg-slate-50 text-[#686f6a] hover:text-[#171918] cursor-pointer transition disabled:opacity-40"
                :title="selectedUser.isActive ? 'Fiók felfüggesztése' : 'Fiók aktiválása'"
              >
                {{ selectedUser.isActive ? 'Tiltás' : 'Aktiválás' }}
              </button>
              <button
                v-if="selectedUser.role !== Role.BOSS && selectedUser.id !== authStore.user?.userId"
                type="button"
                @click="isDeleteConfirmOpen = true"
                class="text-xs p-1.5 rounded-lg text-rose-600 hover:bg-rose-50 cursor-pointer transition"
                title="Felhasználó törlése"
              >
                <i class="pi pi-trash text-xs"></i>
              </button>
            </div>
          </div>

          <!-- Szerepkör ikon + Név + Aktív jelvény -->
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3.5 min-w-0">
              <div class="bg-[#fff0e5] rounded-[14px] size-[52px] flex items-center justify-center shrink-0">
                <i class="pi pi-shield text-[22px] text-[#f46714]"></i>
              </div>
              <div class="min-w-0">
                <p class="text-[21px] font-semibold text-[#171918] leading-tight truncate">
                  {{ selectedUser.name }}
                </p>
                <p class="text-[12px] text-[#686f6a] mt-0.5 truncate">
                  {{ ROLE_META[selectedUser.role]?.label ?? selectedUser.role }} ·
                  {{ formatUserLocationsLabel(selectedUser) }}
                </p>
              </div>
            </div>

            <span
              class="inline-flex items-center px-2.5 py-1 rounded-[7px] text-[11px] font-medium shrink-0"
              :class="
                selectedUser.isActive
                  ? 'bg-[#e5f0e8] text-[#298653]'
                  : 'bg-[#eaeee8] text-[#686f6a]'
              "
            >
              {{ selectedUser.isActive ? 'Aktív' : 'Inaktív' }}
            </span>
          </div>

          <div class="h-px bg-[#e8eae6]"></div>

          <!-- Adatmezők -->
          <div class="space-y-3.5">
            <div>
              <span class="block text-[11px] text-[#686f6a]">E-mail</span>
              <span class="block text-[13px] text-[#171918] mt-0.5">{{ selectedUser.email }}</span>
            </div>

            <div>
              <span class="block text-[11px] text-[#686f6a]">Hozzárendelt raktár / üzlet</span>
              <div
                v-if="ROLE_META[selectedUser.role]?.isUnbound"
                class="text-[13px] text-[#171918] mt-0.5"
              >
                Minden raktár és üzlet (globális szerepkör)
              </div>
              <div v-else class="mt-1.5 space-y-2">
                <!-- Hozzárendelt raktárak chipjei eltávolítás gombbal -->
                <div class="flex flex-wrap gap-1.5">
                  <span
                    v-if="!selectedUser.userLocations || selectedUser.userLocations.length === 0"
                    class="text-[12px] text-amber-700 bg-[#fff0d9] px-2.5 py-1 rounded-[7px]"
                  >
                    Nincs még raktár vagy üzlet hozzárendelve
                  </span>
                  <span
                    v-for="ul in selectedUser.userLocations"
                    :key="ul.id"
                    class="inline-flex items-center gap-1.5 bg-white border border-[#e8eae6] px-2.5 py-1 rounded-[8px] text-[12px] text-[#171918]"
                  >
                    <span>{{ ul.location?.name }}</span>
                    <button
                      v-if="canActorManageUser(selectedUser)"
                      type="button"
                      @click="handleUnassignLocation(ul.locationId)"
                      class="text-[#686f6a] hover:text-rose-600 cursor-pointer"
                      title="Hozzárendelés eltávolítása"
                    >
                      <i class="pi pi-times text-[10px]"></i>
                    </button>
                  </span>
                </div>

                <!-- Gyors raktár/bolt hozzárendelés -->
                <div
                  v-if="canActorManageUser(selectedUser) && availableLocationsForSelectedUser.length > 0"
                  class="flex items-center gap-2 pt-1"
                >
                  <select
                    v-model="selectedLocationToAssign"
                    class="flex-1 h-[34px] bg-white border border-[#e8eae6] rounded-[8px] px-2.5 text-[12px] text-[#171918] outline-none"
                  >
                    <option value="">+ Raktár vagy üzlet hozzáadása...</option>
                    <option
                      v-for="loc in availableLocationsForSelectedUser"
                      :key="loc.id"
                      :value="loc.id"
                    >
                      {{ loc.name }} ({{ loc.type === LocationType.WAREHOUSE ? 'Raktár' : 'Üzlet' }})
                    </option>
                  </select>
                  <button
                    v-if="selectedLocationToAssign"
                    type="button"
                    @click="handleAssignLocation"
                    :disabled="actionLoading"
                    class="h-[34px] px-3 rounded-[8px] bg-[#171918] text-white text-xs font-medium cursor-pointer"
                  >
                    Hozzáadás
                  </button>
                </div>
              </div>
            </div>

            <div class="grid grid-cols-2 gap-2 pt-1">
              <div>
                <span class="block text-[11px] text-[#686f6a]">Regisztrálva</span>
                <span class="block text-[13px] text-[#171918] mt-0.5">
                  {{ formatDate(selectedUser.createdAt) }}
                </span>
              </div>
              <div>
                <span class="block text-[11px] text-[#686f6a]">Utolsó jelszócsere</span>
                <span class="block text-[13px] text-[#171918] mt-0.5">
                  {{ selectedUser.passwordChangedAt ? formatDate(selectedUser.passwordChangedAt) : 'Alapértelmezett' }}
                </span>
              </div>
            </div>
          </div>

          <!-- Hozzáférés szerkesztése gomb (Figma Node 2:457) -->
          <button
            v-if="canActorManageUser(selectedUser)"
            type="button"
            @click="openEditModal(selectedUser)"
            class="w-full h-[44px] bg-[#171918] hover:bg-[#2a2d2b] border border-white rounded-[11px] px-4 text-[13px] font-medium text-white flex items-center justify-between transition cursor-pointer"
          >
            <span>Hozzáférés szerkesztése</span>
            <i class="pi pi-arrow-right text-xs"></i>
          </button>
        </div>

        <!-- 2. Kártya: Hozzáférés és biztonság (Figma Node 2:461) -->
        <div class="bg-[#f8f9f7] border border-white rounded-[16px] p-6 shadow-xs space-y-4">
          <div>
            <h3 class="text-[17px] font-semibold text-[#171918]">Hozzáférés és biztonság</h3>
            <p class="text-[12px] text-[#686f6a] mt-0.5">
              {{ ROLE_META[selectedUser.role]?.label }} jogosultságok
            </p>
          </div>

          <div class="space-y-2.5">
            <div
              v-for="perm in ROLE_META[selectedUser.role]?.permissions ?? []"
              :key="perm"
              class="flex items-start gap-2.5 text-[12px] text-[#171918]"
            >
              <i class="pi pi-check text-xs text-[#298653] mt-0.5 shrink-0"></i>
              <span>{{ perm }}</span>
            </div>
          </div>

          <div class="h-px bg-[#e8eae6]"></div>

          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-3">
              <i class="pi pi-lock text-[18px] text-[#f46714]"></i>
              <div>
                <p class="text-[12px] font-medium text-[#171918]">Helyszínalapú hozzáférés-védelem</p>
                <p class="text-[11px] text-[#686f6a]">
                  {{
                    ROLE_META[selectedUser.role]?.isUnbound
                      ? 'Minden telephelyre érvényes jogosultság'
                      : 'Csak a hozzárendelt raktár/bolt hierarchiát éri el'
                  }}
                </p>
              </div>
            </div>
            <span class="bg-[#e5f0e8] text-[#298653] text-[11px] font-medium px-2.5 py-1 rounded-[7px] shrink-0">
              RBAC
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 4. MODAL: ÚJ FELHASZNÁLÓ LÉTREHOZÁSA -->
    <Dialog
      v-model:visible="isCreateModalOpen"
      modal
      header="Új felhasználó létrehozása"
      class="w-[95vw] max-w-md !rounded-2xl"
    >
      <form @submit.prevent="handleCreateUser" class="space-y-4 pt-2">
        <div>
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">Teljes név</label>
          <input
            v-model="createForm.name"
            type="text"
            required
            placeholder="Pl. Nagy Eszter"
            class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">E-mail cím</label>
          <input
            v-model="createForm.email"
            type="email"
            required
            placeholder="eszter.nagy@ceg.hu"
            class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">Szerepkör</label>
          <select
            v-model="createForm.role"
            class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#f46714]"
          >
            <option v-for="r in assignableRoles" :key="r" :value="r">
              {{ ROLE_META[r]?.label ?? r }}
            </option>
          </select>
        </div>

        <div v-if="!ROLE_META[createForm.role]?.isUnbound">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Elsődleges raktár / üzlet (opcionális)
          </label>
          <select
            v-model="createForm.initialLocationId"
            class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#f46714]"
          >
            <option value="">— Később rendelem hozzá —</option>
            <option v-for="loc in rootLocations" :key="loc.id" :value="loc.id">
              {{ loc.name }} ({{ loc.type === LocationType.WAREHOUSE ? 'Raktár' : 'Üzlet' }})
            </option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Kezdeti jelszó (min. 8 karakter)
          </label>
          <input
            v-model="createForm.password"
            type="password"
            required
            minlength="8"
            placeholder="••••••••"
            class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <div class="flex justify-end gap-2 pt-3">
          <button
            type="button"
            @click="isCreateModalOpen = false"
            class="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 cursor-pointer"
          >
            Mégse
          </button>
          <button
            type="submit"
            :disabled="actionLoading"
            class="px-4 py-2 rounded-xl bg-[#171918] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {{ actionLoading ? 'Mentés...' : 'Felhasználó létrehozása' }}
          </button>
        </div>
      </form>
    </Dialog>

    <!-- 5. MODAL: FELHASZNÁLÓ ÉS HOZZÁFÉRÉS SZERKESZTÉSE -->
    <Dialog
      v-model:visible="isEditModalOpen"
      modal
      header="Felhasználó és hozzáférés szerkesztése"
      class="w-[95vw] max-w-md !rounded-2xl"
    >
      <form v-if="selectedUser" @submit.prevent="handleUpdateUser" class="space-y-4 pt-2">
        <div>
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">Teljes név</label>
          <input
            v-model="editForm.name"
            type="text"
            required
            class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">E-mail cím</label>
          <input
            v-model="editForm.email"
            type="email"
            required
            class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">Szerepkör</label>
          <select
            v-model="editForm.role"
            :disabled="selectedUser.role === Role.BOSS || selectedUser.id === authStore.user?.userId"
            class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#f46714] disabled:bg-slate-100"
          >
            <option v-if="selectedUser.role === Role.BOSS" :value="Role.BOSS">
              {{ ROLE_META[Role.BOSS].label }}
            </option>
            <option v-for="r in assignableRoles" :key="r" :value="r">
              {{ ROLE_META[r]?.label ?? r }}
            </option>
          </select>
        </div>

        <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div>
            <p class="text-xs font-semibold text-[#171918]">Fiók állapota</p>
            <p class="text-[11px] text-[#686f6a]">Inaktív felhasználó nem tud bejelentkezni</p>
          </div>
          <input
            v-model="editForm.isActive"
            type="checkbox"
            :disabled="selectedUser.role === Role.BOSS || selectedUser.id === authStore.user?.userId"
            class="size-4 accent-[#f46714] cursor-pointer"
          />
        </div>

        <div class="flex justify-end gap-2 pt-3">
          <button
            type="button"
            @click="isEditModalOpen = false"
            class="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 cursor-pointer"
          >
            Mégse
          </button>
          <button
            type="submit"
            :disabled="actionLoading"
            class="px-4 py-2 rounded-xl bg-[#171918] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {{ actionLoading ? 'Mentés...' : 'Változtatások mentése' }}
          </button>
        </div>
      </form>
    </Dialog>

    <!-- 6. MODAL: TÖRLÉS MEGERŐSÍTÉSE -->
    <Dialog
      v-model:visible="isDeleteConfirmOpen"
      modal
      header="Felhasználó törlése"
      class="w-[95vw] max-w-sm !rounded-2xl"
    >
      <div v-if="selectedUser" class="space-y-4 pt-2">
        <p class="text-sm text-slate-600">
          Biztosan törölni szeretnéd <b>{{ selectedUser.name }}</b> ({{ selectedUser.email }}) fiókját?
        </p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            @click="isDeleteConfirmOpen = false"
            class="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 cursor-pointer"
          >
            Mégse
          </button>
          <button
            type="button"
            @click="handleDeleteUser"
            :disabled="actionLoading"
            class="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer"
          >
            {{ actionLoading ? 'Törlés...' : 'Végleges törlés' }}
          </button>
        </div>
      </div>
    </Dialog>
  </div>
</template>
