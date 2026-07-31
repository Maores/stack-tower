# Density revision: title and death screens

Date: 2026-07-31. Approved by Maor via two mockup rounds (his pick: variant C's title + variant B's death, tier names relocated). Trigger: his real-phone screenshot of 02:32 showed both screens overloaded after competitive v1; the 02:50 hotfix helped but not enough.

Amends the surface layout of `docs/superpowers/specs/2026-07-30-retention-loop-design.md`. The retention mechanics (tiers, percentile, victim targeting, boards, stats) all survive; only where they appear changes. hud.js + hud.css only.

## Principle

Each screen keeps only what serves its one job (title: breathe and tap; death: how did I do, one more run). Everything else lives exactly one trophy-tap away. No tier vocabulary anywhere the full ladder is not visible to explain it.

## Title screen

STACK, TAP TO START, BEST n. Nothing else new-era: the tier chip, progress bar, and RECORDS pill are removed. Corner buttons (mute, trophy) unchanged.

## Death screen

Order: quip, SCORE label, number, BEST n (no tier suffix), rank sandwich, victim line, restart ring, saved-as micro line, TAP TO RESTART. The percentile line, board tabs, 5-row board, and tier text are removed from this screen.

- Rank sandwich: 3 rows from the ALL-TIME deduped list, anchored on the player's own best row (matched by stored name; score column shows each player's best): the row above, the player (boxed), the row below. Player unranked or nameless: top 3 rows instead, none boxed. Player is #1: player + two below.
- Victim line: anchors the BEST, not the current run: `(above.score - myBest + 1) + ' MORE PASSES ' + name` from the sandwich's above-row (the round-2 mock showed 78 by typo; the correct value there is 79). Player is #1 or above-row missing: line hidden (the existing king roast covers it).
- NEW BEST pill: kept as-is (rare, earned).
- Saved-as: one micro line, `SAVED AS <name> · NOT YOU?`, smallest type on the screen; NOT YOU? stays tappable and the rename flow is unchanged. First-run manual entry (input + SAVE) unchanged, shown in the micro line's slot.
- Spacing: gaps around the sandwich and restart ring roughly double the 02:50 values; exact values tuned at implementation against an iPhone-13 viewport.

## Trophy overlay: the one deep surface

Third tab joins TODAY and ALL TIME: RECORDS. The separate records overlay, its `data-records` state, and the title RECORDS button are deleted; the records content moves into the tab unchanged (best, best streak, today, blocks ever) plus the tier ladder.

- Ladder: all 8 names with thresholds, checkmarks on reached tiers, current tier boxed, footer `TOWER TIERS · FROM YOUR BEST · NEVER DROP`. This is the only place tier names appear persistently: the list context is what makes TITAN legible.
- Percentile relocates here: the TODAY tab gains a header line `YOU: TOP n% TODAY` reusing the existing count machinery and hiding rules (window >= 10, else absent).

## Tier-up toast

When a run's score first crosses a tier threshold above the stored best, a pill toast (`▲ TITAN`) fades in near the top, holds ~2.5s, fades out. Fires at most once per tier by construction (best-derived). Honors reduced-motion (no animation, brief static show). This is the tier system's only in-game voice.

## Explicitly unchanged

In-run HUD (score, ghost line, near-miss flash), quips/roasts and their daily-rows source, auto-submit flow and its tokens, overlay open/close guards (`data-ui`, keepKeysLocal), mode filter, all backend queries except where noted.

## Constraint on future phases

Item 4 (marketplace) adds no persistent element to either screen without a mockup round of this process. Shop entry starts as a fourth overlay tab candidate, decided at item 4's brainstorm.

## Success criteria

- Title: exactly 3 text elements + 2 corner buttons.
- Death: 7 content elements + restart + hint, none within the corner-button band.
- A player who has never opened the trophy overlay never sees a tier name outside the toast.
- All existing suites pass with assertions updated to the new layout; auto-submit and rename flows byte-identical in behavior.
