# Debug-API Decoy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the real `StackCore.debug` behind `?debug=1` and serve console visitors a taunting decoy (spec: `docs/superpowers/specs/2026-07-30-debug-decoy-design.md`).

**Architecture:** core.js only; test scripts gain the flag; one new decoy suite.

**Tech Stack:** Vanilla ES5, Playwright.

## Global Constraints

- core.js is ES5 IIFE style: var, defensive try/catch, no arrow functions, no template literals.
- Game/console text stays English.
- Test scripts live in the session scratchpad, never committed. No test may insert real leaderboard rows (existing suites already comply; the decoy suite never reaches the save flow).
- Playwright executor: `cd "C:\Users\maor4\.claude\plugins\cache\playwright-skill\playwright-skill\4.1.0\skills\playwright-skill" && node run.js "<script path>"`
- Local page URL base: `file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html`. Live base: `https://maores.github.io/stack-tower/`.

---

### Task 1: Decoy in core.js + flagged test URLs

**Files:**
- Modify: `core.js` (api assembly area, version string)
- Modify (scratchpad, not committed): `pw-audio.js`, `pw-mute.js`, `pw-save.js`, `pw-offline.js` (TARGET_URL lines), new `pw-decoy.js`
- Regenerate: `Stack.html`

**Interfaces:**
- Consumes: existing `debug` object and `api` literal in core.js.
- Produces: `StackCore.debug` = real API only when `?debug=1`; decoy otherwise (same five method names, each returns `false` and logs a taunt).

- [ ] **Step 1: Write the failing decoy test**

Write `<scratchpad>/pw-decoy.js`:

```javascript
/* Decoy test: WITHOUT ?debug=1 the console API must taunt and do nothing. */
const { chromium, devices } = require('playwright');

const TARGET_URL = process.env.STACK_URL ||
  'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const logs = [];
  const issues = [];
  page.on('console', m => {
    if (m.type() === 'error') issues.push('console: ' + m.text());
    if (m.type() === 'log') logs.push(m.text());
  });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));

  await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });

  const r = await page.evaluate(() => {
    const a = window.StackCore.debug.build(5);
    const b = window.StackCore.debug.drop(0);
    return { a: a, b: b, score: window.getTowerState().score, phase: window.getTowerState().phase };
  });
  if (r.a !== false || r.b !== false) throw new Error('FAIL: decoy returned real values: ' + JSON.stringify(r));
  if (r.score !== 0 || r.phase !== 'ready') throw new Error('FAIL: decoy affected the game: ' + JSON.stringify(r));
  await page.waitForTimeout(300);
  if (!logs.some(l => l.indexOf('tower') >= 0 || l.indexOf('robot') >= 0 || l.indexOf('fingers') >= 0 || l.indexOf('patience') >= 0))
    throw new Error('FAIL: no taunt logged: ' + JSON.stringify(logs));
  if (issues.length) throw new Error('FAIL: page issues: ' + issues.join(' | '));
  console.log('PASS: decoy taunts and does nothing');
  await browser.close();
})();
```

- [ ] **Step 2: Run it to confirm it fails**

Run the executor on pw-decoy.js.
Expected: FAIL with "decoy returned real values" (today `build(5)` really builds).

- [ ] **Step 3: core.js changes**

3a. Immediately above the `var api = {` literal, add:

```javascript
  /* The real debug API drives the automated tests (deterministic drops).
     On a plain URL, console visitors get a decoy that only talks back; the
     real thing needs ?debug=1 (the test suites append it). The source is
     public, so this is a speed bump for lazy cheaters, not a lock. */
  var debugAllowed = false;
  try { debugAllowed = /[?&]debug=1/.test(window.location.search); }
  catch (err) { debugAllowed = false; }

  var TAUNTS = [
    'The tower remembers cheaters.',
    'Nice try. Stack it with your fingers.',
    'This path is for robots. You do not look like a robot.',
    'Imagine console-cheating a game about patience.'
  ];
  var tauntIdx = 0;

  function decoyCall() {
    var line = TAUNTS[tauntIdx % TAUNTS.length];
    tauntIdx++;
    try { console.log('%c' + line, 'font-weight:bold'); } catch (err) { /* ignore */ }
    return false;
  }

  var decoy = {
    drop: decoyCall,
    build: decoyCall,
    tap: decoyCall,
    fps: decoyCall,
    stats: decoyCall
  };
```

3b. In the `api` literal, change `debug: debug` to `debug: debugAllowed ? debug : decoy` and `version: '1.1.0'` to `version: '1.2.0'`.

- [ ] **Step 4: Flag the four existing test scripts**

In each of `pw-audio.js`, `pw-mute.js`, `pw-save.js` change the TARGET_URL assignment to append the flag:

```javascript
const TARGET_URL = (process.env.STACK_URL ||
  'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html') + '?debug=1';
```

In `pw-offline.js` change its constant to:

```javascript
const TARGET_URL = 'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/Stack.html?debug=1';
```

- [ ] **Step 5: GREEN + full regression + rebuild**

pw-decoy.js PASS (no flag). Then pw-audio.js, pw-mute.js, pw-save.js PASS (flagged). Then `node scripts/build-offline.mjs`, pw-offline.js PASS.

- [ ] **Step 6: Commit**

```bash
git add core.js Stack.html
git commit -m "Console cheat decoy: real StackCore.debug needs ?debug=1, plain URL gets taunts"
```

---

## Rollout (controller)

Push, poll Pages, run pw-decoy (no flag) + pw-audio + pw-save (flagged) against live, board hygiene, CLAUDE.md testing note, logs.

## Self-review notes

- The taunt-assertion substrings ('tower', 'robot', 'fingers', 'patience') each appear in exactly one TAUNTS line, so any first-two calls match.
- `decoyCall` returning `false` matches `debug.drop`'s real failure value, so nothing downstream misreads it.
- The offline bundle keeps the real API reachable via `Stack.html?debug=1` for future local testing.
