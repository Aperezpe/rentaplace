import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pager } from '@/components/pager';
import { EmptyState, Page, PageHeading, StatusBadge, UserAvatar } from '@/components/site';
import { db, param, requireRole, type SearchParams } from '@/lib/server';
import { capitalize, dateLabel, money, plural } from '@/lib/format';
import { reservations } from '../../../src/domain/host.ts';
import { today } from '../../../src/config.ts';

export const metadata = { title: 'Reservations' };

const FILTERS = ['upcoming', 'pending', 'confirmed', 'completed', 'cancelled', 'declined', 'all'];
type Row = { id: string; guest_id: string; guest_name: string; reference: string; guests: number; slug: string; title: string; from_date: string; to_date: string; nights: number; total_cents: number; status: string };

export default async function HostReservations({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const user = await requireRole('host', '/host/reservations');
  const status = FILTERS.includes(param(sp, 'status') ?? '') ? param(sp, 'status')! : 'upcoming';
  const page = Math.max(1, Number(param(sp, 'page') || 1));
  const all = reservations(db(), user) as Row[];
  const filtered = all.filter((b) => status === 'all' ? true : status === 'upcoming' ? b.to_date >= today() && ['confirmed', 'pending'].includes(b.status) : b.status === status);
  const pages = Math.max(1, Math.ceil(filtered.length / 30));
  const items = filtered.slice((page - 1) * 30, page * 30);
  return (
    <Page>
      <PageHeading eyebrow="Every stay, in one place" title="Welcome what’s next." description="Review requests and keep an eye on your upcoming guests." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="list" aria-label="Show reservations">
          {FILTERS.map((f) => (
            <Button key={f} asChild size="sm" variant={f === status ? 'default' : 'outline'} className="rounded-full">
              <Link href={`/host/reservations?status=${f}`} aria-current={f === status ? 'page' : undefined}>{capitalize(f)}</Link>
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">{plural(filtered.length, 'reservation')} · Page {page} of {pages}</p>
      </div>
      {items.length ? (
        <>
          <Card className="overflow-hidden rounded-2xl py-0">
            <Table>
              <TableHeader className="bg-muted/50"><TableRow><TableHead className="pl-5">Guest & reference</TableHead><TableHead>Home</TableHead><TableHead>Dates</TableHead><TableHead>Total</TableHead><TableHead>Status</TableHead><TableHead className="pr-5 text-right">Actions</TableHead></TableRow></TableHeader>
              <TableBody>
                {items.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="pl-5">
                      <div className="flex items-center gap-3">
                        <UserAvatar user={{ id: b.guest_id ?? b.guest_name, name: b.guest_name }} className="size-9" />
                        <div><p className="font-medium">{b.guest_name}</p><p className="text-xs text-muted-foreground">{b.reference} · {plural(b.guests, 'guest')}</p></div>
                      </div>
                    </TableCell>
                    <TableCell><Link href={`/homes/${b.slug}`} className="hover:text-primary">{b.title}</Link></TableCell>
                    <TableCell>{dateLabel(b.from_date)} – {dateLabel(b.to_date)}<p className="text-xs text-muted-foreground">{plural(b.nights, 'night')}</p></TableCell>
                    <TableCell className="tabular-nums">{money(b.total_cents)}</TableCell>
                    <TableCell><StatusBadge status={b.status} /></TableCell>
                    <TableCell className="pr-5 text-right">
                      {b.status === 'pending' ? (
                        <div className="flex justify-end gap-2">
                          <form method="post" action={`/host/reservations/${b.id}/respond`}><input type="hidden" name="action" value="accept" /><Button size="sm" type="submit">Accept</Button></form>
                          <form method="post" action={`/host/reservations/${b.id}/respond`}><input type="hidden" name="action" value="decline" /><Button size="sm" variant="outline" type="submit">Decline</Button></form>
                        </div>
                      ) : <span className="text-xs text-muted-foreground">No action needed</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <Pager page={page} pages={pages} label="Reservation pages" href={(n) => `/host/reservations?status=${status}&page=${n}`} />
        </>
      ) : <EmptyState title="Nothing waiting here." text="Your matching reservations will appear here as guests book your homes." href="/host/calendar" action="View calendar" />}
    </Page>
  );
}
