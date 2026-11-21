<script setup lang="ts">
import { useRouter } from 'vue-router'
import { Role } from '@wmanager/shared-types'
import { useToast } from 'primevue/usetoast'
import { useAuthStore } from '@/stores/auth'
import { useOfflinePutawayQueue } from '@/composables/useOfflinePutawayQueue'

interface PdaTask {
  id: string
  title: string
  subtitle: string
  icon: string
  color: string
  to?: string
  allowedRoles?: Role[]
}

const RECEIVING_ROLES: Role[] = [
  Role.ADMIN,
  Role.BOSS,
  Role.WAREHOUSE_MANAGER,
  Role.STORE_MANAGER,
  Role.WAREHOUSE_STAFF,
  Role.STORE_STAFF,
]

const pdaTasks: PdaTask[] = [
  {
    id: 'picking',
    title: 'Rendelés Kiszedés (Picking)',
    subtitle: 'Kiszedési lista polcról polcra',
    icon: 'pi pi-shopping-bag',
    color: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  },
  {
    id: 'receiving',
    title: 'Bevételezés & Elpakolás (Putaway)',
    subtitle: 'Termék csippantása és polchoz rendelése',
    icon: 'pi pi-inbox',
    color: 'bg-blue-50 text-blue-600 border-blue-200',
    to: '/pda/receiving',
    allowedRoles: RECEIVING_ROLES,
  },
  {
    id: 'lookup',
    title: 'Polc / Termék Ellenőrzés',
    subtitle: 'Gyors vonalkód infó és készletlekérdezés',
    icon: 'pi pi-barcode',
    color: 'bg-orange-50 text-orange-600 border-orange-200',
  },
  {
    id: 'stocktake',
    title: 'Leltározás (Stocktake)',
    subtitle: 'Polcok tételes megszámolása',
    icon: 'pi pi-check-square',
    color: 'bg-purple-50 text-purple-600 border-purple-200',
  },
]

const router = useRouter()
const authStore = useAuthStore()
const toast = useToast()
const { isOnline, totalPendingCount, totalFailedCount } = useOfflinePutawayQueue()

function canAccessTask(task: PdaTask): boolean {
  if (!task.allowedRoles || task.allowedRoles.length === 0) return true
  const role = authStore.user?.role
  return Boolean(role && task.allowedRoles.includes(role))
}

function handleTaskClick(task: PdaTask) {
  if (!task.to) {
    toast.add({
      severity: 'info',
      summary: 'Hamarosan elérhető',
      detail: `A(z) „${task.title}” modul a következő mérföldkőben érkezik.`,
      life: 3000,
    })
    return
  }

  if (!canAccessTask(task)) {
    toast.add({
      severity: 'warn',
      summary: 'Nincs jogosultság',
      detail: 'A jelenlegi szerepköröddel ez a PDA művelet nem nyitható meg.',
      life: 3500,
    })
    return
  }

  void router.push(task.to)
}
</script>

<template>
  <div class="space-y-4">
    <div class="bg-white border border-white rounded-2xl p-3.5 shadow-xs flex items-center justify-between gap-2">
      <p class="text-xs font-medium text-slate-600">
        Válassz raktári műveletet a folytatáshoz!
      </p>
      <span
        :class="[
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0',
          isOnline
            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
            : 'bg-amber-50 text-amber-800 border border-amber-300',
        ]"
      >
        <span
          :class="['w-2 h-2 rounded-full', isOnline ? 'bg-emerald-500' : 'bg-amber-500']"
        ></span>
        {{ isOnline ? 'Online' : 'Offline' }}
      </span>
    </div>

    <!-- Nagy, kesztyűben is könnyen megnyomható fehér Bento kártyagombok -->
    <div class="grid grid-cols-1 gap-3">
      <button
        v-for="task in pdaTasks"
        :key="task.id"
        type="button"
        @click="handleTaskClick(task)"
        :class="[
          'flex items-center gap-4 p-4 min-h-[82px] rounded-2xl bg-white border shadow-sm active:scale-[0.98] transition text-left cursor-pointer',
          task.to
            ? 'border-white hover:border-blue-300'
            : 'border-white/80 opacity-85 hover:border-slate-200',
        ]"
      >
        <div :class="['w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0', task.color]">
          <i :class="[task.icon, 'text-xl']"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <h2 class="font-bold text-base text-slate-900 leading-snug">{{ task.title }}</h2>
          </div>
          <p class="text-xs text-slate-500 mt-0.5">{{ task.subtitle }}</p>

          <div
            v-if="task.id === 'receiving' && (totalFailedCount > 0 || totalPendingCount > 0)"
            class="flex items-center gap-1.5 flex-wrap mt-2"
          >
            <span
              v-if="totalFailedCount > 0"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-700 border border-rose-200"
            >
              <i class="pi pi-exclamation-triangle text-[10px]"></i>
              {{ totalFailedCount }} hibás szinkron
            </span>
            <span
              v-if="totalPendingCount > 0"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200"
            >
              <i class="pi pi-clock text-[10px]"></i>
              {{ totalPendingCount }} offline sorban
            </span>
          </div>
        </div>
        <i
          :class="[
            'pi shrink-0 text-sm',
            task.to ? 'pi-chevron-right text-slate-400' : 'pi-lock text-slate-300',
          ]"
        ></i>
      </button>
    </div>
  </div>
</template>
