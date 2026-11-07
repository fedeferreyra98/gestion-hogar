import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth } from '@/auth/RequireAuth'
import { CatalogPage } from '@/pages/CatalogPage'
import { LoginPage } from '@/pages/LoginPage'
import { Placeholder } from '@/pages/Placeholder'
import { RegisterPage } from '@/pages/RegisterPage'
import { StockPage } from '@/pages/StockPage'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="registro" element={<RegisterPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/listas" replace />} />
          <Route path="listas" element={<Placeholder title="Listas" />} />
          <Route path="gastos" element={<Placeholder title="Gastos" />} />
          <Route path="stock" element={<StockPage />} />
          <Route path="catalogo" element={<CatalogPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
