# Attack Planner v2.0 - Major Feature Upgrade

**Date**: 2026-04-19
**Status**: IMPLEMENTED
**Scope**: 7 features across tw-planner.js + tw-core.js
**Estimated size**: ~600 lines changed/added in tw-planner.js, ~80 in tw-core.js

---

## Context

The Attack Planner (tw-planner.js, 1375 lines) is a Tribal Wars browser script for coordinating timed attacks. It currently:
- Creates attack plans with target coords + landing time + selected source villages
- Shows a chronological table with countdown timers and rally point links
- Has a Fakes tab for bulk fake attack generation
- Stores everything in localStorage (no backend)

**Data available per village**: id, name, x, y, owner, points (from `/map/village.txt`)
**Data NOT available without extra fetches**: troop counts, paladin, population

---

## Feature 1: New Columns in Village Selection Table

### Current state
The source village selection table has 4 columns: `[checkbox] | Village | Coords | Points`

### What to add

| Column | Source | Notes |
|--------|--------|-------|
| **Pop** | `village.txt` points field | Already available as `v.points`. This IS what TW shows as village points (correlates with population). Already shown but labeled "Points" - rename if needed, or clarify this IS population-based |
| **Army** | Fetch from `/game.php?screen=overview_villages&mode=combined&group=0` | Requires AJAX page scraping like tw-overview.js does. Parse total troop count per village |
| **Paladin** | Same overview fetch - check if knight column > 0 | Show Yes/No or checkmark. Also need "is home" vs "traveling" distinction (overview shows units at home vs total) |

### Implementation plan

**Step 1** - Add `fetchTroopOverview()` to tw-planner.js (reuse pattern from tw-overview.js)
- Fetch `/game.php?screen=overview_villages&mode=combined&type=own_home&page=N`
- Parse each row: village ID, per-unit counts (including knight)
- Store in a `villageTroops` map: `{ villageId: { total: N, knight: N, units: {...} } }`
- Cache in localStorage with 5-minute TTL

**Step 2** - Add a "Load Army Data" button near the village filter
- First load shows villages without army data (just name/coords/points)
- Click "Load Army Data" -> fetches all overview pages, populates army + paladin columns
- Show loading spinner during fetch

**Step 3** - Extend village table columns
```
[cb] | Village | Coords | Points | Army | Paladin
```
- Army: total troop count number. Color-code: green (>5000), yellow (1000-5000), red (<1000)
- Paladin: "Yes" (green) if knight >= 1 at home, "No" (red) if 0 or absent
- If army data not loaded yet, show "-" placeholder

**Step 4** - Add "Army" column to the attack results table too
- Show the source village's total army count next to the source name
- Helps identify which attacks come from strong vs weak villages

### Key decisions
- Army data requires multi-page AJAX scraping (~1 request per 20 villages, 200ms delay between)
- NOT auto-fetched on load (too slow for large accounts). Manual trigger via button.
- Paladin: "knight" unit in TW = paladin. Check `units.knight > 0` for "at home" detection
- The `type=own_home` parameter gives units currently in village (not traveling)

### Affected code
- `tw-planner.js`: `buildVillageRows()` (line 425), new `fetchTroopOverview()`, `renderAllPlans()` table headers

---

## Feature 2: Village Group Filtering (like TW Farm dropdown)

### Current state
Village filter is a simple text input that matches name/coords substrings. No group awareness.

### What to add
A dropdown selector above the village table that filters source villages by TW game group. Exactly like the TW Farm screenshot shows: "All villages", "Full NUKE", "LOW nuke", etc.

### Implementation plan

**Step 1** - Read village groups on init
```javascript
// Method 1: game_data.groups (global TW object)
if (typeof game_data !== 'undefined' && game_data.groups) {
  for (var gid in game_data.groups) {
    groups.push({ id: parseInt(gid, 10), name: game_data.groups[gid] });
  }
}
```
- Fallback: scrape group selector from overview page DOM (`#group_id` select element)
- Store groups in `plannerGroups` array

**Step 2** - Fetch group membership
- For each group, need to know which village IDs belong to it
- Approach: fetch `/game.php?screen=overview_villages&mode=combined&group=GROUP_ID&page=-1`
- Parse village IDs from the response
- Build a map: `groupVillages = { groupId: [villageId1, villageId2, ...] }`
- Cache with 10-minute TTL

