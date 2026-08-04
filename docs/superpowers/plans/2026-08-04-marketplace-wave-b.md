# Marketplace Wave B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the prize machine (200/spin, state-first, V2 slot-roll reveal), a 22-single pool across seven slots with per-slot equipping and direct buy at 800, the `hud:gear` event, and the visuals/roast consumers for every single.

**Architecture:** hud.js owns the catalog, storage, machine, rack UI, and roast packs; visuals.js consumes one new `hud:gear` CustomEvent and renders six effect families on existing events and pools. Zero core.js changes; visuals reads `StackCore.getTowerState()` (existing public seam) where it needs slider geometry.

**Tech Stack:** Vanilla ES5 in hud.js (var, IIFE, textContent only), Three.js effects in visuals.js, Playwright suites via the playwright-skill runner.

## Global Constraints

- Spin costs exactly **200** points; direct buy costs exactly **800**; earn rates are untouched.
- **State-first spin:** balance charged, prize granted and equipped, storage written, all before any animation starts.
- Never a duplicate: draw is uniform over UNOWNED singles only; 22 spins drain the pool; the 23rd is impossible.
- Reel numbers come from the approved V2 mockup verbatim: row height **32px**, window **96px**, transition `transform 1.25s cubic-bezier(0.12, 0.82, 0.16, 1)`, hit flash at **1300ms**, busy release at **1900ms** (reduced motion: no roll, immediate result, **400ms** release).
- Storage keys: `stack-singles` (JSON array of owned ids), `stack-gear` (JSON map slot→id). Corrupt or unknown entries are ignored defensively.
- `hud:gear` detail is `{trail, flare, slice, death, record, material}` (id string or null per slot; roast never rides the event). Broadcast at boot inside the existing `fireBoot` (readyState-guarded) and on every change.
- hud.js stays ES5: no arrows, no template literals, no let/const, textContent only for user data. Card art colors are inline styles from the catalog (decorative constants, same as Worlds cards).
- No new elements on the title or death screens. The rack and machine live entirely inside the SHOP pane; the overlay shell height is untouched (pane scrolls).
- Every new focusable control gets `keepKeysLocal` and an aria-label that matches its visible state.
- Game text stays English; Hebrew names keep the LRM guard (`lrm()`) in every new template containing `{n}`.
- Effects never touch renderOrder pins or the grow-in scale channel; every effect cleans up on `stack:reset`.
- An offline rebuild (`node scripts/build-offline.mjs`) is part of any commit touching hud.js, hud.css, or visuals.js.
- Tests run via `cd "C:/Users/maor4/.claude/plugins/cache/playwright-skill/playwright-skill/4.1.0/skills/playwright-skill" && node run.js "<absolute test path>"`; every suite intercepts `**/rest/v1/stack_scores*` (GET fallback, non-GET abort) and loads with `?debug=1`.

## File Structure

- `hud.js` — singles catalog + storage + equip + machine + rack + roast packs (Tasks 1, 2, 3, 6).
- `hud.css` — rack and machine styles, monochrome white-alpha idiom of the existing shop (Tasks 2, 3).
- `visuals.js` — `hud:gear` listener, trail/flare/material families (Task 4), slice/death/record families (Task 5).
- `reference/tests/pw-gear-core.js`, `pw-gear.js`, `pw-machine.js`, `pw-effects-a.js`, `pw-effects-b.js`, `pw-roast-packs.js` — new suites (gitignored like all suites).

---

### Task 1: Singles catalog, storage, and hud:gear plumbing

**Files:**
- Modify: `hud.js` (after the WORLDS table ~line 95; after `equipWorld` ~line 320; inside `fireBoot` ~line 2093)
- Test: `reference/tests/pw-gear-core.js`

**Interfaces:**
- Produces: `GEAR_SLOTS` (7 entries, ids `trail|flare|slice|death|record|material|roast`), `SINGLES` (22 entries `{id, slot, name, color}`), `SINGLE_BY_ID`, `SINGLE_PRICE = 800`, `SPIN_COST = 200`, `readSingles()`, `writeSingles(arr)`, `ownsSingle(id)`, `grantSingle(id)` (returns true when new), `readGear()` (validated map), `writeGear(map)`, `equipSingle(id)`, `unequipSlot(slot)`, `fireGear()`. Tasks 2, 3, 6 call these exactly as named.

- [ ] **Step 1: Add the catalog constants** right after the `WORLD_BY_ID` block (~line 99):

```js
  /* Wave B singles: seven gear slots, one equippable per slot, layered over
     the active World. hud owns names/prices/swatches; visuals owns the
     effects under the same ids; the only coupling is the hud:gear event.
     The roast slot never rides the event - packs apply inside this file. */
  var GEAR_SLOTS = [
    { id: 'trail',    name: 'DROP TRAIL' },
    { id: 'flare',    name: 'PERFECT FLARE' },
    { id: 'slice',    name: 'SLICE STYLE' },
    { id: 'death',    name: 'DEATH EFFECT' },
    { id: 'record',   name: 'RECORD MOMENT' },
    { id: 'material', name: 'BLOCK MATERIAL' },
    { id: 'roast',    name: 'ROAST PACK' }
  ];
  var SINGLES = [
    { id: 'comet',     slot: 'trail',    name: 'COMET',        color: '#ffb45e' },
    { id: 'ribbon',    slot: 'trail',    name: 'RIBBON',       color: '#8fd0ff' },
    { id: 'bubbles',   slot: 'trail',    name: 'BUBBLES',      color: '#7fe8d8' },
    { id: 'goldring',  slot: 'flare',    name: 'GOLD RING',    color: '#f2c14e' },
    { id: 'shockwave', slot: 'flare',    name: 'SHOCKWAVE',    color: '#eef2f8' },
    { id: 'starburst', slot: 'flare',    name: 'STARBURST',    color: '#ffd98a' },
    { id: 'shards',    slot: 'slice',    name: 'GLASS SHARDS', color: '#bfe3ff' },
    { id: 'confetti',  slot: 'slice',    name: 'CONFETTI',     color: '#ff6f91' },
    { id: 'petals',    slot: 'slice',    name: 'PETALS',       color: '#ffa6c5' },
    { id: 'pixels',    slot: 'slice',    name: 'PIXELS',       color: '#59f0ff' },
    { id: 'slowmo',    slot: 'death',    name: 'SLOW-MO',      color: '#b8c6dd' },
    { id: 'bounce',    slot: 'death',    name: 'BOUNCE',       color: '#9be37f' },
    { id: 'fireworks', slot: 'death',    name: 'FIREWORKS',    color: '#b18cff' },
    { id: 'aurora',    slot: 'record',   name: 'AURORA SWEEP', color: '#7fffc9' },
    { id: 'ringburst', slot: 'record',   name: 'RING BURST',   color: '#ffe08a' },
    { id: 'glass',     slot: 'material', name: 'GLASS',        color: '#d7ecff' },
    { id: 'wood',      slot: 'material', name: 'WOOD GRAIN',   color: '#c89a66' },
    { id: 'neonedge',  slot: 'material', name: 'NEON EDGE',    color: '#59f0ff' },
    { id: 'savage',    slot: 'roast',    name: 'SAVAGE PACK',  color: '#ff5d5d' },
    { id: 'gentle',    slot: 'roast',    name: 'GENTLE PACK',  color: '#9be37f' },
    { id: 'nerd',      slot: 'roast',    name: 'NERD PACK',    color: '#59a8f0' },
    { id: 'bard',      slot: 'roast',    name: 'SHAKESPEARE',  color: '#d9b8ff' }
  ];
  var SINGLE_BY_ID = {};
  (function () {
    for (var i = 0; i < SINGLES.length; i++) { SINGLE_BY_ID[SINGLES[i].id] = SINGLES[i]; }
  })();
  var SINGLE_PRICE = 800;
  var SPIN_COST = 200;
```

Also add the two keys next to `OWNED_KEY` (~line 52):

```js
  var SINGLES_KEY = 'stack-singles'; /* owned single ids (JSON array) */
  var GEAR_KEY = 'stack-gear';       /* slot id -> equipped single id (JSON map) */
```

- [ ] **Step 2: Add storage and equip functions** right after `equipWorld` (~line 320), mirroring the readOwned/grantWorld idiom:

```js
  function readSingles() {
    try {
      var v = JSON.parse(window.localStorage.getItem(SINGLES_KEY) || '[]');
      if (!Array.isArray(v)) { return []; }
      var out = [];
      for (var i = 0; i < v.length; i++) {
        if (SINGLE_BY_ID[v[i]] && out.indexOf(v[i]) < 0) { out.push(v[i]); }
      }
      return out;
    } catch (err) { return []; }
  }

  function writeSingles(arr) {
    try { window.localStorage.setItem(SINGLES_KEY, JSON.stringify(arr)); } catch (err) { /* ignore */ }
  }

  function ownsSingle(id) {
    return readSingles().indexOf(id) >= 0;
  }

  function grantSingle(id) {
    if (!SINGLE_BY_ID[id] || ownsSingle(id)) { return false; }
    var owned = readSingles();
    owned.push(id);
    writeSingles(owned);
    return true;
  }

  /* Validated read: every key must be a known slot, every value an owned-
     shape id whose slot matches the key. Anything else is dropped, so a
     corrupt map can never equip a trail into the roast slot. */
  function readGear() {
    var out = {};
    try {
      var v = JSON.parse(window.localStorage.getItem(GEAR_KEY) || '{}');
      if (!v || typeof v !== 'object') { return out; }
      for (var i = 0; i < GEAR_SLOTS.length; i++) {
        var slot = GEAR_SLOTS[i].id;
        var id = v[slot];
        if (typeof id === 'string' && SINGLE_BY_ID[id] && SINGLE_BY_ID[id].slot === slot) {
          out[slot] = id;
        }
      }
    } catch (err) { /* fall through to what validated */ }
    return out;
  }

  function writeGear(map) {
    try { window.localStorage.setItem(GEAR_KEY, JSON.stringify(map)); } catch (err) { /* ignore */ }
  }

  function fireGear() {
    var g = readGear();
    var detail = {};
    for (var i = 0; i < GEAR_SLOTS.length; i++) {
      var slot = GEAR_SLOTS[i].id;
      if (slot === 'roast') { continue; } /* hud-internal, never broadcast */
      detail[slot] = g[slot] || null;
    }
    try { window.dispatchEvent(new CustomEvent('hud:gear', { detail: detail })); }
    catch (err) { /* ignore */ }
  }

  function equipSingle(id) {
    var s = SINGLE_BY_ID[id];
    if (!s) { return; }
    var g = readGear();
    g[s.slot] = id;
    writeGear(g);
    if (s.slot === 'roast') { quipBag = []; } /* next death draws the new pack */
    fireGear();
  }

  function unequipSlot(slot) {
    var g = readGear();
    if (!g[slot]) { return; }
    delete g[slot];
    writeGear(g);
    if (slot === 'roast') { quipBag = []; }
    fireGear();
  }
```

