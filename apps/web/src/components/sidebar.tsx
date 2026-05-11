'use client';

import {
  BookOpen,
  Boxes,
  CalendarDays,
  Cloud,
  CloudUpload,
  Cog,
  GitBranch,
  GraduationCap,
  Activity,
  Inbox as InboxIcon,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  ListTree,
  MessageCircleQuestion,
  Search,
  Server,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType } from 'react';

import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  comingSoon?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

export function Sidebar({ className }: { className?: string }): JSX.Element {
  const t = useTranslations('nav');
  const pathname = usePathname();

  const sections: NavSection[] = [
    {
      title: t('dashboard'),
      items: [
        { href: '/', label: t('dashboard'), icon: LayoutDashboard },
        { href: '/search', label: t('search'), icon: Search },
        { href: '/ask', label: t('ask'), icon: MessageCircleQuestion },
      ],
    },
    {
      title: t('knowledge'),
      items: [
        { href: '/documents', label: t('documents'), icon: BookOpen },
        { href: '/projects', label: t('projects'), icon: Boxes },
        { href: '/decisions', label: t('decisions'), icon: ListChecks },
        { href: '/daily', label: t('daily'), icon: CalendarDays },
        { href: '/graph', label: t('graph'), icon: GitBranch, comingSoon: true },
        { href: '/inbox', label: t('inbox'), icon: InboxIcon },
      ],
    },
    {
      title: t('operations'),
      items: [
        { href: '/imports', label: t('imports'), icon: CloudUpload },
        { href: '/jobs', label: t('jobs'), icon: ListTree },
      ],
    },
    {
      title: t('admin'),
      items: [
        { href: '/admin/system', label: t('system'), icon: Server },
        { href: '/admin/jobs', label: t('jobsDashboard'), icon: Activity },
        { href: '/admin/tokens', label: t('tokens'), icon: KeyRound },
        { href: '/admin/claude', label: t('claude'), icon: GraduationCap },
        { href: '/admin/backup', label: t('backup'), icon: Cloud },
      ],
    },
  ];

  return (
    <aside
      className={cn(
        'flex h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground',
        className,
      )}
    >
      <div className="flex h-14 items-center gap-2 border-b border-sidebar-border px-5">
        <span className="inline-block h-5 w-5 rounded-sm bg-sidebar-accent" />
        <span className="text-sm font-semibold tracking-tight">Mnela</span>
      </div>
      <nav className="flex-1 overflow-y-auto px-2 py-4 scrollbar-thin">
        {sections.map((section) => (
          <div key={section.title} className="mb-4 space-y-0.5">
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {section.title}
            </p>
            {section.items.map(({ href, label, icon: Icon, comingSoon }) => {
              const active = pathname === href || (href !== '/' && pathname.startsWith(href));
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                      : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/15 hover:text-sidebar-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="flex-1 truncate">{label}</span>
                  {comingSoon && (
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      soon
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="border-t border-sidebar-border p-3">
        <Link
          href="/admin/system"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <Cog className="h-4 w-4" />
          v0.0 · phase 3
        </Link>
      </div>
    </aside>
  );
}
