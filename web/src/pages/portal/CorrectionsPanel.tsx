import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Table, Th, Td } from '../../components/ui/Table';

interface CorrectionRule {
  id: string;
  pattern: string;
  action: string;
  category: string | null;
}

export function CorrectionsPanel() {
  const queryClient = useQueryClient();
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState('SKIP_REPLY');

  const { data: rules } = useQuery<CorrectionRule[]>({
    queryKey: ['portal', 'corrections'],
    queryFn: () => apiFetch('/portal/corrections'),
  });

  const createRule = useMutation({
    mutationFn: () => apiFetch('/portal/corrections', { method: 'POST', body: JSON.stringify({ pattern, isRegex: true, action }) }),
    onSuccess: () => {
      setPattern('');
      queryClient.invalidateQueries({ queryKey: ['portal', 'corrections'] });
    },
  });

  const deleteRule = useMutation({
    mutationFn: (id: string) => apiFetch(`/portal/corrections/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal', 'corrections'] }),
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    createRule.mutate();
  }

  return (
    <Card>
      <h2 className="font-semibold mb-3">Correction Rules</h2>
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
    </Card>
  );
}
