// Step two: a model with no tools writes the words. Pi in print mode; a reply from another model than the one asked for is refused.
import { spawn } from 'node:child_process';
import os from 'node:os';
export let spent = 0;
export function write(model, system, prompt) {
  return new Promise((resolve, reject) => {
    const argv = ['-p', '--mode', 'json', '--no-session', '-ne', '-ns', '-np', '-nc', '--no-mcp', '--no-tools', '--thinking', 'off', '--model', model, '--system-prompt', system, prompt];
    const child = spawn(process.env.PI_BIN || 'pi', argv, { cwd: os.tmpdir(), env: { ...process.env, PI_SKIP_VERSION_CHECK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => out += d); child.stderr.on('data', (d) => err += d);
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let text = '', used = '';
      for (const line of out.split('\n')) {
        let e; try { e = JSON.parse(line); } catch { continue; }
        if (e.type === 'message_end' && e.message?.role === 'assistant') { text = (e.message.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''); used = `${e.message.provider}/${e.message.model}`; spent += e.message.usage?.cost?.total || 0; }
      }
      if (!text.trim()) return reject(Error(`${model} gave no reply (exit ${code}): ${err.trim().split('\n').slice(-2).join(' ')}`));
      if (used && used !== model) return reject(Error(`asked for ${model}, but ${used} answered`));
      resolve(text.trim());
    });
  });
}
