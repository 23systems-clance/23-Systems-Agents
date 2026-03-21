import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { api } from '@/lib/api-client';

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'VIEWER';
}

export interface AdminAuthState {
  user: AdminUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AdminAuthState | null>(null);

/** Hook to access auth state. Must be used within AuthProvider. */
export function useAdminAuth(): AdminAuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AuthProvider');
  return ctx;
}

/** Hook that manages the auth state (used by AuthProvider). */
export function useAuthState(): AdminAuthState {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check session on mount.
  useEffect(() => {
    api.get('/auth/me')
      .then((res) => setUser(res.data))
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string): Promise<string | null> => {
    try {
      const res = await api.post('/auth/login', { username, password });
      setUser(res.data);
      return null;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { message?: string } } };
        return axiosErr.response?.data?.message ?? 'Login failed';
      }
      return 'Login failed';
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Ignore logout errors.
    }
    setUser(null);
  }, []);

  return {
    user,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
  };
}
