<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { LocationItem } from '@/api/locations'
import { productApi, type ProductListItem } from '@/api/products'
import { stockApi, type StockReportEntry } from '@/api/stock'
import { variantApi, type VariantBarcodeItem, type VariantItem } from '@/api/variants'
import { extractApiError, getLocationPath, LOCATION_TYPE_META } from '@/utils/locationMeta'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'

const props = defineProps<{
  visible: boolean
  initialVariantId?: string | null
  initialLocationId?: string | null
  initialExpectedQty?: number | null
  allLocations: LocationItem[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'saved', report: StockReportEntry): void
}>()

const toast = useToast()

const QUICK_REASONS = [
  'Nem található a polcon',
  'Kevesebb darab van a polcon',
  'Sérült / selejtes termék',
  'Más méret / szín volt a helyén',
] as const

const selectedVariant = ref<VariantItem | null>(null)
const isEditingVariant = ref(false)
const loadingInitialVariant = ref(false)
const variantSearchInput = ref('')
const variantResults = ref<VariantItem[]>([])
const loadingVariants = ref(false)

const selectedLocationId = ref('')
const isEditingLocation = ref(false)
const locationSearchInput = ref('')

const expectedQuantity = ref<number | null>(null)
const loadingExpectedQty = ref(false)
const foundQuantity = ref<number>(0)
const reason = ref('')
const submitting = ref(false)

const productCache = ref<Record<string, ProductListItem>>({})

let variantSearchTimer: ReturnType<typeof setTimeout> | null = null
let latestVariantSearchSeq = 0
let latestInitialVariantSeq = 0
let latestExpectedQtySeq = 0

const locationById = computed(() => new Map(props.allLocations.map((l) => [l.id, l])))

const activeAssignedLocations = computed(() => {
  return props.allLocations
    .filter((loc) => loc.isActive && loc.isAssigned !== false)
    .map((loc) => {
      const pathNames = getLocationPath(loc.id, locationById.value).map((p) => p.name)
      const pathLabel = pathNames.length > 0 ? pathNames.join(' › ') : loc.name
      const meta = LOCATION_TYPE_META[loc.type]
      return {
        location: loc,
        pathLabel,
        typeLabel: meta.label,
        badgeClass: meta.badgeClass,
        icon: meta.icon,
        searchHaystack: `${pathLabel} ${loc.name} ${loc.description ?? ''} ${meta.label}`.toLowerCase(),
      }
    })
    .sort((a, b) => a.pathLabel.localeCompare(b.pathLabel, 'hu', { numeric: true }))
})

const filteredLocations = computed(() => {
  const tokens = locationSearchInput.value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
  if (tokens.length === 0) return activeAssignedLocations.value
  return activeAssignedLocations.value.filter((item) =>
    tokens.every((t) => item.searchHaystack.includes(t)),
  )
})

const selectedLocationEntry = computed(() => {
  if (!selectedLocationId.value) return null
  return activeAssignedLocations.value.find((item) => item.location.id === selectedLocationId.value) ?? null
})

const canSubmit = computed(() => {
  return (
    Boolean(selectedVariant.value) &&
    Boolean(selectedLocationId.value) &&
    Number.isInteger(foundQuantity.value) &&
    foundQuantity.value >= 0 &&
    reason.value.trim().length > 0 &&
    !submitting.value
  )
})

function getPrimaryBarcode(variant: VariantItem): VariantBarcodeItem | undefined {
  const list = variant.variantBarcodes ?? []
  return list.find((b) => b.isPrimary) ?? list[0]
}

function getProductName(variant: VariantItem): string {
  return variant.product?.name ?? productCache.value[variant.productId]?.name ?? 'Termék'
}

async function hydrateProductNames(variants: VariantItem[]) {
  const missingIds = Array.from(
    new Set(
      variants
        .filter((v) => !v.product?.name && !productCache.value[v.productId])
        .map((v) => v.productId),
    ),
  )
  if (missingIds.length === 0) return

  const settled = await Promise.allSettled(missingIds.map((id) => productApi.getOne(id)))
  const nextCache = { ...productCache.value }
  for (const res of settled) {
    if (res.status === 'fulfilled') {
      nextCache[res.value.data.id] = res.value.data
    }
  }
  productCache.value = nextCache
}

