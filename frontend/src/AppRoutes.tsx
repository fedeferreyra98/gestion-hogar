import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { LazyRoute } from '@/components/LazyRoute'
import { RequireAuth } from '@/auth/RequireAuth'
import { CatalogPage } from '@/pages/CatalogPage'
import { ExpensesPage } from '@/pages/ExpensesPage'
import { LoginPage } from '@/pages/LoginPage'
import { RegisterPage } from '@/pages/RegisterPage'
import { CompleteListPage } from '@/pages/CompleteListPage'
import { ShoppingListDetailPage } from '@/pages/ShoppingListDetailPage'
import { ShoppingListsPage } from '@/pages/ShoppingListsPage'
import { StockPage } from '@/pages/StockPage'

// Recharts pesa: la pantalla de reportes se carga bajo demanda.
const loadReports = () => import('@/reports/ReportsPage').then((m) => ({ default: m.ReportsPage }))

export function AppRoutes() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="registro" element={<RegisterPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/listas" replace />} />
          <Route path="listas" element={<ShoppingListsPage />} />
          <Route path="listas/:id" element={<ShoppingListDetailPage />} />
          <Route path="listas/:id/finalizar" element={<CompleteListPage />} />
          <Route path="gastos/*" element={<ExpensesPage />} />
          <Route path="stock" element={<StockPage />} />
          <Route
            path="reportes"
            element={<LazyRoute load={loadReports} subject="los reportes" />}
          />
          <Route path="catalogo" element={<CatalogPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
