// Curator orchestrator for the 'market' section.

import { MarketCuratedSchema } from '../schemas/curated.js';
import { mergePrompts, validateCuratedOutput } from './_base.js';

export const SECTION = 'market';

export async function getPrompt() {
  return mergePrompts(SECTION);
}

export function validate(raw) {
  return validateCuratedOutput(MarketCuratedSchema, raw);
}
