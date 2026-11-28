<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { LocationType, Role, SalesChannel } from '@wmanager/shared-types'
import AutoComplete, {
  type AutoCompleteCompleteEvent,
  type AutoCompleteOptionSelectEvent,
} from 'primevue/autocomplete'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { useToast } from 'primevue/usetoast'
import { locationApi, type LocationItem } from '@/api/locations'
import {
  salesOrdersApi,
  type CreateSalesOrderItemPayload,
  type SalesOrderDetail,
  type SalesOrderLocationAvailability,
  type SalesOrderVariantAvailabilityRow,
} from '@/api/salesOrders'
import { variantApi, type VariantItem } from '@/api/variants'
import { useAuthStore } from '@/stores/auth'
import { matchesBarcodeOrSku, normalizeScannedBarcode } from '@/utils/barcodeScanner'
import { formatPrice } from '@/utils/formatters'
import { extractApiError, LOCATION_TYPE_META } from '@/utils/locationMeta'
import { SALES_CHANNEL_OPTIONS } from '@/utils/salesOrderMeta'

interface VariantSearchOption {
  id: string
  label: string
  variant: VariantItem
}

interface OrderItemDraftRow {
  variantId: string
  sku: string
  productName: string
  size: string | null
  colors: string[]
  primaryBarcode: string | null
  imageUrl: string | null
  orderedQuantity: number
  baseNetPrice: number
  unitNetPrice: number
  unitGrossPrice: number
  vatRate: number
  discountPercent: number
  note: string
}

interface SiteOption {
  id: string
  label: string
  type: LocationType
}

const props = defineProps<{
  visible: boolean
  locations?: LocationItem[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'created', order: SalesOrderDetail): void
}>()

const authStore = useAuthStore()
const toast = useToast()

const localLocations = ref<LocationItem[]>([])
const loadingLocations = ref(false)
const submitting = ref(false)
const formError = ref('')

// Rendelés fejléc mezők
const channel = ref<SalesChannel>(SalesChannel.STORE)
const isPickup = ref(false)
const autoSelectLocation = ref(false)
const sourceLocationId = ref('')
const customerName = ref('')
const customerEmail = ref('')
const customerPhone = ref('')
const shippingAddress = ref('')
const externalOrderRef = ref('')
const note = ref('')
const instantComplete = ref(false)

// Tételek és variáns kereső
const rows = ref<OrderItemDraftRow[]>([])
const variantAutocompleteModel = ref<VariantSearchOption | string | null>(null)
const variantSuggestions = ref<VariantSearchOption[]>([])
const searchingVariants = ref(false)

// Telephelyi szabadkészlet térkép (variantId -> row) és automatikus ajánlás
const availabilityByVariant = ref<Record<string, SalesOrderVariantAvailabilityRow>>({})
const recommendedLocationId = ref<string | null>(null)
const recommendationReason = ref<string | null>(null)
const recommendedLocationSummary = ref<SalesOrderLocationAvailability | null>(null)
const loadingAvailability = ref(false)

let latestSearchSeq = 0
let availabilityAbortController: AbortController | null = null

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function defaultChannelForRole(role?: Role | null): SalesChannel {
  if (role === Role.STORE_STAFF || role === Role.STORE_MANAGER) {
    return SalesChannel.STORE
  }
  return SalesChannel.WEBSHOP
}

const effectiveLocations = computed(() =>
  props.locations && props.locations.length > 0 ? props.locations : localLocations.value,
)

const siteOptions = computed<SiteOption[]>(() => {
  const activeSites = effectiveLocations.value.filter(
    (loc) =>
      loc.isActive &&
      (loc.type === LocationType.WAREHOUSE || loc.type === LocationType.STORE),
  )
  const assignedSites = activeSites.filter((loc) => loc.isAssigned !== false)
  const list = assignedSites.length > 0 ? assignedSites : activeSites

  return [...list]
    .sort((a, b) => a.name.localeCompare(b.name, 'hu'))
    .map((loc) => ({
      id: loc.id,
      label: `${loc.name} (${LOCATION_TYPE_META[loc.type].label})`,
      type: loc.type,
    }))
})

const isAutoMode = computed(() => !isPickup.value && autoSelectLocation.value)

const hasTargetSite = computed(() =>
  isAutoMode.value ? Boolean(recommendedLocationId.value) : Boolean(sourceLocationId.value),
)

const hasStockShortage = computed(() => {
  if (!hasTargetSite.value || rows.value.length === 0) return false
  return rows.value.some((row) => {
    const avail = availabilityByVariant.value[row.variantId]
    if (!avail) return false
    return row.orderedQuantity > avail.availableQty
  })
})