Note: `quipBag` is declared later in the file (~line 941); function declarations hoist and these run on user events long after boot, so the reference is safe — same pattern `equipWorld` already uses.

- [ ] **Step 3: Boot broadcast.** Inside `fireBoot` (~line 2093), add one line directly after `fireWorld(readWorld());`:

```js
      fireGear();
```

- [ ] **Step 4: Write the suite** `reference/tests/pw-gear-core.js`:

```js
/* hud:gear plumbing: validated storage and the boot broadcast. UI lands in
   later tasks; this drives storage directly and reads the event. */
const { chromium, devices } = require('playwright');
const URL = 'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const fails = [];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  await context.route('**/rest/v1/stack_scores*', r =>
    r.request().method() === 'GET' ? r.fallback() : r.abort());
  /* Listener + storage BEFORE any script runs, so the boot broadcast and
     the validation read both see them. */
  await context.addInitScript(() => {
    window.__gear = [];
    window.addEventListener('hud:gear', e => window.__gear.push(e.detail));
    localStorage.setItem('stack-singles', JSON.stringify(['comet', 'goldring', 'nope', 'comet']));
    localStorage.setItem('stack-gear', JSON.stringify({
      trail: 'comet',          /* valid */
      flare: 'comet',          /* wrong slot for the id: dropped */
      material: 'unknown-id',  /* unknown id: dropped */
      bogus: 'comet'           /* unknown slot: dropped */
    }));
  });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await page.waitForTimeout(600);

  const got = await page.evaluate(() => window.__gear);
  console.log('OBS boot ' + JSON.stringify(got));
  if (got.length < 1) { fails.push('no hud:gear at boot'); }
  const d = got[0] || {};
  if (d.trail !== 'comet') { fails.push('valid entry lost: ' + JSON.stringify(d)); }
  if (d.flare !== null) { fails.push('wrong-slot entry survived: ' + JSON.stringify(d)); }
  if (d.material !== null) { fails.push('unknown id survived: ' + JSON.stringify(d)); }
  if ('bogus' in d) { fails.push('unknown slot key broadcast'); }
  if ('roast' in d) { fails.push('roast slot must never ride the event'); }
  if (!('slice' in d && 'death' in d && 'record' in d)) { fails.push('missing slot keys: ' + JSON.stringify(d)); }

  if (errs.length) { fails.push('errors: ' + JSON.stringify(errs)); }
  await browser.close();
  if (fails.length) { console.log('FAIL ' + JSON.stringify(fails, null, 1)); process.exit(1); }
  console.log('PASS: gear storage validates and broadcasts at boot');
})();
```

- [ ] **Step 5: Run it** — expected PASS. Also run `pw-boards.js` (boot path touched) — expected PASS.

- [ ] **Step 6: Commit** `git add hud.js && git commit -m "Wave B T1: singles catalog, gear storage, hud:gear broadcast"` (test files are gitignored; commit hud.js only).

---

### Task 2: GEAR rack UI and direct buy

**Files:**
- Modify: `hud.js` (shop DOM build ~line 644, before the machine slot; els registry ~line 713; `renderShopPane` ~line 1508; `disarmShop` ~line 1497; shop listeners ~line 1968)
- Modify: `hud.css` (after the `.hud-shop-*` block ~line 1080)
- Test: `reference/tests/pw-gear.js`

**Interfaces:**
- Consumes: Task 1's catalog, storage, and equip functions.
- Produces: `els.gearRack`, `els.gearCards` (array of `{card, chip, single}`), `renderGearRack()` called from `renderShopPane`, `gearArm` state cleared by `disarmShop`. Task 3 renders the machine after this rack.

- [ ] **Step 1: Build the rack DOM.** In the shop shell construction, directly after `boardShop.appendChild(shopGrid);` (~line 646), insert:

```js
    /* GEAR rack: seven slot groups of small single cards. Swatch colors are
       catalog constants (decorative), names/states are textContent. */
    var gearRack = el('div', 'hud-gear-rack');
    var gearCards = [];
    for (var gi = 0; gi < GEAR_SLOTS.length; gi++) {
      var slotDef = GEAR_SLOTS[gi];
      gearRack.appendChild(el('div', 'hud-gear-slot', slotDef.name));
      var row = el('div', 'hud-gear-row');
      for (var si = 0; si < SINGLES.length; si++) {
        var sg = SINGLES[si];
        if (sg.slot !== slotDef.id) { continue; }
        var gcard = el('button', 'hud-gear-card');
        gcard.type = 'button';
        gcard.setAttribute('data-single', sg.id);
        var sw = el('span', 'hud-gear-sw');
        sw.style.background = sg.color;
        gcard.appendChild(sw);
        gcard.appendChild(el('span', 'hud-gear-name', sg.name));
        var gchip = el('span', 'hud-gear-chip', '');
        gcard.appendChild(gchip);
        row.appendChild(gcard);
        gearCards.push({ card: gcard, chip: gchip, single: sg });
      }
      gearRack.appendChild(row);
    }
    boardShop.appendChild(gearRack);
```

The machine slot (`shopMachine`) moves with it: change `shopGrid.appendChild(shopMachine);` to `boardShop.appendChild(shopMachine);` so the order is Worlds grid → rack → machine. Register in the els bundle (~line 713 area, next to `shopCards`): `gearRack: gearRack, gearCards: gearCards,`.

- [ ] **Step 2: Arm state and render.** Extend `disarmShop` (~1497) to clear both arms through one path:

```js
  var shopArm = { id: null, timer: null };
  var gearArm = { id: null, timer: null };

  function disarmShop(rerender) {
    if (shopArm.timer) { clearTimeout(shopArm.timer); }
    if (gearArm.timer) { clearTimeout(gearArm.timer); }
    var had = shopArm.id != null || gearArm.id != null;
    shopArm.id = null;
    shopArm.timer = null;
    gearArm.id = null;
    gearArm.timer = null;
    if (had && rerender) { renderShopPane(); }
  }
```

Add `renderGearRack` next to `renderShopPane` and call it from `renderShopPane`'s end (`renderGearRack();`):

```js
  /* Gear card states: ON (equipped) / OWNED (tap equips) / armed BUY /
     price / dimmed when unaffordable. Wins and buys auto-equip. */
  function renderGearRack() {
    var bal = readInt(PTS_KEY);
    var g = readGear();
    for (var i = 0; i < els.gearCards.length; i++) {
      var c = els.gearCards[i];
      var s = c.single;
      var cls = 'hud-gear-card';
      var chip = '';
      if (g[s.slot] === s.id) { cls += ' is-eq'; chip = 'ON'; }
      else if (ownsSingle(s.id)) { chip = 'OWNED'; }
      else if (gearArm.id === s.id) { cls += ' is-armed'; chip = 'BUY · ' + SINGLE_PRICE + '?'; }
      else if (bal >= SINGLE_PRICE) { chip = String(SINGLE_PRICE); }
      else { cls += ' is-dim'; chip = String(SINGLE_PRICE); }
      c.card.className = cls;
      c.chip.textContent = chip;
      c.card.setAttribute('aria-label', s.name + ' — ' + chip);
    }
  }
```

- [ ] **Step 3: Click handler.** Next to the shopGrid listener (~1968), add a rack listener with the same shape (and `keepKeysLocal` for every gear card in the same loop that handles `els.shopCards`):

```js
    els.gearRack.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.hud-gear-card') : null;
      if (!btn) { disarmShop(true); return; }
      var id = btn.getAttribute('data-single');
      var s = SINGLE_BY_ID[id];
      if (!s) { return; }
      var g = readGear();
      if (g[s.slot] === id) {              /* equipped: tap unequips */
        disarmShop(false);
        unequipSlot(s.slot);
        renderShopPane();
        return;
      }
      if (ownsSingle(id)) {                /* owned: tap equips */
        disarmShop(false);
        equipSingle(id);
        renderShopPane();
        return;
      }
      var bal = readInt(PTS_KEY);
      if (bal < SINGLE_PRICE) { disarmShop(true); return; }
      if (gearArm.id === id) {             /* second tap: buy at 800 */
        disarmShop(false);
        writeInt(PTS_KEY, bal - SINGLE_PRICE);
        grantSingle(id);
        equipSingle(id);
        renderShopPane();
        renderShopPill();
        return;
      }
      disarmShop(false);                   /* first tap: arm */
      gearArm.id = id;
      gearArm.timer = setTimeout(function () { disarmShop(true); }, SHOP_ARM_MS);
      renderShopPane();
    });
    for (var gci = 0; gci < els.gearCards.length; gci++) {
      keepKeysLocal(els.gearCards[gci].card);
    }
```

- [ ] **Step 4: CSS.** Append to hud.css after the shop-card block (~line 1080), following the monochrome white-alpha idiom:

