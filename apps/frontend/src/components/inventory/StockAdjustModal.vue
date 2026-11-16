<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { LocationType, MovementType, SlotMode } from '@wmanager/shared-types'
import type { LocationItem } from '@/api/locations'
import { productApi, type ProductListItem } from '@/api/products'
import { stockApi, type AdjustStockResult } from '@/api/stock'
import { variantApi, type VariantBarcodeItem, type VariantItem } from '@/api/variants'
import { extractApiError, getLocationPath, LOCATION_TYPE_META } from '@/utils/locationMeta'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'

type WizardStep = 1 | 2 | 3
type LocationTypeFilter =
  | 'ALL'
  | LocationType.BIN
  | LocationType.SHELF
  | LocationType.ZONE
  | 'ROOT'

interface EnrichedLocation {
  location: LocationItem
  pathLabel: string
  typeLabel: string
  badgeClass: string
  icon: string
  isDedicated: boolean
  searchHaystack: string
}

const props = defineProps<{
  visible: boolean
  initialLocationId?: string | null
  initialVariantId?: string | null
  allLocations: LocationItem[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'saved', result: AdjustStockResult): void
}>()

const toast = useToast()

const step = ref<WizardStep>(1)
const operationType = ref<MovementType.INITIAL_STOCK | MovementType.MANUAL_CORRECTION>(
  MovementType.INITIAL_STOCK,
)
const selectedLocationId = ref('')
const selectedVariant = ref<VariantItem | null>(null)
const loadingInitialVariant = ref(false)
const correctionDirection = ref<1 | -1>(1)
const quantityInput = ref<number | null>(null)
const note = ref('')

const variantSearchInput = ref('')
const variantResults = ref<VariantItem[]>([])
const loadingVariants = ref(false)
const variantSearchInputEl = ref<HTMLInputElement | null>(null)

const locationSearchInput = ref('')
const locationTypeFilter = ref<LocationTypeFilter>('ALL')
const locationSearchInputEl = ref<HTMLInputElement | null>(null)

const submitting = ref(false)
const productCache = ref<Record<string, ProductListItem>>({})

let variantSearchTimer: ReturnType<typeof setTimeout> | null = null
let latestVariantSearchSeq = 0
let latestInitialVariantSeq = 0

const wizardSteps: { step: WizardStep; title: string }[] = [
  { step: 1, title: 'Termékvariáns' },
  { step: 2, title: 'Pozíció' },
  { step: 3, title: 'Mennyiség & Mentés' },
]

const locationTypeFilterOptions: { value: LocationTypeFilter; label: string }[] = [
  { value: 'ALL', label: 'Összes' },
  { value: LocationType.BIN, label: 'Rekesz (BIN)' },
  { value: LocationType.SHELF, label: 'Polc (SHELF)' },
  { value: LocationType.ZONE, label: 'Zóna' },
  { value: 'ROOT', label: 'Raktár/Üzlet' },
]

const locationById = computed(() => new Map(props.allLocations.map((l) => [l.id, l])))

const activeLocations = computed<EnrichedLocation[]>(() => {
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
        isDedicated: loc.slotMode === SlotMode.DEDICATED,
        searchHaystack: [pathLabel, loc.name, loc.description ?? '', meta.label]
          .join(' ')
          .toLowerCase(),
      }
    })
    .sort((a, b) => a.pathLabel.localeCompare(b.pathLabel, 'hu', { numeric: true }))
})

const filteredLocations = computed<EnrichedLocation[]>(() => {
  const tokens = locationSearchInput.value
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  return activeLocations.value.filter((item) => {
    const type = item.location.type
    if (locationTypeFilter.value === 'ROOT') {
      if (type !== LocationType.WAREHOUSE && type !== LocationType.STORE) return false
    } else if (locationTypeFilter.value !== 'ALL') {
      if (type !== locationTypeFilter.value) return false
    }

    if (tokens.length > 0 && !tokens.every((t) => item.searchHaystack.includes(t))) {
      return false
    }
    return true
  })
})

const selectedLocationEntry = computed<EnrichedLocation | null>(() => {
  if (!selectedLocationId.value) return null
  return activeLocations.value.find((item) => item.location.id === selectedLocationId.value) ?? null
})

const isDedicatedLocation = computed(
  () => selectedLocationEntry.value?.isDedicated ?? false,
)

