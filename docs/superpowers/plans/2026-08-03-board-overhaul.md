# Scoreboard overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One all-time board per mode in a fixed-height overlay shell that never moves: full scrollable list with a MY ROW chip, one stale-while-revalidate loading strategy, 44px touch targets. TODAY as a view is deleted; the 24h data window survives for roasts.

**Architecture:** hud.js + hud.css only, plus the offline rebuild. No core.js, visuals.js, audio.js, or backend changes. No event contract changes.

**Tech Stack:** Vanilla ES5 browser JS, Playwright via the playwright-skill wrapper, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-03-board-overhaul-design.md` (percentile decision: option a, delete, confirmed by Maor 2026-08-03).

## Global Constraints

- **hud.js house style:** ES5 in an IIFE. `var` only, no arrow functions, no template literals, `/* */` comments, defensive `try/catch` around storage access, `textContent` only (never `innerHTML`) for anything a player can influence.
- **Run tests through the playwright-skill wrapper.** The repo has no `package.json`, so `node <test>` fails to resolve playwright. The invocation is:
  `cd "C:/Users/maor4/.claude/plugins/cache/playwright-skill/playwright-skill/4.1.0/skills/playwright-skill" && node run.js "<absolute path to test>"`
- **Every test intercepts `**/rest/v1/stack_scores*` for non-GET.** The live table allows anon INSERT and forbids DELETE; one leaked row is permanent. Shape tests pass GETs through (layout stability is a real-data property); simulation tests may fulfill or delay GETs and must say so.
- Tests load `index.html?debug=1` (without the flag `StackCore.debug` is a decoy). Emulated iPhone 13 reports `innerHeight` 664.
- **Hidden-state assertions use `getComputedStyle(el).display`, never `el.hidden`.** An author `display` beats the UA `[hidden]` rule; this project has shipped that bug three times. Any newly hidden element needs its own `[hidden] { display: none; }` rule.
- **The 24h day window is load-bearing outside the view being deleted:** death roasts fetch `scope='day'` rows (`applyRoastOnce`, `rememberTop`), and `warmUp` pre-fetches them. `scopeFilter('day', …)`, `dayFloorIso()`, and the warm slots' `.day` field must survive every deletion in this plan.
- **The mode-race guard stays:** `overlayBoardSeq`, and `refreshOverlayBoard` capturing its mode at issue time. The Hard-mode final review exists because responses once filed under the mode selected at arrival.
- Exact values are non-negotiable: `min(66vh, 460px)`, `44px`, `38px`, `40px`, `max: 50`, 6 skeleton rows.
- Never run an unscoped process kill. Kill only PIDs you started.
- `reference/` and `.superpowers/` are gitignored; test files are run evidence, not shipped code.

---

## File Structure

| File | Change |
|------|--------|
| `hud.js` | T1: seg/scope/percentile deletion. T2: `setColdFloor` removal. T3: full-list render + MY ROW chip. T4: loading strategy. T5: OUTGOING header doc |
| `hud.css` | T1: seg + pct CSS removal. T2: fixed shell, scroll regions, targets. T3: chip + `[hidden]`. T4: skeleton rows. T5: `cursor: default` on inert cards |
| `reference/tests/pw-oneboard.js` | New (T1) |
| `reference/tests/pw-shape.js` | New (T2, extended T4) |
| `reference/tests/pw-fulllist.js` | New (T3) |
| `Stack.html` | Rebuilt (T5) — hud.js/hud.css are inlined; skipping this shipped a stale artifact once already |

---

### Task 1: Delete the TODAY view and the percentile machinery

**Files:**
- Modify: `hud.js` (buildDom ~547-570 and ~661-673, els map ~697-718, `refreshOverlayBoard` ~1515, `setPane` ~1603, `setOverlayMode` ~1630, seg wiring in wireOutgoing, `showPercentile`/`tryPercentile`/`countRows` ~1168-1386, `overlayPctSeq`, `PCT_MIN_ROWS`, `overlayScope`)
- Modify: `hud.css` (`.hud-lb-seg` block ~901, `.hud-board-pct` block ~1169)
- Test: `reference/tests/pw-oneboard.js`

**Interfaces:**
- Consumes: existing `fetchTop(scope, cb, flag, mode)`, `warmRowsFor(scope, mode)`, `renderRows`.
- Produces: `refreshOverlayBoard(showLoading)` reads only the all-time scope. `overlayScope` no longer exists. Later tasks rely on `setPane`/`setOverlayMode` keeping their names and signatures.

- [ ] **Step 1: Write the failing test**

Create `reference/tests/pw-oneboard.js`:

```js
/* One board: the TODAY view and the percentile line are gone, and the 24h
   window still feeds the death-screen roast. POSTs are intercepted; GETs
   pass through (real data) and are LOGGED to prove which scopes fire. */