```css
/* Wave B gear rack: seven slot groups of small single cards. */
.hud-gear-rack {
  margin-top: 1.6vh;
}
.hud-gear-slot {
  opacity: 0.66;
  font-size: clamp(9px, 1.3vmin, 11px);
  font-weight: 300;
  letter-spacing: 0.24em;
  margin: 1.2vh 2px 0.5vh;
}
.hud-gear-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}
.hud-gear-card {
  pointer-events: auto;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  min-height: 38px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 9px;
  background: rgba(255, 255, 255, 0.05);
  color: inherit;
  font: inherit;
}
.hud-gear-card:active { transform: scale(0.97); }
.hud-gear-card:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.hud-gear-card.is-eq {
  border-color: rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 10px rgba(255, 255, 255, 0.22), inset 0 0 6px rgba(255, 255, 255, 0.08);
}
.hud-gear-card.is-armed {
  border-color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.14);
}
.hud-gear-card.is-dim { opacity: 0.5; cursor: default; }
.hud-gear-sw {
  flex: 0 0 auto;
  width: 12px;
  height: 12px;
  border-radius: 50%;
}
.hud-gear-name {
  flex: 1 1 auto;
  text-align: left;
  font-size: clamp(9px, 1.4vmin, 11px);
  letter-spacing: 0.08em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hud-gear-chip {
  flex: 0 0 auto;
  font-size: clamp(8px, 1.2vmin, 10px);
  letter-spacing: 0.1em;
  opacity: 0.85;
  font-variant-numeric: lining-nums tabular-nums;
}
```

- [ ] **Step 5: Write the suite** `reference/tests/pw-gear.js`:

```js
/* Gear rack: states, equip/unequip toggle, two-tap buy at 800, dim when
   poor, persistence, and the hud:gear change broadcasts. */
const { chromium, devices } = require('playwright');
const URL = 'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const fails = [];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  await context.route('**/rest/v1/stack_scores*', r =>
    r.request().method() === 'GET' ? r.fallback() : r.abort());
  await context.addInitScript(() => {
    window.__gear = [];
    window.addEventListener('hud:gear', e => window.__gear.push(e.detail));
    localStorage.setItem('stack-points', '1000');
    localStorage.setItem('stack-singles', JSON.stringify(['ribbon']));
  });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.click('.hud-shop-pill');
  await page.waitForTimeout(300);

  const card = id => '.hud-gear-card[data-single="' + id + '"]';
  const chipOf = async id => page.$eval(card(id) + ' .hud-gear-chip', n => n.textContent);

  /* A - initial states: owned ribbon OWNED, comet priced, rack visible */
  if (await chipOf('ribbon') !== 'OWNED') { fails.push('A: owned chip: ' + await chipOf('ribbon')); }
  if (await chipOf('comet') !== '800') { fails.push('A: price chip: ' + await chipOf('comet')); }

  /* B - owned tap equips, second tap unequips, events fire */
  await page.click(card('ribbon'));
  await page.waitForTimeout(150);
  if (await chipOf('ribbon') !== 'ON') { fails.push('B: equip failed: ' + await chipOf('ribbon')); }
  let last = await page.evaluate(() => window.__gear[window.__gear.length - 1]);
  if (last.trail !== 'ribbon') { fails.push('B: event after equip: ' + JSON.stringify(last)); }
  await page.click(card('ribbon'));
  await page.waitForTimeout(150);
  if (await chipOf('ribbon') !== 'OWNED') { fails.push('B: unequip failed: ' + await chipOf('ribbon')); }
  last = await page.evaluate(() => window.__gear[window.__gear.length - 1]);
  if (last.trail !== null) { fails.push('B: event after unequip: ' + JSON.stringify(last)); }

  /* C - two-tap buy: arm then buy, balance 1000 -> 200, auto-equipped */
  await page.click(card('goldring'));
  await page.waitForTimeout(150);
  if ((await chipOf('goldring')).indexOf('BUY') !== 0) { fails.push('C: not armed: ' + await chipOf('goldring')); }
  await page.click(card('goldring'));
  await page.waitForTimeout(150);
  if (await chipOf('goldring') !== 'ON') { fails.push('C: buy did not equip: ' + await chipOf('goldring')); }
  const bal = await page.evaluate(() => localStorage.getItem('stack-points'));
  if (bal !== '200') { fails.push('C: balance after buy: ' + bal); }

  /* D - poor now (200 < 800): unowned cards dim, tap spends nothing */
  const dim = await page.$eval(card('comet'), n => n.className.indexOf('is-dim') >= 0);
  if (!dim) { fails.push('D: comet not dimmed at balance 200'); }
  await page.click(card('comet'));
  await page.click(card('comet'));
  await page.waitForTimeout(150);
  const bal2 = await page.evaluate(() => localStorage.getItem('stack-points'));
  if (bal2 !== '200') { fails.push('D: dim tap spent points: ' + bal2); }

  /* E - persistence across reload */
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.click('.hud-shop-pill');
  await page.waitForTimeout(300);
  if (await chipOf('goldring') !== 'ON') { fails.push('E: equip not persisted: ' + await chipOf('goldring')); }

  if (errs.length) { fails.push('errors: ' + JSON.stringify(errs)); }
  await browser.close();
  if (fails.length) { console.log('FAIL ' + JSON.stringify(fails, null, 1)); process.exit(1); }
  console.log('PASS: rack states, toggle, buy, dim, persistence');
})();
```

- [ ] **Step 6: Run it** — expected PASS. Also run `pw-gear-core.js` and the shop suite that covers Worlds cards (`pw-boards.js` if it includes the shop pane; otherwise the Wave A shop suite by its actual name in reference/tests) — expected PASS.

- [ ] **Step 7: Commit** `git add hud.js hud.css && git commit -m "Wave B T2: gear rack with per-slot equip and 800 direct buy"`.

---

### Task 3: The prize machine

**Files:**
- Modify: `hud.js` (replace the `shopMachine` COMING SOON div ~line 644; els registry; `renderShopPane`; listeners)
- Modify: `hud.css` (machine styles after the gear block)
- Test: `reference/tests/pw-machine.js`

**Interfaces:**
- Consumes: Task 1's `SPIN_COST`, `readSingles`, `grantSingle`, `equipSingle`, `SINGLE_BY_ID`, `SINGLES`; Task 2's rack rendering (`renderShopPane` re-renders both).
- Produces: `els.machine*` bundle, `renderMachine()` called from `renderShopPane`, `machineBusy` guard other code must not touch.

- [ ] **Step 1: Machine DOM.** Replace `var shopMachine = el('div', 'hud-shop-machine', 'PRIZE MACHINE · COMING SOON');` with:

```js
    /* Prize machine: V2 slot roll from the approved mockup. Reel numbers
       (32px rows, 96px window, 1.25s cubic-bezier(0.12,0.82,0.16,1), hit
       at 1300ms, release at 1900ms) are the auditioned ones. */
    var shopMachine = el('div', 'hud-shop-machine');
    shopMachine.appendChild(el('div', 'hud-machine-title', 'PRIZE MACHINE'));
    var reelWin = el('div', 'hud-reel-win');
    var reel = el('div', 'hud-reel');
    reelWin.appendChild(reel);
    reelWin.appendChild(el('div', 'hud-reel-mask'));
    reelWin.appendChild(el('div', 'hud-reel-line'));
    shopMachine.appendChild(reelWin);
    var spinBtn = el('button', 'hud-spin-btn', 'SPIN · ' + SPIN_COST);
    spinBtn.type = 'button';
    spinBtn.setAttribute('aria-label', 'Spin the prize machine, ' + SPIN_COST + ' points');
    shopMachine.appendChild(spinBtn);
    var machineWin = el('div', 'hud-machine-last');
    shopMachine.appendChild(machineWin);
```

Register in els: `shopMachine: shopMachine, machineReel: reel, machineReelWin: reelWin, machineSpin: spinBtn, machineWin: machineWin,`. Keep the Task 2 line `boardShop.appendChild(shopMachine);` as the last child.

- [ ] **Step 2: Spin logic.** Next to `renderGearRack`, add:

