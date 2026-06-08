// Schema for catalog ("精選") section items (theme: ai-builder). Consumed by the
// dynamic report-schema composer in src/schemas/report.js (buildReportSchema).

import { z } from 'zod';
import { CatalogItem } from '../../../../src/schemas/items.js';

export const sectionSchema = z.object({
  picks: z.array(CatalogItem).optional(),
});

export const sectionId = 'catalog';
