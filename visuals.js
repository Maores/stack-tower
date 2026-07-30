/*
 * visuals.js
 * Look and feel layer for the Stack tower game. Owns: materials (glassy
 * translucency), palette hue progression up the tower, lighting, gradient
 * sky, ambient particles, the perfect-drop flash, and sliced-piece fall
 * and fade. Never touches game logic, input, camera motion, or the HUD.
 *
 * Consumes tower state and drop events through the API below (direct calls
 * preferred) or through equivalent DOM CustomEvents for loose coupling.
 *
 * Integration, call order:
 *   1. StackVisuals.init({ scene, camera, renderer })
 *        after the shell builds the three.js basics. Idempotent.
 *   2. StackVisuals.styleBlock(mesh, level)
 *        for every block mesh: base blocks, the sliding block, placed blocks.
 *        Safe to call before init (queued). Safe to call again after the
 *        game swaps a mesh geometry (edges rebuild automatically).
 *   3. On a resolved drop:
 *        StackVisuals.onBlockPlaced(mesh, level, { perfect: true|false })
 *        StackVisuals.spawnDebris(cutMesh)      visuals take ownership of the cut piece
 *        StackVisuals.setLevel(topLevel)        top level index of the tower
 *   4. StackVisuals.update(dt)
 *        once per frame before renderer.render, dt in seconds.
 *   5. StackVisuals.onGameOver() on a full miss, StackVisuals.reset() on restart.
 *
 * CustomEvent fallback, window.dispatchEvent(new CustomEvent(name, { detail })):
 *   'stack:init'     { scene, camera, renderer }
 *   'stack:block'    { mesh, level }
 *   'stack:placed'   { mesh, level, perfect }
 *   'stack:debris'   { mesh, dir }
 *   'stack:level'    { level }
 *   'stack:gameover' {}
 *   'stack:reset'    {}
 *
 * Extras for the HUD layer:
 *   StackVisuals.getBlockColor(level, depth) -> '#rrggbb'
 *   StackVisuals.getPalette() -> { bg, bgInner, block, accent } css strings
 *
 * Notes for the integrator:
 *   - Every object this module adds to the scene carries
 *     userData.svHelper === true. Skip those when iterating scene children.
 *   - spawnDebris assumes it may dispose the piece geometry when the piece
 *     is gone. Set mesh.userData.svOwnGeometry = false if the geometry is
 *     shared and must survive.
 *   - World scale is inferred from the first styled block footprint, so any
 *     block size works.
 *   - Compatible with three.js r12x through r16x loaded as the global THREE.
 */
