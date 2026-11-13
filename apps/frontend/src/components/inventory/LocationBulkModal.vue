<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LocationType, SlotMode } from '@wmanager/shared-types'
import {
  locationApi,
  type BulkCreateLocationsResult,
  type BulkLocationItemPayload,
  type LocationItem,
} from '@/api/locations'
import {
  LOCATION_TYPE_META,
  SLOT_MODE_META,
  extractApiError,
  getLocationPath,
} from '@/utils/locationMeta'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'

const MAX_BULK_COUNT = 500

const props = defineProps<{
  visible: boolean
  initialParentId: string | null
  allLocations: LocationItem[]
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'created', result: BulkCreateLocationsResult): void
}>()

const toast = useToast()
const saving = ref(false)
const activeMode = ref<'sequence' | 'grid'>('sequence')
const selectedParentId = ref<string>('')
const skipDuplicates = ref(true)
const isActive = ref(true)
const slotMode = ref<SlotMode | null>(null)

// Sorozat mód mezők (pl. A-01 ... A-20)
const seqForm = ref({
  prefix: 'A-',
  suffix: '',
  start: 1,
  end: 20,
  padLength: 2,
  description: '',
})

// Rács mód mezők (Sor × Oszlop × Szint)
const gridForm = ref({
  rowKind: 'letters' as 'letters' | 'numbers',
  rowStartLetter: 'A',
  rowEndLetter: 'B',
  rowStartNum: 1,
  rowEndNum: 2,
  colStart: 1,
  colEnd: 5,
  colPadLength: 2,
  includeBins: true,
  levelKind: 'numbers' as 'numbers' | 'letters',
  levelStartNum: 1,
  levelEndNum: 4,
  levelStartLetter: 'A',
  levelEndLetter: 'D',
  separator: '-',
})

const locationById = computed(() => new Map(props.allLocations.map((l) => [l.id, l])))

const eligibleParents = computed(() => {
  return props.allLocations
    .filter((loc) => LOCATION_TYPE_META[loc.type].childType !== null)
    .map((loc) => ({
      id: loc.id,
      type: loc.type,
      isActive: loc.isActive,
      label: getLocationPath(loc.id, locationById.value)
        .map((p) => p.name)
        .join(' › '),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'hu'))
})

const selectedParent = computed(() =>
  selectedParentId.value ? locationById.value.get(selectedParentId.value) ?? null : null,
)

const targetChildType = computed<LocationType | null>(() => {
  if (!selectedParent.value) return null
  return LOCATION_TYPE_META[selectedParent.value.type].childType
})

const canUseGridMode = computed(() => {
  const pType = selectedParent.value?.type
  return pType === LocationType.ZONE || pType === LocationType.SHELF
})

function applyDefaultPrefix(childType: LocationType | null) {
  if (childType === LocationType.ZONE) {
    seqForm.value.prefix = 'Zóna '
    seqForm.value.padLength = 1
    seqForm.value.start = 1
    seqForm.value.end = 4
  } else if (childType === LocationType.SHELF) {
    seqForm.value.prefix = 'A-'
    seqForm.value.padLength = 2
    seqForm.value.start = 1
    seqForm.value.end = 10
  } else if (childType === LocationType.BIN) {
    seqForm.value.prefix = 'B-'
    seqForm.value.padLength = 2
    seqForm.value.start = 1
    seqForm.value.end = 8
  }
}

watch(
  () => props.visible,
  (isOpen) => {
    if (!isOpen) return
    const fallbackParent = eligibleParents.value[0]?.id ?? ''
    const hasInitial =
      props.initialParentId &&
      eligibleParents.value.some((p) => p.id === props.initialParentId)
    selectedParentId.value = hasInitial ? (props.initialParentId as string) : fallbackParent
    activeMode.value = 'sequence'
    skipDuplicates.value = true
    isActive.value = true
    slotMode.value = null
    applyDefaultPrefix(targetChildType.value)
  },
)

watch(selectedParentId, () => {
  applyDefaultPrefix(targetChildType.value)
  if (!canUseGridMode.value && activeMode.value === 'grid') {
    activeMode.value = 'sequence'
  }
})

function expandLetterRange(startChar: string, endChar: string): string[] {
  const s = startChar.trim().toUpperCase().charCodeAt(0)
  const e = endChar.trim().toUpperCase().charCodeAt(0)
  if (Number.isNaN(s) || Number.isNaN(e) || s < 65 || e > 90 || s > e) return []
  const out: string[] = []
  for (let c = s; c <= e; c++) {
    out.push(String.fromCharCode(c))
  }
  return out
}

function expandNumberRange(start: number, end: number, pad = 0): string[] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end) return []
  const out: string[] = []
  for (let n = start; n <= end && out.length <= MAX_BULK_COUNT + 1; n++) {
    out.push(pad > 0 ? String(n).padStart(pad, '0') : String(n))
  }
  return out
}

