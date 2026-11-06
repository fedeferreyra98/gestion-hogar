import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterAll, afterEach, beforeAll, vi } from 'vitest'
import { server } from './server'

// jsdom/undici no aceptan URLs relativas en Request: la base absoluta se define acá
// y no en el código de producción (donde la base es '/api/v1' vía proxy de Vite).
vi.stubEnv('VITE_API_BASE_URL', 'http://localhost/api/v1')

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  cleanup()
})
afterAll(() => server.close())