```js
  var machineBusy = false;
  var machineLast = null;   /* {single} for the session's win row */
  var MACHINE_ROWH = 32;
  var MACHINE_ROLL_MS = 1250;
  var MACHINE_HIT_MS = 1300;
  var MACHINE_LOCK_MS = 1900;
  var MACHINE_LOCK_REDUCED_MS = 400;

  function unownedSingles() {
    var out = [];
    for (var i = 0; i < SINGLES.length; i++) {
      if (!ownsSingle(SINGLES[i].id)) { out.push(SINGLES[i]); }
    }
    return out;
  }

  function machineReelRow(s) {
    var row = el('div', 'hud-reel-row');
    var dot = el('span', 'hud-gear-sw');
    dot.style.background = s.color;
    row.appendChild(dot);
    row.appendChild(el('span', 'hud-reel-name', s.name));
    return row;
  }

  function renderMachineWin() {
    els.machineWin.textContent = '';
    if (!machineLast) { return; }
    var s = machineLast;
    var dot = el('span', 'hud-gear-sw');
    dot.style.background = s.color;
    els.machineWin.appendChild(dot);
    var txt = el('span', 'hud-machine-wintxt');
    var slotDef = null;
    for (var i = 0; i < GEAR_SLOTS.length; i++) {
      if (GEAR_SLOTS[i].id === s.slot) { slotDef = GEAR_SLOTS[i]; }
    }
    txt.appendChild(el('span', 'hud-machine-winslot', slotDef ? slotDef.name : ''));
    txt.appendChild(el('span', 'hud-machine-winname', s.name));
    els.machineWin.appendChild(txt);
    els.machineWin.appendChild(el('span', 'hud-machine-wineq', 'EQUIPPED ✓'));
  }

  /* Idle render only: never rebuilds the reel mid-roll. */
  function renderMachine() {
    if (machineBusy) { return; }
    var pool = unownedSingles();
    var bal = readInt(PTS_KEY);
    els.machineReel.style.transition = 'none';
    els.machineReel.style.transform = 'translateY(0)';
    els.machineReel.textContent = '';
    if (!pool.length) {
      /* Dormant: static sample of the collection, no charge possible. */
      for (var i = 0; i < 3; i++) { els.machineReel.appendChild(machineReelRow(SINGLES[i])); }
      els.machineSpin.textContent = 'ALL PRIZES WON';
      els.machineSpin.disabled = true;
      els.machineSpin.setAttribute('aria-label', 'Prize machine, all prizes won');
    } else {
      for (var j = 0; j < 3; j++) { els.machineReel.appendChild(machineReelRow(pool[j % pool.length])); }
      els.machineSpin.textContent = 'SPIN · ' + SPIN_COST;
      els.machineSpin.disabled = bal < SPIN_COST;
      els.machineSpin.setAttribute('aria-label', 'Spin the prize machine, ' + SPIN_COST + ' points' +
        (bal < SPIN_COST ? ', not enough points' : ''));
    }
    renderMachineWin();
  }

  function spinMachine() {
    if (machineBusy) { return; }
    var pool = unownedSingles();
    var bal = readInt(PTS_KEY);
    if (!pool.length || bal < SPIN_COST) { return; }
    machineBusy = true;
    /* State first: charge, grant, equip, persist - the animation is only a
       reveal, and closing the overlay mid-roll can never lose the prize. */
    writeInt(PTS_KEY, bal - SPIN_COST);
    var prize = pool[Math.floor(Math.random() * pool.length)];
    grantSingle(prize.id);
    equipSingle(prize.id);
    machineLast = prize;
    els.shopBalVal.textContent = fmtPts(readInt(PTS_KEY));
    renderShopPill();

    var lockMs = reduceMotion ? MACHINE_LOCK_REDUCED_MS : MACHINE_LOCK_MS;
    els.machineSpin.disabled = true;
    els.machineReelWin.classList.remove('is-hit');

    /* Strip from the pre-spin pool so the prize is present and every row
       advertises something still winnable at tap time. */
    els.machineReel.textContent = '';
    var target = 12;
    for (var i = 0; i < 15; i++) { els.machineReel.appendChild(machineReelRow(pool[i % pool.length])); }
    while (pool[target % pool.length].id !== prize.id) { target++; }
    if (target >= 15) {   /* extend the strip so the landing row exists */
      for (var k = 15; k <= target; k++) { els.machineReel.appendChild(machineReelRow(pool[k % pool.length])); }
    }

    var finish = function () {
      els.machineReelWin.classList.add('is-hit');
      renderMachineWin();
    };
    if (reduceMotion) {
      els.machineReel.style.transition = 'none';
      els.machineReel.style.transform = 'translateY(' + (-(target - 1) * MACHINE_ROWH) + 'px)';
      finish();
    } else {
      els.machineReel.style.transition = 'none';
      els.machineReel.style.transform = 'translateY(0)';
      void els.machineReel.offsetHeight;
      els.machineReel.style.transition = 'transform ' + (MACHINE_ROLL_MS / 1000) + 's cubic-bezier(0.12, 0.82, 0.16, 1)';
      els.machineReel.style.transform = 'translateY(' + (-(target - 1) * MACHINE_ROWH) + 'px)';
      setTimeout(finish, MACHINE_HIT_MS);
    }
    setTimeout(function () {
      machineBusy = false;
      renderShopPane();   /* rack shows the new ON, machine re-idles */
    }, lockMs);
  }
```

Wire it in the listener section: `els.machineSpin.addEventListener('click', spinMachine); keepKeysLocal(els.machineSpin);`. Add `renderMachine();` at the end of `renderShopPane` (after `renderGearRack();`).

- [ ] **Step 3: CSS.** Append after the gear block:

```css
/* Prize machine: V2 slot roll. */
.hud-shop-machine {
  margin-top: 1.8vh;
  border: 1px solid rgba(255, 255, 255, 0.35);
  border-radius: 12px;
  padding: 10px 10px 12px;
  background: rgba(255, 255, 255, 0.04);
  text-align: center;
}
.hud-machine-title {
  font-size: clamp(10px, 1.5vmin, 12px);
  font-weight: 300;
  letter-spacing: 0.24em;
  opacity: 0.85;
  margin-bottom: 8px;
}
.hud-reel-win {
  height: 96px;
  overflow: hidden;
  position: relative;
  border: 1px solid rgba(255, 255, 255, 0.22);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.25);
}
.hud-reel-row {
  height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  justify-content: center;
  font-size: clamp(10px, 1.5vmin, 12px);
  letter-spacing: 0.08em;
}
.hud-reel-mask {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(180deg, rgba(6, 12, 26, 0.85) 0%, transparent 30%, transparent 70%, rgba(6, 12, 26, 0.85) 100%);
}
.hud-reel-line {
  position: absolute;
  left: 8px;
  right: 8px;
  top: 32px;
  height: 32px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 8px;
  pointer-events: none;
}
.hud-reel-win.is-hit .hud-reel-line { animation: hud-reel-hit 0.5s ease; }
@keyframes hud-reel-hit {
  0% { border-color: rgba(255, 255, 255, 0.95); background: rgba(255, 255, 255, 0.18); }
  100% { border-color: rgba(255, 255, 255, 0.5); background: transparent; }
}
@media (prefers-reduced-motion: reduce) {
  .hud-reel-win.is-hit .hud-reel-line { animation: none; border-color: rgba(255, 255, 255, 0.95); }
}
.hud-spin-btn {
  pointer-events: auto;
  cursor: pointer;
  width: 100%;
  margin-top: 10px;
  min-height: 44px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.12);
  color: inherit;
  font: inherit;
  font-size: clamp(12px, 1.8vmin, 14px);
  letter-spacing: 0.18em;
}
.hud-spin-btn:active { transform: scale(0.97); }
.hud-spin-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.hud-spin-btn:disabled { opacity: 0.4; cursor: default; }
.hud-machine-last {
  margin-top: 8px;
  min-height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  font-size: clamp(9px, 1.4vmin, 11px);
  letter-spacing: 0.08em;
}
.hud-machine-wintxt { display: flex; flex-direction: column; align-items: flex-start; }
.hud-machine-winslot { opacity: 0.6; font-size: clamp(8px, 1.2vmin, 9px); letter-spacing: 0.2em; }
.hud-machine-winname { font-weight: 600; }
.hud-machine-wineq { opacity: 0.85; font-size: clamp(8px, 1.2vmin, 10px); letter-spacing: 0.2em; }
```

Delete any old `.hud-shop-machine` COMING SOON styling that conflicts (grep hud.css for `hud-shop-machine` and replace the block).

- [ ] **Step 4: Write the suite** `reference/tests/pw-machine.js`:

```js
/* Prize machine: state-first spins, exact charging, no duplicates, drain
   to dormant, insufficient balance, double-tap, mid-roll reload. Runs
   under forced reduced motion so 22 spins stay fast; one full-motion
   context asserts the roll itself. */
const { chromium, devices } = require('playwright');
const URL = 'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const fails = [];

(async () => {
  const browser = await chromium.launch({ headless: true });

  /* -------- context 1: reduced motion, the full drain -------- */
  const ctx1 = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  await ctx1.route('**/rest/v1/stack_scores*', r =>
    r.request().method() === 'GET' ? r.fallback() : r.abort());
  await ctx1.addInitScript(() => { localStorage.setItem('stack-points', '4600'); });
  const p1 = await ctx1.newPage();
  const errs = [];
  p1.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await p1.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await p1.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await p1.waitForTimeout(600);
  await p1.click('.hud-shop-pill');
  await p1.waitForTimeout(300);

  const balOf = async page => +(await page.evaluate(() => localStorage.getItem('stack-points') || '0'));
  const ownedOf = async page => page.evaluate(() => JSON.parse(localStorage.getItem('stack-singles') || '[]'));

  /* A - double-tap: two rapid clicks, one charge */
  const balA = await balOf(p1);
  await p1.click('.hud-spin-btn');
  await p1.click('.hud-spin-btn', { force: true }).catch(() => {});
  await p1.waitForTimeout(600);
  const balB = await balOf(p1);
  if (balA - balB !== 200) { fails.push('A: double-tap charged ' + (balA - balB)); }
  let owned = await ownedOf(p1);
  if (owned.length !== 1) { fails.push('A: owned after first spin: ' + owned.length); }

  /* B - drain the remaining 21: each spin charges 200 and adds one new id */
  for (let i = 0; i < 21; i++) {
    const before = await balOf(p1);
    const ownedBefore = (await ownedOf(p1)).length;
    await p1.click('.hud-spin-btn');
    await p1.waitForTimeout(520);
    const after = await balOf(p1);
    const ownedAfter = (await ownedOf(p1)).length;
    if (before - after !== 200) { fails.push('B: spin ' + (i + 2) + ' charged ' + (before - after)); break; }
    if (ownedAfter !== ownedBefore + 1) { fails.push('B: spin ' + (i + 2) + ' owned ' + ownedBefore + '->' + ownedAfter); break; }
  }
  owned = await ownedOf(p1);
  const dupes = owned.filter((v, i) => owned.indexOf(v) !== i);
  if (owned.length !== 22 || dupes.length) { fails.push('B: pool end state ' + owned.length + ' dupes ' + JSON.stringify(dupes)); }
  console.log('OBS drained owned=' + owned.length + ' bal=' + await balOf(p1));

  /* C - dormant: label, disabled, no charge on a forced tap */
  const label = await p1.$eval('.hud-spin-btn', n => n.textContent);
  const disabled = await p1.$eval('.hud-spin-btn', n => n.disabled);
  if (label !== 'ALL PRIZES WON' || !disabled) { fails.push('C: dormant state: "' + label + '" disabled=' + disabled); }
  const balC = await balOf(p1);
  await p1.$eval('.hud-spin-btn', n => n.click());
  await p1.waitForTimeout(300);
  if (await balOf(p1) !== balC) { fails.push('C: dormant tap charged'); }
  if (errs.length) { fails.push('ctx1 errors: ' + JSON.stringify(errs)); }
  await ctx1.close();

  /* -------- context 2: insufficient balance -------- */
  const ctx2 = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce' });
  await ctx2.route('**/rest/v1/stack_scores*', r =>
    r.request().method() === 'GET' ? r.fallback() : r.abort());
  await ctx2.addInitScript(() => { localStorage.setItem('stack-points', '150'); });
  const p2 = await ctx2.newPage();
  await p2.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await p2.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await p2.waitForTimeout(600);
  await p2.click('.hud-shop-pill');
  await p2.waitForTimeout(300);
  const poorDisabled = await p2.$eval('.hud-spin-btn', n => n.disabled);
  if (!poorDisabled) { fails.push('D: 150 points but spin enabled'); }
  await p2.$eval('.hud-spin-btn', n => n.click());
  await p2.waitForTimeout(300);
  if (await balOf(p2) !== 150) { fails.push('D: poor tap charged'); }
  await ctx2.close();

  /* -------- context 3: full motion, one spin - roll runs, reload keeps prize -------- */
  const ctx3 = await browser.newContext({ ...devices['iPhone 13'] });
  await ctx3.route('**/rest/v1/stack_scores*', r =>
    r.request().method() === 'GET' ? r.fallback() : r.abort());
  await ctx3.addInitScript(() => { localStorage.setItem('stack-points', '400'); });
  const p3 = await ctx3.newPage();
  await p3.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await p3.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await p3.waitForTimeout(600);
  await p3.click('.hud-shop-pill');
  await p3.waitForTimeout(300);
  await p3.click('.hud-spin-btn');
  await p3.waitForTimeout(200);
  const mid = await p3.$eval('.hud-reel', n => ({ t: n.style.transition, y: n.style.transform }));
  if (mid.t.indexOf('cubic-bezier(0.12, 0.82, 0.16, 1)') < 0) { fails.push('E: roll transition missing: ' + mid.t); }
  const ownedMid = await ownedOf(p3);
  if (ownedMid.length !== 1) { fails.push('E: prize not persisted before animation end'); }
  await p3.reload({ waitUntil: 'load' });   /* mid-roll reload */
  await p3.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  const ownedAfter = await ownedOf(p3);
  if (ownedAfter.length !== 1) { fails.push('E: prize lost by mid-roll reload'); }
  const hit = await (async () => {   /* fresh page continues; hit class asserted on a second spin */
    await p3.waitForTimeout(600);
    await p3.click('.hud-shop-pill');
    await p3.waitForTimeout(300);
    return p3.$eval('.hud-machine-last', n => n.textContent);
  })();
  console.log('OBS ctx3 winrow "' + hit + '"');
  await ctx3.close();

  await browser.close();
  if (fails.length) { console.log('FAIL ' + JSON.stringify(fails, null, 1)); process.exit(1); }
  console.log('PASS: machine charges, drains, goes dormant, survives reloads');
})();
```

