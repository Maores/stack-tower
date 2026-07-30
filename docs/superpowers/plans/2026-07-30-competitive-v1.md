# Competitive Layer v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship roadmap item 3 from `docs/superpowers/specs/2026-07-30-retention-loop-design.md`: daily (rolling 24h) + all-time board tabs with one best row per player, death-screen percentile and next-victim lines, in-run ghost line and near-miss flash, non-demoting tier ladder with a records panel, and the `mode` column groundwork.

**Architecture:** One DB migration, then three code layers along the existing domain seams. core.js adds one CFG knob and an `almost` flag on the `stack:placed` CustomEvent. visuals.js consumes the flag and owns the ghost line (reads `StackCore.getTowerState()`, its allowed state seam). hud.js owns everything else: scoped board fetches with client-side dedupe, HEAD-count percentile, victim line, tiers, records panel. No new files; cross-domain coupling stays CustomEvents-only.

**Tech Stack:** Vanilla ES5 browser JS, Three.js r149, Supabase PostgREST (publishable key, open RLS), Playwright with route interception.

## Global Constraints

- All game JS is ES5 IIFE style: `var`, defensive `try/catch`, no arrow functions, no template literals. hud.js renders user data with `textContent` only; player names composed into strings get the existing `lrm()` guard. Game UI text stays English.
- `StackCore.debug.*` is real only with `?debug=1` in the URL (decoy shipped 2026-07-30). **Every test URL must include `?debug=1`.**
- Local page URL: `file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1`. Live URL: `https://maores.github.io/stack-tower/?debug=1`.
- Playwright executor: `cd "C:\Users\maor4\.claude\plugins\cache\playwright-skill\playwright-skill\4.1.0\skills\playwright-skill" && node run.js "<script path>"`. Test scripts live in the session scratchpad, never committed.
- **All `stack_scores` traffic in tests is intercepted** (GET/HEAD mocked, POST fulfilled): tests never write real rows, locally or live. The one exception is Task 1's migration probe, which writes and then deletes named probe rows per the project cleanup rule.
- Deploy order is load-bearing: Task 1 (DB migration) must be verified live before any Task 4+ code deploys, because the new reads filter on `mode=eq.normal` and would 400 against a missing column.
- Out of scope for this item (spec: items 4/4.5/7): points economy and any points UI, the shop, Hard mode itself (only the column lands now), revive, haptics, any audio change (death stays silent), any ad.
- Client POSTs keep NOT sending `mode`; the column default `'normal'` covers this item. Hard mode sends it explicitly when item 4.5 ships.
- Percentile hides when the 24h window has fewer than 10 rows or any count fails. Ghost line shows only when stored best >= 10. Near-miss threshold: sliced drop with `|offset| <= perfectEps + almostEps`, `almostEps: 0.10` in CFG (tunable).
- Tier ladder (spec, tunable values, fixed structure): CARDBOARD 10, PLYWOOD 25, BRICK 45, MARBLE 70, GRANITE 100, STEEL 140, TITAN 190, OBSIDIAN 250. Never demote.

---

### Task 1: `mode` column migration + live verification

**Files:**
- No repo files. SQL runs against Supabase project `uidxgisstzpsmepoatpm` (certimanager), table `public.stack_scores`.

**Interfaces:**
- Consumes: existing table `(name text CHECK 1-16 chars, score int CHECK 1-10000, created_at timestamptz default now())`, RLS anon SELECT+INSERT.
- Produces: column `mode text not null default 'normal'` with CHECK `mode in ('normal','hard')`, readable and filterable by anon via PostgREST (`?mode=eq.normal`). Tasks 4-5 rely on exactly this name and default.

- [ ] **Step 1: Apply the migration**

Invoke the `supabase` skill and run against the certimanager project (fallback: hand this SQL to Maor for the dashboard SQL editor):

```sql
alter table public.stack_scores add column if not exists mode text not null default 'normal';
alter table public.stack_scores add constraint stack_scores_mode_check check (mode in ('normal','hard'));
```

- [ ] **Step 2: Verify via anon REST probes**

Run in PowerShell (publishable key, same one shipped in hud.js):

```powershell
$K = 'sb_publishable_xW4Ov4SgXIxL6wT2sZ2fuw_0fAO7vbI'
$U = 'https://uidxgisstzpsmepoatpm.supabase.co/rest/v1/stack_scores'
# a) mode visible and defaulted on existing rows
Invoke-RestMethod -Uri "$U?select=name,mode&limit=2" -Headers @{ apikey = $K }
# b) explicit valid mode accepted
Invoke-WebRequest -Uri $U -Method Post -Headers @{ apikey = $K; 'Content-Type' = 'application/json' } -Body '{"name":"MODEPROBE","score":1,"mode":"hard"}' | Select-Object -ExpandProperty StatusCode
# c) invalid mode rejected by the CHECK
try { Invoke-WebRequest -Uri $U -Method Post -Headers @{ apikey = $K; 'Content-Type' = 'application/json' } -Body '{"name":"MODEPROBE","score":1,"mode":"bogus"}' } catch { $_.Exception.Response.StatusCode.value__ }
# d) filter works
Invoke-RestMethod -Uri "$U?select=name&mode=eq.hard&name=eq.MODEPROBE" -Headers @{ apikey = $K }
```

Expected: (a) rows with `mode: normal`; (b) `201`; (c) `400`; (d) one `MODEPROBE` row.

If (b) returns 401/403, the table uses column-level insert grants; run `grant insert (mode) on public.stack_scores to anon;` and repeat (b).

