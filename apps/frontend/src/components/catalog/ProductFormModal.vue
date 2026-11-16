<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { productApi, type CreateProductPayload, type ProductListItem } from '@/api/products'
import type { BrandItem } from '@/api/brands'
import type { Category } from '@/api/categories'
import type { SupplierItem } from '@/api/suppliers'
import { extractApiError } from '@/utils/locationMeta'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'

const props = defineProps<{
  visible: boolean
  mode: 'create' | 'edit'
  editingProduct: ProductListItem | null
  brands: BrandItem[]
  categories: Category[]
  suppliers: SupplierItem[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'saved', product: ProductListItem): void
}>()

const toast = useToast()
const saving = ref(false)

const DEFAULT_GENDERS = ['Férfi', 'Női', 'Unisex', 'Gyerek']

const form = ref({
  name: '',
  brandId: '',
  categoryId: '',
  primarySupplierId: '',
  model: '',
  manufacturerCode: '',
  gender: 'Unisex',
  vatRate: 27,
  material: '',
  usageArea: '',
  functionality: '',
  imageUrls: [] as string[],
  isActive: true,
})

const newImageUrl = ref('')

const genderOptions = computed(() => {
  const current = form.value.gender.trim()
  if (current && !DEFAULT_GENDERS.includes(current)) {
    return [current, ...DEFAULT_GENDERS]
  }
  return DEFAULT_GENDERS
})

const categoryById = computed(() => new Map(props.categories.map((c) => [c.id, c])))

function getCategoryPathLabel(categoryId: string): string {
  const parts: string[] = []
  const seen = new Set<string>()
  let current = categoryById.value.get(categoryId)
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    parts.unshift(current.name)
    current = current.parentId ? categoryById.value.get(current.parentId) : undefined
  }
  return parts.join(' › ')
}

