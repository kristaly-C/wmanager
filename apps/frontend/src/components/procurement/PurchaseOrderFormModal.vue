<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'
import {
  purchaseOrdersApi,
  type CreatePurchaseOrderItemPayload,
  type PurchaseOrderDetail,
} from '@/api/purchaseOrders'
import { supplierApi, type SupplierItem } from '@/api/suppliers'
import { variantApi, type VariantItem } from '@/api/variants'
import { variantSuppliersApi, type VariantSupplierItem } from '@/api/variantSuppliers'
import { extractApiError } from '@/utils/locationMeta'
import { formatCurrency } from '@/utils/procurementMeta'

const CURRENCIES = ['HUF', 'EUR', 'USD', 'GBP', 'CZK', 'PLN'] as const
type CurrencyCode = (typeof CURRENCIES)[number]

interface EditablePoItemRow {
  variantId: string
  sku: string
  productName: string
  size: string | null
  colors: string[]
  primaryBarcode: string | null
  orderedQuantity: number
  unitCost: number
  note: string
  touchedCost: boolean
}

const props = defineProps<{
  visible: boolean
  mode: 'create' | 'edit'
  initialPo?: PurchaseOrderDetail | null
  suppliers: SupplierItem[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'saved', po: PurchaseOrderDetail): void
}>()

const toast = useToast()

const localSuppliers = ref<SupplierItem[]>([])
const loadingSuppliers = ref(false)
const submitting = ref(false)
const formError = ref('')

const supplierId = ref('')
const currency = ref<CurrencyCode>('HUF')
const exchangeRate = ref<number>(1)
const expectedDeliveryDate = ref('')
const supplierReference = ref('')
const note = ref('')
const rows = ref<EditablePoItemRow[]>([])

// Variáns kereső állapot
const variantSearch = ref('')
const variantResults = ref<VariantItem[]>([])
const loadingVariants = ref(false)
const showVariantDropdown = ref(false)
let variantSearchTimer: ReturnType<typeof setTimeout> | null = null
let latestVariantSearchSeq = 0

// Beszállítói ár segédinformáció variánsonként
const variantSuppliersMap = ref<Record<string, VariantSupplierItem[]>>({})

const effectiveSuppliers = computed(() => {
  const list = props.suppliers.length > 0 ? props.suppliers : localSuppliers.value
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'hu'))
})

const addedVariantIds = computed(() => new Set(rows.value.map((r) => r.variantId)))

const totalQuantity = computed(() =>
  rows.value.reduce((sum, r) => sum + (Number.isFinite(r.orderedQuantity) ? Math.max(0, r.orderedQuantity) : 0), 0),
)

const totalAmount = computed(() =>
  rows.value.reduce((sum, r) => {
    const qty = Number.isFinite(r.orderedQuantity) ? Math.max(0, r.orderedQuantity) : 0
    const cost = Number.isFinite(r.unitCost) ? Math.max(0, r.unitCost) : 0
    return sum + qty * cost
  }, 0),
)

const totalAmountHuf = computed(() => {
  const rate = Number.isFinite(exchangeRate.value) && exchangeRate.value > 0 ? exchangeRate.value : 1
  return totalAmount.value * rate
})

