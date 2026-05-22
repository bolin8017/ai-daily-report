import config from '../../lib/config.js';
import { getReadmeExcerpt, makeOctokit } from '../../lib/github.js';
import { defineProvider } from './_registry.js';

const LOG_PREFIX = 'github-search';
const MIN_STARS = 100;
const CREATED_WINDOW_DAYS = 30;
const README_BATCH_SIZE = 5;

export function selectTopicsForDate(topicsConfig, dateString) {
  if (Array.isArray(topicsConfig.topics)) {
    return [...topicsConfig.topics];
  }
  const { tier, rotation } = topicsConfig;
  const seed = hashDate(dateString);
  const picks = pickRotating(tier.rotating, rotation.rotating_per_day, seed);
  return [...tier.core, ...picks];
}

function hashDate(dateString) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < dateString.length; i++) {
    h = Math.imul(h ^ dateString.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function pickRotating(pool, n, seed) {
  const out = [];
  const seen = new Set();
  const len = pool.length;
  let s = seed;
  while (seen.size < Math.min(n, len)) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const idx = s % len;
    if (!seen.has(idx)) {
      seen.add(idx);
      out.push(pool[idx]);
    }
  }
  return out;
}

function todayInTz() {
  const tz = process.env.REPORT_TIMEZONE ?? 'Asia/Taipei';
  return new Date().toLocaleDateString('sv-SE', { timeZone: tz });
}

function createdSinceISO() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - CREATED_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

async function searchTopic(octokit, topic, since, limit) {
  const q = `topic:${topic} stars:>${MIN_STARS} created:>${since}`;
  try {
    const { data } = await octokit.rest.search.repos({
      q,
      sort: 'stars',
      order: 'desc',
      per_page: limit,
    });

    const rawItems = data.items || [];
    const items = [];

    for (let i = 0; i < rawItems.length; i += README_BATCH_SIZE) {
      const batch = rawItems.slice(i, i + README_BATCH_SIZE);
      const enriched = await Promise.all(
        batch.map(async (r) => {
          const [owner, name] = (r.full_name || '').split('/');
          const readmeExcerpt =
            owner && name ? await getReadmeExcerpt(octokit, owner, name, LOG_PREFIX) : '';
          return {
            source: 'github-search',
            topic,
            full_name: r.full_name || '',
            url: r.html_url || '',
            description: r.description || '',
            language: r.language,
            stars: r.stargazers_count || 0,
            forks: r.forks_count || 0,
            open_issues: r.open_issues_count || 0,
            created_at: r.created_at || '',
            pushed_at: r.pushed_at || '',
            readme_excerpt: readmeExcerpt,
          };
        }),
      );
      items.push(...enriched);
    }

    return items;
  } catch (err) {
    console.error(`[${LOG_PREFIX}] topic="${topic}" failed: ${err.message}`);
    return null;
  }
}

export async function githubSearchApiProvider(_cfg, _ctx) {
  const TOPICS_CONFIG = config.sources.github_topics;
  if (!TOPICS_CONFIG.enabled) {
    return { ok: true, items: [] };
  }

  const topics = selectTopicsForDate(TOPICS_CONFIG, todayInTz());
  const octokit = makeOctokit();
  const since = createdSinceISO();
  const allItems = [];
  let topicsOk = 0;
  let topicsTotal = 0;
  const limit = TOPICS_CONFIG.limit_per_topic ?? 10;

  for (const topic of topics) {
    if (!topic) continue;
    topicsTotal++;
    const items = await searchTopic(octokit, topic, since, limit);
    if (items !== null) {
      topicsOk++;
      allItems.push(...items);
    }
  }

  if (topicsTotal === 0) {
    return { ok: true, items: [] };
  }

  const okThreshold = Math.max(1, Math.ceil(topicsTotal / 2));
  return {
    ok: topicsOk >= okThreshold,
    items: allItems,
    topics_ok: topicsOk,
    topics_total: topicsTotal,
  };
}

defineProvider('github-search-api', githubSearchApiProvider);
