import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { Card } from './ui/Card';
import { Table, Th, Td } from './ui/Table';

interface MessageLog {
  id: string;
  remoteJid: string;
  status: string;
  detectedLanguage: string | null;
  suggestedReply: string | null;
  createdAt: string;
}

interface Props {
  // '/portal/messages' or '/admin/tenants/<id>/messages' — both routers mount a
  // handler over the same MessageLog rows, so one component serves both portals.
  basePath: string;
  queryKey: unknown[];
}

export function MessagesCard({ basePath, queryKey }: Props) {
  const { data: messages } = useQuery<MessageLog[]>({
    queryKey,
    queryFn: () => apiFetch(basePath),
  });

  return (
    <Card>
      <h2 className="font-semibold mb-3">Recent Messages</h2>
      <Table>
        <thead>
          <tr>
            <Th>From</Th>
            <Th>Status</Th>
            <Th>Language</Th>
            <Th>Reply</Th>
            <Th>Time</Th>
          </tr>
        </thead>
        <tbody>
          {(messages ?? []).map((m) => (
            <tr key={m.id}>
              <Td>{m.remoteJid}</Td>
              <Td>{m.status}</Td>
              <Td>{m.detectedLanguage ?? '-'}</Td>
              <Td>{m.suggestedReply ?? '-'}</Td>
              <Td>{new Date(m.createdAt).toLocaleString()}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
