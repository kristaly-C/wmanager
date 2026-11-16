<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Role } from '@wmanager/shared-types'
import { useAuthStore } from '@/stores/auth'
import { supplierApi, type SupplierItem } from '@/api/suppliers'
import { extractApiError } from '@/utils/locationMeta'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'

const authStore = useAuthStore()
const toast = useToast()

const suppliers = ref<SupplierItem[]>([])
const loading = ref(false)
const actionLoading = ref(false)

const searchQuery = ref('')

// Modal állapotok
const isFormModalOpen = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const editingSupplier = ref<SupplierItem | null>(null)
const form = ref({
  name: '',
  email: '',
  phone: '',
  description: '',
})

const isDeleteConfirmOpen = ref(false)
const deletingSupplier = ref<SupplierItem | null>(null)

// RBAC: SupplierController
// POST: @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER)
// PATCH / DELETE: @Roles(Role.ADMIN, Role.BOSS)
const canCreateSupplier = computed(() => {
  const role = authStore.user?.role
  return (
    role === Role.ADMIN ||
    role === Role.BOSS ||
    role === Role.WAREHOUSE_MANAGER
  )
})

const canEditOrDeleteSupplier = computed(() => {
  const role = authStore.user?.role
  return role === Role.ADMIN || role === Role.BOSS
})

const filteredSuppliers = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return suppliers.value
  return suppliers.value.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      (s.email?.toLowerCase().includes(q) ?? false) ||
      (s.phone?.toLowerCase().includes(q) ?? false) ||
      (s.description?.toLowerCase().includes(q) ?? false),
  )
})

const withEmailCount = computed(
  () => suppliers.value.filter((s) => Boolean(s.email?.trim())).length,
)
const withPhoneCount = computed(
  () => suppliers.value.filter((s) => Boolean(s.phone?.trim())).length,
)

async function loadSuppliers() {
  loading.value = true
  try {
    const res = await supplierApi.getAll()
    suppliers.value = res.data
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Hiba történt',
      detail: extractApiError(err, 'Nem sikerült betölteni a beszállítókat.'),
      life: 5000,
    })
  } finally {
    loading.value = false
  }
}

function openCreateModal() {
  formMode.value = 'create'
  editingSupplier.value = null
  form.value = {
    name: '',
    email: '',
    phone: '',
    description: '',
  }
  isFormModalOpen.value = true
}

function openEditModal(supplier: SupplierItem) {
  formMode.value = 'edit'
  editingSupplier.value = supplier
  form.value = {
    name: supplier.name,
    email: supplier.email ?? '',
    phone: supplier.phone ?? '',
    description: supplier.description ?? '',
  }
  isFormModalOpen.value = true
}

function openDeleteModal(supplier: SupplierItem) {
  deletingSupplier.value = supplier
  isDeleteConfirmOpen.value = true
}

