#!/usr/bin/env node
// Apply the OPML feed list to Miniflux (idempotent). Auth via miniflux-client
// (MINIFLUX_TOKEN, or MINIFLUX_USERNAME/MINIFLUX_PASSWORD basic auth).
// Miniflux validates each feed at creation, so an unreachable/invalid feed
// fails that one POST (reported) without aborting the rest.
import { loadFeedList } from '../src/lib/feeds-opml.js';
import { minifluxAuthHeaders, minifluxBaseUrl } from '../src/lib/miniflux-client.js';
import { planMinifluxSync } from '../src/lib/miniflux-sync.js';

const URL_BASE = minifluxBaseUrl();
const AUTH = minifluxAuthHeaders();
if (!URL_BASE || !AUTH) {
  console.error('MINIFLUX_URL + (MINIFLUX_TOKEN or MINIFLUX_USERNAME/MINIFLUX_PASSWORD) required');
  process.exit(1);
}

async function api(path, init = {}) {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: { ...AUTH, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`${init.method ?? 'GET'} ${path} -> HTTP ${res.status} ${body.slice(0, 120)}`);
  }
  return res.status === 204 ? null : res.json();
}

async function main() {
  const opmlFeeds = loadFeedList();
  const existingCategories = await api('/v1/categories');
  const existingFeeds = await api('/v1/feeds');
  const plan = planMinifluxSync({ opmlFeeds, existingFeeds, existingCategories });

  const catId = new Map(existingCategories.map((c) => [c.title, c.id]));
  for (const title of plan.createCategories) {
    const c = await api('/v1/categories', { method: 'POST', body: JSON.stringify({ title }) });
    catId.set(title, c.id);
    console.error(`+ category ${title}`);
  }

  let created = 0;
  const failures = [];
  for (const f of plan.createFeeds) {
    try {
      await api('/v1/feeds', {
        method: 'POST',
        body: JSON.stringify({ feed_url: f.feed_url, category_id: catId.get(f.category) }),
      });
      created++;
      console.error(`+ feed ${f.feed_url}`);
    } catch (e) {
      // Feeds that redirect get stored under their final url, so a re-sync sees
      // the OPML url as "missing" and re-adds it — Miniflux then reports it
      // already exists. Treat that as idempotent success, not a failure.
      if (/duplicat|already exist/i.test(e.message)) {
        console.error(`= exists ${f.feed_url} (already in Miniflux, via redirect)`);
      } else {
        failures.push({ url: f.feed_url, error: e.message });
        console.error(`! FAILED ${f.feed_url}: ${e.message}`);
      }
    }
  }

  if (plan.orphanFeeds.length) {
    console.error(`! ${plan.orphanFeeds.length} feed(s) in Miniflux not in OPML (left as-is):`);
    for (const u of plan.orphanFeeds) console.error(`  - ${u}`);
  }
  console.error(
    `done: +${plan.createCategories.length} categories, +${created} feeds, ${failures.length} failed`,
  );
}

main().catch((e) => {
  console.error(`[miniflux-sync] FATAL: ${e.message}`);
  process.exit(1);
});
