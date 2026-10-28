import { AVATAR_COUNT } from '../../data/images.ts';

const dateFormats = new Map<string, Intl.DateTimeFormat>();

export function money(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
}

export function dateLabel(date: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }): string {
  const key = JSON.stringify(options);
  let format = dateFormats.get(key);
  if (!format) { format = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }); dateFormats.set(key, format); }
  return format.format(new Date(`${date}T12:00:00Z`));
}

export const fullDate = (date: string) => dateLabel(date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
export const initials = (name: string) => name.split(' ').map((p) => p[0]).slice(0, 2).join('');
export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A stable profile photo for an account id (the same person always gets the same photo). */
export function avatarFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `/img/avatars/a-${String((hash % AVATAR_COUNT) + 1).padStart(2, '0')}.jpg`;
}
