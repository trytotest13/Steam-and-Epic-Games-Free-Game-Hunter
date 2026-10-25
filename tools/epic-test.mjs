// Epic-specific end-to-end test: loads the unpacked extension in Edge (CDP),
// opens Epic's free-games page through the extension's own service worker,
// pings the content script, scans (free + slider modes), then opens the first
// giveaway's game page and checks the Get button is found.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const EXT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 9226;

const exe =
  process.env.FGH_BROWSER ||
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
if (!existsSync(exe)) {
  console.log(JSON.stringify({ error: 'browser not found: ' + exe }));
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'fgh-epic-'));
const browser = spawn(exe, [
  '--headless=new',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  `--load-extension=${EXT_DIR}`,
  '--window-size=1280,900',
  'about:blank',
], { stdio: 'ignore' });

const cdp = (wsUrl) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.onopen = () =>
      resolve({
        events,
        send: (method, params = {}) =>
          new Promise((res, rej) => {
            const mid = ++id;
            pending.set(mid, { res, rej });
            ws.send(JSON.stringify({ id: mid, method, params }));
          }),
        close: () => ws.close(),
      });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      } else if (m.method) {
        events.push(m);
      }
    };
    ws.onerror = () => reject(new Error('websocket error'));
  });

const evalSafe = async (conn, expression) => {
  try {
    const raw = await conn.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (raw && raw.exceptionDetails) {
      return { __exception: String(raw.exceptionDetails?.exception?.description || raw.exceptionDetails?.text) };
    }
    return raw && raw.result ? raw.result.value : { __raw: raw };
  } catch (e) {
    return { __sendError: String((e && e.message) || e) };
  }
};

const listTargets = async () => {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      return await r.json();
    } catch {
      await sleep(500);
    }
  }
  throw new Error('CDP never came up');
};

const out = {};
const main = async () => {
  try {
    let targets = await listTargets();
    const findSw = (ts) =>
      ts.find((t) => t.type === 'service_worker' && t.url.endsWith('background/service-worker.js'));
    let sw = findSw(targets);
    for (let i = 0; i < 10 && !sw; i++) {
      await sleep(1000);
      targets = await listTargets();
      sw = findSw(targets);
    }
    if (!sw) {
      out.error = 'extension did not load';
      console.log(JSON.stringify(out, null, 2));
      return;
    }
    out.extId = sw.url.split('/')[2];
    const swc = await cdp(sw.webSocketDebuggerUrl);
    await swc.send('Runtime.enable');

    // 1) Free-games listing through the real popup pipeline.
    out.listing = await evalSafe(
      swc,
      `(async () => {
        try {
          const tab = await chrome.tabs.create({ url: 'https://store.epicgames.com/en-US/free-games', active: false });
          await new Promise((r) => setTimeout(r, 12000));
          const ping = await chrome.tabs.sendMessage(tab.id, { cmd: 'FGH_PING' }).catch((e) => ({ pingErr: String(e && e.message || e) }));
          const free = await chrome.tabs.sendMessage(tab.id, { cmd: 'FGH_SCAN' }).catch((e) => ({ scanErr: String(e && e.message || e) }));
          const deals = await chrome.tabs.sendMessage(tab.id, { cmd: 'FGH_SCAN', minDiscount: 30 }).catch(() => null);
          const freeItems = free && free.items ? free.items : [];
          // DOM diagnostics straight from the page (via the content script's world is not
          // needed; the SW can't read the DOM, so this runs through an IFRAME-free probe:
          // we instead ask the content script for a diagnostic via FGH_PING only).
          return {
            url: tab.url,
            ping,
            scanOk: free && free.ok,
            scanError: free && free.error,
            freeCount: freeItems.length,
            freeSample: freeItems.slice(0, 5),
            giveawayUrls: freeItems.filter((i) => i.claimable).map((i) => i.url).filter(Boolean).slice(0, 3),
            dealCount: deals && deals.items ? deals.items.length : -1,
          };
        } catch (e) { return { err: String((e && e.message) || e) }; }
      })()`
    );

    // 1b) DOM diagnostics from the page's own world.
    targets = await listTargets();
    const epicTab = targets.find((t) => t.type === 'page' && (t.url || '').includes('store.epicgames.com'));
    if (epicTab) {
      const tc = await cdp(epicTab.webSocketDebuggerUrl);
      await tc.send('Runtime.enable');
      out.dom = await evalSafe(
        tc,
        `(() => {
          const own = (el) => Array.from(el.childNodes || []).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').replace(/\\s+/g, ' ').trim();
          const leaves = [];
          for (const el of document.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6')) {
            const t = own(el);
            if (t && /free/i.test(t) && t.length < 40) leaves.push(t);
          }
          return {
            title: document.title,
            bodyChars: (document.body.innerText || '').length,
            bodySample: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 400),
            freeLeaves: Array.from(new Set(leaves)).slice(0, 12),
            plinks: document.querySelectorAll('a[href*="/p/"]').length,
            iframes: [...document.querySelectorAll('iframe')].map((f) => f.src.slice(0, 80)).slice(0, 4),
          };
        })()`
      );
    }

    // 2) Open the first giveaway's game page: is the Get button detected?
    const urls = (out.listing && out.listing.giveawayUrls) || [];
    if (urls.length) {
      out.pdp = await evalSafe(
        swc,
        `(async () => {
          try {
            const tab = await chrome.tabs.create({ url: ${JSON.stringify(urls[0])}, active: false });
            await new Promise((r) => setTimeout(r, 12000));
            const ping = await chrome.tabs.sendMessage(tab.id, { cmd: 'FGH_PING' }).catch((e) => ({ pingErr: String(e && e.message || e) }));
            const scan = await chrome.tabs.sendMessage(tab.id, { cmd: 'FGH_SCAN' }).catch((e) => ({ scanErr: String(e && e.message || e) }));
            const dry = await chrome.tabs.sendMessage(tab.id, { cmd: 'FGH_ADD', ids: (scan && scan.items ? scan.items.filter(i => i.claimable).map(i => i.id) : []), dryRun: true }).catch((e) => ({ addErr: String(e && e.message || e) }));
            await chrome.tabs.remove(tab.id).catch(() => {});
            return { url: tab.url, ping, items: scan && scan.items ? scan.items : scan, dryRunAdd: dry };
          } catch (e) { return { err: String((e && e.message) || e) }; }
        })()`
      );
    } else {
      out.pdp = 'SKIPPED — no giveaway url found on the listing';
    }
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    out.error = String((e && e.message) || e);
    console.log(JSON.stringify(out, null, 2));
  } finally {
    try { browser.kill(); } catch {}
    await sleep(500);
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  }
};

main();
