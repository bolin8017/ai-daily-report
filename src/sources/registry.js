import { hnChain, rssWithCloudFallback } from './presets.js';

function rss(id, label, category, url, extras = {}) {
  return {
    id,
    label,
    category,
    itemType: 'rss-post',
    chain: rssWithCloudFallback({ url, sourceName: id, category, ...extras }),
  };
}

export default [
  // === Community feeds (5) ===
  {
    id: 'hackernews',
    label: 'Hacker News',
    category: 'community',
    itemType: 'hn-story',
    threshold: 10,
    chain: hnChain({ list: 'topstories', route: '/hackernews/index' }),
    enrich: ['hn-algolia'],
  },
  {
    id: 'hackernews-show',
    label: 'Show HN',
    category: 'community',
    itemType: 'hn-story',
    threshold: 5,
    chain: hnChain({ list: 'showstories', route: '/hackernews/show' }),
    enrich: ['hn-algolia'],
  },
  {
    id: 'dev-to-top',
    label: 'Dev.to Top',
    category: 'community',
    itemType: 'rss-post',
    chain: [
      {
        provider: 'rsshub',
        config: { route: '/dev.to/top/week', sourceName: 'dev-to-top', category: 'community' },
      },
      {
        provider: 'jina-reader',
        config: { url: 'https://dev.to/top/week', sourceName: 'dev-to-top', category: 'community' },
      },
      {
        provider: 'firecrawl',
        config: { url: 'https://dev.to/top/week', sourceName: 'dev-to-top', category: 'community' },
      },
    ],
  },
  {
    id: 'lobsters',
    label: 'Lobsters',
    category: 'community',
    itemType: 'rss-post',
    chain: [
      { provider: 'lobsters-json', config: { url: 'https://lobste.rs/hottest.json' } },
      {
        provider: 'jina-reader',
        config: { url: 'https://lobste.rs/', sourceName: 'lobsters', category: 'community' },
      },
      {
        provider: 'firecrawl',
        config: { url: 'https://lobste.rs/', sourceName: 'lobsters', category: 'community' },
      },
    ],
  },
  rss('changelog', 'Changelog', 'community', 'https://changelog.com/feed'),

  // === AI 部落格 (8) ===
  rss(
    'simon-willison',
    'Simon Willison',
    'AI 部落格',
    'https://simonwillison.net/atom/everything/',
    {
      homepageUrl: 'https://simonwillison.net/',
    },
  ),
  rss('gary-marcus', 'Gary Marcus', 'AI 部落格', 'https://garymarcus.substack.com/feed', {
    homepageUrl: 'https://garymarcus.substack.com/',
  }),
  rss('karpathy', 'Karpathy', 'AI 部落格', 'https://karpathy.substack.com/feed', {
    homepageUrl: 'https://karpathy.substack.com/',
  }),
  rss('eugene-yan', 'Eugene Yan', 'AI 部落格', 'https://eugeneyan.com/rss/', {
    homepageUrl: 'https://eugeneyan.com/',
  }),
  rss('hamel-husain', 'Hamel Husain', 'AI 部落格', 'https://hamel.dev/index.xml', {
    homepageUrl: 'https://hamel.dev/',
  }),
  rss('lilian-weng', 'Lilian Weng', 'AI 部落格', 'https://lilianweng.github.io/index.xml', {
    homepageUrl: 'https://lilianweng.github.io/',
  }),
  rss(
    'sebastian-raschka',
    'Sebastian Raschka',
    'AI 部落格',
    'https://magazine.sebastianraschka.com/feed',
    {
      homepageUrl: 'https://magazine.sebastianraschka.com/',
    },
  ),
  rss('latent-space', 'Latent Space', 'AI 部落格', 'https://www.latent.space/feed', {
    homepageUrl: 'https://www.latent.space/',
  }),

  // === AI 公司 / 系統 (4) ===
  {
    id: 'anthropic-news',
    label: 'Anthropic News',
    category: 'AI 公司',
    itemType: 'rss-post',
    chain: [
      {
        provider: 'rsshub',
        config: { route: '/anthropic/news', sourceName: 'anthropic-news', category: 'AI 公司' },
      },
      ...rssWithCloudFallback({
        url: 'https://www.anthropic.com/news',
        sourceName: 'anthropic-news',
        category: 'AI 公司',
        homepageUrl: 'https://www.anthropic.com/news',
      }).slice(1),
    ],
  },
  rss('google-ai-blog', 'Google AI Blog', 'AI 公司', 'https://blog.google/technology/ai/rss', {
    homepageUrl: 'https://blog.google/technology/ai/',
  }),
  rss('openai', 'OpenAI', '大廠技術', 'https://openai.com/news/rss.xml', {
    homepageUrl: 'https://openai.com/news/',
  }),
  rss(
    'microsoft-research-ai',
    'Microsoft Research AI',
    '大廠技術',
    'https://www.microsoft.com/en-us/research/feed/',
    {
      homepageUrl: 'https://www.microsoft.com/en-us/research/',
    },
  ),
  rss(
    'aws-ml-blog',
    'AWS ML Blog',
    '大廠技術',
    'https://aws.amazon.com/blogs/machine-learning/feed/',
    {
      homepageUrl: 'https://aws.amazon.com/blogs/machine-learning/',
    },
  ),
  rss(
    'nvidia-developer-blog',
    'NVIDIA Developer Blog',
    '大廠技術',
    'https://developer.nvidia.com/blog/feed',
    {
      homepageUrl: 'https://developer.nvidia.com/blog/',
    },
  ),
  rss('meta-research', 'Meta Research', '大廠技術', 'https://research.facebook.com/feed', {
    homepageUrl: 'https://research.facebook.com/',
  }),
  rss(
    'samsung-semiconductor',
    'Samsung Semiconductor',
    'aidaptiv',
    'https://news.samsung.com/global/feed',
    {
      homepageUrl: 'https://news.samsung.com/global/',
    },
  ),
  rss('blocksandfiles', 'BlocksAndFiles', 'aidaptiv', 'https://blocksandfiles.com/feed', {
    homepageUrl: 'https://blocksandfiles.com/',
  }),
  rss(
    'vllm-releases',
    'vLLM Releases',
    'aidaptiv',
    'https://github.com/vllm-project/vllm/releases.atom',
    {
      homepageUrl: 'https://github.com/vllm-project/vllm/releases',
    },
  ),
  rss(
    'lmcache-releases',
    'LMCache Releases',
    'aidaptiv',
    'https://github.com/LMCache/LMCache/releases.atom',
    {
      homepageUrl: 'https://github.com/LMCache/LMCache/releases',
    },
  ),
  rss(
    'aidaptiv-phison-releases',
    'aiDAPTIV-Phison Releases',
    'aidaptiv',
    'https://github.com/aiDAPTIV-Phison/aiDAPTIV/releases.atom',
    {
      homepageUrl: 'https://github.com/aiDAPTIV-Phison/aiDAPTIV/releases',
    },
  ),
  rss('phoronix', 'Phoronix', '系統/底層', 'https://www.phoronix.com/rss.php', {
    homepageUrl: 'https://www.phoronix.com/',
  }),
  rss('lwn', 'LWN', '系統/底層', 'https://lwn.net/headlines/rss', {
    homepageUrl: 'https://lwn.net/',
  }),

  // === 中文社群 + 台灣媒體 (7) ===
  rss('segmentfault', 'SegmentFault', '中文社群', 'https://segmentfault.com/feeds', {
    homepageUrl: 'https://segmentfault.com/',
  }),
  rss('oschina', 'OSChina', '中文社群', 'https://www.oschina.net/news/rss', {
    homepageUrl: 'https://www.oschina.net/news',
  }),
  rss('ithome', 'iThome', '中文社群', 'https://www.ithome.com.tw/rss', {
    homepageUrl: 'https://www.ithome.com.tw/',
  }),
  rss('inside', 'Inside', '台灣媒體', 'https://feeds.feedburner.com/inside', {
    homepageUrl: 'https://www.inside.com.tw/',
  }),
  rss('techorange', 'TechOrange', '台灣媒體', 'https://buzzorange.com/techorange/feed/', {
    homepageUrl: 'https://buzzorange.com/techorange/',
  }),
  rss('technews-tw', 'TechNews', '台灣媒體', 'https://technews.tw/feed/', {
    homepageUrl: 'https://technews.tw/',
  }),
  rss('digitimes', 'DIGITIMES', '台灣媒體', 'https://www.digitimes.com.tw/rss/all.xml', {
    homepageUrl: 'https://www.digitimes.com.tw/',
  }),

  // === Market / Policy (3) ===
  rss(
    'techcrunch-venture',
    'TechCrunch Venture',
    'market',
    'https://techcrunch.com/category/venture/feed/',
    {
      homepageUrl: 'https://techcrunch.com/category/venture/',
    },
  ),
  rss('stratechery', 'Stratechery Articles', 'market', 'https://stratechery.com/feed', {
    homepageUrl: 'https://stratechery.com/',
  }),
  rss('lawfare', 'Lawfare', 'policy', 'https://www.lawfaremedia.org/feeds/articles', {
    homepageUrl: 'https://www.lawfaremedia.org/',
  }),

  // === 論文 / Research (2) ===
  {
    id: 'hf-daily-papers',
    label: 'HuggingFace Daily Papers',
    category: '論文',
    itemType: 'arxiv-paper',
    chain: [
      { provider: 'rsshub', config: { route: '/huggingface/daily-papers' } },
      { provider: 'jina-reader', config: { url: 'https://huggingface.co/papers' } },
      { provider: 'firecrawl', config: { url: 'https://huggingface.co/papers' } },
    ],
  },
  {
    id: 'arxiv-cs-ai',
    label: 'Arxiv cs.LG + cs.CL',
    category: '論文',
    itemType: 'arxiv-paper',
    chain: [
      { provider: 'arxiv-rss', config: {} },
      { provider: 'jina-reader', config: { url: 'https://arxiv.org/list/cs.LG/recent' } },
    ],
  },

  // === GitHub (3) ===
  {
    id: 'github-trending',
    label: 'GitHub Trending',
    category: 'github',
    itemType: 'repo-card',
    chain: [
      { provider: 'github-trending-html', config: { url: 'https://github.com/trending' } },
      { provider: 'jina-reader', config: { url: 'https://github.com/trending' } },
      { provider: 'firecrawl', config: { url: 'https://github.com/trending' } },
    ],
  },
  {
    id: 'github-developers',
    label: 'GitHub Developers',
    category: 'github',
    itemType: 'repo-card',
    chain: [
      { provider: 'github-developers-api', config: {} },
      { provider: 'github-developers-html', config: {} },
    ],
  },
  {
    id: 'github-search-topics',
    label: 'GitHub Topic Search',
    category: 'github',
    itemType: 'repo-card',
    chain: [{ provider: 'github-search-api', config: {} }],
  },

  // === HF (1) ===
  {
    id: 'hf-trending',
    label: 'HuggingFace Trending',
    category: 'hf',
    itemType: 'hf-model',
    chain: [
      { provider: 'hf-trending-json', config: {} },
      { provider: 'jina-reader', config: { url: 'https://huggingface.co/models?sort=trending' } },
      { provider: 'firecrawl', config: { url: 'https://huggingface.co/models?sort=trending' } },
    ],
  },

  // === MOPS (1) — single-tier, no public fallback ===
  {
    id: 'mops-disclosure',
    label: 'TWSE 重大訊息',
    category: 'taiwan-market',
    itemType: 'mops-disclosure',
    chain: [{ provider: 'mops-twse-openapi', config: {} }],
  },

  // === Leaderboards (3) ===
  // Read each board's official machine-readable export (CSV / results JSON),
  // not the JS-rendered leaderboard HTML. mteb + pinchbench removed 2026-05-25
  // (no stable precomputed-ranking source — see leaderboard-html.js).
  {
    id: 'leaderboard-bfcl',
    label: 'BFCL Leaderboard',
    category: 'leaderboard',
    itemType: 'leaderboard-entry',
    chain: [{ provider: 'leaderboard-html', config: { parser: 'bfcl' } }],
  },
  {
    id: 'leaderboard-swebench',
    label: 'SWE-Bench Leaderboard',
    category: 'leaderboard',
    itemType: 'leaderboard-entry',
    chain: [{ provider: 'leaderboard-html', config: { parser: 'swebench' } }],
  },
  {
    id: 'leaderboard-ocrbench',
    label: 'OCRBench Leaderboard',
    category: 'leaderboard',
    itemType: 'leaderboard-entry',
    chain: [{ provider: 'leaderboard-html', config: { parser: 'ocrbench' } }],
  },
];
