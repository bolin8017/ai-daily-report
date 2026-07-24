// Single source of truth for "which report section(s) a source feeds".
// Consumed by the eleventy footer (source pills) and the condense engine.
import { resolveEffectiveSources } from './sources.js';

// category → default sections. If the Step-1 audit shows a category with feed
// sources not listed here, ADD it (the orphan test enforces completeness).
export const CATEGORY_TO_SECTIONS = {
  community: ['pulse'],
  中文社群: ['pulse'],
  'AI 部落格': ['pulse'],
  '系統/底層': ['pulse'],
  'AI 公司': ['tech'],
  論文: ['tech'],
  大廠技術: ['tech'],
  aidaptiv: ['tech'],
  market: ['market'],
  policy: ['market'],
  台灣媒體: ['market'],
  'taiwan-market': ['market'],
  'phison-vendor': ['tech', 'market'],
  'kv-cache-research': ['tech'],
  'diffusion-research': ['tech'],
  // ssd-vendor: trade-press + analyst coverage of storage/memory vendors;
  // belongs in tech (vendor/models/benchmarks tabs). blocksandfiles is an
  // rss-post in this category and would be orphaned without this entry.
  'ssd-vendor': ['tech'],
};

// Per-source overrides (id → sections). Win over category. Reserved for
// genuinely dual-section sources whose category default doesn't already
// produce both sections — here Taiwan media the curators route into both
// pulse (community chatter) and market (industry/funding coverage). Sources
// whose category already resolves the right sections must NOT be listed here
// (loadSectionMap passes effective sources, so overlay sources DO get a
// category).
export const SOURCE_SECTION_OVERRIDES = {
  ithome: ['pulse', 'market'],
  'technews-tw': ['pulse', 'market'],
};

const FEED_ITEM_TYPES = new Set(['rss-post', 'hn-story']);

export function buildSectionMap(sources) {
  const idToCategory = {};
  for (const s of sources) if (s?.id) idToCategory[s.id] = s.category;

  function sectionsForSource(id) {
    if (SOURCE_SECTION_OVERRIDES[id]) return SOURCE_SECTION_OVERRIDES[id];
    const cat = idToCategory[id];
    return (cat && CATEGORY_TO_SECTIONS[cat]) || [];
  }
  function sourcesForSection(section) {
    return sources
      .filter((s) => s?.id && sectionsForSource(s.id).includes(section))
      .map((s) => s.id);
  }
  function orphans() {
    return sources
      .filter(
        (s) => s?.id && FEED_ITEM_TYPES.has(s.itemType) && sectionsForSource(s.id).length === 0,
      )
      .map((s) => s.id);
  }
  return { sectionsForSource, sourcesForSection, orphans };
}

export async function loadSectionMap() {
  return buildSectionMap(await resolveEffectiveSources());
}
