import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../../lib/apiClient';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { AssistantSettingsCard } from '../../components/AssistantSettingsCard';
import type { AssistantSettings } from '../../components/AssistantSettingsCard';
import { ContactFiltersCard } from '../../components/ContactFiltersCard';
import { CorrectionRulesCard } from '../../components/CorrectionRulesCard';

interface Tenant extends AssistantSettings {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  loginEmail: string | null;
  rateLimitMinutes: number;
  apiKey: string;
}

interface WhatsAppSession {
  id: string;
  label: string | null;
  status: string;
  phoneNumber: string | null;
  qrCode: string | null;
}

// PENDING_QR is the only state with a live QR; the rest are terminal or connected.
const RECONNECTABLE = ['LOGGED_OUT', 'DISCONNECTED'];
// A tenant supports one live socket (auth state is per tenant), so a second session
// would fight the first over shared credentials. Only a fully LOGGED_OUT tenant may
// start a fresh one — everything else reconnects the row it already has.
const BLOCKS_NEW_SESSION = ['PENDING_QR', 'CONNECTED', 'DISCONNECTED'];

export function TenantDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  // null = untouched, so the field tracks the server value until the admin edits it
  const [emailDraft, setEmailDraft] = useState<string | null>(null);
  const [rateLimitDraft, setRateLimitDraft] = useState<string | null>(null);

  const { data: tenant } = useQuery<Tenant>({
    queryKey: ['admin', 'tenants', id],
    queryFn: () => apiFetch(`/admin/tenants/${id}`),
  });

  const { data: sessions } = useQuery<WhatsAppSession[]>({
    queryKey: ['admin', 'tenants', id, 'sessions'],
    queryFn: () => apiFetch(`/admin/tenants/${id}/sessions`),
    // QR codes expire in ~20s and Baileys replaces them; poll fast enough that the
    // rendered code is still scannable.
    refetchInterval: 3000,
  });

  const toggleStatus = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/tenants/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: tenant?.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'tenants', id] }),
  });

  const saveLoginEmail = useMutation({
    mutationFn: (value: string) =>
      apiFetch(`/admin/tenants/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ loginEmail: value }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'tenants', id] }),
  });

  const saveRateLimit = useMutation({
    mutationFn: (value: number) =>
      apiFetch(`/admin/tenants/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ rateLimitMinutes: value }),
      }),
    onSuccess: () => {
      setRateLimitDraft(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'tenants', id] });
    },
  });

  const createSession = useMutation({
    mutationFn: () => apiFetch(`/admin/tenants/${id}/sessions`, { method: 'POST', body: JSON.stringify({}) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'tenants', id, 'sessions'] }),
  });

  const sendReset = useMutation({
    mutationFn: () => apiFetch(`/admin/tenants/${id}/send-password-reset`, { method: 'POST' }),
  });

  const reconnect = useMutation({
    mutationFn: (sessionId: string) => apiFetch(`/admin/tenants/${id}/sessions/${sessionId}/reconnect`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'tenants', id, 'sessions'] }),
  });

  if (!tenant) return null;

  const hasLiveSession = (sessions ?? []).some((s) => BLOCKS_NEW_SESSION.includes(s.status));

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex justify-between items-center">
          <h2 className="font-semibold">{tenant.name}</h2>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => sendReset.mutate()}>
              Send password reset
            </Button>
            <Button variant={tenant.status === 'ACTIVE' ? 'danger' : 'primary'} onClick={() => toggleStatus.mutate()}>
              {tenant.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <label htmlFor="loginEmail" className="text-muted text-sm block mb-1">
            Login email
          </label>
          <div className="flex gap-2 items-start">
            <Input
              id="loginEmail"
              type="email"
              placeholder="No login email set"
              value={emailDraft ?? tenant.loginEmail ?? ''}
              onChange={(e) => setEmailDraft(e.target.value)}
            />
            <Button
              onClick={() => saveLoginEmail.mutate(emailDraft ?? tenant.loginEmail ?? '')}
              disabled={saveLoginEmail.isPending || emailDraft === null || emailDraft === (tenant.loginEmail ?? '')}
            >
              {saveLoginEmail.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
          {saveLoginEmail.isError && <p className="text-danger text-sm mt-1">Could not save the login email.</p>}
          {saveLoginEmail.isSuccess && <p className="text-success text-sm mt-1">Login email saved.</p>}
        </div>

        <div className="mt-3">
          <label htmlFor="rateLimitMinutes" className="text-muted text-sm block mb-1">
            Rate limit (minutes)
          </label>
          <div className="flex gap-2 items-start">
            <Input
              id="rateLimitMinutes"
              type="number"
              min={1}
              step={1}
              value={rateLimitDraft ?? String(tenant.rateLimitMinutes)}
              onChange={(e) => setRateLimitDraft(e.target.value)}
            />
            <Button
              onClick={() => saveRateLimit.mutate(Number(rateLimitDraft))}
              disabled={
                saveRateLimit.isPending ||
                rateLimitDraft === null ||
                !Number.isInteger(Number(rateLimitDraft)) ||
                Number(rateLimitDraft) < 1 ||
                Number(rateLimitDraft) === tenant.rateLimitMinutes
              }
            >
              {saveRateLimit.isPending ? 'Saving...' : 'Save'}
            </Button>
          </div>
          <p className="text-muted text-sm mt-1">One auto-reply per contact within this window.</p>
          {saveRateLimit.isError && <p className="text-danger text-sm mt-1">Could not save the rate limit.</p>}
          {saveRateLimit.isSuccess && <p className="text-success text-sm mt-1">Rate limit saved.</p>}
        </div>

        <div className="mt-3">
          <p className="text-muted text-sm mb-1">API key</p>
          <code className="text-sm break-all">{tenant.apiKey}</code>
          <p className="text-muted text-sm mt-1">
            The <code>x-api-key</code> credential for direct API access. Portal login uses the email above instead.
          </p>
        </div>
      </Card>

      <AssistantSettingsCard
        tenant={tenant}
        basePath={`/admin/tenants/${id}`}
        queryKey={['admin', 'tenants', id]}
      />

      <CorrectionRulesCard
        basePath={`/admin/tenants/${id}/corrections`}
        queryKey={['admin', 'tenants', id, 'corrections']}
      />

      <ContactFiltersCard
        basePath={`/admin/tenants/${id}/contact-filters`}
        queryKey={['admin', 'tenants', id, 'contact-filters']}
      />

      <Card>
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold">WhatsApp sessions</h3>
          {!hasLiveSession && (
            <Button onClick={() => createSession.mutate()} disabled={createSession.isPending}>
              {createSession.isPending ? 'Starting...' : 'New session'}
            </Button>
          )}
        </div>
        {hasLiveSession && (
          <p className="text-muted text-sm mb-2">
            This tenant already has a session. Use <strong>Reconnect</strong> below to re-link the device — a second
            session would share the same WhatsApp credentials and knock the first offline.
          </p>
        )}
        {createSession.isError && <p className="text-danger text-sm mb-2">Could not start a session.</p>}

        {(sessions ?? []).length === 0 && (
          <p className="text-muted text-sm">
            No sessions yet. Start one to generate a QR code, then scan it from WhatsApp &rarr; Linked devices.
          </p>
        )}

        {(sessions ?? []).map((s) => (
          <div key={s.id} className="border-t border-border pt-3 mt-3 first:border-0 first:pt-0 first:mt-0">
            <div className="flex justify-between items-center gap-2 flex-wrap">
              <p className="text-sm">
                {s.label ?? 'Session'} &mdash; <span className="text-accent">{s.status}</span>
                {s.phoneNumber && <span className="text-muted"> ({s.phoneNumber})</span>}
              </p>
              {RECONNECTABLE.includes(s.status) && (
                <Button variant="ghost" onClick={() => reconnect.mutate(s.id)} disabled={reconnect.isPending}>
                  Reconnect
                </Button>
              )}
            </div>
            {s.qrCode && (
              <>
                <img src={s.qrCode} alt="Scan to link WhatsApp" className="w-48 h-48 mt-2" />
                <p className="text-muted text-sm mt-1">
                  Scan within ~20 seconds. This page refreshes the code automatically until it is linked.
                </p>
              </>
            )}
          </div>
        ))}
      </Card>
    </div>
  );
}
