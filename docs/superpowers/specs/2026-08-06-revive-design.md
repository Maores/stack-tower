# Revive design

Date: 2026-08-06. Approved fork by fork by Maor across two sessions (2026-08-05 interview, 2026-08-06 mockup rounds). Every visual decision was taken from a 3-variant phone-frame mockup round at the emulated phone's real 390x664 viewport.

Roadmap item: revive, approved 2026-07-30 in the retention loop spec and never built. This spec supersedes parts of that one; see below.

## What it is

Die, get offered one comeback, keep climbing. On the web the comeback costs 150 points. At the store-wrapper phase the same gate becomes the rewarded ad, which is the only ad the game will ever show. No interstitials, ever. The gate is built so the wrapper swaps the payment method without touching the flow around it.

## Supersessions

The retention loop spec (2026-07-30) is amended, not replaced. Three of its statements no longer hold.

1. **"Revive (wrapper builds only) ... rewarded ad or IAP, never points."** Superseded. The web phase prices the revive at 150 points. The wrapper still swaps in the rewarded ad.
2. **Principle 4, "shared board and personal best count pre-revive height only."** Half superseded. The shared board still takes pre-revive height only, and that condition is untouched. Personal best now counts revived height, and the tier ladder, the Hard mode unlock and the tier gift Worlds all follow it (Maor, 2026-08-06).
3. **Principle 5, "nothing purchasable affects gameplay or score."** Knowingly broken, and recorded here rather than quietly. Because the tier ladder now reads a best that a revive can raise, 150 points can push a player past Marble (70), which unlocks Hard mode and grants the Marble gift World, and past Obsidian (250) for that one. Both Worlds are marked in the catalog as tier gifts rather than purchases. Maor was shown this consequence drawn out and chose it for the consistency it buys: one number, one meaning, nothing in the records panel contradicting anything else.

Consequence of 2 that falls out for free: the ghost line needs no special handling. It marks personal best height, and passing it on a bonus lap now genuinely is a new best.

## Locked decisions

| Fork | Decision |
|---|---|
| Price | Flat 150 points. Flat because one ad cannot cost two ads at the wrapper |
| Count | One revive per run |
| Offered when | Score >= 10, both modes |
| Cannot afford | Control shown dimmed with its price, not tappable |
| Below the threshold | No control at all; the screen is byte-for-byte today's |
| Resume, Normal | Block width restored to the full 2.6 |
| Resume, Hard | Exact width the run died on. `regrow: false` stays absolute |
| Placement | Second 64px circle in the action row, 26px right of restart |
| Glyph | A thin plus, 24x24, stroke 1.5, round caps and joins |
| Confirm | Tap to arm, tap to pay, the shop's existing buy pattern |
| Commit | Everything commits at the first death |
| Second screen | Same screen, revive control absent, restart re-centred |
| Second screen hero | The posted pre-revive score, with NEW BEST firing when the revived height beat the old best |
| Shared board | Pre-revive height only. Unchanged and non-negotiable |

Every number above is a tunable constant except the shared-board rule.

## The run model

A revived run has two deaths. The rule is that the **first death is the real one** for everything except the bonus lap's own earnings.

**First death** does exactly what `applyOver` does today, unchanged and unconditional:

- commits the run's points, consuming the daily double if it is still unspent;
- writes best and today;
- runs the tier check and any gift World grant;
- grants Bobo on a score-0 death;
- auto-posts the score to the board for a known player.

The auto-post therefore fires **once per run, at the first death, carrying the pre-revive score**. It is structurally incapable of double-posting or of posting a post-revive number, which is the property the whole commit model was chosen for.

**Second death** commits only what the bonus lap produced:

- the lap's points (the daily double is already spent, so these are single in Normal; Hard's x2 still applies because the run's mode is latched);
- best, if the revived height beat it;
- today, on the same rule as best. This one is derived rather than separately decided: today is a personal record like best, so under "everything follows" it follows. Flagged here so it can be vetoed on review;
- the tier check again, because best may have moved and may now cross a threshold.

No second post. No second Bobo (unreachable: reviving requires score >= 10).

### What the player sees

