# Task: tw-overview "Ultimate" — Summary

**Date:** 2026-06-23 → 2026-06-24
**Repo:** `/Users/denispaulik/git/tw-tools` (branch `main`)
**Plan:** [plan.md](./plan.md) · **Design:** [design.md](./design.md) · **Contracts:** [node-compat-envelope.md](./node-compat-envelope.md) · **Live test:** [in-game-smoke-checklist.md](./in-game-smoke-checklist.md)

## What was done
Rebuilt `scripts/tw-overview.js` from a 1.6k-line 3-tab monolith into the **ultimate intel dashboard** (Approach C): one unified per-village master model + a declarative 58-column registry, surfaced through an 8-tab card, with all four data domains, smart filters, multi-column sort, and saved presets — shipped as one self-contained read-only `dist` bundle with `node:test` coverage on the extracted pure libs.

Delivered across 7 committed milestones:
- **M1** `3a456db` — build wiring (6-lib load order) + `node:test` glob runner + fixtures scaffold + node-compat contract.
- **M2** `76b7fd2` — `lib/tw-overview-core.js` (NEW pure heart) + `tw-core` parsers/indexes/fetchers + `getContinent` promotion.
- **M3** `ea7d42a` — COLUMN_REGISTRY + `buildMasterModel` JOIN + per-domain TTL cache keys + `detectPremium` + sequential read-only Fetch-All spine.
- **M4** `431ab76` — `lib/tw-table.js` (NEW generic engine: multi-sort, filter chips w/ counts, column-toggle, sticky/virtualized, row pills, BBCode/CSV).
- **M5** `fb5bfe1` — `lib/tw-config-core.js` (NEW versioned config + 5 seeded presets + migration from legacy `two_*`).
- **M6** `8e1e5ea` — thinned entry + 8-tab UI + Commands upgrades + real incomings aggregation (nukes/fakes/nobles EST) + 3 tech-debt fixes.
- **M7** `468ace5` — final dist build (all 7 bundles) + dist invariants + in-game smoke checklist.

## Why
The old Overview scraped only troops + commands, single-sort, 3 fixed settings. Goal: pull **economy, buildings, incomings/defense, map & rank** into one model with smart filters/sorts/saved views, while keeping the familiar tab feel and the `$.getScript` read-only quickbar contract.

## How (architecture)
`lib/` holds pure logic (node-tested, dual browser-IIFE + node-export envelope); `scripts/tw-overview.js` is a thin orchestrator. `build.js` concatenates `tw-core → tw-ui → tw-commands → tw-overview-core → tw-config-core → tw-table → script` into one terser bundle. Cache keys are unprefixed in the libs (the Store wrapper adds `two_`, Storage adds `twt_` → real `twt_two_*`). Fetch is sequential, single-lock, ≥200ms gaps, per-domain TTL (incomings 2m / troops 5m / econ+buildings 15m / map 1h). Columns map by header `<img src>`/class (never index). Fake/nuke is labelled ESTIMATE.

## Files (committed)
| File | Change |
|------|--------|
| `lib/tw-overview-core.js` | NEW — parsers, registry, master model, flags, sort, geo, ESTIMATE, tech-debt seams |
| `lib/tw-table.js` | NEW — generic registry-driven table engine |
| `lib/tw-config-core.js` | NEW — versioned config + presets + migration |
| `lib/tw-core.js` | parsers (villages keep bonusId), indexes, fetchPlayers/Tribes/BuildingInfo, getContinent (+ pre-existing fetchGroups WIP) |
| `lib/tw-commands.js` | parseIncoming emits target village |
| `scripts/tw-map-tools.js` | delegate getContinent |
| `scripts/tw-overview.js` | thin orchestrator + 8 tabs + Commands + tech-debt (+ pre-existing WIP) |
| `build.js`, `package.json` | lib load order + `npm test` |
| `tests/unit/**` | 161 specs + fixtures + tokenizer + harness |
| `dist/*.min.js` | rebuilt (all 7) |

## Verification
- `npm test` → **161 tests, 161 pass, 0 fail, 0 skipped**.
- `npm run build` → **7/7 succeed**; `dist/tw-overview.min.js` 97 KB, parses; VERSION 2.0.0; no `two_troop_data_`; no runtime `require`/`import`; tokens OverviewCore/Table/Config/TimeSync present.
- End-to-end proven in node: incomings → `nukesEst/fakesEst/noblesEst` → master row → pills `[twt-row-nuke, twt-row-underdef]`; preset sort sorts through the engine; flat-key parser output flows to `isNuke/off/defPower`.
- **4 integration bugs caught by verification** (passed isolated unit tests, real defects): M3 flat-vs-nested units + missing off/defPower; M4 pill fired on own `isNuke`; M5 config sort object-not-array; M2 wrong test lib path. All fixed with regression tests.

## Continuation notes (for whoever picks this up)
- **NOT pushed.** Commits are local on `main` (M1 `3a456db` … M7 `468ace5`). Push to `1dead12.github.io` is required before the quickbar serves v2 in-game — awaiting Denis's explicit go.
- **In-game E2E (T42) is PENDING** — run `in-game-smoke-checklist.md` in a Premium world after pushing; record evidence; patch any DOM/real-DOM gaps.
- **Real fixtures PENDING.** `tests/unit/fixtures/*` are **synthetic placeholders**. Capture real View-Source of overview `mode=units(complete)/prod/buildings/incomings` + `/map/{village,player,ally}.txt` from a real world and drop them in `tests/unit/fixtures/` — then re-run `npm test` to harden the parsers against real DOM (esp. prod/buildings icon filenames + the 5-row category labels). Multi-world: worldKey is runtime-detected, so fixtures only need to come from one real world.
- DOM/UI (render functions, live countdown, settings/Views handlers, premium-probe AJAX) is **not unit-tested by design** — covered only by the in-game checklist.
- Pre-existing untracked `tasks/2026-04-23-automation-runner-sk103.md` is unrelated clutter (left as-is).
