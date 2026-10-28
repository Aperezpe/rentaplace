import Link from 'next/link';
import { ChevronLeft, ChevronRight, MapPin, SlidersHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SearchBar, SimpleSelect } from '@/components/forms';
import { EmptyState, Page } from '@/components/site';
import { HomeCard } from '@/components/stay';
import { attempt, db, flag, toURLSearchParams, type SearchParams } from '@/lib/server';
import { dateLabel, money, plural } from '@/lib/format';
import { parseSearch, search } from '../../src/domain/search.ts';
import { log } from '../../src/log.ts';
import { addDays, today } from '../../src/config.ts';
import type { Listing } from '../../src/types.ts';

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }) {
  const place = (await searchParams).place;
  return { title: typeof place === 'string' && place ? `Stays in ${place}` : 'Explore homes' };
}

const AMENITY_FILTERS = ['Wifi', 'Pet friendly', 'Fireplace', 'Lake access'];

function MapPanel({ homes }: { homes: Listing[] }) {
  const lats = homes.map((h) => h.lat), lngs = homes.map((h) => h.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats), minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  return (
    <Card className="sticky top-24 gap-0 overflow-hidden rounded-2xl py-0">
      <div className="flex items-center gap-2 border-b px-4 py-3 text-sm font-medium"><MapPin className="size-4 text-primary" />Explore the area</div>
      <div className="relative aspect-[36/50] bg-waves">
        <svg viewBox="0 0 360 500" role="group" aria-label="Approximate locations of homes on this results page" className="absolute inset-0 size-full">
          <path d="M-40 70Q220 200 130 330T180 520" fill="none" stroke="#bdd6ce" strokeWidth="26" opacity=".7" />
          <path d="M-20 390Q120 300 180 340T380 160M-10 185Q120 130 200 210T390 250" fill="none" stroke="#fffdf7" strokeWidth="7" />
          {homes.map((h, i) => {
            const x = 50 + ((h.lng - minLng) / Math.max(0.05, maxLng - minLng)) * 260;
            const y = 415 - ((h.lat - minLat) / Math.max(0.05, maxLat - minLat)) * 310;
            return (
              <a key={h.slug} href={`/homes/${h.slug}`} aria-label={`${h.title}: ${money(h.nightly_cents)} per night`}>
                <rect x={x - 27} y={y - 13} width="58" height="27" rx="13.5" fill={i === 0 ? '#214c40' : '#fffffa'} stroke="#c8d1bd" />
                <text x={x + 2} y={y + 4.5} textAnchor="middle" fill={i === 0 ? '#fff' : '#244232'} fontFamily="system-ui,sans-serif" fontSize="11" fontWeight="600">{money(h.nightly_cents)}</text>
              </a>
            );
          })}
        </svg>
      </div>
      <p className="border-t px-4 py-3 text-xs text-muted-foreground">Approximate locations · Select a price to explore</p>
    </Card>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: SearchParams }) {
  const params = toURLSearchParams(await searchParams);
  const parsed = attempt(() => parseSearch(params));
  const from = params.get('from') || addDays(today(), 1);
  if (!parsed.ok) {
    return (
      <Page>
        <SearchBar place={params.get('place') ?? ''} from={from} to={addDays(from, 3)} min={today()} />
        <Alert variant="destructive" className="mt-8"><AlertTitle>Let’s adjust that search.</AlertTitle><AlertDescription>{parsed.error.message}</AlertDescription></Alert>
      </Page>
    );
  }
  const q = parsed.value;
  const result = search(db(), q);
  log('search.completed', { ms: result.searchMs, total: result.total, place: q.place || undefined });
  const showMap = flag('map_panel') && result.items.length > 0;
  const pageHref = (page: number) => { const p = new URLSearchParams(params); p.set('page', String(page)); return `/search?${p}`; };
  return (
    <Page className="pt-6">
      <SearchBar place={q.place} from={q.from} to={q.to} guests={q.guests} min={today()} className="shadow-sm" />

      <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <p className="eyebrow">A little change of scenery</p>
          <h1 className="text-4xl">{q.place ? `Find your place in ${q.place}.` : 'Make room for a getaway.'}</h1>
          <p className="text-muted-foreground">{plural(result.total, 'available home')} · {dateLabel(q.from)} – {dateLabel(q.to)} · {plural(q.guests, 'guest')}</p>
        </div>
        <Badge variant="outline" className="rounded-full">Entire homes · USD</Badge>
      </div>

      <form method="get" action="/search" className="mt-6 rounded-2xl border bg-card p-4">
        <input type="hidden" name="place" value={q.place} />
        <input type="hidden" name="from" value={q.from} />
        <input type="hidden" name="to" value={q.to} />
        <input type="hidden" name="guests" value={q.guests} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1.2fr_1.2fr_auto] lg:items-end">
          <div className="grid gap-1.5"><Label htmlFor="min-price">Min / night ($)</Label><Input id="min-price" type="number" name="minPrice" min={0} max={10000} defaultValue={q.minPrice} /></div>
          <div className="grid gap-1.5"><Label htmlFor="max-price">Max / night ($)</Label><Input id="max-price" type="number" name="maxPrice" min={0} max={10000} defaultValue={q.maxPrice === 10000 ? '' : q.maxPrice} placeholder="Any" /></div>
          <div className="grid gap-1.5"><Label htmlFor="bedrooms">Bedrooms</Label><SimpleSelect id="bedrooms" name="bedrooms" value={String(q.bedrooms)} options={[0, 1, 2, 3, 4, 5].map((n) => [String(n), n ? `${n}+ bedrooms` : 'Any bedrooms'])} /></div>
          <div className="grid gap-1.5"><Label htmlFor="sort">Sort by</Label><SimpleSelect id="sort" name="sort" value={q.sort} options={[['recommended', 'Recommended'], ['price', 'Price: low to high'], ['rating', 'Highest rated']]} /></div>
          <Button type="submit"><SlidersHorizontal />Apply filters</Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3 border-t pt-4">
          {AMENITY_FILTERS.map((a) => (
            <Label key={a} className="font-normal"><Checkbox name="amenities" value={a} defaultChecked={q.amenities.includes(a)} />{a}</Label>
          ))}
          <Label className="font-normal"><Checkbox name="instant" value="1" defaultChecked={q.instant} />Instant book</Label>
        </div>
      </form>

      <div className={`mt-8 grid gap-8 ${showMap ? 'lg:grid-cols-[1fr_340px]' : ''}`}>
        <div>
          {result.items.length ? (
            <>
              <div className={`grid gap-x-5 gap-y-8 sm:grid-cols-2 ${showMap ? 'xl:grid-cols-3' : 'lg:grid-cols-3 xl:grid-cols-4'}`}>
                {result.items.map((home: Listing, i: number) => <HomeCard key={home.slug} home={home} q={q} priority={i < 3} />)}
              </div>
              <nav aria-label="Results pages" className="mt-10 flex items-center justify-center gap-3">
                <Button asChild variant="outline" size="sm" className={q.page > 1 ? '' : 'pointer-events-none opacity-0'} aria-hidden={q.page <= 1}>
                  <Link href={pageHref(q.page - 1)} tabIndex={q.page > 1 ? undefined : -1}><ChevronLeft />Previous</Link>
                </Button>
                <span className="min-w-28 text-center text-sm text-muted-foreground">Page {q.page} of {result.pages}</span>
                <Button asChild variant="outline" size="sm" className={q.page < result.pages ? '' : 'pointer-events-none opacity-0'} aria-hidden={q.page >= result.pages}>
                  <Link href={pageHref(q.page + 1)} tabIndex={q.page < result.pages ? undefined : -1}>Next<ChevronRight /></Link>
                </Button>
              </nav>
            </>
          ) : (
            <EmptyState title="A different date, a new possibility." text="No homes match all of these filters. Try a nearby region or a wider price range." href="/search" action="Reset your search" />
          )}
        </div>
        {showMap ? <aside className="hidden lg:block"><MapPanel homes={result.items} /></aside> : null}
      </div>
    </Page>
  );
}
