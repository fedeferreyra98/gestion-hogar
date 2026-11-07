import { Route, Routes } from 'react-router-dom'
import { ExpenseDetailPage, NewExpensePage } from '@/expenses/ExpenseFormPages'
import { ExpenseListPage } from '@/expenses/ExpenseListPage'

export function ExpensesPage() {
  return (
    <Routes>
      <Route index element={<ExpenseListPage />} />
      <Route path="nuevo" element={<NewExpensePage />} />
      <Route path=":id" element={<ExpenseDetailPage />} />
    </Routes>
  )
}
