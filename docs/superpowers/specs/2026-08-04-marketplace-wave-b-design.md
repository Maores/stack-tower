# Marketplace Wave B: prize machine and singles

Approved by Maor 2026-08-04 (brainstorm in session; spin price and real-money
direction settled after the economy review, V2 slot roll picked from the
three-variant mockup round). Builds on the Wave A shop
(`2026-07-31-marketplace-wave-a-design.md`) and the retention design
(`2026-07-30-retention-loop-design.md`).

**Wave B (this spec):** the prize machine where its COMING SOON card sits,
a 22-single pool across seven slots, per-slot equipping over the active
World, direct buy as the deterministic alternative.

**Deferred to Wave C or later:** sound themes, the two secret ritual
Worlds, the chicken World ("Chicken or Kemah"), server-side inventory
(identity item), any real-money mechanism.

## Economy

- Earn rates are untouched. 1 per block, 3 per perfect, first run of the
  day x2, Hard x2, committed at death. The live board (2026-08-03: 285
  normal rows, median score 5, top quartile 29+) shows casual players
  earning crumbs already; scarcity comes from the sink side.
- **Spin: 200 points. Direct buy: 800 per single** (4x the spin, for
  players who want a specific item now). Full pool by spins alone: 4,400.
- **Points stay earn-only forever.** They are the only currency that
  touches the machine and the only thing that will ever be wagered.
  Real-money design is parked until the store phase and will be revised
  there (Maor, 2026-08-04); the leading candidate is a second, buyable,
  non-wagerable token that buys cosmetics directly and never enters the
  machine. Nothing in Wave B depends on that choice.

## The pool: 22 singles, seven slots

Micro-cosmetics layering over the active World, one equippable per slot.
Visual definitions are the contract; exact particle counts, colors, and
durations are tunable at implementation.

**Drop trail** (follows the sliding block):
1. COMET - warm streak behind the block, small sparks falling off.
2. RIBBON - a soft light ribbon waving in the block's wake.
3. BUBBLES - tiny bubbles drifting up from the trailing edge.

**Perfect flare** (layers over the existing perfect flash, never replaces it):
4. GOLD RING - one expanding gold ring.
5. SHOCKWAVE - a thinner, faster white ring with a sharper falloff.
6. STARBURST - 6-8 small star sparks thrown outward.

**Slice style** (restyles the cut-piece debris on a sliced landing):
7. GLASS SHARDS - the piece splits into 3-5 glinting shards.
8. CONFETTI - a burst of small colored rectangles.
9. PETALS - 4-6 soft petals fluttering down slower than debris gravity.
10. PIXELS - the piece dissolves into chunky squares that fade.

**Death effect** (dresses the run-ending miss; death stays silent, and the
death screen itself is untouched):
11. SLOW-MO SHATTER - the final fall plays at reduced speed for under a second.
12. BOUNCE - the missed block bounces once before falling away.
13. FIREWORKS - two or three firework bursts above the settled tower.

**New-record moment** (fires when the run passes the ghost line; visuals
already tracks the pass):
14. AURORA SWEEP - an aurora ribbon sweeps the sky once.
15. RING BURST - an expanding ring from the block that took the record.

**Block material** (finish adjustment in styleBlock, over the World palette):
16. GLASS - more translucent, brighter rim.
17. WOOD GRAIN - subtle grain stripes.
18. NEON EDGE - brighter glowing edge lines.

**Roast pack** (death-screen roast flavor; hud-internal):
19. SAVAGE PACK - meaner templates.
20. GENTLE PACK - kind, backhanded-compliment templates.
21. NERD PACK - programmer and science humor.
22. SHAKESPEARE PACK - thee/thou dramatics.

Roast packs each add ~8-10 templates to the roast pool when equipped
(replacing the default pack, not stacking). Game text stays English;
Hebrew player names keep their LRM guard in every new template.

## The machine

Lives at the bottom of the shop pane, full width, exactly where the
COMING SOON card sits today.

- **State-first spin.** The prize is decided and persisted the instant
  SPIN is tapped: balance -200, prize added to owned, auto-equipped to its
  slot, all before the animation starts. Closing the overlay mid-roll,
  reduced motion, or a crash can never lose a prize.
- **Draw:** uniform random among unowned singles. Never a duplicate;
  every spin yields a new item (Crossy Road rules). 22 spins fully drain
  the machine.
- **Reveal: the V2 slot roll** (picked from the mockup round). A reel of
  prize rows blurs vertically past a fixed window, decelerates over about
  1.25s with a cubic ease-out, lands centered on the prize, and the
  window frame flashes once (border + background tint, no glow shadow).
  The reel strip shows only unowned singles, so every spin advertises
  what is still winnable. Spin button locks (~1.9s) until the reveal
  settles. `prefers-reduced-motion`: no roll, the result row and win line
  appear immediately.
- **Insufficient balance:** button renders dim with the price visible;
  tapping spends nothing and does nothing.
- **Dormant state:** when all 22 are owned, the reel shows a static
  sample of the collection and the button becomes ALL PRIZES WON,
  disabled. No charge is possible.
- **Win line:** under the button, the last prize as slot label + name +
  EQUIPPED tick.

## Owning and equipping

- Seven slots; at most one equipped single per slot; empty slot = the
  World's default look. Singles are global across Worlds and modes.
- Winning a spin or direct-buying auto-equips that slot (same rule as
  Worlds). Tapping an owned single toggles equip/unequip. Tapping an
  unowned single starts the two-tap direct-buy at 800 (same confirm
  pattern as Worlds cards).
