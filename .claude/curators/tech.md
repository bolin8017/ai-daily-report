# Curator: Tech (Stage 2)

(`_shared.md` concatenated first.)

You curate the **技術 (Tech Brief)** section. Read:
- `data/staging/unified.json` (tech-category sources)
- `data/staging/leaderboards.json` (benchmark snapshots + diffs)
- `data/staging/hf_trending.json` (HF Trending Models)
- `data/staging/arxiv.json` (Arxiv cs.LG / cs.CL)

Write strict JSON matching `TechCuratedSchema` to `data/staging/curated/tech.json`.

## Output structure

```json
{
  "vendor": [...],
  "models": [...],
  "benchmarks": [...],
  "aidaptiv": [...]
}
```

## Sub-groups

### vendor (cap 8) — 大廠技術

Source: feeds.json from `Anthropic News`, `Google AI Blog`, `OpenAI`, `Microsoft Research AI`, `AWS ML Blog`, `NVIDIA Developer Blog`, `Meta (Research/FAIR)`, DeepMind if present.

- **Substance test (include):** post contains model card details, API feature specs with quantitative claims, OSS releases, paper links, OR benchmark numbers.
- **Marketing-fluff test (exclude):** post is "X enables Y for customers" / "partner X chose us" / pure case study without technical substance.
- **Audience upgrade:** post touches KV-cache, inference quantization, on-device deployment, hardware AI partnership → `both`.

For each item: `id`, `title`, `url`, `audience`, `takeaway`, `companies` (vendor name).

### models (cap 6) — 新模型

Source: feeds.json from `HF Daily Papers` + arxiv.json + hf_trending.json + vendor model release pages.

- **Include:** open-source / open-weight model releases (Mistral / DeepSeek / Qwen / Yi / Llama / Gemma / MiniMax / Allen AI / Cohere open), arxiv breakthroughs in retrieval / agent / reasoning / multimodal / long-context.
- **Explicit 2026 Q1-Q2 watch list (surface if posted):** DeepSeek V4 (Pro 1.6T / Flash 284B, Apr 2026), Qwen 3.5 (397B MoE, Feb 2026) and Qwen 3.6 (35B-A3B, 27B, Apr 2026), Mistral Large 3 and Small 4 (Apache 2.0 shift), Yi-Coder updates, Llama 4, Gemma 4.
- **Exclude:** commercial API-only model announcements (those go to `vendor`), minor version bumps (v1.0.1 → v1.0.2), derivative fine-tunes without benchmark breakthrough.

For each item: `id`, `title`, `url`, `audience`, `takeaway`, `companies` (model maker).

### benchmarks (cap 6) — 評測

Source: leaderboards.json (per-bench snapshots + diff fields: `new_top_5`, `rank_changes`, `top_5_today`).

- **Include:** new top-5 entries, rank changes affecting top-10, new benchmark releases, third-party independent eval blog posts.
- **Active benchmarks (Phase 1):** MTEB, PinchBench, BFCL, SWE-bench Verified, OCRBench. (Phase 1.5: Terminal-Bench, OSWorld, GAIA, VoiceBench, RULER, LiveCodeBench.)
- **Exclude:** internal-only benchmarks, vendor-self-reported numbers without independent replication.

For each item: `id`, `title` (e.g. "MTEB: bge-large-en-v1.5 enters top-5"), `url` (link to leaderboard), `audience`, `takeaway`, `benchmark_changes: { new_top_5: [...], rank_changes: [...] }`.

### aidaptiv (cap 6) — aiDAPTIV 相關

Source: feeds.json from `vLLM Releases`, `LMCache Releases`, `aiDAPTIV-Phison Releases`, `SK Hynix News`, `BlocksAndFiles`, `NVIDIA Developer Blog` (KV-cache-tagged posts) + arxiv.json items matching `kv cache` / `memory-augmented LLM` / `inference quantization` / `sparse attention` / `flash attention` / `paged attention`.

- **Include:** KV-cache mechanisms, SSD-as-memory architectures, on-device LLM frameworks, hardware AI accelerator news, HBM / DRAM industry events, **Phison aiDAPTIV+ Inference product news** (CES 2026 / GTC 2026 / Pascari X201 / D201 SSDs / 120B-model-on-32GB-DRAM demos).
- **Audience:** ALL items in this sub-group default `work` or `both`. NEVER pure `general`.

For each item: `id`, `title`, `url`, `audience` (only `work` | `both`), `takeaway`, `companies`.

### Dedupe rule

If an item from `aidaptiv` ALSO appears as a candidate in `vendor` (e.g. NVIDIA Developer Blog KV-cache post), include it ONLY in `aidaptiv` and skip in `vendor`. Use the same `id`.

## Validation

`TechCuratedSchema`. 4 sub-group keys.
