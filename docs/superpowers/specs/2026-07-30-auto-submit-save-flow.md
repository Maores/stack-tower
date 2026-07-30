# Auto-submit save flow design

Date: 2026-07-30. Status: approved by Maor ("2 sounds amazing, take care of that"), delegated end to end. Roadmap item 2.

## Goal

Every scoring run lands on the shared board without taps. The first time a player saves a name on a device the game remembers it; from then on each scoring death auto-posts, the game-over panel shows "SAVED AS <name>", and the keyboard becomes a first-run-only event.

## Flows

- **First run on a device (no stored name):** unchanged. Input plus SAVE button, manual save; a successful save stores the name (existing `stack-player-name` key, no new storage).
- **Returning run (stored name, score > 0):** the entry row stays hidden. The panel shows a status row "SAVING AS <name>", the score posts immediately, and on success the row reads "SAVED AS <name>" with a small "NOT YOU?" button. The board then refreshes with the player's row highlighted, and the roast applies as today.
- **Rename ("NOT YOU?"):** reveals the entry row prefilled with the current name and a "USE NAME" button. Saving writes the new name for future runs only; the already-posted run keeps the name it posted under (one run, one row, never a duplicate insert). Confirmation label: "SAVED FOR NEXT".
- **Network failure:** mirror of the manual path: score goes to the device-local board, status reads "SAVED HERE AS <name>", board renders local rows with "THIS DEVICE ONLY".
- **Score 0:** nothing posts, no entry, no status row (unchanged).
- **Instant restart while the post is in flight:** the post still completes (the run counts); UI updates are skipped if the player already left the game-over screen.

## Non-goals (v1)

- No grace-period countdown before posting; posting is immediate. Mis-credit from a friend playing on your phone is accepted (same trust level as the open-insert board itself).
- No dedupe, no identity, no anti-cheat change; trollable-by-design stands until the identity roadmap item.
- No re-posting a run under a corrected name.

## Implementation shape

hud.js and hud.css only; no core/visuals/audio changes, no backend changes. New DOM: a `.hud-lb-auto` status row (span plus NOT YOU? button) inside the leaderboard block. `trySave` gains a rename-only branch guarded by `state.submitted`. The restart tap-exclusion selector extends to the new row. The new button gets the same Enter/Space `keepKeysLocal` guard as the corner buttons. Hebrew names in status text keep the existing LRM guard (`lrm()`); user data rendered with `textContent` only.

## Verification

New Playwright suite (session scratchpad, emulated phone) with **network interception on the `stack_scores` REST endpoint (POST fulfilled with 201 and captured, GET fulfilled with mock rows), so the tests never insert a real row, locally or live**:

1. Fresh profile, scoring death: entry row visible, no auto row (first-run flow intact).
2. Seeded name TESTBOT, scoring death: entry hidden, auto row "SAVED AS TESTBOT", exactly one captured POST with the right name and score, board from mock rows, roast references the mock rival.
3. NOT YOU?: entry appears with USE NAME; saving TESTBOT2 stores it, fires no second POST, shows "SAVED FOR NEXT"; the next run posts as TESTBOT2 (second captured POST).
4. POST aborted: auto row "SAVED HERE AS TESTBOT", local board with "THIS DEVICE ONLY".
5. Zero console errors and pageerrors; existing pw-audio, pw-mute, pw-offline suites still pass (fresh profiles have no stored name, so nothing auto-posts in them).

Run locally, then against the live URL after deploy (interception keeps live runs insert-free); read-only board check after.

## Rollout

Feature commit (hud.js, hud.css), bundle rebuild plus commit, push to main, live verification, vault and memory logs.
