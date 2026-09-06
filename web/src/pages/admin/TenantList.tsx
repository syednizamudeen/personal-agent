import { useState, type FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Table, Th, Td } from '../../components/ui/Table';

interface Tenant {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  loginEmail: string | null;
  rateLimitMinutes: number;
}

const DEFAULT_RATE_LIMIT_MINUTES = 1440;

export function TenantList() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [rateLimit, setRateLimit] = useState(String(DEFAULT_RATE_LIMIT_MINUTES));

  const { data: tenants } = useQuery<Tenant[]>({
    queryKey: ['admin', 'tenants'],
    queryFn: () => apiFetch('/admin/tenants'),
  });

  const createTenant = useMutation({
    mutationFn: () =>
      apiFetch('/admin/tenants', {
        method: 'POST',
        body: JSON.stringify({ name, rateLimitMinutes: Number(rateLimit) }),
      }),
    onSuccess: () => {
      setName('');
      setRateLimit(String(DEFAULT_RATE_LIMIT_MINUTES));
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createTenant.mutate();
  }

  return (
    <Card>
      <h2 className="font-semibold mb-3">Tenants</h2>
      <form onSubmit={handleSubmit} className="mb-3">
        <div className="flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-48">
            <label htmlFor="tenantName" className="text-muted text-sm block mb-1">
              Tenant name
            </label>
            <Input
              id="tenantName"
              placeholder="New tenant name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="w-44">
            <label htmlFor="rateLimit" className="text-muted text-sm block mb-1">
              Rate limit (minutes)
            </label>
            <Input
              id="rateLimit"
              type="number"
              min={1}
              step={1}
              value={rateLimit}
              onChange={(e) => setRateLimit(e.target.value)}
              required
            />
          </div>
          <Button type="submit" disabled={createTenant.isPending}>
            {createTenant.isPending ? 'Creating...' : 'Create'}
          </Button>
        </div>
        <p className="text-muted text-sm mt-1">
          One auto-reply per contact within this window. {DEFAULT_RATE_LIMIT_MINUTES} minutes = 24 hours.
        </p>
        {createTenant.isError && <p className="text-danger text-sm mt-1">Could not create the tenant.</p>}
      </form>
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Login Email</Th>
            <Th>Rate limit</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {(tenants ?? []).map((tenant) => (
            <tr key={tenant.id}>
              <Td>
                <Link to={`/admin/tenants/${tenant.id}`} className="text-accent">
                  {tenant.name}
                </Link>
              </Td>
              <Td>{tenant.loginEmail ?? '-'}</Td>
              <Td>{tenant.rateLimitMinutes} min</Td>
              <Td>
                <span className={tenant.status === 'ACTIVE' ? 'text-success' : 'text-danger'}>{tenant.status}</span>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