const categoryOptions = computed(() => {
  return props.categories
    .map((c) => ({
      id: c.id,
      isActive: c.isActive,
      label: getCategoryPathLabel(c.id),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'hu'))
})

const sortedBrands = computed(() =>
  [...props.brands].sort((a, b) => a.name.localeCompare(b.name, 'hu')),
)

const sortedSuppliers = computed(() =>
  [...props.suppliers].sort((a, b) => a.name.localeCompare(b.name, 'hu')),
)

const dialogTitle = computed(() =>
  props.mode === 'edit' ? 'Termék szerkesztése' : 'Új termék létrehozása',
)

watch(
  () => props.visible,
  (isOpen) => {
    if (!isOpen) return
    newImageUrl.value = ''
    if (props.mode === 'edit' && props.editingProduct) {
      const p = props.editingProduct
      form.value = {
        name: p.name,
        brandId: p.brandId,
        categoryId: p.categoryId,
        primarySupplierId: p.primarySupplierId,
        model: p.model,
        manufacturerCode: p.manufacturerCode,
        gender: p.gender || 'Unisex',
        vatRate: Number(p.vatRate ?? 27),
        material: p.material ?? '',
        usageArea: p.usageArea ?? '',
        functionality: p.functionality ?? '',
        imageUrls: Array.isArray(p.imageUrls) ? [...p.imageUrls] : [],
        isActive: p.isActive,
      }
    } else {
      form.value = {
        name: '',
        brandId: sortedBrands.value[0]?.id ?? '',
        categoryId: categoryOptions.value[0]?.id ?? '',
        primarySupplierId: sortedSuppliers.value[0]?.id ?? '',
        model: '',
        manufacturerCode: '',
        gender: 'Unisex',
        vatRate: 27,
        material: '',
        usageArea: '',
        functionality: '',
        imageUrls: [],
        isActive: true,
      }
    }
  },
)

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function addImageUrl() {
  const url = newImageUrl.value.trim()
  if (!url) return
  if (!isValidHttpUrl(url)) {
    toast.add({
      severity: 'error',
      summary: 'Érvénytelen URL',
      detail: 'A kép URL-nek http:// vagy https:// előtaggal kell kezdődnie.',
      life: 4000,
    })
    return
  }
  if (form.value.imageUrls.length >= 20) {
    toast.add({
      severity: 'error',
      summary: 'Maximum elérve',
      detail: 'Legfeljebb 20 kép URL adható meg egy termékhez.',
      life: 4000,
    })
    return
  }
  if (!form.value.imageUrls.includes(url)) {
    form.value.imageUrls.push(url)
  }
  newImageUrl.value = ''
}

function removeImageUrl(index: number) {
  form.value.imageUrls.splice(index, 1)
}

function closeModal() {
  emit('update:visible', false)
}

async function handleSubmit() {
  const name = form.value.name.trim()
  const model = form.value.model.trim()
  const manufacturerCode = form.value.manufacturerCode.trim()
  const gender = form.value.gender.trim()
  const vatRate = Number(form.value.vatRate)

  if (!name || !model || !manufacturerCode || !gender) {
    toast.add({
      severity: 'error',
      summary: 'Hiányzó adatok',
      detail: 'A név, modell, gyártói kód és nem megadása kötelező.',
      life: 4000,
    })
    return
  }

  if (!form.value.brandId || !form.value.categoryId || !form.value.primarySupplierId) {
    toast.add({
      severity: 'error',
      summary: 'Hiányzó kapcsolatok',
      detail: 'Kérjük válassz márkát, kategóriát és elsődleges beszállítót.',
      life: 4000,
    })
    return
  }

  if (Number.isNaN(vatRate) || vatRate < 0 || vatRate > 100) {
    toast.add({
      severity: 'error',
      summary: 'Érvénytelen ÁFA kulcs',
      detail: 'Az ÁFA kulcsnak 0 és 100 közötti számnak kell lennie.',
      life: 4000,
    })
    return
  }

  // Ha maradt beírt URL a mezőben, automatikusan ellenőrizzük és hozzáadjuk
  const pendingUrl = newImageUrl.value.trim()
  if (pendingUrl) {
    if (!isValidHttpUrl(pendingUrl)) {
      toast.add({
        severity: 'error',
        summary: 'Érvénytelen URL',
        detail: 'A kép URL-nek http:// vagy https:// előtaggal kell kezdődnie.',
        life: 4000,
      })
      return
    }
    if (!form.value.imageUrls.includes(pendingUrl)) {
      form.value.imageUrls.push(pendingUrl)
    }
    newImageUrl.value = ''
  }

  for (const url of form.value.imageUrls) {
    if (!isValidHttpUrl(url)) {
      toast.add({
        severity: 'error',
        summary: 'Érvénytelen URL',
        detail: `Hibás kép URL: ${url}`,
        life: 4000,
      })
      return
    }
  }

  const payload: CreateProductPayload = {
    name,
    brandId: form.value.brandId,
    categoryId: form.value.categoryId,
    primarySupplierId: form.value.primarySupplierId,
    model,
    manufacturerCode,
    gender,
    vatRate,
    material: form.value.material.trim() || undefined,
    usageArea: form.value.usageArea.trim() || undefined,
    functionality: form.value.functionality.trim() || undefined,
    imageUrls: form.value.imageUrls,
    isActive: form.value.isActive,
  }

  saving.value = true
  try {
    let saved: ProductListItem
    if (props.mode === 'create') {
      const res = await productApi.create(payload)
      saved = res.data
      toast.add({
        severity: 'success',
        summary: 'Termék létrehozva',
        detail: `„${saved.name}” sikeresen felvéve a katalógusba.`,
        life: 3500,
      })
    } else {
      if (!props.editingProduct) return
      const res = await productApi.update(props.editingProduct.id, payload)
      saved = res.data
      toast.add({
        severity: 'success',
        summary: 'Termék frissítve',
        detail: `„${saved.name}” adatai sikeresen mentve.`,
        life: 3500,
      })
    }
    emit('saved', saved)
    closeModal()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Mentési hiba',
      detail: extractApiError(err, 'Nem sikerült menteni a terméket.'),
      life: 5000,
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="(val) => emit('update:visible', val)"
    modal
    :header="dialogTitle"
    :style="{ width: '40rem', maxWidth: '95vw' }"
  >
    <form @submit.prevent="handleSubmit" class="space-y-4 pt-1">
      <!-- Név -->
      <div class="space-y-1.5">
        <label class="block text-xs font-medium text-slate-600">Termék megnevezése *</label>
        <input
          v-model="form.name"
          type="text"
          required
          maxlength="255"
          placeholder="pl. Alpinestars T-GP Plus R v3 Air Textil Kabát"
          class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
        />
      </div>

      <!-- Márka + Kategória + Beszállító -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-600">Márka *</label>
          <select
            v-model="form.brandId"
            required
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
          >
            <option value="" disabled>Válassz márkát...</option>
            <option v-for="b in sortedBrands" :key="b.id" :value="b.id">
              {{ b.name }}
            </option>
          </select>
        </div>

        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-600">Kategória *</label>
          <select
            v-model="form.categoryId"
            required
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
          >
            <option value="" disabled>Válassz kategóriát...</option>
            <option v-for="c in categoryOptions" :key="c.id" :value="c.id">
              {{ c.label }}{{ !c.isActive ? ' (inaktív)' : '' }}
            </option>
          </select>
        </div>

        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-600">Elsődleges beszállító *</label>
          <select
            v-model="form.primarySupplierId"
            required
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
          >
            <option value="" disabled>Válassz beszállítót...</option>
            <option v-for="s in sortedSuppliers" :key="s.id" :value="s.id">
              {{ s.name }}
            </option>
          </select>
        </div>
      </div>

      <!-- Modell + Gyártói kód -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-600">Modell *</label>
          <input
            v-model="form.model"
            type="text"
            required
            maxlength="150"
            placeholder="pl. T-GP Plus R v3"
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
          />
        </div>

        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-600">Gyártói kód (MPN) *</label>
          <input
            v-model="form.manufacturerCode"
            type="text"
            required
            maxlength="150"
            placeholder="pl. 3300520-12"
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-orange-500"
          />
        </div>
      </div>

      <!-- Nem + ÁFA kulcs + Felhasználási terület -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-600">Nem *</label>
          <select
            v-model="form.gender"
            required
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
          >
            <option v-for="g in genderOptions" :key="g" :value="g">{{ g }}</option>
          </select>
        </div>

        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-600">ÁFA kulcs (%) *</label>
          <input
            v-model.number="form.vatRate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            required
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
          />
        </div>

        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-600">Felhasználási terület</label>
          <input
            v-model="form.usageArea"
            type="text"
            maxlength="255"
            placeholder="pl. Utcai / Sport / Túra"
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
          />
        </div>
      </div>

      <!-- Anyagösszetétel + Funkcionalitás -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-600">Anyagösszetétel</label>
          <input
            v-model="form.material"
            type="text"
            maxlength="255"
            placeholder="pl. 600D Cordura / Marhabőr"
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
          />
        </div>

        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-600">Funkcionalitás / Jellemzők</label>
          <input
            v-model="form.functionality"
            type="text"
            maxlength="500"
            placeholder="pl. Vízálló membrán, kivehető thermobélés, CE protektor"
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
          />
        </div>
      </div>

      <!-- Képek (imageUrls) -->
      <div class="space-y-1.5">
        <label class="block text-xs font-medium text-slate-600">
          Termékkép URL-ek (http:// vagy https://)
        </label>
        <div class="flex gap-2">
          <input
            v-model="newImageUrl"
            type="url"
            maxlength="2048"
            placeholder="https://pelda.hu/termek-kep.jpg"
            @keydown.enter.prevent="addImageUrl"
            class="flex-1 h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
          />
          <button
            type="button"
            @click="addImageUrl"
            class="h-10 px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 shrink-0 cursor-pointer transition"
          >
            + Hozzáadás
          </button>
        </div>

        <div v-if="form.imageUrls.length > 0" class="flex flex-wrap gap-1.5 pt-1">
          <div
            v-for="(url, idx) in form.imageUrls"
            :key="url"
            class="inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 text-xs px-2.5 py-1 rounded-lg max-w-full"
          >
            <span class="truncate max-w-[260px]">{{ url }}</span>
            <button
              type="button"
              @click="removeImageUrl(idx)"
              class="text-slate-400 hover:text-rose-600 cursor-pointer"
              title="Eltávolítás"
            >
              <i class="pi pi-times text-[10px]"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- Aktív státusz -->
      <label
        class="flex items-center justify-between bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2.5 cursor-pointer"
      >
        <div>
          <p class="text-xs font-semibold text-slate-900">Aktív termék</p>
          <p class="text-[11px] text-slate-500">
            Inaktív termékek rejtve maradhatnak az új rendeléseknél.
          </p>
        </div>
        <input
          v-model="form.isActive"
          type="checkbox"
          class="size-4 accent-slate-900 cursor-pointer"
        />
      </label>

      <!-- Lábléc gombok -->
      <div class="flex justify-end gap-2 pt-2 border-t border-slate-100">
        <button
          type="button"
          @click="closeModal"
          class="h-9 px-4 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer transition"
        >
          Mégse
        </button>
        <button
          type="submit"
          :disabled="saving"
          class="h-9 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-xs font-semibold text-white flex items-center gap-2 cursor-pointer transition"
        >
          <i v-if="saving" class="pi pi-spin pi-spinner text-xs"></i>
          <span>{{ mode === 'create' ? 'Létrehozás' : 'Mentés' }}</span>
        </button>
      </div>
    </form>
  </Dialog>
</template>
