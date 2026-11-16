<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Role } from '@wmanager/shared-types'
import { useAuthStore } from '@/stores/auth'
import { categoryApi, type Category } from '@/api/categories'
import { extractApiError } from '@/utils/locationMeta'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'

const authStore = useAuthStore()
const toast = useToast()

const categories = ref<Category[]>([])
const loading = ref(false)
const actionLoading = ref(false)

// Szűrők (kliensoldali szűrés kis, fix kategória-fához)
const searchQuery = ref('')
const statusFilter = ref<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL')
const levelFilter = ref<'ALL' | 'ROOT' | 'CHILD'>('ALL')

// Modal állapotok
const isFormModalOpen = ref(false)
const formMode = ref<'create' | 'edit'>('create')
const editingCategory = ref<Category | null>(null)
const form = ref({
  name: '',
  parentId: '' as string,
  isActive: true,
})

const isDeleteConfirmOpen = ref(false)
const deletingCategory = ref<Category | null>(null)

// RBAC: CategoryController -> @Roles(Role.ADMIN, Role.BOSS)
const canManageCategories = computed(() => {
  const role = authStore.user?.role
  return role === Role.ADMIN || role === Role.BOSS
})

const categoryById = computed(() => new Map(categories.value.map((c) => [c.id, c])))

const childrenCountByParentId = computed(() => {
  const counts = new Map<string, number>()
  for (const cat of categories.value) {
    if (cat.parentId) {
      counts.set(cat.parentId, (counts.get(cat.parentId) ?? 0) + 1)
    }
  }
  return counts
})

function getCategoryPath(categoryId: string): Category[] {
  const path: Category[] = []
  const seen = new Set<string>()
  let current = categoryById.value.get(categoryId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId ? categoryById.value.get(current.parentId) : undefined
  }
  return path
}

function getFullPathLabel(categoryId: string): string {
  return getCategoryPath(categoryId)
    .map((c) => c.name)
    .join(' › ')
}

function getParentName(cat: Category): string {
  if (!cat.parentId) return '— (Főkategória)'
  return categoryById.value.get(cat.parentId)?.name ?? 'Ismeretlen szülő'
}

// Körkörös hierarchia megelőzése: leszármazottak kigyűjtése szerkesztéskor
function getDescendantIds(rootId: string): Set<string> {
  const descendants = new Set<string>()
  const queue: string[] = [rootId]
  while (queue.length > 0) {
    const currentId = queue.shift()!
    for (const cat of categories.value) {
      if (cat.parentId === currentId && !descendants.has(cat.id)) {
        descendants.add(cat.id)
        queue.push(cat.id)
      }
    }
  }
  return descendants
}

const availableParentCategories = computed(() => {
  const excludedIds = new Set<string>()
  if (formMode.value === 'edit' && editingCategory.value) {
    excludedIds.add(editingCategory.value.id)
    for (const descId of getDescendantIds(editingCategory.value.id)) {
      excludedIds.add(descId)
    }
  }
  return categories.value
    .filter((c) => !excludedIds.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      fullPath: getFullPathLabel(c.id),
      isActive: c.isActive,
    }))
    .sort((a, b) => a.fullPath.localeCompare(b.fullPath, 'hu'))
})

// Rendezett és szűrt kategóriák
const enrichedCategories = computed(() => {
  return categories.value
    .map((cat) => {
      const path = getCategoryPath(cat.id)
      return {
        category: cat,
        depth: Math.max(0, path.length - 1),
        fullPath: path.map((p) => p.name).join(' › '),
        parentName: getParentName(cat),
        childCount: childrenCountByParentId.value.get(cat.id) ?? 0,
      }
    })
    .sort((a, b) => a.fullPath.localeCompare(b.fullPath, 'hu'))
})

