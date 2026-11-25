<script setup lang="ts">
import { ref, watch } from 'vue'
import { variantApi, type VariantBarcodeItem, type VariantItem } from '@/api/variants'
import { normalizeScannedBarcode } from '@/utils/barcodeScanner'
import { extractApiError } from '@/utils/locationMeta'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'

const props = defineProps<{
  visible: boolean
  variant: VariantItem | null
  canManage: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'updated'): void
}>()

const toast = useToast()

const barcodes = ref<VariantBarcodeItem[]>([])
const loading = ref(false)
const actionLoading = ref(false)

// Új vonalkód űrlap
const newBarcode = ref('')
const newNote = ref('')
const newIsPrimary = ref(false)

// Megjegyzés szerkesztése meglévő vonalkódnál
const editingNoteId = ref<string | null>(null)
const editingNoteValue = ref('')

async function loadBarcodes() {
  if (!props.variant) return
  loading.value = true
  try {
    const res = await variantApi.getBarcodes(props.variant.id)
    barcodes.value = res.data
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Betöltési hiba',
      detail: extractApiError(err, 'Nem sikerült betölteni a vonalkódokat.'),
      life: 4000,
    })
  } finally {
    loading.value = false
  }
}

watch(
  () => [props.visible, props.variant?.id] as const,
  ([isOpen]) => {
    if (!isOpen || !props.variant) return
    newBarcode.value = ''
    newNote.value = ''
    newIsPrimary.value = (props.variant.variantBarcodes?.length ?? 0) === 0
    editingNoteId.value = null
    editingNoteValue.value = ''
    void loadBarcodes()
  },
)

async function handleCreateBarcode() {
  if (!props.variant) return
  const code = normalizeScannedBarcode(newBarcode.value)
  newBarcode.value = code
  if (!code) {
    toast.add({
      severity: 'error',
      summary: 'Hiányzó vonalkód',
      detail: 'Kérjük add meg a vonalkódot.',
      life: 3500,
    })
    return
  }

  actionLoading.value = true
  try {
    await variantApi.createBarcode(props.variant.id, {
      barcode: code,
      isPrimary: newIsPrimary.value,
      note: newNote.value.trim() || undefined,
    })
    toast.add({
      severity: 'success',
      summary: 'Vonalkód rögzítve',
      detail: `„${code}” hozzáadva a variánshoz.`,
      life: 3000,
    })
    newBarcode.value = ''
    newNote.value = ''
    newIsPrimary.value = false
    await loadBarcodes()
    emit('updated')
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Rögzítési hiba',
      detail: extractApiError(err, 'Nem sikerült hozzáadni a vonalkódot.'),
      life: 5000,
    })
  } finally {
    actionLoading.value = false
  }
}

async function handleSetPrimary(item: VariantBarcodeItem) {
  if (!props.variant || item.isPrimary) return
  actionLoading.value = true
  try {
    await variantApi.updateBarcode(props.variant.id, item.id, { isPrimary: true })
    toast.add({
      severity: 'success',
      summary: 'Elsődleges vonalkód',
      detail: `„${item.barcode}” beállítva elsődlegesként.`,
      life: 3000,
    })
    await loadBarcodes()
    emit('updated')
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Frissítési hiba',
      detail: extractApiError(err, 'Nem sikerült módosítani a vonalkódot.'),
      life: 4000,
    })
  } finally {
    actionLoading.value = false
  }
}

function startEditNote(item: VariantBarcodeItem) {
  editingNoteId.value = item.id
  editingNoteValue.value = item.note ?? ''
}

function cancelEditNote() {
  editingNoteId.value = null
  editingNoteValue.value = ''
}

async function saveEditNote(item: VariantBarcodeItem) {
  if (!props.variant) return
  actionLoading.value = true
  try {
    await variantApi.updateBarcode(props.variant.id, item.id, {
      note: editingNoteValue.value.trim(),
    })
    toast.add({
      severity: 'success',
      summary: 'Megjegyzés mentve',
      detail: 'A vonalkód megjegyzése frissült.',
      life: 3000,
    })
    editingNoteId.value = null
    editingNoteValue.value = ''
    await loadBarcodes()
    emit('updated')
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Mentési hiba',
      detail: extractApiError(err, 'Nem sikerült menteni a megjegyzést.'),
      life: 4000,
    })
  } finally {
    actionLoading.value = false
  }
}

async function handleDeleteBarcode(item: VariantBarcodeItem) {
  if (!props.variant) return
  actionLoading.value = true
  try {
    await variantApi.removeBarcode(props.variant.id, item.id)
    toast.add({
      severity: 'success',
      summary: 'Vonalkód törölve',
      detail: `„${item.barcode}” eltávolítva.`,
      life: 3000,
    })
    await loadBarcodes()
    emit('updated')
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Törlési hiba',
      detail: extractApiError(err, 'Nem sikerült törölni a vonalkódot.'),
      life: 4000,
    })
  } finally {
    actionLoading.value = false
  }
}

