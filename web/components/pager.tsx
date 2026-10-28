import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Previous / next with a fixed-width label, so the controls never move between pages. */
export function Pager({ page, pages, href, label }: { page: number; pages: number; href: (page: number) => string; label: string }) {
  const hide = 'pointer-events-none invisible';
  return (
    <nav aria-label={label} className="mt-6 flex items-center justify-center gap-3">
      <Button asChild variant="outline" size="sm" className={page > 1 ? '' : hide}>
        <Link href={href(page - 1)} aria-hidden={page <= 1} tabIndex={page > 1 ? undefined : -1}><ChevronLeft />Previous</Link>
      </Button>
      <span className="min-w-24 text-center text-sm text-muted-foreground tabular-nums">{page} / {pages}</span>
      <Button asChild variant="outline" size="sm" className={page < pages ? '' : hide}>
        <Link href={href(page + 1)} aria-hidden={page >= pages} tabIndex={page < pages ? undefined : -1}>Next<ChevronRight /></Link>
      </Button>
    </nav>
  );
}
