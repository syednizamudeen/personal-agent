import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';
import { Table, Th, Td } from '../../components/ui/Table';

interface MessageLog {
  id: string;
  remoteJid: string;
  status: string;
  detectedLanguage: string | null;
  suggestedReply: string | null;
  createdAt: string;
}

export function MessagesPanel() {
  const { data: messages } = useQuery<MessageLog[]>({
    queryKey: ['portal', 'messages'],
    queryFn: () => apiFetch('/portal/messages'),
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
