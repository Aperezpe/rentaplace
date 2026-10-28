import { ArrowRight } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { UserAvatar } from '@/components/site';
import { currentUser, db, param, type SearchParams } from '@/lib/server';
import { safeNext } from '../../src/auth.ts';
import type { Account } from '../../src/types.ts';

export const metadata = { title: 'Demo sign-in' };

const DESCRIPTIONS: Record<string, string> = {
  'host-1': 'Cedar Ridge & a collection of homes',
  'host-5': 'Lakeside A-Frame & nearby stays',
  'host-6': 'Old Mill Loft & city stays',
};

export default async function SignIn({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const next = safeNext(param(sp, 'next'));
  const need = param(sp, 'need');
  const user = await currentUser();
  const accounts = db().prepare("SELECT * FROM users WHERE id IN ('guest-1','guest-2','host-1','host-5','host-6') ORDER BY role,id").all() as Account[];
  return (
    <div data-bleed-end className="grid min-h-[calc(100svh-4rem)] lg:grid-cols-[1fr_1.1fr]">
      <div className="relative hidden lg:block">
        <img src="/img/scenes/signin.jpg" alt="" width={1536} height={1024} className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        <p className="absolute bottom-10 left-10 max-w-sm font-serif text-3xl text-white">Somewhere quiet is waiting.</p>
      </div>
      <div className="bg-paper px-4 py-14 sm:px-10 lg:px-16">
        <div className="mx-auto max-w-xl space-y-8">
          <div className="space-y-3">
            <p className="eyebrow">Make yourself at home</p>
            <h1 className="text-5xl">Choose your demo account.</h1>
            <p className="text-lg text-muted-foreground">Explore as a guest, or step into a host’s space. These accounts are fictional. No passwords, real bookings, or charges.</p>
          </div>
          {need === 'guest' || need === 'host' ? (
            <Alert className="border-primary/30 bg-secondary"><AlertDescription>Choose a {need} demo account to continue.</AlertDescription></Alert>
          ) : null}
          {user ? (
            <Alert>
              <AlertDescription className="block">
                You’re signed in as {user.name}. Choose another account below, or{' '}
                <form method="post" action="/auth/signout" className="inline"><Button type="submit" variant="link" className="inline h-auto p-0 align-baseline">sign out</Button></form>.
              </AlertDescription>
            </Alert>
          ) : null}
          {(['guest', 'host'] as const).map((role) => (
            <section key={role} className="space-y-3">
              <h2 className="text-2xl">{role === 'guest' ? 'Plan a getaway' : 'Welcome your guests'}</h2>
              <div className="grid gap-3">
                {accounts.filter((a) => a.role === role).map((a) => (
                  <form key={a.id} method="post" action="/auth/signin">
                    <input type="hidden" name="userId" value={a.id} />
                    <input type="hidden" name="next" value={next} />
                    <button type="submit" className="group flex w-full items-center gap-4 rounded-2xl border bg-card p-4 text-left shadow-xs transition hover:border-primary/40 hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none">
                      <UserAvatar user={a} className="size-12" />
                      <span className="flex-1">
                        <strong className="block font-medium">{a.name}</strong>
                        <small className="text-sm text-muted-foreground">{DESCRIPTIONS[a.id] ?? 'Guest demo account'}</small>
                      </span>
                      <ArrowRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" />
                    </button>
                  </form>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
