// Catalog-walk provider ("精選"): query 30k+ star repos (AI core topics + a
// general bucket), exclude already-shown repos (seen-repos ledger), and emit a
// stars-ranked candidate pool for the Haiku curator to pick ≤10 from. Written
// raw to staging (no condense) — the pool is small.

import { getReadmeExcerpt, makeOctokit } from '../../lib/github.js';
import { loadInterests } from '../../lib/interests.js';
import { loadSeenSet } from '../../lib/seen-repos.js';
import { getThemeSources } from '../../lib/theme.js';
import { defineProvider } from './_registry.js';

const LOG_PREFIX = 'github-catalog';
const README_BATCH_SIZE = 5;

/** Deduped github topic terms from level:core interests only. */
export function coreTopics(reg) {
  return [
    ...new Set(
      Object.values(reg.interests)
        .filter((e) => e.level === 'core')
        .flatMap((e) => e.github ?? []),
    ),
  ];
}

/**
 * Pure pool shaper: drop seen, dedupe, rank by stars desc, cap each pool, and
 * tag category. General excludes anything already picked into the AI pool.
 * Accepts raw GitHub search items ({full_name, stargazers_count, ...}).
 */
export function shapeCatalogPool({ ai, general, seen, aiPoolSize, generalPoolSize }) {
  const rank = (items) =>
    [...items].sort((a, b) => (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0));
  const take = (items, cap, category, exclude) => {
    const out = [];
    const picked = new Set();
    for (const r of rank(items)) {
      const key = r.full_name;
      if (!key || seen.has(key) || picked.has(key) || exclude.has(key)) continue;
      picked.add(key);
      out.push({ raw: r, full_name: key, stars: r.stargazers_count ?? 0, category });
      if (out.length >= cap) break;
    }
    return out;
  };
  const aiPicked = take(ai, aiPoolSize, 'ai', new Set());
  const aiKeys = new Set(aiPicked.map((r) => r.full_name));
  const generalPicked = take(general, generalPoolSize, 'general', aiKeys);
  return { ai: aiPicked, general: generalPicked };
}

// Returns the result array on success (possibly empty), or null on error so the
// caller can distinguish a failed query from a genuinely-empty one and set `ok`
// proportionally (mirrors github-search-api.js's honest-degradation pattern).
async function searchRepos(octokit, q, perPage) {
  try {
    const { data } = await octokit.rest.search.repos({
      q,
      sort: 'stars',
      order: 'desc',
      per_page: perPage,
    });
    return data.items || [];
  } catch (err) {
    console.error(`[${LOG_PREFIX}] search failed q="${q}": ${err.message}`);
    return null;
  }
}

async function enrich(octokit, shaped) {
  const out = [];
  for (let i = 0; i < shaped.length; i += README_BATCH_SIZE) {
    const batch = shaped.slice(i, i + README_BATCH_SIZE);
    const done = await Promise.all(
      batch.map(async ({ raw, full_name, stars, category }) => {
        const [owner, name] = full_name.split('/');
        const readme =
          owner && name ? await getReadmeExcerpt(octokit, owner, name, LOG_PREFIX) : '';
        return {
          source: 'github-catalog',
          category,
          full_name,
          url: raw.html_url || `https://github.com/${full_name}`,
          description: raw.description || '',
          language: raw.language ?? null,
          stars,
          forks: raw.forks_count ?? 0,
          created_at: raw.created_at || '',
          pushed_at: raw.pushed_at || '',
          readme_excerpt: readme,
        };
      }),
    );
    out.push(...done);
  }
  return out;
}

export async function githubCatalogProvider(_cfg, _ctx) {
  // Opt-out only: a theme with no github_catalog block still runs (cfg = {}).
  const cfg = (await getThemeSources()).github_catalog ?? {};
  if (cfg.enabled === false) return { ok: true, items: [] };

  const minStars = cfg.min_stars ?? 30000;
  const aiPoolSize = cfg.ai_pool_size ?? 40;
  const generalPoolSize = cfg.general_pool_size ?? 15;
  const perTopic = cfg.per_topic ?? 30;

  const reg = await loadInterests();
  const topics = coreTopics(reg);
  const octokit = makeOctokit({ requireAuth: true });
  const seen = loadSeenSet();

  let queriesOk = 0;
  let queriesTotal = 0;

  const ai = [];
  for (const t of topics) {
    queriesTotal++;
    const res = await searchRepos(octokit, `topic:${t} stars:>=${minStars}`, perTopic);
    if (res !== null) {
      queriesOk++;
      ai.push(...res);
    }
  }

  queriesTotal++;
  // Over-fetch the general bucket to absorb seen-repo + AI-pool exclusions
  // before capping to generalPoolSize.
  const generalRes = await searchRepos(
    octokit,
    `stars:>=${minStars}`,
    Math.min(100, generalPoolSize + aiPoolSize + 20),
  );
  const general = generalRes ?? [];
  if (generalRes !== null) queriesOk++;

  const shaped = shapeCatalogPool({ ai, general, seen, aiPoolSize, generalPoolSize });
  const items = await enrich(octokit, [...shaped.ai, ...shaped.general]);

  // ok is false only when the fetch genuinely failed (majority of queries
  // errored) — an empty pool from a successful run (catalog exhausted) is ok:true.
  const ok = queriesTotal === 0 || queriesOk >= Math.ceil(queriesTotal / 2);
  return { ok, items, ai_count: shaped.ai.length, general_count: shaped.general.length };
}

defineProvider('github-catalog', githubCatalogProvider);