const computedQuantityChange = computed<number>(() => {
  if (quantityInput.value === null || Number.isNaN(quantityInput.value)) return 0
  const raw = Math.trunc(quantityInput.value)
  if (raw === 0) return 0
  if (operationType.value === MovementType.INITIAL_STOCK) {
    return Math.abs(raw)
  }
  if (raw < 0) return raw
  return correctionDirection.value * raw
})

const canSubmit = computed(() => {
  return (
    step.value === 3 &&
    Boolean(selectedLocationId.value) &&
    Boolean(selectedVariant.value) &&
    computedQuantityChange.value !== 0 &&
    !submitting.value
  )
})

function isStepCompleted(targetStep: WizardStep): boolean {
  if (targetStep === 1) return Boolean(selectedVariant.value) && step.value !== 1
  if (targetStep === 2) return Boolean(selectedLocationId.value) && step.value !== 2
  return false
}

function canAccessStep(targetStep: WizardStep): boolean {
  if (targetStep === 1) return true
  if (targetStep === 2) return Boolean(selectedVariant.value)
  return Boolean(selectedVariant.value) && Boolean(selectedLocationId.value)
}

function goToStep(targetStep: WizardStep) {
  if (!canAccessStep(targetStep)) return
  step.value = targetStep
}

function getPrimaryBarcode(variant: VariantItem): VariantBarcodeItem | undefined {
  const list = variant.variantBarcodes ?? []
  return list.find((b) => b.isPrimary) ?? list[0]
}

function getProductName(productId: string): string {
  return productCache.value[productId]?.name ?? 'Termék betöltése...'
}

