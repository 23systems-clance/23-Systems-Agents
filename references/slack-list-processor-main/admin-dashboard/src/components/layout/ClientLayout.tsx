/**
 * Client dashboard layout (T065).
 *
 * Simple layout with a sidebar for client-facing pages.
 */

import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard,
  CreditCard,
  FileSpreadsheet,
  Hash,
  Settings,
  LogOut,
} from 'lucide-react';
import { getClientMe } from '@/services/client-api';
import { Button } from '@/components/ui/button';

const NAV_ITEMS = [
  { to: '/client', icon: LayoutDashboard, label: 'Overview', end: true },
  { to: '/client/billing', icon: CreditCard, label: 'Billing', end: false },
  { to: '/client/enrichments', icon: FileSpreadsheet, label: 'Enrichments', end: false },
  { to: '/client/channels', icon: Hash, label: 'Channels', end: false },
  { to: '/client/settings', icon: Settings, label: 'Settings', end: false },
];

export function ClientLayout() {
  const navigate = useNavigate();

  const { data: user } = useQuery({
    queryKey: ['client-me'],
    queryFn: getClientMe,
  });

  const handleLogout = async () => {
    try {
      await fetch('/api/v1/client/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // ignore
    }
    navigate('/client/login');
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <aside className="w-64 border-r bg-card flex flex-col">
        <div className="p-4 border-b">
          <h1 className="text-lg font-semibold">Client Dashboard</h1>
          {user && (
            <p className="text-sm text-muted-foreground truncate">{user.displayName}</p>
          )}
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-muted'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto bg-background p-6">
        <Outlet />
      </main>
    </div>
  );
}
