# TW Train Catcher v5

**Tribal Wars in-game snipe timing calculator with millisecond precision.**

Calculates exact send times for defensive sniping — ensuring your troops return home in the precise ms gap between an incoming cleaner (ram) and the first noble attack.

![Timer Tab](docs/tw-live-test-3-fixed.png)
![Coordination Tab](docs/tw-live-test-4-coordination.png)

## Features

### Tab 1: Timer
- **Train selector** — auto-parses incoming attacks from DOM or manual entry
- **Train breakdown** — shows each command (cleaner, noble, scout) with editable ms values
- **Gap selection** — click between any two commands to set your return target
- **Safe window** — visual bar showing the ms window with width badge (green/yellow/red)
- **3 snipe modes**:
  - **Mode A** — Round-trip attack on barbarian village (send + auto-return)
  - **Mode B** — Support snipe with recall (send + recall + return, with retry table)
  - **Mode C** — One-way support (troops stay at target)
- **Live countdown** — real-time countdown to send time with color transitions
- **MS Precision Bar** — canvas-based 60fps needle showing current ms (0-999) with safe window overlay

### Tab 2: Coordination
- **Village scanner** — detects your villages from game data
- **Barbarian finder** — fetches all barb villages from `/map/village.txt` (4,600+ on sk102)
- **Incoming trains matrix** — grouped by target village
- **Snipe sources** — for each train, shows all your villages that can snipe it with send times
- **Unified send schedule** — chronological list of all sends with "Open in Timer" navigation

### Universal
- Auto-detects world speed and unit speed from `/interface.php` APIs
- Works on **any Tribal Wars market/server** (SK, CZ, EN, DE, PL, etc.)
- Dark theme matching TW aesthetic
- Draggable modal window
- localStorage caching with TTL

## Installation

### Quickbar (recommended)
1. Open Tribal Wars game
2. Go to **Settings** > **Edit Quickbar** > **Add New Link**
3. Copy the contents of `scripts/tw-precision-timer-v5.quickbar.js`
4. Paste as the **Target URL**
5. Click the quickbar button on any game page

### Bookmarklet
1. Create a new browser bookmark
2. Copy the contents of `scripts/tw-precision-timer-v5.quickbar.js`
3. Paste as the bookmark URL
4. Click the bookmark while on a TW game page

## Rules Compliance

This script is a **read-only calculator**. It:
- NEVER submits any form (no attacking, supporting, or recalling)
- NEVER auto-executes (user must click to activate)
- NEVER monitors incoming attacks in background
- NEVER sends data to external servers
- NEVER modifies game state
- NEVER emulates premium features

## Files

| File | Size | Description |
|------|------|-------------|
| `scripts/tw-precision-timer-v5.js` | 75KB | Full source with 29 inline unit tests |
| `scripts/tw-precision-timer-v5.min.js` | 35KB | Minified production build |
| `scripts/tw-precision-timer-v5.quickbar.js` | 35KB | Ready-to-paste quickbar `javascript:` URL |
| `scripts/tw-precision-timer-v5-test.html` | 4KB | Browser test harness |
| `tests/e2e/tw-precision-timer.spec.js` | 10KB | 12 Playwright E2E tests |

## Testing

### Unit Tests (29 tests)
```bash
npm install
npx playwright test --grep "inline tests"
```

### Live Game Tests (requires login)
```bash
npx playwright test --grep "Live Game"
```

### Test Harness (browser)
Open `scripts/tw-precision-timer-v5-test.html` in a browser to run all unit tests visually.

## Game Mechanics

Based on the core TW timing rule: **milliseconds of send = milliseconds of return** (deterministic).

- Mode A: `sendTime = targetReturn - (travelTime * 2)`
- Mode B: `sendTime = targetReturn - (2 * Y)`, `recallTime = targetReturn - Y`
- Mode C: `sendTime = targetArrival - travelTime`
- Safe window: `{min: lastCleanerMs + 1, max: firstNobleMs - 1}`

See `docs/plans/2026-03-23-tw-precision-timer-v5-design.md` for the full design document.

## World Config (sk102 example)

| Setting | Value |
|---------|-------|
| World speed | 1.2x |
| Unit speed | 0.825 |
| Ram speed | 30 min/field (base) |
| Noble speed | 35 min/field (base) |

The script auto-fetches these values for any world.

## License

MIT
