import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

interface Session {
  sessionId: string;
  status: string;
  phoneNumber: string | null;
  qrCode: string | null;
}

// One live socket per tenant: Baileys auth state is keyed per tenant, so a second
// session shares the first's credentials and the two knock each other offline.
const BLOCKS_NEW_SESSION = ['PENDING_QR', 'CONNECTED', 'DISCONNECTED'];

export function SessionsPanel() {
  const queryClient = useQueryClient();

  const { data: sessions } = useQuery<Session[]>({
    queryKey: ['portal', 'sessions'],
    queryFn: () => apiFetch('/portal/sessions'),
    refetchInterval: 4000,
  });

  const createSession = useMutation({
    mutationFn: () => apiFetch('/portal/sessions', { method: 'POST', body: JSON.stringify({ label: 'Main Line' }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal', 'sessions'] }),
  });

  const reconnect = useMutation({
    mutationFn: (sessionId: string) => apiFetch(`/portal/sessions/${sessionId}/reconnect`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['portal', 'sessions'] }),
  });

  const hasLiveSession = (sessions ?? []).some((s) => BLOCKS_NEW_SESSION.includes(s.status));

  return (
    <Card>
      <div className="flex justify-between items-center mb-3">
        <h2 className="font-semibold">WhatsApp Session</h2>
        {!hasLiveSession && (
          <Button onClick={() => createSession.mutate()} disabled={createSession.isPending}>
            New Session
          </Button>
        )}
      </div>
      {hasLiveSession && (
        <p className="text-muted text-sm">
          You already have a session. Use <strong>Reconnect device</strong> to re-link WhatsApp.
        </p>
      )}
      {(sessions ?? []).map((session) => (
        <div key={session.sessionId} className="border-t border-border pt-3 mt-3 first:border-0 first:pt-0 first:mt-0">
          <p className="text-sm">
            Status: <span className="text-accent">{session.status}</span>
            {session.phoneNumber && <span className="text-muted"> ({session.phoneNumber})</span>}
          </p>
          {session.qrCode && <img src={session.qrCode} alt="Scan to link WhatsApp" className="w-48 h-48 mt-2" />}
          {session.status === 'LOGGED_OUT' && (
            <Button variant="ghost" className="mt-2" onClick={() => reconnect.mutate(session.sessionId)}>
              Reconnect device
            </Button>
          )}
        </div>
      ))}
    </Card>
  );
}
