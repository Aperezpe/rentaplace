// Ticket → draft, the plain-code part: read the stay out of a ticket's free text only when it is written
// unmistakably, and otherwise say exactly which part could not be read. Code never fills a gap.
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Every run of 2 to 4 words in the text, as a possible listing slug ("Lakeside A-Frame" → lakeside-a-frame). */
export function slugCandidates(text) {
  const words = text.split(/[^A-Za-z0-9-]+/).filter(Boolean);
  const out = new Set();
  for (let n = 2; n <= 4; n++) for (let i = 0; i + n <= words.length; i++) out.add(slugify(words.slice(i, i + n).join(' ')));
  for (const w of words) if (/^[a-z0-9]+(-[a-z0-9]+)+$/.test(w)) out.add(w);
  return [...out].filter((s) => /^[a-z0-9]+(-[a-z0-9]+)+$/.test(s));
}

/**
 * The stay a ticket asks about, or what is missing. `isListing(slug)` asks the product whether that home exists.
 *  - home: exactly one listing named in the text (two different homes → not read);
 *  - dates: exactly two different dates written in full as YYYY-MM-DD, the first before the second
 *    ("Nov 16 to 19" has no year, so it is not read; code does not pick a year);
 *  - guests: a number followed by guests / people / adults / "of us".
 * Returns { ok:true, stay } or { ok:false, missing:[…], found:{…} }.
 */
export async function stayFromText(text, isListing) {
  const found = {}; const missing = [];
  const homes = [];
  for (const s of slugCandidates(text)) if (await isListing(s)) homes.push(s);
  // A longer name contains shorter windows of itself; keep names that are not part of a longer hit.
  const distinct = homes.filter((s) => !homes.some((o) => o !== s && o.includes(s)));
  if (distinct.length === 1) found.slug = distinct[0]; else missing.push(distinct.length ? 'which home (more than one is named)' : 'which home');
  const dates = [...new Set(text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [])].filter((d) => !Number.isNaN(Date.parse(d + 'T00:00:00Z')));
  if (dates.length === 2 && dates[0] < dates[1]) [found.from, found.to] = dates; else missing.push('the dates (written in full, like 2026-11-16 to 2026-11-19)');
  const g = text.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight)\s+(?:guests?|people|adults|of us)\b/i);
  const guests = g ? (WORDS[g[1].toLowerCase()] ?? Number(g[1])) : null;
  if (guests && guests > 0) found.guests = guests; else missing.push('how many guests');
  return missing.length ? { ok: false, missing, found } : { ok: true, stay: found };
}

/** What the writer is told when code could not read the stay: no stay, no price, and what to ask for. */
export function unreadFacts(missing) {
  return {
    lines: [
      `- stay asked about: NOT READ. Code could not read this from the message: ${missing.join('; ')}.`,
      '- price: UNKNOWN. No price was looked up, because the stay is not known. Do not state, estimate or hint at any amount.',
      '- dates: UNKNOWN. Nothing was checked.',
      `- ask the guest for: ${missing.join('; ')}.`,
    ],
    allowedCents: [],
  };
}
