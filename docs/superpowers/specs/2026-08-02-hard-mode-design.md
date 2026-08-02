# Hard mode design

Date: 2026-08-02. Approved section by section by Maor across three mockup rounds: the lens question, the mode switch placement, and the difficulty preset.

Implements roadmap item 4.5 (difficulty modes) and the `Difficulty modes` section of `2026-07-30-retention-loop-design.md`. That spec remains the source for anything not restated here.

## Inherited constraints

From the retention loop spec, not reopened:

- Hard has a steeper speed ramp, and block width never restores after any loss.
- Hard unlocks at the Marble tier.
- Hard earns double points.
- Hard gets its own board and percentile through the existing `mode` column.
- The tier ladder is computed from the all-time **Normal** best. Hard never moves a tier.
- Cosmetics only, points earn-only, no decay, no demotion.

## Decisions made in this round

**Hard is a lens, not a flag.** A run played in Hard is described everywhere in Hard's terms: its best, its percentile, its board neighbours. The rejected alternative showed a 41-block Hard run beside a Normal best of 180 and a chase line demanding 112 more blocks, which answers "how good was that" wrongly for every Hard run ever played.

**Normal is a state, not the absence of Hard.** Both words are on screen whenever the switch is. There is no lone lit pill anywhere in this feature.

**Difficulty preset B.** Hard's first drop moves at the speed Normal reaches at block 21, and passes Normal's permanent 6.8 cap at block 31.

The supporting reasoning for B: losing regrowth costs nothing below a 3-perfect streak, because `growCombo` is 3 and the rule never fires. It only bites players who chain, and Hard's audience is exactly those players, since Marble at best 70 is unreachable without chaining. No-regrowth is therefore already a hard ceiling on every run by anyone who can enter, and a savage ramp on top would make Hard a shorter game rather than a different one.

## Surface behaviour

| Surface | Normal | Hard |
|---|---|---|
| Title best line | `BEST 180` | `HARD · BEST 38` |
| Ghost line during play | Normal best | Hard best |
| Death best line / NEW BEST | vs Normal best | vs Hard best |
| Death percentile | Normal board, rolling 24h | Hard board, rolling 24h |
| Death sandwich and chase line | Normal board | Hard board |
| Score posted with | `mode=normal` | `mode=hard` |
| Points earned | 1/block, 3/perfect | same, then x2 |
| Points balance | shared, unchanged | shared, unchanged |
| Tier ladder | from Normal best | from Normal best |
| Worlds, shop, ownership | unchanged | unchanged |
| Blocks-ever, best-streak | shared lifetime counters, both modes feed them |

A consequence worth stating plainly: a player can hold a high Normal tier while ranking low on the Hard board. That is correct under the inherited rule and is not a defect.

## Mechanics (core.js)

Core owns the difficulty table. Values are final:

```js
var MODES = {
  normal: { speedStart: 2.7, speedGain: 0.055, speedMax: 6.8, regrow: true  },
  hard:   { speedStart: 3.8, speedGain: 0.100, speedMax: 9.0, regrow: false }
};
```

`normal` restates today's `CFG` values unchanged, so Normal play is bit-for-bit what ships now.

- `spawnNext()` computes slider speed from the active table instead of `CFG.speedStart` / `speedGain` / `speedMax`.
- The existing regrowth branch (`if (combo >= CFG.growCombo)`) additionally requires `regrow`. That branch is the only place width is ever given back, so the flag is the entire no-regrowth rule.
- `CFG.growCombo` (3) and `CFG.growStep` (0.14) are unchanged and shared; Hard simply never reaches the branch.

**Mode is applied at run start only.** The active table is latched when a run begins, so a mode change can never take effect mid-tower.

### Cross-domain contract

Incoming, mirroring `hud:world` exactly:

- `hud:mode {id}` where `id` is `'normal'` or `'hard'`. An unknown id falls back to `'normal'`.

Outgoing, extended:

- `game:start {score, mode}`
- `game:over {score, best, mode}`

`mode` echoes the table the run actually used. The HUD reads that value rather than its own stored setting, so there is exactly one source of truth for which mode a finished run belongs to.

