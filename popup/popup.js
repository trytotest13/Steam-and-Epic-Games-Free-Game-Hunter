// Free Game Hunter — popup logic.
const $ = (s) => document.querySelector(s);

let tab = null;
let info = null; // { site, label, page }
let items = [];
let settings = { dryRun: false, autoCheckout: false, minDiscount: 100 };

async function getSettings() {
  const st = await chrome.storage.sync.get(settings);
  settings = { ...settings, ...st };
  $('#dryRun').checked = settings.dryRun;
  $('#autoCheckout').checked = settings.autoCheckout;
  $('#minDiscount').value = settings.minDiscount;
  updateMinLabel();
}

function updateMinLabel() {
  const min = Number($('#minDiscount').value) || 0;
  $('#minVal').textContent = min + '%';
  $('#minHint').textContent =
    min >= 100 ? '100% = free games only' : `Shows games with ${min}% off or more — put them in the cart and pay there`;
  $('#btnScan').textContent = min >= 100 ? 'Scan for free games' : `Scan for deals ≥ ${min}%`;
  $('#autoCheckout').disabled = min < 100;
  if (min < 100) {
    $('#autoCheckout').checked = false;
    $('#autoCheckout').closest('label').style.opacity = '0.5';
  } else {
    $('#autoCheckout').closest('label').style.opacity = '';
    $('#autoCheckout').checked = settings.autoCheckout;
  }
}

function saveSettings() {
  settings.dryRun = $('#dryRun').checked;
  settings.autoCheckout = $('#autoCheckout').checked;
  settings.minDiscount = Number($('#minDiscount').value) || 0;
  chrome.storage.sync.set(settings);
}

function sendTab(msg) {
  return new Promise((resolve) => {
    if (!tab || !tab.id) return resolve(null);
    try {
      chrome.tabs.sendMessage(tab.id, msg, (res) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(res);
      });
    } catch {
      resolve(null);
    }
  });
}

async function injectFiles(files) {
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files });
    return true;
  } catch {
    return false;
  }
}

// Known store hosts get their dedicated adapter even when the page was opened
// before the extension was installed or reloaded (content scripts only inject
// into pages loaded afterwards).
function scannerFilesFor(url) {
  const u = url || '';
  if (/store\.steampowered\.com/i.test(u)) return ['content/common.js', 'content/steam.js'];
  if (/store\.epicgames\.com|www\.epicgames\.com\/store/i.test(u)) return ['content/common.js', 'content/epic.js'];
  return ['content/common.js', 'content/generic.js'];
}

async function ensureScanner() {
  let res = await sendTab({ cmd: 'FGH_PING' });
  if (res && res.ok) return res;
  if (!/^https?:/i.test(tab.url || '')) return null;
  const ok = await injectFiles(scannerFilesFor(tab.url));
  if (!ok) return null;
  res = await sendTab({ cmd: 'FGH_PING' });
  return res && res.ok ? res : null;
}

function setStatus(text, isError) {
  const el = $('#status');
  el.textContent = text || '';
  el.classList.toggle('error', !!isError);
}

function updateAddLabel() {
  const n = document.querySelectorAll('#itemList input:checked').length;
  $('#btnAdd').textContent = n ? `Add ${n} to cart` : 'Add to cart';
  $('#btnAdd').disabled = n === 0;
}

