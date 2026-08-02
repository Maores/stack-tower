/* ==========================================================================
   audio.js — Stack tower sound layer (glassy minimal, WebAudio, no assets).

   Consumes existing DOM CustomEvents only; never reaches into another
   file's internals:
     'stack:placed' { perfect }   placement sound + streak tracking
     'game:start'                 streak reset
     'game:over'                  streak reset only (game over is silent)
     'hud:mute'    { muted }      mute state pushed by the HUD button
     'hud:world'   { id }         chime voice follows the active World

   Shared constant with hud.js: localStorage 'stack-muted' ('1' | '0',
   absent = sound on). hud.js owns the button and persistence; this file
   reads the key once at boot and then follows 'hud:mute' events.

   Public API (window.StackAudio):
     version                   '1.1.0'
     isReady()                 AudioContext exists (created on first gesture)
     muted                     live boolean
     setMuted(m)               runtime mute; persistence stays with the HUD
     debug: { played, last, world, state() }   scheduled-voice counter, last
                               voice name, resolved World id, and context
                               state, for tests
   ========================================================================== */
(function () {
  'use strict';

  if (window.StackAudio) { return; }

  var MUTE_KEY = 'stack-muted';   /* shared with hud.js */
  var MASTER_GAIN = 0.5;
  /* Per-World chime voices: base note + scale per World, same synthesis.
     Major scale for the bright Worlds, natural minor for the deep and dark
     ones; tap is the sliced-placement thunk center. Keyed by the ids the
     HUD broadcasts on hud:world; unknown ids fall back to classic.

     Diatomic since 2026-08-02 (Maor): the streak now walks do-re-mi-fa-sol
     one step at a time. It was pentatonic, which skipped fa and ti and so
     jumped mi straight to sol — audible, and the thing he asked to fix.
     The trade the pentatonic was making: with no semitone steps, no two
     notes in a long streak can clash. A full scale reintroduces mi-fa and
     ti-do, which is exactly what makes it read as a scale. Seven notes also
     cover less ground than five over the same eleven rungs, so the streak
     peak now lands about half an octave lower than it used to. */
  var WORLD_SOUND = {
    classic:  { base: 523.25, tap: 440, ladder: [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17] },
    sunset:   { base: 440.00, tap: 392, ladder: [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17] },
    neon:     { base: 587.33, tap: 494, ladder: [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17] },
    deepsea:  { base: 392.00, tap: 349, ladder: [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17] },
    marble:   { base: 466.16, tap: 415, ladder: [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17] },
    obsidian: { base: 349.23, tap: 311, ladder: [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17] }
  };
  var sound = WORLD_SOUND.classic;

  var ctx = null, master = null, noiseBuf = null;
  var streak = 0;
  var muted = false;
  var dbg = { played: 0, last: '' };
  dbg.state = function () { return ctx ? ctx.state : 'none'; };
  dbg.world = 'classic';

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
  /* Touch browsers grant audio permission on the END of a tap, not the
     start: a pointerdown-only unlock loses the whole first tap (and the
     second tap's sound fires while resume() is still settling). */
  window.addEventListener('pointerup', wake, true);
  window.addEventListener('touchend', wake, true);
  window.addEventListener('click', wake, true);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && ctx) { wake(); }
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
    tone(t, 'triangle', sound.tap + (Math.random() * 30 - 15), 0.35, 0.14);
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

  /* Perfect placement: chime stepping up the pentatonic ladder. Climbs for
     the first 10 steps; past the cap it rotates the three highest notes so
     the peak shimmers instead of repeating one chime. */
  function playPerfect(t, step) {
    var idx = step <= 10 ? step : 8 + ((step - 11) % 3);
    var f = sound.base * Math.pow(2, sound.ladder[idx] / 12);
    tone(t, 'sine', f, 0.45, 0.35);
    tone(t, 'sine', f * 2 * 1.003, 0.18, 0.35);   /* shimmer partial */
  }

  function speak(name, fn, arg) {
    try {
      fn(ctx.currentTime, arg);
      dbg.played++;
      dbg.last = name;
    } catch (err) { /* audio must never break the game */ }
  }

  function voice(name, fn, arg) {
    if (muted || !ctx) { return; }
    if (ctx.state === 'running') { speak(name, fn, arg); return; }
    /* Mid-wakeup (resume() still settling): play the sound the moment the
       context runs instead of dropping it — that gap is the audible first
       placement. A short freshness cap keeps a stalled resume from firing
       a ghost sound seconds later. */
    try {
      var p = ctx.resume();
      if (p && p.then) {
        var asked = Date.now();
        p.then(function () {
          if (muted || Date.now() - asked > 300) { return; }
          speak(name, fn, arg);
        }, function () { /* rejected resume: stay silent */ });
      }
    } catch (err) { /* ignore */ }
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

  window.addEventListener('game:over', function () { streak = 0; });

  window.addEventListener('hud:mute', function (e) {
    setMuted(!!(e && e.detail && e.detail.muted));
  });

  window.addEventListener('hud:world', function (e) {
    var id = e && e.detail ? String(e.detail.id) : '';
    var key = WORLD_SOUND[id] ? id : 'classic';
    sound = WORLD_SOUND[key];
    dbg.world = key;
  });

  /* -------------------------------------------------------------- api */

  var api = {
    version: '1.1.0',
    isReady: function () { return !!ctx; },
    muted: muted,
    setMuted: setMuted,
    debug: dbg
  };

  window.StackAudio = api;
})();
