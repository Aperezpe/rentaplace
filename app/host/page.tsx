import Link from 'next/link';
import { ArrowRight, CalendarDays, ChevronRight, House, Users, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Page, StatusBadge, UserAvatar } from '@/components/site';
import { db, requireRole } from '@/lib/server';
import { dateLabel, money, plural } from '@/lib/format';
import { dashboard } from '../../src/domain/host.ts';
import { addDays, today } from '../../src/config.ts';

export const metadata = { title: 'Your host space' };

type Arrival = { id: string; title: string; guest_id: string; guest_name: string; guests: number; nights: number; from_date: string; status: string };

export default async function HostHome() {
  const user = await requireRole('host', '/host');
  const database = db();
  const d = dashboard(database, user) as Omit<ReturnType<typeof dashboard>, 'upcoming'> & { upcoming: Arrival[] };
  const bars = (database.prepare("SELECT substr(p.scheduled_date,1,7) month, SUM(p.amount_cents) amount FROM payouts p WHERE host_id=? AND status IN ('paid','scheduled') AND scheduled_date>='2026-06-01' AND scheduled_date<? GROUP BY month ORDER BY month DESC LIMIT 6").all(user.id, addDays(today(), 1)) as { month: string; amount: number }[]).reverse();
  const max = Math.max(1, ...bars.map((b) => b.amount));
  const stats = [
    { icon: Wallet, label: 'Monthly earnings', value: money(d.earningsCents), note: `Paid + scheduled · ${dateLabel(today(), { month: 'short' })}` },
    { icon: CalendarDays, label: 'Occupancy', value: `${d.occupancyPercent}%`, note: `${d.bookedNights} nights reserved this month` },
    { icon: House, label: 'Your homes', value: String(d.listingCount), note: `${d.activeListings} active listings` },
    { icon: Users, label: 'Requests to review', value: String(d.pendingRequests), note: 'Awaiting your response' },
  ];
  return (
    <>
      <section className="relative isolate overflow-hidden border-b">
        <img src="/img/scenes/host.jpg" alt="" width={1536} height={1024} className="absolute inset-0 -z-10 size-full object-cover object-[center_40%]" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-background via-background/85 to-background/20" />
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-14 sm:flex-row sm:items-end sm:justify-between sm:px-6 lg:px-8">
          <div className="flex items-center gap-5">
            <UserAvatar user={user} className="size-16 ring-4 ring-background" />
            <div className="space-y-1">
              <p className="eyebrow">Your host space</p>
              <h1 className="text-4xl sm:text-5xl">Good to have you here, {user.name.split(' ')[0]}.</h1>
              <p className="text-muted-foreground">Here’s how your homes are doing this {dateLabel(today(), { month: 'long' })}.</p>
            </div>
          </div>
          <Button asChild variant="outline" className="bg-background"><Link href="/host/calendar"><CalendarDays />Open your calendar</Link></Button>
        </div>
      </section>
      <Page>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map(({ icon: Icon, label, value, note }) => (
            <Card key={label} className="gap-3 rounded-2xl">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardDescription className="eyebrow text-[11px] text-muted-foreground">{label}</CardDescription>
                <Icon className="size-4 text-primary" />
              </CardHeader>
              <CardContent>
                <p className="font-serif text-4xl">{value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{note}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
          <Card className="min-w-0 rounded-2xl">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
              <CardTitle className="font-serif text-2xl font-normal">Arriving in the next 7 days</CardTitle>
              <Button asChild variant="link" size="sm"><Link href="/host/reservations">All reservations<ArrowRight /></Link></Button>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-1">
              {d.upcoming.length ? d.upcoming.map((b) => (
                <div key={b.id} className="flex min-w-0 items-center gap-3 rounded-xl px-2 py-3 hover:bg-muted/60 sm:gap-4">
                  <div className="w-12 text-center leading-tight"><p className="text-xs text-muted-foreground uppercase">{dateLabel(b.from_date, { month: 'short' })}</p><p className="font-serif text-2xl">{Number(b.from_date.slice(-2))}</p></div>
                  <UserAvatar user={{ id: b.guest_id ?? b.guest_name, name: b.guest_name }} className="size-10" />
                  <div className="min-w-0 flex-1"><p className="truncate font-medium">{b.title}</p><p className="truncate text-sm text-muted-foreground">{b.guest_name} · {plural(b.guests, 'guest')} · {plural(b.nights, 'night')}</p></div>
                  <StatusBadge status={b.status} className="hidden sm:inline-flex" />
                </div>
              )) : <p className="text-sm text-muted-foreground">No arrivals this week. A good moment to get your homes ready.</p>}
            </CardContent>
          </Card>

          <div className="grid min-w-0 content-start gap-6">
            <Card className="rounded-2xl">
              <CardHeader><CardTitle className="font-serif text-2xl font-normal">A little attention goes a long way.</CardTitle></CardHeader>
              <CardContent className="grid gap-1">
                {[
                  ['/host/reservations', Users, 'Welcome your next guests', `${plural(d.pendingRequests, 'request')} ready for your review.`],
                  ['/host/listings', House, 'Keep your homes up to date', 'Photos, amenities, and the details that matter.'],
                  ['/host/payouts', Wallet, 'Know what’s coming in', 'Your payouts, with a clear breakdown.'],
                ].map(([href, Icon, title, text]) => {
                  const I = Icon as typeof Users;
                  return (
                    <Link key={href as string} href={href as string} className="flex items-center gap-3 rounded-xl p-2.5 hover:bg-muted/60">
                      <span className="grid size-9 place-items-center rounded-full bg-secondary text-primary"><I className="size-4" /></span>
                      <span className="flex-1"><span className="block text-sm font-medium">{title as string}</span><span className="block text-xs text-muted-foreground">{text as string}</span></span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </Link>
                  );
                })}
              </CardContent>
            </Card>
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="font-serif text-2xl font-normal">Earnings over time</CardTitle>
                <CardDescription>Host share of paid and scheduled stays</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex h-36 items-end gap-3" role="img" aria-label={bars.map((b) => `${b.month}: ${money(b.amount)}`).join('; ')}>
                  {bars.map((b) => <div key={b.month} title={`${b.month}: ${money(b.amount)}`} className="flex-1 rounded-t-md bg-primary/80" style={{ height: `${Math.max(5, (b.amount / max) * 100)}%` }} />)}
                </div>
                <div className="mt-2 flex gap-3 text-xs text-muted-foreground">{bars.map((b) => <span key={b.month} className="flex-1 text-center">{dateLabel(`${b.month}-01`, { month: 'short' })}</span>)}</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </Page>
    </>
  );
}
