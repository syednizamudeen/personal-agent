import { NavLink, Routes, Route } from 'react-router-dom';
import { useAdminAuth } from '../../lib/authContext';
import { Button } from '../../components/ui/Button';
import { TenantList } from './TenantList';
import { TenantDetail } from './TenantDetail';
import { AuditLogPage } from './AuditLogPage';
import { SystemHealthPage } from './SystemHealthPage';

const navLinkClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'text-accent' : 'text-muted hover:text-text');

export function AdminDashboard() {
  const { logout } = useAdminAuth();

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex justify-between items-center">
        <nav className="flex gap-4 text-sm">
          <NavLink to="/admin/tenants" className={navLinkClass}>
            Tenants
          </NavLink>
          <NavLink to="/admin/audit-logs" className={navLinkClass}>
            Audit Log
          </NavLink>
          <NavLink to="/admin/system" className={navLinkClass}>
            System Health
          </NavLink>
        </nav>
        <Button variant="ghost" onClick={() => logout()}>
          Log out
        </Button>
      </div>
      <Routes>
        <Route index element={<TenantList />} />
        <Route path="tenants" element={<TenantList />} />
        <Route path="tenants/:id" element={<TenantDetail />} />
        <Route path="audit-logs" element={<AuditLogPage />} />
        <Route path="system" element={<SystemHealthPage />} />
      </Routes>
    </div>
  );
}
