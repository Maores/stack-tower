# PWA — design

Status: approved by Maor 2026-08-05 in brainstorm. Roadmap item 5, the
first wave after the shop overhaul was parked as pre-submission polish.

## In plain language

The game gets a name, an icon, and a small helper file, so a phone can
install it on the home screen and still open it with no internet.

Three pieces. The **ID card** (`manifest.webmanifest`) is a tiny text file
telling the phone what the app is called, which icon to use, what colour to
paint the edges, and that it opens full-screen in portrait with no browser
bars. The **icon files** are the home-screen picture, in four sizes because
iPhone and Android each want their own. The **helper** (`sw.js`, the service
worker) is a small script the phone keeps after the game is closed; it sits
between the game and the internet, asks the internet first for every file
exactly like today, keeps a copy of what it gets, and hands over the copies
only when there is no internet.

The rule that keeps the leaderboard untouched: the helper only handles
files from our own site, and only downloads, never uploads. Supabase is a
different site and saving a score is an upload, so both are invisible to
it. Nothing about the board, the save flow, or the tests around them
changes.

One piece of housekeeping rides along: Three.js stops loading from a CDN
and gets committed into the repo.

## Terminology, because one word was doing three jobs

Three different things, and this spec only builds the middle one.

1. **A bookmark.** What Share → Add to Home Screen produces today. Tapping
   it opens Safari with its full chrome. A shortcut, nothing more.
2. **A home-screen app.** What Add to Home Screen produces after this wave,
   caused by `display: standalone` in the manifest: iOS launches the game
   in its own window with no Safari interface and its own app-switcher
   card. Still WebKit, still served from Pages. No Xcode, no binary, no
   App Store, no review. Converting 1 into 2 is what this wave is for.
3. **A native wrapper.** Roadmap item 7: Capacitor, Xcode, a real binary,
   App Store review, IAP, haptics. Not this wave.

Where this spec says "install" it means sense 2, which is the standard web
term but reads like sense 3 next to a roadmap that contains an actual
Xcode port. "Home-screen app" is used instead wherever the distinction
carries weight. The word "install" also appears in its unrelated service
worker sense (the `install` lifecycle event, which precaches files); that
usage is always adjacent to the worker and means only that.

## Why now

Maor's ordering call, 2026-08-04: PWA next, then live 1v1. The argument
that had kept PWA behind the shop overhaul (a cache sitting between rapid
design deploys and his phone) dissolved when the overhaul was parked. The
bundled-Three.js half is an Apple submission blocker already logged in the
30/07 store briefing, so this wave pays that debt early.

## Scope decisions taken in the brainstorm

- **Zero install UI this wave.** The game becomes installable and never
  says so; Maor tells friends to use Share → Add to Home Screen. No
  persistent element is added to the title or death screens, so the
  density rule's mockup requirement is not triggered. An install hint can
  be its own later cycle.
- **Caching is network-first with a precached fallback** (approach A of
  three). Freshness stays byte-identical to today; offline is a pure
  bonus. Stale-while-revalidate was rejected explicitly: it would delay
  every deploy by one load and reproduce the stale-tab confusion of
  2026-07-31.
- **Icon art goes through the usual three-variant mockup round.**

## 1. New files

### `manifest.webmanifest`

```json
{
  "name": "Stack",
  "short_name": "Stack",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#1d6fae",
  "theme_color": "#1d6fae",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icons/icon-maskable-512.png", "sizes": "512x512",
      "type": "image/png", "purpose": "maskable" }
  ]
}
```

`start_url` and `scope` are relative on purpose. Pages serves this repo
from the `/stack-tower/` subpath, and a hard-coded absolute path would
break every local run. The colours are the shell background already in
`index.html` (`#1d6fae`), so the splash and status bar match the sky the
game boots into.

### `sw.js`

One cache constant, three lifecycle handlers, one fetch handler. Under 60
lines, no imports, no game knowledge.

- `CACHE = 'stack-shell-v1'`.
- **Precache list, ten entries:** `./index.html`, `./hud.css`, `./core.js`,
  `./visuals.js`, `./hud.js`, `./audio.js`, `./vendor/three.min.js`,
  `./manifest.webmanifest`, `./icons/icon-192.png`, `./icons/icon-512.png`.
  Roughly 1 MB, dominated by Three.js. The maskable and apple-touch icons
  are deliberately absent: the platform reads them at install time, when
  there is by definition a network, and they are dead weight in an offline
  cache whose job is to boot the game.
- **install:** `cache.addAll(PRECACHE)` inside `waitUntil`, then
  `self.skipWaiting()`. `addAll` is deliberately atomic: a partial shell
  is a broken offline experience, worse than no offline at all, and a
  failed install simply leaves today's behaviour in place.
- **activate:** delete every cache whose name is not `CACHE`, then
  `self.clients.claim()`.
