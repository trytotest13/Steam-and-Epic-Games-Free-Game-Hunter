// Free Game Hunter — MV3 service worker.
// Small message hub: badge updates, notifications, history log and
// per-tab "jobs" (auto claim / auto checkout) passed to content scripts.

const JOB_PREFIX = 'fgh_job_';

chrome.runtime.onInstalled.addListener(async () => {
  const defaults = { autoCheckout: false, dryRun: false, minDiscount: 100, fghCustomSites: [] };
  chrome.storage.sync.get(Object.keys(defaults), (cur) => {
    chrome.storage.sync.set({ ...defaults, ...cur });
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.cmd !== 'string' || !msg.cmd.startsWith('FGH_')) return false;

  (async () => {
    try {
      switch (msg.cmd) {
        case 'FGH_BG': {
          const { type } = msg;
          if (type === 'freeCount') {
            const tabId = sender.tab && sender.tab.id;
            if (tabId != null) {
              chrome.action.setBadgeBackgroundColor({ tabId, color: '#2ea043' });
              chrome.action.setBadgeText({ tabId, text: msg.count ? String(msg.count) : '' });
            }
            sendResponse({ ok: true });
          } else if (type === 'notify') {
            chrome.notifications.create({
              type: 'basic',
              iconUrl: 'icons/icon128.png',
              title: msg.title || 'Free Game Hunter',
              message: msg.message || '',
            });
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: 'unknown-bg-type' });
          }
          break;
        }

        case 'FGH_SET_JOB': {
          const tabId = msg.tabId != null ? msg.tabId : (sender.tab && sender.tab.id);
          if (tabId == null) return sendResponse({ ok: false, error: 'no-tab' });
          await chrome.storage.session.set({ [JOB_PREFIX + tabId]: msg.job });
          sendResponse({ ok: true });
          break;
        }

        case 'FGH_TAKE_JOB': {
          const tabId = (sender.tab && sender.tab.id) ?? msg.tabId;
          if (tabId == null) return sendResponse({ ok: false, error: 'no-tab' });
          const key = JOB_PREFIX + tabId;
          const st = await chrome.storage.session.get(key);
          const job = st[key] || null;
          if (job) await chrome.storage.session.remove(key);
          sendResponse({ ok: true, job });
          break;
        }

        case 'FGH_OPEN_TAB': {
          const tab = await chrome.tabs.create({ url: msg.url, active: false });
          await chrome.storage.session.set({ [JOB_PREFIX + tab.id]: msg.job || null });
          sendResponse({ ok: true, tabId: tab.id });
          break;
        }

        case 'FGH_CLOSE_TAB': {
          if (sender.tab && sender.tab.id != null) chrome.tabs.remove(sender.tab.id);
          sendResponse({ ok: true });
          break;
        }

        default:
          sendResponse({ ok: false, error: 'unknown-cmd' });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
  })();

  return true; // async sendResponse
});
