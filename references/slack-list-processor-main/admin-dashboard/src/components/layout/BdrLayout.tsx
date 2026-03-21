import { Outlet } from 'react-router-dom';
import { BdrSidebar } from './BdrSidebar';

export function BdrLayout() {
  return (
    <div className="flex h-screen overflow-hidden">
      <BdrSidebar />
      <main className="flex-1 overflow-y-auto bg-background">
        <Outlet />
      </main>
    </div>
  );
}
