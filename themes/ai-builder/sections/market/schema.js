import { z } from 'zod';
import { MarketItem } from '../../../../src/schemas/items.js';

export const sectionSchema = z.object({
  ma: z.array(MarketItem).optional(),
  funding: z.array(MarketItem).optional(),
  policy: z.array(MarketItem).optional(),
  taiwan: z.array(MarketItem).optional(),
});

export const sectionId = 'market';
