<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { GoodsReceiptStatus } from '@wmanager/shared-types'
import { useToast } from 'primevue/usetoast'
import { goodsReceiptsApi, type GoodsReceiptListItem } from '@/api/goodsReceipts'
import {
  isNetworkError,
  useOfflinePutawayQueue,
} from '@/composables/useOfflinePutawayQueue'
import { GOODS_RECEIPT_STATUS_META } from '@/utils/procurementMeta'
import { getBarcodeCandidates } from '@/utils/barcodeScanner'
import { extractApiError } from '@/utils/locationMeta'
import { formatDateTime } from '@/utils/formatters'

interface PdaReceiptCardItem {
  id: string
  receiptNumber: string
  invoiceNumber: string | null
  purchaseOrderNumber: string | null
  supplierName: string | null
  targetLocationName: string
  status: GoodsReceiptStatus
  totalReceived: number
  totalExpected: number
  itemCount: number
  itemSearchText?: string
  createdAt: string
  updatedAt: string
}

const RECEIVING_LIST_CACHE_KEY = 'xstorage_pda_receiving_list_cache_v1'

const router = useRouter()
const toast = useToast()

const {
  queue,
  isOnline,
  isFlushing,
  lastSyncEvent,
  totalPendingCount,
  totalFailedCount,
  flushQueue,
  getPendingCount,
  getFailedCount,
} = useOfflinePutawayQueue()

const receipts = ref<PdaReceiptCardItem[]>(loadCachedReceipts())
const loading = ref(false)
const usingCachedData = ref(false)
const searchInput = ref('')
const debouncedSearch = ref('')

let debounceTimer: ReturnType<typeof setTimeout> | null = null
let activeAbortController: AbortController | null = null

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null
}

function isValidCachedCard(val: unknown): val is PdaReceiptCardItem {
  if (!isRecord(val)) return false
  return (
    typeof val.id === 'string' &&
    typeof val.receiptNumber === 'string' &&
    typeof val.targetLocationName === 'string' &&
    typeof val.status === 'string' &&
    typeof val.totalReceived === 'number' &&
    typeof val.totalExpected === 'number' &&
    typeof val.itemCount === 'number' &&
    typeof val.createdAt === 'string' &&
    typeof val.updatedAt === 'string'
  )
}

function loadCachedReceipts(): PdaReceiptCardItem[] {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return []
  }
  try {
    const raw = localStorage.getItem(RECEIVING_LIST_CACHE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidCachedCard)
  } catch {
    return []
  }
}

function saveCachedReceipts(items: PdaReceiptCardItem[]): void {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return
  }
  try {
    localStorage.setItem(RECEIVING_LIST_CACHE_KEY, JSON.stringify(items))
  } catch {
    // Storage quota esetén nem blokkoljuk a működést
  }
}

function toCardItem(dto: GoodsReceiptListItem): PdaReceiptCardItem {
  const totalReceived = dto.items.reduce((sum, item) => sum + item.receivedQuantity, 0)
  const totalExpected = dto.items.reduce((sum, item) => sum + item.expectedQuantity, 0)
  const itemSearchText = dto.items
    .map((item) => {
      const barcodes = (item.variant.variantBarcodes ?? []).map((b) => b.barcode).join(' ')
      return `${item.variant.sku} ${item.variant.product?.name ?? ''} ${barcodes}`
    })
    .join(' ')
    .toLowerCase()
  return {
    id: dto.id,
    receiptNumber: dto.receiptNumber,
    invoiceNumber: dto.invoiceNumber ?? null,
    purchaseOrderNumber: dto.purchaseOrder?.orderNumber ?? null,
    supplierName: dto.supplier?.name ?? null,
    targetLocationName: dto.targetLocation.name,
    status: dto.status,
    totalReceived,
    totalExpected,
    itemCount: dto.items.length,
    itemSearchText,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
  }
}

function sortCards(items: PdaReceiptCardItem[]): PdaReceiptCardItem[] {
  const rank = (status: GoodsReceiptStatus) => (status === GoodsReceiptStatus.IN_PROGRESS ? 0 : 1)
  return [...items].sort((a, b) => {
    const statusDiff = rank(a.status) - rank(b.status)
    if (statusDiff !== 0) return statusDiff
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  })
}

