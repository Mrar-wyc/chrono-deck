<div align="center">

# Chrono Deck

**A time-axis deckbuilding roguelike**

Cards don't resolve immediately. You place them onto a public timeline, where they detonate some number of action points later.

[![CI](https://github.com/Mrar-wyc/chrono-deck/actions/workflows/ci.yml/badge.svg)](https://github.com/Mrar-wyc/chrono-deck/actions/workflows/ci.yml)
[![Android Build](https://github.com/Mrar-wyc/chrono-deck/actions/workflows/android-build.yml/badge.svg)](https://github.com/Mrar-wyc/chrono-deck/actions/workflows/android-build.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-c9a227.svg)](LICENSE)

[Play in browser](https://mrar-wyc.github.io/chrono-deck/) · [中文](README.md) · [Progress & design notes](docs/开发进度.md) · [Contributing](CONTRIBUTING.md)

</div>

---

> **Status: milestone M1 (combat core) is done — a full battle is playable.** Timeline scheduler, event-stream engine, timeline UI, 30 seals, 7 encounters. Pick an encounter and a sideboard on the setup screen, then fight to a decision. The run loop (map, rewards, shop, saves) lands in M2.

## What it is

An original-IP card game built around one idea: a **public timeline**. Cards don't take effect when you play them; they get scheduled onto a shared axis and fire later. Strategy shifts from "which cards do I play this turn" to "what do I line up over the next several action points".

### Three kinds of seals

| Kind | Behaviour | Price |
|---|---|---|
| **Instant** | Resolves right away | Lowest numbers |
| **Deferred** | Scheduled on the timeline, fires after a delay | You're betting the situation still holds |
| **Shift** | Manipulates the timeline only, deals no damage | Doesn't solve the current problem |

Deferred cards are strictly more efficient per energy than instant ones (Frost Strike: 1 energy for 12 damage, versus Calibrate: 1 energy for 6). That gap is the entire reason a player would accept the delay.

### Why it's a solvable puzzle

The timeline is fully visible, including where the enemy's next action lands and what it will do over the next two or three turns (its move rotation is printed right on its card). A seal you detonate after 60 action points either beats the enemy's next action at 110, or it doesn't — and if it doesn't, you take the hit first.

Shift cards let you reorder that: act sooner, push the enemy back, cancel an action already on the axis, or pull a scheduled seal forward. **Resolution order at the same action point is: deferred seals, then you, then enemies** — so "landing exactly one tick before the enemy" is computable and reproducible.

Baseline: a unit with tempo 100 acts once every 100 action points.

### Measured difficulty curve

Bot win rates over 40 seeded matches per tier (`tests/balance.test.ts`). The bot plays greedily by card value and never plans the timeline, so these are a **lower bound on human performance** — a player who does the arithmetic will do better.

| Tier | Encounter | Win rate |
|---|---|---|
| Single normal (tutorial) | Debris / Lagging / Rusher / Corroder | 98% – 100% |
| Group normal | Twin Debris | 100% (a 4.3-round war of attrition) |
| Elite | Corroder & Debris | 40% |
| Boss | Disjoiner | 23% |

## Running it

Node.js 22.12 or newer (required by `vitest` 5's engine field; on Node 20 `npm test` fails outright).

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

The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`. You can also get it from [Releases](https://github.com/Mrar-wyc/chrono-deck/releases) or the Actions build artifacts — note Releases is still empty, since no `v*` tag has been pushed yet (the release job only runs on a tag).

## Layout

Imports flow strictly one way: `content → engine → run → ui`. The rules layer has no idea a UI exists.

```
src/
  rng/        Seeded RNG. Global randomness is banned project-wide, enforced by a guard test
  engine/     Pure rules: type contract, timeline scheduling, effect resolution, bot policy
  content/    Data tables: seals, aberrations, encounters. This is where long-term work happens
  run/        Battle assembly (seeded shuffle → BattleInput); wired into a full run in M2
  replay/     State hashing and canonical serialisation
  ui/         Screens, stage scaling, the timeline axis, the battle screen
tests/        Engine rules + timeline layout + balance regression + soak + UI smoke + guards
```

## Three decisions worth calling out

**Seeded randomness is a first-class citizen.** Every random draw goes through an injected `Rng`; there is not a single global random call in the source (a guard test greps for it, comments included). The payoff: same seed plus same inputs always reproduces the same result, so replays, bug reports, seed sharing, and noise-free balance measurement all come for free. One test literally records a match's actions and replays them, asserting the event streams are identical line for line.

**Content lookups never throw.** A save or replay referencing a deleted id returns `undefined`; the UI renders a placeholder card instead of white-screening. Projects that let lookups throw tend to accumulate more defensive code than feature code — better not to create the need.

**The engine is step-driven and the UI only replays events.** The engine emits `BattleEvent[]`; the UI plays them in order — rules changes don't touch the UI, and UI changes don't touch the rules. That also makes numeric tuning fully headless: bots play hundreds of matches to produce comparable win rates, and `DIAG=1` dumps a whole match turn by turn for a human to read.

## Contributing

Adding a seal touches exactly one file, `src/content/cards.ts` — no engine, UI, or save changes. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). The setting, card text, and code are all original to this project.
