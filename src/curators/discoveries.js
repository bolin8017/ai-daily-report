// Curator orchestrator for the 'discoveries' (新發現) section.

import { DiscoveriesCuratedSchema } from '../schemas/curated.js';
import { buildCuratorPrompt, validateCuratedOutput } from './_base.js';

export const SECTION = 'discoveries';

// `rejected[]` is the funnel's diagnostic record of repos a gate dropped; the
// curator judges only `candidates[]` ∪ `watchlist[]`, so it stays out of the
// prompt (~27 KB of repos the curator must not pick anyway).
function withoutRejected(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  const { rejected: _rejected, ...rest } = data;
  return rest;
}

export async function getPrompt(opts = {}) {
  return buildCuratorPrompt(SECTION, {
    ...opts,
    transforms: { 'feeds-discoveries.json': withoutRejected, ...opts.transforms },
  });
}

export function validate(raw) {
  return validateCuratedOutput(DiscoveriesCuratedSchema, raw);
}
