# Node-Compat Envelope Contract (pure libs)

**Status:** Contract (docs only — does NOT edit any lib).
**Applies to:** `lib/tw-overview-core.js`, `lib/tw-table.js`, `lib/tw-config-core.js` (the NEW pure libs).
**Why:** the bundled browser source must ALSO be `require()`-able by `node:test`, with no second hand-mirror
file (avoids the drift seen in the user's other scripts). One file, two runtimes.

## The four parts every pure lib must use

### HEAD
```js
;(function (root, $) {
  'use strict';
  var TWTools = root.TWTools || (root.TWTools = {});
```
Reuses `window.TWTools` in the browser; creates a namespace on `globalThis` under node.

### BODY rules
- Define pure functions first (no DOM / no `$` / no `window` at module top level — only inside
  explicitly browser-gated branches).
- Attach the browser surface **only if absent** (idempotent, matching `tw-core.js` lines ~1031-1056):
  ```js
  TWTools.OverviewCore = TWTools.OverviewCore || OverviewCore; // / Table / Config
  ```
- **HARD RULE:** any DOM/jQuery/`$.ajax` work lives in `tw-core` / `tw-ui` / `tw-commands`, or in a
  DOM layer that takes `$`/`document` as injected params and early-returns when absent. The pure
  layer must `require()` cleanly under node (no bare `window`/`document`/`$` references at load time).
- Do **not** copy the throw-if-`!TWTools` guard from `tw-ui.js`/`tw-commands.js` — that would crash
  `node:test`. Use a non-throwing guard and only attach DOM behavior when `root.document` exists.

### TAIL (immediately before the IIFE close)
```js
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = OverviewCore; // / Table (with .pure) / Config — the testable API
  }
```
This survives terser (the free identifier `module` is unprovable at bundle scope, so it is NOT
dead-stripped) but is **inert in-browser** because `typeof module === 'undefined'`. Correctness
relies on the runtime `typeof` guard, never on dead-code elimination.

### CALL SITE
```js
})(
  typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this),
  typeof jQuery !== 'undefined' ? jQuery : undefined
);
```

## Verification ritual
1. `node -e "require('./lib/tw-overview-core.js')"` exits 0 (no DOM access at load).
2. `node build.js --only=tw-overview` succeeds; the lib is concatenated in load order.
3. `npm test` runs the node:test specs against the bundled source.
4. dist invariant: assert the **browser token** is present in `dist/tw-overview.min.js`
   (e.g. `OverviewCore`), **NOT** that `module.exports` is absent (terser keeps the guarded branch).

## Load order (canonical, set once in build.js SCRIPT_LIBS)
`tw-core.js → tw-ui.js → tw-commands.js → tw-overview-core.js → tw-config-core.js → tw-table.js`
(`tw-table` consumes `tw-overview-core`'s registry/predicates/comparators; `tw-config-core` before `tw-table`.)
