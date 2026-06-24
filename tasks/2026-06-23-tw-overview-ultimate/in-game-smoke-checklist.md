# tw-overview v2.0.0 — In-Game Smoke Checklist (T42, manual)

Run this in a logged-in **Premium** world. Record PASS/FAIL + evidence (screenshot / Network tab note)
next to each item. No "done" claim without evidence (per design §9). Nothing here auto-sends — the
script is strictly read-only.

## 0. Load
- [ ] The new bundle is reachable. Either push `dist/` to `1dead12.github.io` first, OR for a local
      test paste the contents of `dist/tw-overview.min.js` into the browser console on a game page.
- [ ] Quickbar entry **Overview (8)** → `$.getScript('https://1dead12.github.io/tw-tools/dist/tw-overview.min.js?v='+Date.now())` opens the card.

## 1. Shell
- [ ] Card opens ~**1000×580**, draggable + resizable, position persists across reload.
- [ ] **8 tabs**: Dashboard · Troops · Economy · Buildings · Incomings · Map · Commands · Settings.
- [ ] **Lazy render**: no network fetch on open; a tab renders on first activation; **Fetch All** triggers the data pull.

## 2. Fetch-All discipline (Network tab)
- [ ] Requests are **SEQUENTIAL** with **≥200ms** gaps — never overlapping (single in-flight lock).
- [ ] Progress advances (status/toast); on completion every tab re-renders from the **one** master model (villages JOIN by id).
- [ ] Second Fetch-All within TTL serves **from cache** (troops 5m / econ+buildings 15m / map 1h); **incomings refetch after ~2m**.
- [ ] **Read-only**: no POST/command/send requests appear. Ever.

## 3. Data correctness
- [ ] **Columns map by header icon** (try an archer / church / watchtower world — feature columns appear/disappear correctly, nothing shifts).
- [ ] `type=complete` **dedup**: each village appears once; counts are not doubled/quintupled.
- [ ] **Economy**: the **clay** column (DOM `class="stone"`) shows clay, not iron/wood; warehouse fill % colour-grades green<60 / amber / red≥90.
- [ ] **Buildings**: levels correct; derived flags (academy-ready / no-wall) sane.
- [ ] **Map**: distance-to-front + nearest enemy + continent + points + rank populate; barb targets count sane.

## 4. Incomings & pills
- [ ] **Incomings** tab: per-village count, soonest arrival with **live countdown** (ticks), nearest source.
- [ ] **Fake/nuke EST** badges present and labelled as estimates (never certainty).
- [ ] **Row pills**: red = under-defended, amber = wh-near-full, **purple = incoming nuke** (NOT your own offensive nukes).

## 5. Table power
- [ ] **Multi-column sort**: click a header sorts; **shift-click** adds a secondary key; persists per tab.
- [ ] **Threshold filter chips** with live counts (nukes / under-defended / wh-near-full / has-incomings …) compose with AND.
- [ ] **Column-toggle** chips; **Dashboard** lets you pick any column from any domain; sticky header; smooth scroll on large village counts.
- [ ] **BBCode** + **CSV** export the **current filtered+sorted+visible** view; `[coord]x|y[/coord]` links in BBCode.

## 6. Premium degrade
- [ ] On a non-premium probe, **Economy/Buildings degrade** to `game_data` current village + a "Premium required" note — the tab is **not hidden** and nothing errors.

## 7. Config & presets
- [ ] **Settings**: thresholds / includeArchers / exportFormat / theme / card size bind and persist.
- [ ] **Views presets**: Front Nukes / Eco low-WH / Defense Gaps / Frontline / Full-offense-ready apply (columns+filters+sort); save/rename/delete + import/export work.
- [ ] **Persistence**: a saved preset + settings survive a full page reload (`twt_two_config`).
- [ ] **Migration**: your old `two_*` settings (nukeThreshold/includeArchers/exportFormat) carried into the v2 config on first load.
- [ ] **Clear-Cache** clears the data caches but **keeps** your config/presets.

## 8. Commands tab
- [ ] Multi-sort + live countdown + BBCode/CSV export + fake/nuke EST tag.

---
**Result:** _____ / record date, world, and any failures as Jira/TODO items; ping for patches.
