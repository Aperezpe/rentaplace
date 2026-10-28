import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Page, PageHeading, Problem, StatusBadge } from '@/components/site';
import { db, isLocalRequest } from '@/lib/server';
import { health, stats } from '../../src/domain/ops.ts';
import { flags } from '../../src/flags.ts';
import { readLogs } from '../../src/log.ts';
import { tickets } from '../../src/domain/support.ts';

export const metadata = { title: 'Local operations' };

function LogList({ rows }: { rows: unknown[] }) {
  if (!rows.length) return <p className="text-sm text-muted-foreground">Nothing to report in the current log.</p>;
  return (
    <ScrollArea className="h-72">
      <div className="grid gap-2 pr-3">
        {rows.map((r, i) => <pre key={i} tabIndex={0} aria-label={`Log entry ${i + 1}`} className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[11px] leading-relaxed">{JSON.stringify(r, null, 2)}</pre>)}
      </div>
    </ScrollArea>
  );
}

type Ticket = { id: string; subject: string; message: string; category: string; name: string; email: string; created_at: string; owner_id: string | null };
type Feedback = { page: string; text: string; rating: string; created_at: string };

export default async function AdminPage() {
  if (!(await isLocalRequest())) return <Problem error={{ status: 403, message: 'Local operations are available only from this machine.' }} />;
  const database = db();
  const s = stats(database), h = health(database);
  const support = tickets(database) as Ticket[];
  const feedback = database.prepare('SELECT * FROM feedback ORDER BY created_at DESC,rowid DESC LIMIT 30').all() as Feedback[];
  return (
    <Page>
      <PageHeading
        eyebrow="Local operations"
        title="A clear view of the place."
        description={<span className="inline-flex items-center gap-2"><span className="size-2 rounded-full bg-primary" />All systems ready · {h.node} · App date {h.today}</span>}
        actions={<Button asChild variant="outline"><a href="/api/openapi.json">API reference<ArrowRight /></a></Button>}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[['Homes', s.listings], ['Reservations', s.bookings], ['Support requests', s.supportTickets], ['Page feedback', s.feedback]].map(([label, n]) => (
          <Card key={label} className="gap-2 rounded-2xl"><CardHeader><CardDescription className="eyebrow text-[11px] text-muted-foreground">{label}</CardDescription></CardHeader><CardContent><p className="font-serif text-4xl tabular-nums">{n}</p><p className="text-xs text-muted-foreground">Current database</p></CardContent></Card>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="font-serif text-2xl font-normal">Feature flags</CardTitle><Badge variant="outline">Local only</Badge></CardHeader>
          <CardContent className="grid gap-1">
            {flags(database).map((f) => (
              <div key={f.name} className="flex items-center justify-between gap-4 rounded-xl p-2.5 hover:bg-muted/50">
                <div><p className="font-mono text-sm">{f.name}</p><p className="text-xs text-muted-foreground">{f.description}</p></div>
                <form action={`/admin/flags/${f.name}`} method="post">
                  <input type="hidden" name="enabled" value={f.enabled ? '0' : '1'} />
                  <Button size="sm" variant={f.enabled ? 'default' : 'outline'} type="submit" className="w-14" aria-label={`${f.enabled ? 'Disable' : 'Enable'} ${f.name}`}>{f.enabled ? 'On' : 'Off'}</Button>
                </form>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="font-serif text-2xl font-normal">Health & storage</CardTitle></CardHeader>
          <CardContent className="grid gap-2.5 text-sm">
            {[['Service', h.service], ['Database', h.database], ['Accounts', s.users], ['Pending reservations', s.pendingReservations], ['Applied migrations', h.migrations.length]].map(([k, v]) => (
              <div key={k as string} className="flex justify-between"><span className="text-muted-foreground">{k}</span><span className="tabular-nums">{v}</span></div>
            ))}
            <Separator className="my-2" />
            <p className="text-muted-foreground">Demo payments and local confirmation files. No external services are contacted.</p>
            <div className="flex gap-1">
              <Button asChild variant="link" size="sm" className="px-0 pr-3"><a href="/api/health">Health JSON</a></Button>
              <Button asChild variant="link" size="sm" className="px-3"><a href="/api/stats">Stats JSON</a></Button>
              <Button asChild variant="link" size="sm" className="px-3"><a href="/api/logs">Request logs</a></Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 rounded-2xl">
        <CardContent>
          <Tabs defaultValue="errors">
            <TabsList><TabsTrigger value="errors">Recent errors</TabsTrigger><TabsTrigger value="slow">Slow requests</TabsTrigger></TabsList>
            <TabsContent value="errors" className="pt-3"><p className="mb-2 text-xs text-muted-foreground">HTTP 400+</p><LogList rows={readLogs({ errors: true, limit: 12 })} /></TabsContent>
            <TabsContent value="slow" className="pt-3"><p className="mb-2 text-xs text-muted-foreground">200 ms or more</p><LogList rows={readLogs({ slow: true, limit: 12 })} /></TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="font-serif text-2xl font-normal">Support inbox</CardTitle><Badge variant="secondary">{support.length} requests</Badge></CardHeader>
          <CardContent>
            <ScrollArea className="h-[520px]">
              <div className="grid gap-3 pr-3">
                {support.slice(0, 30).map((t) => (
                  <article key={t.id} className="space-y-2 rounded-xl border p-4">
                    <h3 className="font-sans text-sm font-semibold tracking-normal">{t.subject}</h3>
                    <p className="text-sm text-muted-foreground">{t.message}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><StatusBadge status={t.category} /><span>{t.name} · {t.email}</span><span>{t.created_at.slice(0, 10)}</span><span>{t.owner_id ? 'Assigned' : 'Unassigned'}</span></div>
                  </article>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
        <Card className="rounded-2xl">
          <CardHeader className="flex flex-row items-center justify-between"><CardTitle className="font-serif text-2xl font-normal">Feedback from around the place</CardTitle><Button asChild variant="link" size="sm"><a href="/api/feedback">JSON<ArrowRight /></a></Button></CardHeader>
          <CardContent>
            <ScrollArea className="h-[520px]">
              <div className="grid gap-3 pr-3">
                {feedback.length ? feedback.map((f, i) => (
                  <article key={i} className="space-y-2 rounded-xl border p-4">
                    <Link href={f.page} className="font-mono text-xs text-primary hover:underline">{f.page}</Link>
                    <p className="text-sm">{f.text}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground"><StatusBadge status={f.rating} /><span>{f.created_at}</span></div>
                  </article>
                )) : <p className="text-sm text-muted-foreground">No feedback yet.</p>}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
