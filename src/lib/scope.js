// Tag staging items with their visible scope.
//
// Items from global config.sources are visible to all lenses → scope: ["global"].
// Items from a lens's sources_overlay are visible to global + that lens.
// (An item matching multiple lens overlays gets all those scopes.)
//
// Stage 2 prompts read staging and filter items to those where _scope intersects
// [global, <self-lens-id>] — ai-builder sees only global, Phison sees both.

export function tagItemScope(item, lenses) {
  const scope = new Set(['global']);

  for (const lens of lenses || []) {
    const overlay = lens.sources_overlay;
    if (!overlay) continue;

    // Lens source overlay: match by source id (e.g. item.source === 'phison-blog')
    const sourceIds = (overlay.sources || []).map((s) => s.id);
    if (sourceIds.includes(item.source)) {
      scope.add(lens.id);
    }

    // GitHub topic overlay: match item.topic against overlay topics
    const topics = overlay.github_topics?.topics || [];
    if (item.source === 'github-search' && topics.includes(item.topic)) {
      scope.add(lens.id);
    }
  }

  return { ...item, _scope: [...scope] };
}
