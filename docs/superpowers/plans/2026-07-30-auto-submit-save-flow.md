# Auto-Submit Save Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved auto-submit save flow (spec: `docs/superpowers/specs/2026-07-30-auto-submit-save-flow.md`): once a device knows a player name, every scoring run posts itself; NOT YOU? renames future runs only.

**Architecture:** hud.js and hud.css only. New `.hud-lb-auto` status row; `trySave` gains a rename-only branch; existing `state.submitted` guard guarantees one run one row. No core/visuals/audio/backend changes.

**Tech Stack:** Vanilla ES5 browser JS, Playwright with route interception.

## Global Constraints

- hud.js is ES5 IIFE style: var, defensive try/catch, no arrow functions, no template literals.
- User data rendered with `textContent` only; Hebrew names get the existing `lrm()` guard in composed strings.
- Game UI text stays English.
- Test scripts live in the session scratchpad, never committed. **All `stack_scores` traffic in the new test is intercepted (POST fulfilled or aborted, GET mocked): the test must never write a real leaderboard row, locally or live.**
- Playwright executor: `cd "C:\Users\maor4\.claude\plugins\cache\playwright-skill\playwright-skill\4.1.0\skills\playwright-skill" && node run.js "<script path>"`
- Local page URL: `file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html`. Live URL: `https://maores.github.io/stack-tower/`.

---

### Task 1: Auto-submit flow in hud.js + hud.css

**Files:**
- Modify: `hud.js` (buildDom, els map, leaderboard helpers, trySave, applyOver, tryRestart, wireOutgoing)
- Modify: `hud.css` (new `.hud-lb-auto` block)
- Test: `<scratchpad>/pw-save.js` (scratchpad, not committed)
- Regenerate: `Stack.html` (after code changes pass)

**Interfaces:**
- Consumes: existing hud.js internals: `state.submitted`, `readName`/`writeName` (`stack-player-name`), `submitScore`, `addLocalScore`, `readLocalBoard`, `refreshBoard`, `renderBoard`, `lrm`, `retrigger`, `keepKeysLocal` (defined in wireOutgoing).
- Produces: `.hud-lb-auto` row with `.hud-lb-auto-text` and `.hud-lb-auto-btn` (NOT YOU?); `USE NAME` / `SAVED FOR NEXT` save-button labels in rename mode.

- [ ] **Step 1: Write the failing Playwright test**

Write `<scratchpad>/pw-save.js` exactly:

```javascript
/* Auto-submit save flow tests. ALL stack_scores traffic is intercepted:
   no real leaderboard rows are ever written, locally or live. */
const { chromium, devices } = require('playwright');

const TARGET_URL = process.env.STACK_URL ||
  'file:///C:/Users/maor4/OneDrive/Desktop/Claude%20builds/stack-tower/index.html';
const LB = '**/rest/v1/stack_scores*';
const MOCK_ROWS = JSON.stringify([
  { name: 'MOCKRIVAL', score: 999 },
  { name: 'MOCKPAL', score: 5 }
]);

async function newPage(browser, opts) {
  const context = await browser.newContext({ ...devices['iPhone 13'] });
  const page = await context.newPage();
  const issues = [];
  page.on('console', m => { if (m.type() === 'error') issues.push('console: ' + m.text()); });
  page.on('pageerror', e => issues.push('pageerror: ' + e.message));
  const posts = [];
  await context.route(LB, route => {
    const req = route.request();
    if (req.method() === 'POST') {
      if (opts.failPosts) { return route.abort(); }
      posts.push(JSON.parse(req.postData() || '{}'));
      return route.fulfill({ status: 201, body: '' });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: MOCK_ROWS });
  });
  if (opts.seedName) {
    await context.addInitScript(name => {
      try { localStorage.setItem('stack-player-name', name); } catch (e) {}
    }, opts.seedName);
  }
  await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#hud-root[data-state="title"]', { timeout: 15000 });
  return { context, page, issues, posts };
}

async function playToGameOver(page) {
  await page.touchscreen.tap(195, 500);
  await page.waitForTimeout(600);
  await page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 300));
    window.StackCore.debug.drop(0.5);
    window.StackCore.debug.drop(6);
  });
  await page.waitForSelector('#hud-root[data-state="over"]', { timeout: 5000 });
  await page.waitForTimeout(900);
}

function fail(msg, data) { throw new Error('FAIL: ' + msg + ' ' + JSON.stringify(data)); }

(async () => {
  const browser = await chromium.launch({ headless: false });

  // 1: fresh profile keeps the manual first-run flow
  let t = await newPage(browser, {});
  await playToGameOver(t.page);
  let s = await t.page.evaluate(() => ({
    entryHidden: document.querySelector('.hud-lb-entry').hidden,
    autoHidden: document.querySelector('.hud-lb-auto').hidden
  }));
  if (s.entryHidden || !s.autoHidden) fail('first-run flow broken', s);
  if (t.posts.length !== 0) fail('first run must not auto-post', t.posts);
  if (t.issues.length) fail('page issues', t.issues);
  await t.context.close();
  console.log('1/4 first-run manual flow intact');

  // 2+3: seeded name auto-posts once; rename affects future runs only
  t = await newPage(browser, { seedName: 'TESTBOT' });
  await playToGameOver(t.page);
  s = await t.page.evaluate(() => ({
    entryHidden: document.querySelector('.hud-lb-entry').hidden,
    autoHidden: document.querySelector('.hud-lb-auto').hidden,
    autoText: document.querySelector('.hud-lb-auto-text').textContent,
    quip: document.querySelector('.hud-over-quip').textContent,
    rows: document.querySelectorAll('.hud-lb .hud-lb-list li').length
  }));
  if (!s.entryHidden || s.autoHidden) fail('auto row missing', s);
  if (s.autoText.indexOf('SAVED AS') !== 0 || s.autoText.indexOf('TESTBOT') < 0) fail('auto text wrong', s);
  if (t.posts.length !== 1 || t.posts[0].name !== 'TESTBOT' || !(t.posts[0].score > 0)) fail('bad auto post', t.posts);
  if (s.quip.indexOf('MOCK') < 0) fail('roast not from mock board', s);
  if (s.rows !== 2) fail('board not from mock rows', s);

  await t.page.click('.hud-lb-auto-btn');
  await t.page.waitForTimeout(300);
  s = await t.page.evaluate(() => ({
    entryHidden: document.querySelector('.hud-lb-entry').hidden,
    saveLabel: document.querySelector('.hud-lb-save').textContent
  }));
  if (s.entryHidden || s.saveLabel !== 'USE NAME') fail('rename entry wrong', s);
  await t.page.fill('.hud-lb-input', 'TESTBOT2');
  await t.page.click('.hud-lb-save');
  await t.page.waitForTimeout(300);
  s = await t.page.evaluate(() => ({
    stored: localStorage.getItem('stack-player-name'),
    saveLabel: document.querySelector('.hud-lb-save').textContent
  }));
  if (s.stored !== 'TESTBOT2' || s.saveLabel !== 'SAVED FOR NEXT') fail('rename not stored', s);
  if (t.posts.length !== 1) fail('rename must not re-post', t.posts);

  await t.page.touchscreen.tap(195, 160); // restart
  await t.page.waitForTimeout(700);
  await t.page.evaluate(async () => {
    await new Promise(r => setTimeout(r, 300));
    window.StackCore.debug.drop(0.5);
    window.StackCore.debug.drop(6);
  });
  await t.page.waitForSelector('#hud-root[data-state="over"]', { timeout: 5000 });
  await t.page.waitForTimeout(900);
  if (t.posts.length !== 2 || t.posts[1].name !== 'TESTBOT2') fail('next run wrong name', t.posts);
  if (t.issues.length) fail('page issues', t.issues);
  await t.context.close();
  console.log('2-3/4 auto-post + rename-for-future verified');

  // 4: failed POST falls back to the device board
  t = await newPage(browser, { seedName: 'TESTBOT', failPosts: true });
  await playToGameOver(t.page);
  s = await t.page.evaluate(() => ({
    autoText: document.querySelector('.hud-lb-auto-text').textContent,
    status: document.querySelector('.hud-lb .hud-lb-status').textContent
  }));
  if (s.autoText.indexOf('SAVED HERE AS') !== 0) fail('local fallback text wrong', s);
  if (s.status !== 'THIS DEVICE ONLY') fail('local board label wrong', s);
  if (t.issues.length) fail('page issues', t.issues);
  await t.context.close();
  console.log('4/4 offline fallback verified');

  console.log('PASS: auto-submit save flow all good');
  await browser.close();
})();
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `cd "C:\Users\maor4\.claude\plugins\cache\playwright-skill\playwright-skill\4.1.0\skills\playwright-skill" && node run.js "<scratchpad>/pw-save.js"`
Expected: FAIL in section 1 (`.hud-lb-auto` does not exist yet, the evaluate throws on null).

- [ ] **Step 3: hud.js changes**

3a. In `buildDom`, right after `lb.appendChild(entry);`, add:

```javascript
    /* Auto-post status row for returning players: "SAVED AS X" + NOT YOU? */
    var autoRow = el('div', 'hud-lb-auto');
    var autoText = el('span', 'hud-lb-auto-text', '');
    var autoBtn = el('button', 'hud-lb-auto-btn', 'NOT YOU?');
    autoBtn.type = 'button';
    autoBtn.setAttribute('aria-label', 'Change saved name');
    autoRow.hidden = true;
    autoRow.appendChild(autoText);
    autoRow.appendChild(autoBtn);
    lb.appendChild(autoRow);
