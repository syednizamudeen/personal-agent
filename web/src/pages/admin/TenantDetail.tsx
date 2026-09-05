import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
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
  // null = untouched, so the field tracks the server value until the admin edits it
  const [emailDraft, setEmailDraft] = useState<string | null>(null);

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

  const saveLoginEmail = useMutation({
    mutationFn: (value: string) =>
      apiFetch(`/admin/tenants/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ loginEmail: value }),
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
        <div className="mt-3">
          <label htmlFor="loginEmail" className="text-muted text-sm block mb-1">
            Login email
          </label>
          <div className="flex gap-2 items-start">
            <Input
              id="loginEmail"
              type="email"
              placeholder="No login email set"
              value={emailDraft ?? tenant.loginEmail ?? ''}
              onChange={(e) => setEmailDraft(e.target.value)}
            />
            <Button
              onClick={() => saveLoginEmail.mutate(emailDraft ?? tenant.loginEmail ?? '')}
              disabled={saveLoginEmail.isPending || emailDraft === null || emailDraft === (tenant.loginEmail ?? '')}
            >
              {saveLoginEmail.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
          {saveLoginEmail.isError && <p className="text-danger text-sm mt-1">Could not save the login email.</p>}
          {saveLoginEmail.isSuccess && <p className="text-success text-sm mt-1">Login email saved.</p>}
        </div>
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
