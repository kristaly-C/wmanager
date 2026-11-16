<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  variantApi,
  type BulkVariantItemPayload,
  type VariantItem,
} from '@/api/variants'
import { extractApiError } from '@/utils/locationMeta'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'

interface PreviewRow {
  size: string
  sku: string
  primaryBarcode: string
  skuManuallyEdited: boolean
}

const QUICK_COLORS = [
  'Fekete',
  'Fehér',
  'Piros',
  'Kék',
  'Szürke',
  'Neonsárga',
  'Narancs',
  'Zöld',
  'Ezüst',
  'Arany',
]

const APPAREL_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'UNI']
const NUMERIC_SIZES = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48']

const SIZE_PRESETS: { label: string; sizes: string[] }[] = [
  { label: 'Ruházat (XS–3XL)', sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] },
  { label: 'Alap (S–2XL)', sizes: ['S', 'M', 'L', 'XL', '2XL'] },
  { label: 'Csizma / Cipő (39–46)', sizes: ['39', '40', '41', '42', '43', '44', '45', '46'] },
  { label: 'Bukósisak (XS–2XL)', sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL'] },
  { label: 'Egy-méret (UNI)', sizes: ['UNI'] },
]

const props = defineProps<{
  visible: boolean
  mode: 'create' | 'edit'
  productId: string
  productName: string
  manufacturerCode?: string
  existingSkus?: string[]
  editingVariant: VariantItem | null
  templateVariant?: VariantItem | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'saved', variant?: VariantItem): void
}>()

const toast = useToast()
const saving = ref(false)

const form = ref({
  sku: '',
  size: '',
  colors: [] as string[],
  weight: 0.5,
  costPrice: 0,
  price: 0,
  isActive: true,
})

const colorInput = ref('')
const customSizeInput = ref('')
const skuPrefix = ref('')
const skuPrefixManuallyEdited = ref(false)
const previewRows = ref<PreviewRow[]>([])

const dialogTitle = computed(() => {
  if (props.mode === 'edit') return 'Variáns szerkesztése'
  if (props.templateVariant) return 'Új méretsor klónozása meglévő variánsból'
  return 'Új variánsok létrehozása (méretsor)'
})

const existingSkuSet = computed(() => {
  const list = props.existingSkus ?? []
  return new Set(list.map((s) => s.trim().toUpperCase()))
})

function stripAccents(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function abbreviateColor(color: string): string {
  return stripAccents(color)
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 3)
    .toUpperCase()
}

function computeDefaultSkuPrefix(): string {
  const base = (props.manufacturerCode || 'TERM').trim().toUpperCase()
  const colorParts = form.value.colors
    .map((c) => abbreviateColor(c))
    .filter((abbr) => abbr.length > 0)
  return [base, ...colorParts].filter(Boolean).join('-')
}

function buildRowSku(prefix: string, size: string): string {
  const cleanPrefix = prefix.trim().replace(/-+$/, '')
  return cleanPrefix ? `${cleanPrefix}-${size}` : size
}

function syncAutoRowSkus() {
  for (const row of previewRows.value) {
    if (!row.skuManuallyEdited) {
      row.sku = buildRowSku(skuPrefix.value, row.size)
    }
  }
}

watch(
  () => form.value.colors,
  () => {
    if (props.mode !== 'create') return
    if (!skuPrefixManuallyEdited.value) {
      skuPrefix.value = computeDefaultSkuPrefix()
      syncAutoRowSkus()
    }
  },
  { deep: true },
)

function onSkuPrefixInput() {
  skuPrefixManuallyEdited.value = true
  syncAutoRowSkus()
}

function regenerateAllSkus() {
  skuPrefixManuallyEdited.value = false
  skuPrefix.value = computeDefaultSkuPrefix()
  for (const row of previewRows.value) {
    row.skuManuallyEdited = false
    row.sku = buildRowSku(skuPrefix.value, row.size)
  }
}

