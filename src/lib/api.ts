import axios, { AxiosError, type AxiosInstance } from 'axios'
import { supabase } from '@/lib/supabase'

/** Where fitness-api lives. Every request is absolute against this — never relative. */
export const BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8080'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type Query = Record<string, string | number | undefined | null>

export const http: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: { Accept: 'application/json' },
  // Undefined and null params are dropped rather than serialised as "undefined".
  paramsSerializer: {
    indexes: null,
  },
})

/**
 * Attaches the access token when a session exists.
 *
 * The header is omitted rather than the request being blocked when there is none:
 * fitness-api does not validate tokens yet, and refusing here would make an unsecured
 * backend unreachable while hiding the real response from the Network tab.
 */
http.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

/** Every failure leaves this file as an ApiError, so callers never unwrap axios shapes. */
http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (!(error instanceof AxiosError)) {
      throw new ApiError(0, error instanceof Error ? error.message : 'Request failed')
    }

    // No response at all: the request never reached the server, or CORS blocked it.
    if (!error.response) {
      throw new ApiError(
        0,
        `Cannot reach the API at ${BASE_URL}. Is fitness-api running, and is this ` +
          `origin in its CORS allow-list?`,
      )
    }

    const { status, data } = error.response
    const message =
      typeof data === 'object' && data !== null && typeof (data as { message?: unknown }).message === 'string'
        ? (data as { message: string }).message
        : fallbackMessage(status)

    throw new ApiError(status, message)
  },
)

function fallbackMessage(status: number): string {
  if (status === 401) return 'Your session has expired. Please sign in again.'
  if (status === 403) return 'You do not have access to that.'
  if (status === 404) return 'Not found.'
  return `Request failed (${status})`
}

/** 204 carries no body; everything else is JSON. */
function unwrap<T>(status: number, data: unknown): T {
  return status === 204 ? (undefined as T) : (data as T)
}

export const api = {
  get: async <T,>(path: string, params?: Query) => {
    const { status, data } = await http.get<T>(path, { params })
    return unwrap<T>(status, data)
  },
  post: async <T,>(path: string, body?: unknown) => {
    const { status, data } = await http.post<T>(path, body)
    return unwrap<T>(status, data)
  },
  put: async <T,>(path: string, body?: unknown) => {
    const { status, data } = await http.put<T>(path, body)
    return unwrap<T>(status, data)
  },
  patch: async <T,>(path: string, body?: unknown) => {
    const { status, data } = await http.patch<T>(path, body)
    return unwrap<T>(status, data)
  },
  delete: async <T,>(path: string) => {
    const { status, data } = await http.delete<T>(path)
    return unwrap<T>(status, data)
  },
}
