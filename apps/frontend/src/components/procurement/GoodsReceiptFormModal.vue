<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { LocationType } from '@wmanager/shared-types'
import {
  goodsReceiptsApi,
  type CreateGoodsReceiptItemPayload,
  type CreateGoodsReceiptPayload,
  type GoodsReceiptDetail,
} from '@/api/goodsReceipts'
import type { LocationItem } from '@/api/locations'
import type { PurchaseOrderDetail } from '@/api/purchaseOrders'
import { supplierApi, type SupplierItem } from '@/api/suppliers'
import { variantApi, type VariantItem } from '@/api/variants'
import { extractApiError, getLocationPath, LOCATION_TYPE_META } from '@/utils/locationMeta'
import { formatCurrency } from '@/utils/procurementMeta'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import { useToast } from 'primevue/usetoast'

interface DraftReceiptItem {
  variantId: string
  purchaseOrderItemId?: string
  sku: string
  productName: string
  size?: string | null
  colors: string[]
  poRemainingQty?: number
  expectedQuantity: number
  unitCost: number
  expectedLocationId: string | null
  note: string
}

const CURRENCY_OPTIONS = ['HUF', 'EUR', 'USD', 'GBP', 'CZK', 'PLN'] as const

const props = defineProps<{
  visible: boolean
  preselectedPo?: PurchaseOrderDetail | null
  allLocations: LocationItem[]
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  created: [receipt: GoodsReceiptDetail]
}>()

const toast = useToast()

const suppliers = ref<SupplierItem[]>([])
const loadingSuppliers = ref(false)

const targetLocationId = ref<string | null>(null)
const supplierId = ref<string | null>(null)
const invoiceNumber = ref('')
const currency = ref<string>('HUF')
const exchangeRate = ref<number>(1)
const note = ref('')
const draftItems = ref<DraftReceiptItem[]>([])

const variantSearchInput = ref('')
const variantResults = ref<VariantItem[]>([])
const loadingVariants = ref(false)
const submitting = ref(false)

let variantSearchTimer: ReturnType<typeof setTimeout> | null = null
let latestVariantSeq = 0

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

const isFromPo = computed(() => Boolean(props.preselectedPo))

const locationById = computed(() => new Map(props.allLocations.map((loc) => [loc.id, loc])))

const targetLocationOptions = computed(() => {
  const roots = props.allLocations.filter(
    (loc) =>
      loc.isActive &&
      loc.isAssigned !== false &&
      (loc.type === LocationType.WAREHOUSE || loc.type === LocationType.STORE),
  )
  const source =
    roots.length > 0
      ? roots
      : props.allLocations.filter((loc) => loc.isActive && loc.isAssigned !== false)

  return source
    .map((loc) => ({
      id: loc.id,
      label: `${loc.name} (${LOCATION_TYPE_META[loc.type].label})`,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'hu', { numeric: true }))
})

function isLocationInSubtree(locationId: string, rootId: string): boolean {
  let current: LocationItem | undefined = locationById.value.get(locationId)
  const visited = new Set<string>()
  while (current && !visited.has(current.id)) {
    if (current.id === rootId) return true
    visited.add(current.id)
    current = current.parentId ? locationById.value.get(current.parentId) : undefined
  }
  return false
}

const shelfOptionsForTarget = computed(() => {
  if (!targetLocationId.value) return []
  const rootId = targetLocationId.value
  return props.allLocations
    .filter(
      (loc) => loc.isActive && loc.isAssigned !== false && isLocationInSubtree(loc.id, rootId),
    )
    .map((loc) => {
      const pathNames = getLocationPath(loc.id, locationById.value).map((p) => p.name)
      const pathLabel = pathNames.length > 0 ? pathNames.join(' › ') : loc.name
      return {
        id: loc.id,
        label: `${pathLabel} (${LOCATION_TYPE_META[loc.type].label})`,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label, 'hu', { numeric: true }))
})

const supplierOptions = computed(() =>
  suppliers.value
    .map((s) => ({ id: s.id, label: s.name }))
    .sort((a, b) => a.label.localeCompare(b.label, 'hu')),
)

const addedVariantIds = computed(() => new Set(draftItems.value.map((item) => item.variantId)))

const totalExpectedQuantity = computed(() =>
  draftItems.value.reduce((sum, item) => sum + (Number.isFinite(item.expectedQuantity) ? Math.max(0, Math.trunc(item.expectedQuantity)) : 0), 0),
)

const estimatedTotalForeign = computed(() =>
  round2(
    draftItems.value.reduce(
      (sum, item) =>
        sum +
        Math.max(0, Math.trunc(item.expectedQuantity || 0)) * Math.max(0, Number(item.unitCost || 0)),
      0,
    ),
  ),
)

const estimatedTotalHuf = computed(() => {
  const rate = Number.isFinite(exchangeRate.value) && exchangeRate.value > 0 ? exchangeRate.value : 1
  return round2(estimatedTotalForeign.value * rate)
})

const canSubmit = computed(() => {
  if (submitting.value || !targetLocationId.value) return false
  if (!currency.value || currency.value.trim().length !== 3) return false
  if (!Number.isFinite(exchangeRate.value) || exchangeRate.value < 0.0001) return false
  if (isFromPo.value && draftItems.value.length === 0) return false
  return draftItems.value.every(
    (item) =>
      Number.isInteger(item.expectedQuantity) &&
      item.expectedQuantity >= 1 &&
      Number.isFinite(item.unitCost) &&
      item.unitCost >= 0,
  )
})

async function loadSuppliers() {
  if (suppliers.value.length > 0) return
  loadingSuppliers.value = true
  try {
    const res = await supplierApi.getAll()
    suppliers.value = res.data
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Beszállítók betöltése sikertelen',
      detail: extractApiError(err, 'Nem sikerült lekérni a beszállítók listáját.'),
      life: 4000,
    })
  } finally {
    loadingSuppliers.value = false
  }
}

