// Tag staging items with their visible scope.
//
// Most items are visible to anyone reading the active theme → scope ["global"].
// Items matching the theme's phison_overlay (specific sources or GitHub topics
// tied to Phison-relevant work) additionally carry the theme's name. The
// condense step uses this to bias the condensed top-N toward theme-specific
// items so the LLM sees them prominently.

export function tagItemScope(item, theme) {
  const scope = new Set(['global']);

  const overlay = theme?.sources?.phison_overlay;
  if (!overlay) return { ...item, _scope: [...scope] };

  // Overlay sources: match by source id (e.g. item.source === 'phison-blog')
  const sourceIds = (overlay.sources || []).map((s) => s.id);
  if (sourceIds.includes(item.source)) {
    scope.add(theme.name);
  }

  // Overlay topics: match against item.topic for github-search items
  const topics = overlay.github_topics?.topics || [];
  if (item.source === 'github-search' && topics.includes(item.topic)) {
    scope.add(theme.name);
  }

  return { ...item, _scope: [...scope] };
}
