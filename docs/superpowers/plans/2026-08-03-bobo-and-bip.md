# Bobo World + sliced-placement sound — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sliced-placement sound with candidate B (a low falling body, no pitched note), and add BOBO, a chocolate-brown seventh World granted as a booby prize the first time a player dies at a score of 0.

**Architecture:** Four presentation files, no core.js changes, no backend changes, no new events. audio.js gets a rewritten `playSliced` plus a Bobo voice; visuals.js gains an optional per-World `hueStep` and a Bobo palette; hud.js gains a Bobo catalog entry carrying a new `secret` flag, a quip pack, a grant hook in `applyOver` and a purchase guard; hud.css gains one `[hidden]` rule.

**Tech Stack:** Vanilla ES5 browser JS, WebAudio, Three.js r-pinned, Playwright for tests, GitHub Pages for deploy.

**Spec:** `docs/superpowers/specs/2026-08-02-bobo-and-bip-design.md`

## Global Constraints

- **hud.js is ES5 with a house style.** `var` only, no arrow functions, no template literals, IIFE scope, `/* */` comments, defensive `try/catch` around every storage access, `textContent` only and never `innerHTML` for anything a player can influence.
- **visuals.js uses `//` comments.** audio.js and hud.js use `/* */`. Match the file you are in.
- **Cross-domain coupling goes through window CustomEvents only.** No file reaches into another's internals. This plan adds no new events.
- **Game UI text stays English.** Hebrew player names are data and keep their LRM guard in roast templates.
- **Never put a service key in this repo.** The Supabase key in hud.js is the publishable key and is meant to be public.
- **Any test that can reach the save flow MUST intercept `**/rest/v1/stack_scores*`** so no row reaches the real leaderboard. Anon can INSERT but not DELETE on the live project, so a stray row cannot be cleaned up.
- **Scripted runs need `?debug=1`.** Without it `StackCore.debug` is a deliberate decoy.
- **Test against `index.html` on `file://` first, then the live URL after deploy.**
- **An element hidden via the `.hidden` property needs an explicit `[hidden] { display: none }` rule**, because an author `display` declaration beats the UA rule. Tests for hidden state MUST assert `getComputedStyle(el).display`, never `el.hidden`. This codebase has been bitten twice (`.hud-lb-list`, `.hud-rec-row`).
- **A `pointer-events: none` ancestor does NOT stop an `auto` descendant being a hit target.** Any claim that chrome is untappable must be proven by a real tap at real coordinates.
- **Exact values are non-negotiable.** Every hex string, frequency, ratio and quip line in this plan is copied from the approved spec. Do not round, re-derive or improve them.

---

## File Structure

| File | Change |
|------|--------|
| `audio.js` | Rewrite `playSliced`; add `WORLD_SOUND.bobo` |
| `visuals.js` | `pickRunPalette` honours an optional `worldStyle.hueStep`; add `WORLD_STYLES.bobo` |
| `hud.js` | Add `WORLDS` bobo entry (`secret: true`); add `WORLD_QUIPS.bobo`; hide secret cards in `renderShopPane`; guard the buy path; grant + toast in `applyOver` |
| `hud.css` | `.hud-shop-card[hidden] { display: none; }` |
| `reference/tests/pw-sliced-voice.js` | New |
| `reference/tests/pw-bobo-palette.js` | New |
| `reference/tests/pw-bobo-card.js` | New |
| `reference/tests/pw-bobo-grant.js` | New |
| `Stack.html` | Rebuilt by `node scripts/build-offline.mjs` |

`reference/` is gitignored. Test files are run evidence, not shipped code.

---

### Task 1: The sliced-placement sound

**Files:**
- Modify: `audio.js` (`playSliced`, around lines 146-160)
- Test: `reference/tests/pw-sliced-voice.js`

**Interfaces:**
- Consumes: `sound.tap` from the existing `WORLD_SOUND` table; `noise()`, `envGain()`, `ctx` from the enclosing IIFE. All unchanged.
- Produces: nothing new. `playSliced(t)` keeps its signature and its call site in the `stack:placed` listener.

**Why the body pitch is derived rather than fixed:** the audition ran with classic's `tap` of 440 and hard-coded 150 Hz and 78 Hz. Shipping those literals would make every World's sliced sound identical and leave `WORLD_SOUND[].tap` with zero readers. `0.34` and `0.177` reproduce 149.6 Hz and 77.9 Hz at tap 440, so classic is the sound that was approved.

- [ ] **Step 1: Write the failing test**

