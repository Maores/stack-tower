# Title redeem + death shop door — design

Date: 2026-08-10
Status: approved by Maor from a 3+3 mockup round (scratchpad `ui-round-redeem-shopdoor.html`), picks **T3** and **D2**.

Two approved-but-unbuilt asks from the 2026-08-04 shop review (35/35), both gated
behind the standing 3-variant mockup rule for the title and death screens.

His notes, verbatim from the review blob:

- redeem row relocated to a small button bottom-right of the title screen, "stay visible for now"
- a death-screen shortcut straight into the shop, "it takes a bit of time to get into it"

## What the mockup round established

Two facts came out of drawing it that were not known when the asks were recorded.

**The title screen's "3 elements only" rule no longer describes the screen.** The
density revision (2026-07-31) fixed the title at three elements, but Wave A added
`.hud-title-chrome`, a fixed bottom row holding the SHOP pill and the NORMAL | HARD
switch. The screen is a three-element upper composition over a populated bottom
edge. The redeem button joins the bottom edge, so the rule is not being broken;
the roadmap's phrasing of it is simply stale.

**Neither of the two multi-object title variants fits at the game's normal pill
size on a 300px frame.** T2 (a fourth pill in the centered row) fits only with
every pill shrunk below the size used elsewhere. T3 fits with the centered row
slightly compacted and nothing to spare. T3 was chosen anyway, for the reason in
the next section.

## T3 — three anchors on the title's bottom edge

The bottom edge becomes three independently anchored slots:

| slot | holds | state |
|---|---|---|
| left | the player's name | **reserved, empty this wave** — identity fills it |
| center | `.hud-title-chrome` (SHOP pill + mode switch) | unchanged |
| right | REDEEM | new |

**Why three anchors and not a fourth pill in the existing row.** Identity is the
next roadmap item and it needs a home on this screen for the claimed name. A
fourth pill in the centered row means designing this edge twice, with the second
round liable to move what the first one placed. Three anchors means identity
drops into a slot that is already reserved and nothing else shifts.

**The center stays centered by construction.** The obvious implementation, one
flex row with `space-between`, does not work: with an empty left slot and a
REDEEM right slot the center lands off-center. So the three anchors are three
independently positioned fixed elements, and `.hud-title-chrome` keeps the
`left: 50%` + `translateX(-50%)` centering it already has. Minimal diff, and the
solved geometry is not disturbed.

**As-built correction: the side anchors sit one rung above the center row, not
beside it.** The mockup drew all three on one line, with the center row
compacted to make room. The real center row is not compacted, and measurement
killed the single-line version outright:

| viewport | free space right of the center row | needed | result |
|---|---|---|---|
| 412 (Pixel 7) | 76px | 73px | +5px, barely |
| 390 (iPhone 13) | 71px | 73px | **−2px, overlapping** |
| 320 (iPhone SE) | 36px | 73px | **−35px, badly overlapping** |

No font size fits the word REDEEM into 36px, so this is an impossibility rather
than a tuning problem. The side anchors take their own rung, 36px above the
center row's baseline, and the center keeps its full width at every viewport.
What T3 was chosen for is unaffected: identity's slot is still reserved, the
center still does not move, and the arrangement now holds from 320 up.
`pw-title-redeem` section J asserts the clearance at 320 / 390 / 412 so the
36px constant cannot rot silently.

Consequence for identity: its name element goes on that same upper rung, left,
mirroring REDEEM. That rung is empty apart from these two, so the name has far
more room than the single-line version would have given it.

## Round 2, 2026-08-11: T3's rung superseded by R1

The as-built rung shipped, went live, and failed on Maor's actual phone within a
day, for a reason the emulated frames never surfaced: **every element on the
title screen sits on the centre axis**, so the right-anchored REDEEM pill was
the single off-axis object on the whole surface, floating over the switch's
corner beside a bottom-left that was empty precisely because its partner was
"reserved" for identity. Reserved space is invisible; the balance the rung was
designed around did not exist.

The verdict was stress-tested before re-designing (Maor's instruction: find the
flaws in the verdict, then a solution answering all of them):

1. The diagnosis rested on one word ("weird") until his screenshot confirmed it.
2. Round 1 never questioned the premise that a personal cheat code deserves a
   labelled button on the game's front door at all.
3. The rung's justification depended on identity, which is undesigned; if its
   name lands elsewhere the rung stays orphaned forever.

A fresh 3-variant round (`redeem-round2.html`: key-in-row / corner-furniture /
off-the-title) went through the standing mockup rule, and Maor picked **R1**:

- The rung is deleted. A **key-icon circle** joins the centred chrome row as its
  third flex child; the code row floats above the chrome as an absolute child,
  right-aligned to the key, so opening it cannot disturb the centring.
- The icon fits where the labelled pill measurably could not (row 236px at 320
  wide, centred with margin; the pill needed 73px against 36px of slack).
