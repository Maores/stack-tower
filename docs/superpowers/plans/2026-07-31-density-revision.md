# Density Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/superpowers/specs/2026-07-31-density-revision-design.md`: three-element title, rank-sandwich death screen, records + tier ladder folded into the trophy overlay as a third tab, tier-up toast, percentile relocated to the overlay's TODAY tab.

**Architecture:** hud.js + hud.css only. Deletions first (title extras, records overlay, death board tabs, percentile line), then the two new surfaces (sandwich, records tab), then the two relocations (toast, percentile header). Existing request tokens (`deathBoardSeq`, `overlayBoardSeq`, `deathSeq`, `autoSeq`) keep their jobs; the death screen now consumes a FULL deduped all-time list (no top-10 slice) for the sandwich while roasts keep their daily rows.

**Tech Stack:** Vanilla ES5 browser JS, Playwright with route interception.

## Global Constraints

- hud.js is ES5 IIFE style: `var`, defensive try/catch, no arrow functions, no template literals. User data via `textContent` only; names composed into strings get `lrm()`. Game UI text stays English.
- Only hud.js and hud.css change (plus scratchpad tests and the Task 4 `Stack.html` rebuild).
- Playwright executor: `cd "C:\Users\maor4\.claude\plugins\cache\playwright-skill\playwright-skill\4.1.0\skills\playwright-skill" && node run.js "<script path>"`. Tests live in the session scratchpad `C:\Users\maor4\AppData\Local\Temp\claude\C--Users-maor4-OneDrive-Desktop-Claude-builds-stack-tower\c1e7833a-2c07-43a2-bcab-f5e79bb9336f\scratchpad\`, never committed. Every test URL carries `?debug=1`.
- **Every `stack_scores` request in every test is intercepted (GET/HEAD mocked, POST fulfilled). Real friends' rows must never be written or altered.**
- Spec invariants, verbatim: title = exactly 3 text elements + 2 corner buttons; death = 7 content elements + restart + hint; tier names appear persistently only next to the full ladder; victim formula `(above.score - myBest + 1)`; percentile header hiding rules unchanged (window >= 10); toast fires at most once per tier, honors reduced-motion.
- Unchanged by decree: in-run HUD, quips/roasts and their daily-rows source, auto-submit + rename flows and all four tokens, `data-ui` and `keepKeysLocal` guards, `mode=eq.normal` filter, `LB_URL`/`LB_KEY`.

---

### Task 1: subtract — title extras out, records overlay out, third tab in

**Files:**
- Modify: `hud.js` (buildDom title block ~line 213-232, records overlay block ~line 371-408, els map, `renderTitleBest` ~478, records functions ~964-996, `tryStart` ~1164, wireOutgoing records wiring, keydown overlay block)
- Modify: `hud.css` (title tier/bar/records blocks, `.hud-records` blocks, board-tab row reuse)
- Test: `<scratchpad>/pw-density1.js`

**Interfaces:**
- Consumes: existing `TIERS`, `tierFor`, `readInt`/`readToday`, `STREAK_KEY`/`BLOCKS_KEY`, `renderRows`, board overlay (`els.board`, `els.boardTabs` row with `boardTabDay`/`boardTabAll`, `boardList`, `boardStatus`, `openBoard`/`closeBoard`, `overlayScope`), `keepKeysLocal`, `markTab`.
- Produces: a third overlay tab `els.boardTabRec` (`data-scope="records"`, label `RECORDS`); `els.boardRecords` pane (div, sibling of `boardList`, hidden unless the records tab is active); `renderRecordsPane()` filling stats rows + ladder; `overlayScope` may now be `'records'`. Title has no tier chip, bar, or RECORDS button; `.hud-records` overlay, `data-records` attribute, `openRecords`/`closeRecords`/`recordsOpen` are gone. Tasks 2-4 rely on: `els.boardTabRec`, `renderRecordsPane`, and `overlayScope === 'records'` short-circuiting board fetches.

- [ ] **Step 1: Write the failing test**

Write `<scratchpad>/pw-density1.js`:

```javascript
/* Density task 1: bare title + records as third overlay tab. LB fully mocked. */
const { chromium, devices } = require('playwright');
const TARGET_URL = process.env.STACK_URL ||
  'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const ROWS = JSON.stringify([{ name: 'RIV', score: 40 }, { name: 'PAL', score: 20 }]);

