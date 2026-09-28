// Curator orchestrator for the 'pulse' section.

import { PulseCuratedSchema } from '../schemas/curated.js';
import { buildCuratorPrompt, validateCuratedOutput } from './_base.js';

export const SECTION = 'pulse';

export async function getPrompt(opts = {}) {
  return buildCuratorPrompt(SECTION, opts);
}

export function validate(raw) {
  return validateCuratedOutput(PulseCuratedSchema, raw);
}