watch(
  () => props.visible,
  (isOpen) => {
    if (!isOpen) return
    colorInput.value = ''
    customSizeInput.value = ''
    skuPrefixManuallyEdited.value = false
    previewRows.value = []

    if (props.mode === 'edit' && props.editingVariant) {
      const v = props.editingVariant
      form.value = {
        sku: v.sku,
        size: v.size,
        colors: Array.isArray(v.colors) ? [...v.colors] : [],
        weight: Number(v.weight ?? 0),
        costPrice: Number(v.costPrice ?? 0),
        price: Number(v.price ?? 0),
        isActive: v.isActive,
      }
    } else {
      const tpl = props.templateVariant
      form.value = {
        sku: '',
        size: '',
        colors: tpl && Array.isArray(tpl.colors) ? [...tpl.colors] : [],
        weight: tpl ? Number(tpl.weight ?? 0.5) : 0.5,
        costPrice: tpl ? Number(tpl.costPrice ?? 0) : 0,
        price: tpl ? Number(tpl.price ?? 0) : 0,
        isActive: tpl ? tpl.isActive : true,
      }
      skuPrefix.value = computeDefaultSkuPrefix()
    }
  },
)

function addColorsFromInput() {
  const raw = colorInput.value.trim()
  if (!raw) return
  const parts = raw
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && c.length <= 50)

  for (const part of parts) {
    if (form.value.colors.length >= 20) break
    if (!form.value.colors.includes(part)) {
      form.value.colors.push(part)
    }
  }
  colorInput.value = ''
}

function toggleQuickColor(color: string) {
  const idx = form.value.colors.indexOf(color)
  if (idx >= 0) {
    form.value.colors.splice(idx, 1)
  } else if (form.value.colors.length < 20) {
    form.value.colors.push(color)
  }
}

function removeColor(index: number) {
  form.value.colors.splice(index, 1)
}

function isSizeSelected(size: string): boolean {
  return previewRows.value.some((r) => r.size === size)
}

function addSizeRow(size: string) {
  const normalized = size.trim()
  if (!normalized || isSizeSelected(normalized)) return
  previewRows.value.push({
    size: normalized,
    sku: buildRowSku(skuPrefix.value, normalized),
    primaryBarcode: '',
    skuManuallyEdited: false,
  })
}

function toggleSize(size: string) {
  const idx = previewRows.value.findIndex((r) => r.size === size)
  if (idx >= 0) {
    previewRows.value.splice(idx, 1)
  } else {
    addSizeRow(size)
  }
}

function applySizePreset(sizes: string[]) {
  for (const s of sizes) {
    addSizeRow(s)
  }
}

function clearSelectedSizes() {
  previewRows.value = []
}

function addCustomSize() {
  const raw = customSizeInput.value.trim()
  if (!raw) return
  const parts = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length <= 50)
  for (const part of parts) {
    addSizeRow(part)
  }
  customSizeInput.value = ''
}

function removePreviewRow(index: number) {
  previewRows.value.splice(index, 1)
}

function onRowSkuInput(row: PreviewRow) {
  row.skuManuallyEdited = true
}

function isSkuInExisting(sku: string): boolean {
  const clean = sku.trim().toUpperCase()
  if (!clean) return false
  return existingSkuSet.value.has(clean)
}

function isSkuDuplicateInBatch(sku: string, rowIndex: number): boolean {
  const clean = sku.trim().toUpperCase()
  if (!clean) return false
  return previewRows.value.some(
    (r, idx) => idx !== rowIndex && r.sku.trim().toUpperCase() === clean,
  )
}

const conflictingRowCount = computed(
  () =>
    previewRows.value.filter(
      (r, idx) => isSkuInExisting(r.sku) || isSkuDuplicateInBatch(r.sku, idx),
    ).length,
)

function removeExistingSkuRows() {
  previewRows.value = previewRows.value.filter((r) => !isSkuInExisting(r.sku))
}

function closeModal() {
  emit('update:visible', false)
}

