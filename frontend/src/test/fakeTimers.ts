import { act } from '@testing-library/react'
import { vi } from 'vitest'

// Referencias reales capturadas antes de que vi.useFakeTimers() las reemplace.
const realSetTimeout = globalThis.setTimeout
const realDateNow = Date.now.bind(Date)

/** Timers falsos completos (timeouts, intervals y Date); restaurar con vi.useRealTimers(). */
export function useFakeClock() {
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  })
}

/**
 * Con timers falsos nada avanza solo, y `waitFor`/`findBy*` de Testing Library dependen de
 * timers que acá están falsos. Cada vuelta adelanta 20 ms de reloj falso (dentro de act, para
 * que corran fetch/MSW/React Query), reevalúa la aserción y cede un tick de reloj REAL.
 * El límite es de tiempo real, no una cantidad fija de pasos: tolera máquinas cargadas.
 */
export async function advanceUntil(assertion: () => void, timeoutMs = 5000) {
  const deadline = realDateNow() + timeoutMs
  for (;;) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
    try {
      assertion()
      return
    } catch (e) {
      if (realDateNow() > deadline) throw e
    }
    await new Promise((resolve) => realSetTimeout(resolve, 10))
  }
}