(async () => {
  const browser = await chromium.launch({ headless: false });
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
      headers: { 'content-range': '0-0/0' }, body: ROWS });
  });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('stack-best', '87');
      localStorage.setItem('stack-best-streak', '9');
      localStorage.setItem('stack-blocks-ever', '3412');
    } catch (e) {}
  });
  await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });

  // A: title is exactly STACK / TAP TO START / BEST 87 — no chip, bar, or pill
  let s = await page.evaluate(() => ({
    tier: !!document.querySelector('.hud-title-tier'),
    bar: !!document.querySelector('.hud-title-bar'),
    pill: !!document.querySelector('.hud-title-records'),
    recordsOverlay: !!document.querySelector('.hud-records'),
    best: document.querySelector('.hud-title-best').textContent,
    kids: document.querySelectorAll('.hud-title > *').length
  }));
  if (s.tier || s.bar || s.pill || s.recordsOverlay) throw new Error('FAIL A leftovers: ' + JSON.stringify(s));
  if (s.best !== 'BEST 87' || s.kids !== 3) throw new Error('FAIL A shape: ' + JSON.stringify(s));
  console.log('A PASS: bare title');

  // B: overlay has three tabs; RECORDS shows stats + full ladder with TITAN legible
  await page.click('.hud-board-btn');
  await page.waitForTimeout(500);
  s = await page.evaluate(() => ({
    tabs: Array.from(document.querySelectorAll('.hud-board .hud-lb-tab')).map(b => b.getAttribute('data-scope'))
  }));
  if (s.tabs.join(',') !== 'day,all,records') throw new Error('FAIL B tabs: ' + JSON.stringify(s));
  await page.click('.hud-board .hud-lb-tab[data-scope="records"]');
  await page.waitForTimeout(400);
  s = await page.evaluate(() => ({
    paneShown: !document.querySelector('.hud-board-records').hidden,
    listShown: !document.querySelector('.hud-board-list').hidden,
    best: document.querySelector('.hud-rec-best').textContent,
    streak: document.querySelector('.hud-rec-streak').textContent,
    ladderRows: document.querySelectorAll('.hud-ladder-row').length,
    current: (document.querySelector('.hud-ladder-row.is-cur') || {}).textContent || ''
  }));
  if (!s.paneShown || s.listShown) throw new Error('FAIL B pane: ' + JSON.stringify(s));
  if (s.best !== '87' || s.streak !== '9 PERFECT') throw new Error('FAIL B stats: ' + JSON.stringify(s));
  if (s.ladderRows !== 8 || s.current.indexOf('MARBLE') < 0) throw new Error('FAIL B ladder: ' + JSON.stringify(s));
  console.log('B PASS: records tab');

  // C: switching back to a board tab restores the list; Escape still closes
  await page.click('.hud-board .hud-lb-tab[data-scope="all"]');
  await page.waitForTimeout(500);
  s = await page.evaluate(() => ({
    paneShown: !document.querySelector('.hud-board-records').hidden,
    rows: document.querySelectorAll('.hud-board-list li').length
  }));
  if (s.paneShown || s.rows !== 2) throw new Error('FAIL C back to board: ' + JSON.stringify(s));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  s = await page.evaluate(() => ({
    open: document.getElementById('hud-root').getAttribute('data-board'),
    state: document.getElementById('hud-root').getAttribute('data-state')
  }));
  if (s.open || s.state !== 'title') throw new Error('FAIL C close: ' + JSON.stringify(s));
  if (issues.length) throw new Error('FAIL issues: ' + JSON.stringify(issues));
  console.log('PASS: density task 1');
  await browser.close();
})();
```

- [ ] **Step 2: Run it — expect FAIL A leftovers** (`.hud-title-tier` still exists).

- [ ] **Step 3: Implement in hud.js**

3a. In `buildDom`, delete the title-extra block (the `titleTier`, `titleBar`, `titleBarFill`, `recordsBtn` creations and their three `title.appendChild(...)` calls), leaving the title as word + hint + best only.

3b. In `buildDom`, delete the entire records-overlay block (`var records = el('div', 'hud-board hud-records');` through `records.appendChild(recPanel);` and its `root.appendChild(records);`), and delete these els-map entries: `titleTier`, `titleBarFill`, `recordsBtn`, `records`, `recClose`. KEEP the `recRow` helper and the `recBest`/`recStreak`/`recToday`/`recBlocks` value nodes by moving their construction into the board panel (next step) — the stat rows live on, only their shell dies.

3c. In `buildDom`'s board-panel block, after the tabs row construction add the records tab and pane:

```javascript
    var boardTabRec = el('button', 'hud-lb-tab', 'RECORDS');
    boardTabRec.type = 'button';
    boardTabRec.setAttribute('data-scope', 'records');
    boardTabs.appendChild(boardTabRec);

    /* Records pane: stats + tier ladder, shown in place of the list. */
    var boardRecords = el('div', 'hud-board-records');
    boardRecords.hidden = true;
    function recRow(label, cls) {
      var row = el('div', 'hud-rec-row');
      row.appendChild(el('span', 'hud-rec-label', label));
      var val = el('span', 'hud-rec-val ' + cls, '');
      row.appendChild(val);
      return { row: row, val: val };
    }
    var recBest = recRow('BEST', 'hud-rec-best');
    var recStreak = recRow('BEST STREAK', 'hud-rec-streak');
    var recToday = recRow('TODAY', 'hud-rec-today');
    var recBlocks = recRow('BLOCKS EVER', 'hud-rec-blocks');
    boardRecords.appendChild(recBest.row);
    boardRecords.appendChild(recStreak.row);
    boardRecords.appendChild(recToday.row);
    boardRecords.appendChild(recBlocks.row);
    var ladder = el('div', 'hud-ladder');
    boardRecords.appendChild(ladder);
    var ladderNote = el('div', 'hud-ladder-note', 'TOWER TIERS \u00b7 FROM YOUR BEST \u00b7 NEVER DROP');
    boardRecords.appendChild(ladderNote);
    boardPanel.appendChild(boardRecords);   /* between boardTabs row and boardList */
```

(Insert `boardPanel.appendChild(boardRecords);` between the existing `boardPanel.appendChild(boardTabs);` and `boardPanel.appendChild(boardList);` lines. Delete the old `recRow` construction from wherever it lived in the deleted records block.) Extend the returned els map with `boardTabRec: boardTabRec, boardRecords: boardRecords, ladder: ladder,` and keep `recBest: recBest.val, recStreak: recStreak.val, recToday: recToday.val, recBlocks: recBlocks.val,`.

3d. Replace `renderTitleBest` so it fills only the best line (delete the tier-chip lines from its body):

```javascript
  function renderTitleBest() {
    var best = readBest();
    els.titleBest.textContent = best > 0 ? 'BEST ' + best : '';
  }
