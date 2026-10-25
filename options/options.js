// Free Game Hunter — options page.
const CFG_KEY = 'fghCustomSites';

const FIELDS = [
  ['name', 'Site name'],
  ['match', 'Hostname matches (regex, e.g. gog\\.com$)'],
  ['itemSelector', 'Game card selector (one card)'],
  ['titleSelector', 'Title selector (optional)'],
  ['priceSelector', 'Price selector (optional)'],
  ['cartSelector', 'Add-to-cart button selector (optional)'],
  ['priceRegex', 'Free-price regex (optional, e.g. ^(free|0([.,]00)?)$)'],
];

const EXAMPLE = {
  name: 'GOG.com (example — adjust to the live page)',
  match: 'gog\\.com$',
  itemSelector: '.product-row',
  titleSelector: '.product-row__title',
  priceSelector: '.product-price__final-amount, .product-price__amount',
  cartSelector: '.product-row__link, .cart-action',
  priceRegex: '^\\s*(free|0([.,]00)?)\\s*$',
  enabled: true,
};

function flash(text, isError) {
  const el = document.querySelector('#msg');
  el.textContent = text || '';
  el.className = isError ? 'error' : 'ok';
  if (text && !isError) setTimeout(() => { if (el.textContent === text) { el.textContent = ''; el.className = ''; } }, 2500);
}

function siteRow(site = {}) {
  const div = document.createElement('div');
  div.className = 'site';

  const top = document.createElement('div');
  top.className = 'row';
  const enLabel = document.createElement('label');
  enLabel.style.flexDirection = 'row';
  enLabel.style.alignItems = 'center';
  const en = document.createElement('input');
  en.type = 'checkbox';
  en.className = 'en';
  en.checked = site.enabled !== false;
  enLabel.append(en, document.createTextNode(' Enabled'));
  const del = document.createElement('button');
  del.className = 'del';
  del.type = 'button';
  del.textContent = 'Remove';
  del.addEventListener('click', () => div.remove());
  top.append(enLabel, del);
  div.appendChild(top);

  const grid = document.createElement('div');
  grid.className = 'row';
  for (const [key, label] of FIELDS) {
    const l = document.createElement('label');
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.dataset.k = key;
    input.value = site[key] || '';
    l.append(span, input);
    grid.appendChild(l);
  }
  div.appendChild(grid);
  return div;
}

function addSite(site) {
  document.querySelector('#sites').appendChild(siteRow(site));
}

function validSelector(sel) {
  if (!sel) return true;
  try {
    document.createDocumentFragment().querySelector(sel);
    return true;
  } catch {
    return false;
  }
}

function collect() {
  const sites = [];
  document.querySelectorAll('#sites > .site').forEach((row) => {
    const s = { enabled: row.querySelector('.en').checked };
    for (const [key] of FIELDS) {
      s[key] = row.querySelector(`[data-k="${key}"]`).value.trim();
    }
    if (s.match || s.itemSelector) sites.push(s);
  });
  return sites;
}

async function load() {
  const st = await chrome.storage.sync.get(['autoCheckout', 'dryRun', CFG_KEY]);
  document.querySelector('#autoCheckout').checked = !!st.autoCheckout;
  document.querySelector('#dryRun').checked = !!st.dryRun;
  (st[CFG_KEY] || []).forEach((s) => addSite(s));
  if (!(st[CFG_KEY] || []).length) addSite({});
}

async function save() {
  const sites = collect();
  for (const s of sites) {
    for (const key of ['itemSelector', 'titleSelector', 'priceSelector', 'cartSelector']) {
      if (!validSelector(s[key])) return flash(`Invalid selector in "${s.name || s.match}": ${s[key]}`, true);
    }
    if (s.match) {
      try { new RegExp(s.match); } catch { return flash(`Invalid hostname regex in "${s.name}": ${s.match}`, true); }
    }
    if (s.priceRegex) {
      try { new RegExp(s.priceRegex); } catch { return flash(`Invalid price regex in "${s.name}": ${s.priceRegex}`, true); }
    }
  }
  await chrome.storage.sync.set({
    autoCheckout: document.querySelector('#autoCheckout').checked,
    dryRun: document.querySelector('#dryRun').checked,
    [CFG_KEY]: sites,
  });
  flash('Saved ✓');
}

function exportJson() {
  const data = {
    settings: {
      autoCheckout: document.querySelector('#autoCheckout').checked,
      dryRun: document.querySelector('#dryRun').checked,
    },
    sites: collect(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'free-game-hunter-settings.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const data = JSON.parse(String(reader.result));
      document.querySelector('#autoCheckout').checked = !!(data.settings && data.settings.autoCheckout);
      document.querySelector('#dryRun').checked = !!(data.settings && data.settings.dryRun);
      document.querySelector('#sites').innerHTML = '';
      (data.sites || []).forEach((s) => addSite(s));
      await save();
    } catch (e) {
      flash('Import failed: ' + e, true);
    }
  };
  reader.readAsText(file);
}

function wire() {
  document.querySelector('#btnAddSite').addEventListener('click', () => addSite({}));
  document.querySelector('#btnExample').addEventListener('click', () => addSite({ ...EXAMPLE }));
  document.querySelector('#btnSave').addEventListener('click', save);
  document.querySelector('#btnExport').addEventListener('click', exportJson);
  document.querySelector('#btnImport').addEventListener('click', () => document.querySelector('#fileImport').click());
  document.querySelector('#fileImport').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) importJson(e.target.files[0]);
  });
}

wire();
load();