**Step 3** - Add group dropdown UI
```html
<select id="twp-village-group">
  <option value="0">All villages</option>
  <option value="123">Full NUKE</option>
  <option value="456">LOW nuke</option>
  ...
</select>
```
- Place next to the existing text filter
- On change: filter village rows to only show villages in that group
- Combine with text filter: both filters apply simultaneously

**Step 4** - Filter logic
```javascript
function onFilterVillages() {
  var query = (textFilter).toLowerCase();
  var groupId = parseInt(groupDropdown.val(), 10);
  
  $('.twp-village-row').each(function() {
    var name = $(this).attr('data-name');
    var coords = $(this).attr('data-coords');
    var villageId = parseInt($(this).attr('data-village-id'), 10);
    
    var matchesText = !query || name.indexOf(query) !== -1 || coords.indexOf(query) !== -1;
    var matchesGroup = groupId === 0 || groupVillages[groupId].indexOf(villageId) !== -1;
    
    $(this).toggle(matchesText && matchesGroup);
  });
}
```

**Step 5** - Lazy-load group membership
- Don't fetch all groups on init (too many requests)
- When user selects a group for the first time, fetch that group's villages
- Cache per-group village lists
- "All villages" = no group filter (show all)

### Key decisions
- Group data from `game_data.groups` gives group names but NOT membership
- Membership requires fetching the overview page with `&group=GROUP_ID`
- Lazy-load: only fetch when user actually selects a group
- Both text + group filters apply simultaneously
- "Select all" checkbox still only affects visible (filtered) rows

### Affected code
- `tw-planner.js`: `buildPlanTab()` (line 318), `onFilterVillages()` (line 788), new `fetchGroupVillages()`
- `tw-planner.js`: `buildVillageRows()` - add `data-village-id` attribute to rows

---

## Feature 3: Edit Landing Time on Existing Plans

### Current state
Landing time is set once at plan creation. Cannot be changed afterward. To change it, must delete the plan and recreate it.

### What to add
- Click on a plan's landing time header to edit it
- All attack launch times in that plan recalculate automatically

### Implementation plan

**Step 1** - Make landing time in plan header editable
```javascript
// In renderAllPlans(), change the plan header to include edit controls
'<span class="twp-edit-landing" data-plan-idx="' + pi + '" ' +
  'style="cursor:pointer;text-decoration:underline;" title="Click to edit">' +
  landDisplay + landTimeDisplay + '</span>'
```

**Step 2** - Click handler shows inline edit form
```javascript
$container.on('click', '.twp-edit-landing', function() {
  var idx = $(this).data('plan-idx');
  var plan = plans[idx];
  // Replace text with input fields
  $(this).replaceWith(
    '<select class="twp-edit-day">...</select>' +
    '<input class="twp-edit-time" value="' + currentTime + '" />' +
    '<button class="twp-save-landing" data-plan-idx="' + idx + '">Save</button>' +
    '<button class="twp-cancel-landing">Cancel</button>'
  );
});
```

**Step 3** - Save handler recalculates all attacks
```javascript
$container.on('click', '.twp-save-landing', function() {
  var idx = $(this).data('plan-idx');
  var plan = plans[idx];
  var newLandingMs = parseNewLandingTime();
  
  // Update plan landing time
  plan.landingTimeMs = newLandingMs;
  plan.landingTomorrow = newLandingMs >= 86400000;
  
  // Recalculate each attack's launch time
  for (var a = 0; a < plan.attacks.length; a++) {
    var atk = plan.attacks[a];
    var travel = TWTools.DataFetcher.calcTravelTime(
      { x: atk.source.x, y: atk.source.y },
      TWTools.parseCoords(plan.targetCoords),
      atk.unitType
    );
    var launchMs = newLandingMs - travel;
    // TW ms mechanic
    var landMsComp = newLandingMs % 1000;
    var launchMsComp = ((launchMs % 1000) + 1000) % 1000;
    if (launchMsComp !== landMsComp) {
      launchMs = launchMs - launchMsComp + landMsComp;
    }
    atk.travelTimeMs = travel;
    atk.launchTimeMs = launchMs;
    atk.launchTomorrow = launchMs >= 86400000;
    atk.alerted = false; // Reset alert since time changed
  }
  
  // Re-sort attacks by launch time
  plan.attacks.sort(function(a, b) { return a.launchTimeMs - b.launchTimeMs; });
  
  savePlans();
  renderAllPlans();
  TWTools.UI.toast('Landing time updated, ' + plan.attacks.length + ' attacks recalculated', 'success');
});
```

