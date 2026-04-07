;(function(window, $) {
  'use strict';

  // ============================================================
  // TW MASS SCAVENGE v3.0.0
  // ============================================================
  // Mass scavenging script for Tribal Wars.
  // Calculates optimal troop distribution across scavenge tiers.
  // Click-through sending: 1 click = 1 POST (TW rule compliant).
  // Training: suggest-only — shows direct links, no auto-POST.
  //
  // REQUIRES: window.TWTools (tw-core.js)
  // ============================================================

  var VERSION = '3.0.0';
  var ID_PREFIX = 'twsc-';
  var STORAGE_PREFIX = 'twsc_';

  // ============================================================
  // CONSTANTS
  // ============================================================

  /**
   * Carry capacity per unit type (resources per unit).
   * @type {Object.<string, number>}
   */
  var UNIT_HAUL = {
    spear: 25,
    sword: 15,
    axe: 10,
    archer: 10,
    light: 80,
    heavy: 50,
    marcher: 50
  };

  /**
   * All scavengeable unit types in display order.
   * @type {string[]}
   */
  var ALL_UNIT_TYPES = ['spear', 'sword', 'axe', 'archer', 'light', 'heavy', 'marcher'];

  /**
   * Default scavenge tier parameters (from game defaults).
   * Each tier has: duration_initial_seconds, duration_factor, duration_exponent, loot_factor.
   * Real values are read from the page when available.
   * @type {Object[]}
   */
  var DEFAULT_TIER_PARAMS = [
    { tier: 1, duration_initial_seconds: 1800, duration_factor: 1, duration_exponent: 0.45, loot_factor: 0.10 },
    { tier: 2, duration_initial_seconds: 1800, duration_factor: 1, duration_exponent: 0.45, loot_factor: 0.25 },
    { tier: 3, duration_initial_seconds: 1800, duration_factor: 1, duration_exponent: 0.45, loot_factor: 0.50 },
    { tier: 4, duration_initial_seconds: 1800, duration_factor: 1, duration_exponent: 0.45, loot_factor: 0.75 }
  ];

  // ============================================================
  // STORAGE (wraps TWTools.Storage with local prefix)
  // ============================================================

  var Store = {
    /**
     * Get a setting value from localStorage.
     * @param {string} key - Setting key.
     * @param {*} fallback - Default value.
     * @returns {*} Stored or default value.
     */
    get: function(key, fallback) {
      var val = TWTools.Storage.get(STORAGE_PREFIX + key);
      return val !== null ? val : fallback;
    },

    /**
     * Set a setting value in localStorage (no TTL — permanent).
     * @param {string} key - Setting key.
     * @param {*} value - Value to persist.
     */
    set: function(key, value) {
      TWTools.Storage.set(STORAGE_PREFIX + key, value);
    }
  };

  // ============================================================
  // SETTINGS STATE
  // ============================================================

  /**
   * Loads and persists all user preferences.
   */
  var Settings = {
    /** @type {string[]} Selected unit types for scavenging. */
    unitTypes: [],

    /** @type {Object.<string, number>} Global minimum troops to keep per type. */
    keepHome: {},

    /** @type {Object.<number, Object.<string, number>>} Per-village keep-home overrides keyed by village ID. */
    keepHomePerVillage: {},

    /** @type {number[]} Tier priority order (1-indexed). */
    tierPriority: [4, 3, 2, 1],

    /** @type {number} Default scavenge duration in seconds. */
    defaultDuration: 8 * 3600,

    /** @type {string} Default village group ID. */
    defaultGroup: '0',

    /** @type {string} Distribution mode: 'balanced' or 'priority'. */
    distributionMode: 'balanced',

    /** @type {boolean[]} Selected tiers (0-indexed, tier 1-4). */
    selectedTiers: [true, true, true, true],

    /** @type {number} Target spear count per village. */
    trainTargetSpear: 3000,

    /** @type {number} Target light cavalry count per village. */
    trainTargetLC: 1500,

    load: function() {
      this.unitTypes = Store.get('unitTypes', ['spear', 'sword', 'axe', 'light']);
      this.keepHome = Store.get('keepHome', {});
      this.keepHomePerVillage = Store.get('keepHomePerVillage', {});
      this.tierPriority = Store.get('tierPriority', [4, 3, 2, 1]);
      this.defaultDuration = Store.get('defaultDuration', 8 * 3600);
      this.defaultGroup = Store.get('defaultGroup', '0');
      this.distributionMode = Store.get('distributionMode', 'balanced');
      this.selectedTiers = Store.get('selectedTiers', [true, true, true, true]);
      this.trainTargetSpear = Store.get('trainTargetSpear', 3000);
      this.trainTargetLC = Store.get('trainTargetLC', 1500);
    },

    save: function() {
      Store.set('unitTypes', this.unitTypes);
      Store.set('keepHome', this.keepHome);
      Store.set('keepHomePerVillage', this.keepHomePerVillage);
      Store.set('tierPriority', this.tierPriority);
      Store.set('defaultDuration', this.defaultDuration);
      Store.set('defaultGroup', this.defaultGroup);
      Store.set('distributionMode', this.distributionMode);
      Store.set('selectedTiers', this.selectedTiers);
      Store.set('trainTargetSpear', this.trainTargetSpear);
      Store.set('trainTargetLC', this.trainTargetLC);
    },

    /**
     * Get keep-home amount for a unit type in a village.
     * Per-village overrides global setting.
     * @param {number} villageId - Village ID.
     * @param {string} unitType - Unit type name.
     * @returns {number} Minimum troops to reserve.
     */
    getKeepHome: function(villageId, unitType) {
      var perVillage = this.keepHomePerVillage[villageId];
      if (perVillage && typeof perVillage[unitType] === 'number') {
        return perVillage[unitType];
      }
      return this.keepHome[unitType] || 0;
    }
  };

  // ============================================================
  // SCAVENGE DATA PARSER
  // ============================================================

  /**
   * Parses scavenge data from the mass scavenge page DOM.
   */
  var ScavengeParser = {
    /**
     * Check if current page is the mass scavenge page.
     * @returns {boolean} True if on mass scavenge page.
     */
    isOnMassScavengePage: function() {
      if (typeof game_data === 'undefined') return false;
      // game_data.mode can be null even on scavenge_mass page — check URL instead
      return game_data.screen === 'place' &&
        window.location.href.indexOf('mode=scavenge_mass') !== -1;
    },

    /**
     * Read village groups from the group selector dropdown on the page.
     * Falls back to parsing the overview page group selector.
     * @returns {Array.<{id: string, name: string}>} Village groups.
     */
    readGroups: function() {
      var groups = [{ id: '0', name: 'All villages' }];

      // Method 1: Parse group links from mass scavenge page
      // Groups are <a> links like [Plny utok] with href containing scavenge_mass&group=NNNN
      $('a[href*="scavenge_mass"]').each(function() {
        var $a = $(this);
        var href = $a.attr('href') || '';
        var match = href.match(/group=(\d+)/);
        if (match) {
          groups.push({
            id: match[1],
            name: $a.text().trim().replace(/^\[|\]$/g, '') // Remove brackets
          });
        }
      });
      if (groups.length > 1) return groups;

      // Method 2: Try the standard group selector dropdown
      var $select = $('#group_id');
      if ($select.length === 0) {
        $select = $('select[name="group_id"]');
      }
      if ($select.length > 0) {
        $select.find('option').each(function() {
          groups.push({
            id: $(this).val(),
            name: $(this).text().trim()
          });
        });
      }
      if (groups.length > 1) return groups;

      // Method 3: Try group menu links with data attributes
      $('#group_table a[data-group-id], .group-menu-item a').each(function() {
        var $a = $(this);
        var gid = $a.data('group-id') || $a.attr('data-group-id');
        if (gid !== undefined) {
          groups.push({
            id: String(gid),
            name: $a.text().trim()
          });
        }
      });

      return groups;
    },

    /**
     * Read tier parameters from the page's scavenge config.
     * Looks for ScavengeScreen data or data attributes in DOM.
     * @returns {Object[]} Tier parameter objects.
     */
    readTierParams: function() {
      // Method 1: Read from ScavengeScreen.village.options (single village scavenge page)
      // Structure: ScavengeScreen.village.options = { "1": { base: { duration_factor, ... } }, ... }
      if (typeof ScavengeScreen !== 'undefined' && ScavengeScreen.village && ScavengeScreen.village.options) {
        var opts = ScavengeScreen.village.options;
        var params = [];
        for (var tierNum = 1; tierNum <= 4; tierNum++) {
          var opt = opts[String(tierNum)];
          if (opt && opt.base) {
            var b = opt.base;
            params.push({
              tier: tierNum,
              duration_initial_seconds: b.duration_initial_seconds || DEFAULT_TIER_PARAMS[tierNum - 1].duration_initial_seconds,
              duration_factor: b.duration_factor || DEFAULT_TIER_PARAMS[tierNum - 1].duration_factor,
              duration_exponent: b.duration_exponent || DEFAULT_TIER_PARAMS[tierNum - 1].duration_exponent,
              loot_factor: b.loot_factor || DEFAULT_TIER_PARAMS[tierNum - 1].loot_factor
            });
          } else {
            params.push(DEFAULT_TIER_PARAMS[tierNum - 1]);
          }
        }
        if (params.length > 0) return params;
      }

      // Method 2: Try ScavengeScreen.options as array (legacy format)
      if (typeof ScavengeScreen !== 'undefined' && ScavengeScreen.options) {
        var arr = ScavengeScreen.options;
        if (arr.length) {
          return arr.map(function(opt, idx) {
            return {
              tier: idx + 1,
              duration_initial_seconds: opt.duration_initial_seconds || DEFAULT_TIER_PARAMS[idx].duration_initial_seconds,
              duration_factor: opt.duration_factor || DEFAULT_TIER_PARAMS[idx].duration_factor,
              duration_exponent: opt.duration_exponent || DEFAULT_TIER_PARAMS[idx].duration_exponent,
              loot_factor: opt.loot_factor || DEFAULT_TIER_PARAMS[idx].loot_factor
            };
          });
        }
      }

      // Method 3: Try global Scavenge config
      if (typeof Scavenge !== 'undefined' && Scavenge.data && Scavenge.data.options) {
        var data = Scavenge.data.options;
        if (data.length) {
          return data.map(function(d, idx) {
            return {
              tier: idx + 1,
              duration_initial_seconds: d.duration_initial_seconds || DEFAULT_TIER_PARAMS[idx].duration_initial_seconds,
              duration_factor: d.duration_factor || DEFAULT_TIER_PARAMS[idx].duration_factor,
              duration_exponent: d.duration_exponent || DEFAULT_TIER_PARAMS[idx].duration_exponent,
              loot_factor: d.loot_factor || DEFAULT_TIER_PARAMS[idx].loot_factor
            };
          });
        }
      }

      return DEFAULT_TIER_PARAMS;
    },

    /**
     * Parse village rows from the mass scavenge page.
     * Each row contains: village name/coords, troop counts, unlocked tiers, scavenge status.
     * @param {string} [groupId] - Village group ID to filter (unused on mass page, group changes page).
     * @returns {Array.<Object>} Village data array.
     */
    parseVillageRows: function(groupId) {
      var villages = [];

      // Method 1: Find village rows by links to individual scavenge pages
      // Each village row has an <a> with href containing screen=place&mode=scavenge (NOT scavenge_mass)
      $('a[href*="screen=place"][href*="mode=scavenge"]').each(function() {
        var $a = $(this);
        var href = $a.attr('href') || '';

        // Skip navigation links that point to scavenge_mass (the mass page itself)
        if (href.indexOf('scavenge_mass') !== -1) return;

        var text = $a.text().trim();
        var coords = TWTools.parseCoords(text);
        if (!coords) return;

        var villageId = 0;
        var villageMatch = href.match(/village=(\d+)/);
        if (villageMatch) villageId = parseInt(villageMatch[1], 10);

        var villageName = text.replace(/\s*\(\d+\|\d+\)\s*K\d+\s*$/, '').trim();

        // Get the table row this link is in
        var $row = $a.closest('tr');
        if ($row.length === 0) return;

        // Parse tier cells from the row.
        // Real DOM: each tier is <td class="option option-N option-inactive|option-locked|option-active" data-id="N">
        // All cells contain ALL images (lock_mini, unlock_mini, report_scavenging, block_icon) —
        // visibility is controlled via CSS classes (status-active, status-inactive, status-locked, etc.).
        // The cell CLASS is the authoritative source for tier status:
        //   option-inactive = idle/unlocked (no squad sent)
        //   option-active   = running (squad sent, timer counting)
        //   option-locked   = locked (not yet unlocked by player)
        var unlockedTiers = [];
        var runningTiers = 0;
        $row.find('td.option[data-id]').each(function() {
          var $cell = $(this);
          var tierNum = parseInt($cell.attr('data-id'), 10);
          if (!tierNum) return;

          if ($cell.hasClass('option-locked')) {
            // Locked tier — skip
            return;
          }
          // Tier is unlocked (either idle or running)
          unlockedTiers.push(tierNum);
          if ($cell.hasClass('option-active')) {
            runningTiers++;
          }
        });

        // Fallback: if no td.option[data-id] cells found, try legacy checkbox approach
        if ($row.find('td.option[data-id]').length === 0) {
          var $cells = $row.find('td');
          var tierIndex = 0;
          $cells.each(function(idx) {
            if (idx === 0) return;
            var $cell = $(this);
            var $cb = $cell.find('input[type="checkbox"]');
            if ($cb.length) {
              tierIndex++;
              if (!$cb.prop('disabled')) {
                unlockedTiers.push(tierIndex);
              }
            }
          });
        }

        // Determine status: if any tier shows a running image, village is scavenging
        var status = runningTiers > 0 ? 'running' : 'idle';

        villages.push({
          id: villageId,
          name: villageName,
          coords: coords,
          troops: {}, // Troop data fetched separately via fetchTroopCounts
          unlockedTiers: unlockedTiers.length > 0 ? unlockedTiers : [1, 2, 3, 4],
          status: status,
          checked: false
        });
      });

      if (villages.length > 0) return villages;

      // Method 2: Try legacy table format with th containing Village/Dedina/Dorf
      var $table = $('table.vis').filter(function() {
        var text = $(this).find('th').text().toLowerCase();
        return text.indexOf('village') !== -1 || text.indexOf('dedina') !== -1 || text.indexOf('dorf') !== -1;
      });

      if ($table.length > 0) {
        $table.find('tbody tr').each(function() {
          var $row = $(this);
          var $cells = $row.find('td');
          if ($cells.length < 3) return;

          var village = ScavengeParser._parseVillageRow($row, $cells);
          if (village) villages.push(village);
        });
      }

      if (villages.length > 0) return villages;

      // Method 3: Parse from ScavengeMassScreen JavaScript object (if exists)
      if (typeof ScavengeMassScreen !== 'undefined') {
        var screenData = ScavengeMassScreen.villages || ScavengeMassScreen.data || [];
        for (var i = 0; i < screenData.length; i++) {
          var d = screenData[i];
          villages.push(ScavengeParser._normalizeVillageData(d));
        }
      }

      // Method 4: Parse village data from Scavenge global (if exists)
      if (villages.length === 0 && typeof Scavenge !== 'undefined' && Scavenge.village) {
        villages.push(ScavengeParser._normalizeVillageData(Scavenge.village));
      }

      return villages;
    },

    /**
     * Parse a single village row from the DOM table.
     * @private
     * @param {jQuery} $row - Table row element.
     * @param {jQuery} $cells - TD cells in the row.
     * @returns {?Object} Parsed village data or null.
     */
    _parseVillageRow: function($row, $cells) {
      var nameCell = $cells.eq(0);
      var nameText = nameCell.text().trim();
      var coords = TWTools.parseCoords(nameText);
      if (!coords) return null;

      var $link = nameCell.find('a[href*="village="]');
      var villageId = 0;
      if ($link.length > 0) {
        var href = $link.attr('href') || '';
        var idMatch = href.match(/village=(\d+)/);
        if (idMatch) villageId = parseInt(idMatch[1], 10);
      }

      // Parse troop counts — look for unit input fields or text
      var troops = {};
      ALL_UNIT_TYPES.forEach(function(unit) {
        var $input = $row.find('input[name*="' + unit + '"], .unit-' + unit + ', [data-unit="' + unit + '"]');
        if ($input.length > 0) {
          troops[unit] = parseInt($input.val() || $input.text() || $input.data('available') || '0', 10) || 0;
        } else {
          // Try finding by column class or data attribute
          var $unitCell = $row.find('td.' + unit + ', td[data-unit="' + unit + '"]');
          if ($unitCell.length > 0) {
            troops[unit] = parseInt($unitCell.text().trim(), 10) || 0;
          }
        }
      });

      // Parse unlocked tiers
      var unlockedTiers = [];
      $row.find('.scavenge-option, [data-tier]').each(function() {
        var tier = parseInt($(this).data('tier') || $(this).data('option'), 10);
        if (tier && !$(this).hasClass('locked') && !$(this).hasClass('disabled')) {
          unlockedTiers.push(tier);
        }
      });
      // Default: if we can't detect, assume all 4
      if (unlockedTiers.length === 0) unlockedTiers = [1, 2, 3, 4];

      // Check scavenge status
      var status = 'idle';
      if ($row.hasClass('scavenging') || $row.find('.scavenge-running, .returning').length > 0) {
        status = 'running';
      }

      return {
        id: villageId,
        name: nameText.replace(/\s*\(\d+\|\d+\)\s*$/, '').trim(),
        coords: coords,
        troops: troops,
        unlockedTiers: unlockedTiers,
        status: status,
        checked: false
      };
    },

    /**
     * Normalize village data from JavaScript objects.
     * @private
     * @param {Object} d - Raw village data.
     * @returns {Object} Normalized village data.
     */
    _normalizeVillageData: function(d) {
      var troops = {};
      ALL_UNIT_TYPES.forEach(function(unit) {
        troops[unit] = parseInt(d[unit] || (d.units && d.units[unit]) || 0, 10) || 0;
      });

      var coords = d.coord ? TWTools.parseCoords(d.coord) :
                   (d.x && d.y ? { x: d.x, y: d.y } : { x: 0, y: 0 });

      return {
        id: d.village_id || d.id || 0,
        name: d.name || d.village_name || '',
        coords: coords,
        troops: troops,
        unlockedTiers: d.unlocked_tiers || d.unlockedTiers || [1, 2, 3, 4],
        status: d.scavenging ? 'running' : 'idle',
        checked: false
      };
    },

    /**
     * Fetch scavenge data for villages via AJAX when not on mass page.
     * @param {string} groupId - Village group ID.
     * @param {function(Array)} callback - Called with village data array.
     */
    fetchVillageData: function(groupId, callback) {
      // Try AJAX fetch of mass scavenge page
      var url = '/game.php?village=' + TWTools.getVillageId() +
                '&screen=place&mode=scavenge_mass';
      if (groupId && groupId !== '0') {
        url += '&group=' + groupId;
      }

      $.ajax({
        url: url,
        dataType: 'html',
        success: function(html) {
          var $doc = $('<div>').html(html);
          var villages = [];

          // Parse village links from the fetched page (same approach as parseVillageRows)
          $doc.find('a[href*="screen=place"][href*="mode=scavenge"]').each(function() {
            var $a = $(this);
            var href = $a.attr('href') || '';
            if (href.indexOf('scavenge_mass') !== -1) return;

            var text = $a.text().trim();
            var coords = TWTools.parseCoords(text);
            if (!coords) return;

            var villageId = 0;
            var villageMatch = href.match(/village=(\d+)/);
            if (villageMatch) villageId = parseInt(villageMatch[1], 10);

            var villageName = text.replace(/\s*\(\d+\|\d+\)\s*K\d+\s*$/, '').trim();
            var $row = $a.closest('tr');

            var unlockedTiers = [];
            if ($row.length > 0) {
              // Use td.option[data-id] cells — same approach as parseVillageRows
              $row.find('td.option[data-id]').each(function() {
                var $cell = $(this);
                var tierNum = parseInt($cell.attr('data-id'), 10);
                if (!tierNum) return;
                if (!$cell.hasClass('option-locked')) {
                  unlockedTiers.push(tierNum);
                }
              });
              // Fallback for legacy format
              if ($row.find('td.option[data-id]').length === 0) {
                var tierIndex = 0;
                $row.find('td').each(function(idx) {
                  if (idx === 0) return;
                  var $cell = $(this);
                  var $cb = $cell.find('input[type="checkbox"]');
                  if ($cb.length) {
                    tierIndex++;
                    if (!$cb.prop('disabled')) {
                      unlockedTiers.push(tierIndex);
                    }
                  }
                });
              }
            }

            villages.push({
              id: villageId,
              name: villageName,
              coords: coords,
              troops: {},
              unlockedTiers: unlockedTiers.length > 0 ? unlockedTiers : [1, 2, 3, 4],
              status: 'idle',
              checked: false
            });
          });

          // Fallback: try legacy table parsing
          if (villages.length === 0) {
            $doc.find('table.vis tbody tr').each(function() {
              var $row = $(this);
              var $cells = $row.find('td');
              if ($cells.length < 3) return;

              var village = ScavengeParser._parseVillageRow($row, $cells);
              if (village) villages.push(village);
            });
          }

          callback(villages);
        },
        error: function() {
          callback([]);
        }
      });
    },

    /**
     * Fetch troop counts for all villages from the troops overview page.
     * Primary source: /game.php?village={id}&screen=overview_villages&mode=units&type=own_home
     * This page shows a table with ALL villages and their home troops in a single request.
     *
     * @param {Array.<Object>} villages - Village objects (need .id populated).
     * @param {function(Object.<number, Object.<string, number>>)} callback -
     *   Called with a map of { villageId: { spear: N, sword: N, ... } }.
     */
    fetchTroopCounts: function(villages, callback) {
      if (!villages || villages.length === 0) {
        callback({});
        return;
      }

      var url = '/game.php?village=' + TWTools.getVillageId() +
                '&screen=overview_villages&mode=units&type=own_home';

      $.ajax({
        url: url,
        dataType: 'html',
        success: function(html) {
          var troopMap = ScavengeParser._parseTroopOverviewPage(html);

          // Check if we actually got data for any villages
          var hasData = false;
          for (var key in troopMap) {
            if (troopMap.hasOwnProperty(key)) {
              hasData = true;
              break;
            }
          }

          if (hasData) {
            callback(troopMap);
          } else {
            // Fallback: fetch individual village scavenge pages
            ScavengeParser._fetchTroopsFallback(villages, callback);
          }
        },
        error: function() {
          // Fallback: fetch individual village scavenge pages
          ScavengeParser._fetchTroopsFallback(villages, callback);
        }
      });
    },

    /**
     * Parse the troops overview page HTML to extract troop counts per village.
     * The overview table has unit type headers (images with unit_sprite classes or
     * text/alt attributes) and one row per village with counts.
     *
     * @private
     * @param {string} html - Raw HTML of the overview page.
     * @returns {Object.<number, Object.<string, number>>} Map of villageId -> troops.
     */
    _parseTroopOverviewPage: function(html) {
      var troopMap = {};
      var $doc = $('<div>').html(html);

      // Find the units table — it contains unit header images
      var $table = $doc.find('table#units_table');
      if ($table.length === 0) {
        // Fallback: find table with unit sprite images in headers
        $table = $doc.find('table').filter(function() {
          return $(this).find('th img[src*="unit_"], th .unit_sprite, th img[class*="unit_"]').length > 0;
        }).first();
      }
      if ($table.length === 0) return troopMap;

      // Parse column order from header — detect which column maps to which unit type
      var columnUnits = [];
      $table.find('thead th, tr:first th').each(function() {
        var $th = $(this);
        var unitType = null;

        // Check for unit sprite image: class like "unit_sprite_axe" or src containing unit name
        var $img = $th.find('img[src*="unit_"], img[class*="unit_"], .unit_sprite');
        if ($img.length > 0) {
          var imgClass = $img.attr('class') || '';
          var imgSrc = $img.attr('src') || '';
          var imgAlt = ($img.attr('alt') || '').toLowerCase();
          var imgTitle = ($img.attr('title') || '').toLowerCase();

          for (var i = 0; i < ALL_UNIT_TYPES.length; i++) {
            var u = ALL_UNIT_TYPES[i];
            if (imgClass.indexOf(u) !== -1 || imgSrc.indexOf(u) !== -1 ||
                imgAlt.indexOf(u) !== -1 || imgTitle.indexOf(u) !== -1) {
              unitType = u;
              break;
            }
          }
        }

        // Also check header text content as fallback
        if (!unitType) {
          var text = $th.text().trim().toLowerCase();
          for (var j = 0; j < ALL_UNIT_TYPES.length; j++) {
            if (text === ALL_UNIT_TYPES[j] || text.indexOf(ALL_UNIT_TYPES[j]) === 0) {
              unitType = ALL_UNIT_TYPES[j];
              break;
            }
          }
        }

        columnUnits.push(unitType); // null for non-unit columns (village name, etc.)
      });

      // Parse each data row
      $table.find('tbody tr, tr').each(function() {
        var $row = $(this);
        var $cells = $row.find('td');
        if ($cells.length === 0) return; // Skip header rows

        // Find village ID from a link in the row
        var villageId = 0;
        $row.find('a[href*="village="]').each(function() {
          var href = $(this).attr('href') || '';
          var match = href.match(/village=(\d+)/);
          if (match) {
            villageId = parseInt(match[1], 10);
            return false; // break
          }
        });
        if (villageId === 0) return;

        // Parse troop counts from cells matching columnUnits
        var troops = {};
        $cells.each(function(cellIdx) {
          if (cellIdx < columnUnits.length && columnUnits[cellIdx]) {
            var val = $(this).text().trim().replace(/\./g, '').replace(/,/g, '');
            troops[columnUnits[cellIdx]] = parseInt(val, 10) || 0;
          }
        });

        // If column mapping didn't work (columnUnits are all null), try a different
        // approach: cells after the village name cell are troop counts in order
        var hasAnyUnit = false;
        for (var k = 0; k < ALL_UNIT_TYPES.length; k++) {
          if (troops[ALL_UNIT_TYPES[k]] > 0) {
            hasAnyUnit = true;
            break;
          }
        }

        if (!hasAnyUnit && columnUnits.filter(function(u) { return u !== null; }).length === 0) {
          // Fallback: assume columns after first cell are unit types in standard order
          var unitIdx = 0;
          $cells.each(function(cellIdx) {
            if (cellIdx === 0) return; // Skip village name cell
            if (unitIdx < ALL_UNIT_TYPES.length) {
              var val = $(this).text().trim().replace(/\./g, '').replace(/,/g, '');
              var num = parseInt(val, 10);
              if (!isNaN(num)) {
                troops[ALL_UNIT_TYPES[unitIdx]] = num;
              }
              unitIdx++;
            }
          });
        }

        troopMap[villageId] = troops;
      });

      return troopMap;
    },

    /**
     * Fallback troop fetching: fetch individual village scavenge pages sequentially.
     * Uses /game.php?village={villageId}&screen=place&mode=scavenge to get troop data
     * from the scavenging form.
     *
     * @private
     * @param {Array.<Object>} villages - Village objects with .id.
     * @param {function(Object.<number, Object.<string, number>>)} callback -
     *   Called with merged troopMap when all fetches complete.
     */
    _fetchTroopsFallback: function(villages, callback) {
      var troopMap = {};
      var queue = villages.slice();
      var batchDelay = 200; // ms between requests to avoid rate limiting

      var processNext = function() {
        if (queue.length === 0) {
          callback(troopMap);
          return;
        }

        var village = queue.shift();
        if (!village.id) {
          processNext();
          return;
        }

        var url = '/game.php?village=' + village.id + '&screen=place&mode=scavenge';
        $.ajax({
          url: url,
          dataType: 'html',
          success: function(html) {
            var troops = ScavengeParser._parseSingleVillageTroops(html);
            if (troops) {
              troopMap[village.id] = troops;
            }
            setTimeout(processNext, batchDelay);
          },
          error: function() {
            setTimeout(processNext, batchDelay);
          }
        });
      };

      processNext();
    },

    /**
     * Parse troop counts from a single village scavenge page.
     * Looks for .units-entry-all elements, scavenging form inputs, or
     * ScavengeScreen JavaScript data embedded in the page.
     *
     * @private
     * @param {string} html - Raw HTML of the village scavenge page.
     * @returns {?Object.<string, number>} Troop counts or null if parsing failed.
     */
    _parseSingleVillageTroops: function(html) {
      var $doc = $('<div>').html(html);
      var troops = {};
      var found = false;

      // Method 1: .units-entry-all elements (common TW pattern)
      $doc.find('.units-entry-all').each(function() {
        var $el = $(this);
        var unitType = $el.data('unit') || $el.attr('data-unit');
        var count = parseInt($el.data('all-count') || $el.text().trim().replace(/[()]/g, ''), 10);
        if (unitType && !isNaN(count)) {
          troops[unitType] = count;
          found = true;
        }
      });
      if (found) return troops;

      // Method 2: Scavenging form input fields
      ALL_UNIT_TYPES.forEach(function(unit) {
        var $input = $doc.find('input[name="' + unit + '"], input[data-unit="' + unit + '"]');
        if ($input.length > 0) {
          // The max or data-all-count attribute often holds total available
          var max = parseInt($input.attr('data-all-count') || $input.attr('max') || '0', 10);
          if (max > 0) {
            troops[unit] = max;
            found = true;
          }
        }
        // Also check for an "(N)" link showing total available next to the input
        var $allLink = $doc.find('a[data-unit="' + unit + '"].units-entry-all, ' +
                                 '.scavenge_unit .unit_link_' + unit);
        if ($allLink.length > 0) {
          var val = parseInt($allLink.text().trim().replace(/[()]/g, ''), 10);
          if (!isNaN(val) && val > 0) {
            troops[unit] = val;
            found = true;
          }
        }
      });
      if (found) return troops;

      // Method 3: Look for ScavengeScreen data in inline scripts
      var scriptMatch = html.match(/ScavengeScreen\s*\(\s*\{[\s\S]*?"unit_counts_home"\s*:\s*(\{[^}]+\})/);
      if (scriptMatch) {
        try {
          var unitCounts = JSON.parse(scriptMatch[1]);
          ALL_UNIT_TYPES.forEach(function(unit) {
            if (unitCounts[unit] !== undefined) {
              troops[unit] = parseInt(unitCounts[unit], 10) || 0;
              found = true;
            }
          });
        } catch (e) {
          // JSON parse failed — ignore
        }
      }
      if (found) return troops;

      return null;
    }
  };

  // ============================================================
  // SCAVENGE CALCULATOR
  // ============================================================

  /**
   * Core scavenge calculation engine.
   * Distributes troops across tiers to fill the target duration.
   */
  var Calculator = {
    /**
     * Calculate required loot capacity for a target duration on a tier.
     * Inverts: duration = initial_seconds + factor * capacity ^ exponent
     * => capacity = ((duration - initial) / factor) ^ (1/exponent)
     *
     * @param {number} targetDurationSec - Target scavenge duration in seconds.
     * @param {Object} tierParams - Tier parameters.
     * @returns {number} Required loot capacity (total haul value).
     */
    requiredCapacity: function(targetDurationSec, tierParams) {
      var initial = tierParams.duration_initial_seconds;
      var factor = tierParams.duration_factor;
      var exponent = tierParams.duration_exponent;

      // If target is less than initial, minimum troops
      if (targetDurationSec <= initial) return 1;

      var diff = targetDurationSec - initial;
      var base = diff / factor;
      return Math.ceil(Math.pow(base, 1 / exponent));
    },

    /**
     * Calculate scavenge duration from a given capacity.
     * Formula: duration = initial_seconds + factor * capacity ^ exponent
     *
     * @param {number} capacity - Total loot capacity (sum of troops * haul).
     * @param {Object} tierParams - Tier parameters.
     * @returns {number} Duration in seconds.
     */
    calculateDuration: function(capacity, tierParams) {
      if (capacity <= 0) return 0;
      var initial = tierParams.duration_initial_seconds;
      var factor = tierParams.duration_factor;
      var exponent = tierParams.duration_exponent;
      return Math.floor(initial + factor * Math.pow(capacity, exponent));
    },

    /**
     * Allocate troops to fill a required capacity.
     * Distributes proportionally across available unit types.
     *
     * @param {Object.<string, number>} available - Available troops per type.
     * @param {number} neededCapacity - Total haul capacity needed.
     * @param {string[]} unitTypes - Unit types to use (in preference order).
     * @returns {Object.<string, number>} Allocated troops per type.
     */
    allocateTroops: function(available, neededCapacity, unitTypes) {
      var allocated = {};
      var remainingCapacity = neededCapacity;

      // Sort unit types by haul capacity (highest first — more efficient)
      var sorted = unitTypes.slice().sort(function(a, b) {
        return (UNIT_HAUL[b] || 0) - (UNIT_HAUL[a] || 0);
      });

      for (var i = 0; i < sorted.length; i++) {
        var unit = sorted[i];
        var avail = available[unit] || 0;
        var haul = UNIT_HAUL[unit] || 1;

        if (avail <= 0 || remainingCapacity <= 0) {
          allocated[unit] = 0;
          continue;
        }

        // How many of this unit needed to fill remaining capacity
        var needed = Math.ceil(remainingCapacity / haul);
        var toSend = Math.min(needed, avail);

        allocated[unit] = toSend;
        remainingCapacity -= toSend * haul;
      }

      return allocated;
    },

    /**
     * Calculate full scavenge plan for a single village.
     *
     * @param {Object} village - Village data with troops.
     * @param {number} targetDurationSec - Target runtime in seconds.
     * @param {Object[]} tierParams - Array of tier parameter objects.
     * @param {string} mode - 'balanced' or 'priority'.
     * @param {number[]} tierOrder - Tier order (1-indexed), e.g. [4,3,2,1].
     * @param {boolean[]} selectedTiers - Which tiers are selected (0-indexed).
     * @param {string[]} unitTypes - Unit types to use.
     * @returns {Object} Plan with squads array and summary.
     */
    planVillage: function(village, targetDurationSec, tierParams, mode, tierOrder, selectedTiers, unitTypes) {
      // Calculate available troops after keep-home
      var available = {};
      var totalAvailable = 0;
      unitTypes.forEach(function(unit) {
        var total = village.troops[unit] || 0;
        var keep = Settings.getKeepHome(village.id, unit);
        available[unit] = Math.max(0, total - keep);
        totalAvailable += available[unit];
      });

      if (totalAvailable === 0) {
        return { squads: [], error: 'No troops available' };
      }

      // Filter to unlocked + selected tiers
      var activeTiers = tierOrder.filter(function(t) {
        return selectedTiers[t - 1] &&
               village.unlockedTiers.indexOf(t) !== -1;
      });

      if (activeTiers.length === 0) {
        return { squads: [], error: 'No tiers available' };
      }

      var squads = [];
      var remainingTroops = {};
      unitTypes.forEach(function(u) { remainingTroops[u] = available[u]; });

      if (mode === 'balanced') {
        // BALANCED: Calculate troops so all tiers have approximately EQUAL DURATION.
        // Each tier has different formula params, so equal carry ≠ equal duration.
        // We find a target duration T such that the sum of required capacities
        // across all tiers equals total available carry capacity.

        // Step 1: Compute total available carry capacity
        var totalCarry = 0;
        unitTypes.forEach(function(u) {
          totalCarry += (remainingTroops[u] || 0) * (UNIT_HAUL[u] || 0);
        });

        // Step 2: Binary search for target duration T where sum of
        // requiredCapacity(T, tier) across all tiers ≈ totalCarry, capped at maxDuration.
        var minT = 0;
        var maxT = targetDurationSec;

        // Check if total carry can fill all tiers to maxDuration
        var capAtMax = 0;
        activeTiers.forEach(function(tierNum) {
          var p = tierParams[tierNum - 1];
          if (p) capAtMax += Calculator.requiredCapacity(maxT, p);
        });
        // If we don't have enough troops to fill all tiers to max, binary search
        if (totalCarry < capAtMax) {
          // Lower bound: use LOWEST tier's initial_seconds (tier with shortest base time).
          // Below this, even tier 1 gets minimum troops. This gives the binary search
          // a tight range to converge quickly.
          activeTiers.forEach(function(tierNum) {
            var p = tierParams[tierNum - 1];
            if (p && (minT === 0 || p.duration_initial_seconds < minT)) {
              minT = p.duration_initial_seconds;
            }
          });

          for (var iter = 0; iter < 40; iter++) { // 40 iterations ≈ 1-second precision
            var midT = (minT + maxT) / 2;
            var sumCap = 0;
            activeTiers.forEach(function(tierNum) {
              var p = tierParams[tierNum - 1];
              if (p) sumCap += Calculator.requiredCapacity(midT, p);
            });
            if (sumCap > totalCarry) {
              maxT = midT;
            } else {
              minT = midT;
            }
          }
        }
        // minT is now the balanced target duration (or targetDurationSec if we have excess troops)
        var balancedDuration = Math.min(minT, targetDurationSec);

        // Step 3: Allocate troops per tier to match that balanced duration
        activeTiers.forEach(function(tierNum) {
          var params = tierParams[tierNum - 1];
          if (!params) return;

          var targetCap = Calculator.requiredCapacity(balancedDuration, params);
          if (targetCap <= 0) targetCap = 1;

          var alloc = Calculator.allocateTroops(remainingTroops, targetCap, unitTypes);

          var actualCapacity = 0;
          unitTypes.forEach(function(u) {
            remainingTroops[u] -= alloc[u] || 0;
            actualCapacity += (alloc[u] || 0) * (UNIT_HAUL[u] || 0);
          });

          if (actualCapacity > 0) {
            squads.push({
              tier: tierNum,
              troops: alloc,
              capacity: actualCapacity,
              duration: Calculator.calculateDuration(actualCapacity, params)
            });
          }
        });
      } else {
        // PRIORITY: Fill highest priority tier first up to max duration,
        // then next tier with remaining troops, and so on.
        // Tier 4 (highest loot_factor) gets filled first, then 3, 2, 1.
        // allocateTroops naturally caps at available troops, so no Math.min needed.
        activeTiers.forEach(function(tierNum) {
          var params = tierParams[tierNum - 1];
          if (!params) return;

          var targetCapacity = Calculator.requiredCapacity(targetDurationSec, params);
          var alloc = Calculator.allocateTroops(remainingTroops, targetCapacity, unitTypes);

          var actualCapacity = 0;
          unitTypes.forEach(function(u) {
            remainingTroops[u] -= alloc[u] || 0;
            actualCapacity += (alloc[u] || 0) * (UNIT_HAUL[u] || 0);
          });

          if (actualCapacity > 0) {
            squads.push({
              tier: tierNum,
              troops: alloc,
              capacity: actualCapacity,
              duration: Calculator.calculateDuration(actualCapacity, params)
            });
          }
        });
      }

      return { squads: squads, error: null };
    },

    /**
     * Build API payload for a single village's squads.
     * @param {number} villageId - Village ID.
     * @param {Object[]} squads - Squad array from planVillage.
     * @returns {Object[]} Array of squad objects for the API.
     */
    buildSquadPayload: function(villageId, squads) {
      return squads.map(function(sq) {
        var units = {};
        var carryMax = 0;
        ALL_UNIT_TYPES.forEach(function(u) {
          if (sq.troops[u] && sq.troops[u] > 0) {
            units[u] = sq.troops[u];
            carryMax += sq.troops[u] * (UNIT_HAUL[u] || 0);
          }
        });
        return {
          village_id: villageId,
          candidate_squad: units,
          carry_max: carryMax,
          option_id: sq.tier
        };
      });
    }
  };

  // ============================================================
  // SENDER (API Integration)
  // ============================================================

  /**
   * Sends scavenge squads to the TW API one-at-a-time via user clicks.
   * Each click = exactly 1 POST (compliant with TW "one action per click" rule).
   */
  var Sender = {
    /** @private {boolean} Whether a send operation is in progress (single squad being sent). */
    _sending: false,

    /** @private {Object[]} Queue of squads waiting to be sent. */
    _queue: [],

    /** @private {number} Total squads planned. */
    _total: 0,

    /** @private {number} Squads sent so far. */
    _sent: 0,

    /** @private {number} Squads skipped. */
    _skipped: 0,

    /** @private {number} Errors encountered. */
    _errors: 0,

    /** @private {Object[]} Enriched queue items with village name/coords for display. */
    _displayQueue: [],

    /** @private {function|null} Callback when all squads are done or cancelled. */
    _onComplete: null,

    /** @private {function|null} Callback after each send/skip. */
    _onUpdate: null,

    /**
     * Initialize a click-through send session.
     * Does NOT send anything — just prepares the queue for user-driven sending.
     * @param {Object[]} allSquads - Array of squad payloads.
     * @param {Object[]} displayInfo - Matching array with { villageName, coords, tier, troops, duration } for display.
     * @param {function} onUpdate - Called after each send/skip with current state.
     * @param {function} onComplete - Called when queue is exhausted or cancelled.
     */
    initSession: function(allSquads, displayInfo, onUpdate, onComplete) {
      this._queue = allSquads.slice();
      this._displayQueue = displayInfo.slice();
      this._total = allSquads.length;
      this._sent = 0;
      this._skipped = 0;
      this._errors = 0;
      this._onUpdate = onUpdate;
      this._onComplete = onComplete;
    },

    /**
     * Send the current (first) squad in the queue. One click = one POST.
     */
    sendCurrent: function() {
      if (this._sending || this._queue.length === 0) return;

      var self = this;
      var squad = this._queue.shift();
      this._displayQueue.shift();
      this._sending = true;

      this._sendSingleSquad(squad, function(success) {
        self._sending = false;
        if (success) {
          self._sent++;
        } else {
          self._errors++;
        }
        if (self._onUpdate) self._onUpdate(self.getState());
        if (self._queue.length === 0 && self._onComplete) {
          self._onComplete(self.getState());
        }
      });
    },

    /**
     * Skip the current squad without sending.
     */
    skipCurrent: function() {
      if (this._sending || this._queue.length === 0) return;

      this._queue.shift();
      this._displayQueue.shift();
      this._skipped++;
      if (this._onUpdate) this._onUpdate(this.getState());
      if (this._queue.length === 0 && this._onComplete) {
        this._onComplete(this.getState());
      }
    },

    /**
     * Cancel the session — clear queue.
     */
    cancelSession: function() {
      this._queue = [];
      this._displayQueue = [];
      if (this._onComplete) this._onComplete(this.getState());
    },

    /**
     * Get current session state.
     * @returns {Object} State object.
     */
    getState: function() {
      return {
        total: this._total,
        sent: this._sent,
        skipped: this._skipped,
        errors: this._errors,
        remaining: this._queue.length,
        currentSquad: this._displayQueue.length > 0 ? this._displayQueue[0] : null,
        queue: this._displayQueue
      };
    },

    /**
     * Check if a squad is currently being sent (POST in flight).
     * @returns {boolean}
     */
    isBusy: function() {
      return this._sending;
    },

    /**
     * Check if there are squads remaining in the queue.
     * @returns {boolean}
     */
    hasRemaining: function() {
      return this._queue.length > 0;
    },

    /**
     * Send a single scavenge squad to the TW API.
     * Uses the verified scavenge_api endpoint with URL-encoded form data.
     * Format: squad_requests[0][village_id], squad_requests[0][candidate_squad][unit_counts][unit],
     * squad_requests[0][candidate_squad][carry_max], squad_requests[0][option_id] (1-indexed),
     * squad_requests[0][use_premium], h (CSRF in body).
     * @private
     * @param {Object} squad - Squad payload: { village_id, candidate_squad, carry_max, option_id (1-indexed tier) }.
     * @param {function(boolean)} callback - Called with true on success, false on error.
     */
    _sendSingleSquad: function(squad, callback) {
      var villageId = squad.village_id;
      var csrf = TWTools.getCsrf();
      var optionId = squad.option_id; // Already 1-indexed from buildSquadPayload

      // Build URL-encoded form data matching the verified TW scavenge API format
      var parts = [];
      parts.push('squad_requests%5B0%5D%5Bvillage_id%5D=' + villageId);

      var units = squad.candidate_squad || {};
      for (var unit in units) {
        if (units.hasOwnProperty(unit) && units[unit] > 0) {
          parts.push('squad_requests%5B0%5D%5Bcandidate_squad%5D%5Bunit_counts%5D%5B' + unit + '%5D=' + units[unit]);
        }
      }

      parts.push('squad_requests%5B0%5D%5Bcandidate_squad%5D%5Bcarry_max%5D=' + (squad.carry_max || 0));
      parts.push('squad_requests%5B0%5D%5Boption_id%5D=' + optionId);
      parts.push('squad_requests%5B0%5D%5Buse_premium%5D=false');
      parts.push('h=' + encodeURIComponent(csrf));

      var data = parts.join('&');

      // Use scavenge_api endpoint with ajaxaction=send_squads
      var gameBase = window.location.origin;
      var url = gameBase + '/game.php?village=' + villageId + '&screen=scavenge_api&ajaxaction=send_squads';

      console.log('[TW-Scavenge] Sending squad: village=' + villageId +
                  ', tier=' + optionId + ', carry_max=' + (squad.carry_max || 0));

      var xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
      xhr.onreadystatechange = function() {
        if (xhr.readyState === XMLHttpRequest.DONE) {
          if (xhr.status === 200) {
            try {
              var response = JSON.parse(xhr.responseText);
              console.log('[TW-Scavenge] Response:', response);
              callback(!response.error);
            } catch (e) {
              console.log('[TW-Scavenge] Parse error, raw:', xhr.responseText);
              callback(false);
            }
          } else {
            console.log('[TW-Scavenge] HTTP error:', xhr.status);
            callback(false);
          }
        }
      };
      xhr.send(data);
    },

    /**
     * Check if a send session is active (queue has items or POST in flight).
     * @returns {boolean} True if session is active.
     */
    isActive: function() {
      return this._sending || this._queue.length > 0;
    }
  };

  // ============================================================
  // TRAINER (Auto-Train Spear + LC)
  // ============================================================

  /**
   * Training suggest helper (no auto-POST).
   * Builds a list of villages needing training with direct links to barracks/stable.
   */
  var Trainer = {
    /**
     * Build suggest data for villages that need training.
     * Returns an array of objects with village info, current/target counts, and direct links.
     *
     * @param {Array.<Object>} villages - Village objects with .id, .name, .coords, .troops.
     * @returns {Array.<Object>} Suggest items with links.
     */
    buildSuggestions: function(villages) {
      var suggestions = [];
      var targetSpear = Settings.trainTargetSpear;
      var targetLC = Settings.trainTargetLC;
      var gameBase = window.location.pathname || '/game.php';

      villages.forEach(function(v) {
        var curSpear = (v.troops && v.troops.spear) || 0;
        var curLC = (v.troops && v.troops.light) || 0;
        var needSpear = curSpear < targetSpear;
        var needLC = curLC < targetLC;

        if (!needSpear && !needLC) return;

        var coordStr = v.coords ? '(' + v.coords.x + '|' + v.coords.y + ')' : '';
        var barracksUrl = '/game.php?village=' + v.id + '&screen=barracks';
        var stableUrl = '/game.php?village=' + v.id + '&screen=stable';

        suggestions.push({
          villageId: v.id,
          villageName: v.name || 'Village',
          coordStr: coordStr,
          curSpear: curSpear,
          targetSpear: targetSpear,
          needSpear: needSpear,
          curLC: curLC,
          targetLC: targetLC,
          needLC: needLC,
          barracksUrl: barracksUrl,
          stableUrl: stableUrl
        });
      });

      return suggestions;
    }
  };

  // ============================================================
  // APPLICATION STATE
  // ============================================================

  var AppState = {
    activeTab: 'scavenge',
    groups: [],
    selectedGroup: '0',
    villages: [],
    tierParams: DEFAULT_TIER_PARAMS,
    durationSec: 8 * 3600,
    /** @type {boolean} Whether we are in click-through send mode. */
    sendSessionActive: false,
    /** @type {Object|null} Last completed send session result. */
    lastResult: null
  };

  // ============================================================
  // UI RENDERER
  // ============================================================

  var UI = {
    _card: null,

    /**
     * Show the scavenge card.
     */
    show: function() {
      if (this._card) this.destroy();

      Settings.load();
      AppState.durationSec = Settings.defaultDuration;
      AppState.selectedGroup = Settings.defaultGroup;
      AppState.tierParams = ScavengeParser.readTierParams();
      AppState.groups = ScavengeParser.readGroups();

      // Build card using TWTools.UI.createCard
      this._card = TWTools.UI.createCard({
        id: ID_PREFIX + 'card',
        title: 'MASS SCAVENGE',
        version: VERSION,
        width: 900,
        height: 600,
        tabs: [
          { id: 'scavenge', label: 'Scavenge' },
          { id: 'settings', label: 'Settings' }
        ],
        onTabChange: function(tabId) {
          AppState.activeTab = tabId;
          UI.renderActiveTab();
        },
        onClose: function() {
          UI.destroy();
        }
      });

      this._loadVillages();
    },

    /**
     * Destroy the card and clean up.
     */
    destroy: function() {
      if (this._card) {
        this._card.destroy();
        this._card = null;
      }
    },

    /**
     * Load villages for the selected group, then fetch troop data.
     * Flow: parse/fetch village list -> fetch troop counts -> merge -> render.
     * @private
     */
    _loadVillages: function() {
      var self = this;

      /**
       * After village list is loaded, fetch troop counts and merge them in.
       * @param {Array.<Object>} villages - Parsed village list (troops may be empty).
       */
      var onVillagesLoaded = function(villages) {
        AppState.villages = villages;

        // Check if any village already has troop data (non-empty troops object)
        var hasTroopData = villages.some(function(v) {
          for (var u in v.troops) {
            if (v.troops.hasOwnProperty(u) && v.troops[u] > 0) return true;
          }
          return false;
        });

        if (hasTroopData || villages.length === 0) {
          // Troops already parsed from the page or no villages — render immediately
          self.renderActiveTab();
          return;
        }

        // Show loading state with village count but "Loading troops..." in troop column
        self._renderVillagesLoadingTroops();

        // Fetch troop counts from overview page
        ScavengeParser.fetchTroopCounts(villages, function(troopMap) {
          // Merge troop data into village objects
          villages.forEach(function(v) {
            if (troopMap[v.id]) {
              v.troops = troopMap[v.id];
            }
          });
          self.renderActiveTab();
        });
      };

      if (ScavengeParser.isOnMassScavengePage()) {
        var villages = ScavengeParser.parseVillageRows(AppState.selectedGroup);
        onVillagesLoaded(villages);
      } else {
        // Show loading state
        self._setTabContent('scavenge', '<div style="text-align:center;padding:40px;color:#8a8070;">Loading village data...</div>');
        ScavengeParser.fetchVillageData(AppState.selectedGroup, function(villages) {
          onVillagesLoaded(villages);
        });
      }
    },

    /**
     * Render the village table with a "Loading troops..." indicator in the troops column.
     * Shown while fetchTroopCounts is in progress.
     * @private
     */
    _renderVillagesLoadingTroops: function() {
      var html = '<div style="margin-bottom:12px;font-size:12px;color:#a89050;">' +
                 'Found ' + AppState.villages.length + ' villages. Loading troop data...</div>';
      html += '<div style="max-height:360px;overflow-y:auto;border:1px solid #3a3a3a;border-radius:4px;">';
      html += '<table class="twsc-table"><thead><tr>';
      html += '<th style="width:30px;">&nbsp;</th>';
      html += '<th>Village</th>';
      html += '<th>Available Troops</th>';
      html += '<th>Tiers</th>';
      html += '</tr></thead><tbody>';

      AppState.villages.forEach(function(v) {
        html += '<tr>';
        html += '<td>&nbsp;</td>';
        html += '<td>';
        html += '<span class="twsc-village-name">' + UI._esc(v.name || 'Village') + '</span>';
        if (v.coords) html += ' <span class="twsc-coords">(' + v.coords.x + '|' + v.coords.y + ')</span>';
        html += '</td>';
        html += '<td><span style="color:#a89050;font-style:italic;">Loading troops...</span></td>';
        html += '<td>';
        for (var ti = 1; ti <= 4; ti++) {
          var unlocked = v.unlockedTiers.indexOf(ti) !== -1;
          html += '<span class="twsc-tier-badge' + (unlocked ? '' : ' twsc-tier-locked') + '">' + ti + '</span>';
        }
        html += '</td>';
        html += '</tr>';
      });

      html += '</tbody></table></div>';
      this._setTabContent('scavenge', html);
    },

    /**
     * Set content of a tab panel.
     * @private
     * @param {string} tabId - Tab ID.
     * @param {string} html - HTML content.
     */
    _setTabContent: function(tabId, html) {
      if (!this._card) return;
      this._card.setTabContent(tabId, html);
    },

    /**
     * Render the currently active tab.
     */
    renderActiveTab: function() {
      if (AppState.activeTab === 'scavenge') {
        this.renderScavengeTab();
      } else {
        this.renderSettingsTab();
      }
    },

    // ----------------------------------------------------------
    // TAB 1: SCAVENGE
    // ----------------------------------------------------------

    /**
     * Render the main scavenge tab with village list, controls, and send button.
     */
    renderScavengeTab: function() {
      var html = '';

      // Group selector
      html += '<div style="margin-bottom:12px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">';
      html += '<label style="font-size:12px;color:#a89050;">Village Group:</label>';
      html += '<select id="' + ID_PREFIX + 'group-select" class="twsc-select">';
      AppState.groups.forEach(function(g) {
        var sel = g.id === AppState.selectedGroup ? ' selected' : '';
        html += '<option value="' + g.id + '"' + sel + '>' + UI._esc(g.name) + '</option>';
      });
      html += '</select>';

      // Duration input
      html += '<label style="font-size:12px;color:#a89050;margin-left:16px;">Duration:</label>';
      html += '<input type="text" id="' + ID_PREFIX + 'duration" class="twsc-input" style="width:80px;" ' +
              'value="' + UI._formatDurationInput(AppState.durationSec) + '" placeholder="8:00" title="Hours or HH:MM format">';

      // Distribution mode
      html += '<label style="font-size:12px;color:#a89050;margin-left:16px;">Mode:</label>';
      html += '<label class="twsc-radio"><input type="radio" name="' + ID_PREFIX + 'mode" value="balanced"' +
              (Settings.distributionMode === 'balanced' ? ' checked' : '') + '> Balanced</label>';
      html += '<label class="twsc-radio"><input type="radio" name="' + ID_PREFIX + 'mode" value="priority"' +
              (Settings.distributionMode === 'priority' ? ' checked' : '') + '> Priority higher</label>';
      html += '</div>';

      // Tier selection
      html += '<div style="margin-bottom:12px;display:flex;gap:12px;align-items:center;">';
      html += '<span style="font-size:12px;color:#a89050;">Tiers:</span>';
      for (var t = 0; t < 4; t++) {
        var checked = Settings.selectedTiers[t] ? ' checked' : '';
        html += '<label class="twsc-radio"><input type="checkbox" class="' + ID_PREFIX + 'tier-cb" data-tier="' + t + '"' +
                checked + '> Tier ' + (t + 1) + '</label>';
      }

      // Select all / Deselect all
      html += '<span style="margin-left:auto;">';
      html += '<button class="twsc-btn twsc-btn-sm" id="' + ID_PREFIX + 'select-all">Select All</button>';
      html += '<button class="twsc-btn twsc-btn-sm twsc-btn-outline" id="' + ID_PREFIX + 'deselect-all" style="margin-left:4px;">Deselect All</button>';
      html += '</span>';
      html += '</div>';

      // Village table
      if (AppState.villages.length === 0) {
        html += '<div style="text-align:center;padding:30px;color:#8a8070;">';
        if (!ScavengeParser.isOnMassScavengePage()) {
          html += 'No village data loaded. Navigate to the <b>Mass Scavenge</b> page (Place &rarr; Scavenge Mass) or select a group above.';
        } else {
          html += 'No villages found on this page.';
        }
        html += '</div>';
      } else {
        html += '<div style="max-height:320px;overflow-y:auto;border:1px solid #3a3a3a;border-radius:4px;">';
        html += '<table class="twsc-table"><thead><tr>';
        html += '<th style="width:30px;"><input type="checkbox" id="' + ID_PREFIX + 'check-all"></th>';
        html += '<th>Village</th>';
        html += '<th>Available Troops</th>';
        html += '<th>Tiers</th>';
        html += '<th>Status</th>';
        html += '</tr></thead><tbody>';

        AppState.villages.forEach(function(v, idx) {
          var rowClass = v.status === 'running' ? ' class="twsc-row-running"' : '';
          html += '<tr' + rowClass + ' data-idx="' + idx + '">';

          // Checkbox
          html += '<td><input type="checkbox" class="' + ID_PREFIX + 'village-cb" data-idx="' + idx + '"' +
                  (v.checked ? ' checked' : '') + '></td>';

          // Village name + coords
          html += '<td>';
          html += '<span class="twsc-village-name">' + UI._esc(v.name || 'Village') + '</span>';
          if (v.coords) html += ' <span class="twsc-coords">(' + v.coords.x + '|' + v.coords.y + ')</span>';
          html += '</td>';

          // Available troops (show selected unit types only)
          html += '<td class="twsc-troops">';
          var troopParts = [];
          Settings.unitTypes.forEach(function(u) {
            var count = v.troops[u] || 0;
            var keep = Settings.getKeepHome(v.id, u);
            var avail = Math.max(0, count - keep);
            if (count > 0) {
              troopParts.push('<span class="twsc-troop-badge" title="' + u + ': ' + count + ' total, ' + keep + ' keep">' +
                             u.charAt(0).toUpperCase() + ':' + avail + '</span>');
            }
          });
          html += troopParts.length > 0 ? troopParts.join(' ') : '<span style="color:#555;">none</span>';
          html += '</td>';

          // Unlocked tiers
          html += '<td>';
          for (var ti = 1; ti <= 4; ti++) {
            var unlocked = v.unlockedTiers.indexOf(ti) !== -1;
            html += '<span class="twsc-tier-badge' + (unlocked ? '' : ' twsc-tier-locked') + '">' + ti + '</span>';
          }
          html += '</td>';

          // Status
          html += '<td>';
          if (v.status === 'running') {
            html += '<span style="color:#ff9800;">Running</span>';
          } else {
            html += '<span style="color:#4caf50;">Idle</span>';
          }
          html += '</td>';

          html += '</tr>';
        });

        html += '</tbody></table>';
        html += '</div>';
      }

      // Summary + Calculate button
      html += '<div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;">';
      html += '<div id="' + ID_PREFIX + 'summary" style="font-size:12px;color:#a89050;">' +
              UI._getSummaryText() + '</div>';
      html += '<button class="twsc-btn twsc-btn-primary" id="' + ID_PREFIX + 'send-btn"' +
              (AppState.sendSessionActive ? ' disabled' : '') + '>' +
              (AppState.sendSessionActive ? 'Session active...' : 'Calculate & Send') + '</button>';
      html += '</div>';

      // Click-through send panel (shown when session is active)
      html += '<div id="' + ID_PREFIX + 'send-panel" style="display:none;margin-top:8px;"></div>';

      // Result
      if (AppState.lastResult) {
        html += '<div style="margin-top:8px;padding:8px 12px;border-radius:4px;' +
                'background:rgba(76,175,80,0.1);border-left:3px solid #4caf50;font-size:12px;">';
        html += 'Sent: ' + AppState.lastResult.sent + ' / ' + AppState.lastResult.total + ' squads';
        if (AppState.lastResult.skipped > 0) {
          html += ' | Skipped: ' + AppState.lastResult.skipped;
        }
        if (AppState.lastResult.errors > 0) {
          html += ' | <span style="color:#f44336;">Errors: ' + AppState.lastResult.errors + '</span>';
        }
        html += '</div>';
      }

      this._setTabContent('scavenge', html);
      this._bindScavengeEvents();
    },

    /**
     * Get summary text showing checked village count.
     * @private
     * @returns {string} Summary text.
     */
    _getSummaryText: function() {
      var checked = AppState.villages.filter(function(v) { return v.checked; }).length;
      var total = AppState.villages.length;
      return checked + ' of ' + total + ' villages selected';
    },

    /**
     * Bind events for the scavenge tab.
     * @private
     */
    _bindScavengeEvents: function() {
      var self = this;

      // Group selector
      $(document).off('change.' + ID_PREFIX + 'group').on('change.' + ID_PREFIX + 'group', '#' + ID_PREFIX + 'group-select', function() {
        AppState.selectedGroup = $(this).val();
        Settings.defaultGroup = AppState.selectedGroup;
        Settings.save();
        self._loadVillages();
      });

      // Duration input
      $(document).off('change.' + ID_PREFIX + 'dur').on('change.' + ID_PREFIX + 'dur', '#' + ID_PREFIX + 'duration', function() {
        var val = $(this).val().trim();
        var sec = UI._parseDurationInput(val);
        if (sec > 0) {
          AppState.durationSec = sec;
          Settings.defaultDuration = sec;
          Settings.save();
        }
      });

      // Distribution mode radio
      $(document).off('change.' + ID_PREFIX + 'mode').on('change.' + ID_PREFIX + 'mode', 'input[name="' + ID_PREFIX + 'mode"]', function() {
        Settings.distributionMode = $(this).val();
        Settings.save();
      });

      // Tier checkboxes
      $(document).off('change.' + ID_PREFIX + 'tier').on('change.' + ID_PREFIX + 'tier', '.' + ID_PREFIX + 'tier-cb', function() {
        var tierIdx = parseInt($(this).data('tier'), 10);
        Settings.selectedTiers[tierIdx] = $(this).is(':checked');
        Settings.save();
      });

      // Village checkboxes
      $(document).off('change.' + ID_PREFIX + 'vcb').on('change.' + ID_PREFIX + 'vcb', '.' + ID_PREFIX + 'village-cb', function() {
        var idx = parseInt($(this).data('idx'), 10);
        if (AppState.villages[idx]) {
          AppState.villages[idx].checked = $(this).is(':checked');
        }
        $('#' + ID_PREFIX + 'summary').text(self._getSummaryText());
      });

      // Check all
      $(document).off('change.' + ID_PREFIX + 'ca').on('change.' + ID_PREFIX + 'ca', '#' + ID_PREFIX + 'check-all', function() {
        var isChecked = $(this).is(':checked');
        AppState.villages.forEach(function(v) { v.checked = isChecked; });
        $('.' + ID_PREFIX + 'village-cb').prop('checked', isChecked);
        $('#' + ID_PREFIX + 'summary').text(self._getSummaryText());
      });

      // Select All button
      $(document).off('click.' + ID_PREFIX + 'sa').on('click.' + ID_PREFIX + 'sa', '#' + ID_PREFIX + 'select-all', function() {
        AppState.villages.forEach(function(v) { v.checked = true; });
        $('.' + ID_PREFIX + 'village-cb').prop('checked', true);
        $('#' + ID_PREFIX + 'check-all').prop('checked', true);
        $('#' + ID_PREFIX + 'summary').text(self._getSummaryText());
      });

      // Deselect All button
      $(document).off('click.' + ID_PREFIX + 'da').on('click.' + ID_PREFIX + 'da', '#' + ID_PREFIX + 'deselect-all', function() {
        AppState.villages.forEach(function(v) { v.checked = false; });
        $('.' + ID_PREFIX + 'village-cb').prop('checked', false);
        $('#' + ID_PREFIX + 'check-all').prop('checked', false);
        $('#' + ID_PREFIX + 'summary').text(self._getSummaryText());
      });

      // Send button
      $(document).off('click.' + ID_PREFIX + 'send').on('click.' + ID_PREFIX + 'send', '#' + ID_PREFIX + 'send-btn', function() {
        self._handleSend();
      });
    },

    /**
     * Handle the Calculate & Send button click.
     * Builds plans, then shows a click-through panel where each click = 1 POST.
     * @private
     */
    _handleSend: function() {
      if (AppState.sendSessionActive) return;

      var checkedVillages = AppState.villages.filter(function(v) { return v.checked; });
      if (checkedVillages.length === 0) {
        TWTools.UI.toast('No villages selected', 'warning');
        return;
      }

      // Build squads for all checked villages + display info
      var allSquads = [];
      var displayInfo = [];
      var mode = Settings.distributionMode;
      var tierOrder = Settings.tierPriority;

      checkedVillages.forEach(function(village) {
        var plan = Calculator.planVillage(
          village,
          AppState.durationSec,
          AppState.tierParams,
          mode,
          tierOrder,
          Settings.selectedTiers,
          Settings.unitTypes
        );

        if (plan.squads.length > 0) {
          var payloads = Calculator.buildSquadPayload(village.id, plan.squads);
          for (var i = 0; i < payloads.length; i++) {
            allSquads.push(payloads[i]);
            var sq = plan.squads[i];
            var troopParts = [];
            Settings.unitTypes.forEach(function(u) {
              if (sq.troops[u] && sq.troops[u] > 0) {
                troopParts.push(u.charAt(0).toUpperCase() + ':' + sq.troops[u]);
              }
            });
            displayInfo.push({
              villageName: village.name || 'Village',
              coords: village.coords,
              tier: sq.tier,
              troopStr: troopParts.join(' '),
              duration: sq.duration,
              capacity: sq.capacity
            });
          }
        }
      });

      if (allSquads.length === 0) {
        TWTools.UI.toast('No squads to send — check troop availability', 'warning');
        return;
      }

      // Activate send session
      AppState.sendSessionActive = true;
      AppState.lastResult = null;
      $('#' + ID_PREFIX + 'send-btn').prop('disabled', true).text('Session active...');

      var self = this;
      Sender.initSession(
        allSquads,
        displayInfo,
        function onUpdate(state) {
          self._renderSendPanel(state);
        },
        function onComplete(state) {
          AppState.sendSessionActive = false;
          AppState.lastResult = state;
          // Unbind Enter key listener
          $(document).off('keydown.' + ID_PREFIX + 'enter');
          TWTools.UI.toast(
            'Done: ' + state.sent + ' sent, ' + state.skipped + ' skipped, ' + state.errors + ' errors',
            state.errors > 0 ? 'warning' : 'success'
          );
          self.renderScavengeTab();
        }
      );

      // Render initial send panel
      this._renderSendPanel(Sender.getState());
    },

    /**
     * Render the click-through send panel showing the queue and send/skip/cancel buttons.
     * @private
     * @param {Object} state - Current Sender state from getState().
     */
    _renderSendPanel: function(state) {
      var $panel = $('#' + ID_PREFIX + 'send-panel');
      if ($panel.length === 0) return;

      if (!state.currentSquad && state.remaining === 0) {
        $panel.hide();
        return;
      }

      $panel.show();
      var html = '';

      // Progress header
      var done = state.sent + state.skipped + state.errors;
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">';
      html += '<span style="font-size:13px;font-weight:bold;color:#e0c882;">' +
              done + ' / ' + state.total + ' processed</span>';
      html += '<span style="font-size:11px;color:#8a8070;">' +
              state.sent + ' sent, ' + state.skipped + ' skipped' +
              (state.errors > 0 ? ', ' + state.errors + ' errors' : '') + '</span>';
      html += '</div>';

      // Progress bar
      var pct = state.total > 0 ? Math.round((done / state.total) * 100) : 0;
      html += '<div class="twsc-progress-bar" style="margin-bottom:10px;"><div class="twsc-progress-fill" style="width:' + pct + '%;"></div></div>';

      // Queue list (show up to 8 upcoming squads)
      html += '<div style="max-height:200px;overflow-y:auto;border:1px solid #3a3a3a;border-radius:4px;margin-bottom:8px;">';
      html += '<table class="twsc-table"><thead><tr>';
      html += '<th style="width:30px;">#</th>';
      html += '<th>Village</th>';
      html += '<th>Tier</th>';
      html += '<th>Troops</th>';
      html += '<th>Duration</th>';
      html += '</tr></thead><tbody>';

      var maxShow = Math.min(state.queue.length, 8);
      for (var i = 0; i < maxShow; i++) {
        var item = state.queue[i];
        var isActive = i === 0;
        var rowStyle = isActive ? 'background:#2a3a1a;border-left:3px solid #4caf50;' : '';
        var durStr = TWTools.pad2(Math.floor(item.duration / 3600)) + ':' +
                     TWTools.pad2(Math.floor((item.duration % 3600) / 60));
        var coordStr = item.coords ? '(' + item.coords.x + '|' + item.coords.y + ')' : '';

        html += '<tr style="' + rowStyle + '">';
        html += '<td style="color:#a89050;">' + (done + i + 1) + '</td>';
        html += '<td>';
        html += '<span class="twsc-village-name">' + UI._esc(item.villageName) + '</span>';
        html += ' <span class="twsc-coords">' + coordStr + '</span>';
        html += '</td>';
        html += '<td><span class="twsc-tier-badge">' + item.tier + '</span></td>';
        html += '<td class="twsc-troops" style="font-size:11px;">' + item.troopStr + '</td>';
        html += '<td style="font-size:11px;color:#a89050;">' + durStr + '</td>';
        html += '</tr>';
      }
      if (state.queue.length > maxShow) {
        html += '<tr><td colspan="5" style="text-align:center;color:#555;font-size:11px;">... and ' +
                (state.queue.length - maxShow) + ' more</td></tr>';
      }

      html += '</tbody></table></div>';

      // Action buttons
      html += '<div style="display:flex;gap:8px;align-items:center;">';
      var busy = Sender.isBusy();
      html += '<button class="twsc-btn twsc-btn-primary" id="' + ID_PREFIX + 'send-one"' +
              (busy ? ' disabled' : '') + '>' +
              (busy ? 'Sending...' : 'Send (Enter)') + '</button>';
      html += '<button class="twsc-btn twsc-btn-outline" id="' + ID_PREFIX + 'skip-one"' +
              (busy ? ' disabled' : '') + '>Skip</button>';
      html += '<button class="twsc-btn" id="' + ID_PREFIX + 'cancel-send" style="margin-left:auto;color:#f44336;">Cancel</button>';
      html += '</div>';

      $panel.html(html);

      // Bind send panel button events
      UI._bindSendPanelEvents();
    },

    /**
     * Bind events for the click-through send panel buttons.
     * @private
     */
    _bindSendPanelEvents: function() {
      // Send one squad
      $(document).off('click.' + ID_PREFIX + 'so').on('click.' + ID_PREFIX + 'so', '#' + ID_PREFIX + 'send-one', function() {
        Sender.sendCurrent();
      });

      // Skip one squad
      $(document).off('click.' + ID_PREFIX + 'sk').on('click.' + ID_PREFIX + 'sk', '#' + ID_PREFIX + 'skip-one', function() {
        Sender.skipCurrent();
      });

      // Cancel session
      $(document).off('click.' + ID_PREFIX + 'cs').on('click.' + ID_PREFIX + 'cs', '#' + ID_PREFIX + 'cancel-send', function() {
        Sender.cancelSession();
      });

      // Enter key sends current squad
      $(document).off('keydown.' + ID_PREFIX + 'enter').on('keydown.' + ID_PREFIX + 'enter', function(e) {
        if (e.key === 'Enter' && AppState.sendSessionActive && !Sender.isBusy()) {
          e.preventDefault();
          Sender.sendCurrent();
        }
      });
    },

    // ----------------------------------------------------------
    // TAB 2: SETTINGS
    // ----------------------------------------------------------

    /**
     * Render the settings tab with unit selection, keep-home, and tier priority.
     */
    renderSettingsTab: function() {
      var html = '';

      // Unit type selection
      html += '<div class="twsc-section">';
      html += '<div class="twsc-section-title">Troop Types to Use</div>';
      html += '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:8px;">';
      ALL_UNIT_TYPES.forEach(function(u) {
        var checked = Settings.unitTypes.indexOf(u) !== -1 ? ' checked' : '';
        html += '<label class="twsc-radio"><input type="checkbox" class="' + ID_PREFIX + 'unit-cb" data-unit="' + u + '"' +
                checked + '> ' + u.charAt(0).toUpperCase() + u.slice(1) + '</label>';
      });
      html += '</div></div>';

      // Global keep-home
      html += '<div class="twsc-section">';
      html += '<div class="twsc-section-title">Global Keep-Home (minimum reserves per village)</div>';
      html += '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">';
      ALL_UNIT_TYPES.forEach(function(u) {
        var val = Settings.keepHome[u] || 0;
        html += '<div style="display:flex;flex-direction:column;align-items:center;">';
        html += '<label style="font-size:10px;color:#a89050;text-transform:capitalize;">' + u + '</label>';
        html += '<input type="number" class="twsc-input twsc-input-sm ' + ID_PREFIX + 'keep-global" data-unit="' + u + '" ' +
                'value="' + val + '" min="0" step="10">';
        html += '</div>';
      });
      html += '</div></div>';

      // Per-village keep-home
      html += '<div class="twsc-section">';
      html += '<div class="twsc-section-title" style="display:flex;justify-content:space-between;align-items:center;">';
      html += '<span>Per-Village Keep-Home Overrides</span>';
      html += '<button class="twsc-btn twsc-btn-sm twsc-btn-outline" id="' + ID_PREFIX + 'toggle-per-village">Show/Hide</button>';
      html += '</div>';
      html += '<div id="' + ID_PREFIX + 'per-village-wrap" style="display:none;margin-top:8px;max-height:200px;overflow-y:auto;">';

      if (AppState.villages.length > 0) {
        html += '<table class="twsc-table twsc-table-sm"><thead><tr>';
        html += '<th>Village</th>';
        ALL_UNIT_TYPES.forEach(function(u) {
          html += '<th style="width:60px;">' + u.charAt(0).toUpperCase() + '</th>';
        });
        html += '</tr></thead><tbody>';

        AppState.villages.forEach(function(v) {
          html += '<tr>';
          html += '<td>' + UI._esc(v.name || 'Village ' + v.id) + '</td>';
          ALL_UNIT_TYPES.forEach(function(u) {
            var perV = Settings.keepHomePerVillage[v.id] || {};
            var val = typeof perV[u] === 'number' ? perV[u] : '';
            html += '<td><input type="number" class="twsc-input twsc-input-xs ' + ID_PREFIX + 'keep-pv" ' +
                    'data-vid="' + v.id + '" data-unit="' + u + '" value="' + val + '" min="0" step="10" ' +
                    'placeholder="-"></td>';
          });
          html += '</tr>';
        });

        html += '</tbody></table>';
      } else {
        html += '<div style="color:#555;font-size:12px;">Load villages on the Scavenge tab first.</div>';
      }
      html += '</div></div>';

      // Tier priority
      html += '<div class="twsc-section">';
      html += '<div class="twsc-section-title">Tier Priority (drag to reorder — top = highest priority)</div>';
      html += '<div id="' + ID_PREFIX + 'tier-priority" style="margin-top:8px;">';
      Settings.tierPriority.forEach(function(t, idx) {
        html += '<div class="twsc-tier-item" data-tier="' + t + '" draggable="true">';
        html += '<span class="twsc-drag-handle">&#9776;</span> ';
        html += 'Tier ' + t;
        html += '<span style="color:#555;margin-left:8px;font-size:11px;">' + UI._getTierDescription(t) + '</span>';
        html += '</div>';
      });
      html += '</div></div>';

      // Default duration + group
      html += '<div class="twsc-section">';
      html += '<div class="twsc-section-title">Defaults</div>';
      html += '<div style="display:flex;gap:16px;margin-top:8px;flex-wrap:wrap;">';
      html += '<div><label style="font-size:11px;color:#a89050;">Default Duration:</label><br>';
      html += '<input type="text" class="twsc-input" id="' + ID_PREFIX + 'default-dur" value="' +
              UI._formatDurationInput(Settings.defaultDuration) + '" style="width:80px;"></div>';
      html += '<div><label style="font-size:11px;color:#a89050;">Default Group:</label><br>';
      html += '<select class="twsc-select" id="' + ID_PREFIX + 'default-group">';
      AppState.groups.forEach(function(g) {
        var sel = g.id === Settings.defaultGroup ? ' selected' : '';
        html += '<option value="' + g.id + '"' + sel + '>' + UI._esc(g.name) + '</option>';
      });
      html += '</select></div>';
      html += '</div></div>';

      // Training section (suggest only — no auto-POST)
      html += '<div class="twsc-section">';
      html += '<div class="twsc-section-title">Training (Spear + Light Cavalry) — Suggest Mode</div>';

      // Targets
      html += '<div style="display:flex;gap:16px;margin-top:8px;flex-wrap:wrap;">';
      html += '<div><label style="font-size:11px;color:#a89050;">Target Spear / village:</label><br>';
      html += '<input type="number" class="twsc-input" id="' + ID_PREFIX + 'train-spear" value="' +
              Settings.trainTargetSpear + '" min="0" step="100" style="width:80px;"></div>';
      html += '<div><label style="font-size:11px;color:#a89050;">Target LC / village:</label><br>';
      html += '<input type="number" class="twsc-input" id="' + ID_PREFIX + 'train-lc" value="' +
              Settings.trainTargetLC + '" min="0" step="100" style="width:80px;"></div>';
      html += '</div>';

      // Show Suggestions button
      html += '<div style="margin-top:8px;">';
      html += '<button class="twsc-btn twsc-btn-primary" id="' + ID_PREFIX + 'train-suggest-btn">Show Training Suggestions</button>';
      html += '</div>';

      // Suggestions container (populated on button click)
      html += '<div id="' + ID_PREFIX + 'train-suggestions" style="margin-top:8px;"></div>';

      html += '</div>';

      // Save button
      html += '<div style="text-align:right;margin-top:12px;">';
      html += '<button class="twsc-btn twsc-btn-primary" id="' + ID_PREFIX + 'save-settings">Save Settings</button>';
      html += '</div>';

      this._setTabContent('settings', html);
      this._bindSettingsEvents();
    },

    /**
     * Bind events for the settings tab.
     * @private
     */
    _bindSettingsEvents: function() {
      var self = this;

      // Toggle per-village section
      $(document).off('click.' + ID_PREFIX + 'tpv').on('click.' + ID_PREFIX + 'tpv', '#' + ID_PREFIX + 'toggle-per-village', function() {
        $('#' + ID_PREFIX + 'per-village-wrap').toggle();
      });

      // Tier drag-and-drop reordering
      var $container = $('#' + ID_PREFIX + 'tier-priority');
      $container.find('.twsc-tier-item').on('dragstart', function(e) {
        e.originalEvent.dataTransfer.setData('text/plain', $(this).data('tier'));
        $(this).addClass('twsc-dragging');
      });
      $container.find('.twsc-tier-item').on('dragend', function() {
        $(this).removeClass('twsc-dragging');
      });
      $container.find('.twsc-tier-item').on('dragover', function(e) {
        e.preventDefault();
        $(this).addClass('twsc-drag-over');
      });
      $container.find('.twsc-tier-item').on('dragleave', function() {
        $(this).removeClass('twsc-drag-over');
      });
      $container.find('.twsc-tier-item').on('drop', function(e) {
        e.preventDefault();
        $(this).removeClass('twsc-drag-over');
        var draggedTier = parseInt(e.originalEvent.dataTransfer.getData('text/plain'), 10);
        var targetTier = parseInt($(this).data('tier'), 10);

        if (draggedTier !== targetTier) {
          // Reorder Settings.tierPriority
          var fromIdx = Settings.tierPriority.indexOf(draggedTier);
          var toIdx = Settings.tierPriority.indexOf(targetTier);
          Settings.tierPriority.splice(fromIdx, 1);
          Settings.tierPriority.splice(toIdx, 0, draggedTier);
          self.renderSettingsTab();
        }
      });

      // Train suggest button
      $(document).off('click.' + ID_PREFIX + 'tr').on('click.' + ID_PREFIX + 'tr', '#' + ID_PREFIX + 'train-suggest-btn', function() {
        self._handleTrainSuggest();
      });

      // Save settings button
      $(document).off('click.' + ID_PREFIX + 'ss').on('click.' + ID_PREFIX + 'ss', '#' + ID_PREFIX + 'save-settings', function() {
        // Read unit type checkboxes
        Settings.unitTypes = [];
        $('.' + ID_PREFIX + 'unit-cb:checked').each(function() {
          Settings.unitTypes.push($(this).data('unit'));
        });

        // Read global keep-home
        Settings.keepHome = {};
        $('.' + ID_PREFIX + 'keep-global').each(function() {
          var unit = $(this).data('unit');
          var val = parseInt($(this).val(), 10) || 0;
          if (val > 0) Settings.keepHome[unit] = val;
        });

        // Read per-village keep-home
        Settings.keepHomePerVillage = {};
        $('.' + ID_PREFIX + 'keep-pv').each(function() {
          var vid = $(this).data('vid');
          var unit = $(this).data('unit');
          var val = $(this).val().trim();
          if (val !== '') {
            if (!Settings.keepHomePerVillage[vid]) {
              Settings.keepHomePerVillage[vid] = {};
            }
            Settings.keepHomePerVillage[vid][unit] = parseInt(val, 10) || 0;
          }
        });

        // Read default duration
        var durVal = $('#' + ID_PREFIX + 'default-dur').val().trim();
        var durSec = UI._parseDurationInput(durVal);
        if (durSec > 0) Settings.defaultDuration = durSec;

        // Read default group
        Settings.defaultGroup = $('#' + ID_PREFIX + 'default-group').val();

        // Read training settings
        Settings.trainTargetSpear = parseInt($('#' + ID_PREFIX + 'train-spear').val(), 10) || 0;
        Settings.trainTargetLC = parseInt($('#' + ID_PREFIX + 'train-lc').val(), 10) || 0;

        Settings.save();
        TWTools.UI.toast('Settings saved', 'success');
      });
    },

    /**
     * Handle the Show Training Suggestions button click.
     * Reads current targets from inputs, builds suggestions, and renders a table
     * with direct links to barracks/stable pages (no auto-POST).
     * @private
     */
    _handleTrainSuggest: function() {
      // Read targets from current inputs
      Settings.trainTargetSpear = parseInt($('#' + ID_PREFIX + 'train-spear').val(), 10) || 0;
      Settings.trainTargetLC = parseInt($('#' + ID_PREFIX + 'train-lc').val(), 10) || 0;
      Settings.save();

      var checkedVillages = AppState.villages.filter(function(v) { return v.checked; });
      if (checkedVillages.length === 0) {
        TWTools.UI.toast('No villages selected — select villages on the Scavenge tab', 'warning');
        return;
      }

      var suggestions = Trainer.buildSuggestions(checkedVillages);
      var $container = $('#' + ID_PREFIX + 'train-suggestions');

      if (suggestions.length === 0) {
        $container.html('<div style="padding:8px;color:#4caf50;font-size:12px;">All selected villages already meet targets.</div>');
        return;
      }

      var html = '';
      html += '<div style="font-size:11px;color:#a89050;margin-bottom:4px;">' +
              suggestions.length + ' village(s) need training. Click links to open barracks/stable:</div>';
      html += '<div style="max-height:250px;overflow-y:auto;border:1px solid #333;border-radius:4px;">';
      html += '<table class="twsc-table twsc-table-sm"><thead><tr>';
      html += '<th>Village</th>';
      html += '<th>Spear</th>';
      html += '<th>LC</th>';
      html += '</tr></thead><tbody>';

      suggestions.forEach(function(s) {
        html += '<tr>';
        // Village name + coords
        html += '<td>';
        html += '<span class="twsc-village-name">' + UI._esc(s.villageName) + '</span>';
        html += ' <span class="twsc-coords">' + s.coordStr + '</span>';
        html += '</td>';

        // Spear column: current/target + Train link
        html += '<td>';
        var spearColor = s.needSpear ? '#f44336' : '#4caf50';
        html += '<span style="color:' + spearColor + ';">' + s.curSpear + '</span>';
        html += '/' + s.targetSpear;
        if (s.needSpear) {
          html += ' <a href="' + s.barracksUrl + '" target="_blank" ' +
                  'style="color:#e0c882;text-decoration:none;font-weight:bold;font-size:11px;" ' +
                  'title="Open barracks for this village">[Train &rarr;]</a>';
        }
        html += '</td>';

        // LC column: current/target + Train link
        html += '<td>';
        var lcColor = s.needLC ? '#f44336' : '#4caf50';
        html += '<span style="color:' + lcColor + ';">' + s.curLC + '</span>';
        html += '/' + s.targetLC;
        if (s.needLC) {
          html += ' <a href="' + s.stableUrl + '" target="_blank" ' +
                  'style="color:#e0c882;text-decoration:none;font-weight:bold;font-size:11px;" ' +
                  'title="Open stable for this village">[Train &rarr;]</a>';
        }
        html += '</td>';

        html += '</tr>';
      });

      html += '</tbody></table></div>';
      $container.html(html);
    },

    // ----------------------------------------------------------
    // HELPERS
    // ----------------------------------------------------------

    /**
     * Parse a duration input string. Accepts "8" (hours), "8:00" (HH:MM), "8:30" (8.5h).
     * @private
     * @param {string} val - Duration input string.
     * @returns {number} Duration in seconds, or 0 if invalid.
     */
    _parseDurationInput: function(val) {
      val = (val || '').trim();
      if (!val) return 0;

      // HH:MM format
      var parts = val.split(':');
      if (parts.length === 2) {
        var h = parseInt(parts[0], 10) || 0;
        var m = parseInt(parts[1], 10) || 0;
        return (h * 3600) + (m * 60);
      }

      // Pure number = hours
      var num = parseFloat(val);
      if (!isNaN(num) && num > 0) {
        return Math.round(num * 3600);
      }

      return 0;
    },

    /**
     * Format seconds to "H:MM" for the duration input.
     * @private
     * @param {number} sec - Duration in seconds.
     * @returns {string} Formatted duration string.
     */
    _formatDurationInput: function(sec) {
      var h = Math.floor(sec / 3600);
      var m = Math.floor((sec % 3600) / 60);
      return h + ':' + TWTools.pad2(m);
    },

    /**
     * Get a short description for a tier number.
     * @private
     * @param {number} tier - Tier number (1-4).
     * @returns {string} Description text.
     */
    _getTierDescription: function(tier) {
      var descs = {
        1: 'Short — low loot, fast',
        2: 'Medium — moderate loot',
        3: 'Long — good loot',
        4: 'Longest — highest loot'
      };
      return descs[tier] || '';
    },

    /**
     * Escape HTML to prevent XSS.
     * @private
     * @param {string} str - Raw string.
     * @returns {string} HTML-escaped string.
     */
    _esc: function(str) {
      var div = document.createElement('div');
      div.appendChild(document.createTextNode(str || ''));
      return div.innerHTML;
    }
  };

  // ============================================================
  // STYLES
  // ============================================================

  /**
   * Inject scavenge-specific CSS styles.
   */
  function injectStyles() {
    if (document.getElementById(ID_PREFIX + 'styles')) return;

    var css =
      '.twsc-select{background:#2a2a2a;border:1px solid #555;color:#e0d8c0;padding:5px 8px;font-size:12px;border-radius:3px;}' +
      '.twsc-input{background:#2a2a2a;border:1px solid #555;color:#e0d8c0;padding:5px 8px;font-size:12px;border-radius:3px;outline:none;box-sizing:border-box;}' +
      '.twsc-input:focus{border-color:#e0c882;}' +
      '.twsc-input-sm{width:60px;text-align:center;}' +
      '.twsc-input-xs{width:50px;text-align:center;padding:3px 4px;font-size:11px;}' +
      '.twsc-btn{background:#555;color:#e0d8c0;border:none;padding:5px 12px;font-size:12px;cursor:pointer;border-radius:3px;}' +
      '.twsc-btn:hover{background:#666;}' +
      '.twsc-btn-sm{padding:3px 8px;font-size:11px;}' +
      '.twsc-btn-outline{background:transparent;border:1px solid #555;}' +
      '.twsc-btn-outline:hover{background:rgba(255,255,255,0.05);}' +
      '.twsc-btn-primary{background:#4a6b3a;color:#fff;font-weight:bold;}' +
      '.twsc-btn-primary:hover{background:#5a7b4a;}' +
      '.twsc-btn-primary:disabled{opacity:0.5;cursor:not-allowed;}' +
      '.twsc-radio{font-size:12px;color:#e0d8c0;cursor:pointer;display:inline-flex;align-items:center;gap:3px;}' +
      '.twsc-table{width:100%;border-collapse:collapse;font-size:12px;color:#e0d8c0;}' +
      '.twsc-table th{background:#1a1a1a;color:#a89050;padding:6px 8px;text-align:left;font-size:11px;text-transform:uppercase;position:sticky;top:0;z-index:1;}' +
      '.twsc-table td{padding:5px 8px;border-bottom:1px solid #2a2a2a;}' +
      '.twsc-table tr:hover td{background:rgba(255,255,255,0.03);}' +
      '.twsc-table-sm td{padding:3px 4px;}' +
      '.twsc-table-sm th{padding:4px;font-size:10px;}' +
      '.twsc-row-running td{opacity:0.5;}' +
      '.twsc-village-name{font-weight:bold;}' +
      '.twsc-coords{font-size:11px;color:#8a8070;}' +
      '.twsc-troop-badge{display:inline-block;background:#1a1a1a;border:1px solid #333;border-radius:2px;padding:1px 4px;font-size:10px;margin-right:2px;}' +
      '.twsc-tier-badge{display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:2px;font-size:10px;font-weight:bold;margin-right:2px;background:#1a3a1a;color:#4caf50;}' +
      '.twsc-tier-locked{background:#3a1a1a;color:#f44336;opacity:0.4;}' +
      '.twsc-section{background:#1a1a1a;border:1px solid #333;border-radius:4px;padding:10px;margin-bottom:10px;}' +
      '.twsc-section-title{font-size:11px;color:#a89050;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;}' +
      '.twsc-tier-item{padding:8px 12px;margin-bottom:4px;background:#2a2a2a;border:1px solid #444;border-radius:3px;cursor:grab;font-size:12px;color:#e0d8c0;display:flex;align-items:center;}' +
      '.twsc-tier-item:hover{border-color:#a89050;}' +
      '.twsc-dragging{opacity:0.4;}' +
      '.twsc-drag-over{border-color:#e0c882;background:#2a2a1a;}' +
      '.twsc-drag-handle{margin-right:8px;color:#555;cursor:grab;}' +
      '.twsc-progress-bar{width:100%;height:8px;background:#1a1a1a;border:1px solid #333;border-radius:4px;overflow:hidden;}' +
      '.twsc-progress-fill{height:100%;background:#4a6b3a;width:0%;transition:width 0.3s ease;}' +
      '.twsc-train-link{color:#e0c882;text-decoration:none;font-weight:bold;font-size:11px;}' +
      '.twsc-train-link:hover{color:#fff;text-decoration:underline;}' +
      '';

    var style = document.createElement('style');
    style.id = ID_PREFIX + 'styles';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================

  /**
   * Auto-launch flag key in localStorage.
   * Set before redirect so the script auto-opens after page load.
   * @type {string}
   */
  var AUTO_LAUNCH_KEY = STORAGE_PREFIX + 'auto_launch';

  /**
   * Redirect to the mass scavenge page if not already there.
   * Sets a localStorage flag so the script auto-opens after redirect.
   * @returns {boolean} True if redirecting (caller should abort).
   */
  function redirectToMassScavenge() {
    if (ScavengeParser.isOnMassScavengePage()) return false;

    // Build mass scavenge URL for the current village
    var villageId = TWTools.getVillageId();
    var baseUrl = window.location.pathname;
    var newUrl = baseUrl + '?village=' + villageId + '&screen=place&mode=scavenge_mass';

    // Set auto-launch flag so we open the UI after page loads
    try { localStorage.setItem(AUTO_LAUNCH_KEY, '1'); } catch (e) {}

    window.location.href = newUrl;
    return true;
  }

  /**
   * Check if script should auto-launch (after redirect).
   * Consumes the flag on check.
   * @returns {boolean} True if auto-launch was requested.
   */
  function checkAutoLaunch() {
    try {
      var flag = localStorage.getItem(AUTO_LAUNCH_KEY);
      if (flag) {
        localStorage.removeItem(AUTO_LAUNCH_KEY);
        return true;
      }
    } catch (e) {}
    return false;
  }

  function init() {
    // Verify TWTools is loaded
    if (typeof window.TWTools === 'undefined') {
      alert('[Mass Scavenge] Error: TWTools core library not loaded.');
      return;
    }

    // Verify we are on a TW game page
    if (typeof game_data === 'undefined') {
      alert('[Mass Scavenge] Error: Not on a Tribal Wars game page.');
      return;
    }

    // Redirect to mass scavenge page if not already there
    if (redirectToMassScavenge()) return;

    injectStyles();
    UI.show();
  }

  // Auto-run on load (quickbar click or auto-launch after redirect)
  function tryInit() {
    if (checkAutoLaunch() || typeof window._twsc_manual_launch !== 'undefined') {
      init();
    }
  }

  // If launched from quickbar, run immediately; if auto-launch, wait for DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      if (checkAutoLaunch()) {
        init();
      }
    });
  } else {
    // Direct quickbar execution — check for auto-launch first, otherwise normal init
    if (checkAutoLaunch()) {
      init();
    } else {
      init();
    }
  }

})(window, typeof jQuery !== 'undefined' ? jQuery : null);
