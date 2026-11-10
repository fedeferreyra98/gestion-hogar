import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    port: 5173,
    // Proxy local al backend (docs/06-local-dev.md)
    proxy: { '/api': { target: 'http://localhost:8080', changeOrigin: true } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    // Margen para máquinas cargadas (varios agentes/builds en paralelo): ver BL-015.
    testTimeout: 10000,
    hookTimeout: 15000,
    // afterEach en orden de definición: el cleanup() de setup.ts desmonta antes de que los
    // afterEach de cada archivo (resetSession, etc.) cambien el estado y disparen warnings de act().
    sequence: { hooks: 'list' },
  },
})
