<script setup lang="ts">
const pdaTasks = [
  {
    title: 'Rendelés Kiszedés (Picking)',
    subtitle: 'Kiszedési lista polcról polcra',
    icon: 'pi pi-shopping-bag',
    color: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  },
  {
    title: 'Bevételezés & Elpakolás (Putaway)',
    subtitle: 'Termék csippantása és polchoz rendelése',
    icon: 'pi pi-inbox',
    color: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  },
  {
    title: 'Polc / Termék Ellenőrzés',
    subtitle: 'Gyors vonalkód infó és készletlekérdezés',
    icon: 'pi pi-barcode',
    color: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  },
  {
    title: 'Leltározás (Stocktake)',
    subtitle: 'Polcok tételes megszámolása',
    icon: 'pi pi-check-square',
    color: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  },
]
</script>

<template>
  <div class="space-y-4">
    <div class="bg-slate-900/80 border border-slate-800 rounded-xl p-3 text-center">
      <p class="text-xs text-slate-400">Válassz raktári műveletet, vagy csippants le egy vonalkódot!</p>
    </div>

    <!-- Nagy, kesztyűben is könnyen megnyomható kártyagombok -->
    <div class="grid grid-cols-1 gap-3">
      <button
        v-for="task in pdaTasks"
        :key="task.title"
        class="flex items-center gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800 active:scale-[0.98] transition text-left"
      >
        <div :class="['w-12 h-12 rounded-xl border flex items-center justify-center shrink-0', task.color]">
          <i :class="[task.icon, 'text-2xl']"></i>
        </div>
        <div>
          <h2 class="font-semibold text-base text-white">{{ task.title }}</h2>
          <p class="text-xs text-slate-400 mt-0.5">{{ task.subtitle }}</p>
        </div>
      </button>
    </div>
  </div>
</template>