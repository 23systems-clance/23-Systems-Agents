import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Inbox,
  BarChart3,
  Phone,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';

const NAV_ITEMS = [
  { to: '/bdr/tasks', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/bdr/dialer', icon: Phone, label: 'Power Dialer' },
  { to: '/bdr/unibox', icon: Inbox, label: 'UniBox' },
  { to: '/bdr/stats', icon: BarChart3, label: 'Stats' },
];

export function BdrSidebar() {
  return (
    <aside className="flex h-screen w-60 flex-col border-r border-sidebar-border bg-sidebar-background">
      {/* Brand */}
      <div className="flex h-16 items-center gap-2.5 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-ring/20">
          <Zap className="h-4 w-4 text-sidebar-ring" />
        </div>
        <div>
          <h1 className="text-sm font-bold tracking-tight text-sidebar-primary">Outreach</h1>
          <p className="text-[10px] font-medium uppercase tracking-widest text-sidebar-foreground/50">
            BDR Platform
          </p>
        </div>
      </div>

      <ScrollArea className="flex-1 px-3 py-4">
        <nav className="flex flex-col gap-1">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'group flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] font-medium transition-all',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground shadow-sm'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground',
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0 opacity-70 group-hover:opacity-100" />
              {label}
            </NavLink>
          ))}
        </nav>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-4">
        <p className="text-[10px] text-sidebar-foreground/40 text-center">
          Powered by DevLabs
        </p>
      </div>
    </aside>
  );
}
