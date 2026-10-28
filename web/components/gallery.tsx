'use client';

import { Grid2x2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';

export function Gallery({ title, photos }: { title: string; photos: string[] }) {
  const [first, ...rest] = photos;
  return (
    <Dialog>
      <div className="relative grid gap-2 overflow-hidden rounded-2xl sm:h-[440px] sm:grid-cols-4 sm:grid-rows-2">
        <DialogTrigger asChild>
          <button type="button" className="group relative aspect-[3/2] overflow-hidden sm:col-span-2 sm:row-span-2 sm:aspect-auto" aria-label="View all photos">
            <img src={first} alt={`${title} · the home and its surroundings`} width={1200} height={800} fetchPriority="high" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.02]" />
          </button>
        </DialogTrigger>
        {rest.slice(0, 3).map((src, i) => (
          <DialogTrigger asChild key={src + i}>
            <button type="button" className={`group relative hidden overflow-hidden sm:block ${i === 2 ? 'sm:col-span-2' : ''}`} aria-label="View all photos">
              <img src={src} alt={`${title} · ${i % 2 === 0 ? 'inside the home' : 'the home and its surroundings'}`} width={1200} height={800} loading="lazy" className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
            </button>
          </DialogTrigger>
        ))}
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="absolute right-4 bottom-4 bg-background/95"><Grid2x2 />View all photos</Button>
        </DialogTrigger>
      </div>
      <DialogContent className="max-h-[90svh] sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">{title}</DialogTitle>
          <DialogDescription>Images are generated and illustrative</DialogDescription>
        </DialogHeader>
        <ScrollArea className="h-[70svh] pr-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {photos.map((src, i) => <img key={src + i} src={src} alt={`${title}, photo ${i + 1}`} width={1200} height={800} loading="lazy" className={`aspect-[3/2] w-full rounded-xl object-cover ${i === 0 ? 'sm:col-span-2' : ''}`} />)}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
