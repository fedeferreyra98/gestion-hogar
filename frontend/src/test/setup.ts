import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { server } from './server'

// jsdom/undici no aceptan URLs relativas en Request: la base absoluta se define acá
// y no en el código de producción (donde la base es '/api/v1' vía proxy de Vite).
vi.stubEnv('VITE_API_BASE_URL', 'http://localhost/api/v1')

// Node >= 25 expone un `localStorage` global sin funciones que pisa el de jsdom: se reemplaza
// por un Storage en memoria para que los tests de sesión sean deterministas.
class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  clear() {
    this.data.clear()
  }
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
  setItem(key: string, value: string) {
    this.data.set(key, String(value))
  }
}
vi.stubGlobal('localStorage', new MemoryStorage())

// Los findBy*/waitFor usan 1 s por defecto: con la CPU saturada no alcanza (BL-015).
configure({ asyncUtilTimeout: 5000 })

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  cleanup()
})
afterAll(() => server.close())
