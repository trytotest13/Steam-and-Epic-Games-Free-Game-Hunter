// Free Game Hunter — Steam adapter (store.steampowered.com).
(() => {
  const FGH = window.__FGH__;
  if (!FGH || window.__FGH_STEAM__) return;
  window.__FGH_STEAM__ = true;

  const isCartPage = () => /^\/cart/i.test(location.pathname);
  const isCheckoutPage = () => /^\/checkout/i.test(location.pathname);

  const appTitle = () =>
    FGH.text(document.querySelector('#appHubAppName')) ||
    (document.title || '')
      .replace(/\s+on Steam.*$/i, '')
      .replace(/^Save \d+% on /i, '')
      .trim() ||
    'Unknown';

  // Best-effort title extraction for rows, capsules and tabs. Steam hides the
  // name in different spots per layout (.title on search rows, .tab_item_name
  // on hub tabs, alt on image capsules, …), so try all of them before falling
  // back to the row's first visible text line, then to the app slug in the
  // link's URL ("/app/123/Name_Here/" → "Name Here").
  const titleFrom = (el, fallbackUrl) => {
    if (!el) return '';
    const candidates = [
      () => FGH.text(el.querySelector('.title')),
      () => FGH.text(el.querySelector('.tab_item_name')),
      () => FGH.text(el.querySelector('.recommended_name')),
      () => FGH.text(el.querySelector('[data-name]')),
      () => FGH.text(el.querySelector('.wordmark')),
      () => el.getAttribute('title'),
      () => el.getAttribute('aria-label'),
      () => {
        const img = el.querySelector('img');
        if (!img) return '';
        return img.alt || img.getAttribute('aria-label') || '';
      },
    ];
    for (const pick of candidates) {
      const t = pick();
      if (t) return t;
    }
    const slugMatch = String(fallbackUrl || '').match(/\/app\/\d+\/([^/?]+)/);
    if (slugMatch) {
      const slug = decodeURIComponent(slugMatch[1]).replace(/[_\-\.]+/g, ' ').trim();
      if (slug) return slug;
    }
    const first = (el.innerText || '').split('\n').map((s) => s.trim()).find(Boolean);
    return first || '';
  };

  // min = minimum discount %% to include (100 = free games only, the default).
  // deep = also sweep scrolling shelves/lists (moves the page while scanning).
  async function collect(min, deep) {
    if (typeof min !== 'number' || isNaN(min)) min = 100;
    const map = new Map();
    const add = (it) => {
      const key = (it.title + '|' + it.price).toLowerCase();
      if (!map.has(key)) map.set(key, it);
    };
    const describe = (orig, final, pctNum, free) => {
      if (free && pctNum == null) return final || 'Free';
      if (pctNum != null && orig && final) return `${orig} → ${final}`;
      return final || (pctNum != null ? `-${pctNum}%` : 'Free');
    };

    // One sweep over the page's current DOM. Called repeatedly while the page
    // is scrolled so lazy-loaded rows/carousel items all get collected.
    const grab = () => {
      // 1) Search / listing rows ("specials" search, hub lists, …)
      document.querySelectorAll('a.search_result_row').forEach((row) => {
        const priceEl = row.querySelector('.discount_final_price') || row.querySelector('.search_price');
        const pctEl = row.querySelector('.discount_pct');
        const price = FGH.text(priceEl);
        const pct = FGH.text(pctEl);
        const pctNum = FGH.parseDiscountText(pct);
        const free = FGH.isFreePriceText(price) || FGH.isFreePriceText(pct);
        if (!free && !(pctNum != null && pctNum >= min)) return;
        const orig = FGH.text(row.querySelector('.discount_original_price'));
        const title = titleFrom(row, row.href) || 'Unknown';
        add({
          el: row,
          btn: row.querySelector('a.btn_addtocart'),
          title,
          price: describe(orig, price || pct, pctNum, free),
          discount: free && pctNum == null ? 100 : pctNum,
          // Rows have no inline cart button — discounted/-100% rows are claimed
          // by opening the game page in a background tab. "Free To Play" rows
          // have no pct element and are not claimable.
          openable: !!pct.trim(),
          url: row.href || null,
        });
      });

      // 2) Purchase boxes on a game page (the game itself, demos, packages)
      document.querySelectorAll('.game_area_purchase_game').forEach((box) => {
        const priceEl = box.querySelector('.game_purchase_price, .discount_final_price');
        const pctEl = box.querySelector('.discount_pct');
        const price = FGH.text(priceEl);
        const pct = FGH.text(pctEl);
        const pctNum = FGH.parseDiscountText(pct);
        const free = FGH.isFreePriceText(price) || FGH.isFreePriceText(pct);
        if (!free && !(pctNum != null && pctNum >= min)) return;
        const orig = FGH.text(box.querySelector('.discount_original_price'));
        const heading = FGH.text(box.querySelector('h1,h2,h3,h4,.name'));
        const base = appTitle();
        const title = heading && !base.toLowerCase().includes(heading.toLowerCase())
          ? base + ' — ' + heading
          : base;
        const pageUrl = (box.querySelector('a[href*="/app/"]') || {}).href ||
          (/\/app\//.test(location.pathname) ? location.href.split('?')[0] : null);
        add({
          el: box,
          btn: box.querySelector('a.btn_addtocart'),
          title,
          price: describe(orig, price || pct, pctNum, free),
          discount: free && pctNum == null ? 100 : pctNum,
          url: pageUrl,
        });
      });

      // 3) Homepage / hub capsules that link to an app page (often no button here)
      document.querySelectorAll('a[href*="/app/"]').forEach((a) => {
        if (!FGH.isVisible(a)) return;
        const tag = FGH.text(a.querySelector('.discount_pct'));
        const price = FGH.text(a.querySelector('.discount_final_price'));
        const pctNum = FGH.parseDiscountText(tag);
        const free = FGH.isFreePriceText(tag) || FGH.isFreePriceText(price);
        if (!free && !(pctNum != null && pctNum >= min)) return;
        const orig = FGH.text(a.querySelector('.discount_original_price'));
        const title = titleFrom(a, a.href) || 'Unknown';
        add({
          el: a,
          btn: a.querySelector('a.btn_addtocart'),
          title,
          price: describe(orig, price || tag, pctNum, free),
          discount: free && pctNum == null ? 100 : pctNum,
          openable: !!tag.trim(),
          url: a.href || null,
        });
      });
    };

    grab();

    // Deep scan (opt-in): Steam lazy-loads shelves/carousels as you scroll, so
    // sweep horizontal scrollers and the window to collect everything, then
    // restore the original scroll positions. Off by default — it visibly moves
    // the page while scanning.
    if (deep) {
      const hScrollers = Array.from(document.querySelectorAll('div, ul, section')).filter((el) => {
        if (!el.getClientRects().length) return false;
        const st = getComputedStyle(el);
        const ox = st.overflowX;
        const oy = st.overflowY;
        return (ox === 'auto' || ox === 'scroll' || oy === 'auto' || oy === 'scroll') &&
          el.scrollWidth > el.clientWidth + 40;
      }).slice(0, 12);
      for (const el of hScrollers) {
        const startLeft = el.scrollLeft;
        for (let step = 0; step < 10; step++) {
          el.scrollLeft += el.clientWidth;
          await FGH.sleep(50);
          grab();
          if (el.scrollLeft >= el.scrollWidth - el.clientWidth - 4) break;
        }
        el.scrollLeft = startLeft;
      }

      const startY = window.scrollY;
      let prevY = -1;
      for (let pass = 0; pass < 6 && window.scrollY !== prevY; pass++) {
        prevY = window.scrollY;
        window.scrollBy(0, Math.max(300, window.innerHeight * 1.5));
        await FGH.sleep(220);
        grab();
      }
      window.scrollTo(0, startY);
    }

    return Array.from(map.values());
  }

  const idOf = (it) => 'st_' + FGH.hash(it.title + '|' + it.price);

  function findPurchaseButton() {
    const prefer = [
      /^\s*purchase( for myself)?\s*$/i,
      /purchase for myself/i,
      /^\s*check\s*out\s*$/i,
    ];
    for (const re of prefer) {
      const el = FGH.findClickableByText(re);
      if (el) return el;
    }
    const legacy = document.querySelector('#cart_checkout');
    return legacy && FGH.isVisible(legacy) ? legacy : null;
  }

  async function addItems(ids, dryRun) {
    const items = await collect(0); // no filter: every item on the page must be findable by id
    const byId = new Map(items.map((it) => [idOf(it), it]));
    const results = [];
    for (const id of ids) {
      const it = byId.get(id);
      if (!it) {
        results.push({ id, ok: false, message: 'Item disappeared from the page — rescan' });
        continue;
      }
      if (dryRun) {
        FGH.flash(it.btn || it.el);
        results.push({ id, title: it.title, ok: true, dry: true, message: 'Dry run: highlighted only' });
        continue;
      }
      if (!it.btn) {
        // No button here: open the game page in a background tab and let the
        // auto-add job claim it there.
        const link = it.el.tagName === 'A' && it.el.href ? it.el : it.el.querySelector('a[href*="/app/"]');
        if (link && link.href) {
          const res = await FGH.send({ cmd: 'FGH_OPEN_TAB', url: link.href, job: 'steam-autoadd' });
          results.push({
            id,
            title: it.title,
            ok: !!res,
            openedTab: !!res,
            message: res ? 'Opened game page in a new tab to claim it' : 'Could not open tab',
          });
        } else {
          results.push({ id, title: it.title, ok: false, message: 'Free to play — install it from the Steam client' });
        }
        continue;
      }
      try {
        FGH.clickEl(it.btn);
        results.push({ id, title: it.title, ok: true, message: 'Added to cart' });
        await FGH.sleep(650);
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
      FGH.notify('Steam: nothing matching your discount filter on the opened page.');
      await FGH.sleep(1500);
      await FGH.send({ cmd: 'FGH_CLOSE_TAB' });
      return;
    }
    let n = 0;
    for (const it of items) {
      try {
        FGH.clickEl(it.btn);
        n++;
        await FGH.sleep(800);
      } catch {}
    }
    FGH.notify(`Steam: added ${n} item(s) to your cart from a background tab.`);
    await FGH.sleep(1200);
    await FGH.send({ cmd: 'FGH_CLOSE_TAB' });
  }

  async function runAutoCheckout() {
    const audit = FGH.cartPriceAudit();
    if (audit.paid && audit.paid.length) {
      FGH.notify('Steam: your cart has paid items (' + audit.paid.join(', ') + ') — auto-checkout skipped for safety.');
      return { ok: false, error: 'Cart contains paid items — skipped for safety' };
    }
    const btn = await FGH.waitFor(findPurchaseButton, 12000);
    if (!btn) {
      FGH.notify('Steam: could not find the Purchase button — finish checkout manually.');
      return { ok: false, error: 'Purchase button not found' };
    }
    if (audit.unknown) FGH.notify('Steam: could not verify the cart total — check the tab now.');
    FGH.clickEl(btn);
    FGH.notify('Steam: clicked Purchase for the $0 cart — check the tab to confirm.');
    return { ok: true, message: 'Purchase clicked' };
  }

  // Jobs handed over by the popup / background (per-tab).
  (async () => {
    const res = await FGH.send({ cmd: 'FGH_TAKE_JOB' });
    const job = res && res.job;
    if (job === 'steam-autoadd') runAutoAdd();
    else if (job === 'steam-autocheckout' && (isCartPage() || isCheckoutPage())) runAutoCheckout();
  })();

  FGH.registerSite({
    name: 'steam',
    label: () => 'Steam',
    pageType: () => (isCartPage() ? 'cart' : isCheckoutPage() ? 'checkout' : 'store'),
    scan: async (minArg, deep) => {
      const min = await FGH.resolveMinDiscount(minArg);
      return (await collect(min, !!deep)).map((it) => ({
        id: idOf(it),
        title: it.title,
        price: it.price,
        discount: it.discount == null ? null : it.discount,
        claimable: !!(it.btn || it.openable),
        url: it.url || null,
      }));
    },
    addItems,
    gotoCart: async () => {
      await FGH.sleep(50);
      location.assign(location.origin + '/cart/');
      return { ok: true };
    },
    checkout: async () => {
      if (!isCartPage() && !isCheckoutPage()) {
        return { ok: false, error: 'Open the Steam cart first (use "Go to cart")' };
      }
      return runAutoCheckout();
    },
  });

  FGH.updateBadgeLater(1500);
})();
