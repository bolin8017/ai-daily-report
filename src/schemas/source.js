import { z } from 'zod';

export const ChainEntrySchema = z.object({
  provider: z.string().min(1),
  config: z.record(z.string(), z.any()).default({}),
});

export const SourceSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  category: z.string().min(1),
  itemType: z.string().min(1),
  limit: z.number().int().positive().optional(),
  threshold: z.number().int().nonnegative().default(1),
  chain: z.array(ChainEntrySchema).min(1),
  enrich: z.array(z.string()).optional(),
  enabled: z.boolean().default(true),
});

export const RegistrySchema = z.array(SourceSchema);