async function searchVariants(query: string) {
  const seq = ++latestVariantSeq
  loadingVariants.value = true
  try {
    const res = await variantApi.getAll({
      search: query.trim() || undefined,
      take: 20,
    })
    if (seq !== latestVariantSeq) return
    variantResults.value = res.data
  } catch (err) {
    if (seq !== latestVariantSeq) return
    toast.add({
      severity: 'error',
      summary: 'Variáns keresési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a termékvariánsokat.'),
      life: 4000,
    })
  } finally {
    if (seq === latestVariantSeq) {
      loadingVariants.value = false
    }
  }
}

function triggerImmediateVariantSearch() {
  if (variantSearchTimer) clearTimeout(variantSearchTimer)
  void searchVariants(variantSearchInput.value)
}

function addVariantRow(variant: VariantItem) {
  if (addedVariantIds.value.has(variant.id)) {
    toast.add({
      severity: 'info',
      summary: 'Már szerepel a listában',
      detail: `${variant.sku} már hozzá lett adva ehhez a bevételezéshez.`,
      life: 3000,
    })
    return
  }

  const defaultCost =
    currency.value === 'HUF' && variant.costPrice !== undefined
      ? round2(Number(variant.costPrice) || 0)
      : 0

  draftItems.value.push({
    variantId: variant.id,
    sku: variant.sku,
    productName: variant.product?.name ?? 'Ismeretlen termék',
    size: variant.size,
    colors: variant.colors ?? [],
    expectedQuantity: 1,
    unitCost: Number.isFinite(defaultCost) && defaultCost >= 0 ? defaultCost : 0,
    expectedLocationId: null,
    note: '',
  })
}

function removeDraftRow(variantId: string) {
  draftItems.value = draftItems.value.filter((item) => item.variantId !== variantId)
}

function initializeForm() {
  variantSearchInput.value = ''
  invoiceNumber.value = ''
  note.value = ''

  // Alapértelmezett aktív célhelyszín kiválasztása
  const firstTarget = targetLocationOptions.value[0]?.id ?? null
  targetLocationId.value = firstTarget

  const po = props.preselectedPo
  if (po) {
    supplierId.value = po.supplierId
    currency.value = (po.currency || 'HUF').toUpperCase()
    const parsedRate = Number(po.exchangeRate)
    exchangeRate.value = Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : 1

    draftItems.value = po.items
      .map((poItem) => {
        const targetQty = poItem.confirmedQuantity ?? poItem.orderedQuantity
        const remaining = Math.max(0, targetQty - poItem.receivedQuantity)
        return {
          poItem,
          remaining,
        }
      })
      .filter((entry) => entry.remaining > 0)
      .map(({ poItem, remaining }) => ({
        variantId: poItem.variantId,
        purchaseOrderItemId: poItem.id,
        sku: poItem.variant.sku,
        productName: poItem.variant.product?.name ?? 'Ismeretlen termék',
        size: poItem.variant.size,
        colors: poItem.variant.colors ?? [],
        poRemainingQty: remaining,
        expectedQuantity: remaining,
        unitCost: round2(Number(poItem.unitCost) || 0),
        expectedLocationId: null,
        note: poItem.note ?? '',
      }))
  } else {
    supplierId.value = null
    currency.value = 'HUF'
    exchangeRate.value = 1
    draftItems.value = []
  }
}

