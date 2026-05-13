'use client';

import { useMutation } from '@tanstack/react-query';
import { Languages, LogOut, Moon, Search as SearchIcon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCmdkStore } from '@/lib/state/cmdk-store';
import { api } from '@/lib/api/client';
import type { Principal } from '@/lib/api/types';
import { LOCALE_COOKIE, SUPPORTED_LOCALES, type Locale } from '@/i18n/config';

export function Header({ principal }: { principal: Principal }): JSX.Element {
  const t = useTranslations('common');
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const openCmdk = useCmdkStore((s) => s.open);
  // next-themes resolves the theme client-side. Render a neutral placeholder
  // on the server to avoid a hydration mismatch between SSR (no theme) and
  // the first client paint (theme resolved from localStorage / system).
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const logoutMutation = useMutation({
    mutationFn: () => api.post<{ ok: true }>('/auth/logout'),
    onSuccess: () => {
      router.replace('/login');
      router.refresh();
    },
  });

  const setLocale = (locale: Locale): void => {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}`;
    router.refresh();
  };

  // Principal.name is optional on the API side (token rows can be unnamed);
  // fall back to id-prefix + kind so the avatar / dropdown never crash.
  const displayName = principal.name ?? `${principal.kind}:${principal.id.slice(0, 6)}`;

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/80 px-6 backdrop-blur">
      <button
        type="button"
        onClick={() => openCmdk()}
        className="group flex h-8 w-full max-w-md items-center gap-2 rounded-md border border-input bg-muted/30 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/60"
      >
        <SearchIcon className="h-4 w-4" />
        <span className="flex-1 text-left">{t('search')}…</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-background px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          ⌘K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle theme"
          suppressHydrationWarning
        >
          {mounted ? (
            resolvedTheme === 'dark' ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )
          ) : (
            <Moon className="h-4 w-4 opacity-0" />
          )}
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Language">
              <Languages className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {SUPPORTED_LOCALES.map((loc) => (
              <DropdownMenuItem key={loc} onClick={() => setLocale(loc)}>
                {loc.toUpperCase()}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-2">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-xs font-semibold uppercase">
                {displayName.charAt(0)}
              </span>
              <span className="hidden md:inline">{displayName}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>{displayName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => logoutMutation.mutate()}>
              <LogOut className="mr-2 h-4 w-4" />
              {t('logout')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
