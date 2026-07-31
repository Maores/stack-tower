# Marketplace Wave A design

Date: 2026-07-31. Approved by Maor: wave split ("Two waves: Worlds first"), two mockup rounds (entry/shelf/death, then pill placement/tab structure), and the full design presentation. Child of `2026-07-30-retention-loop-design.md` (economy numbers, catalog, principles) and constrained by `2026-07-31-density-revision-design.md` (no persistent title/death element without a mockup round; both new elements here went through rounds 1-2).

## Scope

**Wave A (this spec):** points economy, overlay restructure (BOARD / RECORDS / SHOP), Worlds shelf with six cards (Classic + three buyable + two tier gifts), prize-machine COMING SOON slot, title shop pill, death whisper line.

**Wave B (separate spec later):** prize machine + ~20 singles, the two secret ritual Worlds, per-slot equipping. Spin pricing gets tuned against observed Wave A earn rates before it ships. Machine interaction gets its own mockup round.

## Locked visual decisions

From the two mockup rounds (scratchpad `mp-round1.html`, `mp-round2.html`):

- **Entry:** SHOP pill on the title screen, bottom-center, live balance inside ("SHOP · 1,240"). Title's three-element center cluster untouched; the pill is edge chrome like the corner buttons.
- **Shelf:** two-column preview cards. Each card shows the World's sky gradient plus three stacked blocks in its palette, name, and one chip. Machine slot is a full-width dashed COMING SOON card at the bottom.
- **Death:** whisper only. The existing micro row becomes "+68 PTS · FIRST RUN ×2 · SAVED AS MAOR" (points segment dim gold, same font size as SAVED AS). No other death change.
- **Tabs:** the trophy overlay goes from TODAY / ALL TIME / RECORDS to **BOARD / RECORDS / SHOP**. TODAY vs ALL TIME becomes a small two-segment toggle inside the board pane. The percentile header ("YOU: TOP N% TODAY") stays, TODAY scope only, as today.

## Economy