Note: the win row is session-state, so after the reload it is legitimately empty; the OBS line records it without asserting.

- [ ] **Step 5: Run it** — expected PASS. Re-run `pw-gear.js` (renderShopPane now renders three sections) — expected PASS.

- [ ] **Step 6: Commit** `git add hud.js hud.css && git commit -m "Wave B T3: prize machine with state-first spins and the V2 slot roll"`.

---

### Task 4: visuals gear state, trails, flares, materials

**Files:**
- Modify: `visuals.js` (header doc line 28 area; S declaration ~line 135; new gear section after the grow-in family ~line 790; `applyBlockColor` ~line 604; `onBlockPlaced` perfect branch ~line 855; `update()` ~line 1106; `reset()` ~line 968; listeners ~line 1290; api ~line 1240)
- Test: `reference/tests/pw-effects-a.js`

**Interfaces:**
- Consumes: `hud:gear` `{trail, flare, slice, death, record, material}`.
- Produces: `GEAR` state object, `S.gearFx` particle list + `spawnGearBit(def, x, y, z)` helper, `applyMaterialGear(mesh, mat)` hook, `api.debug` (`{ gear(), fxCount() }`) — Task 5 reuses all of these exactly as named.

- [ ] **Step 1: Gear state, listener, debug surface.** Add to the S declaration: `gearFx: [],` (next to `growIns`). After the CustomEvent block's `hud:world` listener (~line 1290), add:

```js
  /* Wave B gear: equipped singles per slot, broadcast by the HUD. Effects
     read this at event time; an unknown id in a slot simply never matches
     an effect branch, so forward compatibility is silence, not breakage. */
  var GEAR = { trail: null, flare: null, slice: null, death: null, record: null, material: null };
  window.addEventListener('hud:gear', function (e) {
    var d = det(e);
    for (var k in GEAR) {
      if (Object.prototype.hasOwnProperty.call(GEAR, k)) {
        GEAR[k] = typeof d[k] === 'string' ? d[k] : null;
      }
    }
    // Materials restyle standing blocks, so a gear change recolors the
    // registry the same way a World change does.
    if (S.inited) { recolorAll(); }
  });
```

Extend the api object (~line 1240) with a test seam:

```js
    debug: {
      gear: function () { return { trail: GEAR.trail, flare: GEAR.flare, slice: GEAR.slice, death: GEAR.death, record: GEAR.record, material: GEAR.material }; },
      fxCount: function () { return S.gearFx.length; }
    },
```

- [ ] **Step 2: The shared particle pool.** After the grow-in family (~line 790), add one bounded system every family uses (camera-facing additive quads):

```js
  /* Wave B gear effects share one particle list: small additive quads with
     per-entry velocity, spin, scale and fade. Bounded hard at 90 entries;
     oldest is recycled first, and reset() clears the lot. */
  var GEAR_FX_MAX = 90;

  function spawnGearBit(o) {
    if (!S.inited) { return; }
    if (S.gearFx.length >= GEAR_FX_MAX) { removeGearBit(S.gearFx[0]); }
    var geo = new T.PlaneGeometry(1, 1);
    var mat = new T.MeshBasicMaterial({
      color: new T.Color(o.color[0], o.color[1], o.color[2]),
      transparent: true,
      opacity: o.op == null ? 0.85 : o.op,
      blending: T.AdditiveBlending,
      depthWrite: false
    });
    var m = new T.Mesh(geo, mat);
    tagHelper(m);
    m.renderOrder = 4;
    m.position.set(o.x, o.y, o.z);
    if (o.flat) { m.rotation.x = -Math.PI / 2; }
    else if (ctx.camera) { m.quaternion.copy(ctx.camera.quaternion); }
    var s0 = (o.size || 0.12) * S.blockW;
    m.scale.set(s0, s0, 1);
    ctx.scene.add(m);
    S.gearFx.push({
      mesh: m,
      t: 0,
      life: o.life || 0.5,
      vel: new T.Vector3(o.vx || 0, o.vy || 0, o.vz || 0).multiplyScalar(S.blockW),
      grav: (o.grav || 0) * S.blockW,
      scaleK: o.scaleK == null ? 1 : o.scaleK,   /* end scale / start scale */
      baseOp: o.op == null ? 0.85 : o.op,
      fadePow: o.fadePow || 1.5
    });
  }

  function removeGearBit(fx) {
    var i = S.gearFx.indexOf(fx);
    if (i >= 0) { S.gearFx.splice(i, 1); }
    if (fx.mesh) {
      if (fx.mesh.parent) { fx.mesh.parent.remove(fx.mesh); }
      if (fx.mesh.geometry) { fx.mesh.geometry.dispose(); }
      if (fx.mesh.material) { fx.mesh.material.dispose(); }
    }
  }
```

`tagHelper` already exists (used by edges/ghost); it keeps helper meshes out of block bookkeeping.

- [ ] **Step 3: Update loop.** In `update(dt)`, after the grow-ins block and before `// debris`, add:

```js
    // gear particles
    for (var gx = S.gearFx.length - 1; gx >= 0; gx--) {
      var fx = S.gearFx[gx];
      fx.t += dt;
      var fp = fx.t / fx.life;
      if (fp >= 1) { removeGearBit(fx); continue; }
      fx.vel.y -= fx.grav * dt;
      fx.mesh.position.addScaledVector(fx.vel, dt);
      var fs = (1 + (fx.scaleK - 1) * fp);
      fx.mesh.scale.x = fx.mesh.scale.x >= 0 ? Math.abs(fx.mesh.scale.x) : fx.mesh.scale.x;
      var base = fx.mesh.userData.gearS0 || (fx.mesh.userData.gearS0 = fx.mesh.scale.x);
      fx.mesh.scale.set(base * fs, base * fs, 1);
      fx.mesh.material.opacity = fx.baseOp * Math.pow(1 - fp, fx.fadePow);
    }

    // drop trail emitter
    if (GEAR.trail && S.slider && S.slider.parent) {
      S.trailAcc = (S.trailAcc || 0) + dt;
      var tdef = TRAIL_DEFS[GEAR.trail];
      if (tdef) {
        while (S.trailAcc >= tdef.rate) {
          S.trailAcc -= tdef.rate;
          var sp = S.slider.position;
          spawnGearBit({
            x: sp.x + (Math.random() - 0.5) * 0.3 * S.blockW,
            y: sp.y + (Math.random() - 0.5) * 0.1 * S.blockW,
            z: sp.z + (Math.random() - 0.5) * 0.3 * S.blockW,
            color: tdef.color, size: tdef.size, life: tdef.life,
            vy: tdef.rise, vx: (Math.random() - 0.5) * tdef.drift,
            vz: (Math.random() - 0.5) * tdef.drift,
            scaleK: tdef.scaleK, fadePow: tdef.fadePow
          });
        }
      }
    } else {
      S.trailAcc = 0;
    }
```

- [ ] **Step 4: Trail defs and the slider handle.** Next to the GEAR declaration add:

