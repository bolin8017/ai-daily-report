// Schema for shipped section items (theme: ai-builder).
// Mirrors the ShippedSection block in src/schemas/report.js; the dynamic
// schema composer in report.js imports this when FEATURE_THEME_BUNDLE=1.

import { z } from 'zod';
import { ShippedItem } from '../../../../src/schemas/items.js';

export const sectionSchema = z.object({
  trending: z.array(ShippedItem).optional(),
  topic_discovery: z.array(ShippedItem).optional(),
  dev_watch_taiwan: z.array(ShippedItem).optional(),
  dev_watch_global: z.array(ShippedItem).optional(),
});

export const sectionId = 'shipped';