async function hydrateProductNames(variants: VariantItem[]) {
  const missingIds = Array.from(
    new Set(variants.map((v) => v.productId).filter((id) => !productCache.value[id])),
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

async function searchVariants(searchText: string, autoSelectExact = false) {
  const seq = ++latestVariantSearchSeq
  loadingVariants.value = true
  try {
    const trimmed = searchText.trim()
    const res = await variantApi.getAll({
      search: trimmed || undefined,
      take: 25,
    })
    if (seq !== latestVariantSearchSeq) return

    variantResults.value = res.data
    void hydrateProductNames(res.data)

    if (autoSelectExact && trimmed && res.data.length > 0) {
      const lower = trimmed.toLowerCase()
      const exactMatch =
        res.data.find((v) => v.variantBarcodes?.some((b) => b.barcode === trimmed)) ??
        res.data.find((v) => v.sku.toLowerCase() === lower) ??
        (res.data.length === 1 ? res.data[0] : undefined)

      if (exactMatch) {
        selectedVariant.value = exactMatch
      }
    }
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
    await hydrateProductNames([res.data])
  } catch (err) {
    if (seq !== latestInitialVariantSeq || !props.visible) return
    toast.add({
      severity: 'error',
      summary: 'Variáns hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a kiválasztott variánst.'),
      life: 4000,
    })
    if (step.value > 1) {
      step.value = 1
    }
  } finally {
    if (seq === latestInitialVariantSeq) {
      loadingInitialVariant.value = false
    }
  }
}

function triggerImmediateVariantSearch() {
  if (variantSearchTimer) clearTimeout(variantSearchTimer)
  void searchVariants(variantSearchInput.value, true)
}

function selectVariantAndAdvance(variant: VariantItem) {
  selectedVariant.value = variant
  step.value = 2
}

function selectLocationAndAdvance(locationId: string) {
  selectedLocationId.value = locationId
  if (selectedVariant.value) {
    step.value = 3
  }
}

function handleLocationSearchEnter() {
  const firstMatch = filteredLocations.value[0]
  if (filteredLocations.value.length === 1 && firstMatch) {
    selectedLocationId.value = firstMatch.location.id
  }
}

function addQuickQuantity(delta: number) {
  const current =
    quantityInput.value !== null && !Number.isNaN(quantityInput.value)
      ? Math.max(0, Math.trunc(quantityInput.value))
      : 0
  quantityInput.value = current + delta
}

watch(variantSearchInput, (val) => {
  if (!props.visible) return
  if (variantSearchTimer) clearTimeout(variantSearchTimer)
  variantSearchTimer = setTimeout(() => {
    void searchVariants(val, false)
  }, 300)
})

watch(operationType, (nextType) => {
  if (nextType === MovementType.INITIAL_STOCK) {
    correctionDirection.value = 1
    if (quantityInput.value !== null && quantityInput.value < 0) {
      quantityInput.value = Math.abs(quantityInput.value)
    }
  }
})

watch(step, (nextStep) => {
  if (!props.visible) return
  void nextTick(() => {
    if (nextStep === 1) {
      variantSearchInputEl.value?.focus()
    } else if (nextStep === 2) {
      locationSearchInputEl.value?.focus()
    }
  })
})

watch(
  () => props.visible,
  (isOpen) => {
    if (!isOpen) {
      if (variantSearchTimer) clearTimeout(variantSearchTimer)
      return
    }

    correctionDirection.value = 1
    quantityInput.value = null
    note.value = ''
    variantSearchInput.value = ''
    locationSearchInput.value = ''
    locationTypeFilter.value = 'ALL'
    selectedVariant.value = null
    loadingInitialVariant.value = false

    const hasValidInitialLocation = Boolean(
      props.initialLocationId &&
        props.allLocations.some(
          (l) => l.id === props.initialLocationId && l.isActive && l.isAssigned !== false,
        ),
    )
    selectedLocationId.value =
      hasValidInitialLocation && props.initialLocationId ? props.initialLocationId : ''

    const hasInitialVariant = Boolean(props.initialVariantId)

    if (hasInitialVariant && hasValidInitialLocation) {
      operationType.value = MovementType.MANUAL_CORRECTION
      step.value = 3
    } else if (hasInitialVariant) {
      operationType.value = MovementType.INITIAL_STOCK
      step.value = 2
    } else {
      operationType.value = MovementType.INITIAL_STOCK
      step.value = 1
    }

    if (props.initialVariantId) {
      void loadInitialVariant(props.initialVariantId)
    }
    void searchVariants('', false)

    void nextTick(() => {
      if (step.value === 1) {
        variantSearchInputEl.value?.focus()
      } else if (step.value === 2) {
        locationSearchInputEl.value?.focus()
      }
    })
  },
  { immediate: true },
)

function closeModal() {
  emit('update:visible', false)
}

async function handleSubmit() {
  if (step.value !== 3) return

  if (!selectedVariant.value) {
    toast.add({
      severity: 'warn',
      summary: 'Hiányzó variáns',
      detail: 'Válassz ki egy termékvariánst a listából.',
      life: 4000,
    })
    step.value = 1
    return
  }

  if (!selectedLocationId.value) {
    toast.add({
      severity: 'warn',
      summary: 'Hiányzó pozíció',
      detail: 'Válassz ki egy aktív raktári vagy bolti pozíciót.',
      life: 4000,
    })
    step.value = 2
    return
  }

  const quantityChange = computedQuantityChange.value
  if (!Number.isInteger(quantityChange) || quantityChange === 0) {
    toast.add({
      severity: 'warn',
      summary: 'Érvénytelen mennyiség',
      detail: 'A mennyiség változásának 0-tól eltérő egész számnak kell lennie.',
      life: 4000,
    })
    return
  }

  if (operationType.value === MovementType.INITIAL_STOCK && quantityChange < 0) {
    toast.add({
      severity: 'warn',
      summary: 'Érvénytelen mennyiség',
      detail: 'Kezdeti készletfelvitelnél csak pozitív mennyiség adható meg.',
      life: 4000,
    })
    return
  }

  submitting.value = true
  try {
    const res = await stockApi.adjust({
      variantId: selectedVariant.value.id,
      locationId: selectedLocationId.value,
      quantityChange,
      type: operationType.value,
      note: note.value.trim() || undefined,
    })

    const signedStr = quantityChange > 0 ? `+${quantityChange}` : `${quantityChange}`
    toast.add({
      severity: 'success',
      summary: 'Készlet rögzítve',
      detail: `${selectedVariant.value.sku} (${signedStr} db) sikeresen elmentve.`,
      life: 4000,
    })
    emit('saved', res.data)
    closeModal()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Készletmódosítási hiba',
      detail: extractApiError(err, 'Nem sikerült rögzíteni a készletmozgást.'),
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
    header="Készlet felvitele / korrekció"
    :style="{ width: '42rem', maxWidth: '96vw' }"
  >
    <form class="space-y-4 pt-1" @submit.prevent="handleSubmit">
      <!-- Felső 3 lépéses Stepper -->
      <nav
        aria-label="Készletművelet lépései"
        class="grid grid-cols-3 gap-2 rounded-[12px] bg-[#f8f9f7] border border-[#e5e8e1] p-1.5"
      >
        <button
          v-for="item in wizardSteps"
          :key="item.step"
          type="button"
          :disabled="!canAccessStep(item.step)"
          @click="goToStep(item.step)"
          class="flex items-center gap-2 rounded-[9px] px-2.5 py-2 text-left transition"
          :class="[
            step === item.step
              ? 'bg-[#171918] text-white shadow-xs'
              : isStepCompleted(item.step)
                ? 'bg-white text-[#171918] border border-[#e2e5df] hover:border-[#171918] cursor-pointer'
                : canAccessStep(item.step)
                  ? 'text-[#171918] hover:bg-white cursor-pointer'
                  : 'text-[#9aa197] opacity-65 cursor-not-allowed',
          ]"
        >
          <span
            class="size-5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0"
            :class="[
              step === item.step
                ? 'bg-[#f46714] text-white'
                : isStepCompleted(item.step)
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#e7eae4] text-[#4c534e]',
            ]"
          >
            <i v-if="isStepCompleted(item.step)" class="pi pi-check text-[10px]"></i>
            <span v-else>{{ item.step }}</span>
          </span>
          <span class="text-xs font-semibold truncate">{{ item.title }}</span>
        </button>
      </nav>

      <!-- 1. LÉPÉS: Termékvariáns kiválasztása -->
      <div v-if="step === 1" class="space-y-3">
        <div
          v-if="selectedLocationEntry"
          class="flex items-center justify-between gap-2 rounded-[10px] bg-[#f8f9f7] border border-[#e5e8e1] px-3 py-2 text-[11px] text-[#4c534e]"
        >
          <div class="flex items-center gap-2 min-w-0">
            <i class="pi pi-map-marker text-[#f46714] text-xs shrink-0"></i>
            <span class="truncate">
              Előválasztott pozíció:
              <strong class="text-[#171918]">{{ selectedLocationEntry.pathLabel }}</strong>
            </span>
          </div>
          <span
            :class="[
              'text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0',
              selectedLocationEntry.badgeClass,
            ]"
          >
            {{ selectedLocationEntry.typeLabel }}
          </span>
        </div>

        <div class="space-y-1.5">
          <div class="flex items-center justify-between gap-2">
            <label class="block text-xs font-semibold text-[#171918]">
              Termékvariáns keresése (vonalkód, SKU vagy terméknév)
            </label>
            <span v-if="loadingVariants" class="text-[11px] text-[#686f6a] flex items-center gap-1">
              <i class="pi pi-spin pi-spinner text-[11px]"></i> Keresés...
            </span>
          </div>

          <div class="relative">
            <i class="pi pi-barcode absolute left-3 top-1/2 -translate-y-1/2 text-[#686f6a] text-sm"></i>
            <input
              ref="variantSearchInputEl"
              v-model="variantSearchInput"
              type="text"
              placeholder="Csippants vonalkódot vagy írj SKU-t / terméknevet (Enter = azonnali keresés)..."
              @keydown.enter.prevent="triggerImmediateVariantSearch"
              class="w-full h-[40px] rounded-[10px] border border-[#dce0d8] bg-white pl-9 pr-9 text-xs text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]"
            />
            <button
              v-if="variantSearchInput"
              type="button"
              @click="variantSearchInput = ''"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 size-6 rounded-md text-[#686f6a] hover:text-[#171918] hover:bg-[#eff1ed] flex items-center justify-center cursor-pointer"
              title="Keresés törlése"
            >
              <i class="pi pi-times text-[11px]"></i>
            </button>
          </div>
        </div>

        <div class="max-h-[260px] overflow-y-auto rounded-[11px] border border-[#e5e8e1] bg-[#f8f9f7] divide-y divide-[#eceee9]">
          <div
            v-if="!loadingVariants && variantResults.length === 0"
            class="py-8 text-center text-xs text-[#686f6a]"
          >
            Nincs a keresésnek megfelelő variáns.
          </div>

          <div
            v-for="variant in variantResults"
            :key="variant.id"
            role="button"
            tabindex="0"
            @click="selectedVariant = variant"
            @dblclick="selectVariantAndAdvance(variant)"
            @keydown.enter.prevent="selectVariantAndAdvance(variant)"
            class="px-3.5 py-2.5 transition flex items-center justify-between gap-3 cursor-pointer outline-none"
            :class="
              selectedVariant?.id === variant.id
                ? 'bg-orange-50/90 ring-1 ring-inset ring-[#f46714]/40'
                : 'hover:bg-white'
            "
          >
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-xs font-semibold text-[#171918] truncate">
                  {{ getProductName(variant.productId) }}
                </span>
                <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#eff1ed] text-[#171918] shrink-0">
                  {{ variant.size }}
                </span>
                <span
                  v-if="variant.colors.length > 0"
                  class="text-[11px] text-[#686f6a] truncate"
                >
                  {{ variant.colors.join(', ') }}
                </span>
              </div>
              <div class="flex flex-wrap items-center gap-x-3 text-[11px] text-[#686f6a] mt-0.5">
                <span class="font-mono font-medium text-[#171918]">{{ variant.sku }}</span>
                <span v-if="getPrimaryBarcode(variant)" class="font-mono">
                  EAN: {{ getPrimaryBarcode(variant)?.barcode }}
                </span>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <i
                v-if="selectedVariant?.id === variant.id"
                class="pi pi-check-circle text-[#f46714] text-sm"
              ></i>
              <button
                type="button"
                @click.stop="selectVariantAndAdvance(variant)"
                class="h-[28px] px-2.5 rounded-[8px] border text-[11px] font-semibold transition cursor-pointer"
                :class="
                  selectedVariant?.id === variant.id
                    ? 'bg-[#171918] border-[#171918] text-white'
                    : 'bg-white border-[#dce0d8] text-[#171918] hover:border-[#171918]'
                "
              >
                Kiválasztás
              </button>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 pt-2 border-t border-[#eceee9]">
          <button
            type="button"
            @click="closeModal"
            class="h-[38px] px-4 rounded-[10px] bg-white border border-[#dce0d8] text-xs font-medium text-[#171918] cursor-pointer hover:bg-[#f8f9f7]"
          >
            Mégse
          </button>
          <button
            type="button"
            :disabled="!selectedVariant"
            @click="goToStep(2)"
            class="h-[38px] px-4 rounded-[10px] bg-[#171918] hover:bg-[#2a2d2b] disabled:opacity-45 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
          >
            <span>Tovább a pozícióhoz</span>
            <i class="pi pi-arrow-right text-[11px]"></i>
          </button>
        </div>
      </div>

      <!-- 2. LÉPÉS: Pozíció (Lokáció) kiválasztása -->
      <div v-else-if="step === 2" class="space-y-3">
        <!-- Kiválasztott variáns pill -->
        <div
          class="flex items-center justify-between gap-3 rounded-[10px] bg-[#f8f9f7] border border-[#e5e8e1] px-3 py-2"
        >
          <div v-if="loadingInitialVariant && !selectedVariant" class="flex items-center gap-2 text-xs text-[#686f6a]">
            <i class="pi pi-spin pi-spinner text-xs"></i>
            <span>Variáns betöltése...</span>
          </div>
          <div v-else-if="selectedVariant" class="flex items-center gap-2 min-w-0 flex-wrap">
            <span class="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-emerald-600 text-white shrink-0">
              Variáns
            </span>
            <span class="text-xs font-semibold text-[#171918] truncate">
              {{ getProductName(selectedVariant.productId) }}
            </span>
            <span class="text-[11px] font-mono text-[#4c534e] shrink-0">
              {{ selectedVariant.sku }}
            </span>
            <span class="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#eff1ed] text-[#171918] shrink-0">
              {{ selectedVariant.size }}
            </span>
          </div>
          <button
            type="button"
            @click="step = 1"
            class="text-[11px] font-semibold text-[#f46714] hover:underline shrink-0 cursor-pointer"
          >
            Módosítás
          </button>
        </div>

        <!-- Kereső és típus szűrő pillek -->
        <div class="space-y-2">
          <div class="relative">
            <i class="pi pi-search absolute left-3 top-1/2 -translate-y-1/2 text-[#686f6a] text-xs"></i>
            <input
              ref="locationSearchInputEl"
              v-model="locationSearchInput"
              type="text"
              placeholder="Pozíció keresése név vagy útvonal alapján (pl. Központi, A-01)..."
              @keydown.enter.prevent="handleLocationSearchEnter"
              class="w-full h-[38px] rounded-[10px] border border-[#dce0d8] bg-white pl-8 pr-9 text-xs text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]"
            />
            <button
              v-if="locationSearchInput"
              type="button"
              @click="locationSearchInput = ''"
              class="absolute right-2.5 top-1/2 -translate-y-1/2 size-6 rounded-md text-[#686f6a] hover:text-[#171918] hover:bg-[#eff1ed] flex items-center justify-center cursor-pointer"
              title="Keresés törlése"
            >
              <i class="pi pi-times text-[11px]"></i>
            </button>
          </div>

          <div class="flex flex-wrap items-center gap-1.5">
            <button
              v-for="opt in locationTypeFilterOptions"
              :key="opt.value"
              type="button"
              @click="locationTypeFilter = opt.value"
              class="h-[28px] px-2.5 rounded-full text-[11px] font-semibold transition cursor-pointer border"
              :class="
                locationTypeFilter === opt.value
                  ? 'bg-[#171918] border-[#171918] text-white'
                  : 'bg-[#f8f9f7] border-[#e2e5df] text-[#4c534e] hover:bg-white hover:text-[#171918]'
              "
            >
              {{ opt.label }}
            </button>
          </div>
        </div>

        <!-- Aktív pozíciók listája -->
        <div class="max-h-[240px] overflow-y-auto rounded-[11px] border border-[#e5e8e1] bg-[#f8f9f7] divide-y divide-[#eceee9]">
          <div
            v-if="filteredLocations.length === 0"
            class="py-8 text-center text-xs text-[#686f6a]"
          >
            Nincs a szűrésnek megfelelő aktív pozíció.
          </div>

          <div
            v-for="item in filteredLocations"
            :key="item.location.id"
            role="button"
            tabindex="0"
            @click="selectedLocationId = item.location.id"
            @dblclick="selectLocationAndAdvance(item.location.id)"
            @keydown.enter.prevent="selectLocationAndAdvance(item.location.id)"
            class="px-3.5 py-2.5 transition flex items-center justify-between gap-3 cursor-pointer outline-none"
            :class="
              selectedLocationId === item.location.id
                ? 'bg-orange-50/90 ring-1 ring-inset ring-[#f46714]/40'
                : 'hover:bg-white'
            "
          >
            <div class="min-w-0 flex-1 space-y-1">
              <div class="flex items-center gap-2">
                <i :class="[item.icon, 'text-xs text-[#686f6a] shrink-0']"></i>
                <span class="text-xs font-semibold text-[#171918] truncate">
                  {{ item.pathLabel }}
                </span>
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <span
                  :class="[
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                    item.badgeClass,
                  ]"
                >
                  {{ item.typeLabel }}
                </span>
                <span
                  v-if="item.isDedicated"
                  class="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200"
                >
                  <i class="pi pi-exclamation-triangle text-[9px] text-amber-600"></i>
                  DEDICATED
                </span>
              </div>
            </div>

            <div class="flex items-center gap-2 shrink-0">
              <i
                v-if="selectedLocationId === item.location.id"
                class="pi pi-check-circle text-[#f46714] text-sm"
              ></i>
              <button
                type="button"
                @click.stop="selectLocationAndAdvance(item.location.id)"
                class="h-[28px] px-2.5 rounded-[8px] border text-[11px] font-semibold transition cursor-pointer"
                :class="
                  selectedLocationId === item.location.id
                    ? 'bg-[#171918] border-[#171918] text-white'
                    : 'bg-white border-[#dce0d8] text-[#171918] hover:border-[#171918]'
                "
              >
                Kiválasztás
              </button>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between gap-2 pt-2 border-t border-[#eceee9]">
          <button
            type="button"
            @click="step = 1"
            class="h-[38px] px-4 rounded-[10px] bg-white border border-[#dce0d8] text-xs font-medium text-[#171918] flex items-center gap-1.5 cursor-pointer hover:bg-[#f8f9f7]"
          >
            <i class="pi pi-arrow-left text-[11px]"></i>
            <span>Vissza</span>
          </button>
          <button
            type="button"
            :disabled="!selectedLocationId"
            @click="goToStep(3)"
            class="h-[38px] px-4 rounded-[10px] bg-[#171918] hover:bg-[#2a2d2b] disabled:opacity-45 text-white text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition"
          >
            <span>Tovább a mennyiséghez</span>
            <i class="pi pi-arrow-right text-[11px]"></i>
          </button>
        </div>
      </div>

      <!-- 3. LÉPÉS: Művelet, mennyiség és rögzítés -->
      <div v-else class="space-y-4">
        <!-- Összefoglaló kártyák -->
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <!-- Kiválasztott variáns -->
          <div class="rounded-[11px] border border-[#e5e8e1] bg-[#f8f9f7] px-3.5 py-2.5 flex flex-col justify-between gap-1.5">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10px] font-bold uppercase tracking-wide text-[#686f6a]">
                Kiválasztott variáns
              </span>
              <button
                type="button"
                @click="step = 1"
                class="text-[11px] font-semibold text-[#f46714] hover:underline cursor-pointer"
              >
                Csere
              </button>
            </div>

            <div v-if="loadingInitialVariant && !selectedVariant" class="flex items-center gap-2 text-xs text-[#686f6a] py-1">
              <i class="pi pi-spin pi-spinner text-xs"></i>
              <span>Variáns betöltése...</span>
            </div>
            <div v-else-if="selectedVariant" class="min-w-0">
              <p class="text-xs font-semibold text-[#171918] truncate">
                {{ getProductName(selectedVariant.productId) }}
              </p>
              <p class="text-[11px] text-[#4c534e] mt-0.5 truncate">
                <span class="font-mono font-semibold text-[#171918]">{{ selectedVariant.sku }}</span>
                <span> · </span>
                <strong>{{ selectedVariant.size }}</strong>
                <span v-if="selectedVariant.colors.length > 0">
                  · {{ selectedVariant.colors.join(', ') }}
                </span>
              </p>
            </div>
          </div>

          <!-- Célpozíció -->
          <div class="rounded-[11px] border border-[#e5e8e1] bg-[#f8f9f7] px-3.5 py-2.5 flex flex-col justify-between gap-1.5">
            <div class="flex items-center justify-between gap-2">
              <span class="text-[10px] font-bold uppercase tracking-wide text-[#686f6a]">
                Célpozíció
              </span>
              <button
                type="button"
                @click="step = 2"
                class="text-[11px] font-semibold text-[#f46714] hover:underline cursor-pointer"
              >
                Csere
              </button>
            </div>

            <div v-if="selectedLocationEntry" class="min-w-0 space-y-1">
              <p class="text-xs font-semibold text-[#171918] truncate">
                {{ selectedLocationEntry.pathLabel }}
              </p>
              <div class="flex flex-wrap items-center gap-1.5">
                <span
                  :class="[
                    'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                    selectedLocationEntry.badgeClass,
                  ]"
                >
                  {{ selectedLocationEntry.typeLabel }}
                </span>
                <span
                  v-if="isDedicatedLocation"
                  class="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200"
                >
                  <i class="pi pi-exclamation-triangle text-[9px] text-amber-600"></i>
                  DEDICATED
                </span>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="isDedicatedLocation"
          class="flex items-center gap-2 rounded-[10px] bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] font-medium text-amber-800"
        >
          <i class="pi pi-exclamation-triangle text-amber-600 text-xs shrink-0"></i>
          <span>Dedikált tárhely: csak 1 variáns tárolható rajta</span>
        </div>

        <!-- Művelet típusa -->
        <div class="space-y-1.5">
          <label class="block text-xs font-semibold text-[#171918]">Művelet típusa</label>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              @click="operationType = MovementType.INITIAL_STOCK"
              class="rounded-[11px] border px-3 py-2.5 text-left transition cursor-pointer"
              :class="
                operationType === MovementType.INITIAL_STOCK
                  ? 'bg-[#171918] border-[#171918] text-white shadow-xs'
                  : 'bg-[#f8f9f7] border-[#e2e5df] text-[#171918] hover:bg-white'
              "
            >
              <div class="flex items-center gap-2 text-xs font-semibold">
                <i class="pi pi-plus-circle text-xs"></i>
                <span>Kezdeti készletfelvitel</span>
              </div>
              <p
                class="text-[11px] mt-0.5"
                :class="operationType === MovementType.INITIAL_STOCK ? 'text-white/75' : 'text-[#686f6a]'"
              >
                Nyitó vagy új készlet rögzítése pozitív darabszámmal.
              </p>
            </button>

            <button
              type="button"
              @click="operationType = MovementType.MANUAL_CORRECTION"
              class="rounded-[11px] border px-3 py-2.5 text-left transition cursor-pointer"
              :class="
                operationType === MovementType.MANUAL_CORRECTION
                  ? 'bg-[#171918] border-[#171918] text-white shadow-xs'
                  : 'bg-[#f8f9f7] border-[#e2e5df] text-[#171918] hover:bg-white'
              "
            >
              <div class="flex items-center gap-2 text-xs font-semibold">
                <i class="pi pi-sliders-h text-xs"></i>
                <span>Kézi korrekció</span>
              </div>
              <p
                class="text-[11px] mt-0.5"
                :class="operationType === MovementType.MANUAL_CORRECTION ? 'text-white/75' : 'text-[#686f6a]'"
              >
                Mennyiség növelése vagy csökkentése (pl. sérülés, eltérés).
              </p>
            </button>
          </div>
        </div>

        <!-- Mennyiség -->
        <div class="space-y-1.5">
          <div class="flex items-center justify-between">
            <label class="block text-xs font-semibold text-[#171918]">
              {{
                operationType === MovementType.INITIAL_STOCK
                  ? 'Felvitt mennyiség (db)'
                  : 'Korrekciós mennyiség (db)'
              }}
            </label>
            <span
              v-if="computedQuantityChange !== 0"
              class="text-xs font-bold"
              :class="computedQuantityChange > 0 ? 'text-emerald-700' : 'text-rose-600'"
            >
              Változás: {{ computedQuantityChange > 0 ? `+${computedQuantityChange}` : computedQuantityChange }} db
            </span>
          </div>

          <div class="flex flex-wrap items-center gap-2">
            <div
              v-if="operationType === MovementType.MANUAL_CORRECTION"
              class="inline-flex rounded-[10px] border border-[#dce0d8] bg-[#f8f9f7] p-0.5"
            >
              <button
                type="button"
                @click="correctionDirection = 1"
                class="h-[34px] px-3 rounded-[8px] text-xs font-semibold transition cursor-pointer"
                :class="
                  correctionDirection === 1
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'text-[#686f6a] hover:text-[#171918]'
                "
              >
                + Növelés
              </button>
              <button
                type="button"
                @click="correctionDirection = -1"
                class="h-[34px] px-3 rounded-[8px] text-xs font-semibold transition cursor-pointer"
                :class="
                  correctionDirection === -1
                    ? 'bg-rose-600 text-white shadow-2xs'
                    : 'text-[#686f6a] hover:text-[#171918]'
                "
              >
                - Csökkentés
              </button>
            </div>

            <input
              v-model.number="quantityInput"
              type="number"
              :min="operationType === MovementType.INITIAL_STOCK ? 1 : undefined"
              step="1"
              placeholder="Pl. 5"
              class="w-32 h-[40px] rounded-[10px] border border-[#dce0d8] bg-white px-3 text-sm font-semibold text-[#171918] outline-none focus:border-[#f46714]"
            />

            <div class="flex items-center gap-1.5">
              <button
                v-for="quickStep in [1, 5, 10]"
                :key="quickStep"
                type="button"
                @click="addQuickQuantity(quickStep)"
                class="h-[40px] px-3 rounded-[10px] bg-[#eff1ed] hover:bg-[#171918] text-[#171918] hover:text-white text-xs font-semibold transition cursor-pointer"
              >
                +{{ quickStep }}
              </button>
            </div>
          </div>
        </div>

        <!-- Megjegyzés -->
        <div class="space-y-1.5">
          <label class="block text-xs font-semibold text-[#171918]">Megjegyzés (opcionális)</label>
          <input
            v-model="note"
            type="text"
            placeholder="Pl. Nyitó készlet betöltése vagy sérült csomagolás leírása..."
            class="w-full h-[40px] rounded-[10px] border border-[#dce0d8] bg-white px-3 text-xs text-[#171918] placeholder-[#686f6a] outline-none focus:border-[#f46714]"
          />
        </div>

        <!-- Lábléc -->
        <div class="flex items-center justify-between gap-2 pt-2 border-t border-[#eceee9]">
          <button
            type="button"
            @click="step = 2"
            class="h-[38px] px-4 rounded-[10px] bg-white border border-[#dce0d8] text-xs font-medium text-[#171918] flex items-center gap-1.5 cursor-pointer hover:bg-[#f8f9f7]"
          >
            <i class="pi pi-arrow-left text-[11px]"></i>
            <span>Vissza</span>
          </button>

          <button
            type="submit"
            :disabled="!canSubmit"
            class="h-[38px] px-5 rounded-[10px] bg-[#171918] hover:bg-[#2a2d2b] disabled:opacity-45 text-white text-xs font-semibold flex items-center gap-2 cursor-pointer transition"
          >
            <i v-if="submitting" class="pi pi-spin pi-spinner text-xs"></i>
            <span>Készletmozgás rögzítése</span>
          </button>
        </div>
      </div>
    </form>
  </Dialog>
</template>
