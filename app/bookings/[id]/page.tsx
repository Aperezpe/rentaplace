import Link from 'next/link';
import { ArrowRight, Check, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Page, Problem, StatusBadge } from '@/components/site';
import { attempt, currentUser, db } from '@/lib/server';
import { dateLabel, fullDate, money } from '@/lib/format';
import { guestBooking } from '../../../src/domain/bookings.ts';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Your reservation' };

export default async function Confirmation({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect(`/signin?next=${encodeURIComponent(`/bookings/${id}`)}`);
  const found = attempt(() => guestBooking(db(), id, user));
  if (!found.ok) return <Problem error={found.error} />;
  const booking = found.value;
  const pending = booking.status === 'pending';
  const cancelled = booking.status === 'cancelled';
  return (
    <Page className="max-w-4xl text-center">
      <div className="mx-auto grid size-14 place-items-center rounded-full bg-secondary text-primary">{pending ? <Clock /> : <Check />}</div>
      <p className="eyebrow mt-6">{pending ? 'A good place to start' : 'Your next chapter, booked'}</p>
      <h1 className="mx-auto mt-3 max-w-2xl text-4xl sm:text-5xl">{pending ? 'Your request is with your host.' : cancelled ? 'Your reservation is cancelled.' : 'You have somewhere to look forward to.'}</h1>
      <p className="mx-auto mt-4 max-w-xl text-muted-foreground">{pending ? 'We’ll keep the dates reserved while your host reviews your request.' : 'Your reservation details are all here, whenever you need them.'}</p>

      <Card className="mt-10 grid gap-0 overflow-hidden rounded-2xl py-0 text-left sm:grid-cols-[1.1fr_1fr]">
        <img src={booking.photos[0]} alt={booking.title} width={1200} height={800} className="aspect-[3/2] size-full object-cover sm:aspect-auto" />
        <div className="space-y-5 p-6">
          <StatusBadge status={booking.status} />
          <div><h2 className="text-3xl">{booking.title}</h2><p className="text-sm text-muted-foreground">{booking.region}</p></div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
            <dt className="eyebrow text-[10px] text-muted-foreground">Your dates</dt><dd>{fullDate(booking.from_date)} – {dateLabel(booking.to_date)}</dd>
            <dt className="eyebrow text-[10px] text-muted-foreground">Guests</dt><dd>{booking.guests} · {booking.guest_name}</dd>
            <dt className="eyebrow text-[10px] text-muted-foreground">Confirmation</dt><dd className="font-mono">{booking.reference}</dd>
            <dt className="eyebrow text-[10px] text-muted-foreground">{cancelled ? 'Refund' : 'Total'}</dt><dd>{money(cancelled ? booking.refund_cents : booking.total_cents)} USD · Demo payment</dd>
          </dl>
        </div>
      </Card>
      <p className="mt-6 text-sm text-muted-foreground">A local confirmation email has been prepared for {booking.guest_email}. No email is sent to an external service.</p>
      <div className="mt-6 flex justify-center gap-3">
        <Button asChild><Link href="/trips">View your trips<ArrowRight /></Link></Button>
        <Button asChild variant="outline"><Link href="/help">Ask a question</Link></Button>
      </div>
    </Page>
  );
}
