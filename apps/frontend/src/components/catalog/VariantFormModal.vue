<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  variantApi,
  type BulkVariantItemPayload,
  type VariantItem,
} from '@/api/variants'
import { normalizeScannedBarcode } from '@/utils/barcodeScanner'
import { extractApiError } from '@/utils/locationMeta'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'

type WizardStep = 1 | 2 | 3
type SkuFormat = 'padded3' | 'hyphen' | 'plain'

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
]

const APPAREL_SIZES = ['XXS', 'XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL', 'UNI']
const NUMERIC_SIZES = ['36', '37', '38', '39', '40', '41', '42', '43', '44', '45', '46', '47', '48']

const SIZE_PRESETS: { label: string; sizes: string[] }[] = [
  { label: 'Ruházat XS–3XL', sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'] },
  { label: 'Alap S–2XL', sizes: ['S', 'M', 'L', 'XL', '2XL'] },
  { label: 'Csizma 39–46', sizes: ['39', '40', '41', '42', '43', '44', '45', '46'] },
  { label: 'Bukósisak XS–2XL', sizes: ['XS', 'S', 'M', 'L', 'XL', '2XL'] },
  { label: 'Egy-méret UNI', sizes: ['UNI'] },
]

const WIZARD_STEPS: { step: WizardStep; shortTitle: string; title: string }[] = [
  { step: 1, shortTitle: 'Szín, súly és árak', title: '1. lépés – Szín, súly és árak' },
  { step: 2, shortTitle: 'Méretek kiválasztása', title: '2. lépés – Méretek kiválasztása' },
  { step: 3, shortTitle: 'SKU és Vonalkódok', title: '3. lépés – Cikkszámok (SKU) és Vonalkódok' },
]

const SKU_FORMAT_OPTIONS: { value: SkuFormat; codeLabel: string; description: string }[] = [
  {
    value: 'padded3',
    codeLabel: '00L',
    description: '3 kar. nullázott – pl. Difi',
  },
  {
    value: 'hyphen',
    codeLabel: '-L',
    description: 'Kötőjeles',
  },
  {
    value: 'plain',
    codeLabel: 'L',
    description: 'Közvetlenül egybeírva',
  },
]

const props = defineProps<{
  visible: boolean
  mode: 'create' | 'edit'
  productId: string
  productName: string
  manufacturerCode?: string | null
  vatRate?: number
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
const step = ref<WizardStep>(1)

const form = ref({
  sku: '',
  size: '',
  colors: [] as string[],
  imageUrls: [] as string[],
  weight: '' as number | string,
  netWeight: '' as number | string,
  volume: '' as number | string,
  costPrice: 0,
  netPrice: 0,
  grossPrice: 0,
  isActive: true,
})

const colorInput = ref('')
const newImageUrl = ref('')
const customSizeInput = ref('')
const baseSku = ref('')
const skuFormat = ref<SkuFormat>('padded3')
const previewRows = ref<PreviewRow[]>([])

const dialogTitle = computed(() => {
  if (props.mode === 'edit') return 'Variáns szerkesztése'
  if (props.templateVariant) return 'Új méretsor klónozása meglévő variánsból'
  return 'Új variánsok létrehozása'
})

const existingSkuSet = computed(() => {
  const list = props.existingSkus ?? []
  return new Set(list.map((s) => s.trim().toUpperCase()))
})

const effectiveVatRate = computed(() => {
  const rate = Number(props.vatRate ?? 27)
  return Number.isFinite(rate) && rate >= 0 ? rate : 27
})

function round2(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100
}

function onNetPriceInput() {
  if (!isValidNonNegativeNumber(form.value.netPrice)) return
  const net = Number(form.value.netPrice)
  form.value.grossPrice = round2(net * (1 + effectiveVatRate.value / 100))
}

function onGrossPriceInput() {
  if (!isValidNonNegativeNumber(form.value.grossPrice)) return
  const gross = Number(form.value.grossPrice)
  form.value.netPrice = round2(gross / (1 + effectiveVatRate.value / 100))
}

const sampleSize = computed(() => previewRows.value[0]?.size || 'L')
const sampleBaseSku = computed(() => baseSku.value.trim() || '13102117421')

function buildRowSku(base: string, format: SkuFormat, size: string): string {
  const cleanBase = base.trim()
  const cleanSize = size.trim()
  if (!cleanSize) return cleanBase

  if (format === 'padded3') {
    return `${cleanBase}${cleanSize.toUpperCase().padStart(3, '0')}`
  }
  if (format === 'hyphen') {
    const trimmedBase = cleanBase.replace(/-+$/, '')
    return trimmedBase ? `${trimmedBase}-${cleanSize}` : cleanSize
  }
  return `${cleanBase}${cleanSize}`
}

function syncAutoRowSkus() {
  for (const row of previewRows.value) {
    if (!row.skuManuallyEdited) {
      row.sku = buildRowSku(baseSku.value, skuFormat.value, row.size)
    }
  }
}

watch([baseSku, skuFormat], () => {
  if (props.mode !== 'create') return
  syncAutoRowSkus()
})

function selectSkuFormat(format: SkuFormat) {
  skuFormat.value = format
}

function resetAllRowSkusToAuto() {
  for (const row of previewRows.value) {
    row.skuManuallyEdited = false
    row.sku = buildRowSku(baseSku.value, skuFormat.value, row.size)
  }
}

const hasManualRowEdits = computed(() => previewRows.value.some((r) => r.skuManuallyEdited))

watch(
  () => props.visible,
  (isOpen) => {
    if (!isOpen) return
    step.value = 1
    colorInput.value = ''
    newImageUrl.value = ''
    customSizeInput.value = ''
    skuFormat.value = 'padded3'
    previewRows.value = []

    if (props.mode === 'edit' && props.editingVariant) {
      const v = props.editingVariant
      form.value = {
        sku: v.sku,
        size: v.size ?? '',
        colors: Array.isArray(v.colors) ? [...v.colors] : [],
        imageUrls: Array.isArray(v.imageUrls) ? [...v.imageUrls] : [],
        weight: v.weight !== null && v.weight !== undefined ? Number(v.weight) : '',
        netWeight: v.netWeight !== null && v.netWeight !== undefined ? Number(v.netWeight) : '',
        volume: v.volume !== null && v.volume !== undefined ? Number(v.volume) : '',
        costPrice: Number(v.costPrice ?? 0),
        netPrice: Number(v.netPrice ?? 0),
        grossPrice: Number(v.grossPrice ?? 0),
        isActive: v.isActive,
      }
      baseSku.value = ''
    } else {
      const tpl = props.templateVariant
      form.value = {
        sku: '',
        size: '',
        colors: tpl && Array.isArray(tpl.colors) ? [...tpl.colors] : [],
        imageUrls: tpl && Array.isArray(tpl.imageUrls) ? [...tpl.imageUrls] : [],
        weight: tpl && tpl.weight !== null && tpl.weight !== undefined ? Number(tpl.weight) : '',
        netWeight: tpl && tpl.netWeight !== null && tpl.netWeight !== undefined ? Number(tpl.netWeight) : '',
        volume: tpl && tpl.volume !== null && tpl.volume !== undefined ? Number(tpl.volume) : '',
        costPrice: tpl ? Number(tpl.costPrice ?? 0) : 0,
        netPrice: tpl ? Number(tpl.netPrice ?? 0) : 0,
        grossPrice: tpl ? Number(tpl.grossPrice ?? 0) : 0,
        isActive: tpl ? tpl.isActive : true,
      }
      baseSku.value = (props.manufacturerCode || '').trim()
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

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function addImageUrl(): boolean {
  const url = newImageUrl.value.trim()
  if (!url) return true
  if (!isValidHttpUrl(url)) {
    toast.add({
      severity: 'error',
      summary: 'Érvénytelen URL',
      detail: 'A kép URL-nek http:// vagy https:// előtaggal kell kezdődnie.',
      life: 4000,
    })
    return false
  }
  if (form.value.imageUrls.length >= 20) {
    toast.add({
      severity: 'error',
      summary: 'Maximum elérve',
      detail: 'Legfeljebb 20 kép URL adható meg egy variánshoz.',
      life: 4000,
    })
    return false
  }
  if (!form.value.imageUrls.includes(url)) {
    form.value.imageUrls.push(url)
  }
  newImageUrl.value = ''
  return true
}

function removeImageUrl(index: number) {
  form.value.imageUrls.splice(index, 1)
}

function isSizeSelected(size: string): boolean {
  return previewRows.value.some((r) => r.size === size)
}

function addSizeRow(size: string) {
  const normalized = size.trim()
  if (!normalized || isSizeSelected(normalized)) return
  previewRows.value.push({
    size: normalized,
    sku: buildRowSku(baseSku.value, skuFormat.value, normalized),
    primaryBarcode: '',
    skuManuallyEdited: false,
  })
}

function addSimpleNoSizeRow() {
  if (isSizeSelected('')) return
  previewRows.value.push({
    size: '',
    sku: buildRowSku(baseSku.value, skuFormat.value, ''),
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

const existingConflictCount = computed(
  () => previewRows.value.filter((r) => isSkuInExisting(r.sku)).length,
)

function removeExistingSkuRows() {
  previewRows.value = previewRows.value.filter((r) => !isSkuInExisting(r.sku))
}

function isValidNonNegativeNumber(val: unknown): boolean {
  if (val === '' || val === null || val === undefined) return false
  const num = Number(val)
  return Number.isFinite(num) && num >= 0
}

function isOptionalValidNonNegativeNumber(val: unknown): boolean {
  if (val === '' || val === null || val === undefined) return true
  const num = Number(val)
  return Number.isFinite(num) && num >= 0
}

function toOptionalNumber(val: unknown): number | undefined {
  if (val === '' || val === null || val === undefined) return undefined
  const num = Number(val)
  return Number.isFinite(num) ? num : undefined
}

function validateStep1(): boolean {
  if (colorInput.value.trim()) {
    addColorsFromInput()
  }

  if (newImageUrl.value.trim() && !addImageUrl()) {
    return false
  }

  if (
    !isOptionalValidNonNegativeNumber(form.value.weight) ||
    !isOptionalValidNonNegativeNumber(form.value.netWeight) ||
    !isOptionalValidNonNegativeNumber(form.value.volume)
  ) {
    toast.add({
      severity: 'error',
      summary: 'Érvénytelen fizikai adat',
      detail: 'A súly és térfogat értékek nem lehetnek negatívak.',
      life: 4000,
    })
    return false
  }

  if (
    !isValidNonNegativeNumber(form.value.costPrice) ||
    !isValidNonNegativeNumber(form.value.netPrice) ||
    !isValidNonNegativeNumber(form.value.grossPrice)
  ) {
    toast.add({
      severity: 'error',
      summary: 'Érvénytelen ár',
      detail: 'A beszerzési ár, nettó ár és bruttó ár nem lehet üres vagy negatív.',
      life: 4000,
    })
    return false
  }

  return true
}

function validateStep2(): boolean {
  if (customSizeInput.value.trim()) {
    addCustomSize()
  }

  if (previewRows.value.length === 0) {
    toast.add({
      severity: 'error',
      summary: 'Nincs kijelölt méret',
      detail: 'Jelölj ki legalább egy méretet a továbblépéshez.',
      life: 4000,
    })
    return false
  }

  return true
}

function goToStep(target: WizardStep) {
  if (target === step.value) return
  if (target < step.value) {
    step.value = target
    return
  }
  if (step.value === 1) {
    if (!validateStep1()) return
    if (target === 2) {
      step.value = 2
      return
    }
    if (target === 3) {
      if (!validateStep2()) return
      step.value = 3
    }
    return
  }
  if (step.value === 2 && target === 3) {
    if (!validateStep2()) return
    step.value = 3
  }
}

function closeModal() {
  emit('update:visible', false)
}

async function handleSubmit() {
  if (props.mode === 'create') {
    if (step.value === 1) {
      goToStep(2)
      return
    }
    if (step.value === 2) {
      goToStep(3)
      return
    }
  }

  if (!validateStep1()) return

  const weight = toOptionalNumber(form.value.weight)
  const netWeight = toOptionalNumber(form.value.netWeight)
  const volume = toOptionalNumber(form.value.volume)
  const costPrice = Number(form.value.costPrice)
  const netPrice = Number(form.value.netPrice)
  const grossPrice = Number(form.value.grossPrice)

  if (props.mode === 'create') {
    if (!validateStep2()) return

    for (let i = 0; i < previewRows.value.length; i++) {
      const row = previewRows.value[i]!
      if (!row.sku.trim()) {
        toast.add({
          severity: 'error',
          summary: 'Hiányzó SKU',
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
      const items: BulkVariantItemPayload[] = previewRows.value.map((row) => {
        const normalizedBarcode = normalizeScannedBarcode(row.primaryBarcode)
        return {
          sku: row.sku.trim(),
          colors: [...form.value.colors],
          size: row.size.trim() || undefined,
          weight,
          netWeight,
          volume,
          costPrice,
          netPrice,
          grossPrice,
          imageUrls: form.value.imageUrls.length > 0 ? [...form.value.imageUrls] : undefined,
          isActive: form.value.isActive,
          ...(normalizedBarcode ? { primaryBarcode: normalizedBarcode } : {}),
        }
      })

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

  if (!sku) {
    toast.add({
      severity: 'error',
      summary: 'Hiányzó adat',
      detail: 'A cikkszám (SKU) megadása kötelező.',
      life: 4000,
    })
    return
  }

  if (!props.editingVariant) return
  saving.value = true
  try {
    const res = await variantApi.update(props.editingVariant.id, {
      sku,
      size: size || undefined,
      colors: form.value.colors,
      imageUrls: form.value.imageUrls,
      weight,
      netWeight,
      volume,
      costPrice,
      netPrice,
      grossPrice,
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
    :style="{ width: mode === 'create' ? '48rem' : '34rem', maxWidth: '95vw' }"
  >
    <form @submit.prevent="handleSubmit" class="space-y-5 pt-1">
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
          class="font-mono text-[11px] font-semibold bg-white border border-slate-200 text-slate-600 px-2.5 py-1 rounded-lg shrink-0"
        >
          {{ manufacturerCode }}
        </span>
      </div>

      <!-- CREATE MODE: 3-lépéses vizuális folyamatjelző -->
      <div
        v-if="mode === 'create'"
        class="grid grid-cols-3 gap-2 bg-slate-50/90 border border-slate-200/80 rounded-2xl p-2"
      >
        <button
          v-for="item in WIZARD_STEPS"
          :key="item.step"
          type="button"
          @click="goToStep(item.step)"
          class="flex items-center gap-2.5 px-3 py-2 rounded-xl text-left transition cursor-pointer"
          :class="
            step === item.step
              ? 'bg-white shadow-xs border border-orange-200 text-slate-900'
              : step > item.step
                ? 'bg-emerald-50/60 hover:bg-emerald-50 border border-transparent text-emerald-800'
                : 'hover:bg-white/60 border border-transparent text-slate-400'
          "
        >
          <span
            class="w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 transition"
            :class="
              step === item.step
                ? 'bg-orange-600 text-white'
                : step > item.step
                  ? 'bg-emerald-600 text-white'
                  : 'bg-slate-200 text-slate-600'
            "
          >
            <i v-if="step > item.step" class="pi pi-check text-[10px]"></i>
            <span v-else>{{ item.step }}</span>
          </span>
          <div class="min-w-0">
            <span class="block text-[10px] font-bold uppercase tracking-wider opacity-70">
              {{ item.step }}. lépés
            </span>
            <span class="block text-xs font-bold truncate">
              {{ item.shortTitle }}
            </span>
          </div>
        </button>
      </div>

      <!-- Klónozás visszajelző sáv -->
      <div
        v-if="mode === 'create' && templateVariant && step === 1"
        class="bg-orange-50/70 border border-orange-200 rounded-xl px-3.5 py-2.5 flex items-center gap-2 text-xs text-orange-800"
      >
        <i class="pi pi-copy text-orange-600 text-xs"></i>
        <span>
          Színek, súly és árak átvéve a(z)
          <strong class="font-mono">{{ templateVariant.sku }}</strong> variánsból.
        </span>
      </div>

      <!-- ========================================================= -->
      <!-- EDIT MODE (egyetlen nézet)                                 -->
      <!-- ========================================================= -->
      <template v-if="mode === 'edit'">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-slate-600">Cikkszám (SKU) *</label>
            <input
              v-model="form.sku"
              type="text"
              required
              maxlength="100"
              placeholder="pl. 1310211742100L"
              class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-orange-500"
            />
          </div>

          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-slate-600">Méret (opcionális)</label>
            <input
              v-model="form.size"
              type="text"
              maxlength="50"
              placeholder="pl. M, L, XL, 42 (egyszerű terméknél üres)"
              class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
            />
          </div>
        </div>

        <!-- Színek -->
        <div class="space-y-2">
          <label class="block text-xs font-medium text-slate-600">
            Színek (opcionális — kattints a gyakori színekre vagy adj meg egyénit)
          </label>
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

        <!-- Színváltozat képe(i) (URL) -->
        <div class="space-y-2">
          <label class="block text-xs font-medium text-slate-600">
            Színváltozat képe(i) (URL)
          </label>
          <div class="flex gap-2">
            <input
              v-model="newImageUrl"
              type="url"
              maxlength="2048"
              placeholder="https://pelda.hu/szinvaltozat-kep.jpg"
              @keydown.enter.prevent="addImageUrl()"
              class="flex-1 h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-orange-500"
            />
            <button
              type="button"
              @click="addImageUrl()"
              class="h-9 px-3.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 shrink-0 cursor-pointer transition"
            >
              + Kép URL
            </button>
          </div>
          <div v-if="form.imageUrls.length > 0" class="flex flex-wrap gap-2 pt-1">
            <div
              v-for="(url, idx) in form.imageUrls"
              :key="url"
              class="relative w-16 h-16 aspect-square rounded-xl border border-slate-200 bg-white overflow-hidden group shrink-0"
              :title="url"
            >
              <img
                :src="url"
                :alt="`Színváltozat kép ${idx + 1}`"
                class="w-full h-full aspect-square object-contain bg-white"
              />
              <button
                type="button"
                @click="removeImageUrl(idx)"
                class="absolute top-1 right-1 w-5 h-5 rounded-full bg-slate-900/75 hover:bg-rose-600 text-white flex items-center justify-center cursor-pointer transition"
                title="Kép eltávolítása"
              >
                <i class="pi pi-times text-[9px]"></i>
              </button>
            </div>
          </div>
        </div>

        <!-- Súly + Térfogat (opcionális) -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-slate-600">Bruttó súly (kg)</label>
            <input
              v-model.number="form.weight"
              type="number"
              min="0"
              step="0.001"
              placeholder="pl. 3.25"
              class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
            />
          </div>

          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-slate-600">Nettó súly (kg)</label>
            <input
              v-model.number="form.netWeight"
              type="number"
              min="0"
              step="0.001"
              placeholder="opcionális"
              class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
            />
          </div>

          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-slate-600">Térfogat (m³)</label>
            <input
              v-model.number="form.volume"
              type="number"
              min="0"
              step="0.000001"
              placeholder="opcionális"
              class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
            />
          </div>
        </div>

        <!-- Árak (ÁFA: effectiveVatRate%) -->
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-slate-600">Beszerzési ár (Ft) *</label>
            <input
              v-model.number="form.costPrice"
              type="number"
              min="0"
              step="0.01"
              required
              class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
            />
          </div>

          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-slate-600">
              Nettó ár (Ft) * <span class="text-[10px] text-slate-400">({{ effectiveVatRate }}% ÁFA)</span>
            </label>
            <input
              v-model.number="form.netPrice"
              @input="onNetPriceInput"
              type="number"
              min="0"
              step="0.01"
              required
              class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
            />
          </div>

          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-slate-600">Bruttó ár (Ft) *</label>
            <input
              v-model.number="form.grossPrice"
              @input="onGrossPriceInput"
              type="number"
              min="0"
              step="0.01"
              required
              class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
            />
          </div>
        </div>

        <!-- Aktív státusz -->
        <label
          class="flex items-center justify-between bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2.5 cursor-pointer"
        >
          <div>
            <p class="text-xs font-semibold text-slate-900">Aktív variáns</p>
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

        <!-- Edit lábléc -->
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
            <span>Mentés</span>
          </button>
        </div>
      </template>

      <!-- ========================================================= -->
      <!-- CREATE MODE: 1. LÉPÉS – Szín, súly és árak                 -->
      <!-- ========================================================= -->
      <template v-else-if="step === 1">
        <div class="space-y-5">
          <div>
            <h3 class="text-sm font-bold text-slate-900">{{ WIZARD_STEPS[0]!.title }}</h3>
            <p class="text-xs text-slate-500 mt-0.5">
              Add meg a közös tulajdonságokat, amelyek minden kijelölt méretre érvényesek lesznek.
            </p>
          </div>

          <!-- Színek -->
          <div class="space-y-2.5">
            <label class="block text-xs font-semibold text-slate-700">
              Színek <span class="font-normal text-slate-400">(opcionális — kattints vagy írj be egyénit)</span>
            </label>

            <div class="flex flex-wrap gap-2">
              <button
                v-for="quickColor in QUICK_COLORS"
                :key="quickColor"
                type="button"
                @click="toggleQuickColor(quickColor)"
                class="px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer flex items-center gap-1.5"
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

            <div class="flex gap-2">
              <input
                v-model="colorInput"
                type="text"
                maxlength="100"
                placeholder="Egyéni szín (pl. Matt fekete, Terepmintás)..."
                @keydown.enter.prevent="addColorsFromInput"
                class="flex-1 h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-orange-500"
              />
              <button
                type="button"
                @click="addColorsFromInput"
                class="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 shrink-0 cursor-pointer transition"
              >
                + Hozzáadás
              </button>
            </div>

            <div v-if="form.colors.length > 0" class="flex flex-wrap items-center gap-1.5 pt-1">
              <span class="text-[11px] font-semibold text-slate-400 mr-1">Kiválasztva:</span>
              <span
                v-for="(color, idx) in form.colors"
                :key="color"
                class="inline-flex items-center gap-1.5 bg-orange-50 text-orange-800 border border-orange-200 text-xs font-semibold px-2.5 py-1 rounded-lg"
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

          <!-- Színváltozat képe(i) (URL) -->
          <div class="space-y-2.5">
            <label class="block text-xs font-semibold text-slate-700">
              Színváltozat képe(i) (URL)
              <span class="font-normal text-slate-400">(opcionális, a kijelölt méretsorhoz)</span>
            </label>
            <div class="flex gap-2">
              <input
                v-model="newImageUrl"
                type="url"
                maxlength="2048"
                placeholder="https://pelda.hu/szinvaltozat-kep.jpg"
                @keydown.enter.prevent="addImageUrl()"
                class="flex-1 h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-orange-500"
              />
              <button
                type="button"
                @click="addImageUrl()"
                class="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 shrink-0 cursor-pointer transition"
              >
                + Kép URL
              </button>
            </div>
            <div v-if="form.imageUrls.length > 0" class="flex flex-wrap gap-2 pt-1">
              <div
                v-for="(url, idx) in form.imageUrls"
                :key="url"
                class="relative w-16 h-16 aspect-square rounded-xl border border-slate-200 bg-white overflow-hidden group shrink-0"
                :title="url"
              >
                <img
                  :src="url"
                  :alt="`Színváltozat kép ${idx + 1}`"
                  class="w-full h-full aspect-square object-contain bg-white"
                />
                <button
                  type="button"
                  @click="removeImageUrl(idx)"
                  class="absolute top-1 right-1 w-5 h-5 rounded-full bg-slate-900/75 hover:bg-rose-600 text-white flex items-center justify-center cursor-pointer transition"
                  title="Kép eltávolítása"
                >
                  <i class="pi pi-times text-[9px]"></i>
                </button>
              </div>
            </div>
          </div>

          <!-- Fizikai adatok (opcionális) -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="space-y-1.5">
              <label class="block text-xs font-semibold text-slate-700">
                Bruttó súly (kg) <span class="font-normal text-slate-400">(opcionális)</span>
              </label>
              <input
                v-model.number="form.weight"
                type="number"
                min="0"
                step="0.001"
                placeholder="pl. 3.25"
                class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
              />
            </div>

            <div class="space-y-1.5">
              <label class="block text-xs font-semibold text-slate-700">
                Nettó súly (kg) <span class="font-normal text-slate-400">(opcionális)</span>
              </label>
              <input
                v-model.number="form.netWeight"
                type="number"
                min="0"
                step="0.001"
                placeholder="opcionális"
                class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
              />
            </div>

            <div class="space-y-1.5">
              <label class="block text-xs font-semibold text-slate-700">
                Térfogat (m³) <span class="font-normal text-slate-400">(opcionális)</span>
              </label>
              <input
                v-model.number="form.volume"
                type="number"
                min="0"
                step="0.000001"
                placeholder="opcionális"
                class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
              />
            </div>
          </div>

          <!-- Árak -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div class="space-y-1.5">
              <label class="block text-xs font-semibold text-slate-700">Beszerzési ár (Ft) *</label>
              <input
                v-model.number="form.costPrice"
                type="number"
                min="0"
                step="0.01"
                class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
              />
            </div>

            <div class="space-y-1.5">
              <label class="block text-xs font-semibold text-slate-700">
                Nettó ár (Ft) *
                <span class="font-normal text-slate-400">({{ effectiveVatRate }}% ÁFA)</span>
              </label>
              <input
                v-model.number="form.netPrice"
                @input="onNetPriceInput"
                type="number"
                min="0"
                step="0.01"
                class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
              />
            </div>

            <div class="space-y-1.5">
              <label class="block text-xs font-semibold text-slate-700">Bruttó ár (Ft) *</label>
              <input
                v-model.number="form.grossPrice"
                @input="onGrossPriceInput"
                type="number"
                min="0"
                step="0.01"
                class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-orange-500"
              />
            </div>
          </div>

          <!-- Aktív státusz -->
          <label
            class="flex items-center justify-between bg-slate-50 border border-slate-200/80 rounded-xl px-4 py-3 cursor-pointer"
          >
            <div>
              <p class="text-xs font-semibold text-slate-900">Aktív variánsok</p>
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
        </div>

        <!-- 1. lépés lábléc -->
        <div class="flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            @click="closeModal"
            class="h-10 px-4 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer transition"
          >
            Mégse
          </button>
          <button
            type="button"
            @click="goToStep(2)"
            class="h-10 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white flex items-center gap-2 cursor-pointer transition shadow-sm"
          >
            <span>Tovább a méretekhez</span>
            <i class="pi pi-arrow-right text-[11px]"></i>
          </button>
        </div>
      </template>

      <!-- ========================================================= -->
      <!-- CREATE MODE: 2. LÉPÉS – Méretek kiválasztása               -->
      <!-- ========================================================= -->
      <template v-else-if="step === 2">
        <div class="space-y-5">
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 class="text-sm font-bold text-slate-900">{{ WIZARD_STEPS[1]!.title }}</h3>
              <p class="text-xs text-slate-500 mt-0.5">
                Használj gyors méretsor-sablont vagy válaszd ki egyenként a szükséges méreteket.
              </p>
            </div>
          </div>

          <!-- Gyors sablon gombok -->
          <div class="space-y-2">
            <span class="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Gyors méretsor sablonok
            </span>
            <div class="flex flex-wrap items-center gap-1.5">
              <button
                v-for="preset in SIZE_PRESETS"
                :key="preset.label"
                type="button"
                @click="applySizePreset(preset.sizes)"
                class="px-3 py-1.5 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-200/80 text-xs font-semibold cursor-pointer transition"
              >
                + {{ preset.label }}
              </button>
              <button
                type="button"
                @click="addSimpleNoSizeRow"
                class="px-3 py-1.5 rounded-xl border text-xs font-semibold cursor-pointer transition"
                :class="
                  isSizeSelected('')
                    ? 'bg-orange-600 text-white border-orange-600'
                    : 'bg-slate-900 hover:bg-slate-800 text-white border-slate-900'
                "
              >
                + Méret nélküli (egyszerű termék)
              </button>
              <button
                v-if="previewRows.length > 0"
                type="button"
                @click="clearSelectedSizes"
                class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 text-xs font-semibold cursor-pointer transition"
              >
                Kijelölés törlése
              </button>
            </div>
          </div>

          <!-- Ruházat méretek -->
          <div class="bg-slate-50/70 border border-slate-200/70 rounded-2xl p-4 space-y-4">
            <div class="space-y-2">
              <span class="block text-xs font-semibold text-slate-700">
                Ruházat (betűs méretek, sisak, kesztyű)
              </span>
              <div class="grid grid-cols-6 sm:grid-cols-11 gap-1.5">
                <button
                  v-for="sz in APPAREL_SIZES"
                  :key="sz"
                  type="button"
                  @click="toggleSize(sz)"
                  class="h-9 rounded-xl text-xs font-bold border transition cursor-pointer"
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
            <div class="space-y-2 pt-2 border-t border-slate-200/70">
              <span class="block text-xs font-semibold text-slate-700">
                Számozott méretek (csizma, cipő, konfekció)
              </span>
              <div class="grid grid-cols-7 sm:grid-cols-13 gap-1.5">
                <button
                  v-for="sz in NUMERIC_SIZES"
                  :key="sz"
                  type="button"
                  @click="toggleSize(sz)"
                  class="h-9 rounded-xl text-xs font-bold border transition cursor-pointer"
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
          </div>

          <!-- Egyéni méret hozzáadása -->
          <div class="space-y-1.5">
            <label class="block text-xs font-semibold text-slate-700">
              Egyéni méret hozzáadása
            </label>
            <div class="flex gap-2">
              <input
                v-model="customSizeInput"
                type="text"
                maxlength="50"
                placeholder="pl. 50, 52, 54, 10L (vesszővel elválasztva több is megadható)"
                @keydown.enter.prevent="addCustomSize"
                class="flex-1 h-10 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-orange-500"
              />
              <button
                type="button"
                @click="addCustomSize"
                class="h-10 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 shrink-0 cursor-pointer transition"
              >
                + Egyéni méret
              </button>
            </div>
          </div>

          <!-- Kijelölt méretek összegzése -->
          <div
            class="rounded-2xl border px-4 py-3"
            :class="
              previewRows.length > 0
                ? 'bg-emerald-50/50 border-emerald-200/80'
                : 'bg-slate-50 border-dashed border-slate-200'
            "
          >
            <div class="flex items-center justify-between gap-2 mb-2">
              <span class="text-xs font-bold text-slate-800">
                Kiválasztott méretek ({{ previewRows.length }} db)
              </span>
              <span v-if="previewRows.length === 0" class="text-[11px] text-slate-400">
                Válassz legalább 1 méretet a fenti listából
              </span>
            </div>
            <div v-if="previewRows.length > 0" class="flex flex-wrap gap-1.5">
              <span
                v-for="(row, idx) in previewRows"
                :key="row.size || '__NO_SIZE__'"
                class="inline-flex items-center gap-1.5 bg-white border border-emerald-200 text-slate-900 text-xs font-bold px-2.5 py-1 rounded-lg"
              >
                <span>{{ row.size || 'Méret nélkül' }}</span>
                <button
                  type="button"
                  @click="removePreviewRow(idx)"
                  class="text-slate-400 hover:text-rose-600 cursor-pointer"
                  title="Méret eltávolítása"
                >
                  <i class="pi pi-times text-[10px]"></i>
                </button>
              </span>
            </div>
          </div>
        </div>

        <!-- 2. lépés lábléc -->
        <div class="flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            @click="goToStep(1)"
            class="h-10 px-4 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer transition"
          >
            <i class="pi pi-arrow-left text-[11px]"></i>
            <span>Vissza</span>
          </button>
          <button
            type="button"
            @click="goToStep(3)"
            class="h-10 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white flex items-center gap-2 cursor-pointer transition shadow-sm"
          >
            <span>Tovább az SKU-khoz</span>
            <i class="pi pi-arrow-right text-[11px]"></i>
          </button>
        </div>
      </template>

      <!-- ========================================================= -->
      <!-- CREATE MODE: 3. LÉPÉS – Cikkszámok (SKU) és Vonalkódok     -->
      <!-- ========================================================= -->
      <template v-else>
        <div class="space-y-5">
          <div>
            <h3 class="text-sm font-bold text-slate-900">{{ WIZARD_STEPS[2]!.title }}</h3>
            <p class="text-xs text-slate-500 mt-0.5">
              Állítsd be az alap SKU-t és a méret-hozzáfűzés formátumát, majd igény szerint finomítsd a sorokat.
            </p>
          </div>

          <!-- Alap SKU input -->
          <div class="space-y-1.5">
            <label class="block text-xs font-semibold text-slate-700">
              Alap SKU (gyártói kód + színkód)
            </label>
            <input
              v-model="baseSku"
              type="text"
              maxlength="80"
              placeholder="pl. 13102117421"
              @keydown.enter.prevent
              class="w-full h-10 rounded-xl border border-slate-200 bg-white px-3 font-mono text-sm text-slate-900 outline-none focus:border-orange-500"
            />
            <p class="text-[11px] text-slate-500">
              Írd a gyártói kód mögé a színkódot (pl. <span class="font-mono">13102117</span> +
              <span class="font-mono">421</span> → <span class="font-mono font-semibold">13102117421</span>)
            </p>
          </div>

          <!-- Méret hozzáfűzési mód (3-way selector élő példával) -->
          <div class="space-y-2">
            <label class="block text-xs font-semibold text-slate-700">
              Méret hozzáfűzési mód
            </label>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                v-for="opt in SKU_FORMAT_OPTIONS"
                :key="opt.value"
                type="button"
                @click="selectSkuFormat(opt.value)"
                class="p-3 rounded-xl border text-left transition cursor-pointer space-y-1"
                :class="
                  skuFormat === opt.value
                    ? 'bg-orange-50/80 border-orange-400 shadow-2xs'
                    : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                "
              >
                <div class="flex items-center justify-between gap-2">
                  <span class="font-mono text-xs font-bold text-slate-900">
                    {{ opt.codeLabel }}
                  </span>
                  <span
                    class="w-4 h-4 rounded-full border flex items-center justify-center"
                    :class="
                      skuFormat === opt.value
                        ? 'border-orange-600 bg-orange-600 text-white'
                        : 'border-slate-300 bg-white'
                    "
                  >
                    <i v-if="skuFormat === opt.value" class="pi pi-check text-[9px]"></i>
                  </span>
                </div>
                <p class="text-[11px] text-slate-600 font-medium">{{ opt.description }}</p>
                <p
                  class="font-mono text-[11px] font-semibold truncate pt-0.5"
                  :class="skuFormat === opt.value ? 'text-orange-800' : 'text-slate-400'"
                >
                  pl. {{ buildRowSku(sampleBaseSku, opt.value, sampleSize) }}
                </p>
              </button>
            </div>
          </div>

          <!-- Előnézeti táblázat -->
          <div class="space-y-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-xs font-bold text-slate-800">
                Előnézeti táblázat ({{ previewRows.length }} variáns)
              </span>
              <div class="flex items-center gap-3">
                <button
                  v-if="hasManualRowEdits"
                  type="button"
                  @click="resetAllRowSkusToAuto"
                  class="text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:underline cursor-pointer flex items-center gap-1"
                >
                  <i class="pi pi-refresh text-[10px]"></i>
                  <span>SKU-k újragenerálása</span>
                </button>
                <button
                  v-if="existingConflictCount > 0"
                  type="button"
                  @click="removeExistingSkuRows"
                  class="text-[11px] font-semibold text-rose-600 hover:underline cursor-pointer"
                >
                  Már létező SKU-k eltávolítása ({{ existingConflictCount }})
                </button>
              </div>
            </div>

            <div
              v-if="previewRows.length === 0"
              class="py-6 text-center bg-slate-50/70 border border-dashed border-slate-200 rounded-2xl text-xs text-slate-400"
            >
              Nincs kiválasztott méret. Lépj vissza és jelölj ki legalább egy méretet!
            </div>

            <div
              v-else
              class="max-h-64 overflow-y-auto border border-slate-200/90 rounded-2xl divide-y divide-slate-100"
            >
              <div
                v-for="(row, idx) in previewRows"
                :key="row.size || '__NO_SIZE__'"
                class="p-2.5 flex flex-wrap sm:flex-nowrap items-center gap-2.5 text-xs transition"
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
                  {{ row.size || '—' }}
                </span>

                <!-- Szerkeszthető SKU -->
                <div class="flex-1 min-w-[170px]">
                  <input
                    v-model="row.sku"
                    type="text"
                    maxlength="100"
                    placeholder="Cikkszám (SKU) *"
                    @input="onRowSkuInput(row)"
                    @keydown.enter.prevent
                    class="w-full h-9 rounded-lg border px-2.5 font-mono text-xs outline-none transition"
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
                <div class="w-48 shrink-0">
                  <input
                    v-model="row.primaryBarcode"
                    type="text"
                    maxlength="100"
                    placeholder="Vonalkód / EAN (opcionális)"
                    @blur="row.primaryBarcode = normalizeScannedBarcode(row.primaryBarcode)"
                    @keydown.enter.prevent
                    class="w-full h-9 rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs text-slate-800 outline-none focus:border-orange-500"
                  />
                </div>

                <!-- Sor törlése -->
                <button
                  type="button"
                  @click="removePreviewRow(idx)"
                  class="w-8 h-8 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center shrink-0 cursor-pointer transition"
                  title="Sor eltávolítása"
                >
                  <i class="pi pi-trash text-xs"></i>
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 3. lépés lábléc -->
        <div class="flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
          <button
            type="button"
            @click="goToStep(2)"
            class="h-10 px-4 rounded-xl bg-white border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer transition"
          >
            <i class="pi pi-arrow-left text-[11px]"></i>
            <span>Vissza</span>
          </button>
          <button
            type="submit"
            :disabled="saving || previewRows.length === 0"
            class="h-10 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-xs font-semibold text-white flex items-center gap-2 cursor-pointer transition shadow-sm"
          >
            <i v-if="saving" class="pi pi-spin pi-spinner text-xs"></i>
            <span>
              {{
                previewRows.length > 0
                  ? `${previewRows.length} variáns létrehozása`
                  : 'Variánsok létrehozása'
              }}
            </span>
          </button>
        </div>
      </template>
    </form>
  </Dialog>
</template>
