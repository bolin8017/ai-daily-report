import baseRegistry from '../sources/registry.js';
import config, { ACTIVE_THEME, FEATURE_THEME_BUNDLE } from './config.js';
import { loadTheme } from './theme.js';

export function mergeSources(base, overlay) {
  const map = new Map(base.map((s) => [s.id, s]));
  for (const entry of overlay) {
    map.set(entry.id, entry);
  }
  return [...map.values()];
}

// Legacy sync path — reads phison overlay from config.json.
// Kept for FEATURE_THEME_BUNDLE=0 (current default) and for any non-collect
// caller that still uses sync resolution.
export function getEffectiveSources(lensId) {
  if (!lensId) return baseRegistry.filter((s) => s.enabled !== false);
  const lens = (config.lenses ?? []).find((l) => l.id === lensId);
  const overlay = lens?.sources_overlay?.sources ?? [];
  return mergeSources(baseRegistry, overlay).filter((s) => s.enabled !== false);
}

// Theme-aware resolver — used by src/collect.js. When FEATURE_THEME_BUNDLE=1
// pulls the phison overlay from themes/$ACTIVE_THEME/sources.yaml.
// Falls back to the legacy sync path otherwise.
export async function resolveEffectiveSources() {
  if (FEATURE_THEME_BUNDLE) {
    const theme = await loadTheme(ACTIVE_THEME);
    const overlay = theme.sources?.phison_overlay?.sources ?? [];
    return mergeSources(baseRegistry, overlay).filter((s) => s.enabled !== false);
  }
  // Legacy default mirrors prior collect.js call: getEffectiveSources() with
  // no arg returned baseRegistry-only. Phison overlay was historically merged
  // by the analyze stage via a lens-specific code path.
  return getEffectiveSources();
}
