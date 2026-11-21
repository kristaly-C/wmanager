<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'
import {
  purchaseOrdersApi,
  type ConfirmPurchaseOrderPayload,
  type PurchaseOrderDetail,
} from '@/api/purchaseOrders'
import { extractApiError } from '@/utils/locationMeta'
import { formatCurrency } from '@/utils/procurementMeta'

interface ConfirmRow {
  itemId: string
  sku: string
  productName: string
  size: string | null
  colors: string[]
  orderedQuantity: number
  confirmedQuantity: number
  unitCost: number
  note: string
}

const props = defineProps<{
  visible: boolean
  purchaseOrder: PurchaseOrderDetail | null
}>()

const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'saved', po: PurchaseOrderDetail): void
}>()

const toast = useToast()

const supplierReference = ref('')
const expectedDeliveryDate = ref('')
const note = ref('')
const rows = ref<ConfirmRow[]>([])
const submitting = ref(false)
const formError = ref('')

const currencyCode = computed(() => props.purchaseOrder?.currency ?? 'HUF')

const totalOrdered = computed(() =>
  rows.value.reduce((sum, r) => sum + r.orderedQuantity, 0),
)

const totalConfirmed = computed(() =>
  rows.value.reduce(
    (sum, r) => sum + (Number.isFinite(r.confirmedQuantity) ? Math.max(0, r.confirmedQuantity) : 0),
    0,
  ),
)

const totalConfirmedAmount = computed(() =>
  rows.value.reduce((sum, r) => {
    const qty = Number.isFinite(r.confirmedQuantity) ? Math.max(0, r.confirmedQuantity) : 0
    const cost = Number.isFinite(r.unitCost) ? Math.max(0, r.unitCost) : 0
    return sum + qty * cost
  }, 0),
)

