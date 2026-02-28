const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'
const TOKEN_KEY = 'enertrans.sigf.token'

export class ApiRequestError extends Error {
  status: number
  path: string
  method: string
  responseBody: string

  constructor(params: { status: number; path: string; method: string; responseBody: string }) {
    const { status, path, method, responseBody } = params
    super(`${status} ${responseBody || 'Error en la API'}`)
    this.name = 'ApiRequestError'
    this.status = status
    this.path = path
    this.method = method
    this.responseBody = responseBody
  }
}

export const getAuthToken = (): string | null => {
  if (typeof window === 'undefined') {
    return null
  }
  return window.localStorage.getItem(TOKEN_KEY)
}

export const setAuthToken = (token: string | null) => {
  if (typeof window === 'undefined') {
    return
  }
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token)
  } else {
    window.localStorage.removeItem(TOKEN_KEY)
  }
}

export const apiRequest = async <T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string | null } = {},
): Promise<T> => {
  const { method = 'GET', body, token = getAuthToken() } = options
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    const message = await response.text()
    throw new ApiRequestError({
      status: response.status,
      path,
      method,
      responseBody: message || 'Error en la API',
    })
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}
