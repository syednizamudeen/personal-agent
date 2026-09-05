import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminAuth } from '../../lib/authContext';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { ForgotPasswordForm } from '../../components/ForgotPasswordForm';

export function AdminLogin() {
  const { login } = useAdminAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showForgot, setShowForgot] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/admin');
    } catch {
      setError('Invalid email or password');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex items-center justify-center min-h-screen">
      <Card className="w-full max-w-sm">
        <h1 className="text-lg font-semibold mb-4">Super-Admin Login</h1>
        {showForgot ? (
          <ForgotPasswordForm role="admin" onCancel={() => setShowForgot(false)} />
        ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {error && <p className="text-danger text-sm">{error}</p>}
          <Button type="submit" disabled={submitting} className="w-full">
            {submitting ? 'Logging in...' : 'Log in'}
          </Button>
          <button type="button" onClick={() => setShowForgot(true)} className="text-muted text-sm">
            Forgot password?
          </button>
        </form>
        )}
      </Card>
    </div>
  );
}
