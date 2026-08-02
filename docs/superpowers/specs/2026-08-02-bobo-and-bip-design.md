# Bobo World + the sliced-placement sound — design

Status: approved by Maor 2026-08-02. Sound candidate B (Thunk); World
variant 1 (Fudge) as a booby prize, hidden until earned.

Two changes that travel together because they are both small and both
sensory: the seventh World, and the sound that plays on every off-centre
landing. Neither touches core.js, the leaderboard, or the points economy.

## 1. The sliced-placement sound

### The complaint

`playSliced` in audio.js is the most-heard sound in the game: it fires on
every landing that is not perfect, which on a 40-block run is most of them.
Maor's verdict (2026-08-02) is that it is annoying. Reading a diff cannot
settle that, so the decision came from an audition page that lifted the real
synthesis (`MASTER_GAIN`, the compressor chain, `noise()`, `envGain()`,
`tone()`) byte-for-byte out of audio.js, played the six candidates blind
with the current sound unlabelled among them, and offered each one at real
run pacing against the perfect chime.

Page: `scratchpad/bip-audition.html` (session scratch, not in the repo).

### The candidates

| Letter | Name  | Shape |
|--------|-------|-------|
| A | Wood  | Sine at `tap * 0.5` (220 Hz) plus a woody partial at 2.76×, peak 0.24, decay 0.10. Swish darkened to 900→300 Hz and shortened to 0.07 s. No random detune. |
| B | Thunk | No pitched note. Sine body gliding 150→78 Hz, peak 0.34, decay 0.11, plus a 700→220 Hz swish. |
| C | Slide | Noise only, no oscillator. Bandpass 2200→520 Hz over 0.20 s, Q 0.6, with a 20 ms fade-in instead of the 2 ms snap. |
| D | Glass | **The current sound.** Triangle at `tap ± 15` Hz random, peak 0.35, decay 0.14, plus a bandpass 1200→400 Hz swish at peak 0.12. |
| E | Tick  | 45 ms high-passed (1400 Hz) click at peak 0.14, plus a 320 Hz sine at peak 0.10, decay 0.05. |
| F | Fall  | Triangle gliding `tap*0.62`→`tap*0.40` (273→176 Hz), peak 0.28, decay 0.15, plus an 1100→380 Hz swish. |

### What we believe is wrong with D

Three properties, any of which could be the irritant, which is why the
alternatives vary them independently rather than all at once:

- It is loud. Peak 0.35 against the perfect chime's 0.45, so the failure
  sound is nearly as prominent as the reward sound.
- It is pitched and flat. A held tone at 440 Hz reads as an error beep.
- It wobbles. The `Math.random() * 30 - 15` detune means the pitch is
  slightly different every time, which reads as out of tune rather than as
  variety.

### Decision: B, Thunk

Maor picked B by ear on 2026-08-02, blind, with D unlabelled in the set.

The audition version of B hard-codes 150 Hz and 78 Hz, because the page ran
with classic's `tap` of 440. Shipped verbatim, that would make every World's
sliced sound identical and leave `WORLD_SOUND[].tap` completely unread,
since `playSliced` is its only consumer. Six entries of dead data, and every
World loses one of the two dimensions that distinguish its voice.

So the body pitch is **derived from `tap` instead of fixed**:

```js
/* Sliced placement: a low body falling away under the shaved piece's
   swish. No pitched note: a held tone reads as an error beep, and this
   fires on most landings in a run. The body tracks the World's tap so
   each World still has its own weight; the ratios reproduce 150 -> 78 Hz
   at classic's tap of 440, which is the sound that was approved. */
function playSliced(t) {
  var o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(sound.tap * 0.34, t);
  o.frequency.exponentialRampToValueAtTime(sound.tap * 0.177, t + 0.09);
  o.connect(envGain(t, 0.34, 0.11));
  o.start(t);
  o.stop(t + 0.16);
  var src = ctx.createBufferSource();
  src.buffer = noise();
  var bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(700, t);
  bp.frequency.exponentialRampToValueAtTime(220, t + 0.10);
  bp.Q.value = 0.7;
  src.connect(bp);
  bp.connect(envGain(t, 0.10, 0.10));
  src.start(t);
  src.stop(t + 0.12);
}
```

Classic keeps exactly the sound Maor approved: 440 × 0.34 = 149.6 and
440 × 0.177 = 77.9. The swish stays fixed at 700→220 Hz for every World,
which mirrors the structure being replaced (the old version's swish was
fixed too; only its tap tone was per-World).

Resulting body pitches, for the record:

| World | tap | body glide |
|-------|-----|------------|
| classic | 440 | 150 → 78 Hz |
| sunset | 392 | 133 → 69 Hz |
| neon | 494 | 168 → 87 Hz |
| deepsea | 349 | 119 → 62 Hz |
| marble | 415 | 141 → 73 Hz |
| obsidian | 311 | 106 → 55 Hz |
| bobo | 349 | 119 → 62 Hz |

### Known risk: phone speakers

