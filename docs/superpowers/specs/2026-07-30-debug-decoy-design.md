# Debug-API decoy design

Date: 2026-07-30. Status: approved by Maor (troll option picked over plain removal). Purpose: the console testing API should stop being a free cheat lever on the live site, and taunt whoever tries.

## Behavior

- With `?debug=1` in the URL: `window.StackCore.debug` is the real API (drop/build/tap/fps/stats), exactly as today. All automated suites append the flag.
- Without the flag (the URL friends use): `StackCore.debug` still exists with the same method names, but every call prints a rotating roast line to the console (game voice, English) and returns `false`. No game effect.
- `getTowerState` stays public (read-only, harmless).

## Honest limits (accepted)

- The repo is public, so the flag is discoverable by anyone who reads source. This is a speed bump for lazy console cheaters, not a lock.
- The direct-POST cheat path (public REST endpoint plus publishable key) is untouched; it dies at the identity + server-validation roadmap item.

## Implementation shape

core.js only (debug belongs to the core domain): a `debugAllowed` check of `location.search` at boot, a decoy object with taunting methods, and `debug: debugAllowed ? debug : decoy` in the public api. Version bumps to 1.2.0. All four existing Playwright scripts append `?debug=1` to their target URLs (including the `Stack.html` offline file URL); a new tiny suite proves the decoy: without the flag, `build(5)` returns false, the score stays 0, and a taunt reaches the console.

## Rollout

Feature commit, bundle rebuild, push, live verification (suites with the flag, decoy check without), CLAUDE.md testing note, logs.
