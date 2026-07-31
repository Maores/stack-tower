# Marketplace Wave A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Points economy (earn-only, daily double), trophy-overlay restructure to BOARD / RECORDS / SHOP, six-World shelf with two-tap purchase and tier gifts, per-World palette/chime/quip swaps, title SHOP pill, death whisper line.

**Architecture:** Everything rides the existing event seams. hud.js owns points, ownership, equip state, and all shop UI; it broadcasts `hud:world {id}` (new event, `hud:mute` precedent) which visuals.js and audio.js consume against their own per-World tables. Zero core.js changes; zero backend changes; all state is localStorage.

**Tech Stack:** Vanilla ES5 browser JS (hud.js style: `var`, IIFE, no arrows/template literals, `textContent` only), Three.js r149 (visuals), WebAudio (audio), Playwright suites via playwright-skill runner.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-31-marketplace-wave-a-design.md`. Parent: `2026-07-30-retention-loop-design.md`.
- **No core.js edits.** Files touched: `hud.js`, `hud.css`, `visuals.js`, `audio.js`, test scripts.
- hud.js/audio.js are ES5: `var`, IIFEs, no arrows, no template literals, no `let/const`. visuals.js is ES5 with `//` comments. Match each file's comment density and voice.
- User-visible text goes through `textContent`, never `innerHTML`. All UI copy is English, uppercase.
- Exact copy strings: whisper `+N PTS` and `+N PTS · FIRST RUN ×2`; gift toasts `▲ MARBLE · WORLD UNLOCKED`, `▲ OBSIDIAN · WORLD UNLOCKED`; machine card `PRIZE MACHINE · COMING SOON`; pill `SHOP · 1,240` (comma-formatted balance); tabs `BOARD`, `RECORDS`, `SHOP`; segment `TODAY`, `ALL TIME`; chips `ON`, `OWNED`, `MARBLE GIFT`, `OBSIDIAN GIFT`, `BUY · 600?`.
- Earning: normal placement 1 point, perfect 3 total (+2 on top of the score point). First committed run per device-local calendar day doubles; zero-point runs never consume the double. Points are earn-only; no code path may ever add balance except the death commit and no path may sell it.
- localStorage keys (all corrupt-safe): `stack-points` (int balance), `stack-daily` (`YYYY-MM-DD`), `stack-worlds` (JSON array of owned ids beyond classic), `stack-world` (equipped id, unknown → `classic`).
- Worlds: `classic` (owned), `sunset` 600, `neon` 1000, `deepsea` 1500, `marble` gift at best ≥ 70, `obsidian` gift at best ≥ 250. Gifts are never auto-equipped; purchases auto-equip.
- Every Playwright script: emulated iPhone 13, `?debug=1` in the URL, and **ALL** `**/rest/v1/stack_scores*` traffic intercepted (the friends' real board must never see test rows). Test runner: `cd "C:\Users\maor4\.claude\plugins\cache\playwright-skill\playwright-skill\4.1.0\skills\playwright-skill" && node run.js "<script path>"`.
- Test scripts live in the session scratchpad: `C:\Users\maor4\AppData\Local\Temp\claude\C--Users-maor4-OneDrive-Desktop-Claude-builds-stack-tower\c1e7833a-2c07-43a2-bcab-f5e79bb9336f\scratchpad\` (referred to as `SCRATCH` below). Existing suites there: pw-tiers.js, pw-deathlines.js, pw-boards.js, pw-density1/2/3.js, pw-fixes.js, pw-save.js, pw-ghost.js, pw-almost.js, pw-offline-check.js.
- Debug idiom (from the live suites): `window.StackCore.debug.build(n, 0)` places n perfect blocks instantly; `drop(0.5)` places one sliced block; `drop(0)` places one perfect block; `drop(6)` misses (death). Start a run with `page.touchscreen.tap(195, 500)`.
- After any source change that ships: `node scripts/build-offline.mjs` rebuilds `Stack.html` (needs network once for pinned Three.js; UTF-8 `·`, `×`, `▲` must survive).
- Deploy = push to main; GitHub Pages serves in ~60s; verify with `gh api repos/Maores/stack-tower/pages/builds/latest` and cache-busted curl.

## File structure

- `hud.js` (~1309 lines): gains economy state + commit, Worlds catalog + storage + `hud:world` firing, pane machinery, shop pane, pill, whisper. Stays one file (established codebase pattern).
- `hud.css`: gains whisper, segment, shop pane, pill blocks; three-tab bar reuses `.hud-lb-tab`.
- `visuals.js`: `WORLD_STYLES` table replaces the single `HUE_FAMILIES` palette source; sky/palette formulas parameterized; `hud:world` listener.
- `audio.js`: `WORLD_SOUND` table replaces `LADDER`/`BASE_HZ`; `hud:world` listener; `debug.world` for tests.
- `SCRATCH\pw-shop.js`: the new suite, grown task by task (sections A..P).

---

### Task 1: Points economy + death whisper

**Files:**
- Modify: `hud.js` (keys ~line 47, `state` ~line 64, `setMode` ~line 454, `applyScore` ~line 1032, `applyPerfect` ~line 1064, `applyOver` ~line 1072, `buildDom` lb block ~line 274)
- Modify: `hud.css` (after the `.hud-lb-auto-btn:focus-visible` block, ~line 581)
- Test: `SCRATCH\pw-shop.js` (new, sections A-C)

**Interfaces:**
- Consumes: existing `readInt(key)` / `writeInt(key, v)` / `localDateStr()` helpers in hud.js; existing `state.runBlocks` flush pattern in `applyOver`.
- Produces: `PTS_KEY = 'stack-points'`, `DAILY_KEY = 'stack-daily'`, `readDaily()` → string, `writeDaily(str)`, `state.runPts` (int, in-memory), `els.overPts` (whisper div, class `hud-over-pts`). Task 2's records row and shop balance, Task 4's purchases, and Task 5's pill all read/write balance via `readInt(PTS_KEY)` / `writeInt(PTS_KEY, v)`.

- [ ] **Step 1: Write the failing test.** Create `SCRATCH\pw-shop.js`:

```js
/* Marketplace Wave A suite. LB fully mocked; ?debug=1. Grows per task. */
const { chromium, devices } = require('playwright');
const TARGET_URL = process.env.STACK_URL ||
  'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const ALL = JSON.stringify([
  { name: 'KING', score: 500 }, { name: 'RIV', score: 271 }, { name: 'PAL', score: 138 }
]);
const TODAY = (() => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
})();

async function boot(browser, seed) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const issues = [];
  page.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  await context.route('**/rest/v1/stack_scores*', route => {
    const req = route.request();
    if (req.method() === 'POST') return route.fulfill({ status: 201, body: '' });
    if (req.method() === 'HEAD') return route.fulfill({ status: 206, headers: {
      'content-range': '0-0/0', 'access-control-expose-headers': 'Content-Range' } });
    return route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/0' }, body: ALL });
  });
  await context.addInitScript(s => {
    try { Object.keys(s).forEach(k => localStorage.setItem(k, s[k])); } catch (e) {}
  }, seed || {});
  await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  return { context, page, issues };
}

async function playRun(page, actions) {
  await page.touchscreen.tap(195, 500);
  await page.waitForTimeout(600);
  await page.evaluate(async acts => {
    await new Promise(r => setTimeout(r, 300));
    for (const a of acts) {
      if (a[0] === 'build') window.StackCore.debug.build(a[1], 0);
      else window.StackCore.debug.drop(a[1]);
      await new Promise(r => setTimeout(r, 60));
    }
  }, actions);
  await page.waitForSelector('#hud-root[data-state="over"]', { timeout: 5000 });
  await page.waitForTimeout(600);
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  let t, s;

  // A: earn math. Double suppressed by preseeding today. 2 perfects + 1
  // sliced = 2*3 + 1 = 7 points; whisper shows "+7 PTS" with no marker.
  t = await boot(browser, { 'stack-daily': TODAY });
  await playRun(t.page, [['build', 2], ['drop', 0.5], ['drop', 6]]);
  s = await t.page.evaluate(() => ({
    pts: localStorage.getItem('stack-points'),
    daily: localStorage.getItem('stack-daily'),
    whisper: document.querySelector('.hud-over-pts').textContent,
    hidden: document.querySelector('.hud-over-pts').hidden
  }));
  if (s.pts !== '7' || s.whisper !== '+7 PTS' || s.hidden)
    throw new Error('FAIL A earn: ' + JSON.stringify(s));
  if (t.issues.length) throw new Error('FAIL A issues: ' + JSON.stringify(t.issues));
  await t.context.close();
  console.log('A PASS: 2 perfects + 1 sliced = 7 pts, whisper right');

  // B: daily double. Fresh device: first run doubles and stamps the date,
  // second run commits single with no marker.
  t = await boot(browser, {});
  await playRun(t.page, [['drop', 0.5], ['drop', 6]]);
  s = await t.page.evaluate(() => ({
    pts: localStorage.getItem('stack-points'),
    daily: localStorage.getItem('stack-daily'),
    whisper: document.querySelector('.hud-over-pts').textContent
  }));
  if (s.pts !== '2' || s.daily !== TODAY || s.whisper !== '+2 PTS · FIRST RUN ×2')
    throw new Error('FAIL B first run: ' + JSON.stringify(s));
  await t.page.waitForTimeout(900);
  await playRun(t.page, [['drop', 0.5], ['drop', 6]]);
  s = await t.page.evaluate(() => ({
    pts: localStorage.getItem('stack-points'),
    whisper: document.querySelector('.hud-over-pts').textContent
  }));
  if (s.pts !== '3' || s.whisper !== '+1 PTS')
    throw new Error('FAIL B second run: ' + JSON.stringify(s));
  if (t.issues.length) throw new Error('FAIL B issues: ' + JSON.stringify(t.issues));
  await t.context.close();
  console.log('B PASS: daily double once, then single');

  // C: zero-point run. Whisper hidden, balance untouched, and the daily
  // double NOT consumed (negative control).
  t = await boot(browser, {});
  await playRun(t.page, [['drop', 6]]);
  s = await t.page.evaluate(() => ({
    pts: localStorage.getItem('stack-points'),
    daily: localStorage.getItem('stack-daily'),
    hidden: document.querySelector('.hud-over-pts').hidden
  }));
  if (s.pts !== null || s.daily !== null || !s.hidden)
    throw new Error('FAIL C zero run: ' + JSON.stringify(s));
  if (t.issues.length) throw new Error('FAIL C issues: ' + JSON.stringify(t.issues));
  await t.context.close();
  console.log('C PASS: zero run earns nothing, keeps the double');

  console.log('PASS: pw-shop task 1');
  await browser.close();
})();
```

- [ ] **Step 2: Run it, verify it fails.** `cd "C:\Users\maor4\.claude\plugins\cache\playwright-skill\playwright-skill\4.1.0\skills\playwright-skill" && node run.js "<SCRATCH>\pw-shop.js"` — Expected: FAIL A with a null-property error on `.hud-over-pts` (element does not exist yet).

- [ ] **Step 3: hud.js keys + state.** After `var TODAY_KEY = 'stack-today';` (~line 47) add:

```js
  var PTS_KEY = 'stack-points';    /* spendable balance; earn-only, forever */
  var DAILY_KEY = 'stack-daily';   /* local date of the last doubled run */
