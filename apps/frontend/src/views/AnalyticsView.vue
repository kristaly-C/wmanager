<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { variantApi, type VariantItem } from '@/api/variants'
import {
  variantSuppliersApi,
  type VariantMonthlyStatItem,
  type VariantPurchaseHistoryEntry,
  type VariantPurchaseHistoryResponse,
  type VariantSupplierItem,
} from '@/api/variantSuppliers'
import {
  salesOrdersApi,
  type VariantSalesHistoryItem,
  type VariantSalesHistoryResponse,
  type VariantSalesMonthlyStat,
} from '@/api/salesOrders'
import { extractApiError } from '@/utils/locationMeta'
import { formatDateTime, formatPrice, formatSignedQuantity } from '@/utils/formatters'
import { canSeeCostPrice, formatCurrency } from '@/utils/procurementMeta'
import { SALES_CHANNEL_META } from '@/utils/salesOrderMeta'
import PageHeader from '@/components/common/PageHeader.vue'
import StatKpiCard from '@/components/common/StatKpiCard.vue'
import VariantSuppliersModal, {
  type VariantSupplierTarget,
} from '@/components/catalog/VariantSuppliersModal.vue'
import AutoComplete, {
  type AutoCompleteCompleteEvent,
  type AutoCompleteOptionSelectEvent,
} from 'primevue/autocomplete'
import Column from 'primevue/column'
import DataTable, { type DataTablePageEvent } from 'primevue/datatable'
import { useToast } from 'primevue/usetoast'

type AnalyticsTab = 'purchase-analytics' | 'sales-margin'

interface AnalyticsTabConfig {
  id: AnalyticsTab
  label: string
  icon: string
  disabled?: boolean
  badge?: string
}

interface VariantSearchOption {
  id: string
  label: string
  variant: VariantItem
}

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const toast = useToast()

const canViewCost = computed(() => canSeeCostPrice(authStore.user?.role))

function readQueryTab(): AnalyticsTab {
  const raw = route.query.tab
  const value =
    typeof raw === 'string'
      ? raw.trim()
      : Array.isArray(raw) && typeof raw[0] === 'string'
        ? raw[0].trim()
        : ''
  return value === 'sales-margin' ? 'sales-margin' : 'purchase-analytics'
}

const activeTab = ref<AnalyticsTab>(readQueryTab())
const tabs: AnalyticsTabConfig[] = [
  {
    id: 'purchase-analytics',
    label: 'Beszerzési ártörténet & Statisztika',
    icon: 'pi pi-chart-line',
  },
  {
    id: 'sales-margin',
    label: 'Értékesítés & Árrés',
    icon: 'pi pi-percentage',
    disabled: false,
  },
]

// Variáns kereső / választó állapota
const variantAutocompleteModel = ref<VariantSearchOption | string | null>(null)
const variantSuggestions = ref<VariantSearchOption[]>([])
const quickVariants = ref<VariantItem[]>([])
const searchingVariants = ref(false)

// Kiválasztott variáns adatai (Beszerzési ártörténet)
const selectedVariant = ref<VariantItem | null>(null)
const historyData = ref<VariantPurchaseHistoryResponse | null>(null)
const variantSuppliers = ref<VariantSupplierItem[]>([])
const loadingAnalytics = ref(false)
const loadError = ref<string | null>(null)

// Kiválasztott variáns adatai (Értékesítés & Árrés)
const salesHistoryData = ref<VariantSalesHistoryResponse | null>(null)
const loadingSalesAnalytics = ref(false)
const salesLoadError = ref<string | null>(null)
const salesPage = ref(0)
const salesRows = 20

// Beszállítók modal
const isSuppliersModalOpen = ref(false)

let latestSearchSeq = 0
let latestLoadSeq = 0
let latestSalesSeq = 0

function formatVariantOptionLabel(v: VariantItem): string {
  const parts: string[] = []
  if (v.product?.name) parts.push(v.product.name)
  parts.push(v.sku)
  const detailParts: string[] = []
  if (v.size) detailParts.push(v.size)
  if (v.colors?.length) detailParts.push(v.colors.join(', '))
  if (detailParts.length > 0) parts.push(`(${detailParts.join(' · ')})`)
  return parts.join(' · ')
}

function toSearchOption(v: VariantItem): VariantSearchOption {
  return {
    id: v.id,
    label: formatVariantOptionLabel(v),
    variant: v,
  }
}

function getPrimaryBarcode(v: VariantItem): string | null {
  const list = v.variantBarcodes ?? []
  return (list.find((b) => b.isPrimary) ?? list[0])?.barcode ?? null
}

function getVariantThumbnail(v: VariantItem): string | null {
  return v.imageUrls?.[0] || v.product?.imageUrls?.[0] || null
}

const modalVariantTarget = computed<VariantSupplierTarget | null>(() => {
  if (selectedVariant.value) return selectedVariant.value
  if (historyData.value?.variant) {
    return {
      id: historyData.value.variant.id,
      sku: historyData.value.variant.sku,
    }
  }
  return null
})

// 4 KPI összesítő számítások
const totalPurchasedQty = computed(() =>
  (historyData.value?.monthlyStats ?? []).reduce((sum, s) => sum + s.purchasedQty, 0),
)

const totalPurchasedValueHuf = computed(() =>
  (historyData.value?.monthlyStats ?? []).reduce((sum, s) => sum + s.purchasedTotalCostHuf, 0),
)

const weightedAvgCostFormatted = computed(() => {
  const v = historyData.value?.variant
  if (!v) return '—'
  return formatCurrency(v.costPrice, v.costCurrency)
})

const lastPurchasePriceFormatted = computed(() => {
  const v = historyData.value?.variant
  if (!v || v.lastPurchasePrice === null) return 'Nincs adat'
  return formatCurrency(v.lastPurchasePrice, v.costCurrency)
})