- [ ] **Step 3: Delete the probe rows (project rule: the friends' board stays real)**

Via the same SQL surface:

```sql
delete from public.stack_scores where name = 'MODEPROBE';
```

Verify: `GET $U?select=name&name=eq.MODEPROBE` returns `[]`.

---

### Task 2: core.js emits `almost` on sliced placements

**Files:**
- Modify: `core.js` (CFG block ~line 67, sliced branch of `dropCurrent()` ~line 400, header doc block lines 45-52)
- Test: `<scratchpad>/pw-almost.js`

**Interfaces:**
- Consumes: `CFG.perfectEps` (0.14), existing `fireDom('stack:placed', {mesh, level, perfect})` in the sliced branch.
- Produces: `CFG.almostEps = 0.10`; sliced placements dispatch `stack:placed` with `almost: boolean` (`|delta| <= CFG.perfectEps + CFG.almostEps`). Perfect placements keep `perfect: true` and never carry `almost`. Task 3's visuals wiring receives the flag automatically (it already forwards the whole detail as opts).

- [ ] **Step 1: Write the failing test**

Write `<scratchpad>/pw-almost.js`:

```javascript
/* Near-miss flag on stack:placed. All leaderboard traffic mocked. */
const { chromium, devices } = require('playwright');
const TARGET_URL = process.env.STACK_URL ||
  'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const issues = [];
  page.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  await context.route('**/rest/v1/stack_scores*', route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 201, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]',
      headers: { 'content-range': '0-0/0' } });
  });
  await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });

  await page.touchscreen.tap(195, 500);
  await page.waitForTimeout(600);
  const caught = await page.evaluate(async () => {
    const events = [];
    window.addEventListener('stack:placed', e =>
      events.push({ perfect: !!e.detail.perfect, almost: e.detail.almost === true }));
    await new Promise(r => setTimeout(r, 300));
    window.StackCore.debug.drop(0);     // perfect
    window.StackCore.debug.drop(0.2);   // sliced, |0.2| <= 0.14+0.10 -> almost
    window.StackCore.debug.drop(0.6);   // sliced, far -> not almost
    return events;
  });
  if (caught.length !== 3) throw new Error('FAIL: expected 3 placements, got ' + JSON.stringify(caught));
  if (!caught[0].perfect || caught[0].almost) throw new Error('FAIL: perfect drop wrong ' + JSON.stringify(caught[0]));
  if (caught[1].perfect || !caught[1].almost) throw new Error('FAIL: near-miss not flagged ' + JSON.stringify(caught[1]));
  if (caught[2].perfect || caught[2].almost) throw new Error('FAIL: far slice flagged ' + JSON.stringify(caught[2]));
  if (issues.length) throw new Error('FAIL: page issues ' + JSON.stringify(issues));
  console.log('PASS: almost flag correct on all three drop classes');
  await browser.close();
})();
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd "C:\Users\maor4\.claude\plugins\cache\playwright-skill\playwright-skill\4.1.0\skills\playwright-skill" && node run.js "<scratchpad>/pw-almost.js"`
Expected: FAIL "near-miss not flagged" (detail.almost is undefined today).

- [ ] **Step 3: Implement**

3a. In `CFG`, after the `perfectEps: 0.14,` line add:

```javascript
    almostEps: 0.10,      // sliced drops within perfectEps+this of center flash
                          // a near-miss cue (retention spec, tunable)
```

3b. In `dropCurrent()`, in the sliced branch, replace:

```javascript
    fireDom('stack:placed', { mesh: m, level: dropped.index, perfect: false });
```

with:

```javascript
    fireDom('stack:placed', {
      mesh: m, level: dropped.index, perfect: false,
      almost: Math.abs(delta) <= CFG.perfectEps + CFG.almostEps
    });
```

3c. In the header doc block, change the Visuals-bridge line `'stack:placed' {mesh, level, perfect}` to `'stack:placed' {mesh, level, perfect, almost}`.

- [ ] **Step 4: Run the test to verify it passes**

Same command. Expected: `PASS: almost flag correct on all three drop classes`.

- [ ] **Step 5: Commit**

```bash
git add core.js
git commit -m "Core: flag near-miss slices (almost) on stack:placed"
```

---

### Task 3: visuals.js near-miss flash + ghost line

**Files:**
- Modify: `visuals.js` (`perfectFlash` ~line 627, `onBlockPlaced` ~line 685, state object `S` ~line 75, event wiring ~line 1071)
- Test: `<scratchpad>/pw-ghost.js`

**Interfaces:**
- Consumes: `stack:placed` detail `{mesh, level, perfect, almost}` (Task 2); `window.StackCore.getTowerState()` for `{best, blockHeight, blockSize}`; existing `meshFootprint`, `perfectFlash`, `startPulse`, `S`, `ctx.scene`, `T` (THREE).
- Produces: `perfectFlash(center, sx, sz, opacity)` gains an optional 4th param (default 1; exported API stays backward compatible). Ghost line: a dashed white square outline at `y = best * blockHeight + 0.01`, `mesh.userData.svGhost === true` (test hook), visible only when `best >= 10`, opacity 0.38 normally and 0.85 once passed. Rebuilt on every `stack:init`/`stack:reset`.

- [ ] **Step 1: Write the failing test**

Write `<scratchpad>/pw-ghost.js`:

```javascript
/* Ghost line: presence, height, gating, passed-state. LB traffic mocked. */
const { chromium, devices } = require('playwright');
const TARGET_URL = process.env.STACK_URL ||
  'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';

async function boot(browser, best) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const issues = [];
  page.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  await context.route('**/rest/v1/stack_scores*', route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 201, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]',
      headers: { 'content-range': '0-0/0' } });
  });
  if (best != null) {
    await context.addInitScript(b => {
      try { localStorage.setItem('stack-best', String(b)); } catch (e) {}
    }, best);
  }
  await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  return { context, page, issues };
}

function ghostProbe() {
  const scene = window.StackCore.scene;
  let g = null;
  scene.traverse(o => { if (o.userData && o.userData.svGhost) g = o; });
  return g ? { y: g.position.y, visible: g.visible, opacity: g.material.opacity } : null;
}

(async () => {
  const browser = await chromium.launch({ headless: false });

  // A: best=15 -> line at 15*0.62+0.01, faint
  let t = await boot(browser, 15);
  await t.page.touchscreen.tap(195, 500);
  await t.page.waitForTimeout(700);
  let g = await t.page.evaluate(ghostProbe);
  if (!g || !g.visible) throw new Error('FAIL A: ghost missing ' + JSON.stringify(g));
  if (Math.abs(g.y - (15 * 0.62 + 0.01)) > 0.001) throw new Error('FAIL A: wrong height ' + JSON.stringify(g));
  if (Math.abs(g.opacity - 0.38) > 0.001) throw new Error('FAIL A: wrong idle opacity ' + JSON.stringify(g));

  // B: pass the best -> record style
  await t.page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 300));
    window.StackCore.debug.build(16, 0);   // 16 perfect drops, score 16 > best 15
  });
  await t.page.waitForTimeout(400);
  g = await t.page.evaluate(ghostProbe);
  if (!g || Math.abs(g.opacity - 0.85) > 0.001) throw new Error('FAIL B: passed style missing ' + JSON.stringify(g));
  if (t.issues.length) throw new Error('FAIL B: page issues ' + JSON.stringify(t.issues));
  await t.context.close();
  console.log('A-B PASS: ghost height + passed state');

  // C: best below 10 -> no ghost
  t = await boot(browser, 7);
  await t.page.touchscreen.tap(195, 500);
  await t.page.waitForTimeout(700);
  g = await t.page.evaluate(ghostProbe);
  if (g && g.visible) throw new Error('FAIL C: ghost shown under threshold ' + JSON.stringify(g));
  if (t.issues.length) throw new Error('FAIL C: page issues ' + JSON.stringify(t.issues));
  await t.context.close();

  console.log('PASS: ghost line all sections');
  await browser.close();
})();
```

- [ ] **Step 2: Run it to confirm it fails**

Expected: FAIL A "ghost missing" (no svGhost object in the scene today).

- [ ] **Step 3: Implement in visuals.js**

3a. In `perfectFlash(center, sx, sz)`, change the signature to `perfectFlash(center, sx, sz, opacity)` and the last line from:

```javascript
    f.mesh.material.uniforms.uOpacity.value = 1;
```

to:

```javascript
    f.mesh.material.uniforms.uOpacity.value = opacity == null ? 1 : opacity;
```

3b. In `onBlockPlaced`, replace the `else` branch:

```javascript
    } else {
      startPulse(mesh, 0.016, false);
    }
```

with:

```javascript
    } else if (opts.almost) {
      /* Near-miss: hairline cue, clearly weaker than the perfect flash. */
      var afp = meshFootprint(mesh, {});
      if (afp) {
        perfectFlash(
          { x: afp.cx, y: afp.topY + 0.03 * S.blockW, z: afp.cz },
          afp.sx * 0.72, afp.sz * 0.72, 0.5
        );
      }
      startPulse(mesh, 0.03, false);
    } else {
      startPulse(mesh, 0.016, false);
    }
```

Then add the ghost check at the end of `onBlockPlaced` (after the if/else chain):

```javascript
    ghostCheckPassed(level);
```

3c. Add a ghost module right after the `startPulse` function:

```javascript
  /* ---- ghost line: dashed outline at the personal-best height ---------- */
  /* Reads StackCore.getTowerState() (public state seam); rebuilt fresh on
     every init/reset so visuals' own reset can never leave a stale mesh. */

  var GHOST = { line: null, best: 0, passed: false };

  function ghostRemove() {
    if (GHOST.line && ctx && ctx.scene) { ctx.scene.remove(GHOST.line); }
    if (GHOST.line) {
      if (GHOST.line.geometry) GHOST.line.geometry.dispose();
      if (GHOST.line.material) GHOST.line.material.dispose();
    }
    GHOST.line = null;
  }

  function ghostStyle(passed) {
    if (!GHOST.line) return;
    GHOST.line.material.opacity = passed ? 0.85 : 0.38;
  }

  function ghostSync() {
    if (!S.inited) return;
    ghostRemove();
    GHOST.passed = false;
    var core = window.StackCore;
    var st = core && core.getTowerState ? core.getTowerState() : null;
    GHOST.best = st && st.best ? st.best : 0;
    if (!st || GHOST.best < 10) return;
    var half = st.blockSize * 0.62;
    var pts = [
      new T.Vector3(-half, 0, -half), new T.Vector3(half, 0, -half),
      new T.Vector3(half, 0, half), new T.Vector3(-half, 0, half),
      new T.Vector3(-half, 0, -half)
    ];
    var geo = new T.BufferGeometry().setFromPoints(pts);
    var mat = new T.LineDashedMaterial({
      color: 0xffffff, transparent: true, opacity: 0.38,
      dashSize: 0.16, gapSize: 0.12, depthWrite: false
    });
    var line = new T.Line(geo, mat);
    line.computeLineDistances();
    line.position.y = GHOST.best * st.blockHeight + 0.01;
    line.userData.svGhost = true;
    line.renderOrder = 3;
    ctx.scene.add(line);
    GHOST.line = line;
  }

  function ghostCheckPassed(level) {
    if (!GHOST.line || GHOST.passed) return;
    if (typeof level === 'number' && level > GHOST.best) {
      GHOST.passed = true;
      ghostStyle(true);
    }
  }
```

3d. In the event wiring at the bottom, extend the two lifecycle listeners:

```javascript
  window.addEventListener('stack:init', function (e) {
    var d = det(e);
    init({ scene: d.scene, camera: d.camera, renderer: d.renderer, THREE: d.THREE });
    ghostSync();
  });
```

and:

```javascript
  window.addEventListener('stack:reset', function () { reset(); ghostSync(); });
  /* stack:reset only fires on restarts, and at stack:init time
     window.StackCore may not be assigned yet; game:start fires on every run
     start (including the first), so the ghost is guaranteed by then. */
  window.addEventListener('game:start', function () { ghostSync(); });
```

(`stack:reset` fires after `gameOver()` updated the stored best and before the tower rebuilds; `ghostSync` is idempotent, so the reset+start double call is harmless.)

- [ ] **Step 4: Run pw-ghost.js and pw-almost.js**

Expected: both PASS (pw-almost.js guards against a visuals-layer exception on almost drops).

- [ ] **Step 5: Commit**

```bash
git add visuals.js
git commit -m "Visuals: near-miss flash + dashed ghost line at personal best"
```

---

### Task 4: hud.js scoped boards, tabs, one-best-row-per-player

**Files:**
- Modify: `hud.js` (leaderboard constants ~line 307, `buildDom` lb + board panel blocks, `fetchTop`, `refreshBoard`, `refreshOverlayBoard`, `wireOutgoing`)
- Modify: `hud.css` (new `.hud-lb-tabs` block after `.hud-lb-status:empty`)
- Test: `<scratchpad>/pw-boards.js`

**Interfaces:**
- Consumes: Task 1's `mode` column live; existing `renderRows`, `renderBoard`, `readLocalBoard`, `applyRoast`, `rememberTop`, `keepKeysLocal`.
- Produces: `fetchTop(scope, cb)` where scope is `'day'` or `'all'`, returning deduped (first row per name, order preserved) top 10 from a 50-row fetch filtered `mode=eq.normal`, plus `created_at=gte.<now-24h ISO>` when `'day'`; `refreshBoard(scope, mine, wantRoast, myScore)` (myScore consumed in Task 5, pass `null` until then); death-board tabs default `'day'`, overlay-board tabs default `'all'`; tab DOM `.hud-lb-tabs` with two `.hud-lb-tab` buttons (`data-scope="day"` / `"all"`, active class `is-on`), death set in `els.lbTabs`, overlay set in `els.boardTabs`. Roast and `rememberTop` now run on the daily rows.

- [ ] **Step 1: Write the failing test**

Write `<scratchpad>/pw-boards.js`:

```javascript
/* Scoped boards: tabs, dedupe, mode filter. All LB traffic mocked. */
const { chromium, devices } = require('playwright');
const TARGET_URL = process.env.STACK_URL ||
  'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';

const DAY_ROWS = JSON.stringify([
  { name: 'DAYKING', score: 40 }, { name: 'DAYKING', score: 33 },
  { name: 'DAYPAL', score: 20 }, { name: 'DAYPAL', score: 3 }
]);
const ALL_ROWS = JSON.stringify([
  { name: 'ALLTIME', score: 900 }, { name: 'ALLTIME', score: 800 },
  { name: 'OLDGUY', score: 500 }
]);

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const issues = [];
  page.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  const gets = [];
  await context.route('**/rest/v1/stack_scores*', route => {
    const req = route.request();
    if (req.method() === 'POST') return route.fulfill({ status: 201, body: '' });
    const url = req.url();
    gets.push(url);
    const daily = url.indexOf('created_at=gte.') >= 0;
    return route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/0' },
      body: daily ? DAY_ROWS : ALL_ROWS
    });
  });
  await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });

  // Overlay board (trophy) defaults to ALL-TIME, deduped
  await page.click('.hud-board-btn');
  await page.waitForTimeout(600);
  let s = await page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('.hud-board-list li')).map(li => li.textContent),
    onTab: document.querySelector('.hud-board .hud-lb-tab.is-on').getAttribute('data-scope')
  }));
  if (s.onTab !== 'all') throw new Error('FAIL: overlay default tab ' + JSON.stringify(s));
  if (s.rows.length !== 2 || s.rows[0].indexOf('ALLTIME') < 0 || s.rows[0].indexOf('900') < 0)
    throw new Error('FAIL: overlay not deduped all-time ' + JSON.stringify(s));

  // Switch to TODAY
  await page.click('.hud-board .hud-lb-tab[data-scope="day"]');
  await page.waitForTimeout(600);
  s = await page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('.hud-board-list li')).map(li => li.textContent)
  }));
  if (s.rows.length !== 2 || s.rows[0].indexOf('DAYKING') < 0 || s.rows[1].indexOf('DAYPAL') < 0)
    throw new Error('FAIL: overlay day rows ' + JSON.stringify(s));
  await page.click('.hud-board-close');

  // Death board defaults to TODAY
  await page.touchscreen.tap(195, 500);
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 300));
    window.StackCore.debug.drop(0.5);
    window.StackCore.debug.drop(6);
  });
  await page.waitForSelector('#hud-root[data-state="over"]', { timeout: 5000 });
  await page.waitForTimeout(900);
  s = await page.evaluate(() => ({
    rows: Array.from(document.querySelectorAll('.hud-lb .hud-lb-list li')).map(li => li.textContent),
    onTab: document.querySelector('.hud-lb .hud-lb-tab.is-on').getAttribute('data-scope'),
    quip: document.querySelector('.hud-over-quip').textContent
  }));
  if (s.onTab !== 'day') throw new Error('FAIL: death default tab ' + JSON.stringify(s));
  if (s.rows.length !== 2 || s.rows[0].indexOf('DAYKING') < 0)
    throw new Error('FAIL: death board rows ' + JSON.stringify(s));
  if (s.quip.indexOf('DAY') < 0) throw new Error('FAIL: roast not from daily rows ' + JSON.stringify(s));

  // Every board GET carries the mode filter and the 50 cap
  const bad = gets.filter(u => u.indexOf('select=name,score') >= 0 &&
    (u.indexOf('mode=eq.normal') < 0 || u.indexOf('limit=50') < 0));
  if (bad.length) throw new Error('FAIL: unfiltered board GETs ' + JSON.stringify(bad));
  if (issues.length) throw new Error('FAIL: page issues ' + JSON.stringify(issues));
  console.log('PASS: scoped boards, tabs, dedupe, filters');
  await browser.close();
})();
```

- [ ] **Step 2: Run it to confirm it fails**

Expected: FAIL on the first evaluate (`.hud-lb-tab` does not exist).

- [ ] **Step 3: Implement in hud.js**

3a. Replace the `LB_QUERY` constant line with:

```javascript
  var LB_SELECT = '?select=name,score&order=score.desc,created_at.asc&limit=50';

  function dayFloorIso() {
    return new Date(Date.now() - 86400000).toISOString();
  }

  /* Every read is Normal-mode only; Hard gets its own board when modes ship. */
  function scopeFilter(scope) {
    var f = '&mode=eq.normal';
    if (scope === 'day') { f += '&created_at=gte.' + encodeURIComponent(dayFloorIso()); }
    return f;
  }

  /* One best row per player: rows arrive score-desc, keep the first per name. */
  function dedupeBest(rows) {
    var seen = {}, out = [], i, r, k;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!r || r.name == null) { continue; }
      k = String(r.name);
      if (seen[k]) { continue; }
      seen[k] = true;
      out.push(r);
    }
    return out;
  }
```

3b. Replace `fetchTop(cb)` with:

```javascript
  function fetchTop(scope, cb) {
    if (!window.fetch) { cb(null); return; }
    var done = false;
    var finish = function (rows) { if (!done) { done = true; cb(rows); } };
    var timer = setTimeout(function () { finish(null); }, LB_TIMEOUT_MS);
    try {
      window.fetch(LB_URL + LB_SELECT + scopeFilter(scope), { headers: { apikey: LB_KEY } })
        .then(function (r) { if (!r.ok) { throw new Error('http ' + r.status); } return r.json(); })
        .then(function (rows) {
          clearTimeout(timer);
          finish(Array.isArray(rows) ? dedupeBest(rows).slice(0, 10) : null);
        })
        .catch(function () { clearTimeout(timer); finish(null); });
    } catch (err) { clearTimeout(timer); finish(null); }
  }
```

3c. In `buildDom`, after the `var lbStatus = ...` line, add the death-board tabs and insert them between status and list (`lb.appendChild` order becomes title, status, tabs, list, entry):

```javascript
    var lbTabs = el('div', 'hud-lb-tabs');
    var lbTabDay = el('button', 'hud-lb-tab is-on', 'TODAY');
    lbTabDay.type = 'button';
    lbTabDay.setAttribute('data-scope', 'day');
    var lbTabAll = el('button', 'hud-lb-tab', 'ALL TIME');
    lbTabAll.type = 'button';
    lbTabAll.setAttribute('data-scope', 'all');
    lbTabs.appendChild(lbTabDay);
    lbTabs.appendChild(lbTabAll);
```

and in the board-panel block after `var boardStatus = ...` the same pattern with `is-on` on the ALL tab:

```javascript
    var boardTabs = el('div', 'hud-lb-tabs');
    var boardTabDay = el('button', 'hud-lb-tab', 'TODAY');
    boardTabDay.type = 'button';
    boardTabDay.setAttribute('data-scope', 'day');
    var boardTabAll = el('button', 'hud-lb-tab is-on', 'ALL TIME');
    boardTabAll.type = 'button';
    boardTabAll.setAttribute('data-scope', 'all');
    boardTabs.appendChild(boardTabDay);
    boardTabs.appendChild(boardTabAll);
```

Then insert `boardPanel.appendChild(boardTabs);` between the existing `boardPanel.appendChild(boardStatus);` and `boardPanel.appendChild(boardList);` lines, so the panel order is close, title, status, tabs, list. Extend the returned map with `lbTabs: lbTabs, lbTabDay: lbTabDay, lbTabAll: lbTabAll, boardTabDay: boardTabDay, boardTabAll: boardTabAll,`.

3d. Add scope state next to the `boardOpen` vars and a tab-sync helper next to `renderBoard`:

```javascript
  var deathScope = 'day';
  var overlayScope = 'all';

  function markTab(onBtn, offBtn) {
    onBtn.classList.add('is-on');
    offBtn.classList.remove('is-on');
  }
```

3e. Replace `refreshBoard` with (the `myScore` argument is wired for Task 5; passing `null` keeps behavior identical):

```javascript
  function refreshBoard(scope, mine, wantRoast, myScore) {
    els.lbStatus.textContent = 'LOADING';
    fetchTop(scope, function (rows) {
      if (rows) {
        renderBoard(rows, mine, '');
        if (wantRoast && state.mode === 'over') { applyRoast(rows); }
        if (myScore != null && state.mode === 'over') { showVictim(rows, myScore); }
        rememberTop(rows);
      }
      else { renderBoard(readLocalBoard(), mine, 'THIS DEVICE ONLY'); }
    });
  }
```

Until Task 5 lands, include this stub next to it so the file stays runnable (Task 5 replaces it):

```javascript
  function showVictim(rows, myScore) { /* Task 5 fills this in */ }
```

Update the two existing callers: in `applyOver` `refreshBoard(null, true)` becomes `refreshBoard(deathScope, null, true, null)`; in `autoSubmit` `refreshBoard({ name: name, score: score }, true)` becomes `refreshBoard(deathScope, { name: name, score: score }, true, null)`. In `applyOver`, before the fetch branch, reset the death tab to the default: `deathScope = 'day'; markTab(els.lbTabDay, els.lbTabAll);`.

3f. Replace `refreshOverlayBoard` body's `fetchTop(function (rows) {` with `fetchTop(overlayScope, function (rows) {`.

3g. In `wireOutgoing`, after the `els.boardClose.addEventListener` line, wire the four tabs:

```javascript
    els.lbTabDay.addEventListener('click', function () {
      deathScope = 'day'; markTab(els.lbTabDay, els.lbTabAll);
      refreshBoard(deathScope, null, false, null);
    });
    els.lbTabAll.addEventListener('click', function () {
      deathScope = 'all'; markTab(els.lbTabAll, els.lbTabDay);
      refreshBoard(deathScope, null, false, null);
    });
    els.boardTabDay.addEventListener('click', function () {
      overlayScope = 'day'; markTab(els.boardTabDay, els.boardTabAll);
      refreshOverlayBoard(true);
    });
    els.boardTabAll.addEventListener('click', function () {
      overlayScope = 'all'; markTab(els.boardTabAll, els.boardTabDay);
      refreshOverlayBoard(true);
    });
    keepKeysLocal(els.lbTabDay);
    keepKeysLocal(els.lbTabAll);
    keepKeysLocal(els.boardTabDay);
    keepKeysLocal(els.boardTabAll);
```

In `tryRestart`, extend the exclusion selector to `'.hud-lb-entry, .hud-lb-auto, .hud-lb-tabs'`.

3h. Death-board title: in `buildDom` change `var lbTitle = el('div', 'hud-lb-title', 'TOP 10');` to `'TOP TOWERS'` and the overlay `boardTitle` the same way (the tabs now carry the scope wording).

- [ ] **Step 4: hud.css addition**

After the `.hud-lb-status:empty` rule add:

```css
/* Board scope tabs: TODAY | ALL TIME */
.hud-lb-tabs {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-top: 1vh;
  pointer-events: auto;
}
.hud-lb-tab {
  pointer-events: auto;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.35);
  background: transparent;
  border-radius: 999px;
  padding: 0.28em 0.9em 0.28em 1.08em; /* extra left pad balances letter-spacing */
  font-size: clamp(10px, 1.5vmin, 12px);
  font-weight: 300;
  letter-spacing: 0.18em;
  opacity: 0.6;
  transition: opacity 0.18s ease, background-color 0.18s ease;
}
.hud-lb-tab.is-on {
  opacity: 1;
  border-color: rgba(255, 255, 255, 0.8);
  background: rgba(255, 255, 255, 0.10);
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.18);
}
.hud-lb-tab:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
```

- [ ] **Step 5: Run pw-boards.js until PASS, then regressions**

Run pw-boards.js (PASS), then pw-almost.js and pw-ghost.js (PASS; their GET mock returns `[]` for any scope).

- [ ] **Step 6: Commit**

```bash
git add hud.js hud.css
git commit -m "Boards: TODAY/ALL-TIME tabs, rolling-24h scope, one best row per player, mode filter"
```

---

### Task 5: death-screen percentile + next-victim lines

**Files:**
- Modify: `hud.js` (`buildDom` over-panel block, `countRows` new helper next to `fetchTop`, `showVictim` stub from Task 4, `applyOver`)
- Modify: `hud.css` (two rules after `.hud-over-best`)
- Test: `<scratchpad>/pw-deathlines.js`

**Interfaces:**
- Consumes: `fetchTop`/`scopeFilter`/`refreshBoard(scope, mine, wantRoast, myScore)` from Task 4; `lrm`, `readBest`, `LB_URL`, `LB_KEY`, `LB_TIMEOUT_MS`.
- Produces: `els.overPct` (`.hud-over-pct`) and `els.overVictim` (`.hud-over-victim`), both hidden until filled; `countRows(filters, cb)` HEAD-count helper returning a number or null; `showPercentile(score)`; real `showVictim(rows, myScore)`. Percentile shows only when the 24h Normal window has >= 10 rows.

- [ ] **Step 1: Write the failing test**

Write `<scratchpad>/pw-deathlines.js`:

```javascript
/* Percentile + victim lines on death. All LB traffic mocked. */
const { chromium, devices } = require('playwright');
const TARGET_URL = process.env.STACK_URL ||
  'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';

const DAY_ROWS = JSON.stringify([
  { name: 'DAYKING', score: 40 }, { name: 'DAYPAL', score: 1 }
]);

async function run(browser, opts) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const issues = [];
  page.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  await context.route('**/rest/v1/stack_scores*', route => {
    const req = route.request();
    if (req.method() === 'POST') return route.fulfill({ status: 201, body: '' });
    const url = req.url();
    if (req.method() === 'HEAD') {
      const above = url.indexOf('score=gt.') >= 0;
      return route.fulfill({ status: 200,
        headers: { 'content-range': above ? '0-0/' + opts.above : '0-0/' + opts.total } });
    }
    return route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/0' }, body: DAY_ROWS });
  });
  await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await page.touchscreen.tap(195, 500);
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 300));
    window.StackCore.debug.drop(0.5);   // score 1
    window.StackCore.debug.drop(6);     // miss -> over
  });
  await page.waitForSelector('#hud-root[data-state="over"]', { timeout: 5000 });
  await page.waitForTimeout(900);
  const s = await page.evaluate(() => ({
    pctHidden: document.querySelector('.hud-over-pct').hidden,
    pct: document.querySelector('.hud-over-pct').textContent,
    vicHidden: document.querySelector('.hud-over-victim').hidden,
    vic: document.querySelector('.hud-over-victim').textContent
  }));
  if (issues.length) throw new Error('FAIL: page issues ' + JSON.stringify(issues));
  await context.close();
  return s;
}

(async () => {
  const browser = await chromium.launch({ headless: false });

  // A: total 40, 8 above my score of 1 -> TOP 23% TODAY.
  // Victim: nearest row >= my score is the TIE, DAYPAL(1); a tie ranks above
  // me (earlier created_at) and passing it needs +1 -> "1 MORE PASSES DAYPAL".
  let s = await run(browser, { total: 40, above: 8 });
  if (s.pctHidden || s.pct !== 'TOP 23% TODAY') throw new Error('FAIL A pct: ' + JSON.stringify(s));
  if (s.vicHidden || s.vic.indexOf('1 MORE PASSES') !== 0 || s.vic.indexOf('DAYPAL') < 0)
    throw new Error('FAIL A victim: ' + JSON.stringify(s));
  console.log('A PASS: ' + s.pct + ' | ' + s.vic);

  // B: thin window (total 4) -> percentile stays hidden, victim still shows
  s = await run(browser, { total: 4, above: 1 });
  if (!s.pctHidden) throw new Error('FAIL B: pct shown on thin window ' + JSON.stringify(s));
  if (s.vicHidden || s.vic.indexOf('DAYPAL') < 0) throw new Error('FAIL B: victim missing ' + JSON.stringify(s));

  console.log('PASS: death lines');
  await browser.close();
})();
```

Section A math check: score 1, `DAYKING` at 40 is the nearest row `>= 1` excluding self, need `40 - 1 + 1 = 40`; percentile `round((8+1)/40*100) = 23`.

- [ ] **Step 2: Run it to confirm it fails**

Expected: FAIL on the evaluate (`.hud-over-pct` does not exist).

- [ ] **Step 3: Implement in hud.js**

3a. In `buildDom`, after the `var overBest = ...` line add:

```javascript
    var overPct = el('div', 'hud-over-pct hud-anim d3', '');
    overPct.hidden = true;
    var overVictim = el('div', 'hud-over-victim hud-anim d4', '');
    overVictim.hidden = true;
```

Append them in panel order right after `panel.appendChild(overBest);`:

```javascript
    panel.appendChild(overPct);
    panel.appendChild(overVictim);
```

Extend the returned map with `overPct: overPct, overVictim: overVictim,`.

3b. Next to `fetchTop`, add the HEAD-count helper:

```javascript
  /* HEAD + Prefer count=exact: row count for a filter, no rows transferred. */
  function countRows(filters, cb) {
    if (!window.fetch) { cb(null); return; }
    var done = false;
    var finish = function (n) { if (!done) { done = true; cb(n); } };
    var timer = setTimeout(function () { finish(null); }, LB_TIMEOUT_MS);
    try {
      window.fetch(LB_URL + '?select=score' + filters + '&limit=1', {
        method: 'HEAD',
        headers: { apikey: LB_KEY, Prefer: 'count=exact' }
      })
        .then(function (r) {
          clearTimeout(timer);
          var cr = (r.headers.get('content-range') || '').split('/')[1];
          var n = parseInt(cr, 10);
          finish(isFinite(n) ? n : null);
        })
        .catch(function () { clearTimeout(timer); finish(null); });
    } catch (err) { clearTimeout(timer); finish(null); }
  }
```

3c. Replace the Task 4 `showVictim` stub and add `showPercentile`:

```javascript
  /* "N MORE PASSES <name>": the daily row just above me; fallback: my best. */
  function showVictim(rows, myScore) {
    if (!(myScore > 0)) { return; }
    var above = null, i, r;
    if (rows && rows.length) {
      for (i = rows.length - 1; i >= 0; i--) {
        r = rows[i];
        if (r && typeof r.score === 'number' && r.score >= myScore &&
            r.name !== readName()) { above = r; break; }
      }
    }
    if (above) {
      els.overVictim.textContent =
        (above.score - myScore + 1) + ' MORE PASSES ' +
        lrm(String(above.name).slice(0, 16));
      els.overVictim.hidden = false;
      return;
    }
    var best = readBest();
    if (best > myScore) {
      els.overVictim.textContent = (best - myScore) + ' FROM YOUR BEST';
      els.overVictim.hidden = false;
    }
  }

  /* "TOP N% TODAY" from two window counts; hidden when thin (<10) or offline. */
  function showPercentile(score) {
    var windowF = scopeFilter('day');
    countRows(windowF, function (total) {
      if (state.mode !== 'over' || total == null || total < 10) { return; }
      countRows(windowF + '&score=gt.' + score, function (above) {
        if (state.mode !== 'over' || above == null) { return; }
        var pct = Math.max(1, Math.round(((above + 1) / total) * 100));
        els.overPct.textContent = 'TOP ' + pct + '% TODAY';
        els.overPct.hidden = false;
      });
    });
  }
```

3d. In `applyOver`: right after `els.newBest.hidden = !isNewBest;` add:

```javascript
    els.overPct.hidden = true;
    els.overPct.textContent = '';
    els.overVictim.hidden = true;
    els.overVictim.textContent = '';
    if (finalScore > 0) { showPercentile(finalScore); }
```

and update the two `refreshBoard` calls to pass the score: in the auto branch `autoSubmit(autoName, finalScore);` stays (its internal call updates below), in the else branch `refreshBoard(deathScope, null, true, finalScore);`. In `autoSubmit`, the success-callback call becomes `refreshBoard(deathScope, { name: name, score: score }, true, score);`.

- [ ] **Step 4: hud.css addition**

After the `.hud-over-best` rule add:

```css
.hud-over-pct {
  margin-top: 1.2vh;
  font-size: clamp(12px, 1.9vmin, 16px);
  font-weight: 300;
  letter-spacing: 0.3em;
  margin-right: -0.3em;
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.45);
}
.hud-over-pct[hidden] {
  display: none;
}
.hud-over-victim {
  margin-top: 0.8vh;
  font-size: clamp(11px, 1.7vmin, 14px);
  font-weight: 300;
  letter-spacing: 0.24em;
  margin-right: -0.24em;
  opacity: 0.8;
}
.hud-over-victim[hidden] {
  display: none;
}
```

- [ ] **Step 5: Run pw-deathlines.js until PASS, then pw-boards.js**

pw-boards.js keeps passing (its HEAD mock returns `0-0/0`, thin window, percentile stays hidden there).

- [ ] **Step 6: Commit**

```bash
git add hud.js hud.css
git commit -m "Death screen: TOP N% TODAY percentile + next-victim line"
```

---

### Task 6: tier ladder, title chip, records panel

**Files:**
- Modify: `hud.js` (constants near `BEST_KEY`, `buildDom` title + a new records overlay, `renderTitleBest`, `applyPerfect`, `applyScore`, `applyOver`, `tryStart`, `wireOutgoing`, keydown handler)
- Modify: `hud.css` (title tier block, records overlay rows, after the `.hud-board-list` rule)
- Test: `<scratchpad>/pw-tiers.js`

**Interfaces:**
- Consumes: `readBest`, `el`, `setMode`/`renderTitleBest`, board overlay CSS classes (`.hud-board`, `.hud-board-panel`, `.hud-board-close`), `keepKeysLocal`, `pickNumber`.
- Produces: `TIERS` table and `tierFor(best)` -> `{cur: {name, at, idx}|null, next: {name, at, idx}|null}`; `tierLine(best)` -> display string; localStorage keys `stack-best-streak`, `stack-blocks-ever`, `stack-today` (`{"d":"YYYY-MM-DD","best":n}`, local device date); `.hud-title-tier` + `.hud-title-bar` + `.hud-title-records` on the title; `.hud-over-tier` line on death; `.hud-records` overlay with `data-records="open"` root attribute.

- [ ] **Step 1: Write the failing test**

Write `<scratchpad>/pw-tiers.js`:

```javascript
/* Tiers, records panel, stat tracking. All LB traffic mocked. */
const { chromium, devices } = require('playwright');
const TARGET_URL = process.env.STACK_URL ||
  'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const issues = [];
  page.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  await context.route('**/rest/v1/stack_scores*', route => {
    if (route.request().method() === 'POST') return route.fulfill({ status: 201, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json',
      headers: { 'content-range': '0-0/0' }, body: '[]' });
  });
  await context.addInitScript(() => {
    try { localStorage.setItem('stack-best', '87'); } catch (e) {}
  });
  await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });

  // A: title tier chip for best=87 -> MARBLE, 13 TO GRANITE, bar ~57%
  let s = await page.evaluate(() => ({
    tier: document.querySelector('.hud-title-tier').textContent,
    bar: document.querySelector('.hud-title-bar i').style.width
  }));
  if (s.tier !== 'MARBLE \u00b7 13 TO GRANITE') throw new Error('FAIL A tier: ' + JSON.stringify(s));
  if (s.bar !== '57%') throw new Error('FAIL A bar: ' + JSON.stringify(s));
  console.log('A PASS: title chip ' + s.tier);

  // B: RECORDS opens the panel without starting a run
  await page.click('.hud-title-records');
  await page.waitForTimeout(400);
  s = await page.evaluate(() => ({
    open: document.getElementById('hud-root').getAttribute('data-records'),
    mode: document.getElementById('hud-root').getAttribute('data-state'),
    best: document.querySelector('.hud-rec-best').textContent
  }));
  if (s.open !== 'open' || s.mode !== 'title') throw new Error('FAIL B open: ' + JSON.stringify(s));
  if (s.best !== '87') throw new Error('FAIL B best row: ' + JSON.stringify(s));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  s = await page.evaluate(() =>
    ({ open: document.getElementById('hud-root').getAttribute('data-records') }));
  if (s.open) throw new Error('FAIL B close: ' + JSON.stringify(s));
  console.log('B PASS: records panel open/close, no run started');

  // C: a run updates streak, blocks-ever, today; death shows tier line
  await page.touchscreen.tap(195, 500);
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 300));
    window.StackCore.debug.build(4, 0);   // 4 perfect drops, combo 4
    window.StackCore.debug.drop(6);       // miss -> over, score 4
  });
  await page.waitForSelector('#hud-root[data-state="over"]', { timeout: 5000 });
  await page.waitForTimeout(600);
  s = await page.evaluate(() => ({
    streak: localStorage.getItem('stack-best-streak'),
    blocks: localStorage.getItem('stack-blocks-ever'),
    today: JSON.parse(localStorage.getItem('stack-today') || '{}'),
    overTier: document.querySelector('.hud-over-tier').textContent
  }));
  if (s.streak !== '4') throw new Error('FAIL C streak: ' + JSON.stringify(s));
  if (s.blocks !== '4') throw new Error('FAIL C blocks: ' + JSON.stringify(s));
  if (s.today.best !== 4 || !/^\d{4}-\d{2}-\d{2}$/.test(s.today.d || ''))
    throw new Error('FAIL C today: ' + JSON.stringify(s));
  if (s.overTier !== 'MARBLE \u00b7 13 TO GRANITE') throw new Error('FAIL C over tier: ' + JSON.stringify(s));
  if (issues.length) throw new Error('FAIL: page issues ' + JSON.stringify(issues));
  console.log('PASS: tiers + records + stats');
  await browser.close();
})();
```

Bar math check: best 87, MARBLE at 70, GRANITE at 100 -> `(87-70)/(100-70) = 0.566 -> 57%`.

- [ ] **Step 2: Run it to confirm it fails**

Expected: FAIL A (`.hud-title-tier` does not exist).

- [ ] **Step 3: Implement in hud.js**

3a. After the `MUTE_KEY` constant add:

```javascript
  var STREAK_KEY = 'stack-best-streak';
  var BLOCKS_KEY = 'stack-blocks-ever';
  var TODAY_KEY = 'stack-today';

  /* Non-demoting ladder from the all-time Normal best (retention spec). */
  var TIERS = [
    ['CARDBOARD', 10], ['PLYWOOD', 25], ['BRICK', 45], ['MARBLE', 70],
    ['GRANITE', 100], ['STEEL', 140], ['TITAN', 190], ['OBSIDIAN', 250]
  ];

  function tierFor(best) {
    var cur = null, next = null, i;
    for (i = 0; i < TIERS.length; i++) {
      if (best >= TIERS[i][1]) { cur = { name: TIERS[i][0], at: TIERS[i][1], idx: i }; }
      else { next = { name: TIERS[i][0], at: TIERS[i][1], idx: i }; break; }
    }
    return { cur: cur, next: next };
  }

  function tierLine(best) {
    var t = tierFor(best);
    if (!t.cur && !t.next) { return ''; }
    if (!t.cur) { return (t.next.at - best) + ' TO ' + t.next.name; }
    if (!t.next) { return t.cur.name; }
    return t.cur.name + ' \u00b7 ' + (t.next.at - best) + ' TO ' + t.next.name;
  }

  function tierProgress(best) {
    var t = tierFor(best);
    if (!t.next) { return 1; }
    var floor = t.cur ? t.cur.at : 0;
    return Math.max(0, Math.min(1, (best - floor) / (t.next.at - floor)));
  }

  function readInt(key) {
    try {
      var v = parseInt(window.localStorage.getItem(key), 10);
      return isFinite(v) && v > 0 ? v : 0;
    } catch (err) { return 0; }
  }

  function writeInt(key, v) {
    try { window.localStorage.setItem(key, String(v)); } catch (err) { /* ignore */ }
  }

  function localDateStr() {
    var d = new Date();
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
  }

  function readToday() {
    try {
      var v = JSON.parse(window.localStorage.getItem(TODAY_KEY) || 'null');
      if (v && v.d === localDateStr() && typeof v.best === 'number') { return v; }
    } catch (err) { /* ignore */ }
    return { d: localDateStr(), best: 0 };
  }

  function writeToday(v) {
    try { window.localStorage.setItem(TODAY_KEY, JSON.stringify(v)); } catch (err) { /* ignore */ }
  }
```

3b. In `buildDom`, after `title.appendChild(titleBest);` add the tier chip, bar, and records button:

```javascript
    var titleTier = el('div', 'hud-title-tier', '');
    var titleBar = el('div', 'hud-title-bar');
    var titleBarFill = el('i', null);
    titleBar.appendChild(titleBarFill);
    var recordsBtn = el('button', 'hud-title-records', 'RECORDS');
    recordsBtn.type = 'button';
    title.appendChild(titleTier);
    title.appendChild(titleBar);
    title.appendChild(recordsBtn);
```

After `var overBest = ...` (and Task 5's overPct/overVictim) add the death tier line and append it right after `panel.appendChild(overBest);`:

```javascript
    var overTier = el('div', 'hud-over-tier hud-anim d3', '');
    overTier.hidden = true;
```

```javascript
    panel.appendChild(overTier);
```

Before the `root.appendChild` block, add the records overlay (board-pattern reuse):

```javascript
    var records = el('div', 'hud-board hud-records');
    var recPanel = el('div', 'hud-board-panel');
    var recClose = el('button', 'hud-board-close');
    recClose.type = 'button';
    recClose.setAttribute('aria-label', 'Close records');
    recClose.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    var recTitle = el('div', 'hud-lb-title', 'RECORDS');
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
    var recBar = el('div', 'hud-title-bar hud-rec-bar');
    var recBarFill = el('i', null);
    recBar.appendChild(recBarFill);
    var recTier = el('div', 'hud-rec-tier', '');
    recPanel.appendChild(recClose);
    recPanel.appendChild(recTitle);
    recPanel.appendChild(recBest.row);
    recPanel.appendChild(recStreak.row);
    recPanel.appendChild(recToday.row);
    recPanel.appendChild(recBlocks.row);
    recPanel.appendChild(recBar);
    recPanel.appendChild(recTier);
    records.appendChild(recPanel);
```

Append `root.appendChild(records);` after `root.appendChild(board);` and extend the returned map with:

```javascript
      titleTier: titleTier,
      titleBarFill: titleBarFill,
      recordsBtn: recordsBtn,
      overTier: overTier,
      records: records,
      recClose: recClose,
      recBest: recBest.val,
      recStreak: recStreak.val,
      recToday: recToday.val,
      recBlocks: recBlocks.val,
      recBarFill: recBarFill,
      recTier: recTier,
```

3c. Extend `renderTitleBest` (it currently only fills `titleBest`; find it above `setMode`) by appending at its end:

```javascript
    var b = readBest();
    els.titleTier.textContent = tierLine(b);
    els.titleBarFill.style.width = Math.round(tierProgress(b) * 100) + '%';
```

3d. Stat tracking. In `applyScore`, after the `if (state.mode === 'playing' && n > prev) { pop(); }` line add:

```javascript
    if (state.mode === 'playing' && n > prev) {
      writeInt(BLOCKS_KEY, readInt(BLOCKS_KEY) + (n - prev));
    }
```

In `applyPerfect`, change the signature to `applyPerfect(detail)` (the `on(...)` wiring already passes the detail through) and add before the retrigger:

```javascript
    var combo = pickNumber(detail, ['combo']);
    if (combo != null && combo > readInt(STREAK_KEY)) { writeInt(STREAK_KEY, combo); }
```

In `applyOver`, after the `if (best > storedBest) { writeBest(best); }` line add:

```javascript
    var today = readToday();
    if (finalScore > today.best) { today.best = finalScore; writeToday(today); }
    els.overTier.textContent = tierLine(best);
    els.overTier.hidden = !els.overTier.textContent;
```

3e. Records open/close, next to the board pair:

```javascript
  var recordsOpen = false;

  function renderRecords() {
    var b = readBest();
    els.recBest.textContent = String(b);
    els.recStreak.textContent = String(readInt(STREAK_KEY));
    els.recToday.textContent = String(readToday().best);
    els.recBlocks.textContent = String(readInt(BLOCKS_KEY));
    els.recBarFill.style.width = Math.round(tierProgress(b) * 100) + '%';
    els.recTier.textContent = tierLine(b);
  }

  function openRecords() {
    if (recordsOpen) { return; }
    recordsOpen = true;
    renderRecords();
    els.root.setAttribute('data-records', 'open');
  }

  function closeRecords() {
    if (!recordsOpen) { return; }
    recordsOpen = false;
    els.root.removeAttribute('data-records');
  }
```

3f. Wiring. In `tryStart`, change the signature to `tryStart(ev)` and add as the first line:

```javascript
    if (ev && ev.target && ev.target.closest && ev.target.closest('.hud-title-records')) { return; }
```

In `wireOutgoing` add (next to the board wiring):

```javascript
    els.recordsBtn.addEventListener('click', openRecords);
    els.recClose.addEventListener('click', closeRecords);
    els.records.addEventListener('pointerdown', function (ev) {
      if (ev.target === els.records) { closeRecords(); }
    });
    keepKeysLocal(els.recordsBtn);
```

In the window keydown handler, change the `if (boardOpen) {` block to:

```javascript
      if (boardOpen || recordsOpen) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          if (boardOpen) { closeBoard(); }
          if (recordsOpen) { closeRecords(); }
        }
        return; /* overlay views swallow all other keys */
      }
```

- [ ] **Step 4: hud.css addition**

After the `.hud-board-list` rule add:

```css
/* Title tier chip + progress bar + records pill */
.hud-title-tier {
  margin-top: 2.6vh;
  font-size: clamp(11px, 1.7vmin, 14px);
  font-weight: 300;
  letter-spacing: 0.3em;
  margin-right: -0.3em;
  text-shadow: 0 0 12px rgba(255, 255, 255, 0.4);
}
.hud-title-tier:empty {
  display: none;
}
.hud-title-bar {
  margin-top: 1.2vh;
  width: min(38vw, 170px);
  height: 3px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.25);
  overflow: hidden;
}
.hud-title-bar i {
  display: block;
  height: 100%;
  width: 0;
  border-radius: 3px;
  background: #fff;
  box-shadow: 0 0 8px rgba(255, 255, 255, 0.8);
  transition: width 0.5s cubic-bezier(0.2, 0.7, 0.25, 1);
}
.hud-title-records {
  pointer-events: auto;
  cursor: pointer;
  margin-top: 3.2vh;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.08);
  border-radius: 999px;
  padding: 0.5em 1.2em 0.5em 1.42em; /* extra left pad balances letter-spacing */
  font-size: clamp(10px, 1.6vmin, 13px);
  font-weight: 300;
  letter-spacing: 0.22em;
  transition: background-color 0.18s ease, transform 0.18s ease;
}
.hud-title-records:hover {
  background: rgba(255, 255, 255, 0.16);
}
.hud-title-records:active {
  transform: scale(0.95);
}
.hud-title-records:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}

/* Death-screen tier line */
.hud-over-tier {
  margin-top: 0.8vh;
  font-size: clamp(11px, 1.7vmin, 14px);
  font-weight: 300;
  letter-spacing: 0.26em;
  margin-right: -0.26em;
  opacity: 0.72;
}
.hud-over-tier[hidden] {
  display: none;
}

/* Records overlay reuses the board shell; only rows are new */
.hud-records {
  z-index: 121; /* above the trophy board if both ever open */
}
#hud-root[data-records="open"] .hud-records {
  opacity: 1;
  visibility: visible;
  pointer-events: auto;
  transition: opacity 0.3s ease;
}
.hud-rec-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  padding: 1vh 2px 0;
  font-size: clamp(12px, 1.9vmin, 16px);
  font-weight: 300;
  letter-spacing: 0.14em;
}
.hud-rec-label {
  opacity: 0.66;
  font-size: clamp(10px, 1.5vmin, 12px);
  letter-spacing: 0.24em;
}
.hud-rec-val {
  font-variant-numeric: lining-nums tabular-nums;
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.3);
}
.hud-rec-bar {
  margin: 2.2vh auto 0;
}
.hud-rec-tier {
  margin-top: 1vh;
  text-align: center;
  font-size: clamp(10px, 1.5vmin, 12px);
  font-weight: 300;
  letter-spacing: 0.24em;
  opacity: 0.75;
}
```

Note: `.hud-records` inherits `.hud-board`'s hidden default; the `data-records` selector above is its only opener. The `data-board` selector cannot open it because the records root lacks nothing: it shares `.hud-board` class, so ALSO add this guard right after the existing `#hud-root[data-board="open"] .hud-board` rule:

```css
#hud-root[data-board="open"] .hud-records {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
```

- [ ] **Step 5: Run pw-tiers.js until PASS, then the full local suite**

pw-tiers.js PASS, then pw-almost.js, pw-ghost.js, pw-boards.js, pw-deathlines.js all PASS.

- [ ] **Step 6: Commit**

```bash
git add hud.js hud.css
git commit -m "Tiers: non-demoting ladder, title chip + progress, records panel"
```

---

### Task 7: offline build + full regression

**Files:**
- Regenerate: `Stack.html` via `node scripts/build-offline.mjs`
- Test: `<scratchpad>/pw-offline-check.js`

**Interfaces:**
- Consumes: everything above, `scripts/build-offline.mjs` (in-repo inliner).
- Produces: updated `Stack.html` with all four source files inlined; the offline file must boot to title with the tier chip and no console errors, boards showing the local fallback.

- [ ] **Step 1: Rebuild**

Run: `node scripts/build-offline.mjs` (from the repo root). Expected: exit 0, `Stack.html` regenerated.

- [ ] **Step 2: Write and run the offline smoke test**

Write `<scratchpad>/pw-offline-check.js`:

```javascript
/* Offline single-file build: boots, tier chip renders, no network needed. */
const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ...devices['iPhone 13'], offline: true });
  const page = await context.newPage();
  const issues = [];
  page.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  await context.addInitScript(() => {
    try { localStorage.setItem('stack-best', '30'); } catch (e) {}
  });
  await page.goto('file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/Stack.html?debug=1',
    { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  const s = await page.evaluate(() => ({
    tier: document.querySelector('.hud-title-tier').textContent,
    three: !!window.THREE
  }));
  if (!s.three) throw new Error('FAIL: THREE not inlined');
  // best 30: PLYWOOD (25) held, BRICK (45) next -> 15 to go
  if (s.tier !== 'PLYWOOD \u00b7 15 TO BRICK') throw new Error('FAIL: tier chip ' + JSON.stringify(s));
  // one full run offline: boards fall back to the device list, nothing crashes
  await page.touchscreen.tap(195, 500);
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 300));
    window.StackCore.debug.drop(0.5);
    window.StackCore.debug.drop(6);
  });
  await page.waitForSelector('#hud-root[data-state="over"]', { timeout: 5000 });
  await page.waitForTimeout(1200);
  const o = await page.evaluate(() => ({
    pctHidden: document.querySelector('.hud-over-pct').hidden,
    status: document.querySelector('.hud-lb .hud-lb-status').textContent
  }));
  if (!o.pctHidden) throw new Error('FAIL: percentile shown offline ' + JSON.stringify(o));
  if (o.status !== 'THIS DEVICE ONLY') throw new Error('FAIL: local fallback ' + JSON.stringify(o));
  if (issues.length) throw new Error('FAIL: page issues ' + JSON.stringify(issues));
  console.log('PASS: offline build');
  await browser.close();
})();
```

- [ ] **Step 3: Commit**

```bash
git add Stack.html
git commit -m "Rebuild offline Stack.html with competitive layer v1"
```

---

## Rollout (controller, after all tasks green)

1. Confirm Task 1 ran against live (it did, first) and probe rows are gone.
2. Ask Maor before pushing (public repo + auto-deploy). Then: push to main, poll Pages ~1 min.
3. Run pw-boards.js and pw-deathlines.js with `STACK_URL='https://maores.github.io/stack-tower/?debug=1'` (interception keeps them insert-free), plus one manual-eyes emulated-phone pass: title chip, tabs flip, death lines stagger in, ghost line visible with a real best.
4. Read-only board hygiene check (no probe rows, top-10 sane).
5. Update the roadmap memory (item 3 shipped), vault note + daily line.
6. Spec success criteria to verify explicitly: death -> new run still <= 2 taps; three progress signals on a fresh profile's first session (tier by 10, percentile when window >= 10, records panel); no frame-pacing complaints in the fps ring (`StackCore.debug.fps()` worst < 34ms on the test machine).

## Self-review notes

- Spec coverage: mode column (T1), near-miss (T2+T3), ghost + record flip (T3), daily/all-time tabs + dedupe + roast-on-daily (T4), percentile + victim + fallbacks (T5), tiers + records + stat keys (T6), offline degradation (T7 + fetch guards throughout). Deliberately absent per Global Constraints: points, shop, Hard mode, revive.
- Deploy-order guard restated: T1 before T4+ reaches live. Code deploys atomically on push, so the only risky window is running local code against live DB pre-migration; T1 runs first in this plan.
- Type consistency: `fetchTop(scope, cb)` matches all four call sites (refreshBoard, refreshOverlayBoard x2 via overlayScope, tab handlers via refreshBoard); `refreshBoard(scope, mine, wantRoast, myScore)` matches applyOver + autoSubmit + tab handlers; `tierLine`/`tierProgress` used in renderTitleBest, applyOver, renderRecords; storage keys appear once each in constants and only via readInt/writeInt/readToday/writeToday.
- Test-name consistency: `.hud-lb-tab`, `.hud-over-pct`, `.hud-over-victim`, `.hud-over-tier`, `.hud-title-tier`, `.hud-title-bar`, `.hud-title-records`, `.hud-rec-*`, `userData.svGhost` all match between implementation steps and test files.