B's body sits between 55 and 168 Hz depending on the World, and phone
speakers roll off hard below roughly 200 Hz. The audition ran on a desktop.
On an iPhone the body may be much quieter than it sounded, leaving mostly
the swish.

This is not a blocker and not a reason to change the design pre-emptively:
the sound is deliberately meant to recede, and the swish carries on its own.
It is a **named check for the live verification pass** on Maor's actual
phone. If the thunk proves inaudible there, the fix is one constant: raise
both ratios (e.g. 0.50 / 0.26, giving 220 → 114 Hz at classic), which keeps
the falling-body character that won the audition. Obsidian at 106 → 55 Hz is
the worst case and the one to listen to.

### Scope

`audio.js` only, plus a rebuild of `Stack.html`. No event contracts change,
and `WORLD_SOUND[].tap` keeps its meaning.

## 2. BOBO — the seventh World

### What it is

A brown World, themed as chocolate. Maor picked variant 1 (`fudge`) from a
three-variant mockup round; the rejected two were `swamp` (murky khaki) and
`sundae` (chocolate blocks on a cream sky).

Page: `scratchpad/bobo-worlds.html` (session scratch, not in the repo).

The chosen variant plays the art completely straight. The joke lives
entirely in the name and in how you get it, not in the palette, which means
Bobo still looks like it belongs beside the other six in a store screenshot.

### The palette problem this exposed

`blockHSL` walks the block hue upward as the tower climbs, at a fixed
`CFG.hueStep` of 3.8 degrees per block. That is why classic runs from teal
to violet, and it is fine for every World shipped so far because each one's
`families` list spans a wide enough band to absorb the walk.

A brown World cannot absorb it. At 3.8 degrees per block, a tower starting
at hue 24 is green by block 20 and blue by block 45. The mockup page proves
this: it renders the real formula, and the first draft's towers came out
green and gold rather than brown.

**Fix:** `WORLD_STYLES` entries gain an optional `hueStep`. `blockHSL` reads
`worldStyle.hueStep` when present and `CFG.hueStep` otherwise, and
`pickRunPalette` scales its per-run randomisation off the same value. The
six existing Worlds omit the field and behave exactly as they do today. Bobo
sets 0.4, which is 18 degrees of drift over 45 blocks: enough to keep the
tower from looking flat, small enough that it never leaves brown.

### The numbers

`visuals.js` — `WORLD_STYLES`:

```js
bobo: {
  families: [24, 30, 18, 36, 12],
  hueStep: 0.4,
  satBias: -0.22, lightBias: -0.10,
  sky: { base: 28, swing: 5, innerS: 0.42, innerLBias: -0.24,
         outerS: 0.50, outerL: 0.08, beamS: 0.40, beamL: 0.72 }
}
```

`hud.js` — `WORLDS`:

```js
{ id: 'bobo', name: 'BOBO', price: 0, giftAt: 0, secret: true,
  sky: 'radial-gradient(120% 100% at 50% 26%,#885737 0%,#1f180a 78%)',
  blocks: ['#a7704b', '#90542b', '#82471f'] }
```

**Card art is sampled by depth, not by hue.** The other six cards take three
points of their World's hue ladder, which works because their `families`
lists span a wide band. Bobo's hue barely moves by construction, which is
the whole point of `hueStep: 0.4`, so three hue samples come back as the
same colour three times (`#a37649`, `#a5724a`, `#a7704b`: indistinguishable).
The values above are instead sampled at depths 0, 6 and 13 at level 0, which
is the light-to-dark falloff a real tower shows, narrow bright rung on top.
This is a change of constants only; no card-rendering code changes, and the
other six cards are not touched.

`audio.js` — `WORLD_SOUND`:

```js
bobo: { base: 415.30, tap: 349, ladder: [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17] }
```

Major ladder, matching the other bright Worlds. Base is G#4, the lowest of
the majors, which sits with the warm palette.

`hud.js` — `WORLD_QUIPS.bobo`, eight lines, deadpan rather than scatological.
The World is called Bobo; the copy does not need to press the point:

```
Well. That happened.
Down the drain, as ever.
Nothing about that was solid.
A brown day for architecture.
It went the way these things go.
The tower had one job.
Gravity remains undefeated.
Back to the bottom with you.
```

### How you get it: the booby prize

Bobo is **not for sale and not a tier gift.** It is granted the first time
you die with a score of 0.

- `giftAt: 0` is load-bearing: it keeps Bobo out of the `fireBoot` gift loop
  and out of `giftWorldForTier`, both of which test `giftAt > 0`.
- `price: 0` is **not** a guard and must not be mistaken for one. The buy
  path tests `bal < w.price`, and `bal < 0` is false for every balance, so a
  price of 0 makes Bobo free rather than unbuyable. It is set to 0 only so
  no price string can ever render. The actual guard is `secret`, below.
- The grant fires in `applyOver`, after `finalScore` is settled, when
  `finalScore === 0` and `grantWorld('bobo')` returns true.
- **Either mode counts.** Dying at 0 in Hard is easier than in Normal, but
  Bobo is a joke rather than an achievement, and a mode gate would be a rule
  with no payoff. Deliberate, not an oversight.
