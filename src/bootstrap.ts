import { openDatabase } from './db.ts';
import { seedDatabase } from '../data/seed.ts';
export function bootstrap(path?: string) {
  const db = openDatabase(path);
  if (!db.prepare('SELECT id FROM users LIMIT 1').get()) seedDatabase(db);
  return db;
}