```js
  var TRAIL_DEFS = {
    comet:   { rate: 0.028, life: 0.5,  size: 0.16, rise: -0.4, drift: 0.1,  scaleK: 0.35, fadePow: 2,   color: [1.0, 0.72, 0.38] },
    ribbon:  { rate: 0.022, life: 0.6,  size: 0.13, rise: 0,    drift: 0.05, scaleK: 0.8,  fadePow: 1.5, color: [0.62, 0.83, 1.0] },
    bubbles: { rate: 0.05,  life: 0.75, size: 0.09, rise: 0.9,  drift: 0.3,  scaleK: 1.3,  fadePow: 1,   color: [0.55, 0.95, 0.88] }
  };
```

Track the slider: in the `stack:block` listener, after the grow-in line, add `if (d.mesh && d.level > 0) { S.slider = d.mesh; }`. In the `stack:placed` listener path (`onBlockPlaced`, next to the renderOrder release) and in the `stack:debris` listener (next to its release), add `if (mesh === S.slider) { S.slider = null; }` / `if (d.mesh === S.slider) { S.slider = null; }`. Add `slider: null,` and `trailAcc: 0,` to the S declaration.

- [ ] **Step 5: Flares.** Add defs next to TRAIL_DEFS and a spawn call in `onBlockPlaced`:

```js
  var FLARE_DEFS = {
    goldring:  { rings: [{ size: 0.5, scaleK: 4.4, life: 0.5,  op: 0.8, color: [0.95, 0.76, 0.31] }] },
    shockwave: { rings: [{ size: 0.4, scaleK: 7.0, life: 0.32, op: 0.9, color: [0.93, 0.95, 0.97] }] },
    starburst: { sparks: 7, size: 0.1, speed: 2.6, life: 0.45, op: 0.9, color: [1.0, 0.85, 0.54] }
  };

  function spawnFlare(mesh) {
    var def = FLARE_DEFS[GEAR.flare];
    var fp = meshFootprint(mesh, {});
    if (!def || !fp) { return; }
    var y = fp.topY + 0.04 * S.blockW;
    if (def.rings) {
      for (var i = 0; i < def.rings.length; i++) {
        var r = def.rings[i];
        spawnGearBit({ x: fp.cx, y: y, z: fp.cz, flat: true, size: r.size, scaleK: r.scaleK, life: r.life, op: r.op, color: r.color, fadePow: 2 });
      }
    } else if (def.sparks) {
      for (var s = 0; s < def.sparks; s++) {
        var a = (s / def.sparks) * Math.PI * 2;
        spawnGearBit({
          x: fp.cx, y: y, z: fp.cz, size: def.size, life: def.life, op: def.op,
          vx: Math.cos(a) * def.speed, vz: Math.sin(a) * def.speed, vy: 0.6,
          grav: 2.2, scaleK: 0.4, fadePow: 1.5, color: def.color
        });
      }
    }
  }
```

In `onBlockPlaced`, inside the `if (opts.perfect)` branch after `startPulse(mesh, 0.05, true);`, add:

```js
      if (GEAR.flare && mesh) { spawnFlare(mesh); }
```

- [ ] **Step 6: Materials.** At the end of `applyBlockColor` (after `mat.opacity = p.op;`), add `applyMaterialGear(mesh, mat);` and define next to it:

```js
  /* Material singles adjust the finish after the World palette lands, and
     recolorAll re-runs this on gear changes, so equip and unequip both
     restyle the standing tower. Deep frozen blocks (recolorAll's d > 34
     skip) keep their old finish off-screen by design. */
  function applyMaterialGear(mesh, mat) {
    var ud = mesh.userData || {};
    if (GEAR.material === 'glass') {
      mat.opacity = Math.max(0.5, mat.opacity * 0.72);
    } else if (GEAR.material === 'wood') {
      S.tmpC.setRGB(0.72, 0.55, 0.34);
      mat.color.lerp(S.tmpC, 0.34);
      mat.opacity = Math.min(1, mat.opacity * 1.12);
    }
    if (ud.svEdges && ud.svEdges.material) {
      if (GEAR.material === 'neonedge') {
        if (ud.svEdges.material === S.edgeMat) { ud.svEdges.material = S.edgeMat.clone(); }
        ud.svEdges.material.opacity = 1.0;
        ud.svEdges.material.color.copy(mat.color).multiplyScalar(1.6);
      } else if (ud.svEdges.material !== S.edgeMat) {
        ud.svEdges.material.dispose();
        ud.svEdges.material = S.edgeMat;
      }
    }
  }
```

- [ ] **Step 7: Cleanup.** In `reset()` (after the growIns lines): `while (S.gearFx.length) { removeGearBit(S.gearFx[0]); } S.slider = null; S.trailAcc = 0;`. Update the header doc line 28 to `'stack:block' { mesh, level, grown }` block by adding a line: `'hud:gear' { trail, flare, slice, death, record, material }` under the consumed-events list.

- [ ] **Step 8: Write the suite** `reference/tests/pw-effects-a.js`:

```js
/* Gear effects, families A: trail emits while sliding, flare fires on a
   perfect, glass material thins the tower, and reset cleans the pool. */
const { chromium, devices } = require('playwright');
const URL = 'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const fails = [];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  await context.route('**/rest/v1/stack_scores*', r =>
    r.request().method() === 'GET' ? r.fallback() : r.abort());
  await context.addInitScript(() => {
    localStorage.setItem('stack-singles', JSON.stringify(['comet', 'goldring', 'glass']));
    localStorage.setItem('stack-gear', JSON.stringify({ trail: 'comet', flare: 'goldring', material: 'glass' }));
  });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await page.waitForTimeout(900);

  /* A - boot handoff reached visuals */
  const gear = await page.evaluate(() => window.StackVisuals.debug.gear());
  if (gear.trail !== 'comet' || gear.flare !== 'goldring' || gear.material !== 'glass') {
    fails.push('A: gear did not reach visuals: ' + JSON.stringify(gear));
  }

  /* B - trail: particles exist while the slider moves */
  await page.evaluate(() => { window.StackCore.debug.reset(); window.StackCore.debug.drop(0); });
  await page.waitForTimeout(700);
  const trailN = await page.evaluate(() => window.StackVisuals.debug.fxCount());
  console.log('OBS trail fx ' + trailN);
  if (trailN < 3) { fails.push('B: trail not emitting (fx=' + trailN + ')'); }

  /* C - flare: a perfect drop spawns a burst beyond the trail baseline */
  const before = await page.evaluate(() => window.StackVisuals.debug.fxCount());
  await page.evaluate(() => { window.StackCore.debug.drop(0); });
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => window.StackVisuals.debug.fxCount());
  console.log('OBS flare fx ' + before + ' -> ' + after);
  if (after <= before) { fails.push('C: perfect landing spawned no flare'); }

  /* D - glass: the placed cap is thinner than the stock 0.85-band opacity */
  const op = await page.evaluate(() => {
    const st = window.StackCore.getTowerState();
    return st.blocks[st.blocks.length - 1].mesh.material.opacity;
  });
  console.log('OBS glass opacity ' + op);
  if (!(op < 0.75)) { fails.push('D: glass finish not applied (opacity ' + op + ')'); }

  /* E - reset clears the pool */
  await page.evaluate(() => { window.StackCore.debug.reset(); });
  await page.waitForTimeout(200);
  const cleared = await page.evaluate(() => window.StackVisuals.debug.fxCount());
  if (cleared !== 0) { fails.push('E: reset left ' + cleared + ' fx'); }

  if (errs.length) { fails.push('errors: ' + JSON.stringify(errs)); }
  await browser.close();
  if (fails.length) { console.log('FAIL ' + JSON.stringify(fails, null, 1)); process.exit(1); }
  console.log('PASS: trail, flare, glass, cleanup');
})();
```

- [ ] **Step 9: Run it** — expected PASS. Also run `pw-hover-fix.js`, `pw-regrow-cue.js`, `pw-fps-run.js` (update loop and styleBlock touched) — expected PASS with the fps gate intact.

- [ ] **Step 10: Commit** `git add visuals.js && git commit -m "Wave B T4: gear state in visuals - trails, flares, materials"`.

---

### Task 5: visuals slice styles, death effects, record moments

**Files:**
- Modify: `visuals.js` (`spawnDebris` ~line 883; debris integrator ~line 1111; `stack:gameover` listener ~line 1296; `ghostCheckPassed` and its caller ~line 876)
- Test: `reference/tests/pw-effects-b.js`

**Interfaces:**
- Consumes: Task 4's `GEAR`, `spawnGearBit`, `S.gearFx`, `api.debug`.
- Produces: per-entry `gravK` and `bounceY`/`bounces` fields on debris entries; `recordFx(mesh)`; death handling on `stack:gameover`.

- [ ] **Step 1: Slice styles inside `spawnDebris`.** After the existing `S.debris.push({...})` call, capture the new entry (`var entry = S.debris[S.debris.length - 1];`) and append:

```js
    // Slice singles restyle the cut piece. They apply to every debris
    // spawn, including the run-ending miss, so the look stays consistent;
    // the death single layers on top of whatever the slice style left.
    var sliceKind = GEAR.slice;
    if (sliceKind === 'petals') {
      entry.gravK = 0.22;
      entry.rate *= 2.2;
      entry.dur = Math.max(entry.dur, 1.6);
      for (var pi = 0; pi < 5; pi++) {
        spawnGearBit({
          x: mesh.position.x, y: mesh.position.y, z: mesh.position.z,
          size: 0.1, life: 1.3, op: 0.8, grav: 1.1,
          vx: (Math.random() - 0.5) * 1.4, vy: 0.7 + Math.random() * 0.4,
          vz: (Math.random() - 0.5) * 1.4,
          scaleK: 0.7, fadePow: 1.2, color: [1.0, 0.7, 0.8]
        });
      }
    } else if (sliceKind === 'confetti') {
      entry.dur = Math.min(entry.dur, 0.45);
      var cCols = [[1, 0.44, 0.57], [0.35, 0.94, 1], [0.95, 0.76, 0.31], [0.61, 0.89, 0.5]];
      for (var ci = 0; ci < 10; ci++) {
        spawnGearBit({
          x: mesh.position.x, y: mesh.position.y, z: mesh.position.z,
          size: 0.07, life: 0.9, op: 0.95, grav: 5.5,
          vx: (Math.random() - 0.5) * 3.2, vy: 1.6 + Math.random() * 1.2,
          vz: (Math.random() - 0.5) * 3.2,
          scaleK: 0.6, fadePow: 1, color: cCols[ci % cCols.length]
        });
      }
    } else if (sliceKind === 'pixels') {
      entry.dur = Math.min(entry.dur, 0.35);
      for (var xi = 0; xi < 8; xi++) {
        spawnGearBit({
          x: mesh.position.x + (Math.random() - 0.5) * 0.5 * S.blockW,
          y: mesh.position.y + (Math.random() - 0.5) * 0.3 * S.blockW,
          z: mesh.position.z + (Math.random() - 0.5) * 0.5 * S.blockW,
          size: 0.11, life: 0.6, op: 0.9, grav: 4.5,
          vx: (Math.random() - 0.5) * 1.6, vy: 0.5, vz: (Math.random() - 0.5) * 1.6,
          scaleK: 1, fadePow: 0.8, color: [0.35, 0.94, 1]
        });
      }
    } else if (sliceKind === 'shards') {
      entry.rate *= 1.6;
      for (var hi = 0; hi < 4; hi++) {
        spawnGearBit({
          x: mesh.position.x, y: mesh.position.y, z: mesh.position.z,
          size: 0.12, life: 0.7, op: 0.85, grav: 6,
          vx: (Math.random() - 0.5) * 2.6, vy: 1.2 + Math.random(), vz: (Math.random() - 0.5) * 2.6,
          scaleK: 0.3, fadePow: 2, color: [0.75, 0.89, 1.0]
        });
      }
    }
```

- [ ] **Step 2: Integrator support.** In the debris loop (~line 1114), change the gravity line and add the bounce, exactly:

```js
      en.vel.y -= CFG.gravity * S.blockW * dt * (en.gravK == null ? 1 : en.gravK);
```

and after `en.mesh.position.addScaledVector(en.vel, dt);`:

```js
      if (en.bounces > 0 && en.mesh.position.y <= en.bounceY && en.vel.y < 0) {
        en.vel.y = -en.vel.y * 0.55;
        en.bounces--;
      }
```

- [ ] **Step 3: Death effects.** Replace the `stack:gameover` listener body (`window.addEventListener('stack:gameover', function () { onGameOver(); });`) with:

```js
  window.addEventListener('stack:gameover', function () {
    onGameOver();
    // Death singles dress the fall. The screen and the audio stay silent;
    // this is scene-side only.
    if (GEAR.death === 'slowmo') {
      S.slowmoT = 0.8;
    } else if (GEAR.death === 'bounce' && S.debris.length) {
      var en = S.debris[S.debris.length - 1];
      en.bounces = 1;
      en.bounceY = en.mesh.position.y - 3 * S.blockW;
      en.dur = Math.max(en.dur, 2.0);
    } else if (GEAR.death === 'fireworks') {
      var top = 0;
      try { top = window.StackCore.getTowerState().towerTop; } catch (err) { top = 4; }
      var cols = [[0.69, 0.55, 1.0], [1.0, 0.72, 0.38], [0.55, 0.95, 0.88]];
      for (var b = 0; b < 3; b++) {
        (function (bi) {
          setTimeout(function () {
            if (!S.inited) { return; }
            var bx = (Math.random() - 0.5) * 3 * S.blockW;
            var bz = (Math.random() - 0.5) * 3 * S.blockW;
            for (var p = 0; p < 8; p++) {
              var a = (p / 8) * Math.PI * 2;
              spawnGearBit({
                x: bx, y: top + (2.5 + bi) * S.blockW, z: bz,
                size: 0.1, life: 0.8, op: 0.95, grav: 1.6,
                vx: Math.cos(a) * 2.4, vy: Math.sin(a) * 2.4 * 0.6 + 0.8, vz: Math.sin(a) * 1.2,
                scaleK: 0.4, fadePow: 1.5, color: cols[bi % cols.length]
              });
            }
          }, 500 + bi * 250);
        })(b);
      }
    }
  });
```

Add `slowmoT: 0,` to the S declaration, and at the very top of `update(dt)` (first lines of the function):

```js
    if (S.slowmoT > 0) {
      S.slowmoT -= dt;
      dt *= 0.4;   /* the whole scene breathes slower for under a second */
    }
```

Add `S.slowmoT = 0;` to `reset()`.

- [ ] **Step 4: Record moments.** Change `ghostCheckPassed(level)` to `ghostCheckPassed(level, mesh)` (single caller at ~line 876 becomes `ghostCheckPassed(level, mesh);`), and inside its `if` body (where `GHOST.passed = true;` is set) add `recordFx(mesh);`. Define next to the flare code:

```js
  function recordFx(mesh) {
    if (!GEAR.record || !S.inited) { return; }
    var fp = mesh ? meshFootprint(mesh, {}) : null;
    if (GEAR.record === 'ringburst' && fp) {
      spawnGearBit({ x: fp.cx, y: fp.topY + 0.05 * S.blockW, z: fp.cz, flat: true, size: 0.6, scaleK: 6.5, life: 0.7, op: 0.9, color: [1.0, 0.88, 0.54], fadePow: 2 });
      spawnGearBit({ x: fp.cx, y: fp.topY + 0.05 * S.blockW, z: fp.cz, flat: true, size: 0.4, scaleK: 5.0, life: 0.55, op: 0.6, color: [1.0, 0.95, 0.8], fadePow: 2 });
    } else if (GEAR.record === 'aurora') {
      var y = (fp ? fp.topY : 4) + 6 * S.blockW;
      for (var i = 0; i < 6; i++) {
        spawnGearBit({
          x: -6 * S.blockW + i * 0.6 * S.blockW, y: y + (i % 2) * 0.5 * S.blockW, z: -2 * S.blockW,
          size: 1.4, life: 1.2, op: 0.35,
          vx: 5.5, vy: 0.2, vz: 0,
          scaleK: 1.6, fadePow: 1.2, color: [0.5, 1.0, 0.79]
        });
      }
    }
  }
```

- [ ] **Step 5: Write the suite** `reference/tests/pw-effects-b.js`:

```js
/* Gear effects, families B: confetti replaces the cut piece's tail, slow-mo
   arms on death, bounce tags the death piece, fireworks burst after the
   fall, ring burst fires on a new record. */
const { chromium, devices } = require('playwright');
const URL = 'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const fails = [];

async function boot(browser, gearMap, extra) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  await context.route('**/rest/v1/stack_scores*', r =>
    r.request().method() === 'GET' ? r.fallback() : r.abort());
  await context.addInitScript(([g, x]) => {
    localStorage.setItem('stack-singles', JSON.stringify(Object.values(g)));
    localStorage.setItem('stack-gear', JSON.stringify(g));
    if (x && x.best) { localStorage.setItem('stack-best', String(x.best)); }
  }, [gearMap, extra || {}]);
  const page = await context.newPage();
  page.on('pageerror', e => fails.push('pageerror: ' + e.message));
  await page.goto('file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1', { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await page.waitForTimeout(900);
  return { context, page };
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  /* A - confetti: sliced drop spawns burst particles */
  let s = await boot(browser, { slice: 'confetti' });
  await s.page.evaluate(() => { window.StackCore.debug.reset(); window.StackCore.debug.drop(0.5); });
  await s.page.waitForTimeout(150);
  const conf = await s.page.evaluate(() => window.StackVisuals.debug.fxCount());
  console.log('OBS confetti fx ' + conf);
  if (conf < 8) { fails.push('A: confetti burst missing (fx=' + conf + ')'); }
  await s.context.close();

  /* B - fireworks: bursts appear after a full-miss death */
  s = await boot(browser, { death: 'fireworks' });
  await s.page.evaluate(() => { window.StackCore.debug.reset(); window.StackCore.debug.drop(9); });
  await s.page.waitForTimeout(1400);
  const fw = await s.page.evaluate(() => window.StackVisuals.debug.fxCount());
  console.log('OBS fireworks fx ' + fw);
  if (fw < 8) { fails.push('B: fireworks missing (fx=' + fw + ')'); }
  await s.context.close();

  /* C - ring burst on beating the stored best */
  s = await boot(browser, { record: 'ringburst' }, { best: 2 });
  await s.page.evaluate(() => { window.StackCore.debug.reset(); window.StackCore.debug.build(3, 0); });
  await s.page.waitForTimeout(300);
  const ring = await s.page.evaluate(() => window.StackVisuals.debug.fxCount());
  console.log('OBS record fx ' + ring);
  if (ring < 1) { fails.push('C: record moment missing (fx=' + ring + ')'); }
  await s.context.close();

  /* D - no gear, no fx: the same drives spawn nothing */
  s = await boot(browser, {});
  await s.page.evaluate(() => { window.StackCore.debug.reset(); window.StackCore.debug.drop(0.5); window.StackCore.debug.drop(9); });
  await s.page.waitForTimeout(900);
  const none = await s.page.evaluate(() => window.StackVisuals.debug.fxCount());
  if (none !== 0) { fails.push('D: fx spawned with nothing equipped: ' + none); }
  await s.context.close();

  await browser.close();
  if (fails.length) { console.log('FAIL ' + JSON.stringify(fails, null, 1)); process.exit(1); }
  console.log('PASS: slice, death, record families fire and stay silent unequipped');
})();
```

Note for the implementer: `localStorage.setItem('stack-singles', JSON.stringify(Object.values(g)))` stores the equipped ids as owned, which is exactly the invariant the machine maintains.

- [ ] **Step 6: Run it** — expected PASS. Re-run `pw-effects-a.js`, `pw-hover-fix.js`, `pw-fps-run.js` — expected PASS.

- [ ] **Step 7: Commit** `git add visuals.js && git commit -m "Wave B T5: slice styles, death effects, record moments"`.

---

### Task 6: Roast packs

**Files:**
- Modify: `hud.js` (after the `WORLD_QUIPS` table / `activeQuips` ~line 937; `computeRoast` ~line 1004)
- Test: `reference/tests/pw-roast-packs.js`

