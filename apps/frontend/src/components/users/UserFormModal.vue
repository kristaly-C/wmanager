<script setup lang="ts">
import { ref, watch } from 'vue'
import { Role, LocationType } from '@wmanager/shared-types'
import Dialog from 'primevue/dialog'
import type { UserItem } from '@/api/users'
import type { LocationItem } from '@/api/locations'

export interface CreateUserSubmitPayload {
  name: string
  email: string
  role: Role
  password: string
  initialLocationId?: string
}

export interface EditUserSubmitPayload {
  id: string
  name: string
  email: string
  role: Role
  isActive: boolean
}

const props = defineProps<{
  visible: boolean
  mode: 'create' | 'edit'
  editingUser: UserItem | null
  assignableRoles: Role[]
  rootLocations: LocationItem[]
  roleMeta: Record<Role, { label: string; isUnbound: boolean; permissions: string[] }>
  isSelf?: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
  (e: 'submitCreate', payload: CreateUserSubmitPayload): void
  (e: 'submitEdit', payload: EditUserSubmitPayload): void
}>()

const form = ref({
  name: '',
  email: '',
  role: Role.WAREHOUSE_STAFF as Role,
  password: '',
  initialLocationId: '',
  isActive: true,
})

watch(
  () => [props.visible, props.mode, props.editingUser] as const,
  ([visible, mode, user]) => {
    if (!visible) return
    if (mode === 'edit' && user) {
      form.value = {
        name: user.name,
        email: user.email,
        role: user.role,
        password: '',
        initialLocationId: '',
        isActive: user.isActive,
      }
    } else {
      form.value = {
        name: '',
        email: '',
        role: Role.WAREHOUSE_STAFF,
        password: '',
        initialLocationId: '',
        isActive: true,
      }
    }
  },
  { immediate: true },
)

function handleSubmit() {
  if (props.mode === 'create') {
    emit('submitCreate', {
      name: form.value.name.trim(),
      email: form.value.email.trim(),
      role: form.value.role,
      password: form.value.password,
      initialLocationId: form.value.initialLocationId || undefined,
    })
    return
  }

  if (!props.editingUser) return
  emit('submitEdit', {
    id: props.editingUser.id,
    name: form.value.name.trim(),
    email: form.value.email.trim(),
    role: form.value.role,
    isActive: form.value.isActive,
  })
}
</script>

<template>
  <Dialog
    :visible="visible"
    @update:visible="emit('update:visible', $event)"
    modal
    :header="mode === 'create' ? 'Új felhasználó létrehozása' : 'Felhasználó és hozzáférés szerkesztése'"
    class="w-[95vw] max-w-md !rounded-2xl"
  >
    <form
      v-if="mode === 'create' || editingUser"
      @submit.prevent="handleSubmit"
      class="space-y-4 pt-2"
    >
      <div>
        <label class="block text-xs font-semibold text-[#686f6a] mb-1">Teljes név</label>
        <input
          v-model="form.name"
          type="text"
          required
          :placeholder="mode === 'create' ? 'Pl. Nagy Eszter' : undefined"
          class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#f46714]"
        />
      </div>

      <div>
        <label class="block text-xs font-semibold text-[#686f6a] mb-1">E-mail cím</label>
        <input
          v-model="form.email"
          type="email"
          required
          :placeholder="mode === 'create' ? 'eszter.nagy@ceg.hu' : undefined"
          class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#f46714]"
        />
      </div>

      <div>
        <label class="block text-xs font-semibold text-[#686f6a] mb-1">Szerepkör</label>
        <select
          v-model="form.role"
          :disabled="mode === 'edit' && (editingUser?.role === Role.BOSS || isSelf)"
          class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#f46714] disabled:bg-slate-100"
        >
          <option
            v-if="mode === 'edit' && editingUser?.role === Role.BOSS"
            :value="Role.BOSS"
          >
            {{ roleMeta[Role.BOSS].label }}
          </option>
          <option v-for="r in assignableRoles" :key="r" :value="r">
            {{ roleMeta[r]?.label ?? r }}
          </option>
        </select>
      </div>

      <template v-if="mode === 'create'">
        <div v-if="!roleMeta[form.role]?.isUnbound">
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Elsődleges raktár / üzlet (opcionális)
          </label>
          <select
            v-model="form.initialLocationId"
            class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#f46714]"
          >
            <option value="">— Később rendelem hozzá —</option>
            <option v-for="loc in rootLocations" :key="loc.id" :value="loc.id">
              {{ loc.name }} ({{ loc.type === LocationType.WAREHOUSE ? 'Raktár' : 'Üzlet' }})
            </option>
          </select>
        </div>

        <div>
          <label class="block text-xs font-semibold text-[#686f6a] mb-1">
            Kezdeti jelszó (min. 8 karakter)
          </label>
          <input
            v-model="form.password"
            type="password"
            required
            minlength="8"
            placeholder="••••••••"
            class="w-full h-10 rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#f46714]"
          />
        </div>
      </template>

      <div
        v-else
        class="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-200"
      >
        <div>
          <p class="text-xs font-semibold text-[#171918]">Fiók állapota</p>
          <p class="text-[11px] text-[#686f6a]">Inaktív felhasználó nem tud bejelentkezni</p>
        </div>
        <input
          v-model="form.isActive"
          type="checkbox"
          :disabled="editingUser?.role === Role.BOSS || isSelf"
          class="size-4 accent-[#f46714] cursor-pointer"
        />
      </div>

      <div class="flex justify-end gap-2 pt-3">
        <button
          type="button"
          @click="emit('update:visible', false)"
          class="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 cursor-pointer"
        >
          Mégse
        </button>
        <button
          type="submit"
          :disabled="loading"
          class="px-4 py-2 rounded-xl bg-[#171918] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
        >
          <template v-if="loading">Mentés...</template>
          <template v-else-if="mode === 'create'">Felhasználó létrehozása</template>
          <template v-else>Változtatások mentése</template>
        </button>
      </div>
    </form>
  </Dialog>
</template>
