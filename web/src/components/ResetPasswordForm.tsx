import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/apiClient';
import { Card } from './ui/Card';
import { Input } from './ui/Input';
import { Button } from './ui/Button';

interface Props {
  role: 'portal' | 'admin';
  title: string;
}

// Shared by the portal and admin reset pages; the only difference is which
// endpoint the token is redeemed against and where "back to login" points.
export function ResetPasswordForm({ role, title }: Props) {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const loginPath = `/${role}/login`;

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch(`/${role}/reset-password`, {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-4">{title}</h1>

        {done ? (
          <div className="space-y-3">
            <p className="text-success text-sm">Your password has been updated.</p>
            <Link to={loginPath} className="text-accent text-sm">
              Go to login
            </Link>
          </div>
        ) : !token ? (
          <div className="space-y-3">
            <p className="text-danger text-sm">This reset link is missing its token. Request a new one from the login page.</p>
            <Link to={loginPath} className="text-accent text-sm">
              Back to login
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <Input
              type="password"
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <Input
              type="password"
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
            {error && <p className="text-danger text-sm">{error}</p>}
            <Button type="submit" disabled={submitting} className="w-full">
              {submitting ? 'Saving...' : 'Set new password'}
            </Button>
            <Link to={loginPath} className="text-muted text-sm block">
              Back to login
            </Link>
          </form>
        )}
      </Card>
    </div>
  );
}
