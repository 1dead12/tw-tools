# tw-overview — Attack/Defense Tiers + Curated Filters

**Date:** 2026-06-24 · **Status:** APPROVED, executing · **Builds on:** tw-overview v2 (live on sk104)
**Research:** workflow `wf_d1d2393b-0aa` (attack-tier metric + filter catalog + UX).

## Decisions (locked)
- **Attack tier basis:** offensive **farm-space** `offensivePop = Σ(unit × pop)` over OFFENSIVE_UNITS (axe·1, light·4, ram·5, cata·8, +marcher·5 if includeArchers). `nukeFraction = offensivePop / TARGET_NUKE_POP`.
- **Tiers:** full ≥ 0.90 (AND `ram ≥ MIN_RAM` guard) · partial 0.40–0.89 · empty < 0.40.
- **Color polarity (offense):** **RED = full nuke** (default, polarity B), ORANGE = partial, GREEN = empty. Configurable toggle. Defense tier keeps RED = under-defended (danger).
- **Accessibility:** tier = colored **badge column** (NOT row bg — avoids red collision with the under-defended/wh-full/incoming-nuke row pills). Badge ALWAYS shows icon + text label + raw %.
- **TARGET_NUKE_POP = 20000** (configurable). TARGET_DEF_POP = 20000. MIN_RAM = 200.
- **Unit pops:** fetched per-world from `get_unit_info` (real: axe1/light4/ram5/cata8/spear1/sword1/heavy6/spy2/snob100/militia0/knight10); pure code takes an injected `unitPops` map with these as defaults.
- **Scope = YOUR villages.** Deferred: incoming-classification (nukeIncoming/nobleIncoming/snipeNeeded — need watchtower size + per-incoming noble flag + landing timestamps; account has 0 incomings) and enemy/target cluster (farmTarget/lowLoyalty).

## Curated filter columns (all filterable + sortable)
- **offense:** `attackTier`(badge full/partial/empty) · `nukePercent`(num) · `hasFullNuke`(flag) · `offType`(axe-heavy/lc-heavy/balanced) · `catNuke`(num/flag, cata≥200) · `fakeAvailable`(flag: has a unit AND nukeFraction<0.40)
- **defense:** `defTier`(badge) · `underDefended`(sharpened) · `stacked`(defFraction≥2.0)
- **noble:** `nobleTrainReady`(snob≥4 AND nukeFraction≥0.6) · `hasNoble`(exists)
- **economy:** `whFull`(≥99%) · `whNearFull`(exists) · `resLow`(any res<10% cap) · `merchantsFree`(≥1) · `freeFarmSpace`(popMax−popUsed) · `farmCapped`(popUsed≥95% popMax)
- **buildings:** `academyReady`(exists) · `noWall`(wall<20) · `underBuilt`(main<20)
- **scout/map:** `scoutReady`(spy≥50) · `frontline`(distFront ≤ band) · `distFront`(exists)

## Seed presets (add to the 5 existing)
- ⭐ **Send-out wave** — attackTier=full AND hasIncomings=false
- ⭐ **Defense needed** — underDefended=true OR (defTier=empty AND hasIncomings)
- ⭐ **Economy overflow** — whNearFull=true
- ⭐ **Noble-ready** — nobleTrainReady=true OR academyReady=true
- ⭐ **Fakes available** — fakeAvailable=true

## Build steps (test-first; in-browser validation at the end)
1. **Pure (`lib/tw-overview-core.js`):** `UNIT_POP` defaults; `classifyAttackTier(row,opts)`→{tier,nukeFraction,nukePercent,offensivePop,label,icon,colorKey}; `classifyDefTier(row,opts)`; extend `computeDerivedFlags` to set all the new fields above. opts gains {targetNukePop, greenFraction, orangeFraction, minRam, targetDefPop, includeArchers, colorPolarity, unitPops}. All pure, fail-safe; node:tests with real pops (e.g. 6500 axe+3000 light+300 ram → ~20000 pop → full).
2. **Registry:** add the new columns with `domain`, `filterable`, `sortable`, `format`, and tier `badge`/`tierChips` meta.
3. **Table engine (`lib/tw-table.js`):** render `badge` columns as a colored pill (bg per colorKey + icon + label + %); generate tier filter chips (full/partial/empty) with live counts; keep multi-sort working on `nukePercent`.
4. **Config/Settings (`lib/tw-config-core.js` + entry):** new threshold keys + colorPolarity; Settings-tab form fields (NaN-safe, clamps); 5 seed presets; cfgVersion migration.
5. **Wire (`scripts/tw-overview.js`):** fetch `get_unit_info` pops once (cached) → thread `unitPops` + tier thresholds into `buildMasterModel` opts; rebuild.
6. **Verify:** npm test green; build green; then LIVE on sk104 — Fetch All, confirm attackTier badge renders (Freeck = empty/GREEN, 0 troops), tier chips filter, Settings thresholds persist; push.

## Verify gates
`npm test` green · `npm run build:overview` green · `node -e require` clean · live in-browser: badge column + tier chips + filter counts render; Settings persist.
