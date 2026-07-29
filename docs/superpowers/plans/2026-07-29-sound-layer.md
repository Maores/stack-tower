# Sound Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the approved glassy-minimal WebAudio sound layer (spec: `docs/superpowers/specs/2026-07-29-sound-haptics-design.md`) to stack-tower: a new `audio.js` domain, a HUD mute toggle, an offline build script, verified by emulated-phone Playwright runs locally and live.

**Architecture:** `audio.js` is a fourth ES5 IIFE domain file consuming only existing window CustomEvents (`stack:placed`, `game:start`, `game:over`, plus the new `hud:mute`). The HUD owns the mute button DOM and localStorage persistence. Nothing in core.js or visuals.js changes.

**Tech Stack:** Vanilla ES5 browser JS, WebAudio API, Node 18+ (build script only, zero npm dependencies), Playwright via the playwright-skill executor.

## Global Constraints

- Game files are ES5 IIFE style: `var`, defensive try/catch, no arrow functions, no template literals (match core.js/hud.js).
- Cross-domain coupling through window CustomEvents only; never call into another file's internals.
- The one shared constant is the localStorage key `stack-muted` (`'1'` muted, `'0'` or absent = sound on), documented in both hud.js and audio.js.
- No audio assets, no npm dependencies, no new network requests at play time.
- `textContent` only for user data in the HUD; static SVG via innerHTML is the existing accepted pattern.
- Game UI text stays English.
- Playwright test scripts live in the session scratchpad directory (from the system prompt), never committed to the repo.
- Tests must not insert leaderboard rows; if one slips in, delete it: `delete from public.stack_scores where name in ('<test names>');`
- Playwright executor (path stable until the plugin updates): `cd "C:\Users\maor4\.claude\plugins\cache\playwright-skill\playwright-skill\4.1.0\skills\playwright-skill" && node run.js "<script path>"`
- Local page URL: `file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html`. Live URL: `https://maores.github.io/stack-tower/`.

---

### Task 1: audio.js domain + index.html wiring

**Files:**
- Create: `audio.js`
- Modify: `index.html:36` (add script tag after hud.js)
- Test: `<scratchpad>/pw-audio.js` (scratchpad, not committed)

**Interfaces:**
- Consumes: CustomEvents `stack:placed` `{ perfect }` (core.js:390, core.js:411), `game:start` (core.js:424), `game:over` (core.js:440), `hud:mute` `{ muted }` (arrives in Task 2); `StackCore.debug.drop(offset)` for test drops.
- Produces: `window.StackAudio = { version: '1.0.0', isReady(), muted, setMuted(bool), debug: { played, last, state() } }`. Task 2's button relies on audio.js reacting to `hud:mute`; Tasks 3-4 rely on the whole API for smoke checks.

- [ ] **Step 1: Write the failing Playwright test**

Write `<scratchpad>/pw-audio.js`:

```javascript
/* Task 1 test: audio.js API + sounds fire on game events. No score saves. */
const { chromium, devices } = require('playwright');

const TARGET_URL = process.env.STACK_URL ||
  'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const issues = [];
  page.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));

  await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });

  const before = await page.evaluate(() => ({
    defined: !!window.StackAudio,
    ready: window.StackAudio ? window.StackAudio.isReady() : null
  }));
  if (!before.defined) throw new Error('FAIL: StackAudio undefined');
  if (before.ready !== false) throw new Error('FAIL: context must not exist before first gesture');

  await page.touchscreen.tap(195, 500); // gesture: starts game, unlocks audio
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({
    ready: window.StackAudio.isReady(),
    state: window.StackAudio.debug.state()
  }));
  if (!after.ready || after.state !== 'running')
    throw new Error('FAIL: context not running after gesture: ' + JSON.stringify(after));

  // deterministic drops: sliced, 3 perfects, miss
  const counts = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    const out = [];
    await wait(400);
    window.StackCore.debug.drop(0.5);  out.push([window.StackAudio.debug.played, window.StackAudio.debug.last]);
    await wait(150);
    window.StackCore.debug.drop(0);   out.push([window.StackAudio.debug.played, window.StackAudio.debug.last]);
    await wait(150);
    window.StackCore.debug.drop(0);
    window.StackCore.debug.drop(0);   out.push([window.StackAudio.debug.played, window.StackAudio.debug.last]);
    await wait(150);
    window.StackCore.debug.drop(6);   out.push([window.StackAudio.debug.played, window.StackAudio.debug.last]);
    return out;
  });
  const expect = [[1, 'sliced'], [2, 'perfect'], [4, 'perfect'], [5, 'gameover']];
  for (let i = 0; i < expect.length; i++) {
    if (counts[i][0] !== expect[i][0] || counts[i][1] !== expect[i][1])
      throw new Error('FAIL: sound sequence ' + JSON.stringify(counts) + ' wanted ' + JSON.stringify(expect));
  }
  if (issues.length) throw new Error('FAIL: page issues: ' + issues.join(' | '));
  console.log('PASS: audio API, unlock, and event sounds all good');
  await browser.close();
})();
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd "C:\Users\maor4\.claude\plugins\cache\playwright-skill\playwright-skill\4.1.0\skills\playwright-skill" && node run.js "<scratchpad>/pw-audio.js"`
Expected: `FAIL: StackAudio undefined`

- [ ] **Step 3: Create audio.js**

Full file content:

```javascript
/* ==========================================================================
   audio.js — Stack tower sound layer (glassy minimal, WebAudio, no assets).

   Consumes existing DOM CustomEvents only; never reaches into another
   file's internals:
     'stack:placed' { perfect }   placement sound + streak tracking
     'game:start'                 streak reset
     'game:over'                  game-over sound
     'hud:mute'    { muted }      mute state pushed by the HUD button

   Shared constant with hud.js: localStorage 'stack-muted' ('1' | '0',
   absent = sound on). hud.js owns the button and persistence; this file
   reads the key once at boot and then follows 'hud:mute' events.

   Public API (window.StackAudio):
     version                   '1.0.0'
     isReady()                 AudioContext exists (created on first gesture)
     muted                     live boolean
     setMuted(m)               runtime mute; persistence stays with the HUD
     debug: { played, last, state() }   scheduled-voice counter, last voice
                               name, and context state, for tests
   ========================================================================== */
(function () {
  'use strict';

  if (window.StackAudio) { return; }

  var MUTE_KEY = 'stack-muted';   /* shared with hud.js */
  var MASTER_GAIN = 0.5;
  /* Major pentatonic from C5, two octaves of semitone offsets; the streak
     indexes into this ladder and holds at the top (spec: 10-step cap). */
  var LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  var BASE_HZ = 523.25;

  var ctx = null, master = null, noiseBuf = null;
  var streak = 0;
  var muted = false;
  var dbg = { played: 0, last: '' };
  dbg.state = function () { return ctx ? ctx.state : 'none'; };

  try { muted = window.localStorage.getItem(MUTE_KEY) === '1'; }
  catch (err) { muted = false; }

  /* ---------------------------------------------------------- context */

  function ensureCtx() {
    if (ctx) { return true; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { return false; }
    try {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = MASTER_GAIN;
      var comp = ctx.createDynamicsCompressor();
      master.connect(comp);
      comp.connect(ctx.destination);
      if (muted) { try { ctx.suspend(); } catch (err) { /* ignore */ } }
      return true;
    } catch (err) {
      ctx = null; master = null;
      return false;
    }
  }

  /* Every gesture: cheap no-op once running. Creates the context lazily
     (autoplay policy) and re-resumes after iOS interruptions. */
  function wake() {
    if (!ensureCtx() || muted) { return; }
    if (ctx.state !== 'running') {
      try { ctx.resume(); } catch (err) { /* ignore */ }
    }
  }

  window.addEventListener('pointerdown', wake, true);
  window.addEventListener('keydown', wake, true);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { wake(); }
  });

  function setMuted(m) {
    muted = !!m;
    api.muted = muted;
    if (!ctx) { return; }
    try {
      if (muted) { ctx.suspend(); }
      else if (ctx.state !== 'running') { ctx.resume(); }
    } catch (err) { /* ignore */ }
  }

  /* ----------------------------------------------------------- voices */

  function noise() {
    if (noiseBuf) { return noiseBuf; }
    var len = Math.floor(ctx.sampleRate * 0.2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var data = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) { data[i] = Math.random() * 2 - 1; }
    return noiseBuf;
  }

  function envGain(t, peak, decay) {
    var g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    g.connect(master);
    return g;
  }

  function tone(t, type, freq, peak, decay) {
    var o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.connect(envGain(t, peak, decay));
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  /* Sliced placement: glass tap + the shaved piece's band-swept swish. */
  function playSliced(t) {
    tone(t, 'triangle', 440 + (Math.random() * 30 - 15), 0.35, 0.14);
    var src = ctx.createBufferSource();
    src.buffer = noise();
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1200, t);
    bp.frequency.exponentialRampToValueAtTime(400, t + 0.12);
    bp.Q.value = 1;
    src.connect(bp);
    bp.connect(envGain(t, 0.12, 0.12));
    src.start(t);
    src.stop(t + 0.14);
  }

  /* Perfect placement: chime stepping up the pentatonic ladder. */
  function playPerfect(t, step) {
    var f = BASE_HZ * Math.pow(2, LADDER[Math.min(step, LADDER.length - 1)] / 12);
    tone(t, 'sine', f, 0.45, 0.35);
    tone(t, 'sine', f * 2 * 1.003, 0.18, 0.35);   /* shimmer partial */
  }

  /* Game over: low felt thud, then a quiet two-note descending motif. */
  function playGameOver(t) {
    var o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.3);
    o.connect(envGain(t, 0.6, 0.5));
    o.start(t);
    o.stop(t + 0.55);
    tone(t + 0.25, 'triangle', 329.63, 0.2, 0.18);  /* E4 */
    tone(t + 0.45, 'triangle', 220.0, 0.2, 0.30);   /* A3 */
  }

  function voice(name, fn, arg) {
    if (muted || !ctx || ctx.state !== 'running') { return; }
    try {
      fn(ctx.currentTime, arg);
      dbg.played++;
      dbg.last = name;
    } catch (err) { /* audio must never break the game */ }
  }

  /* ----------------------------------------------------------- events */

  window.addEventListener('stack:placed', function (e) {
    var perfect = !!(e && e.detail && e.detail.perfect);
    if (perfect) {
      streak++;
      voice('perfect', playPerfect, streak - 1);
    } else {
      streak = 0;
      voice('sliced', playSliced);
    }
  });

  window.addEventListener('game:start', function () { streak = 0; });

  window.addEventListener('game:over', function () {
    streak = 0;
    voice('gameover', playGameOver);
  });

  window.addEventListener('hud:mute', function (e) {
    setMuted(!!(e && e.detail && e.detail.muted));
  });

  /* -------------------------------------------------------------- api */

  var api = {
    version: '1.0.0',
    isReady: function () { return !!ctx; },
    muted: muted,
    setMuted: setMuted,
    debug: dbg
  };

  window.StackAudio = api;
})();
```

- [ ] **Step 4: Add the script tag**

In `index.html`, after `<script src="hud.js"></script>` (line 36), add:

```html
<script src="audio.js"></script>
```

- [ ] **Step 5: Run the test to confirm it passes**

Same command as Step 2.
Expected: `PASS: audio API, unlock, and event sounds all good` and zero page issues.

- [ ] **Step 6: Commit**

```bash
git add audio.js index.html
git commit -m "Sound layer: glassy WebAudio SFX with perfect-streak pitch ladder"
```

---

### Task 2: HUD mute button

**Files:**
- Modify: `hud.js` (constants near line 43, buildDom near line 202, handlers, wireOutgoing near line 654, init near line 698)
- Modify: `hud.css` (new `.hud-mute-btn` block after the `.hud-board-btn` rules near line 517; extend the hide rule at lines 519-523)
- Test: `<scratchpad>/pw-mute.js` (scratchpad, not committed)

