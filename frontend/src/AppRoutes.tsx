import { Navigate, Route, Routes } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { Placeholder } from '@/pages/Placeholder'

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/listas" replace />} />
        <Route path="listas" element={<Placeholder title="Listas" />} />
        <Route path="gastos" element={<Placeholder title="Gastos" />} />
        <Route path="stock" element={<Placeholder title="Stock" />} />
      </Route>
    </Routes>
  )
}