```

In the `state` object, after `runStreakPeak: 0,` add:

```js
    runPts: 0,          /* points earned this run, committed at death */
```

In `setMode`, inside the `if (mode === 'playing')` block, after `state.runStreakPeak = 0;` add:

```js
      state.runPts = 0;
```

- [ ] **Step 4: daily helpers.** After `writeToday` (~line 162) add:

```js
  function readDaily() {
    try { return String(window.localStorage.getItem(DAILY_KEY) || ''); }
    catch (err) { return ''; }
  }

  function writeDaily(v) {
    try { window.localStorage.setItem(DAILY_KEY, v); } catch (err) { /* ignore */ }
  }
```

- [ ] **Step 5: accrual.** In `applyScore`, right after `state.runBlocks += (n - prev);` add:

```js
      state.runPts += (n - prev);
```

In `applyPerfect`, after the `runStreakPeak` line add:

```js
    state.runPts += 2;   /* perfect placement: 1 (score) + 2 = 3 points */
```

- [ ] **Step 6: commit + whisper in `applyOver`.** Directly after the streak-flush block (`state.runStreakPeak = 0;`) insert:

```js
    /* Commit the run's points: counted in memory during play (same frame
       argument as runBlocks), doubled once per local calendar day, written
       at death. A zero-point run never consumes the daily double; an
       abandoned run loses its points like it loses its score. */
    var runPts = state.runPts;
    state.runPts = 0;
    var ptsDoubled = false;
    if (runPts > 0) {
      if (readDaily() !== localDateStr()) {
        runPts *= 2;
        ptsDoubled = true;
        writeDaily(localDateStr());
      }
      writeInt(PTS_KEY, readInt(PTS_KEY) + runPts);
    }
    els.overPts.textContent = runPts > 0
      ? '+' + runPts + ' PTS' + (ptsDoubled ? ' · FIRST RUN ×2' : '')
      : '';
    els.overPts.hidden = !(runPts > 0);
```

- [ ] **Step 7: whisper DOM.** In `buildDom`, after `lb.appendChild(autoRow);` add:

```js
    /* Run earnings whisper: same micro scale as the SAVED AS row. The
       density rule holds — the death screen grows no new layer, only this
       line in the existing micro cluster. */
    var overPts = el('div', 'hud-over-pts', '');
    overPts.hidden = true;
    lb.appendChild(overPts);
```

Add `overPts: overPts,` to the returned els map (next to `overVictim`).

- [ ] **Step 8: whisper CSS.** In `hud.css`, after the `.hud-lb-auto-btn:focus-visible` rule add:

```css
/* Run earnings whisper (marketplace Wave A): micro scale, hue-neutral like
   the rest of the HUD so it reads on any World's sky. */
.hud-over-pts {
  margin-top: 1vh;
  text-align: center;
  font-size: clamp(10px, 1.5vmin, 12px);
  font-weight: 300;
  letter-spacing: 0.18em;
  margin-right: -0.18em;
  opacity: 0.6;
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.3);
}
.hud-over-pts[hidden] {
  display: none;
}
```

Note: the approved mockup drew this line gold; the shipped HUD stays hue-neutral white (hud.css's documented rule) so it reads on every World sky. The mockup gold also painted BEST, which is white in the real game — same translation.

- [ ] **Step 9: Run the test, verify A-C pass.** Same command. Expected: `A PASS`, `B PASS`, `C PASS`, `PASS: pw-shop task 1`.

- [ ] **Step 10: Regression.** Run `pw-fixes.js` and `pw-tiers.js` (unchanged files' behavior must hold). Expected: both end with their PASS lines.

- [ ] **Step 11: Commit.**

```bash
git add hud.js hud.css
git commit -m "Wave A economy: run points, daily double, death whisper"
```

---

### Task 2: Overlay restructure — BOARD / RECORDS / SHOP + scope segment

**Files:**
- Modify: `hud.js` (`buildDom` board block ~lines 346-396, els map, `showPercentile` ~line 868, `refreshOverlayBoard`/`openBoard`/`closeBoard` ~lines 926-966, `renderRecordsPane` ~line 972, tab wiring in `wireOutgoing` ~lines 1203-1237, delete `tierLine`/`tierProgress` ~lines 117-130, delete `markTab` ~line 803)
- Modify: `hud.css` (segment + shop-shell blocks after `.hud-board-list`; nothing removed)
- Test: `SCRATCH\pw-shop.js` (sections D-F) plus selector reconciliation in `SCRATCH\pw-tiers.js`
- Reference: existing suites use `.hud-lb-tab[data-scope="day"|"all"|"records"]` — the day/all pair moves to `.hud-lb-seg-btn[data-scope=...]`, records/shop become `.hud-lb-tab[data-pane=...]`.

**Interfaces:**
- Consumes: Task 1's `PTS_KEY`, `readInt`.
- Produces: `overlayPane` (`'board'|'records'|'shop'`), `setPane(pane)`, `openBoardTo(pane)` (Task 5's pill entry), `fmtPts(n)` → comma string, els: `boardTabBoard`, `boardTabRec`, `boardTabShop`, `segDay`, `segAll`, `boardSeg`, `boardShop`, `shopBalVal`, `recPts`; `renderShopPane()` (balance-only in this task; Task 4 extends it). `overlayScope` keeps its `'day'|'all'` meaning and persists across pane switches and reopens.

- [ ] **Step 1: Extend the test (fails first).** Append to `SCRATCH\pw-shop.js` before the final `PASS` log:

```js
  // D: three tabs, BOARD active on open, segment visible with ALL TIME on.
  t = await boot(browser, { 'stack-points': '340', 'stack-best': '87' });
  await t.page.click('.hud-board-btn');
  await t.page.waitForTimeout(500);
  s = await t.page.evaluate(() => ({
    tabs: Array.from(document.querySelectorAll('.hud-lb-tab')).map(b => b.textContent),
    on: (document.querySelector('.hud-lb-tab.is-on') || {}).textContent,
    segOn: (document.querySelector('.hud-lb-seg-btn.is-on') || {}).textContent,
    segHidden: document.querySelector('.hud-lb-seg').hidden,
    listVisible: getComputedStyle(document.querySelector('.hud-board-list')).display !== 'none'
  }));
  if (s.tabs.join('|') !== 'BOARD|RECORDS|SHOP' || s.on !== 'BOARD' ||
      s.segOn !== 'ALL TIME' || s.segHidden || !s.listVisible)
    throw new Error('FAIL D tabs: ' + JSON.stringify(s));
  console.log('D PASS: BOARD/RECORDS/SHOP + segment');

  // E: segment flips scope in place; panes swap exclusively.
  await t.page.click('.hud-lb-seg-btn[data-scope="day"]');
  await t.page.waitForTimeout(400);
  s = await t.page.evaluate(() => ({
    segOn: (document.querySelector('.hud-lb-seg-btn.is-on') || {}).textContent,
    on: (document.querySelector('.hud-lb-tab.is-on') || {}).textContent
  }));
  if (s.segOn !== 'TODAY' || s.on !== 'BOARD') throw new Error('FAIL E seg: ' + JSON.stringify(s));
  await t.page.click('.hud-lb-tab[data-pane="records"]');
  await t.page.waitForTimeout(300);
  s = await t.page.evaluate(() => ({
    recVisible: getComputedStyle(document.querySelector('.hud-board-records')).display !== 'none',
    listGone: getComputedStyle(document.querySelector('.hud-board-list')).display === 'none',
    segGone: getComputedStyle(document.querySelector('.hud-lb-seg')).display === 'none',
    pts: document.querySelector('.hud-rec-pts').textContent
  }));
  if (!s.recVisible || !s.listGone || !s.segGone || s.pts !== '340')
    throw new Error('FAIL E records: ' + JSON.stringify(s));
  console.log('E PASS: segment + records POINTS row');

  // F: SHOP pane shows the balance; back to BOARD restores the list; scope
  // survived the round trip (still TODAY).
  await t.page.click('.hud-lb-tab[data-pane="shop"]');
  await t.page.waitForTimeout(300);
  s = await t.page.evaluate(() => ({
    shopVisible: getComputedStyle(document.querySelector('.hud-board-shop')).display !== 'none',
    bal: document.querySelector('.hud-shop-bal-val').textContent
  }));
  if (!s.shopVisible || s.bal !== '340') throw new Error('FAIL F shop: ' + JSON.stringify(s));
  await t.page.click('.hud-lb-tab[data-pane="board"]');
  await t.page.waitForTimeout(400);
  s = await t.page.evaluate(() => ({
    listVisible: getComputedStyle(document.querySelector('.hud-board-list')).display !== 'none',
    segOn: (document.querySelector('.hud-lb-seg-btn.is-on') || {}).textContent
  }));
  if (!s.listVisible || s.segOn !== 'TODAY') throw new Error('FAIL F back: ' + JSON.stringify(s));
  if (t.issues.length) throw new Error('FAIL F issues: ' + JSON.stringify(t.issues));
  await t.context.close();
  console.log('F PASS: shop shell + scope persistence');