- **Storage** (client-local, same accepted risk as Worlds):
  - `stack-singles`: JSON array of owned single ids.
  - `stack-gear`: JSON map of slot id to equipped single id; absent key =
    nothing equipped. Unknown or corrupt entries are ignored defensively.
- **Event contract:** hud.js broadcasts `hud:gear
  {trail, flare, slice, death, record, material}` (equipped id or null
  per slot) at boot and on every change. Boot broadcast gates on
  DOMContentLoaded behind the readyState guard, like `hud:world`.
  visuals.js is the only consumer. Roast packs never ride the event;
  hud.js applies them internally.

## Shop pane layout

Balance row (unchanged), Worlds shelf (unchanged), then a GEAR rack, then
the machine card. The rack groups singles by slot: a small caps slot
label, then a row of small cards (swatch + name + state: price, OWNED, or
EQUIPPED). The overlay shell keeps the fixed height from the board
overhaul; the pane scrolls inside. No new elements on the title or death
screens; the machine and rack live entirely inside the existing SHOP pane.

## Effects wiring (visuals.js)

Each visual single is a small bounded effect riding existing events and
pools; zero core.js changes.

- Trails: emitted while the slider moves (driven from the existing
  per-frame update; the slider mesh is known from `stack:block`).
- Flares: on `stack:placed` with perfect, layered with the existing flash.
- Slice styles: on `stack:debris`, restyling or replacing the cut piece's
  look (the physics handover is untouched).
- Death effects: on `stack:gameover`, dressing the already-falling mesh
  or the settled tower.
- Record moments: on the ghost-line pass visuals already detects.
- Materials: inside styleBlock, after the World palette applies.

Every effect must respect the existing `prefers-reduced-motion` behavior
of its host system, clean up on `stack:reset`, and never touch
renderOrder pins or the grow-in scale channel (snap-home rules from the
regrowth cue stay intact).

## Offline

Fully local: machine, singles, equipping, and every effect work with no
network. Nothing new is fetched or posted.

## Verification

- New suite pw-machine: spin deducts 200 exactly once per tap
  (double-tap during the roll spends nothing), 22 spins drain the pool
  with zero duplicates, the 23rd tap is impossible (dormant, disabled,
  no charge), insufficient balance spends nothing, prize persisted
  before animation end (reload mid-roll still owns it).
- New suite pw-gear: equip/unequip toggles per slot, one per slot
  enforced, persistence across reload, `hud:gear` fires at boot (guarded)
  and on change with the right payload, unknown storage ids ignored.
- New suite pw-effects: with a scripted gear map, each slot's effect
  observably engages (probe visuals state or scene graph per effect
  family) and cleans up on reset; reduced-motion path exercised.
- Roast packs: equipped pack changes the template pool; LRM guard
  asserted on a Hebrew name through a new pack's template.
- Existing suites reconciled; offline rebuild in the ship commit;
  deploy verified by cache-busted curl; key suites re-run against live.

## Non-goals

Sound themes, ritual and chicken Worlds, server-side inventory, any
real-money mechanism (parked to the store phase), per-World gear
profiles, machine odds weighting, pity timers (pointless without
duplicates), and any change to earn rates.

## As-shipped addendum (final review, 2026-08-04)

- The material singles ship simplified relative to the pool descriptions: GLASS lowers block opacity without a brighter rim, WOOD GRAIN is a warm tint without stripe texture, GLASS SHARDS spins the intact cut piece faster with glinting sparks rather than splitting the geometry. Approved plan values; richer versions are Wave C candidates.
- Scene-side effects (trails, slow-mo, fireworks) have no prefers-reduced-motion branch, matching visuals.js's pre-existing behavior of animating the whole scene; the machine's DOM reel is the only Wave B surface with a reduced-motion path, by design.
- Record-moment singles fire only when the ghost line exists (best 10 or higher), inherited from the ghost system; below that they are silent. Resolved 2026-08-04, option B: with no ghost line, the moment fires on any new personal best (stored best 1 or higher; a fresh device stays silent), converging to identical behavior from best 10 up.
- Post-close addition (Maor, 2026-08-04): a redeem row under the machine accepts one known code that unlocks the 22 singles and the three priced Worlds on the device, for reviewing every effect in the real game. Tier gifts and Bobo stay earned. The code is client-visible in a public repo by accepted design; cosmetics only.
- Spin pacing lengthened same evening on Maor's verdict ("ends too fast"): roll 1250 to 2000ms, hit flash 2050ms, lock 2650ms, same deceleration curve; the reduced-motion path is unchanged. Further pacing shapes (suspense, near-miss tease) belong to the shop-overhaul mockup round.
- Post-review cuts (Maor's 35/35 shop review verdicts, same evening, his timing pick "cut tonight"): the record-moment slot (AURORA SWEEP, RING BURST), the roast-pack slot (all four packs and both pack tables), and FIREWORKS are removed from the catalog. The pool is 15 singles across five slots; full drain by spins alone is 3,000. Stale owned/equipped ids in old saves drop out through the validated reads; the ghost line's style flip on passing the stored best remains, now without any record effect riding it. The redeem code grants the remaining 15.
- Debris fixes, same evening, from Maor's iPhone bug reports: the cut piece's fixed fade clock (0.34s fade, 1.25s life) deleted pieces still inside a portrait phone's frame, worst under the death zoom-out, so life went to 2.2s with the fade at 1.1s and the confetti/pixels early-kill clamps were removed; and debris gained real tower collision, resting on (or, with BOUNCE, bouncing 0.55 off) the highest standing ledge under it, carried as a `surfaces` list on the stack:debris payload. The BOUNCE single's fixed plane 3 blockW below the death height is gone. Synthetic events without surfaces stay purely ballistic.