- Unlabelled is deliberate, reversing round 1's reasoning: the code is personal,
  the repo is public, and a REDEEM sign on the front door invites code-hunting.
  For this control, undiscoverable is a feature.
- **Nothing on the edge is reserved for identity any more.** The truncation and
  bidi requirements recorded above still apply to wherever its name eventually
  renders, but it designs its own home in its own round.
- Everything rides `.hud-title-chrome`'s existing `data-ui` and state-gated
  pointer-events: the `.hud-title-redeem` anchor is gone, and `pw-title-redeem`
  section A now asserts its absence so the old rung cannot ship alongside.

**Interaction.** REDEEM is a pill button. Tapping it reveals the existing redeem
row (input + APPLY + message) anchored above it; tapping it again collapses the
row and clears both the field and the message. A successful redeem leaves the row
open so `FULL CATALOG UNLOCKED` is readable — collapsing on success would hide the
only confirmation the action produces. Leaving the title state also collapses it,
so a row left open never waits behind a run. The row moves off the shop pane
entirely: "relocated", not duplicated.

"Stay visible for now" is read as the *entry* staying visible. A permanently open
text field on the title screen is a different and worse thing.

**Truncation is required from day one, not deferred.** The left anchor will hold
a player-supplied name, and the edge fits at 300px with nothing to spare. The
board already contains שמעון חנוכייב, so an over-long name is not hypothetical.
Identity's wave inherits a slot with a hard truncation rule attached to it.

**Names on this edge need the bidi guard.** Building the mockup, the Hebrew name
scrambled the English around it until it was isolated. Any element that renders a
player name needs the same LRM guard the roast templates already carry. That
applies to the reserved left slot when identity fills it.

## D2 — SHOP pill beside MENU on the death screen

The death screen's bottom chrome becomes a row of two pills: MENU, and a SHOP
pill carrying the live balance, identical to the title screen's.

**Why the bottom chrome and not inside the panel.** The panel overflowed on
2026-08-08 on a two-line Hebrew roast, and `pw-panel-fit` now pins the worst
case. Anything added inside the panel has to clear that test on every future
content change. The bottom chrome adds no panel height at all.

**Why the pill carries the balance.** It is byte-identical to the title screen's
`SHOP · N` pill, so it is one object learned once and recognised on both screens,
and the number is the reason to press it.

**D3 was offered and not taken.** D3 turned the existing earned-points line into
the door, which would have added zero height and read well contextually, but it
departs from the bottom-chrome placement and sits inside the tap-anywhere surface.
Recorded here because it is a cheap swap if D2 proves wrong in play.

**Render ordering is load-bearing.** Points commit inside `applyOver` before the
death screen is drawn. The pill must render after that write or it shows a stale
balance on the one screen where the player just earned. One renderer updates both
pills so they cannot drift.

## Hazards this wave has to clear

All three are standing hazards this codebase has reproduced before.

1. **Invisible chrome stays clickable.** `.hud-redeem-input` and `.hud-redeem-btn`
   currently declare `pointer-events: auto` explicitly. That was safe inside the
   board panel, which is gated by its own visibility triad. On the title screen it
   is not: a `pointer-events: auto` descendant stays a hit target under a
   `pointer-events: none` ancestor. Both declarations must be removed so they
   inherit from the anchor, exactly as `.hud-shop-pill` documents.
2. **A HUD-side guard cannot stop a restart.** `core.js` binds a global
   pointerdown and starts a run for any target not matching
   `button, a, input, [data-ui]`. The pill and the input match it on their own;
   the message span does not, so the anchor carries `data-ui="1"`.
3. **Author `display` beats `[hidden]`.** `.hud-redeem` sets `display: flex`, so
   hiding it via the property needs an explicit `[hidden] { display: none }` rule,
   and its test must assert computed style, never `el.hidden`.

Plus the keyboard contract: every new focusable control calls `keepKeysLocal`.

Two more that surfaced while building, both real and both fixed:

4. **`tryRestart`'s exclusion list is not optional for anything in the death
   panel.** It skips `.hud-lb-entry, .hud-lb-auto, .hud-over-menu, .hud-revive`.
   A new button inside `.hud-over` that is not on that list gets its own click
   handler *and* a restart from the panel's pointerdown, so the first tap on the
   shop door opened the shop and restarted the run underneath it.
   `.hud-over-shop` is now on the list.
5. **Adjacent hit expanders fight over the gap.** Each pill's expander reaches
   14px sideways and the row's gap is 8px, so unmodified they overlap by 20px,
   and SHOP (later in the DOM, neither carrying a z-index) would win 6px of
   MENU's own painted surface. The facing edges are pulled to half the gap so
   they meet at its midpoint: no overlap, no dead strip, and the outward 14px
   both pills were tuned with is untouched.

## Out of scope

- Identity's name element. The slot is reserved and empty.
- Any change to what the redeem code grants.
- The shop overhaul, which stays parked as pre-submission polish.
