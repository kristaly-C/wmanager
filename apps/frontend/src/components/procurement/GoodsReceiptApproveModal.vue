<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useAuthStore } from '@/stores/auth'
import {
  goodsReceiptsApi,
  type ApproveGoodsReceiptPayload,
  type GoodsReceiptDetail,
  type GoodsReceiptItemCostOverridePayload,
  type GoodsReceiptItemDto,
} from '@/api/goodsReceipts'
import { extractApiError } from '@/utils/locationMeta'
import { canSeeCostPrice, formatCurrency } from '@/utils/procurementMeta'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'

interface EditableCostRow {
  item: GoodsReceiptItemDto
  originalUnitCost: number
  editedUnitCost: number | null
}

const props = defineProps<{
  visible: boolean
  receipt: GoodsReceiptDetail | null
}>()

const emit = defineEmits<{
  'update:visible': [value: boolean]
  approved: [receipt: GoodsReceiptDetail]
}>()

const authStore = useAuthStore()
const toast = useToast()

const rows = ref<EditableCostRow[]>([])
const discrepancyNote = ref('')
const submitting = ref(false)

const showCostPrices = computed(() => canSeeCostPrice(authStore.user?.role))

const receiptCurrency = computed(() => (props.receipt?.currency || 'HUF').toUpperCase())
const exchangeRate = computed(() => {
  const num = Number(props.receipt?.exchangeRate ?? 1)
  return Number.isFinite(num) && num > 0 ? num : 1
})

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function getDiff(item: GoodsReceiptItemDto): number {
  return item.receivedQuantity - item.expectedQuantity
}

function hasRowDiscrepancy(item: GoodsReceiptItemDto): boolean {
  return item.isUnexpected || item.receivedQuantity !== item.expectedQuantity
}

function isCostModified(row: EditableCostRow): boolean {
  if (row.editedUnitCost === null || !Number.isFinite(row.editedUnitCost)) return false
  return Math.abs(round2(row.editedUnitCost) - round2(row.originalUnitCost)) >= 0.005
}

function computePreviewHuf(row: EditableCostRow): number {
  const cost =
    row.editedUnitCost !== null && Number.isFinite(row.editedUnitCost) ? row.editedUnitCost : 0
  return round2(Math.max(0, cost) * exchangeRate.value)
}

const discrepancyCount = computed(() =>
  rows.value.filter((row) => hasRowDiscrepancy(row.item)).length,
)

const unexpectedCount = computed(() => rows.value.filter((row) => row.item.isUnexpected).length)

const modifiedCostCount = computed(() => rows.value.filter((row) => isCostModified(row)).length)

const zeroCostReceivedUnexpectedCount = computed(() =>
  rows.value.filter(
    (row) =>
      row.item.isUnexpected &&
      row.item.receivedQuantity > 0 &&
      (row.editedUnitCost === null || row.editedUnitCost <= 0),
  ).length,
)

const totalReceivedHuf = computed(() => {
  return rows.value.reduce((sum, row) => {
    return sum + round2(row.item.receivedQuantity * computePreviewHuf(row))
  }, 0)
})

const hasInvalidCost = computed(() =>
  rows.value.some(
    (row) =>
      row.editedUnitCost === null ||
      !Number.isFinite(row.editedUnitCost) ||
      row.editedUnitCost < 0,
  ),
)

watch(
  () => [props.visible, props.receipt] as const,
  ([isOpen, receipt]) => {
    if (!isOpen || !receipt) return
    discrepancyNote.value = receipt.discrepancyNote ?? ''
    rows.value = receipt.items.map((item) => {
      const original = round2(Number(item.unitCost ?? 0))
      return {
        item,
        originalUnitCost: Number.isFinite(original) ? original : 0,
        editedUnitCost: Number.isFinite(original) ? original : 0,
      }
    })
  },
  { immediate: true },
)

function closeModal() {
  emit('update:visible', false)
}

