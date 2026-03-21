import { useState, useEffect } from 'react';
import { bdrApi } from '@/lib/bdr-api-client';

interface BdrAuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
}

/**
 * Hook to check BDR authentication state.
 * On first load, if a `token` query param is present, it passes it
 * to the API to establish a session.
 */
export function useBdrAuth(): BdrAuthState {
  const [state, setState] = useState<BdrAuthState>({
    isAuthenticated: false,
    isLoading: true,
  });

  useEffect(() => {
    async function checkAuth() {
      try {
        // Pass token from URL if present (first-time magic link visit)
        const params = new URLSearchParams(window.location.search);
        const token = params.get('token');
        const url = token ? `/tasks?token=${token}` : '/tasks';

        await bdrApi.get(url);
        setState({ isAuthenticated: true, isLoading: false });

        // Clean token from URL after successful auth
        if (token) {
          const cleanUrl = window.location.pathname;
          window.history.replaceState({}, '', cleanUrl);
        }
      } catch {
        setState({ isAuthenticated: false, isLoading: false });
      }
    }

    checkAuth();
  }, []);

  return state;
}
