// Curator orchestrator for the 'tech' section.

import { TechCuratedSchema } from '../schemas/curated.js';
import { buildCuratorPrompt, validateCuratedOutput } from './_base.js';

export const SECTION = 'tech';

export async function getPrompt(opts = {}) {
  return buildCuratorPrompt(SECTION, opts);
}

export function validate(raw) {
  return validateCuratedOutput(TechCuratedSchema, raw);
}
