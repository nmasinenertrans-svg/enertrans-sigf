import { apiRequest } from '../../../services/api/apiClient'
import type { PostventaEvent } from '../../../types/domain'

export const fetchEvents = (from: string, to: string): Promise<PostventaEvent[]> =>
  apiRequest<PostventaEvent[]>(`/postventa?from=${from}&to=${to}`)

export const createEvent = (data: object): Promise<PostventaEvent> =>
  apiRequest<PostventaEvent>('/postventa', { method: 'POST', body: data })

export const updateEvent = (id: string, data: object): Promise<PostventaEvent> =>
  apiRequest<PostventaEvent>(`/postventa/${id}`, { method: 'PATCH', body: data })

export const deleteEvent = (id: string): Promise<void> =>
  apiRequest<void>(`/postventa/${id}`, { method: 'DELETE' })