const sequencePreview = computed(() => {
  const start = Number(seqForm.value.start)
  const end = Number(seqForm.value.end)
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end) {
    return { valid: false, count: 0, samples: [] as string[], error: 'Érvénytelen sorszám-tartomány.' }
  }
  const count = end - start + 1
  if (count > MAX_BULK_COUNT) {
    return {
      valid: false,
      count,
      samples: [] as string[],
      error: `Egyszerre legfeljebb ${MAX_BULK_COUNT} pozíció generálható (jelenleg: ${count}).`,
    }
  }
  const samples: string[] = []
  const pad = Math.max(1, Number(seqForm.value.padLength) || 1)
  for (let i = start; i <= Math.min(end, start + 5); i++) {
    const num = pad > 1 ? String(i).padStart(pad, '0') : String(i)
    samples.push(`${seqForm.value.prefix}${num}${seqForm.value.suffix}`.trim())
  }
  if (end - start >= 6) {
    const lastNum = pad > 1 ? String(end).padStart(pad, '0') : String(end)
    samples.push('…')
    samples.push(`${seqForm.value.prefix}${lastNum}${seqForm.value.suffix}`.trim())
  }
  return { valid: count > 0, count, samples, error: '' }
})

const gridItemsAndStats = computed(() => {
  const parent = selectedParent.value
  if (!parent || !canUseGridMode.value) {
    return { valid: false, totalCount: 0, shelfCount: 0, binCount: 0, items: [] as BulkLocationItemPayload[], error: 'Válassz Zóna vagy Polc szülőt a rács generáláshoz.' }
  }

  const sep = gridForm.value.separator ?? '-'
  const cols = expandNumberRange(
    Number(gridForm.value.colStart),
    Number(gridForm.value.colEnd),
    Math.max(1, Number(gridForm.value.colPadLength) || 1),
  )
  if (cols.length === 0) {
    return { valid: false, totalCount: 0, shelfCount: 0, binCount: 0, items: [] as BulkLocationItemPayload[], error: 'Érvénytelen oszlop-tartomány.' }
  }

  const levels =
    gridForm.value.levelKind === 'letters'
      ? expandLetterRange(gridForm.value.levelStartLetter, gridForm.value.levelEndLetter)
      : expandNumberRange(Number(gridForm.value.levelStartNum), Number(gridForm.value.levelEndNum), 0)

  if (parent.type === LocationType.SHELF) {
    if (levels.length === 0) {
      return { valid: false, totalCount: 0, shelfCount: 0, binCount: 0, items: [] as BulkLocationItemPayload[], error: 'Érvénytelen szint-tartomány.' }
    }
    const totalCount = cols.length * levels.length
    if (totalCount > MAX_BULK_COUNT) {
      return { valid: false, totalCount, shelfCount: 0, binCount: totalCount, items: [] as BulkLocationItemPayload[], error: `Túl sok pozíció (${totalCount} > ${MAX_BULK_COUNT}).` }
    }
    const items: BulkLocationItemPayload[] = []
    for (const col of cols) {
      for (const lvl of levels) {
        items.push({
          name: `${col}${sep}${lvl}`,
          type: LocationType.BIN,
          slotMode: slotMode.value ?? undefined,
          isActive: isActive.value,
        })
      }
    }
    return { valid: items.length > 0, totalCount, shelfCount: 0, binCount: totalCount, items, error: '' }
  }

  // ZONE alatt: Sor × Oszlop = SHELF, Szint = BIN
  const rows =
    gridForm.value.rowKind === 'letters'
      ? expandLetterRange(gridForm.value.rowStartLetter, gridForm.value.rowEndLetter)
      : expandNumberRange(Number(gridForm.value.rowStartNum), Number(gridForm.value.rowEndNum), 0)

  if (rows.length === 0) {
    return { valid: false, totalCount: 0, shelfCount: 0, binCount: 0, items: [] as BulkLocationItemPayload[], error: 'Érvénytelen sor-tartomány (A–Z vagy pozitív számok).' }
  }

  if (gridForm.value.includeBins && levels.length === 0) {
    return { valid: false, totalCount: 0, shelfCount: 0, binCount: 0, items: [] as BulkLocationItemPayload[], error: 'Érvénytelen szint-tartomány.' }
  }

  const shelfCount = rows.length * cols.length
  const binCount = gridForm.value.includeBins ? shelfCount * levels.length : 0
  const totalCount = shelfCount + binCount

  if (totalCount > MAX_BULK_COUNT) {
    return {
      valid: false,
      totalCount,
      shelfCount,
      binCount,
      items: [] as BulkLocationItemPayload[],
      error: `Egyszerre legfeljebb ${MAX_BULK_COUNT} pozíció hozható létre (jelenleg: ${totalCount}).`,
    }
  }

  const items: BulkLocationItemPayload[] = []
  for (const row of rows) {
    for (const col of cols) {
      const shelfName = `${row}${sep}${col}`
      const binChildren: BulkLocationItemPayload[] | undefined = gridForm.value.includeBins
        ? levels.map((lvl) => ({
            name: `${shelfName}${sep}${lvl}`,
            type: LocationType.BIN,
            slotMode: slotMode.value ?? undefined,
            isActive: isActive.value,
          }))
        : undefined

      items.push({
        name: shelfName,
        type: LocationType.SHELF,
        slotMode: slotMode.value ?? undefined,
        isActive: isActive.value,
        children: binChildren,
      })
    }
  }

  return { valid: items.length > 0, totalCount, shelfCount, binCount, items, error: '' }
})

