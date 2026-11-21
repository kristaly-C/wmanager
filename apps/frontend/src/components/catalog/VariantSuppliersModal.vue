<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { supplierApi, type SupplierItem } from '@/api/suppliers'
import {
  variantSuppliersApi,
  type CreateVariantSupplierPayload,
  type UpdateVariantSupplierPayload,
  type VariantSupplierItem,
} from '@/api/variantSuppliers'
import { extractApiError } from '@/utils/locationMeta'
import { canSeeCostPrice, formatCurrency } from '@/utils/procurementMeta'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import { useToast } from 'primevue/usetoast'

export interface VariantSupplierTarget {
  id: string
  sku: string
  size?: string | null
  colors?: string[]
}

interface SupplierOption extends SupplierItem {
  alreadyAssigned: boolean
}

const COMMON_CURRENCIES = ['HUF', 'EUR', 'USD', 'GBP', 'CHF', 'PLN', 'CZK'] as const

const props = defineProps<{
  visible: boolean
  variant: VariantSupplierTarget | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  updated: []
}>()

const authStore = useAuthStore()
const toast = useToast()

const canViewCost = computed(() => canSeeCostPrice(authStore.user?.role))

const variantSuppliers = ref<VariantSupplierItem[]>([])
const allSuppliers = ref<SupplierItem[]>([])
const loading = ref(false)
const actionLoading = ref(false)

const formMode = ref<'closed' | 'create' | 'edit'>('closed')
const editingId = ref<string | null>(null)
const confirmDeleteId = ref<string | null>(null)

const form = ref({
  supplierId: '',
  supplierSku: '',
  supplierProductName: '',
  purchasePrice: '0' as string | number,
  currency: 'HUF',
  discountPercent: '' as string | number,
  orderUnit: '',
  isPrimary: false,
  note: '',
})

const assignedSupplierIds = computed(
  () => new Set(variantSuppliers.value.map((item) => item.supplierId)),
)

const supplierOptions = computed<SupplierOption[]>(() =>
  [...allSuppliers.value]
    .sort((a, b) => a.name.localeCompare(b.name, 'hu'))
    .map((supplier) => ({
      ...supplier,
      alreadyAssigned: assignedSupplierIds.value.has(supplier.id),
    })),
)

const hasUnassignedSupplier = computed(() =>
  supplierOptions.value.some((option) => !option.alreadyAssigned),
)

const editingSupplierName = computed(() => {
  if (!editingId.value) return ''
  return (
    variantSuppliers.value.find((item) => item.id === editingId.value)?.supplier.name ?? ''
  )
})

function resetForm() {
  form.value = {
    supplierId: '',
    supplierSku: '',
    supplierProductName: '',
    purchasePrice: '0',
    currency: 'HUF',
    discountPercent: '',
    orderUnit: '',
    isPrimary: variantSuppliers.value.length === 0,
    note: '',
  }
  editingId.value = null
}

function openCreateForm() {
  if (!canViewCost.value) return
  resetForm()
  confirmDeleteId.value = null
  formMode.value = 'create'
}

function openEditForm(item: VariantSupplierItem) {
  if (!canViewCost.value) return
  confirmDeleteId.value = null
  editingId.value = item.id
  form.value = {
    supplierId: item.supplierId,
    supplierSku: item.supplierSku ?? '',
    supplierProductName: item.supplierProductName ?? '',
    purchasePrice:
      item.purchasePrice !== undefined && item.purchasePrice !== null
        ? String(item.purchasePrice)
        : '0',
    currency: item.currency ?? 'HUF',
    discountPercent:
      item.discountPercent !== undefined && item.discountPercent !== null
        ? String(item.discountPercent)
        : '',
    orderUnit: item.orderUnit ?? '',
    isPrimary: item.isPrimary,
    note: item.note ?? '',
  }
  formMode.value = 'edit'
}

function closeForm() {
  formMode.value = 'closed'
  editingId.value = null
}

