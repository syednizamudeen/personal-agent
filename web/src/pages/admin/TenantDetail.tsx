import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Table, Th, Td } from '../../components/ui/Table';

interface Tenant {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  loginEmail: string | null;
}

interface WhatsAppSession {
  id: string;
  status: string;
  phoneNumber: string | null;
}

export function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const { data: tenant } = useQuery<Tenant>({
    queryKey: ['admin', 'tenants', id],
    queryFn: () => apiFetch(`/admin/tenants/${id}`),
  });

  const { data: sessions } = useQuery<WhatsAppSession[]>({
    queryKey: ['admin', 'tenants', id, 'sessions'],
    queryFn: () => apiFetch(`/admin/tenants/${id}/sessions`),
    refetchInterval: 5000,
  });

  const toggleStatus = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/tenants/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: tenant?.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'tenants', id] }),
  });

  const sendReset = useMutation({
    mutationFn: () => apiFetch(`/admin/tenants/${id}/send-password-reset`, { method: 'POST' }),
  });

  const reconnect = useMutation({
    mutationFn: (sessionId: string) => apiFetch(`/admin/tenants/${id}/sessions/${sessionId}/reconnect`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'tenants', id, 'sessions'] }),
  });

  if (!tenant) return null;

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex justify-between items-center">
          <h2 className="font-semibold">{tenant.name}</h2>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => sendReset.mutate()}>
              Send password reset
            </Button>
            <Button variant={tenant.status === 'ACTIVE' ? 'danger' : 'primary'} onClick={() => toggleStatus.mutate()}>
              {tenant.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
            </Button>
          </div>
        </div>
        <p className="text-muted text-sm mt-1">{tenant.loginEmail ?? 'No login email set'}</p>
      </Card>

      <Card>
        <h3 className="font-semibold mb-3">Sessions</h3>
        <Table>
          <thead>
            <tr>
              <Th>Status</Th>
              <Th>Phone</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {(sessions ?? []).map((s) => (
              <tr key={s.id}>
                <Td>{s.status}</Td>
                <Td>{s.phoneNumber ?? '-'}</Td>
                <Td>
                  {s.status === 'LOGGED_OUT' && (
                    <Button variant="ghost" onClick={() => reconnect.mutate(s.id)}>
                      Reconnect
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
