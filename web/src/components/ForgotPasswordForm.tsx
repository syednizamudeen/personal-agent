import { useState } from 'react';
import type { FormEvent } from 'react';
import { apiFetch } from '../lib/apiClient';
import { Input } from './ui/Input';
import { Button } from './ui/Button';

interface Props {
  role: 'portal' | 'admin';
  onCancel: () => void;
}

// Inline panel shown on the login pages. The endpoint always returns 200 so the
// message here is deliberately generic — it must not reveal whether an account exists.
export function ForgotPasswordForm({ role, onCancel }: Props) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch(`/${role}/forgot-password`, {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch {
      setError('Could not send the reset email. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="space-y-3">
        <p className="text-muted text-sm">If that account exists, a password reset email is on its way.</p>
        <button type="button" onClick={onCancel} className="text-accent text-sm">
          Back to login
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      {error && <p className="text-danger text-sm">{error}</p>}
      <Button type="submit" disabled={submitting} className="w-full">
        {submitting ? 'Sending...' : 'Send reset link'}
      </Button>
      <button type="button" onClick={onCancel} className="text-muted text-sm">
        Back to login
      </button>
    </form>
  );
}
