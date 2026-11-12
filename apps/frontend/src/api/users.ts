import { Role } from '@wmanager/shared-types'
import apiClient from './axios'
import type { LocationItem } from './locations'

export interface UserLocationEntry {
  id: string
  userId: string
  locationId: string
  createdAt: string
  location: LocationItem
}

export interface UserItem {
  id: string
  email: string
  name: string
  role: Role
  isActive: boolean
  passwordChangedAt?: string | null
  createdAt: string
  updatedAt: string
  userLocations?: UserLocationEntry[]
}

export interface CreateUserPayload {
  name: string
  email: string
  role: Role
  password: string
}

export interface UpdateUserPayload {
  name?: string
  email?: string
  role?: Role
  isActive?: boolean
}

export const userApi = {
  getAll: () => apiClient.get<UserItem[]>('/users'),
  getOne: (id: string) => apiClient.get<UserItem>(`/users/${id}`),
  create: (data: CreateUserPayload) => apiClient.post<UserItem>('/users', data),
  update: (id: string, data: UpdateUserPayload) =>
    apiClient.patch<UserItem>(`/users/${id}`, data),
  remove: (id: string) => apiClient.delete(`/users/${id}`),

  // Helyszín (Raktár / Üzlet) hozzárendelések
  listLocations: (userId: string) =>
    apiClient.get<UserLocationEntry[]>(`/users/${userId}/locations`),
  assignLocation: (userId: string, locationId: string) =>
    apiClient.post<UserLocationEntry>(`/users/${userId}/locations`, { locationId }),
  unassignLocation: (userId: string, locationId: string) =>
    apiClient.delete(`/users/${userId}/locations/${locationId}`),
}
