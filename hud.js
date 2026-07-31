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

   OUTGOING (HUD -> game): dispatched on window:

     "hud:start"    user tapped the title screen (HUD flips to playing
                    optimistically; a later game:start is harmless)
     "hud:restart"  user tapped restart on the game-over screen

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
  var RESTART_LOCKOUT_MS = 500;  /* ignore taps right after game over */
  var RESTART_DEDUPE_MS = 400;   /* pointerdown + click on button = one restart */

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
    var lb = el('div', 'hud-lb hud-anim d5');
    var lbTitle = el('div', 'hud-lb-title', 'TOP TOWERS');
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
    lb.appendChild(lbTitle);
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
    var boardTitle = el('div', 'hud-lb-title', 'TOP TOWERS');
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

    var boardList = el('ol', 'hud-lb-list hud-board-list');
    /* TODAY-tab percentile header (density revision: relocated from death) */
    var boardPct = el('div', 'hud-board-pct', '');
    boardPct.hidden = true;
    boardPanel.appendChild(boardClose);
    boardPanel.appendChild(boardTitle);
    boardPanel.appendChild(boardStatus);
    boardPanel.appendChild(boardTabs);
    boardPanel.appendChild(boardSeg);
    boardPanel.appendChild(boardPct);
    boardPanel.appendChild(boardRecords);
    boardPanel.appendChild(boardShop);
    boardPanel.appendChild(boardList);
    board.appendChild(boardPanel);

    /* Tier-up toast: fixed top-center, above everything, never interactive. */
    var toast = el('div', 'hud-toast', '');
    toast.setAttribute('aria-live', 'polite');

    root.appendChild(scoreWrap);
    root.appendChild(title);
    root.appendChild(over);
    root.appendChild(boardBtn);
    root.appendChild(muteBtn);
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
      segDay: segDay,
      segAll: segAll,
      boardSeg: boardSeg,
      boardShop: boardShop,
      shopBalVal: shopBalVal,
      boardPct: boardPct,
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
      board: board,
      boardStatus: boardStatus,
      boardList: boardList,
      boardClose: boardClose,
      boardRecords: boardRecords,
      ladder: ladder,
      recBest: recBest.val,
      recStreak: recStreak.val,
      recToday: recToday.val,
      recBlocks: recBlocks.val,
      recPts: recPts.val
    };
  }

  /* ---------------------------------------------------------------- state */

  function setMode(mode) {
    if (state.mode === mode) { return; }
    if (mode === 'playing') {
      /* Snapshot the pre-run best now: by game-over time the game layer may
         already have persisted the new best under the same storage key, so a
         read at that point can never detect "beat my old best". */
      state.runStartBest = readBest();
      state.runBlocks = 0;      /* fresh in-memory accumulators for this run */
      state.runStreakPeak = 0;
      state.runPts = 0;
    }
    state.mode = mode;
    els.root.setAttribute('data-state', mode);
    if (mode === 'title') { renderTitleBest(); }
  }

  function renderTitleBest() {
    var best = readBest();
    els.titleBest.textContent = best > 0 ? 'BEST ' + best : '';
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

  /* Every read is Normal-mode only; Hard gets its own board when modes ship. */
  function scopeFilter(scope) {
    var f = '&mode=eq.normal';
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
  var quipBag = [];
  var autoSeq = 0;

  function nextQuip() {
    if (!quipBag.length) {
      quipBag = QUIPS.slice();
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
    return fillRoast(pickFrom(rv.score === myScore ? ROAST_TIE : ROAST_RIVAL), rv.name, rv.score);
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
    submitScore(name, score, function (ok) {
      if (!ok) { addLocalScore(name, score); } /* record even mid-restart */
      if (seq !== autoSeq || state.mode !== 'over') { return; }
      if (ok) {
        setAutoRow('SAVED AS ' + lrm(name), true);
        refreshBoard(row, true);
      } else {
        setAutoRow('SAVED HERE AS ' + lrm(name), true);
        renderBoard(readLocalBoard(), row, 'THIS DEVICE ONLY');
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

  function readLocalBoard() {
    try {
      var rows = JSON.parse(window.localStorage.getItem(LOCAL_BOARD_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (err) { return []; }
  }

  function addLocalScore(name, score) {
    var rows = readLocalBoard();
    rows.push({ name: name, score: score });
    rows.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    rows = rows.slice(0, 10);
    try { window.localStorage.setItem(LOCAL_BOARD_KEY, JSON.stringify(rows)); } catch (err) { /* ignore */ }
    return rows;
  }

  function fetchTop(scope, cb, full) {
    if (!window.fetch) { cb(null); return; }
    var done = false;
    var finish = function (rows) { if (!done) { done = true; cb(rows); } };
    var timer = setTimeout(function () { finish(null); }, LB_TIMEOUT_MS);
    try {
      window.fetch(LB_URL + LB_SELECT + scopeFilter(scope), { headers: { apikey: LB_KEY } })
        .then(function (r) { if (!r.ok) { throw new Error('http ' + r.status); } return r.json(); })
        .then(function (rows) {
          clearTimeout(timer);
          /* full: the sandwich needs the whole deduped ranking, not the top 10 */
          finish(Array.isArray(rows) ? (full ? dedupeBest(rows) : dedupeBest(rows).slice(0, 10)) : null);
        })
        .catch(function () { clearTimeout(timer); finish(null); });
    } catch (err) { clearTimeout(timer); finish(null); }
  }

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

  function submitScore(name, score, cb) {
    if (!window.fetch) { cb(false); return; }
    var done = false;
    var finish = function (ok) { if (!done) { done = true; cb(ok); } };
    var timer = setTimeout(function () { finish(false); }, LB_TIMEOUT_MS);
    try {
      window.fetch(LB_URL, {
        method: 'POST',
        headers: { apikey: LB_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, score: score })
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
      if (!mineMarked && mine && r.name === mine.name && r.score === mine.score) {
        li.className = 'hud-lb-mine';
        mineMarked = true;
      }
      listEl.appendChild(li);
    }
  }

  function renderBoard(rows, mine, label) {
    /* Death-screen fallback list matches the sandwich scale: 3 rows; the
       trophy overlay keeps the full 10 (density revision, 2026-07-31). */
    renderRows(els.lbList, els.lbStatus, rows, mine, label, 3);
  }

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

  /* Overlay TODAY header: "YOU: TOP n% TODAY" for today's device best.
     Same hiding rules as the old death-screen line: window >= 10, both
     counts healthy, never 100%. Relocated here by the density revision. */
  function showPercentile() {
    var myToday = readToday().best;
    els.boardPct.hidden = true;
    els.boardPct.textContent = '';
    if (!(myToday > 0)) { return; }
    var windowF = scopeFilter('day');
    countRows(windowF, function (total) {
      if (overlayPane !== 'board' || overlayScope !== 'day' || total == null || total < 10) { return; }
      countRows(windowF + '&score=gt.' + myToday, function (above) {
        if (overlayPane !== 'board' || overlayScope !== 'day' || above == null) { return; }
        var pct = Math.max(1, Math.round(((above + 1) / total) * 100));
        /* Dead last reads as "TOP 100%"; not a brag worth printing. */
        if (pct >= 100) { return; }
        els.boardPct.textContent = 'YOU: TOP ' + pct + '% TODAY';
        els.boardPct.hidden = false;
      });
    });
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

  /* Death screen data: one full all-time fetch for the rank sandwich, one
     daily fetch for the roast. Tokens keep their jobs: deathBoardSeq drops a
     stale paint, deathSeq drops everything from a previous death. */
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

  /* Standalone board view: opens from the corner trophy, refreshes itself
     every 15s while open so nobody has to reload anything. */
  var overlayScope = 'all';
  var overlayPane = 'board';
  var boardOpen = false;
  var boardTimer = null;
  var BOARD_REFRESH_MS = 15000;

  function refreshOverlayBoard(showLoading) {
    if (overlayPane !== 'board') { return; }  /* records/shop panes are local: the 15s tick must not fetch */
    var seq = ++overlayBoardSeq;
    if (showLoading) { els.boardStatus.textContent = 'LOADING'; }
    fetchTop(overlayScope, function (rows) {
      if (!boardOpen || seq !== overlayBoardSeq) { return; }
      if (rows) { renderRows(els.boardList, els.boardStatus, rows, null, ''); }
      else { renderRows(els.boardList, els.boardStatus, readLocalBoard(), null, 'THIS DEVICE ONLY'); }
    });
  }

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

  function closeBoard() {
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
    els.recPts.textContent = String(readInt(PTS_KEY));
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
    submitScore(name, score, function (ok) {
      els.entry.classList.add('is-done');
      if (ok) {
        els.saveBtn.textContent = 'SAVED';
        refreshBoard(row, false);
      } else {
        addLocalScore(name, score);
        els.saveBtn.textContent = 'SAVED HERE';
        renderBoard(readLocalBoard(), row, 'THIS DEVICE ONLY');
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
      var base = state.runStartBest != null ? state.runStartBest : readBest();
      for (var ti = 0; ti < TIERS.length; ti++) {
        if (n >= TIERS[ti][1] && prev < TIERS[ti][1] && base < TIERS[ti][1]) {
          showToast('▲ ' + TIERS[ti][0]);
          break;
        }
      }
    }
  }

  function applyStart(detail) {
    var n = pickNumber(detail, ['score', 'value', 'points']);
    state.score = n != null ? Math.max(0, Math.round(n)) : 0;
    renderScore();
    setMode('playing');
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
    var s = pickNumber(detail, ['score', 'value', 'points']);
    if (s != null) { state.score = Math.max(0, Math.round(s)); renderScore(); }
    var finalScore = state.score;
    var gameBest = pickNumber(detail, ['best', 'highscore', 'hiScore']) || 0;
    var storedBest = readBest();
    var baseline = state.runStartBest != null ? state.runStartBest : storedBest;
    var isNewBest = finalScore > 0 && finalScore > baseline && finalScore >= gameBest;
    var best = Math.max(storedBest, gameBest, finalScore);
    if (best > storedBest) { writeBest(best); }
    var today = readToday();
    if (finalScore > today.best) { today.best = finalScore; writeToday(today); }
    /* Density revision 2026-07-31: no tier vocabulary on the death screen.
       The ladder lives in the trophy overlay's RECORDS tab; the toast owns
       the tier-up moment. */
    els.overTier.hidden = true;
    els.overTier.textContent = '';

    els.overScore.textContent = String(finalScore);
    els.overBest.textContent = 'BEST ' + best;
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
    els.boardClose.addEventListener('click', closeBoard);
    /* state.postedRow, not readName(): after a NOT YOU? rename the row on the
       board still carries the old name, and that is the row to highlight. */
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

    window.addEventListener('keydown', function (ev) {
      if (ev.repeat) { return; }
      if (els && ev.target === els.nameInput) { return; } /* typing, not restarting */
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
    window.HUD = window.HUD || api;
  }

  if (document.body) { init(); }
  else { document.addEventListener('DOMContentLoaded', init); }
})();
