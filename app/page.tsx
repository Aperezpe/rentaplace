import Link from 'next/link';
import { ArrowRight, BadgeDollarSign, House, Leaf, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchBar } from '@/components/forms';
import { HomeCard } from '@/components/stay';
import { db } from '@/lib/server';
import { listingBySlug } from '../src/db.ts';
import { addDays, today } from '../src/config.ts';
import { MOSAIC_COUNT } from '../data/images.ts';

export const metadata = { title: 'Find your somewhere' };

const FEATURED = ['lakeside-a-frame', 'pine-hollow-cabin', 'red-rock-casita', 'old-mill-loft'];

export default function HomePage() {
  const database = db();
  const regions = database.prepare("SELECT * FROM regions WHERE slug IN ('dune-meadow','juniper-wash','pine-hollow','silver-bay') ORDER BY CASE slug WHEN 'dune-meadow' THEN 0 WHEN 'silver-bay' THEN 1 WHEN 'juniper-wash' THEN 2 ELSE 3 END").all() as { name: string; region: string; image: string }[];
  const homes = FEATURED.map((slug) => listingBySlug(database, slug)!).filter(Boolean);
  const from = addDays(today(), 1);
  const mosaic = Array.from({ length: 8 }, (_, i) => `/img/mosaic/m-${String(((i * 3) % MOSAIC_COUNT) + 1).padStart(2, '0')}.jpg`);
  return (
    <>
      <section className="relative">
        <div className="relative isolate overflow-hidden">
          <img src="/img/scenes/wide-lake.jpg" alt="A small cabin and dock on a still mountain lake at dawn" width={1916} height={821} fetchPriority="high" className="absolute inset-0 -z-10 size-full object-cover object-[70%_center]" />
          <div className="absolute inset-0 -z-10 bg-gradient-to-r from-background via-background/80 to-background/0 sm:via-background/55" />
          <div className="mx-auto max-w-7xl px-4 pt-16 pb-36 sm:px-6 sm:pt-24 sm:pb-44 lg:px-8">
            <div className="max-w-xl space-y-5">
              <p className="eyebrow">Good places. Unhurried days.</p>
              <h1 className="text-5xl leading-[0.98] sm:text-7xl">Find your kind of <em className="text-primary">away.</em></h1>
              <p className="max-w-md text-lg text-foreground/80">Cabins for quiet mornings. Cottages for salty hair. A place that feels like it was waiting for you.</p>
              <p className="flex items-center gap-2 text-sm text-muted-foreground"><Leaf className="size-4 text-primary" />Thoughtfully chosen stays, a little closer to nature.</p>
            </div>
          </div>
        </div>
        <div className="relative z-10 mx-auto -mt-20 max-w-7xl px-4 sm:px-6 lg:px-8">
          <SearchBar from={from} to={addDays(from, 3)} min={today()} />
          <div className="mt-6 grid gap-3 text-sm text-muted-foreground sm:grid-cols-3">
            <span className="flex items-center gap-2"><BadgeDollarSign className="size-4 text-primary" />Clear prices, from the start</span>
            <span className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" />Flexible stays, thoughtful hosts</span>
            <span className="flex items-center gap-2"><House className="size-4 text-primary" />A whole place to yourself</span>
          </div>
        </div>
      </section>

      <section className="mx-auto mt-24 max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div className="space-y-2">
            <p className="eyebrow">Follow your curiosity</p>
            <h2 className="text-4xl">Somewhere worth slowing down.</h2>
          </div>
          <Button asChild variant="link" className="hidden sm:inline-flex"><Link href="/search">Explore all<ArrowRight /></Link></Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {regions.map((r) => (
            <Link key={r.name} href={`/search?place=${encodeURIComponent(r.name)}`} className="group relative block aspect-[4/5] overflow-hidden rounded-2xl">
              <img src={r.image} alt={r.region} width={1200} height={800} loading="lazy" className="size-full object-cover transition-transform duration-700 group-hover:scale-105" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 p-5 text-white">
                <h3 className="text-2xl">{r.region.split(',')[0]}</h3>
                <p className="text-sm text-white/85">{r.name} & the surrounding quiet</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-24 max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div className="space-y-2">
            <p className="eyebrow">Room to make yourself at home</p>
            <h2 className="text-4xl">Little places. Lasting memories.</h2>
            <p className="text-muted-foreground">A few of our favourite homes for your next escape.</p>
          </div>
          <Button asChild variant="link" className="hidden sm:inline-flex"><Link href="/search?sort=rating">View homes<ArrowRight /></Link></Button>
        </div>
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          {homes.map((home) => <HomeCard key={home.slug} home={home} />)}
        </div>
      </section>

      <section className="relative isolate mt-24 bg-botanical">
        <div className="absolute inset-0 -z-10 bg-gradient-to-r from-background via-background/85 to-background/40" />
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.15fr] lg:px-8">
          <div className="space-y-4">
            <p className="eyebrow">Open your door</p>
            <h2 className="text-4xl sm:text-5xl">A good home has more stories to tell.</h2>
            <p className="max-w-md text-muted-foreground">Share your place, welcome new people, and keep the details in one simple host space.</p>
            <Button asChild size="lg" className="mt-2"><Link href="/host">Start hosting<ArrowRight /></Link></Button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {mosaic.map((src, i) => (
              <img key={src + i} src={src} alt="" width={600} height={400} className={`aspect-[3/2] w-full rounded-xl object-cover shadow-sm ${i % 2 ? 'translate-y-4' : ''}`} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