Boot-time broadcast of the stored mode follows the project's existing rule: gated on `DOMContentLoaded` behind a `readyState` guard, never a bare `setTimeout(0)`. Classic scripts stream on network loads and a queued timer can fire between downloads, which is how audio.js missed the `hud:world` broadcast on 2026-08-01.

## Storage

| Key | Owner | Meaning |
|---|---|---|
| `stack-best` | core.js | Normal best. Unchanged, no migration. |
| `stack-best-hard` | core.js | Hard best. New. |
| `stack-mode` | hud.js | Equipped mode, `'normal'` or `'hard'`. New. |

Normal keeping its existing key means no migration and no player loses a record or a tier.

Core cannot know the mode at init, because `hud:mode` arrives after boot. So core loads **both** keys at init into a map, and the `best` it exposes is derived from whichever mode is active:

```js
var bests = { normal: <stack-best>, hard: <stack-best-hard> };   // both read at init
// getTowerState().best  ->  bests[activeMode]
// gameOver()            ->  writes bests[activeMode] back to that mode's key
```

**Ordering requirement:** the active mode must be latched, and `best` therefore correct, *before* `startGame()` fires `game:start`. Two consumers depend on it.

Two behaviours then need no further code at all:

- The **ghost line** reads `StackCore.getTowerState().best`. visuals.js already calls `ghostSync()` on `game:start` — on every run start including the first — because core fires `stack:init` before it has read `best` from storage. With the mode latched first, the line lands at the Hard best during a Hard run. No change to visuals.js.
- **NEW BEST** compares the final score against `detail.best` from `game:over`, so it fires against the correct record.

Corrupt or edited storage: if `stack-mode` is `hard` while the Normal best is below the unlock gate, boot falls back to Normal and writes the corrected value.

## The unlock

Hard is available when the Normal best has reached the Marble threshold (70).

The gate value is **derived from the existing `TIERS` table by name**, not written as a second literal. The project already carries one bug of that shape (gift thresholds encoded both in `WORLDS[].giftAt` and in tier-name matching); this one gets a single source of truth from the start.

Crossing Marble already grants the Marble World and fires a toast. It now also unlocks Hard, and the toast carries both rather than firing twice:

```
▲ MARBLE · WORLD + HARD MODE
```

Back on the title screen the switch stops being dimmed. That is the discovery moment, and it is passive: no modal, no interruption to the tap-anywhere loop.

Before the unlock the switch is present but dimmed, with `NORMAL` selected and `HARD` locked. Its presence from the first session is deliberate advertising for a mode the player cannot yet play.

## Title screen

The switch is a segmented `NORMAL | HARD` pair in the bottom chrome row, beside the SHOP pill. The centre composition stays `STACK` / hint / best, holding the bare-title rule set during the marketplace round: controls are edge furniture, never part of the composition.

The best line names the mode only in Hard (`HARD · BEST 38`). In Normal it stays `BEST 180`, because the lit `NORMAL` chip already states it and repeating it would be redundant.

## Board

- Reads: `scopeFilter` composes `&mode=eq.<mode>` from the active board mode instead of the hardcoded `&mode=eq.normal`.
- Writes: `submitScore` posts `mode` in the body. It currently posts `{name, score}` and relies on the column default, which would route every Hard score onto the Normal board.
- Percentile count queries use the same mode filter as the board they describe.
- The trophy overlay gains a `NORMAL | HARD` picker rendered as a sibling of the existing `TODAY | ALL TIME` segment, so both read as views of the board.

**The overlay picker is view-only.** It changes which board is being read, never which mode will be played. The reason is that the trophy is reachable from the death screen, where the title switch is not visible, so a picker that armed Hard could drop a player into it without any screen having said so. The accepted cost is that the same chip pair means a setting on the title and a filter in the overlay. It is mitigated by the picker opening on the player's current mode, so the common case requires no interaction.

The death screen's board reads use the finished run's mode, not the overlay picker's state.

## Records and the points whisper

The records pane gains exactly one row, `HARD BEST`, below a separator, shown only once Hard is unlocked. Records is the one panel that describes the whole player rather than a moment, so it shows both modes. A second stats group would cost more density than the mode is worth.

Points: Hard's x2 multiplies with the first-run-of-the-day x2, so the first Hard run of a day earns x4. The whisper line reports:

| Case | Line |
|---|---|
| Daily double only | `+124 PTS · FIRST RUN ×2` (unchanged) |
| Hard only | `+248 PTS · HARD ×2` |
| Both | `+496 PTS · ×4` |

