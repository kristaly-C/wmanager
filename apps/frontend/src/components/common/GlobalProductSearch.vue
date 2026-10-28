<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useSearchStore, type QuickProductInfo } from '@/stores/search'
import Dialog from 'primevue/dialog'

const searchStore = useSearchStore()
const searchQuery = ref('')
const selectedIndex = ref(0)
const copiedSku = ref<string | null>(null)

// Teszt adatok (később ezt a backend API-ból töltjük majd)
const mockProducts: QuickProductInfo[] = [
  {
    id: 'v1',
    productId: 'p1',
    name: 'Shox Motoros Kesztyű',
    variantLabel: 'Fekete · L',
    sku: 'SHX-GL-BL-L',
    barcode: '5991234567890',
    price: 24990,
    freeStock: 12,
    shelf: 'A-12-03',
  },
  {
    id: 'v2',
    productId: 'p1',
    name: 'Shox Motoros Kesztyű',
    variantLabel: 'Fekete · XL',
    sku: 'SHX-GL-BL-XL',
    barcode: '5991234567891',
    price: 24990,
    freeStock: 4,
    shelf: 'A-12-04',
  },
  {
    id: 'v3',
    productId: 'p2',
    name: 'Alpinestars Kabát',
    variantLabel: 'Piros/Fekete · M',
    sku: 'ALP-JKT-RD-M',
    barcode: '5999876543210',
    price: 89900,
    freeStock: 0,
    shelf: 'B-04-01',
  },
]

// Szűrt találatok a beírt keresőszó alapján
const filteredResults = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return mockProducts
  return mockProducts.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      p.barcode.includes(q),
  )
})

// Ha változik a keresés vagy a nyilakkal lépegetünk, frissítjük a globálisan kijelölt terméket
watch(
  [filteredResults, selectedIndex, () => searchStore.isSearchOpen],
  () => {
    if (searchStore.isSearchOpen && filteredResults.value.length > 0) {
      const current = filteredResults.value[selectedIndex.value] ?? filteredResults.value[0]
      searchStore.setHighlightedProduct(current ?? null)
    }
  },
  { immediate: true },
)

// Ha gépel a user, ugorjon vissza a legelső találatra a kijelölés
watch(searchQuery, () => {
  selectedIndex.value = 0
})

// SKU másolása vágólapra
async function copySku(sku: string) {
  await navigator.clipboard.writeText(sku)
  copiedSku.value = sku
  setTimeout(() => {
    if (copiedSku.value === sku) {
      copiedSku.value = null
    }
  }, 1500)
}