**Interfaces:**
- Consumes: `window.StackAudio.muted` and `debug.state()` (Task 1) in the test only; the production coupling is the `hud:mute` CustomEvent.
- Produces: `hud:mute` `{ muted: boolean }` dispatched on window; localStorage `stack-muted` writes; a `.hud-mute-btn` element with `aria-pressed` and an `is-muted` class.

- [ ] **Step 1: Write the failing Playwright test**

Write `<scratchpad>/pw-mute.js`:

```javascript
/* Task 2 test: mute button visibility, persistence, and audio coupling. */
const { chromium, devices } = require('playwright');

const TARGET_URL = process.env.STACK_URL ||
  'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const issues = [];
  page.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));

  await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });

  const onTitle = await page.evaluate(() => {
    const b = document.querySelector('.hud-mute-btn');
    return b ? {
      visible: getComputedStyle(b).opacity !== '0',
      pressed: b.getAttribute('aria-pressed'),
      label: b.getAttribute('aria-label')
    } : null;
  });
  if (!onTitle) throw new Error('FAIL: .hud-mute-btn missing');
  if (!onTitle.visible || onTitle.pressed !== 'false' || onTitle.label !== 'Mute sound')
    throw new Error('FAIL: title-state button wrong: ' + JSON.stringify(onTitle));

  // mute, then verify persistence + audio coupling
  await page.click('.hud-mute-btn');
  await page.waitForTimeout(400);
  const mutedState = await page.evaluate(() => ({
    stored: localStorage.getItem('stack-muted'),
    pressed: document.querySelector('.hud-mute-btn').getAttribute('aria-pressed'),
    slashed: document.querySelector('.hud-mute-btn').classList.contains('is-muted'),
    audioMuted: window.StackAudio.muted,
    ctxState: window.StackAudio.debug.state()
  }));
  if (mutedState.stored !== '1' || mutedState.pressed !== 'true' || !mutedState.slashed ||
      mutedState.audioMuted !== true || mutedState.ctxState === 'running')
    throw new Error('FAIL: muted state wrong: ' + JSON.stringify(mutedState));

  // muted playthrough: no voices scheduled
  await page.touchscreen.tap(195, 500);
  await page.waitForTimeout(500);
  const played = await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 400));
    window.StackCore.debug.drop(0.5);
    window.StackCore.debug.drop(6);
    return window.StackAudio.debug.played;
  });
  if (played !== 0) throw new Error('FAIL: voices played while muted: ' + played);

  // button must hide during play (fresh run) and reappear on game over
  await page.waitForSelector('#hud-root[data-state="over"]', { timeout: 5000 });
  await page.waitForTimeout(700);
  await page.touchscreen.tap(195, 160); // restart
  await page.waitForTimeout(600);
  const hiddenPlaying = await page.evaluate(() => {
    const b = document.querySelector('.hud-mute-btn');
    const s = getComputedStyle(b);
    return { state: document.querySelector('#hud-root').getAttribute('data-state'),
             opacity: s.opacity, pe: s.pointerEvents };
  });
  if (hiddenPlaying.state !== 'playing' || hiddenPlaying.opacity !== '0' || hiddenPlaying.pe !== 'none')
    throw new Error('FAIL: button not hidden during play: ' + JSON.stringify(hiddenPlaying));

  // unmute on the game-over screen; sounds come back
  await page.evaluate(() => window.StackCore.debug.drop(6));
  await page.waitForSelector('#hud-root[data-state="over"]', { timeout: 5000 });
  await page.waitForTimeout(700);
  await page.click('.hud-mute-btn');
  await page.waitForTimeout(400);
  const unmuted = await page.evaluate(() => ({
    stored: localStorage.getItem('stack-muted'),
    audioMuted: window.StackAudio.muted,
    ctxState: window.StackAudio.debug.state()
  }));
  if (unmuted.stored !== '0' || unmuted.audioMuted !== false || unmuted.ctxState !== 'running')
    throw new Error('FAIL: unmute wrong: ' + JSON.stringify(unmuted));

  if (issues.length) throw new Error('FAIL: page issues: ' + issues.join(' | '));
  console.log('PASS: mute button visibility, persistence, and coupling all good');
  await browser.close();
})();
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd "C:\Users\maor4\.claude\plugins\cache\playwright-skill\playwright-skill\4.1.0\skills\playwright-skill" && node run.js "<scratchpad>/pw-mute.js"`
Expected: `FAIL: .hud-mute-btn missing`