```

3e. Replace the `renderRecords`/`openRecords`/`closeRecords`/`recordsOpen` group with the pane renderer:

```javascript
  function renderRecordsPane() {
    var b = readBest();
    els.recBest.textContent = String(b);
    els.recStreak.textContent = readInt(STREAK_KEY) > 0 ? readInt(STREAK_KEY) + ' PERFECT' : '0';
    els.recToday.textContent = String(readToday().best);
    els.recBlocks.textContent = String(readInt(BLOCKS_KEY));
    while (els.ladder.firstChild) { els.ladder.removeChild(els.ladder.firstChild); }
    var t = tierFor(b), i, row, reached, cur;
    for (i = 0; i < TIERS.length; i++) {
      reached = b >= TIERS[i][1];
      cur = t.cur && t.cur.idx === i;
      row = el('div', 'hud-ladder-row' + (cur ? ' is-cur' : reached ? ' is-done' : ''));
      row.appendChild(el('span', 'hud-ladder-mark', cur ? '\u25c8' : reached ? '\u2713' : '\u00b7'));
      row.appendChild(el('span', 'hud-ladder-name', TIERS[i][0]));
      row.appendChild(el('span', 'hud-ladder-th', String(TIERS[i][1])));
      els.ladder.appendChild(row);
    }
  }
```

3f. Tab switching. In `wireOutgoing`, delete the records-overlay wiring (`els.recordsBtn.addEventListener`, `els.recClose.addEventListener`, the `els.records` backdrop pointerdown, `keepKeysLocal(els.recordsBtn)`, `keepKeysLocal(els.recClose)`) and add, next to the two existing overlay-tab handlers:

```javascript
    els.boardTabRec.addEventListener('click', function () {
      overlayScope = 'records';
      els.boardTabRec.classList.add('is-on');
      els.boardTabDay.classList.remove('is-on');
      els.boardTabAll.classList.remove('is-on');
      els.boardRecords.hidden = false;
      els.boardList.hidden = true;
      els.boardStatus.textContent = '';
      renderRecordsPane();
    });
    keepKeysLocal(els.boardTabRec);
```

and extend BOTH existing overlay tab handlers (`boardTabDay`, `boardTabAll`) with these two lines before their `refreshOverlayBoard(true);` call, plus un-highlight the records tab in their `markTab` step:

```javascript
      els.boardRecords.hidden = true;
      els.boardList.hidden = false;
      els.boardTabRec.classList.remove('is-on');
```

3g. In `refreshOverlayBoard`, first line: `if (overlayScope === 'records') { return; }` (the 15s interval must not fetch while the records pane shows). In `openBoard`, after the existing open work add a reset so the overlay always opens on a board tab: if `overlayScope === 'records'`, set `overlayScope = 'all'`, `markTab(els.boardTabAll, els.boardTabDay)`, `els.boardTabRec.classList.remove('is-on')`, `els.boardRecords.hidden = true`, `els.boardList.hidden = false`.

3h. In `tryStart`, delete the `.hud-title-records` closest-guard line. In the window keydown handler, replace the `boardOpen || recordsOpen` condition with plain `boardOpen` and delete the `closeRecords` branch inside.

- [ ] **Step 4: hud.css**

Delete the `.hud-title-tier`, `.hud-title-bar` (and its `i`), `.hud-title-records`, `.hud-records`, `#hud-root[data-records="open"] .hud-records`, and `#hud-root[data-board="open"] .hud-records` blocks. Keep the `.hud-rec-row`/`.hud-rec-label`/`.hud-rec-val` blocks (they now style the pane inside the board panel). Add:

```css
/* Records pane inside the trophy overlay (third tab) */
.hud-board-records {
  margin-top: 1.6vh;
  overflow-y: auto;
  max-height: 58vh;
}
.hud-board-records[hidden] {
  display: none;
}
.hud-ladder {
  margin-top: 2vh;
}
.hud-ladder-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0.6vh 4px;
  font-size: clamp(11px, 1.7vmin, 14px);
  font-weight: 300;
  letter-spacing: 0.2em;
  opacity: 0.45;
}
.hud-ladder-row.is-done {
  opacity: 0.85;
}
.hud-ladder-row.is-cur {
  opacity: 1;
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 8px;
  box-shadow: 0 0 14px rgba(255, 255, 255, 0.25);
}
.hud-ladder-name {
  flex: 1;
}
.hud-ladder-th {
  font-size: clamp(9px, 1.4vmin, 11px);
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}
.hud-ladder-note {
  margin-top: 1.4vh;
  text-align: center;
  font-size: clamp(8px, 1.3vmin, 10px);
  font-weight: 300;
  letter-spacing: 0.2em;
  opacity: 0.55;
}
```

- [ ] **Step 5: Run pw-density1.js until PASS, then regressions** — `pw-ghost.js`, `pw-almost.js` (title-agnostic, must stay green). `pw-tiers.js` and others WILL fail on removed elements; that reconciliation is Task 4's job, do not touch them here.

- [ ] **Step 6: Commit** — `git add hud.js hud.css && git commit -m "Density 1: bare title, records fold into trophy overlay as third tab"`

---

### Task 2: death screen — rank sandwich, victim rework, spacing

