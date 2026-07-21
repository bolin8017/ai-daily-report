// URL + date helpers for the 11ty build (eleventy.config.js / feed.njk).
//
// Report JSON is LLM-produced from scraped feeds, so url fields are untrusted:
// Nunjucks autoescape prevents attribute breakout, but a javascript: href
// would otherwise be stopped only by the page CSP. scrubUrls removes any
// non-http(s) url-named field at data-load time so the protection doesn't
// rest on a single header staying strict.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * @param {unknown} value
 * @returns {string|null} the URL if it parses with an http/https scheme, else null
 */
export function safeHttpUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Walk a report object in place and delete every string field whose key ends
 * in "url" (url, hn_url, lobsters_url, …) that is not an http(s) URL, so
 * templates' `{% if item.url %}` guards render no link instead of a
 * javascript: href.
 * @param {unknown} node
 */
export function scrubUrls(node) {
  if (Array.isArray(node)) {
    for (const child of node) scrubUrls(child);
    return;
  }
  if (!node || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string' && /url$/i.test(key)) {
      if (safeHttpUrl(value) === null) delete node[key];
    } else {
      scrubUrls(value);
    }
  }
}

/**
 * RSS 2.0 requires RFC-822 dates; the feed publishes each report at a nominal
 * 08:00 Taipei time.
 * @param {string} dateStr YYYY-MM-DD
 * @returns {string} e.g. "Tue, 21 Jul 2026 08:00:00 +0800"
 */
export function rfc822Date(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = DAYS[d.getUTCDay()];
  const dom = String(d.getUTCDate()).padStart(2, '0');
  return `${day}, ${dom} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} 08:00:00 +0800`;
}