// Billentyűzet figyelő: Ctrl+K (Kereső), F5 (Termék Törzslap bárhonnan!), Nyilak (Lépegetés)
function handleKeydown(e: KeyboardEvent) {
  // 1. Ctrl + K -> Kereső nyitás/zárás
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    if (searchStore.isSearchOpen) {
      searchStore.closeSearch()
    } else {
      searchStore.openSearch()
    }
    return
  }

  // 2. F5 -> Bárhol vagyunk, ha van kijelölt termék, megnyitja a Termék Törzslap ablakot!
  if (e.key === 'F5') {
    if (searchStore.highlightedProduct) {
      e.preventDefault() // Megakadályozza a böngésző oldalfrissítését!
      searchStore.openProductSheet(searchStore.highlightedProduct)
    }
    return
  }

  // 3. Ha a kereső nyitva van: Fel / Le nyilak és Enter kezelése
  if (searchStore.isSearchOpen && !searchStore.isProductSheetOpen) {
    const count = filteredResults.value.length
    if (count === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectedIndex.value = (selectedIndex.value + 1) % count
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedIndex.value = (selectedIndex.value - 1 + count) % count
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const picked = filteredResults.value[selectedIndex.value]
      if (picked) {
        searchStore.openProductSheet(picked)
      }
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <!-- 1. GLOBÁLIS KERESŐ ABLAK (Ctrl + K) -->
  <Dialog
    v-model:visible="searchStore.isSearchOpen"
    modal
    dismissableMask
    :closeOnEscape="!searchStore.isProductSheetOpen"
    position="top"
    :showHeader="false"
    :draggable="false"
    class="w-[95vw] max-w-3xl !rounded-3xl !overflow-hidden !border !border-slate-200 !shadow-2xl !mt-16"
    contentClass="!p-0"
  >
    <div class="bg-white flex flex-col max-h-[75vh]">
      
      <!-- FELSŐ KERESŐSÁV -->
      <div class="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
        <i class="pi pi-search text-orange-500 text-lg"></i>
        <input
          v-model="searchQuery"
          type="text"
          autofocus
          placeholder="Keress terméknévre, cikkszámra (SKU), modellre vagy csippants vonalkódot..."
          class="w-full text-base text-slate-900 placeholder-slate-400 bg-transparent outline-none"
        />
        <button
          v-if="searchQuery"
          type="button"
          @click="searchQuery = ''"
          class="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
          title="Keresés törlése"
        >
          <i class="pi pi-times text-sm"></i>
        </button>
        <span
          @click="searchStore.closeSearch()"
          class="text-[11px] font-mono bg-slate-100 hover:bg-slate-200 px-2.5 py-1 rounded-lg text-slate-500 cursor-pointer shrink-0 transition"
        >
          ESC
        </span>
      </div>

      <!-- TALÁLATI LISTA -->
      <div class="flex-1 overflow-y-auto p-5 space-y-2.5 bg-slate-50/50">
        <div class="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-400 px-1">
          <span>Találatok ({{ filteredResults.length }})</span>
          <span>Készlet & Polchely</span>
        </div>

        <div
          v-if="filteredResults.length === 0"
          class="text-center py-8 text-sm text-slate-400"
        >
          Nincs találat a megadott keresésre.
        </div>

        <!-- Találati kártyák -->
        <div
          v-for="(item, index) in filteredResults"
          :key="item.id"
          @click="selectedIndex = index"
          @dblclick="searchStore.openProductSheet(item)"
          class="bg-white rounded-2xl p-4 transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-2"
          :class="
            selectedIndex === index
              ? 'border-orange-500 shadow-md bg-orange-50/10'
              : 'border-slate-200/80 hover:border-slate-300 shadow-sm'
          "
        >
          <!-- Bal oldal: Termék adatai + SKU másolás gomb -->
          <div class="flex items-start gap-4">
            <div class="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
              <i class="pi pi-image text-xl"></i>
            </div>
            <div>
              <div class="flex items-center gap-2">
                <h3 class="font-bold text-slate-900">{{ item.name }}</h3>
                <span class="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                  {{ item.variantLabel }}
                </span>
              </div>

              <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-500">
                <!-- SKU + Másolás ikon (@click.stop, hogy ne nyissa meg a kártyát!) -->
                <span class="inline-flex items-center gap-1.5 bg-slate-100 px-2 py-0.5 rounded-md">
                  <span>SKU:</span>
                  <b class="font-mono text-slate-800">{{ item.sku }}</b>
                  <button
                    type="button"
                    @click.stop="copySku(item.sku)"
                    class="ml-0.5 text-slate-400 hover:text-orange-600 transition cursor-pointer"
                    title="SKU másolása vágólapra"
                  >
                    <i
                      :class="
                        copiedSku === item.sku
                          ? 'pi pi-check text-emerald-600 font-bold'
                          : 'pi pi-copy'
                      "
                      class="text-xs"
                    ></i>
                  </button>
                </span>

                <span>Vonalkód: <b class="font-mono text-slate-700">{{ item.barcode }}</b></span>
                <span>Ár: <b class="text-slate-800">{{ item.price.toLocaleString('hu-HU') }} Ft</b></span>
              </div>
            </div>
          </div>

          <!-- Jobb oldal: Polcok és készletek -->
          <div class="flex items-center gap-2.5 self-end sm:self-center shrink-0">
            <div
              class="text-right px-3 py-1.5 rounded-xl border"
              :class="
                item.freeStock > 0
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                  : 'bg-rose-50 border-rose-200 text-rose-700'
              "
            >
              <span class="block text-[10px] font-bold uppercase opacity-75">Szabad készlet</span>
              <span class="text-sm font-black">{{ item.freeStock }} db</span>
            </div>
            <div class="text-right px-3 py-1.5 rounded-xl bg-orange-50 border border-orange-200">
              <span class="block text-[10px] font-bold uppercase text-orange-600">Polchely</span>
              <span class="text-sm font-black font-mono text-orange-700">{{ item.shelf }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ALSÓ LÁBLÉC (Gyorsbillentyű tippek) -->
      <div class="px-5 py-3 bg-white border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <div class="flex items-center gap-4">
          <span><kbd class="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">↑</kbd> <kbd class="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">↓</kbd> Lépegetés</span>
          <span><kbd class="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">F5</kbd> vagy <kbd class="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">↵</kbd> Termék Törzslap</span>
          <span><kbd class="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600 font-mono">ESC</kbd> Bezárás</span>
        </div>
        <span class="hidden sm:inline">Dupla kattintás vagy F5 a törzslaphoz</span>
      </div>

    </div>
  </Dialog>

  <!-- 2. LEBEGŐ TERMÉK TÖRZSLAP ABLAK (F5 megnyomására nyílik meg bárhonnan, elnavigálás nélkül!) -->
  <Dialog
    v-model:visible="searchStore.isProductSheetOpen"
    modal
    dismissableMask
    :header="searchStore.activeProductSheet ? `Termék Törzslap — ${searchStore.activeProductSheet.name}` : 'Termék Törzslap'"
    class="w-[95vw] max-w-4xl !rounded-3xl"
  >
    <div v-if="searchStore.activeProductSheet" class="space-y-6 pt-2">
      <!-- Felső összefoglaló sáv -->
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-2xl bg-slate-50 border border-slate-200">
        <div>
          <span class="text-xs font-bold uppercase text-orange-600">Kiválasztott variáns</span>
          <h2 class="text-xl font-bold text-slate-900 mt-0.5">
            {{ searchStore.activeProductSheet.name }} ({{ searchStore.activeProductSheet.variantLabel }})
          </h2>
          <p class="text-sm text-slate-500 mt-1 font-mono">
            SKU: <b>{{ searchStore.activeProductSheet.sku }}</b> · EAN: <b>{{ searchStore.activeProductSheet.barcode }}</b>
          </p>
        </div>
        <div class="flex gap-3">
          <div class="px-4 py-2 rounded-xl bg-white border border-slate-200 text-right">
            <span class="block text-xs text-slate-400">Eladási ár</span>
            <span class="text-lg font-black text-slate-900">
              {{ searchStore.activeProductSheet.price.toLocaleString('hu-HU') }} Ft
            </span>
          </div>
          <div class="px-4 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-right">
            <span class="block text-xs text-emerald-600">Szabad készlet</span>
            <span class="text-lg font-black text-emerald-700">
              {{ searchStore.activeProductSheet.freeStock }} db
            </span>
          </div>
        </div>
      </div>

      <!-- Részletes adatok helye (Készlet polconként, összes variáns, utolsó mozgások) -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="p-4 rounded-2xl border border-slate-200">
          <h3 class="font-bold text-slate-900 mb-2">Készlet eloszlás (Polcok)</h3>
          <div class="flex justify-between py-2 border-b border-slate-100 text-sm">
            <span>Főraktár — <b>{{ searchStore.activeProductSheet.shelf }}</b></span>
            <span class="font-bold text-emerald-600">{{ searchStore.activeProductSheet.freeStock }} db szabad</span>
          </div>
        </div>
        <div class="p-4 rounded-2xl border border-slate-200">
          <h3 class="font-bold text-slate-900 mb-2">Alapadatok</h3>
          <p class="text-sm text-slate-500">
            Itt jelennek majd meg a termék részletes törzsadatai (Beszállító, Márka, Kategória, Összes szín/méret variáns és készlettörténet), anélkül, hogy elhagynád az aktuális munkafolyamatot!
          </p>
        </div>
      </div>
    </div>
  </Dialog>
</template>