**Files:**
- Modify: `hud.js` (`fetchTop` ~738, buildDom over-panel + death-board block, `applyOver` ~1064, `refreshBoard` ~880, `showVictim` ~825, `showPercentile` call site, `autoSubmit` ~664, death-tab wiring ~1208-1214, `tryRestart` selector)
- Modify: `hud.css` (death spacing, sandwich variant, saved-as micro, delete `.hud-over-pct`)
- Test: `<scratchpad>/pw-density2.js`

**Interfaces:**
- Consumes: Task 1's state (no records overlay; overlay tabs incl. records).
- Produces: `fetchTop(scope, cb, full)` — when `full` is truthy, returns ALL deduped rows (no `.slice(0, 10)`); `buildSandwich(rows)` returning `{ rows: [{rank, name, score, mine}], above: {name, score}|null }` per the spec's anchor/fallback rules; death screen renders the sandwich via `renderSandwich(sw)` into the existing `els.lbList` (rank numbers explicit, no CSS counter); `.hud-over-pct` element and `showPercentile` death call are gone (the FUNCTION stays for Task 3's relocation); death tabs (`lbTabDay`/`lbTabAll`) and `deathScope` are gone — death always fetches `'all'` full for the sandwich and `'day'` for the roast.

- [ ] **Step 1: Write the failing test**

Write `<scratchpad>/pw-density2.js`:

```javascript
/* Density task 2: rank sandwich + victim + no pct/tabs on death. LB mocked. */
const { chromium, devices } = require('playwright');
const TARGET_URL = process.env.STACK_URL ||
  'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';

const ALL = JSON.stringify([
  { name: 'KING', score: 500 }, { name: 'RIV', score: 271 },
  { name: 'ME', score: 193 }, { name: 'PAL', score: 138 }, { name: 'LOW', score: 65 }
]);
const DAY = JSON.stringify([{ name: 'RIV', score: 40 }, { name: 'PAL', score: 20 }]);

async function boot(browser, opts) {
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
    const daily = req.url().indexOf('created_at=gte.') >= 0;
    return route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/0' }, body: daily ? DAY : (opts.all || ALL) });
  });
  await context.addInitScript(seed => {
    try {
      if (seed.best) localStorage.setItem('stack-best', String(seed.best));
      if (seed.name) localStorage.setItem('stack-player-name', seed.name);
    } catch (e) {}
  }, opts.seed || {});
  await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await page.touchscreen.tap(195, 500);
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 300));
    window.StackCore.debug.drop(0.5);
    window.StackCore.debug.drop(6);
  });
  await page.waitForSelector('#hud-root[data-state="over"]', { timeout: 5000 });
  await page.waitForTimeout(1200);
  const s = await page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('.hud-lb .hud-lb-list li')).map(li => li.textContent),
    mine: Array.from(document.querySelectorAll('.hud-lb .hud-lb-mine')).map(li => li.textContent),
    tabs: document.querySelectorAll('.hud-lb .hud-lb-tab').length,
    pct: !!document.querySelector('.hud-over-pct'),
    vicHidden: document.querySelector('.hud-over-victim').hidden,
    vic: document.querySelector('.hud-over-victim').textContent,
    best: document.querySelector('.hud-over-best').textContent
  }));
  if (issues.length) throw new Error('FAIL issues: ' + JSON.stringify(issues));
  await context.close();
  return s;
}

(async () => {
  const browser = await chromium.launch({ headless: false });

  // A: ranked player -> above/me/below with ranks 2/3/4; victim 271-193+1=79
  let s = await boot(browser, { seed: { best: 193, name: 'ME' } });
  if (s.tabs !== 0 || s.pct) throw new Error('FAIL A leftovers: ' + JSON.stringify(s));
  if (s.rows.length !== 3 || s.rows[0].indexOf('RIV') < 0 || s.rows[0].indexOf('2') < 0 ||
      s.rows[2].indexOf('PAL') < 0) throw new Error('FAIL A rows: ' + JSON.stringify(s));
  if (s.mine.length !== 1 || s.mine[0].indexOf('ME') < 0) throw new Error('FAIL A mine: ' + JSON.stringify(s));
  if (s.vicHidden || s.vic.indexOf('79 MORE PASSES') !== 0 || s.vic.indexOf('RIV') < 0)
    throw new Error('FAIL A victim: ' + JSON.stringify(s));
  if (s.best !== 'BEST 193') throw new Error('FAIL A best: ' + JSON.stringify(s));
  console.log('A PASS: ranked sandwich + victim 79');

  // B: nameless player -> top 3, none boxed, victim hidden (falls to best-delta rule: no name, no anchor)
  s = await boot(browser, { seed: { best: 50 } });
  if (s.rows.length !== 3 || s.rows[0].indexOf('KING') < 0 || s.mine.length !== 0)
    throw new Error('FAIL B fallback: ' + JSON.stringify(s));
  console.log('B PASS: nameless top-3');

  // C: player is #1 -> me + two below, victim hidden
  s = await boot(browser, { seed: { best: 500, name: 'KING' } });
  if (s.rows.length !== 3 || s.mine.length !== 1 || s.mine[0].indexOf('KING') < 0 ||
      s.rows[1].indexOf('RIV') < 0) throw new Error('FAIL C king rows: ' + JSON.stringify(s));
  if (!s.vicHidden) throw new Error('FAIL C victim should hide: ' + JSON.stringify(s));
  console.log('C PASS: king sandwich');

  console.log('PASS: density task 2');
  await browser.close();
})();
```

- [ ] **Step 2: Run it — expect FAIL A leftovers** (death tabs still exist).