- The grant never equips. Consistent with the tier gifts, and equipping a
  brown World under someone the instant they fumble the first block would be
  a punishment rather than a prize.

### How you learn about it

The existing tier-up toast, which the density revision established as the
only in-game voice of this kind. Wording:

```
▲ BOBO · WORLD UNLOCKED
```

Same `▲ <NAME> · WORLD UNLOCKED` shape the Obsidian gift already uses, so
the player has seen this exact sentence form before if they got that far.

Timing: it fires on the same frame the death screen appears. That is
correct rather than a clash: you failed at the first block, and something
immediately arrives to mark it.

### The shop card is hidden until earned

Maor's decision (2026-08-02). Marble and Obsidian sit in the grid from day
one wearing a `MARBLE GIFT` chip that names their unlock. Bobo does not
follow that pattern: a chip stating the condition turns the prize into a
checklist item people farm on purpose, and the ambush is the whole joke.

This is a third acquisition kind, so it gets its own catalog flag rather
than three separate tests for the literal id `'bobo'`. `secret: true` on the
World entry; the other six omit the field.

- The card is still **built** at boot, in `buildDom`'s `WORLDS` loop, so
  grid construction stays a straight iteration with no special case.
- `renderShopPane` hides it while unowned: `c.card.hidden = !!(w.secret &&
  !ownsWorld(w.id))`, and sets `.hidden = false` on every other card so a
  card can never stay hidden after the grant. Once granted it appears on the
  next shop open with no reload, because `renderShopPane` runs on every
  `setPane('shop')`.
- Its chip states follow the normal rules from that point on: `ON` when
  equipped, `OWNED` otherwise. It never shows a price.

**Hiding the card is presentation, not a guard.** The click handler's
existing purchase path is reachable independently:

```js
if (w.giftAt > 0) { disarmShop(true); return; }   /* locked gift */
var bal = readInt(PTS_KEY);
if (bal < w.price) { disarmShop(true); return; }
```

Bobo has `giftAt: 0` and `price: 0`, so it passes both tests (`bal < 0` is
false for every balance including zero), arms on the first tap and grants
itself free on the second. A hidden element is still in the DOM, still
focusable, and `keepKeysLocal` is wired to every card, so keyboard
activation reaches it. The handler therefore needs its own line, placed
immediately after the `ownsWorld(id)` equip branch and before the gift test:

```js
if (w.secret) { disarmShop(true); return; }   /* earned, never bought */
```

Unconditional on `secret`: by that point in the handler an owned World has
already returned via the equip branch, so anything still reaching this line
is unowned.

**Hazard, and this codebase has been bitten by it twice.** An author
`display` declaration beats the user-agent `[hidden] { display: none }`
rule. `.hud-shop-card` is a grid item with its own `display`, so setting
`.hidden` will do nothing on its own. `hud.css` needs an explicit
`.hud-shop-card[hidden] { display: none; }` rule, and the test must assert
**computed** style, never `el.hidden`, because a property-based assertion is
structurally blind to this failure and has passed over it before, on
`.hud-lb-list` during the density revision and `.hud-rec-row` during Hard
mode.

### Grid arithmetic

The shop grid holds six cards plus the `PRIZE MACHINE · COMING SOON` tile,
which is seven tiles. Bobo makes it seven cards plus the tile, which is
eight. Whatever column count `hud.css` uses, the last row's fill changes for
anyone who owns Bobo, so the grid needs a look on a real phone viewport
before this ships, not only in a desktop browser.

## Testing

Playwright, emulated iPhone 13, `?debug=1`, POSTs to
`**/rest/v1/stack_scores*` intercepted so nothing reaches the real board.

1. **Grant on a score-0 death.** Fresh storage, die at 0, assert
   `stack-owned` contains `bobo` and the toast text reads
   `▲ BOBO · WORLD UNLOCKED`.
2. **Granted once.** Die at 0 twice; the second death fires no toast and
   leaves `stack-owned` unchanged.
3. **Hard counts too.** Same as 1 with `stack-mode` seeded to `hard`.
4. **Not granted on a scoring death.** Die at 5; `stack-owned` has no
   `bobo`.
5. **Card hidden before, shown after**, asserting
   `getComputedStyle(card).display`, not `card.hidden`.
6. **Never purchasable.** With a large points balance and Bobo unowned,
   drive the card's click handler directly (the element is in the DOM even
   while hidden, so a test must not rely on it being untappable): two taps
   must leave `stack-owned` without `bobo` and the balance unchanged.
   Repeat via keyboard activation, since `keepKeysLocal` is wired to every
   card.
7. **hueStep isolation.** Equip each of the six existing Worlds and assert
   the block hues they produce are unchanged from the current build.
8. **World voice.** Equip Bobo, assert `StackAudio.debug.world === 'bobo'`
   and `StackVisuals` reports the bobo palette.
9. Existing suites reconciled: any that counts shop cards or asserts grid
   contents.

## Out of scope

Sound themes as a marketplace item, the prize machine, and the ~20 singles
all stay in Wave B. Bobo is a single catalog addition plus one new grant
path.
