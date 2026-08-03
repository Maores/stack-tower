# Scoreboard overhaul — design (variant 1, "One board")

Status: variant approved by Maor 2026-08-03 from a three-way interactive
mockup round. One open decision inside: the percentile line (section 4).

## Why

Maor's verdict: the scoreboard is clunky. A live diagnostic
(`reference/tests/pw-board-clunk.js`, run twice against production with real
data, identical numbers) measured five defects:

1. A NORMAL→HARD flip wipes the list, shows `LOADING` in a 378px cold-floor
   shell, then snaps to 300px: three panel heights in ~200ms.
2. An empty TODAY collapses the panel 398→199px around "NO SCORES YET".
3. Two contradictory loading strategies: scope flips keep stale rows
   silently under the new header; mode flips wipe and flash.
4. The list renders at most 10 rows (scrollHeight equals clientHeight), so
   ranks 11+ do not exist anywhere in the UI. The all-time board already
   holds ~15 unique players.
5. Touch targets: tabs 22px tall, segments 18px, against a 44px platform
   guideline. Every pane switch also resizes the panel (398/438/425).

## The shape

The trophy overlay's board pane becomes **one all-time list per mode**.
TODAY as a view is deleted. The panel takes one fixed height and never
changes it: not per pane, not per mode, not while loading, not when a fetch
fails. Panes scroll inside the shell.

## 1. Delete the TODAY view, keep the 24h data

Removed:

- The `TODAY | ALL TIME` segment row (`boardSeg`, `segDay`, `segAll`, the
  `.hud-lb-seg*` CSS block).
- `overlayScope` and every branch on it.
- The overlay's day-scope board reads (`warmRowsFor('day', …)` for the
  board pane, the `scope` plumbing in `refreshOverlayBoard`).

Explicitly kept, and this is the trap for the implementer:

- **`scopeFilter('day', …)`, `dayFloorIso()`, and the warm slots' `.day`
  field stay.** The 24h window is not only a view: on death,
  `fetchTop('day', …)` feeds `applyRoastOnce` (roasts pick their victims
  from players active in the last 24h) and `rememberTop`. `warmUp` also
  pre-fetches the day rows for exactly that path. Deleting the day QUERY
  breaks roasts; only the day VIEW dies.

## 2. One fixed-height shell

`.hud-board-panel` gets a fixed `height: min(66vh, 460px)`.

- Derived from measurement, not eyeballing: the tallest pane today is
  RECORDS at 438px on the emulated iPhone 13 (innerHeight 664; the
  device reports 664, not 844, a documented trap). 438/664 = 66vh.
- `min-height`/`max-height` and the `is-cold` floor (`setColdFloor`, the
  `.hud-board-panel.is-cold` rule) are deleted. A min-height floor is the
  mechanism that already failed once (01-08: floor below content never
  engages); a fixed height cannot fail that way.
- `.hud-board-list`, `.hud-board-records`, `.hud-board-shop` become the
  scrolling region: `flex: 1 1 auto; min-height: 0; overflow-y: auto`.
  On short viewports the pane scrolls; the panel does not move.
- Acceptance is behavioral, not structural: on the emulated device against
  the live board, the panel's `getBoundingClientRect().height` must not
  change across any of: open, close+reopen, all pane switches, both mode
  flips, a simulated empty day, a simulated 1.2s network, a simulated
  failed fetch. The diagnostic script is the template for that test.

## 3. Full list + MY ROW chip

- The overlay board renders every deduped row the fetch returns (limit 50),
  not 10. `renderRows` keeps its signature; the overlay call sites pass
  `max: 50`. The death screen's sandwich and device-fallback lists keep
  their explicit `3`.
- Row numbering already handles both branches (CSS counter and explicit
  rank spans); no change.