const filteredCategories = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  return enrichedCategories.value.filter((item) => {
    const matchesSearch =
      !q ||
      item.category.name.toLowerCase().includes(q) ||
      item.fullPath.toLowerCase().includes(q) ||
      item.parentName.toLowerCase().includes(q)

    const matchesStatus =
      statusFilter.value === 'ALL' ||
      (statusFilter.value === 'ACTIVE' && item.category.isActive) ||
      (statusFilter.value === 'INACTIVE' && !item.category.isActive)

    const matchesLevel =
      levelFilter.value === 'ALL' ||
      (levelFilter.value === 'ROOT' && !item.category.parentId) ||
      (levelFilter.value === 'CHILD' && Boolean(item.category.parentId))

    return matchesSearch && matchesStatus && matchesLevel
  })
})

const hasActiveFilters = computed(
  () =>
    searchQuery.value.trim().length > 0 ||
    statusFilter.value !== 'ALL' ||
    levelFilter.value !== 'ALL',
)

// KPI mutatók
const totalCount = computed(() => categories.value.length)
const rootCount = computed(() => categories.value.filter((c) => !c.parentId).length)
const childCount = computed(() => categories.value.filter((c) => Boolean(c.parentId)).length)
const activeCount = computed(() => categories.value.filter((c) => c.isActive).length)

function resetFilters() {
  searchQuery.value = ''
  statusFilter.value = 'ALL'
  levelFilter.value = 'ALL'
}

function formatDate(dateStr?: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('hu-HU', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  })
}

async function loadCategories() {
  loading.value = true
  try {
    const response = await categoryApi.getAll()
    categories.value = response.data
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Hiba történt',
      detail: extractApiError(err, 'Nem sikerült betölteni a kategóriákat.'),
      life: 5000,
    })
  } finally {
    loading.value = false
  }
}

function openCreateModal(initialParentId = '') {
  formMode.value = 'create'
  editingCategory.value = null
  form.value = {
    name: '',
    parentId: initialParentId,
    isActive: true,
  }
  isFormModalOpen.value = true
}

function openEditModal(cat: Category) {
  formMode.value = 'edit'
  editingCategory.value = cat
  form.value = {
    name: cat.name,
    parentId: cat.parentId ?? '',
    isActive: cat.isActive,
  }
  isFormModalOpen.value = true
}

function openDeleteModal(cat: Category) {
  deletingCategory.value = cat
  isDeleteConfirmOpen.value = true
}