(function () {
  'use strict';

  var T = null;    // THREE namespace, resolved at init
  var ctx = null;  // { scene, camera, renderer }

  var CFG = {
    hueStep: 3.8,       // hue advance per level (sign randomized per run)
    depthSpan: 14,      // levels over which glass deepens below the top
    meltFrom: 16,       // depth where the tower starts melting into the sky
    bgBase: 202,        // background hue center
    bgSwing: 11,        // background hue swing amplitude (stays blue-cyan)
    particleCount: 150,
    maxDebris: 40,
    maxFlashes: 8,
    maxPulses: 12,
    flashDur: 0.5,
    gravity: 15,        // in block widths per second squared
    debrisDrag: 2.1,    // horizontal damping per second
    debrisLife: 1.25,   // seconds until a cut piece is fully gone
    debrisFadeAt: 0.34  // seconds before the fade begins
  };

  // Palette families that sit well on the blue sky, like the reference art.
  var HUE_FAMILIES = [148, 164, 180, 198, 214, 232, 256, 284, 312];

  var S = {
    inited: false,
    time: 0,
    level: 0,
    hueStart: 164,
    hueStep: CFG.hueStep,
    blockW: 1,
    blockWSet: false,
    gameDim: 0,
    gameDimTarget: 0,
    registry: [],       // styled block meshes
    pending: [],        // styleBlock calls made before init
    debris: [],
    pulses: [],
    flashPool: [],
    bgCur: null,        // { inner, outer, beam } THREE.Color, working space
    bgTarget: null,
    sky: null,
    particles: null,
    lights: null,
    edgeMat: null,
    envRT: null,
    fog: null,
    tmpV: null,
    tmpV2: null,
    tmpC: null,
    tmpC2: null
  };

  /* ------------------------------------------------ color pipeline */

  function cmOn() {
    if (!T || !T.ColorManagement) return false;
    if (T.ColorManagement.enabled === true) return true;       // r150+
    if (T.ColorManagement.legacyMode === false) return true;   // r139-r149
    return false;
  }

  // Turn on proper color management so lit material colors are converted
  // sRGB -> linear -> sRGB. Without this, sRGB output encoding on top of
  // raw colors double-brightens everything into a washed-out chalk look.
  function setupColorManagement() {
    try {
      if (T.ColorManagement) {
        if ('enabled' in T.ColorManagement) T.ColorManagement.enabled = true;
        if ('legacyMode' in T.ColorManagement) T.ColorManagement.legacyMode = false;
      }
    } catch (e) {}
  }

  // Set an HSL color authored in sRGB display space onto an existing color.
  // Without the explicit color space, r139-r15x setHSL defaults to linear
  // and every authored value comes out brighter and paler than intended.
  function setHSLInto(c, h, s, l) {
    var hh = (((h % 360) + 360) % 360) / 360;
    if (cmOn() && T.SRGBColorSpace !== undefined) {
      try { return c.setHSL(hh, s, l, T.SRGBColorSpace); } catch (e) {}
    }
    return c.setHSL(hh, s, l);
  }

  // Build a color from HSL where h is in degrees (sRGB authored).
  function hsl(h, s, l) {
    return setHSLInto(new T.Color(), h, s, l);
  }

  // Copy src into dst as raw display-space values for ShaderMaterial
  // uniforms (sky, particles) that skip the renderer's output conversion.
  function dispInto(src, dst) {
    dst.copy(src);
    if (cmOn() && dst.convertLinearToSRGB) dst.convertLinearToSRGB();
    return dst;
  }

  // getHexString already returns display-space sRGB on color-managed builds
  // (and raw authored values on legacy builds), so no extra conversion here.
  function css(color) {
    return '#' + color.getHexString();
  }

  /* ------------------------------------------------ palette */

  function blockHSL(level, depth) {
    var f = Math.min(Math.max(depth, 0) / CFG.depthSpan, 1);
    f = f * (2 - f); // ease-out: the first few levels below the top deepen fast
    return {
      h: S.hueStart + level * S.hueStep,
      s: 0.60 + 0.24 * f,
      l: 0.575 - 0.16 * f + 0.012 * Math.sin(level * 1.7),
      op: 0.88 + 0.06 * f
    };
  }

  function computeBgTargets() {
    var h = CFG.bgBase + CFG.bgSwing * Math.sin(S.level * 0.05 + 0.4);
    var l = 0.585 + 0.03 * Math.sin(S.level * 0.03 + 1.7);
    S.bgTarget = {
      inner: hsl(h - 6, 0.66, l - 0.03),
      outer: hsl(h + 10, 0.74, 0.205),
      beam: hsl(h - 16, 0.55, 0.82)
    };
    if (!S.bgCur) {
      S.bgCur = {
        inner: S.bgTarget.inner.clone(),
        outer: S.bgTarget.outer.clone(),
        beam: S.bgTarget.beam.clone()
      };
    }
  }

  function pickRunPalette() {
    S.hueStart = HUE_FAMILIES[Math.floor(Math.random() * HUE_FAMILIES.length)];
    S.hueStep = (Math.random() < 0.5 ? -1 : 1) * (CFG.hueStep * (0.85 + Math.random() * 0.5));
  }

  /* ------------------------------------------------ scene dressing */

  function tagHelper(obj) {
    obj.userData.svHelper = true;
    obj.raycast = function () {};
    return obj;
  }

  function buildSky() {
    var geo = new T.PlaneGeometry(2, 2);
    var mat = new T.ShaderMaterial({
      uniforms: {
        uInner: { value: new T.Color(0.35, 0.65, 0.85) },
        uOuter: { value: new T.Color(0.04, 0.15, 0.33) },
        uBeam: { value: new T.Color(0.8, 0.92, 1.0) },
        uRes: { value: new T.Vector2(1, 1) },
        uTime: { value: 0 }
      },
      vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0.999999, 1.0); }',
      fragmentShader: [
        'uniform vec3 uInner;',
        'uniform vec3 uOuter;',
        'uniform vec3 uBeam;',
        'uniform vec2 uRes;',
        'uniform float uTime;',
        'void main(){',
        '  vec2 uv = gl_FragCoord.xy / uRes;',
        '  float aspect = uRes.x / max(uRes.y, 1.0);',
        '  vec2 d = uv - vec2(0.5, 0.72);',
        '  d.x *= aspect;',
        '  float r = length(d);',
        '  vec3 col = mix(uInner, uOuter, smoothstep(0.02, 0.66, r));',
        // wide halo behind the tower's upper half
        '  col += uBeam * exp(-r * r * 6.5) * 0.17;',
        // soft vertical light shaft from the sky
        '  float beam = exp(-pow(d.x * 2.6, 2.0)) * smoothstep(-0.25, 0.65, uv.y - 0.12);',
        '  beam *= 0.45 + 0.07 * sin(uTime * 0.5);',
        '  col += uBeam * beam * 0.11;',
        // corner vignette keeps the frame focused
        '  vec2 vg = (uv - 0.5) * vec2(aspect, 1.0);',
        '  col *= 1.0 - 0.30 * smoothstep(0.45, 0.95, length(vg));',
        '  float grain = fract(sin(dot(uv * uRes, vec2(12.9898, 78.233))) * 43758.5453);',
        '  col += (grain - 0.5) * 0.016;',
        '  gl_FragColor = vec4(col, 1.0);',
        '}'
      ].join('\n'),
      depthTest: false,
      depthWrite: false
    });
    mat.toneMapped = false;
    var mesh = new T.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = -1000;
    tagHelper(mesh);
    ctx.scene.add(mesh);
    S.sky = mesh;
  }

  function physicalLightScale() {
    // r155+ made physical light units the default, older code paths need
    // roughly a PI boost to look the same. Avoid reading useLegacyLights on
    // recent builds, the getter logs a deprecation warning.
    var rev = parseInt(T.REVISION, 10);
    if (rev >= 155) return Math.PI;
    var legacy = ctx.renderer ? ctx.renderer.useLegacyLights : undefined;
    if (legacy === false) return Math.PI;
    return 1;
  }

  function buildLights() {
    var k = physicalLightScale();
    var hemi = new T.HemisphereLight(0xd6ecff, 0x0c2a44, 0.3 * k);
    var key = new T.DirectionalLight(0xffffff, 0.72 * k);
    key.position.set(1.1, 1.55, 0.5);
    var fill = new T.DirectionalLight(0x86c9f0, 0.22 * k);
    fill.position.set(-0.9, 0.25, -0.75);
    tagHelper(hemi); tagHelper(key); tagHelper(fill);
    ctx.scene.add(hemi); ctx.scene.add(key); ctx.scene.add(fill);
    S.lights = {
      hemi: hemi, key: key, fill: fill,
      hemiBase: hemi.intensity, keyBase: key.intensity, fillBase: fill.intensity
    };
  }

  function buildEnv() {
    try {
      var cv = document.createElement('canvas');
      cv.width = 256; cv.height = 128;
      var g = cv.getContext('2d');
      var grad = g.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0, '#ffffff');
      grad.addColorStop(0.30, '#bfe6f8');
      grad.addColorStop(0.55, '#3f88b4');
      grad.addColorStop(0.78, '#123a5e');
      grad.addColorStop(1, '#04101f');
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 128);
      // hot sun blob and a bright horizon strip give the clearcoat its sparkle
      var sun = g.createRadialGradient(128, 22, 2, 128, 22, 46);
      sun.addColorStop(0, 'rgba(255,255,255,1)');
      sun.addColorStop(0.35, 'rgba(255,250,235,0.7)');
      sun.addColorStop(1, 'rgba(255,250,235,0)');
      g.fillStyle = sun;
      g.fillRect(0, 0, 256, 128);
      g.fillStyle = 'rgba(235,250,255,0.6)';
      g.fillRect(0, 62, 256, 5);
      g.fillStyle = 'rgba(190,235,255,0.25)';
      g.fillRect(0, 70, 256, 10);
      var tex = new T.CanvasTexture(cv);
      tex.mapping = T.EquirectangularReflectionMapping;
      try {
        if (T.SRGBColorSpace !== undefined) tex.colorSpace = T.SRGBColorSpace;
        else if (T.sRGBEncoding !== undefined) tex.encoding = T.sRGBEncoding;
      } catch (e1) {}
      if (T.PMREMGenerator && ctx.renderer) {
        var pm = new T.PMREMGenerator(ctx.renderer);
        var rt = pm.fromEquirectangular(tex);
        S.envRT = rt;
        ctx.scene.environment = rt.texture;
        pm.dispose();
      }
      tex.dispose();
    } catch (e) {
      // environment reflections are optional, lights still carry the look
    }
  }

  function buildParticles() {
    var n = CFG.particleCount;
    var seeds = new Float32Array(n * 3);
    var sizes = new Float32Array(n);
    var phases = new Float32Array(n);
    var speeds = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      seeds[i * 3] = Math.random() - 0.5;
      seeds[i * 3 + 1] = Math.random() - 0.5;
      seeds[i * 3 + 2] = Math.random() - 0.5;
      var big = i < 14;
      sizes[i] = big ? 2.1 + Math.random() * 1.4 : 0.4 + Math.random() * 0.55;
      phases[i] = Math.random() * Math.PI * 2;
      speeds[i] = 0.12 + Math.random() * 0.35;
    }
    var geo = new T.BufferGeometry();
    var setAttr = geo.setAttribute ? 'setAttribute' : 'addAttribute';
    geo[setAttr]('position', new T.BufferAttribute(seeds, 3));
    geo[setAttr]('aSize', new T.BufferAttribute(sizes, 1));
    geo[setAttr]('aPhase', new T.BufferAttribute(phases, 1));
    geo[setAttr]('aSpeed', new T.BufferAttribute(speeds, 1));
    var mat = new T.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uCenter: { value: new T.Vector3(0, 0, 0) },
        uVol: { value: new T.Vector3(19, 40, 19) },
        uPx: { value: 80 },
        uOrtho: { value: 0 },
        uPPU: { value: 60 },
        uBW: { value: 1 },
        uDim: { value: 0 },
        uColor: { value: new T.Color(0.85, 0.95, 1.0) }
      },
      vertexShader: [
        'attribute float aSize;',
        'attribute float aPhase;',
        'attribute float aSpeed;',
        'uniform float uTime;',
        'uniform vec3 uCenter;',
        'uniform vec3 uVol;',
        'uniform float uPx;',
        'uniform float uOrtho;',
        'uniform float uPPU;',
        'uniform float uBW;',
        'varying float vA;',
        'varying float vBig;',
        'void main(){',
        '  vec3 base = position * uVol;',
        '  base.y += uTime * aSpeed * uBW;',
        '  vec3 lo = uCenter - uVol * 0.5;',
        '  vec3 world = lo + mod(base - lo, uVol);',
        '  vec4 mv = modelViewMatrix * vec4(world, 1.0);',
        '  if (mv.z > -0.001) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vA = 0.0; vBig = 0.0; return; }',
        '  float ps = (uOrtho > 0.5) ? (aSize * uBW * uPPU) : (aSize * uBW * uPx / -mv.z);',
        '  gl_PointSize = clamp(ps, 0.0, 64.0);',
        '  vBig = step(1.6, aSize);',
        '  vA = 0.4 + 0.6 * (0.5 + 0.5 * sin(uTime * (0.5 + aSpeed) + aPhase));',
        '  gl_Position = projectionMatrix * mv;',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor;',
        'uniform float uDim;',
        'varying float vA;',
        'varying float vBig;',
        'void main(){',
        '  vec2 q = gl_PointCoord - 0.5;',
        '  float d2 = dot(q, q) * 4.0;',
        '  float a = max(0.0, 1.0 - d2);',
        '  a = a * a;',
        // small sparkles are bright and crisp, big bokeh discs stay faint
        '  float amp = mix(1.15, 0.30, vBig);',
        '  gl_FragColor = vec4(uColor * (vA * a * amp * (1.0 - 0.5 * uDim)), 1.0);',
        '}'
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      blending: T.AdditiveBlending
    });
    mat.toneMapped = false;
    var pts = new T.Points(geo, mat);
    pts.frustumCulled = false;
    tagHelper(pts);
    ctx.scene.add(pts);
    S.particles = pts;
  }

  function makeFlashMaterial() {
    var mat = new T.ShaderMaterial({
      uniforms: {
        uColor: { value: new T.Color(1, 1, 1) },
        uOpacity: { value: 0 }
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main(){',
        '  vUv = uv;',
        '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uColor;',
        'uniform float uOpacity;',
        'varying vec2 vUv;',
        'void main(){',
        '  vec2 p = abs(vUv - 0.5) * 2.0;',
        '  float rect = max(p.x, p.y);',
        '  float band = smoothstep(0.52, 0.86, rect) * (1.0 - smoothstep(0.88, 1.0, rect));',
        '  float glow = smoothstep(0.30, 1.0, rect);',
        '  float a = (band * 1.35 + glow * 0.22) * uOpacity;',
        '  gl_FragColor = vec4(uColor * a, a);',
        '}'
      ].join('\n'),
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
      blending: T.AdditiveBlending
    });
    mat.toneMapped = false;
    return mat;
  }

  function buildFlashPool() {
    var geo = new T.PlaneGeometry(1, 1);
    for (var i = 0; i < CFG.maxFlashes; i++) {
      var mesh = new T.Mesh(geo, makeFlashMaterial());
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 5;
      tagHelper(mesh);
      ctx.scene.add(mesh);
      S.flashPool.push({ mesh: mesh, active: false, t: 0, sx: 1, sz: 1 });
    }
  }

  /* ------------------------------------------------ block styling */

  // Injected into the standard material: bright beveled rim light along the
  // face borders (the glass "edge catch" from the reference art), stronger
  // on upward faces, plus a slight alpha bump so rims stay solid.
  function injectGlassRim(mat) {
    mat.defines = mat.defines || {};
    mat.defines.USE_UV = '';
    mat.customProgramCacheKey = function () { return 'sv-glass-rim-2'; };
    mat.onBeforeCompile = function (shader) {
      var inject = [
        'vec2 svq = abs(vUv - 0.5) * 2.0;',
        'float svRect = max(svq.x, svq.y);',
        'float svRim = smoothstep(0.855, 0.975, svRect);',
        'float svHalo = smoothstep(0.42, 0.98, svRect);',
        'vec3 svWN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);',
        'float svTop = clamp(svWN.y, 0.0, 1.0);',
        'vec3 svRimCol = clamp(mix(vec3(1.0), diffuseColor.rgb * 1.7, 0.24), 0.0, 1.2);',
        'float svBoost = svRim * (0.30 + 0.55 * svTop) + svHalo * (0.03 + 0.05 * svTop);',
        'outgoingLight += svRimCol * svBoost;',
        'diffuseColor.a = min(1.0, diffuseColor.a + svRim * 0.30);',
        ''
      ].join('\n');
      if (shader.fragmentShader.indexOf('#include <opaque_fragment>') >= 0) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>', inject + '#include <opaque_fragment>'
        );
      } else if (shader.fragmentShader.indexOf('#include <output_fragment>') >= 0) {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <output_fragment>', inject + '#include <output_fragment>'
        );
      }
    };
  }

  function makeBlockMaterial(color) {
    var M = T.MeshPhysicalMaterial || T.MeshStandardMaterial || T.MeshPhongMaterial;
    var mat = new M({ color: color });
    mat.transparent = true;
    mat.opacity = 0.85;
    if ('roughness' in mat) mat.roughness = 0.12;
    if ('metalness' in mat) mat.metalness = 0.0;
    if ('clearcoat' in mat) {
      mat.clearcoat = 1.0;
      mat.clearcoatRoughness = 0.08;
    }
    if ('envMapIntensity' in mat) mat.envMapIntensity = 0.55;
    if ('specularIntensity' in mat) mat.specularIntensity = 1.0;
    if ('onBeforeCompile' in mat) {
      try { injectGlassRim(mat); } catch (e) {}
    }
    return mat;
  }

  function estimateScale(mesh) {
    if (S.blockWSet || !mesh.geometry) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    var bb = mesh.geometry.boundingBox;
    if (!bb) return;
    bb.getSize(S.tmpV);
    var w = Math.max(S.tmpV.x * (mesh.scale.x || 1), S.tmpV.z * (mesh.scale.z || 1));
    if (w > 0) {
      S.blockW = w;
      S.blockWSet = true;
      if (S.fog) S.fog.density = 0.026 / S.blockW;
      if (S.particles) {
        S.particles.material.uniforms.uBW.value = S.blockW;
        S.particles.material.uniforms.uVol.value.set(19 * S.blockW, 40 * S.blockW, 19 * S.blockW);
      }
    }
  }

  function ensureEdges(mesh) {
    var ud = mesh.userData;
    var gid = mesh.geometry ? mesh.geometry.uuid : null;
    if (ud.svEdges && ud.svEdgesGeoId === gid) return;
    if (ud.svEdges) {
      mesh.remove(ud.svEdges);
      if (ud.svEdges.geometry) ud.svEdges.geometry.dispose();
      if (ud.svEdges.material && ud.svEdges.material !== S.edgeMat) ud.svEdges.material.dispose();
      ud.svEdges = null;
    }
    if (!mesh.geometry) return;
    try {
      var eg = new T.EdgesGeometry(mesh.geometry, 20);
      var lines = new T.LineSegments(eg, S.edgeMat);
      lines.renderOrder = 2;
      tagHelper(lines);
      mesh.add(lines);
      ud.svEdges = lines;
      ud.svEdgesGeoId = gid;
    } catch (e) {}
  }

  function applyBlockColor(mesh, level, depth) {
    var mat = mesh.userData.svMat;
    if (!mat) return;
    // The tall base pedestal reads as deeper glass from the first frame.
    if (level === 0) depth += 4;
    var p = blockHSL(level, depth);
    setHSLInto(mat.color, p.h, p.s, p.l);
    if (depth > CFG.meltFrom && S.bgTarget) {
      // deep tower melts toward the sky color, like the reference falloff
      var mf = Math.min((depth - CFG.meltFrom) / 18, 1) * 0.4;
      mat.color.lerp(S.bgTarget.outer, mf);
    }
    mat.opacity = p.op;
  }

  function styleBlock(mesh, level, opts) {
    if (!mesh || !mesh.geometry) return;
    if (!S.inited) {
      S.pending.push([mesh, level, opts]);
      return;
    }
    level = level | 0;
    var ud = mesh.userData || (mesh.userData = {});
    estimateScale(mesh);
    if (!ud.svMat) {
      ud.svMat = makeBlockMaterial(new T.Color(0xffffff));
      mesh.material = ud.svMat;
    } else if (mesh.material !== ud.svMat) {
      mesh.material = ud.svMat;
    }
    ud.svLevel = level;
    ensureEdges(mesh);
    if (!ud.svRegistered && !ud.svDebris) {
      ud.svRegistered = true;
      S.registry.push(mesh);
      if (S.registry.length > 400) {
        var old = S.registry.shift();
        if (old && old.userData) old.userData.svRegistered = false;
      }
    }
    applyBlockColor(mesh, level, Math.max(S.level - level, 0));
  }

  function recolorAll() {
    var keep = [];
    for (var i = 0; i < S.registry.length; i++) {
      var m = S.registry[i];
      if (!m || !m.parent || (m.userData && m.userData.svDebris)) {
        if (m && m.userData) m.userData.svRegistered = false;
        continue;
      }
      keep.push(m);
      var lv = m.userData.svLevel | 0;
      var d = S.level - lv;
      if (d < 0) d = 0;
      if (d > 34) continue; // frozen deep blocks, far below the view
      applyBlockColor(m, lv, d);
    }
    S.registry = keep;
  }

  /* ------------------------------------------------ events */

  function meshFootprint(mesh, out) {
    if (!mesh.geometry) return null;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    var bb = mesh.geometry.boundingBox;
    if (!bb) return null;
    bb.getSize(S.tmpV);
    bb.getCenter(S.tmpV2);
    var wp = new T.Vector3();
    if (mesh.getWorldPosition) mesh.getWorldPosition(wp);
    else wp.copy(mesh.position);
    out.cx = wp.x + S.tmpV2.x * mesh.scale.x;
    out.cz = wp.z + S.tmpV2.z * mesh.scale.z;
    out.topY = wp.y + S.tmpV2.y * mesh.scale.y + (S.tmpV.y * mesh.scale.y) / 2;
    out.sx = S.tmpV.x * mesh.scale.x;
    out.sz = S.tmpV.z * mesh.scale.z;
    return out;
  }

  function perfectFlash(center, sx, sz, opacity) {
    if (!S.inited) return;
    var f = null;
    for (var i = 0; i < S.flashPool.length; i++) {
      if (!S.flashPool[i].active) { f = S.flashPool[i]; break; }
    }
    if (!f) {
      f = S.flashPool[0];
      for (var j = 1; j < S.flashPool.length; j++) {
        if (S.flashPool[j].t > f.t) f = S.flashPool[j];
      }
    }
    f.active = true;
    f.t = 0;
    f.sx = sx * 1.1;
    f.sz = sz * 1.1;
    f.mesh.visible = true;
    f.mesh.position.set(center.x, center.y, center.z);
    f.mesh.scale.set(f.sx, f.sz, 1);
    f.mesh.material.uniforms.uOpacity.value = opacity == null ? 1 : opacity;
  }

  function perfectFlashForMesh(mesh) {
    var fp = meshFootprint(mesh, {});
    if (!fp) return;
    perfectFlash(
      { x: fp.cx, y: fp.topY + 0.03 * S.blockW, z: fp.cz },
      fp.sx, fp.sz
    );
  }

  function finishPulse(p) {
    if (!p) return;
    if (p.mesh && p.s0) p.mesh.scale.copy(p.s0);
    var mat = p.mesh && p.mesh.userData ? p.mesh.userData.svMat : null;
    if (mat && mat.emissive) mat.emissive.setRGB(0, 0, 0);
  }

  function startPulse(mesh, strength, glow) {
    if (!mesh) return;
    for (var i = 0; i < S.pulses.length; i++) {
      if (S.pulses[i].mesh === mesh) {
        finishPulse(S.pulses[i]);
        S.pulses.splice(i, 1);
        break;
      }
    }
    if (S.pulses.length >= CFG.maxPulses) finishPulse(S.pulses.shift());
    S.pulses.push({
      mesh: mesh,
      t: 0,
      dur: 0.3,
      s0: mesh.scale.clone(),
      k: strength,
      glow: !!glow
    });
  }

  /* ---- ghost line: dashed outline at the personal-best height ---------- */
  /* Reads StackCore.getTowerState() (public state seam); rebuilt fresh on
     every init/reset so visuals' own reset can never leave a stale mesh. */

  var GHOST = { line: null, best: 0, passed: false };

  function ghostRemove() {
    if (GHOST.line && ctx && ctx.scene) { ctx.scene.remove(GHOST.line); }
    if (GHOST.line) {
      if (GHOST.line.geometry) GHOST.line.geometry.dispose();
      if (GHOST.line.material) GHOST.line.material.dispose();
    }
    GHOST.line = null;
  }

  function ghostStyle(passed) {
    if (!GHOST.line) return;
    GHOST.line.material.opacity = passed ? 0.85 : 0.38;
  }

  function ghostSync() {
    if (!S.inited) return;
    ghostRemove();
    GHOST.passed = false;
    var core = window.StackCore;
    var st = core && core.getTowerState ? core.getTowerState() : null;
    GHOST.best = st && st.best ? st.best : 0;
    if (!st || GHOST.best < 10) return;
    var half = st.blockSize * 0.62;
    var pts = [
      new T.Vector3(-half, 0, -half), new T.Vector3(half, 0, -half),
      new T.Vector3(half, 0, half), new T.Vector3(-half, 0, half),
      new T.Vector3(-half, 0, -half)
    ];
    var geo = new T.BufferGeometry().setFromPoints(pts);
    var mat = new T.LineDashedMaterial({
      color: 0xffffff, transparent: true, opacity: 0.38,
      dashSize: 0.16, gapSize: 0.12, depthWrite: false
    });
    var line = new T.Line(geo, mat);
    line.computeLineDistances();
    line.position.y = GHOST.best * st.blockHeight + 0.01;
    line.userData.svGhost = true;
    line.renderOrder = 3;
    ctx.scene.add(line);
    GHOST.line = line;
  }

  function ghostCheckPassed(level) {
    if (!GHOST.line || GHOST.passed) return;
    if (typeof level === 'number' && level > GHOST.best) {
      GHOST.passed = true;
      ghostStyle(true);
    }
  }

  function onBlockPlaced(mesh, level, opts) {
    opts = opts || {};
    if (!S.inited) return;
    if (typeof level !== 'number') level = S.level + 1;
    styleBlock(mesh, level, opts);
    if (level > S.level) setLevel(level);
    if (opts.perfect) {
      perfectFlashForMesh(mesh);
      startPulse(mesh, 0.05, true);
    } else if (opts.almost) {
      /* Near-miss: hairline cue, clearly weaker than the perfect flash. */
      var afp = meshFootprint(mesh, {});
      if (afp) {
        perfectFlash(
          { x: afp.cx, y: afp.topY + 0.03 * S.blockW, z: afp.cz },
          afp.sx * 0.72, afp.sz * 0.72, 0.5
        );
      }
      startPulse(mesh, 0.03, false);
    } else {
      startPulse(mesh, 0.016, false);
    }
    /* Track the tower's horizontal drift: placed blocks never move again, so
       the ghost only needs updating when one lands, not every frame. */
    if (GHOST.line && mesh) {
      GHOST.line.position.x = mesh.position.x;
      GHOST.line.position.z = mesh.position.z;
    }
    ghostCheckPassed(level);
  }

  /* Cut piece handover. The piece must read as physical: it tips OUTWARD
     over the cut edge (never back into the tower), clears the silhouette
     with a small outward nudge, falls under strong gravity with horizontal
     drag, and fades out quickly so pieces never pile up mid-air. */
  function spawnDebris(mesh, opts) {
    if (!S.inited || !mesh || !mesh.geometry) return;
    opts = opts || {};
    if (S.debris.length >= CFG.maxDebris) removeDebris(S.debris[0]);
    var ud = mesh.userData || (mesh.userData = {});
    ud.svDebris = true;
    if (ud.svRegistered) ud.svRegistered = false;
    // Own material so the fade never touches a shared tower material.
    var baseColor = null;
    if (mesh.material && mesh.material.color) baseColor = mesh.material.color.clone();
    var lv = typeof opts.level === 'number' ? opts.level : (ud.svLevel | 0) || S.level;
    if (ud.svMat) { ud.svMat.dispose(); ud.svMat = null; }
    var mat = makeBlockMaterial(baseColor || new T.Color(0xffffff));
    if (!baseColor) {
      var p = blockHSL(lv, 0);
      setHSLInto(mat.color, p.h, p.s, p.l);
    }
    mat.opacity = 0.85;
    ud.svMat = mat;
    mesh.material = mat;
    ensureEdges(mesh);
    if (ud.svEdges) ud.svEdges.material = S.edgeMat.clone();
    var dir = null;
    if (opts.dir && typeof opts.dir.x === 'number' &&
        (opts.dir.x !== 0 || (opts.dir.z || 0) !== 0)) {
      dir = new T.Vector3(opts.dir.x, 0, opts.dir.z || 0);
    } else {
      dir = new T.Vector3(mesh.position.x, 0, mesh.position.z);
    }
    if (dir.lengthSq() < 1e-8) dir.set(0.6, 0, 0.4);
    dir.normalize();
    // Tip axis: horizontal, perpendicular to the outward direction. A
    // positive rate around (up x dir) dips the outer edge downward.
    var axis = new T.Vector3(0, 1, 0).cross(dir);
    if (axis.lengthSq() < 1e-8) axis.set(1, 0, 0);
    axis.normalize();
    // Nudge the piece off the cut plane so it never shares the silhouette.
    mesh.position.addScaledVector(dir, 0.05 * S.blockW);
    mesh.position.y -= 0.01 * S.blockW;
    if (!mesh.parent) ctx.scene.add(mesh);
    S.debris.push({
      mesh: mesh,
      vel: dir.clone().multiplyScalar((0.9 + Math.random() * 0.35) * S.blockW)
        .add(new T.Vector3(0, 0.05 * S.blockW, 0)),
      axis: axis,
      rate: 1.5 + Math.random() * 1.1,
      t: 0,
      fadeAt: CFG.debrisFadeAt,
      dur: CFG.debrisLife,
      baseOp: mat.opacity
    });
  }

  function removeDebris(entry) {
    var idx = S.debris.indexOf(entry);
    if (idx >= 0) S.debris.splice(idx, 1);
    var mesh = entry.mesh;
    if (!mesh) return;
    var ud = mesh.userData || {};
    if (ud.svEdges) {
      mesh.remove(ud.svEdges);
      if (ud.svEdges.geometry) ud.svEdges.geometry.dispose();
      if (ud.svEdges.material && ud.svEdges.material !== S.edgeMat) ud.svEdges.material.dispose();
      ud.svEdges = null;
      ud.svEdgesGeoId = null;
    }
    if (mesh.parent) mesh.parent.remove(mesh);
    if (ud.svMat) {
      ud.svMat.dispose();
      ud.svMat = null;
    }
    if (mesh.geometry && ud.svOwnGeometry !== false) mesh.geometry.dispose();
  }

  function setLevel(l) {
    l = l | 0;
    var changed = l !== S.level;
    S.level = l;
    computeBgTargets();
    if (changed) recolorAll();
  }

  function onGameOver() {
    S.gameDimTarget = 1;
  }

  function reset() {
    while (S.debris.length) removeDebris(S.debris[0]);
    for (var i = 0; i < S.pulses.length; i++) finishPulse(S.pulses[i]);
    S.pulses.length = 0;
    for (var j = 0; j < S.flashPool.length; j++) {
      S.flashPool[j].active = false;
      S.flashPool[j].mesh.visible = false;
    }
    for (var k = 0; k < S.registry.length; k++) {
      var m = S.registry[k];
      if (m && m.userData) m.userData.svRegistered = false;
    }
    S.registry.length = 0;
    S.level = 0;
    S.gameDim = 0;
    S.gameDimTarget = 0;
    // fresh palette family per run, the reference game does the same
    pickRunPalette();
    computeBgTargets();
  }

  /* ------------------------------------------------ per-frame */

  function easeOutCubic(p) {
    var q = 1 - p;
    return 1 - q * q * q;
  }

  function update(dt) {
    if (!S.inited) return;
    dt = Math.max(0, Math.min(dt || 0.016, 0.05));
    S.time += dt;
    S.gameDim += (S.gameDimTarget - S.gameDim) * (1 - Math.exp(-dt * 3));

    // background drift
    var k = 1 - Math.exp(-dt * 2.4);
    S.bgCur.inner.lerp(S.bgTarget.inner, k);
    S.bgCur.outer.lerp(S.bgTarget.outer, k);
    S.bgCur.beam.lerp(S.bgTarget.beam, k);

    var dimMul = 1 - 0.32 * S.gameDim;
    var u = S.sky.material.uniforms;
    dispInto(S.bgCur.inner, S.tmpC).multiplyScalar(dimMul);
    u.uInner.value.copy(S.tmpC);
    dispInto(S.bgCur.outer, S.tmpC).multiplyScalar(dimMul);
    u.uOuter.value.copy(S.tmpC);
    dispInto(S.bgCur.beam, S.tmpC).multiplyScalar(dimMul);
    u.uBeam.value.copy(S.tmpC);
    u.uTime.value = S.time;
    if (ctx.renderer && ctx.renderer.domElement) {
      u.uRes.value.set(ctx.renderer.domElement.width, ctx.renderer.domElement.height);
    }

    if (S.fog) S.fog.color.copy(S.bgCur.outer);

    var li = S.lights;
    var lightMul = 1 - 0.4 * S.gameDim;
    li.key.intensity = li.keyBase * lightMul;
    li.hemi.intensity = li.hemiBase * lightMul;
    li.fill.intensity = li.fillBase * lightMul;

    // particles
    if (S.particles) {
      var pu = S.particles.material.uniforms;
      pu.uTime.value = S.time;
      pu.uDim.value = S.gameDim;
      if (ctx.camera) {
        ctx.camera.getWorldDirection(S.tmpV);
        S.tmpV.multiplyScalar(13 * S.blockW).add(ctx.camera.position);
        pu.uCenter.value.copy(S.tmpV);
      }
      if (ctx.renderer && ctx.renderer.domElement) {
        pu.uPx.value = ctx.renderer.domElement.height * 0.16;
      }
      if (ctx.camera && ctx.camera.isOrthographicCamera) {
        pu.uOrtho.value = 1;
        var fh = (ctx.camera.top - ctx.camera.bottom) / (ctx.camera.zoom || 1);
        if (fh > 0 && ctx.renderer && ctx.renderer.domElement) {
          pu.uPPU.value = (ctx.renderer.domElement.height / fh) * 0.06;
        }
      } else {
        pu.uOrtho.value = 0;
      }
    }

    // flashes
    for (var i = 0; i < S.flashPool.length; i++) {
      var f = S.flashPool[i];
      if (!f.active) continue;
      f.t += dt;
      var p = f.t / CFG.flashDur;
      if (p >= 1) {
        f.active = false;
        f.mesh.visible = false;
        continue;
      }
      var s = 1 + 0.85 * easeOutCubic(p);
      f.mesh.scale.set(f.sx * s, f.sz * s, 1);
      f.mesh.material.uniforms.uOpacity.value = (1 - p) * (1 - p);
    }

    // pulses
    for (var q = S.pulses.length - 1; q >= 0; q--) {
      var pl = S.pulses[q];
      pl.t += dt;
      var pp = pl.t / pl.dur;
      if (pp >= 1) {
        finishPulse(pl);
        S.pulses.splice(q, 1);
        continue;
      }
      var sc = 1 + pl.k * Math.sin(pp * Math.PI);
      pl.mesh.scale.copy(pl.s0).multiplyScalar(sc);
      if (pl.glow) {
        var mat = pl.mesh.userData ? pl.mesh.userData.svMat : null;
        if (mat && mat.emissive) {
          var e = 0.55 * (1 - pp) * (1 - pp);
          mat.emissive.setRGB(e, e, e);
        }
      }
    }

    // debris
    var camY = ctx.camera ? ctx.camera.position.y : 0;
    var drag = Math.exp(-CFG.debrisDrag * dt);
    for (var d = S.debris.length - 1; d >= 0; d--) {
      var en = S.debris[d];
      en.t += dt;
      en.vel.y -= CFG.gravity * S.blockW * dt;
      en.vel.x *= drag;
      en.vel.z *= drag;
      en.mesh.position.addScaledVector(en.vel, dt);
      if (en.mesh.rotateOnWorldAxis) en.mesh.rotateOnWorldAxis(en.axis, en.rate * dt);
      else en.mesh.rotateOnAxis(en.axis, en.rate * dt);
      var gone = en.mesh.position.y < camY - 26 * S.blockW;
      if (en.t > en.fadeAt) {
        var ff = (en.t - en.fadeAt) / (en.dur - en.fadeAt);
        if (ff >= 1) gone = true;
        else {
          var op = en.baseOp * (1 - ff);
          if (en.mesh.userData.svMat) en.mesh.userData.svMat.opacity = op;
          var edges = en.mesh.userData.svEdges;
          if (edges && edges.material) edges.material.opacity = 0.6 * (1 - ff);
        }
      }
      if (gone) removeDebris(en);
    }
  }

  /* ------------------------------------------------ init and teardown */

  function setupRenderer() {
    var r = ctx.renderer;
    if (!r) return;
    try {
      if (T.ACESFilmicToneMapping !== undefined) {
        r.toneMapping = T.ACESFilmicToneMapping;
        r.toneMappingExposure = 1.0;
      }
      if (T.SRGBColorSpace !== undefined && 'outputColorSpace' in r) {
        r.outputColorSpace = T.SRGBColorSpace;
      } else if (T.sRGBEncoding !== undefined && 'outputEncoding' in r) {
        r.outputEncoding = T.sRGBEncoding;
      }
    } catch (e) {}
  }

  function init(opts) {
    opts = opts || {};
    T = opts.THREE || window.THREE;
    if (!T) {
      if (window.console) console.warn('StackVisuals: THREE not found, init skipped');
      return null;
    }
    if (S.inited) return api;
    if (!opts.scene) {
      if (window.console) console.warn('StackVisuals: init needs a scene');
      return null;
    }
    ctx = { scene: opts.scene, camera: opts.camera || null, renderer: opts.renderer || null };
    S.tmpV = new T.Vector3();
    S.tmpV2 = new T.Vector3();
    S.tmpC = new T.Color();
    S.tmpC2 = new T.Color();
    setupColorManagement();
    setupRenderer();
    S.edgeMat = new T.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.62,
      blending: T.AdditiveBlending,
      depthWrite: false
    });
    S.edgeMat.toneMapped = false;
    pickRunPalette();
    computeBgTargets();
    buildSky();
    buildLights();
    buildEnv();
    buildParticles();
    buildFlashPool();
    try {
      S.fog = new T.FogExp2(S.bgCur.outer.getHex(), 0.02 / S.blockW);
      ctx.scene.fog = S.fog;
    } catch (e) {}
    S.inited = true;
    var queued = S.pending;
    S.pending = [];
    for (var i = 0; i < queued.length; i++) {
      styleBlock(queued[i][0], queued[i][1], queued[i][2]);
    }
    return api;
  }

  function dispose() {
    if (!S.inited) return;
    reset();
    var drop = [S.sky, S.particles];
    if (S.lights) drop.push(S.lights.hemi, S.lights.key, S.lights.fill);
    for (var i = 0; i < S.flashPool.length; i++) drop.push(S.flashPool[i].mesh);
    for (var j = 0; j < drop.length; j++) {
      var o = drop[j];
      if (!o) continue;
      if (o.parent) o.parent.remove(o);
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    }
    if (S.envRT) {
      S.envRT.dispose();
      if (ctx.scene.environment === S.envRT.texture) ctx.scene.environment = null;
      S.envRT = null;
    }
    if (ctx.scene.fog === S.fog) ctx.scene.fog = null;
    S.fog = null;
    S.flashPool.length = 0;
    S.sky = null;
    S.particles = null;
    S.lights = null;
    S.inited = false;
  }

  /* ------------------------------------------------ public API */

  function getBlockColor(level, depth) {
    if (!T) return '#8fd2c8';
    var p = blockHSL(level | 0, depth | 0);
    return css(hsl(p.h, p.s, p.l));
  }

  function getPalette() {
    if (!S.bgCur) {
      return { bg: '#1a6f9e', bgInner: '#6ec6e8', block: '#c9e8dd', accent: '#ffffff' };
    }
    return {
      bg: css(S.bgCur.outer),
      bgInner: css(S.bgCur.inner),
      block: getBlockColor(S.level, 0),
      accent: '#ffffff'
    };
  }

  var api = {
    version: '2.0.0',
    init: init,
    isReady: function () { return S.inited; },
    styleBlock: styleBlock,
    onBlockPlaced: onBlockPlaced,
    spawnDebris: spawnDebris,
    perfectFlash: perfectFlash,
    setLevel: setLevel,
    update: update,
    reset: reset,
    onGameOver: onGameOver,
    dispose: dispose,
    getBlockColor: getBlockColor,
    getPalette: getPalette
  };

  window.StackVisuals = api;

  /* CustomEvent wiring, optional loose-coupling path */
  function det(e) { return (e && e.detail) || {}; }
  window.addEventListener('stack:init', function (e) {
    var d = det(e);
    init({ scene: d.scene, camera: d.camera, renderer: d.renderer, THREE: d.THREE });
    ghostSync();
  });
  window.addEventListener('stack:block', function (e) {
    var d = det(e);
    styleBlock(d.mesh, d.level, d);
  });
  window.addEventListener('stack:placed', function (e) {
    var d = det(e);
    onBlockPlaced(d.mesh, d.level, d);
  });
  window.addEventListener('stack:debris', function (e) {
    var d = det(e);
    spawnDebris(d.mesh, d);
  });
  window.addEventListener('stack:level', function (e) {
    var d = det(e);
    if (typeof d.level === 'number') setLevel(d.level);
  });
  window.addEventListener('stack:gameover', function () { onGameOver(); });
  window.addEventListener('stack:reset', function () { reset(); ghostSync(); });
  /* stack:reset only fires on restarts. game:start is still needed as a
     fallback because core.js fires stack:init before it reads `best` from
     localStorage (fireDom('stack:init', ...) runs ahead of the
     localStorage read in init()), so the ghostSync() above always sees
     best=0 on that first call and can build no line. game:start fires
     once best is loaded, on every run start including the first, so the
     ghost is guaranteed by then. */
  window.addEventListener('game:start', function () { ghostSync(); });
})();
