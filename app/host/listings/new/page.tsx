import { ListingEditor } from '@/components/listing-editor';
import { requireRole } from '@/lib/server';

export const metadata = { title: 'Add your home' };

export default async function NewListing() {
  await requireRole('host', '/host/listings/new');
  return <ListingEditor />;
}