async function handleApprove() {
  if (!props.receipt || submitting.value) return

  if (showCostPrices.value && hasInvalidCost.value) {
    toast.add({
      severity: 'warn',
      summary: 'Érvénytelen egységár',
      detail: 'Minden tétel egységárának 0 vagy annál nagyobb érvényes számnak kell lennie.',
      life: 4000,
    })
    return
  }

  const overrides: GoodsReceiptItemCostOverridePayload[] = []
  if (showCostPrices.value) {
    for (const row of rows.value) {
      if (isCostModified(row) && row.editedUnitCost !== null) {
        overrides.push({
          goodsReceiptItemId: row.item.id,
          unitCost: round2(row.editedUnitCost),
        })
      }
    }
  }

  const payload: ApproveGoodsReceiptPayload = {
    discrepancyNote: discrepancyNote.value.trim() || undefined,
    itemCostOverrides: overrides.length > 0 ? overrides : undefined,
  }

  submitting.value = true
  try {
    const res = await goodsReceiptsApi.approve(props.receipt.id, payload)
    toast.add({
      severity: 'success',
      summary: 'Bevételezés jóváhagyva',
      detail: `${res.data.receiptNumber} lezárásra került, a készletértékek és statisztikák frissültek.`,
      life: 4500,
    })
    emit('approved', res.data)
    closeModal()
  } catch (err) {
    toast.add({
      severity: 'error',
      summary: 'Jóváhagyási hiba',
      detail: extractApiError(err, 'Nem sikerült jóváhagyni a bevételezést.'),
      life: 6000,
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="(val) => emit('update:visible', val)"
    modal
    header="Eltérések jóváhagyása és bevételezés lezárása"
    :style="{ width: '64rem', maxWidth: '96vw' }"
  >
    <div v-if="receipt" class="space-y-4 pt-1 text-[#171918]">
      <!-- Felső összegző sáv -->
      <div
        class="rounded-[14px] bg-[#f8f9f7] border border-[#e8eae6] p-4 flex flex-wrap items-center justify-between gap-3"
      >
        <div class="space-y-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-sm font-bold text-[#171918]">
              {{ receipt.receiptNumber }}
            </span>
            <span
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-orange-50 text-orange-700 border border-orange-200"
            >
              <i class="pi pi-exclamation-triangle text-[10px]"></i>
              <span>{{ discrepancyCount }} eltérő tétel</span>
            </span>
            <span
              v-if="unexpectedCount > 0"
              class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-700 border border-rose-200"
            >
              {{ unexpectedCount }} váratlan tétel
            </span>
          </div>
          <p class="text-xs text-[#686f6a]">
            Célhelyszín: <span class="font-semibold text-[#171918]">{{ receipt.targetLocation.name }}</span>
            <template v-if="receipt.supplier">
              · Beszállító: <span class="font-semibold text-[#171918]">{{ receipt.supplier.name }}</span>
            </template>
            <template v-if="receipt.invoiceNumber">
              · Számla: <span class="font-mono text-[#171918]">{{ receipt.invoiceNumber }}</span>
            </template>
          </p>
        </div>

        <div v-if="showCostPrices" class="text-right">
          <p class="text-[11px] text-[#686f6a]">
            Pénznem / Árfolyam:
            <span class="font-semibold text-[#171918]">
              {{ receiptCurrency }} (1 {{ receiptCurrency }} = {{ exchangeRate }} Ft)
            </span>
          </p>
          <p class="text-sm font-bold text-[#171918] mt-0.5">
            Beérkezett összérték: {{ formatCurrency(totalReceivedHuf, 'HUF') }}
          </p>
        </div>
      </div>

      <!-- Figyelmeztetés a lezárás hatásairól -->
      <div
        class="rounded-[12px] bg-amber-50/80 border border-amber-200 px-3.5 py-2.5 text-xs text-amber-900 flex items-start gap-2.5"
      >
        <i class="pi pi-info-circle text-amber-600 mt-0.5 shrink-0"></i>
        <div class="space-y-0.5">
          <p class="font-semibold">A jóváhagyás véglegesen lezárja a bevételezést.</p>
          <p class="text-amber-800">
            Ellenőrizd az eltérő és váratlan tételek beszerzési egységárát! Jóváhagyáskor újraszámolódik
            a variánsok súlyozott átlagára, frissülnek a havi statisztikák, és ha PO-hoz kapcsolódik,
            a megrendelés állapota is frissül.
          </p>
        </div>
      </div>

      <!-- 0 Ft váratlan tétel figyelmeztetés -->
      <div
        v-if="showCostPrices && zeroCostReceivedUnexpectedCount > 0"
        class="rounded-[12px] bg-rose-50 border border-rose-200 px-3.5 py-2.5 text-xs text-rose-800 flex items-center gap-2"
      >
        <i class="pi pi-exclamation-circle text-rose-600 shrink-0"></i>
        <span>
          {{ zeroCostReceivedUnexpectedCount }} váratlan tétel egységára jelenleg 0
          {{ receiptCurrency }}. Ha nem ingyenes/minta tétel, írd be a helyes egységárat jóváhagyás
          előtt!
        </span>
      </div>

      <!-- Tételek táblázat + helybeni ár-felülírás -->
      <div class="border border-[#e8eae6] rounded-[14px] overflow-hidden bg-white">
        <div class="overflow-x-auto max-h-[380px]">
          <table class="w-full text-left border-collapse text-xs">
            <thead class="bg-[#eff1ed] text-[#686f6a] sticky top-0 z-10">
              <tr>
                <th class="px-3.5 py-2.5 font-semibold">Termék &amp; SKU</th>
                <th class="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Várt</th>
                <th class="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Beérkezett</th>
                <th class="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Eltérés</th>
                <th v-if="showCostPrices" class="px-3 py-2.5 font-semibold text-right whitespace-nowrap">
                  Egységár ({{ receiptCurrency }})
                </th>
                <th v-if="showCostPrices" class="px-3.5 py-2.5 font-semibold text-right whitespace-nowrap">
                  Egységár (HUF)
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-[#e8eae6]">
              <tr
                v-for="row in rows"
                :key="row.item.id"
                :class="
                  row.item.isUnexpected
                    ? 'bg-rose-50/50'
                    : hasRowDiscrepancy(row.item)
                      ? 'bg-amber-50/50'
                      : 'bg-white'
                "
              >
                <td class="px-3.5 py-2.5 min-w-[220px]">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="font-semibold text-[#171918]">
                      {{ row.item.variant.product?.name ?? 'Ismeretlen termék' }}
                    </span>
                    <span
                      v-if="row.item.isUnexpected"
                      class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 border border-rose-200"
                    >
                      Váratlan
                    </span>
                  </div>
                  <div class="flex flex-wrap items-center gap-1.5 text-[11px] text-[#686f6a] mt-0.5">
                    <span class="font-mono font-medium text-[#171918]">{{ row.item.variant.sku }}</span>
                    <span
                      v-if="row.item.variant.size"
                      class="bg-[#eff1ed] text-[#171918] font-semibold px-1.5 py-0.2 rounded"
                    >
                      {{ row.item.variant.size }}
                    </span>
                    <span v-if="row.item.variant.colors.length > 0">
                      {{ row.item.variant.colors.join(', ') }}
                    </span>
                  </div>
                </td>

                <td class="px-3 py-2.5 text-right font-medium text-[#4c534e] whitespace-nowrap">
                  {{ row.item.expectedQuantity }} db
                </td>

                <td class="px-3 py-2.5 text-right font-bold text-[#171918] whitespace-nowrap">
                  {{ row.item.receivedQuantity }} db
                </td>

                <td class="px-3 py-2.5 text-right whitespace-nowrap">
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold"
                    :class="
                      getDiff(row.item) === 0 && !row.item.isUnexpected
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : getDiff(row.item) < 0
                          ? 'bg-rose-50 text-rose-700 border border-rose-200'
                          : 'bg-orange-50 text-orange-700 border border-orange-200'
                    "
                  >
                    {{ getDiff(row.item) > 0 ? `+${getDiff(row.item)}` : getDiff(row.item) }} db
                  </span>
                </td>

                <td v-if="showCostPrices" class="px-3 py-2.5 text-right whitespace-nowrap">
                  <div class="inline-flex flex-col items-end gap-0.5">
                    <input
                      v-model.number="row.editedUnitCost"
                      type="number"
                      step="0.01"
                      min="0"
                      class="w-28 h-[32px] px-2.5 rounded-[8px] text-right font-mono text-xs bg-white border outline-none transition"
                      :class="
                        row.editedUnitCost === null || row.editedUnitCost < 0
                          ? 'border-rose-400 focus:border-rose-500'
                          : isCostModified(row)
                            ? 'border-[#f46714] bg-orange-50/40'
                            : row.item.isUnexpected
                              ? 'border-amber-300 focus:border-[#f46714]'
                              : 'border-[#dce0d8] focus:border-[#171918]'
                      "
                    />
                    <span v-if="isCostModified(row)" class="text-[10px] text-[#f46714] font-medium">
                      Eredeti: {{ formatCurrency(row.originalUnitCost, receiptCurrency) }}
                    </span>
                  </div>
                </td>

                <td
                  v-if="showCostPrices"
                  class="px-3.5 py-2.5 text-right font-semibold text-[#171918] whitespace-nowrap"
                >
                  {{ formatCurrency(computePreviewHuf(row), 'HUF') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Indoklás / Megjegyzés -->
      <div class="space-y-1.5">
        <label for="gr-discrepancy-note" class="block text-xs font-semibold text-[#171918]">
          Eltérés indoklása / vezetői megjegyzés
          <span class="font-normal text-[#686f6a]">(opcionális)</span>
        </label>
        <textarea
          id="gr-discrepancy-note"
          v-model="discrepancyNote"
          rows="3"
          placeholder="Pl. Hiányzó 2 db beszállító felé reklamálva, vagy váratlan tétel számlaegyeztetés után elfogadva..."
          class="w-full rounded-[12px] bg-[#f8f9f7] border border-[#dce0d8] px-3.5 py-2.5 text-xs text-[#171918] placeholder-[#8c938d] outline-none focus:bg-white focus:border-[#f46714]/60 transition"
        ></textarea>
      </div>

      <!-- Lábléc -->
      <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#e8eae6]">
        <div class="text-xs text-[#686f6a]">
          <span v-if="showCostPrices && modifiedCostCount > 0" class="font-semibold text-[#f46714]">
            {{ modifiedCostCount }} tétel egységára felülírva
          </span>
          <span v-else>Nincs módosított egységár</span>
        </div>

        <div class="flex items-center gap-2.5">
          <button
            type="button"
            :disabled="submitting"
            @click="closeModal"
            class="h-[38px] px-4 rounded-[10px] bg-white border border-[#dce0d8] hover:bg-[#f8f9f7] text-xs font-semibold text-[#171918] transition cursor-pointer disabled:opacity-50"
          >
            Mégse
          </button>
          <button
            type="button"
            :disabled="submitting || (showCostPrices && hasInvalidCost)"
            @click="handleApprove"
            class="h-[38px] px-5 rounded-[10px] bg-[#171918] hover:bg-[#2a2d2b] text-xs font-semibold text-white inline-flex items-center gap-2 transition cursor-pointer disabled:opacity-50"
          >
            <i :class="submitting ? 'pi pi-spin pi-spinner text-xs' : 'pi pi-check-circle text-xs'"></i>
            <span>Eltérések jóváhagyása és lezárás</span>
          </button>
        </div>
      </div>
    </div>
  </Dialog>
</template>