watch(currency, (next) => {
  if (next === 'HUF') {
    exchangeRate.value = 1
  }
})

watch(targetLocationOptions, (options) => {
  if (props.visible && !targetLocationId.value && options.length > 0 && options[0]) {
    targetLocationId.value = options[0].id
  }
})

watch(targetLocationId, (nextRoot) => {
  if (!nextRoot) {
    for (const item of draftItems.value) {
      item.expectedLocationId = null
    }
    return
  }
  for (const item of draftItems.value) {
    if (item.expectedLocationId && !isLocationInSubtree(item.expectedLocationId, nextRoot)) {
      item.expectedLocationId = null
    }
  }
})

watch(variantSearchInput, (val) => {
  if (!props.visible) return
  if (variantSearchTimer) clearTimeout(variantSearchTimer)
  variantSearchTimer = setTimeout(() => {
    void searchVariants(val)
  }, 300)
})

watch(
  () => [props.visible, props.preselectedPo] as const,
  ([isOpen]) => {
    if (!isOpen) {
      if (variantSearchTimer) clearTimeout(variantSearchTimer)
      return
    }
    initializeForm()
    void loadSuppliers()
    void searchVariants('')
  },
  { immediate: true },
)

function closeModal() {
  emit('update:visible', false)
}

async function handleSubmit() {
  if (!targetLocationId.value) {
    toast.add({
      severity: 'warn',
      summary: 'Hiányzó célhelyszín',
      detail: 'Válassz ki egy aktív raktárat vagy üzletet a bevételezéshez.',
      life: 4000,
    })
    return
  }

  if (isFromPo.value && draftItems.value.length === 0) {
    toast.add({
      severity: 'warn',
      summary: 'Üres tétellista',
      detail: 'Beszerzési rendelésből indított bevételezéshez legalább egy tétel szükséges.',
      life: 4000,
    })
    return
  }

  const normalizedItems: CreateGoodsReceiptItemPayload[] = []
  for (const row of draftItems.value) {
    const qty = Math.trunc(row.expectedQuantity)
    const cost = round2(Number(row.unitCost))
    if (!Number.isInteger(qty) || qty < 1) {
      toast.add({
        severity: 'warn',
        summary: 'Érvénytelen mennyiség',
        detail: `${row.sku}: a várt mennyiségnek legalább 1 egész számnak kell lennie.`,
        life: 4000,
      })
      return
    }
    if (!Number.isFinite(cost) || cost < 0) {
      toast.add({
        severity: 'warn',
        summary: 'Érvénytelen egységár',
        detail: `${row.sku}: az egységár nem lehet negatív.`,
        life: 4000,
      })
      return
    }
    normalizedItems.push({
      variantId: row.variantId,
      purchaseOrderItemId: row.purchaseOrderItemId,
      expectedQuantity: qty,
      unitCost: cost,
      expectedLocationId: row.expectedLocationId || undefined,
      note: row.note.trim() || undefined,
    })
  }

  const payload: CreateGoodsReceiptPayload = {
    targetLocationId: targetLocationId.value,
    purchaseOrderId: props.preselectedPo?.id,
    supplierId: props.preselectedPo ? props.preselectedPo.supplierId : supplierId.value || undefined,
    invoiceNumber: invoiceNumber.value.trim() || undefined,
    currency: currency.value.trim().toUpperCase(),
    exchangeRate: Number(exchangeRate.value),
    note: note.value.trim() || undefined,
    items: normalizedItems.length > 0 ? normalizedItems : undefined,
  }

  submitting.value = true
  try {
    const res = await goodsReceiptsApi.create(payload)
    toast.add({
      severity: 'success',
      summary: 'Bevételezés létrehozva',
      detail: `${res.data.receiptNumber} nyitott állapotban elmentve.`,
      life: 4000,
    })
    emit('created', res.data)
    closeModal()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Létrehozási hiba',
      detail: extractApiError(err, 'Nem sikerült létrehozni a bevételezést.'),
      life: 6000,
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
    @update:visible="(val) => emit('update:visible', val)"
    modal
    :header="
      preselectedPo
        ? `Szállítmány bevételezése (${preselectedPo.orderNumber})`
        : 'Új bevételezés (számla / szállítmány)'
    "
    :style="{ width: '68rem', maxWidth: '96vw' }"
  >
    <form class="space-y-4 pt-1 text-[#171918]" @submit.prevent="handleSubmit">
      <!-- PO összekapcsolás jelző -->
      <div
        v-if="preselectedPo"
        class="rounded-[12px] bg-sky-50 border border-sky-200 px-3.5 py-2.5 text-xs text-sky-900 flex flex-wrap items-center justify-between gap-2"
      >
        <div class="flex items-center gap-2">
          <i class="pi pi-link text-sky-600"></i>
          <span>
            Beszerzési rendelés:
            <strong class="font-mono">{{ preselectedPo.orderNumber }}</strong>
            · Beszállító: <strong>{{ preselectedPo.supplier.name }}</strong>
          </span>
        </div>
        <span class="text-[11px] text-sky-700">
          Részszállításhoz szabadon módosíthatod a várt mennyiségeket vagy törölhetsz sorokat.
        </span>
      </div>

      <!-- Fejléc adatok -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
        <div class="space-y-1">
          <label class="block text-xs font-semibold text-[#171918]">
            Célhelyszín (Raktár / Üzlet) <span class="text-rose-600">*</span>
          </label>
          <Select
            v-model="targetLocationId"
            :options="targetLocationOptions"
            optionLabel="label"
            optionValue="id"
            placeholder="Válassz célhelyszínt..."
            filter
            class="w-full text-xs"
          />
        </div>

        <div class="space-y-1">
          <label class="block text-xs font-semibold text-[#171918]">
            Beszállító <span v-if="!isFromPo" class="font-normal text-[#686f6a]">(opcionális)</span>
          </label>
          <Select
            v-model="supplierId"
            :options="supplierOptions"
            optionLabel="label"
            optionValue="id"
            :loading="loadingSuppliers"
            :disabled="isFromPo"
            placeholder="Válassz beszállítót..."
            filter
            :showClear="!isFromPo"
            class="w-full text-xs"
          />
        </div>

        <div class="space-y-1">
          <label for="gr-invoice-number" class="block text-xs font-semibold text-[#171918]">
            Számlaszám / Szállítólevél
          </label>
          <input
            id="gr-invoice-number"
            v-model="invoiceNumber"
            type="text"
            maxlength="100"
            placeholder="Pl. INV-2026-0042"
            class="w-full h-[38px] rounded-[10px] bg-white border border-[#dce0d8] px-3 text-xs text-[#171918] outline-none focus:border-[#f46714]"
          />
        </div>

        <div class="space-y-1">
          <label class="block text-xs font-semibold text-[#171918]">Pénznem</label>
          <Select
            v-model="currency"
            :options="[...CURRENCY_OPTIONS]"
            placeholder="Pénznem"
            class="w-full text-xs"
          />
        </div>

        <div class="space-y-1">
          <label for="gr-exchange-rate" class="block text-xs font-semibold text-[#171918]">
            Árfolyam (1 {{ currency }} = ? HUF)
          </label>
          <input
            id="gr-exchange-rate"
            v-model.number="exchangeRate"
            type="number"
            step="0.0001"
            min="0.0001"
            :disabled="currency === 'HUF'"
            class="w-full h-[38px] rounded-[10px] bg-white border border-[#dce0d8] px-3 text-xs font-mono text-[#171918] outline-none focus:border-[#f46714] disabled:bg-[#f1f3ef] disabled:text-[#686f6a]"
          />
        </div>

        <div class="space-y-1">
          <label for="gr-note" class="block text-xs font-semibold text-[#171918]">
            Megjegyzés
          </label>
          <input
            id="gr-note"
            v-model="note"
            type="text"
            placeholder="Pl. 1. részszállítmány, sérült külső doboz..."
            class="w-full h-[38px] rounded-[10px] bg-white border border-[#dce0d8] px-3 text-xs text-[#171918] outline-none focus:border-[#f46714]"
          />
        </div>
      </div>

      <!-- Variáns kereső és hozzáadó doboz -->
      <div class="rounded-[14px] bg-[#f8f9f7] border border-[#e8eae6] p-3.5 space-y-2.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <span class="text-xs font-bold text-[#171918]">
            Tétel hozzáadása variáns-keresővel
          </span>
          <span class="text-[11px] text-[#686f6a]">
            Kereshetsz terméknévre, SKU-ra vagy vonalkódra
          </span>
        </div>

        <div class="relative">
          <i class="pi pi-search absolute left-3 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"></i>
          <input
            v-model="variantSearchInput"
            type="text"
            placeholder="Keresés SKU, vonalkód vagy terméknév alapján..."
            @keydown.enter.prevent="triggerImmediateVariantSearch"
            class="w-full h-[36px] rounded-[10px] bg-white border border-[#dce0d8] pl-9 pr-3 text-xs text-[#171918] outline-none focus:border-[#f46714]"
          />
        </div>

        <div
          v-if="loadingVariants"
          class="py-3 text-center text-xs text-[#686f6a]"
        >
          <i class="pi pi-spin pi-spinner mr-1"></i> Variánsok keresése...
        </div>

        <div
          v-else-if="variantResults.length > 0"
          class="max-h-[155px] overflow-y-auto divide-y divide-[#e8eae6] bg-white rounded-[10px] border border-[#e8eae6]"
        >
          <div
            v-for="variant in variantResults"
            :key="variant.id"
            class="px-3 py-2 flex items-center justify-between gap-2 hover:bg-[#f8f9f7] transition"
          >
            <div class="min-w-0">
              <p class="text-xs font-semibold text-[#171918] truncate">
                {{ variant.product?.name ?? 'Ismeretlen termék' }}
              </p>
              <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-[#686f6a]">
                <span class="font-mono font-medium text-[#171918]">{{ variant.sku }}</span>
                <span
                  v-if="variant.size"
                  class="bg-[#eff1ed] text-[#171918] px-1.5 rounded font-semibold"
                >
                  {{ variant.size }}
                </span>
                <span v-if="variant.colors.length > 0">{{ variant.colors.join(', ') }}</span>
              </div>
            </div>

            <button
              type="button"
              :disabled="addedVariantIds.has(variant.id)"
              @click="addVariantRow(variant)"
              class="h-[28px] px-2.5 rounded-[8px] text-[11px] font-semibold inline-flex items-center gap-1 shrink-0 transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
              :class="
                addedVariantIds.has(variant.id)
                  ? 'bg-[#eff1ed] text-[#686f6a]'
                  : 'bg-[#171918] hover:bg-[#2a2d2b] text-white'
              "
            >
              <i :class="addedVariantIds.has(variant.id) ? 'pi pi-check text-[10px]' : 'pi pi-plus text-[10px]'"></i>
              <span>{{ addedVariantIds.has(variant.id) ? 'Hozzáadva' : 'Hozzáadás' }}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- Várt tételek táblázat -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <h3 class="text-xs font-bold uppercase tracking-wide text-[#686f6a]">
            Várt tételek ({{ draftItems.length }} sor · {{ totalExpectedQuantity }} db)
          </h3>
          <span class="text-xs font-semibold text-[#171918]">
            Becsült érték: {{ formatCurrency(estimatedTotalForeign, currency) }}
            <span v-if="currency !== 'HUF'" class="text-[#686f6a] font-normal">
              ({{ formatCurrency(estimatedTotalHuf, 'HUF') }})
            </span>
          </span>
        </div>

        <div
          v-if="draftItems.length === 0"
          class="rounded-[12px] border border-dashed border-[#cfd5cc] bg-[#f8f9f7] py-6 px-4 text-center text-xs text-[#686f6a]"
        >
          <p v-if="isFromPo">
            A kiválasztott beszerzési rendelésnek nincs fennmaradó tétele (vagy minden sor törölve lett).
            Adj hozzá legalább egy tételt a fenti keresőből!
          </p>
          <p v-else>
            Még nincs tétel felvéve. Használd a fenti variáns-keresőt, vagy hozd létre üresként
            vak-bevételezéshez (a raktárosok PDA-n/PC-n rögzítik a beérkező árut).
          </p>
        </div>

        <div v-else class="border border-[#e8eae6] rounded-[12px] overflow-x-auto bg-white">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-[#eff1ed] text-[#686f6a]">
              <tr>
                <th class="px-3 py-2 font-semibold">Termék &amp; SKU</th>
                <th class="px-2.5 py-2 font-semibold text-right whitespace-nowrap">Várt db</th>
                <th class="px-2.5 py-2 font-semibold text-right whitespace-nowrap">
                  Egységár ({{ currency }})
                </th>
                <th class="px-2.5 py-2 font-semibold whitespace-nowrap">Javasolt polc</th>
                <th class="px-2.5 py-2 font-semibold text-right"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#e8eae6]">
              <tr v-for="row in draftItems" :key="row.variantId">
                <td class="px-3 py-2 min-w-[200px]">
                  <p class="font-semibold text-[#171918]">{{ row.productName }}</p>
                  <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-[#686f6a]">
                    <span class="font-mono text-[#171918]">{{ row.sku }}</span>
                    <span v-if="row.size" class="bg-[#eff1ed] text-[#171918] px-1 rounded font-semibold">
                      {{ row.size }}
                    </span>
                    <span
                      v-if="row.poRemainingQty !== undefined"
                      class="text-sky-700 font-medium"
                    >
                      · PO hátralévő: {{ row.poRemainingQty }} db
                    </span>
                  </div>
                </td>

                <td class="px-2.5 py-2 text-right whitespace-nowrap">
                  <input
                    v-model.number="row.expectedQuantity"
                    type="number"
                    min="1"
                    step="1"
                    class="w-20 h-[32px] px-2 rounded-[8px] border border-[#dce0d8] text-right font-mono text-xs outline-none focus:border-[#f46714]"
                  />
                </td>

                <td class="px-2.5 py-2 text-right whitespace-nowrap">
                  <input
                    v-model.number="row.unitCost"
                    type="number"
                    min="0"
                    step="0.01"
                    class="w-28 h-[32px] px-2 rounded-[8px] border border-[#dce0d8] text-right font-mono text-xs outline-none focus:border-[#f46714]"
                  />
                </td>

                <td class="px-2.5 py-2 min-w-[210px]">
                  <Select
                    v-model="row.expectedLocationId"
                    :options="shelfOptionsForTarget"
                    optionLabel="label"
                    optionValue="id"
                    placeholder="Opcionális célpolc..."
                    filter
                    showClear
                    :disabled="!targetLocationId"
                    class="w-full text-xs"
                  />
                </td>

                <td class="px-2.5 py-2 text-right">
                  <button
                    type="button"
                    @click="removeDraftRow(row.variantId)"
                    class="w-7 h-7 rounded-lg text-[#686f6a] hover:text-rose-600 hover:bg-rose-50 inline-flex items-center justify-center transition cursor-pointer"
                    title="Tétel eltávolítása"
                  >
                    <i class="pi pi-trash text-xs"></i>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Gombok -->
      <div class="flex items-center justify-end gap-2.5 pt-2 border-t border-[#e8eae6]">
        <button
          type="button"
          :disabled="submitting"
          @click="closeModal"
          class="h-[38px] px-4 rounded-[10px] bg-white border border-[#dce0d8] hover:bg-[#f8f9f7] text-xs font-semibold text-[#171918] transition cursor-pointer disabled:opacity-50"
        >
          Mégse
        </button>
        <button
          type="submit"
          :disabled="!canSubmit"
          class="h-[38px] px-5 rounded-[10px] bg-[#171918] hover:bg-[#2a2d2b] text-xs font-semibold text-white inline-flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
        >
          <i :class="submitting ? 'pi pi-spin pi-spinner text-xs' : 'pi pi-check text-xs'"></i>
          <span>Bevételezés létrehozása</span>
        </button>
      </div>
    </form>
  </Dialog>
</template>
