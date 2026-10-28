import Link from 'next/link';
import { Leaf, ArrowRight, CircleUserRound } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { avatarFor, capitalize, initials } from '@/lib/format';
import type { Account } from '../../src/types.ts';
import { AccountMenu, MainNav, MobileNav } from './site-client';

export const MAIN_NAV = [
  { href: '/search', label: 'Find a place' },
  { href: '/trips', label: 'Your trips' },
  { href: '/host', label: 'Hosting' },
  { href: '/help', label: 'Help' },
];

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" aria-label="RentAPlace home" className={cn('flex items-center gap-2.5 font-semibold tracking-tight', className)}>
      <img src="/img/brand/mark-64.png" alt="" width={32} height={32} className="size-8 rounded-lg" />
      <span className="text-[1.35rem]">RentAPlace<span className="text-primary">.</span></span>
    </Link>
  );
}

export function UserAvatar({ user, className }: { user: { id: string; name: string }; className?: string }) {
  return (
    <Avatar className={className}>
      <AvatarImage src={avatarFor(user.id)} alt="" />
      <AvatarFallback className="bg-secondary text-xs font-semibold text-primary">{initials(user.name)}</AvatarFallback>
    </Avatar>
  );
}

export function SiteHeader({ user }: { user?: Account }) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        <MobileNav items={MAIN_NAV} />
        <Logo />
        <MainNav items={MAIN_NAV} />
        <div className="ml-auto">
          {user ? (
            <AccountMenu user={{ id: user.id, name: user.name, role: user.role, avatar: avatarFor(user.id), initials: initials(user.name) }} />
          ) : (
            <Button asChild variant="outline" className="rounded-full">
              <Link href="/signin"><CircleUserRound />Demo sign-in</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t bg-topo">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr] lg:px-8">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-xs text-sm text-muted-foreground">A little closer to somewhere you love.</p>
        </div>
        <nav aria-label="Explore" className="grid content-start gap-2 text-sm">
          <span className="eyebrow mb-1">Explore</span>
          <Link className="hover:text-primary" href="/search">Explore homes</Link>
          <Link className="hover:text-primary" href="/trips">Your trips</Link>
          <Link className="hover:text-primary" href="/help">Get help</Link>
        </nav>
        <nav aria-label="Hosting" className="grid content-start gap-2 text-sm">
          <span className="eyebrow mb-1">Hosting</span>
          <Link className="hover:text-primary" href="/host">Become a host</Link>
          <Link className="hover:text-primary" href="/host/calendar">Host calendar</Link>
          <Link className="hover:text-primary" href="/admin">Local operations</Link>
        </nav>
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:px-6 lg:px-8">
          <span>Demo marketplace · All homes and accounts are fictional · Photos are AI-generated</span>
          <span>USD · English · No real payments</span>
        </div>
      </div>
    </footer>
  );
}

export function PageHeading({ eyebrow, title, description, actions, className }: { eyebrow: string; title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-6 pb-8 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="max-w-2xl space-y-3">
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="text-4xl leading-[1.05] sm:text-5xl">{title}</h1>
        {description ? <p className="text-base text-muted-foreground sm:text-lg">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-7xl px-4 pt-10 sm:px-6 lg:px-8', className)}>{children}</div>;
}

const STATUS_STYLES: Record<string, string> = {
  confirmed: 'bg-secondary text-primary',
  active: 'bg-secondary text-primary',
  paid: 'bg-secondary text-primary',
  completed: 'bg-muted text-muted-foreground',
  pending: 'bg-pending/30 text-[#6b5414]',
  scheduled: 'bg-pending/30 text-[#6b5414]',
  paused: 'bg-accent text-accent-foreground',
  cancelled: 'bg-destructive/10 text-destructive',
  declined: 'bg-destructive/10 text-destructive',
  closed: 'bg-destructive/10 text-destructive',
  refunded: 'bg-muted text-muted-foreground',
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  return (
    <Badge variant="secondary" className={cn('rounded-full px-2.5 font-medium', STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground', className)}>
      {capitalize(status.replaceAll('-', ' '))}
    </Badge>
  );
}

export function EmptyState({ title, text, href = '/search', action = 'Explore homes' }: { title: string; text: string; href?: string; action?: string }) {
  return (
    <div className="grid overflow-hidden rounded-2xl border bg-card sm:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col justify-center gap-3 p-8">
        <Leaf className="size-6 text-primary" aria-hidden />
        <h2 className="text-2xl">{title}</h2>
        <p className="text-muted-foreground">{text}</p>
        <Button asChild className="mt-2 w-fit"><Link href={href}>{action}<ArrowRight /></Link></Button>
      </div>
      <img src="/img/scenes/empty-dock.jpg" alt="" width={1536} height={1024} className="hidden aspect-[3/2] h-full w-full object-cover sm:block" />
    </div>
  );
}

export function roleLabel(role: string) {
  return `Demo ${role}`;
}

const PROBLEM_TITLES: Record<number, string> = {
  400: 'Let’s try that a different way.',
  403: 'That isn’t available from this account.',
  404: 'We couldn’t find that place.',
  409: 'Something changed in the meantime.',
};

/** A friendly page for an expected problem (bad input, wrong account, a conflict). */
export function Problem({ error }: { error: { status: number; message: string } }) {
  return (
    <Page className="max-w-3xl">
      <p className="eyebrow">{error.status === 404 ? 'Not found' : 'A small detour'}</p>
      <h1 className="mt-3 text-5xl">{PROBLEM_TITLES[error.status] ?? 'Something went wrong.'}</h1>
      <p className="mt-4 text-lg text-muted-foreground">{error.message}</p>
      <div className="mt-8 flex gap-3">
        <Button asChild><Link href="/">Back home</Link></Button>
        <Button asChild variant="outline"><Link href="/help">Get help</Link></Button>
      </div>
    </Page>
  );
}
