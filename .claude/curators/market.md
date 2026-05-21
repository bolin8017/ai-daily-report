# Curator: Market (Stage 2)

(`_shared.md` concatenated first.)

You curate the **市場 (Market)** section. Read:
- `data/staging/feeds.json` (market-category feeds)
- `data/staging/mops.json` (TWSE OpenAPI 重大訊息 filtered to tracked tickers)

Write strict JSON matching `MarketCuratedSchema` to `data/staging/curated/market.json`.

## Output structure

```json
{
  "ma": [...],
  "funding": [...],
  "policy": [...],
  "taiwan": [...]
}
```

## Sub-groups

### ma (cap 5) — 合作併購

Source: feeds.json from `TechCrunch Venture`, `Stratechery`, possibly Reuters Tech / Crunchbase News (if available).

- **Include:** AI company M&A (Anthropic / OpenAI / xAI / DeepSeek / Mistral acquisitions / acquihires), semi M&A (NVIDIA / AMD / Broadcom / Marvell / SK Hynix / Samsung / Micron), AI infra startup acquisitions (vector DB / inference / RAG infra being acquired).
- **Exclude:** non-AI / non-semi tech M&A, PE handovers without strategic story, pure financial restructuring.
- **Audience upgrade:** SSD / memory / HBM / Phison upstream-downstream involved → `both`.

For each item: `id`, `title`, `url`, `audience`, `amount` (deal size if stated), `companies` (array), `region` (`us`/`eu`/`global`), `takeaway`.

### funding (cap 5) — 募資財報

Same source pool as ma plus AWS / OpenAI / etc. earnings coverage.

- **Include:** ≥$20M AI startup rounds, AI company valuation updates, NVIDIA / AMD / TSMC / Broadcom / Micron / SK Hynix quarterly earnings highlights, HBM / SSD supply commentary affecting builders.
- **Exclude:** stock-price commentary, TMT trader takes, KOL prediction posts.

Same fields as ma.

### policy (cap 3) — 政策法規

Source: feeds.json from `Lawfare`, future Politico / Stanford HAI / FT regulation when available.

- **Include:** EU AI Act milestones (especially 2 Aug 2026 enforcement, AI Omnibus impact), US Executive Orders, export control updates (NVIDIA chip ban etc.), Taiwan generative AI rules, China Cyberspace AI rules, AI safety frameworks (RSP).
- **Exclude:** pure political spin, jargon-only legal pieces without builder/vendor impact.

Same fields as ma. `region` important.

### taiwan (cap 8) — 台灣動態

Source: mops.json (TWSE 重大訊息 for tracked tickers) + feeds.json from `iThome`, `TechNews`, `Inside`, `TechOrange`, `DIGITIMES`.

- **Include:** Taiwan AI vendor product news (MediaTek / TSMC / Phison / ASE etc.), MOPS 重大訊息 from tracked tickers (8299 Phison / 2454 聯發科 / 2330 台積電 / 3711 日月光 / 2382 廣達 / 3231 緯創 / 6669 緯穎 / 2376 技嘉 / 2357 華碩 / 2353 宏碁), Taiwan AI startup developments, 公部門 AI 政策.
- **Exclude:** consumer tech reviews, generic gadget news, recruitment ads.
- **Audience auto-upgrade:** items mentioning Phison / SK Hynix / Micron / Samsung / memory / SSD / KV-cache / on-device / aiDAPTIV / HBM auto-upgrade from `general` to `both`.

For each item: `id`, `title`, `url`, `audience`, `companies`, `region: "taiwan"`, `amount` (if applicable), `takeaway`.

For MOPS items: prefer the headline (`主旨`) as title; `companies` = [`公司名稱`]; `url` can be a synthetic mops disclosure page link.

## Validation

`MarketCuratedSchema`. 4 sub-group keys.