const shortageItemsSummary = computed(() => {
  if (!hasTargetSite.value) return []
  return rows.value
    .map((row) => {
      const avail = availabilityByVariant.value[row.variantId]
      if (!avail || row.orderedQuantity <= avail.availableQty) return null
      return {
        sku: row.sku,
        ordered: row.orderedQuantity,
        available: Math.max(0, avail.availableQty),
        missing: row.orderedQuantity - Math.max(0, avail.availableQty),
      }
    })
    .filter(
      (
        entry,
      ): entry is { sku: string; ordered: number; available: number; missing: number } =>
        entry !== null,
    )
})

const totalQuantity = computed(() =>
  rows.value.reduce(
    (sum, r) => sum + (Number.isFinite(r.orderedQuantity) ? Math.max(0, r.orderedQuantity) : 0),
    0,
  ),
)

const totalNetAmount = computed(() =>
  round2(
    rows.value.reduce((sum, r) => {
      const qty = Number.isFinite(r.orderedQuantity) ? Math.max(0, r.orderedQuantity) : 0
      const price = Number.isFinite(r.unitNetPrice) ? Math.max(0, r.unitNetPrice) : 0
      return sum + qty * price
    }, 0),
  ),
)

const totalGrossAmount = computed(() =>
  round2(
    rows.value.reduce((sum, r) => {
      const qty = Number.isFinite(r.orderedQuantity) ? Math.max(0, r.orderedQuantity) : 0
      const price = Number.isFinite(r.unitGrossPrice) ? Math.max(0, r.unitGrossPrice) : 0
      return sum + qty * price
    }, 0),
  ),
)

function getPrimaryBarcode(variant: VariantItem): string | null {
  const list = variant.variantBarcodes ?? []
  return (list.find((b) => b.isPrimary) ?? list[0])?.barcode ?? null
}

function getVariantThumbnail(variant: VariantItem): string | null {
  return variant.imageUrls?.[0] || variant.product?.imageUrls?.[0] || null
}

function formatVariantOptionLabel(v: VariantItem): string {
  const parts: string[] = []
  if (v.product?.name) parts.push(v.product.name)
  parts.push(v.sku)
  const attrs: string[] = []
  if (v.size) attrs.push(v.size)
  if (v.colors?.length) attrs.push(v.colors.join(', '))
  if (attrs.length > 0) parts.push(`(${attrs.join(' · ')})`)
  return parts.join(' · ')
}

function toSearchOption(v: VariantItem): VariantSearchOption {
  return {
    id: v.id,
    label: formatVariantOptionLabel(v),
    variant: v,
  }
}

async function ensureLocationsLoaded() {
  if (props.locations && props.locations.length > 0) return
  if (localLocations.value.length > 0) return
  loadingLocations.value = true
  try {
    const res = await locationApi.getAll()
    localLocations.value = res.data
  } catch {
    // Nem blokkoljuk a modált, a felhasználó üres lista esetén hibajelzést lát
  } finally {
    loadingLocations.value = false
  }
}

function resetForm() {
  formError.value = ''
  const defaultChan = defaultChannelForRole(authStore.user?.role)
  channel.value = defaultChan
  isPickup.value = false
  autoSelectLocation.value = defaultChan === SalesChannel.WEBSHOP
  sourceLocationId.value = siteOptions.value[0]?.id ?? ''
  customerName.value = ''
  customerEmail.value = ''
  customerPhone.value = ''
  shippingAddress.value = ''
  externalOrderRef.value = ''
  note.value = ''
  instantComplete.value = false
  rows.value = []
  variantAutocompleteModel.value = null
  variantSuggestions.value = []
  availabilityByVariant.value = {}
  recommendedLocationId.value = null
  recommendationReason.value = null
  recommendedLocationSummary.value = null
}

watch(
  () => props.visible,
  async (isVisible) => {
    if (isVisible) {
      await ensureLocationsLoaded()
      resetForm()
    }
  },
  { immediate: true },
)

watch(siteOptions, (options) => {
  if (!sourceLocationId.value && options.length > 0) {
    sourceLocationId.value = options[0]!.id
  }
})

watch(channel, (nextChannel) => {
  if (isPickup.value) return
  if (nextChannel === SalesChannel.WEBSHOP) {
    autoSelectLocation.value = true
  } else if (nextChannel === SalesChannel.STORE) {
    autoSelectLocation.value = false
  }
})

watch(isPickup, (pickup) => {
  if (pickup) {
    autoSelectLocation.value = false
    const current = siteOptions.value.find((s) => s.id === sourceLocationId.value)
    if (!current || current.type !== LocationType.STORE) {
      const firstStore = siteOptions.value.find((s) => s.type === LocationType.STORE)
      if (firstStore) {
        sourceLocationId.value = firstStore.id
      }
    }
  }
})

watch([hasStockShortage, isAutoMode], ([shortage, auto]) => {
  if ((shortage || auto) && instantComplete.value) {
    instantComplete.value = false
  }
})

