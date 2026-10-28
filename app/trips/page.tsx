import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState, Page, PageHeading, StatusBadge } from '@/components/site';
import { db, requireRole } from '@/lib/server';
import { dateLabel, fullDate, money, plural } from '@/lib/format';
import { guestBookings } from '../../src/domain/bookings.ts';
import { today } from '../../src/config.ts';

export const metadata = { title: 'Your trips' };

type Trip = { id: string; title: string; region: string; reference: string; status: string; from_date: string; to_date: string; guests: number; total_cents: number; refund_cents: number; photos: string[] };

function TripCard({ b }: { b: Trip }) {
  const cancellable = ['confirmed', 'pending'].includes(b.status) && b.from_date >= today();
  return (
    <Card className="grid gap-0 overflow-hidden rounded-2xl py-0 sm:grid-cols-[260px_1fr]">
      <img src={b.photos[0]} alt={b.title} width={1200} height={800} loading="lazy" className="aspect-[3/2] size-full object-cover sm:aspect-auto" />
      <div className="flex flex-col gap-3 p-5">
        <div className="flex items-center justify-between gap-3"><StatusBadge status={b.status} /><span className="font-mono text-xs text-muted-foreground">{b.reference}</span></div>
        <div>
          <h3 className="text-2xl"><Link href={`/bookings/${b.id}`} className="hover:text-primary">{b.title}</Link></h3>
          <p className="text-sm text-muted-foreground">{b.region}</p>
          <p className="text-sm">{fullDate(b.from_date)} – {dateLabel(b.to_date)} · {plural(b.guests, 'guest')}</p>
        </div>
        <div className="mt-auto flex flex-wrap items-end justify-between gap-3 border-t pt-3">
          <div className="text-sm">
            <strong className="text-base">{money(b.total_cents)}</strong> <span className="text-muted-foreground">total</span>
            {b.status === 'cancelled' ? <p className="text-muted-foreground">Refund: {money(b.refund_cents)}</p> : null}
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm"><Link href={`/bookings/${b.id}`}>Details</Link></Button>
            {cancellable ? <Button asChild variant="ghost" size="sm" className="text-destructive hover:text-destructive"><Link href={`/trips/${b.id}/cancel`}>Cancel</Link></Button> : null}
          </div>
        </div>
      </div>
    </Card>
  );
}

export default async function TripsPage() {
  const user = await requireRole('guest', '/trips');
  const bookings = guestBookings(db(), user) as Trip[];
  const upcoming = bookings.filter((b) => b.to_date > today() && ['confirmed', 'pending'].includes(b.status));
  const past = bookings.filter((b) => !upcoming.includes(b));
  return (
    <Page className="max-w-5xl">
      <PageHeading eyebrow="The places you’re going" title="Your time away." description="All your stays, from the next adventure to the last lovely weekend." />
      <Tabs defaultValue="upcoming">
        <TabsList className="mb-6">
          <TabsTrigger value="upcoming">Coming up ({upcoming.length})</TabsTrigger>
          <TabsTrigger value="past">Past & cancelled ({past.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="upcoming" className="grid gap-5">
          {upcoming.length ? upcoming.map((b) => <TripCard key={b.id} b={b} />) : <EmptyState title="Your next escape is out there." text="Find a home, pick your dates, and give yourself something to look forward to." />}
        </TabsContent>
        <TabsContent value="past" className="grid gap-5">
          {past.length ? past.map((b) => <TripCard key={b.id} b={b} />) : <p className="text-muted-foreground">Your past stays will appear here.</p>}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
