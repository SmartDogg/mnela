'use client';

import { useMutation } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, KeyRound, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError, api } from '@/lib/api/client';
import { useCollapsibleSection } from '@/lib/hooks/use-collapsible-section';

interface ChangePasswordResponse {
  ok: true;
  otherSessionsRevoked: number;
}

const MIN_LEN = 12;

export function PasswordSection(): JSX.Element {
  const [cardOpen, toggleCard] = useCollapsibleSection('password');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      api.patch<ChangePasswordResponse>('/auth/password', {
        currentPassword: current,
        newPassword: next,
      }),
    onSuccess: (data) => {
      setCurrent('');
      setNext('');
      setConfirm('');
      toast.success(
        data.otherSessionsRevoked > 0
          ? `Password changed — ${data.otherSessionsRevoked} other session(s) signed out.`
          : 'Password changed.',
      );
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Failed to change password'),
  });

  const mismatch = next.length > 0 && confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < MIN_LEN;
  const sameAsCurrent = next.length > 0 && current.length > 0 && next === current;

  const canSubmit =
    !mutation.isPending &&
    current.length > 0 &&
    next.length >= MIN_LEN &&
    confirm === next &&
    next !== current;

  return (
    <Card id="password">
      <CardHeader>
        <button type="button" className="w-full cursor-pointer text-left" onClick={toggleCard}>
          <CardTitle className="flex items-center gap-2">
            {cardOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            <KeyRound className="size-4" />
            Password
          </CardTitle>
          <CardDescription>
            Rotate your admin password. Verifies the current password and signs out every other
            session on success — your own session here keeps working.
          </CardDescription>
        </button>
      </CardHeader>

      {cardOpen && (
        <CardContent>
          <div className="max-w-md space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pw-current">Current password</Label>
              <Input
                id="pw-current"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-new">New password</Label>
              <Input
                id="pw-new"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Minimum {MIN_LEN} characters.</p>
              {tooShort && (
                <p className="text-xs text-destructive">
                  Too short — need at least {MIN_LEN} characters.
                </p>
              )}
              {sameAsCurrent && (
                <p className="text-xs text-destructive">
                  New password must differ from the current one.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw-confirm">Confirm new password</Label>
              <Input
                id="pw-confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              {mismatch && <p className="text-xs text-destructive">Passwords don't match.</p>}
            </div>
            <Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
              {mutation.isPending && <Loader2 className="animate-spin" />}
              Change password
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
