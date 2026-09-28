// Curator orchestrator for the 'market' section.

import { MarketCuratedSchema } from '../schemas/curated.js';
import { buildCuratorPrompt, validateCuratedOutput } from './_base.js';

export const SECTION = 'market';

export async function getPrompt(opts = {}) {
  return buildCuratorPrompt(SECTION, opts);
}

export function validate(raw) {
  return validateCuratedOutput(MarketCuratedSchema, raw);
}
