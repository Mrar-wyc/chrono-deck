<div align="center">

# Chrono Deck

**A time-axis deckbuilding roguelike**

Cards don't resolve immediately. You place them onto a public timeline, where they detonate some number of action points later.

[![CI](https://github.com/Mrar-wyc/chrono-deck/actions/workflows/ci.yml/badge.svg)](https://github.com/Mrar-wyc/chrono-deck/actions/workflows/ci.yml)
[![Android Build](https://github.com/Mrar-wyc/chrono-deck/actions/workflows/android-build.yml/badge.svg)](https://github.com/Mrar-wyc/chrono-deck/actions/workflows/android-build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-c9a227.svg)](LICENSE)

[Play in browser](https://mrar-wyc.github.io/chrono-deck/) · [中文](README.md) · [Contributing](CONTRIBUTING.md)

</div>

---

> **Status: the M0 skeleton is done.** The timeline combat arrives in milestone M1 — the "Enter the timeline" button on the setup screen is deliberately disabled rather than pretending to work. Seed codes can already be generated, copied, typed in, and the full card dataset browsed.

## What it is

An original-IP card game built around one idea: a **public timeline**. Cards don't take effect when you play them; they get scheduled onto a shared axis and fire later. Strategy shifts from "which cards do I play this turn" to "what do I line up over the next several action points".

### Three kinds of seals

| Kind | Behaviour | Price |
|---|---|---|
| **Instant** | Resolves right away | Lowest numbers |
| **Deferred** | Scheduled on the timeline, fires after a delay | You're betting the situation still holds |
| **Shift** | Manipulates the timeline only, deals no damage | Doesn't solve the current problem |

Deferred cards are strictly more efficient per energy than instant ones (Frost Strike: 1 energy for 14 damage, versus Calibrate: 1 energy for 6). That gap is the entire reason a player would accept the delay.

### Why it's a solvable puzzle

The timeline is fully visible, including where the enemy's next action lands. A seal you detonate after 60 action points either beats the enemy's next action at 100, or it doesn't — and if it doesn't, you take the hit first. Shift cards let you reorder that: act sooner, push the enemy back, cancel an action already on the axis, or pull a scheduled seal forward.

Baseline: a unit with tempo 100 acts once every 100 action points.

## Running it

Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:5173
```

The quality gate (exactly what CI runs):

```bash
npm run typecheck && npm test && npm run build
```

### Android

```bash
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`. You can also grab it from [Releases](https://github.com/Mrar-wyc/chrono-deck/releases) or from the Actions build artifacts.

## Layout

Imports flow strictly one way: `content → engine → run → ui`. The rules layer has no idea a UI exists.

```
src/
  rng/        Seeded RNG. Global randomness is banned project-wide, enforced by a guard test
  engine/     Pure rules: type contract, timeline scheduling, effect resolution, enemy AI
  content/    Data tables: seals, aberrations, encounters. This is where long-term work happens
  run/        Single-run state machine: map, rewards, shop, saves
  replay/     Action log, replay runner, state hashing
  ui/         Screens, stage scaling, card rendering
tests/        Unit tests + cross-file guards + UI smoke
```

## Two design decisions worth calling out

**Seeded randomness is a first-class citizen.** Every random draw goes through an injected `Rng`; there is not a single global random call in the source (a guard test greps for it, comments included). The payoff: same seed plus same inputs always reproduces the same result, so replays, bug reports, seed sharing, and noise-free balance measurement all come for free. A future "daily shared seed" mode needs no architectural change.

**Content lookups never throw.** A save or replay referencing a deleted id returns `undefined`; the UI renders a placeholder card instead of white-screening. Projects that let lookups throw tend to accumulate more defensive code than feature code — better not to create the need.

## Contributing

Adding a seal touches exactly one file, `src/content/cards.ts` — no engine, UI, or save changes. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). The setting, card text, and code are all original to this project.