const canSubmit = computed(() => {
  if (!selectedParentId.value || !targetChildType.value || saving.value) return false
  if (activeMode.value === 'sequence') return sequencePreview.value.valid
  return gridItemsAndStats.value.valid
})

async function handleSubmit() {
  if (!canSubmit.value || !targetChildType.value) return
  saving.value = true
  try {
    let result: BulkCreateLocationsResult
    if (activeMode.value === 'sequence') {
      const res = await locationApi.bulkCreate({
        parentId: selectedParentId.value,
        type: targetChildType.value,
        prefix: seqForm.value.prefix,
        suffix: seqForm.value.suffix || undefined,
        start: Number(seqForm.value.start),
        end: Number(seqForm.value.end),
        padLength: Math.max(1, Number(seqForm.value.padLength) || 1),
        slotMode: slotMode.value ?? undefined,
        description: seqForm.value.description.trim() || undefined,
        isActive: isActive.value,
        skipDuplicates: skipDuplicates.value,
      })
      result = res.data
    } else {
      const res = await locationApi.bulkCreate({
        parentId: selectedParentId.value,
        skipDuplicates: skipDuplicates.value,
        items: gridItemsAndStats.value.items,
      })
      result = res.data
    }

    const msgParts = [`${result.createdCount} új pozíció létrehozva`]
    if (result.skippedCount > 0) {
      msgParts.push(`${result.skippedCount} meglévő kihagyva`)
    }
    toast.add({
      severity: 'success',
      summary: 'Tömeges generálás kész',
      detail: msgParts.join(', ') + '.',
      life: 4000,
    })

    emit('created', result)
    emit('update:visible', false)
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Hiba történt',
      detail: extractApiError(err, 'Nem sikerült a pozíciók tömeges létrehozása.'),
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
    header="Tömeges pozíció-generátor"
    :style="{ width: '40rem', maxWidth: '95vw' }"
  >
    <form @submit.prevent="handleSubmit" class="space-y-4 pt-1">
      <!-- Szülő lokáció -->
      <div class="space-y-1.5">
        <label class="block text-xs font-medium text-[#686f6a]">Cél szülő lokáció *</label>
        <select
          v-model="selectedParentId"
          required
          class="w-full h-[40px] rounded-[10px] border border-[#dce0d8] bg-white px-3 text-sm text-[#171918] outline-none focus:border-[#f46714]"
        >
          <option v-for="p in eligibleParents" :key="p.id" :value="p.id">
            {{ p.label }} ({{ LOCATION_TYPE_META[p.type].label }})
          </option>
        </select>
      </div>

      <!-- Mód választó (Sorozat vs Rács) -->
      <div class="grid grid-cols-2 gap-2 p-1 bg-[#eff1ed] rounded-[12px]">
        <button
          type="button"
          @click="activeMode = 'sequence'"
          class="h-[36px] rounded-[9px] text-xs font-semibold transition cursor-pointer flex items-center justify-center gap-2"
          :class="
            activeMode === 'sequence'
              ? 'bg-white text-[#171918] shadow-2xs'
              : 'text-[#686f6a] hover:text-[#171918]'
          "
        >
          <i class="pi pi-sort-numeric-up text-xs"></i>
          <span>Sorozat (pl. A-01 … A-20)</span>
        </button>

        <button
          type="button"
          :disabled="!canUseGridMode"
          @click="canUseGridMode && (activeMode = 'grid')"
          class="h-[36px] rounded-[9px] text-xs font-semibold transition flex items-center justify-center gap-2"
          :class="[
            activeMode === 'grid'
              ? 'bg-white text-[#171918] shadow-2xs'
              : 'text-[#686f6a] hover:text-[#171918]',
            !canUseGridMode ? 'opacity-45 cursor-not-allowed' : 'cursor-pointer',
          ]"
          :title="canUseGridMode ? '' : 'Rács mód Zóna vagy Polc szülő esetén használható'"
        >
          <i class="pi pi-table text-xs"></i>
          <span>Rács (Sor × Oszlop × Szint)</span>
        </button>
      </div>

      <!-- 1. MÓD: SOROZAT -->
      <div v-if="activeMode === 'sequence'" class="space-y-3 bg-[#f6f7f5] border border-[#e8eae6] rounded-[14px] p-4">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-[#171918]">
            Létrejövő típus:
            <span v-if="targetChildType" class="text-[#f46714]">
              {{ LOCATION_TYPE_META[targetChildType].label }} ({{ targetChildType }})
            </span>
          </span>
          <span class="text-[11px] text-[#686f6a]">Max. {{ MAX_BULK_COUNT }} db / művelet</span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
          <div class="col-span-2 sm:col-span-2 space-y-1">
            <label class="block text-[11px] font-medium text-[#686f6a]">Előtag</label>
            <input
              v-model="seqForm.prefix"
              type="text"
              maxlength="50"
              placeholder="A-"
              class="w-full h-[38px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm outline-none focus:border-[#f46714]"
            />
          </div>

          <div class="space-y-1">
            <label class="block text-[11px] font-medium text-[#686f6a]">Kezdő</label>
            <input
              v-model.number="seqForm.start"
              type="number"
              min="0"
              max="9999"
              class="w-full h-[38px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm outline-none focus:border-[#f46714]"
            />
          </div>

          <div class="space-y-1">
            <label class="block text-[11px] font-medium text-[#686f6a]">Záró</label>
            <input
              v-model.number="seqForm.end"
              type="number"
              min="0"
              max="9999"
              class="w-full h-[38px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm outline-none focus:border-[#f46714]"
            />
          </div>

          <div class="space-y-1">
            <label class="block text-[11px] font-medium text-[#686f6a]">Számjegyek</label>
            <select
              v-model.number="seqForm.padLength"
              class="w-full h-[38px] rounded-[9px] border border-[#dce0d8] bg-white px-2 text-xs outline-none"
            >
              <option :value="1">1 (1, 2…)</option>
              <option :value="2">2 (01, 02…)</option>
              <option :value="3">3 (001…)</option>
            </select>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div class="space-y-1">
            <label class="block text-[11px] font-medium text-[#686f6a]">Utótag (opcionális)</label>
            <input
              v-model="seqForm.suffix"
              type="text"
              maxlength="50"
              placeholder="pl. -POLC"
              class="w-full h-[38px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm outline-none focus:border-[#f46714]"
            />
          </div>
          <div class="space-y-1">
            <label class="block text-[11px] font-medium text-[#686f6a]">Megjegyzés (opcionális)</label>
            <input
              v-model="seqForm.description"
              type="text"
              maxlength="200"
              placeholder="pl. Standard polcos sor"
              class="w-full h-[38px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm outline-none focus:border-[#f46714]"
            />
          </div>
        </div>

        <!-- Előnézet -->
        <div class="bg-white rounded-[10px] border border-[#e3e6e0] p-3">
          <div v-if="sequencePreview.error" class="text-xs text-rose-600 font-medium">
            {{ sequencePreview.error }}
          </div>
          <div v-else>
            <p class="text-[11px] font-semibold text-[#171918] mb-1.5">
              Előnézet ({{ sequencePreview.count }} db):
            </p>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="(sample, idx) in sequencePreview.samples"
                :key="idx"
                class="text-[11px] font-mono px-2 py-0.5 rounded-md bg-[#eff1ed] text-[#171918]"
              >
                {{ sample }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- 2. MÓD: RÁCS (Sor × Oszlop × Szint) -->
      <div v-else class="space-y-3 bg-[#f6f7f5] border border-[#e8eae6] rounded-[14px] p-4">
        <!-- Sorok (csak Zóna szülőnél) -->
        <div v-if="selectedParent?.type === LocationType.ZONE" class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-xs font-semibold text-[#171918]">1. Sorok (Polc előtag)</label>
            <div class="flex gap-1 text-[11px]">
              <button
                type="button"
                @click="gridForm.rowKind = 'letters'"
                class="px-2 py-0.5 rounded-md cursor-pointer"
                :class="gridForm.rowKind === 'letters' ? 'bg-[#171918] text-white' : 'bg-white text-[#686f6a]'"
              >
                Betűk (A–Z)
              </button>
              <button
                type="button"
                @click="gridForm.rowKind = 'numbers'"
                class="px-2 py-0.5 rounded-md cursor-pointer"
                :class="gridForm.rowKind === 'numbers' ? 'bg-[#171918] text-white' : 'bg-white text-[#686f6a]'"
              >
                Számok
              </button>
            </div>
          </div>

          <div v-if="gridForm.rowKind === 'letters'" class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="block text-[11px] text-[#686f6a] mb-1">Kezdő betű</label>
              <input
                v-model="gridForm.rowStartLetter"
                maxlength="1"
                class="w-full h-[36px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm uppercase outline-none"
              />
            </div>
            <div>
              <label class="block text-[11px] text-[#686f6a] mb-1">Záró betű</label>
              <input
                v-model="gridForm.rowEndLetter"
                maxlength="1"
                class="w-full h-[36px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm uppercase outline-none"
              />
            </div>
          </div>

          <div v-else class="grid grid-cols-2 gap-2.5">
            <div>
              <label class="block text-[11px] text-[#686f6a] mb-1">Kezdő sor</label>
              <input
                v-model.number="gridForm.rowStartNum"
                type="number"
                min="1"
                max="99"
                class="w-full h-[36px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm outline-none"
              />
            </div>
            <div>
              <label class="block text-[11px] text-[#686f6a] mb-1">Záró sor</label>
              <input
                v-model.number="gridForm.rowEndNum"
                type="number"
                min="1"
                max="99"
                class="w-full h-[36px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm outline-none"
              />
            </div>
          </div>
        </div>

        <!-- Oszlopok -->
        <div class="space-y-1.5 pt-1 border-t border-[#e5e8e1]">
          <label class="block text-xs font-semibold text-[#171918]">
            {{ selectedParent?.type === LocationType.ZONE ? '2. Oszlopok (Polcok)' : '1. Oszlopok' }}
          </label>
          <div class="grid grid-cols-3 gap-2.5">
            <div>
              <label class="block text-[11px] text-[#686f6a] mb-1">Kezdő</label>
              <input
                v-model.number="gridForm.colStart"
                type="number"
                min="1"
                max="999"
                class="w-full h-[36px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm outline-none"
              />
            </div>
            <div>
              <label class="block text-[11px] text-[#686f6a] mb-1">Záró</label>
              <input
                v-model.number="gridForm.colEnd"
                type="number"
                min="1"
                max="999"
                class="w-full h-[36px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm outline-none"
              />
            </div>
            <div>
              <label class="block text-[11px] text-[#686f6a] mb-1">Számjegyek</label>
              <select
                v-model.number="gridForm.colPadLength"
                class="w-full h-[36px] rounded-[9px] border border-[#dce0d8] bg-white px-2 text-xs outline-none"
              >
                <option :value="1">1 (1, 2…)</option>
                <option :value="2">2 (01, 02…)</option>
              </select>
            </div>
          </div>
        </div>

        <!-- Szintek / Rekeszek -->
        <div class="space-y-2 pt-1 border-t border-[#e5e8e1]">
          <div class="flex items-center justify-between">
            <label class="flex items-center gap-2 text-xs font-semibold text-[#171918] cursor-pointer">
              <input
                v-if="selectedParent?.type === LocationType.ZONE"
                v-model="gridForm.includeBins"
                type="checkbox"
                class="size-4 accent-[#171918] cursor-pointer"
              />
              <span>
                {{
                  selectedParent?.type === LocationType.ZONE
                    ? '3. Szintek / Rekeszek (BIN) létrehozása minden polc alá'
                    : '2. Szintek (Rekeszek)'
                }}
              </span>
            </label>
            <div v-if="selectedParent?.type === LocationType.SHELF || gridForm.includeBins" class="flex gap-1 text-[11px]">
              <button
                type="button"
                @click="gridForm.levelKind = 'numbers'"
                class="px-2 py-0.5 rounded-md cursor-pointer"
                :class="gridForm.levelKind === 'numbers' ? 'bg-[#171918] text-white' : 'bg-white text-[#686f6a]'"
              >
                Számok
              </button>
              <button
                type="button"
                @click="gridForm.levelKind = 'letters'"
                class="px-2 py-0.5 rounded-md cursor-pointer"
                :class="gridForm.levelKind === 'letters' ? 'bg-[#171918] text-white' : 'bg-white text-[#686f6a]'"
              >
                Betűk
              </button>
            </div>
          </div>

          <div
            v-if="selectedParent?.type === LocationType.SHELF || gridForm.includeBins"
            class="grid grid-cols-3 gap-2.5"
          >
            <template v-if="gridForm.levelKind === 'numbers'">
              <div>
                <label class="block text-[11px] text-[#686f6a] mb-1">Kezdő szint</label>
                <input
                  v-model.number="gridForm.levelStartNum"
                  type="number"
                  min="1"
                  max="99"
                  class="w-full h-[36px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm outline-none"
                />
              </div>
              <div>
                <label class="block text-[11px] text-[#686f6a] mb-1">Záró szint</label>
                <input
                  v-model.number="gridForm.levelEndNum"
                  type="number"
                  min="1"
                  max="99"
                  class="w-full h-[36px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm outline-none"
                />
              </div>
            </template>
            <template v-else>
              <div>
                <label class="block text-[11px] text-[#686f6a] mb-1">Kezdő betű</label>
                <input
                  v-model="gridForm.levelStartLetter"
                  maxlength="1"
                  class="w-full h-[36px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm uppercase outline-none"
                />
              </div>
              <div>
                <label class="block text-[11px] text-[#686f6a] mb-1">Záró betű</label>
                <input
                  v-model="gridForm.levelEndLetter"
                  maxlength="1"
                  class="w-full h-[36px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm uppercase outline-none"
                />
              </div>
            </template>
            <div>
              <label class="block text-[11px] text-[#686f6a] mb-1">Elválasztó</label>
              <input
                v-model="gridForm.separator"
                maxlength="3"
                class="w-full h-[36px] rounded-[9px] border border-[#dce0d8] bg-white px-2.5 text-sm outline-none"
              />
            </div>
          </div>
        </div>

        <!-- Rács előnézet -->
        <div class="bg-white rounded-[10px] border border-[#e3e6e0] p-3">
          <div v-if="gridItemsAndStats.error" class="text-xs text-rose-600 font-medium">
            {{ gridItemsAndStats.error }}
          </div>
          <div v-else class="space-y-1.5">
            <p class="text-[11px] font-semibold text-[#171918]">
              Előnézet:
              <span v-if="gridItemsAndStats.shelfCount > 0">
                {{ gridItemsAndStats.shelfCount }} polc
              </span>
              <span v-if="gridItemsAndStats.shelfCount > 0 && gridItemsAndStats.binCount > 0"> + </span>
              <span v-if="gridItemsAndStats.binCount > 0">
                {{ gridItemsAndStats.binCount }} rekesz
              </span>
              <span class="text-[#686f6a] font-normal"> (összesen {{ gridItemsAndStats.totalCount }} pozíció)</span>
            </p>
            <div class="flex flex-wrap gap-1.5">
              <span
                v-for="item in gridItemsAndStats.items.slice(0, 4)"
                :key="item.name"
                class="text-[11px] font-mono px-2 py-0.5 rounded-md bg-[#eff1ed] text-[#171918]"
              >
                {{ item.name }}
                <template v-if="item.children?.length">
                  → {{ item.children[0]?.name }}..{{ item.children[item.children.length - 1]?.name }}
                </template>
              </span>
              <span v-if="gridItemsAndStats.items.length > 4" class="text-[11px] text-[#686f6a] self-center">
                … +{{ gridItemsAndStats.items.length - 4 }} további
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Közös beállítások: SlotMode, Aktív, Duplikátumok kihagyása -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="space-y-1">
          <label class="block text-xs font-medium text-[#686f6a]">Tárolási mód (SlotMode)</label>
          <select
            v-model="slotMode"
            class="w-full h-[38px] rounded-[10px] border border-[#dce0d8] bg-white px-3 text-xs text-[#171918] outline-none"
          >
            <option :value="null">Nincs megadva (alapért.)</option>
            <option :value="SlotMode.MIXED">{{ SLOT_MODE_META[SlotMode.MIXED].label }}</option>
            <option :value="SlotMode.DEDICATED">{{ SLOT_MODE_META[SlotMode.DEDICATED].label }}</option>
          </select>
        </div>

        <div class="flex flex-col justify-end gap-1.5">
          <label class="flex items-center gap-2 text-xs text-[#171918] cursor-pointer">
            <input v-model="skipDuplicates" type="checkbox" class="size-4 accent-[#171918]" />
            <span>Már létező nevű pozíciók kihagyása</span>
          </label>
          <label class="flex items-center gap-2 text-xs text-[#171918] cursor-pointer">
            <input v-model="isActive" type="checkbox" class="size-4 accent-[#171918]" />
            <span>Létrehozás aktívként</span>
          </label>
        </div>
      </div>

      <div class="flex justify-end gap-2 pt-2 border-t border-[#e8eae6]">
        <button
          type="button"
          @click="emit('update:visible', false)"
          class="h-[38px] px-4 rounded-[10px] bg-white border border-[#dce0d8] text-xs font-medium text-[#171918] hover:bg-[#f6f7f5] cursor-pointer"
        >
          Mégse
        </button>
        <button
          type="submit"
          :disabled="!canSubmit"
          class="h-[38px] px-5 rounded-[10px] bg-[#171918] hover:bg-[#2a2d2b] disabled:opacity-50 text-xs font-medium text-white flex items-center gap-2 cursor-pointer"
        >
          <i v-if="saving" class="pi pi-spin pi-spinner text-xs"></i>
          <span>Pozíciók generálása</span>
        </button>
      </div>
    </form>
  </Dialog>
</template>