### Key decisions
- Inline editing (click to edit) is the most intuitive UX
- Recalculating is straightforward: same formula as creation, just with new landing time
- Must reset `alerted` flag so alerts fire again for the new times
- Re-sort attacks after recalculation

### Affected code
- `tw-planner.js`: `renderAllPlans()` (line 526), new click handlers

---

## Feature 4: Single Attack Deletion (per-row)

### Current state
- Each plan (target) has an "X" button to delete the ENTIRE plan (all attacks on that target)
- "Clear All" button deletes everything
- No way to remove a single attack from a plan

### What to add
- A delete button (X or trash icon) on each attack row in the results table
- Clicking removes that single attack from its plan
- If the last attack in a plan is removed, the plan itself is removed too

### Implementation plan

**Step 1** - Add delete column to attack table
```javascript
// In the attack table header, add a new column
'<th style="width:20px;"></th>'

// In each row, add a delete button
'<td><span class="' + ID_PREFIX + 'del-attack" data-plan="' + entry.planIdx + 
  '" data-atk="' + entry.attackIdx + '" ' +
  'style="cursor:pointer;color:#a02020;font-size:11px;" title="Remove this attack">X</span></td>'
```

**Step 2** - Click handler
```javascript
$container.on('click', '.' + ID_PREFIX + 'del-attack', function() {
  var planIdx = parseInt($(this).data('plan'), 10);
  var atkIdx = parseInt($(this).data('atk'), 10);
  
  if (plans[planIdx]) {
    plans[planIdx].attacks.splice(atkIdx, 1);
    
    // If no attacks left, remove the entire plan
    if (plans[planIdx].attacks.length === 0) {
      plans.splice(planIdx, 1);
    }
    
    savePlans();
    renderAllPlans();
    TWTools.UI.toast('Attack removed', 'warning');
  }
});
```

### Key decisions
- Simple X button per row, same style as plan deletion
- Auto-remove empty plans (no attacks = no plan)
- No confirmation dialog (consistent with current plan deletion behavior)

### Affected code
- `tw-planner.js`: `renderAllPlans()` table structure (line 584-641), new click handler

---

## Feature 5: Sort Village List by Name

### Current state
Villages in the source selection table are listed in the order returned by `fetchPlayerVillages()`, which returns them from `village.txt` — essentially ordered by village ID (creation order), which loosely correlates with coordinates.

### What to add
Sort the source village list alphabetically by village name (A, B, C... or 1, 2, 3...).

### Implementation plan

**Step 1** - Sort playerVillages after fetch
```javascript
// In init(), after fetchPlayerVillages callback:
playerVillages = villages;
playerVillages.sort(function(a, b) {
  return (a.name || '').localeCompare(b.name || '');
});
```

That's it. One line of code. The `buildVillageRows()` function iterates `playerVillages` in order, so sorting the array sorts the table.

**Step 2** (optional) - Add sort toggle in the table header
```javascript
// Make the "Village" column header clickable to toggle sort
'<th class="twp-sort-header" data-sort="name" style="cursor:pointer;">Village &#9650;</th>' +
'<th class="twp-sort-header" data-sort="coords" style="cursor:pointer;">Coords</th>' +
'<th class="twp-sort-header" data-sort="points" style="cursor:pointer;">Points</th>'
```
- Click toggles between ascending/descending
- Active sort column gets arrow indicator

### Key decisions
- Default sort: alphabetical by name (ascending)
- `localeCompare()` handles mixed letter/number names naturally ("A1" < "A2" < "B1")
- Optional: clickable headers for multi-column sorting

### Affected code
- `tw-planner.js`: `init()` callback (line 267), optionally `buildVillageRows()` headers