const displayedReceipts = computed<PdaReceiptCardItem[]>(() => {
  const rawSearch = debouncedSearch.value.trim()
  if (!usingCachedData.value || !rawSearch) {
    return receipts.value
  }
  const q = rawSearch.toLowerCase()
  const barcodeCandidates = getBarcodeCandidates(rawSearch).map((c) => c.toLowerCase())
  return receipts.value.filter((item) => {
    const itemText = item.itemSearchText ?? ''
    return (
      item.receiptNumber.toLowerCase().includes(q) ||
      (item.invoiceNumber?.toLowerCase().includes(q) ?? false) ||
      (item.supplierName?.toLowerCase().includes(q) ?? false) ||
      item.targetLocationName.toLowerCase().includes(q) ||
      (item.purchaseOrderNumber?.toLowerCase().includes(q) ?? false) ||
      barcodeCandidates.some((candidate) => itemText.includes(candidate))
    )
  })
})

const orphanQueueReceiptIds = computed<string[]>(() => {
  const visibleIds = new Set(receipts.value.map((r) => r.id))
  const missing = new Set<string>()
  for (const item of queue.value) {
    if (!visibleIds.has(item.goodsReceiptId)) {
      missing.add(item.goodsReceiptId)
    }
  }
  return Array.from(missing)
})

async function fetchReceipts(options?: { silent?: boolean }) {
  if (!isOnline.value) {
    usingCachedData.value = true
    return
  }

  if (activeAbortController) {
    activeAbortController.abort()
  }
  const controller = new AbortController()
  activeAbortController = controller

  if (!options?.silent) {
    loading.value = true
  }

  try {
    const querySearch = debouncedSearch.value.trim() || undefined
    const [inProgressRes, openRes] = await Promise.all([
      goodsReceiptsApi.list(
        {
          status: GoodsReceiptStatus.IN_PROGRESS,
          search: querySearch,
          take: 100,
        },
        controller.signal,
      ),
      goodsReceiptsApi.list(
        {
          status: GoodsReceiptStatus.OPEN,
          search: querySearch,
          take: 100,
        },
        controller.signal,
      ),
    ])

    const byId = new Map<string, PdaReceiptCardItem>()
    for (const dto of [...inProgressRes.data.items, ...openRes.data.items]) {
      byId.set(dto.id, toCardItem(dto))
    }

    const merged = sortCards(Array.from(byId.values()))
    receipts.value = merged
    usingCachedData.value = false

    // Csak szűretlen lista esetén frissítjük a helyi offline gyorsítótárat
    if (!querySearch) {
      saveCachedReceipts(merged)
    }
  } catch (err: unknown) {
    const maybeErr = err as { code?: string; name?: string }
    if (maybeErr?.code === 'ERR_CANCELED' || maybeErr?.name === 'CanceledError') {
      return
    }

    if (isNetworkError(err)) {
      usingCachedData.value = true
      if (!options?.silent && receipts.value.length === 0) {
        toast.add({
          severity: 'warn',
          summary: 'Offline mód',
          detail: 'Nincs hálózati kapcsolat a szállítmányok betöltéséhez.',
          life: 3500,
        })
      }
      return
    }

    if (!options?.silent) {
      toast.add({
        severity: 'error',
        summary: 'Betöltési hiba',
        detail: extractApiError(err, 'Nem sikerült betölteni az aktív bevételezéseket.'),
        life: 4500,
      })
    }
  } finally {
    if (activeAbortController === controller) {
      activeAbortController = null
    }
    if (!options?.silent) {
      loading.value = false
    }
  }
}

function getProgressPercent(card: PdaReceiptCardItem): number {
  if (card.totalExpected <= 0) {
    return card.totalReceived > 0 ? 100 : 0
  }
  return Math.min(100, Math.round((card.totalReceived / card.totalExpected) * 100))
}

function getProgressBarClass(card: PdaReceiptCardItem): string {
  if (card.totalExpected > 0 && card.totalReceived > card.totalExpected) {
    return 'bg-orange-500'
  }
  if (card.totalExpected > 0 && card.totalReceived === card.totalExpected) {
    return 'bg-emerald-500'
  }
  if (card.totalReceived > 0) {
    return 'bg-blue-500'
  }
  return 'bg-slate-300'
}

