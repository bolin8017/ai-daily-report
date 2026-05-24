import { z } from 'zod';
import { TechItem } from '../../../../src/schemas/items.js';

export const sectionSchema = z.object({
  vendor: z.array(TechItem).optional(),
  models: z.array(TechItem).optional(),
  benchmarks: z.array(TechItem).optional(),
  aidaptiv: z.array(TechItem).optional(),
});

export const sectionId = 'tech';
