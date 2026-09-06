import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { Card } from './ui/Card';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Table, Th, Td } from './ui/Table';

interface ContactFilter {
  id: string;
  jid: string;
  type: 'ALLOW' | 'BLOCK';
  label: string | null;
}

interface Props {
  basePath: string;
  queryKey: unknown[];
}

export function ContactFiltersCard({ basePath, queryKey }: Props) {
  const queryClient = useQueryClient();
  const [jid, setJid] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState<'ALLOW' | 'BLOCK'>('BLOCK');

  const { data: filters } = useQuery<ContactFilter[]>({
    queryKey,
    queryFn: () => apiFetch(basePath),
  });

  const createFilter = useMutation({
    mutationFn: () => apiFetch(basePath, { method: 'POST', body: JSON.stringify({ jid, type, label }) }),
    onSuccess: () => {
      setJid('');
      setLabel('');
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const deleteFilter = useMutation({
    mutationFn: (id: string) => apiFetch(`${basePath}/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createFilter.mutate();
  }

  return (
    <Card>
      <h2 className="font-semibold mb-1">Contacts</h2>
      <p className="text-muted text-sm mb-3">
        Enter a phone number (<code>6591234567</code>) or a full JID copied from the message log.{' '}
        <strong>BLOCK</strong> always ignores that contact. <strong>ALLOW</strong> only matters when the reply policy
        is set to allowlist.
      </p>
      <form onSubmit={handleSubmit} className="flex gap-2 mb-3 flex-wrap items-end">
        <div className="flex-1 min-w-40">
          <Input placeholder="Phone number or JID" value={jid} onChange={(e) => setJid(e.target.value)} required />
        </div>
        <div className="flex-1 min-w-32">
          <Input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as 'ALLOW' | 'BLOCK')}
          className="bg-surface border border-border rounded-md px-2 py-1.5 text-sm"
        >
          <option value="BLOCK">BLOCK</option>
          <option value="ALLOW">ALLOW</option>
        </select>
        <Button type="submit" disabled={createFilter.isPending}>
          Add
        </Button>
      </form>
      {createFilter.isError && <p className="text-danger text-sm mb-2">Could not save that contact.</p>}
      {(filters ?? []).length === 0 ? (
        <p className="text-muted text-sm">No contact rules yet.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Contact</Th>
              <Th>Label</Th>
              <Th>Type</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {(filters ?? []).map((filter) => (
              <tr key={filter.id}>
                <Td>{filter.jid}</Td>
                <Td>{filter.label ?? '-'}</Td>
                <Td>
                  <span className={filter.type === 'ALLOW' ? 'text-success' : 'text-danger'}>{filter.type}</span>
                </Td>
                <Td>
                  <Button variant="danger" onClick={() => deleteFilter.mutate(filter.id)}>
                    Remove
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
