<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LocationType, SlotMode } from '@wmanager/shared-types'
import { locationApi, type LocationItem } from '@/api/locations'
import {
  LOCATION_TYPE_META,
  SLOT_MODE_META,
  extractApiError,
  getLocationPath,
  supportsSlotMode,
} from '@/utils/locationMeta'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'

const props = defineProps<{
  visible: boolean
  mode: 'create' | 'edit'
  initialType: LocationType
  initialParentId: string | null
  editingLocation: LocationItem | null
  allLocations: LocationItem[]
  canCreateRoot: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'saved', location: LocationItem): void
}>()

const toast = useToast()
const saving = ref(false)

const form = ref({
  name: '',
  description: '',
  type: LocationType.WAREHOUSE as LocationType,
  parentId: null as string | null,
  slotMode: null as SlotMode | null,
  isActive: true,
})

const locationById = computed(() => new Map(props.allLocations.map((l) => [l.id, l])))

const activeType = computed<LocationType>(() =>
  props.mode === 'edit' && props.editingLocation ? props.editingLocation.type : form.value.type,
)

const typeMeta = computed(() => LOCATION_TYPE_META[activeType.value])
const showSlotMode = computed(() => supportsSlotMode(activeType.value))
const requiresParent = computed(() => typeMeta.value.allowedParentTypes.length > 0)

