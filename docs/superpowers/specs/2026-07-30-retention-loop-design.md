# Retention loop design

Date: 2026-07-30. Approved end to end by Maor section by section (loop model, retry engine, ladder and economy, marketplace catalog, data and success criteria).

Feeds roadmap items 3 (competitive v1), 4 (customization v1 / marketplace), 4.5 (difficulty modes, new item), and constrains items 7 (wrapper: ads policy) and 8 (multiplayer: wagering guard). Each item still gets its own implementation plan when it starts; this spec is the shared source.

## Evidence base

- Ketchapp Stack (56k ratings, 4.4): 50 recent App Store reviews pulled 2026-07-30. Dominant complaints: interstitial after every run, ad-load frame drops that break timing, paid ad-removal that stopped working, a 14-day season that archived players' progress and drove uninstalls. Players explicitly request PvP.
- Category scan (iTunes Search API): 125 stacking/tower titles, 66 under 100 ratings; median size 164 MB. One incumbent plus a graveyard; no one competes on restraint.
- What loyal players praise and we must not break: calm, mindless, offline, easy to learn hard to master.

## Locked principles

1. Soft-only obligation: showing up can grant bonuses; absence never costs anything. No decay, no expiry, no demotion, no timed seasons.
2. Strangers-first: every competitive feature works with zero social graph on day one.
3. Ads only when the player asks: the rewarded revive is the only ad in the product. Zero interstitials, permanently. This is also a store-page marketing line.
4. Clean records: shared board and personal best count pre-revive height only.
5. Cosmetics only: nothing purchasable affects gameplay or score.
6. Wagering guard (future item 8): stakeable currency is earn-only forever. Any real-money-purchasable currency must be a separate, non-stakeable token.
7. Opt-in stakes are compatible with principle 1; absence-based losses are not.

## The four loops

| Time scale | Hook | Mechanic |
|---|---|---|
| Seconds | tension | Existing slice/perfect feel, plus near-miss flash (within ~8% of perfect, tunable): hairline edge flash, no text, no added sound |
| Runs | one more try | Death screen answers: how good was that (daily percentile), who's next (next-victim line), what almost happened (ghost line at personal best) |
| Days | fresh race | First run of the day earns double points (local-midnight day, client-side); rolling 24h board resets the percentile race |
| Weeks | identity | Non-demoting tier ladder from all-time Normal best; marketplace collection as trophy case |

## Retry engine

Death screen order: score, percentile line, quip/roast (existing), next-victim line, points line, buttons. Tap-anywhere-to-restart unchanged; all additions are passive text with the existing staggered entrance.

- Percentile: "TOP N% TODAY" from the rolling 24h window. Hidden when the window has fewer than 10 rows (avoids "top 100%" with 2 players) or offline.
- Next-victim: lowest board row strictly above my score, from the fetch that already runs for the roast: "3 MORE PASSES MAOR". Above everyone: existing king roast covers it. Board unreachable: "4 FROM YOUR BEST".
- Points line: run earnings plus the daily-double marker when it applied.
- Ghost line: faint marker at personal best height during play, drawn by visuals.js from a core event; shown only when best >= 10. Passing it flips to a quiet new-record state.
- Revive (wrapper builds only): one offer per run, shown when score >= 10 (tunable); rewarded ad or IAP, never points. Continues the tower; records stay pre-revive (principle 4); post-revive blocks still earn points.

## Ladder

Eight tiers from all-time Normal-mode best. Working names and thresholds (tunable, relative spacing fixed): Cardboard 10, Plywood 25, Brick 45, Marble 70, Granite 100, Steel 140, Titan 190, Obsidian 250. First two land in a normal first session.

- Never demote. Tier plus progress-to-next on title and death screens.
- Tier gifts: exclusive Worlds at Marble and Obsidian, not purchasable.
- Hard mode unlocks at Marble.
- Board tier badges wait for identity (item 6); until then tier is personal identity only.