const rowVariantIdsKey = computed(() => rows.value.map((r) => r.variantId).join(','))
const rowQuantitiesKey = computed(() =>
  rows.value.map((r) => `${r.variantId}:${Math.max(1, Math.trunc(r.orderedQuantity) || 1)}`).join(','),
)

watch([sourceLocationId, autoSelectLocation, isPickup, rowVariantIdsKey, rowQuantitiesKey], () => {
  void refreshAvailability()
})

async function refreshAvailability() {
  if (availabilityAbortController) {
    availabilityAbortController.abort()
    availabilityAbortController = null
  }

  const variantIds = rows.value.map((r) => r.variantId)
  if (variantIds.length === 0 || (!isAutoMode.value && !sourceLocationId.value)) {
    availabilityByVariant.value = {}
    recommendedLocationId.value = null
    recommendationReason.value = null
    recommendedLocationSummary.value = null
    loadingAvailability.value = false
    return
  }

  const controller = new AbortController()
  availabilityAbortController = controller
  loadingAvailability.value = true

  try {
    const quantities: Record<string, number> = {}
    for (const r of rows.value) {
      quantities[r.variantId] = Math.max(1, Math.trunc(r.orderedQuantity) || 1)
    }
    const res = await salesOrdersApi.getAvailability(variantIds, quantities, controller.signal)
    recommendedLocationId.value = res.data.recommendedLocationId
    recommendationReason.value = res.data.recommendationReason

    const targetSiteId = isAutoMode.value
      ? res.data.recommendedLocationId
      : sourceLocationId.value
    const siteEntry = targetSiteId
      ? (res.data.locations.find((loc) => loc.locationId === targetSiteId) ?? null)
      : null
    recommendedLocationSummary.value = siteEntry

    const map: Record<string, SalesOrderVariantAvailabilityRow> = {}
    if (siteEntry) {
      for (const v of siteEntry.variants) {
        map[v.variantId] = v
      }
    }
    availabilityByVariant.value = map
  } catch (err) {
    const e = err as { code?: string; name?: string }
    if (e?.code === 'ERR_CANCELED' || e?.name === 'CanceledError' || e?.name === 'AbortError') {
      return
    }
    // Nem blokkoljuk a szerkesztést, ha az élő készletlekérdezés átmenetileg sikertelen
  } finally {
    if (availabilityAbortController === controller) {
      loadingAvailability.value = false
    }
  }
}

async function onVariantSearch(event: AutoCompleteCompleteEvent) {
  const seq = ++latestSearchSeq
  const raw = event.query.trim()
  const normalized = normalizeScannedBarcode(raw)
  const searchQuery =
    !/\s/.test(raw) && /\d/.test(raw) && /[öÖüÜ]/.test(raw) ? normalized : raw

  searchingVariants.value = true
  try {
    const res = await variantApi.getAll({
      search: searchQuery || undefined,
      take: 20,
    })
    if (seq !== latestSearchSeq) return
    variantSuggestions.value = res.data.filter((v) => v.isActive).map(toSearchOption)
  } catch (err) {
    if (seq !== latestSearchSeq) return
    toast.add({
      severity: 'error',
      summary: 'Keresési hiba',
      detail: extractApiError(err, 'Nem sikerült keresni a termékvariánsok között.'),
      life: 4000,
    })
  } finally {
    if (seq === latestSearchSeq) {
      searchingVariants.value = false
    }
  }
}

function addOrIncrementVariant(variant: VariantItem) {
  const existing = rows.value.find((r) => r.variantId === variant.id)
  if (existing) {
    existing.orderedQuantity = Math.max(1, Math.trunc(existing.orderedQuantity || 0) + 1)
    variantAutocompleteModel.value = null
    formError.value = ''
    return
  }

  const parsedVat = Number(variant.product?.vatRate ?? 27)
  const vatRate = Number.isFinite(parsedVat) && parsedVat >= 0 ? round2(parsedVat) : 27
  const parsedNet = Number(variant.netPrice)
  const parsedGross = Number(variant.grossPrice)
  const unitNetPrice = Number.isFinite(parsedNet) && parsedNet >= 0 ? round2(parsedNet) : 0
  const unitGrossPrice =
    Number.isFinite(parsedGross) && parsedGross >= 0
      ? round2(parsedGross)
      : round2(unitNetPrice * (1 + vatRate / 100))

  rows.value.push({
    variantId: variant.id,
    sku: variant.sku,
    productName: variant.product?.name ?? 'Ismeretlen termék',
    size: variant.size ?? null,
    colors: variant.colors ?? [],
    primaryBarcode: getPrimaryBarcode(variant),
    imageUrl: getVariantThumbnail(variant),
    orderedQuantity: 1,
    baseNetPrice: unitNetPrice,
    unitNetPrice,
    unitGrossPrice,
    vatRate,
    discountPercent: 0,
    note: '',
  })

  variantAutocompleteModel.value = null
  variantSuggestions.value = []
  formError.value = ''
}

