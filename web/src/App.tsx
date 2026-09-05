import type { ReactElement } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PortalAuthProvider, AdminAuthProvider, usePortalAuth, useAdminAuth } from './lib/authContext';
import { PortalLogin } from './pages/portal/PortalLogin';
import { AdminLogin } from './pages/admin/AdminLogin';

const queryClient = new QueryClient();

function PortalGuard({ children }: { children: ReactElement }) {
  const { isAuthenticated, isLoading } = usePortalAuth();
  if (isLoading) return null;
  return isAuthenticated ? children : <Navigate to="/portal/login" replace />;
}

function AdminGuard({ children }: { children: ReactElement }) {
  const { isAuthenticated, isLoading } = useAdminAuth();
  if (isLoading) return null;
  return isAuthenticated ? children : <Navigate to="/admin/login" replace />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <PortalAuthProvider>
        <AdminAuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Navigate to="/portal/login" replace />} />
              <Route path="/portal/login" element={<PortalLogin />} />
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route
                path="/portal/*"
                element={
                  <PortalGuard>
                    <div>Portal dashboard placeholder</div>
                  </PortalGuard>
                }
              />
              <Route
                path="/admin/*"
                element={
                  <AdminGuard>
                    <div>Admin dashboard placeholder</div>
                  </AdminGuard>
                }
              />
            </Routes>
          </BrowserRouter>
        </AdminAuthProvider>
      </PortalAuthProvider>
    </QueryClientProvider>
  );
}