function formatDateInput(iso?: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

function getPrimaryBarcode(variant: { variantBarcodes?: Array<{ barcode: string; isPrimary: boolean }> }): string | null {
  const list = variant.variantBarcodes ?? []
  const primary = list.find((b) => b.isPrimary) ?? list[0]
  return primary?.barcode ?? null
}

function computeNetSupplierPrice(vs: VariantSupplierItem): number | null {
  if (vs.purchasePrice === undefined || vs.purchasePrice === null) return null
  const base = Number(vs.purchasePrice)
  if (!Number.isFinite(base)) return null
  const discount = vs.discountPercent !== undefined && vs.discountPercent !== null ? Number(vs.discountPercent) : 0
  if (Number.isFinite(discount) && discount > 0) {
    return Math.round(base * (1 - discount / 100) * 100) / 100
  }
  return Math.round(base * 100) / 100
}

function getSupplierHintForVariant(variantId: string): {
  entry: VariantSupplierItem
  netPrice: number | null
  isExactSupplier: boolean
} | null {
  const list = variantSuppliersMap.value[variantId]
  if (!list || list.length === 0) return null
  const exact = supplierId.value ? list.find((item) => item.supplierId === supplierId.value) : undefined
  const chosen = exact ?? list.find((item) => item.isPrimary) ?? list[0]
  if (!chosen) return null
  return {
    entry: chosen,
    netPrice: computeNetSupplierPrice(chosen),
    isExactSupplier: Boolean(exact),
  }
}

async function ensureSuppliersLoaded() {
  if (props.suppliers.length > 0 || localSuppliers.value.length > 0) return
  loadingSuppliers.value = true
  try {
    const res = await supplierApi.getAll()
    localSuppliers.value = res.data
  } catch {
    // Nem blokkoljuk a modált, a szülő komponenstől is érkezhetnek beszállítók
  } finally {
    loadingSuppliers.value = false
  }
}

async function loadVariantSupplierHints(variantId: string, autoApplyToRow = false) {
  if (variantSuppliersMap.value[variantId]) {
    if (autoApplyToRow) {
      applySuggestedPriceIfUntouched(variantId)
    }
    return
  }
  try {
    const res = await variantSuppliersApi.list(variantId)
    variantSuppliersMap.value = {
      ...variantSuppliersMap.value,
      [variantId]: res.data,
    }
    if (autoApplyToRow) {
      applySuggestedPriceIfUntouched(variantId)
    }
  } catch {
    // Opcionális segédkártya, hiba esetén csendben kihagyjuk
  }
}

function applySuggestedPriceIfUntouched(variantId: string) {
  const row = rows.value.find((r) => r.variantId === variantId)
  if (!row || row.touchedCost) return
  const hint = getSupplierHintForVariant(variantId)
  if (!hint || !hint.isExactSupplier || hint.netPrice === null) return
  const vsCurrency = (hint.entry.currency || 'HUF').toUpperCase()
  if (vsCurrency === currency.value) {
    row.unitCost = hint.netPrice
  }
}

function applySupplierHintPrice(variantId: string) {
  const row = rows.value.find((r) => r.variantId === variantId)
  const hint = getSupplierHintForVariant(variantId)
  if (!row || !hint || hint.netPrice === null) return
  row.unitCost = hint.netPrice
  row.touchedCost = true
}

function resetForm() {
  formError.value = ''
  variantSearch.value = ''
  variantResults.value = []
  showVariantDropdown.value = false

  if (props.mode === 'edit' && props.initialPo) {
    const po = props.initialPo
    supplierId.value = po.supplierId
    const upperCur = (po.currency || 'HUF').toUpperCase()
    currency.value = CURRENCIES.includes(upperCur as CurrencyCode) ? (upperCur as CurrencyCode) : 'HUF'
    exchangeRate.value = Number(po.exchangeRate) || 1
    expectedDeliveryDate.value = formatDateInput(po.expectedDeliveryDate)
    supplierReference.value = po.supplierReference ?? ''
    note.value = po.note ?? ''
    rows.value = po.items.map((item) => ({
      variantId: item.variantId,
      sku: item.variant.sku,
      productName: item.variant.product?.name ?? 'Ismeretlen termék',
      size: item.variant.size ?? null,
      colors: item.variant.colors ?? [],
      primaryBarcode: getPrimaryBarcode(item.variant),
      orderedQuantity: item.orderedQuantity,
      unitCost: Number(item.unitCost) || 0,
      note: item.note ?? '',
      touchedCost: true,
    }))
    for (const row of rows.value) {
      void loadVariantSupplierHints(row.variantId, false)
    }
  } else {
    supplierId.value = ''
    currency.value = 'HUF'
    exchangeRate.value = 1
    expectedDeliveryDate.value = ''
    supplierReference.value = ''
    note.value = ''
    rows.value = []
  }
}

watch(
  () => props.visible,
  (isVisible) => {
    if (isVisible) {
      void ensureSuppliersLoaded()
      resetForm()
    }
  },
  { immediate: true },
)

watch(currency, (nextCur) => {
  if (nextCur === 'HUF') {
    exchangeRate.value = 1
  }
})

watch(variantSearch, (val) => {
  if (variantSearchTimer) clearTimeout(variantSearchTimer)
  const trimmed = val.trim()
  if (!trimmed) {
    variantResults.value = []
    loadingVariants.value = false
    return
  }
  loadingVariants.value = true
  variantSearchTimer = setTimeout(() => {
    void fetchVariants(trimmed)
  }, 300)
})

async function fetchVariants(query: string) {
  const seq = ++latestVariantSearchSeq
  loadingVariants.value = true
  try {
    const res = await variantApi.getAll({ search: query, take: 20 })
    if (seq !== latestVariantSearchSeq) return
    variantResults.value = res.data
    showVariantDropdown.value = true
  } catch (err) {
    if (seq !== latestVariantSearchSeq) return
    toast.add({
      severity: 'error',
      summary: 'Keresési hiba',
      detail: extractApiError(err, 'Nem sikerült keresni a termékvariánsok között.'),
      life: 4000,
    })
  } finally {
    if (seq === latestVariantSearchSeq) {
      loadingVariants.value = false
    }
  }
}

function addVariantRow(variant: VariantItem) {
  if (addedVariantIds.value.has(variant.id)) {
    toast.add({
      severity: 'warn',
      summary: 'Duplikált tétel',
      detail: `A(z) ${variant.sku} variáns már szerepel a rendelés tételei között.`,
      life: 3000,
    })
    return
  }

  const fallbackCost = Number(variant.costPrice ?? 0)
  rows.value.push({
    variantId: variant.id,
    sku: variant.sku,
    productName: variant.product?.name ?? 'Ismeretlen termék',
    size: variant.size ?? null,
    colors: variant.colors ?? [],
    primaryBarcode: getPrimaryBarcode(variant),
    orderedQuantity: 1,
    unitCost: currency.value === 'HUF' && Number.isFinite(fallbackCost) ? fallbackCost : 0,
    note: '',
    touchedCost: false,
  })

  variantSearch.value = ''
  variantResults.value = []
  showVariantDropdown.value = false
  formError.value = ''

  void loadVariantSupplierHints(variant.id, true)
}

function removeRow(index: number) {
  rows.value.splice(index, 1)
}

function validateForm(): string | null {
  if (!supplierId.value) {
    return 'Válassz egy beszállítót a beszerzési rendeléshez.'
  }
  if (!Number.isFinite(exchangeRate.value) || exchangeRate.value <= 0) {
    return 'Az árfolyam pozitív szám kell legyen.'
  }

  const seen = new Set<string>()
  for (const row of rows.value) {
    if (seen.has(row.variantId)) {
      return `Duplikált variáns a tételek között (${row.sku}).`
    }
    seen.add(row.variantId)

    if (!Number.isInteger(row.orderedQuantity) || row.orderedQuantity < 1) {
      return `A rendelt mennyiség legalább 1 egész szám kell legyen (${row.sku}).`
    }
    if (!Number.isFinite(row.unitCost) || row.unitCost < 0) {
      return `Az egységár nem lehet negatív (${row.sku}).`
    }
  }

  return null
}

async function handleSubmit() {
  formError.value = ''
  const validationError = validateForm()
  if (validationError) {
    formError.value = validationError
    return
  }

  const itemPayloads: CreatePurchaseOrderItemPayload[] = rows.value.map((r) => ({
    variantId: r.variantId,
    orderedQuantity: Math.trunc(r.orderedQuantity),
    unitCost: Math.round(r.unitCost * 100) / 100,
    note: r.note.trim() || null,
  }))

  submitting.value = true
  try {
    const commonPayload = {
      supplierId: supplierId.value,
      currency: currency.value,
      exchangeRate: Math.round(exchangeRate.value * 10000) / 10000,
      supplierReference: supplierReference.value.trim() || null,
      expectedDeliveryDate: expectedDeliveryDate.value || null,
      note: note.value.trim() || null,
      items: itemPayloads,
    }

    const res =
      props.mode === 'edit' && props.initialPo
        ? await purchaseOrdersApi.update(props.initialPo.id, commonPayload)
        : await purchaseOrdersApi.create(commonPayload)

    toast.add({
      severity: 'success',
      summary: props.mode === 'edit' ? 'Rendelés frissítve' : 'Rendelés létrehozva',
      detail: `${res.data.orderNumber} sikeresen mentve.`,
      life: 4000,
    })
    emit('saved', res.data)
    emit('update:visible', false)
  } catch (err) {
    const msg = extractApiError(err, 'Nem sikerült menteni a beszerzési rendelést.')
    formError.value = msg
    toast.add({
      severity: 'error',
      summary: 'Mentési hiba',
      detail: msg,
      life: 5000,
    })
  } finally {
    submitting.value = false
  }
}

onBeforeUnmount(() => {
  if (variantSearchTimer) clearTimeout(variantSearchTimer)
})
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="
      mode === 'edit' && initialPo
        ? `Beszerzési rendelés szerkesztése (${initialPo.orderNumber})`
        : 'Új beszerzési rendelés (PO)'
    "
    :style="{ width: '60rem', maxWidth: '96vw' }"
    @update:visible="emit('update:visible', $event)"
  >
    <form @submit.prevent="handleSubmit" class="space-y-5 pt-2 text-[#171918]">
      <div
        v-if="formError"
        class="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium px-3.5 py-2.5 rounded-xl flex items-center gap-2"
      >
        <i class="pi pi-exclamation-circle text-sm"></i>
        <span>{{ formError }}</span>
      </div>

      <!-- Fejadatok -->
      <div class="grid grid-cols-1 md:grid-cols-12 gap-3.5 bg-[#f8f9f7] border border-[#e8eae6] rounded-2xl p-4">
        <div class="md:col-span-5">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Beszállító <span class="text-rose-500">*</span>
          </label>
          <select
            v-model="supplierId"
            required
            class="w-full h-10 bg-white rounded-xl border border-[#dce0d8] px-3 text-sm outline-none focus:border-[#f46714]"
          >
            <option value="" disabled>
              {{ loadingSuppliers ? 'Beszállítók betöltése...' : 'Válassz beszállítót...' }}
            </option>
            <option v-for="sup in effectiveSuppliers" :key="sup.id" :value="sup.id">
              {{ sup.name }}
            </option>
          </select>
        </div>

        <div class="md:col-span-2">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">Pénznem</label>
          <select
            v-model="currency"
            class="w-full h-10 bg-white rounded-xl border border-[#dce0d8] px-3 text-sm outline-none focus:border-[#f46714]"
          >
            <option v-for="cur in CURRENCIES" :key="cur" :value="cur">
              {{ cur }}
            </option>
          </select>
        </div>

        <div class="md:col-span-2">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">Árfolyam (Ft)</label>
          <input
            v-model.number="exchangeRate"
            type="number"
            min="0.0001"
            step="0.0001"
            :disabled="currency === 'HUF'"
            required
            class="w-full h-10 bg-white disabled:bg-slate-100 rounded-xl border border-[#dce0d8] px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <div class="md:col-span-3">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">Tervezett kézbesítés</label>
          <input
            v-model="expectedDeliveryDate"
            type="date"
            class="w-full h-10 bg-white rounded-xl border border-[#dce0d8] px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <div class="md:col-span-5">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">Gyártói hivatkozás</label>
          <input
            v-model="supplierReference"
            type="text"
            placeholder="Pl. SUP-INV-2026 / ajánlatszám"
            class="w-full h-10 bg-white rounded-xl border border-[#dce0d8] px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <div class="md:col-span-7">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">Megjegyzés</label>
          <input
            v-model="note"
            type="text"
            placeholder="Belső megjegyzés vagy szállítási instrukció..."
            class="w-full h-10 bg-white rounded-xl border border-[#dce0d8] px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>
      </div>

      <!-- Variáns kereső -->
      <div class="space-y-2">
        <label class="block text-xs font-semibold text-[#686f6a]">
          Tétel hozzáadása (variáns keresése név, SKU vagy vonalkód alapján)
        </label>
        <div class="relative">
          <i class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"></i>
          <input
            v-model="variantSearch"
            type="text"
            placeholder="Kezdj el gépelni pl. SKU-t, terméknevet vagy vonalkódot..."
            @focus="showVariantDropdown = variantResults.length > 0"
            class="w-full h-10 bg-white rounded-xl border border-[#dce0d8] pl-9 pr-10 text-sm outline-none focus:border-[#f46714]"
          />
          <i
            v-if="loadingVariants"
            class="pi pi-spin pi-spinner absolute right-3.5 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"
          ></i>

          <div
            v-if="showVariantDropdown && variantSearch.trim().length > 0"
            class="absolute z-30 mt-1.5 w-full bg-white border border-[#dce0d8] rounded-xl shadow-lg max-h-64 overflow-y-auto divide-y divide-[#eff1ed]"
          >
            <div v-if="loadingVariants" class="px-4 py-3 text-xs text-[#686f6a]">
              Variánsok keresése...
            </div>
            <div
              v-else-if="variantResults.length === 0"
              class="px-4 py-3 text-xs text-[#686f6a]"
            >
              Nincs találat a keresésre.
            </div>
            <button
              v-for="variant in variantResults"
              v-else
              :key="variant.id"
              type="button"
              :disabled="addedVariantIds.has(variant.id)"
              @click="addVariantRow(variant)"
              class="w-full px-4 py-2.5 text-left flex items-center justify-between gap-3 hover:bg-[#f8f9f7] disabled:opacity-55 disabled:cursor-not-allowed transition cursor-pointer"
            >
              <div class="min-w-0">
                <p class="text-xs font-semibold text-[#171918] truncate">
                  {{ variant.product?.name ?? 'Ismeretlen termék' }}
                </p>
                <div class="flex flex-wrap items-center gap-2 text-[11px] text-[#686f6a] mt-0.5">
                  <span class="font-mono font-semibold text-[#171918]">{{ variant.sku }}</span>
                  <span v-if="variant.size" class="bg-[#eff1ed] px-1.5 py-0.5 rounded">
                    {{ variant.size }}
                  </span>
                  <span v-if="variant.colors.length > 0">{{ variant.colors.join(', ') }}</span>
                  <span v-if="getPrimaryBarcode(variant)" class="font-mono">
                    · {{ getPrimaryBarcode(variant) }}
                  </span>
                </div>
              </div>
              <span
                v-if="addedVariantIds.has(variant.id)"
                class="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 shrink-0"
              >
                Már hozzáadva
              </span>
              <span
                v-else
                class="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[#171918] text-white shrink-0"
              >
                + Hozzáadás
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- Tételek táblázata -->
      <div class="border border-[#e8eae6] rounded-2xl overflow-hidden bg-white">
        <div class="bg-[#f8f9f7] px-4 py-2.5 border-b border-[#e8eae6] flex items-center justify-between">
          <span class="text-xs font-semibold text-[#171918]">
            Rendelési tételek ({{ rows.length }} sor · {{ totalQuantity }} db)
          </span>
          <span v-if="rows.length === 0" class="text-[11px] text-[#686f6a]">
            Piszkozatként tétel nélkül is menthető, feladáshoz min. 1 tétel szükséges.
          </span>
        </div>

        <div v-if="rows.length === 0" class="py-10 text-center text-xs text-[#686f6a]">
          Használd a fenti variáns-keresőt tételek felvételéhez.
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="bg-[#eff1ed] text-[#686f6a] text-[11px]">
                <th class="py-2 px-3 font-medium">Termék & SKU</th>
                <th class="py-2 px-3 font-medium w-28">Rendelt db</th>
                <th class="py-2 px-3 font-medium w-44">Egységár ({{ currency }})</th>
                <th class="py-2 px-3 font-medium w-44">Megjegyzés</th>
                <th class="py-2 px-3 font-medium text-right w-32">Összesen</th>
                <th class="py-2 px-3 font-medium text-right w-14"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#eff1ed]">
              <tr v-for="(row, idx) in rows" :key="row.variantId" class="hover:bg-[#fafbf9]">
                <td class="py-2.5 px-3 align-top">
                  <p class="font-semibold text-[#171918]">{{ row.productName }}</p>
                  <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-[#686f6a] mt-0.5">
                    <span class="font-mono font-semibold text-[#171918]">{{ row.sku }}</span>
                    <span v-if="row.size" class="bg-[#eff1ed] px-1.5 py-0.5 rounded">{{ row.size }}</span>
                    <span v-if="row.colors.length > 0">{{ row.colors.join(', ') }}</span>
                  </div>
                  <div
                    v-if="getSupplierHintForVariant(row.variantId)"
                    class="mt-1 inline-flex flex-wrap items-center gap-1.5 text-[10px] bg-sky-50 text-sky-800 border border-sky-200 rounded-md px-2 py-0.5"
                  >
                    <span>
                      {{ getSupplierHintForVariant(row.variantId)?.isExactSupplier ? 'Beszállítói ár' : 'Elsődleges besz. ár' }}:
                      <strong>
                        {{
                          formatCurrency(
                            getSupplierHintForVariant(row.variantId)?.netPrice,
                            getSupplierHintForVariant(row.variantId)?.entry.currency,
                          )
                        }}
                      </strong>
                    </span>
                    <span v-if="getSupplierHintForVariant(row.variantId)?.entry.supplierSku" class="font-mono">
                      ({{ getSupplierHintForVariant(row.variantId)?.entry.supplierSku }})
                    </span>
                    <button
                      v-if="
                        getSupplierHintForVariant(row.variantId)?.netPrice !== null &&
                        (getSupplierHintForVariant(row.variantId)?.entry.currency || 'HUF').toUpperCase() === currency
                      "
                      type="button"
                      @click="applySupplierHintPrice(row.variantId)"
                      class="underline font-semibold hover:text-sky-950 cursor-pointer"
                    >
                      Ár átvétele
                    </button>
                  </div>
                </td>
                <td class="py-2.5 px-3 align-top">
                  <input
                    v-model.number="row.orderedQuantity"
                    type="number"
                    min="1"
                    step="1"
                    required
                    class="w-full h-8 rounded-lg border border-[#dce0d8] px-2 text-xs font-semibold outline-none focus:border-[#f46714]"
                  />
                </td>
                <td class="py-2.5 px-3 align-top">
                  <input
                    v-model.number="row.unitCost"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    @input="row.touchedCost = true"
                    class="w-full h-8 rounded-lg border border-[#dce0d8] px-2 text-xs font-semibold outline-none focus:border-[#f46714]"
                  />
                </td>
                <td class="py-2.5 px-3 align-top">
                  <input
                    v-model="row.note"
                    type="text"
                    placeholder="Opc. megjegyzés"
                    class="w-full h-8 rounded-lg border border-[#dce0d8] px-2 text-xs outline-none focus:border-[#f46714]"
                  />
                </td>
                <td class="py-2.5 px-3 align-top text-right font-semibold text-[#171918] whitespace-nowrap">
                  {{ formatCurrency((row.orderedQuantity || 0) * (row.unitCost || 0), currency) }}
                </td>
                <td class="py-2.5 px-3 align-top text-right">
                  <button
                    type="button"
                    @click="removeRow(idx)"
                    title="Tétel eltávolítása"
                    class="size-8 rounded-lg text-rose-600 hover:bg-rose-50 inline-flex items-center justify-center cursor-pointer transition"
                  >
                    <i class="pi pi-trash text-xs"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-if="rows.length > 0"
          class="bg-[#f8f9f7] px-4 py-3 border-t border-[#e8eae6] flex flex-wrap items-center justify-end gap-4 text-xs"
        >
          <span class="text-[#686f6a]">
            Mindösszesen:
            <strong class="text-sm text-[#171918] ml-1">{{ formatCurrency(totalAmount, currency) }}</strong>
          </span>
          <span v-if="currency !== 'HUF'" class="text-[#686f6a]">
            (≈ <strong class="text-[#171918]">{{ formatCurrency(totalAmountHuf, 'HUF') }}</strong>)
          </span>
        </div>
      </div>

      <!-- Gombok -->
      <div class="flex justify-end gap-2.5 pt-2">
        <button
          type="button"
          @click="emit('update:visible', false)"
          class="h-10 px-4 rounded-xl bg-white border border-[#dce0d8] hover:bg-[#f8f9f7] text-xs font-semibold text-[#171918] cursor-pointer transition"
        >
          Mégse
        </button>
        <button
          type="submit"
          :disabled="submitting"
          class="h-10 px-5 rounded-xl bg-[#171918] hover:bg-[#2a2d2b] text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 transition"
        >
          <i v-if="submitting" class="pi pi-spin pi-spinner text-xs"></i>
          <span>{{ mode === 'edit' ? 'Módosítások mentése' : 'Piszkozat létrehozása' }}</span>
        </button>
      </div>
    </form>
  </Dialog>
</template>