function onVariantSelected(event: AutoCompleteOptionSelectEvent) {
  const option = event.value as VariantSearchOption | undefined
  if (!option?.variant) return
  addOrIncrementVariant(option.variant)
}

async function onVariantInputEnter(event: KeyboardEvent) {
  const target = event.target as HTMLInputElement | null
  const rawFromModel =
    typeof variantAutocompleteModel.value === 'string' ? variantAutocompleteModel.value : ''
  const raw = (target?.value ?? rawFromModel).trim()
  if (!raw) return

  event.preventDefault()

  // Először nézzük meg a már betöltött találatok közt pontos egyezést
  const currentMatches = variantSuggestions.value.filter((opt) =>
    matchesBarcodeOrSku(raw, opt.variant.sku, opt.variant.variantBarcodes),
  )
  if (currentMatches.length === 1) {
    addOrIncrementVariant(currentMatches[0]!.variant)
    return
  }

  const normalized = normalizeScannedBarcode(raw)
  const searchTerm =
    !/\s/.test(raw) && /\d/.test(raw) && /[öÖüÜ]/.test(raw) ? normalized : raw

  const seq = ++latestSearchSeq
  searchingVariants.value = true
  try {
    const res = await variantApi.getAll({ search: searchTerm, take: 15 })
    if (seq !== latestSearchSeq) return
    const active = res.data.filter((v) => v.isActive)
    const exactMatch =
      active.find((v) => matchesBarcodeOrSku(raw, v.sku, v.variantBarcodes)) ??
      (active.length === 1 ? active[0] : undefined)

    if (exactMatch) {
      addOrIncrementVariant(exactMatch)
    } else if (active.length === 0) {
      toast.add({
        severity: 'warn',
        summary: 'Nincs találat',
        detail: `Nem található aktív variáns a következőre: ${normalized || raw}`,
        life: 3000,
      })
    } else {
      variantSuggestions.value = active.map(toSearchOption)
    }
  } catch (err) {
    if (seq !== latestSearchSeq) return
    toast.add({
      severity: 'error',
      summary: 'Keresési hiba',
      detail: extractApiError(err, 'Nem sikerült keresni a variánst.'),
      life: 4000,
    })
  } finally {
    if (seq === latestSearchSeq) {
      searchingVariants.value = false
    }
  }
}

function onNetPriceChange(row: OrderItemDraftRow) {
  const net = Number.isFinite(row.unitNetPrice) ? Math.max(0, row.unitNetPrice) : 0
  row.unitNetPrice = round2(net)
  const vat = Number.isFinite(row.vatRate) ? Math.max(0, row.vatRate) : 0
  row.unitGrossPrice = round2(row.unitNetPrice * (1 + vat / 100))
}

function onGrossPriceChange(row: OrderItemDraftRow) {
  const gross = Number.isFinite(row.unitGrossPrice) ? Math.max(0, row.unitGrossPrice) : 0
  row.unitGrossPrice = round2(gross)
  const vat = Number.isFinite(row.vatRate) ? Math.max(0, row.vatRate) : 0
  const divisor = 1 + vat / 100
  row.unitNetPrice = divisor > 0 ? round2(row.unitGrossPrice / divisor) : row.unitGrossPrice
}

function onVatRateChange(row: OrderItemDraftRow) {
  const vat = Number.isFinite(row.vatRate) ? Math.min(100, Math.max(0, row.vatRate)) : 0
  row.vatRate = round2(vat)
  row.unitGrossPrice = round2(row.unitNetPrice * (1 + row.vatRate / 100))
}

function onDiscountChange(row: OrderItemDraftRow) {
  const discount = Number.isFinite(row.discountPercent)
    ? Math.min(100, Math.max(0, row.discountPercent))
    : 0
  row.discountPercent = round2(discount)
  const factor = Math.max(0, 1 - row.discountPercent / 100)
  row.unitNetPrice = round2(row.baseNetPrice * factor)
  const vat = Number.isFinite(row.vatRate) ? Math.max(0, row.vatRate) : 0
  row.unitGrossPrice = round2(row.unitNetPrice * (1 + vat / 100))
}

function removeRow(index: number) {
  rows.value.splice(index, 1)
}

function getAvailableQty(variantId: string): number | null {
  const entry = availabilityByVariant.value[variantId]
  return entry ? entry.availableQty : null
}