---

## Feature 6: Review Fakes Section

### Current analysis

The Fakes tab works well for its purpose. Here's what it does and potential improvements:

**What works:**
- Target input (space-separated coords) 
- Player name lookup (loads player's villages via player.txt)
- Coordinate range filtering (min/max)
- Max distance filter
- Configurable spy + catapult counts
- Landing time (simultaneous or staggered)
- Rally point links

**Issues/improvements to consider:**

1. **Only 1 source per target** - Current algorithm picks the SINGLE nearest village. For mass fakes, you might want multiple fakes per target from different sources.

2. **No village group filter** - Can't limit source villages to a specific group (e.g., only send fakes from "defensive" villages). Should add the same group filter from Feature 2.

3. **No persistence** - Fake entries aren't saved to localStorage. Refreshing loses everything. Plans are saved, fakes are not.

4. **Source village reuse** - Same source village can be assigned to multiple targets. No option to "use each source once."

5. **No countdown/status** - Fakes table has no live countdown like the Plan tab does.

**Recommendations (scope this session):**
- Add village group filter to Fakes source selection (reuse Feature 2 code)
- Add fake persistence to localStorage (small change)
- Defer multi-source-per-target and countdown to a future version

---

## Feature 7: Review Settings Section

### Current analysis

Settings tab has 7 options + world info display. Analysis:

**What works:**
- Default unit type selector with speed display
- Fake spy/cat defaults
- Sound toggle + test button
- Alert timing (5-300s before launch)
- Auto-sort toggle
- Max distance for fakes
- World info (speed, unit factor, village count, player name)

**Missing/improvements:**

1. **No village group setting** - Should add default group filter (ties into Feature 2)

2. **No theme/size preferences** - Card size resets if localStorage cleared. Consider adding explicit width/height settings.

3. **No export/import settings** - Can't share settings between browsers or accounts.

4. **No "reset to defaults" button** - Only the save button exists.

5. **No keyboard shortcuts** - Could add hotkeys for common actions (e.g., Ctrl+Enter to add plan)

**Recommendations (scope this session):**
- Add default village group to settings (ties into Feature 2)
- Add "Reset to Defaults" button (trivial)
- Defer export/import and keyboard shortcuts

---

## Execution Order

Implement in this order to minimize conflicts and build on dependencies:

| # | Feature | Dependencies | Complexity |
|---|---------|-------------|------------|
| 1 | Sort village list by name | None | Trivial (1 line) |
| 2 | Single attack deletion | None | Small (~30 lines) |
| 3 | Edit landing time | None | Medium (~80 lines) |
| 4 | Village group filtering | None | Large (~150 lines) |
| 5 | New columns (army/paladin) | Feature 4 for village-id attr | Large (~200 lines) |
| 6 | Fakes improvements | Feature 4 for group filter reuse | Medium (~50 lines) |
| 7 | Settings improvements | Feature 4, 6 | Small (~30 lines) |

**Total estimated new/changed code**: ~540 lines in tw-planner.js

---

## Files Changed

| File | Changes |
|------|---------|
| `scripts/tw-planner.js` | All 7 features |
| `lib/tw-core.js` | None (all needed utilities already exist) |
| `lib/tw-ui.js` | None |

---

## Testing Plan

Since this is a browser script running inside the TW game:
1. Build with `node build.js`
2. Install in Tampermonkey/Greasemonkey
3. Test each feature on a live TW world
4. Verify localStorage persistence after page reload

### Test cases per feature:
- **F1 (Sort)**: Verify A-Z ordering in village table
- **F2 (Delete)**: Delete single attack, verify plan remains. Delete all attacks, verify plan auto-removed
- **F3 (Edit landing)**: Change landing time, verify all launch times recalculate correctly
- **F4 (Groups)**: Select a group, verify only that group's villages shown. Combine with text filter
- **F5 (Army/Paladin)**: Click "Load Army Data", verify columns populate. Check paladin Yes/No accuracy
- **F6 (Fakes)**: Verify group filter in fakes tab. Verify fake persistence across page reload
- **F7 (Settings)**: Verify default group setting. Test "Reset to Defaults"