```

- [ ] **Step 2: Run, verify D fails** (tab list reads `TODAY|ALL TIME|RECORDS`).

- [ ] **Step 3: Delete dead helpers.** Remove `tierLine` and `tierProgress` (hud.js ~lines 117-130; both orphaned since the density revision — verify first: `grep -n "tierLine\|tierProgress" hud.js` must show only the definitions). Remove `markTab` (~line 803) in the same pass; its two callers are rewritten below.

- [ ] **Step 4: Rebuild the tab DOM.** In `buildDom`, replace the whole block from `var boardTabs = el('div', 'hud-lb-tabs');` through `boardTabs.appendChild(boardTabRec);` with:

```js
    var boardTabs = el('div', 'hud-lb-tabs');
    var boardTabBoard = el('button', 'hud-lb-tab is-on', 'BOARD');
    boardTabBoard.type = 'button';
    boardTabBoard.setAttribute('data-pane', 'board');
    var boardTabRec = el('button', 'hud-lb-tab', 'RECORDS');
    boardTabRec.type = 'button';
    boardTabRec.setAttribute('data-pane', 'records');
    var boardTabShop = el('button', 'hud-lb-tab', 'SHOP');
    boardTabShop.type = 'button';
    boardTabShop.setAttribute('data-pane', 'shop');
    boardTabs.appendChild(boardTabBoard);
    boardTabs.appendChild(boardTabRec);
    boardTabs.appendChild(boardTabShop);

    /* TODAY | ALL TIME, demoted from top-level tabs into the board pane
       when SHOP arrived (round-2 mockup pick): places on top, views of the
       board inside it. */
    var boardSeg = el('div', 'hud-lb-seg');
    var segDay = el('button', 'hud-lb-seg-btn', 'TODAY');
    segDay.type = 'button';
    segDay.setAttribute('data-scope', 'day');
    var segAll = el('button', 'hud-lb-seg-btn is-on', 'ALL TIME');
    segAll.type = 'button';
    segAll.setAttribute('data-scope', 'all');
    boardSeg.appendChild(segDay);
    boardSeg.appendChild(segAll);
```

- [ ] **Step 5: Records POINTS row + shop shell.** Still in `buildDom`: after `boardRecords.appendChild(recBlocks.row);` add:

```js
    var recPts = recRow('POINTS', 'hud-rec-pts');
    boardRecords.appendChild(recPts.row);
```

After the `boardRecords` block (before `var boardList = ...`) add:

```js
    /* Shop pane shell: balance now, cards in the shop task. */
    var boardShop = el('div', 'hud-board-shop');
    boardShop.hidden = true;
    var shopBal = el('div', 'hud-shop-bal');
    shopBal.appendChild(el('span', 'hud-shop-bal-label', 'POINTS'));
    var shopBalVal = el('span', 'hud-shop-bal-val', '0');
    shopBal.appendChild(shopBalVal);
    boardShop.appendChild(shopBal);
```

Panel assembly becomes (replacing the current `boardPanel.appendChild` run):

```js
    boardPanel.appendChild(boardClose);
    boardPanel.appendChild(boardTitle);
    boardPanel.appendChild(boardStatus);
    boardPanel.appendChild(boardTabs);
    boardPanel.appendChild(boardSeg);
    boardPanel.appendChild(boardPct);
    boardPanel.appendChild(boardRecords);
    boardPanel.appendChild(boardShop);
    boardPanel.appendChild(boardList);
```

In the returned els map: remove `boardTabDay`/`boardTabAll`, add `boardTabBoard: boardTabBoard, boardTabShop: boardTabShop, segDay: segDay, segAll: segAll, boardSeg: boardSeg, boardShop: boardShop, shopBalVal: shopBalVal, recPts: recPts.val,` (keep `boardTabRec`).

- [ ] **Step 6: Pane machinery.** Add `var overlayPane = 'board';` next to `var overlayScope = 'all';`. Replace `refreshOverlayBoard`'s first guard line with `if (overlayPane !== 'board') { return; }`. In `showPercentile`, replace both `overlayScope !== 'day'` guards with `overlayPane !== 'board' || overlayScope !== 'day'`. Add (near `openBoard`):

```js
  function fmtPts(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* Balance-only for now; the shop task adds the cards. */
  function renderShopPane() {
    els.shopBalVal.textContent = fmtPts(readInt(PTS_KEY));
  }

  function setPane(pane) {
    overlayPane = pane;
    els.boardTabBoard.classList.toggle('is-on', pane === 'board');
    els.boardTabRec.classList.toggle('is-on', pane === 'records');
    els.boardTabShop.classList.toggle('is-on', pane === 'shop');
    els.boardSeg.hidden = pane !== 'board';
    els.boardList.hidden = pane !== 'board';
    els.boardRecords.hidden = pane !== 'records';
    els.boardShop.hidden = pane !== 'shop';
    els.boardPct.hidden = true;
    els.boardStatus.textContent = '';
    if (pane === 'board') {
      refreshOverlayBoard(true);
      if (overlayScope === 'day') { showPercentile(); }
    } else {
      overlayBoardSeq++;  /* an in-flight list fetch must not repaint under another pane */
    }
    if (pane === 'records') { renderRecordsPane(); }
    if (pane === 'shop') { renderShopPane(); }
  }
```

Rewrite `openBoard` (and its records-reset block) as:

```js
  function openBoardTo(pane) {
    if (!boardOpen) {
      boardOpen = true;
      els.root.setAttribute('data-board', 'open');
      boardTimer = setInterval(function () { refreshOverlayBoard(false); }, BOARD_REFRESH_MS);
    }
    setPane(pane);
  }

  /* Opens on the board pane; the scope (TODAY / ALL TIME) persists. */
  function openBoard() {
    openBoardTo('board');
  }
```

`closeBoard` is unchanged.

- [ ] **Step 7: Rewire the tabs.** In `wireOutgoing`, replace the three old tab handlers (`boardTabDay`, `boardTabAll`, `boardTabRec` listeners) and their `keepKeysLocal` trio with:

```js
    els.boardTabBoard.addEventListener('click', function () { setPane('board'); });
    els.boardTabRec.addEventListener('click', function () { setPane('records'); });
    els.boardTabShop.addEventListener('click', function () { setPane('shop'); });
    els.segDay.addEventListener('click', function () {
      if (overlayScope === 'day') { return; }
      overlayScope = 'day';
      els.segDay.classList.add('is-on');
      els.segAll.classList.remove('is-on');
      refreshOverlayBoard(true);
      showPercentile();
    });
    els.segAll.addEventListener('click', function () {
      if (overlayScope === 'all') { return; }
      overlayScope = 'all';
      els.segAll.classList.add('is-on');
      els.segDay.classList.remove('is-on');
      els.boardPct.hidden = true;
      refreshOverlayBoard(true);
    });
    keepKeysLocal(els.boardTabBoard);
    keepKeysLocal(els.boardTabRec);
    keepKeysLocal(els.boardTabShop);
    keepKeysLocal(els.segDay);
    keepKeysLocal(els.segAll);
```

- [ ] **Step 8: CSS.** In `hud.css`, after the `.hud-board-list` rule add:

```css
/* Board-pane scope segment: TODAY | ALL TIME */
.hud-lb-seg {
  display: flex;
  justify-content: center;
  margin-top: 1vh;
  pointer-events: auto;
}
.hud-lb-seg[hidden] {
  display: none;
}
.hud-lb-seg-btn {
  pointer-events: auto;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.3);
  background: transparent;
  padding: 0.22em 0.85em 0.22em 1.01em; /* extra left pad balances letter-spacing */
  font-size: clamp(9px, 1.4vmin, 11px);
  font-weight: 300;
  letter-spacing: 0.16em;
  opacity: 0.55;
  transition: opacity 0.18s ease, background-color 0.18s ease;
}
.hud-lb-seg-btn:first-child {
  border-radius: 999px 0 0 999px;
}
.hud-lb-seg-btn:last-child {
  border-radius: 0 999px 999px 0;
  border-left: none;
}
.hud-lb-seg-btn.is-on {
  opacity: 1;
  border-color: rgba(255, 255, 255, 0.75);
  background: rgba(255, 255, 255, 0.10);
}
.hud-lb-seg-btn:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}

