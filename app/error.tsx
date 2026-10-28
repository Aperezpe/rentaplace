'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-10 sm:px-6">
      <p className="eyebrow">A small detour</p>
      <h1 className="mt-3 text-5xl">Something went wrong.</h1>
      <p className="mt-4 text-lg text-muted-foreground">Please try again. If it keeps happening, our support team can take a look.</p>
      <div className="mt-8 flex gap-3">
        <Button onClick={() => reset()}>Try again</Button>
        <Button asChild variant="outline"><Link href="/help">Get help</Link></Button>
      </div>
    </div>
  );
}