- **fetch:** return immediately, without calling `respondWith`, when the
  request is cross-origin or its method is not GET. Everything else goes
  network-first: fetch, clone into the cache on an ok response, return it;
  on rejection fall back to `caches.match(request)`. For requests with
  `mode === 'navigate'`, the offline fallback is
  `caches.match('./index.html')` regardless of the requested URL, which is
  what lets the home-screen app launch from `start_url` with no network. A
  same-origin GET that is neither cached nor reachable returns
  `Response.error()` rather than leaving a rejection unhandled.

`skipWaiting` plus `clients.claim` are safe here specifically because the
policy is network-first: a page that is already open keeps fetching from
the network, so a new worker taking over mid-session cannot serve it a
mismatched mix of old and new assets.

### `vendor/three.min.js`

The pinned 0.149.0 build, committed. Same file the CDN was serving and the
same file `build-offline.mjs` was fetching, so no behaviour changes.

### `icons/`

`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
`apple-touch-icon-180.png`. The maskable variant keeps all meaningful
content inside the inner 80% circle, since Android crops to a
platform-chosen shape.

Production: Maor picks a direction in a three-variant mockup round, the
winner is authored once as vector art, and the four PNGs are rasterized by
screenshotting it at exact pixel sizes through the existing Playwright
setup. No new dependency.

The mockup round gates the icon files but nothing else in this wave. The
worker, the manifest, the vendored Three.js, and the build changes can all
land against placeholder icons and be tested, so the plan should sequence
the round early but never let it block the rest.

## 2. Edits to `index.html`

Two marked blocks, so the offline build has stable strip targets and fails
loudly if either moves.

In `<head>`:

```html
<!-- pwa:head:start -->
<link rel="manifest" href="manifest.webmanifest">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="icons/apple-touch-icon-180.png">
<!-- pwa:head:end -->
```

The apple-touch-icon link is present because that is the documented iOS
source for a home-screen icon. Whether current iOS also reads manifest
icons is not something this spec asserts; the link costs one line and
removes the question.

At the end of `<body>`, after the game scripts:

```html
<!-- pwa:boot:start -->
<script>
(function () {
  if (!('serviceWorker' in navigator)) return;
  var h = location.hostname;
  if (location.protocol !== 'https:' && h !== 'localhost' && h !== '127.0.0.1') return;
  var go = function () { navigator.serviceWorker.register('sw.js')['catch'](function () {}); };
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go);
})();
</script>
<!-- pwa:boot:end -->
```

Three things this shape is buying, all of them lessons this repo has
already paid for:

- The protocol guard means a `file://` load skips registration silently
  instead of throwing, which keeps both `Stack.html` and any local
  file-based test run clean.
- The `readyState === 'complete'` check mirrors the house pattern for
  boot-time work. A bare `addEventListener('load')` would be a silent
  no-op if `load` had already fired, which is the same class of race the
  boot broadcasts hit on 2026-08-01.
- Registering after `load` keeps the precache download from competing with
  the game's own boot for bandwidth. The catch is empty on purpose:
  registration failure must never surface to the player, because the game
  is fully functional without it.

Also in `<body>`, the CDN pair

```html
<script src="https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js"></script>
<script>window.THREE || document.write('<script src="https://unpkg.com/three@0.149.0/build/three.min.js"><\/script>');</script>
```

collapses to a single `<script src="vendor/three.min.js"></script>`. The
unpkg fallback goes away with it: it existed to survive one CDN being
down, and a file served from our own origin alongside the page has no such
failure mode.

The `<link rel="icon" href="data:,">` line stays as is. Pointing it at a
real icon would be a cosmetic win but would need a third strip rule in the
offline build; out of scope.

## 3. Edits to `scripts/build-offline.mjs`

- Delete `THREE_URL` and the `fetch`. Read `vendor/three.min.js` from disk
  alongside the other sources. **The offline build becomes network-free**,
  which retires the "needs network once per run" caveat in `CLAUDE.md` and
  the script's own header comment.
- The three.js `mustReplace` regex currently targets the CDN pair. Retarget
  it at `<script src="vendor/three.min.js"></script>`.
- Add two `mustReplace` calls that strip the `pwa:head` and `pwa:boot`
  blocks whole. `Stack.html` must contain no PWA markup at all: a manifest
  link would 404 under `file://` and the registration script has no job
  there.
- Add a backstop after the existing two: the output must not contain the
  strings `sw.js` or `manifest.webmanifest`. The existing
  `/^<script\s+src=/m` check does not catch the registration block,
  because that block is an inline `<script>` with no `src`.

## 4. What is untouched

`core.js`, `visuals.js`, `hud.js`, `hud.css`, `audio.js`: no changes. No
new CustomEvent, no new cross-domain coupling. `sw.js` is its own
top-level domain that reads no game state. The registration snippet lives
in `index.html`, which is core's file per the domain contracts, but it
neither reads nor emits anything the game can observe.

Offline leaderboard behaviour needs no new code: `hud.js` already falls
back to the device-local board on a failed fetch, at four call sites
(1278, 1568, 1683, 2016), and a failed POST already falls back to the
device board through the autoSeq path.

## 5. Failure behaviour

