'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Heart, LogOut, Menu, Repeat2, Home, Luggage } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type NavItem = { href: string; label: string };

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

export function MainNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main navigation" className="mx-auto hidden items-center gap-1 md:flex">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(pathname, item.href) ? 'page' : undefined}
          className={cn(
            'rounded-full px-3.5 py-2 text-sm font-medium text-foreground/80 transition-colors hover:bg-secondary hover:text-primary',
            isActive(pathname, item.href) && 'bg-secondary text-primary',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function MobileNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu"><Menu /></Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-72">
        <SheetHeader><SheetTitle className="font-serif text-2xl">RentAPlace</SheetTitle></SheetHeader>
        <nav aria-label="Mobile navigation" className="grid gap-1 px-4">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={isActive(pathname, item.href) ? 'page' : undefined}
              className={cn('rounded-lg px-3 py-2.5 text-base hover:bg-secondary', isActive(pathname, item.href) && 'bg-secondary text-primary')}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </SheetContent>
    </Sheet>
  );
}

export function AccountMenu({ user }: { user: { id: string; name: string; role: string; avatar: string; initials: string } }) {
  const pathname = usePathname();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-11 gap-2.5 rounded-full pl-1.5 pr-4">
          <Avatar className="size-8">
            <AvatarImage src={user.avatar} alt="" />
            <AvatarFallback className="text-xs">{user.initials}</AvatarFallback>
          </Avatar>
          <span className="hidden text-left leading-tight sm:block">
            <span className="block text-sm font-medium">{user.name.split(' ')[0]}</span>
            <span className="block text-[11px] font-normal text-muted-foreground">Demo {user.role}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="font-normal">
          <span className="block font-medium">{user.name}</span>
          <span className="block text-xs text-muted-foreground">Demo {user.role} account</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {user.role === 'guest' ? (
          <DropdownMenuItem asChild><Link href="/trips"><Luggage />Your trips</Link></DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild><Link href="/host"><Home />Host space</Link></DropdownMenuItem>
        )}
        <DropdownMenuItem asChild><Link href={`/signin?next=${encodeURIComponent(pathname)}`}><Repeat2 />Switch account</Link></DropdownMenuItem>
        <DropdownMenuSeparator />
        <form method="post" action="/auth/signout">
          <DropdownMenuItem asChild><button type="submit" className="w-full"><LogOut />Sign out</button></DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Messages carried back in the address after a form post (?saved, ?feedback, ?received, ?error). */
export function FlashMessages() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const shown = useRef('');
  useEffect(() => {
    const key = params.toString();
    if (!key || shown.current === key) return;
    let message: string | undefined;
    if (params.has('error')) toast.error(params.get('error') ?? 'Something went wrong.');
    else if (params.has('feedback')) message = 'Thank you. Your feedback has been saved.';
    else if (params.has('received')) message = `We’ve received your request. Your reference is ${params.get('received')}.`;
    else if (params.has('saved')) message = 'Your changes have been saved.';
    if (message) toast.success(message);
    if (['error', 'feedback', 'saved'].some((k) => params.has(k))) {
      shown.current = key;
      const next = new URLSearchParams(params);
      ['error', 'feedback', 'saved'].forEach((k) => next.delete(k));
      router.replace(next.size ? `${pathname}?${next}` : pathname, { scroll: false });
    }
  }, [params, pathname, router]);
  return null;
}

export function FeedbackWidget() {
  const pathname = usePathname();
  const params = useSearchParams();
  const page = params.size ? `${pathname}?${params}` : pathname;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" className="fixed right-4 bottom-4 z-30 h-10 rounded-full bg-card shadow-lg shadow-primary/5">
          <Heart className="text-primary" />How was this page?
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-80">
        <form method="post" action="/feedback" className="grid gap-4">
          <div className="space-y-1">
            <h3 className="text-lg">A little feedback helps.</h3>
            <p className="text-xs text-muted-foreground">Please keep payment details out of your message.</p>
          </div>
          <input type="hidden" name="page" value={pathname} />
          <input type="hidden" name="next" value={page} />
          <RadioGroup name="rating" defaultValue="good" className="grid grid-cols-2 gap-2">
            {[['good', 'Good'], ['needs-work', 'Could be better']].map(([value, label]) => (
              <Label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border p-2.5 text-sm font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary">
                <RadioGroupItem value={value} />{label}
              </Label>
            ))}
          </RadioGroup>
          <div className="grid gap-2">
            <Label htmlFor="feedback-text">What should we know?</Label>
            <Textarea id="feedback-text" name="text" rows={3} maxLength={2000} required placeholder="Tell us what worked, or what got in the way." />
          </div>
          <Button type="submit">Send feedback</Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