async function loadData() {
  if (!props.variant) return
  loading.value = true
  try {
    const [listRes, suppliersRes] = await Promise.all([
      variantSuppliersApi.list(props.variant.id),
      canViewCost.value && allSuppliers.value.length === 0
        ? supplierApi.getAll()
        : Promise.resolve(null),
    ])
    variantSuppliers.value = listRes.data
    if (suppliersRes) {
      allSuppliers.value = suppliersRes.data
    }
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a variáns beszállítóit.'),
      life: 4000,
    })
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.visible, props.variant?.id] as const,
  ([isOpen]) => {
    if (!isOpen || !props.variant) return
    formMode.value = 'closed'
    editingId.value = null
    confirmDeleteId.value = null
    void loadData()
  },
)

function parseOptionalNonNegativeTwoDecimals(
  raw: string | number | null | undefined,
): number | null {
  const trimmed = String(raw ?? '').trim().replace(',', '.')
  if (!trimmed) return null
  const num = Number(trimmed)
  if (!Number.isFinite(num) || num < 0) return Number.NaN
  return Math.round((num + Number.EPSILON) * 100) / 100
}

function showValidationError(detail: string) {
  toast.add({
    severity: 'error',
    summary: 'Érvénytelen adat',
    detail,
    life: 4000,
  })
}

async function handleSubmit() {
  if (!props.variant || !canViewCost.value) return

  if (formMode.value === 'create' && !form.value.supplierId) {
    showValidationError('Kérjük válassz egy beszállítót.')
    return
  }

  const parsedPrice = parseOptionalNonNegativeTwoDecimals(form.value.purchasePrice)
  if (parsedPrice === null || Number.isNaN(parsedPrice)) {
    showValidationError('A beszerzési árnak 0 vagy pozitív számnak kell lennie.')
    return
  }

  const normalizedCurrency = form.value.currency.trim().toUpperCase() || 'HUF'
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) {
    showValidationError('A pénznemnek 3 betűs ISO kódnak kell lennie (pl. HUF, EUR, USD).')
    return
  }

  const parsedDiscount = parseOptionalNonNegativeTwoDecimals(form.value.discountPercent)
  if (Number.isNaN(parsedDiscount) || (parsedDiscount !== null && parsedDiscount > 100)) {
    showValidationError('A kedvezmény 0 és 100% között lehet.')
    return
  }

  actionLoading.value = true
  try {
    if (formMode.value === 'create') {
      const payload: CreateVariantSupplierPayload = {
        supplierId: form.value.supplierId,
        supplierSku: form.value.supplierSku.trim() || undefined,
        supplierProductName: form.value.supplierProductName.trim() || undefined,
        purchasePrice: parsedPrice,
        currency: normalizedCurrency,
        ...(parsedDiscount !== null ? { discountPercent: parsedDiscount } : {}),
        orderUnit: form.value.orderUnit.trim() || undefined,
        isPrimary: form.value.isPrimary,
        note: form.value.note.trim() || undefined,
      }
      await variantSuppliersApi.create(props.variant.id, payload)
      toast.add({
        severity: 'success',
        summary: 'Beszállító rögzítve',
        detail: 'A variáns-beszállító kapcsolat létrejött.',
        life: 3000,
      })
    } else if (formMode.value === 'edit' && editingId.value) {
      const payload: UpdateVariantSupplierPayload = {
        supplierSku: form.value.supplierSku.trim(),
        supplierProductName: form.value.supplierProductName.trim(),
        purchasePrice: parsedPrice,
        currency: normalizedCurrency,
        ...(parsedDiscount !== null ? { discountPercent: parsedDiscount } : {}),
        orderUnit: form.value.orderUnit.trim(),
        isPrimary: form.value.isPrimary,
        note: form.value.note.trim(),
      }
      await variantSuppliersApi.update(props.variant.id, editingId.value, payload)
      toast.add({
        severity: 'success',
        summary: 'Beszállító frissítve',
        detail: 'A beszállítói kondíciók módosultak.',
        life: 3000,
      })
    }

    closeForm()
    await loadData()
    emit('updated')
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Mentési hiba',
      detail: extractApiError(err, 'Nem sikerült menteni a beszállítói adatokat.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

async function handleSetPrimary(item: VariantSupplierItem) {
  if (!props.variant || !canViewCost.value || item.isPrimary) return
  actionLoading.value = true
  try {
    await variantSuppliersApi.update(props.variant.id, item.id, { isPrimary: true })
    toast.add({
      severity: 'success',
      summary: 'Elsődleges beszállító',
      detail: `„${item.supplier.name}” beállítva elsődlegesként.`,
      life: 3000,
    })
    await loadData()
    emit('updated')
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Frissítési hiba',
      detail: extractApiError(err, 'Nem sikerült módosítani az elsődleges beszállítót.'),
      life: 4000,
    })
  } finally {
    actionLoading.value = false
  }
}

