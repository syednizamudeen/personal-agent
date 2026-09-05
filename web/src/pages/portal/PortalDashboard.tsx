import { usePortalAuth } from '../../lib/authContext';
import { Button } from '../../components/ui/Button';
import { SessionsPanel } from './SessionsPanel';
import { MessagesPanel } from './MessagesPanel';
import { CorrectionsPanel } from './CorrectionsPanel';

export function PortalDashboard() {
  const { logout } = usePortalAuth();

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="flex justify-between items-center">
        <h1 className="text-xl font-semibold">Your WhatsApp Assistant</h1>
        <Button variant="ghost" onClick={() => logout()}>
          Log out
        </Button>
      </div>
      <SessionsPanel />
      <MessagesPanel />
      <CorrectionsPanel />
    </div>
  );
}