- **MY ROW chip**: a floating button overlaid near the list's lower edge,
  visible only when (board pane) AND (a row matches the stored player name)
  AND (that row sits outside the list's visible scroll area). Text:
  `▾ MY ROW · #<rank>` (or `▴` when the row is above the viewport). Tap
  scrolls the row to center (`smooth`; instant under reduced motion).
  - It is `position: absolute` over the shell. Appearing or disappearing
    must not move ANY layout by a pixel (the mockup's watchdog caught
    exactly this bug in its first draft).
  - Its hidden state needs `.hud-board-myrow[hidden] { display: none; }`
    and tests assert computed style, never `.hidden` (three prior
    occurrences of this trap).
  - Scroll listener on the list updates visibility; pane/mode switches
    hide it until the next render settles.

## 4. The percentile line — DECISION FOR MAOR

The mockup round's variant-1 pitch said the daily itch is served by "the
death screen percentile". **That was wrong, and the correction changes
scope**: since the density revision there is no percentile on the death
screen. The only percentile in the game is `boardPct` ("YOU: TOP n%
TODAY", with the all-time fallback), and it renders exclusively on the
TODAY tab this design deletes.

So variant 1 as approved removes the game's last percentile surface.
Options:

- **(a) Recommended: delete the percentile machinery** (`showPercentile`,
  `tryPercentile`, `boardPct`, `overlayPctSeq`, `PCT_MIN_ROWS`, the two
  `countRows` calls it makes). The full scrollable list with your row
  highlighted, plus the MY ROW chip carrying `#rank`, states your standing
  more concretely than a percentage. Two fewer network requests per board
  open.
- **(b) Keep it as an always-on all-time line** under the mode row:
  `YOU: TOP 29%`, computed against the current mode's all-time board,
  hidden under 10 rows as today. Costs a fixed chrome line (reserved
  height, never collapsing) and keeps the two count requests.

The spec proceeds under (a); if Maor picks (b) the plan adds one task.

## 5. One loading strategy: stale-while-revalidate

- **Never wipe.** `setOverlayMode` stops clearing the list; existing rows
  stay painted until the incoming mode's rows land. The mode-race guard
  from the Hard-mode final review (`overlayBoardSeq`, responses filed
  under the mode captured at issue time) already makes this safe; it stays.
- **`LOADING` text is removed from the overlay.** `.hud-lb-status` keeps
  its other overlay job (`THIS DEVICE ONLY`). The death screen keeps its
  own status behavior untouched.
- **Skeleton rows replace the cold case**: when the list is empty AND no
  warm rows exist, render 6 placeholder rows (`li.hud-lb-skel`) in the
  list itself: shimmer via CSS animation, static translucent bars under
  `prefers-reduced-motion`. Replaced by the first real render. A failed
  fetch over an empty list falls back to the device board exactly as
  today.
- The 15s auto-refresh repaints in place; with the fixed shell that is
  invisible unless data changed.

## 6. Touch targets

- `.hud-lb-tab` (BOARD / RECORDS / SHOP): `min-height: 44px`.
- `.hud-board-mode` buttons (NORMAL / HARD): `min-height: 38px`.
- `.hud-board-close`: 34px → 40px square; the panel's top padding derives
  from it (`calc(10px + 34px + 8px)`) and follows to `calc(10px + 40px + 8px)`.
- No title-screen or death-screen control changes.

## 7. Housekeeping riders (Wave A final-review leftovers, hud.js territory)

Carried per the standing "next-wave first-commit bundle" note; all three
are small and live in the files this wave already touches:

1. `openBoard` gains a state guard (no overlay during `playing`; the
   keyboard path can currently reach it mid-run, and from there purchases).
2. The hud.js header's OUTGOING section documents `hud:world`, `hud:mute`,
   `hud:menu`, `hud:mode`.
3. `cursor: default` on inert (locked/dimmed) shop cards.

## Non-goals

- **The death screen is untouched**: sandwich of 3, tap-anywhere restart,
  its own status line. The diagnostic's finding that a drag on the death
  list restarts the game is accepted behavior while that list never needs
  scrolling; if the sandwich ever grows, this reopens.
- No core.js, visuals.js, audio.js, or backend changes. No schema changes;
  the `mode` column and day-window queries are untouched server-side.
- Wave B (prize machine, singles, sound themes) stays parked.

## Files

| File | Change |
|------|--------|
| `hud.js` | seg/scope removal, fixed-shell wiring, full-list render, MY ROW chip, loading strategy, percentile removal (option a), riders 1-2 |
| `hud.css` | panel fixed height, scroll regions, skeleton rows, chip + `[hidden]` rule, target sizes, seg CSS removal, `is-cold` removal, rider 3 |
| `Stack.html` | rebuilt (hud.js and hud.css are inlined; a58245b proved skipping this ships a stale artifact) |

## Testing

Playwright, emulated iPhone 13, `?debug=1`, POSTs intercepted always; live
GETs pass through for shape tests (layout stability is a real-data
property).

1. **Shape invariance** (the headline test): panel height sampled across
   every transition listed in section 2; any change is a failure. Run
   against live data, twice.
2. TODAY seg absent; `overlayScope` gone from the API surface; day fetch
   still fires on death (roast path) — assert the request happens.
3. Full list: with the live board's >10 unique names, rendered rows > 10,
   list scrollHeight > clientHeight, touch drag scrolls it (CDP-trusted),
   and the drag neither closes the overlay nor restarts anything.
4. MY ROW chip: hidden when own row visible; appears after scrolling it
   out; tap centers the row; asserts computed display; appearing does not
   move the panel or the list.
5. Mode flip with rows present: old rows remain until new rows land (no
   empty frame), no `LOADING` text ever, correct rows after landing
   (the overlayBoardSeq race stays covered by pw-hard-board's existing
   sections).
6. Cold + slow (simulated 1.2s): skeleton rows in place, shell height
   constant, real rows replace skeletons.
7. Empty day simulation: no visual difference on the board pane at all
   (the day view no longer exists).
8. Targets: computed heights of tabs ≥ 44, mode buttons ≥ 38, close ≥ 40.
9. Riders: overlay unopenable during play (keyboard path), header doc
   present, inert cards show default cursor.
10. Existing suites reconciled: `pw-boards` and `pw-hard-board` assert the
    seg and percentile today and will need their expectations updated to
    this spec (or sections retired with a dated note); `pw-tiers`,
    `pw-bobo-card`, `pw-save`, `pw-deathlines`, `pw-chase-local` must stay
    green unmodified.
