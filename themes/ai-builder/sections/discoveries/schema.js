import { z } from 'zod';
import { ProjectItem } from '../../../../src/schemas/items.js';

export const sectionSchema = z.object({
  rising: z.array(ProjectItem).optional(),
  dev_watch: z.array(ProjectItem).optional(),
});
export const sectionId = 'discoveries';