const { chromium, devices } = require('playwright');
const URL = 'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const fails = [];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const errs = [];
  const gets = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await context.route('**/rest/v1/stack_scores*', route => {
    const req = route.request();
    if (req.method() !== 'GET') { return route.abort(); }
    gets.push(req.url());
    return route.fallback();
  });
  await context.addInitScript(() => {
    try { localStorage.setItem('stack-player-name', 'רוניוס'); } catch (e) {}
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await page.waitForTimeout(900);

  /* A — the view is gone */
  await page.click('.hud-board-btn');
  await page.waitForTimeout(800);
  const a = await page.evaluate(() => ({
    seg: document.querySelectorAll('.hud-lb-seg, .hud-lb-seg-btn').length,
    pct: document.querySelectorAll('.hud-board-pct').length,
    rows: document.querySelectorAll('.hud-board-list li').length
  }));
  console.log('OBS A ' + JSON.stringify(a));
  if (a.seg !== 0) { fails.push('A: seg elements still in the DOM: ' + a.seg); }
  if (a.pct !== 0) { fails.push('A: percentile element still in the DOM: ' + a.pct); }
  if (a.rows < 1) { fails.push('A: board rendered no rows'); }

  /* B — overlay traffic is all-time only, through a mode flip too */
  gets.length = 0;
  await page.evaluate(() => {
    const btns = document.querySelectorAll('.hud-board-mode button');
    for (const b of btns) { if (b.textContent === 'HARD') { b.click(); return; } }
  });
  await page.waitForTimeout(900);
  const overlayDay = gets.filter(u => u.indexOf('created_at=gte.') >= 0);
  console.log('OBS B gets=' + gets.length + ' day=' + overlayDay.length);
  if (overlayDay.length) { fails.push('B: the overlay still queries the day window: ' + overlayDay[0]); }
  if (!gets.length) { fails.push('B: the mode flip fetched nothing at all'); }

  /* C — the day window survives as a data source. The roast consumes day
     rows from the warm cache fetched at BOOT (warmUp fires ~150ms into
     load), so a healthy death makes no fresh day request — asserting one
     at death time was this plan's original mistake and blocked Task 1.
     The deterministic survival signal is the boot fetch itself: it runs
     through scopeFilter('day') and dayFloorIso, exactly the machinery the
     deletion must not touch. `gets` has captured since page load. */
  const bootDay = gets.filter(u => u.indexOf('created_at=gte.') >= 0);
  console.log('OBS C bootDay=' + bootDay.length);
  if (!bootDay.length) { fails.push('C: boot no longer warms the day window — the roast lost its victim pool'); }

  if (errs.length) { fails.push('errors: ' + JSON.stringify(errs)); }
  await browser.close();
  if (fails.length) { console.log('FAIL ' + JSON.stringify(fails, null, 1)); process.exit(1); }
  console.log('PASS: one board, day window alive underneath');
})();
```

- [ ] **Step 2: Run it and watch it fail**

Expected: A fails (`seg elements still in the DOM: 3`, pct 1). B likely fails too (the TODAY tab's request machinery still exists if the seg is on day, but with ALL TIME default it may pass; A alone gates). C passes today (warmUp fires a day GET on every load). If C fails BEFORE your change, stop and report: the boot warm path is already broken and you are not the cause.

Note for section B: `gets.length = 0` before the mode flip resets the capture; section C reads the boot-time entries, so C's filter must run on a capture taken BEFORE that reset — hoist `const bootDay = …` above section B's reset (the ordering in the listing above already reflects this if C's filter line sits before `gets.length = 0`; if you reorder, keep the boot capture intact).

- [ ] **Step 3: Delete the view**

In `hud.js`:

1. buildDom: delete the `boardSeg`/`segDay`/`segAll` creation block and `boardPanel.appendChild(boardSeg)`; delete `boardPct` creation and its append; remove `boardSeg`, `segDay`, `segAll`, `boardPct` from the returned els map (grep the exact keys first).
2. Delete the seg click/keyboard wiring in wireOutgoing (grep `segDay`, `segAll`, and any `setOverlayScope`/`setScope` helper; delete the helper and its `keepKeysLocal` lines).
3. Delete `var overlayScope = …` and every read: in `refreshOverlayBoard` replace the scope resolution with the literal `'all'` (keep `warmRowsFor('all', mode)` and `fetchTop('all', …)`); in `setPane` delete `els.boardSeg.hidden = …`, `els.boardPct.hidden = true;` and the `if (overlayScope === 'day') { showPercentile(); }` branch; in `setOverlayMode` delete line `if (overlayScope === 'day') { showPercentile(); } else { els.boardPct.hidden = true; }`.
4. Delete `showPercentile`, `tryPercentile`, `overlayPctSeq` (declaration and every `++`), `PCT_MIN_ROWS`.
5. `countRows`: grep for callers first. If `tryPercentile` was the only caller, delete it too and say so in the report; if another caller exists, keep it and name the caller.
6. Do NOT touch: `scopeFilter`, `dayFloorIso`, `warmBoard.*.day`, `warmUp`'s day fetch, the death path's `fetchTop('day', …)`.

In `hud.css`: delete the `.hud-lb-seg` / `.hud-lb-seg-btn` block (including any `.is-on` variants) and the `.hud-board-pct` block.

- [ ] **Step 4: Run the test to green, then the neighbors**

`pw-oneboard.js` must pass all three sections. Then run `pw-chase-local.js` and `pw-tiers.js` — untouched territory, must stay green (if `pw-tiers` turns out to touch the seg too, report it and reclassify rather than fixing). `pw-boards.js`, `pw-hard-board.js`, AND `pw-deathlines.js` are EXPECTED to fail from this task (all three assert the seg or the percentile — pw-deathlines' dependence was found during Task 1's block); do not fix them here — that is Task 5's reconciliation. Record their failure signatures in the report.

- [ ] **Step 5: Commit**

```bash
git add hud.js hud.css
git commit -m "One board: the TODAY view and its percentile are gone"
```

---

### Task 2: The fixed shell and the touch targets

**Files:**
- Modify: `hud.css` (`.hud-board-panel` ~817-846, `.hud-board-list/.hud-board-records/.hud-board-shop` ~883-892, `.hud-lb-tab` ~369, mode buttons' rule, `.hud-board-close` ~847)
- Modify: `hud.js` (delete `setColdFloor` and its call sites, ~1511 and inside `refreshOverlayBoard`/`setPane`)
- Test: `reference/tests/pw-shape.js`

**Interfaces:**
- Consumes: T1's simplified `refreshOverlayBoard`.
- Produces: a panel whose height is a constant; Task 3's chip and Task 4's skeletons render inside it. The `.is-cold` class no longer exists.

- [ ] **Step 1: Write the failing test**

Create `reference/tests/pw-shape.js`. It is the diagnostic `pw-board-clunk.js` turned into assertions; reuse its structure (sampling helper, CDP touch drag) but assert instead of observe:

```js
/* Shape invariance: the overlay panel's height must not change by a pixel
   across anything a player can do to it. Live data (GET passes through),
   POSTs intercepted. Also asserts the touch-target minimums. */