async function handleManualSync() {
  if (!isOnline.value) {
    toast.add({
      severity: 'warn',
      summary: 'Offline állapot',
      detail: 'Szinkronizáláshoz várd meg, amíg visszatér a Wi-Fi kapcsolat.',
      life: 3000,
    })
    return
  }

  const result = await flushQueue()
  if (result.syncedCount > 0) {
    toast.add({
      severity: 'success',
      summary: 'Szinkronizálás kész',
      detail: `${result.syncedCount} offline elrakás sikeresen beküldve.`,
      life: 3500,
    })
    void fetchReceipts({ silent: true })
  }
  if (result.failedCount > 0) {
    toast.add({
      severity: 'error',
      summary: 'Hibás szinkronizálás',
      detail: `${result.failedCount} tétel sikertelen – nyisd meg a szállítmányt az ellenőrzéshez!`,
      life: 5000,
    })
  } else if (result.stoppedOffline) {
    toast.add({
      severity: 'warn',
      summary: 'Hálózat megszakadt',
      detail: 'A sorban maradt tételeket automatikusan újraküldjük, amint visszajön a Wi-Fi.',
      life: 3500,
    })
  } else if (result.syncedCount === 0 && totalFailedCount.value === 0) {
    toast.add({
      severity: 'info',
      summary: 'Minden naprakész',
      detail: 'Nincs szinkronizálásra váró offline tétel.',
      life: 2500,
    })
  }
}

function openReceipt(id: string) {
  void router.push({ name: 'pda-putaway', params: { id } })
}

function clearSearch() {
  if (debounceTimer) clearTimeout(debounceTimer)
  searchInput.value = ''
  debouncedSearch.value = ''
  void fetchReceipts()
}

function triggerImmediateSearch() {
  if (debounceTimer) clearTimeout(debounceTimer)
  debouncedSearch.value = searchInput.value.trim()
  void fetchReceipts()
}

watch(searchInput, (value) => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    const trimmed = value.trim()
    if (debouncedSearch.value !== trimmed) {
      debouncedSearch.value = trimmed
      void fetchReceipts()
    }
  }, 300)
})

watch(isOnline, (online, wasOnline) => {
  if (online && !wasOnline) {
    void fetchReceipts({ silent: true })
  }
})

watch(lastSyncEvent, (evt) => {
  if (evt && evt.syncedCount > 0 && isOnline.value) {
    void fetchReceipts({ silent: true })
  }
})

onMounted(() => {
  void fetchReceipts()
})

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (activeAbortController) activeAbortController.abort()
})
</script>

