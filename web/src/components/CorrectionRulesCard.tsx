import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { Card } from './ui/Card';
import { Input } from './ui/Input';
import { Button } from './ui/Button';
import { Table, Th, Td } from './ui/Table';

interface CorrectionRule {
  id: string;
  pattern: string;
  action: string;
  category: string | null;
}

interface Props {
  // '/portal/corrections' or '/admin/tenants/<id>/corrections' — the two routers mount
  // the same reviewController, so one component serves both portals.
  basePath: string;
  queryKey: unknown[];
}

export function CorrectionRulesCard({ basePath, queryKey }: Props) {
  const queryClient = useQueryClient();
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState('SKIP_REPLY');

  const { data: rules } = useQuery<CorrectionRule[]>({
    queryKey,
    queryFn: () => apiFetch(basePath),
  });

  const createRule = useMutation({
    mutationFn: () =>
      apiFetch(basePath, { method: 'POST', body: JSON.stringify({ pattern, isRegex: true, action }) }),
    onSuccess: () => {
      setPattern('');
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const deleteRule = useMutation({
    mutationFn: (id: string) => apiFetch(`${basePath}/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createRule.mutate();
  }

  return (
    <Card>
      <h2 className="font-semibold mb-1">Correction rules</h2>
      <p className="text-muted text-sm mb-3">
        Matched against the message text before the AI runs. <strong>SKIP_REPLY</strong> ignores the message entirely,{' '}
        <strong>FORCE_GREETING</strong> sends a fixed reply, <strong>FORCE_CATEGORY</strong> flags it for review.
      </p>
      <form onSubmit={handleSubmit} className="flex gap-2 mb-3">
        <Input placeholder="Pattern (regex)" value={pattern} onChange={(e) => setPattern(e.target.value)} required />
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          className="bg-surface border border-border rounded-md px-2 text-sm"
        >
          <option value="SKIP_REPLY">SKIP_REPLY</option>
          <option value="FORCE_GREETING">FORCE_GREETING</option>
          <option value="FORCE_CATEGORY">FORCE_CATEGORY</option>
        </select>
        <Button type="submit">Add</Button>
      </form>
      {(rules ?? []).length === 0 ? (
        <p className="text-muted text-sm">No rules yet. Every message goes to the AI.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Pattern</Th>
              <Th>Action</Th>
              <Th> </Th>
            </tr>
          </thead>
          <tbody>
            {(rules ?? []).map((rule) => (
              <tr key={rule.id}>
                <Td>{rule.pattern}</Td>
                <Td>{rule.action}</Td>
                <Td>
                  <Button variant="danger" onClick={() => deleteRule.mutate(rule.id)}>
                    Delete
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
