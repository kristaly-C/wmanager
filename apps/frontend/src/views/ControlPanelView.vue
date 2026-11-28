<script setup lang="ts">
import FulfillmentRoutingCard from '@/components/control-panel/FulfillmentRoutingCard.vue'
import InitialStockModeCard from '@/components/control-panel/InitialStockModeCard.vue'
</script>

<template>
  <div class="space-y-6 text-[#171918]">
    <!-- Oldalfejléc -->
    <div>
      <h1 class="text-[30px] font-semibold tracking-[-0.42px] text-[#171918] leading-tight">
        Vezérlőpult
      </h1>
      <p class="text-[14px] text-[#686f6a] mt-1 tracking-[-0.196px]">
        Rendszerszintű biztonsági és működési beállítások (ADMIN / BOSS).
      </p>
    </div>

    <!-- Nyitókészlet felvitel mód (INITIAL_STOCK) -->
    <InitialStockModeCard />

    <!-- Webshop teljesítési sorrend & útválasztás (ADMIN / BOSS) -->
    <FulfillmentRoutingCard />

    <!-- Helyőrző kártya a közelgő biztonsági / bejelentkezés-korlátozási beállításokhoz -->
    <div class="bg-white rounded-3xl border border-slate-200 shadow-sm p-6 sm:p-8">
      <div class="flex flex-col sm:flex-row sm:items-start gap-4">
        <div
          class="w-12 h-12 rounded-2xl bg-[#f6f7f5] border border-[#e8eae6] flex items-center justify-center shrink-0 text-[#686f6a]"
        >
          <i class="pi pi-shield text-xl"></i>
        </div>

        <div class="space-y-2 flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2.5">
            <h2 class="text-base font-bold text-[#171918]">
              Biztonsági és beléptetési szabályozók
            </h2>
            <span
              class="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200"
            >
              Hamarosan
            </span>
          </div>

          <p class="text-xs sm:text-sm text-[#686f6a] leading-relaxed max-w-3xl">
            Itt lesznek majd konfigurálhatók a rendszerszintű hitelesítési korlátozások:
            a maximális sikertelen bejelentkezési próbálkozások száma és az ideiglenes tiltási
            időtartam.
          </p>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 max-w-2xl">
            <div class="rounded-2xl bg-[#f6f7f5] border border-[#e8eae6] px-4 py-3">
              <p class="text-[11px] font-bold uppercase tracking-wide text-[#686f6a]">
                Bejelentkezési próbálkozások száma
              </p>
              <p class="text-sm font-semibold text-[#171918] mt-1">
                Későbbi beállítás
              </p>
            </div>
            <div class="rounded-2xl bg-[#f6f7f5] border border-[#e8eae6] px-4 py-3">
              <p class="text-[11px] font-bold uppercase tracking-wide text-[#686f6a]">
                Tiltási időtartam
              </p>
              <p class="text-sm font-semibold text-[#171918] mt-1">
                Későbbi beállítás
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
