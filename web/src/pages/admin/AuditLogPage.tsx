import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';
import { Table, Th, Td } from '../../components/ui/Table';

interface AuditLog {
  id: string;
  actorType: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  createdAt: string;
}

export function AuditLogPage() {
  const { data: logs } = useQuery<AuditLog[]>({
    queryKey: ['admin', 'audit-logs'],
    queryFn: () => apiFetch('/admin/audit-logs'),
  });

  return (
    <Card>
      <h2 className="font-semibold mb-3">Audit Log</h2>
      <Table>
        <thead>
          <tr>
            <Th>When</Th>
            <Th>Actor</Th>
            <Th>Action</Th>
            <Th>Target</Th>
          </tr>
        </thead>
        <tbody>
          {(logs ?? []).map((log) => (
            <tr key={log.id}>
              <Td>{new Date(log.createdAt).toLocaleString()}</Td>
              <Td>
                {log.actorType} ({log.actorId})
              </Td>
              <Td>{log.action}</Td>
              <Td>
                {log.targetType} {log.targetId}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