async function handleSaveCategory() {
  const trimmedName = form.value.name.trim()
  if (!trimmedName) return

  actionLoading.value = true
  try {
    if (formMode.value === 'create') {
      await categoryApi.create({
        name: trimmedName,
        parentId: form.value.parentId || undefined,
        isActive: form.value.isActive,
      })
      toast.add({
        severity: 'success',
        summary: 'Kategória létrehozva',
        detail: `„${trimmedName}” sikeresen rögzítve.`,
        life: 3500,
      })
    } else if (editingCategory.value) {
      await categoryApi.update(editingCategory.value.id, {
        name: trimmedName,
        parentId: form.value.parentId ? form.value.parentId : null,
        isActive: form.value.isActive,
      })
      toast.add({
        severity: 'success',
        summary: 'Kategória frissítve',
        detail: `„${trimmedName}” módosításai elmentve.`,
        life: 3500,
      })
    }
    isFormModalOpen.value = false
    await loadCategories()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Mentési hiba',
      detail: extractApiError(err, 'Nem sikerült menteni a kategóriát.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

async function handleDeleteCategory() {
  if (!deletingCategory.value) return
  actionLoading.value = true
  try {
    const targetName = deletingCategory.value.name
    await categoryApi.remove(deletingCategory.value.id)
    isDeleteConfirmOpen.value = false
    deletingCategory.value = null
    toast.add({
      severity: 'success',
      summary: 'Kategória törölve',
      detail: `„${targetName}” véglegesen törölve.`,
      life: 3500,
    })
    await loadCategories()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Nem törölhető',
      detail: extractApiError(
        err,
        'A kategória nem törölhető, mert alkategóriák vagy termékek tartoznak hozzá.',
      ),
      life: 6000,
    })
  } finally {
    actionLoading.value = false
  }
}

onMounted(() => {
  loadCategories()
})
</script>

<template>
  <div class="space-y-6 text-[#171918]">
    <!-- 1. FEJLÉC -->
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div>
        <h1 class="text-[26px] font-semibold tracking-[-0.36px] text-[#171918] leading-tight">
          Termékkategóriák
        </h1>
        <p class="text-[13px] text-[#686f6a] mt-1">
          Hierarchikus kategória-struktúra, főkategóriák és alkategóriák kezelése.
        </p>
      </div>

      <div class="flex items-center gap-2.5">
        <button
          v-if="canManageCategories"
          type="button"
          @click="openCreateModal()"
          class="bg-[#171918] hover:bg-[#2a2d2b] border border-white h-[40px] px-4 rounded-[12px] text-[13px] font-medium text-white flex items-center gap-2 shadow-xs transition cursor-pointer"
        >
          <i class="pi pi-plus text-xs text-white"></i>
          <span>+ Új kategória</span>
        </button>
      </div>
    </div>

    <!-- 2. NÉGY MUTATÓ KÁRTYA -->
    <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      <div class="bg-[#f6f7f5] border border-white rounded-[18px] p-4 flex items-center gap-3.5 shadow-2xs">
        <div class="bg-white rounded-[13px] size-[46px] flex items-center justify-center shrink-0 shadow-2xs">
          <i class="pi pi-sitemap text-[18px] text-[#171918]"></i>
        </div>
        <div>
          <p class="text-[11px] text-[#686f6a]">Összes kategória</p>
          <p class="text-[26px] font-semibold text-[#171918] leading-tight">{{ totalCount }}</p>
        </div>
      </div>

      <div class="bg-[#f6f7f5] border border-white rounded-[18px] p-4 flex items-center gap-3.5 shadow-2xs">
        <div class="bg-white rounded-[13px] size-[46px] flex items-center justify-center shrink-0 shadow-2xs">
          <i class="pi pi-folder text-[18px] text-[#f46714]"></i>
        </div>
        <div>
          <p class="text-[11px] text-[#686f6a]">Főkategóriák</p>
          <p class="text-[26px] font-semibold text-[#171918] leading-tight">{{ rootCount }}</p>
        </div>
      </div>

      <div class="bg-[#f6f7f5] border border-white rounded-[18px] p-4 flex items-center gap-3.5 shadow-2xs">
        <div class="bg-white rounded-[13px] size-[46px] flex items-center justify-center shrink-0 shadow-2xs">
          <i class="pi pi-folder-open text-[18px] text-blue-600"></i>
        </div>
        <div>
          <p class="text-[11px] text-[#686f6a]">Alkategóriák</p>
          <p class="text-[26px] font-semibold text-[#171918] leading-tight">{{ childCount }}</p>
        </div>
      </div>

      <div class="bg-[#f6f7f5] border border-white rounded-[18px] p-4 flex items-center gap-3.5 shadow-2xs">
        <div class="bg-white rounded-[13px] size-[46px] flex items-center justify-center shrink-0 shadow-2xs">
          <i class="pi pi-check-circle text-[18px] text-[#298653]"></i>
        </div>
        <div>
          <p class="text-[11px] text-[#686f6a]">Aktív kategóriák</p>
          <p class="text-[26px] font-semibold text-[#171918] leading-tight">{{ activeCount }}</p>
        </div>
      </div>
    </div>

    <!-- 3. FŐ LISTA KÁRTYA -->
    <div class="bg-[#f8f9f7] border border-white rounded-[16px] p-5 shadow-xs space-y-4">
      <!-- Szűrősáv -->
      <div class="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#e8eae6]">
        <div class="flex flex-wrap items-center gap-2.5 flex-1 min-w-[240px]">
          <div class="relative flex-1 min-w-[220px] max-w-md">
            <i class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"></i>
            <input
              v-model="searchQuery"
              type="text"
              placeholder="Keresés kategória vagy útvonal alapján..."
              class="w-full h-[38px] bg-white border border-white rounded-[10px] pl-9 pr-3 text-[12px] text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]/40 transition"
            />
          </div>

          <select
            v-model="levelFilter"
            class="h-[38px] bg-white border border-white rounded-[10px] px-3 text-[12px] text-[#171918] outline-none cursor-pointer"
          >
            <option value="ALL">Minden szint</option>
            <option value="ROOT">Csak főkategóriák</option>
            <option value="CHILD">Csak alkategóriák</option>
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

        <div class="flex items-center gap-3">
          <span class="bg-[#e9ece7] text-[#171918] text-[11px] font-medium px-2.5 py-1 rounded-[7px]">
            {{ filteredCategories.length }} / {{ totalCount }} kategória
          </span>

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
            @click="loadCategories"
            class="text-xs text-[#686f6a] hover:text-[#171918] flex items-center gap-1.5 cursor-pointer transition"
          >
            <i :class="['pi pi-refresh text-xs', loading ? 'animate-spin' : '']"></i>
            <span>Frissítés</span>
          </button>
        </div>
      </div>

      <!-- Táblázat -->
      <div v-if="loading && categories.length === 0" class="py-14 text-center text-sm text-[#686f6a]">
        Kategóriák betöltése...
      </div>

      <div
        v-else-if="filteredCategories.length === 0"
        class="py-14 text-center text-sm text-[#686f6a] bg-white/60 rounded-[12px] border border-dashed border-[#dce0d8]"
      >
        Nincs a keresésnek megfelelő kategória.
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-left border-collapse">
          <thead>
            <tr class="bg-[#eff1ed] text-[11px] font-semibold text-[#686f6a]">
              <th class="py-2.5 px-4 rounded-l-[8px]">Kategória neve</th>
              <th class="py-2.5 px-4">Teljes hierarchia útvonal</th>
              <th class="py-2.5 px-4">Szülő kategória</th>
              <th class="py-2.5 px-4">Alkategóriák</th>
              <th class="py-2.5 px-4">Állapot</th>
              <th class="py-2.5 px-4">Módosítva</th>
              <th v-if="canManageCategories" class="py-2.5 px-4 text-right rounded-r-[8px]">
                Műveletek
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-[#e8eae6] text-[13px]">
            <tr
              v-for="item in filteredCategories"
              :key="item.category.id"
              class="hover:bg-white/80 transition"
            >
              <!-- Kategória név behúzással -->
              <td class="py-3 px-4 font-semibold text-[#171918]">
                <div
                  class="flex items-center gap-2"
                  :style="{ paddingLeft: `${item.depth * 18}px` }"
                >
                  <i
                    :class="[
                      'pi text-xs',
                      item.category.parentId
                        ? 'pi-angle-right text-[#686f6a]'
                        : 'pi-folder text-[#f46714]',
                    ]"
                  ></i>
                  <span :class="!item.category.isActive ? 'line-through text-[#686f6a]' : ''">
                    {{ item.category.name }}
                  </span>
                </div>
              </td>

              <!-- Teljes útvonal -->
              <td class="py-3 px-4 text-[12px] text-[#686f6a]">
                {{ item.fullPath }}
              </td>

              <!-- Szülő -->
              <td class="py-3 px-4 text-[12px]">
                <span
                  v-if="item.category.parentId"
                  class="inline-flex items-center px-2 py-0.5 rounded-md bg-white border border-[#e8eae6] text-[#171918] font-medium"
                >
                  {{ item.parentName }}
                </span>
                <span v-else class="text-[#686f6a] text-[11px]">Főkategória</span>
              </td>

              <!-- Alkategóriák száma -->
              <td class="py-3 px-4 text-[12px] text-[#686f6a]">
                <span
                  v-if="item.childCount > 0"
                  class="inline-flex items-center px-2 py-0.5 rounded-md bg-[#eff1ed] text-[#171918] text-[11px] font-medium"
                >
                  {{ item.childCount }} db
                </span>
                <span v-else>—</span>
              </td>

              <!-- Állapot -->
              <td class="py-3 px-4">
                <span
                  class="inline-flex items-center px-2.5 py-0.5 rounded-[7px] text-[11px] font-medium"
                  :class="
                    item.category.isActive
                      ? 'bg-[#e5f0e8] text-[#298653]'
                      : 'bg-rose-50 text-rose-600'
                  "
                >
                  {{ item.category.isActive ? 'Aktív' : 'Inaktív' }}
                </span>
              </td>

              <!-- Módosítva -->
              <td class="py-3 px-4 text-[12px] text-[#686f6a]">
                {{ formatDate(item.category.updatedAt) }}
              </td>

              <!-- Műveletek -->
              <td v-if="canManageCategories" class="py-3 px-4 text-right">
                <div class="inline-flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    @click="openCreateModal(item.category.id)"
                    class="h-[28px] px-2.5 rounded-[8px] bg-[#eff1ed] hover:bg-[#171918] text-[#171918] hover:text-white text-[11px] font-medium transition cursor-pointer"
                    title="Alkategória hozzáadása"
                  >
                    + Alkategória
                  </button>
                  <button
                    type="button"
                    @click="openEditModal(item.category)"
                    class="size-[28px] rounded-[8px] bg-white border border-[#e2e5df] hover:border-[#171918] text-[#686f6a] hover:text-[#171918] flex items-center justify-center transition cursor-pointer"
                    title="Kategória szerkesztése"
                  >
                    <i class="pi pi-pencil text-xs"></i>
                  </button>
                  <button
                    type="button"
                    @click="openDeleteModal(item.category)"
                    class="size-[28px] rounded-[8px] bg-white border border-rose-200 hover:bg-rose-50 text-rose-600 flex items-center justify-center transition cursor-pointer"
                    title="Kategória törlése"
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
      :header="formMode === 'create' ? 'Új kategória létrehozása' : 'Kategória szerkesztése'"
      :style="{ width: '28rem', maxWidth: '95vw' }"
    >
      <form @submit.prevent="handleSaveCategory" class="space-y-4 pt-2">
        <div>
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Kategória neve <span class="text-rose-500">*</span>
          </label>
          <input
            v-model="form.name"
            type="text"
            required
            maxlength="150"
            placeholder="Pl. Túrakabátok"
            class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm text-[#171918] outline-none focus:border-[#f46714]"
          />
        </div>

        <div>
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Szülő kategória (opcionális)
          </label>
          <select
            v-model="form.parentId"
            class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm text-[#171918] outline-none focus:border-[#f46714] bg-white"
          >
            <option value="">— Főkategória (nincs szülő) —</option>
            <option
              v-for="parent in availableParentCategories"
              :key="parent.id"
              :value="parent.id"
            >
              {{ parent.fullPath }}{{ !parent.isActive ? ' (inaktív)' : '' }}
            </option>
          </select>
          <p v-if="formMode === 'edit'" class="text-[11px] text-[#686f6a] mt-1">
            A körkörös hierarchia elkerülése érdekében a kategória saját maga és leszármazottai nem választhatók.
          </p>
        </div>

        <div class="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200">
          <div>
            <p class="text-xs font-semibold text-[#171918]">Kategória aktív</p>
            <p class="text-[11px] text-[#686f6a]">
              Inaktív kategória megmarad az előzményekben, de új termékekhez nem ajánlott
            </p>
          </div>
          <input
            v-model="form.isActive"
            type="checkbox"
            class="size-4 accent-[#f46714] cursor-pointer"
          />
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
      header="Kategória törlése"
      :style="{ width: '26rem', maxWidth: '95vw' }"
    >
      <div v-if="deletingCategory" class="space-y-4 pt-1">
        <p class="text-sm text-[#686f6a]">
          Biztosan törölni szeretnéd a(z)
          <strong class="text-[#171918]">{{ deletingCategory.name }}</strong>
          kategóriát?
        </p>
        <p class="text-xs text-[#686f6a] bg-[#f6f7f5] rounded-[10px] p-3 border border-[#e8eae6]">
          Ha a kategóriának még vannak alkategóriái vagy tartoznak hozzá termékek, a rendszer megakadályozza a törlést.
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
            @click="handleDeleteCategory"
            class="h-[36px] px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            {{ actionLoading ? 'Törlés...' : 'Végleges törlés' }}
          </button>
        </div>
      </div>
    </Dialog>
  </div>
</template>