Stacking both markers verbatim would wrap the line on a narrow phone, which is why the combined case collapses to a single multiplier.

## Offline

Unchanged degradation, applied per mode: no percentile, the chase line falls back to a personal-best delta against the active mode's best, and boards show the local list labelled `THIS DEVICE ONLY`. Mode selection, mechanics, points, records and the unlock gate are fully offline.

## Testing

Emulated-phone Playwright runs against `index.html`, then twice against the live URL. Scripted runs need `?debug=1`. Any test that can reach the save flow intercepts `**/rest/v1/stack_scores*` so no real rows land.

- **Mechanics, deterministic.** `debug.build()` with scripted offsets in each mode. Assert slider speed at a chosen block index matches the table, and that the footprint is monotonically non-increasing across a Hard run.
- **The Normal control test must chain.** Regrowth needs `combo >= 3`, so a test whose perfects are scattered never fires the branch and would pass against code that had removed it entirely. The Normal case asserts regrowth by landing at least three consecutive perfects and observing the footprint increase.
- **Best-key isolation.** Play Hard, die, assert `stack-best` is unchanged and the tier chip has not moved. This is the regression that matters most: without it a Hard run inflates the Normal tier.
- **Board routing.** Assert the POST body carries `mode: 'hard'` and that reads carry the matching filter.
- **The lens.** Die in Hard with a seeded Normal best far above the Hard score, and assert the death screen shows the Hard best, the Hard percentile and Hard neighbours. This is the exact case that made the rejected alternative unacceptable.
- **Locked state.** With the Normal best under the gate, assert the switch is dimmed and inert, and that a forced `stack-mode=hard` still boots into Normal.
- **Ghost line height.** With both bests seeded and differing, start a Hard run and assert the ghost line's world Y matches the Hard best, not the Normal one. This is the assertion that catches a regression in the latch-before-`game:start` ordering, which is otherwise invisible.
- **Layout.** The bottom chrome row now carries SHOP plus the switch; assert it does not overflow at 320px wide. Per the project's layout rule, measure against real content on the emulated phone, whose `innerHeight` is 664.
- All 12 existing suites re-run unchanged.

## Success criteria

- A Normal player's experience is byte-identical to what ships today: same speeds, same regrowth, same best, same tier.
- Death to new run stays at most two taps in both modes.
- A Hard death never displays a Normal number.
- Playing Hard cannot change the tier ladder, by test.
- No frame-pacing regression; the mode table is read at spawn, not per frame.

## Folded in from Wave A

This wave touches the board-open path, so the parked hardening bundle ships with it:

- `openBoard` mode guard: the keyboard can currently open the overlay mid-run, which since Wave A reaches purchases.
- Gift thresholds encoded twice (`WORLDS[].giftAt` and tier-name matching), collapsed to one source alongside the new unlock gate.
- hud.js OUTGOING header documentation missing `hud:world`, `hud:mute` and `hud:menu`; `hud:mode` joins the same list.
- `cursor: default` on inert shop cards.
- aria-label refresh in `renderShopPane`.

## Out of scope

Hard-specific death quips, a Hard tier ladder, Hard-only Worlds, board badges identifying Hard players, and any change to the revive, identity or multiplayer items. All are additive later and none are needed for the mode to be complete.

## Percentile fallback

Decided by Maor, 2026-08-02, while this spec was under review.

The percentile line requires at least 10 rows in its window before it appears, because a percentage drawn from two players is an insult rather than a brag. The Hard board will not reach 10 rows in a 24h window for a long time, and the Normal daily board often does not either.

So the rule gains a fallback rather than a lower threshold: if the rolling 24h window holds fewer than 10 rows, rank the player against the **whole board for that mode** and change the label to say so.

| Window | Line |
|---|---|
| 24h window has 10+ rows | `YOU: TOP 12% TODAY` |
| 24h too thin, all-time has 10+ rows | `YOU: TOP 12% ALL TIME` |
| Neither reaches 10 rows | nothing, as today |

The label naming the pool is what keeps this honest. The threshold itself stays at 10 for both passes. Hard tracks no per-day best, so it ranks its all-time best in both windows; Normal keeps today's best for the daily pool.