function renderItems() {
  const list = $('#itemList');
  list.innerHTML = '';
  items.forEach((it, idx) => {
    const li = document.createElement('li');
    li.style.setProperty('--i', Math.min(idx, 10));
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!it.claimable;
    cb.dataset.id = it.id;
    cb.setAttribute('aria-label', it.title);
    const meta = document.createElement('div');
    meta.className = 'meta';
    const title = document.createElement('span');
    title.className = 't';
    title.textContent = it.title;
    title.title = it.title + (it.claimable ? '' : ' — no add-to-cart on this page');
    const price = document.createElement('span');
    price.className = 'price';
    price.textContent = it.price || 'Free';
    meta.append(title, price);
    li.append(cb, meta);
    if (it.discount != null && it.discount < 100) {
      const d = document.createElement('span');
      d.className = 'badge';
      d.textContent = `-${it.discount}%`;
      d.title = `${it.discount}% off`;
      li.appendChild(d);
    }
    if (it.url) {
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'openbtn';
      open.title = 'Open the game page';
      open.setAttribute('aria-label', `Open ${it.title} page`);
      open.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
        '<path d="M18 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4.5"/>' +
        '<path d="M14.5 4H20v5.5"/>' +
        '<path d="M11 13 20 4"/></svg>';
      open.addEventListener('click', () => {
        try {
          chrome.tabs.create({ url: it.url, active: true });
        } catch {}
      });
      li.appendChild(open);
    }
    if (!it.claimable) li.classList.add('weak');
    list.appendChild(li);
  });
  $('#results').hidden = items.length === 0;
  $('#resultsTitle').textContent = `${items.length} deal${items.length === 1 ? '' : 's'}`;
  updateAddLabel();
}

async function scan() {
  setStatus('Scanning…');
  $('#btnScan').disabled = true;
  info = await ensureScanner();
  $('#btnScan').disabled = false;
  if (!info) {
    $('#siteLine').textContent = 'Not a store page (or needs a reload)';
    setStatus('Open a store page and try again. On other sites the beta scanner runs when you click the extension icon.', true);
    return;
  }
  $('#siteLine').textContent = `${info.label} — ${info.page}`;
  const res = await sendTab({ cmd: 'FGH_SCAN', minDiscount: Number($('#minDiscount').value) || 0 });
  if (res && res.ok === false) {
    setStatus(`Scan failed on this page: ${res.error || 'unknown error'}. Reload the page (F5) and try again.`, true);
    $('#btnScan').disabled = false;
    return;
  }
  items = (res && res.items) || [];
  renderItems();
  const min = Number($('#minDiscount').value) || 0;
  setStatus(
    items.length
      ? `${items.length} deal${items.length === 1 ? '' : 's'} on this page.`
      : `No deals ≥ ${min}% on this page. Lower the slider or open a store page with discounts.`
  );
}

async function logHistory(results) {
  const st = await chrome.storage.local.get(['fghHistory']);
  const hist = st.fghHistory || [];
  for (const r of results.slice(0, 20)) {
    hist.unshift({
      ts: Date.now(),
      site: info ? info.label : '',
      title: r.title || '?',
      ok: !!r.ok,
      message: r.message || '',
    });
  }
  await chrome.storage.local.set({ fghHistory: hist.slice(0, 50) });
  renderHistory();
}

async function addSelected() {
  const ids = Array.from(document.querySelectorAll('#itemList input:checked')).map((c) => c.dataset.id);
  if (!ids.length) return;
  const dry = $('#dryRun').checked;
  setStatus(dry ? 'Highlighting (dry run)…' : 'Adding to cart…');
  const res = (await sendTab({ cmd: 'FGH_ADD', ids, dryRun: dry })) || { ok: false, results: [] };
  const results = res.results || [];

  for (const r of results) {
    const li = Array.from($('#itemList').children).find(
      (x) => x.querySelector('input') && x.querySelector('input').dataset.id === r.id
    );
    if (!li) continue;
    const s = document.createElement('span');
    s.className = 'st ' + (r.ok ? 'ok' : 'bad');
    s.textContent = (r.ok ? '✓ ' : '✕ ') + (r.message || (r.ok ? 'done' : 'failed'));
    li.appendChild(s);
  }

  if (!dry) {
    logHistory(results);
    const good = results.filter((r) => r.ok && !r.dry).length;
    const opened = results.filter((r) => r.openedTab).length;
    const min = Number($('#minDiscount').value) || 0;

    if (info && info.site !== 'generic' && good > 0 && opened === 0 && $('#autoCheckout').checked && min >= 100) {
      const job = info.site === 'steam' ? 'steam-autocheckout' : 'epic-autocheckout';
      try {
        await chrome.runtime.sendMessage({ cmd: 'FGH_SET_JOB', tabId: tab.id, job });
      } catch {}
      await sendTab({ cmd: 'FGH_GOTO_CART' });
      setStatus('Cart opened — placing the free order…');
      return;
    }
    if (opened > 0) {
      setStatus(
        `${opened} game page(s) opened in background tabs — they claim themselves. Afterwards press Checkout here.`
      );
      return;
    }
    if (min < 100) {
      setStatus(
        dry
          ? 'Dry run done — nothing was clicked.'
          : `Done: ${good}/${results.length} in cart. Discounted games are paid — open the cart and check out yourself.`
      );
      return;
    }
    setStatus(dry ? 'Dry run done — nothing was clicked.' : `Done: ${good}/${results.length} added.`);
  } else {
    setStatus('Dry run done — nothing was clicked.');
  }
}

