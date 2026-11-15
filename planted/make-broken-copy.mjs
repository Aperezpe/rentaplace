#!/usr/bin/env node
// Make a copy of this project with one bug planted on purpose. usage: node planted/make-broken-copy.mjs <folder> [--clean]
// --clean writes the same copy without the bug (the control).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dest = resolve(process.argv[2] ?? '');
const clean = process.argv.includes('--clean');
if (!process.argv[2]) { console.error('usage: node planted/make-broken-copy.mjs <folder> [--clean]'); process.exit(2); }
if (existsSync(dest)) { console.error(`${dest} already exists`); process.exit(2); }
mkdirSync(dest, { recursive: true });
// Tracked files as they are in the working tree (includes uncommitted edits to tracked files).
const files = execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(Boolean).filter((f) => existsSync(join(root, f)));
const tar = execFileSync('tar', ['-cf', '-', '--null', '-T', '-'], { cwd: root, input: files.join('\0'), maxBuffer: 1 << 30 });
execFileSync('tar', ['-xf', '-'], { cwd: dest, input: tar });
if (existsSync(join(root, 'node_modules'))) symlinkSync(realpathSync(join(root, 'node_modules')), join(dest, 'node_modules'), 'dir');
// Seed the copy's database BEFORE planting the bug: the seed prices December stays, so the broken copy cannot seed itself.
execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', '-e', "process.env.RAP_LOG_STDOUT='0';const {bootstrap}=await import('./src/bootstrap.ts');bootstrap().close()", '--input-type=module'], { cwd: dest, env: { ...process.env, RAP_ROOT: dest, RAP_TODAY: '2026-11-09', RAP_DB: '', RAP_LOG_DIR: '', RAP_OUTBOX_DIR: '' }, stdio: 'inherit' });
if (!clean) {
  execFileSync('patch', ['-p1', '-s', '-i', join(root, 'planted/bug-a-december.patch')], { cwd: dest, stdio: 'inherit' });
  writeFileSync(join(dest, 'PLANTED-BUG.md'), '# This copy is broken on purpose\n\n`planted/bug-a-december.patch` is applied: any stay that includes a December night answers 500.\nIt exists so the Day 4 error hunter has a real failure to find. Never copy `src/domain/pricing.ts` back from here.\n');
}
console.log(`${clean ? 'clean' : 'broken'} copy at ${dest}`);
