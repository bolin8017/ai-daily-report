// Curator orchestrator for the 'discoveries' (新發現) section.

import { DiscoveriesCuratedSchema } from '../schemas/curated.js';
import { mergePrompts, validateCuratedOutput } from './_base.js';

export const SECTION = 'discoveries';

export async function getPrompt() {
  return mergePrompts(SECTION);
}

export function validate(raw) {
  return validateCuratedOutput(DiscoveriesCuratedSchema, raw);
}
