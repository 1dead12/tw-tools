# TW Train Catcher v5

**Tribal Wars in-game snipe timing calculator with millisecond precision.**

Calculates exact send times for defensive sniping — ensuring your troops return home in the precise ms gap between an incoming cleaner (ram) and the first noble attack.

![Timer Tab](docs/tw-live-test-3-fixed.png)
![Coordination Tab](docs/tw-live-test-4-coordination.png)

## Features

### Auto-Detection of Incoming Attacks
- Parses the **Incomings (Prichod) overview page** automatically
- Extracts arrival times **with milliseconds** directly from DOM
- Multi-market support: SK, CZ, EN, DE, PL (date words: dnes/zajtra/today/tomorrow/heute/morgen...)
- **Unit speed heuristic** auto-classifies commands as cleaner vs noble based on travel time gaps
- Click any type cell to manually override classification
- Groups attacks into trains: same player + same target + within 30s

### Tab 1: Timer
- **Train selector** — auto-parsed incoming attacks + manual entry
- **Train breakdown** — each command with arrival ms, source village, distance
- **Gap selection** — click between commands to set return target
- **Safe window** — visual bar showing ms window with width badge
- **3 snipe modes**:
  - **Mode A** — Round-trip to barbarian village
  - **Mode B** — Support + recall with retry table
  - **Mode C** — One-way support
- **Live countdown** with color transitions
- **MS Precision Bar** — canvas 60fps needle (0-999ms) with safe window overlay

### Tab 2: Coordination
- **Barbarian finder** — fetches barb villages from `/map/village.txt`
- **Incoming trains matrix** — grouped by target village
- **Snipe sources** — all your villages that can snipe, with send times
- **Unified send schedule** — chronological list with "Open in Timer" navigation

### Universal
- Auto-detects world speed from `/interface.php` APIs
- Works on **any Tribal Wars market/server**
- Dark theme, draggable modal, localStorage caching

## Installation

### Quickbar (recommended, requires Premium)
1. Go to **Settings** > **Edit Quickbar** > **Add New Link**
2. Paste this as the **Target URL**:
```
javascript:$.getScript('https://1dead12.github.io/TW-train-catcher/scripts/tw-precision-timer-v5.min.js');void 0;
```
3. Save and click the quickbar button on the **Incomings** page

> **Note:** Uses GitHub Pages (`*.github.io`) which serves proper CORS headers. `raw.githubusercontent.com` does NOT work with `$.getScript()`.

### Bookmarklet (no Premium needed)
1. Create a browser bookmark with the same URL as above
2. Click the bookmark while on a TW game page

## Building from Source

```bash
npm install
npm run build     # minify + generate quickbar version
npm test          # run all tests
```

| Script | Description |
|--------|-------------|
| `npm run build` | Minify source + generate quickbar wrapper |
| `npm run minify` | Generate `.min.js` only |
| `npm run quickbar` | Wrap minified into `javascript:void(...)` |
| `npm test` | Run all Playwright tests |
| `npm run test:unit` | Run 33 inline unit tests |
| `npm run test:e2e` | Run live game integration tests |

## Rules Compliance

This script is a **read-only calculator**. It:
- NEVER submits any form
- NEVER auto-executes
- NEVER monitors attacks in background
- NEVER sends data externally
- NEVER modifies game state

## Game Mechanics

Core rule: **milliseconds of send = milliseconds of return** (deterministic).

- Mode A: `sendTime = targetReturn - (travelTime * 2)`
- Mode B: `sendTime = targetReturn - (2 * Y)`, `recallTime = targetReturn - Y`
- Mode C: `sendTime = targetArrival - travelTime`
- Safe window: `{min: lastCleanerMs + 1, max: firstNobleMs - 1}`

See [design document](docs/plans/2026-03-23-tw-precision-timer-v5-design.md) for full mechanics.

## License

MIT