const lastPurchaseSubtext = computed(() => {
  const v = historyData.value?.variant
  if (!v || !v.lastPurchaseAt) return 'Még nincs lezárt bevételezés'
  return `Utolsó: ${formatDateTime(v.lastPurchaseAt)}`
})

const totalPurchasedQtyFormatted = computed(
  () => `${totalPurchasedQty.value.toLocaleString('hu-HU')} db`,
)

const totalPurchasedValueFormatted = computed(() => formatPrice(totalPurchasedValueHuf.value))

// Értékesítés & Árrés KPI számítások
const salesTotalSoldQtyFormatted = computed(() => {
  const qty = salesHistoryData.value?.summary.totalSoldQty ?? 0
  return `${qty.toLocaleString('hu-HU')} db`
})

const salesTotalRevenueFormatted = computed(() =>
  formatPrice(salesHistoryData.value?.summary.totalSoldRevenueHuf),
)

const salesTotalCogsFormatted = computed(() =>
  formatPrice(salesHistoryData.value?.summary.totalSoldCogsHuf),
)

const salesTotalMarginFormatted = computed(() =>
  formatPrice(salesHistoryData.value?.summary.totalMarginHuf),
)

function formatMarginPercent(pct: number | null | undefined): string {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return '—'
  return `${pct.toLocaleString('hu-HU', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`
}

const salesMarginSubtext = computed(
  () => `Árrésráta: ${formatMarginPercent(salesHistoryData.value?.summary.totalMarginPercent)}`,
)

const salesMarginColorClass = computed(() => {
  const margin = salesHistoryData.value?.summary.totalMarginHuf ?? 0
  if (margin > 0) return 'text-emerald-600'
  if (margin < 0) return 'text-rose-600'
  return 'text-[#686f6a]'
})

async function onVariantSearch(event: AutoCompleteCompleteEvent) {
  if (!canViewCost.value) return
  const seq = ++latestSearchSeq
  searchingVariants.value = true
  try {
    const query = event.query.trim()
    const res = await variantApi.getAll({
      search: query || undefined,
      take: 20,
    })
    if (seq !== latestSearchSeq) return
    variantSuggestions.value = res.data.map(toSearchOption)
  } catch (err) {
    if (seq !== latestSearchSeq) return
    toast.add({
      severity: 'error',
      summary: 'Keresési hiba',
      detail: extractApiError(err, 'Nem sikerült keresni a variánsok között.'),
      life: 4000,
    })
  } finally {
    if (seq === latestSearchSeq) {
      searchingVariants.value = false
    }
  }
}

async function loadQuickVariants() {
  if (!canViewCost.value) return
  try {
    const res = await variantApi.getAll({ take: 8 })
    quickVariants.value = res.data
  } catch {
    quickVariants.value = []
  }
}

async function loadVariantAnalytics(variantId: string, knownVariant?: VariantItem) {
  if (!canViewCost.value || !variantId) return
  const seq = ++latestLoadSeq
  loadingAnalytics.value = true
  loadError.value = null

  try {
    const [variantRes, historyRes, suppliersRes] = await Promise.all([
      knownVariant ? Promise.resolve(knownVariant) : variantApi.getOne(variantId).then((r) => r.data),
      variantSuppliersApi.getPurchaseHistory(variantId).then((r) => r.data),
      variantSuppliersApi.list(variantId).then((r) => r.data),
    ])

    if (seq !== latestLoadSeq) return

    selectedVariant.value = variantRes
    variantAutocompleteModel.value = toSearchOption(variantRes)
    historyData.value = historyRes
    variantSuppliers.value = suppliersRes
  } catch (err) {
    if (seq !== latestLoadSeq) return
    const msg = extractApiError(err, 'Nem sikerült betölteni a variáns beszerzési adatait.')
    loadError.value = msg
    historyData.value = null
    variantSuppliers.value = []
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: msg,
      life: 5000,
    })
  } finally {
    if (seq === latestLoadSeq) {
      loadingAnalytics.value = false
    }
  }
}

async function loadVariantSalesHistory(variantId: string) {
  if (!canViewCost.value || !variantId) return
  const seq = ++latestSalesSeq
  loadingSalesAnalytics.value = true
  salesLoadError.value = null

  try {
    const res = await salesOrdersApi.getVariantHistory(variantId, {
      skip: salesPage.value * salesRows,
      take: salesRows,
    })
    if (seq !== latestSalesSeq) return
    salesHistoryData.value = res.data
  } catch (err) {
    if (seq !== latestSalesSeq) return
    const msg = extractApiError(err, 'Nem sikerült betölteni a variáns értékesítési adatait.')
    salesLoadError.value = msg
    salesHistoryData.value = null
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: msg,
      life: 5000,
    })
  } finally {
    if (seq === latestSalesSeq) {
      loadingSalesAnalytics.value = false
    }
  }
}

async function refreshVariantSuppliersAndHistory() {
  const id = modalVariantTarget.value?.id
  if (!id || !canViewCost.value) return
  await loadVariantAnalytics(id, selectedVariant.value ?? undefined)
}

function switchTab(tabId: AnalyticsTab) {
  if (activeTab.value === tabId) return
  activeTab.value = tabId
  if (readQueryTab() !== tabId) {
    void router.replace({
      path: '/analytics',
      query: { ...route.query, tab: tabId },
    })
  }
}

function selectVariantAndSyncUrl(variant: VariantItem) {
  selectedVariant.value = variant
  variantAutocompleteModel.value = toSearchOption(variant)
  if (route.query.variantId !== variant.id) {
    void router.replace({
      path: '/analytics',
      query: { ...route.query, variantId: variant.id },
    })
  } else {
    void loadVariantAnalytics(variant.id, variant)
    if (activeTab.value === 'sales-margin') {
      salesPage.value = 0
      void loadVariantSalesHistory(variant.id)
    }
  }
}

