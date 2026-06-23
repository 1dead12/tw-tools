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
 *     headers:     [{ text, iconSrc, cssClass, colIndex }],
 *     rows:        [{ cells: [{ text, iconSrc, cssClass, links: [{ href, text }] }] }],
 *     hasNextPage: boolean,
 *     infoBoxText: string
 *   }
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
      cells.push({
        text: stripTags(cellHtml),
        iconSrc: firstImgSrc(cellHtml),
        cssClass: classOfTag(openTag),
        links: parseLinks(cellHtml)
      });
    }
    if (isHeaderRow && headers.length === 0) {
      headers = cells.map(function (cell, i) {
        return { text: cell.text, iconSrc: cell.iconSrc, cssClass: cell.cssClass, colIndex: i };
      });
    } else if (cells.length) {
      rows.push({ cells: cells });
    }
  }

  // Next page exists if a paged-nav-item points forward (>, », or a higher page link).
  const hasNextPage = /class="[^"]*paged-nav-item[^"]*"[^>]*>\s*(?:&gt;|>|»)/i.test(html);

  return { headers: headers, rows: rows, hasNextPage: hasNextPage, infoBoxText: infoBoxText };
}

module.exports = { rowMatrix: rowMatrix, stripTags: stripTags };