Records panel (title screen, all local): best, best perfect-streak, today's best, total blocks ever, points balance, tier progress. Deliberately no days-played or streak-pressure stats.

## Economy

Earn: 1 point per block placed, +2 per perfect, first run of the day x2, Hard mode x2 (when modes ship). No decay, no expiry, never sold for money.

## Marketplace

Two layers with distinct jobs. Cosmetics only.

**Worlds (the shelf, deliberate purchases, ~600-1500 points).** One World = palette + sky gradient + streak note set + trail + themed roast pack (+ slice debris tint). All three delivery systems already exist as data (visuals palettes, audio note tables, quip arrays). Launch set of 8: Classic (owned), 3 purchasable, 2 tier gifts (Marble, Obsidian), 2 secret Worlds unlocked by rituals (working: die at exactly 13; 10 perfects then a deliberate miss). Secrets are discovery marketing; ritual definitions final at implementation.

**Singles (the prize machine's pool).** Event-attached micro-cosmetics layering over the active World:

| Slot | Examples |
|---|---|
| Drop trail | comet, ribbon, bubbles |
| Perfect flare | gold ring, shockwave, starburst |
| Slice style | glass shards, confetti, petals, pixels |
| Death effect (visual only, death stays silent) | slow-mo shatter, bounce, fireworks |
| New-record moment | aurora sweep, ring burst |
| Block material | glass, wood grain, neon edge |
| Roast pack | savage, gentle, nerd, shakespearean |

**Prize machine:** 100 points per spin, dispenses singles only, never a duplicate, guaranteed progress (Crossy Road rules). Singles also direct-buyable at ~400 for players who dislike randomness. Legal today because points are earn-only (loot-box odds rules apply to purchases); if a paid currency ever exists it must not touch the machine (principle 6 analog).

Launch pool: ~20 singles so the machine does not run dry in week one. Roast packs are the cheap filler; particle work is small visuals.js effects.

## Difficulty modes

Normal + Hard (Maor's call, 2026-07-30). Hard: steeper speed ramp, and block width never restores after any loss (no perfect-streak regrowth). Unlocks at Marble. Own board and percentile via mode column; x2 points. Ships after competitive v1 lands the mode column.

## Data and backend

All within the current open-RLS model; no new tables.

- `stack_scores` adds `mode` text default 'normal', CHECK in ('normal','hard'); existing rows backfill 'normal'.
- Rolling 24h window (`created_at >= now() - interval '24 hours'`) is the "TODAY" board and percentile basis; label stays TODAY.
- Percentile: two count queries (below mine / total) in the window, piggybacking the death-time fetch.
- Points, tiers, records, owned Worlds and singles: client-local (localStorage now, Capacitor Preferences in wrapper). Server-side inventory migrates in at identity (item 6). Accepted risk until then: clearing storage loses cosmetics.
- The daily-double "day" is the local device day; the board "TODAY" is the rolling window. Different concepts by design.

## Offline

Every network feature degrades to absence (existing pattern): no percentile, victim line falls back to personal-best delta, boards show the local list labeled THIS DEVICE ONLY. Points, tiers, records, machine, Worlds: fully offline.

## Success criteria

- Cousin test: 3-8 runs between episodes with zero forced interruptions.
- Death to new run stays <= 2 taps with all new lines present.
- A stranger's first session produces three progress signals with no account: first tier, points balance, a percentile.
- No frame-pacing regressions: fetches async, ghost line is one static line.
- Observable without analytics: daily-board rows per day in Supabase after competitive v1. No analytics SDK this phase; privacy label stays clean for store submission.

## Out of scope

Multiplayer and wagering (item 8), identity (item 6), PWA mechanics (item 5), any purchasable currency, any ad beyond the revive, store-phase leaderboard moderation (Game Center swap, decided in the 2026-07-30 store research).

## Open items deferred on purpose

- Item 2 save-flow question (auto-focus vs auto-submit) is untouched by this spec.
- Tier names, thresholds, prices, near-miss threshold, revive-offer threshold, ritual definitions: tunable at implementation inside the fixed structures above.