Score keeps climbing visibly through the bonus lap. At the second death the screen shows the **posted** score as the hero number and the **new** best beneath it, so a run that died at 38 and reached 62 reads SCORE 38, BEST 62, with the NEW BEST badge. Those two numbers legitimately differ, and the offer's own copy is what prepares the player for it.

## The offer

A second circle in the death screen's action row, 26px right of the restart circle, same 64px diameter.

| State | Circle | Caption | Hint line |
|---|---|---|---|
| Idle | Plus glyph, 1px border at 0.75 alpha, soft glow | `REVIVE · 150` | unchanged |
| Armed | Solid fill, border at full white, shows `150?` | `TAP AGAIN TO CONFIRM` | `FULL BLOCK · YOUR {score} STILL COUNTS` |
| Cannot afford | Dimmed, no glow, not tappable | `REVIVE · 150` | unchanged |

In Hard the armed hint reads `SAME BLOCK · YOUR {score} STILL COUNTS`, because Hard does not restore width and the player is told so before paying rather than after.

The armed state is not modal. A tap anywhere else restarts the run exactly as it does today, which is also how the player declines. Declining costs nothing: no streak, no penalty, nothing decays.

**Entrance.** The control joins at **0.14s**, 40ms after the restart button, so the pair reads as one action row rather than as a second thing arriving. It does not join the d1-d5 informational ladder. For reference, the live order after the 2026-08-06 re-split is restart 0.10s, revive 0.14s, hint 0.18s, ladder d1-d5 0.04-0.28s, MENU 0.32s, fade 0.34s.

## The second death screen

Same screen definition, second showing. The revive control is absent entirely and the restart circle returns to centre.

- Hero: the posted pre-revive score.
- Best line: the updated best.
- NEW BEST badge: fires when the revived height beat the previous best.
- Points line: the bonus lap's earnings only.
- Board rows and the SAVED AS row: unchanged from the first death, because that is still what was posted.
- Quip: a line from a small post-revive set. The roast fired at the first death and must not repeat.

Restart moves 45px between the two screens of a revived run. That was chosen with the movement visible in the mockup, against the alternative of leaving a dead button on screen.

## Resume mechanics

Resuming a dead run is a new capability, and it belongs to core, which owns the run lifecycle.

- The fatal block is gone. The tower keeps every block it had.
- Normal restores the next block's footprint to `CFG.blockSize` (2.6). Hard resumes at the width the run died on.
- Slider speed is untouched. It is `speedStart + (index - 1) * speedGain`, keyed to block index, so it continues exactly where the run left it. At score 38 in Normal that is 4.74 against a fresh run's 2.7. Full width restore therefore gives back one of the two difficulty axes, not both.
- A full restore leaves wide blocks sitting on the narrow neck the run died on. That silhouette is intended and was reviewed.

## Economy

Points stay earn-only forever. The revive is the recurring sink.

Anchors it was priced against: 1 point per block, +2 per perfect, first run of the day x2, Hard x2, spin 200, cheapest World 600, live-board median score about 5, a strong 30-50 block run earning roughly 40-60. At 150 the revive sits just under a spin, a good run roughly funds the next one, and a bonus lap returns maybe 40-60 of the 150, so it stays a net sink and cannot be farmed.

## Modes

Revive exists in both. Hard's difference is the resume state only: it never gives width back, which keeps `regrow: false` absolute. Hard's x2 applies to the bonus lap's points. Hard keeps its own board and its own best, both on the same rules as Normal.

## Edge cases

- **Score 0.** Below the threshold, so no offer is ever shown. The Bobo grant path is untouched.
- **Score 1 to 9.** No control. The screen is identical to today's.
- **Cannot afford.** Dimmed control with the price visible, so the feature is discoverable to a player who has never held 150 points.
- **Offline.** The revive is entirely local: points, best and the resume need no network. A failed auto-post at the first death follows the existing failure path and does not block the offer.
- **Tab closed during the bonus lap.** The run's real numbers are already committed, so only the lap's own points are lost. This is the failure mode the commit model was chosen to defuse.
- **Second revive attempt.** Core refuses it. The per-run flag is the guard, and the control is absent on the second screen anyway.
- **Menu during a bonus lap.** Not reachable: MENU only exists on the death screen, and taking the revive leaves that screen.

