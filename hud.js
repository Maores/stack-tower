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
    submitted: false    /* this run's score already sent to the board */
  };

  var els = null;

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
    var newBest = el('div', 'hud-over-newbest hud-anim d4', 'NEW BEST');
    newBest.hidden = true;
    var lb = el('div', 'hud-lb hud-anim d5');
    var lbTitle = el('div', 'hud-lb-title', 'TOP 10');
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
    panel.appendChild(newBest);
    panel.appendChild(lb);
    panel.appendChild(restart);
    panel.appendChild(overHint);
    over.appendChild(backdrop);
    over.appendChild(panel);

    root.appendChild(scoreWrap);
    root.appendChild(title);
    root.appendChild(over);

    return {
      root: root,
      score: score,
      title: title,
      titleBest: titleBest,
      over: over,
      overScore: overScore,
      overBest: overBest,
      newBest: newBest,
      restart: restart,
      quip: quip,
      lbStatus: lbStatus,
      lbList: lbList,
      entry: entry,
      nameInput: nameInput,
      saveBtn: saveBtn
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

  var LB_URL = 'https://uidxgisstzpsmepoatpm.supabase.co/rest/v1/stack_scores';
  /* Publishable key by design: safe in public clients, access is RLS-gated. */
  var LB_KEY = 'sb_publishable_xW4Ov4SgXIxL6wT2sZ2fuw_0fAO7vbI';
  var LB_QUERY = '?select=name,score&order=score.desc,created_at.asc&limit=10';
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

  function readName() {
    try { return String(window.localStorage.getItem(NAME_KEY) || ''); } catch (err) { return ''; }
  }

  function writeName(v) {
    try { window.localStorage.setItem(NAME_KEY, v); } catch (err) { /* ignore */ }
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

  function fetchTop(cb) {
    if (!window.fetch) { cb(null); return; }
    var done = false;
    var finish = function (rows) { if (!done) { done = true; cb(rows); } };
    var timer = setTimeout(function () { finish(null); }, LB_TIMEOUT_MS);
    try {
      window.fetch(LB_URL + LB_QUERY, { headers: { apikey: LB_KEY } })
        .then(function (r) { if (!r.ok) { throw new Error('http ' + r.status); } return r.json(); })
        .then(function (rows) { clearTimeout(timer); finish(Array.isArray(rows) ? rows : null); })
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

  function renderBoard(rows, mine, label) {
    els.lbStatus.textContent = label || '';
    while (els.lbList.firstChild) { els.lbList.removeChild(els.lbList.firstChild); }
    if (!rows || !rows.length) {
      els.lbList.appendChild(el('li', 'hud-lb-empty', 'NO SCORES YET'));
      return;
    }
    var mineMarked = false;
    for (var i = 0; i < rows.length && i < 10; i++) {
      var r = rows[i] || {};
      var li = el('li', null);
      li.appendChild(el('span', 'hud-lb-name', String(r.name == null ? '?' : r.name).slice(0, 16)));
      li.appendChild(el('span', 'hud-lb-pts', String(r.score == null ? 0 : r.score)));
      if (!mineMarked && mine && r.name === mine.name && r.score === mine.score) {
        li.className = 'hud-lb-mine';
        mineMarked = true;
      }
      els.lbList.appendChild(li);
    }
  }

  function refreshBoard(mine) {
    els.lbStatus.textContent = 'LOADING';
    fetchTop(function (rows) {
      if (rows) { renderBoard(rows, mine, ''); }
      else { renderBoard(readLocalBoard(), mine, 'THIS DEVICE ONLY'); }
    });
  }

  function trySave() {
    if (state.mode !== 'over' || state.submitted) { return; }
    var name = (els.nameInput.value || '').replace(/\s+/g, ' ').trim().slice(0, 16);
    var score = state.score;
    if (!name) {
      retrigger(els.entry, 'is-shake');
      try { els.nameInput.focus(); } catch (err) { /* ignore */ }
      return;
    }
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

  /* ------------------------------------------------------------- handlers */

  function applyScore(n) {
    if (n == null) { return; }
    n = Math.max(0, Math.round(n));
    var prev = state.score;
    state.score = n;
    renderScore();
    if (state.mode === 'title' && n > 0) { setMode('playing'); }
    if (state.mode === 'playing' && n > prev) { pop(); }
  }

  function applyStart(detail) {
    var n = pickNumber(detail, ['score', 'value', 'points']);
    state.score = n != null ? Math.max(0, Math.round(n)) : 0;
    renderScore();
    setMode('playing');
  }

  function applyPerfect() {
    if (state.mode !== 'playing') { return; }
    retrigger(els.score, 'is-flare');
  }

  function applyOver(detail) {
    var s = pickNumber(detail, ['score', 'value', 'points']);
    if (s != null) { state.score = Math.max(0, Math.round(s)); renderScore(); }
    var finalScore = state.score;
    var gameBest = pickNumber(detail, ['best', 'highscore', 'hiScore']) || 0;
    var storedBest = readBest();
    var baseline = state.runStartBest != null ? state.runStartBest : storedBest;
    var isNewBest = finalScore > 0 && finalScore > baseline && finalScore >= gameBest;
    var best = Math.max(storedBest, gameBest, finalScore);
    if (best > storedBest) { writeBest(best); }

    els.overScore.textContent = String(finalScore);
    els.overBest.textContent = 'BEST ' + best;
    els.newBest.hidden = !isNewBest;

    els.quip.textContent = nextQuip();
    state.submitted = false;
    els.nameInput.disabled = false;
    els.nameInput.value = readName();
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = 'SAVE';
    els.entry.classList.remove('is-done');
    els.entry.hidden = !(finalScore > 0);
    refreshBoard(null);

    state.overAt = Date.now();
    setMode('over');
  }

  function applyReady() {
    state.score = 0;
    renderScore();
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

  function tryStart() {
    if (state.mode !== 'title') { return; }
    emit('hud:start');
    state.score = 0;
    renderScore();
    setMode('playing');
  }

  function tryRestart(ev) {
    /* Taps on the name entry are for typing/saving, never restarts. */
    if (ev && ev.target && ev.target.closest && ev.target.closest('.hud-lb-entry')) { return; }
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
    els.nameInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); trySave(); }
    });

    window.addEventListener('keydown', function (ev) {
      if (ev.repeat) { return; }
      if (els && ev.target === els.nameInput) { return; } /* typing, not restarting */
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
    applyReady(); /* boot into title state */
    window.HUD = window.HUD || api;
  }

  if (document.body) { init(); }
  else { document.addEventListener('DOMContentLoaded', init); }
})();