function formatDateInput(iso?: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

watch(
  () => [props.visible, props.purchaseOrder] as const,
  ([isVisible, po]) => {
    if (!isVisible || !po) return
    formError.value = ''
    supplierReference.value = po.supplierReference ?? ''
    expectedDeliveryDate.value = formatDateInput(po.expectedDeliveryDate)
    note.value = po.note ?? ''
    rows.value = po.items.map((item) => ({
      itemId: item.id,
      sku: item.variant.sku,
      productName: item.variant.product?.name ?? 'Ismeretlen termék',
      size: item.variant.size ?? null,
      colors: item.variant.colors ?? [],
      orderedQuantity: item.orderedQuantity,
      confirmedQuantity: item.confirmedQuantity ?? item.orderedQuantity,
      unitCost: Number(item.unitCost) || 0,
      note: item.note ?? '',
    }))
  },
  { immediate: true },
)

function fillAllOrderedAsConfirmed() {
  for (const row of rows.value) {
    row.confirmedQuantity = row.orderedQuantity
  }
}

function validate(): string | null {
  for (const row of rows.value) {
    if (!Number.isInteger(row.confirmedQuantity) || row.confirmedQuantity < 0) {
      return `A visszaigazolt mennyiség nemnegatív egész szám kell legyen (${row.sku}).`
    }
    if (!Number.isFinite(row.unitCost) || row.unitCost < 0) {
      return `Az egységár nem lehet negatív (${row.sku}).`
    }
  }
  return null
}

async function handleSubmit() {
  if (!props.purchaseOrder) return
  formError.value = ''
  const errMsg = validate()
  if (errMsg) {
    formError.value = errMsg
    return
  }

  const payload: ConfirmPurchaseOrderPayload = {
    supplierReference: supplierReference.value.trim() || null,
    expectedDeliveryDate: expectedDeliveryDate.value || null,
    note: note.value.trim() || null,
    items: rows.value.map((r) => ({
      itemId: r.itemId,
      confirmedQuantity: Math.trunc(r.confirmedQuantity),
      unitCost: Math.round(r.unitCost * 100) / 100,
      note: r.note.trim() || null,
    })),
  }

  submitting.value = true
  try {
    const res = await purchaseOrdersApi.confirm(props.purchaseOrder.id, payload)
    toast.add({
      severity: 'success',
      summary: 'Visszaigazolás rögzítve',
      detail: `${res.data.orderNumber} gyártói visszaigazolása elmentve.`,
      life: 4000,
    })
    emit('saved', res.data)
    emit('update:visible', false)
  } catch (err) {
    const msg = extractApiError(err, 'Nem sikerült rögzíteni a gyártói visszaigazolást.')
    formError.value = msg
    toast.add({
      severity: 'error',
      summary: 'Mentési hiba',
      detail: msg,
      life: 5000,
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    modal
    :header="
      purchaseOrder
        ? `Gyártói visszaigazolás (${purchaseOrder.orderNumber})`
        : 'Gyártói visszaigazolás'
    "
    :style="{ width: '56rem', maxWidth: '96vw' }"
    @update:visible="emit('update:visible', $event)"
  >
    <form v-if="purchaseOrder" @submit.prevent="handleSubmit" class="space-y-4 pt-2 text-[#171918]">
      <div
        v-if="formError"
        class="bg-rose-50 border border-rose-200 text-rose-700 text-xs font-medium px-3.5 py-2.5 rounded-xl flex items-center gap-2"
      >
        <i class="pi pi-exclamation-circle text-sm"></i>
        <span>{{ formError }}</span>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-12 gap-3.5 bg-[#f8f9f7] border border-[#e8eae6] rounded-2xl p-4">
        <div class="sm:col-span-5">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Gyártói / beszállítói hivatkozás
          </label>
          <input
            v-model="supplierReference"
            type="text"
            placeholder="Pl. Visszaigazolási szám (SO-12345)"
            class="w-full h-10 bg-white rounded-xl border border-[#dce0d8] px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <div class="sm:col-span-3">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Tervezett kézbesítés
          </label>
          <input
            v-model="expectedDeliveryDate"
            type="date"
            class="w-full h-10 bg-white rounded-xl border border-[#dce0d8] px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>

        <div class="sm:col-span-4">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">Megjegyzés</label>
          <input
            v-model="note"
            type="text"
            placeholder="Visszaigazolási megjegyzés..."
            class="w-full h-10 bg-white rounded-xl border border-[#dce0d8] px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>
      </div>

      <div class="border border-[#e8eae6] rounded-2xl overflow-hidden bg-white">
        <div class="bg-[#f8f9f7] px-4 py-2.5 border-b border-[#e8eae6] flex flex-wrap items-center justify-between gap-2">
          <span class="text-xs font-semibold text-[#171918]">
            Tételek visszaigazolása ({{ totalConfirmed }} / {{ totalOrdered }} db)
          </span>
          <button
            type="button"
            @click="fillAllOrderedAsConfirmed"
            class="text-[11px] font-semibold text-[#f46714] hover:underline cursor-pointer"
          >
            Mindegyik = Rendelt mennyiség
          </button>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="bg-[#eff1ed] text-[#686f6a] text-[11px]">
                <th class="py-2 px-3 font-medium">Termék & SKU</th>
                <th class="py-2 px-3 font-medium text-right w-24">Rendelt</th>
                <th class="py-2 px-3 font-medium w-32">Visszaigazolt</th>
                <th class="py-2 px-3 font-medium w-36">Egységár ({{ currencyCode }})</th>
                <th class="py-2 px-3 font-medium text-right w-32">Összesen</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#eff1ed]">
              <tr v-for="row in rows" :key="row.itemId" class="hover:bg-[#fafbf9]">
                <td class="py-2.5 px-3 align-top">
                  <p class="font-semibold text-[#171918]">{{ row.productName }}</p>
                  <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-[#686f6a] mt-0.5">
                    <span class="font-mono font-semibold text-[#171918]">{{ row.sku }}</span>
                    <span v-if="row.size" class="bg-[#eff1ed] px-1.5 py-0.5 rounded">{{ row.size }}</span>
                    <span v-if="row.colors.length > 0">{{ row.colors.join(', ') }}</span>
                  </div>
                </td>
                <td class="py-2.5 px-3 align-top text-right font-semibold text-[#686f6a]">
                  {{ row.orderedQuantity }} db
                </td>
                <td class="py-2.5 px-3 align-top">
                  <input
                    v-model.number="row.confirmedQuantity"
                    type="number"
                    min="0"
                    step="1"
                    required
                    class="w-full h-8 rounded-lg border px-2 text-xs font-semibold outline-none focus:border-[#f46714]"
                    :class="
                      row.confirmedQuantity === 0
                        ? 'border-rose-300 bg-rose-50/40'
                        : row.confirmedQuantity < row.orderedQuantity
                          ? 'border-amber-300 bg-amber-50/40'
                          : 'border-[#dce0d8] bg-white'
                    "
                  />
                  <p
                    v-if="row.confirmedQuantity !== row.orderedQuantity"
                    class="text-[10px] mt-0.5"
                    :class="row.confirmedQuantity === 0 ? 'text-rose-600' : 'text-amber-700'"
                  >
                    {{ row.confirmedQuantity === 0 ? 'Nem szállítható (0 db)' : `Eltérés: ${row.confirmedQuantity - row.orderedQuantity} db` }}
                  </p>
                </td>
                <td class="py-2.5 px-3 align-top">
                  <input
                    v-model.number="row.unitCost"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    class="w-full h-8 rounded-lg border border-[#dce0d8] px-2 text-xs font-semibold outline-none focus:border-[#f46714]"
                  />
                </td>
                <td class="py-2.5 px-3 align-top text-right font-semibold text-[#171918] whitespace-nowrap">
                  {{ formatCurrency((row.confirmedQuantity || 0) * (row.unitCost || 0), currencyCode) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="bg-[#f8f9f7] px-4 py-3 border-t border-[#e8eae6] flex items-center justify-end text-xs">
          <span class="text-[#686f6a]">
            Visszaigazolt összérték:
            <strong class="text-sm text-[#171918] ml-1">
              {{ formatCurrency(totalConfirmedAmount, currencyCode) }}
            </strong>
          </span>
        </div>
      </div>

      <div class="flex justify-end gap-2.5 pt-2">
        <button
          type="button"
          @click="emit('update:visible', false)"
          class="h-10 px-4 rounded-xl bg-white border border-[#dce0d8] hover:bg-[#f8f9f7] text-xs font-semibold text-[#171918] cursor-pointer transition"
        >
          Mégse
        </button>
        <button
          type="submit"
          :disabled="submitting"
          class="h-10 px-5 rounded-xl bg-[#171918] hover:bg-[#2a2d2b] text-white text-xs font-semibold inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 transition"
        >
          <i v-if="submitting" class="pi pi-spin pi-spinner text-xs"></i>
          <span>Visszaigazolás mentése</span>
        </button>
      </div>
    </form>
  </Dialog>
</template>
