// Validated config singleton. Import this instead of reading config.json
// directly — validation runs once at module load so every fetcher gets the
// same parsed + frozen object and malformed config fails loudly at startup
// rather than as three separate cryptic errors inside each fetcher.
//
// Lens-aware: the default export is the merged config, where each enabled
// lens's sources_overlay (feeds + github_topics) has been unioned (deduped)
// into the global sources. This means fetchers receive the union of all
// lenses' sources automatically — no per-fetcher overlay-merging needed.
// Items emitted to staging are tagged with _scope per src/lib/scope.js so
// Stage 2 can filter back to per-lens views.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigSchema } from '../schemas/config.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CONFIG_PATH = path.join(REPO_ROOT, 'config.json');

/**
 * Union the global sources with each enabled lens's sources_overlay.
 * Deduped by `${type}:${name}` for feeds and by topic string for topics.
 * Returns a NEW config object (does not mutate input).
 */
export function mergeOverlaySources(rawConfig) {
  const allFeeds = [...rawConfig.sources.feeds];
  const seenFeedKeys = new Set(allFeeds.map((f) => `${f.type}:${f.name}`));

  // Topics support two shapes (legacy flat + new tier).
  const baseTopics = rawConfig.sources.github_topics;
  const hasTier = Array.isArray(baseTopics.tier?.core);
  const allLegacyTopics = hasTier ? null : [...baseTopics.topics];
  const tierCore = hasTier ? [...baseTopics.tier.core] : null;
  const tierRotating = hasTier ? [...baseTopics.tier.rotating] : null;
  // Single dedupe set across both legacy and tier — overlay topics shouldn't
  // double-count if they're already part of core/rotating.
  const seenTopics = new Set([
    ...(allLegacyTopics ?? []),
    ...(tierCore ?? []),
    ...(tierRotating ?? []),
  ]);

  for (const lens of rawConfig.lenses || []) {
    if (lens.enabled === false) continue;
    const overlay = lens.sources_overlay || {};

    for (const feed of overlay.feeds || []) {
      const key = `${feed.type}:${feed.name}`;
      if (!seenFeedKeys.has(key)) {
        allFeeds.push(feed);
        seenFeedKeys.add(key);
      }
    }

    for (const topic of overlay.github_topics?.topics || []) {
      if (!seenTopics.has(topic)) {
        seenTopics.add(topic);
        if (hasTier) {
          // Lens overlay topics go into the rotating pool — they're not
          // promoted to core (core is reserved for the most-essential daily set).
          tierRotating.push(topic);
        } else {
          allLegacyTopics.push(topic);
        }
      }
    }
  }

  const mergedGithubTopics = hasTier
    ? { ...baseTopics, tier: { core: tierCore, rotating: tierRotating } }
    : { ...baseTopics, topics: allLegacyTopics };

  return {
    ...rawConfig,
    sources: {
      ...rawConfig.sources,
      feeds: allFeeds,
      github_topics: mergedGithubTopics,
    },
  };
}

const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const parsed = ConfigSchema.parse(raw);
const merged = mergeOverlaySources(parsed);

export default Object.freeze(merged);
