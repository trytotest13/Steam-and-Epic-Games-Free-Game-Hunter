// Loads the unpacked extension in a real Chromium (headless) via CDP and
// reports any error Chrome would show: manifest/icon problems, service-worker
// crash, content-script injection, popup runtime errors.
// Usage: node tools/cdp-test.mjs [https://start-url]
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const EXT_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 9224;

const candidates = [
  process.env.FGH_BROWSER,
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const exe = candidates.find((p) => existsSync(p));
if (!exe) {
  console.log(JSON.stringify({ loaded: false, stage: 'find-browser', error: 'no Chrome/Edge found' }));
  process.exit(1);
}

const profile = mkdtempSync(join(tmpdir(), 'fgh-profile-'));
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

// Evaluate in a CDP target and always return a plain value (never throws).
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

const out = { exe, loaded: false };
const main = async () => {
  try {
    let targets = await listTargets();
    // Match OUR extension only (Chrome ships component extensions like
    // "Google Network Speech" that also expose chrome-extension:// SW targets).
    const findSw = (ts) =>
      ts.find((t) => t.type === 'service_worker' && t.url.endsWith('background/service-worker.js'));
    let sw = findSw(targets);
    for (let i = 0; i < 10 && !sw; i++) {
      await sleep(1000);
      targets = await listTargets();
      sw = findSw(targets);
    }
    if (!sw) {
      out.stage = 'load-extension';
      out.error =
        '--load-extension produced no service worker for our extension. Either Chrome ignored the flag (newer branded Chrome) or rejected the extension. Try Edge fallback / load via chrome://extensions.';
      out.allTargets = targets
        .filter((t) => (t.url || '').includes('chrome-extension'))
        .map((t) => ({ type: t.type, url: t.url }));
      console.log(JSON.stringify(out, null, 2));
      return;
    }
  out.loaded = true;
  out.extId = sw.url.split('/')[2];

  // 1) Service worker alive?
  const swc = await cdp(sw.webSocketDebuggerUrl);
  await swc.send('Runtime.enable');
  out.serviceWorker = await evalSafe(
    swc,
    `({ version: chrome.runtime.getManifest().version, name: chrome.runtime.getManifest().name, id: chrome.runtime.id })`
  );

  // 2) From the extension's own service worker: open Steam, ping + scan via
  //    the content script — once with the default filter (free only) and
  //    once with the slider at 30%.
  out.contentScript = await evalSafe(
    swc,
    `(async () => {
      try {
        const tab = await chrome.tabs.create({ url: 'https://store.steampowered.com/search/?specials=1', active: false });
        await new Promise((r) => setTimeout(r, 9000));
        const res = await chrome.tabs.sendMessage(tab.id, { cmd: 'FGH_PING' });
        const freeScan = await chrome.tabs.sendMessage(tab.id, { cmd: 'FGH_SCAN' });
        const dealScan = await chrome.tabs.sendMessage(tab.id, { cmd: 'FGH_SCAN', minDiscount: 30 });
        await chrome.tabs.remove(tab.id).catch(() => {});
        const deals = dealScan && dealScan.items ? dealScan.items : [];
        return {
          ping: res,
          freeOnlyCount: freeScan && freeScan.items ? freeScan.items.length : -1,
          min30Count: deals.length,
          min30Sample: deals.slice(0, 4),
          min30AllHaveDiscount: deals.length > 0 && deals.every((i) => i.discount != null && i.discount >= 30),
          min30WithUrl: deals.filter((i) => i.url && i.url.indexOf('store.steampowered.com/app/') !== -1).length,
        };
      } catch (e) { return { err: String((e && e.message) || e) }; }
    })()`
  );

  // 3) Popup page loads without runtime errors?
  await evalSafe(swc, `chrome.windows.create({ url: 'chrome-extension://${out.extId}/popup/popup.html', type: 'popup', width: 400, height: 640 })`);
  await sleep(2500);
  targets = await listTargets();
  const popTarget = targets.find((t) => (t.url || '').includes(`${out.extId}/popup/popup.html`));
  if (popTarget) {
    const pc = await cdp(popTarget.webSocketDebuggerUrl);
    await pc.send('Runtime.enable');
    out.popup = await evalSafe(
      pc,
      `({ ready: document.readyState, btnScan: !!document.getElementById('btnScan'), siteLine: (document.getElementById('siteLine')||{}).textContent })`
    );
    const exc = pc.events
      .filter((e) => e.method === 'Runtime.exceptionThrown')
      .map((e) => String(e.params.exceptionDetails?.exception?.description || e.params.exceptionDetails?.text))
      .slice(0, 5);
    if (exc.length) out.popupExceptions = exc;
  } else {
    out.popup = 'POPUP_TARGET_NOT_FOUND';
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
