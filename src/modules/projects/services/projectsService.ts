import { apiRequest } from '../../../services/api/apiClient'
import type { FleetProject } from '../../../types/domain'

export const fetchProjects = (): Promise<FleetProject[]> =>
  apiRequest<FleetProject[]>('/projects')

export const fetchProject = (id: string): Promise<FleetProject> =>
  apiRequest<FleetProject>(`/projects/${id}`)

export const createProject = (data: object): Promise<FleetProject> =>
  apiRequest<FleetProject>('/projects', { method: 'POST', body: data })

export const updateProject = (id: string, data: object): Promise<FleetProject> =>
  apiRequest<FleetProject>(`/projects/${id}`, { method: 'PATCH', body: data })

export const deleteProject = (id: string): Promise<void> =>
  apiRequest<void>(`/projects/${id}`, { method: 'DELETE' })

export const createProjectItem = (projectId: string, data: object): Promise<FleetProject> =>
  apiRequest<FleetProject>(`/projects/${projectId}/items`, { method: 'POST', body: data })

export const updateProjectItem = (projectId: string, itemId: string, data: object): Promise<FleetProject> =>
  apiRequest<FleetProject>(`/projects/${projectId}/items/${itemId}`, { method: 'PATCH', body: data })

export const deleteProjectItem = (projectId: string, itemId: string): Promise<FleetProject> =>
  apiRequest<FleetProject>(`/projects/${projectId}/items/${itemId}`, { method: 'DELETE' })
