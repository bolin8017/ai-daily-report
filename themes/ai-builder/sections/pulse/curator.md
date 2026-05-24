# Curator: Pulse (Stage 2)

(`_shared.md` concatenated before this.)

You curate the **脈動 (Pulse)** section. Read:
- `data/staging/unified.json` (aggregated RSS / JSON / RSSHub)

Write strict JSON matching `PulseCuratedSchema` to `data/staging/curated/pulse.json`.

## Output structure

```json
{
  "hn": [...],
  "lobsters": [...],
  "chinese_community": [...],
  "ai_bloggers": [...]
}
```

## Sub-groups

### hn (cap 8)

Source: feeds.json items where `source` ∈ {"Hacker News", "Show HN"}.

- **Include:** AI/ML model launches + tool launches, RAG / agent / inference / KV-cache discussion, AI company news (Anthropic / OpenAI / Meta AI / Google DeepMind / xAI), Show HN AI demos, significant industry events (layoffs, M&A) when builder-adjacent.
- **Soft include (lower priority):** important non-AI dev tool / infra discussions (PostgreSQL features, Cloudflare incidents, language updates) only if score ≥ 200.
- **Exclude:** politics, health (non-AI), cryptocurrency hype (unless AI crossover), life-hack / motivational.
- **Audience upgrade:** topics about KV-cache, SSD-as-memory, on-device LLM, AI accelerators → `both`.

For each item: `id`, `title`, `url`, `audience`, `score`, `comments`, `takeaway` (1 sentence).

### lobsters (cap 6)

Source: feeds.json items where `source` = "Lobsters" OR `source` ∈ {"Phoronix", "LWN"} (systems content from those venues).

- **Include tags:** ai, ml, programming, practices, databases, distributed, compsci, performance, hardware.
- **Exclude tags:** culture, philosophy, historical.

Same fields as hn.

### chinese_community (cap 6)

Source: feeds.json items where `source` ∈ {"SegmentFault", "OSChina", "iThome", "TechNews"}.

- **Include:** 中文 AI 應用實作、工作 case study、台廠 AI 落地、aiDAPTIV 相關中文討論、技術深度文。
- **Exclude:** 純翻譯外文新聞、賣課廣告、招聘、低 substance prompt 工程教學。
- **Audience:** default `general`. Upgrade to `both` for Phison / Taiwan semi / on-device / KV-cache 相關.

Same fields as hn (score may be absent if RSS doesn't provide).

### ai_bloggers (cap 5)

Source: feeds.json items where `source` ∈ {"Simon Willison", "Karpathy", "Gary Marcus", "Eugene Yan", "Hamel Husain", "Lilian Weng", "Sebastian Raschka", "Latent Space", "Dev.to Top", "Changelog"}.

- **Include:** independent expert commentary, technical deep-dives, eval methodology, framework comparisons.
- **Exclude:** newsletters that are mostly link aggregation without commentary.
- **Audience:** default `general`. `both` if KV-cache / inference / on-device.

Same fields as hn.

## Validation

`PulseCuratedSchema`. 4 sub-group keys.