async function searchVariants(searchText: string) {
  const seq = ++latestVariantSearchSeq
  loadingVariants.value = true
  try {
    const res = await variantApi.getAll({
      search: searchText.trim() || undefined,
      take: 20,
    })
    if (seq !== latestVariantSearchSeq) return
    variantResults.value = res.data
    void hydrateProductNames(res.data)
  } catch (err) {
    if (seq !== latestVariantSearchSeq) return
    toast.add({
      severity: 'error',
      summary: 'Keresési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a variánsokat.'),
      life: 4000,
    })
  } finally {
    if (seq === latestVariantSearchSeq) {
      loadingVariants.value = false
    }
  }
}

async function loadInitialVariant(variantId: string) {
  const seq = ++latestInitialVariantSeq
  loadingInitialVariant.value = true
  try {
    const res = await variantApi.getOne(variantId)
    if (seq !== latestInitialVariantSeq || !props.visible) return
    selectedVariant.value = res.data
    isEditingVariant.value = false
    await hydrateProductNames([res.data])
  } catch (err) {
    if (seq !== latestInitialVariantSeq || !props.visible) return
    isEditingVariant.value = true
    toast.add({
      severity: 'error',
      summary: 'Variáns hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a kiválasztott variánst.'),
      life: 4000,
    })
  } finally {
    if (seq === latestInitialVariantSeq) {
      loadingInitialVariant.value = false
    }
  }
}

async function refreshExpectedQuantity(variantId: string, locationId: string) {
  const seq = ++latestExpectedQtySeq
  loadingExpectedQty.value = true
  try {
    const res = await stockApi.getAll({ variantId, locationId, take: 1 })
    if (seq !== latestExpectedQtySeq || !props.visible) return
    const match = res.data.items.find(
      (i) => i.variantId === variantId && i.locationId === locationId && !i.isExternalLocation,
    )
    expectedQuantity.value = match ? match.quantity : 0
  } catch {
    if (seq === latestExpectedQtySeq) {
      expectedQuantity.value = null
    }
  } finally {
    if (seq === latestExpectedQtySeq) {
      loadingExpectedQty.value = false
    }
  }
}

function selectVariant(variant: VariantItem) {
  selectedVariant.value = variant
  isEditingVariant.value = false
}

function selectLocation(locationId: string) {
  selectedLocationId.value = locationId
  isEditingLocation.value = false
}

function triggerImmediateVariantSearch() {
  if (variantSearchTimer) clearTimeout(variantSearchTimer)
  void searchVariants(variantSearchInput.value)
}

watch(variantSearchInput, (val) => {
  if (!props.visible || !isEditingVariant.value) return
  if (variantSearchTimer) clearTimeout(variantSearchTimer)
  variantSearchTimer = setTimeout(() => {
    void searchVariants(val)
  }, 300)
})

watch([() => selectedVariant.value?.id, selectedLocationId], ([vId, lId]) => {
  if (!props.visible || !vId || !lId) {
    expectedQuantity.value = null
    return
  }
  if (
    props.initialExpectedQty !== undefined &&
    props.initialExpectedQty !== null &&
    vId === props.initialVariantId &&
    lId === props.initialLocationId
  ) {
    expectedQuantity.value = props.initialExpectedQty
    return
  }
  void refreshExpectedQuantity(vId, lId)
})

watch(
  () => props.visible,
  (isOpen) => {
    if (!isOpen) {
      if (variantSearchTimer) clearTimeout(variantSearchTimer)
      return
    }

    selectedVariant.value = null
    variantSearchInput.value = ''
    locationSearchInput.value = ''
    foundQuantity.value = 0
    reason.value = ''
    expectedQuantity.value = null

    const hasValidInitialLocation = Boolean(
      props.initialLocationId &&
        props.allLocations.some(
          (l) => l.id === props.initialLocationId && l.isActive && l.isAssigned !== false,
        ),
    )
    selectedLocationId.value =
      hasValidInitialLocation && props.initialLocationId ? props.initialLocationId : ''
    isEditingLocation.value = !hasValidInitialLocation

    if (props.initialVariantId) {
      isEditingVariant.value = false
      void loadInitialVariant(props.initialVariantId)
    } else {
      isEditingVariant.value = true
      void searchVariants('')
    }

    if (
      props.initialVariantId &&
      hasValidInitialLocation &&
      props.initialExpectedQty !== undefined &&
      props.initialExpectedQty !== null
    ) {
      expectedQuantity.value = props.initialExpectedQty
    }
  },
  { immediate: true },
)

