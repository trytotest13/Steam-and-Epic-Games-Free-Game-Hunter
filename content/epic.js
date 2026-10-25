// Free Game Hunter — Epic Games Store adapter (store.epicgames.com).
// Epic is a React SPA, so detection is text-based ("Free", "$0.00", "Get")
// instead of relying on class names that change often.
(() => {
  const FGH = window.__FGH__;
  if (!FGH || window.__FGH_EPIC__) return;
  window.__FGH_EPIC__ = true;

  const GET_RE = /^\s*(get|get it now|claim|buy now|add to cart|add to basket)\b/i;
  const INCART_RE = /^\s*(in cart|view in cart|in your cart|added)\b/i;
  const CHECKOUT_RE = /^\s*check\s*out\b/i;
  const PLACE_RE = /^\s*place\s*order\b/i;

  // Strict whitelist for what counts as a free price on Epic: tiles say
  // "Free Now", the PDP price is "$0.00" / "Free". Banners like
  // "Free Giveaway" (upcoming game) must not match. Includes the free-price
  // words Epic's other storefront languages use.
  const FREE_PRICE_RE =
    /^(free|free!|free now|free game|free to keep|free to play|100% off|-100%|us\$?0\.00|\$0\.00|0,00(\s?€)?|0\.00(\s?\$)?|grátis|grátis agora|gratuito|gratuit|gratuit maintenant|kostenlos|jetzt kostenlos|бесплатно|免费|限時免費|限时免费|無料|무료|이제 무료)$/i;

  const localePrefix = () => {
    const m = location.pathname.match(/^\/([a-z]{2}(?:-[a-z]{2})?)(\/|$)/i);
    return m ? '/' + m[1] : '';
  };
  const cartUrl = () => location.origin + localePrefix() + '/cart';
  const isCartPage = () => /\/cart/i.test(location.pathname);
  const isCartish = () => /\/cart|\/purchase|\/checkout/i.test(location.pathname);
  const isLoginPage = () => /\/login/i.test(location.href);

  const btns = (root = document) =>
    Array.from(root.querySelectorAll('button, a, [role="button"]')).filter(FGH.isVisible);

  const cleanTitle = (t) => {
    const s = String(t || '').trim();
    // Carousel tiles have aria-labels like
    // "Top Free to Play, 1 of 38, Base Game, Fortnite, Free"
    const m = /\bBase Game,\s*(.+?),\s*Free\b/i.exec(s);
    if (m && m[1]) return m[1].trim();
    return s;
  };

  const titleOf = (container) => {
    let out = 'Unknown';
    const h = container.querySelector && container.querySelector('h1,h2,h3,h4,h5,h6');
    if (h && FGH.text(h)) out = FGH.text(h);
    else if (container.getAttribute) {
      const aria = container.getAttribute('aria-label');
      if (aria) out = aria;
    }
    if (out === 'Unknown' && container.querySelector) {
      const img = container.querySelector('img[alt]');
      if (img && img.alt) out = img.alt;
    }
    if (out === 'Unknown') out = (document.title.split('|')[0] || '').trim();
    return cleanTitle(out) || 'Unknown';
  };

  // min = minimum discount %% to include (100 = free games only, the default).
  function collect(min) {
    if (typeof min !== 'number' || isNaN(min)) min = 100;
    const map = new Map();
    const seenContainers = new Set();

    for (const leaf of Array.from(document.querySelectorAll('div, span, p, h1, h2, h3, h4, h5, h6'))) {
      if (!FGH.isVisible(leaf)) continue;
      const own = FGH.ownText(leaf);
      if (!own) continue;
      const pctNum = FGH.parseDiscountText(own);
      const isFreeLeaf = FREE_PRICE_RE.test(own.trim());
      if (!isFreeLeaf && !(pctNum != null && pctNum >= min)) continue;

      // Climb to the nearest sensible container: stop at the first link
      // ancestor, at the smallest ancestor holding exactly one "Get" button,
      // or at the smallest ancestor holding exactly one game link (homepage
      // carousels place the link on a sibling branch of the price block).
      let container = null;
      let button = null;
      let cur = leaf;
      while (cur && cur !== document.body) {
        if (cur.nodeType === 1 && cur.tagName === 'A' && cur.href) {
          container = cur;
          button = null;
          break;
        }
        const gets = btns(cur).filter((x) => GET_RE.test(FGH.text(x)));
        if (gets.length === 1) {
          container = cur;
          button = gets[0];
          break;
        }
        if (gets.length > 1) break; // shared ancestor of several cards — ambiguous
        const gameLinks = Array.from(cur.querySelectorAll('a[href*="/p/"]')).filter(FGH.isVisible);
        if (gameLinks.length === 1) {
          container = cur;
          button = null;
          break;
        }
        if (gameLinks.length > 1) break; // left the card — ambiguous
        cur = cur.parentElement;
      }
      if (!container || seenContainers.has(container)) continue;
      seenContainers.add(container);

      const inCart = button ? INCART_RE.test(FGH.text(button)) : false;
      const title = titleOf(container);

      // Store page URL for the "open this game" button in the popup.
      let pageUrl = null;
      if (container.tagName === 'A' && container.href) pageUrl = container.href;
      else if (button) pageUrl = location.href.split('?')[0];
      else if (container.querySelector) {
        const a = container.querySelector('a[href]');
        if (a) pageUrl = a.href;
      }

      let price;
      if (isFreeLeaf) {
        price = 'Free';
      } else {
        // Discounted item: show "old price → sale price (-N%)" when available.
        const prices = FGH.priceTextsIn(container);
        const finalP = (prices.find((p) => !p.struck) || {}).text;
        const origP = (prices.find((p) => p.struck) || {}).text;
        price = ((origP ? origP + ' → ' : '') + (finalP || '') + (pctNum != null ? ` (-${pctNum}%)` : '')).trim() || `-${pctNum}%`;
      }
      map.set(title.toLowerCase(), {
        el: container,
        btn: button,
        title,
        price,
        discount: isFreeLeaf ? 100 : pctNum,
        inCart,
        url: pageUrl,
        // "Free Now" tiles are this week's giveaways: claimable via their
        // game page even without a Get button in the tile.
        giveaway: isFreeLeaf && /free\s*now/i.test(own),
      });
    }

    // PDP fallback: page has a free price somewhere and one "Get" button.
    if (!map.size) {
      const hasFree = Array.from(document.querySelectorAll('div, span, p')).some(
        (e) => FGH.isVisible(e) && FREE_PRICE_RE.test(FGH.ownText(e).trim())
      );
      if (hasFree) {
        const b = btns().find((x) => GET_RE.test(FGH.text(x)));
        if (b) {
          const title = (document.title.split('|')[0] || 'Unknown').trim();
          map.set(title.toLowerCase(), {
            el: b,
            btn: b,
            title,
            price: 'Free',
            discount: 100,
            inCart: false,
            url: location.href.split('?')[0],
          });
        }
      }
    }

    return Array.from(map.values());
  }

  const idOf = (it) => 'ep_' + FGH.hash(it.title + '|' + it.price);

  async function addItems(ids, dryRun) {
    const items = collect();
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
      if (it.inCart) {
        results.push({ id, title: it.title, ok: true, message: 'Already in cart' });
        continue;
      }
      if (!it.btn) {
        // Listing tile without a Get button: open the game page in a background
        // tab and let the auto-get job claim it there.
        const href = it.el.tagName === 'A' && it.el.href ? it.el.href : null;
        if (href) {
          const res = await FGH.send({ cmd: 'FGH_OPEN_TAB', url: href, job: 'epic-autoget' });
          results.push({
            id,
            title: it.title,
            ok: !!res,
            openedTab: !!res,
            message: res ? 'Opened game page in a new tab to claim it' : 'Could not open tab',
          });
        } else {
          results.push({ id, title: it.title, ok: false, message: 'No Get button found — open the game page' });
        }
        continue;
      }
      try {
        FGH.clickEl(it.btn);
        results.push({ id, title: it.title, ok: true, message: 'Clicked Get — added to cart' });
        await FGH.sleep(900);
      } catch (e) {
        results.push({ id, title: it.title, ok: false, message: 'Click failed: ' + e });
      }
    }
    return { ok: true, results };
  }

  async function runAutoGet() {
    await FGH.sleep(2500);
    if (isLoginPage()) {
      FGH.notify('Epic: log in first, then try the scan again.');
      return;
    }
    // Background claiming is for free giveaways only — never auto-click
    // "Buy Now" on a paid game.
    const hasFree = Array.from(document.querySelectorAll('div, span, p')).some(
      (e) => FGH.isVisible(e) && FREE_PRICE_RE.test(FGH.ownText(e).trim())
    );
    if (!hasFree) {
      FGH.notify('Epic: the opened page is not a free game — skipped. Claim discounted games from their page.');
      await FGH.sleep(1200);
      await FGH.send({ cmd: 'FGH_CLOSE_TAB' });
      return;
    }
    const b = await FGH.waitFor(() => btns().find((x) => GET_RE.test(FGH.text(x))), 15000);
    if (!b) {
      FGH.notify('Epic: no Get button found on the opened page.');
      await FGH.sleep(1200);
      await FGH.send({ cmd: 'FGH_CLOSE_TAB' });
      return;
    }
    FGH.clickEl(b);
    await FGH.sleep(2000);
    const t = (document.title.split('|')[0] || 'Game').trim();
    FGH.notify('Epic: claimed "' + t + '" — it is in your cart.');
    await FGH.sleep(1500);
    await FGH.send({ cmd: 'FGH_CLOSE_TAB' });
  }

  async function checkoutFlow() {
    if (isLoginPage()) return { ok: false, error: 'Log in to Epic first' };
    const audit = FGH.cartPriceAudit();
    if (audit.paid && audit.paid.length) {
      FGH.notify('Epic: your cart has paid items (' + audit.paid.join(', ') + ') — auto-checkout skipped for safety.');
      return { ok: false, error: 'Cart contains paid items — skipped for safety' };
    }

    // Cart page → press "Check Out"
    if (isCartPage()) {
      const co = await FGH.waitFor(() => FGH.findClickableByText(CHECKOUT_RE), 8000);
      if (!co) return { ok: false, error: 'Check Out button not found' };
      FGH.clickEl(co);
      const moved = await FGH.waitFor(() => (/\/purchase|\/checkout/i.test(location.pathname) ? true : null), 15000);
      if (!moved) return { ok: false, error: 'Checkout page did not open — finish manually' };
    }

    // Purchase page → accept agreements, place order
    const accept = FGH.findClickableByText(/^\s*(accept|agree)\s*$/i);
    if (accept) {
      try {
        FGH.clickEl(accept);
        await FGH.sleep(800);
      } catch {}
    }
    const place = await FGH.waitFor(() => FGH.findClickableByText(PLACE_RE), 20000);
    if (!place) {
      FGH.notify('Epic: "Place Order" not found — finish checkout manually.');
      return { ok: false, error: 'Place Order not found' };
    }
    document.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      if (cb.checked) return;
      const label = cb.closest('label') || cb.parentElement;
      if (label && /agree|accept|terms|eula|refun/i.test(FGH.text(label) || '')) {
        try { cb.click(); } catch {}
      }
    });
    await FGH.sleep(600);
    FGH.clickEl(place);
    await FGH.sleep(3000);
    const captcha = document.querySelector('iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i]');
    if (captcha) {
      FGH.notify('Epic: complete the captcha in the tab to finish.');
      return { ok: true, needsManual: true, message: 'Place Order clicked — captcha needs you' };
    }
    FGH.notify('Epic: order placed — check the tab for the confirmation.');
    return { ok: true, message: 'Place Order clicked' };
  }

  // Jobs handed over by the popup / background (per-tab).
  (async () => {
    const res = await FGH.send({ cmd: 'FGH_TAKE_JOB' });
    const job = res && res.job;
    if (job === 'epic-autoget') runAutoGet();
    else if (job === 'epic-autocheckout' && isCartish()) checkoutFlow().catch(() => {});
  })();

  FGH.registerSite({
    name: 'epic',
    label: () => 'Epic Games Store',
    pageType: () => {
      if (/\/purchase|\/checkout/i.test(location.pathname)) return 'checkout';
      if (isCartPage()) return 'cart';
      if (/\/free-games/i.test(location.pathname)) return 'free games';
      return 'store';
    },
    scan: async (minArg) => {
      const min = await FGH.resolveMinDiscount(minArg);
      return collect(min).map((it) => ({
        id: idOf(it),
        title: it.title,
        price: it.price,
        discount: it.discount == null ? null : it.discount,
        claimable: !!(it.btn || it.giveaway),
        url: it.url || null,
      }));
    },
    addItems,
    gotoCart: async () => {
      await FGH.sleep(50);
      location.assign(cartUrl());
      return { ok: true };
    },
    checkout: async () => {
      if (!isCartish()) return { ok: false, error: 'Open the Epic cart first (use "Go to cart")' };
      return checkoutFlow();
    },
  });

  FGH.updateBadgeLater(2000);
})();
