/* ==========================================================================
   core.js - Stack tower game, core mechanics layer (owned by core-mechanics).

   Owns: block spawn/slide/drop loop, overhang slicing, tower data structure,
   debris physics, camera rise/zoom, input (click / tap / space), phases.

   Public API (window.StackCore):
     on(event, cb) / off(event, cb)   internal event bus, events below
     getTowerState()                  live state snapshot (also window.getTowerState)
     setMaterialFactory(fn)           fn(info) -> THREE.Material; info =
                                      { index, hue (deg), sat, light, isBase }.
                                      Applies to blocks created afterwards;
                                      restyle existing ones via getTowerState().
     setRenderHook(fn)                fn(dt) replaces the default
                                      renderer.render(scene, camera) call
                                      (for composers / post-processing).
     scene, camera, renderer, lights, container   set once 'ready' fires
     config                           tunables (read or tweak before start)
     debug.drop(offset)               deterministic drop for testing
     debug.build(n, offset)           n scripted drops; offset is a number or
                                      fn(i), returns { placed, score, phase }
     debug.tap()                      one synthetic input through handleInput
     debug.fps()                      { frames, avg, worst } from the live
                                      frame-time ring buffer (raw rAF deltas)
     debug.stats()                    { phase, score, blocks, debris,
                                        drawCalls, triangles, geometries }

   Bus events (payload always includes state = getTowerState()):
     'ready'    boot finished
     'start'    run started
     'spawn'    { block }                        new slider block
     'drop'     { type: 'perfect'|'sliced'|'miss', block, debris, offset,
                  combo, score }                 block = placed record or null
     'gameover' { score, best }
     'restart'  tower cleared, new run starting
     'frame'    { dt, now }                      every frame, before render

   DOM bridge (for the HUD layer, dispatched on window as CustomEvents):
     out: 'game:ready', 'game:start' {score}, 'game:score' {score},
          'game:perfect' {combo}, 'game:over' {score, best}
     in:  'hud:start', 'hud:restart'

   Visuals bridge (for visuals.js, dispatched on window as CustomEvents):
     'stack:init' {scene, camera, renderer, THREE}, 'stack:block'
     {mesh, level}, 'stack:placed' {mesh, level, perfect}, 'stack:debris'
     {mesh, level, dir}, 'stack:gameover', 'stack:reset'; plus a direct
     StackVisuals.update(dt) call each frame. When StackVisuals is ready it
     owns lighting, materials, debris animation, and placement juice; core
     falls back to its own lights, Lambert palette, and debris physics when
     it is absent.

   Tower state shape:
     { phase: 'ready'|'playing'|'gameover', score, best, combo, baseHue,
       blockSize, blockHeight, baseHeight, towerTop,
       blocks: [{ mesh, x, y, z, w, d, h, hue, index, perfect, isBase }],
       current: { mesh, axis: 'x'|'z', index, w, d, y, hue, center, dir,
                  speed } | null    (y is the landing height; the mesh glides
                                     sliderHover above it until placed),
       debris: [{ mesh, vx, vy, vz, ax, ay, az }],
       camera: { focusY, viewHeight, focusTargetY } }
   ========================================================================== */
