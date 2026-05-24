import baseRegistry from '../sources/registry.js';
import { ACTIVE_THEME } from './config.js';
import { loadTheme } from './theme.js';

export function mergeSources(base, overlay) {
  const map = new Map(base.map((s) => [s.id, s]));
  for (const entry of overlay) {
    map.set(entry.id, entry);
  }
  return [...map.values()];
}

// Resolve the effective source list for the active theme: base registry
// merged with the theme's phison_overlay sources, filtered to enabled
// entries. Called by src/collect.js at pipeline start.
export async function resolveEffectiveSources() {
  const theme = await loadTheme(ACTIVE_THEME);
  const overlay = theme.sources?.phison_overlay?.sources ?? [];
  return mergeSources(baseRegistry, overlay).filter((s) => s.enabled !== false);
}
