import { Outlet, NavLink } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Home, Refrigerator, CalendarDays, Receipt, Settings } from 'lucide-react'
import PageTransition from './PageTransition'

const navItems = [
  { to: '/', icon: Home, label: 'nav.home' },
  { to: '/fridge', icon: Refrigerator, label: 'nav.fridge' },
  { to: '/history', icon: CalendarDays, label: 'nav.history' },
  { to: '/payslip', icon: Receipt, label: 'nav.payslip' },
  { to: '/settings', icon: Settings, label: 'nav.settings' }
]

export default function Layout() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen bg-warm-bg">
      <main className="pb-20">
        <PageTransition>
          <Outlet />
        </PageTransition>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-md border-t border-gray-100 px-2 py-2 z-50">
        <div className="max-w-lg mx-auto flex justify-around">
          {navItems.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `${isActive ? 'nav-item-active' : 'nav-item-inactive'} transition-all duration-200`
              }
            >
              {({ isActive }) => (
                <>
                  <div className={`p-1.5 rounded-xl transition-all duration-200 ${isActive ? 'bg-primary/10 scale-110' : ''}`}>
                    <Icon size={22} strokeWidth={2} />
                  </div>
                  <span className="text-[11px]">{t(label)}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  )
}