- [ ] **Step 3: hud.js changes**

3a. Next to `BEST_KEY` (line 43), add:

```javascript
  var MUTE_KEY = 'stack-muted';  /* shared with audio.js */
```

3b. In `buildDom`, after the `boardBtn` block ends (line 210, before `var board = ...`), add:

```javascript
    /* Mute toggle (title/over states only), state broadcast via hud:mute */
    var muteBtn = el('button', 'hud-mute-btn');
    muteBtn.type = 'button';
    muteBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M11 5 6.5 9H3v6h3.5L11 19V5z"/>' +
      '<path class="hud-mute-wave" d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/>' +
      '<path class="hud-mute-slash" d="M4 4l16 16"/></svg>';
```

3c. In the same function, append it to the root alongside the trophy (after `root.appendChild(boardBtn);`):

```javascript
    root.appendChild(muteBtn);
```

and add `muteBtn: muteBtn,` to the returned object (after `boardBtn: boardBtn,`).

3d. Below the leaderboard helpers (after `writeName`, line 407), add:

```javascript
  function readMuted() {
    try { return window.localStorage.getItem(MUTE_KEY) === '1'; }
    catch (err) { return false; }
  }

  function applyMuteUi(muted) {
    els.muteBtn.classList.toggle('is-muted', muted);
    els.muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    els.muteBtn.setAttribute('aria-label', muted ? 'Unmute sound' : 'Mute sound');
  }

  function toggleMute() {
    var muted = !readMuted();
    try { window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); }
    catch (err) { /* ignore */ }
    applyMuteUi(muted);
    try { window.dispatchEvent(new CustomEvent('hud:mute', { detail: { muted: muted } })); }
    catch (err) { /* ignore */ }
  }
```

3e. In `wireOutgoing` (after `els.boardClose.addEventListener('click', closeBoard);`, line 665), add:

```javascript
    els.muteBtn.addEventListener('click', toggleMute);
```

3f. In `init` (after `wireOutgoing();`, line 704), add:

```javascript
    applyMuteUi(readMuted());
```

- [ ] **Step 4: hud.css changes**

4a. After the `.hud-board-btn svg` rule (line 517), add:

```css
/* Mute toggle, mirroring the trophy button on the left edge */
.hud-mute-btn {
  position: fixed;
  top: max(2.2vh, env(safe-area-inset-top, 0px));
  left: max(2.2vh, env(safe-area-inset-left, 0px));
  z-index: 110;
  width: clamp(40px, 6.5vmin, 52px);
  height: clamp(40px, 6.5vmin, 52px);
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.65);
  background: rgba(255, 255, 255, 0.08);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  cursor: pointer;
  opacity: 0.8;
  box-shadow: 0 0 12px rgba(255, 255, 255, 0.18);
  transition: opacity 0.3s ease, transform 0.18s ease, background-color 0.18s ease;
}
.hud-mute-btn:hover {
  opacity: 1;
  background: rgba(255, 255, 255, 0.16);
}
.hud-mute-btn:active {
  transform: scale(0.92);
}
.hud-mute-btn:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 3px;
}
.hud-mute-btn svg {
  width: 52%;
  height: 52%;
  display: block;
}
.hud-mute-btn .hud-mute-slash {
  display: none;
}
.hud-mute-btn.is-muted .hud-mute-slash {
  display: block;
}
.hud-mute-btn.is-muted .hud-mute-wave {
  display: none;
}
```

4b. Extend the existing hide rule (lines 519-523) to cover the mute button:

