// Curator orchestrator for the 'tech' section.

import { TechCuratedSchema } from '../schemas/curated.js';
import { mergePrompts, validateCuratedOutput } from './_base.js';

export const SECTION = 'tech';

export async function getPrompt() {
  return mergePrompts(SECTION);
}

export function validate(raw) {
  return validateCuratedOutput(TechCuratedSchema, raw);
}