async function handleSaveSupplier() {
  const trimmedName = form.value.name.trim()
  if (!trimmedName) return

  const trimmedEmail = form.value.email.trim()
  const trimmedPhone = form.value.phone.trim()
  const trimmedDesc = form.value.description.trim()

  const payload = {
    name: trimmedName,
    email: trimmedEmail || undefined,
    phone: trimmedPhone || undefined,
    description: trimmedDesc || undefined,
  }

  actionLoading.value = true
  try {
    if (formMode.value === 'create') {
      await supplierApi.create(payload)
      toast.add({
        severity: 'success',
        summary: 'Beszállító létrehozva',
        detail: `„${trimmedName}” sikeresen rögzítve.`,
        life: 3500,
      })
    } else if (editingSupplier.value) {
      await supplierApi.update(editingSupplier.value.id, payload)
      toast.add({
        severity: 'success',
        summary: 'Beszállító frissítve',
        detail: `„${trimmedName}” adatai elmentve.`,
        life: 3500,
      })
    }
    isFormModalOpen.value = false
    await loadSuppliers()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Mentési hiba',
      detail: extractApiError(err, 'Nem sikerült menteni a beszállítót.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

async function handleDeleteSupplier() {
  if (!deletingSupplier.value) return
  actionLoading.value = true
  try {
    const targetName = deletingSupplier.value.name
    await supplierApi.remove(deletingSupplier.value.id)
    isDeleteConfirmOpen.value = false
    deletingSupplier.value = null
    toast.add({
      severity: 'success',
      summary: 'Beszállító törölve',
      detail: `„${targetName}” sikeresen törölve.`,
      life: 3500,
    })
    await loadSuppliers()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Nem törölhető',
      detail: extractApiError(
        err,
        'A beszállító nem törölhető, mert termékek hivatkoznak rá.',
      ),
      life: 6000,
    })
  } finally {
    actionLoading.value = false
  }
}

onMounted(() => {
  loadSuppliers()
})
</script>

<template>
  <div class="space-y-6 text-[#171918]">
    <!-- 1. FEJLÉC -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-[26px] font-semibold tracking-[-0.36px] text-[#171918] leading-tight">
          Beszállítók
        </h1>
        <p class="text-[13px] text-[#686f6a] mt-1">
          Elsődleges beszállítói partnerek és kapcsolattartási adatok nyilvántartása.
        </p>
      </div>

      <div class="flex items-center gap-2.5">
        <button
          v-if="canCreateSupplier"
          type="button"
          @click="openCreateModal"
          class="bg-[#171918] hover:bg-[#2a2d2b] border border-white h-[40px] px-4 rounded-[12px] text-[13px] font-medium text-white flex items-center gap-2 shadow-xs transition cursor-pointer"
        >
          <i class="pi pi-plus text-xs text-white"></i>
          <span>+ Új beszállító</span>
        </button>
      </div>
    </div>

    <!-- 2. MUTATÓ KÁRTYÁK -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="bg-[#f6f7f5] border border-white rounded-[18px] p-4 flex items-center gap-3.5 shadow-2xs">
        <div class="bg-white rounded-[13px] size-[46px] flex items-center justify-center shrink-0 shadow-2xs">
          <i class="pi pi-building text-[18px] text-[#171918]"></i>
        </div>
        <div>
          <p class="text-[11px] text-[#686f6a]">Összes beszállító</p>
          <p class="text-[26px] font-semibold text-[#171918] leading-tight">
            {{ suppliers.length }}
          </p>
        </div>
      </div>

      <div class="bg-[#f6f7f5] border border-white rounded-[18px] p-4 flex items-center gap-3.5 shadow-2xs">
        <div class="bg-white rounded-[13px] size-[46px] flex items-center justify-center shrink-0 shadow-2xs">
          <i class="pi pi-envelope text-[18px] text-[#f46714]"></i>
        </div>
        <div>
          <p class="text-[11px] text-[#686f6a]">E-mail címmel rögzített</p>
          <p class="text-[26px] font-semibold text-[#171918] leading-tight">
            {{ withEmailCount }}
          </p>
        </div>
      </div>

      <div class="bg-[#f6f7f5] border border-white rounded-[18px] p-4 flex items-center gap-3.5 shadow-2xs">
        <div class="bg-white rounded-[13px] size-[46px] flex items-center justify-center shrink-0 shadow-2xs">
          <i class="pi pi-phone text-[18px] text-[#298653]"></i>
        </div>
        <div>
          <p class="text-[11px] text-[#686f6a]">Telefonszámmal rögzített</p>
          <p class="text-[26px] font-semibold text-[#171918] leading-tight">
            {{ withPhoneCount }}
          </p>
        </div>
      </div>
    </div>

    <!-- 3. TÁBLÁZAT KÁRTYA -->
    <div class="bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs space-y-4">
      <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#e8eae6]">
        <div class="relative flex-1 min-w-[220px] max-w-md">
          <i class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"></i>
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Keresés név, e-mail vagy telefonszám alapján..."
            class="w-full h-[38px] bg-white border border-white rounded-[10px] pl-9 pr-3 text-[12px] text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]/40 transition"
          />
        </div>

        <div class="flex items-center gap-3">
          <span class="bg-[#e9ece7] text-[#171918] text-[11px] font-medium px-2.5 py-1 rounded-[7px]">
            {{ filteredSuppliers.length }} beszállító
          </span>

          <button
            v-if="searchQuery.trim()"
            type="button"
            @click="searchQuery = ''"
            class="text-xs text-[#f46714] hover:underline font-medium cursor-pointer"
          >
            Keresés törlése
          </button>

          <button
            type="button"
            @click="loadSuppliers"
            class="text-xs text-[#686f6a] hover:text-[#171918] flex items-center gap-1.5 cursor-pointer transition"
          >
            <i :class="['pi pi-refresh text-xs', loading ? 'animate-spin' : '']"></i>
            <span>Frissítés</span>
          </button>
        </div>
      </div>

      <div v-if="loading && suppliers.length === 0" class="py-14 text-center text-sm text-[#686f6a]">
        Beszállítók betöltése...
      </div>

      <div
        v-else-if="filteredSuppliers.length === 0"
        class="py-14 text-center text-sm text-[#686f6a] bg-white/60 rounded-[12px] border border-dashed border-[#dce0d8]"
      >
        Nincs a keresésnek megfelelő beszállító.
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-[#eff1ed] text-[11px] font-semibold text-[#686f6a]">
              <th class="py-2.5 px-4 rounded-l-[8px]">Beszállító neve</th>
              <th class="py-2.5 px-4">E-mail</th>
              <th class="py-2.5 px-4">Telefonszám</th>
              <th class="py-2.5 px-4">Leírás / Megjegyzés</th>
              <th v-if="canEditOrDeleteSupplier" class="py-2.5 px-4 text-right rounded-r-[8px]">
                Műveletek
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#e8eae6] text-[13px]">
            <tr
              v-for="supplier in filteredSuppliers"
              :key="supplier.id"
              class="hover:bg-white/80 transition"
            >
              <td class="py-3 px-4 font-semibold text-[#171918]">
                <div class="flex items-center gap-2.5">
                  <div class="size-7 rounded-[8px] bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                    <i class="pi pi-building text-xs"></i>
                  </div>
                  <span>{{ supplier.name }}</span>
                </div>
              </td>
              <td class="py-3 px-4 text-[12px] text-[#171918]">
                <a
                  v-if="supplier.email"
                  :href="`mailto:${supplier.email}`"
                  class="hover:text-[#f46714] hover:underline"
                >
                  {{ supplier.email }}
                </a>
                <span v-else class="text-[#686f6a]">—</span>
              </td>
              <td class="py-3 px-4 text-[12px] text-[#171918] whitespace-nowrap">
                {{ supplier.phone || '—' }}
              </td>
              <td class="py-3 px-4 text-[12px] text-[#686f6a] max-w-md">
                {{ supplier.description || '—' }}
              </td>
              <td v-if="canEditOrDeleteSupplier" class="py-3 px-4 text-right whitespace-nowrap">
                <div class="inline-flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    @click="openEditModal(supplier)"
                    class="size-[28px] rounded-[8px] bg-white border border-[#e2e5df] hover:border-[#171918] text-[#686f6a] hover:text-[#171918] flex items-center justify-center transition cursor-pointer"
                    title="Beszállító szerkesztése"
                  >
                    <i class="pi pi-pencil text-xs"></i>
                  </button>
                  <button
                    type="button"
                    @click="openDeleteModal(supplier)"
                    class="size-[28px] rounded-[8px] bg-white border border-rose-200 hover:bg-rose-50 text-rose-600 flex items-center justify-center transition cursor-pointer"
                    title="Beszállító törlése"
                  >
                    <i class="pi pi-trash text-xs"></i>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 4. MODAL: LÉTREHOZÁS / SZERKESZTÉS -->
    <Dialog
      v-model:visible="isFormModalOpen"
      modal
      :header="formMode === 'create' ? 'Új beszállító létrehozása' : 'Beszállító szerkesztése'"
      :style="{ width: '30rem', maxWidth: '95vw' }"
    >
      <form @submit.prevent="handleSaveSupplier" class="space-y-4 pt-2">
        <div>
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Beszállító neve <span class="text-rose-500">*</span>
          </label>
          <input
            v-model="form.name"
            type="text"
            required
            maxlength="200"
            placeholder="Pl. Alpine Gear Europe GmbH"
            class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm text-[#171918] outline-none focus:border-[#f46714]"
          />
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label class="block text-xs font-semibold text-[#686f6a] mb-1">
              E-mail cím (opcionális)
            </label>
            <input
              v-model="form.email"
              type="email"
              maxlength="255"
              placeholder="orders@supplier.eu"
              class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm text-[#171918] outline-none focus:border-[#f46714]"
            />
          </div>

          <div>
            <label class="block text-xs font-semibold text-[#686f6a] mb-1">
              Telefonszám (opcionális)
            </label>
            <input
              v-model="form.phone"
              type="text"
              maxlength="50"
              placeholder="+36 1 234 5678"
              class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm text-[#171918] outline-none focus:border-[#f46714]"
            />
          </div>
        </div>

        <div>
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Leírás / Megjegyzés (opcionális, max. 1000 karakter)
          </label>
          <textarea
            v-model="form.description"
            rows="3"
            maxlength="1000"
            placeholder="Szállítási feltételek, kapcsolattartó neve, szerződésszám..."
            class="w-full rounded-xl border border-slate-200 p-3 text-sm text-[#171918] outline-none focus:border-[#f46714] resize-none"
          ></textarea>
        </div>

        <div class="flex justify-end gap-2 pt-2">
          <button
            type="button"
            @click="isFormModalOpen = false"
            class="h-[38px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 cursor-pointer"
          >
            Mégse
          </button>
          <button
            type="submit"
            :disabled="actionLoading || !form.name.trim()"
            class="h-[38px] px-4 rounded-xl bg-[#171918] hover:bg-[#2a2d2b] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {{ actionLoading ? 'Mentés...' : formMode === 'create' ? 'Létrehozás' : 'Mentés' }}
          </button>
        </div>
      </form>
    </Dialog>

    <!-- 5. MODAL: TÖRLÉS MEGERŐSÍTÉSE -->
    <Dialog
      v-model:visible="isDeleteConfirmOpen"
      modal
      header="Beszállító törlése"
      :style="{ width: '26rem', maxWidth: '95vw' }"
    >
      <div v-if="deletingSupplier" class="space-y-4 pt-1">
        <p class="text-sm text-[#686f6a]">
          Biztosan törölni szeretnéd a(z)
          <strong class="text-[#171918]">{{ deletingSupplier.name }}</strong>
          beszállítót?
        </p>
        <p class="text-xs text-[#686f6a] bg-[#f6f7f5] rounded-[10px] p-3 border border-[#e8eae6]">
          Ha a beszállítóhoz még tartoznak termékek a katalógusban, a rendszer megakadályozza a törlést.
        </p>
        <div class="flex justify-end gap-2 pt-1">
          <button
            type="button"
            @click="isDeleteConfirmOpen = false"
            class="h-[36px] px-4 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 cursor-pointer"
          >
            Mégse
          </button>
          <button
            type="button"
            :disabled="actionLoading"
            @click="handleDeleteSupplier"
            class="h-[36px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {{ actionLoading ? 'Törlés...' : 'Végleges törlés' }}
          </button>
        </div>
      </div>
    </Dialog>
  </div>
</template>
