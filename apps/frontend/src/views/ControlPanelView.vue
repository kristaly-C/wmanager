<script setup lang="ts">
// A későbbi rendszerszintű beállítások (pl. bejelentkezési próbálkozások száma, tiltási idő) ide kerülnek.
</script>

<template>
  <div class="max-w-7xl mx-auto space-y-6 text-[#171918]">
    <!-- Oldalfejléc -->
    <div>
      <h1 class="text-[30px] font-semibold tracking-[-0.42px] text-[#171918] leading-tight">
        Vezérlőpult
      </h1>
      <p class="text-[14px] text-[#686f6a] mt-1 tracking-[-0.196px]">
        Rendszerszintű biztonsági és működési beállítások (ADMIN / BOSS).
      </p>
    </div>

    <!-- Üres állapot kártya a jövőbeli beállításoknak -->
    <div class="bg-white rounded-3xl border border-white shadow-sm p-10 sm:p-14 text-center">
      <div
        class="size-14 rounded-2xl bg-[#f6f7f5] border border-[#e8eae6] flex items-center justify-center mx-auto mb-4 text-[#686f6a]"
      >
        <i class="pi pi-sliders-h text-2xl"></i>
      </div>
      <h2 class="text-lg font-semibold text-[#171918]">A vezérlőpult készen áll</h2>
      <p class="text-sm text-[#686f6a] max-w-md mx-auto mt-1.5">
        Ide kerülnek majd a rendszerszintű szabályozók (például bejelentkezési kísérletek limitje,
        tiltási időtartam és további jogosultsági/üzemeltetési opciók).
      </p>
    </div>
  </div>
</template>
