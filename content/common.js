// Free Game Hunter — shared helpers + command router (content scripts).
(() => {
  if (window.__FGH_COMMON__) return;
  window.__FGH_COMMON__ = true;

  const FGH = (window.__FGH__ = window.__FGH__ || {});

  FGH.sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Text of the element's own direct text nodes only (ignores children).
  FGH.ownText = (el) =>
    Array.from(el.childNodes || [])
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

  FGH.text = (el) =>
    !el ? '' : String(el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();

  FGH.isVisible = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const r = el.getBoundingClientRect();
    if (!el.getClientRects().length && !(r && r.width && r.height)) return false;
    const st = getComputedStyle(el);
    return st.display !== 'none' && st.visibility !== 'hidden';
  };

  // Recognises "Free", "Free To Play", "-100%", "$0.00", "0,00 €", "US$0.00", etc.
  FGH.isFreePriceText = (text) => {
    if (!text) return false;
    const t = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
    if (!t || t.length > 40) return false;
    if (/^-?100\s*%$/.test(t)) return true;
    if (t === 'free to play') return true;
    // Reject commerce/banner phrases that merely start with "free".
    if (/\b(shipping|delivery|giveaway|trial|sample|returns|tracking|storage|parking|wifi|update|play days|weekend)\b/.test(t)) return false;
    if (/(^|[\s!])(free|gratis|grátis|gratuito|gratuit|kostenlos|бесплатно|免费|無料|무료)([\s!]|$)/.test(t)) return true;
    if (/^[a-z]{0,2}\s*[$€£₹]?\s*0([.,]00)?\s*[$€£₹]?$/.test(t)) return true;
    return false;
  };

  // "-50%", "50% off", "-90 %" → 50 (number 1-100), else null.
  FGH.parseDiscountText = (text) => {
    if (!text) return null;
    const t = String(text).replace(/\s+/g, ' ').trim().toLowerCase();
    const m = /^-?(\d{1,3})\s*%$/.exec(t) || /^-?(\d{1,3})\s*%\s*off$/.exec(t);
    if (!m) return null;
    const n = parseInt(m[1], 10);
    return n >= 1 && n <= 100 ? n : null;
  };

  FGH.isLineThrough = (el) => {
    try {
      return /line-through/.test(getComputedStyle(el).textDecorationLine || '');
    } catch {
      return false;
    }
  };

  // Price texts inside a container: [{ text, struck }] — struck = old price.
  FGH.priceTextsIn = (container, limit = 80) => {
    const out = [];
    for (const el of container.querySelectorAll('*')) {
      if (out.length >= limit) break;
      const t = FGH.ownText(el);
      if (!t || t.length > 20) continue;
      if (/[$€£₹]\s*\d|^\d+([.,]\d{1,2})?\s*[$€£₹]/.test(t)) {
        out.push({ text: t, struck: FGH.isLineThrough(el) });
      }
    }
    return out;
  };

  // Minimum discount the popup asked for; falls back to the stored setting
  // (default 100 = free games only).
  FGH.resolveMinDiscount = async (min) => {
    if (typeof min === 'number' && min >= 0 && min <= 100) return min;
    try {
      const st = await chrome.storage.sync.get('minDiscount');
      if (typeof st.minDiscount === 'number') return st.minDiscount;
    } catch {}
    return 100;
  };

  FGH.clickEl = (el) => {
    try { el.scrollIntoView({ block: 'center' }); } catch {}
    const opts = { bubbles: true, cancelable: true, view: window };
    try {
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      el.dispatchEvent(new MouseEvent('mouseup', opts));
    } catch {}
    el.click();
  };

  FGH.flash = (el) => {
    if (!el || !el.style) return;
    try {
      el.style.outline = '3px solid #37c24a';
      el.style.outlineOffset = '2px';
      setTimeout(() => {
        el.style.outline = '';
        el.style.outlineOffset = '';
      }, 1800);
    } catch {}
  };

  FGH.waitFor = async (fn, timeout = 8000, step = 250) => {
    const end = Date.now() + timeout;
    for (;;) {
      let v = null;
      try { v = fn(); } catch {}
      const ok = Array.isArray(v) ? v.length > 0 : v != null && v !== false;
      if (ok) return v;
      if (Date.now() > end) return null;
      await FGH.sleep(step);
    }
  };

  FGH.hash = (s) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  };

  FGH.findClickableByText = (re, root = document) => {
    const els = root.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]');
    for (const el of els) {
      if (!FGH.isVisible(el)) continue;
      const t = FGH.text(el) || el.value || '';
      if (re.test(t)) return el;
    }
    return null;
  };

  FGH.send = (msg) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError) resolve(null);
          else resolve(res);
        });
      } catch {
        resolve(null);
      }
    });

  FGH.notify = (message, title = 'Free Game Hunter') =>
    FGH.send({ cmd: 'FGH_BG', type: 'notify', title, message });

  // Safety audit for cart pages: looks for any visible non-free price on the page.
  // Struck-through original prices ("was $19.99") are ignored.
  FGH.cartPriceAudit = () => {
    const els = Array.from(document.querySelectorAll('[class*="price" i]')).filter(
      (e) =>
        FGH.isVisible(e) &&
        !(typeof e.className === 'string' && /original|was-?price|strik/i.test(e.className))
    );
    const texts = Array.from(new Set(els.map((e) => FGH.text(e)).filter((t) => t && t.length <= 30)));
    const paid = texts.filter((t) => {
      if (FGH.isFreePriceText(t) || /free/i.test(t)) return false;
      if (/%\s*$/.test(t)) return false; // discount tags like -50%
      const s = t.replace(/\s/g, '');
      const m = s.match(/(\d+(?:[.,]\d{3})*)(?:[.,](\d{2}))?/);
      if (!m) return false;
      const cents = m[2] || '0';
      return parseFloat(m[1].replace(/[.,]/g, '') + '.' + cents) > 0;
    });
    return { paid, unknown: texts.length === 0 };
  };

  // ---- adapter registry + command router (popup <-> content) ----
  let adapter = null;
  FGH.registerSite = (a) => {
    adapter = a;
    window.__FGH_SITE__ = a;
  };

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.cmd !== 'string' || msg.cmd.indexOf('FGH_') !== 0) return false;
    if (!adapter) {
      sendResponse({ ok: false, error: 'not-ready' });
      return true;
    }
    (async () => {
      try {
        switch (msg.cmd) {
          case 'FGH_PING':
            sendResponse({ ok: true, site: adapter.name, label: adapter.label(), page: adapter.pageType() });
            break;
          case 'FGH_SCAN': {
            const items = await adapter.scan(msg.minDiscount);
            sendResponse({ ok: true, site: adapter.name, label: adapter.label(), page: adapter.pageType(), items });
            break;
          }
          case 'FGH_ADD':
            sendResponse(await adapter.addItems(msg.ids || [], !!msg.dryRun));
            break;
          case 'FGH_GOTO_CART':
            sendResponse(await adapter.gotoCart());
            break;
          case 'FGH_CHECKOUT':
            sendResponse(await adapter.checkout());
            break;
          default:
            sendResponse({ ok: false, error: 'unknown-cmd' });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true; // async response
  });

  // Light scan after page load so the toolbar badge shows how many free items
  // are on the current page.
  FGH.updateBadgeLater = (delay) => {
    setTimeout(async () => {
      try {
        if (!adapter) return;
        const items = await adapter.scan();
        FGH.send({ cmd: 'FGH_BG', type: 'freeCount', count: items.length });
      } catch {}
    }, delay || 1200);
  };
})();
