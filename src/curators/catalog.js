// Curator orchestrator for the 'catalog' (精選) section.

import { CatalogCuratedSchema } from '../schemas/curated.js';
import { mergePrompts, validateCuratedOutput } from './_base.js';

export const SECTION = 'catalog';

export async function getPrompt() {
  return mergePrompts(SECTION);
}

export function validate(raw) {
  return validateCuratedOutput(CatalogCuratedSchema, raw);
}
