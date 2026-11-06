import { ClipboardList, Package, Receipt, Tags, type LucideIcon } from 'lucide-react'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export const navItems: NavItem[] = [
  { to: '/listas', label: 'Listas', icon: ClipboardList },
  { to: '/gastos', label: 'Gastos', icon: Receipt },
  { to: '/stock', label: 'Stock', icon: Package },
  { to: '/catalogo', label: 'Catálogo', icon: Tags },
]
