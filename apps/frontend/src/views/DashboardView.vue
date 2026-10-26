<script setup lang="ts">
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()

// Moduláris widget adatok (ezeket később adatbázisból is lekérhetjük)
const kpiStats = [
  { label: 'Aktív Rendelések', value: '58', trend: '+2.5%', isUp: true, icon: 'pi pi-box' },
  { label: 'Függő Bevételezés', value: '10', trend: '+1.5%', isUp: true, icon: 'pi pi-truck' },
  { label: 'Raktár Telítettség', value: '86%', trend: '-3.5%', isUp: false, icon: 'pi pi-chart-pie' },
  { label: 'Kiszállítás Alatt', value: '130', trend: '+2.0%', isUp: true, icon: 'pi pi-send' },
]
</script>

<template>
  <div class="max-w-7xl mx-auto space-y-6">
    <!-- Fejléc és moduláris gyors-statisztikák -->
    <div class="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">Áttekintés</h1>
        <p class="text-slate-500 text-sm mt-1">Üdv újra! Itt a mai raktári összesítőd.</p>
      </div>

      <!-- KPI Kártyák (Widgetek) -->
      <div class="flex gap-4 overflow-x-auto pb-2 xl:pb-0">
        <div v-for="stat in kpiStats" :key="stat.label" class="bg-white rounded-2xl p-4 min-w-[200px] border border-slate-200 shadow-sm flex items-center gap-4">
          <div class="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-slate-600">
            <i :class="stat.icon"></i>
          </div>
          <div>
            <p class="text-[11px] font-bold text-slate-400 uppercase tracking-wide">{{ stat.label }}</p>
            <div class="flex items-end gap-2 mt-1">
              <span class="text-xl font-black text-slate-900 leading-none">{{ stat.value }}</span>
              <span :class="['text-xs font-bold px-1.5 py-0.5 rounded-md', stat.isUp ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700']">
                {{ stat.trend }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Moduláris Grid Rendszer a nagy kártyáknak -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      
      <!-- FŐ WIDGET (Illusztrációval) -->
      <div class="lg:col-span-2 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden flex flex-col relative">
        <div class="p-6 pb-0 flex justify-between items-start">
          <div>
            <h2 class="font-bold text-slate-900">Kiemelt Szállítmány / Feladat</h2>
            <p class="text-sm text-slate-500">TRK-318 azonosítójú beérkező áru</p>
          </div>
          <button class="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex justify-center items-center text-slate-600 transition">
            <i class="pi pi-ellipsis-h"></i>
          </button>
        </div>
        <!-- Illusztráció helye (később ide jöhet saját 3D render vagy grafika) -->
        <div class="relative h-64 mt-4 bg-gradient-to-br from-slate-50 to-slate-100 flex justify-center items-center">
           <!-- Placeholder egy szép 3D teherautónak vagy doboznak -->
           <img src="https://cdn3d.iconscout.com/3d/premium/thumb/delivery-truck-4993635-4161118.png" alt="Truck" class="h-56 object-contain drop-shadow-2xl z-10" />
           
           <!-- Díszítő háttérelem -->
           <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 bg-orange-400/20 blur-3xl rounded-full"></div>
        </div>
      </div>

      <!-- JOBB OLDALI WIDGET OSZLOP -->
      <div class="space-y-6">
        <!-- Kapacitás Widget -->
        <div class="bg-white/60 rounded-3xl border border-slate-200 shadow-sm p-5 backdrop-blur-xl">
          <h3 class="font-bold text-slate-900 mb-4">Raktár Kapacitás</h3>
          <div class="flex items-center gap-6">
            <div class="relative w-24 h-24 flex items-center justify-center">
              <!-- Ide jöhet egy PrimeVue Knob vagy Chart komponens -->
              <svg class="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                <path class="text-slate-100" stroke-width="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                <path class="text-orange-500" stroke-dasharray="68, 100" stroke-width="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
              </svg>
              <div class="absolute text-center">
                <span class="text-xl font-black text-slate-900">68%</span>
              </div>
            </div>
            <div>
              <p class="text-xs text-slate-500 uppercase font-bold">Foglalt</p>
              <p class="text-lg font-bold text-slate-900">8.5 ezer</p>
              <p class="text-xs text-slate-500 mt-2 uppercase font-bold">Összesen</p>
              <p class="text-sm font-bold text-slate-900">12.4 ezer</p>
            </div>
          </div>
        </div>

        <!-- Munkatársak Widget -->
        <div class="bg-slate-900 rounded-3xl border border-slate-800 shadow-lg p-6 text-white relative overflow-hidden">
          <div class="absolute right-0 top-0 opacity-10 text-9xl -mt-4 -mr-4 pointer-events-none">
            <i class="pi pi-users"></i>
          </div>
          <h3 class="font-bold mb-1">Műszak Információ</h3>
          <p class="text-sm text-slate-400 mb-4">Jelenleg aktív dolgozók</p>
          <div class="flex items-center gap-3">
             <div class="flex -space-x-3">
               <div class="w-10 h-10 rounded-full border-2 border-slate-900 bg-emerald-500 flex items-center justify-center font-bold">JD</div>
               <div class="w-10 h-10 rounded-full border-2 border-slate-900 bg-blue-500 flex items-center justify-center font-bold">AB</div>
               <div class="w-10 h-10 rounded-full border-2 border-slate-900 bg-orange-500 flex items-center justify-center font-bold">KT</div>
             </div>
             <div class="w-10 h-10 rounded-full border-2 border-slate-900 bg-slate-800 flex items-center justify-center font-bold text-sm">+4</div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>