async function handleDelete(item: VariantSupplierItem) {
  if (!props.variant || !canViewCost.value) return
  actionLoading.value = true
  try {
    await variantSuppliersApi.remove(props.variant.id, item.id)
    confirmDeleteId.value = null
    if (editingId.value === item.id) {
      closeForm()
    }
    toast.add({
      severity: 'success',
      summary: 'Kapcsolat törölve',
      detail: `„${item.supplier.name}” eltávolítva a variánstól.`,
      life: 3000,
    })
    await loadData()
    emit('updated')
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Törlési hiba',
      detail: extractApiError(err, 'Nem sikerült törölni a beszállítót.'),
      life: 4000,
    })
  } finally {
    actionLoading.value = false
  }
}

function getEffectiveNetPrice(item: VariantSupplierItem): number | null {
  if (item.purchasePrice === undefined || item.purchasePrice === null) return null
  const discount = item.discountPercent ?? 0
  if (discount <= 0) return item.purchasePrice
  return Math.round((item.purchasePrice * (1 - discount / 100) + Number.EPSILON) * 100) / 100
}

function closeModal() {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="(val) => emit('update:visible', val)"
    modal
    header="Variáns beszállítók és beszerzési kondíciók"
    :style="{ width: '48rem', maxWidth: '95vw' }"
  >
    <div v-if="variant" class="space-y-4 pt-1">
      <!-- Variáns fejléc -->
      <div
        class="bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-3"
      >
        <div class="min-w-0">
          <p class="text-xs font-bold font-mono text-slate-900">{{ variant.sku }}</p>
          <p v-if="variant.size || (variant.colors && variant.colors.length > 0)" class="text-[11px] text-slate-500">
            <template v-if="variant.size">
              Méret: <span class="font-semibold text-slate-700">{{ variant.size }}</span>
            </template>
            <template v-if="variant.size && variant.colors && variant.colors.length > 0"> · </template>
            <template v-if="variant.colors && variant.colors.length > 0">
              Szín: <span class="font-semibold text-slate-700">{{ variant.colors.join(', ') }}</span>
            </template>
          </p>
        </div>

        <div class="flex items-center gap-2 shrink-0">
          <span class="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-200/70 text-slate-700">
            {{ variantSuppliers.length }} beszállító
          </span>

          <button
            v-if="canViewCost && formMode === 'closed'"
            type="button"
            :disabled="!hasUnassignedSupplier || actionLoading"
            @click="openCreateForm"
            class="h-8 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer transition"
          >
            <i class="pi pi-plus text-[10px]"></i>
            <span>Beszállító hozzáadása</span>
          </button>
        </div>
      </div>

      <!-- Létrehozó / Szerkesztő űrlap (csak jogosult szerepköröknek) -->
      <form
        v-if="canViewCost && formMode !== 'closed'"
        @submit.prevent="handleSubmit"
        class="bg-slate-50/80 border border-slate-200 rounded-2xl p-4 space-y-3.5"
      >
        <div class="flex items-center justify-between gap-2">
          <p class="text-xs font-bold text-slate-900">
            {{
              formMode === 'create'
                ? 'Új beszállító hozzárendelése'
                : `Beszállító szerkesztése: ${editingSupplierName}`
            }}
          </p>
          <button
            type="button"
            @click="closeForm"
            class="text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            Mégse
          </button>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div v-if="formMode === 'create'" class="sm:col-span-2">
            <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Beszállító *
            </label>
            <Select
              v-model="form.supplierId"
              :options="supplierOptions"
              optionLabel="name"
              optionValue="id"
              optionDisabled="alreadyAssigned"
              :filter="true"
              filterPlaceholder="Beszállító keresése..."
              placeholder="Válassz beszállítót..."
              class="w-full text-xs"
            >
              <template #option="{ option }">
                <div class="flex items-center justify-between gap-2 w-full text-xs">
                  <span class="font-medium">{{ option.name }}</span>
                  <span
                    v-if="option.alreadyAssigned"
                    class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500"
                  >
                    Már hozzárendelve
                  </span>
                </div>
              </template>
            </Select>
          </div>

          <div>
            <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Beszállítói cikkszám
            </label>
            <input
              v-model="form.supplierSku"
              type="text"
              maxlength="100"
              placeholder="pl. SUP-SKU-42"
              class="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 font-mono text-xs text-slate-900 outline-none focus:border-orange-500"
            />
          </div>

          <div>
            <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Beszállítói terméknév
            </label>
            <input
              v-model="form.supplierProductName"
              type="text"
              maxlength="255"
              placeholder="pl. Gyári megnevezés"
              class="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-orange-500"
            />
          </div>

          <div>
            <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Beszerzési ár *
            </label>
            <input
              v-model="form.purchasePrice"
              type="number"
              min="0"
              step="0.01"
              required
              placeholder="0.00"
              class="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-900 outline-none focus:border-orange-500"
            />
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Deviza *
              </label>
              <input
                v-model="form.currency"
                type="text"
                maxlength="3"
                list="variant-supplier-currencies"
                placeholder="HUF"
                @blur="form.currency = form.currency.trim().toUpperCase() || 'HUF'"
                class="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 font-mono uppercase text-xs font-semibold text-slate-900 outline-none focus:border-orange-500"
              />
              <datalist id="variant-supplier-currencies">
                <option v-for="code in COMMON_CURRENCIES" :key="code" :value="code" />
              </datalist>
            </div>

            <div>
              <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                Kedvezmény (%)
              </label>
              <input
                v-model="form.discountPercent"
                type="number"
                min="0"
                max="100"
                step="0.01"
                placeholder="0"
                class="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-orange-500"
              />
            </div>
          </div>

          <div>
            <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Rendelési egység
            </label>
            <input
              v-model="form.orderUnit"
              type="text"
              maxlength="50"
              placeholder="pl. db, pár, karton"
              class="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-orange-500"
            />
          </div>

          <div>
            <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
              Megjegyzés
            </label>
            <input
              v-model="form.note"
              type="text"
              maxlength="1000"
              placeholder="Szállítási határidő, MOQ..."
              class="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-orange-500"
            />
          </div>
        </div>

        <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
          <label class="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              v-model="form.isPrimary"
              type="checkbox"
              class="size-3.5 accent-slate-900 cursor-pointer"
            />
            <span>Beállítás elsődleges beszállítóként</span>
          </label>

          <div class="flex items-center gap-2">
            <button
              type="button"
              @click="closeForm"
              class="h-8 px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-600 cursor-pointer transition"
            >
              Mégse
            </button>
            <button
              type="submit"
              :disabled="actionLoading"
              class="h-8 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer transition"
            >
              <i v-if="actionLoading" class="pi pi-spin pi-spinner text-[10px]"></i>
              <span>{{ formMode === 'create' ? 'Hozzáadás' : 'Mentés' }}</span>
            </button>
          </div>
        </div>
      </form>

      <!-- Beszállítók listája -->
      <div v-if="loading" class="py-8 text-center text-xs text-slate-400">
        <i class="pi pi-spin pi-spinner mr-1.5"></i> Beszállítók betöltése...
      </div>

      <div
        v-else-if="variantSuppliers.length === 0"
        class="py-8 text-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 text-xs text-slate-400"
      >
        Ehhez a variánshoz még nincs beszállító rögzítve.
      </div>

      <div v-else class="space-y-2.5 max-h-80 overflow-y-auto pr-1">
        <div
          v-for="item in variantSuppliers"
          :key="item.id"
          class="p-3.5 rounded-2xl border flex flex-col gap-2 transition"
          :class="
            item.isPrimary
              ? 'bg-orange-50/40 border-orange-200'
              : 'bg-white border-slate-200/80 hover:border-slate-300'
          "
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0 space-y-1">
              <div class="flex flex-wrap items-center gap-2">
                <i class="pi pi-building text-slate-500 text-xs"></i>
                <span class="text-sm font-bold text-slate-900">{{ item.supplier.name }}</span>
                <span
                  v-if="item.isPrimary"
                  class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-orange-500 text-white"
                >
                  Elsődleges
                </span>
                <span
                  v-if="item.orderUnit"
                  class="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600"
                >
                  Egység: {{ item.orderUnit }}
                </span>
              </div>

              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                <span v-if="item.supplierSku">
                  Besz. cikkszám:
                  <span class="font-mono font-semibold text-slate-700">{{ item.supplierSku }}</span>
                </span>
                <span v-if="item.supplierProductName">
                  Megnevezés:
                  <span class="font-medium text-slate-700">{{ item.supplierProductName }}</span>
                </span>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <!-- Ármezők KIZÁRÓLAG jogosult szerepköröknek -->
              <div v-if="canViewCost" class="text-right mr-1">
                <div class="flex items-center justify-end gap-1.5">
                  <span class="text-sm font-bold text-slate-900">
                    {{ formatCurrency(item.purchasePrice, item.currency) }}
                  </span>
                  <span
                    v-if="item.discountPercent !== null && item.discountPercent !== undefined && item.discountPercent > 0"
                    class="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200"
                  >
                    -{{ item.discountPercent }}%
                  </span>
                </div>
                <p
                  v-if="item.discountPercent && item.discountPercent > 0"
                  class="text-[11px] text-slate-500"
                >
                  Nettó: {{ formatCurrency(getEffectiveNetPrice(item), item.currency) }}
                </p>
              </div>

              <!-- Műveletek KIZÁRÓLAG jogosult szerepköröknek -->
              <div v-if="canViewCost" class="flex items-center gap-1.5">
                <button
                  v-if="!item.isPrimary"
                  type="button"
                  :disabled="actionLoading"
                  @click="handleSetPrimary(item)"
                  class="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-orange-100 text-slate-700 hover:text-orange-800 cursor-pointer transition"
                  title="Beállítás elsődleges beszállítóként"
                >
                  Legyen elsődleges
                </button>
                <button
                  type="button"
                  :disabled="actionLoading"
                  @click="openEditForm(item)"
                  class="w-7 h-7 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-600 flex items-center justify-center cursor-pointer transition"
                  title="Beszállító szerkesztése"
                >
                  <i class="pi pi-pencil text-[11px]"></i>
                </button>
                <template v-if="confirmDeleteId === item.id">
                  <button
                    type="button"
                    :disabled="actionLoading"
                    @click="handleDelete(item)"
                    class="h-7 px-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-semibold cursor-pointer transition"
                  >
                    Törlés
                  </button>
                  <button
                    type="button"
                    @click="confirmDeleteId = null"
                    class="h-7 px-2 rounded-lg border border-slate-200 text-slate-600 text-[11px] font-semibold cursor-pointer transition"
                  >
                    Mégse
                  </button>
                </template>
                <button
                  v-else
                  type="button"
                  :disabled="actionLoading"
                  @click="confirmDeleteId = item.id"
                  class="w-7 h-7 rounded-lg border border-rose-200 hover:bg-rose-50 text-rose-600 flex items-center justify-center cursor-pointer transition"
                  title="Beszállító eltávolítása"
                >
                  <i class="pi pi-trash text-[11px]"></i>
                </button>
              </div>
            </div>
          </div>

          <p v-if="item.note" class="text-xs text-slate-500 pt-1 border-t border-slate-100">
            Megjegyzés: <span class="text-slate-700">{{ item.note }}</span>
          </p>
        </div>
      </div>

      <!-- Lábléc -->
      <div class="flex justify-end pt-2 border-t border-slate-100">
        <button
          type="button"
          @click="closeModal"
          class="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white cursor-pointer transition"
        >
          Bezárás
        </button>
      </div>
    </div>
  </Dialog>
</template>
