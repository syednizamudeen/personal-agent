import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '../lib/apiClient';
import { Card } from './ui/Card';
import { Input } from './ui/Input';
import { Button } from './ui/Button';

export interface AssistantSettings {
  assistantName: string | null;
  ownerName: string | null;
  businessInfo: string | null;
  personaInstructions: string | null;
  replyToDirect: boolean;
  groupReplyMode: 'NEVER' | 'MENTIONED_ONLY' | 'ALWAYS';
  greetingsOnly: boolean;
  contactPolicy: 'ALL' | 'ALLOWLIST';
  autoReplyBurstLimit: number;
}

interface Props {
  tenant: AssistantSettings;
  // PATCH target, e.g. '/admin/tenants/<id>'.
  basePath: string;
  queryKey: unknown[];
}

type Draft = Partial<Record<keyof AssistantSettings, string | number | boolean>>;

export function AssistantSettingsCard({ tenant, basePath, queryKey }: Props) {
  const queryClient = useQueryClient();
  // Only edited fields are held here, so a PATCH sends exactly what changed and the
  // form keeps tracking the server value for everything the user has not touched.
  const [draft, setDraft] = useState<Draft>({});

  const save = useMutation({
    mutationFn: () => apiFetch(basePath, { method: 'PATCH', body: JSON.stringify(draft) }),
    onSuccess: () => {
      setDraft({});
      queryClient.invalidateQueries({ queryKey });
    },
  });

  function set(field: keyof AssistantSettings, value: string | number | boolean) {
    setDraft((d) => ({ ...d, [field]: value }));
  }

  function valueOf(field: keyof AssistantSettings): string {
    const drafted = draft[field];
    if (drafted !== undefined) return String(drafted);
    return tenant[field] === null || tenant[field] === undefined ? '' : String(tenant[field]);
  }

  function boolOf(field: 'replyToDirect' | 'greetingsOnly'): boolean {
    return (draft[field] as boolean | undefined) ?? tenant[field];
  }

  const dirty = Object.keys(draft).length > 0;

  return (
    <Card>
      <h2 className="font-semibold mb-1">Assistant persona</h2>
      <p className="text-muted text-sm mb-3">
        Without a persona the AI answers as itself — asked its name, it replies with the model name. These fields tell
        it who it is speaking as.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="assistantName" className="text-muted text-sm block mb-1">
            Assistant name
          </label>
          <Input
            id="assistantName"
            placeholder="e.g. Aria"
            value={valueOf('assistantName')}
            onChange={(e) => set('assistantName', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ownerName" className="text-muted text-sm block mb-1">
            Replying on behalf of
          </label>
          <Input
            id="ownerName"
            placeholder="e.g. Nizam"
            value={valueOf('ownerName')}
            onChange={(e) => set('ownerName', e.target.value)}
          />
        </div>
      </div>

      <div className="mt-3">
        <label htmlFor="businessInfo" className="text-muted text-sm block mb-1">
          About you / your business
        </label>
        <Input
          id="businessInfo"
          placeholder="e.g. Runs a BBQ catering business in Singapore."
          value={valueOf('businessInfo')}
          onChange={(e) => set('businessInfo', e.target.value)}
        />
      </div>

      <div className="mt-3">
        <label htmlFor="personaInstructions" className="text-muted text-sm block mb-1">
          Extra instructions
        </label>
        <Input
          id="personaInstructions"
          placeholder="e.g. Always confirm the event date before quoting."
          value={valueOf('personaInstructions')}
          onChange={(e) => set('personaInstructions', e.target.value)}
        />
      </div>

      <h3 className="font-semibold mt-5 mb-1">Where it replies</h3>
      <div className="space-y-3 mt-2">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={boolOf('replyToDirect')}
            onChange={(e) => set('replyToDirect', e.target.checked)}
          />
          <span>
            Direct messages (1-to-1 chats)
            <span className="text-muted block">Turn off to stop auto-replying to personal chats entirely.</span>
          </span>
        </label>

        <fieldset>
          <legend className="text-sm mb-1">Group chats</legend>
          {(
            [
              ['NEVER', 'Never reply in groups', 'Recommended. Group messages are logged but never answered.'],
              [
                'MENTIONED_ONLY',
                'Only when someone @-mentions me',
                'Stays quiet in the group unless your number is tagged, or someone replies to your message.',
              ],
              ['ALWAYS', 'Reply to every group message', 'Noisy — the assistant answers everything posted in any group.'],
            ] as const
          ).map(([value, title, hint]) => (
            <label key={value} className="flex items-start gap-2 text-sm mt-1">
              <input
                type="radio"
                name="groupReplyMode"
                className="mt-1"
                value={value}
                checked={valueOf('groupReplyMode') === value}
                onChange={(e) => set('groupReplyMode', e.target.value)}
              />
              <span>
                {title}
                <span className="text-muted block">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1"
            checked={boolOf('greetingsOnly')}
            onChange={(e) => set('greetingsOnly', e.target.checked)}
          />
          <span>
            Only auto-reply to greetings and well-wishes
            <span className="text-muted block">
              Applies everywhere. Everything else is logged for review instead of answered.
            </span>
          </span>
        </label>
      </div>
      <p className="text-muted text-sm mt-2">Status posts and newsletters are never answered.</p>

      <div className="grid gap-3 sm:grid-cols-2 mt-3">
        <div>
          <label htmlFor="contactPolicy" className="text-muted text-sm block mb-1">
            Reply policy
          </label>
          <select
            id="contactPolicy"
            value={valueOf('contactPolicy')}
            onChange={(e) => set('contactPolicy', e.target.value)}
            className="w-full bg-surface border border-border rounded-md px-2 py-1.5 text-sm"
          >
            <option value="ALL">Anyone except blocked contacts</option>
            <option value="ALLOWLIST">Only allow-listed contacts</option>
          </select>
        </div>
        <div>
          <label htmlFor="autoReplyBurstLimit" className="text-muted text-sm block mb-1">
            Max auto-replies per contact per hour
          </label>
          <Input
            id="autoReplyBurstLimit"
            type="number"
            min={1}
            step={1}
            value={valueOf('autoReplyBurstLimit')}
            onChange={(e) => set('autoReplyBurstLimit', Number(e.target.value))}
          />
          <p className="text-muted text-sm mt-1">Stops runaway loops if the other side is also an auto-responder.</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <Button onClick={() => save.mutate()} disabled={!dirty || save.isPending}>
          {save.isPending ? 'Saving...' : 'Save'}
        </Button>
        {save.isError && <span className="text-danger text-sm">Could not save.</span>}
        {save.isSuccess && !dirty && <span className="text-success text-sm">Saved.</span>}
      </div>
    </Card>
  );
}