```

3b. In the object `buildDom` returns, after `saveBtn: saveBtn,` add:

```javascript
      autoRow: autoRow,
      autoText: autoText,
      autoBtn: autoBtn,
```

3c. After the `writeName` function, add:

```javascript
  /* --------------------------------------------- auto-post status row */

  function setAutoRow(text, done) {
    els.autoText.textContent = text;
    els.autoRow.hidden = false;
    els.autoRow.classList.toggle('is-done', !!done);
  }

  function hideAutoRow() {
    els.autoRow.hidden = true;
    els.autoRow.classList.remove('is-done');
  }

  /* Once a name is known on this device, every scoring run posts itself.
     NOT YOU? renames future runs only: the posted row stays as-is, so one
     run can never produce two rows. */
  function autoSubmit(name, score) {
    state.submitted = true;
    setAutoRow('SAVING AS ' + lrm(name), false);
    submitScore(name, score, function (ok) {
      if (state.mode !== 'over') { return; } /* already restarted; run still posted */
      if (ok) {
        setAutoRow('SAVED AS ' + lrm(name), true);
        refreshBoard({ name: name, score: score }, true);
      } else {
        addLocalScore(name, score);
        setAutoRow('SAVED HERE AS ' + lrm(name), true);
        renderBoard(readLocalBoard(), { name: name, score: score }, 'THIS DEVICE ONLY');
      }
    });
  }

  function changeName() {
    hideAutoRow();
    els.entry.hidden = false;
    els.entry.classList.remove('is-done');
    els.nameInput.disabled = false;
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = 'USE NAME';
    try { els.nameInput.focus(); } catch (err) { /* ignore */ }
  }
```

3d. Replace the whole `trySave` function with:

```javascript
  function trySave() {
    if (state.mode !== 'over') { return; }
    var name = (els.nameInput.value || '').replace(/\s+/g, ' ').trim().slice(0, 16);
    if (!name) {
      retrigger(els.entry, 'is-shake');
      try { els.nameInput.focus(); } catch (err) { /* ignore */ }
      return;
    }
    if (state.submitted) {
      /* Rename after an auto-post: future runs save as the new name. */
      writeName(name);
      els.nameInput.disabled = true;
      els.saveBtn.disabled = true;
      els.saveBtn.textContent = 'SAVED FOR NEXT';
      els.entry.classList.add('is-done');
      return;
    }
    var score = state.score;
    if (!(score > 0)) { return; }
    state.submitted = true;
    writeName(name);
    els.nameInput.disabled = true;
    els.saveBtn.disabled = true;
    els.saveBtn.textContent = 'SAVING';
    submitScore(name, score, function (ok) {
      els.entry.classList.add('is-done');
      if (ok) {
        els.saveBtn.textContent = 'SAVED';
        refreshBoard({ name: name, score: score });
      } else {
        addLocalScore(name, score);
        els.saveBtn.textContent = 'SAVED HERE';
        renderBoard(readLocalBoard(), { name: name, score: score }, 'THIS DEVICE ONLY');
      }
    });
  }
