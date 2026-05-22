// Heuristic: strip common feed suffixes to derive a homepage URL.
// Used by jina/firecrawl fallbacks since they render HTML pages, not feed XML.
function homepageFromFeed(feedUrl) {
  let u = feedUrl;
  for (const suffix of [
    '/feed',
    '/rss',
    '/atom',
    '/rss.php',
    '/index.xml',
    '/feeds',
    '.xml',
    '.atom',
    '/atom/everything/',
    '/headlines/rss',
  ]) {
    if (u.endsWith(suffix)) {
      u = u.slice(0, -suffix.length);
      break;
    }
  }
  if (!u.endsWith('/')) u = `${u}/`;
  return u;
}

export function rssWithCloudFallback({ url, sourceName, category, homepageUrl }) {
  const page = homepageUrl ?? homepageFromFeed(url);
  return [
    { provider: 'native-rss', config: { url, sourceName, category } },
    { provider: 'jina-reader', config: { url: page, sourceName, category } },
    { provider: 'firecrawl', config: { url: page, sourceName, category } },
  ];
}

export function hnChain({ list, route }) {
  return [
    { provider: 'rsshub', config: { route, normalize: 'hackernews' } },
    { provider: 'hn-firebase', config: { list, limit: 30 } },
    { provider: 'jina-reader', config: { url: 'https://news.ycombinator.com' } },
    { provider: 'firecrawl', config: { url: 'https://news.ycombinator.com' } },
  ];
}