```css
#hud-root[data-state="playing"] .hud-board-btn,
#hud-root[data-state="boot"] .hud-board-btn,
#hud-root[data-state="playing"] .hud-mute-btn,
#hud-root[data-state="boot"] .hud-mute-btn {
  opacity: 0;
  pointer-events: none;
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Same command as Step 2.
Expected: `PASS: mute button visibility, persistence, and coupling all good`

- [ ] **Step 6: Re-run the Task 1 test (regression)**

Run: `cd "C:\Users\maor4\.claude\plugins\cache\playwright-skill\playwright-skill\4.1.0\skills\playwright-skill" && node run.js "<scratchpad>/pw-audio.js"`
Expected: still `PASS`.

- [ ] **Step 7: Commit**

```bash
git add hud.js hud.css
git commit -m "HUD mute toggle, broadcast to the audio layer via hud:mute"
```

---

### Task 3: Offline build script + Stack.html rebuild

**Files:**
- Create: `scripts/build-offline.mjs`
- Modify: `Stack.html` (regenerated output)
- Test: `<scratchpad>/pw-offline.js` (scratchpad, not committed)

**Interfaces:**
- Consumes: `index.html`, `hud.css`, `core.js`, `visuals.js`, `hud.js`, `audio.js` from the repo root; the pinned Three.js CDN URL.
- Produces: `Stack.html`, self-contained. Later sessions rebuild with `node scripts/build-offline.mjs`.

- [ ] **Step 1: Create the build script**

Full content of `scripts/build-offline.mjs`:

```javascript
#!/usr/bin/env node
/* Builds Stack.html: index.html with hud.css, Three.js, and all game
   scripts inlined, so the game runs offline from a double-click.
   Usage: node scripts/build-offline.mjs
   Needs network once per run for the pinned Three.js fetch. */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js';

const read = (name) => readFile(path.join(root, name), 'utf8');
const [html, css, core, visuals, hud, audio] = await Promise.all([
  read('index.html'), read('hud.css'), read('core.js'),
  read('visuals.js'), read('hud.js'), read('audio.js')
]);

const resp = await fetch(THREE_URL);
if (!resp.ok) throw new Error('three.js fetch failed: ' + resp.status);
const three = await resp.text();

const inline = (js) => '<script>\n' + js + '\n</script>';

/* The data: stylesheet link satisfies hud.js ensureCss() so it never
   injects a dead hud.css link under file://. */
const out = html
  .replace(
    '<link rel="stylesheet" href="hud.css">',
    '<link rel="stylesheet" data-stack-hud href="data:text/css,">\n<style>\n' + css + '\n</style>'
  )
  .replace(
    /<script src="https:\/\/cdn\.jsdelivr\.net[^>]*><\/script>\s*\n<script>window\.THREE[^\n]*<\/script>/,
    inline(three)
  )
  .replace('<script src="core.js"></script>', inline(core))
  .replace('<script src="visuals.js"></script>', inline(visuals))
  .replace('<script src="hud.js"></script>', inline(hud))
  .replace('<script src="audio.js"></script>', inline(audio));

if (/<script src=/.test(out)) throw new Error('unreplaced <script src> remains');
if (/<link rel="stylesheet" href=/.test(out)) throw new Error('unreplaced stylesheet link remains');
await writeFile(path.join(root, 'Stack.html'), out);
console.log('Stack.html written: ' + out.length + ' bytes');
```

- [ ] **Step 2: Run the build**

Run: `node scripts/build-offline.mjs`
Expected: `Stack.html written: <about 1.3 MB> bytes` (Three.js r149 min is ~600KB; the old Stack.html is a size reference).

- [ ] **Step 3: Write the offline smoke test**

Write `<scratchpad>/pw-offline.js`:

```javascript
/* Task 3 test: rebuilt Stack.html boots standalone over file:// with audio. */
const { chromium, devices } = require('playwright');