<template>
  <div class="space-y-3.5 pb-6">
    <!-- Felső navigációs és Online/Offline sáv -->
    <div class="flex items-center justify-between gap-2">
      <button
        type="button"
        @click="router.push('/pda')"
        class="inline-flex items-center gap-1.5 min-h-[42px] px-3 rounded-xl bg-white border border-slate-200 text-slate-700 text-sm font-semibold shadow-2xs active:scale-[0.98] transition cursor-pointer"
      >
        <i class="pi pi-arrow-left text-xs"></i>
        <span>Vissza</span>
      </button>

      <div class="flex items-center gap-1.5">
        <span
          :class="[
            'inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-full text-xs font-bold border',
            isOnline
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-amber-100 text-amber-900 border-amber-300',
          ]"
        >
          <span
            :class="[
              'w-2 h-2 rounded-full',
              isOnline ? 'bg-emerald-500' : 'bg-amber-600 animate-pulse',
            ]"
          ></span>
          {{ isOnline ? 'Online' : 'Offline' }}
        </span>

        <button
          type="button"
          :disabled="loading || !isOnline"
          @click="fetchReceipts()"
          title="Lista frissítése"
          class="inline-flex items-center justify-center w-[42px] h-[42px] rounded-xl bg-white border border-slate-200 text-slate-700 shadow-2xs active:scale-[0.97] disabled:opacity-50 transition cursor-pointer"
        >
          <i :class="['pi pi-refresh text-sm', loading ? 'pi-spin' : '']"></i>
        </button>
      </div>
    </div>

    <!-- Cím -->
    <div class="bg-white rounded-2xl border border-slate-200/80 p-3.5 shadow-2xs">
      <h1 class="text-lg font-bold text-slate-900 leading-tight">
        Bevételezés &amp; Elpakolás
      </h1>
      <p class="text-xs text-slate-500 mt-0.5">
        Válaszd ki az aktív szállítmányt az elpakolás megkezdéséhez vagy folytatásához.
      </p>
    </div>

    <!-- Függő / Hibás offline sor összesítő sáv -->
    <div
      v-if="totalPendingCount > 0 || totalFailedCount > 0"
      :class="[
        'rounded-2xl border-2 p-3.5 shadow-xs space-y-2.5',
        totalFailedCount > 0
          ? 'bg-rose-50 border-rose-300 text-rose-900'
          : 'bg-amber-50 border-amber-300 text-amber-900',
      ]"
    >
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-xs font-bold flex items-center gap-1.5">
            <i
              :class="[
                'pi text-sm',
                totalFailedCount > 0
                  ? 'pi-exclamation-triangle text-rose-600'
                  : 'pi-cloud-upload text-amber-600',
              ]"
            ></i>
            <span>
              <template v-if="totalFailedCount > 0">
                {{ totalFailedCount }} sikertelen szinkronizálás!
              </template>
              <template v-else>
                {{ totalPendingCount }} offline elrakás vár szinkronra
              </template>
            </span>
          </p>
          <p class="text-[11px] opacity-85 mt-0.5">
            <template v-if="totalFailedCount > 0 && totalPendingCount > 0">
              További {{ totalPendingCount }} tétel várakozik a helyi sorban.
            </template>
            <template v-else-if="totalFailedCount > 0">
              Nyisd meg az érintett szállítmányt a részletes hiba ellenőrzéséhez.
            </template>
            <template v-else>
              {{
                isOnline
                  ? 'Készen áll a beküldésre a szerver felé.'
                  : 'Wi-Fi visszatérésekor automatikusan beküldjük.'
              }}
            </template>
          </p>
        </div>

        <button
          v-if="totalPendingCount > 0"
          type="button"
          :disabled="!isOnline || isFlushing"
          @click="handleManualSync"
          class="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-xl bg-slate-900 text-white text-xs font-bold shrink-0 active:scale-[0.98] disabled:opacity-50 transition cursor-pointer"
        >
          <i :class="['pi text-xs', isFlushing ? 'pi-spin pi-spinner' : 'pi-sync']"></i>
          <span>Szinkronizálás</span>
        </button>
      </div>

      <!-- Ha van olyan offline tétel, amelynek szállítmánya már nincs a nyitott listában (pl. PC-ről lezárták) -->
      <div v-if="orphanQueueReceiptIds.length > 0" class="pt-2 border-t border-rose-200/80 space-y-1.5">
        <p class="text-[11px] font-semibold text-rose-800">
          Nem aktív / lezárt szállítmányhoz tartozó sor-elemek:
        </p>
        <div class="flex flex-wrap gap-1.5">
          <button
            v-for="orphanId in orphanQueueReceiptIds"
            :key="orphanId"
            type="button"
            @click="openReceipt(orphanId)"
            class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-rose-300 text-rose-700 text-xs font-bold active:scale-[0.98] cursor-pointer"
          >
            <i class="pi pi-external-link text-[10px]"></i>
            <span>Megnyitás ({{ getFailedCount(orphanId) }} hibás / {{ getPendingCount(orphanId) }} függő)</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Offline gyorsítótár jelzés -->
    <div
      v-if="usingCachedData && !isOnline"
      class="rounded-xl bg-slate-800 text-slate-100 px-3.5 py-2.5 text-xs flex items-center gap-2"
    >
      <i class="pi pi-wifi text-amber-400"></i>
      <span>Offline mód – az utoljára letöltött aktív szállítmányokat látod.</span>
    </div>

    <!-- Gyors kereső bizonylatszám / számlaszám / beszállító alapján -->
    <div class="relative">
      <i class="pi pi-search absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm"></i>
      <input
        v-model="searchInput"
        type="text"
        placeholder="Keresés: bizonylatszám, számla, beszállító, SKU, vonalkód..."
        @keydown.enter.prevent="triggerImmediateSearch"
        class="w-full min-h-[48px] bg-white border border-slate-200 rounded-2xl pl-10 pr-10 text-sm text-slate-900 placeholder-slate-400 shadow-2xs outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
      />
      <button
        v-if="searchInput"
        type="button"
        @click="clearSearch"
        aria-label="Keresés törlése"
        class="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:bg-slate-100 cursor-pointer"
      >
        <i class="pi pi-times text-xs"></i>
      </button>
    </div>

    <!-- Betöltés jelző -->
    <div
      v-if="loading && displayedReceipts.length === 0"
      class="bg-white rounded-2xl border border-slate-200/80 p-8 text-center text-slate-500 space-y-2"
    >
      <i class="pi pi-spin pi-spinner text-2xl text-blue-500"></i>
      <p class="text-sm font-medium">Aktív bevételezések betöltése...</p>
    </div>

    <!-- Üres állapot -->
    <div
      v-else-if="displayedReceipts.length === 0"
      class="bg-white rounded-2xl border border-slate-200/80 p-8 text-center space-y-2"
    >
      <div class="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
        <i class="pi pi-inbox text-xl"></i>
      </div>
      <p class="text-sm font-bold text-slate-800">
        {{ debouncedSearch ? 'Nincs a keresésnek megfelelő szállítmány' : 'Nincs aktív bevételezés' }}
      </p>
      <p class="text-xs text-slate-500">
        {{
          debouncedSearch
            ? 'Próbálj más bizonylatszámot vagy számlaszámot.'
            : 'Jelenleg nincs OPEN vagy IN_PROGRESS státuszú bevételezés a helyszíneiden.'
        }}
      </p>
    </div>

    <!-- Nagy, kesztyűbarát bevételezés kártyák -->
    <div v-else class="space-y-3">
      <button
        v-for="card in displayedReceipts"
        :key="card.id"
        type="button"
        @click="openReceipt(card.id)"
        class="w-full text-left bg-white rounded-2xl border border-slate-200/90 p-4 shadow-xs hover:border-blue-300 active:scale-[0.985] transition cursor-pointer space-y-3"
      >
        <!-- Fejléc: Bizonylatszám + státusz -->
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="text-base font-extrabold text-slate-900 tracking-tight">
                {{ card.receiptNumber }}
              </span>
              <span
                v-if="card.purchaseOrderNumber"
                class="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-600"
              >
                {{ card.purchaseOrderNumber }}
              </span>
            </div>
            <p v-if="card.invoiceNumber" class="text-xs font-medium text-slate-600 mt-0.5 truncate">
              Számla: <span class="font-semibold text-slate-800">{{ card.invoiceNumber }}</span>
            </p>
          </div>

          <span
            :class="[
              'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0',
              GOODS_RECEIPT_STATUS_META[card.status].badgeClass,
            ]"
          >
            <i :class="[GOODS_RECEIPT_STATUS_META[card.status].icon, 'text-[10px]']"></i>
            {{ GOODS_RECEIPT_STATUS_META[card.status].label }}
          </span>
        </div>

        <!-- Beszállító és célhelyszín -->
        <div class="grid grid-cols-1 gap-1.5 text-xs text-slate-600">
          <div class="flex items-center gap-2 min-w-0">
            <i class="pi pi-truck text-slate-400 text-xs shrink-0"></i>
            <span class="truncate font-medium text-slate-800">
              {{ card.supplierName || 'Nincs beszállító megadva' }}
            </span>
          </div>
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <i class="pi pi-map-marker text-blue-500 text-xs shrink-0"></i>
              <span class="truncate font-semibold text-slate-800">
                {{ card.targetLocationName }}
              </span>
            </div>
            <span class="text-[11px] text-slate-400 shrink-0">
              {{ formatDateTime(card.createdAt) }}
            </span>
          </div>
        </div>

        <!-- Haladáscsík -->
        <div class="space-y-1.5 pt-1">
          <div class="flex items-center justify-between text-xs">
            <span class="font-semibold text-slate-600">
              Elpakolás ({{ card.itemCount }} tétel)
            </span>
            <span class="font-extrabold text-slate-900">
              <template v-if="card.totalExpected > 0">
                {{ card.totalReceived }} / {{ card.totalExpected }} db
              </template>
              <template v-else>
                {{ card.totalReceived }} db elrakva
              </template>
            </span>
          </div>

          <div class="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              :class="['h-full rounded-full transition-all duration-300', getProgressBarClass(card)]"
              :style="{ width: `${getProgressPercent(card)}%` }"
            ></div>
          </div>
        </div>

        <!-- Offline sor jelvények ehhez a szállítmányhoz -->
        <div
          v-if="getFailedCount(card.id) > 0 || getPendingCount(card.id) > 0"
          class="flex items-center gap-2 flex-wrap pt-1"
        >
          <span
            v-if="getFailedCount(card.id) > 0"
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-700 border border-rose-300"
          >
            <i class="pi pi-exclamation-triangle text-[11px]"></i>
            {{ getFailedCount(card.id) }} sikertelen szinkron!
          </span>
          <span
            v-if="getPendingCount(card.id) > 0"
            class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300"
          >
            <i class="pi pi-clock text-[11px]"></i>
            {{ getPendingCount(card.id) }} offline várakozó
          </span>
        </div>
      </button>
    </div>
  </div>
</template>