| What fails | What the player gets |
| --- | --- |
| Registration (unsupported, insecure origin, throw) | Today's game exactly, no offline copy |
| Precache install (a file 404s) | Worker never activates; today's game exactly |
| Network, with the worker installed | Cached shell boots; device-local board |
| Network, worker never installed | Browser's own offline page, as today |
| Anything unexpected inside the fetch handler | Falls through to a plain network request |

The invariant behind the table: the worker can never be the reason the
game fails to load. Every path either serves the game or gets out of the
way.

## 6. Testing

**New suite, `pw-pwa.js`**, the only suite that lets a service worker run:

1. Registration resolves and the worker controls the page after one
   reload (`navigator.serviceWorker.controller` is non-null).
2. The manifest parses and carries `name`, `start_url`, `display`, and at
   least one icon that resolves to a real image.
3. With the network cut after a first load, a reload still boots and
   reaches a playable state.
4. A full play-to-gameover run with the worker active reaches game over
   with a score above zero, renders the quip, and logs zero page errors.
   This is the assertion that proves the worker is transparent to
   gameplay, so it cannot be dropped for being slow.
5. Cross-origin passthrough: with the worker active, Supabase requests are
   observed reaching the network layer rather than being answered by the
   worker.

**Safety rule for points 4 and 5, and it is not optional.** Point 4 plays
to game over, and every scoring run auto-submits, so that test *is* a
save-flow test whether or not it is written as one. Playwright's request
interception and service workers can interact in ways that let a request
escape a `page.route` handler, and if that happened here a real row would
land on the friends' board, where anon cannot delete it. So `pw-pwa.js`
registers `context.route('**/rest/v1/**', r => r.abort())` as an outer net
before anything else, and the whole suite runs against a local
`index.html`, never production. An aborted request cannot insert a row
even if an inner fulfilling route is bypassed, which is the point: the
outer net does not depend on the behaviour we are testing for.

**Every other suite** gains `serviceWorkers: 'block'` on its
`newContext({ ...devices['iPhone 13'] })` call. This keeps their existing
interception contract byte-identical and is a one-line change each. The
cost, stated plainly: no existing suite then exercises the worker
alongside the game, which is exactly why point 4 above is in the new
suite and not optional either.

**`pw-offline-check`** keeps passing, plus one new assertion: `Stack.html`
contains neither `sw.js` nor `manifest.webmanifest`.

**Installability** is checked with Chrome's own Lighthouse audit
(`lighthouse_audit` via the chrome-devtools MCP) against the deployed URL,
rather than by reading the manifest and hoping.

**On the device, by Maor**, after deploy: add it from Safari via Share →
Add to Home Screen, confirm the icon and name look right, launch it and
check it opens in its own window with no Safari chrome (which is the
proof that it is now sense 2 rather than a bookmark), enable airplane
mode, launch again.

## 7. Open questions

**iOS storage isolation, unresolved and deliberately not guessed at.** The
question exists because of what this wave changes: once iOS runs the game
in its own window instead of inside Safari, it is a separate browsing
context, and a separate context may or may not come with a separate box of
stored data. If it does, the home-screen app opens with a fresh best
score, zero points, and no owned Worlds while the Safari tab still holds
the real numbers. This spec does not assert either way, and the answer is
not worth researching secondhand: adding it to Maor's home screen and
looking settles it, which is already a step in section 6. If it turns out
to be true, cosmetics come back with the `MAOR-SEES-ALL` redeem code and
the leaderboard is server-side and keyed by name, so the real loss is the
points balance and the local records panel. Nothing in this design changes
based on the answer. It changes only what Maor should expect the first
time he opens the home-screen app.

**Not to be confused with the wrapper-phase storage item.** Roadmap item 7
carries a separate, already-recorded risk: a native WKWebView can evict
`localStorage` under storage pressure, which is why the wrapper moves the
game's ~9 keys to Capacitor Preferences. Different mechanism, different
phase, different fix. Nothing in this wave should attempt it.

**Safe-area insets, decided: not this wave.** In standalone mode iOS will
hand the app the full screen including the notch and home-indicator areas
if the viewport meta opts in with `viewport-fit=cover`. This spec keeps
the current viewport meta unchanged, so the game stays letterboxed inside
the safe area with its layout geometry exactly as it is today. Taking the
full screen risks pushing HUD controls under the home indicator, and
invisible-or-misplaced chrome in the thumb zone is one of this codebase's
two standing hazards. Revisit when Maor has the home-screen app on his phone
and can judge the letterboxing.

## 8. Explicitly out of scope

Install prompt or button UI. Push notifications. Background sync. Offline
queueing of scores: a run played offline saves to the device board only,
as today. Any change to the favicon link. Any change to game code.

## 9. Release checklist addition

Alongside the standing "rebuild `Stack.html` after any commit touching an
inlined source":

- Bump `CACHE` in `sw.js` when the precache list gains or loses a file.
  Because the policy is network-first and refreshes entries in passing, an
  unbumped version still self-heals for files that already exist; the bump
  matters for eviction and for newly added files only.
