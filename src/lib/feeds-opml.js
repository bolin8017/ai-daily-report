import { readFileSync } from 'node:fs';
import { ACTIVE_THEME } from './config.js';

const OUTLINE_RE = /<outline\b[^>]*?\/?>/g;
const ATTR_RE = /(\w+)="([^"]*)"/g;

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

export function parseOpml(xml) {
  const feeds = [];
  for (const tag of xml.match(OUTLINE_RE) ?? []) {
    const attrs = {};
    for (const m of tag.matchAll(ATTR_RE)) attrs[m[1]] = decodeEntities(m[2]);
    if (!attrs.xmlUrl) continue; // category-container outlines have no feed url
    feeds.push({
      id: attrs.text,
      label: attrs.title ?? attrs.text,
      url: attrs.xmlUrl,
      category: attrs.category ?? '',
    });
  }
  return feeds;
}

// Shared url normalization (used by the sync planner to compare OPML urls
// against Miniflux's stored feed urls).
export function normUrl(u) {
  return (u || '').replace(/\/+$/, '').toLowerCase();
}

export function feedsOpmlPath(theme = ACTIVE_THEME) {
  return `themes/${theme}/feeds.opml`;
}

export function loadFeedList(theme = ACTIVE_THEME) {
  return parseOpml(readFileSync(feedsOpmlPath(theme), 'utf8'));
}
