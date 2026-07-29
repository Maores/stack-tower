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
