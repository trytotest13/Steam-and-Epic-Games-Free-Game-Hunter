<div align="center">

# Free Game Hunter: Steam & Epic

**A Chrome extension that finds every free and discounted game on Steam and the Epic Games Store,
adds them to your cart in one click, and can place the $0 order for you.**

![version](https://img.shields.io/badge/version-1.3.3-46c26a)
![manifest](https://img.shields.io/badge/manifest-v3-4285F4)
![CI](https://github.com/trytotest13/Steam-and-Epic-Games-Free-Game-Hunter/actions/workflows/ci.yml/badge.svg)
![license](https://img.shields.io/badge/license-MIT-blue)

[Overview](#overview) · [Screenshots](#screenshots) · [Installation](#installation) · [Usage](#usage) · [How it works](#how-it-works) · [Other stores](#other-stores) · [FAQ](#faq)

</div>

## Overview

Free Game Hunter scans the store page you are on, lists every free or discounted game it finds with
the old and new price, and adds them all to your cart in one click. For games without an inline
button, it opens each game page in a background tab, clicks Add to Cart or Get, and closes the tab.
It can also place the $0 order for free games, so they land in your library. A slider sets the
discount threshold, dry run shows you what would be clicked before anything happens, and custom
rules teach it stores beyond Steam and Epic.

Everything runs locally in your browser. No account data is read and nothing is sent anywhere.

## Screenshots

<div align="center">
<table>
  <tr>
    <td align="center"><img src="docs/screenshots/popup-deals.png" alt="Popup showing discounted Steam deals with -70% / -90% badges, old and new prices, and per-row open buttons" width="300"/><br/><sub>Discount deals with badges, old and new prices, per-row open buttons</sub></td>
    <td align="center"><img src="docs/screenshots/popup-free.png" alt="Popup in free-only mode listing Epic Games Store giveaways with Get buttons pre-checked" width="300"/><br/><sub>Free-only mode, Epic giveaways pre-checked to claim</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/screenshots/options.png" alt="Options page with behavior toggles and a custom site rule for GOG.com" width="460"/><br/><sub>Settings and custom store rules (example: GOG.com)</sub></td>
    <td align="center"><img src="docs/screenshots/demo-store.png" alt="Demo store page with green dry-run highlights on the free and discounted game buttons" width="460"/><br/><sub>Dry run on the bundled demo store: highlights, no clicks</sub></td>
  </tr>
</table>
</div>

## Features

| Feature | Detail |
| --- | --- |
| One-click scan | The toolbar badge shows how many free items the current page has, before you even open the popup |
| Batch add to cart | Free games come pre-checked; one click adds them all, and background tabs handle games without inline buttons |
| Discount slider, 0 to 100% | Any threshold: 20%, 50%, 90%. Results show `-50%`-style badges with the old and sale price |
| Per-row open button | Jump straight to any game's store page to buy it individually |
| Auto-checkout for free games | The cart opens, Purchase or Place Order gets clicked, and only carts that audit as $0 qualify |
| Dry run | Highlights what would be clicked, on any site, before allowing a single click |
| Other stores | A beta scanner works on any site, plus custom selector rules for GOG, Humble, itch.io and similar |
| Demo store included | A fake store with free, discounted and paid games for safe testing |
| Notifications and history | Background claims notify you, and the popup keeps a recent-activity log |

## Installation

1. Download this repository (or `git clone` it)
2. Open `chrome://extensions` in Chrome or Edge
3. Turn on **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the folder containing `manifest.json`
5. Pin the 🎯 icon and log in to Steam / Epic as usual

Or grab the packaged zip from [Releases](https://github.com/trytotest13/Steam-and-Epic-Games-Free-Game-Hunter/releases). Every `v*` tag is packaged automatically by CI.

## Usage

1. Open a store page, for example Steam's [specials search](https://store.steampowered.com/search/?specials=1),
   Epic's [free games](https://store.epicgames.com/en-US/free-games), or any game page
2. Click the extension icon, then **Scan**. The popup auto-detects Steam, Epic and other sites
3. Check the games you want (free ones come pre-checked), then **Add to cart**
4. Use the per-row **open button** (arrow in a box) to buy a specific game individually
5. Optional: enable **Auto-checkout**. After adding, the cart opens and the $0 order is placed

### Discount slider

| Position | Behaviour |
| --- | --- |
| **100%** (default) | Free games only. These qualify for auto-checkout |
| **20 / 50 / 90** | Everything with at least that discount, with badges and the old and sale price |
| **0%** | Every discounted game on the page |

Auto-checkout is intentionally disabled below 100%. Discounted games go to your cart and you pay
there yourself.

### Safety rails

- **Dry run** highlights the buttons it would click. Nothing gets clicked
- **$0 audit**: before any auto-checkout, the cart page is scanned for paid prices. Any paid item,
  or a total it cannot read, skips the automatic purchase
- **Free-to-play games** are listed but never pre-checked. There is nothing to claim in the browser;
  install them from the store client

## How it works

| Page | What the extension does |
| --- | --- |
| Steam search and listing rows | Rows have no inline cart button, so each game page opens in a background tab, Add to Cart is clicked there, and the tab closes |
| Steam game page with a 100% off box | Clicks Add to Cart directly |
| Steam cart | Verifies the total is $0, then clicks Purchase |
| Epic free-games listing and homepage cards | Finds "Free Now" / "Free" tiles, opens each game page in a background tab, clicks Get, closes the tab |
| Epic game page | Clicks Get directly |
| Epic cart and checkout | Clicks Check Out, accepts the EULA checkbox if shown, clicks Place Order |
| Any other site | The beta scanner looks for free prices next to cart-style buttons, or uses your custom rule |

The scanners are text-first ("Free", "$0.00", "-50%", "Get", "Purchase") so they survive store
redesigns, with class-based fast paths where stores are stable.

## Other stores

- **Beta scanner**: open any store, click the icon, press **Scan**. Free prices next to cart-style
  buttons are detected anywhere
- **Custom rules**: open the settings (gear icon), then Custom sites. Add the hostname regex and CSS
  selectors for the game card, title, price and button. An example for GOG.com is included; adjust
  it with DevTools. Rules export and import as JSON
- **Demo store**: run `node tools/dev-server.mjs` and open <http://127.0.0.1:8123> to test safely.
  It ships with two free games, two discounted and two paid

## CI

GitHub Actions runs on every push and pull request (`scripts/validate.mjs`, zero dependencies):
manifest sanity, every referenced file exists, PNG icon signatures, `node --check` on every script,
then the extension is packaged as `FreeGameHunter-<version>.zip` and uploaded as an artifact. Tags
starting with `v` get a GitHub release with the zip. The same gate runs locally with `npm run validate`.

## Project structure

```
manifest.json               MV3 manifest (permissions, content scripts)
background/service-worker.js  badge, notifications, per-tab claim jobs
content/common.js           scanning engine + $0 cart audit + command router
content/steam.js            Steam adapter
content/epic.js             Epic adapter (text-based, survives their React redesigns)
content/generic.js          beta scanner for other sites (injected on demand)
popup/                      the one-click popup UI
options/                    settings + custom site rules editor
demo/test-store.html        offline fake store for safe testing
scripts/validate.mjs        CI quality gate
tools/                      icon generator, demo dev server, CDP self-tests
docs/screenshots/           the screenshots above
DESIGN.md                   the UI design contract
```

## FAQ

**Is it safe?** It only clicks buttons on pages you already use, it only ever tries to complete $0
orders, and it refuses auto-checkout when the cart contains anything paid. Use dry run on new sites.

**Does it work without logging in?** Scanning works logged out. Claiming and checkout need you
logged in to the store, in the same browser. Epic may occasionally show its own captcha; complete
it once and continue.

**A store updated and the scan finds nothing?** Reload the page first (content scripts only inject
into pages loaded after the extension). If it still finds nothing, the popup shows the actual error.
Open an issue with that message.

**What about free-to-play games?** They are listed but not pre-checked. There is nothing to claim
in the browser; install them from the store client.

## Privacy

Everything runs locally. Settings live in `chrome.storage.sync`, history in `chrome.storage.local`.
No analytics, no network calls, no account access.

## Disclaimer

Automating clicks is your own account and your own risk. Review each store's terms of service, keep
**dry run** on when trying a new site, and check the cart before any purchase.

## License

[MIT](LICENSE) © trytotest13