const { chromium, devices } = require('playwright');
const URL = 'https://maores.github.io/stack-tower/index.html?debug=1';
const LOCAL = 'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const TARGET = process.env.SHAPE_LIVE ? URL : LOCAL;
const fails = [];

async function heights(page, ms, label) {
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const h = await page.evaluate(() =>
      Math.round(document.querySelector('.hud-board-panel').getBoundingClientRect().height));
    seen.add(h);
    await new Promise(r => setTimeout(r, 55));
  }
  return [...seen];
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await context.route('**/rest/v1/stack_scores*', r =>
    r.request().method() === 'GET' ? r.fallback() : r.abort());

  await page.goto(TARGET, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await page.waitForTimeout(900);
  await page.click('.hud-board-btn');
  await page.waitForTimeout(400);

  const base = await page.evaluate(() =>
    Math.round(document.querySelector('.hud-board-panel').getBoundingClientRect().height));
  console.log('OBS base ' + base);
  const all = new Set([base]);

  async function phase(label, act, ms) {
    await act();
    const hs = await heights(page, ms, label);
    hs.forEach(h => all.add(h));
    console.log('OBS ' + label + ' ' + JSON.stringify(hs));
  }

  const clickText = async (sel, t) => page.evaluate(([s, txt]) => {
    for (const b of document.querySelectorAll(s)) {
      if (b.textContent === txt) { b.click(); return; }
    }
  }, [sel, t]);

  await phase('records', () => page.evaluate(() =>
    document.querySelector('.hud-lb-tab[data-pane="records"]').click()), 700);
  await phase('shop', () => page.evaluate(() =>
    document.querySelector('.hud-lb-tab[data-pane="shop"]').click()), 700);
  await phase('board', () => page.evaluate(() =>
    document.querySelector('.hud-lb-tab[data-pane="board"]').click()), 900);
  await phase('hard', () => clickText('.hud-board-mode button', 'HARD'), 2200);
  await phase('normal', () => clickText('.hud-board-mode button', 'NORMAL'), 1500);
  await phase('reopen', async () => {
    await page.click('.hud-board-close');
    await page.waitForTimeout(450);
    await page.click('.hud-board-btn');
  }, 900);

  if (all.size !== 1) {
    fails.push('panel took ' + all.size + ' distinct heights: ' + JSON.stringify([...all]));
  }

  /* targets */
  const t = await page.evaluate(() => {
    const grab = sel => Array.prototype.map.call(document.querySelectorAll(sel),
      b => Math.round(b.getBoundingClientRect().height));
    return {
      tabs: grab('.hud-lb-tab'),
      mode: grab('.hud-board-mode button'),
      close: grab('.hud-board-close')
    };
  });
  console.log('OBS targets ' + JSON.stringify(t));
  if (t.tabs.some(h => h < 44)) { fails.push('tab under 44px: ' + JSON.stringify(t.tabs)); }
  if (t.mode.some(h => h < 38)) { fails.push('mode button under 38px: ' + JSON.stringify(t.mode)); }
  if (t.close.some(h => h < 40)) { fails.push('close under 40px: ' + JSON.stringify(t.close)); }

  if (errs.length) { fails.push('errors: ' + JSON.stringify(errs)); }
  await browser.close();
  if (fails.length) { console.log('FAIL ' + JSON.stringify(fails, null, 1)); process.exit(1); }
  console.log('PASS: one height, real targets');
})();
```

- [ ] **Step 2: Run it and watch it fail**

Expected (local): multiple distinct heights (today's board/records/shop measure 398/438/425) and every target assertion failing (22/18/34).

- [ ] **Step 3: The shell**

In `hud.css`, `.hud-board-panel`:
- Replace `min-height: min(30vh, 240px);` and `max-height: 82vh;` with `height: min(66vh, 460px);` (66vh is the measured RECORDS pane, 438px, over the emulated 664px viewport; the 460px cap covers desktop).
- Keep the existing comment block but rewrite it to say the panel is fixed and why (one height across panes/modes/loading; the min-height floor failed at 01-08 because a floor below content never engages).
- Delete the `.hud-board-panel.is-cold` rule and its comment.
- Update the close-button clearance: `padding: calc(10px + 40px + 8px) 6vw 3.2vh;` (40px is the new close size from Step 5).

Scroll regions — replace the current shared block:

```css
.hud-board-list,
.hud-board-records,
.hud-board-shop {
  flex: 1 1 auto;
  min-height: 0;
  max-height: none;
  overflow-y: auto;
}
```

In `hud.js`: delete `setColdFloor` (function) and every call (`setColdFloor(...)` appears in `refreshOverlayBoard` twice/thrice and `setPane` once — grep to be exhaustive). The cold-empty case is allowed to render an empty list until Task 4 adds skeletons.

- [ ] **Step 4: The targets**

In `hud.css`:
- `.hud-lb-tab`: add `min-height: 44px;`
- The NORMAL/HARD buttons' rule (grep `boardModeNormal` in hud.js for the class it carries, then find that CSS block): add `min-height: 38px;`
- `.hud-board-close`: `width: 40px; height: 40px;` (from 34).

- [ ] **Step 5: Run to green, both flavors**

`pw-shape.js` local must pass. Then run it once with `SHAPE_LIVE=1` — EXPECTED TO FAIL against production (the fix is not deployed); record the failure as proof the test bites reality, and say so in the report. Then `pw-tiers.js`, `pw-bobo-card.js` (they exercise the panes) must stay green.

- [ ] **Step 6: Commit**

```bash
git add hud.js hud.css
git commit -m "The overlay takes one height and keeps it"
```

---

### Task 3: The full list and the MY ROW chip

**Files:**
- Modify: `hud.js` (`refreshOverlayBoard`'s two `renderRows` calls + the fetch-failure fallback call; buildDom chip element; chip logic)
- Modify: `hud.css` (chip + `[hidden]` rule)
- Test: `reference/tests/pw-fulllist.js`

**Interfaces:**
- Consumes: `renderRows(listEl, statusEl, rows, mine, label, max)` — cap parameter already exists (default 10).
- Produces: `els.boardMyRow`, `updateMyRow()`. Task 4's repaints must call `updateMyRow()` after rendering into `boardList`.

- [ ] **Step 1: Write the failing test**

Create `reference/tests/pw-fulllist.js`:

```js
/* The board renders past 10, scrolls by real touch, and the MY ROW chip
   points at your row without moving a pixel of layout. Live GETs (the
   live board holds ~15 unique names, which is the >10 this needs);
   POSTs intercepted. */