async function handleSubmit() {
  if (colorInput.value.trim()) {
    addColorsFromInput()
  }
  if (customSizeInput.value.trim()) {
    addCustomSize()
  }

  const weight = Number(form.value.weight)
  const costPrice = Number(form.value.costPrice)
  const price = Number(form.value.price)

  if (form.value.colors.length === 0) {
    toast.add({
      severity: 'error',
      summary: 'Hiányzó szín',
      detail: 'Legalább egy színt adj meg a variánshoz.',
      life: 4000,
    })
    return
  }

  if (
    Number.isNaN(weight) ||
    weight < 0 ||
    Number.isNaN(costPrice) ||
    costPrice < 0 ||
    Number.isNaN(price) ||
    price < 0
  ) {
    toast.add({
      severity: 'error',
      summary: 'Érvénytelen számérték',
      detail: 'A súly, beszerzési ár és eladási ár nem lehet negatív.',
      life: 4000,
    })
    return
  }

  if (props.mode === 'create') {
    if (previewRows.value.length === 0) {
      toast.add({
        severity: 'error',
        summary: 'Nincs kijelölt méret',
        detail: 'Jelölj ki legalább egy méretet a létrehozáshoz.',
        life: 4000,
      })
      return
    }

    for (let i = 0; i < previewRows.value.length; i++) {
      const row = previewRows.value[i]!
      if (!row.sku.trim() || !row.size.trim()) {
        toast.add({
          severity: 'error',
          summary: 'Hiányzó SKU vagy méret',
          detail: 'Minden generálandó variánsnál kötelező a cikkszám (SKU) megadása.',
          life: 4000,
        })
        return
      }
      if (isSkuInExisting(row.sku)) {
        toast.add({
          severity: 'error',
          summary: 'Ütköző cikkszám (SKU)',
          detail: `A(z) „${row.sku.trim()}” SKU már létezik ennél a terméknél. Módosítsd vagy távolítsd el a sort.`,
          life: 4500,
        })
        return
      }
      if (isSkuDuplicateInBatch(row.sku, i)) {
        toast.add({
          severity: 'error',
          summary: 'Duplikált cikkszám (SKU)',
          detail: `A(z) „${row.sku.trim()}” SKU többször szerepel a listában.`,
          life: 4500,
        })
        return
      }
    }

    saving.value = true
    try {
      const items: BulkVariantItemPayload[] = previewRows.value.map((row) => ({
        sku: row.sku.trim(),
        colors: [...form.value.colors],
        size: row.size.trim(),
        weight,
        costPrice,
        price,
        isActive: form.value.isActive,
        ...(row.primaryBarcode.trim()
          ? { primaryBarcode: row.primaryBarcode.trim() }
          : {}),
      }))

      const res = await variantApi.bulkCreate({
        productId: props.productId,
        items,
      })

      toast.add({
        severity: 'success',
        summary: 'Variánsok létrehozva',
        detail: `${res.data.createdCount} variáns sikeresen létrehozva`,
        life: 3500,
      })
      emit('saved', res.data.items[0])
      closeModal()
    } catch (err) {
      toast.add({
        severity: 'error',
        summary: 'Mentési hiba',
        detail: extractApiError(err, 'Nem sikerült létrehozni a variánsokat.'),
        life: 5000,
      })
    } finally {
      saving.value = false
    }
    return
  }

  // Edit mode (single variant)
  const sku = form.value.sku.trim()
  const size = form.value.size.trim()

  if (!sku || !size) {
    toast.add({
      severity: 'error',
      summary: 'Hiányzó adatok',
      detail: 'A cikkszám (SKU) és a méret megadása kötelező.',
      life: 4000,
    })
    return
  }

  if (!props.editingVariant) return
  saving.value = true
  try {
    const res = await variantApi.update(props.editingVariant.id, {
      sku,
      size,
      colors: form.value.colors,
      weight,
      costPrice,
      price,
      isActive: form.value.isActive,
    })
    const saved = res.data
    toast.add({
      severity: 'success',
      summary: 'Variáns frissítve',
      detail: `„${saved.sku}” adatai sikeresen mentve.`,
      life: 3500,
    })
    emit('saved', saved)
    closeModal()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Mentési hiba',
      detail: extractApiError(err, 'Nem sikerült menteni a variánst.'),
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
    :style="{ width: mode === 'create' ? '44rem' : '34rem', maxWidth: '95vw' }"
  >
    <form @submit.prevent="handleSubmit" class="space-y-4 pt-1">
      <!-- Termék fejléc info -->
      <div
        v-if="productName"
        class="bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-2.5"
      >
        <div class="flex items-center gap-2.5 min-w-0">
          <i class="pi pi-box text-slate-500 text-sm"></i>
          <div class="min-w-0">
            <p class="text-[11px] text-slate-400 font-semibold uppercase tracking-wider">Termék</p>
            <p class="text-xs font-bold text-slate-900 truncate">{{ productName }}</p>
          </div>
        </div>
        <span
          v-if="manufacturerCode"
          class="font-mono text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 px-2 py-0.5 rounded-lg shrink-0"
        >
          {{ manufacturerCode }}
        </span>
      </div>

      <!-- Klónozás visszajelző sáv -->
      <div
        v-if="mode === 'create' && templateVariant"
        class="bg-orange-50/70 border border-orange-200 rounded-xl px-3.5 py-2 flex items-center gap-2 text-xs text-orange-800"
      >
        <i class="pi pi-copy text-orange-600 text-xs"></i>
        <span>
          Színek, súly és árak átvéve a(z)
          <strong class="font-mono">{{ templateVariant.sku }}</strong> variánsból. Válaszd ki az új
          méreteket!
        </span>
      </div>

      <!-- EDIT MODE: Cikkszám (SKU) + Méret -->
      <div v-if="mode === 'edit'" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-600">Cikkszám (SKU) *</label>
          <input
            v-model="form.sku"
            type="text"
            required
            maxlength="100"
            placeholder="pl. ALP-TGP-BK-L"
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-orange-500"
          />
        </div>

        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-600">Méret *</label>
          <input
            v-model="form.size"
            type="text"
            required
            maxlength="50"
            placeholder="pl. M, L, XL, 42, 54"
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
          />
        </div>
      </div>

      <!-- Színek (string[]) + Gyors színválasztó chipek -->
      <div class="space-y-2">
        <label class="block text-xs font-medium text-slate-600">
          Színek * (kattints a gyakori színekre vagy adj meg egyénit)
        </label>

        <!-- Gyors szín chipek -->
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="quickColor in QUICK_COLORS"
            :key="quickColor"
            type="button"
            @click="toggleQuickColor(quickColor)"
            class="px-2.5 py-1 rounded-lg text-xs font-semibold border transition cursor-pointer flex items-center gap-1"
            :class="
              form.colors.includes(quickColor)
                ? 'bg-slate-900 text-white border-slate-900 shadow-2xs'
                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
            "
          >
            <i
              :class="
                form.colors.includes(quickColor)
                  ? 'pi pi-check text-[10px]'
                  : 'pi pi-plus text-[10px] text-slate-400'
              "
            ></i>
            <span>{{ quickColor }}</span>
          </button>
        </div>

        <!-- Egyéni szín megadása -->
        <div class="flex gap-2">
          <input
            v-model="colorInput"
            type="text"
            maxlength="100"
            placeholder="Egyéni szín (pl. Matt fekete, Terepmintás)..."
            @keydown.enter.prevent="addColorsFromInput"
            class="flex-1 h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-orange-500"
          />
          <button
            type="button"
            @click="addColorsFromInput"
            class="h-9 px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 shrink-0 cursor-pointer transition"
          >
            + Hozzáadás
          </button>
        </div>

        <!-- Kiválasztott színek listája -->
        <div v-if="form.colors.length > 0" class="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span class="text-[11px] font-semibold text-slate-400 mr-1">Kiválasztva:</span>
          <span
            v-for="(color, idx) in form.colors"
            :key="color"
            class="inline-flex items-center gap-1.5 bg-orange-50 text-orange-800 border border-orange-200 text-xs font-semibold px-2.5 py-0.5 rounded-lg"
          >
            <span>{{ color }}</span>
            <button
              type="button"
              @click="removeColor(idx)"
              class="text-orange-400 hover:text-rose-600 cursor-pointer"
              title="Szín eltávolítása"
            >
              <i class="pi pi-times text-[10px]"></i>
            </button>
          </span>
        </div>
      </div>

      <!-- Súly + Beszerzési ár + Eladási ár -->
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-600">Súly (kg) *</label>
          <input
            v-model.number="form.weight"
            type="number"
            min="0"
            step="0.01"
            required
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
          />
        </div>

        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-600">Beszerzési ár (Ft) *</label>
          <input
            v-model.number="form.costPrice"
            type="number"
            min="0"
            step="1"
            required
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
          />
        </div>

        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-slate-600">Eladási ár (Ft) *</label>
          <input
            v-model.number="form.price"
            type="number"
            min="0"
            step="1"
            required
            class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
          />
        </div>
      </div>

      <!-- CREATE MODE: Méretek kijelölése + SKU előtag + Generálandó variánsok -->
      <template v-if="mode === 'create'">
        <div class="border-t border-slate-100 pt-3 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <label class="block text-xs font-bold text-slate-800">
              Méretek kijelölése *
            </label>
            <div class="flex flex-wrap items-center gap-1">
              <button
                v-for="preset in SIZE_PRESETS"
                :key="preset.label"
                type="button"
                @click="applySizePreset(preset.sizes)"
                class="px-2 py-1 rounded-lg bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-200/80 text-[11px] font-semibold cursor-pointer transition"
              >
                + {{ preset.label }}
              </button>
              <button
                v-if="previewRows.length > 0"
                type="button"
                @click="clearSelectedSizes"
                class="px-2 py-1 rounded-lg bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 text-[11px] font-semibold cursor-pointer transition"
              >
                Kijelölés törlése
              </button>
            </div>
          </div>

          <!-- Ruházati / Betűs méretek -->
          <div class="space-y-1.5">
            <span class="block text-[11px] text-slate-400 font-medium">
              Betűs méretek (ruházat, sisak, kesztyű):
            </span>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="sz in APPAREL_SIZES"
                :key="sz"
                type="button"
                @click="toggleSize(sz)"
                class="min-w-10 h-8 px-2.5 rounded-lg text-xs font-bold border transition cursor-pointer"
                :class="
                  isSizeSelected(sz)
                    ? 'bg-orange-600 text-white border-orange-600 shadow-2xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                "
              >
                {{ sz }}
              </button>
            </div>
          </div>

          <!-- Számozott méretek -->
          <div class="space-y-1.5">
            <span class="block text-[11px] text-slate-400 font-medium">
              Számozott méretek (csizma, cipő, konfekció):
            </span>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="sz in NUMERIC_SIZES"
                :key="sz"
                type="button"
                @click="toggleSize(sz)"
                class="min-w-9 h-8 px-2 rounded-lg text-xs font-bold border transition cursor-pointer"
                :class="
                  isSizeSelected(sz)
                    ? 'bg-orange-600 text-white border-orange-600 shadow-2xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                "
              >
                {{ sz }}
              </button>
            </div>
          </div>

          <!-- Egyéni méret hozzáadása + SKU előtag -->
          <div class="grid grid-cols-1 sm:grid-cols-12 gap-3 pt-1">
            <div class="sm:col-span-5 space-y-1">
              <label class="block text-[11px] font-medium text-slate-500">
                Egyéni méret hozzáadása
              </label>
              <div class="flex gap-1.5">
                <input
                  v-model="customSizeInput"
                  type="text"
                  maxlength="50"
                  placeholder="pl. 50, 52, 54, 10L"
                  @keydown.enter.prevent="addCustomSize"
                  class="flex-1 min-w-0 h-9 rounded-xl border border-slate-200 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-orange-500"
                />
                <button
                  type="button"
                  @click="addCustomSize"
                  class="h-9 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 shrink-0 cursor-pointer transition"
                >
                  + Egyéni méret
                </button>
              </div>
            </div>

            <div class="sm:col-span-7 space-y-1">
              <label class="block text-[11px] font-medium text-slate-500">
                Automatikus SKU előtag
              </label>
              <div class="flex gap-1.5">
                <input
                  v-model="skuPrefix"
                  type="text"
                  maxlength="80"
                  placeholder="pl. ALP-TGP-FEK"
                  @input="onSkuPrefixInput"
                  @keydown.enter.prevent
                  class="flex-1 min-w-0 h-9 rounded-xl border border-slate-200 bg-white px-2.5 font-mono text-xs text-slate-900 outline-none focus:border-orange-500"
                />
                <button
                  type="button"
                  @click="regenerateAllSkus"
                  class="h-9 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 shrink-0 cursor-pointer transition flex items-center gap-1"
                  title="SKU előtag és sorok újragenerálása a gyártói kódból és színekből"
                >
                  <i class="pi pi-refresh text-[11px]"></i>
                  <span>SKU-k újragenerálása</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- Generálandó variánsok táblázata (Editable preview rows) -->
        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-800">
              Generálandó variánsok ({{ previewRows.length }} db)
            </span>
            <button
              v-if="conflictingRowCount > 0"
              type="button"
              @click="removeExistingSkuRows"
              class="text-[11px] font-semibold text-rose-600 hover:underline cursor-pointer"
            >
              Már létező SKU-k eltávolítása ({{ conflictingRowCount }})
            </button>
          </div>

          <div
            v-if="previewRows.length === 0"
            class="py-6 text-center bg-slate-50/70 border border-dashed border-slate-200 rounded-2xl text-xs text-slate-400"
          >
            Kattints fent a méretekre vagy válassz egy méretsor-sablont (pl. Ruházat XS–3XL)!
          </div>

          <div
            v-else
            class="max-h-60 overflow-y-auto border border-slate-200/90 rounded-2xl divide-y divide-slate-100"
          >
            <div
              v-for="(row, idx) in previewRows"
              :key="row.size"
              class="p-2.5 flex flex-wrap sm:flex-nowrap items-center gap-2 text-xs transition"
              :class="
                isSkuInExisting(row.sku) || isSkuDuplicateInBatch(row.sku, idx)
                  ? 'bg-rose-50/70'
                  : 'bg-white hover:bg-slate-50/60'
              "
            >
              <!-- Méret badge -->
              <span
                class="w-12 text-center font-bold text-slate-900 bg-slate-100 px-2 py-1.5 rounded-lg shrink-0"
              >
                {{ row.size }}
              </span>

              <!-- Szerkeszthető SKU -->
              <div class="flex-1 min-w-[160px]">
                <input
                  v-model="row.sku"
                  type="text"
                  maxlength="100"
                  placeholder="Cikkszám (SKU) *"
                  @input="onRowSkuInput(row)"
                  @keydown.enter.prevent
                  class="w-full h-8 rounded-lg border px-2.5 font-mono text-xs outline-none transition"
                  :class="
                    isSkuInExisting(row.sku) || isSkuDuplicateInBatch(row.sku, idx)
                      ? 'border-rose-400 bg-white text-rose-800 focus:border-rose-600'
                      : 'border-slate-200 bg-white text-slate-900 focus:border-orange-500'
                  "
                />
                <p
                  v-if="isSkuInExisting(row.sku)"
                  class="text-[10px] font-semibold text-rose-600 mt-0.5"
                >
                  Ez az SKU már létezik ennél a terméknél!
                </p>
                <p
                  v-else-if="isSkuDuplicateInBatch(row.sku, idx)"
                  class="text-[10px] font-semibold text-amber-600 mt-0.5"
                >
                  Duplikált SKU a listában!
                </p>
              </div>

              <!-- Opcionális elsődleges vonalkód (EAN) -->
              <div class="w-44 shrink-0">
                <input
                  v-model="row.primaryBarcode"
                  type="text"
                  maxlength="100"
                  placeholder="Vonalkód / EAN (opcionális)"
                  @keydown.enter.prevent
                  class="w-full h-8 rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs text-slate-800 outline-none focus:border-orange-500"
                />
              </div>

              <!-- Sor törlése -->
              <button
                type="button"
                @click="removePreviewRow(idx)"
                class="w-7 h-7 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center shrink-0 cursor-pointer transition"
                title="Méret eltávolítása"
              >
                <i class="pi pi-trash text-xs"></i>
              </button>
            </div>
          </div>
        </div>
      </template>

      <!-- Aktív státusz -->
      <label
        class="flex items-center justify-between bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2.5 cursor-pointer"
      >
        <div>
          <p class="text-xs font-semibold text-slate-900">
            {{ mode === 'create' ? 'Aktív variánsok' : 'Aktív variáns' }}
          </p>
          <p class="text-[11px] text-slate-500">
            Inaktív variánsok nem választhatók új értékesítéshez.
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
          :disabled="saving || (mode === 'create' && previewRows.length === 0)"
          class="h-9 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-xs font-semibold text-white flex items-center gap-2 cursor-pointer transition"
        >
          <i v-if="saving" class="pi pi-spin pi-spinner text-xs"></i>
          <span v-if="mode === 'create'">
            {{
              previewRows.length > 0
                ? `${previewRows.length} variáns létrehozása`
                : 'Variánsok létrehozása'
            }}
          </span>
          <span v-else>Mentés</span>
        </button>
      </div>
    </form>
  </Dialog>
</template>
