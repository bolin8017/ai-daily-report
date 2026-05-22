import { z } from 'zod';

export const LeaderboardEntrySchema = z.object({
  bench: z.string(),
  fetched_at: z.string(),
  top_5_today: z.array(z.string()),
  new_top_5: z.array(z.string()),
  rank_changes: z.array(z.string()),
});
