// Canonical "owner/repo" key for a collected or curated item.
//
// Items arrive keyed inconsistently: github-* fetchers carry `full_name`
// ("owner/repo"); shipped curated items render `name` as a bare slug
// ("superpowers") with the owner only in `url`. Deriving one stable key is the
// prerequisite for BOTH the seen-repos dedup ledger and the star-history
// velocity ledger — keying on the bare name silently fails to match
// (see docs/superpowers/specs/2026-06-14-merge-projects-tab-rising-stars-design.md).

const GH_URL = /github\.com\/([^/\s]+\/[^/\s#?]+)/i;

function clean(s) {
  return s.trim().replace(/\.git$/i, '').replace(/\/$/, '');
}

/**
 * @param {{full_name?:string, url?:string, name?:string}|null|undefined} item
 * @returns {string|null} "owner/repo" or null when none can be derived
 */
export function canonicalRepoKey(item) {
  if (!item || typeof item !== 'object') return null;
  if (typeof item.full_name === 'string' && item.full_name.includes('/')) {
    return clean(item.full_name);
  }
  if (typeof item.url === 'string') {
    const m = item.url.match(GH_URL);
    if (m) return clean(m[1]);
  }
  if (typeof item.name === 'string' && item.name.includes('/')) {
    return clean(item.name);
  }
  return null;
}