/* Shop pane (trophy overlay third destination) */
.hud-board-shop {
  margin-top: 1.6vh;
  overflow-y: auto;
  max-height: 58vh;
}
.hud-board-shop[hidden] {
  display: none;
}
.hud-shop-bal {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 0.4vh 2px 0;
}
.hud-shop-bal-label {
  opacity: 0.66;
  font-size: clamp(10px, 1.5vmin, 12px);
  font-weight: 300;
  letter-spacing: 0.24em;
}
.hud-shop-bal-val {
  font-size: clamp(13px, 2vmin, 16px);
  font-weight: 300;
  letter-spacing: 0.12em;
  font-variant-numeric: lining-nums tabular-nums;
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.3);
}
```

- [ ] **Step 9: Run pw-shop, verify A-F pass** (A-C must still pass: the death screen was not touched).

- [ ] **Step 10: Reconcile pw-tiers.** In `SCRATCH\pw-tiers.js` `openRecordsTab`, change `.hud-board .hud-lb-tab[data-scope="records"]` to `.hud-board .hud-lb-tab[data-pane="records"]`. Run pw-tiers — Expected: all PASS lines. Run `pw-boards.js`; if it clicks `[data-scope="day"|"all"]` tabs, update those to `.hud-lb-seg-btn[data-scope="day"|"all"]` (the board pane is the landing pane, so no extra click needed first) and any records-tab selector to `[data-pane="records"]`; rerun to PASS. Behavior note: the overlay now reopens on the board pane with the scope preserved (it used to force ALL TIME after a records visit) — if a suite asserted that forced reset, update the assertion to the new contract.

- [ ] **Step 11: Commit.**

```bash
git add hud.js hud.css
git commit -m "Overlay restructure: BOARD/RECORDS/SHOP tabs + scope segment"
```

---

### Task 3: Worlds — catalog, hud:world event, palette/chime/quip consumers

**Files:**
- Modify: `hud.js` (keys + catalog after `DAILY_KEY`, quip packs after `QUIPS` ~line 538, `nextQuip` ~line 542, gift toast in `applyScore` ~line 1047, boot broadcast in `init` ~line 1293)
- Modify: `visuals.js` (`HUE_FAMILIES` ~line 73 → `WORLD_STYLES`, `blockHSL` ~line 157, `computeBgTargets` ~line 168, `pickRunPalette` ~line 185, listener at the CustomEvent block ~line 1144, version bump)
- Modify: `audio.js` (`LADDER`/`BASE_HZ` ~lines 33-34 → `WORLD_SOUND`, `playSliced` ~line 128, `playPerfect` ~line 145, listener + `dbg.world`, header + version bump)
- Test: `SCRATCH\pw-shop.js` (sections G-I)

**Interfaces:**
- Consumes: Task 1's storage idioms; existing `QUIPS`/`quipBag`/`nextQuip`; existing toast crossing loop; visuals' `S.inited`/`pickRunPalette`/`computeBgTargets`/`recolorAll`; audio's `dbg`.
- Produces: `WORLD_KEY='stack-world'`, `OWNED_KEY='stack-worlds'`, `WORLDS` array + `WORLD_BY_ID` (entry shape: `{ id, name, price, giftAt, sky, block }` — sky/block are the card-art CSS strings), `readWorld()`, `writeWorld(id)`, `readOwned()`, `writeOwned(arr)`, `ownsWorld(id)`, `grantWorld(id)` → bool (true when newly granted), `equipWorld(id)`, `fireWorld(id)`, event **`hud:world` detail `{ id }`** (fired at boot deferred 0ms, and on every equip), `WORLD_QUIPS`, `StackAudio.debug.world` (resolved id string). Task 4 consumes the catalog + all helpers; Task 5 consumes nothing new here.

- [ ] **Step 1: Extend the test (fails first).** Append to pw-shop before the final log:

```js
  // G: preseeded World reaches audio (debug.world) and the quip pack.
  const SUNSET_QUIPS = [
    'The sun set on that one.', 'Golden hour, leaden hands.',
    'Dusk claims another architect.', 'That tower rode into the sunset. Sideways.',
    'Even the horizon looked away.', 'Warm colors, cold result.',
    'The evening forgives; the ledge does not.', 'Painted skies, unpainted landing.'
  ];
  t = await boot(browser, { 'stack-world': 'sunset', 'stack-daily': TODAY });
  /* Empty board for this section: with rows present, the death-time roast
     would overwrite the quip and the pack assertion below would flake. A
     later-registered route wins in Playwright, so this shadows boot()'s. */
  await t.context.route('**/rest/v1/stack_scores*', route => {
    const m = route.request().method();
    if (m === 'POST') return route.fulfill({ status: 201, body: '' });
    if (m === 'HEAD') return route.fulfill({ status: 206, headers: {
      'content-range': '0-0/0', 'access-control-expose-headers': 'Content-Range' } });
    return route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/0' }, body: '[]' });
  });
  await t.page.waitForTimeout(400);
  s = await t.page.evaluate(() => window.StackAudio.debug.world);
  if (s !== 'sunset') throw new Error('FAIL G audio world: ' + s);
  await playRun(t.page, [['drop', 0.5], ['drop', 6]]);
  s = await t.page.evaluate(() => document.querySelector('.hud-over-quip').textContent);
  if (SUNSET_QUIPS.indexOf(s) < 0) throw new Error('FAIL G quip pack: ' + s);
  if (t.issues.length) throw new Error('FAIL G issues: ' + JSON.stringify(t.issues));
  await t.context.close();
  console.log('G PASS: sunset reaches audio + quips');

  // H: equip event retargets the visual palette; unknown ids fall back.
  t = await boot(browser, {});
  await t.page.waitForTimeout(400);
  const pal1 = await t.page.evaluate(() => window.StackVisuals.getPalette().bg);
  await t.page.evaluate(() => window.dispatchEvent(
    new CustomEvent('hud:world', { detail: { id: 'neon' } })));
  await t.page.waitForTimeout(1400);   /* bg lerps per-frame toward the target */
  const pal2 = await t.page.evaluate(() => window.StackVisuals.getPalette().bg);
  if (pal1 === pal2) throw new Error('FAIL H palette static: ' + pal1);
  await t.page.evaluate(() => window.dispatchEvent(
    new CustomEvent('hud:world', { detail: { id: 'bogus' } })));
  await t.page.waitForTimeout(200);
  s = await t.page.evaluate(() => window.StackAudio.debug.world);
  if (s !== 'classic') throw new Error('FAIL H fallback: ' + s);
  if (t.issues.length) throw new Error('FAIL H issues: ' + JSON.stringify(t.issues));
  await t.context.close();
  console.log('H PASS: palette swap + unknown-id fallback');

  // I: gifts. Boot with best 80 grants marble silently; a live crossing of
  // 70 shows the WORLD UNLOCKED toast.
  t = await boot(browser, { 'stack-best': '80' });
  await t.page.waitForTimeout(500);
  s = await t.page.evaluate(() => ({
    owned: localStorage.getItem('stack-worlds'),
    toast: document.querySelector('.hud-toast').textContent
  }));
  if (!s.owned || s.owned.indexOf('marble') < 0 || s.toast !== '')
    throw new Error('FAIL I silent grant: ' + JSON.stringify(s));
  await t.context.close();
  t = await boot(browser, { 'stack-best': '50', 'stack-daily': TODAY });
  await t.page.touchscreen.tap(195, 500);
  await t.page.waitForTimeout(600);
  await t.page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 300));
    window.StackCore.debug.build(70, 0);
  });
  await t.page.waitForTimeout(800);
  s = await t.page.evaluate(() => ({
    toast: document.querySelector('.hud-toast').textContent,
    owned: localStorage.getItem('stack-worlds')
  }));
  if (s.toast !== '▲ MARBLE · WORLD UNLOCKED' || !s.owned || s.owned.indexOf('marble') < 0)
    throw new Error('FAIL I crossing: ' + JSON.stringify(s));
  if (t.issues.length) throw new Error('FAIL I issues: ' + JSON.stringify(t.issues));
  await t.context.close();
  console.log('I PASS: silent grant + crossing toast');
```

- [ ] **Step 2: Run, verify G fails** (`StackAudio.debug.world` is undefined).

- [ ] **Step 3: hud.js — keys + catalog.** After the `DAILY_KEY` line add:

```js
  var WORLD_KEY = 'stack-world';    /* equipped World id */
  var OWNED_KEY = 'stack-worlds';   /* owned ids beyond classic (JSON array) */

  /* Worlds catalog — hud-owned presentation data (names, prices, card art,
     quip packs). visuals.js and audio.js keep their own per-World tables
     under the same ids; the only coupling is the hud:world event. */
  var WORLDS = [
    { id: 'classic',  name: 'CLASSIC',  price: 0,    giftAt: 0,
      sky: 'linear-gradient(180deg,#232c3d,#141a26)', block: '#7ec8e3' },
    { id: 'sunset',   name: 'SUNSET',   price: 600,  giftAt: 0,
      sky: 'linear-gradient(180deg,#4a2440,#2a1830)', block: '#ff9a76' },
    { id: 'neon',     name: 'NEON',     price: 1000, giftAt: 0,
      sky: 'linear-gradient(180deg,#12101e,#0a0912)', block: '#22e0d4' },
    { id: 'deepsea',  name: 'DEEP SEA', price: 1500, giftAt: 0,
      sky: 'linear-gradient(180deg,#0e2436,#081521)', block: '#2e9cc4' },
    { id: 'marble',   name: 'MARBLE',   price: 0,    giftAt: 70,
      sky: 'linear-gradient(180deg,#3a3830,#211f1a)', block: '#f0ece4' },
    { id: 'obsidian', name: 'OBSIDIAN', price: 0,    giftAt: 250,
      sky: 'linear-gradient(180deg,#241c1a,#120e0d)', block: '#33303c' }
  ];
  var WORLD_BY_ID = {};
  (function () {
    for (var i = 0; i < WORLDS.length; i++) { WORLD_BY_ID[WORLDS[i].id] = WORLDS[i]; }
  })();
