<script setup lang="ts">
const pdaTasks = [
  {
    title: 'Rendelés Kiszedés (Picking)',
    subtitle: 'Kiszedési lista polcról polcra',
    icon: 'pi pi-shopping-bag',
    color: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  },
  {
    title: 'Bevételezés & Elpakolás (Putaway)',
    subtitle: 'Termék csippantása és polchoz rendelése',
    icon: 'pi pi-inbox',
    color: 'bg-blue-50 text-blue-600 border-blue-200',
  },
  {
    title: 'Polc / Termék Ellenőrzés',
    subtitle: 'Gyors vonalkód infó és készletlekérdezés',
    icon: 'pi pi-barcode',
    color: 'bg-orange-50 text-orange-600 border-orange-200',
  },
  {
    title: 'Leltározás (Stocktake)',
    subtitle: 'Polcok tételes megszámolása',
    icon: 'pi pi-check-square',
    color: 'bg-purple-50 text-purple-600 border-purple-200',
  },
]
</script>

<template>
  <div class="space-y-4">
    <div class="bg-white border border-white rounded-2xl p-3.5 text-center shadow-xs">
      <p class="text-xs font-medium text-slate-500">
        Válassz raktári műveletet, vagy csippants le egy vonalkódot!
      </p>
    </div>

    <!-- Nagy, kesztyűben is könnyen megnyomható fehér Bento kártyagombok -->
    <div class="grid grid-cols-1 gap-3">
      <button
        v-for="task in pdaTasks"
        :key="task.title"
        type="button"
        class="flex items-center gap-4 p-4 rounded-2xl bg-white border border-white shadow-sm hover:border-orange-200 active:scale-[0.98] transition text-left cursor-pointer"
      >
        <div :class="['w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0', task.color]">
          <i :class="[task.icon, 'text-xl']"></i>
        </div>
        <div>
          <h2 class="font-bold text-base text-slate-900">{{ task.title }}</h2>
          <p class="text-xs text-slate-500 mt-0.5">{{ task.subtitle }}</p>
        </div>
      </button>
    </div>
  </div>
</template>