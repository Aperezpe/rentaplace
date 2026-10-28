import { ListingEditor } from '@/components/listing-editor';
import { Problem } from '@/components/site';
import { attempt, db, requireRole } from '@/lib/server';
import { ownedListing } from '../../../../../src/domain/listings.ts';

export const metadata = { title: 'Edit your home' };

export default async function EditListing({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireRole('host', `/host/listings/${slug}/edit`);
  const home = attempt(() => ownedListing(db(), slug, user));
  return home.ok ? <ListingEditor home={home.value} /> : <Problem error={home.error} />;
}
