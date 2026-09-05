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
}

export function TenantList() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const { data: tenants } = useQuery<Tenant[]>({
    queryKey: ['admin', 'tenants'],
    queryFn: () => apiFetch('/admin/tenants'),
  });

  const createTenant = useMutation({
    mutationFn: () => apiFetch('/admin/tenants', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: () => {
      setName('');
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
      <form onSubmit={handleSubmit} className="flex gap-2 mb-3">
        <Input placeholder="New tenant name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Button type="submit">Create</Button>
      </form>
      <Table>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Login Email</Th>
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
