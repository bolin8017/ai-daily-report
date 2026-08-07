// Fourth candidate source for the 新發現 excellence funnel: GitHub repos the
// community feeds already surfaced (HN, Lobsters, blogs).
//
// Why it exists: GitHub topic search and HN's front page are near-disjoint. On
// 2026-08-07 the feed corpus carried 4 GitHub repos on HN — none of them was in
// that day's 45-repo search/trending/developers pool. The funnel therefore never
// saw the repos people were actually reading about, and externalValidation, which
// can only corroborate a repo the GitHub fetchers already returned, had gone 20
// consecutive reports without a single hit.
//
// The items produced here carry the same shape as the github-search provider's,
// so every existing gate (freeGates age/license/staleness, velocity, engineering)
// applies unchanged — this widens the intake, it does not relax the bar.

// Repo names may contain dots; the trailing-punctuation trim below handles prose
// like "see github.com/o/repo." without eating a legitimate ".js" suffix.
// Case-insensitive for the host: prose writes "GitHub.com" and externalValidation
// (which now shares this parser) used to catch those by lowercasing the whole
// haystack before its substring test.
const REPO_URL_RE = /github\.com\/([A-Za-z0-9][\w-]*)\/([\w.-]+)/gi;

// First path segments that are GitHub's own routes, not repo owners.
const RESERVED_OWNERS = new Set([
  'about',
  'account',
  'apps',
  'blog',
  'codespaces',
  'collections',
  'contact',
  'customer-stories',
  'dashboard',
  'enterprise',
  'events',
  'explore',
  'features',
  'join',
  'login',
  'marketplace',
  'new',
  'notifications',
  'organizations',
  'orgs',
  'pricing',
  'pulls',
  'search',
  'security',
  'settings',
  'site',
  'sponsors',
  'topics',
  'trending',
  'users',
]);

const DEFAULT_LIMIT = 40;
const FETCH_BATCH_SIZE = 5;

/**
 * Every distinct "owner/repo" a blob of text links to on github.com, in the
 * casing the text used. Route paths (`/sponsors/x`, `/topics/y`) are excluded
 * and a trailing `.git` or prose full-stop is trimmed.
 *
 * Shared with excellence.js's externalValidation so intake and validation agree
 * on what counts as a mention of a given repo: validation used to substring-test
 * `github.com/<owner>/<repo>`, which credited any repo whose name was a prefix
 * of the mentioned one (`openai/gpt` matched a link to `openai/gpt-oss`).
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function repoMentionsIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(REPO_URL_RE)) {
    const owner = m[1];
    if (RESERVED_OWNERS.has(owner.toLowerCase())) continue;
    const repo = m[2].replace(/\.git$/i, '').replace(/[.]+$/, '');
    if (!repo) continue;
    out.add(`${owner}/${repo}`);
  }
  return out;
}

/**
 * Scan already-fetched feed items for GitHub repo mentions.
 *
 * Pure. Ranks by how many distinct feed sources mentioned a repo (two
 * independent write-ups beat one), then by name so the cap is deterministic.
 *
 * @param {{source:string, url?:string, title?:string, description?:string}[]} feedItems
 * @param {{limit?: number}} [opts]
 * @returns {{ mentions: {full_name:string, mentioned_by:string[]}[], dropped: number }}
 */
export function extractRepoMentions(feedItems, { limit = DEFAULT_LIMIT } = {}) {
  const byName = new Map();

  for (const item of feedItems ?? []) {
    const hay = `${item?.url ?? ''} ${item?.title ?? ''} ${item?.description ?? ''}`;
    for (const fullName of repoMentionsIn(hay)) {
      if (!byName.has(fullName)) byName.set(fullName, new Set());
      if (item?.source) byName.get(fullName).add(item.source);
    }
  }

  const all = [...byName.entries()]
    .map(([full_name, sources]) => ({ full_name, mentioned_by: [...sources].sort() }))
    .sort(
      (a, b) =>
        b.mentioned_by.length - a.mentioned_by.length || (a.full_name < b.full_name ? -1 : 1),
    );

  return { mentions: all.slice(0, limit), dropped: Math.max(0, all.length - limit) };
}

/**
 * Resolve mentions into funnel candidate items. Fetchers are injected so tests
 * run without network. Fail-soft per repo: an unresolvable repo is skipped, a
 * failed readme degrades to an empty excerpt.
 *
 * @param {object} opts
 * @param {{full_name:string, mentioned_by:string[]}[]} opts.mentions
 * @param {(fullName:string) => Promise<object|null>} opts.fetchRepo
 * @param {(fullName:string) => Promise<string>} opts.fetchReadme
 * @returns {Promise<object[]>}
 */
export async function buildFeedRepoItems({ mentions, fetchRepo, fetchReadme }) {
  const items = [];

  for (let i = 0; i < (mentions?.length ?? 0); i += FETCH_BATCH_SIZE) {
    const batch = mentions.slice(i, i + FETCH_BATCH_SIZE);
    const resolved = await Promise.all(
      batch.map(async (mention) => {
        let repo;
        try {
          repo = await fetchRepo(mention.full_name);
        } catch {
          return null;
        }
        if (!repo?.full_name) return null;

        let readmeExcerpt = '';
        try {
          readmeExcerpt = (await fetchReadme(mention.full_name)) ?? '';
        } catch {
          readmeExcerpt = '';
        }

        return {
          source: 'github-feed',
          full_name: repo.full_name,
          url: repo.html_url || `https://github.com/${repo.full_name}`,
          description: repo.description || '',
          language: repo.language ?? null,
          stars: repo.stargazers_count || 0,
          forks: repo.forks_count || 0,
          open_issues: repo.open_issues_count || 0,
          created_at: repo.created_at || '',
          pushed_at: repo.pushed_at || '',
          readme_excerpt: readmeExcerpt,
          default_branch: repo.default_branch || null,
          license: repo.license?.spdx_id ?? null,
          fork: repo.fork ?? false,
          mentioned_by: mention.mentioned_by,
        };
      }),
    );
    items.push(...resolved.filter(Boolean));
  }

  return items;
}
