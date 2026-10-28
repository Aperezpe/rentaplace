'use client';

import { useRef, useState } from 'react';
import { CalendarDays, CreditCard, MapPin, Search, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

const GUEST_OPTIONS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20];

/** Check-in / check-out pair that refuses a check-out on or before check-in, with the browser's own message UI. */
export function DateRangeFields({ from, to, min, className, labels = ['Check in', 'Check out'], compact }: {
  from: string; to: string; min: string; className?: string; labels?: [string, string]; compact?: boolean;
}) {
  const toRef = useRef<HTMLInputElement>(null);
  const [start, setStart] = useState(from);
  const check = (value: string) => {
    const input = toRef.current;
    if (!input) return;
    input.setCustomValidity(value && input.value && input.value <= value ? 'Check-out must be after check-in.' : '');
  };
  return (
    <div className={cn('grid grid-cols-2 gap-3', className)}>
      <div className="grid gap-1.5">
        <Label htmlFor="stay-from" className={cn(compact && 'eyebrow text-[10px] text-muted-foreground')}>{labels[0]}</Label>
        <Input id="stay-from" type="date" name="from" defaultValue={from} min={min} required onChange={(e) => { setStart(e.target.value); check(e.target.value); }} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="stay-to" className={cn(compact && 'eyebrow text-[10px] text-muted-foreground')}>{labels[1]}</Label>
        <Input id="stay-to" ref={toRef} type="date" name="to" defaultValue={to} min={start || min} required onChange={() => check(start)} />
      </div>
    </div>
  );
}

export function GuestSelect({ value, max, id = 'guests', name = 'guests' }: { value: number; max?: number; id?: string; name?: string }) {
  const options = max ? Array.from({ length: max }, (_, i) => i + 1) : GUEST_OPTIONS;
  return (
    <Select name={name} defaultValue={String(value)}>
      <SelectTrigger id={id} className="w-full bg-card"><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((n) => <SelectItem key={n} value={String(n)}>{n} {n === 1 ? 'guest' : 'guests'}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

export function SearchBar({ place = '', from, to, guests = 2, min, className }: { place?: string; from: string; to: string; guests?: number; min: string; className?: string }) {
  return (
    <form method="get" action="/search" className={cn('grid gap-3 rounded-2xl border bg-card p-3 shadow-xl shadow-primary/5 sm:p-4 lg:grid-cols-[1.4fr_1.6fr_0.9fr_auto] lg:items-end', className)}>
      <div className="grid gap-1.5">
        <Label htmlFor="search-place" className="eyebrow text-[10px] text-muted-foreground"><MapPin className="size-3" />Where</Label>
        <Input id="search-place" name="place" defaultValue={place} placeholder="A region, a home, a little escape" />
      </div>
      <DateRangeFields from={from} to={to} min={min} compact labels={['Check in', 'Check out']} />
      <div className="grid gap-1.5">
        <Label htmlFor="search-guests" className="eyebrow text-[10px] text-muted-foreground"><Users className="size-3" />Guests</Label>
        <GuestSelect id="search-guests" value={guests} />
      </div>
      <Button type="submit" size="lg" className="h-10"><Search />Search</Button>
    </form>
  );
}

export function DemoCardField() {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-primary/30 bg-secondary/60 p-4 text-sm">
        <div>
          <p className="font-medium">No real money will move.</p>
          <p className="text-muted-foreground">Use the test card 4242 4242 4242 4242. Card numbers are never stored.</p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => { if (ref.current) { ref.current.value = '4242 4242 4242 4242'; ref.current.focus(); } }}>
          <CreditCard />Fill in the demo card
        </Button>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="card-number">Demo card number</Label>
        <Input id="card-number" ref={ref} name="cardNumber" inputMode="numeric" autoComplete="off" placeholder="4242 4242 4242 4242" required maxLength={23} aria-describedby="demo-card-note" />
        <p id="demo-card-note" className="text-xs text-muted-foreground">Only the test card is accepted. Do not enter real payment details.</p>
      </div>
    </div>
  );
}

export function MonthField({ value }: { value: string }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="month"><CalendarDays className="size-3.5" />Month</Label>
      <Input id="month" type="month" name="month" defaultValue={value} required className="bg-card" />
    </div>
  );
}

export function SimpleSelect({ id, name, value, options, className }: { id: string; name: string; value: string; options: [string, string][]; className?: string }) {
  return (
    <Select name={name} defaultValue={value || 'all'}>
      <SelectTrigger id={id} className={cn('w-full bg-card', className)}><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map(([v, label]) => <SelectItem key={v || 'all'} value={v || 'all'}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