const TARGET_URL = 'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/Stack.html';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ...devices['iPhone 13'], offline: true });
  const page = await context.newPage();
  const issues = [];
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));

  await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  await page.touchscreen.tap(195, 500);
  await page.waitForTimeout(600);
  const check = await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 400));
    window.StackCore.debug.drop(0);
    return {
      three: !!window.THREE,
      audioReady: window.StackAudio.isReady(),
      played: window.StackAudio.debug.played,
      muteBtn: !!document.querySelector('.hud-mute-btn')
    };
  });
  if (!check.three || !check.audioReady || check.played < 1 || !check.muteBtn)
    throw new Error('FAIL: offline bundle incomplete: ' + JSON.stringify(check));
  if (issues.length) throw new Error('FAIL: page issues: ' + issues.join(' | '));
  console.log('PASS: Stack.html standalone with sound (network disabled)');
  await browser.close();
})();
```

Note: the context is `offline: true`, which proves the bundle needs no network. The leaderboard will show its `THIS DEVICE ONLY` fallback; that is expected and correct offline behavior, not a failure.

- [ ] **Step 4: Run the smoke test**

Run: `cd "C:\Users\maor4\.claude\plugins\cache\playwright-skill\playwright-skill\4.1.0\skills\playwright-skill" && node run.js "<scratchpad>/pw-offline.js"`
Expected: `PASS: Stack.html standalone with sound (network disabled)`

- [ ] **Step 5: Commit**

```bash
git add scripts/build-offline.mjs Stack.html
git commit -m "Offline build script in-repo; rebuild Stack.html with the sound layer"
```

---

### Task 4: Full verification, deploy, live check, logs

**Files:**
- No repo files change (push only).
- Modify (outside repo): Obsidian vault `Projects/Orchestrated-build skill.md`, `Daily/2026-07-29.md`; memory `feature-roadmap.md` + `MEMORY.md` index.

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: the live deployment plus session logs. Nothing downstream.

- [ ] **Step 1: Full local pass**

Run both scratchpad tests once more against local `index.html` (default URL): `pw-audio.js`, then `pw-mute.js`.
Expected: both `PASS`, zero page issues. This is the spec's verification checklist items 1-4 in one sweep.

- [ ] **Step 2: Push to deploy**

```bash
git push origin main
```

GitHub Pages redeploys in about a minute.

- [ ] **Step 3: Live verification**

Wait ~90 seconds, then run both tests against the live site by setting the env var:
`$env:STACK_URL = 'https://maores.github.io/stack-tower/'` then the same two run commands, then `Remove-Item Env:STACK_URL`.
Expected: both `PASS`. Note: the live mute test persists `stack-muted` only inside the throwaway browser profile, so real players are untouched.

- [ ] **Step 4: Leaderboard hygiene check**

The tests never call the save flow. Confirm anyway with a read-only query (Supabase MCP): `select name, score, created_at from public.stack_scores order by created_at desc limit 5;` and verify no new rows appeared during the test window. If any test row exists, delete it per project rules.

- [ ] **Step 5: Manual listen**

Ask Maor to open the live site on his phone and listen to a run (placement taps, a perfect streak climbing the ladder, the game-over thud). Tuning tweaks to frequencies/gains happen here if anything sounds off; they are single-constant edits in `audio.js` followed by re-push and a Stack.html rebuild.

- [ ] **Step 6: Vault and memory logs**

Per the global vault rule: append the sound-layer line to the `## Current status` history in `Projects/Orchestrated-build skill.md`, add the daily-log line to `Daily/2026-07-29.md` (`- HH:MM — stack-tower: sound layer shipped ([[Orchestrated-build skill]])`), create memory `feature-roadmap.md` (agreed order with sound marked done) linked from `MEMORY.md`.

---

## Self-review notes

- Spec coverage: architecture and events (Task 1), context lifecycle (Task 1 code), all three sounds (Task 1 code), mute UX + accessibility (Task 2), platform notes need no code, verification checklist (Tasks 1-4), rollout items 1-5 (gitignore commit already landed pre-plan; Tasks 1-4 cover the rest).
- `debug.state()` is a small addition beyond the spec's `debug: { played, last }`; the spec's own verification section requires asserting context state, so the accessor is the minimal way to honor it.
- Type consistency: `hud:mute` detail shape `{ muted: boolean }` matches between hud.js (Task 2, 3d) and audio.js (Task 1); `stack-muted` key values `'1'`/`'0'` match; `.hud-mute-btn` class name matches across hud.js, hud.css, and both tests.