```

- [ ] **Step 4: hud.js — storage + event helpers.** After `writeDaily` add:

```js
  function readWorld() {
    try {
      var v = String(window.localStorage.getItem(WORLD_KEY) || '');
      return WORLD_BY_ID[v] ? v : 'classic';
    } catch (err) { return 'classic'; }
  }

  function writeWorld(v) {
    try { window.localStorage.setItem(WORLD_KEY, v); } catch (err) { /* ignore */ }
  }

  function readOwned() {
    try {
      var v = JSON.parse(window.localStorage.getItem(OWNED_KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (err) { return []; }
  }

  function writeOwned(arr) {
    try { window.localStorage.setItem(OWNED_KEY, JSON.stringify(arr)); } catch (err) { /* ignore */ }
  }

  function ownsWorld(id) {
    if (id === 'classic') { return true; }
    var owned = readOwned();
    for (var i = 0; i < owned.length; i++) { if (owned[i] === id) { return true; } }
    return false;
  }

  /* True when the grant is new — drives the gift-toast wording. */
  function grantWorld(id) {
    if (ownsWorld(id)) { return false; }
    var owned = readOwned();
    owned.push(id);
    writeOwned(owned);
    return true;
  }

  function fireWorld(id) {
    try { window.dispatchEvent(new CustomEvent('hud:world', { detail: { id: id } })); }
    catch (err) { /* ignore */ }
  }

  function equipWorld(id) {
    if (!WORLD_BY_ID[id]) { return; }
    writeWorld(id);
    quipBag = [];   /* the next death draws from the new World's pack */
    fireWorld(id);
  }
```

- [ ] **Step 5: hud.js — quip packs.** After the `QUIPS` array add (each pack 8 static English lines, no `{n}` slots — the name-bearing roasts stay universal):

```js
  /* Per-World death quips: a World's pack replaces the generic pool while
     it is equipped (classic keeps QUIPS). Static lines only — the
     name-interpolating roasts below stay universal, LRM guard and all. */
  var WORLD_QUIPS = {
    sunset: [
      'The sun set on that one.',
      'Golden hour, leaden hands.',
      'Dusk claims another architect.',
      'That tower rode into the sunset. Sideways.',
      'Even the horizon looked away.',
      'Warm colors, cold result.',
      'The evening forgives; the ledge does not.',
      'Painted skies, unpainted landing.'
    ],
    neon: [
      'Flatline in neon.',
      'The grid rejects your geometry.',
      'Insert coin to pretend that did not happen.',
      'Your tower just rage-quit reality.',
      'Signal lost. Tower too.',
      'That drop lagged. The blame does not.',
      'The synthwave stops for no one.',
      'Game over, glow on.'
    ],
    deepsea: [
      'The tower sleeps with the fishes.',
      'Pressure: 1, you: 0.',
      'That block just joined the wreck.',
      'Somewhere below, a crab applauds.',
      'The abyss reviewed your tower: one star.',
      'Sunk without a bubble.',
      'The tide keeps what you drop.',
      'Depth achieved. Height, less so.'
    ],
    marble: [
      'The museum declines your donation.',
      'Carved in marble: "almost".',
      'The sculptors union has questions.',
      'A classical collapse, technically.',
      'Ruins are just towers with history.',
      'The gallery lights dim in respect.',
      'Polished start, gravel finish.',
      'Antiquity called. It wants distance.'
    ],
    obsidian: [
      'The volcano accepts your offering.',
      'Forged in fire, dropped in shame.',
      'The lava is not even impressed.',
      'Obsidian: sharp. That drop: not.',
      'Ash to ash, block to floor.',
      'The mountain keeps the pieces.',
      'Dark glass, darker landing.',
      'Cooled, hardened, toppled.'
    ]
  };

  function activeQuips() {
    return WORLD_QUIPS[readWorld()] || QUIPS;
  }
```

In `nextQuip`, change `quipBag = QUIPS.slice();` to `quipBag = activeQuips().slice();`.

- [ ] **Step 6: hud.js — gift toast + boot broadcast.** In `applyScore`, replace the crossing loop body's `showToast('▲ ' + TIERS[ti][0]);` with:

```js
          var tn = TIERS[ti][0];
          /* Tier-gift Worlds ride the crossing toast (spec: Marble and
             Obsidian each carry a World). grantWorld is false if some
             corrupt store already owned it — then the plain toast shows. */
          if (tn === 'MARBLE' && grantWorld('marble')) { showToast('▲ MARBLE · WORLD UNLOCKED'); }
          else if (tn === 'OBSIDIAN' && grantWorld('obsidian')) { showToast('▲ OBSIDIAN · WORLD UNLOCKED'); }
          else { showToast('▲ ' + tn); }
```

In `init()`, after `applyReady();` add:

```js
    /* Boot World broadcast, deferred one task: script order is core,
       visuals, hud, audio — a synchronous fire here would beat audio.js's
       listener registration. All four scripts parse before any queued task
       runs, so a 0ms timer is deterministic, not a race. Gifts earned
       before this feature shipped arrive silently here, never equipped. */
    setTimeout(function () {
      var b = readBest();
      for (var i = 0; i < WORLDS.length; i++) {
        if (WORLDS[i].giftAt > 0 && b >= WORLDS[i].giftAt) { grantWorld(WORLDS[i].id); }
      }
      fireWorld(readWorld());
    }, 0);
```

- [ ] **Step 7: visuals.js — World styles.** Replace the `HUE_FAMILIES` line (~73) with:

```js
  // Per-World palette + sky (marketplace Wave A), keyed by the ids the HUD
  // broadcasts on hud:world; unknown ids fall back to classic. classic
  // reproduces the pre-Worlds look exactly. All numbers tunable.
  var WORLD_STYLES = {
    classic: {
      families: [148, 164, 180, 198, 214, 232, 256, 284, 312],
      satBias: 0, lightBias: 0,
      sky: { base: 202, swing: 11, innerS: 0.66, innerLBias: -0.03,
             outerS: 0.74, outerL: 0.205, beamS: 0.55, beamL: 0.82 }
    },
    sunset: {
      families: [352, 8, 18, 26, 336],
      satBias: 0.06, lightBias: 0.01,
      sky: { base: 322, swing: 9, innerS: 0.52, innerLBias: -0.10,
             outerS: 0.58, outerL: 0.14, beamS: 0.50, beamL: 0.78 }
    },
    neon: {
      families: [168, 190, 258, 286, 310],
      satBias: 0.24, lightBias: -0.02,
      sky: { base: 252, swing: 8, innerS: 0.45, innerLBias: -0.28,
             outerS: 0.55, outerL: 0.05, beamS: 0.60, beamL: 0.70 }
    },
    deepsea: {
      families: [172, 188, 202, 216, 230],
      satBias: 0.04, lightBias: -0.06,
      sky: { base: 210, swing: 8, innerS: 0.62, innerLBias: -0.16,
             outerS: 0.72, outerL: 0.10, beamS: 0.55, beamL: 0.75 }
    },
    marble: {
      families: [42, 48, 54],
      satBias: -0.38, lightBias: 0.16,
      sky: { base: 46, swing: 6, innerS: 0.22, innerLBias: -0.02,
             outerS: 0.30, outerL: 0.16, beamS: 0.35, beamL: 0.88 }
    },
    obsidian: {
      families: [12, 22, 355],
      satBias: -0.10, lightBias: -0.26,
      sky: { base: 8, swing: 6, innerS: 0.35, innerLBias: -0.22,
             outerS: 0.45, outerL: 0.055, beamS: 0.55, beamL: 0.62 }
    }
  };
  var worldStyle = WORLD_STYLES.classic;

  function clampRange(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
```

- [ ] **Step 8: visuals.js — parameterized formulas.** Replace `blockHSL` with:

```js
  function blockHSL(level, depth) {
    var f = Math.min(Math.max(depth, 0) / CFG.depthSpan, 1);
    f = f * (2 - f); // ease-out: the first few levels below the top deepen fast
    return {
      h: S.hueStart + level * S.hueStep,
      s: clampRange(0.60 + 0.24 * f + worldStyle.satBias, 0.04, 1),
      l: clampRange(0.575 - 0.16 * f + 0.012 * Math.sin(level * 1.7) + worldStyle.lightBias, 0.08, 0.92),
      op: 0.88 + 0.06 * f
    };
  }
```

Replace the first three lines of `computeBgTargets` (through the `S.bgTarget = {...}` assignment) with:

```js
  function computeBgTargets() {
    var sky = worldStyle.sky;
    var h = sky.base + sky.swing * Math.sin(S.level * 0.05 + 0.4);
    var l = 0.585 + 0.03 * Math.sin(S.level * 0.03 + 1.7);
    S.bgTarget = {
      inner: hsl(h - 6, sky.innerS, l + sky.innerLBias),
      outer: hsl(h + 10, sky.outerS, sky.outerL),
      beam: hsl(h - 16, sky.beamS, sky.beamL)
    };
```

(the `if (!S.bgCur)` tail stays as is). Replace `pickRunPalette` with:

```js
  function pickRunPalette() {
    var fam = worldStyle.families;
    S.hueStart = fam[Math.floor(Math.random() * fam.length)];
    S.hueStep = (Math.random() < 0.5 ? -1 : 1) * (CFG.hueStep * (0.85 + Math.random() * 0.5));
  }
```

`CFG.bgBase`/`CFG.bgSwing` are now unread — delete those two lines from `CFG`. Bump `version` to `'2.1.0'`.

- [ ] **Step 9: visuals.js — listener.** In the CustomEvent wiring block (next to the `stack:reset` listener) add:

```js
  window.addEventListener('hud:world', function (e) {
    var id = e && e.detail ? String(e.detail.id) : '';
    worldStyle = WORLD_STYLES[id] || WORLD_STYLES.classic;
    if (!S.inited) return;   // init's own pickRunPalette/computeBgTargets read worldStyle
    // Equip preview is immediate: the sky retargets (per-frame lerp) and
    // standing blocks recolor into the new families. Runs never see a
    // mid-run change; the shop is unreachable while playing.
    pickRunPalette();
    computeBgTargets();
    recolorAll();
  });
```

Also document the event in the header comment's CustomEvent list: `'hud:world'   { id }  active World changed (palette + sky swap)`.

- [ ] **Step 10: audio.js — World voices.** Replace the `LADDER`/`BASE_HZ` lines (33-34) with:

```js
  /* Per-World chime voices: base note + scale per World, same synthesis.
     Major pentatonic for the bright Worlds, minor pentatonic for the deep
     and dark ones; tap is the sliced-placement thunk center. Keyed by the
     ids the HUD broadcasts on hud:world; unknown ids fall back to classic. */
  var WORLD_SOUND = {
    classic:  { base: 523.25, tap: 440, ladder: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24] },
    sunset:   { base: 440.00, tap: 392, ladder: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24] },
    neon:     { base: 587.33, tap: 494, ladder: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24] },
    deepsea:  { base: 392.00, tap: 349, ladder: [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24] },
    marble:   { base: 466.16, tap: 415, ladder: [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24] },
    obsidian: { base: 349.23, tap: 311, ladder: [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24] }
  };
  var sound = WORLD_SOUND.classic;
```

In `playSliced`, change the first `tone(...)` line to:

```js
    tone(t, 'triangle', sound.tap + (Math.random() * 30 - 15), 0.35, 0.14);
```

In `playPerfect`, change the frequency line to:

```js
    var f = sound.base * Math.pow(2, sound.ladder[idx] / 12);
```

After `dbg.state = ...` (~line 40) add `dbg.world = 'classic';`. Next to the `hud:mute` listener add:

```js
  window.addEventListener('hud:world', function (e) {
    var id = e && e.detail ? String(e.detail.id) : '';
    var key = WORLD_SOUND[id] ? id : 'classic';
    sound = WORLD_SOUND[key];
    dbg.world = key;
  });
```

Update the header: add `'hud:world' { id }  chime voice follows the active World` to the consumed-events list, add `world` to the documented debug fields, bump `version` to `'1.1.0'`.

- [ ] **Step 11: Run pw-shop, verify A-I pass.** Then run `pw-fixes.js` (audio contract: first-tap unlock must still pass — `dbg.last === 'sliced'` unchanged) and `pw-ghost.js` (visuals still build the ghost). Expected: PASS lines on all three.

- [ ] **Step 12: Commit.**

```bash
git add hud.js visuals.js audio.js
git commit -m "Worlds: catalog, hud:world event, palette/chime/quip packs"
```

---

### Task 4: Shop pane — World cards, two-tap purchase, equip

**Files:**
- Modify: `hud.js` (`buildDom` shop shell from Task 2, els map, `renderShopPane` from Task 2, new arm state + click wiring in `wireOutgoing`, `SHOP_ARM_MS` const near `RESTART_DEDUPE_MS`)
- Modify: `hud.css` (card grid blocks after the `.hud-shop-bal-val` rule)
- Test: `SCRATCH\pw-shop.js` (sections J-M)

**Interfaces:**
- Consumes: Task 2's `boardShop`/`shopBalVal`/`setPane`/`fmtPts`/`renderShopPane` stub; Task 3's `WORLDS`, `WORLD_BY_ID`, `readWorld`, `ownsWorld`, `grantWorld`, `equipWorld`; Task 1's `PTS_KEY`.
- Produces: full `renderShopPane()`, `els.shopCards` (`[{card, chip, world}]`), `els.shopGrid`, `shopArm` state + `disarmShop(rerender)`, `SHOP_ARM_MS = 3000`. Task 5 adds one `renderShopPill()` call into the purchase branch.

- [ ] **Step 1: Extend the test (fails first).** Append before the final log:

```js
  // J: card states. 700 pts: sunset affordable, neon/deepsea dimmed,
  // classic ON, gifts locked, machine inert text present.
  t = await boot(browser, { 'stack-points': '700' });
  await t.page.click('.hud-board-btn');
  await t.page.waitForTimeout(400);
  await t.page.click('.hud-lb-tab[data-pane="shop"]');
  await t.page.waitForTimeout(300);
  const card = id => `.hud-shop-card[data-world="${id}"]`;
  s = await t.page.evaluate(() => {
    const get = id => {
      const c = document.querySelector(`.hud-shop-card[data-world="${id}"]`);
      return { cls: c.className, chip: c.querySelector('.hud-shop-chip').textContent };
    };
    return {
      classic: get('classic'), sunset: get('sunset'), neon: get('neon'),
      marble: get('marble'), machine: document.querySelector('.hud-shop-machine').textContent,
      cards: document.querySelectorAll('.hud-shop-card').length
    };
  });
  if (s.cards !== 6 || s.machine !== 'PRIZE MACHINE · COMING SOON')
    throw new Error('FAIL J shape: ' + JSON.stringify(s));
  if (s.classic.cls.indexOf('is-eq') < 0 || s.classic.chip !== 'ON')
    throw new Error('FAIL J classic: ' + JSON.stringify(s.classic));
  if (s.sunset.cls.indexOf('is-dim') >= 0 || s.sunset.chip !== '600')
    throw new Error('FAIL J sunset: ' + JSON.stringify(s.sunset));
  if (s.neon.cls.indexOf('is-dim') < 0 || s.neon.chip !== '1000')
    throw new Error('FAIL J neon: ' + JSON.stringify(s.neon));
  if (s.marble.cls.indexOf('is-locked') < 0 || s.marble.chip !== 'MARBLE GIFT')
    throw new Error('FAIL J marble: ' + JSON.stringify(s.marble));
  console.log('J PASS: card states');

  // K: two-tap purchase auto-equips and spends exactly the price.
  await t.page.click(card('sunset'));
  await t.page.waitForTimeout(200);
  s = await t.page.evaluate(() =>
    document.querySelector('.hud-shop-card[data-world="sunset"] .hud-shop-chip').textContent);
  if (s !== 'BUY · 600?') throw new Error('FAIL K arm: ' + s);
  await t.page.click(card('sunset'));
  await t.page.waitForTimeout(300);
  s = await t.page.evaluate(() => ({
    pts: localStorage.getItem('stack-points'),
    world: localStorage.getItem('stack-world'),
    owned: localStorage.getItem('stack-worlds'),
    chip: document.querySelector('.hud-shop-card[data-world="sunset"] .hud-shop-chip').textContent,
    bal: document.querySelector('.hud-shop-bal-val').textContent
  }));
  if (s.pts !== '100' || s.world !== 'sunset' || s.owned.indexOf('sunset') < 0 ||
      s.chip !== 'ON' || s.bal !== '100')
    throw new Error('FAIL K buy: ' + JSON.stringify(s));
  // Equip back to an owned World: no spend.
  await t.page.click(card('classic'));
  await t.page.waitForTimeout(200);
  s = await t.page.evaluate(() => ({
    pts: localStorage.getItem('stack-points'),
    world: localStorage.getItem('stack-world'),
    sunsetChip: document.querySelector('.hud-shop-card[data-world="sunset"] .hud-shop-chip').textContent
  }));
  if (s.pts !== '100' || s.world !== 'classic' || s.sunsetChip !== 'OWNED')
    throw new Error('FAIL K equip back: ' + JSON.stringify(s));
  if (t.issues.length) throw new Error('FAIL K issues: ' + JSON.stringify(t.issues));
  await t.context.close();
  console.log('K PASS: two-tap buy + equip');

  // L: the armed state disarms after 3s with nothing spent.
  t = await boot(browser, { 'stack-points': '700' });
  await t.page.click('.hud-board-btn');
  await t.page.waitForTimeout(400);
  await t.page.click('.hud-lb-tab[data-pane="shop"]');
  await t.page.waitForTimeout(300);
  await t.page.click(card('sunset'));
  await t.page.waitForTimeout(3400);
  s = await t.page.evaluate(() => ({
    chip: document.querySelector('.hud-shop-card[data-world="sunset"] .hud-shop-chip').textContent,
    pts: localStorage.getItem('stack-points')
  }));
  if (s.chip !== '600' || s.pts !== '700') throw new Error('FAIL L disarm: ' + JSON.stringify(s));
  console.log('L PASS: 3s disarm, nothing spent');

  // M: negative controls — dimmed, locked, and machine taps change nothing.
  for (const sel of [card('neon'), card('marble'), '.hud-shop-machine']) {
    await t.page.click(sel);
    await t.page.waitForTimeout(150);
  }
  s = await t.page.evaluate(() => ({
    pts: localStorage.getItem('stack-points'),
    world: localStorage.getItem('stack-world'),
    owned: localStorage.getItem('stack-worlds'),
    state: document.getElementById('hud-root').getAttribute('data-state'),
    board: document.getElementById('hud-root').getAttribute('data-board')
  }));
  if (s.pts !== '700' || s.world !== null || s.owned !== null ||
      s.state !== 'title' || s.board !== 'open')
    throw new Error('FAIL M negatives: ' + JSON.stringify(s));
  if (t.issues.length) throw new Error('FAIL M issues: ' + JSON.stringify(t.issues));
  await t.context.close();
  console.log('M PASS: locked/dim/machine taps are inert');
```

- [ ] **Step 2: Run, verify J fails** (zero `.hud-shop-card` elements).

- [ ] **Step 3: Constants + card DOM.** Near `RESTART_DEDUPE_MS` add:

```js
  var SHOP_ARM_MS = 3000;        /* armed BUY confirm window */
```

In `buildDom`, after `boardShop.appendChild(shopBal);` add:

```js
    /* One card per World + the machine tease. Card art is inline style from
       the catalog (sky gradient + three block bars) — decorative CSS values,
       not user data; every text node stays textContent. */
    var shopGrid = el('div', 'hud-shop-grid');
    var shopCards = [];
    for (var wi = 0; wi < WORLDS.length; wi++) {
      var w = WORLDS[wi];
      var card = el('button', 'hud-shop-card');
      card.type = 'button';
      card.setAttribute('data-world', w.id);
      card.setAttribute('aria-label', w.name);
      var prev = el('div', 'hud-shop-prev');
      prev.style.background = w.sky;
      var stack = el('div', 'hud-shop-blocks');
      for (var bi = 0; bi < 3; bi++) {
        var bk = el('span', 'hud-shop-bk');
        bk.style.background = w.block;
        bk.style.width = (22 + bi * 6) + 'px';
        bk.style.opacity = String(1 - (2 - bi) * 0.15);
        stack.appendChild(bk);
      }
      prev.appendChild(stack);
      card.appendChild(prev);
      var meta = el('div', 'hud-shop-meta');
      meta.appendChild(el('span', 'hud-shop-name', w.name));
      var chip = el('span', 'hud-shop-chip', '');
      meta.appendChild(chip);
      card.appendChild(meta);
      shopGrid.appendChild(card);
      shopCards.push({ card: card, chip: chip, world: w });
    }
    var shopMachine = el('div', 'hud-shop-machine', 'PRIZE MACHINE · COMING SOON');
    shopGrid.appendChild(shopMachine);
    boardShop.appendChild(shopGrid);
```

Add `shopGrid: shopGrid, shopCards: shopCards,` to the els map.

- [ ] **Step 4: renderShopPane (full) + arm state.** Replace Task 2's balance-only `renderShopPane` with:

```js
  /* Two-tap purchase state: first tap arms one card, second inside the
     window confirms. No modal — a stray tap can cost at most an armed chip. */
  var shopArm = { id: null, timer: null };

  function disarmShop(rerender) {
    if (shopArm.timer) { clearTimeout(shopArm.timer); }
    var had = shopArm.id != null;
    shopArm.id = null;
    shopArm.timer = null;
    if (had && rerender) { renderShopPane(); }
  }

  /* Card states: ON (equipped) / OWNED (tap equips) / price (tap-tap buys)
     / gift lock / dimmed when unaffordable. Purchases auto-equip (spec);
     gifts never do. */
  function renderShopPane() {
    var bal = readInt(PTS_KEY);
    els.shopBalVal.textContent = fmtPts(bal);
    var equipped = readWorld();
    for (var i = 0; i < els.shopCards.length; i++) {
      var c = els.shopCards[i];
      var w = c.world;
      var cls = 'hud-shop-card';
      var chip = '';
      if (w.id === equipped) { cls += ' is-eq'; chip = 'ON'; }
      else if (ownsWorld(w.id)) { chip = 'OWNED'; }
      else if (w.giftAt > 0) { cls += ' is-locked'; chip = w.name + ' GIFT'; }
      else if (shopArm.id === w.id) { cls += ' is-armed'; chip = 'BUY · ' + w.price + '?'; }
      else if (bal >= w.price) { chip = String(w.price); }
      else { cls += ' is-dim'; chip = String(w.price); }
      c.card.className = cls;
      c.chip.textContent = chip;
    }
  }
```

- [ ] **Step 5: Click wiring.** In `wireOutgoing` (near the tab handlers) add:

```js
    els.shopGrid.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.hud-shop-card') : null;
      if (!btn) { disarmShop(true); return; }        /* machine or gap: just disarm */
      var id = btn.getAttribute('data-world');
      var w = WORLD_BY_ID[id];
      if (!w) { return; }
      if (id === readWorld()) { return; }            /* already on */
      if (ownsWorld(id)) {                            /* owned: equip */
        disarmShop(false);
        equipWorld(id);
        renderShopPane();
        return;
      }
      if (w.giftAt > 0) { disarmShop(true); return; } /* locked gift */
      var bal = readInt(PTS_KEY);
      if (bal < w.price) { disarmShop(true); return; }
      if (shopArm.id === id) {                        /* second tap: buy */
        disarmShop(false);
        writeInt(PTS_KEY, bal - w.price);
        grantWorld(id);
        equipWorld(id);   /* buying means wanting it on (spec) */
        renderShopPane();
        return;
      }
      disarmShop(false);                              /* first tap: arm */
      shopArm.id = id;
      shopArm.timer = setTimeout(function () { disarmShop(true); }, SHOP_ARM_MS);
      renderShopPane();
    });
    for (var ci = 0; ci < els.shopCards.length; ci++) {
      keepKeysLocal(els.shopCards[ci].card);
    }
