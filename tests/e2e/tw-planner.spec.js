// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');

const HARNESS_URL = 'file://' + path.resolve(__dirname, 'planner-test-harness.html');
const PREFIX = 'twp-';

/**
 * Wait for the planner card to fully initialize (villages loaded, UI rendered).
 */
async function waitForPlannerReady(page) {
  // Wait for the card to appear
  await page.waitForSelector('.twt-card', { timeout: 10000 });
  // Wait for village table to have rows
  await page.waitForSelector('.' + PREFIX + 'village-row', { timeout: 10000 });
}

test.describe('Attack Planner v2.0 — unit tests', () => {

  test.beforeEach(async ({ page }) => {
    // Clear localStorage to start fresh each test
    await page.goto(HARNESS_URL);
    await page.evaluate(() => {
      Object.keys(localStorage).forEach(k => {
        if (k.startsWith('twt_') || k.startsWith('twp_')) localStorage.removeItem(k);
      });
    });
    // Reload to get clean state
    await page.goto(HARNESS_URL);
    await waitForPlannerReady(page);
  });

  // ============================================================
  // FEATURE 1: Sort villages by name
  // ============================================================

  test('F1: Villages are sorted alphabetically by name', async ({ page }) => {
    const names = await page.$$eval('.' + PREFIX + 'village-row td:nth-child(2)', cells =>
      cells.map(c => c.textContent.trim())
    );

    expect(names.length).toBeGreaterThan(0);

    // Verify alphabetical order
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);

    // First village should start with 'A'
    expect(names[0]).toMatch(/^A /);
  });

  // ============================================================
  // FEATURE 2: Single attack deletion
  // ============================================================

  test('F2: Can delete individual attack from a plan', async ({ page }) => {
    // Create a plan with multiple attacks
    await page.fill('#' + PREFIX + 'target-coords', '500|500');
    await page.fill('#' + PREFIX + 'land-time', '20:00:00:000');

    // Select first 3 villages
    const checkboxes = await page.$$('.' + PREFIX + 'village-cb');
    await checkboxes[0].check();
    await checkboxes[1].check();
    await checkboxes[2].check();

    await page.click('#' + PREFIX + 'add-plan');

    // Verify 3 attacks created
    let rows = await page.$$('#' + PREFIX + 'attack-table tbody tr');
    expect(rows.length).toBe(3);

    // Delete the first attack (click X on first row)
    await page.click('.' + PREFIX + 'del-attack >> nth=0');

    // Now should be 2 attacks
    rows = await page.$$('#' + PREFIX + 'attack-table tbody tr');
    expect(rows.length).toBe(2);
  });

  test('F2: Deleting last attack removes the entire plan', async ({ page }) => {
    // Create a plan with 1 attack
    await page.fill('#' + PREFIX + 'target-coords', '500|500');
    await page.fill('#' + PREFIX + 'land-time', '20:00:00:000');

    const checkboxes = await page.$$('.' + PREFIX + 'village-cb');
    await checkboxes[0].check();

    await page.click('#' + PREFIX + 'add-plan');

    // Verify 1 attack exists
    let rows = await page.$$('#' + PREFIX + 'attack-table tbody tr');
    expect(rows.length).toBe(1);

    // Delete it
    await page.click('.' + PREFIX + 'del-attack');

    // Plan should be gone — no table should exist
    const table = await page.$('#' + PREFIX + 'attack-table');
    expect(table).toBeNull();

    // "No plans yet" message
    const container = await page.textContent('#' + PREFIX + 'plans-container');
    expect(container).toContain('No plans yet');
  });

  // ============================================================
  // FEATURE 3: Edit landing time
  // ============================================================

  test('F3: Can edit landing time and recalculate attacks', async ({ page }) => {
    // Create plan
    await page.fill('#' + PREFIX + 'target-coords', '480|480');
    await page.fill('#' + PREFIX + 'land-time', '18:00:00:000');

    const checkboxes = await page.$$('.' + PREFIX + 'village-cb');
    await checkboxes[0].check();
    await checkboxes[1].check();

    await page.click('#' + PREFIX + 'add-plan');

    // Get original launch times
    const originalLaunches = await page.$$eval('#' + PREFIX + 'attack-table tbody tr td:nth-child(6)',
      cells => cells.map(c => c.textContent.trim())
    );
    expect(originalLaunches.length).toBe(2);

    // Click on the landing time to edit
    await page.click('.' + PREFIX + 'edit-landing');

    // Verify edit form appeared
    await expect(page.locator('.' + PREFIX + 'edit-time')).toBeVisible();
    await expect(page.locator('.' + PREFIX + 'save-landing')).toBeVisible();

    // Change landing time to 22:00:00:000
    await page.fill('.' + PREFIX + 'edit-time', '22:00:00:000');
    await page.click('.' + PREFIX + 'save-landing');

    // Get new launch times — they should be different (4 hours later)
    const newLaunches = await page.$$eval('#' + PREFIX + 'attack-table tbody tr td:nth-child(6)',
      cells => cells.map(c => c.textContent.trim())
    );
    expect(newLaunches.length).toBe(2);
    expect(newLaunches).not.toEqual(originalLaunches);

    // Verify plan header shows new time
    const header = await page.textContent('.' + PREFIX + 'edit-landing');
    expect(header).toContain('22:00:00');
  });

  test('F3: Cancel edit restores original view', async ({ page }) => {
    // Create plan
    await page.fill('#' + PREFIX + 'target-coords', '480|480');
    await page.fill('#' + PREFIX + 'land-time', '18:00:00:000');
    const checkboxes = await page.$$('.' + PREFIX + 'village-cb');
    await checkboxes[0].check();
    await page.click('#' + PREFIX + 'add-plan');

    // Click edit
    await page.click('.' + PREFIX + 'edit-landing');
    await expect(page.locator('.' + PREFIX + 'edit-time')).toBeVisible();

    // Click cancel
    await page.click('.' + PREFIX + 'cancel-landing');

    // Edit form should be gone, original landing time restored
    await expect(page.locator('.' + PREFIX + 'edit-time')).not.toBeVisible();
    const header = await page.textContent('.' + PREFIX + 'edit-landing');
    expect(header).toContain('18:00:00');
  });

  // ============================================================
  // FEATURE 4: Village group filtering
  // ============================================================

  test('F4: Group dropdown is populated from game_data.groups', async ({ page }) => {
    const options = await page.$$eval('#' + PREFIX + 'village-group option', opts =>
      opts.map(o => ({ value: o.value, text: o.textContent.trim() }))
    );

    // Should have "All villages" + 4 groups
    expect(options.length).toBe(5);
    expect(options[0].text).toBe('All villages');
    expect(options[0].value).toBe('0');

    const groupNames = options.slice(1).map(o => o.text);
    expect(groupNames).toContain('Full NUKE');
    expect(groupNames).toContain('LOW nuke');
    expect(groupNames).toContain('Defensive');
    expect(groupNames).toContain('Fakes only');
  });

  test('F4: Selecting a group filters village rows', async ({ page }) => {
    // Start with all villages visible
    let visibleRows = await page.$$('.' + PREFIX + 'village-row:visible');
    expect(visibleRows.length).toBe(20);

    // Select "Full NUKE" group (id=10, has 5 villages)
    await page.selectOption('#' + PREFIX + 'village-group', '10');

    // Wait for AJAX fetch of group membership
    await page.waitForTimeout(500);

    visibleRows = await page.$$('.' + PREFIX + 'village-row:visible');
    expect(visibleRows.length).toBe(5);
  });

  test('F4: Group + text filter combine', async ({ page }) => {
    // Select "Full NUKE" group
    await page.selectOption('#' + PREFIX + 'village-group', '10');
    await page.waitForTimeout(500);

    let visibleRows = await page.$$('.' + PREFIX + 'village-row:visible');
    expect(visibleRows.length).toBe(5);

    // Now type in text filter to narrow further
    await page.fill('#' + PREFIX + 'village-filter', 'A Village');
    await page.waitForTimeout(100);

    // Only rows matching BOTH group AND text should show
    visibleRows = await page.$$('.' + PREFIX + 'village-row:visible');
    expect(visibleRows.length).toBeLessThan(5);
  });

  test('F4: "All villages" shows everything again', async ({ page }) => {
    // Filter by group
    await page.selectOption('#' + PREFIX + 'village-group', '10');
    await page.waitForTimeout(500);
    let visibleRows = await page.$$('.' + PREFIX + 'village-row:visible');
    expect(visibleRows.length).toBe(5);

    // Switch back to "All villages"
    await page.selectOption('#' + PREFIX + 'village-group', '0');
    await page.waitForTimeout(100);

    visibleRows = await page.$$('.' + PREFIX + 'village-row:visible');
    expect(visibleRows.length).toBe(20);
  });

  // ============================================================
  // FEATURE 5: Army + Paladin columns
  // ============================================================

  test('F5: Village table has Army and Pala columns', async ({ page }) => {
    const headers = await page.$$eval('#' + PREFIX + 'village-table thead th',
      ths => ths.map(th => th.textContent.trim())
    );

    expect(headers).toContain('Army');
    expect(headers).toContain('Pala');
  });

  test('F5: Army/Pala show "-" before loading', async ({ page }) => {
    const firstArmyCell = await page.textContent('.' + PREFIX + 'village-row:first-child td:nth-child(5)');
    const firstPalaCell = await page.textContent('.' + PREFIX + 'village-row:first-child td:nth-child(6)');

    expect(firstArmyCell.trim()).toBe('-');
    expect(firstPalaCell.trim()).toBe('-');
  });

  test('F5: Load Army button populates army data', async ({ page }) => {
    // Click "Load Army"
    await page.click('#' + PREFIX + 'load-army');

    // Wait for AJAX fetch
    await page.waitForTimeout(1000);

    // Army column should now have numbers
    const armyCells = await page.$$eval('.' + PREFIX + 'village-row td:nth-child(5)',
      cells => cells.map(c => c.textContent.trim())
    );

    // At least some should be numeric (not "-")
    const numericCount = armyCells.filter(c => c !== '-' && !isNaN(parseInt(c, 10))).length;
    expect(numericCount).toBeGreaterThan(0);

    // Paladin column should show Yes/No
    const palaCells = await page.$$eval('.' + PREFIX + 'village-row td:nth-child(6)',
      cells => cells.map(c => c.textContent.trim())
    );

    const hasYes = palaCells.some(c => c === 'Yes');
    const hasNo = palaCells.some(c => c === 'No');
    expect(hasYes || hasNo).toBe(true);
  });

  // ============================================================
  // FEATURE 6: Fakes improvements
  // ============================================================

  test('F6: Fakes tab has group filter dropdown', async ({ page }) => {
    // Switch to Fakes tab
    await page.click('.twt-card-tab[data-tab="fakes"]');

    const fakeGroupSelect = await page.$('#' + PREFIX + 'fake-group');
    expect(fakeGroupSelect).not.toBeNull();

    const options = await page.$$eval('#' + PREFIX + 'fake-group option', opts =>
      opts.map(o => o.textContent.trim())
    );
    expect(options).toContain('All villages');
    expect(options).toContain('Full NUKE');
  });

  test('F6: Generate fakes with targets', async ({ page }) => {
    // Switch to Fakes tab
    await page.click('.twt-card-tab[data-tab="fakes"]');

    // Enter target coords
    await page.fill('#' + PREFIX + 'fake-targets', '460|460 461|461 462|462');

    // Click generate
    await page.click('#' + PREFIX + 'gen-fakes');

    // Wait for generation
    await page.waitForTimeout(300);

    // Should have results table
    const resultRows = await page.$$('#' + PREFIX + 'fake-results table tbody tr');
    expect(resultRows.length).toBeGreaterThan(0);
  });

  test('F6: Fakes persist in localStorage', async ({ page }) => {
    // Switch to Fakes tab
    await page.click('.twt-card-tab[data-tab="fakes"]');

    // Generate fakes
    await page.fill('#' + PREFIX + 'fake-targets', '460|460 461|461');
    await page.click('#' + PREFIX + 'gen-fakes');
    await page.waitForTimeout(300);

    // Verify fakes exist
    let resultRows = await page.$$('#' + PREFIX + 'fake-results table tbody tr');
    expect(resultRows.length).toBeGreaterThan(0);

    // Check localStorage has fakes saved
    const hasFakes = await page.evaluate(() => {
      var raw = localStorage.getItem('twt_twp_fakes');
      return raw !== null && JSON.parse(raw).value.length > 0;
    });
    expect(hasFakes).toBe(true);

    // Reload page
    await page.goto(HARNESS_URL);
    await waitForPlannerReady(page);

    // Switch to Fakes tab
    await page.click('.twt-card-tab[data-tab="fakes"]');
    await page.waitForTimeout(300);

    // Fakes should still be rendered
    resultRows = await page.$$('#' + PREFIX + 'fake-results table tbody tr');
    expect(resultRows.length).toBeGreaterThan(0);
  });

  // ============================================================
  // FEATURE 7: Settings improvements
  // ============================================================

  test('F7: Settings tab has default group and reset button', async ({ page }) => {
    // Switch to Settings tab
    await page.click('.twt-card-tab[data-tab="settings"]');

    // Default group dropdown exists
    const groupSelect = await page.$('#' + PREFIX + 'set-group');
    expect(groupSelect).not.toBeNull();

    // Reset button exists
    const resetBtn = await page.$('#' + PREFIX + 'reset-settings');
    expect(resetBtn).not.toBeNull();
  });

  test('F7: Save settings persists to localStorage', async ({ page }) => {
    // Switch to Settings tab
    await page.click('.twt-card-tab[data-tab="settings"]');

    // Change default unit to 'snob'
    await page.selectOption('#' + PREFIX + 'set-unit', 'snob');

    // Change alert seconds
    await page.fill('#' + PREFIX + 'set-alert-sec', '60');

    // Save
    await page.click('#' + PREFIX + 'save-settings');

    // Verify localStorage
    const settings = await page.evaluate(() => {
      var raw = localStorage.getItem('twt_twp_settings');
      return raw ? JSON.parse(raw).value : null;
    });

    expect(settings).not.toBeNull();
    expect(settings.defaultUnit).toBe('snob');
    expect(settings.alertSeconds).toBe(60);
  });

  test('F7: Reset settings restores defaults', async ({ page }) => {
    // Switch to Settings tab
    await page.click('.twt-card-tab[data-tab="settings"]');

    // Change a setting
    await page.selectOption('#' + PREFIX + 'set-unit', 'snob');
    await page.click('#' + PREFIX + 'save-settings');

    // Reset
    await page.click('#' + PREFIX + 'reset-settings');

    // Verify unit is back to 'ram'
    const unitValue = await page.$eval('#' + PREFIX + 'set-unit', el => el.value);
    expect(unitValue).toBe('ram');

    // Verify localStorage was updated
    const settings = await page.evaluate(() => {
      var raw = localStorage.getItem('twt_twp_settings');
      return raw ? JSON.parse(raw).value : null;
    });
    expect(settings.defaultUnit).toBe('ram');
  });

  // ============================================================
  // INTEGRATION: Full workflow
  // ============================================================

  test('Integration: Create plan, edit landing, delete single attack, verify persistence', async ({ page }) => {
    // Step 1: Create plan with 4 attacks
    await page.fill('#' + PREFIX + 'target-coords', '470|470');
    await page.fill('#' + PREFIX + 'land-time', '19:30:00:000');

    const checkboxes = await page.$$('.' + PREFIX + 'village-cb');
    await checkboxes[0].check();
    await checkboxes[1].check();
    await checkboxes[2].check();
    await checkboxes[3].check();

    await page.click('#' + PREFIX + 'add-plan');

    let rows = await page.$$('#' + PREFIX + 'attack-table tbody tr');
    expect(rows.length).toBe(4);

    // Step 2: Edit landing time
    await page.click('.' + PREFIX + 'edit-landing');
    await page.fill('.' + PREFIX + 'edit-time', '21:00:00:000');
    await page.click('.' + PREFIX + 'save-landing');

    // Verify still 4 attacks
    rows = await page.$$('#' + PREFIX + 'attack-table tbody tr');
    expect(rows.length).toBe(4);

    // Verify new landing time in header
    const header = await page.textContent('.' + PREFIX + 'edit-landing');
    expect(header).toContain('21:00:00');

    // Step 3: Delete 2 attacks
    await page.click('.' + PREFIX + 'del-attack >> nth=0');
    rows = await page.$$('#' + PREFIX + 'attack-table tbody tr');
    expect(rows.length).toBe(3);

    await page.click('.' + PREFIX + 'del-attack >> nth=0');
    rows = await page.$$('#' + PREFIX + 'attack-table tbody tr');
    expect(rows.length).toBe(2);

    // Step 4: Reload and verify persistence
    await page.goto(HARNESS_URL);
    await waitForPlannerReady(page);

    rows = await page.$$('#' + PREFIX + 'attack-table tbody tr');
    expect(rows.length).toBe(2);
  });

  test('Integration: Select all in group, create plan', async ({ page }) => {
    // Select "LOW nuke" group
    await page.selectOption('#' + PREFIX + 'village-group', '20');
    await page.waitForTimeout(500);

    // Select all visible
    await page.check('#' + PREFIX + 'select-all');

    // Verify only 5 checkboxes are checked
    const checkedCount = await page.$$eval(
      '.' + PREFIX + 'village-row:visible .' + PREFIX + 'village-cb:checked',
      cbs => cbs.length
    );
    expect(checkedCount).toBe(5);

    // Create plan
    await page.fill('#' + PREFIX + 'target-coords', '490|490');
    await page.fill('#' + PREFIX + 'land-time', '15:00:00:000');
    await page.click('#' + PREFIX + 'add-plan');

    // Should have 5 attacks (only from LOW nuke group)
    const rows = await page.$$('#' + PREFIX + 'attack-table tbody tr');
    expect(rows.length).toBe(5);
  });

  test('Integration: BBCode export shows success toast', async ({ page }) => {
    // Create plan
    await page.fill('#' + PREFIX + 'target-coords', '500|500');
    await page.fill('#' + PREFIX + 'land-time', '20:00:00:000');
    const checkboxes = await page.$$('.' + PREFIX + 'village-cb');
    await checkboxes[0].check();
    await page.click('#' + PREFIX + 'add-plan');

    // Export BBCode — clipboard may not work in test context but toast should fire
    await page.click('#' + PREFIX + 'export-bbcode');
    await page.waitForTimeout(200);

    // Verify success toast appeared
    const toasts = await page.$$eval('.test-toast.success', els =>
      els.map(e => e.textContent)
    );
    const hasBBCodeToast = toasts.some(t => t.includes('BBCode') || t.includes('clipboard'));
    expect(hasBBCodeToast).toBe(true);
  });

  test('Integration: Clear all removes everything', async ({ page }) => {
    // Create 2 plans
    await page.fill('#' + PREFIX + 'target-coords', '500|500');
    await page.fill('#' + PREFIX + 'land-time', '20:00:00:000');
    const checkboxes = await page.$$('.' + PREFIX + 'village-cb');
    await checkboxes[0].check();
    await page.click('#' + PREFIX + 'add-plan');

    await checkboxes[0].uncheck();
    await page.fill('#' + PREFIX + 'target-coords', '501|501');
    await checkboxes[1].check();
    await page.click('#' + PREFIX + 'add-plan');

    let rows = await page.$$('#' + PREFIX + 'attack-table tbody tr');
    expect(rows.length).toBe(2);

    // Clear all
    await page.click('#' + PREFIX + 'clear-plans');

    const container = await page.textContent('#' + PREFIX + 'plans-container');
    expect(container).toContain('No plans yet');
  });
});