async function goCart() {
  const r = await sendTab({ cmd: 'FGH_GOTO_CART' });
  if (!r || !r.ok) setStatus((r && r.error) || 'Could not find a cart on this site.', true);
  else setStatus('Opening the cart…');
}

async function checkout() {
  setStatus('Checking out…');
  const r = await sendTab({ cmd: 'FGH_CHECKOUT' });
  if (!r) return setStatus('Scanner not ready — click Scan first.', true);
  setStatus(r.ok ? r.message || 'Checkout clicked — check the tab.' : r.error || 'Checkout failed.', !r.ok);
}

function renderHistory() {
  chrome.storage.local.get(['fghHistory'], (st) => {
    const hist = (st.fghHistory || []).slice(0, 6);
    const sec = document.querySelector('.history');
    sec.hidden = hist.length === 0;
    const list = $('#historyList');
    list.innerHTML = '';
    for (const h of hist) {
      const li = document.createElement('li');
      li.className = h.ok ? 'ok' : 'bad';
      const t = document.createElement('span');
      t.className = 'h-title';
      t.textContent = (h.ok ? '✓ ' : '✕ ') + h.title;
      t.title = h.message || '';
      const d = new Date(h.ts);
      const w = document.createElement('span');
      w.textContent = `${h.site ? h.site + ' ' : ''}${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })}`;
      li.append(t, w);
      list.appendChild(li);
    }
  });
}

function wire() {
  $('#btnScan').addEventListener('click', scan);
  $('#btnAdd').addEventListener('click', addSelected);
  $('#btnCart').addEventListener('click', goCart);
  $('#btnCheckout').addEventListener('click', checkout);
  $('#btnOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());
  $('#linkHelp').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });
  $('#dryRun').addEventListener('change', saveSettings);
  $('#autoCheckout').addEventListener('change', saveSettings);
  $('#minDiscount').addEventListener('input', updateMinLabel);
  $('#minDiscount').addEventListener('change', saveSettings);
  $('#checkAll').addEventListener('change', (e) => {
    document.querySelectorAll('#itemList input[type=checkbox]').forEach((c) => (c.checked = e.target.checked));
    updateAddLabel();
  });
  $('#itemList').addEventListener('change', (e) => {
    if (e.target.matches('input[type=checkbox]')) updateAddLabel();
  });
}

(async () => {
  wire();
  await getSettings();
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  tab = tabs && tabs[0];
  renderHistory();
  const ping = await sendTab({ cmd: 'FGH_PING' });
  if (ping && ping.ok) {
    info = ping;
    $('#siteLine').textContent = `${ping.label} — ${ping.page}`;
  } else {
    $('#siteLine').textContent = /^https?:/i.test((tab && tab.url) || '')
      ? 'Supported site not loaded yet — try Scan'
      : 'Not a web page';
  }
})();
