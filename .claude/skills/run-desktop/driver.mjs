// .claude/skills/run-desktop/driver.mjs
// Driver for Zlib Workbench (Electron). Native Windows desktop -- no xvfb
// needed (there's a real display), so this launches directly.
//
// Two modes:
//   Interactive REPL:  node driver.mjs
//   Scripted (no TTY needed): node driver.mjs "launch" "ss 01" "click-text Reinject (packzip)" "ss 02" "quit"
//     (each argv is one command line, run in order, then the process exits)
//
// Designed for agents: wrap in tmux if available and send-keys commands, or
// use the scripted argv mode when tmux isn't installed (this machine has no
// tmux at time of writing).

import { _electron as electron } from 'playwright-core';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '../../..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(APP_DIR, '.driver-shots');
fs.mkdirSync(SHOT_DIR, { recursive: true });

let app = null;
let page = null;

const electronBin = process.platform === 'darwin'
  ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  : path.join(APP_DIR, 'node_modules/electron/dist/electron.exe');

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched');
    app = await electron.launch({
      executablePath: electronBin,
      args: [APP_DIR, '--dev'],
      timeout: 30_000,
    });
    app.on('console', (msg) => console.log('[app console]', msg.text()));
    page = app.windows().find(w => !w.url().startsWith('devtools://'))
        ?? await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    console.log('launched.', app.windows().length, 'windows:');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(s => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click(); return 'OK';
    }, sel);
    console.log('click', sel, '->', r);
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(t => {
      const els = [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')];
      const el = els.find(e => e.textContent?.trim() === t)
              ?? els.find(e => e.textContent?.includes(t));
      if (!el) return 'NOT_FOUND';
      el.click(); return 'OK: ' + el.tagName;
    }, text);
    console.log('click-text', JSON.stringify(text), '->', r);
  },

  async type(text)  { if (page) await page.keyboard.type(text, { delay: 30 }); },
  async press(key)  { if (page) await page.keyboard.press(key); },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first');
    try { await page.waitForSelector(sel, { timeout: 10_000 }); console.log('found:', sel); }
    catch { console.log('TIMEOUT:', sel); }
  },

  async sleep(ms) { await new Promise(r => setTimeout(r, Number(ms) || 500)); },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try { console.log(JSON.stringify(await page.evaluate(expr))); }
    catch (e) { console.log('ERROR:', e.message); }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(await page.evaluate(
      s => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
      sel || null));
  },

  async windows() {
    if (!app) return console.log('ERROR: launch first');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async quit() { if (app) await app.close().catch(()=>{}); app = null; page = null; },
  help() { console.log('commands:', Object.keys(COMMANDS).join(', ')); },
};

async function runLine(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (!cmd) return;
  const fn = COMMANDS[cmd];
  if (!fn) { console.log('unknown:', cmd, '- try: help'); return; }
  try { await fn(rest.join(' ')); } catch (e) { console.log('ERROR:', e.message); }
}

const scriptedCommands = process.argv.slice(2);

if (scriptedCommands.length > 0) {
  // Scripted mode: run each argv as one command line, in order, then exit.
  (async () => {
    for (const line of scriptedCommands) {
      console.log('driver>', line);
      await runLine(line);
    }
    await COMMANDS.quit();
    process.exit(0);
  })();
} else {
  // Interactive REPL mode.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'driver> ' });
  console.log('Zlib Workbench driver - "help" for commands, "launch" to start');
  rl.prompt();
  rl.on('line', async (line) => {
    await runLine(line);
    if (line.trim() === 'quit') { rl.close(); process.exit(0); }
    rl.prompt();
  });
  rl.on('close', async () => { await COMMANDS.quit(); process.exit(0); });
}
