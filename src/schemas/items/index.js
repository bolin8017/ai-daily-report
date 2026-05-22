import { ArxivPaperSchema } from './arxiv-paper.js';
import { HFModelSchema } from './hf-model.js';
import { HNStorySchema } from './hn-story.js';
import { LeaderboardEntrySchema } from './leaderboard-entry.js';
import { MopsDisclosureSchema } from './mops-disclosure.js';
import { RepoCardSchema } from './repo-card.js';
import { RSSPostSchema } from './rss-post.js';

export const ItemSchemas = {
  'arxiv-paper': ArxivPaperSchema,
  'hf-model': HFModelSchema,
  'hn-story': HNStorySchema,
  'leaderboard-entry': LeaderboardEntrySchema,
  'mops-disclosure': MopsDisclosureSchema,
  'repo-card': RepoCardSchema,
  'rss-post': RSSPostSchema,
};