```

(`keepKeysLocal` is declared later in `wireOutgoing` — function declarations hoist, same as the existing early calls.)

- [ ] **Step 6: CSS.** After the `.hud-shop-bal-val` rule add:

```css
.hud-shop-grid {
  margin-top: 1.2vh;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
.hud-shop-card {
  pointer-events: auto;
  cursor: pointer;
  display: block;
  width: 100%;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.05);
  overflow: hidden;
  text-align: left;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, opacity 0.18s ease, transform 0.18s ease;
}
.hud-shop-card:active {
  transform: scale(0.97);
}
.hud-shop-card:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
.hud-shop-card.is-eq {
  border-color: rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 14px rgba(255, 255, 255, 0.25), inset 0 0 8px rgba(255, 255, 255, 0.08);
}
.hud-shop-card.is-armed {
  border-color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.14);
}
.hud-shop-card.is-locked,
.hud-shop-card.is-dim {
  opacity: 0.5;
}
.hud-shop-prev {
  height: clamp(44px, 7vh, 62px);
  position: relative;
}
.hud-shop-blocks {
  position: absolute;
  left: 50%;
  bottom: 5px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.hud-shop-bk {
  display: block;
  height: 6px;
  border-radius: 2px;
}
.hud-shop-meta {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 6px;
  padding: 6px 8px 7px;
}
.hud-shop-name {
  font-size: clamp(9px, 1.4vmin, 11px);
  font-weight: 300;
  letter-spacing: 0.14em;
  white-space: nowrap;
}
.hud-shop-chip {
  font-size: clamp(8px, 1.3vmin, 10px);
  font-weight: 300;
  letter-spacing: 0.1em;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 999px;
  padding: 0.2em 0.6em;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.hud-shop-card.is-eq .hud-shop-chip {
  border-color: rgba(255, 255, 255, 0.8);
}
.hud-shop-machine {
  grid-column: 1 / -1;
  border: 1px dashed rgba(255, 255, 255, 0.3);
  border-radius: 12px;
  padding: 1.4vh 8px;
  text-align: center;
  font-size: clamp(9px, 1.4vmin, 11px);
  font-weight: 300;
  letter-spacing: 0.2em;
  opacity: 0.5;
}
```

- [ ] **Step 7: Run pw-shop, verify A-M pass.** The buy in K must also visibly change the sky behind the overlay (H already proves the palette contract; no extra assert needed).

- [ ] **Step 8: Commit.**

```bash
git add hud.js hud.css
git commit -m "Shop pane: World cards, two-tap purchase, tier gifts UI"
```

---

### Task 5: Title SHOP pill

**Files:**
- Modify: `hud.js` (`buildDom` root furniture ~line 402, els map, `renderTitleBest` ~line 469, purchase branch from Task 4, `wireOutgoing`)
- Modify: `hud.css` (pill block after `.hud-mute-btn` rules; one line in the reduced-motion block)
- Test: `SCRATCH\pw-shop.js` (sections N-P)

**Interfaces:**
- Consumes: Task 2's `openBoardTo('shop')` + `fmtPts`; Task 1's `PTS_KEY`.
- Produces: `els.shopPill` (`.hud-shop-pill`), `renderShopPill()`. Safety contract: the pill is a `<button>`, so core.js's global tap handler ignores it (`closest('button, a, input, [data-ui]')`), and it sits outside `els.title`, so the HUD's own tap-to-start never sees it.

- [ ] **Step 1: Extend the test (fails first).** Append before the final log:

```js
  // N: pill on the title with the formatted balance; gone while playing
  // and on the death screen.
  t = await boot(browser, { 'stack-points': '1240', 'stack-daily': TODAY });
  s = await t.page.evaluate(() => ({
    text: document.querySelector('.hud-shop-pill').textContent,
    op: getComputedStyle(document.querySelector('.hud-shop-pill')).opacity
  }));
  if (s.text !== 'SHOP · 1,240' || Number(s.op) === 0)
    throw new Error('FAIL N title pill: ' + JSON.stringify(s));
  await t.page.touchscreen.tap(195, 500);
  await t.page.waitForTimeout(700);
  s = await t.page.evaluate(() => ({
    op: getComputedStyle(document.querySelector('.hud-shop-pill')).opacity,
    pe: getComputedStyle(document.querySelector('.hud-shop-pill')).pointerEvents
  }));
  if (Number(s.op) !== 0 || s.pe !== 'none')
    throw new Error('FAIL N playing pill: ' + JSON.stringify(s));
  await t.page.evaluate(() => window.StackCore.debug.drop(6));
  await t.page.waitForSelector('#hud-root[data-state="over"]', { timeout: 5000 });
  await t.page.waitForTimeout(700);
  s = await t.page.evaluate(() =>
    getComputedStyle(document.querySelector('.hud-shop-pill')).opacity);
  if (Number(s) !== 0) throw new Error('FAIL N over pill: ' + s);
  console.log('N PASS: pill title-only');

  // O: pill tap opens the overlay on SHOP without starting a run.
  await t.page.waitForTimeout(900);
  await t.page.click('.hud-over-menu');
  await t.page.waitForTimeout(700);
  await t.page.click('.hud-shop-pill');
  await t.page.waitForTimeout(400);
  s = await t.page.evaluate(() => ({
    board: document.getElementById('hud-root').getAttribute('data-board'),
    on: (document.querySelector('.hud-lb-tab.is-on') || {}).textContent,
    shopVisible: getComputedStyle(document.querySelector('.hud-board-shop')).display !== 'none',
    state: document.getElementById('hud-root').getAttribute('data-state'),
    phase: window.StackCore.getTowerState().phase
  }));
  if (s.board !== 'open' || s.on !== 'SHOP' || !s.shopVisible ||
      s.state !== 'title' || s.phase !== 'ready')
    throw new Error('FAIL O pill open: ' + JSON.stringify(s));
  console.log('O PASS: pill opens shop, starts nothing');

  // P: balance on the pill updates after a scoring run + MENU.
  await t.page.keyboard.press('Escape');
  await t.page.waitForTimeout(400);
  await playRun(t.page, [['drop', 0.5], ['drop', 6]]);
  await t.page.waitForTimeout(900);
  await t.page.click('.hud-over-menu');
  await t.page.waitForTimeout(700);
  s = await t.page.evaluate(() => document.querySelector('.hud-shop-pill').textContent);
  if (s !== 'SHOP · 1,241') throw new Error('FAIL P refresh: ' + s);
  if (t.issues.length) throw new Error('FAIL P issues: ' + JSON.stringify(t.issues));
  await t.context.close();
  console.log('P PASS: pill balance refresh');
```

- [ ] **Step 2: Run, verify N fails** (no `.hud-shop-pill`).

- [ ] **Step 3: DOM + render.** In `buildDom`, after the `muteBtn` construction add:

```js
    /* Title shop pill (Wave A round-2 pick: bottom-center + live balance).
       Edge chrome like the corner buttons — never part of the center
       composition. A <button>, so core's global tap handler ignores it. */
    var shopPill = el('button', 'hud-shop-pill', 'SHOP');
    shopPill.type = 'button';
    shopPill.setAttribute('aria-label', 'Open the shop');
```

Append `root.appendChild(shopPill);` next to the other root children (after `muteBtn`), and add `shopPill: shopPill,` to the els map. Replace `renderTitleBest` with:

```js
  function renderTitleBest() {
    var best = readBest();
    els.titleBest.textContent = best > 0 ? 'BEST ' + best : '';
    renderShopPill();
  }

  function renderShopPill() {
    els.shopPill.textContent = 'SHOP · ' + fmtPts(readInt(PTS_KEY));
  }
```

(`renderShopPill` is hoisted; `renderTitleBest` already runs on every title entry, which is the only state where the pill is visible.)

- [ ] **Step 4: Wiring + purchase refresh.** In `wireOutgoing` add:

```js
    els.shopPill.addEventListener('click', function () {
      if (state.mode !== 'title') { return; }
      openBoardTo('shop');
    });
```

and `keepKeysLocal(els.shopPill);` next to the other `keepKeysLocal` calls. In Task 4's purchase branch, after the `renderShopPane();` that follows `equipWorld(id);` add one line:

```js
        renderShopPill();   /* the title pill must not show a stale balance */
```

- [ ] **Step 5: CSS.** After the `.hud-mute-btn.is-muted .hud-mute-wave` rule add:

```css
/* Title shop pill: bottom-center chrome, title state only */
.hud-shop-pill {
  position: fixed;
  left: 50%;
  bottom: calc(max(2.6vh, env(safe-area-inset-bottom, 0px)) + 1vh);
  transform: translateX(-50%);
  z-index: 110;
  pointer-events: none;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.07);
  border-radius: 999px;
  padding: 0.5em 1.35em 0.5em 1.57em; /* extra left pad balances letter-spacing */
  font-size: clamp(11px, 1.7vmin, 14px);
  font-weight: 300;
  letter-spacing: 0.22em;
  font-variant-numeric: lining-nums tabular-nums;
  opacity: 0;
  box-shadow: 0 0 14px rgba(255, 255, 255, 0.18);
  transition: opacity 0.3s ease, background-color 0.18s ease, transform 0.18s ease;
}
#hud-root[data-state="title"] .hud-shop-pill {
  opacity: 0.85;
  pointer-events: auto;
}
.hud-shop-pill:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.15);
}
.hud-shop-pill:active {
  transform: translateX(-50%) scale(0.95);
}
.hud-shop-pill:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 3px;
}
```

In the reduced-motion block's grouped selector list (the one ending `.hud-mute-btn`), add `#hud-root .hud-shop-pill` to the list.