function onVariantSelected(event: AutoCompleteOptionSelectEvent) {
  const option = event.value as VariantSearchOption | undefined
  if (!option?.variant) return
  selectVariantAndSyncUrl(option.variant)
}

function clearSelection() {
  selectedVariant.value = null
  variantAutocompleteModel.value = null
  historyData.value = null
  variantSuppliers.value = []
  loadError.value = null
  salesHistoryData.value = null
  salesLoadError.value = null
  salesPage.value = 0
  loadingSalesAnalytics.value = false
  latestSalesSeq++
  if (route.query.variantId) {
    const nextQuery = { ...route.query }
    delete nextQuery.variantId
    void router.replace({ path: '/analytics', query: nextQuery })
  }
}

function onSalesPage(event: DataTablePageEvent) {
  const variantId = selectedVariant.value?.id || readQueryVariantId()
  if (!variantId) return
  salesPage.value = event.page
  void loadVariantSalesHistory(variantId)
}

function formatMonthLabel(year: number, month: number): string {
  return `${year}. ${String(month).padStart(2, '0')}.`
}

function formatExchangeRate(rate: number, currency: string): string {
  if (currency.trim().toUpperCase() === 'HUF') return '1'
  return rate.toLocaleString('hu-HU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })
}

function getEffectiveSupplierPrice(item: VariantSupplierItem): number | null {
  if (item.purchasePrice === undefined || item.purchasePrice === null) return null
  const discount = item.discountPercent ?? 0
  if (discount <= 0) return item.purchasePrice
  return Math.round((item.purchasePrice * (1 - discount / 100) + Number.EPSILON) * 100) / 100
}

function readQueryVariantId(): string {
  const raw = route.query.variantId
  if (typeof raw === 'string') return raw.trim()
  if (Array.isArray(raw) && typeof raw[0] === 'string') return raw[0].trim()
  return ''
}

watch(
  () => route.query.tab,
  () => {
    const nextTab = readQueryTab()
    if (activeTab.value !== nextTab) {
      activeTab.value = nextTab
    }
  },
)

watch(activeTab, (tab) => {
  if (!canViewCost.value || tab !== 'sales-margin') return
  const variantId = selectedVariant.value?.id || readQueryVariantId()
  if (!variantId) return
  if (salesHistoryData.value?.variant.id !== variantId) {
    salesPage.value = 0
    void loadVariantSalesHistory(variantId)
  }
})

watch(
  () => [route.query.variantId, canViewCost.value] as const,
  ([, allowed]) => {
    if (!allowed) return
    const qId = readQueryVariantId()
    if (!qId) {
      if (selectedVariant.value || salesHistoryData.value) {
        selectedVariant.value = null
        variantAutocompleteModel.value = null
        historyData.value = null
        variantSuppliers.value = []
        salesHistoryData.value = null
        salesLoadError.value = null
        salesPage.value = 0
        loadingSalesAnalytics.value = false
        latestSalesSeq++
      }
      return
    }
    const known = selectedVariant.value?.id === qId ? selectedVariant.value : undefined
    void loadVariantAnalytics(qId, known)
    if (activeTab.value === 'sales-margin') {
      salesPage.value = 0
      salesHistoryData.value = null
      salesLoadError.value = null
      void loadVariantSalesHistory(qId)
    }
  },
)

onMounted(() => {
  if (!canViewCost.value) return
  activeTab.value = readQueryTab()
  void loadQuickVariants()
  const initialId = readQueryVariantId()
  if (initialId) {
    void loadVariantAnalytics(initialId)
    if (activeTab.value === 'sales-margin') {
      void loadVariantSalesHistory(initialId)
    }
  }
})
</script>

<template>
  <div class="space-y-5">
    <PageHeader
      title="Elemzések & Ártörténet"
      subtitle="Variánsok súlyozott átlagára, beszállítói ajánlatok összevetése, beérkezésenkénti ártörténet és havi forgalmi statisztika."
    />

    <!-- Jogosultság-védelem -->
    <div
      v-if="!canViewCost"
      class="bg-white rounded-3xl border border-white shadow-sm p-10 text-center space-y-2.5"
    >
      <div
        class="w-12 h-12 rounded-2xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto"
      >
        <i class="pi pi-lock text-xl"></i>
      </div>
      <h2 class="text-base font-bold text-slate-900">Hozzáférés korlátozva</h2>
      <p class="text-xs text-slate-500 max-w-md mx-auto">
        A beszerzési ártörténet és költségár-elemzések megtekintéséhez vezetői vagy beszerzési
        jogosultság szükséges.
      </p>
    </div>

    <template v-else>
      <!-- Kapszula al-fül váltó -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div
          class="inline-flex items-center bg-white border border-white rounded-2xl p-1 shadow-sm gap-1"
        >
          <button
            v-for="tab in tabs"
            :key="tab.id"
            type="button"
            :disabled="tab.disabled"
            @click="!tab.disabled && switchTab(tab.id)"
            class="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
            :class="
              tab.disabled
                ? 'text-slate-400 cursor-not-allowed opacity-75'
                : activeTab === tab.id
                  ? 'bg-slate-900 text-white shadow-sm cursor-pointer'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50 cursor-pointer'
            "
          >
            <i :class="[tab.icon, 'text-xs']"></i>
            <span>{{ tab.label }}</span>
            <span
              v-if="tab.badge"
              class="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500"
            >
              {{ tab.badge }}
            </span>
          </button>
        </div>
      </div>

      <!-- Variáns kereső / választó Bento kártya -->
      <div class="bg-white rounded-3xl border border-white shadow-sm p-5 sm:p-6 space-y-4">
        <div class="flex flex-col lg:flex-row lg:items-center gap-4">
          <div class="flex-1 space-y-1.5">
            <label class="block text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Termékvariáns kiválasztása (SKU, terméknév, vonalkód vagy márka alapján)
            </label>
            <div class="flex items-center gap-2">
              <AutoComplete
                v-model="variantAutocompleteModel"
                :suggestions="variantSuggestions"
                optionLabel="label"
                dataKey="id"
                :dropdown="true"
                :delay="300"
                :minLength="0"
                :loading="searchingVariants"
                placeholder="Kezdj el gépelni (pl. Difi, SKU, EAN vonalkód)..."
                class="w-full"
                inputClass="w-full h-10 rounded-xl border border-slate-200 bg-slate-50/60 px-3.5 text-sm text-slate-900"
                @complete="onVariantSearch"
                @item-select="onVariantSelected"
              >
                <template #option="{ option }: { option: VariantSearchOption }">
                  <div class="flex items-center justify-between gap-3 py-1">
                    <div class="min-w-0">
                      <p class="text-xs font-bold text-slate-900 truncate">
                        {{ option.variant.product?.name ?? 'Termék' }}
                      </p>
                      <p class="text-[11px] text-slate-500 flex items-center gap-2 flex-wrap">
                        <span class="font-mono font-semibold text-slate-700">
                          {{ option.variant.sku }}
                        </span>
                        <span v-if="option.variant.size">· Méret: {{ option.variant.size }}</span>
                        <span v-if="option.variant.colors?.length">
                          · {{ option.variant.colors.join(', ') }}
                        </span>
                        <span v-if="option.variant.product?.brand?.name">
                          · {{ option.variant.product.brand.name }}
                        </span>
                      </p>
                    </div>
                    <span
                      v-if="getPrimaryBarcode(option.variant)"
                      class="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0"
                    >
                      {{ getPrimaryBarcode(option.variant) }}
                    </span>
                  </div>
                </template>
              </AutoComplete>

              <button
                v-if="selectedVariant || historyData"
                type="button"
                @click="clearSelection"
                class="h-10 px-3.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-xs font-semibold text-slate-600 shrink-0 cursor-pointer transition"
                title="Kiválasztás törlése"
              >
                <i class="pi pi-times text-xs mr-1"></i>
                <span>Törlés</span>
              </button>
            </div>
          </div>

          <!-- Kiválasztott variáns összefoglaló chip -->
          <div
            v-if="selectedVariant"
            class="flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-slate-50 border border-slate-200/80 lg:max-w-md shrink-0"
          >
            <img
              v-if="getVariantThumbnail(selectedVariant)"
              :src="getVariantThumbnail(selectedVariant) ?? undefined"
              :alt="selectedVariant.sku"
              class="w-11 h-11 rounded-xl object-contain bg-white border border-slate-200 shrink-0"
            />
            <div
              v-else
              class="w-11 h-11 rounded-xl bg-slate-200/70 text-slate-500 flex items-center justify-center shrink-0"
            >
              <i class="pi pi-box text-base"></i>
            </div>
            <div class="min-w-0">
              <p class="text-xs font-bold text-slate-900 truncate">
                {{ selectedVariant.product?.name ?? 'Kiválasztott variáns' }}
              </p>
              <div class="flex items-center gap-1.5 flex-wrap text-[11px] text-slate-500 mt-0.5">
                <span class="font-mono font-bold text-slate-800">{{ selectedVariant.sku }}</span>
                <span
                  v-if="selectedVariant.size"
                  class="px-1.5 py-0.2 rounded bg-slate-900 text-white text-[10px] font-bold"
                >
                  {{ selectedVariant.size }}
                </span>
                <span v-if="selectedVariant.colors?.length">
                  {{ selectedVariant.colors.join(', ') }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Gyors választó chipek ha még nincs variáns kiválasztva -->
        <div
          v-if="!selectedVariant && !loadingAnalytics && quickVariants.length > 0"
          class="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2"
        >
          <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">
            Gyors elérés:
          </span>
          <button
            v-for="qv in quickVariants"
            :key="qv.id"
            type="button"
            @click="selectVariantAndSyncUrl(qv)"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-orange-50 border border-slate-200/80 hover:border-orange-200 text-xs text-slate-700 hover:text-orange-800 cursor-pointer transition"
          >
            <span class="font-mono font-bold">{{ qv.sku }}</span>
            <span v-if="qv.product?.name" class="text-slate-500 truncate max-w-[160px]">
              · {{ qv.product.name }}
            </span>
          </button>
        </div>
      </div>

      <!-- 1. FÜL: Beszerzési ártörténet & Statisztika -->
      <template v-if="activeTab === 'purchase-analytics'">
        <!-- Betöltés állapot -->
        <div
          v-if="loadingAnalytics"
          class="bg-white rounded-3xl border border-white shadow-sm py-16 text-center text-sm text-slate-400"
        >
        <i class="pi pi-spin pi-spinner text-lg mr-2"></i>
        <span>Beszerzési ártörténet és statisztikák betöltése...</span>
      </div>

      <!-- Hiba állapot -->
      <div
        v-else-if="loadError"
        class="bg-white rounded-3xl border border-rose-200 shadow-sm p-8 text-center space-y-2"
      >
        <i class="pi pi-exclamation-circle text-2xl text-rose-500"></i>
        <p class="text-sm font-semibold text-slate-900">{{ loadError }}</p>
      </div>

      <!-- Üres állapot (nincs kiválasztott variáns) -->
      <div
        v-else-if="!historyData"
        class="bg-white rounded-3xl border border-white shadow-sm p-12 text-center space-y-2.5"
      >
        <div
          class="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto"
        >
          <i class="pi pi-chart-line text-xl"></i>
        </div>
        <h2 class="text-base font-bold text-slate-900">Válassz egy termékvariánst az elemzéshez</h2>
        <p class="text-xs text-slate-500 max-w-md mx-auto">
          Használd a fenti keresőt SKU, terméknév vagy vonalkód alapján, vagy kattints a Katalógus
          variáns-táblájában az Ártörténet ikonra.
        </p>
      </div>

      <!-- Elemzési tartalom (amikor van betöltött variáns) -->
      <template v-else>
        <!-- 4 KPI Kártya (StatKpiCard) -->
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatKpiCard
            label="Súlyozott átlagár"
            :value="weightedAvgCostFormatted"
            :subtext="`Devizanem: ${historyData.variant.costCurrency}`"
            icon="pi pi-wallet"
            icon-class="text-[#f46714]"
          />
          <StatKpiCard
            label="Utolsó beszerzési ár"
            :value="lastPurchasePriceFormatted"
            :subtext="lastPurchaseSubtext"
            icon="pi pi-tag"
            icon-class="text-sky-600"
          />
          <StatKpiCard
            label="Összes beszerzett db"
            :value="totalPurchasedQtyFormatted"
            :subtext="`${historyData.history.length} lezárt bevételezés`"
            icon="pi pi-box"
            icon-class="text-emerald-600"
          />
          <StatKpiCard
            label="Összes beszerzési érték"
            :value="totalPurchasedValueFormatted"
            subtext="Összesített HUF bekerülési érték"
            icon="pi pi-chart-bar"
            icon-class="text-indigo-600"
          />
        </div>

        <!-- Regisztrált beszállítók összevető kártya -->
        <div class="bg-white rounded-3xl border border-white shadow-sm p-6 space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div class="flex items-center gap-2">
                <h2 class="text-base font-bold text-slate-900">
                  Regisztrált beszállítók összevetése
                </h2>
                <span class="text-xs font-bold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
                  {{ variantSuppliers.length }} beszállító
                </span>
              </div>
              <p class="text-xs text-slate-500 mt-0.5">
                A variánshoz rögzített beszállítói listaárak, kedvezmények és cikkszámok.
              </p>
            </div>

            <button
              type="button"
              @click="isSuppliersModalOpen = true"
              class="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white flex items-center gap-2 cursor-pointer transition"
            >
              <i class="pi pi-building text-xs"></i>
              <span>Beszállítók kezelése</span>
            </button>
          </div>

          <div
            v-if="variantSuppliers.length === 0"
            class="py-8 text-center bg-slate-50/60 rounded-2xl border border-dashed border-slate-200 text-xs text-slate-400"
          >
            Ehhez a variánshoz még nincs regisztrált beszállító. Kattints a „Beszállítók kezelése”
            gombra az első rögzítéséhez.
          </div>

          <div v-else class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            <div
              v-for="sup in variantSuppliers"
              :key="sup.id"
              class="p-4 rounded-2xl border flex flex-col justify-between gap-3 transition"
              :class="
                sup.isPrimary
                  ? 'bg-orange-50/40 border-orange-200'
                  : 'bg-slate-50/50 border-slate-200/80'
              "
            >
              <div class="space-y-1.5">
                <div class="flex items-center justify-between gap-2">
                  <span class="text-sm font-bold text-slate-900 truncate">
                    {{ sup.supplier.name }}
                  </span>
                  <span
                    v-if="sup.isPrimary"
                    class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-orange-500 text-white shrink-0"
                  >
                    Elsődleges
                  </span>
                </div>

                <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span v-if="sup.supplierSku">
                    Cikkszám:
                    <span class="font-mono font-semibold text-slate-700">
                      {{ sup.supplierSku }}
                    </span>
                  </span>
                  <span v-if="sup.orderUnit">Egység: {{ sup.orderUnit }}</span>
                </div>

                <p v-if="sup.supplierProductName" class="text-xs text-slate-600 truncate">
                  {{ sup.supplierProductName }}
                </p>
              </div>

              <div class="pt-2 border-t border-slate-200/70 flex items-end justify-between gap-2">
                <div>
                  <span class="text-[11px] text-slate-400 block">Listaár</span>
                  <span class="text-base font-bold text-slate-900">
                    {{ formatCurrency(sup.purchasePrice, sup.currency) }}
                  </span>
                </div>

                <div
                  v-if="sup.discountPercent !== null && sup.discountPercent !== undefined && sup.discountPercent > 0"
                  class="text-right"
                >
                  <span
                    class="inline-block text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200"
                  >
                    -{{ sup.discountPercent }}% kedvezmény
                  </span>
                  <p class="text-xs font-semibold text-emerald-800 mt-0.5">
                    Nettó: {{ formatCurrency(getEffectiveSupplierPrice(sup), sup.currency) }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Beérkezésenkénti ártörténet táblázat -->
        <div class="bg-white rounded-3xl border border-white shadow-sm p-6 space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-base font-bold text-slate-900">Beérkezésenkénti ártörténet</h2>
              <p class="text-xs text-slate-500 mt-0.5">
                Minden lezárt bevételezés egységára devizában, alkalmazott árfolyammal és HUF
                értékkel.
              </p>
            </div>
            <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
              {{ historyData.history.length }} tétel
            </span>
          </div>

          <DataTable
            :value="historyData.history"
            :paginator="historyData.history.length > 10"
            :rows="10"
            dataKey="id"
            responsiveLayout="scroll"
            class="text-[13px]"
          >
            <template #empty>
              <div class="py-10 text-center text-xs text-slate-400">
                Ehhez a variánshoz még nincs lezárt bevételezési ártörténet.
              </div>
            </template>

            <Column header="Dátum">
              <template #body="{ data }: { data: VariantPurchaseHistoryEntry }">
                <span class="whitespace-nowrap text-xs text-slate-700">
                  {{ formatDateTime(data.completedAt) }}
                </span>
              </template>
            </Column>

            <Column header="Bevételezés">
              <template #body="{ data }: { data: VariantPurchaseHistoryEntry }">
                <div class="space-y-0.5">
                  <div class="flex items-center gap-1.5">
                    <span class="font-mono text-xs font-bold text-slate-900">
                      {{ data.receiptNumber }}
                    </span>
                    <span
                      v-if="data.isUnexpected"
                      class="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200"
                    >
                      Váratlan
                    </span>
                  </div>
                  <p class="text-[11px] text-slate-400">{{ data.targetLocation.name }}</p>
                </div>
              </template>
            </Column>

            <Column header="Számlaszám">
              <template #body="{ data }: { data: VariantPurchaseHistoryEntry }">
                <span class="font-mono text-xs text-slate-700">
                  {{ data.invoiceNumber || '—' }}
                </span>
              </template>
            </Column>

            <Column header="Beszállító">
              <template #body="{ data }: { data: VariantPurchaseHistoryEntry }">
                <span class="text-xs font-medium text-slate-800">
                  {{ data.supplier?.name || '—' }}
                </span>
              </template>
            </Column>

            <Column header="PO rendelés">
              <template #body="{ data }: { data: VariantPurchaseHistoryEntry }">
                <span
                  v-if="data.purchaseOrder"
                  class="font-mono text-xs font-semibold px-2 py-0.5 rounded-lg bg-sky-50 text-sky-700 border border-sky-200"
                >
                  {{ data.purchaseOrder.orderNumber }}
                </span>
                <span v-else class="text-xs text-slate-400">Közvetlen</span>
              </template>
            </Column>

            <Column header="Beérkezett db" class="text-right">
              <template #body="{ data }: { data: VariantPurchaseHistoryEntry }">
                <span class="font-bold text-slate-900 whitespace-nowrap">
                  {{ data.receivedQuantity.toLocaleString('hu-HU') }} db
                </span>
              </template>
            </Column>

            <Column header="Egységár (deviza)" class="text-right">
              <template #body="{ data }: { data: VariantPurchaseHistoryEntry }">
                <span class="font-semibold text-slate-800 whitespace-nowrap">
                  {{ formatCurrency(data.unitCost, data.currency) }}
                </span>
              </template>
            </Column>

            <Column header="Árfolyam" class="text-right">
              <template #body="{ data }: { data: VariantPurchaseHistoryEntry }">
                <span class="font-mono text-xs text-slate-600 whitespace-nowrap">
                  {{ formatExchangeRate(data.exchangeRate, data.currency) }}
                </span>
              </template>
            </Column>

            <Column header="Egységár (HUF)" class="text-right">
              <template #body="{ data }: { data: VariantPurchaseHistoryEntry }">
                <span class="font-bold text-slate-900 whitespace-nowrap">
                  {{ formatPrice(data.unitCostHuf) }}
                </span>
              </template>
            </Column>
          </DataTable>
        </div>

        <!-- Havi statisztika (VariantMonthlyStat) táblázat -->
        <div class="bg-white rounded-3xl border border-white shadow-sm p-6 space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-base font-bold text-slate-900">Havi forgalmi és beszerzési statisztika</h2>
              <p class="text-xs text-slate-500 mt-0.5">
                Havi bontású beszerzési, értékesítési, COGS, visszáru és készletkorrekciós mutatók.
              </p>
            </div>
            <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
              {{ historyData.monthlyStats.length }} hónap
            </span>
          </div>

          <DataTable
            :value="historyData.monthlyStats"
            :paginator="historyData.monthlyStats.length > 12"
            :rows="12"
            dataKey="id"
            responsiveLayout="scroll"
            class="text-[13px]"
          >
            <template #empty>
              <div class="py-10 text-center text-xs text-slate-400">
                Ehhez a variánshoz még nem keletkezett havi statisztika.
              </div>
            </template>

            <Column header="Év / Hó">
              <template #body="{ data }: { data: VariantMonthlyStatItem }">
                <span class="font-mono font-bold text-slate-900 whitespace-nowrap">
                  {{ formatMonthLabel(data.year, data.month) }}
                </span>
              </template>
            </Column>

            <Column header="Beszerzett db" class="text-right">
              <template #body="{ data }: { data: VariantMonthlyStatItem }">
                <span class="font-semibold text-slate-800 whitespace-nowrap">
                  {{ data.purchasedQty.toLocaleString('hu-HU') }} db
                </span>
              </template>
            </Column>

            <Column header="Beszerzési érték (HUF)" class="text-right">
              <template #body="{ data }: { data: VariantMonthlyStatItem }">
                <span class="font-bold text-slate-900 whitespace-nowrap">
                  {{ formatPrice(data.purchasedTotalCostHuf) }}
                </span>
              </template>
            </Column>

            <Column header="Eladott db" class="text-right">
              <template #body="{ data }: { data: VariantMonthlyStatItem }">
                <span class="text-slate-700 whitespace-nowrap">
                  {{ data.soldQty.toLocaleString('hu-HU') }} db
                </span>
              </template>
            </Column>

            <Column header="Bevétel (HUF)" class="text-right">
              <template #body="{ data }: { data: VariantMonthlyStatItem }">
                <span class="font-semibold text-slate-800 whitespace-nowrap">
                  {{ formatPrice(data.soldRevenueHuf) }}
                </span>
              </template>
            </Column>

            <Column header="COGS (HUF)" class="text-right">
              <template #body="{ data }: { data: VariantMonthlyStatItem }">
                <span class="text-slate-700 whitespace-nowrap">
                  {{ formatPrice(data.soldCogsHuf) }}
                </span>
              </template>
            </Column>

            <Column header="Visszáru db" class="text-right">
              <template #body="{ data }: { data: VariantMonthlyStatItem }">
                <span class="text-slate-700 whitespace-nowrap">
                  {{ data.returnedQty.toLocaleString('hu-HU') }} db
                </span>
              </template>
            </Column>

            <Column header="Korrekció db" class="text-right">
              <template #body="{ data }: { data: VariantMonthlyStatItem }">
                <span
                  class="font-semibold whitespace-nowrap"
                  :class="
                    data.adjustmentQty > 0
                      ? 'text-emerald-700'
                      : data.adjustmentQty < 0
                        ? 'text-rose-700'
                        : 'text-slate-500'
                  "
                >
                  {{ formatSignedQuantity(data.adjustmentQty) }}
                </span>
              </template>
            </Column>
          </DataTable>
        </div>
      </template>
      </template>

      <!-- 2. FÜL: Értékesítés & Árrés -->
      <template v-else-if="activeTab === 'sales-margin'">
        <!-- Betöltés állapot -->
        <div
          v-if="loadingSalesAnalytics && !salesHistoryData"
          class="bg-white rounded-3xl border border-white shadow-sm py-16 text-center text-sm text-slate-400"
        >
          <i class="pi pi-spin pi-spinner text-lg mr-2"></i>
          <span>Értékesítési és árrés statisztikák betöltése...</span>
        </div>

        <!-- Hiba állapot -->
        <div
          v-else-if="salesLoadError"
          class="bg-white rounded-3xl border border-rose-200 shadow-sm p-8 text-center space-y-2"
        >
          <i class="pi pi-exclamation-circle text-2xl text-rose-500"></i>
          <p class="text-sm font-semibold text-slate-900">{{ salesLoadError }}</p>
        </div>

        <!-- Üres állapot (nincs kiválasztott variáns) -->
        <div
          v-else-if="!salesHistoryData"
          class="bg-white rounded-3xl border border-white shadow-sm p-12 text-center space-y-2.5"
        >
          <div
            class="w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center mx-auto"
          >
            <i class="pi pi-percentage text-xl"></i>
          </div>
          <h2 class="text-base font-bold text-slate-900">
            Válassz egy termékvariánst az árrés-elemzéshez
          </h2>
          <p class="text-xs text-slate-500 max-w-md mx-auto">
            Használd a fenti keresőt SKU, terméknév vagy vonalkód alapján az eladási volumen,
            árbevétel, ELÁBÉ (COGS) és realizált árrés megtekintéséhez.
          </p>
        </div>

        <!-- Értékesítési elemzési tartalom -->
        <template v-else>
          <!-- 4 KPI Kártya (StatKpiCard) -->
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <StatKpiCard
              label="Eladott mennyiség"
              :value="salesTotalSoldQtyFormatted"
              :subtext="`${salesHistoryData.total.toLocaleString('hu-HU')} lezárt rendelési tétel`"
              icon="pi pi-shopping-bag"
              icon-class="text-[#f46714]"
            />
            <StatKpiCard
              label="Nettó árbevétel"
              :value="salesTotalRevenueFormatted"
              subtext="Teljesített rendelések nettó értéke"
              icon="pi pi-wallet"
              icon-class="text-sky-600"
            />
            <StatKpiCard
              label="ELÁBÉ (COGS)"
              :value="salesTotalCogsFormatted"
              subtext="Eladott áruk beszerzési értéke"
              icon="pi pi-box"
              icon-class="text-indigo-600"
            />
            <StatKpiCard
              label="Realizált árrés"
              :value="salesTotalMarginFormatted"
              :subtext="salesMarginSubtext"
              :subtext-class="salesMarginColorClass"
              icon="pi pi-percentage"
              :icon-class="salesMarginColorClass"
            />
          </div>

          <!-- Havi értékesítési & árrés statisztika táblázat -->
          <div class="bg-white rounded-3xl border border-white shadow-sm p-6 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 class="text-base font-bold text-slate-900">
                  Havi értékesítési &amp; árrés statisztika
                </h2>
                <p class="text-xs text-slate-500 mt-0.5">
                  Havi bontású eladott mennyiség, nettó árbevétel, ELÁBÉ (COGS) és realizált árrés.
                </p>
              </div>
              <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                {{ salesHistoryData.monthlyStats.length }} hónap
              </span>
            </div>

            <DataTable
              :value="salesHistoryData.monthlyStats"
              :paginator="salesHistoryData.monthlyStats.length > 12"
              :rows="12"
              dataKey="id"
              responsiveLayout="scroll"
              class="text-[13px]"
            >
              <template #empty>
                <div class="py-10 text-center text-xs text-slate-400">
                  Ehhez a variánshoz még nem keletkezett havi értékesítési statisztika.
                </div>
              </template>

              <Column header="Hónap">
                <template #body="{ data }: { data: VariantSalesMonthlyStat }">
                  <span class="font-mono font-bold text-slate-900 whitespace-nowrap">
                    {{ formatMonthLabel(data.year, data.month) }}
                  </span>
                </template>
              </Column>

              <Column header="Eladott db" class="text-right">
                <template #body="{ data }: { data: VariantSalesMonthlyStat }">
                  <span class="font-semibold text-slate-800 whitespace-nowrap">
                    {{ data.soldQty.toLocaleString('hu-HU') }} db
                  </span>
                </template>
              </Column>

              <Column header="Nettó árbevétel" class="text-right">
                <template #body="{ data }: { data: VariantSalesMonthlyStat }">
                  <span class="font-semibold text-slate-800 whitespace-nowrap">
                    {{ formatPrice(data.soldRevenueHuf) }}
                  </span>
                </template>
              </Column>

              <Column header="ELÁBÉ" class="text-right">
                <template #body="{ data }: { data: VariantSalesMonthlyStat }">
                  <span class="text-slate-700 whitespace-nowrap">
                    {{ formatPrice(data.soldCogsHuf) }}
                  </span>
                </template>
              </Column>

              <Column header="Realizált árrés (Ft)" class="text-right">
                <template #body="{ data }: { data: VariantSalesMonthlyStat }">
                  <span
                    class="font-bold whitespace-nowrap"
                    :class="
                      data.marginHuf > 0
                        ? 'text-emerald-700'
                        : data.marginHuf < 0
                          ? 'text-rose-700'
                          : 'text-slate-600'
                    "
                  >
                    {{ formatPrice(data.marginHuf) }}
                  </span>
                </template>
              </Column>

              <Column header="Árrés %" class="text-right">
                <template #body="{ data }: { data: VariantSalesMonthlyStat }">
                  <span
                    class="font-semibold whitespace-nowrap"
                    :class="
                      data.marginPercent !== null && data.marginPercent > 0
                        ? 'text-emerald-700'
                        : data.marginPercent !== null && data.marginPercent < 0
                          ? 'text-rose-700'
                          : 'text-slate-500'
                    "
                  >
                    {{ formatMarginPercent(data.marginPercent) }}
                  </span>
                </template>
              </Column>
            </DataTable>
          </div>

          <!-- Lezárt értékesítési tételek (COMPLETED rendelések) -->
          <div class="bg-white rounded-3xl border border-white shadow-sm p-6 space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 class="text-base font-bold text-slate-900">
                  Lezárt értékesítési tételek (COMPLETED rendelések)
                </h2>
                <p class="text-xs text-slate-500 mt-0.5">
                  A variáns összes teljesített vevői rendelési tétele csatorna, telephely és
                  egységár bontásban.
                </p>
              </div>
              <span class="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-100 text-slate-700">
                {{ salesHistoryData.total.toLocaleString('hu-HU') }} tétel
              </span>
            </div>

            <DataTable
              :value="salesHistoryData.items"
              :lazy="true"
              :paginator="true"
              :rows="salesRows"
              :totalRecords="salesHistoryData.total"
              :first="salesPage * salesRows"
              :loading="loadingSalesAnalytics"
              dataKey="id"
              responsiveLayout="scroll"
              class="text-[13px]"
              @page="onSalesPage"
            >
              <template #empty>
                <div class="py-10 text-center text-xs text-slate-400">
                  Ehhez a variánshoz még nincs teljesített értékesítési tétel.
                </div>
              </template>

              <Column header="Teljesítés dátuma">
                <template #body="{ data }: { data: VariantSalesHistoryItem }">
                  <span class="whitespace-nowrap text-xs text-slate-700">
                    {{ formatDateTime(data.salesOrder.completedAt ?? data.salesOrder.createdAt) }}
                  </span>
                </template>
              </Column>

              <Column header="Rendelésszám">
                <template #body="{ data }: { data: VariantSalesHistoryItem }">
                  <div class="space-y-0.5">
                    <RouterLink
                      :to="{ path: '/orders', query: { orderId: data.salesOrder.id } }"
                      class="inline-flex items-center gap-1 font-mono text-xs font-bold text-[#f46714] hover:text-orange-700 hover:underline whitespace-nowrap"
                    >
                      <span>{{ data.salesOrder.orderNumber }}</span>
                      <i class="pi pi-external-link text-[10px]"></i>
                    </RouterLink>
                    <p
                      v-if="data.salesOrder.externalOrderRef"
                      class="text-[11px] font-mono text-slate-400"
                    >
                      {{ data.salesOrder.externalOrderRef }}
                    </p>
                  </div>
                </template>
              </Column>

              <Column header="Csatorna">
                <template #body="{ data }: { data: VariantSalesHistoryItem }">
                  <span
                    class="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg whitespace-nowrap"
                    :class="SALES_CHANNEL_META[data.salesOrder.channel].badgeClass"
                  >
                    <i :class="[SALES_CHANNEL_META[data.salesOrder.channel].icon, 'text-[10px]']"></i>
                    <span>{{ SALES_CHANNEL_META[data.salesOrder.channel].label }}</span>
                  </span>
                </template>
              </Column>

              <Column header="Telephely">
                <template #body="{ data }: { data: VariantSalesHistoryItem }">
                  <span class="text-xs font-medium text-slate-800 whitespace-nowrap">
                    {{ data.salesOrder.sourceLocation.name }}
                  </span>
                </template>
              </Column>

              <Column header="Vevő">
                <template #body="{ data }: { data: VariantSalesHistoryItem }">
                  <span class="text-xs font-medium text-slate-800">
                    {{ data.salesOrder.customerName }}
                  </span>
                </template>
              </Column>

              <Column header="Mennyiség" class="text-right">
                <template #body="{ data }: { data: VariantSalesHistoryItem }">
                  <span class="font-bold text-slate-900 whitespace-nowrap">
                    {{
                      (data.pickedQuantity > 0
                        ? data.pickedQuantity
                        : data.orderedQuantity
                      ).toLocaleString('hu-HU')
                    }}
                    db
                  </span>
                </template>
              </Column>

              <Column header="Nettó egységár" class="text-right">
                <template #body="{ data }: { data: VariantSalesHistoryItem }">
                  <span class="font-semibold text-slate-800 whitespace-nowrap">
                    {{ formatPrice(data.unitNetPrice) }}
                  </span>
                </template>
              </Column>

              <Column header="Sor nettó" class="text-right">
                <template #body="{ data }: { data: VariantSalesHistoryItem }">
                  <span class="font-bold text-slate-900 whitespace-nowrap">
                    {{ formatPrice(data.lineNetTotalHuf) }}
                  </span>
                </template>
              </Column>

              <Column header="Sor bruttó" class="text-right">
                <template #body="{ data }: { data: VariantSalesHistoryItem }">
                  <span class="font-semibold text-slate-700 whitespace-nowrap">
                    {{ formatPrice(data.lineGrossTotalHuf) }}
                  </span>
                </template>
              </Column>
            </DataTable>
          </div>
        </template>
      </template>

      <!-- Helyben nyitható Beszállítók kezelése Modal -->
      <VariantSuppliersModal
        v-model:visible="isSuppliersModalOpen"
        :variant="modalVariantTarget"
        @updated="refreshVariantSuppliersAndHistory"
      />
    </template>
  </div>
</template>