- Normal placement earns 1 point; perfect placement earns 3 (the parent spec's "1 per block, +2 per perfect").
- Points accrue in HUD memory during the run and commit to storage when the run ends (`game:over` path). A run abandoned mid-play (refresh, closed tab) loses its points, same as it loses its score.
- **Daily double:** the first committed run of each calendar day (device-local midnight, `YYYY-MM-DD` comparison) commits double points and shows the "FIRST RUN ×2" marker on the whisper line. A zero-point run never consumes the double. Hard-mode x2 waits for the modes item.
- No core.js changes anywhere in this wave: accrual rides the placement events the HUD already consumes.

## Worlds

### Catalog

| id | Name | Acquire | Visual identity (starting reference, tunable) |
|---|---|---|---|
| classic | CLASSIC | owned from the start | current palette and sky, current chimes, current quips |
| sunset | SUNSET | 600 points | warm oranges/pinks, dusk sky |
| neon | NEON | 1000 points | electric cyan/magenta/violet on near-black |
| deepsea | DEEP SEA | 1500 points | teals and deep blues, dark navy sky |
| marble | MARBLE | gift at Marble tier (best >= 70) | white/cream with gold accent |
| obsidian | OBSIDIAN | gift at Obsidian tier (best >= 250) | near-black with ember accent |

Prices and exact palettes are tunable at implementation; the mockup gradients are the starting reference.

### What equipping changes

- **visuals.js:** block palette, sky gradient, slice-debris tint. Sky and ambient swap immediately (visible behind the overlay); block colors take effect from the next run (the tower rebuilds anyway).
- **audio.js:** chime voice. Per-World base note and scale flavor (Classic keeps 523.25 Hz pentatonic; others get their own base/character). Same synthesis engine, different table entry.
- **hud.js:** death-quip pack. A World's themed pack (~8-10 static lines each, English) replaces the generic pool while equipped; Classic keeps the current quips. Leaderboard-driven roasts (the ones that interpolate player names, with their LRM guard) stay universal and are untouched.

### Data ownership and the event

Each domain file owns its own per-World table keyed by id: visuals owns palettes/skies/tints, audio owns note tables, hud owns names/prices/quip packs plus ownership and equip state. No shared config object, no cross-file reads.

New event, following the `hud:mute` precedent: **`hud:world`** with detail `{ id }`. The HUD fires it once during init (after reading storage) and again on every equip. visuals and audio listen; an unknown id falls back to classic in every consumer.

### Tier gifts

- Crossing Marble or Obsidian (the existing run-start-best crossing detection that drives the tier toast) grants the matching World: it is added to owned storage and the toast reads "▲ MARBLE · WORLD UNLOCKED" instead of the plain tier name.
- On boot, if the stored best already clears a gift threshold and the World is not owned, it is granted silently (covers players who passed the tier before this ships). Gifts are never auto-equipped.

## Shop UI

### Shop pane

Balance row (label POINTS, gold right-aligned value with thousands separator), then the card grid, then the machine card.

Card states:

- **Equipped:** gold border, gold ON chip.
- **Owned, not equipped:** OWNED chip; tapping equips instantly (storage write + `hud:world`).
- **Priced, affordable:** white price chip. First tap arms the card (chip becomes "BUY · 600?", card highlighted); a second tap within 3 seconds purchases: balance decreases, World becomes owned, and it auto-equips (buying means wanting it on). The armed state auto-disarms after 3 seconds or when another card is tapped. No modal.
- **Priced, unaffordable:** card dimmed, taps do nothing.
- **Gift, locked:** dashed chip ("MARBLE GIFT" / "OBSIDIAN GIFT"), card slightly dimmed, taps do nothing.
- **Machine:** full-width dashed "PRIZE MACHINE · COMING SOON", non-interactive.

### Title pill

- `.hud-shop-pill`, bottom-center above the safe-area inset, text "SHOP · 1,240" (live balance). Title-screen states only; hidden during play and on the death screen (which has MENU).
- Tapping opens the trophy overlay pre-switched to the SHOP tab. The pill carries the `data-ui` guard and joins the tap-exclusion list and key-locking, so it can never start a run.
- Balance text refreshes whenever the title screen is (re)shown and after any purchase.

### Overlay restructure

- Tab bar: BOARD / RECORDS / SHOP (three labels, larger type than the current four-way fit).
- Board pane: the existing list plus the TODAY | ALL TIME segmented toggle; existing scope state, fetch logic, dedupe, and percentile-header rules carry over unchanged.
- Records pane: unchanged plus one appended POINTS row showing the balance.
- The death-screen rank sandwich and its fetches are untouched. The trophy corner button is untouched.

### Death whisper

Format: `+N PTS` plus ` · FIRST RUN ×2` when the double applied, joined to the existing `SAVED AS X` with a separator when both are present. Points segment first, dim gold. Hidden entirely on a zero-point run. No new tap targets.

## Storage

All localStorage, all with the existing try/catch corrupt-safe idiom:

| Key | Value | Corrupt/missing |
|---|---|---|
| `stack-points` | integer balance >= 0 | 0 |
| `stack-daily` | `YYYY-MM-DD` of the last doubled run (device-local) | treated as never doubled |
| `stack-worlds` | JSON array of owned ids beyond classic | `[]` |
| `stack-world` | equipped id | `classic` |

Fully offline; no network calls anywhere in this wave. Clearing storage loses cosmetics; accepted until the identity item (parent spec).

## Testing

New Playwright suite (emulated iPhone, `?debug=1`, all `**/rest/v1/stack_scores*` intercepted, run against index.html then live post-deploy):

- Earn math: N placements with K perfects ends the run with N + 2K points committed (double excluded by preseeding `stack-daily` to today).
- Daily double: with `stack-daily` unset, first run commits double and the whisper shows the ×2 marker; the next run commits single with no marker.
- Purchase: arming, confirm within the window, balance decrement, ownership + equip persisted, `hud:world` observed (palette/sky swap assertable), disarm on timeout.
- Gift: simulated tier crossing grants the World and shows the WORLD UNLOCKED toast; boot with a pre-seeded qualifying best grants silently.
- Pill: visible on title with the right balance, opens the overlay on SHOP, and (negative control) never starts a run.
- Tabs: three tabs render, the board toggle flips scope, percentile appears only in TODAY, RECORDS shows the POINTS row.
- Negative controls: unaffordable and gift-locked cards spend nothing on tap; the machine card does nothing; a zero-point death shows no whisper.

Existing suites that touch the old tab structure (boards, tiers/records, density suites) get their selectors reconciled. The offline suite must stay green (the shop is fully offline). Offline `Stack.html` rebuild (`node scripts/build-offline.mjs`) and GitHub Pages deploy close the wave.

## Success criteria

- A friend playing casually reaches the first buyable World in about 2-3 sessions (600 points at roughly 30-60 per run plus daily doubles).
- Death-to-new-run stays at most 2 taps; the whisper adds no tap targets.
- Every overlay destination is reachable in at most 2 taps from the title.
- No new network calls; no added per-frame work during runs (accrual is arithmetic on events that already fire).
- Friends' shared board is untouched by all test traffic (interception, as always).

## Out of scope

Prize machine mechanics and singles (Wave B), secret ritual Worlds (Wave B), server-side inventory (identity item), any purchasable currency (and if one ever exists it never touches the machine), Hard-mode x2 (modes item), revive (wrapper item).

## Tunables at implementation

Prices, palettes/skies/tints, chime tables, quip texts, the 3-second arm window, whisper and pill copy, gift toast copy. Structure and rules above are fixed.