- [ ] **Step 3: Implement in hud.js**

3a. `fetchTop` gains the `full` parameter — change the signature to `function fetchTop(scope, cb, full)` and the resolve line to:

```javascript
          finish(Array.isArray(rows) ? (full ? dedupeBest(rows) : dedupeBest(rows).slice(0, 10)) : null);
```

3b. In `buildDom`: delete the death-tab block (`lbTabs`, `lbTabDay`, `lbTabAll` creation, their appends, and their els-map entries). Delete the `overPct` creation and append and its els entry. Keep `lbTitle` (text `TOP TOWERS` stays), `lbStatus`, `lbList`, `entry`, auto-row.

3c. Sandwich builders, placed right after `dedupeBest`:

```javascript
  /* Rank sandwich: the deduped all-time list windowed around my best row.
     Anchor by stored name; the row's score is that player's best. */
  function buildSandwich(rows) {
    var out = { rows: [], above: null };
    if (!rows || !rows.length) { return out; }
    var myName = readName();
    var i, at = -1;
    if (myName) {
      for (i = 0; i < rows.length; i++) {
        if (rows[i] && rows[i].name === myName) { at = i; break; }
      }
    }
    var start;
    if (at < 0) { start = 0; }              /* unranked or nameless: top 3 */
    else if (at === 0) { start = 0; }       /* king: me + two below */
    else { start = at - 1; }                /* ranked: above / me / below */
    for (i = start; i < rows.length && out.rows.length < 3; i++) {
      out.rows.push({
        rank: i + 1,
        name: rows[i].name,
        score: rows[i].score,
        mine: i === at
      });
    }
    if (at > 0) { out.above = rows[at - 1]; }
    return out;
  }

  function renderSandwich(sw) {
    els.lbStatus.textContent = '';
    while (els.lbList.firstChild) { els.lbList.removeChild(els.lbList.firstChild); }
    if (!sw.rows.length) {
      els.lbList.appendChild(el('li', 'hud-lb-empty', 'NO SCORES YET'));
      return;
    }
    for (var i = 0; i < sw.rows.length; i++) {
      var r = sw.rows[i];
      var li = el('li', r.mine ? 'hud-lb-mine' : null);
      li.appendChild(el('span', 'hud-lb-rank', String(r.rank)));
      li.appendChild(el('span', 'hud-lb-name', String(r.name == null ? '?' : r.name).slice(0, 16)));
      li.appendChild(el('span', 'hud-lb-pts', String(r.score == null ? 0 : r.score)));
      els.lbList.appendChild(li);
    }
  }
```

(The `.hud-lb-rank` span replaces the CSS counter for these rows; Step 4 disables the counter inside the death list.)

3d. Victim rework — replace `showVictim` with:

```javascript
  /* Victim anchors the BEST, not the current run (spec 2026-07-31):
     beat the neighbor above your best row. Hidden for kings and the unranked. */
  function showVictim(above) {
    if (!above || typeof above.score !== 'number') { return; }
    var myBest = readBest();
    if (!(myBest > 0)) { return; }
    els.overVictim.textContent =
      (above.score - myBest + 1) + ' MORE PASSES ' +
      lrm(String(above.name).slice(0, 16));
    els.overVictim.hidden = false;
  }
```

