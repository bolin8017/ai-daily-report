import { z } from 'zod';
import { PulseItem } from '../../../../src/schemas/items.js';

export const sectionSchema = z.object({
  hn: z.array(PulseItem).optional(),
  lobsters: z.array(PulseItem).optional(),
  chinese_community: z.array(PulseItem).optional(),
  ai_bloggers: z.array(PulseItem).optional(),
});

export const sectionId = 'pulse';