Create `reference/tests/pw-sliced-voice.js`:

```js
/* The sliced-placement voice must actually run for every World.
   audio.js swallows exceptions inside speak() by design (audio must never
   break the game), and dbg.played++ sits AFTER fn(), so a throw inside
   playSliced is silent except that the counter does not move. That makes
   the counter the real assertion here. */
const { chromium, devices } = require('playwright');
const URL = 'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const WORLDS = ['classic', 'sunset', 'neon', 'deepsea', 'marble', 'obsidian', 'bobo'];
const fails = [];

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));

  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  /* WebAudio needs a real gesture before a context exists. */
  await page.mouse.click(180, 400);
  await page.waitForTimeout(400);

  const ready = await page.evaluate(() => window.StackAudio.isReady());
  if (!ready) { fails.push('audio context never came up after a tap'); }

  for (const id of WORLDS) {
    const seen = await page.evaluate(async (world) => {
      window.dispatchEvent(new CustomEvent('hud:world', { detail: { id: world } }));
      const before = window.StackAudio.debug.played;
      window.dispatchEvent(new CustomEvent('stack:placed', { detail: { perfect: false } }));
      await new Promise(r => setTimeout(r, 120));
      return {
        world: window.StackAudio.debug.world,
        last: window.StackAudio.debug.last,
        moved: window.StackAudio.debug.played - before
      };
    }, id);
    console.log('OBS ' + id + ' ' + JSON.stringify(seen));
    if (seen.moved !== 1) {
      fails.push(id + ': playSliced did not complete (played moved by ' + seen.moved + ')');
    }
    if (seen.last !== 'sliced') { fails.push(id + ': last voice was ' + seen.last); }
    if (seen.world !== id) { fails.push(id + ': world resolved to ' + seen.world); }
  }

  if (errs.length) { fails.push('errors: ' + JSON.stringify(errs)); }
  await browser.close();
  if (fails.length) { console.log('FAIL ' + JSON.stringify(fails, null, 1)); process.exit(1); }
  console.log('PASS: the sliced voice runs in every World');
})();
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node reference/tests/pw-sliced-voice.js`