## Domain contracts

- **core.js** owns the run lifecycle and gains the resume capability. It listens for `hud:revive`, and acts only when the phase is `gameover` and the run has not already been revived. It restores width per mode, returns the phase to `playing`, spawns the next block, and emits `game:revived { score, mode }`, where `score` is the banked pre-revive score the run is resuming from. A per-run flag blocks a second revive and clears on reset and restart.

  The 450ms `restartLockMs` deliberately does **not** apply to a revive request. That lock exists so the gesture that killed you cannot restart the run, and the revive is already guarded by needing two deliberate taps on a real button that itself only enters at 0.14s. Applying the lock as well would refuse a fast arm-and-confirm and read as a dead button.
- **hud.js** never calls into core. It emits `hud:revive` and reacts to `game:revived`. It holds the banked pre-revive score for the second death screen. ES5 throughout: `var`, IIFE, defensive try/catch, `textContent` only.
- **visuals.js** and **audio.js** may consume `game:revived` for their own feedback. Neither is required by this spec.
- Game UI text stays English.

### The two traps this screen already paid for

Both were found the hard way on the MENU pill, and any new control must satisfy both:

1. `core.js` binds its own global tap-to-restart on `window` and skips only targets matching `button, a, input, [data-ui]`. A guard in hud.js alone does not stop it. **The revive control must be a real `<button>`.**
2. `hud.js`'s `tryRestart` restarts on any death-screen tap not explicitly excluded. **The control's selector must be added to that exclusion list**, which today reads `.hud-lb-entry, .hud-lb-auto, .hud-over-menu`.

It also carries an invisible hit expander in the manner of `.hud-over-menu::before`, so a near-miss resolves to the button rather than falling through to a restart. Minimum tap target is 44px; this control is 64px.

## The wrapper swap

The gate is one function: ask for permission to revive, get an answer, resume or do not. On the web that function checks and debits 150 points. In the wrapper it plays a rewarded ad and resolves on completion. Nothing else in the flow changes: same control, same placement, same arm-then-confirm, same resume, same two death screens. Only the caption changes, from a price to an ad label.

This is why the price is flat. A score-scaled price would make the swap an economic redesign rather than a substitution.

## Testing

Emulated-phone Playwright, from `reference/tests`, following the existing harness (`lib/serve`, `STACK_LIVE` for the live pass).

- Scripted runs need `?debug=1`. Without it `StackCore.debug` is a decoy.
- Any test that can reach the save flow intercepts `**/rest/v1/stack_scores*` so no real rows land.
- Local first, then the live URL twice, because boot-race and timing defects have only ever reproduced on production network loads.

Re-run after touching the death screen, since these cover exactly what changes: `pw-death-timing`, `pw-menu-pill`, `pw-deathlines`, `pw-pwa`.

New coverage this wave needs:

1. The control appears at score >= 10 and never below it, and a score-0 death still grants Bobo.
2. Arm then confirm spends exactly once; a single tap spends nothing.
3. A stray tap next to the control restarts the run and spends nothing.
4. The auto-post fires once per revived run and carries the pre-revive score. This is the integrity test and it is the one that must never be skipped.
5. Points commit at the first death, and the bonus lap's points commit at the second.
6. Best takes the revived height; the board row does not.
7. The control is absent on the second death screen and restart is centred.
8. Entrance order: restart at 0.10s, revive at 0.14s, hint at 0.18s, MENU last.
9. Hard resumes at the died-on width; Normal resumes at 2.6.

## Out of scope

- Any server-side validation. The open-insert backend stays trollable by design, and server enforcement belongs to the identity arc. Any fork that seems to need it parks for that arc.
- Any second ad surface. The rewarded revive is the only ad, permanently.
- Any real money. Points are earn-only in this cycle and every cycle.
- FURTHEST as a separate record. It was designed, drawn, and dropped on 2026-08-06 when best absorbed revived height, which left it with nothing to measure.
