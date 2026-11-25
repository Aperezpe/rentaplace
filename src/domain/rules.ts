import type { DatabaseSync } from 'node:sqlite';
import type { Listing } from '../types.ts';
import { policyText } from './cancellation.ts';

/**
 * The fixed rule topics. One list feeds the desk tool's topic enum, the API and the home page.
 * stored: the passage is the home's row in listing_rules, or nothing when the home publishes none.
 * listing: the passage is built from a published listing field (guest count, cancellation policy).
 */
export const RULE_TOPICS = [
  { id: 'check_in_out', label: 'Check-in and check-out', describe: 'arrival and departure times', source: 'stored' },
  { id: 'smoking', label: 'Smoking', describe: 'smoking, vaping', source: 'stored' },
  { id: 'quiet_hours', label: 'Quiet hours', describe: 'noise, quiet hours', source: 'stored' },
  { id: 'max_guests', label: 'Guests', describe: 'how many people may stay', source: 'listing' },
  { id: 'pets', label: 'Pets', describe: 'dogs, cats or any pet (not service animals)', source: 'stored' },
  { id: 'cancellation', label: 'Cancellation', describe: 'cancelling and refunds', source: 'listing' },
] as const satisfies readonly { id: string; label: string; describe: string; source: 'stored' | 'listing' }[];
export type RuleTopicId = (typeof RULE_TOPICS)[number]['id'];
export const RULE_TOPIC_IDS = RULE_TOPICS.map(t => t.id) as RuleTopicId[];

/** One passage of one home's published rules: what the page shows, the tool returns and a reply is checked against. */
export type RulePassage = { id: string; slug: string; home: string; topic: RuleTopicId; label: string; text: string; link: string; updatedAt: string };

type Home = Pick<Listing, 'id' | 'slug' | 'title' | 'sleeps' | 'cancellation_policy' | 'updated_at'>;
function fromListing(home: Home, topic: RuleTopicId): string | null {
  if (topic === 'max_guests') return `Up to ${home.sleeps} ${home.sleeps === 1 ? 'guest' : 'guests'}.`;
  if (topic === 'cancellation') return `${policyText[home.cancellation_policy]} No refunds after check-in.`;
  return null;
}

/** The home's passage on a topic, or null when it publishes nothing on it. Never borrowed from another home. */
export function rulePassage(db: DatabaseSync, home: Home, topic: RuleTopicId): RulePassage | null {
  const entry = RULE_TOPICS.find(t => t.id === topic);
  if (!entry) return null;
  let text: string | null, updatedAt = home.updated_at;
  if (entry.source === 'stored') {
    const row = db.prepare('SELECT text,updated_at FROM listing_rules WHERE listing_id=? AND topic=?').get(home.id, topic) as { text: string; updated_at: string } | undefined;
    text = row?.text ?? null; if (row) updatedAt = row.updated_at;
  } else text = fromListing(home, topic);
  if (!text) return null;
  return { id: `${home.slug}:${topic}`, slug: home.slug, home: home.title, topic, label: entry.label, text, link: `/homes/${home.slug}#rule-${topic}`, updatedAt };
}
export function rulePassages(db: DatabaseSync, home: Home): RulePassage[] {
  return RULE_TOPIC_IDS.map(t => rulePassage(db, home, t)).filter((p): p is RulePassage => p !== null);
}

/** Seed: the rules every home publishes, and a pets passage only for homes marked Pet friendly. Same rows as migration 004. */
export function publishSeedRules(db: DatabaseSync) {
  for (const [topic, text] of [['check_in_out', 'Check-in after 3 pm. Check-out by 11 am.'], ['smoking', 'No smoking indoors.'], ['quiet_hours', 'Quiet hours 10 pm to 8 am.']])
    db.prepare('INSERT OR IGNORE INTO listing_rules SELECT id,?,?,updated_at FROM listings').run(topic, text);
  db.prepare(`INSERT OR IGNORE INTO listing_rules SELECT id,'pets','Pets welcome; please include them in your note to support.',updated_at FROM listings WHERE amenities LIKE '%"Pet friendly"%'`).run();
}
