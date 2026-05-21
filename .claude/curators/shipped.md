# Curator: Shipped (Stage 2)

(The shared voice rules `_shared.md` are concatenated before this prompt by the orchestrator.)

You curate the **上線 (Shipped)** section. Read these staging files via Read tool:
- `data/staging/github-trending.json`
- `data/staging/github-search.json`
- `data/staging/github-developers.json`

Write strict JSON matching `ShippedCuratedSchema` to `data/staging/curated/shipped.json`.

## Output structure

```json
{
  "trending": [...],
  "topic_discovery": [...],
  "dev_watch_taiwan": [...],
  "dev_watch_global": [...]
}
```

## Sub-groups

### trending (cap 8 items)

Source: github-trending.json. Pick AI/ML and AI-builder-adjacent infra.

- **Include:** RAG, agent framework, MCP server, VLM, OCR, fine-tuning tools, inference engine (vLLM / llama.cpp / SGLang / TensorRT-LLM / oMLX / MLC / LMDeploy), vector DB / embedding store / reranker, eval framework, web scraping, dev productivity for builders (claude-code plugins, Cursor/Cline/Aider/Continue tooling), voice (TTS / STT / voice cloning), robotics LLM / embodied AI, browser agent / browser automation, edge AI / quantization, document AI.
- **Exclude:** pure front-end framework, Web3/blockchain, game dev (non-AI), generic CRUD scaffolding, awesome-* lists (unless awesome-mcp / awesome-rag / awesome-agent etc.).
- **Audience upgrade:** repo about KV-cache, on-device LLM, inference quantization, hardware AI accelerators, embedded inference → `both`.

For each item:
- `id`, `name`, `url`, `audience`, `desc` (from staging), `stars`, `language`, `repo_age`
- `relevance` (1 sentence: why today, not what it is)
- `topic_match` (array of matched topics, e.g. `['rag', 'kv-cache']`)

### topic_discovery (cap 10 items)

Source: github-search.json (already filtered to ≤30-day-old AI repos with ≥100 stars).

- **Include:** anything interesting beyond what's already in trending. De-dupe by repo slug against your trending output.
- **Exclude:** repos in your trending output, repos with primarily marketing README, forks of major projects.
- **Audience:** same upgrade rules as trending.

Same fields as trending; `topic_match` always populated.

### dev_watch_taiwan (cap 5 items)

Source: github-developers.json `regions.taiwan`.

- **All-domain retained** (Taiwan dev ecosystem is small; cross-domain creativity matters for ideation). AI/builder items get `relevance` mentioning the AI angle; non-AI items get neutral `relevance`.
- **Audience:** AI/builder repos `general` or `both`; non-AI repos `general`.
- **Exclude:** forks, dotfiles / personal config, template clones.

For each item:
- `id`, `name` (e.g. `"audreyt/cool-repo"`), `url`, `audience`, `stars`, `language`
- `desc` (developer name + followers, e.g. "Audrey Tang (1.2k followers) — new repo")
- `relevance` (1 sentence)

### dev_watch_global (cap 5 items)

Source: github-developers.json `global` (top 100, ≥1000 followers).

- **AI-only filter** (volume too high otherwise). De-prioritize non-AI domains.

Same field shape as dev_watch_taiwan.

## Validation

Your output is parsed with `ShippedCuratedSchema` (Zod) — invalid output = pipeline abort. Confirm exactly 4 sub-group keys with arrays (empty arrays OK).
