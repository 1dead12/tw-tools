# TW Tools Suite v2.1

**Tribal Wars script suite — 6 tools for combat, intel, and map.**

6 independent quickbar scripts sharing a common UI library. Game-native TW styling, floating card widgets.

## Scripts

| # | Script | Category | Description |
|---|--------|----------|-------------|
| 1 | **tw-snipe** | Combat | Snipe v6 — ms-precision timing, all-village scanner, return-snipe, BBCode |
| 2 | **tw-planner** | Combat | Attack Planner — coordinate timed attacks, fakes, audio alerts |
| 3 | **tw-scavenge** | Economy | Mass Scavenge v2 — group selection, checkbox villages, keep-home |
| 4 | **tw-overview** | Intel | Troop Overview — army summary, nuke counter, command tracker |
| 5 | **tw-map-tools** | Map | Extended Map — barb finder, bonus finder, coord picker, watchtower |
| 6 | **tw-clock** | Utility | MS Clock v3 — 60fps server time with milliseconds + countdown timers |

## Features

### tw-snipe.js — Snipe Timer v6

**5 tabs: Timer | Scanner | Return-Snipe | Coordination | Tools**

- **Timer**: Auto-parse incoming trains, unit heuristic (cleaner/noble), safe window, 60fps MS bar
- **Scanner**: Scan ALL your villages → which ones can snipe, sorted by launch time, recommended badges, BBCode export
- **Return-Snipe**: Calculate exact ms to cancel outgoing command so troops return at target time. One-click cancel via API. MS of cancel click = MS of return arrival.
- **Coordination**: Multi-village send schedule, barb finder, chronological plan
- **Tools**: Distance calculator, back-time calculator, fields calculator

### tw-scavenge.js — Mass Scavenge v2

- **Village group dropdown** — scavenge specific groups
- **Checkbox mass selection** — check/uncheck individual villages
- **Per-village keep-home** — different troop reserves per village
- Balanced or priority-higher distribution modes
- Batch sending (200 squads per request)

### tw-planner.js — Attack Planner v1

- **Timed attacks**: plan coordinated attacks from multiple villages to one or more targets
- **Fake generator**: bulk fakes with player/tribe lookup, distance filters, custom units
- **Audio alerts**: beep N seconds before launch time
- **Live countdown**: blinking rows when <10s, visual urgency indicators
- Rally point links (never auto-sends)
- BBCode export for tribal coordination

### tw-overview.js — Troop Overview v1

- **Army summary**: total troops, offensive/defensive power, nuke count, noble trains
- **Per-village table**: all unit types with sortable columns
- **Command tracker**: outgoing attacks, supports, returns with arrival times
- BBCode + CSV export

### tw-map-tools.js — Extended Map Tools v1

- **Barb finder**: filter by points, distance, continent
- **Bonus village finder**: 8 bonus types, owner/distance filters
- **Coordinate picker**: click map to collect coords, BB-code export
- **Watchtower planner**: detection ranges, coverage overlap matrix

### tw-clock.js — MS Clock v3

- `performance.now()` interpolated server time
- 60fps display with milliseconds
- Optional game clock patching
- **Countdown timers** with labels, colors, and sound alerts
- Timer persistence across page refreshes
- Auto-cleanup expired timers (configurable interval)
- Quick-add timers from incoming attack times
- Settings: font size, volume, cleanup interval

## Installation

### Quickbar (requires Premium)

Go to **Settings** > **Edit Quickbar** > **Add New Link**, paste target URL:

```
javascript:$.getScript('https://1dead12.github.io/tw-tools/dist/tw-snipe.min.js');void 0;
```

| Script | Quickbar URL |
|--------|-------------|
| Snipe | `javascript:$.getScript('https://1dead12.github.io/tw-tools/dist/tw-snipe.min.js');void 0;` |
| Planner | `javascript:$.getScript('https://1dead12.github.io/tw-tools/dist/tw-planner.min.js');void 0;` |
| Scavenge | `javascript:$.getScript('https://1dead12.github.io/tw-tools/dist/tw-scavenge.min.js');void 0;` |
| Overview | `javascript:$.getScript('https://1dead12.github.io/tw-tools/dist/tw-overview.min.js');void 0;` |
| Map Tools | `javascript:$.getScript('https://1dead12.github.io/tw-tools/dist/tw-map-tools.min.js');void 0;` |
| Clock | `javascript:$.getScript('https://1dead12.github.io/tw-tools/dist/tw-clock.min.js');void 0;` |

### Bookmarklet (no Premium needed)

Create browser bookmarks with the same URLs above.

## Building from Source

```bash
npm install
npm run build              # Build all 6 scripts
npm run build:snipe        # Build only tw-snipe
npm run build:planner      # Build only tw-planner
```

## Architecture

```
tw-tools/
├── lib/
│   ├── tw-core.js        # Utilities, TimeSync, Storage, DataFetcher (743 lines)
│   ├── tw-ui.js          # Floating card widget, MS bar, TW theme (773 lines)
│   └── tw-commands.js    # Command parser, cancel API (566 lines)
├── scripts/
│   ├── tw-snipe.js       # Snipe v6 — Combat (2656 lines)
│   ├── tw-planner.js     # Attack Planner — Combat (1357 lines)
│   ├── tw-scavenge.js    # Mass Scavenge v2 — Economy (1555 lines)
│   ├── tw-overview.js    # Troop Overview — Intel (1419 lines)
│   ├── tw-map-tools.js   # Extended Map — Map (1499 lines)
│   └── tw-clock.js       # MS Clock v3 + Timers — Utility (740 lines)
├── dist/                 # Built files (min.js + quickbar.js per script)
├── build.js              # Build system (concat libs + minify)
└── package.json
```

**Total**: ~11,700 lines source → ~280 KB minified across 6 scripts.

Each `dist/*.min.js` is self-contained (libs bundled in). No external dependencies at runtime except jQuery (provided by TW).

## Game Mechanics

**MS determinism**: milliseconds of send action = milliseconds of arrival. This is the core mechanic that makes precision sniping possible.

- **Mode A** (round-trip barb): `sendTime = targetReturn - (travelTime * 2)`
- **Mode B** (support + recall): `sendTime = targetReturn - (2 * Y)`, `recallTime = targetReturn - Y`
- **Mode C** (one-way support): `sendTime = targetArrival - travelTime`
- **Return-Snipe**: `cancelTime = targetArrival - travelTimeBack` (cancel click ms = return arrival ms)

## Legacy

The original TW Precision Timer v5 (`scripts/tw-precision-timer-v5.js`) is kept for reference. The new `tw-snipe.js` v6 is its successor with all v5 features plus Tsalkapone scanner merge, return-snipe, and more.

## License

MIT