Expected: FAIL on the `bobo` iteration only. `bobo` is not in `WORLD_SOUND` yet, so `dbg.world` resolves to `classic` (the table's documented fallback). The six existing Worlds pass. If any of the six fails, stop and report: something is already broken and this task is not the cause.

- [ ] **Step 3: Rewrite `playSliced`**

In `audio.js`, replace the whole `playSliced` function (currently at lines 146-160, including its comment) with:

```js
  /* Sliced placement: a low body falling away under the shaved piece's
     swish. No pitched note on purpose — this fires on most landings in a
     run, and a flat held tone reads as an error beep. Chosen by ear from a
     blind six-way audition (Maor, 2026-08-02).

     The body tracks the World's tap so each World keeps its own weight;
     the ratios reproduce 150 -> 78 Hz at classic's tap of 440, which is
     the sound that was approved. */
  function playSliced(t) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(sound.tap * 0.34, t);
    o.frequency.exponentialRampToValueAtTime(sound.tap * 0.177, t + 0.09);
    o.connect(envGain(t, 0.34, 0.11));
    o.start(t);
    o.stop(t + 0.16);
    var src = ctx.createBufferSource();
    src.buffer = noise();
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(220, t + 0.10);
    bp.Q.value = 0.7;
    src.connect(bp);
    bp.connect(envGain(t, 0.10, 0.10));
    src.start(t);
    src.stop(t + 0.12);
  }
```

- [ ] **Step 4: Add the Bobo voice**

In `audio.js`, add one line to `WORLD_SOUND`, after the `obsidian` entry (mind the comma on the line above):

```js
    obsidian: { base: 349.23, tap: 311, ladder: [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17] },
    bobo:     { base: 415.30, tap: 349, ladder: [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17] }
```

- [ ] **Step 5: Run the test again**

Run: `node reference/tests/pw-sliced-voice.js`

Expected: `PASS: the sliced voice runs in every World`, all seven Worlds with `moved: 1` and `last: "sliced"`.

- [ ] **Step 6: Commit**

```bash
git add audio.js
git commit -m "Sliced placement is a falling body, not a beep"
```

---

### Task 2: Per-World hueStep, and the Bobo palette

**Files:**
- Modify: `visuals.js` (`WORLD_STYLES` around line 74; `pickRunPalette` around line 227)
- Test: `reference/tests/pw-bobo-palette.js`

**Interfaces:**
- Consumes: `StackVisuals.getBlockColor(level, depth)`, already public, which reads `blockHSL` and therefore `S.hueStep`.
- Produces: `WORLD_STYLES` entries may now carry an optional `hueStep`. Absent means `CFG.hueStep` (3.8), which is what all six existing Worlds do.

**The problem this solves:** `blockHSL` advances the block hue by `S.hueStep` per level, and `pickRunPalette` derives that from a single global `CFG.hueStep` of 3.8. Over 45 blocks that is 171 degrees of drift before the per-run 0.85-1.35 randomisation. Classic absorbs it because its `families` span 148 to 312. A brown World cannot: starting at hue 24 it is green by block 20 and blue by block 45.

**Do not touch line 121 (`hueStep: CFG.hueStep` in the `S` literal).** That is a pre-init default which `pickRunPalette` overwrites at every run start and on every `hud:world` equip. Changing it would be a second source of truth.

- [ ] **Step 1: Write the failing test**

Create `reference/tests/pw-bobo-palette.js`:

```js
/* hueStep per World. pickRunPalette randomises the START hue (from families)
   and the SIGN and magnitude of the step (0.85 to 1.35 of the base), so no
   absolute colour is assertable. The DRIFT MAGNITUDE over a fixed span is,
   and the two bands do not overlap:
     base 3.8 over 20 levels -> 64.6 to 102.6 degrees
     base 0.4 over 20 levels ->  6.8 to  10.8 degrees
   Sampling 20 levels keeps every value under 180, so shortest-arc distance
   is unambiguous. */
const { chromium, devices } = require('playwright');
const URL = 'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const OLD = ['classic', 'sunset', 'neon', 'deepsea', 'marble', 'obsidian'];
const fails = [];
const SAMPLES = 6;   /* each equip re-randomises; sample several */

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));

  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await page.waitForTimeout(600);

  const drifts = await page.evaluate((n) => {
    function hueOf(hex) {
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      if (d === 0) { return 0; }
      let h;
      if (mx === r) { h = ((g - b) / d) % 6; }
      else if (mx === g) { h = (b - r) / d + 2; }
      else { h = (r - g) / d + 4; }
      h *= 60;
      return (h % 360 + 360) % 360;
    }
    function arc(a, b) { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; }
    const out = {};
    const ids = ['classic', 'sunset', 'neon', 'deepsea', 'marble', 'obsidian', 'bobo'];
    for (const id of ids) {
      out[id] = [];
      for (let i = 0; i < n; i++) {
        window.dispatchEvent(new CustomEvent('hud:world', { detail: { id: id } }));
        out[id].push(arc(hueOf(window.StackVisuals.getBlockColor(0, 0)),
                         hueOf(window.StackVisuals.getBlockColor(20, 0))));
      }
    }
    return out;
  }, SAMPLES);

  for (const id of OLD) {
    const bad = drifts[id].filter(d => d < 64 || d > 103);
    console.log('OBS ' + id + ' ' + JSON.stringify(drifts[id].map(d => d.toFixed(1))));
    if (bad.length) {
      fails.push(id + ': drift left the untouched band 64-103, saw ' + JSON.stringify(bad));
    }
  }
  console.log('OBS bobo ' + JSON.stringify(drifts.bobo.map(d => d.toFixed(1))));
  const boboBad = drifts.bobo.filter(d => d < 6 || d > 11);
  if (boboBad.length) {
    fails.push('bobo: drift outside 6-11 degrees over 20 levels, saw ' + JSON.stringify(boboBad));
  }

  if (errs.length) { fails.push('errors: ' + JSON.stringify(errs)); }
  await browser.close();
  if (fails.length) { console.log('FAIL ' + JSON.stringify(fails, null, 1)); process.exit(1); }
  console.log('PASS: bobo walks slowly, the other six are untouched');
})();
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node reference/tests/pw-bobo-palette.js`

Expected: FAIL on bobo only. Its `hud:world` falls back to `WORLD_STYLES.classic`, so its drift lands in the 64-103 band instead of 6-11. The six existing Worlds must pass; if they do not, stop and report.

- [ ] **Step 3: Teach `pickRunPalette` the override**

In `visuals.js`, replace `pickRunPalette` (around line 227):

```js
  function pickRunPalette() {
    var fam = worldStyle.families;
    // Per-World hue walk. A World whose families sit in a narrow band (brown)
    // cannot absorb the global 3.8 per level: 45 blocks of it is 171 degrees,
    // which leaves brown entirely. Absent means the global value, which is
    // every World shipped before bobo.
    var step = worldStyle.hueStep != null ? worldStyle.hueStep : CFG.hueStep;
    S.hueStart = fam[Math.floor(Math.random() * fam.length)];
    S.hueStep = (Math.random() < 0.5 ? -1 : 1) * (step * (0.85 + Math.random() * 0.5));
  }
```

- [ ] **Step 4: Add the Bobo style**

In `visuals.js`, add to `WORLD_STYLES` after the `obsidian` entry (mind the comma):

```js
    obsidian: {
      families: [12, 22, 355],
      satBias: -0.10, lightBias: -0.26,
      sky: { base: 8, swing: 6, innerS: 0.35, innerLBias: -0.22,
             outerS: 0.45, outerL: 0.055, beamS: 0.55, beamL: 0.62 }
    },
    bobo: {
      families: [24, 30, 18, 36, 12],
      hueStep: 0.4,     // the only World with an override; see pickRunPalette
      satBias: -0.22, lightBias: -0.10,
      sky: { base: 28, swing: 5, innerS: 0.42, innerLBias: -0.24,
             outerS: 0.50, outerL: 0.08, beamS: 0.40, beamL: 0.72 }
    }
```

- [ ] **Step 5: Run the test again**

Run: `node reference/tests/pw-bobo-palette.js`

Expected: `PASS: bobo walks slowly, the other six are untouched`.

- [ ] **Step 6: Commit**

```bash
git add visuals.js
git commit -m "Worlds may set their own hue walk; add the Bobo palette"
```

---

### Task 3: The catalog entry, the quips, and the hidden card

**Files:**
- Modify: `hud.js` (`WORLDS` around line 65; `WORLD_QUIPS` around line 879; `renderShopPane` around line 1557)
- Modify: `hud.css` (add one rule near the `.hud-shop-card` block)
- Test: `reference/tests/pw-bobo-card.js`

**Interfaces:**
- Consumes: `ownsWorld(id)`, `readOwned()`, both existing.
- Produces: `WORLDS` entries may now carry `secret: true`. Task 4 reads the same flag in the click handler.

**Card art is sampled by depth, not by hue.** The other six cards take three points of their World's hue ladder. Bobo's hue barely moves by design, so hue sampling returns `#a37649`, `#a5724a`, `#a7704b`: the same colour three times. The values below are sampled at depths 0, 6 and 13 at level 0, which is the light-to-dark falloff a real tower shows. Narrow bright rung on top, matching `blocks[0]` getting the smallest width in `buildDom`.

- [ ] **Step 1: Write the failing test**

Create `reference/tests/pw-bobo-card.js`:

```js
/* The Bobo card exists in the grid from boot but must not be VISIBLE until
   it is owned. Asserted on computed display, never on el.hidden: an author
   `display` beats the UA [hidden] rule, and this codebase has shipped that
   bug twice (.hud-lb-list, .hud-rec-row). */
const { chromium, devices } = require('playwright');
const URL = 'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const fails = [];

async function shop(browser, seed) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await context.route('**/rest/v1/stack_scores*', r => r.abort());
  await context.addInitScript(s => {
    try { Object.keys(s).forEach(k => localStorage.setItem(k, s[k])); } catch (e) {}
  }, seed);

  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await page.waitForTimeout(700);
  await page.click('.hud-board-btn');
  await page.waitForTimeout(300);
  await page.click('.hud-lb-tab[data-pane="shop"]');
  await page.waitForTimeout(300);

  const seen = await page.evaluate(() => {
    const card = document.querySelector('.hud-shop-card[data-world="bobo"]');
    const cards = [...document.querySelectorAll('.hud-shop-card')];
    return {
      exists: !!card,
      display: card ? getComputedStyle(card).display : null,
      chip: card ? card.querySelector('.hud-shop-chip').textContent : null,
      visibleCount: cards.filter(c => getComputedStyle(c).display !== 'none').length,
      totalCount: cards.length
    };
  });
  if (errs.length) { fails.push('errors: ' + JSON.stringify(errs)); }
  await context.close();
  return seen;
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  /* A — never earned: built, but not on screen */
  let r = await shop(browser, { 'stack-points': '99999' });
  console.log('OBS A unowned ' + JSON.stringify(r));
  if (!r.exists) { fails.push('A: the bobo card was never built'); }
  if (r.display !== 'none') {
    fails.push('A: bobo card is visible while unowned, display=' + r.display);
  }
  if (r.totalCount !== 7) { fails.push('A: expected 7 cards built, saw ' + r.totalCount); }
  if (r.visibleCount !== 6) { fails.push('A: expected 6 visible, saw ' + r.visibleCount); }

  /* B — earned: on screen, and never showing a price */
  r = await shop(browser, { 'stack-points': '99999', 'stack-worlds': JSON.stringify(['bobo']) });
  console.log('OBS B owned ' + JSON.stringify(r));
  if (r.display === 'none') { fails.push('B: bobo stayed hidden after being owned'); }
  if (r.chip !== 'OWNED') { fails.push('B: chip read ' + JSON.stringify(r.chip) + ', wanted OWNED'); }
  if (r.visibleCount !== 7) { fails.push('B: expected 7 visible, saw ' + r.visibleCount); }

  /* C — equipped: ON, still visible */
  r = await shop(browser, { 'stack-points': '99999',
    'stack-worlds': JSON.stringify(['bobo']), 'stack-world': 'bobo' });
  console.log('OBS C equipped ' + JSON.stringify(r));
  if (r.chip !== 'ON') { fails.push('C: chip read ' + JSON.stringify(r.chip) + ', wanted ON'); }
  if (r.display === 'none') { fails.push('C: the equipped World is hidden'); }

  await browser.close();
  if (fails.length) { console.log('FAIL ' + JSON.stringify(fails, null, 1)); process.exit(1); }
  console.log('PASS: bobo is built always, shown only once earned');
})();
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node reference/tests/pw-bobo-card.js`

Expected: FAIL on A with `the bobo card was never built`, plus the count assertions.

- [ ] **Step 3: Add the catalog entry**

In `hud.js`, append to `WORLDS` after the `obsidian` entry (mind the comma):

```js
    { id: 'obsidian', name: 'OBSIDIAN', price: 0,    giftAt: 250,
      sky: 'radial-gradient(120% 100% at 50% 26%,#884842 0%,#150d08 78%)',
      blocks: ['#5d7d29', '#756b27', '#784528'] },
    /* Bobo is neither bought nor a tier gift: it is a booby prize for dying
       at 0, so it carries `secret` and stays off the shelf until earned.
       price 0 is NOT what makes it unbuyable — the buy path tests
       bal < price, which is false at zero. The guard is `secret`; price 0
       only keeps a price string from ever rendering.
       Card art is sampled at depths 0/6/13 rather than three hue rungs:
       hueStep 0.4 means a hue sample returns the same brown three times. */
    { id: 'bobo',     name: 'BOBO',     price: 0,    giftAt: 0, secret: true,
      sky: 'radial-gradient(120% 100% at 50% 26%,#885737 0%,#1f180a 78%)',
      blocks: ['#a7704b', '#90542b', '#82471f'] }
```

- [ ] **Step 4: Add the quip pack**

In `hud.js`, add to `WORLD_QUIPS` after the `obsidian` array (mind the comma). Deadpan, not scatological: the World is called Bobo and the copy does not need to press the point.

```js
    bobo: [
      'Well. That happened.',
      'Down the drain, as ever.',
      'Nothing about that was solid.',
      'A brown day for architecture.',
      'It went the way these things go.',
      'The tower had one job.',
      'Gravity remains undefeated.',
      'Back to the bottom with you.'
    ]
```

- [ ] **Step 5: Hide secret cards in `renderShopPane`**

In `hud.js`, inside the `renderShopPane` loop, add the visibility line immediately after `c.card.className = cls;`:

```js
      c.card.className = cls;
      /* Secret Worlds are absent from the shelf until earned. Set on every
         card, not only the secret one, so a card can never stay hidden
         after its grant. */
      c.card.hidden = !!(w.secret && !ownsWorld(w.id));
      c.chip.textContent = chip;
```

- [ ] **Step 6: Add the CSS rule**

In `hud.css`, immediately after the `.hud-shop-card { ... }` block, add:

```css
/* .hud-shop-card sets its own display, and an author display beats the UA
   [hidden] rule, so the property alone would do nothing. */
.hud-shop-card[hidden] { display: none; }
```

- [ ] **Step 7: Run the test again**

Run: `node reference/tests/pw-bobo-card.js`

Expected: `PASS: bobo is built always, shown only once earned`.

- [ ] **Step 8: Prove the CSS rule is load-bearing**

Temporarily comment out the `.hud-shop-card[hidden]` rule, re-run the test, and confirm case A fails with a display that is not `none`. Restore the rule and confirm the test passes again. Record both outputs in the task report. A rule nobody proved is a rule nobody knows works.

- [ ] **Step 9: Commit**

```bash
git add hud.js hud.css
git commit -m "Bobo joins the catalog, off the shelf until earned"
```

---

### Task 4: The booby prize, the toast, and the purchase guard

**Files:**
- Modify: `hud.js` (`applyOver` around line 1831; the shop grid click handler around line 2017)
- Test: `reference/tests/pw-bobo-grant.js`

**Interfaces:**
- Consumes: `grantWorld(id)` (returns true only when the grant is new), `showToast(text)`, `ownsWorld(id)`, `finalScore` inside `applyOver`, and the `secret` flag added in Task 3.
- Produces: nothing new.

**Two separate concerns, do not conflate them.** Task 3 hid the card, which is presentation. A hidden element is still in the DOM, still focusable, and `keepKeysLocal` is wired to every card, so the buy path stays reachable. Bobo has `giftAt: 0` and `price: 0`, so it passes the existing `w.giftAt > 0` test and the `bal < w.price` test (`bal < 0` is false for every balance including zero), arms on the first tap and grants itself free on the second. The handler needs its own line.

- [ ] **Step 1: Write the failing test**

Create `reference/tests/pw-bobo-grant.js`:

```js
/* The booby prize: first score-0 death grants Bobo, in either mode, once,
   with a toast, without equipping it, and it can never be bought.
   Every POST is intercepted; nothing reaches the real leaderboard. */
const { chromium, devices } = require('playwright');
const URL = 'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html?debug=1';
const fails = [];

async function open(browser, seed) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  await context.route('**/rest/v1/stack_scores*', r => r.abort());
  await context.addInitScript(s => {
    try { Object.keys(s).forEach(k => localStorage.setItem(k, s[k])); } catch (e) {}
  }, seed || {});
  await page.goto(URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await page.waitForTimeout(700);
  return { context, page, errs };
}

/* Build to `score`, then force a miss. score 0 = miss the very first block. */
async function die(page, score) {
  await page.evaluate(n => {
    window.StackCore.debug.reset();
    if (n > 0) { window.StackCore.debug.build(n, 0); }
    window.StackCore.debug.drop(9);
  }, score);
  await page.waitForSelector('#hud-root[data-state="over"]', { timeout: 8000 });
  await page.waitForTimeout(300);
}

function state(page) {
  return page.evaluate(() => ({
    owned: localStorage.getItem('stack-worlds') || '',
    score: document.querySelector('.hud-over-score')
      ? document.querySelector('.hud-over-score').textContent : '?',
    world: localStorage.getItem('stack-world') || '',
    pts: localStorage.getItem('stack-points') || '0',
    toast: document.querySelector('.hud-toast').textContent,
    toastOn: document.querySelector('.hud-toast').classList.contains('is-on')
  }));
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  /* A — the grant itself */
  let s = await open(browser);
  await die(s.page, 0);
  let r = await state(s.page);
  console.log('OBS A ' + JSON.stringify(r));
  /* Prove the setup before trusting the result: if debug.drop(9) on a fresh
     reset does not actually land on 0, every assertion below is vacuous. */
  if (r.score !== '0') { fails.push('A: the forced first-block miss scored ' + r.score + ', not 0'); }
  if (r.owned.indexOf('bobo') < 0) { fails.push('A: a score-0 death granted nothing: ' + r.owned); }
  if (!r.toastOn || r.toast !== '\u25B2 BOBO \u00B7 WORLD UNLOCKED') {
    fails.push('A: toast was ' + JSON.stringify(r.toast) + ' on=' + r.toastOn);
  }
  if (r.world === 'bobo') { fails.push('A: the grant equipped Bobo; gifts never equip'); }
  if (s.errs.length) { fails.push('A errors: ' + JSON.stringify(s.errs)); }
  await s.context.close();

  /* B — granted once, and a second score-0 death says nothing */
  s = await open(browser, { 'stack-worlds': JSON.stringify(['bobo']) });
  await die(s.page, 0);
  r = await state(s.page);
  console.log('OBS B ' + JSON.stringify(r));
  if (r.toastOn) { fails.push('B: a re-grant toasted again: ' + r.toast); }
  if (r.owned !== JSON.stringify(['bobo'])) {
    fails.push('B: owned list changed on a second score-0 death: ' + r.owned);
  }
  await s.context.close();

  /* C — Hard counts too */
  s = await open(browser, { 'stack-best': '9999', 'stack-mode': 'hard' });
  await die(s.page, 0);
  r = await state(s.page);
  console.log('OBS C hard ' + JSON.stringify(r));
  if (r.owned.indexOf('bobo') < 0) { fails.push('C: a score-0 Hard death granted nothing'); }
  await s.context.close();

  /* D — a scoring death grants nothing */
  s = await open(browser);
  await die(s.page, 5);
  r = await state(s.page);
  console.log('OBS D ' + JSON.stringify(r));
  if (r.score !== '5') { fails.push('D: wanted a death at 5, the screen read ' + r.score); }
  if (r.owned.indexOf('bobo') >= 0) { fails.push('D: a score-5 death granted Bobo'); }
  await s.context.close();

  /* E — never purchasable. The card is hidden, but hidden is not a guard:
     it is in the DOM and focusable, so drive the handler directly. */
  s = await open(browser, { 'stack-points': '99999' });
  await s.page.click('.hud-board-btn');
  await s.page.waitForTimeout(250);
  await s.page.click('.hud-lb-tab[data-pane="shop"]');
  await s.page.waitForTimeout(250);
  await s.page.evaluate(() => {
    const c = document.querySelector('.hud-shop-card[data-world="bobo"]');
    c.click(); c.click();          /* two taps = the buy sequence */
  });
  await s.page.waitForTimeout(250);
  r = await state(s.page);
  console.log('OBS E click ' + JSON.stringify(r));
  if (r.owned.indexOf('bobo') >= 0) { fails.push('E: two taps bought the secret World'); }
  if (r.pts !== '99999') { fails.push('E: the balance moved: ' + r.pts); }
  if (r.world === 'bobo') { fails.push('E: the secret World got equipped by tapping'); }

  /* E2 — same via keyboard, since keepKeysLocal is wired to every card */
  await s.page.evaluate(() => {
    const c = document.querySelector('.hud-shop-card[data-world="bobo"]');
    c.focus();
    for (let i = 0; i < 2; i++) {
      c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      c.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
    }
  });
  await s.page.waitForTimeout(250);
  r = await state(s.page);
  console.log('OBS E2 keyboard ' + JSON.stringify(r));
  if (r.owned.indexOf('bobo') >= 0) { fails.push('E2: the keyboard path bought the secret World'); }
  if (s.errs.length) { fails.push('E errors: ' + JSON.stringify(s.errs)); }
  await s.context.close();

  await browser.close();
  if (fails.length) { console.log('FAIL ' + JSON.stringify(fails, null, 1)); process.exit(1); }
  console.log('PASS: earned by dying at zero, never bought');
})();
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node reference/tests/pw-bobo-grant.js`

Expected: FAIL on A (nothing granted, no toast) and on E (two taps bought it for free, balance unchanged only because the price is 0 but `owned` now contains bobo). Case E failing is the proof that hiding the card was never a guard.

- [ ] **Step 3: Grant the prize in `applyOver`**

In `hud.js`, inside `applyOver`, immediately after `var finalScore = state.score;`:

```js
    var finalScore = state.score;
    /* Bobo, the booby prize: the first score-0 death in either mode.
       grantWorld returns true only when the grant is new, so the toast
       cannot repeat. Never equips, same as the tier gifts — dropping a
       brown World on someone the instant they fumble block one would be a
       punishment. Hard counts: this is a joke, not an achievement, so a
       mode gate would be a rule with no payoff (Maor, 2026-08-02). */
    if (finalScore === 0 && grantWorld('bobo')) {
      showToast('\u25B2 BOBO \u00B7 WORLD UNLOCKED');
    }
```

Write the toast string with the literal characters `▲ BOBO · WORLD UNLOCKED` if the file's existing toasts use literals (they do: see the MARBLE toast). The escaped form above is shown so the exact code points are unambiguous.

- [ ] **Step 4: Guard the buy path**

In `hud.js`, in the shop grid click handler, add the secret test immediately after the `ownsWorld(id)` equip branch and before the gift test:

```js
      if (ownsWorld(id)) {                            /* owned: equip */
        disarmShop(false);
        equipWorld(id);
        renderShopPane();
        return;
      }
      /* Secret Worlds are earned, never bought. Unconditional on the flag:
         an owned World has already returned above, so anything reaching
         here is unowned. Hiding the card is presentation — it stays in the
         DOM and focusable, and price 0 would otherwise pass `bal < price`
         and hand it over free on the second tap. */
      if (w.secret) { disarmShop(true); return; }
      if (w.giftAt > 0) { disarmShop(true); return; } /* locked gift */
```

- [ ] **Step 5: Run the test again**

Run: `node reference/tests/pw-bobo-grant.js`

Expected: `PASS: earned by dying at zero, never bought`.

- [ ] **Step 6: Commit**

```bash
git add hud.js
git commit -m "Bobo is the prize for failing at block one"
```

---

### Task 5: Reconcile the suites, rebuild offline, deploy, verify live

**Files:**
- Modify: any existing suite in `reference/tests/` that counts shop cards or asserts grid contents
- Modify: `Stack.html` (generated)
- Test: the whole suite directory

- [ ] **Step 1: Inventory the suites**

```bash
ls reference/tests/pw-*.js
```

Read each one and list which assert on the shop grid, the card count, the World catalog length, or the audio voices. Those are the reconciliation candidates. Record the list in the task report before changing anything.

- [ ] **Step 2: Run every suite and record the honest result**

Run each `node reference/tests/<file>.js` in turn. Record pass/fail per suite verbatim.

**A suite that has not been run since the markup changed is not evidence.** Five suites were silently broken at the start of Hard mode by earlier commits, and the ledger's "12 suites green" claim for that wave did not hold. If a suite fails for a reason this plan did not cause, say so plainly in the report rather than fixing it quietly or leaving it out.

- [ ] **Step 3: Reconcile only what this wave broke**

For each failing suite, decide and record which it is:
1. Broken by this wave (a card count went 6 to 7, a voice list grew): update the expectation.
2. Broken before this wave: report it, do not fix it here.

- [ ] **Step 4: Re-run everything until green or honestly reported**

Run all suites again. The report must carry the full list with a verdict per suite.

- [ ] **Step 5: Rebuild the offline build**

```bash
node scripts/build-offline.mjs
```

This needs network once for the pinned Three.js fetch.

- [ ] **Step 6: Verify the offline build carries the change**

```bash
grep -c "sound.tap \* 0.34" Stack.html
grep -c "bobo" Stack.html
```

Expected: 1 and at least 4 (audio voice, visuals style, hud catalog, quips).

- [ ] **Step 7: Commit and deploy**

```bash
git add reference Stack.html
git commit -m "Reconcile suites and rebuild the offline build for Bobo"
git push origin main
```

- [ ] **Step 8: Verify the deploy reached production**

`gh api repos/Maores/stack-tower/pages/builds/latest` reports the previous commit as "built" long after the new one is serving. Ground truth is both of:

```bash
gh run list --workflow "pages build and deployment" --limit 3
curl -s "https://maores.github.io/stack-tower/hud.js?cb=$(git rev-parse --short HEAD)" | grep -c "bobo"
```

The Actions run must be `success` for the exact SHA, and the cache-busted fetch must show the new content.

- [ ] **Step 9: Verify live behaviour, twice**

Run `pw-bobo-grant.js` and `pw-sliced-voice.js` against `https://maores.github.io/stack-tower/?debug=1`, twice. Timing-sensitive behaviour in this project only ever reproduced on production network loads, never on `file://`.

- [ ] **Step 10: Report the phone-speaker check as OPEN**

The spec names one thing no automated test can settle: candidate B's body sits between 55 and 168 Hz depending on the World, and phone speakers roll off hard below roughly 200 Hz. The audition ran on a desktop.

Do not attempt to resolve this. Report it to the controller as an open item for Maor's ear on his own iPhone, naming Obsidian (106 to 55 Hz) as the worst case. If it proves inaudible the fix is one constant, raising both ratios to about 0.50 and 0.26, which keeps the falling-body character that won the audition.

---

## Self-review notes

- **Spec coverage.** Sound rewrite: Task 1. Per-World `hueStep` and the Bobo palette: Task 2. Catalog entry, card art, quips, hidden card, CSS rule: Task 3. Grant, toast, either-mode rule, no-equip rule, purchase guard: Task 4. Suite reconciliation, offline rebuild, deploy, live verification, phone-speaker check: Task 5. No spec section is unclaimed.
- **The two hazards this codebase repeats** both appear as explicit steps rather than advice: the `[hidden]` rule is proven load-bearing by removing it (Task 3 Step 8), and the purchase guard is proven necessary by watching case E fail first (Task 4 Step 2).
- **Task 1's test asserts a counter, not a sound.** That is deliberate and its reason is written into the test file: `dbg.played++` runs after `fn()` inside a `try`, so a throw inside `playSliced` is otherwise completely silent. Whether the sound is *good* was settled by ear before this plan existed, and the one remaining audio risk is routed to Maor in Task 5 Step 10 rather than being asserted.
