import apiClient from "./axios"


export interface Category {
    id: string
    name: string
    description?: string
    parentId?: string | null
}


export const categoryApi = {
    getAll: () => apiClient.get<Category[]>('/categories'),
    create: (data: Partial<Category>) => apiClient.post<Category>('/categories', data),
    update: (id:string, data: Partial<Category>) => apiClient.patch<Category>(`/categories/${id}`,data),
    remove: (id: string) => apiClient.delete(`/categories/${id}`)
}