- [ ] **Step 6: Run pw-shop, verify A-P pass.**

- [ ] **Step 7: Commit.**

```bash
git add hud.js hud.css
git commit -m "Title shop pill: bottom-center, live balance, opens SHOP tab"
```

---

### Task 6: Full reconciliation, offline rebuild, deploy, live verify

**Files:**
- Modify (as needed, tests only unless a real bug surfaces): `SCRATCH\pw-boards.js`, `SCRATCH\pw-density2.js`, `SCRATCH\pw-density3.js`, `SCRATCH\pw-deathlines.js`
- Rebuild: `Stack.html` via `scripts/build-offline.mjs`
- No source edits expected; if a suite exposes a real regression, fix it in the owning file and rerun everything.

- [ ] **Step 1: Full local sweep.** Run every suite against local index.html: pw-shop, pw-tiers, pw-boards, pw-deathlines, pw-density1, pw-density2, pw-density3, pw-fixes, pw-save, pw-ghost, pw-almost, pw-offline-check. Expected: every suite ends with its PASS line. Selector-drift rules for updates: day/all tab clicks → `.hud-lb-seg-btn[data-scope=...]` (board pane is the landing pane); records tab → `.hud-lb-tab[data-pane="records"]`; a suite asserting the overlay reopens on ALL TIME after a records visit updates to the new contract (pane resets to board, scope persists). Distinguish carefully: test-expectation drift gets fixed in the test; anything else is a code bug and blocks the task.

