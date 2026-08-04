/* ==========================================================================
   Stack HUD — pure DOM overlay (owned by the hud-ui agent).

   Drop-in: include <script src="hud.js"></script> anywhere in index.html.
   The HUD builds its own DOM under <body>, injects hud.css automatically if
   the page has not linked it, and sits at z-index 100 above the canvas.
   It never touches game internals; the coupling seam is DOM events.

   INCOMING (game -> HUD): dispatch CustomEvents on window (or document,
   or any element with bubbles: true). Aliases accepted per concept:

     start    "game:start"  | "game-start"  | "gamestart"
              -> HUD enters playing state, score resets (detail.score wins)
     score    "game:score"  | "game-score"  | "score"
              detail: number, or { score | value | points }
     perfect  "game:perfect" | "game-perfect" | "perfect"
              -> brief numeral flare (glow boost); no extra geometry,
                 matching the reference stills (bare numeral, no ring)
     over     "game:over" | "game:gameover" | "game-over" | "gameover"
              detail: { score?, best? } -> game-over overlay, best persisted
     ready    "game:ready" | "game:reset" | "game:title"
              -> back to title state

   OUTGOING (dispatched on window):
     'hud:start', 'hud:restart'
     'hud:menu'                   back to title; core answers with game:ready
     'hud:mute'  { muted }        mute state for audio.js
     'hud:world' { id }           equipped World for visuals.js / audio.js
     'hud:mode'  { id }           difficulty for core.js; applied at run start
     'hud:gear'  { trail, flare, slice, death, record, material }  broadcast at boot and on gear changes

   The HUD never stops propagation of pointer events, so a game that starts
   or restarts from its own global tap handler keeps working; hud:start /
   hud:restart are then redundant signals of the same tap.

   Convenience mirror (optional, same handlers as the events):
     window.HUD = { setScore, start, perfect, gameOver, reset, state }
   ========================================================================== */
