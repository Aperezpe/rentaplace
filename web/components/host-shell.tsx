'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarDays, House, LayoutDashboard, Inbox, Wallet } from 'lucide-react';
import { cn } from '@/lib/utils';

const LINKS = [
  { href: '/host', label: 'Overview', icon: LayoutDashboard },
  { href: '/host/listings', label: 'Homes', icon: House },
  { href: '/host/calendar', label: 'Calendar', icon: CalendarDays },
  { href: '/host/reservations', label: 'Reservations', icon: Inbox },
  { href: '/host/payouts', label: 'Payouts', icon: Wallet },
];

export function HostNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Host navigation" className="border-b bg-card/70">
      <div className="mx-auto flex max-w-7xl gap-1 overflow-x-auto px-4 sm:px-6 lg:px-8">
        {LINKS.map(({ href, label, icon: Icon }) => {
          const active = href === '/host' ? pathname === '/host' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
                active && 'border-primary text-primary',
              )}
            >
              <Icon className="size-4" />{label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
