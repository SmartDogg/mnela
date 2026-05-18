'use client';

import { useMutation } from '@tanstack/react-query';
import { Check, ChevronRight, Copy, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError, api } from '@/lib/api/client';
import type { CreatedAuthToken } from '@/lib/api/types';
import { cn } from '@/lib/utils';

type Step = 'admin' | 'config' | 'claude' | 'modules' | 'import' | 'token' | 'done';

const STEP_ORDER: Step[] = ['admin', 'config', 'claude', 'modules', 'import', 'token', 'done'];

interface AdminInput {
  username: string;
  password: string;
}

interface ConfigInput {
  brainName: string;
  timezone: string;
  language: 'en' | 'ru';
}

type ClaudeChoice = 'have_max' | 'later' | 'never';

export function SetupWizard(): JSX.Element {
  const t = useTranslations('setup');
  const router = useRouter();
  const [step, setStep] = useState<Step>('admin');
  const [admin, setAdmin] = useState<AdminInput>({ username: '', password: '' });
  const [config, setConfig] = useState<ConfigInput>({
    brainName: 'Mnela',
    timezone: 'UTC',
    language: 'en',
  });
  const [claudeChoice, setClaudeChoice] = useState<ClaudeChoice>('have_max');
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [token, setToken] = useState<CreatedAuthToken | null>(null);

  // /auth/bootstrap creates the first admin AND sets a session cookie in
  // one round-trip. Subsequent attempts (admin already exists) return 403
  // — at that point the visitor wants /login, not /setup.
  const bootstrapMutation = useMutation({
    mutationFn: () => api.post<{ id: string; username: string }>('/auth/bootstrap', admin),
  });

  const tokenMutation = useMutation({
    mutationFn: () =>
      api.post<CreatedAuthToken>('/auth/tokens', {
        name: 'First MCP token',
        scope: 'mcp',
      }),
    onSuccess: (created) => {
      setToken(created);
      // Pre-expand the cards the user will most plausibly need first on
      // /admin/system: AI Providers (unless they chose Claude Max — in
      // which case the built-in is already wired), Telegram, and the
      // whisper / Transcription block when voice was enabled. The
      // mnela:admin-system:open:<section> keys are read by
      // useCollapsibleSection so a single localStorage write is enough.
      if (typeof window !== 'undefined') {
        const sectionsToOpen: string[] = [];
        if (claudeChoice !== 'have_max') sectionsToOpen.push('providers');
        sectionsToOpen.push('telegram');
        if (voiceEnabled) sectionsToOpen.push('whisper');
        for (const section of sectionsToOpen) {
          window.localStorage.setItem(`mnela:admin-system:open:${section}`, '1');
        }
      }
      setStep('done');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Failed'),
  });

  const persistVoiceMutation = useMutation({
    mutationFn: () =>
      api.patch<{ key: string; value: boolean }>('/system/config', {
        key: 'transcription.enabled',
        value: voiceEnabled,
      }),
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : 'Failed to save voice setting'),
  });

  const next = (): void => {
    const idx = STEP_ORDER.indexOf(step);
    const nxt = STEP_ORDER[idx + 1];
    if (nxt) setStep(nxt);
  };

  const back = (): void => {
    const idx = STEP_ORDER.indexOf(step);
    const prev = STEP_ORDER[idx - 1];
    if (prev) setStep(prev);
  };

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 space-y-1">
        <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <ol className="mb-8 flex flex-wrap gap-2 text-xs">
        {(STEP_ORDER.slice(0, -1) as Exclude<Step, 'done'>[]).map((s, i) => (
          <li
            key={s}
            className={cn(
              'flex items-center gap-1.5 rounded-full border px-2.5 py-1',
              i === stepIndex
                ? 'border-primary bg-primary text-primary-foreground'
                : i < stepIndex
                  ? 'border-emerald-500/50 text-emerald-300'
                  : 'border-border text-muted-foreground',
            )}
          >
            {i < stepIndex && <Check className="h-3 w-3" />}
            {t(`steps.${s}`)}
          </li>
        ))}
      </ol>

      {step === 'admin' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('admin.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('admin.description')}</p>
            <div className="space-y-1.5">
              <Label htmlFor="su-username">{t('admin.username')}</Label>
              <Input
                id="su-username"
                value={admin.username}
                onChange={(e) => setAdmin((s) => ({ ...s, username: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="su-password">{t('admin.password')}</Label>
              <Input
                id="su-password"
                type="password"
                value={admin.password}
                onChange={(e) => setAdmin((s) => ({ ...s, password: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">{t('admin.passwordHint')}</p>
            </div>
          </CardContent>
          <Footer>
            <Button
              disabled={
                !admin.username || admin.password.length < 12 || bootstrapMutation.isPending
              }
              onClick={() =>
                bootstrapMutation.mutate(undefined, {
                  onSuccess: () => next(),
                  onError: (err) =>
                    toast.error(
                      err instanceof ApiError && err.status === 403
                        ? 'An admin already exists for this install — use the regular /login page instead.'
                        : err instanceof ApiError
                          ? err.message
                          : 'Failed to create admin user',
                    ),
                })
              }
            >
              {bootstrapMutation.isPending && <Loader2 className="animate-spin" />}
              Next
              <ChevronRight />
            </Button>
          </Footer>
        </Card>
      )}

      {step === 'config' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('config.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="su-brain">{t('config.brainName')}</Label>
              <Input
                id="su-brain"
                value={config.brainName}
                onChange={(e) => setConfig((s) => ({ ...s, brainName: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">{t('config.brainNameHint')}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="su-tz">{t('config.timezone')}</Label>
                <Input
                  id="su-tz"
                  value={config.timezone}
                  onChange={(e) => setConfig((s) => ({ ...s, timezone: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t('config.language')}</Label>
                <div className="flex gap-2">
                  {(['en', 'ru'] as const).map((lng) => (
                    <Button
                      key={lng}
                      type="button"
                      variant={config.language === lng ? 'default' : 'outline'}
                      onClick={() => setConfig((s) => ({ ...s, language: lng }))}
                      className="flex-1"
                    >
                      {lng.toUpperCase()}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
          <Footer>
            <Button variant="outline" onClick={back}>
              Back
            </Button>
            <Button onClick={next}>
              Next <ChevronRight />
            </Button>
          </Footer>
        </Card>
      )}

      {step === 'claude' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('claude.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('claude.description')}</p>
            <div className="space-y-2">
              <ClaudeOption
                active={claudeChoice === 'have_max'}
                title={t('claude.haveMax')}
                description={t('claude.haveMaxDescription')}
                onSelect={() => setClaudeChoice('have_max')}
              />
              <ClaudeOption
                active={claudeChoice === 'later'}
                title={t('claude.later')}
                description={t('claude.laterDescription')}
                onSelect={() => setClaudeChoice('later')}
              />
              <ClaudeOption
                active={claudeChoice === 'never'}
                title={t('claude.never')}
                description={t('claude.neverDescription')}
                onSelect={() => setClaudeChoice('never')}
              />
            </div>
            {claudeChoice === 'have_max' && (
              <pre className="rounded-md bg-muted/40 p-3 font-mono text-xs scrollbar-thin">
                {`# ${t('claude.instructions')}
ssh user@your-mnela-host
claude login`}
              </pre>
            )}
          </CardContent>
          <Footer>
            <Button variant="outline" onClick={back}>
              Back
            </Button>
            <Button onClick={next}>
              Next <ChevronRight />
            </Button>
          </Footer>
        </Card>
      )}

      {step === 'modules' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('modules.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('modules.description')}</p>
            <label className="flex items-center gap-3 rounded-md border p-3 text-sm">
              <input
                type="checkbox"
                checked={voiceEnabled}
                onChange={(e) => setVoiceEnabled(e.target.checked)}
                className="h-4 w-4"
              />
              <div>
                <p className="font-medium">{t('modules.voice')}</p>
                <p className="text-xs text-muted-foreground">{t('modules.voiceDescription')}</p>
              </div>
            </label>
            {voiceEnabled && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                {t('modules.voiceWarning')}
              </p>
            )}
          </CardContent>
          <Footer>
            <Button variant="outline" onClick={back}>
              Back
            </Button>
            <Button
              onClick={() =>
                persistVoiceMutation.mutate(undefined, {
                  onSuccess: () => next(),
                  onSettled: () => undefined,
                })
              }
              disabled={persistVoiceMutation.isPending}
            >
              {persistVoiceMutation.isPending && <Loader2 className="animate-spin" />}
              Next <ChevronRight />
            </Button>
          </Footer>
        </Card>
      )}

      {step === 'import' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('import.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('import.description')}</p>
            <p className="text-xs text-muted-foreground">
              You can also import later via /imports/new.
            </p>
          </CardContent>
          <Footer>
            <Button variant="outline" onClick={back}>
              Back
            </Button>
            <Button onClick={next}>
              {t('import.skip')} <ChevronRight />
            </Button>
          </Footer>
        </Card>
      )}

      {step === 'token' && (
        <Card>
          <CardHeader>
            <CardTitle>{t('token.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t('token.description')}</p>
          </CardContent>
          <Footer>
            <Button variant="outline" onClick={back}>
              Back
            </Button>
            <Button onClick={() => tokenMutation.mutate()} disabled={tokenMutation.isPending}>
              {tokenMutation.isPending && <Loader2 className="animate-spin" />}
              Generate token
            </Button>
          </Footer>
        </Card>
      )}

      {step === 'done' && token && (
        <Card>
          <CardHeader>
            <CardTitle>{t('complete')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Badge variant="outline">{token.name}</Badge>
              <Textarea
                readOnly
                rows={3}
                value={token.token}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <p className="text-xs text-muted-foreground">Add this MCP server to Claude Code:</p>
              <pre className="rounded-md bg-muted/40 p-3 font-mono text-xs scrollbar-thin">
                {`claude mcp add --transport http mnela ${typeof window === 'undefined' ? 'http://localhost:3001/mcp' : window.location.origin + '/mcp'} \\
  --header "Authorization: Bearer ${token.token}"`}
              </pre>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  navigator.clipboard.writeText(token.token);
                  toast.success('Copied');
                }}
              >
                <Copy /> Copy token
              </Button>
              <Button variant="outline" onClick={() => router.push('/')}>
                Open dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Footer({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex items-center justify-end gap-2 border-t bg-muted/20 px-6 py-3">
      {children}
    </div>
  );
}

function ClaudeOption({
  active,
  title,
  description,
  onSelect,
}: {
  active: boolean;
  title: string;
  description: string;
  onSelect: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full rounded-md border p-3 text-left transition-colors',
        active ? 'border-primary bg-primary/5' : 'hover:bg-accent/30',
      )}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </button>
  );
}
