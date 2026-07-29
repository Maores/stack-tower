# Sound layer design

Date: 2026-07-29. Status: approved (brainstorm with Maor). Haptics explicitly deferred to the native-wrapper phase; this spec is sound only.

## Goal

Add synthesized sound to the stack-tower web game: glassy minimal SFX, no ambient music, with a persistent mute toggle. No audio assets; everything is generated with WebAudio at runtime so the game stays a static, offline-capable page.

## Out of scope

- Haptics/vibration (returns with the Capacitor wrapper, which also brings iPhone support)
- Ambient or background music
- UI sounds (save, board open/close), start blip, new-best jingle (candidates for a later pass)

## Architecture

- New file `audio.js`, ES5 IIFE style matching the codebase, loaded after `hud.js` in `index.html`, and added to the `Stack.html` offline inline list.
- Consumes only existing window CustomEvents; core.js and visuals.js are untouched:
  - `stack:placed` detail `{ mesh, level, perfect }`: placement sounds and streak tracking
  - `game:start`: reset the streak
  - `game:over`: game-over sound
- audio.js keeps its own perfect-streak counter (perfect placement increments, sliced placement resets, `game:start` resets), so it never depends on event ordering relative to `game:perfect`.
- hud.js adds the mute button (the HUD owns all DOM): a top-left speaker icon, visible in title and over states only, which toggles the localStorage key and dispatches `hud:mute` `{ muted }`.
- Coupling stays event-only per the project contract. The shared localStorage key `stack-muted` is the one deliberate common constant, documented in both files.
- Public API: `window.StackAudio = { version, isReady(), muted, setMuted(bool), debug: { played, last } }`. `debug.played` counts scheduled sounds and `debug.last` names the most recent one, mirroring the `StackCore.debug` testing pattern.

## AudioContext lifecycle

- Created lazily inside the first user gesture (`pointerdown` or `keydown` capture listeners registered at boot, removed once creation succeeds), satisfying autoplay policy with no console warnings.
- `resume()` is retried on `visibilitychange` back to visible and on later gestures whenever state is not `running` (covers the iOS `interrupted` state).
- Muted: the context is suspended entirely (zero battery cost); unmute resumes it, or creates it on the next gesture if it never existed.
- Every audio call is wrapped defensively (try/catch, hud.js style). The game must never break because audio failed.

## Sound palette (glassy minimal)

Master chain: voices route into one master GainNode (0.5) into a DynamicsCompressor (defaults) into the destination.

- **Sliced placement**: glass tap. Triangle oscillator, base 440Hz with random detune up to ±15Hz, 2ms attack, roughly 140ms exponential decay, peak gain 0.35. Layered with a white-noise burst through a bandpass sweeping 1200Hz down to 400Hz over roughly 120ms at gain 0.12 (the shaved-piece swish).
- **Perfect placement**: the signature chime ladder. Major pentatonic on C5 (523.25Hz), steps C D E G A per octave, one step per consecutive perfect, capped at 10 steps (two octaves) and held at the cap; resets with the streak. Voice: sine at f plus sine at 2f (0.4 relative gain) with slight detune shimmer, roughly 350ms decay, peak gain 0.45.
- **Game over**: a low felt thud (sine gliding 150Hz to 55Hz over 300ms, peak 0.6, roughly 500ms decay), then about 250ms later a quiet two-note descending motif (E4 then A3, triangle, gain 0.2).
- Exponential ramps bottom out at 0.0001; every voice stops and disconnects its nodes after the tail. Exact frequencies, decays, and gains are starting values, tunable by ear during implementation without changing this design.

## Mute UX

- Speaker SVG button (slash overlay when muted), styled to mirror `.hud-board-btn`, fixed top-left with the same safe-area `max()` pattern the trophy uses on the right.
- Hidden during play and boot, same rule as the trophy: any mid-run tap drops a block.
- Persistence: `localStorage['stack-muted']` is `'1'` or `'0'`; absent means sound on (the default).
- Accessibility: `aria-label` "Mute sound" / "Unmute sound", `aria-pressed` reflects state.

## Platform notes (accepted)

- The iPhone hardware silent switch mutes WebAudio output; accepted until the native wrapper phase.
- No persistent audio processing while idle; cost is event-driven only.

## Verification

Playwright emulated-phone run (project standard), against local `index.html` first, then the live URL after deploy:

1. Load and tap to start: `StackAudio.isReady()` is true after the first gesture and the context state is `running`.
2. Play mixed drops via `StackCore.debug.drop(offset)` (0 for perfect, small for slice, large for miss): `debug.played` grows and `debug.last` matches each event class.
3. Mute button: visible on title and over states only; toggling flips the localStorage key and `aria-pressed`; while muted the context state is `suspended` and `debug.played` stops growing.
4. Zero console errors and pageerrors throughout.

Synthesis quality is a human judgment: Maor listens on a real phone before the feature is called done.

## Rollout

1. Housekeeping commit of the `.gitignore` change already sitting in the working tree (keeps CLAUDE.md local).
2. Feature commits: `audio.js`, the `index.html` script tag, and the hud.js/hud.css mute button.
3. Offline build: add the inliner to the repo as `scripts/` (Node, no dependencies) and rebuild `Stack.html` with audio.js included.
4. Push to main, GitHub Pages deploys, run the live verification pass. The test flow saves no scores; if any test row slips in, delete it per project rules.
5. Update the vault note and daily log.

## Implementation deviations (accepted)

- `debug.state()` was added to the public debug API; the spec's own verification section requires asserting context state.
- The gesture listeners stay attached permanently as cheap no-ops instead of being removed after context creation; removing them would contradict the spec's own "resume on later gestures" requirement (iOS interruptions).
- Voices stop their nodes after the tail but do not explicitly disconnect them; the per-voice subgraph becomes unreachable and is garbage-collected, which satisfies the intent.
