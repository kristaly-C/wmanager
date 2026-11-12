import { LocationType, SlotMode } from '@wmanager/shared-types'
import apiClient from './axios'

export interface LocationItem {
  id: string
  parentId: string | null
  name: string
  description?: string | null
  type: LocationType
  slotMode?: SlotMode | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export const locationApi = {
  getAll: () => apiClient.get<LocationItem[]>('/locations'),
  getOne: (id: string) => apiClient.get<LocationItem>(`/locations/${id}`),
  create: (data: {
    name: string
    description?: string
    type: LocationType
    parentId?: string
    slotMode?: SlotMode
    isActive?: boolean
  }) => apiClient.post<LocationItem>('/locations', data),
  update: (
    id: string,
    data: {
      name?: string
      description?: string
      parentId?: string | null
      slotMode?: SlotMode | null
      isActive?: boolean
    },
  ) => apiClient.patch<LocationItem>(`/locations/${id}`, data),
  remove: (id: string) => apiClient.delete(`/locations/${id}`),
}
