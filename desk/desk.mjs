// The front desk: Booking's customer-safe side, answering one visitor message with two powers (desk/tools/desk.ts).
// Used by POST /desk in src/server.ts and by the desk checks. Pi in print mode, small model, no other tools, no saved session.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PI = process.env.PI_BIN || 'pi';
export const DESK_MODEL = process.env.DESK_MODEL || 'anthropic/claude-haiku-4-5';

const section = (text, title) => (text.match(new RegExp(`^##\\s+${title}\\s*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'm')) || [, ''])[1].trim();
/** Drop a line's trailing source note "(commit …; file …)" and a glossary line's "(Code: …)" note. Sources are for colleagues. */
export const withoutSources = text => text.split('\n').map(l => l.replace(/\s*\((?:Code:|commit |decision |tracker card |`[^`]+`[,;]|`test\/)[^()]*(?:\([^()]*\)[^()]*)*\)\s*$/i, '').replace(/\s*\(`[^`]+`\.?\)\s*$/, '')).join('\n');
/** What the desk may know: the Job, the glossary and the customer-facing memories without sources, and the desk rules. Never the internal memories. */
export function deskKnowledge(root = ROOT) {
  const dir = path.join(root, 'agents', 'booking');
  const read = f => fs.readFileSync(path.join(dir, f), 'utf8');
  const glossary = withoutSources(read('glossary.md')).replace(/^.*Short on purpose.*$/m, '').trim();
  const memories = withoutSources(section(read('memories.md'), 'Customer-facing'));
  return [section(read('agent.md'), 'Job').replace(/\s+/g, ' '), glossary, `## What guests are told\n${memories}`, section(read('desk.md'), 'At the desk')].join('\n\n');
}
/** The whole of Booking, as Day 3 runs it: the control for the leak check. */
export function internalKnowledge(root = ROOT) {
  const dir = path.join(root, 'agents', 'booking');
  const read = f => fs.readFileSync(path.join(dir, f), 'utf8').trim();
  return [section(read('agent.md'), 'Job').replace(/\s+/g, ' '), read('glossary.md'), read('memories.md')].join('\n\n');
}
/** Things only a colleague should see: commit hashes, repository paths, test names, tracker cards, function names. */
export function leaks(reply, root = ROOT) {
  const dir = path.join(root, 'agents', 'booking');
  const internal = fs.readFileSync(path.join(dir, 'memories.md'), 'utf8') + fs.readFileSync(path.join(dir, 'glossary.md'), 'utf8');
  const marks = new Set();
  for (const m of internal.matchAll(/`([^`]+)`/g)) if (/[\/_.-]|[a-z][A-Z]/.test(m[1]) && m[1].length > 5) marks.add(m[1]);
  for (const m of internal.matchAll(/commit ([0-9a-f]{7})/g)) marks.add(m[1]);
  for (const m of internal.matchAll(/added in ([0-9a-f]{7})/g)) marks.add(m[1]);
  return [...marks].filter(mark => reply.includes(mark));
}

function runPi({ system, message, model, env, tools }) {
  return new Promise((resolve, reject) => {
    const argv = ['-p', '--mode', 'json', '--no-session', '-ne', '-ns', '-np', '-nc', '--no-mcp', ...(tools ? ['-e', path.join(HERE, 'tools', 'desk.ts'), '--tools', 'quote,place_hold'] : ['--no-tools']), '--thinking', 'off', '--model', model, '--system-prompt', system, message];
    const child = spawn(PI, argv, { cwd: os.tmpdir(), env: { ...process.env, PI_SKIP_VERSION_CHECK: '1', ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', d => out += d); child.stderr.on('data', d => err += d);
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      let text = '', used = '', cost = 0; const toolNames = [];
      for (const line of out.split('\n')) {
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'message_end' && e.message?.role === 'assistant') {
          const t = (e.message.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
          for (const c of e.message.content || []) if (c.type === 'toolCall') toolNames.push(c.name);
          if (t.trim()) text = t;
          used = `${e.message.provider}/${e.message.model}`; cost += e.message.usage?.cost?.total || 0;
          if (e.message.errorMessage) err += e.message.errorMessage;
        }
      }
      if (!text.trim()) return reject(Error(`${model} gave no reply (exit ${code}): ${err.trim().split('\n').slice(-1)[0] || 'no output'}`));
      if (used !== model) return reject(Error(`asked for ${model}, but ${used} answered`));
      resolve({ text: text.trim(), cost, toolNames });
    });
  });
}

/** Ask a model with given knowledge and no tools (leak check). */
export const askPlain = (system, message, model = DESK_MODEL) => runPi({ system, message, model, env: {}, tools: false });

/**
 * One visitor message to the desk. `cookie` is the visitor's own sign-in, passed straight through to the product.
 * Returns the reply, the confirmation (built here from what the product saved, never from the model's words),
 * and whether something was left for a person (appended to `list`, one line each).
 */
export async function askDesk({ message, cookie = '', guest = null, site, list, model = DESK_MODEL, broken = process.env.DESK_BROKEN || '' }) {
  const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'desk-')), 'tools.jsonl');
  const who = guest ? `The visitor is signed in as the guest ${guest.name}.` : 'The visitor is not signed in. A hold needs a guest sign-in; you can still quote.';
  const r = await runPi({ system: `${deskKnowledge()}\n\n${who}`, message: String(message).slice(0, 4000), model, tools: true, env: { DESK_SITE: site, DESK_COOKIE: cookie, DESK_GUEST: guest?.id || '', DESK_LOG: log, DESK_BROKEN: broken } });
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  fs.rmSync(path.dirname(log), { recursive: true, force: true });
  const held = calls.filter(c => c.tool === 'place_hold' && c.hold).at(-1);
  const m = r.text.match(/^\s*FOR A PERSON:\s*(.+)$/m);
  const reply = r.text.replace(/^\s*FOR A PERSON:.*$/m, '').trim();
  let forAPerson = null;
  if (m) { forAPerson = { at: new Date().toISOString(), guest: guest?.id || null, asked: m[1].trim(), message: String(message).slice(0, 500), status: 'waiting for a person' }; if (list) { fs.mkdirSync(path.dirname(list), { recursive: true }); fs.appendFileSync(list, JSON.stringify(forAPerson) + '\n'); } }
  return { reply, confirmation: held ? { ...held.hold, sameRequestAsBefore: !!held.replayed } : null, forAPerson, calls, cost: r.cost, model };
}
