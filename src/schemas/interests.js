import { z } from 'zod';

const TopicSchema = z.object({
  level: z.enum(['core', 'rotating', 'off']),
  label: z.string(),
  github: z.array(z.string().min(1)).default([]),
  arxiv: z.array(z.string().min(1)).default([]),
  note: z.string().optional(),
});

export const InterestsSchema = z.object({
  rotation: z
    .object({
      rotating_per_day: z.number().int().positive().default(3),
      seed_field: z.string().default('date'),
    })
    .default({ rotating_per_day: 3, seed_field: 'date' }),
  interests: z.record(z.string(), TopicSchema),
});
