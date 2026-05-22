// HN front page rendered via jina.ai appears on one giant line where each
// story is a numeric-prefixed block:
//   N.[](vote_url)[Title](url) (domain) NN points by [user](...)[time](item?id=NN)
// We anchor on the per-entry vote URL (always contains a unique vote?id=) and
// then capture the title link that follows immediately after.
export function extractHNStory(markdown) {
  const stories = [];
  const re = /(\d+)\.\[\]\([^)]*vote\?id=(\d+)[^)]*\)\[([^\]]{3,})\]\((https?:\/\/[^)]+)\)/g;
  while (true) {
    const m = re.exec(markdown);
    if (m === null) break;
    const rank = Number(m[1]);
    const hn_id = m[2];
    const title = m[3].trim();
    const url = m[4];
    // Try to find author from text following the match
    const tail = markdown.slice(m.index, m.index + 1200);
    const authorMatch = tail.match(/by\s*\[([A-Za-z0-9_-]+)\]/);
    const scoreMatch = tail.match(/(\d+)\s*points/);
    stories.push({
      source: 'hackernews',
      title,
      url,
      hn_url: `https://news.ycombinator.com/item?id=${hn_id}`,
      hn_id,
      author: authorMatch?.[1] ?? '',
      published: null,
      rank,
      score: scoreMatch ? Number(scoreMatch[1]) : undefined,
    });
    if (stories.length >= 30) break;
  }
  return stories;
}
