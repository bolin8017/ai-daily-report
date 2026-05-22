// Curator orchestrator for the 'shipped' section.

import { ShippedCuratedSchema } from '../schemas/curated.js';
import { mergePrompts, validateCuratedOutput } from './_base.js';

export const SECTION = 'shipped';

export async function getPrompt() {
  return mergePrompts(SECTION);
}

export function validate(raw) {
  return validateCuratedOutput(ShippedCuratedSchema, raw);
}
