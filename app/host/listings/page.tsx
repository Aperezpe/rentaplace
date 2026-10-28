import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState, Page, PageHeading, StatusBadge } from '@/components/site';
import { Rating } from '@/components/stay';
import { db, requireRole } from '@/lib/server';
import { money, plural } from '@/lib/format';
import { hostListings } from '../../../src/domain/listings.ts';

export const metadata = { title: 'Your homes' };

export default async function HostListings() {
  const user = await requireRole('host', '/host/listings');
  const homes = hostListings(db(), user);
  return (
    <Page>
      <PageHeading
        eyebrow="Room for your next guest"
        title="Your collection of homes."
        description={`${plural(homes.length, 'home')}, and all the details in one place.`}
        actions={<Button asChild><Link href="/host/listings/new"><Plus />Add a home</Link></Button>}
      />
      {homes.length ? (
        <Card className="overflow-hidden rounded-2xl py-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow><TableHead className="pl-5">Home</TableHead><TableHead>Status</TableHead><TableHead>Guests</TableHead><TableHead>Weeknight / weekend</TableHead><TableHead>Rating</TableHead><TableHead className="pr-5 text-right">Manage</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {homes.map((h) => (
                <TableRow key={h.slug}>
                  <TableCell className="pl-5">
                    <Link href={`/host/listings/${h.slug}/edit`} className="flex items-center gap-3 hover:text-primary">
                      <img src={h.photos[0]} alt="" width={72} height={48} className="h-12 w-[72px] rounded-lg object-cover" />
                      <span><span className="block font-medium">{h.title}</span><span className="block text-xs text-muted-foreground">{h.region}</span></span>
                    </Link>
                  </TableCell>
                  <TableCell><StatusBadge status={h.status} /></TableCell>
                  <TableCell>{h.sleeps} · {plural(h.bedrooms, 'bed')}</TableCell>
                  <TableCell className="tabular-nums">{money(h.nightly_cents)} / {money(h.weekend_cents)}</TableCell>
                  <TableCell><Rating value={h.rating} /></TableCell>
                  <TableCell className="pr-5 text-right">
                    <Button asChild variant="ghost" size="sm"><Link href={`/host/listings/${h.slug}/edit`}>Edit</Link></Button>
                    <Button asChild variant="ghost" size="sm"><Link href={`/host/calendar?slug=${h.slug}`}>Calendar</Link></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      ) : <EmptyState title="Your first home belongs here." text="Add a few details and help a guest find their next favourite place." href="/host/listings/new" action="Add a home" />}
    </Page>
  );
}