function validateForm(): string | null {
  if (!isAutoMode.value && !sourceLocationId.value) {
    return isPickup.value
      ? 'Személyes átvételnél az átvételi üzlet / telephely kiválasztása kötelező.'
      : 'Válassz forrás telephelyet a rendeléshez.'
  }
  if (!customerName.value.trim()) {
    return 'A vevő nevének megadása kötelező.'
  }
  if (rows.value.length === 0) {
    return 'Legalább egy termékvariáns hozzáadása kötelező.'
  }
  for (const row of rows.value) {
    if (!Number.isInteger(row.orderedQuantity) || row.orderedQuantity < 1) {
      return `A mennyiség legalább 1 egész szám kell legyen (${row.sku}).`
    }
    if (!Number.isFinite(row.unitNetPrice) || row.unitNetPrice < 0) {
      return `A nettó egységár nem lehet negatív (${row.sku}).`
    }
    if (!Number.isFinite(row.unitGrossPrice) || row.unitGrossPrice < 0) {
      return `A bruttó egységár nem lehet negatív (${row.sku}).`
    }
    if (!Number.isFinite(row.vatRate) || row.vatRate < 0 || row.vatRate > 100) {
      return `Az ÁFA kulcs 0% és 100% között kell legyen (${row.sku}).`
    }
    if (
      !Number.isFinite(row.discountPercent) ||
      row.discountPercent < 0 ||
      row.discountPercent > 100
    ) {
      return `A kedvezmény 0% és 100% között kell legyen (${row.sku}).`
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

  const items: CreateSalesOrderItemPayload[] = rows.value.map((r) => ({
    variantId: r.variantId,
    orderedQuantity: Math.trunc(r.orderedQuantity),
    unitNetPrice: round2(r.unitNetPrice),
    unitGrossPrice: round2(r.unitGrossPrice),
    vatRate: round2(r.vatRate),
    discountPercent: r.discountPercent > 0 ? round2(r.discountPercent) : undefined,
    note: r.note.trim() || undefined,
  }))

  submitting.value = true
  try {
    const res = await salesOrdersApi.create({
      sourceLocationId: isAutoMode.value ? undefined : sourceLocationId.value,
      channel: channel.value,
      isPickup: isPickup.value,
      externalOrderRef: externalOrderRef.value.trim() || undefined,
      customerName: customerName.value.trim(),
      customerEmail: customerEmail.value.trim() || undefined,
      customerPhone: customerPhone.value.trim() || undefined,
      shippingAddress: shippingAddress.value.trim() || undefined,
      note: note.value.trim() || undefined,
      instantComplete:
        !hasStockShortage.value && !isAutoMode.value && instantComplete.value ? true : undefined,
      items,
    })

    toast.add({
      severity: res.data.status === 'ON_HOLD' ? 'warn' : 'success',
      summary:
        res.data.status === 'ON_HOLD'
          ? 'Rendelés rögzítve (ON_HOLD)'
          : res.data.status === 'COMPLETED'
            ? 'Azonnali kiadás teljesítve'
            : 'Rendelés rögzítve',
      detail:
        res.data.status === 'ON_HOLD'
          ? `${res.data.orderNumber} készlethiány miatt felfüggesztve.`
          : `${res.data.orderNumber} sikeresen létrejött.`,
      life: 4500,
    })

    emit('created', res.data)
    emit('update:visible', false)
  } catch (err) {
    const msg = extractApiError(err, 'Nem sikerült létrehozni a rendelést.')
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
  if (availabilityAbortController) {
    availabilityAbortController.abort()
  }
})
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    header="Új vevői rendelés rögzítése"
    :style="{ width: '62rem', maxWidth: '96vw' }"
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

      <!-- Fejadatok (Bento blokk) -->
      <div class="grid grid-cols-1 md:grid-cols-12 gap-3.5 bg-[#f8f9f7] border border-[#e8eae6] rounded-2xl p-4">
        <div class="md:col-span-4">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Értékesítési csatorna <span class="text-rose-500">*</span>
          </label>
          <Select
            v-model="channel"
            :options="SALES_CHANNEL_OPTIONS"
            optionLabel="label"
            optionValue="value"
            class="w-full"
          />
        </div>

        <div class="md:col-span-5">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            <template v-if="isAutoMode">Automatikus telephely-választás</template>
            <template v-else-if="isPickup">
              Átvételi üzlet / telephely <span class="text-rose-500">*</span>
            </template>
            <template v-else>
              Forrás telephely <span class="text-rose-500">*</span>
            </template>
          </label>
          <div
            v-if="isAutoMode"
            class="min-h-10 rounded-xl border px-3 py-2 flex items-center justify-between gap-2 text-xs"
            :class="
              recommendedLocationSummary
                ? recommendedLocationSummary.canFulfillAll
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                  : 'bg-sky-50/70 border-sky-200 text-sky-900'
                : 'bg-white border-[#dce0d8] text-[#686f6a]'
            "
          >
            <div class="min-w-0">
              <p v-if="recommendedLocationSummary" class="font-bold truncate">
                <i class="pi pi-sitemap text-[11px] mr-1"></i>
                Ajánlott: {{ recommendedLocationSummary.locationName }}
              </p>
              <p v-else class="font-medium">
                Központi Raktár / legkevesebb árumozgatás
              </p>
              <p v-if="recommendationReason" class="text-[11px] opacity-90 truncate">
                {{ recommendationReason }}
              </p>
              <p v-else class="text-[11px]">
                Vegyél fel tételt az élő telephely-ajánláshoz.
              </p>
            </div>
            <i v-if="loadingAvailability" class="pi pi-spin pi-spinner text-xs shrink-0"></i>
          </div>
          <Select
            v-else
            v-model="sourceLocationId"
            :options="siteOptions"
            optionLabel="label"
            optionValue="id"
            :loading="loadingLocations"
            placeholder="Válassz telephelyet..."
            class="w-full"
          />
        </div>

        <div class="md:col-span-3">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Külső rendelésszám
          </label>
          <input
            v-model="externalOrderRef"
            type="text"
            placeholder="Pl. WEB-2026-8412"
            class="w-full h-10 bg-white rounded-xl border border-[#dce0d8] px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <div class="md:col-span-4">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Vevő neve <span class="text-rose-500">*</span>
          </label>
          <input
            v-model="customerName"
            type="text"
            required
            placeholder="Pl. Kovács János / Motoros Bt."
            class="w-full h-10 bg-white rounded-xl border border-[#dce0d8] px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <div class="md:col-span-4">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">Telefon</label>
          <input
            v-model="customerPhone"
            type="text"
            placeholder="+36 30 123 4567"
            class="w-full h-10 bg-white rounded-xl border border-[#dce0d8] px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <div class="md:col-span-4">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">Email</label>
          <input
            v-model="customerEmail"
            type="email"
            placeholder="vevo@pelda.hu"
            class="w-full h-10 bg-white rounded-xl border border-[#dce0d8] px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <div class="md:col-span-6">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">Szállítási cím</label>
          <input
            v-model="shippingAddress"
            type="text"
            placeholder="1117 Budapest, Irinyi József utca 4-20."
            class="w-full h-10 bg-white rounded-xl border border-[#dce0d8] px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <div class="md:col-span-6">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">Megjegyzés</label>
          <input
            v-model="note"
            type="text"
            placeholder="Vevői vagy belső csomagolási megjegyzés..."
            class="w-full h-10 bg-white rounded-xl border border-[#dce0d8] px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <!-- Átvétel, automatikus útválasztás és azonnali bolti kiadás kapcsolók -->
        <div
          class="md:col-span-12 pt-2.5 border-t border-[#e8eae6] space-y-2.5"
        >
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="flex items-center gap-3 bg-white border border-[#e8eae6] rounded-xl px-3 py-2">
              <ToggleSwitch v-model="isPickup" inputId="isPickupSwitch" />
              <label for="isPickupSwitch" class="cursor-pointer select-none">
                <span class="text-xs font-semibold text-[#171918] block">
                  Személyes bolti átvétel (Click & Collect)
                </span>
                <span class="text-[11px] text-[#686f6a]">
                  A vevő a választott üzletben veszi át a rendelést (nincs átirányítás).
                </span>
              </label>
            </div>

            <div
              class="flex items-center gap-3 bg-white border border-[#e8eae6] rounded-xl px-3 py-2"
              :class="isPickup ? 'opacity-50' : ''"
            >
              <ToggleSwitch
                v-model="autoSelectLocation"
                inputId="autoSelectLocationSwitch"
                :disabled="isPickup"
              />
              <label for="autoSelectLocationSwitch" class="cursor-pointer select-none">
                <span class="text-xs font-semibold text-[#171918] block">
                  Automatikus telephely-választás
                </span>
                <span class="text-[11px] text-[#686f6a]">
                  Prioritás és legkevesebb árumozgatás alapján (split nélkül).
                </span>
              </label>
            </div>
          </div>

          <div class="flex flex-wrap items-center justify-between gap-3 pt-1">
            <div class="flex items-center gap-3">
              <ToggleSwitch
                v-model="instantComplete"
                inputId="instantCompleteSwitch"
                :disabled="hasStockShortage || isAutoMode || !sourceLocationId"
              />
              <label for="instantCompleteSwitch" class="cursor-pointer select-none">
                <span class="text-xs font-semibold text-[#171918] block">
                  Azonnali bolti kiadás (polcról azonnal levonva)
                </span>
                <span class="text-[11px] text-[#686f6a]">
                  Kiszedési feladat nélkül, rögtön <span class="font-semibold">Teljesítve</span> állapotba zárja a rendelést és levonja a polckészletet.
                </span>
              </label>
            </div>
            <span
              v-if="hasStockShortage || isAutoMode"
              class="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg"
            >
              {{ isAutoMode ? 'Automatikus választásnál letiltva' : 'Készlethiány miatt letiltva' }}
            </span>
          </div>
        </div>
      </div>

      <!-- Variáns kereső (AutoComplete + Enteres gyors vonalkód) -->
      <div class="space-y-1.5">
        <label class="block text-xs font-semibold text-[#686f6a]">
          Tétel hozzáadása (SKU, terméknév vagy vonalkód — Enterre pontos találat azonnal hozzáadódik)
        </label>
        <AutoComplete
          v-model="variantAutocompleteModel"
          :suggestions="variantSuggestions"
          optionLabel="label"
          dataKey="id"
          :delay="300"
          :minLength="1"
          :loading="searchingVariants"
          placeholder="Olvasd be a vonalkódot vagy írj be SKU-t / terméknevet..."
          class="w-full"
          inputClass="w-full h-10 rounded-xl border border-[#dce0d8] bg-white px-3.5 text-sm text-[#171918]"
          @complete="onVariantSearch"
          @item-select="onVariantSelected"
          @keydown.enter="onVariantInputEnter"
        >
          <template #option="{ option }: { option: VariantSearchOption }">
            <div class="flex items-center justify-between gap-3 py-1">
              <div class="min-w-0">
                <p class="text-xs font-semibold text-[#171918] truncate">
                  {{ option.variant.product?.name ?? 'Ismeretlen termék' }}
                </p>
                <div class="flex flex-wrap items-center gap-2 text-[11px] text-[#686f6a] mt-0.5">
                  <span class="font-mono font-semibold text-[#171918]">
                    {{ option.variant.sku }}
                  </span>
                  <span v-if="option.variant.size" class="bg-[#eff1ed] px-1.5 py-0.5 rounded">
                    {{ option.variant.size }}
                  </span>
                  <span v-if="option.variant.colors.length > 0">
                    {{ option.variant.colors.join(', ') }}
                  </span>
                  <span v-if="getPrimaryBarcode(option.variant)" class="font-mono">
                    · {{ getPrimaryBarcode(option.variant) }}
                  </span>
                </div>
              </div>
              <span class="text-xs font-semibold text-[#171918] shrink-0">
                {{ formatPrice(option.variant.grossPrice) }}
              </span>
            </div>
          </template>
        </AutoComplete>
      </div>

      <!-- Készlethiány figyelmeztető sáv -->
      <div
        v-if="hasStockShortage"
        class="bg-amber-50 border border-amber-300 text-amber-900 rounded-2xl p-3.5 flex items-start gap-3 text-xs"
      >
        <i class="pi pi-exclamation-triangle text-amber-600 text-base mt-0.5 shrink-0"></i>
        <div class="space-y-1">
          <p class="font-bold">
            Készlethiány ezen a telephelyen: rögzítéskor a rendelés <code>ON_HOLD</code> állapotba kerül, csak a szabad mennyiség foglalódik le.
          </p>
          <p class="text-amber-800">
            Hiányzó tételek:
            <span v-for="(s, i) in shortageItemsSummary" :key="s.sku" class="font-mono font-semibold">
              {{ i > 0 ? ', ' : '' }}{{ s.sku }} (szabad: {{ s.available }} db, kért: {{ s.ordered }} db)
            </span>
          </p>
        </div>
      </div>

      <!-- Tételek táblázata -->
      <div class="border border-[#e8eae6] rounded-2xl overflow-hidden bg-white">
        <div class="bg-[#f8f9f7] px-4 py-2.5 border-b border-[#e8eae6] flex items-center justify-between">
          <span class="text-xs font-semibold text-[#171918]">
            Rendelési tételek ({{ rows.length }} sor · {{ totalQuantity }} db)
          </span>
          <span v-if="loadingAvailability" class="text-[11px] text-[#686f6a] flex items-center gap-1.5">
            <i class="pi pi-spin pi-spinner text-[11px]"></i>
            Szabadkészlet ellenőrzése...
          </span>
        </div>

        <div v-if="rows.length === 0" class="py-10 text-center text-xs text-[#686f6a]">
          Használd a fenti keresőt vagy vonalkód-szkennert a tételek felvételéhez.
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="bg-[#eff1ed] text-[#686f6a] text-[11px]">
                <th class="py-2 px-3 font-medium">Termék & SKU</th>
                <th class="py-2 px-2.5 font-medium text-center w-24">Szabad</th>
                <th class="py-2 px-2.5 font-medium w-20">Db</th>
                <th class="py-2 px-2.5 font-medium w-28">Nettó (Ft)</th>
                <th class="py-2 px-2.5 font-medium w-28">Bruttó (Ft)</th>
                <th class="py-2 px-2.5 font-medium w-16">ÁFA %</th>
                <th class="py-2 px-2.5 font-medium w-20">Kedv. %</th>
                <th class="py-2 px-3 font-medium text-right w-28">Sor összesen</th>
                <th class="py-2 px-2 font-medium text-right w-10"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#eff1ed]">
              <tr
                v-for="(row, idx) in rows"
                :key="row.variantId"
                :class="
                  getAvailableQty(row.variantId) !== null &&
                  row.orderedQuantity > (getAvailableQty(row.variantId) ?? 0)
                    ? 'bg-amber-50/50'
                    : 'hover:bg-[#fafbf9]'
                "
              >
                <td class="py-2.5 px-3 align-top">
                  <div class="flex items-start gap-2.5">
                    <img
                      v-if="row.imageUrl"
                      :src="row.imageUrl"
                      :alt="row.productName"
                      class="w-9 h-9 rounded-lg object-cover border border-[#e8eae6] shrink-0"
                    />
                    <div class="min-w-0">
                      <p class="font-semibold text-[#171918] leading-snug">{{ row.productName }}</p>
                      <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-[#686f6a] mt-0.5">
                        <span class="font-mono font-semibold text-[#171918]">{{ row.sku }}</span>
                        <span v-if="row.size" class="bg-[#eff1ed] px-1.5 py-0.5 rounded">
                          {{ row.size }}
                        </span>
                        <span v-if="row.colors.length > 0">{{ row.colors.join(', ') }}</span>
                      </div>
                    </div>
                  </div>
                </td>

                <td class="py-2.5 px-2.5 align-top text-center">
                  <template v-if="getAvailableQty(row.variantId) !== null">
                    <span
                      :class="[
                        'inline-flex items-center px-2 py-0.5 rounded-md font-semibold text-[11px]',
                        row.orderedQuantity <= (getAvailableQty(row.variantId) ?? 0)
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-amber-100 text-amber-800 border border-amber-300',
                      ]"
                    >
                      {{ getAvailableQty(row.variantId) }} db
                    </span>
                  </template>
                  <span v-else class="text-[#686f6a]">—</span>
                </td>

                <td class="py-2.5 px-2.5 align-top">
                  <input
                    v-model.number="row.orderedQuantity"
                    type="number"
                    min="1"
                    step="1"
                    required
                    class="w-full h-8 rounded-lg border border-[#dce0d8] px-2 text-xs font-semibold outline-none focus:border-[#f46714]"
                  />
                </td>

                <td class="py-2.5 px-2.5 align-top">
                  <input
                    v-model.number="row.unitNetPrice"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    @change="onNetPriceChange(row)"
                    class="w-full h-8 rounded-lg border border-[#dce0d8] px-2 text-xs font-semibold outline-none focus:border-[#f46714]"
                  />
                </td>

                <td class="py-2.5 px-2.5 align-top">
                  <input
                    v-model.number="row.unitGrossPrice"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    @change="onGrossPriceChange(row)"
                    class="w-full h-8 rounded-lg border border-[#dce0d8] px-2 text-xs font-semibold outline-none focus:border-[#f46714]"
                  />
                </td>

                <td class="py-2.5 px-2.5 align-top">
                  <input
                    v-model.number="row.vatRate"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    @change="onVatRateChange(row)"
                    class="w-full h-8 rounded-lg border border-[#dce0d8] px-1.5 text-xs outline-none focus:border-[#f46714]"
                  />
                </td>

                <td class="py-2.5 px-2.5 align-top">
                  <input
                    v-model.number="row.discountPercent"
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    @change="onDiscountChange(row)"
                    class="w-full h-8 rounded-lg border border-[#dce0d8] px-1.5 text-xs outline-none focus:border-[#f46714]"
                  />
                </td>

                <td class="py-2.5 px-3 align-top text-right whitespace-nowrap">
                  <p class="font-bold text-[#171918]">
                    {{ formatPrice((row.orderedQuantity || 0) * (row.unitGrossPrice || 0)) }}
                  </p>
                  <p class="text-[10px] text-[#686f6a]">
                    nettó: {{ formatPrice((row.orderedQuantity || 0) * (row.unitNetPrice || 0)) }}
                  </p>
                </td>

                <td class="py-2.5 px-2 align-top text-right">
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
          class="bg-[#f8f9f7] px-4 py-3 border-t border-[#e8eae6] flex flex-wrap items-center justify-end gap-5 text-xs"
        >
          <span class="text-[#686f6a]">
            Nettó összesen:
            <strong class="text-[#171918] ml-1">{{ formatPrice(totalNetAmount) }}</strong>
          </span>
          <span class="text-[#686f6a]">
            Bruttó végösszeg:
            <strong class="text-sm text-[#171918] ml-1">{{ formatPrice(totalGrossAmount) }}</strong>
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
          :disabled="submitting || rows.length === 0"
          class="h-10 px-5 rounded-xl bg-[#171918] hover:bg-[#2a2d2b] text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 transition"
        >
          <i v-if="submitting" class="pi pi-spin pi-spinner text-xs"></i>
          <span>
            {{
              !hasStockShortage && !isAutoMode && instantComplete
                ? 'Rögzítés és azonnali kiadás'
                : 'Rendelés rögzítése'
            }}
          </span>
        </button>
      </div>
    </form>
  </Dialog>
</template>
