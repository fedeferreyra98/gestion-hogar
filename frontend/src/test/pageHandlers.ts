import { http, HttpResponse } from 'msw'

const emptyPage = { content: [], page: 0, size: 20, totalElements: 0, totalPages: 0 }

/**
 * Handlers vacíos de las queries que disparan las pantallas al montar. Se usan en tests
 * que solo verifican navegación/sesión y terminan con la pantalla destino aún cargando,
 * para que no queden requests en vuelo sin handler (MSW `onUnhandledRequest: 'error'`).
 * Los tests que asertan datos registran los suyos con server.use(...) (tienen prioridad).
 */
export const emptyPageHandlers = [
  http.get('*/shopping-lists', () => HttpResponse.json(emptyPage)),
  http.get('*/expenses', () => HttpResponse.json({ ...emptyPage, totalFiltered: [] })),
  http.get('*/categories', () => HttpResponse.json([])),
  http.get('*/members', () => HttpResponse.json([])),
  http.get('*/me', () =>
    HttpResponse.json({
      member: {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'ana@example.test',
        displayName: 'Ana Demo',
        role: 'OWNER',
        active: true,
      },
      household: {
        id: '00000000-0000-4000-8000-0000000000aa',
        name: 'Casa Demo',
        baseCurrency: 'ARS',
        timezone: 'America/Argentina/Buenos_Aires',
        expiryWarningDays: 3,
        sharePurchasesByDefault: false,
      },
    }),
  ),
  http.get('*/stock/alerts', () => HttpResponse.json({ expired: [], expiringSoon: [] })),
  http.get('*/stock', () => HttpResponse.json({ ...emptyPage, size: 100 })),
]
