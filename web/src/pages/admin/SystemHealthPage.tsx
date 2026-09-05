import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';

interface SystemHealth {
  queues: {
    incomingMessages: { waiting: number; active: number; failed: number };
    outgoingReplies: { waiting: number; active: number; failed: number };
  };
  ollama: { reachable: boolean };
}

export function SystemHealthPage() {
  const { data } = useQuery<SystemHealth>({
    queryKey: ['admin', 'system', 'health'],
    queryFn: () => apiFetch('/admin/system/health'),
    refetchInterval: 5000,
  });

  if (!data) return null;

  return (
    <div className="grid grid-cols-3 gap-4">
      <Card>
        <p className="text-muted text-sm">Incoming Queue</p>
        <p className="text-lg">{data.queues.incomingMessages.waiting} waiting</p>
      </Card>
      <Card>
        <p className="text-muted text-sm">Reply Queue</p>
        <p className="text-lg">{data.queues.outgoingReplies.waiting} waiting</p>
      </Card>
      <Card>
        <p className="text-muted text-sm">Ollama</p>
        <p className={data.ollama.reachable ? 'text-success' : 'text-danger'}>
          {data.ollama.reachable ? 'Reachable' : 'Unreachable'}
        </p>
      </Card>
    </div>
  );
}
