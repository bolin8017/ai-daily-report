import { extractArxivPaper } from './arxiv-paper.js';
import { extractHFModel } from './hf-model.js';
import { extractHNStory } from './hn-story.js';
import { extractRepoCard } from './repo-card.js';
import { extractRSSPost } from './rss-post.js';

export const Extractors = {
  'arxiv-paper': extractArxivPaper,
  'hf-model': extractHFModel,
  'hn-story': extractHNStory,
  'repo-card': extractRepoCard,
  'rss-post': extractRSSPost,
  // Single-tier sources — no jina/firecrawl extractor needed:
  'mops-disclosure': null,
  'leaderboard-entry': null,
};
