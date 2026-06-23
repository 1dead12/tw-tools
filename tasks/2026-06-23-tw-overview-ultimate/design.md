# tw-overview "Ultimate" — Design

**Date:** 2026-06-23
**Status:** APPROVED (scope + architecture). Plan pending.
**Repo:** `/Users/denispaulik/git/tw-tools` (you = github `1dead12`)
**Target:** `scripts/tw-overview.js` → `dist/tw-overview.min.js` (loaded via `$.getScript` premium quickbar / bookmarklet)
**Driven by:** 11-agent deep research pass (read the full tw-tools suite + the user's iCloud TW scripts + online TW data/script ecosystem). Raw synthesis: workflow `wf_7ca311b0-462`.

---

## 1. Goal (one sentence)

Turn `tw-overview` into the **ultimate single-player intel dashboard** — one unified per-village dataset surfaced through the familiar tabs, with all four game-data domains, smart threshold filters, multi-column sort, group/distance/search, and saved view presets — while staying a single self-contained read-only `dist` bundle.

## 2. Locked scope (your decisions)

| Decision | Choice |
|----------|--------|
| **Ambition** | Supercharge the existing tab structure (keep the Troops/Commands/Settings feel as the backbone) |
| **Architecture** | **C — Unified per-village master model + declarative COLUMN registry + `lib/` extraction + `node:test`** (built on a B substrate) |
| **Premium** | **Yes** — full multi-village Economy (`mode=prod`) + Buildings (`mode=buildings`) scraping available |
| **Layout** | **Dashboard + domain tabs**: `[Dashboard][Troops][Econ][Buildings][Incomings][Map][Commands][⚙]` — each domain tab is a built-in preset view over the shared model; Dashboard lets you pick any columns from any domain |
| **Data domains** | All four: Economy, Buildings, Incomings & defense, Map & rank |
| **Filters/sort** | All four: smart threshold filters, multi-column sort (every table), group/continent/distance/coord+name search, saved view presets |
| **Map intel (v1)** | **Lean**: distance-to-front + nearest-enemy + continent + village points + player rank + nearby barb/bonus targets (defer conquests feed + activity heuristic) |

### Defaults locked (overridable at plan review)

- **Theme:** keep the tw-tools TW-parchment `.twt-card` theme for suite consistency, **add** `data-state` row color pills (red = under-defended, amber = wh-near-full, purple = incoming-nuke).
- **Tests:** wire `node:test` + a `tests/unit/` dir + `npm test`; the **bundled lib source IS the tested source** (no hand-mirror — avoids the drift seen in the user's own scripts).
- **Persistence:** migrate the flat `two_*` settings to **one versioned `twov_config` blob** `{cfgVersion, columns, filters, sort, views[], thresholds, theme}` with a migration shim importing legacy `two_settings`. Per-domain TTL caches stay under `twt_/two_` keys.
- **Seeded presets:** `⭐ Front Nukes`, `⭐ Eco low-WH`, `⭐ Defense Gaps`, `⭐ Frontline`, `⭐ Full-offense-ready` (plus each domain tab = a preset).
- **Card:** larger resizable default (~1000×580); column-toggle chips + sticky `thead` + horizontal scroll for wide tables.
- **Build contract (non-negotiable):** stays ONE self-contained `dist/tw-overview.min.js` via `$.getScript`; jQuery-only runtime; each file its own IIFE; `build.js` only concatenates `lib/*` (in order) + the single `scripts/tw-overview.js`; **add `tw-commands.js` to `SCRIPT_LIBS['tw-overview.js']`**.
- **Behavior contract (non-negotiable):** strictly **READ-ONLY** (never auto-send); fetch **sequentially** with ≥200ms gap + single in-flight lock; generous per-domain caching.

## 3. Architecture (Approach C)

```
lib/
  tw-core.js          (extend) keep rank col in fetchAllVillages; byId/byOwner/byContinent index;
                               promote getContinent; fetchBuildingInfo (get_building_info XML);
                               extend fetchWorldConfig/fetchUnitInfo to read building/coin/snob nodes
  tw-ui.js            (extend) table-engine hooks: sticky thead, column-toggle chips, filter chips
  tw-commands.js      (extend) parseIncoming emits TARGET village (for per-village aggregation)
  tw-overview-core.js (NEW, pure) parseOverviewTable(html,{headerIconRegex,labelMap,cellReaders});
                               per-domain cellReaders/labelMaps (units|prod|buildings|incomings);
                               dedup-by-id; derived flags (isNuke/isFull/underDefended/whNearFull/
                               hasIncomings/hasNoble); threshold predicates; multi-sort comparator
                               sortBy([{key,dir}]); continent/distance math; fake/nuke ESTIMATE
                               (classifyUnit/estimateAttackUnits); locale-tolerant number parse
  tw-table.js         (NEW) generic sortable/filterable/virtualized table over the column registry;
                               BBCode/CSV export of the CURRENT filtered+sorted view; row pills
scripts/
  tw-overview.js      (thin orchestrator) COLUMN_REGISTRY; buildMasterModel (JOIN by id);
                               Fetch-All orchestrator (sequential per-domain, one lock, progress);
                               Premium feature-detect/degrade; tab assembly (Dashboard + domains);
                               Commands tab upgrades; tech-debt fixes
tests/unit/           (NEW) node:test specs over the pure libs, with saved-HTML fixtures
```

**The single highest-leverage move:** generalize `parseCompleteOverview`/`parseUnitHeaders` into **one** `parseOverviewTable` shared by `units`/`prod`/`buildings`/`incomings` (all the same overview table shape), build **one** per-village master row JOINed by id, and drive **every** table's columns/filters/sorts/exports from **one declarative COLUMN registry** — then layer a shared multi-sort + threshold-filter-chip + saved-view engine on top. Adding a column or a whole domain becomes *one registry entry*.

## 4. Data-source map (per domain)

All sources are HTML/CSV/XML reads of same-origin TW pages — no third-party requests, no auto-send.

### Economy (Premium)
- **Primary:** `GET /game.php?screen=overview_villages&mode=prod&group={gid}&page={n}` → `parseOverviewTable`.
- **Derive** prod/h, warehouse cap, hide cap from `get_building_info` × building levels.
- **Free fallback:** `game_data.village.{wood,clay,iron,storage_max,pop,pop_max,trader_max}` for the open village (instant, no AJAX).
- **Columns:** warehouse fill % (color-graded green<60 / amber 60–90 / red ≥90), wood, clay, iron, wh capacity, prod/h, time-to-full, merchants free/total, hide cap, points. **Cache** `two_econ_g{gid}` TTL ~15m.

### Buildings (Premium)
- **Primary:** `GET ...&mode=buildings&group={gid}&page={n}` → `parseOverviewTable`, columns mapped by **building icon `img src`** (`/buildings/main.png`, `wall.png`, `smith.png`, …) — language-proof and world-config-proof.
- **Derive flags** from `get_building_info` caps: `academy-ready` (HQ≥20 & smithy≥20 & market≥10), `farm-capped`, `no-wall`, `under-built`.
- **Columns:** HQ, wall, smithy, farm, warehouse, academy, rally, market, barracks, stable, workshop, watchtower, church + derived flags. **Cache** `two_buildings_g{gid}` TTL ~15m.

### Incomings & defense
- **Primary (count/timing per target):** `GET ...&mode=incomings&subtype=attacks&group={gid}&page={n}` → reuse/extend `TWTools.Commands.parseIncoming()` (multi-lang col map, source coords, arrival via `parseArrivalTime`) **to emit the TARGET village**; aggregate per target. **Cache** `two_incomings_g{gid}` TTL ~2m (volatile — separate key, never shared with troops).
- **Fake/nuke tagging (ESTIMATE):** port `classifyUnit(travelMs,dist,unitSpeeds,worldConfig)` + `groupIntoTrains(cmds,30000)` + `estimateAttackUnits`; gated on `get_config`+`get_unit_info` loaded first. Labeled **ESTIMATE**, never certainty.
- **Under-defended (free JOIN):** reuse existing `calculateArmySummary` defPower vs threshold AND has-incomings.
- **Columns:** # incomings, soonest arrival + **live countdown** (`TimeSync.now()`), #nukes/#fakes/#nobles (est), under-defended flag, defPower (home), nearest source player/tribe (friend/enemy).

### Map & rank (Lean, ~free — fetchers already exist, 1h cache)
- `GET /map/village.txt` → `fetchAllVillages` **extended to keep rank (col 6, currently dropped)** + build `byId/byOwner/byContinent` index. Store ONLY trimmed cols `(id,x,y,owner,points,rank)` (5MB localStorage quota).
- `GET /map/player.txt` (id,name,tribe,villages,points,rank) + `/map/ally.txt` (tribe) → JOIN for **nearest-ENEMY** + friend/enemy tagging.
- **Columns:** distance-to-front, nearest-enemy player/tribe, continent (Kxy), points, rank, nearby barb/bonus targets (count + nearest). Distance-to-front bucketed by continent first (avoid O(own×all) freeze).

## 5. Reuse inventory (don't rebuild these)

`createCard` (tabs/drag/resize/position-persist) · `Storage.get/set(ttl)/remove` · `fetchAllVillages`/`fetchBarbVillages` · `fetchGroups(force)` (just-improved WIP) · `fetchWorldConfig`/`fetchUnitInfo` + `DEFAULT_UNIT_SPEEDS` · `distance`/`travelTime`/`calcTravelTime` · `parseArrivalTime` + `TimeSync` (live countdowns) · `Commands.parseIncoming/classifyUnit/groupIntoTrains/CMD_TYPE` · `parseCompleteOverview`/`parseUnitHeaders` (→ generalize) · `splitIntoCategories` (dedup-by-id + derived flags → extend) · `calculateArmySummary` (defPower → under-defended) · `formatNum/parseIntSafe/escapeHtml/extractCoords/copyToClipboard/exportBBCode/exportCSV` · `getContinent` (in tw-map-tools → promote to tw-core).

## 6. Feature menu (prioritized — high value first)

**High value / small:** per-domain TTL caching; add `tw-commands.js` to overview libs; under-defended detection.
**High value / medium:** generalize `parseOverviewTable`; COLUMN registry; multi-column `sortBy` (every table, persisted); smart threshold filter chips (composable AND + counts); Economy cols; Buildings grid + flags; Incomings radar + live countdown; group+continent+distance+coord/name search; saved view presets; distance-to-front/nearest-enemy; column-toggle + sticky thead + virtualized rows; Fetch-All orchestrator + progress.
**High value / large:** unified per-village master model (the substrate).
**Med value:** dynamic-column BBCode/CSV export of current view; army/defense summary header; data-state row pills; per-village tags/notes; world-config feature gating; **tech-debt fixes** (VERSION/header unify; Clear-Cache currently clears wrong keys = no-op → fix to `two_troop_all_g*`; `recalculateNukeStatus` across all 5 view buckets); fake-vs-nuke tagging (ESTIMATE); pure testable libs; barb/bonus farm targets; Commands tab upgrades (sort/countdown/export/tagging).
**Deferred (post-v1):** conquests feed near front; activity/last-growth heuristic; combined-tab advanced analytics.

## 7. Conventions to adopt (from your own scripts)

Versioned spread-merge config (`{...DEFAULTS, ...parsed}`) + dated `migrateConfig()` (restore SAVED version before migrating); two-tier persistence (config vs cache) with hydrate-first patch-merge; saved views `[{name,visibleColumns,filters,sort,group}]` with import/export; **pure `parse(html)->data` (fail-safe: return 0/null/[], never throw)** + pure predicates/comparators split into testable modules; declarative registry over branching (à la `ALL_MODULES`); settings-form `#two-<key>` binding + NaN-safe `intOr` + min/max clamps + auto-swap inverted pairs; `game_data`-first then DOM/URL fallback; locale-tolerant numeric parse (strip NBSP/`.`/`,`; **TW DOM quirk: `stone` element == clay**); defensive try/catch everywhere; idempotent DOM injection.

## 8. Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| `mode=prod`/`mode=buildings` Premium-gated | Premium=Yes confirmed; still feature-detect + degrade to `game_data` current village + note |
| Single-TTL cache shows stale incomings / refetches multi-MB map.txt | **Per-domain TTLs** (incomings 2m / troops 5m / econ+buildings 15m / map 1h) — #1 correctness trap |
| localStorage ~5MB quota (shared across all tw-tools scripts) | Cache only trimmed map cols; namespace keys with world+market |
| Column index not fixed across worlds (archer/church/watchtower) | Map columns by header `img src`/class, NEVER hardcode indices; gate feature cols on `get_config` |
| `type=complete` 5 rows/village double-counts | Dedup by id (à la `splitIntoCategories`) before JOIN |
| Fake/nuke is an estimate | Label ESTIMATE; gate on `get_config`+`get_unit_info` loaded first |
| Distance-to-front O(own×all) freeze | Bucket enemy villages by continent first |
| File bloat (already 1681 lines) | Lib extraction (Approach C) — thin entry script |
| No `npm test` wired | Add `node:test` + `tests/unit/` + `npm test` |
| Existing bugs | Fix VERSION/header, Clear-Cache no-op, `recalculateNukeStatus` stale buckets |
| Uncommitted WIP on `main` (tw-core.js fetchGroups, tw-overview.js +20) | Branch before execution; build ON the WIP (don't revert it) |

## 9. Build & verify procedure

Edit `lib/*` + `scripts/tw-overview.js` → `npm run build:overview` → terser → `dist/tw-overview.min.js` (+ `.quickbar.js`). Verify in-game via the existing quickbar entry (`Overview (8)` → `1dead12.github.io/tw-tools/dist/tw-overview.min.js`). Unit: `npm test` (node:test over pure libs). E2E: existing Playwright in `tests/e2e/` if applicable.

## 10. Out of scope (v1)

Conquests feed; activity heuristic; auto-actions of any kind; changes to sibling scripts beyond promoting shared helpers (`getContinent`) into `tw-core` and the `tw-commands` target-village extension; non-overview tabs' deep rework beyond the Commands upgrades.