function openVariantPicker() {
  isEditingVariant.value = true
  if (variantResults.value.length === 0) {
    void searchVariants(variantSearchInput.value)
  }
}

function closeModal() {
  emit('update:visible', false)
}

async function handleSubmit() {
  if (!selectedVariant.value) {
    toast.add({
      severity: 'warn',
      summary: 'Hiányzó variáns',
      detail: 'Válassz ki egy termékvariánst.',
      life: 4000,
    })
    return
  }
  if (!selectedLocationId.value) {
    toast.add({
      severity: 'warn',
      summary: 'Hiányzó pozíció',
      detail: 'Válassz ki egy aktív saját pozíciót.',
      life: 4000,
    })
    return
  }
  const qty = Math.trunc(Number(foundQuantity.value))
  if (!Number.isInteger(qty) || qty < 0) {
    toast.add({
      severity: 'warn',
      summary: 'Érvénytelen mennyiség',
      detail: 'A talált mennyiség 0 vagy pozitív egész szám lehet.',
      life: 4000,
    })
    return
  }
  const trimmedReason = reason.value.trim()
  if (!trimmedReason) {
    toast.add({
      severity: 'warn',
      summary: 'Hiányzó indoklás',
      detail: 'Add meg az eltérés vagy hiány okát.',
      life: 4000,
    })
    return
  }

  submitting.value = true
  try {
    const res = await stockApi.createReport({
      variantId: selectedVariant.value.id,
      locationId: selectedLocationId.value,
      foundQuantity: qty,
      reason: trimmedReason,
    })
    toast.add({
      severity: 'success',
      summary: 'Eltérés-jelentés elküldve',
      detail: `${selectedVariant.value.sku} jelentése rögzítve, vezetői jóváhagyásra vár.`,
      life: 4500,
    })
    emit('saved', res.data)
    closeModal()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Beküldési hiba',
      detail: extractApiError(err, 'Nem sikerült elküldeni a hiány/eltérés-jelentést.'),
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
    @update:visible="(v) => emit('update:visible', v)"
    modal
    header="Hiány / Eltérés jelentése"
    :style="{ width: '38rem', maxWidth: '96vw' }"
  >
    <form class="space-y-4 pt-1" @submit.prevent="handleSubmit">
      <!-- Figyelmeztető tájékoztató -->
      <div class="flex items-start gap-2.5 rounded-[11px] bg-amber-50 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-900">
        <i class="pi pi-exclamation-triangle text-amber-600 mt-0.5 shrink-0"></i>
        <p class="leading-relaxed">
          Ha a polcon nem található a várt termék vagy eltérő a darabszám, itt jelentheted. A jelentés jóváhagyásig nem módosítja automatikusan a készletet.
        </p>
      </div>

      <!-- 1. Termékvariáns -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <label class="block text-xs font-semibold text-[#171918]">Termékvariáns *</label>
          <button
            v-if="selectedVariant && !isEditingVariant"
            type="button"
            @click="openVariantPicker"
            class="text-[11px] font-semibold text-[#f46714] hover:underline cursor-pointer"
          >
            Csere
          </button>
        </div>

        <div
          v-if="loadingInitialVariant && !selectedVariant"
          class="rounded-[10px] border border-[#e5e8e1] bg-[#f8f9f7] px-3 py-2.5 flex items-center gap-2 text-xs text-[#686f6a]"
        >
          <i class="pi pi-spin pi-spinner text-xs"></i>
          <span>Variáns betöltése...</span>
        </div>

        <div
          v-else-if="selectedVariant && !isEditingVariant"
          class="rounded-[11px] border border-[#e5e8e1] bg-[#f8f9f7] px-3.5 py-2.5"
        >
          <p class="text-xs font-semibold text-[#171918] truncate">
            {{ getProductName(selectedVariant) }}
          </p>
          <div class="flex flex-wrap items-center gap-2 text-[11px] text-[#4c534e] mt-0.5">
            <span class="font-mono font-semibold text-[#171918]">{{ selectedVariant.sku }}</span>
            <span
              v-if="selectedVariant.size"
              class="bg-[#eff1ed] text-[#171918] font-semibold px-1.5 py-0.5 rounded"
            >
              {{ selectedVariant.size }}
            </span>
            <span v-if="selectedVariant.colors.length > 0">
              {{ selectedVariant.colors.join(', ') }}
            </span>
            <span v-if="getPrimaryBarcode(selectedVariant)" class="font-mono text-[#686f6a]">
              EAN: {{ getPrimaryBarcode(selectedVariant)?.barcode }}
            </span>
          </div>
        </div>

        <div v-else class="space-y-2">
          <div class="relative">
            <i class="pi pi-barcode absolute left-3 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"></i>
            <input
              v-model="variantSearchInput"
              type="text"
              placeholder="Keresés név, SKU vagy vonalkód alapján..."
              @keydown.enter.prevent="triggerImmediateVariantSearch"
              class="w-full h-[38px] rounded-[10px] border border-[#dce0d8] bg-white pl-8 pr-8 text-xs text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]"
            />
            <i
              v-if="loadingVariants"
              class="pi pi-spin pi-spinner absolute right-3 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"
            ></i>
          </div>

          <div class="max-h-[170px] overflow-y-auto rounded-[10px] border border-[#e5e8e1] bg-[#f8f9f7] divide-y divide-[#eceee9]">
            <div v-if="!loadingVariants && variantResults.length === 0" class="py-5 text-center text-xs text-[#686f6a]">
              Nincs találat.
            </div>
            <button
              v-for="v in variantResults"
              :key="v.id"
              type="button"
              @click="selectVariant(v)"
              class="w-full px-3 py-2 text-left hover:bg-white transition flex items-center justify-between gap-2 cursor-pointer"
              :class="selectedVariant?.id === v.id ? 'bg-orange-50' : ''"
            >
              <div class="min-w-0">
                <p class="text-xs font-semibold text-[#171918] truncate">{{ getProductName(v) }}</p>
                <p class="text-[11px] text-[#686f6a] truncate">
                  <span class="font-mono font-medium text-[#171918]">{{ v.sku }}</span>
                  <span v-if="v.size">· {{ v.size }}</span>
                  <span v-if="v.colors.length > 0">· {{ v.colors.join(', ') }}</span>
                </p>
              </div>
              <i v-if="selectedVariant?.id === v.id" class="pi pi-check-circle text-[#f46714] text-xs shrink-0"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- 2. Pozíció -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <label class="block text-xs font-semibold text-[#171918]">Pozíció *</label>
          <button
            v-if="selectedLocationEntry && !isEditingLocation"
            type="button"
            @click="isEditingLocation = true"
            class="text-[11px] font-semibold text-[#f46714] hover:underline cursor-pointer"
          >
            Csere
          </button>
        </div>

        <div
          v-if="selectedLocationEntry && !isEditingLocation"
          class="rounded-[11px] border border-[#e5e8e1] bg-[#f8f9f7] px-3.5 py-2.5 flex items-center justify-between gap-2"
        >
          <div class="min-w-0 flex items-center gap-2">
            <i :class="[selectedLocationEntry.icon, 'text-xs text-[#686f6a] shrink-0']"></i>
            <span class="text-xs font-semibold text-[#171918] truncate">
              {{ selectedLocationEntry.pathLabel }}
            </span>
          </div>
          <span :class="['text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0', selectedLocationEntry.badgeClass]">
            {{ selectedLocationEntry.typeLabel }}
          </span>
        </div>

        <div v-else class="space-y-2">
          <div class="relative">
            <i class="pi pi-search absolute left-3 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"></i>
            <input
              v-model="locationSearchInput"
              type="text"
              placeholder="Saját pozíció keresése (pl. A-01)..."
              class="w-full h-[38px] rounded-[10px] border border-[#dce0d8] bg-white pl-8 pr-3 text-xs text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]"
            />
          </div>

          <div class="max-h-[160px] overflow-y-auto rounded-[10px] border border-[#e5e8e1] bg-[#f8f9f7] divide-y divide-[#eceee9]">
            <div v-if="filteredLocations.length === 0" class="py-5 text-center text-xs text-[#686f6a]">
              Nincs a szűrésnek megfelelő aktív saját pozíció.
            </div>
            <button
              v-for="item in filteredLocations"
              :key="item.location.id"
              type="button"
              @click="selectLocation(item.location.id)"
              class="w-full px-3 py-2 text-left hover:bg-white transition flex items-center justify-between gap-2 cursor-pointer"
              :class="selectedLocationId === item.location.id ? 'bg-orange-50' : ''"
            >
              <div class="min-w-0 flex items-center gap-2">
                <i :class="[item.icon, 'text-xs text-[#686f6a] shrink-0']"></i>
                <span class="text-xs font-medium text-[#171918] truncate">{{ item.pathLabel }}</span>
              </div>
              <span :class="['text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0', item.badgeClass]">
                {{ item.typeLabel }}
              </span>
            </button>
          </div>
        </div>
      </div>

      <!-- 3. Talált valós mennyiség -->
      <div class="space-y-1.5">
        <div class="flex items-center justify-between gap-2">
          <label class="block text-xs font-semibold text-[#171918]">
            Talált valós mennyiség (db) *
          </label>
          <span v-if="loadingExpectedQty" class="text-[11px] text-[#686f6a]">
            Rendszerkészlet ellenőrzése...
          </span>
          <span
            v-else-if="expectedQuantity !== null"
            class="text-[11px] font-medium text-[#4c534e]"
          >
            Várt készlet a rendszerben: <strong class="text-[#171918]">{{ expectedQuantity }} db</strong>
          </span>
        </div>

        <div class="flex items-center gap-2">
          <input
            v-model.number="foundQuantity"
            type="number"
            min="0"
            step="1"
            class="w-32 h-[40px] rounded-[10px] border border-[#dce0d8] bg-white px-3 text-sm font-semibold text-[#171918] outline-none focus:border-[#f46714]"
          />
          <button
            type="button"
            @click="foundQuantity = 0"
            class="h-[40px] px-3 rounded-[10px] border text-xs font-semibold transition cursor-pointer"
            :class="
              foundQuantity === 0
                ? 'bg-[#171918] border-[#171918] text-white'
                : 'bg-[#eff1ed] border-transparent text-[#171918] hover:bg-white hover:border-[#dce0d8]'
            "
          >
            0 db (Teljes hiány)
          </button>
        </div>
      </div>

      <!-- 4. Gyors indoklás chipek + szöveges ok -->
      <div class="space-y-2">
        <label class="block text-xs font-semibold text-[#171918]">Eltérés oka *</label>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="chip in QUICK_REASONS"
            :key="chip"
            type="button"
            @click="reason = chip"
            class="px-2.5 py-1.5 rounded-full text-[11px] font-medium border transition cursor-pointer"
            :class="
              reason === chip
                ? 'bg-[#171918] border-[#171918] text-white'
                : 'bg-[#f8f9f7] border-[#e2e5df] text-[#4c534e] hover:bg-white hover:text-[#171918]'
            "
          >
            {{ chip }}
          </button>
        </div>

        <input
          v-model="reason"
          type="text"
          maxlength="1000"
          placeholder="Írd le röviden az eltérés okát..."
          class="w-full h-[40px] rounded-[10px] border border-[#dce0d8] bg-white px-3 text-xs text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]"
        />
      </div>

      <!-- Lábléc -->
      <div class="flex items-center justify-end gap-2 pt-2 border-t border-[#eceee9]">
        <button
          type="button"
          @click="closeModal"
          class="h-[38px] px-4 rounded-[10px] bg-white border border-[#dce0d8] text-xs font-medium text-[#171918] cursor-pointer hover:bg-[#f8f9f7]"
        >
          Mégse
        </button>
        <button
          type="submit"
          :disabled="!canSubmit"
          class="h-[38px] px-4 rounded-[10px] bg-[#f46714] hover:bg-[#dc590d] disabled:opacity-45 text-white text-xs font-semibold flex items-center gap-2 cursor-pointer transition"
        >
          <i v-if="submitting" class="pi pi-spin pi-spinner text-xs"></i>
          <i v-else class="pi pi-exclamation-triangle text-xs"></i>
          <span>Jelentés beküldése</span>
        </button>
      </div>
    </form>
  </Dialog>
</template>