3e. Death flow — replace `refreshBoard` with (tokens keep their jobs via the file's existing capture idiom; the sandwich fetch and roast fetch are separate requests):

```javascript
  function refreshBoard(mine, wantRoast) {
    var dseq = ++deathBoardSeq;
    var dgen = deathSeq;
    els.lbStatus.textContent = 'LOADING';
    fetchTop('all', function (rows) {
      if (dseq !== deathBoardSeq || state.mode !== 'over' || dgen !== deathSeq) { return; }
      if (rows) {
        var sw = buildSandwich(rows);
        renderSandwich(sw);
        els.overVictim.hidden = true;
        els.overVictim.textContent = '';
        showVictim(sw.above);
      } else {
        renderRows(els.lbList, els.lbStatus, readLocalBoard(), mine, 'THIS DEVICE ONLY', 3);
      }
    }, true);
    if (wantRoast) {
      fetchTop('day', function (rows) {
        if (state.mode !== 'over' || dgen !== deathSeq) { return; }
        if (rows) { applyRoast(rows); rememberTop(rows); }
      });
    }
  }
```

Update every `refreshBoard` caller to the new 2-arg signature: in `applyOver`'s else branch `refreshBoard(null, true);`; in `autoSubmit`'s success callback `refreshBoard({ name: name, score: score }, true);` (delete the captured `scope` variable there and the retry-hop roast-only plumbing — with death tabs gone, scope juggling for the death board is dead code: remove the `isRetry` parameter path and any `deathScope` reads; keep `autoSeq`/`dgen` guards untouched); in `trySave`'s success callback `refreshBoard({ name: name, score: score }, false);`. Delete the `deathScope` variable and the two death-tab click handlers plus their `keepKeysLocal` calls. Keep `markTab`, `overlayScope`, and the overlay handlers (Task 1 already reworked them).

3f. In `applyOver`: delete the `overPct` reset lines and the `showPercentile(finalScore)` call plus the `deathScope = 'day'; markTab(...)` reset; keep `deathSeq++`/`autoSeq++`, the victim reset stays (now also reset inside `refreshBoard`, harmless), keep everything else. `showPercentile` itself stays in the file, unreferenced until Task 3 rewires it (add a one-line comment above it: `/* relocated to the overlay TODAY header in the density revision */`).

3g. `tryRestart` exclusion selector: replace `'.hud-lb-entry, .hud-lb-auto, .hud-lb-tabs'` with `'.hud-lb-entry, .hud-lb-auto'` (tabs no longer exist on the death screen; the overlay has its own guards).

- [ ] **Step 4: hud.css**

Delete the `.hud-over-pct` blocks. Add after the `.hud-lb-list li::before` rule:

```css
/* Sandwich rows carry explicit rank spans; suppress the counter there */
.hud-lb-list li .hud-lb-rank {
  width: 1.5em;
  flex: none;
  opacity: 0.5;
  font-variant-numeric: tabular-nums;
}
.hud-lb-list li:has(.hud-lb-rank)::before {
  content: none;
  counter-increment: none;
}
```

(`:has` is fine: iOS 15.4+/all evergreen; the offline file targets the same engines.) Spacing (spec: roughly double the 02:50 values): change `.hud-lb { margin-top: 2.4vh; ... }` to `margin-top: 3.2vh;`, `.hud-over-victim`'s `margin-top` to `1.8vh`, `.hud-restart`'s `margin-top` to `3.4vh`, `.hud-lb-auto`'s `margin-top` to `2.4vh`. Saved-as micro: in the `.hud-lb-auto-text` block set `font-size: clamp(10px, 1.5vmin, 12px);` and `opacity: 0.6;`, and in `.hud-lb-auto-btn` set `font-size: clamp(9px, 1.4vmin, 11px);`.

- [ ] **Step 5: Run pw-density2.js until PASS, then pw-density1.js, pw-save.js, pw-ghost.js, pw-almost.js.** pw-save.js asserts on the auto-row and rename flow, which are unchanged; if it trips on board-row counts, that reconciliation belongs to Task 4 — investigate before touching anything, and only proceed if the failure is a layout-assert, not a behavior change.

- [ ] **Step 6: Commit** — `git add hud.js hud.css && git commit -m "Density 2: rank-sandwich death screen, victim anchors best, percentile off death"`

---

### Task 3: tier-up toast + percentile header in TODAY tab

**Files:**
- Modify: `hud.js` (buildDom root block, `applyScore`, `showPercentile`, `refreshOverlayBoard`, els map)
- Modify: `hud.css` (toast block, overlay header line)
- Test: `<scratchpad>/pw-density3.js`

**Interfaces:**
- Consumes: `TIERS`, `state.runStartBest` (snapshotted at run start), `retrigger`/`reduceMotion` conventions, `countRows`, `scopeFilter`, `readToday`, Task 1's `overlayScope === 'records'` short-circuit.
- Produces: `els.toast` (`.hud-toast`, fixed top-center, hidden default) with `showToast(text)`; `els.boardPct` (`.hud-board-pct`) header line inside the board panel above the list, filled only on the TODAY tab per the existing hiding rules with `score = readToday().best`.

- [ ] **Step 1: Write the failing test**

Write `<scratchpad>/pw-density3.js`:

```javascript
/* Density task 3: tier-up toast + overlay TODAY percentile header. LB mocked. */
const { chromium, devices } = require('playwright');
const TARGET_URL = process.env.STACK_URL ||
  'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const ROWS = JSON.stringify([{ name: 'RIV', score: 40 }]);

async function boot(browser, opts) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const issues = [];
  page.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  await context.route('**/rest/v1/stack_scores*', route => {
    const req = route.request();
    if (req.method() === 'POST') return route.fulfill({ status: 201, body: '' });
    if (req.method() === 'HEAD') {
      const above = req.url().indexOf('score=gt.') >= 0;
      return route.fulfill({ status: 206, headers: {
        'content-range': above ? '0-0/' + (opts.above || 0) : '0-0/' + (opts.total || 0),
        'access-control-expose-headers': 'Content-Range' } });
    }
    return route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/0' }, body: ROWS });
  });
  await context.addInitScript(seed => {
    try {
      if (seed.best) localStorage.setItem('stack-best', String(seed.best));
      if (seed.today) localStorage.setItem('stack-today', JSON.stringify(seed.today));
    } catch (e) {}
  }, opts.seed || {});
  await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  return { context, page, issues };
}

(async () => {
  const browser = await chromium.launch({ headless: false });

  // A: crossing CARDBOARD (10) with prior best 4 -> toast fires once, then fades
  let t = await boot(browser, { seed: { best: 4 } });
  await t.page.touchscreen.tap(195, 500);
  await t.page.waitForTimeout(600);
  await t.page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 300));
    window.StackCore.debug.build(10, 0);   // score reaches 10 -> crosses CARDBOARD
  });
  await t.page.waitForTimeout(400);
  let s = await t.page.evaluate(() => ({
    shown: document.querySelector('.hud-toast').classList.contains('is-on'),
    text: document.querySelector('.hud-toast').textContent
  }));
  if (!s.shown || s.text !== '\u25b2 CARDBOARD') throw new Error('FAIL A toast: ' + JSON.stringify(s));
  await t.page.waitForTimeout(3200);
  s = await t.page.evaluate(() => ({
    shown: document.querySelector('.hud-toast').classList.contains('is-on')
  }));
  if (s.shown) throw new Error('FAIL A toast stuck: ' + JSON.stringify(s));
  if (t.issues.length) throw new Error('FAIL A issues: ' + JSON.stringify(t.issues));
  await t.context.close();
  console.log('A PASS: toast fires and fades');

  // B: best already 87 -> reaching 10 again fires nothing
  t = await boot(browser, { seed: { best: 87 } });
  await t.page.touchscreen.tap(195, 500);
  await t.page.waitForTimeout(600);
  await t.page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 300));
    window.StackCore.debug.build(12, 0);
  });
  await t.page.waitForTimeout(400);
  s = await t.page.evaluate(() => ({
    shown: document.querySelector('.hud-toast').classList.contains('is-on')
  }));
  if (s.shown) throw new Error('FAIL B toast re-fired: ' + JSON.stringify(s));
  await t.context.close();
  console.log('B PASS: no re-fire below best');

  // C: TODAY tab header shows percentile when window >= 10 and today-best > 0
  t = await boot(browser, { total: 40, above: 8, seed: { best: 87,
    today: { d: new Date().getFullYear() + '-' +
      ('0' + (new Date().getMonth() + 1)).slice(-2) + '-' +
      ('0' + new Date().getDate()).slice(-2), best: 30 } } });
  await t.page.click('.hud-board-btn');
  await t.page.waitForTimeout(500);
  await t.page.click('.hud-board .hud-lb-tab[data-scope="day"]');
  await t.page.waitForTimeout(700);
  s = await t.page.evaluate(() => ({
    hidden: document.querySelector('.hud-board-pct').hidden,
    text: document.querySelector('.hud-board-pct').textContent
  }));
  if (s.hidden || s.text !== 'YOU: TOP 23% TODAY') throw new Error('FAIL C pct: ' + JSON.stringify(s));
  // D: ALL TIME tab hides it
  await t.page.click('.hud-board .hud-lb-tab[data-scope="all"]');
  await t.page.waitForTimeout(500);
  s = await t.page.evaluate(() => ({
    hidden: document.querySelector('.hud-board-pct').hidden
  }));
  if (!s.hidden) throw new Error('FAIL D pct on all-time: ' + JSON.stringify(s));
  if (t.issues.length) throw new Error('FAIL C/D issues: ' + JSON.stringify(t.issues));
  await t.context.close();

  console.log('PASS: density task 3');
  await browser.close();
})();
```

Percentile math check: total 40, above 8 → `round((8+1)/40*100)` = 23 → `YOU: TOP 23% TODAY`.

- [ ] **Step 2: Run it — expect FAIL A** (`.hud-toast` missing).

- [ ] **Step 3: Implement in hud.js**

3a. In `buildDom`, after the board overlay's `root.appendChild(board);` add:

```javascript
    /* Tier-up toast: the tier system's only in-game voice. */
    var toast = el('div', 'hud-toast', '');
    toast.setAttribute('aria-live', 'polite');
    root.appendChild(toast);
```

In the board panel, insert a percentile header between the tabs row and the records pane:

```javascript
    var boardPct = el('div', 'hud-board-pct', '');
    boardPct.hidden = true;
```

with `boardPanel.appendChild(boardPct);` placed directly after `boardPanel.appendChild(boardTabs);`. Extend the els map with `toast: toast, boardPct: boardPct,`.

3b. Toast logic, placed after `retrigger`:

```javascript
  var toastTimer = null;

  function showToast(text) {
    els.toast.textContent = text;
    els.toast.classList.add('is-on');
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('is-on');
      toastTimer = null;
    }, 2500);
  }
```

3c. Crossing detection — in `applyScore`, after the existing blocks-ever line inside the `if (state.mode === 'playing' && n > prev)` block, add:

```javascript
      /* Tier-up: first time this run's score crosses a threshold the stored
         best had not reached. Fires at most once per tier by construction. */
      var base = state.runStartBest != null ? state.runStartBest : readBest();
      for (var ti = 0; ti < TIERS.length; ti++) {
        if (n >= TIERS[ti][1] && prev < TIERS[ti][1] && base < TIERS[ti][1]) {
          showToast('\u25b2 ' + TIERS[ti][0]);
          break;
        }
      }
```

3d. Percentile relocation — replace `showPercentile` with:

```javascript
  /* Overlay TODAY header: "YOU: TOP n% TODAY" for today's device best.
     Same hiding rules as the old death-screen line: window >= 10, else absent. */
  function showPercentile() {
    var myToday = readToday().best;
    els.boardPct.hidden = true;
    els.boardPct.textContent = '';
    if (!(myToday > 0)) { return; }
    var windowF = scopeFilter('day');
    countRows(windowF, function (total) {
      if (overlayScope !== 'day' || total == null || total < 10) { return; }
      countRows(windowF + '&score=gt.' + myToday, function (above) {
        if (overlayScope !== 'day' || above == null) { return; }
        var pct = Math.max(1, Math.round(((above + 1) / total) * 100));
        if (pct >= 100) { return; }
        els.boardPct.textContent = 'YOU: TOP ' + pct + '% TODAY';
        els.boardPct.hidden = false;
      });
    });
  }
```

3e. Wire it: in the `boardTabDay` click handler add `showPercentile();` after its `refreshOverlayBoard(true);`; in the `boardTabAll` and `boardTabRec` handlers add `els.boardPct.hidden = true;`. In `openBoard`, after the open work add `els.boardPct.hidden = true;` then `if (overlayScope === 'day') { showPercentile(); }` (covers reopening on a remembered TODAY tab).

- [ ] **Step 4: hud.css**

```css
/* Tier-up toast */
.hud-toast {
  position: fixed;
  top: calc(max(2.2vh, env(safe-area-inset-top, 0px)) + clamp(40px, 6.5vmin, 52px) + 1.2vh);
  left: 50%;
  transform: translateX(-50%) translateY(-8px);
  z-index: 115;
  border: 1px solid rgba(255, 255, 255, 0.75);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  padding: 0.55em 1.4em 0.55em 1.62em;
  font-size: clamp(11px, 1.7vmin, 14px);
  font-weight: 300;
  letter-spacing: 0.3em;
  box-shadow: 0 0 16px rgba(255, 255, 255, 0.3);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.4s ease, transform 0.4s cubic-bezier(0.2, 0.7, 0.25, 1);
}
.hud-toast.is-on {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

/* Overlay TODAY percentile header */
.hud-board-pct {
  margin-top: 1.2vh;
  text-align: center;
  font-size: clamp(11px, 1.7vmin, 14px);
  font-weight: 300;
  letter-spacing: 0.24em;
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.4);
}
.hud-board-pct[hidden] {
  display: none;
}
```

And in the existing `@media (prefers-reduced-motion: reduce)` block add `#hud-root .hud-toast { transition-duration: 0.01s; }`.

- [ ] **Step 5: Run pw-density3.js until PASS, then pw-density1.js and pw-density2.js.**

- [ ] **Step 6: Commit** — `git add hud.js hud.css && git commit -m "Density 3: tier-up toast + percentile header on overlay TODAY tab"`

---

### Task 4: suite reconciliation, offline rebuild, deploy

**Files:**
- Modify (scratchpad only): `pw-tiers.js`, `pw-deathlines.js`, `pw-boards.js`, `pw-offline-check.js`
- Regenerate: `Stack.html` (`node scripts/build-offline.mjs`)

**Interfaces:**
- Consumes: everything above.
- Produces: the full suite green against the new layout; rebuilt offline file; deployed site.

- [ ] **Step 1: Reconcile the four suites** — update assertions to the new contract, keeping each suite's intent:
  - `pw-tiers.js`: title sections now assert ABSENCE of `.hud-title-tier`/`.hud-title-bar`/`.hud-title-records`; records sections drive the overlay (`.hud-board-btn` → records tab) instead of the deleted overlay; keep the stat-tracking, boundary-math (assert via `renderRecordsPane`'s ladder: `.hud-ladder-row.is-cur` text), backdrop/data-ui, and Escape sections. The over-tier assertions stay deleted (04:00 revision already removed the BEST-line tier suffix; assert `.hud-over-best` text is exactly `BEST <n>`).
  - `pw-deathlines.js`: percentile sections move conceptually to pw-density3 (already covered); rewrite the remaining sections to assert `.hud-over-pct` no longer exists and victim behavior per the new anchor (mock rows sized so the formula is unambiguous); keep the stale-response section G with the new 2-arg `refreshBoard` reality (assert no victim line and no stale SAVED AS on the score-0 second death).
  - `pw-boards.js`: death-tab sections become sandwich sections (reuse pw-density2's row-shape asserts with this suite's row fixtures); overlay sections keep TODAY/ALL-TIME asserts and add `records` to the expected tab list; keep the stale-key roast section, the save-during-switch section adapts: with death tabs gone, assert the saved row appears in the sandwich after the POST resolves.
  - `pw-offline-check.js`: tier-chip assert becomes bare-title assert (`BEST 30`, no `.hud-title-tier`); death asserts: no `.hud-over-pct`, sandwich renders the local fallback rows offline with `THIS DEVICE ONLY`.
- [ ] **Step 2: Run everything** — `pw-density1/2/3.js`, the four reconciled suites, `pw-save.js`, `pw-ghost.js`, `pw-almost.js`. All PASS.
- [ ] **Step 3: Rebuild offline** — `node scripts/build-offline.mjs`; run `pw-offline-check.js` against `Stack.html?debug=1`; verify the U+200E and U+00B7 bytes survive (`Select-String` on the built file or the byte-check from the prior rebuild report).
- [ ] **Step 4: Commit** — `git add hud.js hud.css Stack.html && git commit -m "Density 4: suite reconciliation + offline rebuild"` (hud files only if reconciliation exposed real fixes; otherwise Stack.html alone).
- [ ] **Step 5: Deploy (controller gate)** — push to main, poll Pages, re-run `pw-density2.js` and `pw-density3.js` with `STACK_URL='https://maores.github.io/stack-tower/index.html?debug=1'`, take one emulated-phone screenshot of title + death for Maor, ledger + roadmap memory + vault updates.

## Self-review notes

- Spec coverage: title strip (T1), records/ladder tab (T1), sandwich + fallbacks + victim formula (T2), saved-as micro + spacing (T2 Step 4), pct off death (T2) and into TODAY header (T3), toast with once-per-tier + reduced-motion (T3), suites + offline + deploy (T4). Constraint on future phases needs no code.
- Deliberate scope cuts, stated: `deathScope`, death tabs, and the retry-hop roast-only path die in T2 (dead code once the death board is unscoped); `showPercentile` survives T2 unreferenced and is rewired in T3 — T2 and T3 must land in order.
- Type consistency: `fetchTop(scope, cb, full)` used by T2 (full=true) and unchanged 2-arg calls elsewhere; `buildSandwich`/`renderSandwich`/`showVictim(above)` names match between T2 code and T2/T4 tests; `showToast`/`els.toast`/`els.boardPct` match T3 code and test; `renderRecordsPane` matches T1 code and test.
- Known judgment call: sandwich fallback for a named-but-unranked player shows top 3 unboxed (same as nameless) — spec's "Player unranked or nameless" line, encoded in `buildSandwich`'s `at < 0` branch.
