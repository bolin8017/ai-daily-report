import baseRegistry from '../sources/registry.js';
import config from './config.js';

export function mergeSources(base, overlay) {
  const map = new Map(base.map((s) => [s.id, s]));
  for (const entry of overlay) {
    map.set(entry.id, entry);
  }
  return [...map.values()];
}

export function getEffectiveSources(lensId) {
  if (!lensId) return baseRegistry.filter((s) => s.enabled !== false);
  const lens = (config.lenses ?? []).find((l) => l.id === lensId);
  const overlay = lens?.sources_overlay?.sources ?? [];
  return mergeSources(baseRegistry, overlay).filter((s) => s.enabled !== false);
}
