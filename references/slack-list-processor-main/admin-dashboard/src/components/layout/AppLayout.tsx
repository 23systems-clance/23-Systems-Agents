import { Outlet, useNavigate } from 'react-router-dom';
import { AppSidebar } from './AppSidebar';
import { useAdminAuth } from '@/hooks/useAdminAuth';

export function AppLayout() {
  const { logout } = useAdminAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen overflow-hidden">
      <AppSidebar onLogout={handleLogout} />
      <main className="flex-1 overflow-y-auto bg-background bg-dot-pattern p-6">
        <Outlet />
      </main>
    </div>
  );
}
