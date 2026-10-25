// Free Game Hunter — generic / custom-site adapter.
// Injected on demand by the popup on any http(s) site the user is browsing.
// If the site has a user-defined rule (options page) it is used first,
// otherwise built-in heuristics look for free prices next to cart buttons.
(() => {
  const FGH = window.__FGH__;
  if (!FGH) return; // common.js must be injected first
  if (window.__FGH_SITE__) return; // a dedicated adapter already owns this page
  window.__FGH_GENERIC__ = true;

  const CFG_KEY = 'fghCustomSites';
  const BTN_RE = /(add\s*to\s*(cart|basket|bag)|^buy(\s*now)?$|^get$|claim|^purchase$|^add$)/i;

  const safeRegex = (s) => {
    try {
      return new RegExp(s, 'i');
    } catch {
      return null;
    }
  };

  async function currentConfig() {
    try {
      const st = await chrome.storage.sync.get(CFG_KEY);
      const list = st[CFG_KEY] || [];
      for (const c of list) {
        if (!c || c.enabled === false || !c.match) continue;
        const re = safeRegex(c.match);
        if (re && re.test(location.hostname)) return c;
      }
    } catch {}
    return null;
  }

  function collectFromConfig(cfg) {
    const items = [];
    if (!cfg || !cfg.itemSelector) return items;
    const priceRe = cfg.priceRegex ? safeRegex(cfg.priceRegex) : null;
    let els = [];
    try {
      els = Array.from(document.querySelectorAll(cfg.itemSelector));
    } catch {
      return items;
    }
    for (const el of els) {
      let free = false;
      let priceText = 'Free';
      if (cfg.priceSelector) {
        let p = null;
        try { p = el.querySelector(cfg.priceSelector); } catch {}
        priceText = FGH.text(p);
        free = priceRe ? priceRe.test(priceText) : FGH.isFreePriceText(priceText);
      } else {
        free = priceRe ? priceRe.test(FGH.text(el)) : /\bfree\b|0[.,]00/i.test(FGH.text(el));
      }
      if (!free) continue;
      let title = 'Unknown';
      if (cfg.titleSelector) {
        try { title = FGH.text(el.querySelector(cfg.titleSelector)) || 'Unknown'; } catch {}
      }
      if (title === 'Unknown') title = (document.title.split('|')[0] || 'Unknown').trim();
      let btn = null;
      if (cfg.cartSelector) {
        try { btn = el.querySelector(cfg.cartSelector); } catch {}
      }
      if (!btn) {
        btn = Array.from(el.querySelectorAll('button, a, [role="button"]')).find((b) => BTN_RE.test(FGH.text(b)));
      }
      const a = el.querySelector('a[href]');
      items.push({ el, btn, isLink: false, title, price: priceText || 'Free', url: (a && a.href) || null });
    }
    return items;
  }

  // min = minimum discount %% to include (100 = free games only, the default).
  function collectHeuristic(min) {
    if (typeof min !== 'number' || isNaN(min)) min = 100;
    const map = new Map();
    for (const leaf of Array.from(document.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6'))) {
      if (!FGH.isVisible(leaf)) continue;
      const own = FGH.ownText(leaf);
      if (!own) continue;
      const pctNum = FGH.parseDiscountText(own);
      const isFreeLeaf = FGH.isFreePriceText(own);
      if (!isFreeLeaf && !(pctNum != null && pctNum >= min)) continue;

      let container = null;
      let button = null;
      let cur = leaf;
      while (cur && cur !== document.body) {
        if (cur.nodeType === 1 && cur.tagName === 'A' && cur.href) {
          container = cur;
          button = null;
          break;
        }
        const candidates = Array.from(cur.querySelectorAll('button, a, [role="button"]')).filter(
          (x) => FGH.isVisible(x) && BTN_RE.test(FGH.text(x))
        );
        if (candidates.length === 1) {
          container = cur;
          button = candidates[0];
          break;
        }
        if (candidates.length > 1) break; // ambiguous shared ancestor
        // Card whose item link sits on a sibling branch: adopt this level when
        // it holds exactly one real link.
        const links = Array.from(cur.querySelectorAll('a[href]')).filter(
          (x) =>
            FGH.isVisible(x) &&
            !/^(#|javascript:)/i.test(x.getAttribute('href') || '')
        );
        if (links.length === 1) {
          container = cur;
          button = null;
          break;
        }
        if (links.length > 1) break; // left the card — ambiguous
        cur = cur.parentElement;
      }
      if (!container) continue;

      // Store page URL for the popup's per-row "open" button.
      let pageUrl = null;
      if (container.tagName === 'A' && container.href) pageUrl = container.href;
      else if (container.querySelector) {
        const a = container.querySelector('a[href]');
        if (a) pageUrl = a.href;
      }

      const h = container.querySelector('h1,h2,h3,h4,h5,h6,[aria-label]');
      const img = container.querySelector('img[alt]');
      const title =
        FGH.text(container.querySelector('h1,h2,h3,h4,h5,h6')) ||
        container.getAttribute('title') ||
        (h && h.getAttribute && h.getAttribute('aria-label')) ||
        (img && img.alt) ||
        (document.title.split('|')[0] || 'Unknown').trim();

      let price;
      if (isFreeLeaf) {
        price = 'Free';
      } else {
        const prices = FGH.priceTextsIn(container);
        const finalP = (prices.find((p) => !p.struck) || {}).text;
        const origP = (prices.find((p) => p.struck) || {}).text;
        price = ((origP ? origP + ' → ' : '') + (finalP || '') + (pctNum != null ? ` (-${pctNum}%)` : '')).trim() || `-${pctNum}%`;
      }

      const key = (title + '|' + price).toLowerCase();
      if (!map.has(key)) {
        map.set(key, {
          el: container,
          btn: button,
          isLink: !button,
          title,
          price,
          discount: isFreeLeaf ? 100 : pctNum,
          url: pageUrl,
        });
      }
    }
    return Array.from(map.values());
  }

  async function collect(min) {
    const cfg = await currentConfig();
    let items = collectFromConfig(cfg);
    if (!items.length) items = collectHeuristic(min);
    return items;
  }

  const idOf = (it) => 'gn_' + FGH.hash(it.title + '|' + it.price);

  async function addItems(ids, dryRun) {
    const items = await collect(0); // no filter: every item must be findable by id
    const byId = new Map(items.map((it) => [idOf(it), it]));
    const results = [];
    for (const id of ids) {
      const it = byId.get(id);
      if (!it) {
        results.push({ id, ok: false, message: 'Item disappeared — rescan' });
        continue;
      }
      if (dryRun) {
        FGH.flash(it.btn || it.el);
        results.push({ id, title: it.title, ok: true, dry: true, message: 'Dry run: highlighted only' });
        continue;
      }
      if (!it.btn) {
        const href = it.el.tagName === 'A' && it.el.href ? it.el.href : null;
        if (href) {
          const res = await FGH.send({ cmd: 'FGH_OPEN_TAB', url: href, job: 'generic-autoadd' });
          results.push({
            id,
            title: it.title,
            ok: !!res,
            openedTab: !!res,
            message: res ? 'Opened item page in a new tab to claim it' : 'Could not open tab',
          });
        } else {
          results.push({ id, title: it.title, ok: false, message: 'No add-to-cart button found' });
        }
        continue;
      }
      try {
        FGH.clickEl(it.btn);
        results.push({ id, title: it.title, ok: true, message: 'Clicked the add button' });
        await FGH.sleep(500);
      } catch (e) {
        results.push({ id, title: it.title, ok: false, message: 'Click failed: ' + e });
      }
    }
    return { ok: true, results };
  }

  async function runAutoAdd() {
    await FGH.sleep(2000);
    const min = await FGH.resolveMinDiscount();
    const items = (await collect(min)).filter((it) => it.btn);
    if (!items.length) {
      FGH.notify('Free Game Hunter: no claimable free item on the opened page.');
    } else {
      try {
        FGH.clickEl(items[0].btn);
        FGH.notify('Free Game Hunter: claimed "' + items[0].title + '" in the background tab.');
      } catch {}
    }
    await FGH.sleep(1500);
    await FGH.send({ cmd: 'FGH_CLOSE_TAB' });
  }

  // Job handed over when a background tab was opened.
  (async () => {
    const res = await FGH.send({ cmd: 'FGH_TAKE_JOB' });
    if (res && res.job === 'generic-autoadd') runAutoAdd();
  })();

  FGH.registerSite({
    name: 'generic',
    label: () => 'This site (beta)',
    pageType: () => 'generic scan',
    scan: async (minArg) => {
      const min = await FGH.resolveMinDiscount(minArg);
      return (await collect(min)).map((it) => ({
        id: idOf(it),
        title: it.title,
        price: it.price,
        discount: it.discount == null ? null : it.discount,
        claimable: !!(it.btn || it.isLink),
        url: it.url || null,
      }));
    },
    addItems,
    gotoCart: async () => {
      const link =
        FGH.findClickableByText(/^\s*(cart|basket|my cart|your cart)\s*$/i) ||
        FGH.findClickableByText(/cart|basket/i);
      if (link) {
        FGH.clickEl(link);
        return { ok: true };
      }
      return { ok: false, error: 'No cart link found on this site' };
    },
    checkout: async () => {
      const btn = FGH.findClickableByText(/check\s*out|place\s*order|^purchase$|pay\s*now/i);
      if (!btn) return { ok: false, error: 'No checkout button found on this page' };
      const audit = FGH.cartPriceAudit();
      if (audit.paid && audit.paid.length) {
        return { ok: false, error: 'Page shows paid prices (' + audit.paid.join(', ') + ') — check the cart manually first' };
      }
      FGH.clickEl(btn);
      return { ok: true, message: 'Clicked the checkout button' };
    },
  });
})();
