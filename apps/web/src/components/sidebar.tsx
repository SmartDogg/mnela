'use client';

import {
  Activity,
  BookOpen,
  Boxes,
  ChevronsLeft,
  ChevronsRight,
  GitBranch,
  Inbox as InboxIcon,
  LayoutDashboard,
  MessageCircleQuestion,
  Server,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState, type ComponentType } from 'react';

import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const COLLAPSE_STORAGE_KEY = 'mnela:sidebar:collapsed';

function useCollapsedState(): [boolean, () => void] {
  // The component is rendered on the server too; default to expanded for
  // first paint and hydrate the persisted value once the browser is up. We
  // wait for hydration via `mounted` so SSR markup and the first client
  // render match (avoiding a hydration mismatch warning).
  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const stored = window.localStorage.getItem(COLLAPSE_STORAGE_KEY);
      if (stored === '1') setCollapsed(true);
    } catch {
      // localStorage unavailable (private mode); keep default.
    }
  }, []);

  const toggle = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  return [mounted && collapsed, toggle];
}

function useNavSections(): NavSection[] {
  const t = useTranslations('nav');
  return [
    {
      title: t('workspace'),
      items: [
        { href: '/', label: t('dashboard'), icon: LayoutDashboard },
        // Graph stays one click from the workspace shell — it is the
        // canonical visual of the brain. Global search lives in the header
        // via ⌘K, not as a sidebar entry.
        { href: '/graph', label: t('graph'), icon: GitBranch },
        { href: '/ask', label: t('ask'), icon: MessageCircleQuestion },
      ],
    },
    {
      title: t('library'),
      items: [
        { href: '/documents', label: t('documents'), icon: BookOpen },
        { href: '/projects', label: t('projects'), icon: Boxes },
        { href: '/inbox', label: t('review'), icon: InboxIcon },
      ],
    },
    {
      title: t('admin'),
      items: [
        { href: '/activity', label: t('activity'), icon: Activity },
        { href: '/admin/system', label: t('system'), icon: Server },
      ],
    },
  ];
}

/**
 * Nav rail body — shared between the desktop sidebar (collapsible) and
 * the mobile drawer (always expanded). Pass `onNavigate` from the drawer
 * to close it after a link click.
 */
export function SidebarNav({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}): JSX.Element {
  const pathname = usePathname();
  const sections = useNavSections();
  return (
    <nav className="flex-1 overflow-y-auto px-2 py-4 scrollbar-thin">
      {sections.map((section) => (
        <div key={section.title} className="mb-4 space-y-0.5">
          {!collapsed && (
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {section.title}
            </p>
          )}
          {section.items.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href !== '/' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                onClick={onNavigate}
                title={collapsed ? label : undefined}
                aria-label={collapsed ? label : undefined}
                className={cn(
                  'flex items-center rounded-md text-sm transition-colors',
                  collapsed ? 'justify-center px-0 py-2' : 'gap-2.5 px-3 py-1.5',
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/15 hover:text-sidebar-foreground',
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {!collapsed && <span className="flex-1 truncate">{label}</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export function SidebarBrand({ collapsed }: { collapsed: boolean }): JSX.Element {
  return (
    <div
      className={cn(
        'flex h-14 items-center gap-2 border-b border-sidebar-border',
        collapsed ? 'justify-center px-2' : 'px-5',
      )}
    >
      <span className="inline-block h-5 w-5 shrink-0 rounded-sm bg-sidebar-accent" />
      {!collapsed && <span className="text-sm font-semibold tracking-tight">Mnela</span>}
    </div>
  );
}

export function Sidebar({ className }: { className?: string }): JSX.Element {
  const t = useTranslations('nav');
  const [collapsed, toggleCollapsed] = useCollapsedState();

  return (
    <aside
      className={cn(
        // sticky + self-start keeps the rail anchored to the viewport while
        // long pages (e.g. /admin/system) scroll under it. Without these
        // the flex stretch lets the aside scroll out of view.
        'sticky top-0 z-20 flex h-screen shrink-0 flex-col self-start border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out',
        collapsed ? 'w-14' : 'w-60',
        className,
      )}
    >
      <SidebarBrand collapsed={collapsed} />
      <SidebarNav collapsed={collapsed} />
      <div className="border-t border-sidebar-border p-2">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? t('expand') : t('collapse')}
          title={collapsed ? t('expand') : t('collapse')}
          className={cn(
            'flex w-full items-center rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-sidebar-accent/15 hover:text-sidebar-foreground',
            collapsed ? 'justify-center' : 'gap-2',
          )}
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4" />
              <span>{t('collapse')}</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