- [ ] **Step 2: Offline rebuild.** Run `node scripts/build-offline.mjs`. Then verify markers survived as UTF-8: `grep -c "hud-shop-pill" Stack.html` ≥ 2, `grep -c "PRIZE MACHINE · COMING SOON" Stack.html` = 1, `grep -c "FIRST RUN ×2" Stack.html` = 1, `grep -c "WORLD UNLOCKED" Stack.html` = 2. Run pw-shop against the offline file (`STACK_URL=file:///.../Stack.html?debug=1` styled like pw-offline-check does, network requests expected to fail to the mocked routes the same way) — if pw-offline-check has its own pattern for the offline file, extend that suite with one shop assertion (SHOP tab opens, balance renders) instead.

- [ ] **Step 3: Commit + push.**

```bash
git add Stack.html
git commit -m "Rebuild offline Stack.html with marketplace Wave A"
git push
```

- [ ] **Step 4: Deploy verification.** Poll `gh api repos/Maores/stack-tower/pages/builds/latest` until `status: "built"` on the pushed commit (~60s). Cache-busted curls (`?v=<timestamp>`) on the live files must show: `stack-points` and `hud:world` and `PRIZE MACHINE` in hud.js, `hud-shop-pill` in hud.css, `WORLD_STYLES` in visuals.js, `WORLD_SOUND` in audio.js.

- [ ] **Step 5: Live suite.** Run pw-shop with `STACK_URL=https://maores.github.io/stack-tower/index.html?debug=1` (the route interception still swallows every leaderboard call — no real rows, as always). Expected: full PASS.

- [ ] **Step 6: Screenshots for Maor.** Capture three live screenshots (emulated iPhone 13): title with the pill, shop tab with the six cards + machine, death screen with the whisper line. Save to SCRATCH and send them in the wrap-up message.

- [ ] **Step 7: Commit any reconciled test scripts note.** Tests live in SCRATCH (gitignored territory — not committed); nothing further to commit. Confirm `git status` is clean.

---

## Self-review checklist (run after writing, before execution)

1. Spec coverage: economy (T1), whisper (T1), tabs+segment+POINTS row (T2), hud:world + consumers + quips + gifts (T3), shop cards + purchase (T4), pill (T5), suites/offline/deploy (T6). Machine COMING SOON card: T4. Percentile relocation rules: T2. No-core-changes: all tasks.
2. Names used across tasks: `PTS_KEY`, `fmtPts`, `readWorld`, `ownsWorld`, `grantWorld`, `equipWorld`, `openBoardTo`, `renderShopPane`, `renderShopPill`, `els.shopCards`, `SHOP_ARM_MS` — defined before first use, single spelling.
3. Copy strings match the Global Constraints block verbatim.
