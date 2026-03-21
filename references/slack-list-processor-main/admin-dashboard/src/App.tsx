import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { appRouter } from '@/router';
import { AuthContext, useAuthState } from '@/hooks/useAdminAuth';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export default function App() {
  const authState = useAuthState();

  return (
    <AuthContext.Provider value={authState}>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <RouterProvider router={appRouter} />
        </TooltipProvider>
      </QueryClientProvider>
    </AuthContext.Provider>
  );
}
