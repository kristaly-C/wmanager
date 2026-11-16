<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Role } from '@wmanager/shared-types'
import { useAuthStore } from '@/stores/auth'
import { brandApi, type BrandItem } from '@/api/brands'
import { extractApiError } from '@/utils/locationMeta'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'

const authStore = useAuthStore()
const toast = useToast()

const brands = ref<BrandItem[]>([])
const loading = ref(false)
const actionLoading = ref(false)

const searchQuery = ref('')

// Modal állapotok
const isFormModalOpen = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const editingBrand = ref<BrandItem | null>(null)
const form = ref({
  name: '',
  description: '',
})

const isDeleteConfirmOpen = ref(false)
const deletingBrand = ref<BrandItem | null>(null)

// RBAC: BrandController -> @Roles(Role.ADMIN, Role.BOSS, Role.WAREHOUSE_MANAGER)
const canManageBrands = computed(() => {
  const role = authStore.user?.role
  return (
    role === Role.ADMIN ||
    role === Role.BOSS ||
    role === Role.WAREHOUSE_MANAGER
  )
})

const filteredBrands = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return brands.value
  return brands.value.filter(
    (b) =>
      b.name.toLowerCase().includes(q) ||
      (b.description?.toLowerCase().includes(q) ?? false),
  )
})

const brandsWithDescriptionCount = computed(
  () => brands.value.filter((b) => Boolean(b.description?.trim())).length,
)

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

async function loadBrands() {
  loading.value = true
  try {
    const res = await brandApi.getAll()
    brands.value = res.data
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Hiba történt',
      detail: extractApiError(err, 'Nem sikerült betölteni a márkákat.'),
      life: 5000,
    })
  } finally {
    loading.value = false
  }
}

function openCreateModal() {
  formMode.value = 'create'
  editingBrand.value = null
  form.value = {
    name: '',
    description: '',
  }
  isFormModalOpen.value = true
}

function openEditModal(brand: BrandItem) {
  formMode.value = 'edit'
  editingBrand.value = brand
  form.value = {
    name: brand.name,
    description: brand.description ?? '',
  }
  isFormModalOpen.value = true
}

function openDeleteModal(brand: BrandItem) {
  deletingBrand.value = brand
  isDeleteConfirmOpen.value = true
}