const { chromium, devices } = require('playwright');
const URL = 'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const fails = [];

async function touchDrag(context, page, x, y, dy, steps) {
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove',
      touchPoints: [{ x, y: y + (dy * i / steps) }] });
    await new Promise(r => setTimeout(r, 16));
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await context.route('**/rest/v1/stack_scores*', r =>
    r.request().method() === 'GET' ? r.fallback() : r.abort());
  /* Be a player whose best row sits low on the board, so the chip has
     something to point at: איתי ושביט holds the live board's last rank. */
  await context.addInitScript(() => {
    try { localStorage.setItem('stack-player-name', 'איתי ושביט'); } catch (e) {}
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await page.waitForTimeout(900);
  await page.click('.hud-board-btn');
  await page.waitForTimeout(900);

  /* A — more than 10 rows, and they overflow */
  const a = await page.evaluate(() => {
    const l = document.querySelector('.hud-board-list');
    return { rows: l.querySelectorAll('li').length,
             over: l.scrollHeight > l.clientHeight };
  });
  console.log('OBS A ' + JSON.stringify(a));
  if (a.rows <= 10) { fails.push('A: still capped at 10 (rows=' + a.rows + ')'); }
  if (!a.over) { fails.push('A: list does not overflow, nothing to scroll'); }

  /* B — the chip is up (my row is far down), asserted on computed style,
     and its presence has not moved the panel */
  const b = await page.evaluate(() => {
    const c = document.querySelector('.hud-board-myrow');
    const p = document.querySelector('.hud-board-panel');
    return { exists: !!c,
             display: c ? getComputedStyle(c).display : null,
             text: c ? c.textContent : '',
             panelH: Math.round(p.getBoundingClientRect().height) };
  });
  console.log('OBS B ' + JSON.stringify(b));
  if (!b.exists) { fails.push('B: no chip element'); }
  if (b.display === 'none') { fails.push('B: chip hidden while my row is off-screen'); }
  if (b.text.indexOf('MY ROW') < 0 || b.text.indexOf('#') < 0) {
    fails.push('B: chip text wrong: ' + JSON.stringify(b.text));
  }

  /* C — touch scroll works and does not close the overlay */
  const mid = await page.evaluate(() => {
    const r = document.querySelector('.hud-board-list').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  await touchDrag(context, page, mid.x, mid.y, -160, 8);
  await page.waitForTimeout(350);
  const c = await page.evaluate(() => ({
    scrollTop: document.querySelector('.hud-board-list').scrollTop,
    open: document.querySelector('#hud-root').getAttribute('data-board') === 'open',
    state: document.querySelector('#hud-root').getAttribute('data-state')
  }));
  console.log('OBS C ' + JSON.stringify(c));
  if (!(c.scrollTop > 0)) { fails.push('C: touch drag did not scroll the list'); }
  if (!c.open) { fails.push('C: the drag closed the overlay'); }
  if (c.state !== 'title') { fails.push('C: the drag changed game state to ' + c.state); }

  /* D — tapping the chip centers my row and the chip hides */
  const d0 = await page.evaluate(() => {
    const c = document.querySelector('.hud-board-myrow');
    if (getComputedStyle(c).display === 'none') { return { skipped: true }; }
    c.click();
    return { skipped: false };
  });
  await page.waitForTimeout(900);
  const d = await page.evaluate(() => {
    const c = document.querySelector('.hud-board-myrow');
    const mine = document.querySelector('.hud-board-list .hud-lb-mine');
    const lr = document.querySelector('.hud-board-list').getBoundingClientRect();
    const mr = mine ? mine.getBoundingClientRect() : null;
    return {
      chipDisplay: getComputedStyle(c).display,
      mineVisible: mr ? (mr.top >= lr.top - 2 && mr.bottom <= lr.bottom + 2) : false
    };
  });
  console.log('OBS D ' + JSON.stringify(Object.assign(d0, d)));
  if (!d0.skipped) {
    if (!d.mineVisible) { fails.push('D: chip tap did not bring my row into view'); }
    if (d.chipDisplay !== 'none') { fails.push('D: chip still showing after the row is visible'); }
  }

  /* E — panel height identical with chip shown vs hidden */
  const e = await page.evaluate(() =>
    Math.round(document.querySelector('.hud-board-panel').getBoundingClientRect().height));
  console.log('OBS E panel ' + e + ' vs ' + b.panelH);
  if (e !== b.panelH) { fails.push('E: chip visibility moved the panel ' + b.panelH + ' -> ' + e); }

  if (errs.length) { fails.push('errors: ' + JSON.stringify(errs)); }
  await browser.close();
  if (fails.length) { console.log('FAIL ' + JSON.stringify(fails, null, 1)); process.exit(1); }
  console.log('PASS: the whole board, one chip, zero movement');
})();
```

- [ ] **Step 2: Run it and watch it fail**

Expected: A fails (10 rows, no overflow), B fails (no chip element). If the live board has dropped to ≤10 unique names by run time, say so and seed the GET with a fulfilled 15-row fixture instead — do not weaken assertion A.

- [ ] **Step 3: Uncap the overlay**

In `refreshOverlayBoard`, all three render sites pass the cap:
- warm render: `renderRows(els.boardList, els.boardStatus, warm, me, '', 50);`
- fetch render: `renderRows(els.boardList, els.boardStatus, rows, me, '', 50);`
- device fallback: `renderRows(els.boardList, els.boardStatus, readLocalBoard(mode), me, 'THIS DEVICE ONLY', 50);`

The death-screen call sites (`renderBoard`, `paintSandwich`) keep their explicit `3`. Touch nothing there.

- [ ] **Step 4: The chip**

buildDom, after `boardList` is created:

```js
    /* Floating jump-to-my-row chip: absolutely positioned over the list's
       lower edge, so showing or hiding it cannot move the panel. */
    var boardMyRow = el('button', 'hud-board-myrow');
    boardMyRow.type = 'button';
    boardMyRow.hidden = true;
```

Append it to `boardPanel` after `boardList`, add `boardMyRow: boardMyRow` to the els map.

Chip logic (place near `refreshOverlayBoard`):

```js
  /* The chip points at the row renderRows marked mine. Rank is the row's
     1-based position in the rendered list, which is the deduped board
     order. Hidden whenever the row is on screen, absent, or the pane is
     not the board. */
  function updateMyRow() {
    var chip = els.boardMyRow;
    if (overlayPane !== 'board') { chip.hidden = true; return; }
    var mine = els.boardList.querySelector('.hud-lb-mine');
    if (!mine) { chip.hidden = true; return; }
    var lr = els.boardList.getBoundingClientRect();
    var mr = mine.getBoundingClientRect();
    var above = mr.bottom < lr.top + 4;
    var below = mr.top > lr.bottom - 4;
    if (!above && !below) { chip.hidden = true; return; }
    var rank = 1, node = mine;
    while ((node = node.previousElementSibling)) { rank++; }
    chip.textContent = (above ? '\u25B4' : '\u25BE') + ' MY ROW \u00B7 #' + rank;
    chip.hidden = false;
  }
```

Wire it: `els.boardList.addEventListener('scroll', updateMyRow);` in wireOutgoing, `updateMyRow()` as the last line of `refreshOverlayBoard`'s warm render branch AND its fetch callback AND `setPane` (after pane switches, where non-board panes hide it via the first guard), and chip click:

```js
    els.boardMyRow.addEventListener('click', function () {
      var mine = els.boardList.querySelector('.hud-lb-mine');
      if (!mine) { return; }
      try { mine.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); }
      catch (err) { mine.scrollIntoView(); }
    });
    keepKeysLocal(els.boardMyRow);
```

The smooth scroll fires `scroll` events, which re-run `updateMyRow`, which hides the chip when the row lands. No extra call needed.

hud.css, after the `.hud-board-list` block:

```css
/* Jump-to-my-row: floats over the list's lower edge. Absolute on purpose —
   appearing must not change the panel's height. */
.hud-board-myrow {
  position: absolute;
  left: 6vw;
  right: 6vw;
  bottom: 3.2vh;
  min-height: 34px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 10px;
  background: rgba(10, 18, 38, 0.92);
  color: rgba(255, 255, 255, 0.92);
  font-size: clamp(10px, 1.6vmin, 12px);
  font-weight: 600;
  letter-spacing: 0.14em;
  pointer-events: auto;
  cursor: pointer;
  z-index: 2;
}
/* The chip hides via the property, and this class sets its own display
   nowhere — but the rule stays explicit anyway: three prior bugs. */
.hud-board-myrow[hidden] { display: none; }
```

- [ ] **Step 5: Run to green**

`pw-fulllist.js` all five sections. Then `pw-shape.js` (local) again — the chip must not have broken invariance — and `pw-oneboard.js`.

- [ ] **Step 6: Commit**

```bash
git add hud.js hud.css
git commit -m "The whole board scrolls, with a chip that finds your row"
```

---

### Task 4: One loading strategy

**Files:**
- Modify: `hud.js` (`setOverlayMode` ~1630, `refreshOverlayBoard` cold path)
- Modify: `hud.css` (skeleton rows)
- Test: extend `reference/tests/pw-shape.js` with two sections

**Interfaces:**
- Consumes: T2's shell, T3's `updateMyRow`.
- Produces: `renderSkeleton(listEl)`. No signature changes anywhere.

- [ ] **Step 1: Extend the test, watch the new sections fail**

Append to `pw-shape.js` (before the final summary; new browser context so the routes differ):

```js
  /* F — slow cold open: skeletons, not LOADING, not emptiness */
  const c2 = await browser.newContext({ ...devices['iPhone 13'] });
  const p2 = await c2.newPage();
  p2.on('pageerror', e => errs.push('pageerror2: ' + e.message));
  await c2.route('**/rest/v1/stack_scores*', async r => {
    if (r.request().method() !== 'GET') { return r.abort(); }
    await new Promise(res => setTimeout(res, 1200));
    return r.fallback();
  });
  await p2.goto(TARGET, { waitUntil: 'load', timeout: 30000 });
  await p2.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await p2.click('.hud-board-btn');
  await p2.waitForTimeout(350);   /* mid-fetch */
  const f = await p2.evaluate(() => ({
    skel: document.querySelectorAll('.hud-board-list .hud-lb-skel').length,
    loading: document.body.textContent.indexOf('LOADING') >= 0,
    panelH: Math.round(document.querySelector('.hud-board-panel').getBoundingClientRect().height)
  }));
  await p2.waitForTimeout(1800);   /* fetch landed */
  const f2 = await p2.evaluate(() => ({
    skel: document.querySelectorAll('.hud-board-list .hud-lb-skel').length,
    rows: document.querySelectorAll('.hud-board-list li:not(.hud-lb-skel)').length,
    panelH: Math.round(document.querySelector('.hud-board-panel').getBoundingClientRect().height)
  }));
  console.log('OBS F ' + JSON.stringify(f) + ' -> ' + JSON.stringify(f2));
  if (f.skel < 1) { fails.push('F: no skeleton rows during the cold fetch'); }
  if (f.loading) { fails.push('F: LOADING text still exists'); }
  if (f2.skel !== 0) { fails.push('F: skeletons survived the data landing'); }
  if (f2.rows < 1) { fails.push('F: no real rows after the fetch'); }
  if (f.panelH !== f2.panelH) { fails.push('F: panel moved ' + f.panelH + ' -> ' + f2.panelH); }

  /* G — mode flip keeps old rows on screen until the new ones land */
  const gSamples = [];
  await p2.evaluate(() => {
    for (const b of document.querySelectorAll('.hud-board-mode button')) {
      if (b.textContent === 'HARD') { b.click(); return; }
    }
  });
  for (let i = 0; i < 40; i++) {
    gSamples.push(await p2.evaluate(() =>
      document.querySelectorAll('.hud-board-list li:not(.hud-lb-skel)').length));
    await new Promise(r => setTimeout(r, 45));
  }
  console.log('OBS G rows over time ' + JSON.stringify(gSamples));
  if (gSamples.some(n => n === 0)) {
    fails.push('G: the list went empty mid-flip (wipe is back)');
  }
  await c2.close();
```

Run: F fails today (no skeletons; LOADING appears), G fails (wipe empties the list).

- [ ] **Step 2: Stop the wipe**

In `setOverlayMode`, delete the line:

```js
    while (els.boardList.firstChild) { els.boardList.removeChild(els.boardList.firstChild); }
```

Keep `overlayBoardSeq++` and `refreshOverlayBoard(true)` exactly as they are (the seq is the race guard; the old rows now simply survive until the guarded repaint).

- [ ] **Step 3: Skeletons instead of LOADING**

In `hud.js`, next to `renderRows`:

```js
  /* Cold-open placeholder: six shimmer bars where rows will land. Only
     ever rendered into an empty list; any real render replaces it because
     renderRows clears the list first. */
  function renderSkeleton(listEl) {
    while (listEl.firstChild) { listEl.removeChild(listEl.firstChild); }
    for (var i = 0; i < 6; i++) { listEl.appendChild(el('li', 'hud-lb-skel')); }
  }
```

In `refreshOverlayBoard`, replace the cold branch (which after T2 reads `else if (showLoading && !els.boardList.children.length) { els.boardStatus.textContent = 'LOADING'; }`) with:

```js
    else if (showLoading && !els.boardList.children.length) { renderSkeleton(els.boardList); }
```

Grep hud.js for any remaining `'LOADING'` literal: the overlay must have none left. The death screen's own status behavior (els.lbStatus) is out of scope — if the literal lives only there, leave it and say so.

In `hud.css`:

```css
/* Cold-open skeleton rows. Same box as a real row; shimmer is decorative
   and stops for reduced motion. */
.hud-lb-skel {
  height: 1.5em;
  border-radius: 8px;
  background: linear-gradient(90deg,
    rgba(255, 255, 255, 0.05) 25%,
    rgba(255, 255, 255, 0.13) 50%,
    rgba(255, 255, 255, 0.05) 75%);
  background-size: 200% 100%;
  animation: hud-skel-sweep 1.1s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .hud-lb-skel { animation: none; }
}
@keyframes hud-skel-sweep {
  from { background-position: 200% 0; }
  to { background-position: -200% 0; }
}
```

- [ ] **Step 4: Run to green**

`pw-shape.js` local, all sections including F and G. Then `pw-hard-board.js`'s race sections if they run at all post-T1 (they may be failing from T1's deletions; only regressions NEW to this task matter — compare against T1's recorded signatures). Then `pw-fulllist.js` (repaints must still call `updateMyRow`).

- [ ] **Step 5: Commit**

```bash
git add hud.js hud.css
git commit -m "One loading strategy: keep what you have, shimmer only when cold"
```

---

### Task 5: Riders, reconciliation, rebuild, deploy, live verification

**Files:**
- Modify: `hud.js` (header OUTGOING doc), `hud.css` (inert-card cursor)
- Modify: `reference/tests/pw-boards.js`, `reference/tests/pw-hard-board.js` (reconcile to the spec)
- Modify: `Stack.html` (generated)

- [ ] **Step 1: Riders**

1. hud.js header: the OUTGOING section (top-of-file comment) must list `hud:world { id }`, `hud:mute { muted }`, `hud:menu`, `hud:mode { mode }` with one-line meanings. Add the missing ones; touch nothing else in the header.
2. hud.css: on the locked/dimmed shop-card rules (`.hud-shop-card.is-locked`, `.hud-shop-card.is-dim`): `cursor: default;`
3. Rider test (append to `pw-oneboard.js`): start a run (`window.StackCore.debug.build(1, 0)` after a start tap, or drive `game:start` via a real start), then send the keyboard path at the trophy button (`focus()` + real Enter via CDP `Input.dispatchKeyEvent`) and assert `data-board` never becomes `open` during `data-state="playing"`.

- [ ] **Step 2: Reconcile pw-boards.js and pw-hard-board.js**

Read all three: `pw-boards.js`, `pw-hard-board.js`, and `pw-deathlines.js` (the third joined the list during Task 1: it drives scope switches through `.hud-lb-seg-btn[data-scope="day"]` and reads `.hud-board-pct`). Sections asserting the TODAY|ALL TIME seg, `overlayScope` behavior, or the percentile line describe deleted features: retire each with a dated comment naming this spec (do not delete the file). Sections asserting the mode-race guard, dedupe, mode-scoped requests, or death behavior must be kept and passing — adapt selectors if the seg's absence shifted them. Record per-section verdicts (kept/adapted/retired) in the report.

- [ ] **Step 3: The full ledger**

Run every suite in `reference/tests/` (19 files plus this wave's three new ones; `pw-board-clunk.js` is a diagnostic, run it for observations but it has no pass/fail). Record a per-suite verdict table. Any failure this wave did not cause is reported, not quietly fixed.

- [ ] **Step 4: Rebuild the offline build**

```bash
node scripts/build-offline.mjs
```

Then verify the artifact carries the wave:

```bash
grep -cF "hud-board-myrow" Stack.html
grep -cF "hud-lb-skel" Stack.html
grep -c "hud-lb-seg" Stack.html
```

Expected: ≥2, ≥2, and 0 (the seg is gone from the bundle).

- [ ] **Step 5: Commit and deploy**

```bash
git add Stack.html hud.js hud.css
git commit -m "Board overhaul: riders, reconciled suites, offline rebuild"
git push origin main
```

- [ ] **Step 6: Verify the deploy**

`gh api .../pages/builds/latest` lies. Ground truth is both:

```bash
gh run list --workflow "pages build and deployment" --limit 3
curl -s "https://maores.github.io/stack-tower/hud.js?cb=$(git rev-parse --short HEAD)" | grep -cF "hud-board-myrow"
```

Actions run `success` for the exact SHA; curl count ≥ 1.

- [ ] **Step 7: Live verification, twice**

Run `pw-shape.js` with `SHAPE_LIVE=1` and `pw-fulllist.js` pointed at the live URL (copy to a `-live` variant, switch the constant; keep intercepts), twice each. Timing behavior in this project only ever reproduced on production network loads.

- [ ] **Step 8: Report**

Full per-suite table, deploy evidence, both live rounds, and any open items, to `.superpowers/sdd/task-5-report.md` under this wave's heading.

---

## Self-review notes

- Spec section 1 (delete view, keep data) → T1, with the roast-path assertion (C) proving the keep. Section 2 (shell) → T2. Section 3 (list + chip) → T3. Section 4 option a (percentile deleted) → T1. Section 5 (loading) → T4. Section 6 (targets) → T2. Section 7 riders → T5 (rider 1 is test-only; it already shipped). Testing section items 1-9 map to pw-shape (1, 5-8), pw-oneboard (2, 9), pw-fulllist (3-4); item 10 → T5.
- Ordering is deliberate: the view deletion first so the shell task measures the final chrome; the wipe removal after the shell so G's no-empty-frame assertion cannot be confused by cold-floor behavior.
- pw-boards/pw-hard-board are knowingly red from T1 until T5. Every task's step 4/5 says which failures are expected; T5 reconciles. This is the honest version of the "five suites silently broken" lesson: red on purpose, named, then fixed once.
- T2 step 5 runs the live flavor expecting failure, so the live rerun in T5 step 7 is a real before/after rather than a first-ever run.
