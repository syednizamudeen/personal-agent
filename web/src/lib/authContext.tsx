import { createContext, useContext, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from './apiClient';

type Role = 'portal' | 'admin';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

function useAuth(role: Role): AuthState {
  const queryClient = useQueryClient();
  const meKey = [role, 'me'];

  const { data, isLoading } = useQuery({
    queryKey: meKey,
    queryFn: async () => {
      try {
        return await apiFetch(`/${role}/me`);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null;
        throw err;
      }
    },
  });

  const login = useCallback(
    async (email: string, password: string) => {
      await apiFetch(`/${role}/login`, { method: 'POST', body: JSON.stringify({ email, password }) });
      await queryClient.invalidateQueries({ queryKey: meKey });
    },
    [role, queryClient, meKey]
  );

  const logout = useCallback(async () => {
    await apiFetch(`/${role}/logout`, { method: 'POST' });
    await queryClient.invalidateQueries({ queryKey: meKey });
  }, [role, queryClient, meKey]);

  return { isAuthenticated: Boolean(data), isLoading, login, logout };
}

const PortalAuthContext = createContext<AuthState | null>(null);
const AdminAuthContext = createContext<AuthState | null>(null);

export function PortalAuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth('portal');
  return <PortalAuthContext.Provider value={auth}>{children}</PortalAuthContext.Provider>;
}

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth('admin');
  return <AdminAuthContext.Provider value={auth}>{children}</AdminAuthContext.Provider>;
}

export function usePortalAuth() {
  const ctx = useContext(PortalAuthContext);
  if (!ctx) throw new Error('usePortalAuth must be used within PortalAuthProvider');
  return ctx;
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error('useAdminAuth must be used within AdminAuthProvider');
  return ctx;
}
