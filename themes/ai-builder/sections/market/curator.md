# Curator: Market (Stage 2)

(`_shared.md` concatenated first.)

You curate the **市場 (Market)** section. Read:
- `data/staging/feeds-market.json` — market feeds, pre-scoped to this section's sources
- `data/staging/mops.json` (TWSE + TPEx OpenAPI 重大訊息 filtered to tracked tickers)

The feed items are already scoped to this section — route them to the sub-groups below by their `source` field.

Write strict JSON matching `MarketCuratedSchema` to `data/staging/curated/market.json`.

## Output structure

```json
{
  "ma": [...],
  "funding": [...],
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

### taiwan (cap 8) — 台灣動態

Source: mops.json (TWSE + TPEx 重大訊息 for tracked tickers) + feeds.json from `iThome`, `TechNews`, `Inside`, `TechOrange`, `EE Times Taiwan`, `鉅亨網科技`, `經濟日報產業`, `T客邦`, `國科會 NSTC`.

- **Include:** Taiwan AI vendor product news (MediaTek / TSMC / Phison / ASE etc.), MOPS 重大訊息 from the tracked Phison-ecosystem watchlist — 記憶體/控制 IC: 8299 群聯 / 2337 旺宏 / 2344 華邦電 / 2408 南亞科 / 3260 威剛 / 4967 十銓 / 8271 宇瞻 / 2451 創見; aiDAPTIV+ 夥伴與 AI server/PC: 2376 技嘉 / 3515 華擎 / 2395 研華 / 6166 凌華 / 2377 微星 / 2357 華碩 / 2353 宏碁 / 6669 緯穎 / 2382 廣達 / 3231 緯創 / 2356 英業達; 晶圓/封測/server 晶片: 2330 台積電 / 3711 日月光 / 2454 聯發科 / 5274 信驊 — Taiwan AI startup developments, 公部門 AI 政策.
- **Exclude:** consumer tech reviews, generic gadget news, recruitment ads.
- **Audience auto-upgrade:** items mentioning Phison / SK Hynix / Micron / Samsung / memory / SSD / KV-cache / on-device / aiDAPTIV / HBM auto-upgrade from `general` to `both`.

For each item: `id`, `title`, `url`, `audience`, `companies`, `region: "taiwan"`, `amount` (if applicable), `takeaway`.

For MOPS items: prefer the headline (`主旨`) as title; `companies` = [`公司名稱`]; `url` can be a synthetic mops disclosure page link.

### Numeric magnitude discipline

Do NOT put a multiplier (`N 倍` / `Nx`) in a `takeaway` unless the source explicitly states it AND it is plausible. Prefer absolute figures ($ amounts, %, units). Treat vendor / press "up to N×" marketing as a claim, not a fact — paraphrase as "claims up to N×", never assert it. (A wrong multiplier copied into a takeaway becomes a faithfulness-invisible error downstream.) Forward-looking figures (next-year TAM, projected rounds, "will reach N") must be hedged in the `takeaway` (預計 / 預估 / 將 / 上看 / 有望) — never state a projection as an accomplished number.

## Validation

`MarketCuratedSchema`. 3 sub-group keys.