async function handleSaveBrand() {
  const trimmedName = form.value.name.trim()
  if (!trimmedName) return
  const trimmedDesc = form.value.description.trim()

  actionLoading.value = true
  try {
    if (formMode.value === 'create') {
      await brandApi.create({
        name: trimmedName,
        description: trimmedDesc || undefined,
      })
      toast.add({
        severity: 'success',
        summary: 'Márka létrehozva',
        detail: `„${trimmedName}” sikeresen rögzítve.`,
        life: 3500,
      })
    } else if (editingBrand.value) {
      await brandApi.update(editingBrand.value.id, {
        name: trimmedName,
        description: trimmedDesc,
      })
      toast.add({
        severity: 'success',
        summary: 'Márka frissítve',
        detail: `„${trimmedName}” adatai elmentve.`,
        life: 3500,
      })
    }
    isFormModalOpen.value = false
    await loadBrands()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Mentési hiba',
      detail: extractApiError(err, 'Nem sikerült menteni a márkát.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

async function handleDeleteBrand() {
  if (!deletingBrand.value) return
  actionLoading.value = true
  try {
    const targetName = deletingBrand.value.name
    await brandApi.remove(deletingBrand.value.id)
    isDeleteConfirmOpen.value = false
    deletingBrand.value = null
    toast.add({
      severity: 'success',
      summary: 'Márka törölve',
      detail: `„${targetName}” sikeresen törölve.`,
      life: 3500,
    })
    await loadBrands()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Nem törölhető',
      detail: extractApiError(
        err,
        'A márka nem törölhető, mert termékek hivatkoznak rá.',
      ),
      life: 6000,
    })
  } finally {
    actionLoading.value = false
  }
}

onMounted(() => {
  loadBrands()
})
</script>

<template>
  <div class="space-y-6 text-[#171918]">
    <!-- 1. FEJLÉC -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-[26px] font-semibold tracking-[-0.36px] text-[#171918] leading-tight">
          Márkák
        </h1>
        <p class="text-[13px] text-[#686f6a] mt-1">
          A termékkatalógusban szereplő gyártói márkák és leírások kezelése.
        </p>
      </div>

      <div class="flex items-center gap-2.5">
        <button
          v-if="canManageBrands"
          type="button"
          @click="openCreateModal"
          class="bg-[#171918] hover:bg-[#2a2d2b] border border-white h-[40px] px-4 rounded-[12px] text-[13px] font-medium text-white flex items-center gap-2 shadow-xs transition cursor-pointer"
        >
          <i class="pi pi-plus text-xs text-white"></i>
          <span>+ Új márka</span>
        </button>
      </div>
    </div>

    <!-- 2. MUTATÓ KÁRTYÁK -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="bg-[#f6f7f5] border border-white rounded-[18px] p-4 flex items-center gap-3.5 shadow-2xs">
        <div class="bg-white rounded-[13px] size-[46px] flex items-center justify-center shrink-0 shadow-2xs">
          <i class="pi pi-verified text-[18px] text-[#171918]"></i>
        </div>
        <div>
          <p class="text-[11px] text-[#686f6a]">Összes márka</p>
          <p class="text-[26px] font-semibold text-[#171918] leading-tight">{{ brands.length }}</p>
        </div>
      </div>

      <div class="bg-[#f6f7f5] border border-white rounded-[18px] p-4 flex items-center gap-3.5 shadow-2xs">
        <div class="bg-white rounded-[13px] size-[46px] flex items-center justify-center shrink-0 shadow-2xs">
          <i class="pi pi-file-edit text-[18px] text-[#f46714]"></i>
        </div>
        <div>
          <p class="text-[11px] text-[#686f6a]">Leírással ellátott</p>
          <p class="text-[26px] font-semibold text-[#171918] leading-tight">
            {{ brandsWithDescriptionCount }}
          </p>
        </div>
      </div>

      <div class="bg-[#f6f7f5] border border-white rounded-[18px] p-4 flex items-center gap-3.5 shadow-2xs">
        <div class="bg-white rounded-[13px] size-[46px] flex items-center justify-center shrink-0 shadow-2xs">
          <i class="pi pi-filter text-[18px] text-[#298653]"></i>
        </div>
        <div>
          <p class="text-[11px] text-[#686f6a]">Megjelenített találatok</p>
          <p class="text-[26px] font-semibold text-[#171918] leading-tight">
            {{ filteredBrands.length }}
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
            placeholder="Keresés márkanév vagy leírás alapján..."
            class="w-full h-[38px] bg-white border border-white rounded-[10px] pl-9 pr-3 text-[12px] text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]/40 transition"
          />
        </div>

        <div class="flex items-center gap-3">
          <span class="bg-[#e9ece7] text-[#171918] text-[11px] font-medium px-2.5 py-1 rounded-[7px]">
            {{ filteredBrands.length }} márka
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
            @click="loadBrands"
            class="text-xs text-[#686f6a] hover:text-[#171918] flex items-center gap-1.5 cursor-pointer transition"
          >
            <i :class="['pi pi-refresh text-xs', loading ? 'animate-spin' : '']"></i>
            <span>Frissítés</span>
          </button>
        </div>
      </div>

      <div v-if="loading && brands.length === 0" class="py-14 text-center text-sm text-[#686f6a]">
        Márkák betöltése...
      </div>

      <div
        v-else-if="filteredBrands.length === 0"
        class="py-14 text-center text-sm text-[#686f6a] bg-white/60 rounded-[12px] border border-dashed border-[#dce0d8]"
      >
        Nincs a keresésnek megfelelő márka.
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-[#eff1ed] text-[11px] font-semibold text-[#686f6a]">
              <th class="py-2.5 px-4 rounded-l-[8px]">Márka neve</th>
              <th class="py-2.5 px-4">Leírás</th>
              <th class="py-2.5 px-4">Létrehozva</th>
              <th v-if="canManageBrands" class="py-2.5 px-4 text-right rounded-r-[8px]">
                Műveletek
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#e8eae6] text-[13px]">
            <tr
              v-for="brand in filteredBrands"
              :key="brand.id"
              class="hover:bg-white/80 transition"
            >
              <td class="py-3 px-4 font-semibold text-[#171918]">
                <div class="flex items-center gap-2.5">
                  <div class="size-7 rounded-[8px] bg-[#fff0e5] text-[#f46714] flex items-center justify-center shrink-0">
                    <i class="pi pi-verified text-xs"></i>
                  </div>
                  <span>{{ brand.name }}</span>
                </div>
              </td>
              <td class="py-3 px-4 text-[12px] text-[#686f6a] max-w-xl">
                {{ brand.description || '—' }}
              </td>
              <td class="py-3 px-4 text-[12px] text-[#686f6a] whitespace-nowrap">
                {{ formatDate(brand.createdAt) }}
              </td>
              <td v-if="canManageBrands" class="py-3 px-4 text-right whitespace-nowrap">
                <div class="inline-flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    @click="openEditModal(brand)"
                    class="size-[28px] rounded-[8px] bg-white border border-[#e2e5df] hover:border-[#171918] text-[#686f6a] hover:text-[#171918] flex items-center justify-center transition cursor-pointer"
                    title="Márka szerkesztése"
                  >
                    <i class="pi pi-pencil text-xs"></i>
                  </button>
                  <button
                    type="button"
                    @click="openDeleteModal(brand)"
                    class="size-[28px] rounded-[8px] bg-white border border-rose-200 hover:bg-rose-50 text-rose-600 flex items-center justify-center transition cursor-pointer"
                    title="Márka törlése"
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
      :header="formMode === 'create' ? 'Új márka létrehozása' : 'Márka szerkesztése'"
      :style="{ width: '28rem', maxWidth: '95vw' }"
    >
      <form @submit.prevent="handleSaveBrand" class="space-y-4 pt-2">
        <div>
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Márka neve <span class="text-rose-500">*</span>
          </label>
          <input
            v-model="form.name"
            type="text"
            required
            maxlength="150"
            placeholder="Pl. The North Face"
            class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm text-[#171918] outline-none focus:border-[#f46714]"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Leírás (opcionális, max. 1000 karakter)
          </label>
          <textarea
            v-model="form.description"
            rows="3"
            maxlength="1000"
            placeholder="Rövid leírás a márkáról vagy a forgalmazott termékkörről..."
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
      header="Márka törlése"
      :style="{ width: '26rem', maxWidth: '95vw' }"
    >
      <div v-if="deletingBrand" class="space-y-4 pt-1">
        <p class="text-sm text-[#686f6a]">
          Biztosan törölni szeretnéd a(z)
          <strong class="text-[#171918]">{{ deletingBrand.name }}</strong>
          márkát?
        </p>
        <p class="text-xs text-[#686f6a] bg-[#f6f7f5] rounded-[10px] p-3 border border-[#e8eae6]">
          Ha a márkához még tartoznak termékek, a rendszer megakadályozza a törlést.
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
            @click="handleDeleteBrand"
            class="h-[36px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {{ actionLoading ? 'Törlés...' : 'Végleges törlés' }}
          </button>
        </div>
      </div>
    </Dialog>
  </div>
</template>