```

(The only changes from the original: the `state.submitted` early-return guard becomes the rename branch, and the empty-name check moved above it so the shake still works in rename mode.)

3e. In `applyOver`, replace:

```javascript
    els.quip.textContent = nextQuip();
    state.submitted = false;
    els.nameInput.disabled = false;
    els.nameInput.value = readName();
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = 'SAVE';
    els.entry.classList.remove('is-done');
    els.entry.hidden = !(finalScore > 0);
    refreshBoard(null, true);
```

with:

```javascript
    els.quip.textContent = nextQuip();
    state.submitted = false;
    var autoName = readName();
    els.nameInput.disabled = false;
    els.nameInput.value = autoName;
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = 'SAVE';
    els.entry.classList.remove('is-done');
    hideAutoRow();
    if (finalScore > 0 && autoName) {
      /* Known player: the run posts itself; the keyboard stays away. */
      els.entry.hidden = true;
      autoSubmit(autoName, finalScore);
    } else {
      els.entry.hidden = !(finalScore > 0);
      refreshBoard(null, true);
    }
```

3f. In `tryRestart`, change the exclusion line to:

```javascript
    if (ev && ev.target && ev.target.closest && ev.target.closest('.hud-lb-entry, .hud-lb-auto')) { return; }
```

3g. In `wireOutgoing`: after `els.saveBtn.addEventListener('click', trySave);` add:

```javascript
    els.autoBtn.addEventListener('click', changeName);
```

and after the two existing `keepKeysLocal(...)` calls add:

```javascript
    keepKeysLocal(els.autoBtn);
```

- [ ] **Step 4: hud.css addition**

After the `.hud-lb-entry.is-shake` rule, add:

```css
/* Auto-post status row (returning players): "SAVED AS X" + NOT YOU? */
.hud-lb-auto {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 1.4vh;
  pointer-events: auto;
}
.hud-lb-auto[hidden] {
  display: none;
}
.hud-lb-auto.is-done {
  opacity: 0.85;
}
.hud-lb-auto-text {
  font-size: clamp(12px, 1.8vmin, 15px);
  font-weight: 300;
  letter-spacing: 0.18em;
  text-shadow: 0 0 10px rgba(255, 255, 255, 0.3);
}
.hud-lb-auto-btn {
  pointer-events: auto;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 0.3em 0.7em;
  font-size: clamp(10px, 1.5vmin, 12px);
  font-weight: 300;
  letter-spacing: 0.18em;
  transition: background-color 0.18s ease, transform 0.18s ease;
}
.hud-lb-auto-btn:hover {
  background: rgba(255, 255, 255, 0.16);
}
.hud-lb-auto-btn:active {
  transform: scale(0.95);
}
.hud-lb-auto-btn:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
```

- [ ] **Step 5: GREEN + regressions + rebuild**

Run pw-save.js (PASS with all four sections), then pw-audio.js, pw-mute.js (both PASS; their fresh profiles store no name, so nothing auto-posts), then `node scripts/build-offline.mjs` and pw-offline.js (PASS).

- [ ] **Step 6: Commit**

```bash
git add hud.js hud.css Stack.html
git commit -m "Auto-submit save flow: known names post every scoring run, NOT YOU? renames future runs"
```

---

## Rollout (controller)

Push to main, poll Pages, run pw-save.js and pw-mute.js against the live URL (interception keeps it insert-free), read-only board hygiene check, vault and memory logs.

## Self-review notes

- Spec coverage: first-run unchanged (applyOver else-branch), auto-post (autoSubmit), rename-future-only (trySave rename branch plus one-run-one-row via state.submitted), failure fallback (autoSubmit else), score 0 (else-branch keeps entry hidden), instant restart (mode check in the callback posts but skips UI).
- Name consistency: `.hud-lb-auto` / `-text` / `-btn` match across hud.js, hud.css, and pw-save.js; labels `USE NAME` / `SAVED FOR NEXT` match test assertions; `stack-player-name` key unchanged.
- The test's route interception covers POST and GET on `**/rest/v1/stack_scores*`, so live runs write nothing.