const validParentOptions = computed(() => {
  const allowed = typeMeta.value.allowedParentTypes
  if (allowed.length === 0) return []
  return props.allLocations
    .filter((loc) => allowed.includes(loc.type) && loc.id !== props.editingLocation?.id)
    .map((loc) => ({
      id: loc.id,
      isActive: loc.isActive,
      label: getLocationPath(loc.id, locationById.value)
        .map((p) => p.name)
        .join(' › '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'hu'))
})

const selectedParentPathLabel = computed(() => {
  if (!form.value.parentId) return ''
  return getLocationPath(form.value.parentId, locationById.value)
    .map((p) => p.name)
    .join(' › ')
})

const dialogTitle = computed(() => {
  if (props.mode === 'edit' && props.editingLocation) {
    return `${LOCATION_TYPE_META[props.editingLocation.type].label} szerkesztése`
  }
  return `Új ${typeMeta.value.label.toLowerCase()} létrehozása`
})

watch(
  () => props.visible,
  (isOpen) => {
    if (!isOpen) return
    if (props.mode === 'edit' && props.editingLocation) {
      form.value = {
        name: props.editingLocation.name,
        description: props.editingLocation.description ?? '',
        type: props.editingLocation.type,
        parentId: props.editingLocation.parentId,
        slotMode: props.editingLocation.slotMode ?? null,
        isActive: props.editingLocation.isActive,
      }
    } else {
      form.value = {
        name: '',
        description: '',
        type: props.initialType,
        parentId: props.initialParentId,
        slotMode: null,
        isActive: true,
      }
    }
  },
)

function closeModal() {
  emit('update:visible', false)
}

async function handleSubmit() {
  const trimmedName = form.value.name.trim()
  if (!trimmedName) {
    toast.add({
      severity: 'error',
      summary: 'Hiányzó adat',
      detail: 'A lokáció neve kötelező.',
      life: 4000,
    })
    return
  }

  if (requiresParent.value && !form.value.parentId) {
    toast.add({
      severity: 'error',
      summary: 'Hiányzó szülő',
      detail: `A ${typeMeta.value.label.toLowerCase()} típushoz kötelező szülő lokációt választani.`,
      life: 4000,
    })
    return
  }

  saving.value = true
  try {
    let saved: LocationItem
    if (props.mode === 'create') {
      const res = await locationApi.create({
        name: trimmedName,
        description: form.value.description.trim() || undefined,
        type: form.value.type,
        parentId: requiresParent.value ? (form.value.parentId ?? undefined) : undefined,
        slotMode: showSlotMode.value && form.value.slotMode ? form.value.slotMode : undefined,
        isActive: form.value.isActive,
      })
      saved = res.data
      toast.add({
        severity: 'success',
        summary: 'Létrehozva',
        detail: `${typeMeta.value.label} („${saved.name}”) sikeresen létrehozva.`,
        life: 3500,
      })
    } else {
      if (!props.editingLocation) return
      const res = await locationApi.update(props.editingLocation.id, {
        name: trimmedName,
        description: form.value.description.trim() || null,
        parentId: requiresParent.value ? form.value.parentId : undefined,
        slotMode: showSlotMode.value ? form.value.slotMode : undefined,
        isActive: form.value.isActive,
      })
      saved = res.data
      toast.add({
        severity: 'success',
        summary: 'Mentve',
        detail: `„${saved.name}” adatai frissítve.`,
        life: 3500,
      })
    }

    emit('saved', saved)
    closeModal()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Hiba történt',
      detail: extractApiError(err, 'Nem sikerült menteni a lokációt.'),
      life: 5000,
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="(val) => emit('update:visible', val)"
    modal
    :header="dialogTitle"
    :style="{ width: '32rem', maxWidth: '95vw' }"
  >
    <form @submit.prevent="handleSubmit" class="space-y-4 pt-1">
      <!-- Gyökér típus választó (új raktár/üzlet létrehozásakor) -->
      <div v-if="mode === 'create' && !initialParentId && canCreateRoot" class="space-y-1.5">
        <label class="block text-xs font-medium text-[#686f6a]">Lokáció típusa</label>
        <div class="grid grid-cols-2 gap-2.5">
          <button
            v-for="rootType in [LocationType.WAREHOUSE, LocationType.STORE]"
            :key="rootType"
            type="button"
            @click="form.type = rootType"
            class="h-[44px] rounded-[12px] border px-3 flex items-center justify-center gap-2 text-xs font-semibold transition cursor-pointer"
            :class="
              form.type === rootType
                ? 'bg-[#171918] text-white border-[#171918] shadow-xs'
                : 'bg-[#f6f7f5] text-[#171918] border-[#e3e6e0] hover:bg-white'
            "
          >
            <i :class="LOCATION_TYPE_META[rootType].icon"></i>
            <span>{{ LOCATION_TYPE_META[rootType].label }}</span>
          </button>
        </div>
      </div>

      <!-- Típus jelvény al-lokációnál vagy szerkesztésnél -->
      <div v-else class="flex items-center justify-between bg-[#f6f7f5] rounded-[12px] px-3.5 py-2.5 border border-[#e8eae6]">
        <div class="flex items-center gap-2.5 min-w-0">
          <div :class="['size-8 rounded-[9px] flex items-center justify-center shrink-0', typeMeta.iconBgClass]">
            <i :class="[typeMeta.icon, 'text-xs']"></i>
          </div>
          <div class="min-w-0">
            <p class="text-xs font-semibold text-[#171918]">{{ typeMeta.label }}</p>
            <p v-if="selectedParentPathLabel" class="text-[11px] text-[#686f6a] truncate">
              Szülő: {{ selectedParentPathLabel }}
            </p>
          </div>
        </div>
        <span :class="['text-[10px] font-semibold px-2 py-0.5 rounded-md', typeMeta.badgeClass]">
          {{ activeType }}
        </span>
      </div>

      <!-- Szülő választó (al-lokációknál létrehozáskor vagy áthelyezéshez szerkesztéskor) -->
      <div v-if="requiresParent" class="space-y-1.5">
        <label class="block text-xs font-medium text-[#686f6a]">
          {{ mode === 'edit' ? 'Szülő lokáció (áthelyezés)' : 'Szülő lokáció' }}
        </label>
        <select
          v-model="form.parentId"
          required
          class="w-full h-[40px] rounded-[10px] border border-[#dce0d8] bg-white px-3 text-sm text-[#171918] outline-none focus:border-[#f46714]"
        >
          <option :value="null" disabled>Válassz szülő lokációt...</option>
          <option v-for="opt in validParentOptions" :key="opt.id" :value="opt.id">
            {{ opt.label }}{{ !opt.isActive ? ' (inaktív)' : '' }}
          </option>
        </select>
      </div>

      <!-- Név -->
      <div class="space-y-1.5">
        <label class="block text-xs font-medium text-[#686f6a]">Megnevezés / Kód *</label>
        <input
          v-model="form.name"
          type="text"
          required
          maxlength="150"
          :placeholder="
            activeType === LocationType.WAREHOUSE
              ? 'pl. Központi Raktár – Budapest'
              : activeType === LocationType.STORE
                ? 'pl. Győri Motoros Szaküzlet'
                : activeType === LocationType.ZONE
                  ? 'pl. A Zóna (Bukósisakok)'
                  : activeType === LocationType.SHELF
                    ? 'pl. A-01'
                    : 'pl. A-01-1'
          "
          class="w-full h-[40px] rounded-[10px] border border-[#dce0d8] bg-white px-3 text-sm text-[#171918] outline-none focus:border-[#f46714]"
        />
      </div>

      <!-- Leírás -->
      <div class="space-y-1.5">
        <label class="block text-xs font-medium text-[#686f6a]">Leírás / Megjegyzés</label>
        <textarea
          v-model="form.description"
          rows="2"
          maxlength="1000"
          placeholder="Opcionális megjegyzés (pl. teherbírás, hűtött, kiemelt polc)..."
          class="w-full rounded-[10px] border border-[#dce0d8] bg-white px-3 py-2 text-sm text-[#171918] outline-none focus:border-[#f46714] resize-none"
        ></textarea>
      </div>

      <!-- Tárhely mód (slotMode) csak ZONE / SHELF / BIN esetén -->
      <div v-if="showSlotMode" class="space-y-1.5">
        <label class="block text-xs font-medium text-[#686f6a]">Tárhely tárolási mód (SlotMode)</label>
        <div class="grid grid-cols-3 gap-2">
          <button
            type="button"
            @click="form.slotMode = null"
            class="rounded-[10px] border px-2.5 py-2 text-left transition cursor-pointer"
            :class="
              form.slotMode === null
                ? 'bg-[#171918] text-white border-[#171918]'
                : 'bg-[#f6f7f5] text-[#171918] border-[#e3e6e0] hover:bg-white'
            "
          >
            <p class="text-[11px] font-semibold">Alapért.</p>
            <p class="text-[10px] opacity-75 leading-tight mt-0.5">Nincs megadva</p>
          </button>

          <button
            v-for="sm in [SlotMode.MIXED, SlotMode.DEDICATED]"
            :key="sm"
            type="button"
            @click="form.slotMode = sm"
            class="rounded-[10px] border px-2.5 py-2 text-left transition cursor-pointer"
            :class="
              form.slotMode === sm
                ? 'bg-[#171918] text-white border-[#171918]'
                : 'bg-[#f6f7f5] text-[#171918] border-[#e3e6e0] hover:bg-white'
            "
          >
            <p class="text-[11px] font-semibold">{{ SLOT_MODE_META[sm].shortLabel }}</p>
            <p class="text-[10px] opacity-75 leading-tight mt-0.5">
              {{ sm === SlotMode.DEDICATED ? '1 variáns' : 'Több variáns' }}
            </p>
          </button>
        </div>
        <p v-if="form.slotMode" class="text-[11px] text-[#686f6a]">
          {{ SLOT_MODE_META[form.slotMode].description }}
        </p>
      </div>

      <!-- Aktív státusz -->
      <label class="flex items-center justify-between bg-[#f6f7f5] border border-[#e8eae6] rounded-[12px] px-3.5 py-2.5 cursor-pointer">
        <div>
          <p class="text-xs font-semibold text-[#171918]">Aktív pozíció</p>
          <p class="text-[11px] text-[#686f6a]">Inaktív pozícióra nem végezhető új készletmozgatás.</p>
        </div>
        <input
          v-model="form.isActive"
          type="checkbox"
          class="size-4 accent-[#171918] cursor-pointer"
        />
      </label>

      <div class="flex justify-end gap-2 pt-2 border-t border-[#e8eae6]">
        <button
          type="button"
          @click="closeModal"
          class="h-[38px] px-4 rounded-[10px] bg-white border border-[#dce0d8] text-xs font-medium text-[#171918] hover:bg-[#f6f7f5] cursor-pointer"
        >
          Mégse
        </button>
        <button
          type="submit"
          :disabled="saving"
          class="h-[38px] px-5 rounded-[10px] bg-[#171918] hover:bg-[#2a2d2b] disabled:opacity-60 text-xs font-medium text-white flex items-center gap-2 cursor-pointer"
        >
          <i v-if="saving" class="pi pi-spin pi-spinner text-xs"></i>
          <span>{{ mode === 'create' ? 'Létrehozás' : 'Mentés' }}</span>
        </button>
      </div>
    </form>
  </Dialog>
</template>