(function () {
  'use strict';

  if (window.__STACK_HUD_INIT__) { return; }
  window.__STACK_HUD_INIT__ = true;

  var BEST_KEY = 'stack-best';
  var MUTE_KEY = 'stack-muted';  /* shared with audio.js */
  var STREAK_KEY = 'stack-best-streak';
  var BLOCKS_KEY = 'stack-blocks-ever';
  var TODAY_KEY = 'stack-today';
  var PTS_KEY = 'stack-points';    /* spendable balance; earn-only, forever */
  var DAILY_KEY = 'stack-daily';   /* local date of the last doubled run */
  var WORLD_KEY = 'stack-world';    /* equipped World id */
  var OWNED_KEY = 'stack-worlds';   /* owned ids beyond classic (JSON array) */
  var SINGLES_KEY = 'stack-singles'; /* owned single ids (JSON array) */
  var GEAR_KEY = 'stack-gear';       /* slot id -> equipped single id (JSON map) */
  var MODE_KEY = 'stack-mode';      /* equipped difficulty: normal | hard */
  var HARD_BEST_KEY = 'stack-best-hard';   /* core owns the writes; hud reads */

  /* Worlds catalog — hud-owned presentation data (names, prices, card art,
     quip packs). visuals.js and audio.js keep their own per-World tables
     under the same ids; the only coupling is the hud:world event.

     Card art is sampled from the running game (StackVisuals.getPalette and
     getBlockColor per World), not invented: sky is the real inner-to-outer
     falloff, blocks are three rungs of that World's hue ladder, narrow
     rung on top. Earlier art was authored as dark thumbnails and sold the
     wrong thing — classic looked like a night sky when it is bright blue,
     neon looked teal when it is magenta. Re-sample if a palette changes. */
  var WORLDS = [
    { id: 'classic',  name: 'CLASSIC',  price: 0,    giftAt: 0,
      sky: 'radial-gradient(120% 100% at 50% 26%,#4fabda 0%,#0d2c5a 78%)',
      blocks: ['#4ec2d2', '#5695d4', '#7451d3'] },
    { id: 'sunset',   name: 'SUNSET',   price: 600,  giftAt: 0,
      sky: 'radial-gradient(120% 100% at 50% 26%,#c2459a 0%,#380f21 78%)',
      blocks: ['#d154dc', '#da4ba2', '#db4f61'] },
    { id: 'neon',     name: 'NEON',     price: 1000, giftAt: 0,
      sky: 'radial-gradient(120% 100% at 50% 26%,#3e2f7c 0%,#0c0513 78%)',
      blocks: ['#ed338f', '#ec2ad1', '#c02eec'] },
    { id: 'deepsea',  name: 'DEEP SEA', price: 1500, giftAt: 0,
      sky: 'radial-gradient(120% 100% at 50% 26%,#2c7abb 0%,#07112b 78%)',
      blocks: ['#39d34a', '#30d17f', '#34d2bd'] },
    { id: 'marble',   name: 'MARBLE',   price: 0,    giftAt: 70,
      sky: 'radial-gradient(120% 100% at 50% 26%,#ada081 0%,#34341c 78%)',
      blocks: ['#c2ccb0', '#c7c8a9', '#cac1ac'] },
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
  ];
  var WORLD_BY_ID = {};
  (function () {
    for (var i = 0; i < WORLDS.length; i++) { WORLD_BY_ID[WORLDS[i].id] = WORLDS[i]; }
  })();

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
  var RESTART_LOCKOUT_MS = 500;  /* ignore taps right after game over */
  var RESTART_DEDUPE_MS = 400;   /* pointerdown + click on button = one restart */
  var SHOP_ARM_MS = 3000;        /* armed BUY confirm window */

  var scriptBase = (function () {
    var cs = document.currentScript;
    if (cs && cs.src) { return cs.src.slice(0, cs.src.lastIndexOf('/') + 1); }
    return '';
  })();

  var reduceMotion = false;
  try {
    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = mq.matches;
    if (mq.addEventListener) { mq.addEventListener('change', function (e) { reduceMotion = e.matches; }); }
  } catch (err) { /* ignore */ }

  var state = {
    mode: 'boot',       /* boot | title | playing | over */
    score: 0,
    overAt: 0,
    lastRestart: 0,
    runStartBest: null, /* stored best snapshotted when a run starts */
    runBlocks: 0,       /* blocks landed this run; flushed to storage at death
                           so the landing frame never pays a storage write */
    runStreakPeak: 0,   /* highest perfect combo this run, flushed the same way */
    runPts: 0,          /* points earned this run, committed at death */
    submitted: false,   /* this run's score already sent to the board */
    postedRow: null     /* {name, score} actually posted this run, for the
                           "my row" highlight; the name can differ from the
                           stored one after a NOT YOU? rename */
  };

  var els = null;
  var muteOn = false;

  /* ---------------------------------------------------------------- utils */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) { node.className = cls; }
    if (text != null) { node.textContent = text; }
    return node;
  }

  function readBest() {
    try {
      var v = parseInt(window.localStorage.getItem(BEST_KEY), 10);
      return isFinite(v) && v > 0 ? v : 0;
    } catch (err) { return 0; }
  }

  function writeBest(v) {
    try { window.localStorage.setItem(BEST_KEY, String(v)); } catch (err) { /* ignore */ }
  }

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

  /* Hard unlocks at Marble. Derived from TIERS by name so the threshold has
     exactly one source — the tier-gift thresholds in WORLDS are the bug of
     the opposite shape and get collapsed in a later task. */
  var HARD_GATE = (function () {
    for (var i = 0; i < TIERS.length; i++) {
      if (TIERS[i][0] === 'MARBLE') { return TIERS[i][1]; }
    }
    return Infinity;   /* renaming the tier disables Hard rather than opening it */
  })();

  function hardUnlocked() {
    return readBest() >= HARD_GATE;
  }

  /* Gift Worlds are keyed by their tier threshold, so the number lives only
     in TIERS. Previously the threshold existed twice — in WORLDS[].giftAt
     and again in tier-name matching — which is the drift this removes. */
  function giftWorldForTier(tierName) {
    var at = null, i;
    for (i = 0; i < TIERS.length; i++) {
      if (TIERS[i][0] === tierName) { at = TIERS[i][1]; break; }
    }
    if (at == null) { return null; }
    for (i = 0; i < WORLDS.length; i++) {
      if (WORLDS[i].giftAt === at) { return WORLDS[i].id; }
    }
    return null;
  }

  function readHardBest() {
    try {
      var v = parseInt(window.localStorage.getItem(HARD_BEST_KEY), 10);
      return isFinite(v) && v > 0 ? v : 0;
    } catch (err) { return 0; }
  }

  /* The active difficulty. Distinct from state.mode, which is the HUD's
     screen state (boot|title|playing|over) — do not conflate them. */
  function readPlayMode() {
    try {
      var v = String(window.localStorage.getItem(MODE_KEY) || '');
      if (v === 'hard' && hardUnlocked()) { return 'hard'; }
      return 'normal';
    } catch (err) { return 'normal'; }
  }

  function writePlayMode(v) {
    try { window.localStorage.setItem(MODE_KEY, v); } catch (err) { /* ignore */ }
  }

  function firePlayMode(id) {
    try { window.dispatchEvent(new CustomEvent('hud:mode', { detail: { id: id } })); }
    catch (err) { /* ignore */ }
  }

  /* Best for whichever mode is being described. */
  function bestFor(mode) {
    return mode === 'hard' ? readHardBest() : readBest();
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

  /* Local device date on purpose: the personal daily stat is "my day", not the
     board's rolling 24h TODAY window. The two are meant to differ. */
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

  function readDaily() {
    try { return String(window.localStorage.getItem(DAILY_KEY) || ''); }
    catch (err) { return ''; }
  }

  function writeDaily(v) {
    try { window.localStorage.setItem(DAILY_KEY, v); } catch (err) { /* ignore */ }
  }

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

  function readSingles() {
    try {
      var v = JSON.parse(window.localStorage.getItem(SINGLES_KEY) || '[]');
      if (!Array.isArray(v)) { return []; }
      var out = [];
      for (var i = 0; i < v.length; i++) {
        if (Object.prototype.hasOwnProperty.call(SINGLE_BY_ID, v[i]) && out.indexOf(v[i]) < 0) { out.push(v[i]); }
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
    if (!Object.prototype.hasOwnProperty.call(SINGLE_BY_ID, id) || ownsSingle(id)) { return false; }
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
    if (!Object.prototype.hasOwnProperty.call(SINGLE_BY_ID, id)) { return; }
    var s = SINGLE_BY_ID[id];
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

  function pickNumber(detail, keys) {
    if (typeof detail === 'number' && isFinite(detail)) { return detail; }
    if (detail && typeof detail === 'object') {
      for (var i = 0; i < keys.length; i++) {
        var v = detail[keys[i]];
        if (typeof v === 'number' && isFinite(v)) { return v; }
        if (typeof v === 'string' && v !== '' && isFinite(+v)) { return +v; }
      }
    }
    return null;
  }

  function emit(name) {
    try {
      window.dispatchEvent(new CustomEvent(name, { detail: { at: Date.now() } }));
    } catch (err) { /* ignore */ }
  }

  /* Re-trigger a CSS keyframe animation via class toggle. */
  function retrigger(node, cls) {
    if (reduceMotion || !node) { return; }
    node.classList.remove(cls);
    void node.offsetWidth;
    node.classList.add(cls);
  }

  /* Tier-up toast: the tier system's only in-game voice (density revision).
     CSS owns the fade; reduced-motion gets a near-instant transition there. */
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

  function ensureCss() {
    if (document.querySelector('link[data-stack-hud], link[href*="hud.css"]')) { return; }
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = scriptBase + 'hud.css';
    link.setAttribute('data-stack-hud', '1');
    (document.head || document.documentElement).appendChild(link);
  }

  /* ------------------------------------------------------------------ dom */

  function buildDom() {
    var root = el('div', null);
    root.id = 'hud-root';
    root.setAttribute('data-state', 'boot');
    root.setAttribute('aria-hidden', 'false');

    /* score — bare numeral, like the reference (no ring or frame) */
    var scoreWrap = el('div', 'hud-score-wrap');
    var score = el('div', 'hud-score', '0');
    score.setAttribute('aria-hidden', 'true');
    scoreWrap.appendChild(score);

    /* title */
    var title = el('div', 'hud-title');
    var titleWord = el('h1', 'hud-title-word', 'STACK');
    var titleHint = el('div', 'hud-title-hint', 'TAP TO START');
    var titleBest = el('div', 'hud-title-best', '');
    title.appendChild(titleWord);
    title.appendChild(titleHint);
    title.appendChild(titleBest);

    /* game over */
    var over = el('div', 'hud-over');
    var backdrop = el('div', 'hud-over-backdrop');
    var panel = el('div', 'hud-over-panel');
    var quip = el('div', 'hud-over-quip hud-anim d1', '');
    var overLabel = el('div', 'hud-over-label hud-anim d1', 'SCORE');
    var overScore = el('div', 'hud-over-score hud-anim d2', '0');
    overScore.setAttribute('role', 'status');
    var overBest = el('div', 'hud-over-best hud-anim d3', '');
    var overVictim = el('div', 'hud-over-victim hud-anim d4', '');
    overVictim.hidden = true;
    var overTier = el('div', 'hud-over-tier hud-anim d3', '');
    overTier.hidden = true;
    var newBest = el('div', 'hud-over-newbest hud-anim d4', 'NEW BEST');
    newBest.hidden = true;
    /* No heading over the sandwich: once you are ranked these are the three
       rows around you, so calling them the top towers was a lie, and the
       ranks plus the box on your own row already say what the list is. */
    var lb = el('div', 'hud-lb hud-anim d5');
    var lbStatus = el('div', 'hud-lb-status', '');
    var lbList = el('ol', 'hud-lb-list');
    var entry = el('div', 'hud-lb-entry');
    var nameInput = el('input', 'hud-lb-input');
    nameInput.type = 'text';
    nameInput.maxLength = 16;
    nameInput.placeholder = 'YOUR NAME';
    nameInput.autocomplete = 'off';
    nameInput.spellcheck = false;
    nameInput.setAttribute('enterkeyhint', 'done');
    nameInput.setAttribute('aria-label', 'Your name for the leaderboard');
    var saveBtn = el('button', 'hud-lb-save', 'SAVE');
    saveBtn.type = 'button';
    entry.appendChild(nameInput);
    entry.appendChild(saveBtn);
    lb.appendChild(lbStatus);
    lb.appendChild(lbList);
    lb.appendChild(entry);

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

    /* Run earnings whisper: same micro scale as the SAVED AS row. The
       density rule holds — the death screen grows no new layer, only this
       line in the existing micro cluster. */
    var overPts = el('div', 'hud-over-pts', '');
    overPts.hidden = true;
    lb.appendChild(overPts);

    var restart = el('button', 'hud-restart hud-anim d5');
    restart.type = 'button';
    restart.setAttribute('aria-label', 'Restart game');
    restart.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>' +
      '<path d="M3 3v5h5"/></svg>';
    var overHint = el('div', 'hud-over-hint hud-anim d6', 'TAP TO RESTART');
    panel.appendChild(quip);
    panel.appendChild(overLabel);
    panel.appendChild(overScore);
    panel.appendChild(overBest);
    panel.appendChild(overTier);
    panel.appendChild(newBest);
    panel.appendChild(lb);
    /* Spec order (density revision): the chase target sits under the
       sandwich that names it, not between BEST and the board. */
    panel.appendChild(overVictim);
    panel.appendChild(restart);
    panel.appendChild(overHint);
    /* Way back to the title from a death (Maor, 2026-07-31). */
    var overMenu = el('button', 'hud-over-menu', 'MENU');
    overMenu.type = 'button';
    overMenu.setAttribute('aria-label', 'Back to the title screen');
    panel.appendChild(overMenu);
    over.appendChild(backdrop);
    over.appendChild(panel);

    /* Standalone board view + its corner toggle (title/over states only) */
    var boardBtn = el('button', 'hud-board-btn');
    boardBtn.type = 'button';
    boardBtn.setAttribute('aria-label', 'Show leaderboard');
    boardBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0V4z"/>' +
      '<path d="M7 6H4a2 2 0 0 0 2 4h1M17 6h3a2 2 0 0 1-2 4h-1"/></svg>';

    /* Mute toggle (title/over states only), state broadcast via hud:mute */
    var muteBtn = el('button', 'hud-mute-btn');
    muteBtn.type = 'button';
    muteBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M11 5 6.5 9H3v6h3.5L11 19V5z"/>' +
      '<path class="hud-mute-wave" d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12"/>' +
      '<path class="hud-mute-slash" d="M4 4l16 16"/></svg>';

    /* Title shop pill (Wave A round-2 pick: bottom-center + live balance).
       Edge chrome like the corner buttons — never part of the center
       composition. A <button>, so core's global tap handler ignores it. */
    /* Bottom chrome row: shop pill + difficulty switch, side by side. Edge
       furniture, never part of the centre composition (bare-title rule). */
    var titleChrome = el('div', 'hud-title-chrome');
    titleChrome.setAttribute('data-ui', '1');
    var shopPill = el('button', 'hud-shop-pill', 'SHOP');
    shopPill.type = 'button';
    shopPill.setAttribute('aria-label', 'Open the shop');

    /* Both words always on screen: Normal must read as a selected state,
       never as the absence of Hard. */
    var modeSeg = el('div', 'hud-mode-seg');
    var modeNormal = el('button', 'hud-mode-btn is-on', 'NORMAL');
    modeNormal.type = 'button';
    modeNormal.setAttribute('data-mode', 'normal');
    var modeHard = el('button', 'hud-mode-btn', 'HARD');
    modeHard.type = 'button';
    modeHard.setAttribute('data-mode', 'hard');
    modeSeg.appendChild(modeNormal);
    modeSeg.appendChild(modeHard);
    titleChrome.appendChild(shopPill);
    titleChrome.appendChild(modeSeg);

    /* data-ui is core.js's documented opt-out. Without it every tap inside
       this subtree that is not one of the buttons (panel body, heading,
       status line, every leaderboard row) reaches core's global pointerdown
       handler and starts or restarts a run behind the open board. */
    var board = el('div', 'hud-board');
    board.setAttribute('data-ui', '1');
    var boardPanel = el('div', 'hud-board-panel');
    var boardClose = el('button', 'hud-board-close');
    boardClose.type = 'button';
    boardClose.setAttribute('aria-label', 'Close leaderboard');
    boardClose.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" ' +
      'stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    /* The tabs below name the destination, so a fixed heading above them
       could only ever be redundant or wrong: it read TOP TOWERS over the
       shop and over the records. */
    var boardStatus = el('div', 'hud-lb-status', '');
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

    /* NORMAL | HARD: which board this pane reads. View-only: it never
       changes what will be played, because the trophy opens from the death
       screen too, where the title switch is not visible. */
    var boardMode = el('div', 'hud-board-mode');
    var boardModeNormal = el('button', 'hud-mode-btn is-on', 'NORMAL');
    boardModeNormal.type = 'button';
    boardModeNormal.setAttribute('data-mode', 'normal');
    var boardModeHard = el('button', 'hud-mode-btn', 'HARD');
    boardModeHard.type = 'button';
    boardModeHard.setAttribute('data-mode', 'hard');
    boardMode.appendChild(boardModeNormal);
    boardMode.appendChild(boardModeHard);

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
    var recPts = recRow('POINTS', 'hud-rec-pts');
    boardRecords.appendChild(recPts.row);
    /* Records describes the whole player rather than a moment, so it shows
       both modes. Exactly one new row, below a rule, and only once Hard is
       unlocked — the density line held through every wave so far. */
    var recHardSep = el('div', 'hud-rec-sep');
    recHardSep.hidden = true;
    boardRecords.appendChild(recHardSep);
    var recHard = recRow('HARD BEST', 'hud-rec-hard');
    recHard.row.classList.add('hud-rec-hard-row');
    recHard.row.hidden = true;
    boardRecords.appendChild(recHard.row);
    var ladder = el('div', 'hud-ladder');
    boardRecords.appendChild(ladder);
    var ladderNote = el('div', 'hud-ladder-note', 'TOWER TIERS · FROM YOUR BEST · NEVER DROP');
    boardRecords.appendChild(ladderNote);

    /* Shop pane shell: balance now, cards in the shop task. */
    var boardShop = el('div', 'hud-board-shop');
    boardShop.hidden = true;
    var shopBal = el('div', 'hud-shop-bal');
    shopBal.appendChild(el('span', 'hud-shop-bal-label', 'POINTS'));
    var shopBalVal = el('span', 'hud-shop-bal-val', '0');
    shopBal.appendChild(shopBalVal);
    boardShop.appendChild(shopBal);

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
        /* Full strength: these are the World's own hues, and fading them
           was what made six different places look like one dark one. */
        bk.style.background = w.blocks[bi];
        bk.style.width = (22 + bi * 6) + 'px';
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
    boardShop.appendChild(shopGrid);

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
    /* The machine slot moves with the rack: it now sits directly under
       boardShop rather than inside the two-column Worlds grid, so the
       shelf order reads Worlds grid -> gear rack -> machine. */
    boardShop.appendChild(shopMachine);

    /* Redeem row: one known code unlocks the full current catalog on this
       device (Maor's review lane, 2026-08-04: judging effects in the real
       game beats reading mockups). The code ships in a public repo, so
       anyone reading source can find it; cosmetics only, accepted like the
       rest of the trollable-by-design surface. Trophies stay earned: the
       code grants the 22 singles and the three priced Worlds, never the
       tier gifts or Bobo. */
    var redeemRow = el('div', 'hud-redeem');
    var redeemInput = document.createElement('input');
    redeemInput.type = 'text';
    redeemInput.className = 'hud-redeem-input';
    redeemInput.placeholder = 'REDEEM CODE';
    redeemInput.maxLength = 24;
    redeemInput.setAttribute('aria-label', 'Redeem code');
    var redeemBtn = el('button', 'hud-redeem-btn', 'APPLY');
    redeemBtn.type = 'button';
    redeemBtn.setAttribute('aria-label', 'Apply redeem code');
    var redeemMsg = el('span', 'hud-redeem-msg', '');
    redeemRow.appendChild(redeemInput);
    redeemRow.appendChild(redeemBtn);
    redeemRow.appendChild(redeemMsg);
    boardShop.appendChild(redeemRow);

    var boardList = el('ol', 'hud-lb-list hud-board-list');
    /* Floating jump-to-my-row chip: absolutely positioned over the list's
       lower edge, so showing or hiding it cannot move the panel. */
    var boardMyRow = el('button', 'hud-board-myrow');
    boardMyRow.type = 'button';
    boardMyRow.hidden = true;
    boardPanel.appendChild(boardClose);
    boardPanel.appendChild(boardStatus);
    boardPanel.appendChild(boardTabs);
    boardPanel.appendChild(boardMode);
    boardPanel.appendChild(boardRecords);
    boardPanel.appendChild(boardShop);
    boardPanel.appendChild(boardList);
    boardPanel.appendChild(boardMyRow);
    board.appendChild(boardPanel);

    /* Tier-up toast: fixed top-center, above everything, never interactive. */
    var toast = el('div', 'hud-toast', '');
    toast.setAttribute('aria-live', 'polite');

    root.appendChild(scoreWrap);
    root.appendChild(title);
    root.appendChild(over);
    root.appendChild(boardBtn);
    root.appendChild(muteBtn);
    root.appendChild(titleChrome);
    root.appendChild(board);
    root.appendChild(toast);

    return {
      root: root,
      score: score,
      title: title,
      titleBest: titleBest,
      over: over,
      overScore: overScore,
      overBest: overBest,
      overTier: overTier,
      overMenu: overMenu,
      overVictim: overVictim,
      overPts: overPts,
      newBest: newBest,
      restart: restart,
      quip: quip,
      lbStatus: lbStatus,
      boardTabBoard: boardTabBoard,
      boardTabRec: boardTabRec,
      boardTabShop: boardTabShop,
      boardMode: boardMode,
      boardModeNormal: boardModeNormal,
      boardModeHard: boardModeHard,
      boardShop: boardShop,
      shopBalVal: shopBalVal,
      shopGrid: shopGrid,
      shopCards: shopCards,
      gearRack: gearRack,
      gearCards: gearCards,
      shopMachine: shopMachine,
      machineReel: reel,
      machineReelWin: reelWin,
      machineSpin: spinBtn,
      machineWin: machineWin,
      redeemInput: redeemInput,
      redeemBtn: redeemBtn,
      redeemMsg: redeemMsg,
      toast: toast,
      lbList: lbList,
      entry: entry,
      nameInput: nameInput,
      saveBtn: saveBtn,
      autoRow: autoRow,
      autoText: autoText,
      autoBtn: autoBtn,
      boardBtn: boardBtn,
      muteBtn: muteBtn,
      shopPill: shopPill,
      titleChrome: titleChrome,
      modeSeg: modeSeg,
      modeNormal: modeNormal,
      modeHard: modeHard,
      board: board,
      boardPanel: boardPanel,
      boardStatus: boardStatus,
      boardList: boardList,
      boardMyRow: boardMyRow,
      boardClose: boardClose,
      boardRecords: boardRecords,
      ladder: ladder,
      recBest: recBest.val,
      recStreak: recStreak.val,
      recToday: recToday.val,
      recBlocks: recBlocks.val,
      recPts: recPts.val,
      recHardBest: recHard.val,
      recHardRow: recHard.row,
      recHardSep: recHardSep
    };
  }

  /* ---------------------------------------------------------------- state */

  function setMode(mode) {
    if (state.mode === mode) { return; }
    if (mode === 'playing') {
      /* Snapshot the pre-run best now: by game-over time the game layer may
         already have persisted the new best under the same storage key, so a
         read at that point can never detect "beat my old best". */
      state.runStartBest = bestFor(readPlayMode());
      state.runBlocks = 0;      /* fresh in-memory accumulators for this run */
      state.runStreakPeak = 0;
      state.runPts = 0;
    }
    state.mode = mode;
    els.root.setAttribute('data-state', mode);
    if (mode === 'title') { renderTitleBest(); }
  }

  function renderTitleBest() {
    var mode = readPlayMode();
    var best = bestFor(mode);
    var label = best > 0 ? 'BEST ' + best : '';
    /* Only Hard names itself here: the lit NORMAL chip already says Normal,
       and repeating it in the best line would be redundant. Hard still names
       itself with no best yet (a fresh unlock): dropping to a blank line on
       the very first switch would read as the tap having failed
       (brief deviation — see task-2-report.md). */
    if (mode === 'hard') { label = label ? 'HARD · ' + label : 'HARD'; }
    els.titleBest.textContent = label;
    renderShopPill();
    renderModeSwitch();
  }

  function renderModeSwitch() {
    var mode = readPlayMode();
    var unlocked = hardUnlocked();
    els.modeNormal.classList.toggle('is-on', mode !== 'hard');
    els.modeHard.classList.toggle('is-on', mode === 'hard');
    els.modeSeg.classList.toggle('is-locked', !unlocked);
    /* Not a native disabled: the setPlayMode() gate below already blocks the
       state change, and staying focusable keeps the "unlocks at N" label
       reachable by keyboard/AT instead of dropping the control from the tab
       order entirely (brief deviation — see task-2-report.md). aria-disabled
       is the real unavailable signal for assistive tech in its place. Note
       for the next test written against this control: Playwright's own
       actionability wait DOES treat [aria-disabled=true] as not-enabled
       (playwright.dev/docs/actionability), same as a native disabled — a
       plain .click() on this button while locked needs { force: true }. */
    els.modeHard.setAttribute('aria-disabled', unlocked ? 'false' : 'true');
    els.modeHard.setAttribute('aria-label', unlocked
      ? 'Play Hard mode'
      : 'Hard mode unlocks at ' + HARD_GATE);
    els.modeNormal.setAttribute('aria-pressed', mode !== 'hard' ? 'true' : 'false');
    els.modeHard.setAttribute('aria-pressed', mode === 'hard' ? 'true' : 'false');
  }

  function setPlayMode(id) {
    if (id === 'hard' && !hardUnlocked()) { return; }
    var next = id === 'hard' ? 'hard' : 'normal';
    writePlayMode(next);
    firePlayMode(next);
    renderTitleBest();
  }

  function renderShopPill() {
    els.shopPill.textContent = 'SHOP · ' + fmtPts(readInt(PTS_KEY));
  }

  function renderScore() {
    els.score.textContent = String(state.score);
  }

  function pop() {
    if (reduceMotion || !els.score.animate) { return; }
    els.score.animate(
      [{ transform: 'scale(1.13)' }, { transform: 'scale(1)' }],
      { duration: 190, easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' }
    );
  }

  /* ----------------------------------------------------------- leaderboard */

  var LB_URL = 'https://exfjfiuzrwuedztmdyqf.supabase.co/rest/v1/stack_scores';
  /* Publishable key by design: safe in public clients, access is RLS-gated. */
  var LB_KEY = 'sb_publishable_gJ5RS5qGx2_Md1J0fWBTBw_DFYDB0Dd';
  var LB_SELECT = '?select=name,score&order=score.desc,created_at.asc&limit=50';

  function dayFloorIso() {
    return new Date(Date.now() - 86400000).toISOString();
  }

  /* Every read names its mode explicitly; there is no implicit default. */
  function scopeFilter(scope, mode) {
    var f = '&mode=eq.' + (mode === 'hard' ? 'hard' : 'normal');
    if (scope === 'day') { f += '&created_at=gte.' + encodeURIComponent(dayFloorIso()); }
    return f;
  }

  /* One best row per player: rows arrive score-desc, keep the first per name.
     Keys carry a '#' prefix so a player named toString / valueOf / __proto__
     cannot read back truthy off Object.prototype and vanish from the board. */
  function dedupeBest(rows) {
    var seen = {}, out = [], i, r, k;
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      if (!r || r.name == null) { continue; }
      k = '#' + String(r.name);
      if (seen[k]) { continue; }
      seen[k] = true;
      out.push(r);
    }
    return out;
  }
  var LB_TIMEOUT_MS = 6000;
  var LOCAL_BOARD_KEY = 'stack-local-board';
  var NAME_KEY = 'stack-player-name';

  var QUIPS = [
    'The tower remembers your hubris.',
    'Gravity: 1, you: 0.',
    'That block had a family.',
    'The architecture critics are speechless.',
    'A monument to almost.',
    'The ground thanks you for your donation.',
    'Physics has filed a complaint.',
    'Even the Tower of Pisa is judging you.',
    'Blocks fall. Legends restart.',
    'The city has revoked your building permit.',
    'The wind was not even blowing.',
    'One tap too brave.',
    'Structural integrity: optional, apparently.',
    'Your tower is now modern art.'
  ];

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
    ],
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
  };

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

  var quipBag = [];
  var autoSeq = 0;

  function nextQuip() {
    if (!quipBag.length) {
      quipBag = activeQuips().slice();
      for (var i = quipBag.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = quipBag[i]; quipBag[i] = quipBag[j]; quipBag[j] = tmp;
      }
    }
    return quipBag.pop();
  }

  /* Personal roasts: when the live board is available at death time, the quip
     targets someone real instead of the generic bag. Namespaced to the daily
     scope: a device from before the daily board existed may still hold a
     value under the old unscoped 'stack-last-top' key, and that all-time
     leader is not comparable to a daily top. Leaving that old key unread
     orphans it, which is correct; it is never migrated. */
  var LAST_TOP_KEY = 'stack-last-top-day';
  var ROAST_RIVAL = [
    'Even {n} got further. {n} got {s}.',
    'Somewhere, {n} ({s}) is not impressed.',
    'That puts you below {n}. Sit with that.',
    '{n} needed {s} to beat you. {n} had it.'
  ];
  var ROAST_TIE = [
    'You and {n}: equally mortal at {s}.',
    'A perfect tie with {n}. Neither of you is fine.'
  ];
  var ROAST_KING = [
    'New throne occupant: {me}. Everyone else may now cope.',
    'The board bows to {me}. For now.'
  ];
  var ROAST_NEWS = [
    'Meanwhile, {n} took the crown at {s}.',
    'Breaking: {n} now rules the tower at {s}.'
  ];

  /* Trailing LRM keeps RTL names (Hebrew) from reordering the sentence. */
  function lrm(name) { return String(name) + '‎'; }

  function pickFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  function fillRoast(tpl, name, score) {
    return tpl.replace(/\{n\}/g, lrm(name)).replace(/\{s\}/g, String(score));
  }

  function readLastTop() {
    try {
      var v = JSON.parse(window.localStorage.getItem(LAST_TOP_KEY) || 'null');
      return v && typeof v.name === 'string' ? v : null;
    } catch (err) { return null; }
  }

  function rememberTop(rows) {
    if (!rows || !rows.length || !rows[0]) { return; }
    try {
      window.localStorage.setItem(LAST_TOP_KEY, JSON.stringify({ name: rows[0].name, score: rows[0].score }));
    } catch (err) { /* ignore */ }
  }

  function computeRoast(rows, myScore, myName) {
    if (!rows || !rows.length) { return null; }
    var top = rows[0] || {};
    if (typeof top.score === 'number' && myScore > top.score) {
      return pickFrom(ROAST_KING).replace('{me}', myName ? lrm(myName) : 'you');
    }
    var last = readLastTop();
    if (last && top.name != null && (top.name !== last.name || top.score !== last.score) && top.name !== myName) {
      return fillRoast(pickFrom(ROAST_NEWS), top.name, top.score);
    }
    var rivals = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (r && r.name != null && r.name !== myName && typeof r.score === 'number' && r.score >= myScore) {
        rivals.push(r);
      }
    }
    if (!rivals.length) { return null; }
    var rv = rivals[Math.floor(Math.random() * rivals.length)];
    return fillRoast(pickFrom(rv.score === myScore ? ROAST_TIE : activeRivals()), rv.name, rv.score);
  }

  function applyRoast(rows) {
    var line = computeRoast(rows, state.score, readName());
    if (line) { els.quip.textContent = line; }
  }

  function readName() {
    try { return String(window.localStorage.getItem(NAME_KEY) || ''); } catch (err) { return ''; }
  }

  function writeName(v) {
    try { window.localStorage.setItem(NAME_KEY, v); } catch (err) { /* ignore */ }
  }

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
    var seq = autoSeq;   /* bumped by every death (applyOver) and by NOT YOU? */
    var row = { name: name, score: score };
    state.postedRow = row;
    setAutoRow('SAVING AS ' + lrm(name), false);
    /* Captured now, not read in the callback: a late response must file this
       run under the mode it was played in, not whatever is equipped by then. */
    var m = deathMode();
    submitScore(name, score, m, function (ok) {
      if (!ok) { addLocalScore(name, score, m); } /* record even mid-restart */
      if (seq !== autoSeq || state.mode !== 'over') { return; }
      if (ok) {
        setAutoRow('SAVED AS ' + lrm(name), true);
        refreshBoard(row, true);
      } else {
        setAutoRow('SAVED HERE AS ' + lrm(name), true);
        renderBoard(readLocalBoard(m), row, 'THIS DEVICE ONLY');
      }
    });
  }

  function changeName() {
    if (state.mode !== 'over') { return; }
    autoSeq++;   /* a late auto-post callback must not resurrect the row */
    hideAutoRow();
    els.entry.hidden = false;
    els.entry.classList.remove('is-done');
    els.nameInput.disabled = false;
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = 'USE NAME';
    try { els.nameInput.focus(); } catch (err) { /* ignore */ }
  }

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
    muteOn = !muteOn;
    var muted = muteOn;
    try { window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); }
    catch (err) { /* ignore */ }
    applyMuteUi(muted);
    try { window.dispatchEvent(new CustomEvent('hud:mute', { detail: { muted: muted } })); }
    catch (err) { /* ignore */ }
  }

  /* One device list per mode. Normal keeps the original key, so nothing has
     to migrate: every row written before Hard shipped is a Normal row by
     definition. Without this an offline Hard death shows Normal scores. */
  function localBoardKey(mode) {
    return mode === 'hard' ? LOCAL_BOARD_KEY + '-hard' : LOCAL_BOARD_KEY;
  }

  function readLocalBoard(mode) {
    try {
      var rows = JSON.parse(window.localStorage.getItem(localBoardKey(mode)) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (err) { return []; }
  }

  function addLocalScore(name, score, mode) {
    var rows = readLocalBoard(mode);
    rows.push({ name: name, score: score });
    rows.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    rows = rows.slice(0, 10);
    try {
      window.localStorage.setItem(localBoardKey(mode), JSON.stringify(rows));
    } catch (err) { /* ignore */ }
    return rows;
  }

  function fetchTop(scope, cb, full, mode) {
    if (!window.fetch) { cb(null); return; }
    var done = false;
    var finish = function (rows) { if (!done) { done = true; cb(rows); } };
    var timer = setTimeout(function () { finish(null); }, LB_TIMEOUT_MS);
    try {
      window.fetch(LB_URL + LB_SELECT + scopeFilter(scope, mode), { headers: { apikey: LB_KEY } })
        .then(function (r) { if (!r.ok) { throw new Error('http ' + r.status); } return r.json(); })
        .then(function (rows) {
          clearTimeout(timer);
          /* full: the sandwich needs the whole deduped ranking, not the top 10 */
          finish(Array.isArray(rows) ? (full ? dedupeBest(rows) : dedupeBest(rows).slice(0, 10)) : null);
        })
        .catch(function () { clearTimeout(timer); finish(null); });
    } catch (err) { clearTimeout(timer); finish(null); }
  }

  /* Which mode the run being described belongs to. Set from the mode core
     echoes on game:start and re-set from what it echoes on game:over, so a
     finished run is always described in the mode it actually played, not
     whatever the title switch happens to be equipped to by then. */
  var runMode = 'normal';
  function deathMode() { return runMode === 'hard' ? 'hard' : 'normal'; }

  function submitScore(name, score, mode, cb) {
    if (!window.fetch) { cb(false); return; }
    var done = false;
    var finish = function (ok) { if (!done) { done = true; cb(ok); } };
    var timer = setTimeout(function () { finish(false); }, LB_TIMEOUT_MS);
    try {
      window.fetch(LB_URL, {
        method: 'POST',
        headers: { apikey: LB_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, score: score, mode: mode === 'hard' ? 'hard' : 'normal' })
      })
        .then(function (r) { clearTimeout(timer); finish(r.ok); })
        .catch(function () { clearTimeout(timer); finish(false); });
    } catch (err) { clearTimeout(timer); finish(false); }
  }

  function renderRows(listEl, statusEl, rows, mine, label, max) {
    var cap = max || 10;
    statusEl.textContent = label || '';
    while (listEl.firstChild) { listEl.removeChild(listEl.firstChild); }
    if (!rows || !rows.length) {
      listEl.appendChild(el('li', 'hud-lb-empty', 'NO SCORES YET'));
      return;
    }
    var mineMarked = false;
    for (var i = 0; i < rows.length && i < cap; i++) {
      var r = rows[i] || {};
      var li = el('li', null);
      li.appendChild(el('span', 'hud-lb-name', String(r.name == null ? '?' : r.name).slice(0, 16)));
      li.appendChild(el('span', 'hud-lb-pts', String(r.score == null ? 0 : r.score)));
      /* A score-less `mine` matches on name alone: the trophy board knows
         who I am but not which of my runs the board kept, while the death
         screen passes the exact row it just posted. */
      if (!mineMarked && mine && r.name === mine.name &&
          (mine.score == null || r.score === mine.score)) {
        li.className = 'hud-lb-mine';
        mineMarked = true;
      }
      listEl.appendChild(li);
    }
  }

  /* Cold-open placeholder: six shimmer bars where rows will land. Only
     ever rendered into an empty list; any real render replaces it because
     renderRows clears the list first. */
  function renderSkeleton(listEl) {
    while (listEl.firstChild) { listEl.removeChild(listEl.firstChild); }
    for (var i = 0; i < 6; i++) { listEl.appendChild(el('li', 'hud-lb-skel')); }
  }

  function renderBoard(rows, mine, label) {
    /* Death-screen fallback list matches the sandwich scale: 3 rows; the
       trophy overlay keeps the full 10 (density revision, 2026-07-31). */
    renderRows(els.lbList, els.lbStatus, rows, mine, label, 3);
  }

  /* Rank sandwich: the deduped all-time list windowed around my best row.
     Anchor by stored name; the row's score is that player's best. */
  function buildSandwich(rows) {
    var out = { rows: [], above: null, mineScore: null };
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
    /* The board's opinion of me, which is what the ranking above is built
       from. The local best can be higher (a run that never posted, e.g.
       played offline), and mixing the two produces a gap that counts from
       the wrong place. */
    if (at >= 0 && typeof rows[at].score === 'number') { out.mineScore = rows[at].score; }
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

  /* Victim anchors the BEST, not the current run (spec 2026-07-31):
     beat the neighbor above your best row. Hidden for kings and the unranked.
     The gap must be measured from the same number the ranking used — my row
     on the board — or it counts from a place the board does not agree with:
     a best set offline never reached the board, and subtracting it from the
     neighbour's score printed lines like "-21 MORE PASSES". Falls back to
     the local best only when the board has no row for me. */
  function showVictim(above, mineScore) {
    var text = '';
    if (above && typeof above.score === 'number') {
      var anchor = typeof mineScore === 'number' ? mineScore : bestFor(deathMode());
      if (anchor > 0) {
        var gap = above.score - anchor + 1;
        /* gap < 1 means I am already past them, so there is nobody to chase
           on the board and the fallback below takes over. */
        if (gap >= 1) {
          text = gap + ' MORE PASSES ' + lrm(String(above.name).slice(0, 16));
        }
      }
    }
    if (!text) {
      /* Nobody above me: I am top of the board, or the board is empty (every
         early Hard run, since that board starts with no rows), or it never
         loaded at all. Then the only target left is my own record. Restores
         the retention spec's "N FROM YOUR BEST", lost when the death screen
         was rebuilt around the rank sandwich. */
      var myBest = bestFor(deathMode());
      var toBeat = myBest - state.score;
      /* A run that placed nothing has nothing to chase with, and the score-0
         screen must stay bare (it is also where a stale line from the
         previous death would show up). toBeat < 1 means this run IS the
         record, which NEW BEST already announces. */
      if (myBest > 0 && state.score > 0 && toBeat >= 1) {
        text = toBeat + ' FROM YOUR BEST';
      }
    }
    if (!text) { return; }
    els.overVictim.textContent = text;
    els.overVictim.hidden = false;
  }

  /* Render tokens, one per board, matching their independent scopes: a slow
     response must never paint under a tab the player has since left. Same
     idiom as autoSeq. Bumped by every request and by every scope change. */
  var deathBoardSeq = 0;
  var overlayBoardSeq = 0;
  /* One generation per death, not per request: the death lines describe the
     run that just ended, so they survive a tab switch (the board tokens do
     not) but are dropped the moment the next run dies. */
  var deathSeq = 0;
  /* Which death already chose its quip. The roast may reach us twice (warm
     rows first, live rows after); swapping the line a second time can
     reflow it from one line to two under someone mid-read, and the second
     roast is no truer than the first. */
  var roastedGen = -1;

  function applyRoastOnce(rows) {
    if (roastedGen === deathSeq) { return; }
    applyRoast(rows);
    roastedGen = deathSeq;
  }

  /* Board rows kept from the last successful read, so a death screen can be
     drawn in one pass instead of assembling itself while it is being read.
     Warmed when a run starts: by the time anyone dies the rows are in hand,
     and the fill arrives with the screen rather than a beat behind it. */
  /* Warmed rows, per mode: opening the Hard board after playing Normal must
     not paint Normal's rows while Hard's read is in flight. */
  var warmBoard = {
    normal: { all: null, day: null, at: 0 },
    hard:   { all: null, day: null, at: 0 }
  };
  var WARM_MS = 120000;

  function warmSlot(mode) {
    return mode === 'hard' ? warmBoard.hard : warmBoard.normal;
  }
  function warmIsFresh(mode) {
    var w = warmSlot(mode);
    return !!w.all && (Date.now() - w.at) < WARM_MS;
  }
  function warmUp(mode) {
    var m = mode === 'hard' ? 'hard' : 'normal';
    var w = warmSlot(m);
    fetchTop('all', function (rows) { if (rows) { w.all = rows; w.at = Date.now(); } }, true, m);
    fetchTop('day', function (rows) { if (rows) { w.day = rows; } }, false, m);
  }
  function warmRowsFor(scope, mode) {
    if (!warmIsFresh(mode)) { return null; }
    var w = warmSlot(mode);
    return scope === 'day' ? w.day : w.all;
  }

  function paintSandwich(rows, mine) {
    els.overVictim.hidden = true;
    els.overVictim.textContent = '';
    if (!rows) {
      renderRows(els.lbList, els.lbStatus, readLocalBoard(deathMode()), mine, 'THIS DEVICE ONLY', 3);
      /* No board at all still deserves a target, and my own best is one. */
      showVictim(null, null);
      return;
    }
    var sw = buildSandwich(rows);
    renderSandwich(sw);
    showVictim(sw.above, sw.mineScore);
  }

  /* Death screen data: the rank sandwich from the all-time list, the roast
     from the daily one. Tokens keep their jobs: deathBoardSeq drops a stale
     paint, deathSeq drops everything from a previous death.

     Warm rows paint immediately so the screen has its final shape from the
     first frame; the live fetch still runs and still repaints (your own row
     may have just moved), but three rows of names and scores occupy the
     same space either way, so that repaint costs no movement. The roast is
     applied once per death — swapping the quip twice could reflow it from
     one line to two under the reader. */
  function refreshBoard(mine, wantRoast) {
    var dseq = ++deathBoardSeq;
    var dgen = deathSeq;
    var m = deathMode();
    els.lbStatus.textContent = '';
    var paintedWarm = false;
    if (warmIsFresh(m)) {
      paintSandwich(warmRowsFor('all', m), mine);
      paintedWarm = true;
      var wday = warmRowsFor('day', m);
      if (wantRoast && wday) { applyRoastOnce(wday); }
    }
    fetchTop('all', function (rows) {
      if (rows) { var w = warmSlot(m); w.all = rows; w.at = Date.now(); }
      if (dseq !== deathBoardSeq || state.mode !== 'over' || dgen !== deathSeq) { return; }
      /* A read that failed after warm rows are already up is not worth
         trading real board rows for a one-line device list. */
      if (!rows && paintedWarm) { return; }
      paintSandwich(rows, mine);
    }, true, m);
    if (wantRoast) {
      fetchTop('day', function (rows) {
        if (rows) { warmSlot(m).day = rows; }
        if (state.mode !== 'over' || dgen !== deathSeq) { return; }
        if (rows) {
          applyRoastOnce(rows);
          rememberTop(rows);
        }
      }, false, m);
    }
  }

  /* Standalone board view: opens from the corner trophy, refreshes itself
     every 15s while open so nobody has to reload anything. */
  var overlayMode = 'normal';   /* which board is being READ, not played */
  var overlayPane = 'board';
  var boardOpen = false;
  var boardTimer = null;
  var BOARD_REFRESH_MS = 15000;

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
    chip.textContent = (above ? '▴' : '▾') + ' MY ROW · #' + rank;
    chip.hidden = false;
  }

  function refreshOverlayBoard(showLoading) {
    if (overlayPane !== 'board') { return; }  /* records/shop panes are local: the 15s tick must not fetch */
    var seq = ++overlayBoardSeq;
    /* Captured once, at issue time (Review Finding 2): overlayMode is a
       live picker, not the mode this particular read was issued for. The
       fetchTop callback below is async, so a tap on the picker before it
       resolves must not relabel the answer that is already in flight — the
       same reasoning refreshBoard already applies via its own captured
       `m`. */
    var mode = overlayMode;
    /* Find myself on the shared board: the whole point of opening it is
       seeing where I sit, and scanning a list of friends for my own name
       is work the highlight can do. Name only — the board keeps my best
       run, whichever one that was. */
    var myName = readName();
    var me = myName ? { name: myName } : null;
    /* Paint the warmed rows first, so the panel is the size it will stay
       at before the read even leaves — opening used to show an empty list
       that grew instead. */
    var warm = warmRowsFor('all', mode);
    /* Nothing cached and nothing on screen yet — the cold-empty case. The
       panel's height is fixed (hud.css .hud-board-panel), so a skeleton
       costs nothing to show; the fetch below replaces it the moment real
       rows (or the empty/device-fallback state) land. showLoading is false
       on the silent 15s tick, so a background refresh never interrupts
       whatever is already on screen with a fresh skeleton. */
    if (warm) { renderRows(els.boardList, els.boardStatus, warm, me, '', 50); updateMyRow(); }
    else if (showLoading && !els.boardList.children.length) { renderSkeleton(els.boardList); }
    fetchTop('all', function (rows) {
      if (rows) {
        var w = warmSlot(mode);
        w.all = rows; w.at = Date.now();
      }
      if (!boardOpen || seq !== overlayBoardSeq) { return; }
      if (rows) { renderRows(els.boardList, els.boardStatus, rows, me, '', 50); }
      else if (!warm) { renderRows(els.boardList, els.boardStatus, readLocalBoard(mode), me, 'THIS DEVICE ONLY', 50); }
      updateMyRow();
    }, true, mode);   /* full: the uncapped list needs the whole deduped ranking,
                          not fetchTop's own top-10 slice (Task 3 fix — this call
                          was still asking for the 10-row answer the old renderRows
                          cap used to match; raising renderRows's cap alone could
                          never see past a truncation that already happened here.
                          No extra network cost: LB_SELECT's limit=50 already runs
                          regardless of this flag, which only ever gated the
                          client-side slice). */
  }

  function fmtPts(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  /* Two-tap purchase state: first tap arms one card, second inside the
     window confirms. No modal — a stray tap can cost at most an armed chip. */
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
      /* Secret Worlds are absent from the shelf until earned. Set on every
         card, not only the secret one, so a card can never stay hidden
         after its grant. */
      c.card.hidden = !!(w.secret && !ownsWorld(w.id));
      c.chip.textContent = chip;
      /* The visible chip carries the state; the label must say the same. */
      c.card.setAttribute('aria-label', c.world.name + ' — ' + c.chip.textContent);
    }
    renderGearRack();
    renderMachine();
  }

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

  var machineBusy = false;
  var machineLast = null;   /* {single} for the session's win row */
  var MACHINE_ROWH = 32;
  /* Lengthened from 1250/1300/1900 on Maor's verdict (2026-08-04: the spin
     "ends too fast"); same deceleration curve, stretched. Further pacing
     shapes belong to the shop-overhaul mockup round. */
  var MACHINE_ROLL_MS = 2000;
  var MACHINE_HIT_MS = 2050;
  var MACHINE_LOCK_MS = 2650;
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
    if (readGear()[s.slot] === s.id) {
      els.machineWin.appendChild(el('span', 'hud-machine-wineq', 'EQUIPPED ✓'));
    }
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
    if (target + 1 >= 15) {   /* extend the strip so target+1 (bottom of the window) exists too */
      for (var k = 15; k <= target + 1; k++) { els.machineReel.appendChild(machineReelRow(pool[k % pool.length])); }
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

  function setPane(pane) {
    disarmShop(false);   /* an armed BUY never survives a pane switch */
    overlayPane = pane;
    els.boardTabBoard.classList.toggle('is-on', pane === 'board');
    els.boardTabRec.classList.toggle('is-on', pane === 'records');
    els.boardTabShop.classList.toggle('is-on', pane === 'shop');
    els.boardMode.hidden = pane !== 'board';
    els.boardList.hidden = pane !== 'board';
    els.boardRecords.hidden = pane !== 'records';
    els.boardShop.hidden = pane !== 'shop';
    els.boardStatus.textContent = '';
    if (pane === 'board') {
      refreshOverlayBoard(true);
    } else {
      overlayBoardSeq++;  /* an in-flight list fetch must not repaint under another pane */
    }
    if (pane === 'records') { renderRecordsPane(); }
    if (pane === 'shop') { renderShopPane(); }
    updateMyRow();   /* non-board panes hide the chip via its own first guard */
  }

  /* The overlay's own NORMAL | HARD picker. View-only by construction: it
     only ever touches overlayMode (what is READ), never stack-mode / the
     play-mode helpers (what is PLAYED). */
  function setOverlayMode(mode, refresh) {
    overlayMode = mode === 'hard' ? 'hard' : 'normal';
    els.boardModeNormal.classList.toggle('is-on', overlayMode !== 'hard');
    els.boardModeHard.classList.toggle('is-on', overlayMode === 'hard');
    els.boardModeNormal.setAttribute('aria-pressed', overlayMode !== 'hard' ? 'true' : 'false');
    els.boardModeHard.setAttribute('aria-pressed', overlayMode === 'hard' ? 'true' : 'false');
    if (!refresh) { return; }
    overlayBoardSeq++;   /* the other board's in-flight read must not paint here */
    refreshOverlayBoard(true);
  }

  function openBoardTo(pane) {
    if (!boardOpen) {
      boardOpen = true;
      els.root.setAttribute('data-board', 'open');
      boardTimer = setInterval(function () { refreshOverlayBoard(false); }, BOARD_REFRESH_MS);
    }
    /* Open on the mode being played, so the common case needs no tap. */
    setOverlayMode(readPlayMode(), false);
    setPane(pane);
  }

  /* Opens on the board pane, all-time for the equipped mode.
     Never during play: the button is visually gone but still focusable, and
     since the shop arrived the overlay behind it can spend points. */
  function openBoard() {
    if (state.mode === 'playing') { return; }
    openBoardTo('board');
  }

  function closeBoard() {
    disarmShop(false);   /* an armed BUY never survives closing the overlay */
    if (!boardOpen) { return; }
    boardOpen = false;
    els.root.removeAttribute('data-board');
    if (boardTimer) { clearInterval(boardTimer); boardTimer = null; }
  }

  /* Records pane (third overlay tab): purely local, so it renders on tab
     entry and never polls. Every stat counts upward only; nothing here can
     shame a player for a day off, which is why days-played is deliberately
     absent. */
  function renderRecordsPane() {
    var b = readBest();
    els.recBest.textContent = String(b);
    els.recStreak.textContent = readInt(STREAK_KEY) > 0 ? readInt(STREAK_KEY) + ' PERFECT' : '0';
    els.recToday.textContent = String(readToday().best);
    els.recBlocks.textContent = String(readInt(BLOCKS_KEY));
    els.recPts.textContent = fmtPts(readInt(PTS_KEY));
    var showHard = hardUnlocked();
    els.recHardSep.hidden = !showHard;
    els.recHardRow.hidden = !showHard;
    if (showHard) { els.recHardBest.textContent = String(readHardBest()); }
    while (els.ladder.firstChild) { els.ladder.removeChild(els.ladder.firstChild); }
    var t = tierFor(b), i, row, reached, cur;
    for (i = 0; i < TIERS.length; i++) {
      reached = b >= TIERS[i][1];
      cur = t.cur && t.cur.idx === i;
      row = el('div', 'hud-ladder-row' + (cur ? ' is-cur' : reached ? ' is-done' : ''));
      row.appendChild(el('span', 'hud-ladder-mark', cur ? '◈' : reached ? '✓' : '·'));
      row.appendChild(el('span', 'hud-ladder-name', TIERS[i][0]));
      row.appendChild(el('span', 'hud-ladder-th', String(TIERS[i][1])));
      els.ladder.appendChild(row);
    }
  }

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
    var row = { name: name, score: score };
    state.postedRow = row;
    writeName(name);
    els.nameInput.disabled = true;
    els.saveBtn.disabled = true;
    els.saveBtn.textContent = 'SAVING';
    var m = deathMode();   /* captured, same reason as autoSubmit */
    submitScore(name, score, m, function (ok) {
      els.entry.classList.add('is-done');
      if (ok) {
        els.saveBtn.textContent = 'SAVED';
        refreshBoard(row, false);
      } else {
        addLocalScore(name, score, m);
        els.saveBtn.textContent = 'SAVED HERE';
        renderBoard(readLocalBoard(m), row, 'THIS DEVICE ONLY');
      }
    });
  }

  /* ------------------------------------------------------------- handlers */

  function applyScore(n) {
    if (n == null) { return; }
    n = Math.max(0, Math.round(n));
    var prev = state.score;
    state.score = n;
    renderScore();
    if (state.mode === 'title' && n > 0) { setMode('playing'); }
    if (state.mode === 'playing' && n > prev) {
      pop();
      /* Count in memory only: this runs on the frame a block lands, and a
         synchronous storage write per block costs frames. Flushed at death. */
      state.runBlocks += (n - prev);
      state.runPts += (n - prev);
      /* Tier-up: first time this run's score crosses a threshold the stored
         best had not reached. Fires at most once per tier by construction
         (the next run's baseline already includes this best). */
      /* Tiers derive from the Normal best alone (retention spec), so a Hard
         run can never cross one. Without this guard the check compares this
         run's score against the HARD best and re-announces tiers the player
         passed long ago — and at Obsidian would reach grantWorld. */
      if (state.mode === 'playing' && n > prev && deathMode() !== 'hard') {
        var base = state.runStartBest != null ? state.runStartBest : readBest();
        for (var ti = 0; ti < TIERS.length; ti++) {
          if (n >= TIERS[ti][1] && prev < TIERS[ti][1] && base < TIERS[ti][1]) {
            var tn = TIERS[ti][0];
            /* Marble grants a World and unlocks Hard; one toast carries both
               rather than firing twice into the same 2.5s window. */
            var gift = giftWorldForTier(tn);
            var got = gift ? grantWorld(gift) : false;
            if (tn === 'MARBLE') {
              showToast(got ? '▲ MARBLE · WORLD + HARD MODE' : '▲ MARBLE · HARD MODE UNLOCKED');
              /* No renderModeSwitch() here: the switch is opacity:0 /
                 pointer-events:none outside the title state, and readBest()
                 can't see this run's new peak until core's gameOver() writes
                 it, so a call at this instant is provably a no-op. It
                 un-dims correctly later, on the existing, unconditional
                 renderTitleBest() -> renderModeSwitch() at the next return
                 to title (the only time the control is visible anyway). */
            } else if (got) {
              showToast('▲ ' + tn + ' · WORLD UNLOCKED');
            } else {
              showToast('▲ ' + tn);
            }
            break;
          }
        }
      }
    }
  }

  function applyStart(detail) {
    var n = pickNumber(detail, ['score', 'value', 'points']);
    state.score = n != null ? Math.max(0, Math.round(n)) : 0;
    renderScore();
    setMode('playing');
    /* Fetch the board now, while there is a run to play, so the death
       screen it feeds can be drawn complete instead of filling in after
       the player is already looking at it. */
    runMode = (detail && detail.mode === 'hard') ? 'hard' : 'normal';
    if (!warmIsFresh(runMode)) { warmUp(runMode); }
  }

  function applyPerfect(detail) {
    if (state.mode !== 'playing') { return; }
    var combo = pickNumber(detail, ['combo']);
    /* Track the run's peak in memory; compared to storage once, at death. */
    if (combo != null && combo > state.runStreakPeak) { state.runStreakPeak = combo; }
    state.runPts += 2;   /* perfect placement: 1 (score) + 2 = 3 points */
    retrigger(els.score, 'is-flare');
  }

  function applyOver(detail) {
    deathSeq++;   /* new run: any death line still in flight from the last one is void */
    autoSeq++;    /* and so is the last run's auto-post row, whether or not this
                     run posts one of its own (a score-0 death posts nothing) */
    /* Flush the run's stat accumulators: one storage write per key per death
       instead of one per block. First thing here, so everything below (and a
       records panel opened later) reads the settled values. Trade-off: a tab
       closed mid-run loses that run's counts; upward-only stats, minor. */
    if (state.runBlocks > 0) {
      writeInt(BLOCKS_KEY, readInt(BLOCKS_KEY) + state.runBlocks);
      state.runBlocks = 0;
    }
    if (state.runStreakPeak > readInt(STREAK_KEY)) { writeInt(STREAK_KEY, state.runStreakPeak); }
    state.runStreakPeak = 0;
    /* Commit the run's points: counted in memory during play (same frame
       argument as runBlocks), doubled once per local calendar day, written
       at death. A zero-point run never consumes the daily double; an
       abandoned run loses its points like it loses its score. */
    var runPts = state.runPts;
    state.runPts = 0;
    /* Core echoes the mode the run actually used; trust it over the
       equipped setting, so there is one source of truth per finished run. */
    runMode = (detail && detail.mode === 'hard') ? 'hard' : 'normal';
    var ptsDoubled = false;
    var ptsHard = runMode === 'hard';
    if (runPts > 0) {
      if (ptsHard) { runPts *= 2; }
      if (readDaily() !== localDateStr()) {
        runPts *= 2;
        ptsDoubled = true;
        writeDaily(localDateStr());
      }
      writeInt(PTS_KEY, readInt(PTS_KEY) + runPts);
    }
    /* Both markers verbatim would wrap on a narrow phone, so the combined
       case collapses to one multiplier. */
    var ptsMark = '';
    if (ptsHard && ptsDoubled) { ptsMark = ' · ×4'; }
    else if (ptsHard) { ptsMark = ' · HARD ×2'; }
    else if (ptsDoubled) { ptsMark = ' · FIRST RUN ×2'; }
    els.overPts.textContent = runPts > 0 ? '+' + runPts + ' PTS' + ptsMark : '';
    els.overPts.hidden = !(runPts > 0);
    var s = pickNumber(detail, ['score', 'value', 'points']);
    if (s != null) { state.score = Math.max(0, Math.round(s)); renderScore(); }
    var finalScore = state.score;
    /* Bobo, the booby prize: the first score-0 death in either mode.
       grantWorld returns true only when the grant is new, so the toast
       cannot repeat. Never equips, same as the tier gifts — dropping a
       brown World on someone the instant they fumble block one would be a
       punishment. Hard counts: this is a joke, not an achievement, so a
       mode gate would be a rule with no payoff (Maor, 2026-08-02). */
    if (finalScore === 0 && grantWorld('bobo')) {
      showToast('▲ BOBO · WORLD UNLOCKED');
    }
    var gameBest = pickNumber(detail, ['best', 'highscore', 'hiScore']) || 0;
    var storedBest = bestFor(runMode);
    var baseline = state.runStartBest != null ? state.runStartBest : storedBest;
    var isNewBest = finalScore > 0 && finalScore > baseline && finalScore >= gameBest;
    var best = Math.max(storedBest, gameBest, finalScore);
    /* core.js owns the write for both modes; hud only mirrors Normal's key
       for the tier ladder, which must never see a Hard score. */
    if (runMode === 'normal' && best > storedBest) { writeBest(best); }
    /* TODAY stays a Normal statistic. It sits directly under BEST in the
       records panel, which is Normal's by spec, and a shared TODAY could
       render "TODAY 41" above "BEST 30" for anyone whose Hard run beat
       their Normal best — visibly broken. Blocks-ever and best-streak stay
       shared per the spec table; this one row does not. */
    var today = readToday();
    if (runMode === 'normal' && finalScore > today.best) { today.best = finalScore; writeToday(today); }
    /* Density revision 2026-07-31: no tier vocabulary on the death screen.
       The ladder lives in the trophy overlay's RECORDS tab; the toast owns
       the tier-up moment. */
    els.overTier.hidden = true;
    els.overTier.textContent = '';

    els.overScore.textContent = String(finalScore);
    els.overBest.textContent = (runMode === 'hard' ? 'HARD BEST ' : 'BEST ') + best;
    els.newBest.hidden = !isNewBest;
    els.overVictim.hidden = true;
    els.overVictim.textContent = '';

    els.quip.textContent = nextQuip();
    state.submitted = false;
    state.postedRow = null;
    var autoName = readName();
    els.nameInput.disabled = false;
    els.nameInput.value = autoName;
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = 'SAVE';
    els.entry.classList.remove('is-done');
    hideAutoRow();
    deathBoardSeq++;   /* a request from the last death screen must not paint here */
    els.lbStatus.textContent = '';   /* and must not leave its LOADING label stuck either */
    /* Fill the board-fed parts now, from the rows warmed at run start. A
       known player's screen used to wait for the score post to answer
       before any of this appeared, so the quip grew a second line and the
       chase line arrived while the screen was being read. */
    if (warmIsFresh(runMode)) {
      paintSandwich(warmRowsFor('all', runMode), null);
      var wday = warmRowsFor('day', runMode);
      if (wday) { applyRoastOnce(wday); }
    } else {
      /* No rows to draw a rival from, and the failed-submit path renders the
         device list without ever reaching paintSandwich. Seed the own-best
         target so an offline death still says what to beat; a board read
         that lands later replaces this line with a real name. */
      showVictim(null, null);
    }
    if (finalScore > 0 && autoName) {
      /* Known player: the run posts itself; the keyboard stays away. */
      els.entry.hidden = true;
      autoSubmit(autoName, finalScore);
    } else {
      els.entry.hidden = !(finalScore > 0);
      refreshBoard(null, true);
    }

    state.overAt = Date.now();
    setMode('over');
  }

  function applyReady() {
    state.score = 0;
    renderScore();
    renderTitleBest();   /* a menu return after a new best must show it */
    setMode('title');
  }

  /* --------------------------------------------------------------- wiring */

  function on(names, fn) {
    var handler = function (ev) {
      if (ev.__hudSeen) { return; } /* dedupe window+document double delivery */
      try { ev.__hudSeen = true; } catch (err) { /* ignore */ }
      fn(ev && ev.detail);
    };
    for (var i = 0; i < names.length; i++) {
      window.addEventListener(names[i], handler);
      document.addEventListener(names[i], handler);
    }
  }

  function wireIncoming() {
    on(['game:start', 'game-start', 'gamestart'], applyStart);
    on(['game:score', 'game-score', 'score'], function (d) {
      applyScore(pickNumber(d, ['score', 'value', 'points']));
    });
    on(['game:perfect', 'game-perfect', 'perfect'], applyPerfect);
    on(['game:over', 'game:gameover', 'game-over', 'gameover'], function (d) { applyOver(d || {}); });
    on(['game:ready', 'game:reset', 'game:title'], applyReady);
  }

  function tryStart(ev) {
    /* The title screen is tap-anywhere-to-start. */
    if (state.mode !== 'title') { return; }
    emit('hud:start');
    state.score = 0;
    renderScore();
    setMode('playing');
  }

  function tryRestart(ev) {
    /* Taps on the name entry are for typing/saving, never restarts. */
    if (ev && ev.target && ev.target.closest && ev.target.closest('.hud-lb-entry, .hud-lb-auto, .hud-over-menu')) { return; }
    if (state.mode !== 'over') { return; }
    var now = Date.now();
    if (now - state.overAt < RESTART_LOCKOUT_MS) { return; }
    if (now - state.lastRestart < RESTART_DEDUPE_MS) { return; }
    state.lastRestart = now;
    emit('hud:restart');
    state.score = 0;
    renderScore();
    setMode('playing');
  }

  function wireOutgoing() {
    /* Taps: never stopPropagation — the game's own global tap handler,
       if it has one, must keep seeing these. */
    els.title.addEventListener('pointerdown', tryStart);
    els.over.addEventListener('pointerdown', tryRestart);
    els.restart.addEventListener('click', tryRestart);
    els.saveBtn.addEventListener('click', trySave);
    els.autoBtn.addEventListener('click', changeName);
    els.overMenu.addEventListener('click', function () {
      if (state.mode !== 'over') { return; }
      emit('hud:menu');   /* core flips to ready and answers with game:ready */
    });
    els.nameInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); trySave(); }
    });
    els.boardBtn.addEventListener('click', openBoard);
    els.shopPill.addEventListener('click', function () {
      if (state.mode !== 'title') { return; }
      openBoardTo('shop');
    });
    els.modeNormal.addEventListener('click', function () {
      if (state.mode !== 'title') { return; }
      setPlayMode('normal');
    });
    els.modeHard.addEventListener('click', function () {
      if (state.mode !== 'title') { return; }
      setPlayMode('hard');
    });
    els.boardClose.addEventListener('click', closeBoard);
    /* state.postedRow, not readName(): after a NOT YOU? rename the row on the
       board still carries the old name, and that is the row to highlight. */
    els.boardTabBoard.addEventListener('click', function () { setPane('board'); });
    els.boardTabRec.addEventListener('click', function () { setPane('records'); });
    els.boardTabShop.addEventListener('click', function () { setPane('shop'); });
    els.boardModeNormal.addEventListener('click', function () { setOverlayMode('normal', true); });
    els.boardModeHard.addEventListener('click', function () { setOverlayMode('hard', true); });
    keepKeysLocal(els.boardTabBoard);
    keepKeysLocal(els.boardTabRec);
    keepKeysLocal(els.boardTabShop);
    /* Same treatment as every other control inside .hud-board: Space/Enter
       here must not bubble to core.js's own window keydown listener, which
       knows nothing of boardOpen and would drop a block or start a run
       behind the open overlay (the exact bug class keepKeysLocal exists
       for elsewhere in this file — see boardClose). Brief gap, fixed here. */
    keepKeysLocal(els.boardModeNormal);
    keepKeysLocal(els.boardModeHard);
    /* The chip tracks scroll position live: a partial drag can bring my row
       fully into view (or push it back out) without a re-render happening. */
    els.boardList.addEventListener('scroll', updateMyRow);
    els.boardMyRow.addEventListener('click', function () {
      var mine = els.boardList.querySelector('.hud-lb-mine');
      if (!mine) { return; }
      try { mine.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' }); }
      catch (err) { mine.scrollIntoView(); }
    });
    keepKeysLocal(els.boardMyRow);
    els.shopGrid.addEventListener('click', function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest('.hud-shop-card') : null;
      if (!btn) { disarmShop(true); return; }        /* machine or gap: just disarm */
      var id = btn.getAttribute('data-world');
      var w = WORLD_BY_ID[id];
      if (!w) { return; }
      if (id === readWorld()) { disarmShop(true); return; } /* already on */
      if (ownsWorld(id)) {                            /* owned: equip */
        disarmShop(false);
        equipWorld(id);
        renderShopPane();
        return;
      }
      /* Secret Worlds are earned, never bought. Unconditional on the flag:
         an owned World has already returned above, so anything reaching
         here is unowned. This is defence in depth, not the primary guard —
         renderShopPane hiding the card via display:none already keeps a
         real user from ever reaching it. But a programmatic .click() or a
         dispatched KeyboardEvent still reaches this handler regardless of
         rendering, and price 0 would otherwise pass `bal < price` and hand
         the World over free on the second tap. Any future change that
         renders a secret card in some other context would inherit the same
         guard instead of a fresh hole. */
      if (w.secret) { disarmShop(true); return; }
      if (w.giftAt > 0) { disarmShop(true); return; } /* locked gift */
      var bal = readInt(PTS_KEY);
      if (bal < w.price) { disarmShop(true); return; }
      if (shopArm.id === id) {                        /* second tap: buy */
        disarmShop(false);
        writeInt(PTS_KEY, bal - w.price);
        grantWorld(id);
        equipWorld(id);   /* buying means wanting it on (spec) */
        renderShopPane();
        renderShopPill();   /* the title pill must not show a stale balance */
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
    els.machineSpin.addEventListener('click', spinMachine);
    keepKeysLocal(els.machineSpin);
    var REDEEM_CODE = 'MAOR-SEES-ALL';
    function applyRedeem() {
      var v = String(els.redeemInput.value || '').replace(/\s+/g, '').toUpperCase();
      if (v !== REDEEM_CODE) {
        els.redeemMsg.textContent = v ? 'NOTHING HAPPENS.' : '';
        return;
      }
      for (var ri = 0; ri < SINGLES.length; ri++) { grantSingle(SINGLES[ri].id); }
      for (var rw = 0; rw < WORLDS.length; rw++) {
        if (WORLDS[rw].price > 0) { grantWorld(WORLDS[rw].id); }
      }
      els.redeemInput.value = '';
      els.redeemMsg.textContent = 'FULL CATALOG UNLOCKED';
      renderShopPane();
      renderShopPill();
    }
    els.redeemBtn.addEventListener('click', applyRedeem);
    keepKeysLocal(els.redeemBtn);
    /* The input takes Enter as APPLY and keeps Space out of core's window
       drop/start listener, same class of shielding as keepKeysLocal but
       without eating the characters being typed. */
    els.redeemInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); applyRedeem(); return; }
      if (ev.key === ' ' || ev.key === 'Spacebar') { ev.stopPropagation(); }
    });
    els.muteBtn.addEventListener('click', toggleMute);
    els.board.addEventListener('pointerdown', function (ev) {
      if (ev.target === els.board) { closeBoard(); } /* tap outside the panel */
    });

    /* Corner and overlay buttons are keyboard-operable: Enter/Space must
       activate the button, not fall through to the window-level
       start/restart/drop keys. core.js listens on window too and calls
       preventDefault, which would eat the button's own activation, so every
       focusable control the player can Tab to has to stop these keys here. */
    function keepKeysLocal(btn) {
      btn.addEventListener('keydown', function (ev) {
        if (ev.key === ' ' || ev.key === 'Enter' || ev.key === 'Spacebar') { ev.stopPropagation(); }
      });
    }
    keepKeysLocal(els.muteBtn);
    keepKeysLocal(els.boardBtn);
    keepKeysLocal(els.autoBtn);
    keepKeysLocal(els.boardClose);
    keepKeysLocal(els.overMenu);
    keepKeysLocal(els.shopPill);

    window.addEventListener('keydown', function (ev) {
      if (ev.repeat) { return; }
      if (els && (ev.target === els.nameInput || ev.target === els.redeemInput)) { return; } /* typing, not restarting */
      if (boardOpen) {
        if (ev.key === 'Escape') {
          ev.preventDefault();
          closeBoard();
        }
        /* This handler stops here, but core.js has its own window keydown
           listener that no return of ours can reach, which is why the
           overlay's own controls call keepKeysLocal. */
        return;
      }
      var k = ev.key;
      if (k !== ' ' && k !== 'Enter' && k !== 'Spacebar') { return; }
      if (state.mode === 'title') { ev.preventDefault(); tryStart(); }
      else if (state.mode === 'over') { ev.preventDefault(); tryRestart(); }
      /* playing: the game owns space/click for drops; HUD stays out */
    });
  }

  /* ----------------------------------------------------------------- init */

  var api = {
    setScore: function (n) { applyScore(pickNumber(n, ['score', 'value', 'points'])); },
    start: function (detail) { applyStart(detail); },
    perfect: function () { applyPerfect(); },
    gameOver: function (detail) { applyOver(detail || {}); },
    reset: function () { applyReady(); },
    get state() { return state.mode; },
    get score() { return state.score; },
    get best() { return readBest(); }
  };

  function init() {
    if (els) { return; }
    ensureCss();
    els = buildDom();
    document.body.appendChild(els.root);
    wireIncoming();
    wireOutgoing();
    muteOn = readMuted();
    applyMuteUi(muteOn);
    applyReady(); /* boot into title state */
    /* Read the board once at boot as well as at run start: the trophy is
       reachable from the title before anyone has played, and that first
       open is the one most likely to catch an empty list. */
    warmUp(readPlayMode());
    /* Boot World broadcast. DOMContentLoaded is the deterministic "all
       classic scripts have executed" line: on network loads a 0ms timer
       can fire BETWEEN script downloads (audio.js not yet parsed, its
       listener missing), which is exactly the live flake this replaces.
       Past DCL a 0ms timer is safe. Gifts earned before this feature
       shipped arrive silently here, never equipped. */
    var fireBoot = function () {
      var b = readBest();
      for (var i = 0; i < WORLDS.length; i++) {
        if (WORLDS[i].giftAt > 0 && b >= WORLDS[i].giftAt) { grantWorld(WORLDS[i].id); }
      }
      fireWorld(readWorld());
      fireGear();
      /* Same DOMContentLoaded gate as the World broadcast, and for the same
         reason: core.js may not have executed when a 0ms timer fires. */
      var m = readPlayMode();
      writePlayMode(m);   /* rewrite, so a corrupt 'hard' is corrected on disk */
      firePlayMode(m);
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fireBoot);
    } else {
      setTimeout(fireBoot, 0);
    }
    window.HUD = window.HUD || api;
  }

  if (document.body) { init(); }
  else { document.addEventListener('DOMContentLoaded', init); }
})();