**Interfaces:**
- Consumes: Task 1's `readGear()` (the `roast` slot) and `equipSingle`'s `quipBag` reset.
- Produces: `ROAST_PACK_QUIPS`, `ROAST_PACK_RIVAL`, `activeRivals()`.

- [ ] **Step 1: Pack tables.** After the `WORLD_QUIPS` table's closing `};` (~line 935), add:

```js
  /* Roast packs (Wave B singles): an equipped pack replaces the World's
     quip bag and the generic rival templates - it never stacks. Rival
     templates keep the {n}/{s} slots and go through fillRoast, so Hebrew
     names keep their LRM guard. */
  var ROAST_PACK_QUIPS = {
    savage: [
      'That was a cry for help in block form.',
      'The tower died of embarrassment first.',
      'Delete this run from your memory. Everyone else will.',
      'Gravity did you a favor, honestly.',
      'Your thumbs owe the tower an apology.',
      'The blocks unionized against you.',
      'Even the base is disappointed, and it does nothing.',
      'That collapse had witnesses.'
    ],
    gentle: [
      'A very brave attempt, all things considered.',
      'The tower simply needed a rest.',
      'You placed some of those beautifully. Some.',
      'Every collapse is a lesson wearing a costume.',
      'The blocks enjoyed their time with you.',
      'That was nearly something wonderful.',
      'Rest now. The tower certainly is.',
      'Tomorrow the blocks will forgive everything.'
    ],
    nerd: [
      'Stack overflow. Literally.',
      'Segmentation fault at block level.',
      'Your tower failed the integration test.',
      'Entropy: 1. Architecture: 0.',
      'That was an off-by-everything error.',
      'The tower got garbage collected.',
      'Undefined behavior, well defined outcome.',
      'Race condition between thumb and physics. Physics won.'
    ],
    bard: [
      'Alas, poor tower. It knew thee well.',
      'Thy blocks hath fallen most grievously.',
      'A plague upon that final drop.',
      'So falls the tower, so falls the crown.',
      'Wherefore didst thou tap, and tap so ill?',
      'The stage is cleared. The tragedy, complete.',
      'Sleep, sweet prince of poorly landed stone.',
      'Exeunt tower, pursued by gravity.'
    ]
  };
  var ROAST_PACK_RIVAL = {
    savage: [
      '{n} got {s} without even trying. Think about that.',
      'You lost to {n}. {n}! At {s}!'
    ],
    gentle: [
      '{n} reached {s}. You will get there, probably.',
      'Look at {n} with {s}. Something to aim for, gently.'
    ],
    nerd: [
      '{n} benchmarked {s}. Your build failed to compile.',
      'Diff vs {n}: you are {s} minus a lot.'
    ],
    bard: [
      'Yon {n} standeth taller at {s}.',
      'To {n} at {s}: the crown remains thine.'
    ]
  };

  function activeRoastPack() {
    return readGear().roast || null;
  }
```

- [ ] **Step 2: Wire the pools.** Replace `activeQuips` (~line 937) and add `activeRivals`, then point `computeRoast` at it:

```js
  function activeQuips() {
    var pack = activeRoastPack();
    if (pack && ROAST_PACK_QUIPS[pack]) { return ROAST_PACK_QUIPS[pack]; }
    return WORLD_QUIPS[readWorld()] || QUIPS;
  }

  function activeRivals() {
    var pack = activeRoastPack();
    if (pack && ROAST_PACK_RIVAL[pack]) { return ROAST_PACK_RIVAL[pack]; }
    return ROAST_RIVAL;
  }
```

In `computeRoast` (~line 1023), change `pickFrom(rv.score === myScore ? ROAST_TIE : ROAST_RIVAL)` to `pickFrom(rv.score === myScore ? ROAST_TIE : activeRivals())`.

- [ ] **Step 3: Write the suite** `reference/tests/pw-roast-packs.js`:

```js
/* Roast packs: the equipped pack owns the death quip, the rival line comes
   from the pack's templates, and a Hebrew rival name keeps the LRM guard. */
const { chromium, devices } = require('playwright');
const URL = 'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const fails = [];
const SAVAGE = [
  'That was a cry for help in block form.',
  'The tower died of embarrassment first.',
  'Delete this run from your memory. Everyone else will.',
  'Gravity did you a favor, honestly.',
  'Your thumbs owe the tower an apology.',
  'The blocks unionized against you.',
  'Even the base is disappointed, and it does nothing.',
  'That collapse had witnesses.'
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  /* Board GETs return one Hebrew rival high above us so the roast path has
     a target; nothing is ever posted. */
  await context.route('**/rest/v1/stack_scores*', r => {
    if (r.request().method() !== 'GET') { return r.abort(); }
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ name: 'יוסי', score: 500, mode: 'normal' }])
    });
  });
  await context.addInitScript(() => {
    localStorage.setItem('stack-singles', JSON.stringify(['savage']));
    localStorage.setItem('stack-gear', JSON.stringify({ roast: 'savage' }));
    localStorage.setItem('stack-name', 'tester');
  });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await page.waitForTimeout(900);

  await page.evaluate(() => { window.StackCore.debug.reset(); window.StackCore.debug.drop(0); window.StackCore.debug.drop(9); });
  await page.waitForSelector('#hud-root[data-state="over"]', { timeout: 8000 });
  await page.waitForTimeout(1200);
  const quip = await page.$eval('.hud-quip', n => n.textContent);
  console.log('OBS quip "' + quip + '"');

  const fromPack = SAVAGE.indexOf(quip) >= 0;
  const rivalWithLrm = quip.indexOf('יוסי\u200e') >= 0;
  if (!fromPack && !rivalWithLrm) {
    fails.push('quip came from neither the savage pack nor a pack rival line with LRM: "' + quip + '"');
  }

  if (errs.length) { fails.push('errors: ' + JSON.stringify(errs)); }
  await browser.close();
  if (fails.length) { console.log('FAIL ' + JSON.stringify(fails, null, 1)); process.exit(1); }
  console.log('PASS: pack owns the death line, LRM guard holds');
})();
```

Implementer note: check the real class name of the quip element (`.hud-quip` here) and the name storage key (`stack-name`) against hud.js before running; if they differ, use the file's actual selectors — the assertion logic stays the same. If the rival line templates land (`rivalWithLrm` path), they must also be from `ROAST_PACK_RIVAL.savage` shapes; extend the check to match both templates if flake appears.

- [ ] **Step 4: Run it** — expected PASS. Re-run `pw-deathlines.js` (roast machinery touched) — expected PASS.

- [ ] **Step 5: Commit** `git add hud.js && git commit -m "Wave B T6: roast packs replace the quip bag and rival templates"`.

---

### Task 7: Reconciliation, offline rebuild, deploy

**Files:**
- Modify: `Stack.html` (rebuilt artifact)
- Test: the full existing suite plus the five new ones

- [ ] **Step 1: Full local run.** Run every suite in `reference/tests/` that is a pass/fail suite (per the ledger: 25 existing + `pw-gear-core`, `pw-gear`, `pw-machine`, `pw-effects-a`, `pw-effects-b`, `pw-roast-packs`). Diagnostics (`pw-board-clunk`, `pw-hover-probe*`) stay excluded. Every failure is fixed in code (or the suite reconciled with a recorded reason) before proceeding.

- [ ] **Step 2: Offline rebuild** `node scripts/build-offline.mjs`, then run `pw-offline-check.js` — expected PASS.

- [ ] **Step 3: Commit and push**

```bash
git add hud.js hud.css visuals.js Stack.html
git commit -m "Wave B: prize machine, 22 singles, per-slot gear, offline rebuild"
git push origin main
```

- [ ] **Step 4: Deploy verification.** Cache-busted curl until both serve (the Pages run label lies on rapid pushes; the curl is ground truth):

```bash
curl -s "https://maores.github.io/stack-tower/hud.js?cb=$(date +%s)" | grep -c "spinMachine"
curl -s "https://maores.github.io/stack-tower/visuals.js?cb=$(date +%s)" | grep -c "spawnGearBit"
```

Expected: both ≥ 1.

- [ ] **Step 5: Live re-runs.** Run `pw-machine.js` and `pw-effects-a.js` against production by switching their URL constant to `https://maores.github.io/stack-tower/?debug=1` via the same env-flag pattern the cue and fart suites use (`CUE_LIVE`/`FART_LIVE`): add `MACHINE_LIVE` / `FX_LIVE` env checks to both files' URL lines. Expected: PASS twice.

- [ ] **Step 6: Ledger and records.** Append the wave-close entry to `.superpowers/sdd/progress.md` (commits, suite counts, deploy SHAs, anything reconciled), then the memory/vault updates per the project's wrap-up rules.

## Self-Review

- Spec coverage: economy (T3 constants, earn untouched), pool of 22 (T1 catalog matches the spec list one to one), machine mechanics (T3: state-first, uniform unowned draw, dormant, V2 numbers, reduced motion, insufficient balance, win line), owning/equipping (T1 storage + T2 rack + auto-equip in both buy and spin paths), hud:gear contract (T1, boot broadcast inside fireBoot), shop layout (T2 order: Worlds → rack → machine), effects wiring (T4/T5, every family on its spec event, cleanup on reset), offline (nothing fetched), verification (suites per spec section), non-goals (nothing here builds them).
- Placeholder scan: no TBDs; every code step carries the code; the two implementer notes (quip selector check, `pw-boards` shop-suite name) direct verification against the file rather than leaving values undefined.
- Type consistency: `readGear`/`writeGear`/`equipSingle`/`unequipSlot`/`fireGear` (T1) are the only storage surface T2/T3/T6 call; `spawnGearBit(o)`/`removeGearBit(fx)`/`GEAR`/`api.debug.fxCount` (T4) are what T5 reuses; `renderShopPane` chains `renderGearRack` (T2) then `renderMachine` (T3); `disarmShop` owns both arm states from T2 on.
