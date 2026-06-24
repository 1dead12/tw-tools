'use strict';

/**
 * Dependency-free HTML -> RowMatrix tokenizer for node:test.
 *
 * Produces the SAME normalized shape that the browser-side extractRowMatrix(html, $)
 * adapter yields, so the pure parseOverviewTable(matrix, cfg) in lib/tw-overview-core.js
 * can be exercised headlessly in node without jQuery/jsdom.
 *
 * Shape:
 *   {
 *     headers:     [{ text, iconSrc, cssClass, colIndex, order }],
 *     rows:        [{ cells: [{ text, iconSrc, cssClass, links, colIndex, res } }] }],
 *     hasNextPage: boolean,
 *     infoBoxText: string
 *   }
 *
 *   header.order = the `order=` query param off the header's sort link (e.g. 'points',
 *   'storage_max', 'trader_available', 'pop', 'name'). Language-proof column mapping.
 *   cell.res = { wood, clay, iron } parsed from span.res.wood/.stone/.iron (stone->clay),
 *   present only when such spans exist in the cell.
 *
 * This is a TEST HELPER only — it is intentionally regex-based and small. The browser
 * uses jQuery for the real DOM; this just has to be faithful to the column-mapping and
 * row-grouping contracts the parser depends on (header img src/class, links, coords).
 */

function stripTags(html) {
  return String(html || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function firstImgSrc(html) {
  const m = String(html || '').match(/<img[^>]*\bsrc="([^"]+)"/i);
  return m ? m[1] : '';
}

function classOfTag(openTag) {
  const m = String(openTag || '').match(/\bclass="([^"]*)"/i);
  return m ? m[1] : '';
}

function parseLinks(html) {
  const links = [];
  const re = /<a[^>]*\bhref="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    links.push({ href: m[1], text: stripTags(m[2]) });
  }
  return links;
}

/**
 * Locale-tolerant integer parse (mirror of OverviewCore.parseLocaleNumber): strips
 * whitespace (incl. NBSP) and '.'/',' thousands separators, keeps a leading '-'.
 * @param {*} text
 * @returns {number} 0 on failure.
 */
function parseLocaleNumber(text) {
  if (text === null || text === undefined) return 0;
  let s = String(text).replace(/[\s   ]/g, '').replace(/[.,]/g, '');
  const neg = /^-/.test(s);
  s = s.replace(/[^\d]/g, '');
  if (!s) return 0;
  const n = parseInt(s, 10);
  if (isNaN(n)) return 0;
  return neg ? -n : n;
}

/**
 * Extract the `order=` query param from the first sort link inside a header cell.
 * Language-proof column mapping (e.g. order=points, order=storage_max, order=name).
 * @param {string} cellHtml - Inner HTML of a <th>.
 * @returns {string} order token, or '' when absent.
 */
function headerOrder(cellHtml) {
  // Tolerate raw-HTML entity encoding: href carries `&amp;order=` (char before is ';').
  const m = String(cellHtml || '').match(/[?&;]order=([a-z_]+)/i);
  return m ? m[1] : '';
}

/**
 * Read resource spans (span.res.wood / .res.stone / .res.iron) out of a cell's HTML
 * into { wood, clay, iron } numbers (stone -> clay). Returns null when no res span.
 * @param {string} cellHtml - Inner HTML of a <td>.
 * @returns {?{wood:number, clay:number, iron:number}}
 */
function parseResCell(cellHtml) {
  const html = String(cellHtml || '');
  if (!/class="[^"]*\bres\b/i.test(html)) return null;
  const res = { wood: 0, clay: 0, iron: 0 };
  const re = /<span[^>]*class="([^"]*\bres\b[^"]*)"[^>]*>([\s\S]*?)<\/span>/gi;
  let m;
  let found = false;
  while ((m = re.exec(html))) {
    const cls = m[1];
    const val = parseLocaleNumber(stripTags(m[2]));
    if (/\bwood\b/.test(cls)) { res.wood = val; found = true; }
    else if (/\bstone\b/.test(cls)) { res.clay = val; found = true; } // stone -> clay
    else if (/\bclay\b/.test(cls)) { res.clay = val; found = true; }
    else if (/\biron\b/.test(cls)) { res.iron = val; found = true; }
  }
  return found ? res : null;
}

/**
 * Tokenize an HTML table fragment into a RowMatrix.
 * @param {string} html - Raw HTML (a full page or just a <table> fragment).
 * @returns {{headers: Array, rows: Array, hasNextPage: boolean, infoBoxText: string}}
 */
function rowMatrix(html) {
  html = String(html || '');

  // Empty-group / info box detection (multi-lang text lives inside).
  const ib = html.match(/class="[^"]*info_box[^"]*"[^>]*>([\s\S]*?)<\/(?:div|td|p)>/i);
  const infoBoxText = ib ? stripTags(ib[1]) : '';

  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const cellRe = /<t([hd])\b([^>]*)>([\s\S]*?)<\/t\1>/gi;

  let headers = [];
  const rows = [];
  let tr;
  while ((tr = trRe.exec(html))) {
    const inner = tr[1];
    const cells = [];
    let isHeaderRow = false;
    let c;
    cellRe.lastIndex = 0;
    while ((c = cellRe.exec(inner))) {
      const tagType = c[1]; // 'h' header | 'd' data
      const openTag = '<t' + c[1] + c[2] + '>';
      const cellHtml = c[3];
      if (tagType === 'h') isHeaderRow = true;
      const cell = {
        text: stripTags(cellHtml),
        iconSrc: firstImgSrc(cellHtml),
        cssClass: classOfTag(openTag),
        links: parseLinks(cellHtml),
        order: headerOrder(cellHtml)
      };
      const res = parseResCell(cellHtml);
      if (res) cell.res = res;
      cells.push(cell);
    }
    if (isHeaderRow && headers.length === 0) {
      headers = cells.map(function (cell, i) {
        return {
          text: cell.text,
          iconSrc: cell.iconSrc,
          cssClass: cell.cssClass,
          colIndex: i,
          order: cell.order || ''
        };
      });
    } else if (cells.length) {
      // Re-index data cells with colIndex (parser reads cell.res, keeps fields intact).
      rows.push({
        cells: cells.map(function (cell, i) {
          cell.colIndex = i;
          return cell;
        })
      });
    }
  }

  // Next page exists if a paged-nav-item points forward (>, », or a higher page link).
  const hasNextPage = /class="[^"]*paged-nav-item[^"]*"[^>]*>\s*(?:&gt;|>|»)/i.test(html);

  return { headers: headers, rows: rows, hasNextPage: hasNextPage, infoBoxText: infoBoxText };
}

module.exports = { rowMatrix: rowMatrix, stripTags: stripTags };
