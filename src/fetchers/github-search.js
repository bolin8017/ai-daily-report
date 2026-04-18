#!/usr/bin/env node

// GitHub Search by topic — uses Octokit REST search API.
//
// Query strategy: freshness-first. The original `pushed:>yesterday` filter
// returned long-lived heavyweights (langchain, ShareX, etc.) whose nightly
// CI commits made them look "active today" while having zero real news
// value. We now use `created:>30d` + `stars:>100` to surface genuinely new
// topic-relevant repos, and enrich each result with a README excerpt so
// the agent has context to evaluate them as discovery picks for shipped.
//
// Octokit's throttling and retry plugins (bundled in the `octokit` meta
// package) handle rate limiting and transient failures for free.
//
// Two usage modes:
//   - Import: `import { fetchSearch } from './github-search.js'`
//   - Standalone: `node src/fetchers/github-search.js > tmp/github-search.json`

import config from '../lib/config.js';
import { getReadmeExcerpt, makeOctokit } from '../lib/github.js';
import { runAsStandalone } from './_dispatch.js';

const LOG_PREFIX = 'github-search';
const TOPICS_CONFIG = config.sources.github_topics;
const LIMIT = TOPICS_CONFIG.limit_per_topic ?? 10;
const TOPICS = TOPICS_CONFIG.topics ?? [];
const MIN_STARS = 100;
const CREATED_WINDOW_DAYS = 30;
const README_BATCH_SIZE = 5;

function createdSinceISO() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - CREATED_WINDOW_DAYS);
  return d.toISOString().slice(0, 10);
}

// Returns null on failure so main() can distinguish "topic had zero results"
// from "topic errored out". This lets the ok field reflect real success rate
// instead of always being true.
async function searchTopic(octokit, topic, since) {
  const q = `topic:${topic} stars:>${MIN_STARS} created:>${since}`;
  try {
    const { data } = await octokit.rest.search.repos({
      q,
      sort: 'stars',
      order: 'desc',
      per_page: LIMIT,
    });

    const rawItems = data.items || [];
    const items = [];

    // Enrich READMEs in batches of README_BATCH_SIZE to stay polite with
    // GitHub's secondary rate limit. Per topic, at most LIMIT/BATCH_SIZE
    // sequential bursts of README_BATCH_SIZE parallel calls.
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

export async function fetchSearch() {
  if (!TOPICS_CONFIG.enabled) {
    return { ok: true, items: [] };
  }

  const octokit = makeOctokit();
  const since = createdSinceISO();
  const allItems = [];
  let topicsOk = 0;
  let topicsTotal = 0;

  // Sequential: GitHub search has stricter limits (30/min auth, 10/min unauth)
  // than core REST. With <20 configured topics this stays well under quota.
  for (const topic of TOPICS) {
    if (!topic) continue;
    topicsTotal++;
    const items = await searchTopic(octokit, topic, since);
    if (items !== null) {
      topicsOk++;
      allItems.push(...items);
    }
  }

  // Empty topics list is a valid config, not a failure
  if (topicsTotal === 0) {
    return { ok: true, items: [] };
  }

  // Require at least half the topics to succeed, mirroring feeds.js threshold
  const okThreshold = Math.max(1, Math.ceil(topicsTotal / 2));
  return {
    ok: topicsOk >= okThreshold,
    items: allItems,
    topics_ok: topicsOk,
    topics_total: topicsTotal,
  };
}

runAsStandalone(import.meta.url, fetchSearch);