(function () {
  'use strict';

  var CFG = {
    blockSize: 2.6,       // base footprint (world units)
    blockHeight: 0.62,
    sliderHover: 0.07,    // slide plane sits this far above the landing plane
                          // and the block snaps down flush on placement; with
                          // translucent materials a coplanar contact lets the
                          // tower's top rim bleed through the slider and it
                          // reads as sunk into the stack (round-1 defect)
    baseHeight: 5.4,      // pedestal column under the first block
    travelBound: 3.55,    // slider travel half-range around the tower top
    speedStart: 2.7,
    speedGain: 0.055,     // per block index
    speedMax: 6.8,
    perfectEps: 0.14,     // |offset| below this snaps as a perfect drop
    growStep: 0.14,       // footprint regrowth per perfect while on a streak
    growCombo: 3,         // streak length at which regrowth starts
    gravity: 22,
    viewHeight: 8.8,      // ortho frustum height while playing
    minViewWidth: 10,     // widen frustum on narrow (portrait) windows so the
                          // slider travel range stays fully on screen
    camOffset: { x: 16, y: 13.8, z: 16 },
    focusLead: 0.5,       // how far below screen-center the tower top sits
    followLerp: 3.2,
    zoomLerp: 2.2,
    restartLockMs: 450,   // ignore input right after game over
    startGraceMs: 260,    // ignore drops right after a run starts; the same
                          // tap that starts or restarts must not also drop
    hueStep: 4.2,         // default palette hue drift per block
    maxDpr: 2,
    debrisCull: 42        // drop debris meshes this far below the camera focus
  };

  var listeners = {};
  var scene = null, camera = null, renderer = null, container = null, lights = null;
  var phase = 'boot';           // boot | ready | playing | gameover
  var blocks = [];              // placed blocks, index 0 is the base pedestal
  var debris = [];              // falling cut pieces
  var pulses = [];              // perfect-snap scale pulses
  var current = null;           // sliding block
  var score = 0, best = 0, combo = 0;
  var baseHue = 42;
  var camFocusY = 0, camFocusTargetY = 0;
  var camFocusX = 0, camFocusZ = 0, camFocusTargetX = 0, camFocusTargetZ = 0;
  var camViewH = CFG.viewHeight, camTargetViewH = CFG.viewHeight;
  var gameOverAt = 0, phaseStartedAt = 0, clockLast = 0, sideToggle = 1;
  var renderHook = null;
  var materialFactory = defaultMaterial;
  var fpsBuf = new Float32Array(240), fpsIdx = 0, fpsCount = 0;  // raw rAF deltas

  /* ------------------------------------------------------------ event bus */

  function on(ev, cb) {
    (listeners[ev] || (listeners[ev] = [])).push(cb);
    return api;
  }

  function off(ev, cb) {
    var a = listeners[ev];
    if (a) {
      var i = a.indexOf(cb);
      if (i >= 0) { a.splice(i, 1); }
    }
    return api;
  }

  function emit(ev, data) {
    var a = listeners[ev];
    if (!a) { return; }
    for (var i = 0; i < a.length; i++) {
      try { a[i](data); }
      catch (err) { console.error('[StackCore] "' + ev + '" listener failed:', err); }
    }
  }

  function fireDom(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); }
    catch (err) { /* ignore */ }
  }

  function visualsReady() {
    var v = window.StackVisuals;
    return !!(v && v.isReady && v.isReady());
  }

  /* --------------------------------------------------------------- colors */

  function hueFor(index) {
    var h = (baseHue + index * CFG.hueStep) % 360;
    return h < 0 ? h + 360 : h;
  }

  function colorInfo(index, isBase) {
    return {
      index: index,
      hue: hueFor(index),
      sat: 0.62,
      light: 0.52 + 0.10 * Math.sin(index * 0.22),
      isBase: !!isBase
    };
  }

  function defaultMaterial(info) {
    return new THREE.MeshLambertMaterial({
      color: new THREE.Color().setHSL(info.hue / 360, info.sat, info.light)
    });
  }

  /* -------------------------------------------------------------- helpers */

  function topBlock() { return blocks[blocks.length - 1]; }

  function towerTopY() {
    var t = topBlock();
    return t.y + t.h / 2;
  }

  function disposeMesh(mesh) {
    /* Children (e.g. visuals edge lines) may share materials, so only the
       root material is disposed; child geometries are always released. */
    mesh.traverse(function (node) {
      if (node.geometry) { node.geometry.dispose(); }
      if (node !== mesh) { return; }
      var m = node.material;
      if (Array.isArray(m)) { for (var i = 0; i < m.length; i++) { m[i].dispose(); } }
      else if (m) { m.dispose(); }
    });
  }

  function getTowerState() {
    return {
      phase: phase,
      score: score,
      best: best,
      combo: combo,
      baseHue: baseHue,
      blockSize: CFG.blockSize,
      blockHeight: CFG.blockHeight,
      baseHeight: CFG.baseHeight,
      towerTop: blocks.length ? towerTopY() : 0,
      blocks: blocks,
      current: current,
      debris: debris,
      camera: { focusY: camFocusY, viewHeight: camViewH, focusTargetY: camFocusTargetY }
    };
  }

  /* ---------------------------------------------------------- tower setup */

  function resetTower() {
    var i;
    for (i = 0; i < blocks.length; i++) { scene.remove(blocks[i].mesh); disposeMesh(blocks[i].mesh); }
    for (i = 0; i < debris.length; i++) { scene.remove(debris[i].mesh); disposeMesh(debris[i].mesh); }
    if (current) { scene.remove(current.mesh); disposeMesh(current.mesh); }
    blocks = []; debris = []; pulses = []; current = null;
    score = 0; combo = 0; sideToggle = 1;
    baseHue = Math.random() * 360;

    var info = colorInfo(0, true);
    var mesh = new THREE.Mesh(
      new THREE.BoxGeometry(CFG.blockSize, CFG.baseHeight, CFG.blockSize),
      materialFactory(info)
    );
    mesh.position.set(0, -CFG.baseHeight / 2, 0);
    scene.add(mesh);
    blocks.push({
      mesh: mesh, x: 0, y: -CFG.baseHeight / 2, z: 0,
      w: CFG.blockSize, d: CFG.blockSize, h: CFG.baseHeight,
      hue: info.hue, index: 0, perfect: false, isBase: true
    });
    fireDom('stack:block', { mesh: mesh, level: 0 });

    camFocusY = camFocusTargetY = CFG.focusLead;
    camFocusX = camFocusTargetX = 0;
    camFocusZ = camFocusTargetZ = 0;
    camViewH = camTargetViewH = CFG.viewHeight;
  }

  /* ------------------------------------------------------- spawn and drop */

  function spawnNext() {
    var prev = topBlock();
    var index = prev.index + 1;
    var axis = index % 2 === 1 ? 'x' : 'z';
    var w = prev.w, d = prev.d;
    if (combo >= CFG.growCombo) {          // streak regrowth, Stack-style
      w = Math.min(CFG.blockSize, w + CFG.growStep);
      d = Math.min(CFG.blockSize, d + CFG.growStep);
    }
    sideToggle = -sideToggle;

    var y = towerTopY() + CFG.blockHeight / 2;
    var info = colorInfo(index, false);
    var mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, CFG.blockHeight, d),
      materialFactory(info)
    );
    var center = axis === 'x' ? prev.x : prev.z;
    var startA = center + CFG.travelBound * sideToggle;
    mesh.position.set(
      axis === 'x' ? startA : prev.x,
      y + CFG.sliderHover,   /* glide above the landing plane, snap on drop */
      axis === 'z' ? startA : prev.z
    );
    scene.add(mesh);
    fireDom('stack:block', { mesh: mesh, level: index });

    current = {
      mesh: mesh, axis: axis, index: index,
      w: w, d: d, y: y, hue: info.hue,
      center: center, dir: -sideToggle,
      speed: Math.min(CFG.speedMax, CFG.speedStart + (index - 1) * CFG.speedGain)
    };
    emit('spawn', { block: current, state: getTowerState() });
  }

  function placedRecord(mesh, dropped, w, d, perfect) {
    return {
      mesh: mesh, x: mesh.position.x, y: dropped.y, z: mesh.position.z,
      w: w, d: d, h: CFG.blockHeight,
      hue: dropped.hue, index: dropped.index, perfect: perfect, isBase: false
    };
  }

  function pushDebris(mesh, vel) {
    var rec = {
      mesh: mesh,
      vx: vel.vx || 0, vy: vel.vy || 0, vz: vel.vz || 0,
      ax: vel.ax || 0, ay: vel.ay || 0, az: vel.az || 0
    };
    debris.push(rec);
    return rec;
  }

  /* Cut piece spanning [lo, hi] on the active axis; side is -1 or 1.
     With a ready visuals layer the piece is handed over whole (visuals owns
     its motion, fade, and disposal); otherwise core animates it. */
  function slicePiece(dropped, lo, hi, side) {
    var a = dropped.axis;
    var size = hi - lo;
    var w = a === 'x' ? size : dropped.w;
    var d = a === 'z' ? size : dropped.d;
    var handover = visualsReady();
    var mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, CFG.blockHeight, d),
      handover ? dropped.mesh.material : dropped.mesh.material.clone()
    );
    mesh.position.set(
      a === 'x' ? (lo + hi) / 2 : dropped.mesh.position.x,
      dropped.y,
      a === 'z' ? (lo + hi) / 2 : dropped.mesh.position.z
    );
    scene.add(mesh);
    if (handover) {
      fireDom('stack:debris', {
        mesh: mesh, level: dropped.index,
        dir: { x: a === 'x' ? side : 0, z: a === 'z' ? side : 0 }
      });
      return { mesh: mesh, visuals: true };
    }
    return pushDebris(mesh, {
      vx: a === 'x' ? side * (1.3 + Math.random() * 0.7) : 0,
      vy: 0.5,
      vz: a === 'z' ? side * (1.3 + Math.random() * 0.7) : 0,
      ax: a === 'z' ? side * (2.2 + Math.random() * 1.8) : 0,
      az: a === 'x' ? -side * (2.2 + Math.random() * 1.8) : 0
    });
  }

  function dropPayload(type, blockRec, debrisArr, delta) {
    return {
      type: type, block: blockRec, debris: debrisArr,
      offset: delta, combo: combo, score: score,
      state: getTowerState()
    };
  }

  function dropCurrent() {
    if (phase !== 'playing' || !current) { return; }
    var dropped = current;
    var m = dropped.mesh;
    var a = dropped.axis;
    var prev = topBlock();
    var p = a === 'x' ? prev.x : prev.z;
    var c = m.position[a];
    var wc = a === 'x' ? dropped.w : dropped.d;
    var wp = a === 'x' ? prev.w : prev.d;
    var delta = c - p;
    var curLo = c - wc / 2, curHi = c + wc / 2;
    var prevLo = p - wp / 2, prevHi = p + wp / 2;
    var keepLo = Math.max(curLo, prevLo), keepHi = Math.min(curHi, prevHi);
    var keepSize = keepHi - keepLo;
    current = null;

    if (keepSize <= 0.0005) {
      /* Total miss: whole block becomes debris, run ends. */
      var s = delta !== 0 ? (delta > 0 ? 1 : -1) : dropped.dir;
      var deb;
      if (visualsReady()) {
        deb = { mesh: m, visuals: true };
        fireDom('stack:debris', {
          mesh: m, level: dropped.index,
          dir: { x: a === 'x' ? s : 0, z: a === 'z' ? s : 0 }
        });
      } else {
        deb = pushDebris(m, {
          vx: a === 'x' ? s * (1.2 + Math.random() * 0.6) : 0,
          vy: 0.4,
          vz: a === 'z' ? s * (1.2 + Math.random() * 0.6) : 0,
          ax: a === 'z' ? s * (2.4 + Math.random() * 1.6) : 0,
          az: a === 'x' ? -s * (2.4 + Math.random() * 1.6) : 0
        });
      }
      emit('drop', dropPayload('miss', null, [deb], delta));
      gameOver();
      return;
    }

    if (Math.abs(delta) <= CFG.perfectEps) {
      /* Perfect: snap into place, keep the full footprint. */
      m.position[a] = p;
      m.position.y = dropped.y;   /* settle from the hover plane, flush */
      var rec = placedRecord(m, dropped, dropped.w, dropped.d, true);
      blocks.push(rec);
      score += 1; combo += 1;
      if (!visualsReady()) { pulses.push({ mesh: m, t: 0 }); }
      fireDom('stack:placed', { mesh: m, level: dropped.index, perfect: true });
      fireDom('game:score', { score: score });
      fireDom('game:perfect', { combo: combo });
      emit('drop', dropPayload('perfect', rec, [], delta));
      spawnNext();
      return;
    }

    /* Sliced: keep the overlap, shed the overhang (both sides if regrown). */
    var pieces = [];
    if (keepLo - curLo > 0.0005) { pieces.push(slicePiece(dropped, curLo, keepLo, -1)); }
    if (curHi - keepHi > 0.0005) { pieces.push(slicePiece(dropped, keepHi, curHi, 1)); }
    var newW = a === 'x' ? keepSize : dropped.w;
    var newD = a === 'z' ? keepSize : dropped.d;
    m.geometry.dispose();
    m.geometry = new THREE.BoxGeometry(newW, CFG.blockHeight, newD);
    m.position[a] = (keepLo + keepHi) / 2;
    m.position.y = dropped.y;   /* settle from the hover plane, flush */
    var recS = placedRecord(m, dropped, newW, newD, false);
    blocks.push(recS);
    score += 1; combo = 0;
    fireDom('stack:placed', { mesh: m, level: dropped.index, perfect: false });
    fireDom('game:score', { score: score });
    emit('drop', dropPayload('sliced', recS, pieces, delta));
    spawnNext();
  }

  /* --------------------------------------------------------------- phases */

  function startGame() {
    if (phase !== 'ready') { return; }
    phase = 'playing';
    phaseStartedAt = performance.now();
    camTargetViewH = CFG.viewHeight;
    fireDom('game:start', { score: 0 });
    emit('start', { state: getTowerState() });
    spawnNext();
  }

  function gameOver() {
    phase = 'gameover';
    gameOverAt = performance.now();
    if (score > best) {
      best = score;
      try { localStorage.setItem('stack-best', String(best)); } catch (err) { /* ignore */ }
    }
    var top = towerTopY();
    camFocusTargetY = (top - CFG.baseHeight) / 2;
    camTargetViewH = Math.max(CFG.viewHeight, top + CFG.baseHeight + 4);
    fireDom('stack:gameover');
    fireDom('game:over', { score: score, best: best });
    emit('gameover', { score: score, best: best, state: getTowerState() });
  }

  function restartGame() {
    if (phase !== 'gameover') { return; }
    if (performance.now() - gameOverAt < CFG.restartLockMs) { return; }
    fireDom('stack:reset');   /* before rebuilding, so the new base stays registered */
    resetTower();
    phase = 'ready';
    emit('restart', { state: getTowerState() });
    startGame();
  }

  /* ---------------------------------------------------------------- input */

  function handleInput() {
    if (phase === 'ready') { startGame(); }
    else if (phase === 'playing') {
      /* The gesture that started or restarted the run reaches this handler
         too (HUD relays plus direct bubbling); a drop that soon would be an
         instant miss at the spawn edge, so it is ignored. */
      if (performance.now() - phaseStartedAt < CFG.startGraceMs) { return; }
      dropCurrent();
    }
    else if (phase === 'gameover') { restartGame(); }
  }

  function bindInput() {
    window.addEventListener('pointerdown', function (e) {
      if (e.isPrimary === false) { return; }
      var t = e.target;
      /* Let real controls (e.g. the HUD restart button) act on their own. */
      if (t && t.closest && t.closest('button, a, input, [data-ui]')) { return; }
      if (e.cancelable) { e.preventDefault(); }
      handleInput();
    }, { passive: false });

    window.addEventListener('keydown', function (e) {
      if (e.code !== 'Space' || e.repeat) { return; }
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) { return; }
      e.preventDefault();
      handleInput();
    });

    /* HUD-originated taps (redundant with the global handlers, both no-op
       if the phase already advanced). */
    window.addEventListener('hud:start', function () {
      if (phase === 'ready') { startGame(); }
    });
    window.addEventListener('hud:restart', function () {
      if (phase === 'gameover') { restartGame(); }
    });
  }

  /* ----------------------------------------------------- per-frame update */

  function updateCurrent(dt) {
    if (!current) { return; }
    var m = current.mesh;
    var pos = m.position[current.axis] + current.dir * current.speed * dt;
    var lo = current.center - CFG.travelBound;
    var hi = current.center + CFG.travelBound;
    if (pos > hi) { pos = hi - (pos - hi); current.dir = -1; }
    else if (pos < lo) { pos = lo + (lo - pos); current.dir = 1; }
    m.position[current.axis] = pos;
  }

  function updateDebris(dt) {
    for (var i = debris.length - 1; i >= 0; i--) {
      var d = debris[i];
      d.vy -= CFG.gravity * dt;
      var m = d.mesh;
      m.position.x += d.vx * dt;
      m.position.y += d.vy * dt;
      m.position.z += d.vz * dt;
      m.rotation.x += d.ax * dt;
      m.rotation.y += d.ay * dt;
      m.rotation.z += d.az * dt;
      if (m.position.y < camFocusY - CFG.debrisCull) {
        scene.remove(m);
        disposeMesh(m);
        debris.splice(i, 1);
      }
    }
  }

  function updatePulses(dt) {
    var T = 0.24;
    for (var i = pulses.length - 1; i >= 0; i--) {
      var p = pulses[i];
      p.t += dt;
      if (p.t >= T) {
        p.mesh.scale.set(1, 1, 1);
        pulses.splice(i, 1);
      } else {
        var s = 1 + 0.07 * Math.sin(Math.PI * p.t / T);
        p.mesh.scale.set(s, 1, s);
      }
    }
  }

  function applyCamera() {
    var aspect = window.innerWidth / Math.max(1, window.innerHeight);
    var vh = camViewH;
    if (vh * aspect < CFG.minViewWidth) { vh = CFG.minViewWidth / aspect; }
    camera.left = -vh * aspect / 2;
    camera.right = vh * aspect / 2;
    camera.top = vh / 2;
    camera.bottom = -vh / 2;
    camera.updateProjectionMatrix();
    camera.position.set(
      camFocusX + CFG.camOffset.x,
      camFocusY + CFG.camOffset.y,
      camFocusZ + CFG.camOffset.z
    );
    camera.lookAt(camFocusX, camFocusY, camFocusZ);
  }

  function updateCamera(dt) {
    if (phase === 'playing') {
      var top = topBlock();
      camFocusTargetY = towerTopY() + CFG.focusLead;
      camFocusTargetX = top.x;   /* keep a sliced, drifting tower centered */
      camFocusTargetZ = top.z;
    }
    var k = phase === 'gameover' ? CFG.zoomLerp : CFG.followLerp;
    var s = 1 - Math.exp(-k * dt);
    camFocusY += (camFocusTargetY - camFocusY) * s;
    camFocusX += (camFocusTargetX - camFocusX) * s;
    camFocusZ += (camFocusTargetZ - camFocusZ) * s;
    camViewH += (camTargetViewH - camViewH) * s;
    applyCamera();
  }

  function tick(now) {
    requestAnimationFrame(tick);
    var raw = (now - clockLast) / 1000;
    if (raw > 0) {
      fpsBuf[fpsIdx] = raw;
      fpsIdx = (fpsIdx + 1) % fpsBuf.length;
      if (fpsCount < fpsBuf.length) { fpsCount++; }
    }
    var dt = Math.min(0.05, Math.max(0, raw));
    clockLast = now;
    if (phase === 'playing') { updateCurrent(dt); }
    updateDebris(dt);
    updatePulses(dt);
    updateCamera(dt);
    if (visualsReady()) { window.StackVisuals.update(dt); }
    emit('frame', { dt: dt, now: now });
    if (renderHook) { renderHook(dt); }
    else { renderer.render(scene, camera); }
  }

  /* ----------------------------------------------------------------- init */

  function fatal(message) {
    var host = document.getElementById('game') || document.body;
    var note = document.createElement('div');
    note.style.cssText =
      'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'padding:24px;text-align:center;color:#fff;font:500 16px/1.6 system-ui,"Segoe UI",sans-serif;';
    note.textContent = message;
    host.appendChild(note);
  }

  function onResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    applyCamera();
  }

  function init() {
    if (typeof THREE === 'undefined') {
      fatal('Three.js failed to load. Connect to the internet once and reload the page.');
      return;
    }
    container = document.getElementById('game');
    if (!container) {
      container = document.createElement('div');
      container.id = 'game';
      document.body.appendChild(container);
    }

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, CFG.maxDpr));
    renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(renderer.domElement);
    renderer.domElement.addEventListener('webglcontextlost', function (e) { e.preventDefault(); }, false);

    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -80, 220);

    /* Offer the scene to the visuals layer first; it brings its own
       lighting, sky, and materials. Core lights are only a fallback. */
    fireDom('stack:init', { scene: scene, camera: camera, renderer: renderer, THREE: THREE });
    if (!visualsReady()) {
      lights = {
        ambient: new THREE.AmbientLight(0xffffff, 0.45),
        hemi: new THREE.HemisphereLight(0xe8efff, 0x7c8aa5, 0.4),
        dir: new THREE.DirectionalLight(0xffffff, 0.8)
      };
      lights.dir.position.set(9, 18, 6);
      scene.add(lights.ambient, lights.hemi, lights.dir);
    }

    try { best = parseInt(localStorage.getItem('stack-best') || '0', 10) || 0; }
    catch (err) { best = 0; }

    resetTower();
    bindInput();
    window.addEventListener('resize', onResize);

    api.scene = scene;
    api.camera = camera;
    api.renderer = renderer;
    api.lights = lights;
    api.container = container;

    phase = 'ready';
    clockLast = performance.now();
    applyCamera();
    requestAnimationFrame(tick);
    fireDom('game:ready');
    emit('ready', { state: getTowerState() });
  }

  /* ------------------------------------------------------------------ api */

  var debug = {
    /* Deterministic drop at a given offset from the tower top (testing). */
    drop: function (offset) {
      if (phase === 'ready') { startGame(); }
      if (phase !== 'playing' || !current) { return false; }
      var prev = topBlock();
      var p = current.axis === 'x' ? prev.x : prev.z;
      current.mesh.position[current.axis] = p + (offset || 0);
      dropCurrent();
      return true;
    },
    /* n scripted drops in one go; offset is a number or fn(i). Stops early
       on a miss. Builds tall towers for performance evidence. */
    build: function (n, offset) {
      n = Math.max(0, Math.min(n | 0, 1000));
      var placed = 0;
      for (var i = 0; i < n; i++) {
        var off = typeof offset === 'function' ? offset(i) : (offset || 0);
        if (!debug.drop(off)) { break; }
        placed++;
        if (phase !== 'playing') { break; }
      }
      return { placed: placed, score: score, phase: phase };
    },
    /* One synthetic input through the real handler (spam testing). */
    tap: function () { handleInput(); },
    /* Frame-rate over the last <=240 raw rAF deltas. */
    fps: function () {
      var n = fpsCount, sum = 0, worstDt = 0;
      for (var i = 0; i < n; i++) {
        sum += fpsBuf[i];
        if (fpsBuf[i] > worstDt) { worstDt = fpsBuf[i]; }
      }
      return {
        frames: n,
        avg: n > 0 && sum > 0 ? n / sum : 0,
        worst: worstDt > 0 ? 1 / worstDt : 0
      };
    },
    /* Live scene/renderer counters for robustness evidence. */
    stats: function () {
      var info = renderer && renderer.info ? renderer.info : null;
      return {
        phase: phase, score: score,
        blocks: blocks.length, debris: debris.length,
        drawCalls: info ? info.render.calls : -1,
        triangles: info ? info.render.triangles : -1,
        geometries: info ? info.memory.geometries : -1,
        textures: info ? info.memory.textures : -1
      };
    }
  };

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

  var api = {
    version: '1.2.0',
    config: CFG,
    on: on,
    off: off,
    getTowerState: getTowerState,
    setMaterialFactory: function (fn) {
      materialFactory = typeof fn === 'function' ? fn : defaultMaterial;
    },
    setRenderHook: function (fn) {
      renderHook = typeof fn === 'function' ? fn : null;
    },
    scene: null, camera: null, renderer: null, lights: null, container: null,
    debug: debugAllowed ? debug : decoy
  };

  window.StackCore = api;
  window.getTowerState = getTowerState;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    window.setTimeout(init, 0);
  }
})();