function closeModal() {
  emit('update:visible', false)
}
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="(val) => emit('update:visible', val)"
    modal
    header="Variáns vonalkódok (EAN / gyári / belső)"
    :style="{ width: '36rem', maxWidth: '95vw' }"
  >
    <div v-if="variant" class="space-y-4 pt-1">
      <!-- Variáns fejléc -->
      <div
        class="bg-slate-50 border border-slate-200/80 rounded-xl px-3.5 py-2.5 flex items-center justify-between gap-3"
      >
        <div class="min-w-0">
          <p class="text-xs font-bold font-mono text-slate-900">{{ variant.sku }}</p>
          <p class="text-[11px] text-slate-500">
            Méret: <span class="font-semibold text-slate-700">{{ variant.size }}</span> · Szín:
            <span class="font-semibold text-slate-700">{{ variant.colors.join(', ') }}</span>
          </p>
        </div>
        <span class="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-200/70 text-slate-700 shrink-0">
          {{ barcodes.length }} vonalkód
        </span>
      </div>

      <!-- Új vonalkód hozzáadása (csak jogosult szerepköröknek) -->
      <form
        v-if="canManage"
        @submit.prevent="handleCreateBarcode"
        class="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-3.5 space-y-3"
      >
        <p class="text-xs font-bold text-slate-800">Új vonalkód rögzítése</p>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <input
              v-model="newBarcode"
              type="text"
              required
              placeholder="Vonalkód (pl. 8059175287411) *"
              @blur="newBarcode = normalizeScannedBarcode(newBarcode)"
              class="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 font-mono text-xs text-slate-900 outline-none focus:border-orange-500"
            />
          </div>
          <div>
            <input
              v-model="newNote"
              type="text"
              placeholder="Megjegyzés (pl. Gyári EAN, Belső címke)"
              class="w-full h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900 outline-none focus:border-orange-500"
            />
          </div>
        </div>

        <div class="flex items-center justify-between gap-2">
          <label class="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              v-model="newIsPrimary"
              type="checkbox"
              class="size-3.5 accent-slate-900 cursor-pointer"
            />
            <span>Beállítás elsődleges vonalkódként</span>
          </label>

          <button
            type="submit"
            :disabled="actionLoading"
            class="h-8 px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-xs font-semibold text-white flex items-center gap-1.5 cursor-pointer transition"
          >
            <i class="pi pi-plus text-[10px]"></i>
            <span>Hozzáadás</span>
          </button>
        </div>
      </form>

      <!-- Vonalkódok listája -->
      <div v-if="loading" class="py-8 text-center text-xs text-slate-400">
        <i class="pi pi-spin pi-spinner mr-1.5"></i> Vonalkódok betöltése...
      </div>

      <div
        v-else-if="barcodes.length === 0"
        class="py-8 text-center bg-slate-50/50 rounded-2xl border border-dashed border-slate-200 text-xs text-slate-400"
      >
        Ehhez a variánshoz még nincs vonalkód rögzítve.
      </div>

      <div v-else class="space-y-2 max-h-72 overflow-y-auto pr-1">
        <div
          v-for="item in barcodes"
          :key="item.id"
          class="p-3 rounded-xl border flex flex-col gap-2 transition"
          :class="
            item.isPrimary
              ? 'bg-orange-50/40 border-orange-200'
              : 'bg-white border-slate-200/80 hover:border-slate-300'
          "
        >
          <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-2 min-w-0">
              <i class="pi pi-barcode text-slate-500 text-sm"></i>
              <span class="font-mono text-sm font-bold text-slate-900 truncate">
                {{ item.barcode }}
              </span>
              <span
                v-if="item.isPrimary"
                class="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md bg-orange-500 text-white shrink-0"
              >
                Elsődleges
              </span>
            </div>

            <div v-if="canManage" class="flex items-center gap-1.5 shrink-0">
              <button
                v-if="!item.isPrimary"
                type="button"
                :disabled="actionLoading"
                @click="handleSetPrimary(item)"
                class="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-orange-100 text-slate-700 hover:text-orange-800 cursor-pointer transition"
                title="Beállítás elsődlegesként"
              >
                Legyen elsődleges
              </button>
              <button
                type="button"
                :disabled="actionLoading"
                @click="startEditNote(item)"
                class="w-7 h-7 rounded-lg border border-slate-200 hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer transition"
                title="Megjegyzés szerkesztése"
              >
                <i class="pi pi-pencil text-[11px]"></i>
              </button>
              <button
                type="button"
                :disabled="actionLoading"
                @click="handleDeleteBarcode(item)"
                class="w-7 h-7 rounded-lg border border-rose-200 hover:bg-rose-50 text-rose-600 flex items-center justify-center cursor-pointer transition"
                title="Vonalkód törlése"
              >
                <i class="pi pi-trash text-[11px]"></i>
              </button>
            </div>
          </div>

          <!-- Megjegyzés megjelenítése vagy szerkesztése -->
          <div v-if="editingNoteId === item.id && canManage" class="flex items-center gap-2 pt-1">
            <input
              v-model="editingNoteValue"
              type="text"
              placeholder="Megjegyzés..."
              @keydown.enter.prevent="saveEditNote(item)"
              class="flex-1 h-8 rounded-lg border border-slate-300 bg-white px-2.5 text-xs text-slate-900 outline-none focus:border-orange-500"
            />
            <button
              type="button"
              :disabled="actionLoading"
              @click="saveEditNote(item)"
              class="h-8 px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold cursor-pointer"
            >
              Mentés
            </button>
            <button
              type="button"
              @click="cancelEditNote"
              class="h-8 px-2.5 rounded-lg border border-slate-200 text-slate-600 text-xs font-semibold cursor-pointer"
            >
              Mégse
            </button>
          </div>
          <p v-else-if="item.note" class="text-xs text-slate-500">
            Megjegyzés: <span class="text-slate-700">{{ item.note }}</span>
          </p>
        </div>
      </div>

      <!-- Lábléc -->
      <div class="flex justify-end pt-2 border-t border-slate-100">
        <button
          type="button"
          @click="closeModal"
          class="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-xs font-semibold text-white cursor-pointer transition"
        >
          Bezárás
        </button>
      </div>
    </div>
  </Dialog>
</template>
