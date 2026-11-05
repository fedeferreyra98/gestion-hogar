import { setupServer } from 'msw/node'

// Handlers mock (sin datos reales). Cada test agrega los suyos con server.use(...)
export const server = setupServer()
