# Curator: Tech (Stage 2)

(`_shared.md` concatenated first.)

You curate the **技術 (Tech Brief)** section. Read:
- `data/staging/feeds-tech.json` — tech feeds (vendor / aidaptiv), pre-scoped to this section's sources
- `data/staging/leaderboards.json` (benchmark snapshots + diffs)
- `data/staging/hf_trending.json` (HF Trending Models)
- `data/staging/arxiv.json` (Arxiv cs.LG / cs.CL)

The items are already scoped to this section — route them to the sub-groups below by their `source` field.

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

Source: feeds.json from `Anthropic News`, `Google AI Blog`, `OpenAI`, `Microsoft Research AI`, `AWS ML Blog`, `NVIDIA Developer Blog`, `Meta (Research/FAIR)`, DeepMind if present, plus the video-generation feeds (`NVlabs Sana Commits`, `LTX-Video Releases`, `FastVideo Releases`, `ComfyUI Blog`, `stable-diffusion.cpp Releases`).

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

### 影片生成：優先題材（跨 vendor / models）

A new video-generation **technique** — a sampler, a distillation or few-step
schedule, a sparse/linear attention variant, a cache-reuse trick, a serving
recipe that changes the latency or VRAM envelope — outranks a routine LLM or
agent item of equal size. Surface it the day it appears; do not hold it for
corroboration. It reaches this section as a commit or release entry, not as a
polished blog post, so judge it on what the diff or release note says it does.

Two failure modes to avoid, both observed:

- **Naming without mechanism.** "廠商更新影片生成模型至 X 版,新增多模態管線" tells a
  builder nothing. Say what changed and what it buys: which step count, which
  resolution, which attention variant, what the measured latency or memory
  figure is. If the source carries no mechanism at all, the item is a `models`
  one-liner at best — do not promote it.
- **Crowding-out.** Video-gen items compete against a daily flood of agent and
  LLM news. When the vendor or models cap forces a cut, an item carrying a
  concrete video-gen mechanism is cut last, not first.

Model releases still belong in `models`; acceleration and serving work belongs
in `vendor`. The dedupe rule below applies as usual.

**廠商硬體 / runtime 這一側。** `TensorRT Model Optimizer Releases`, `OpenVINO
Releases`, `AMD ROCm Blog`, `ROCm Releases` and `NVIDIA Developer Blog` are
domain-general: most of what they carry is LLM, training, or datacenter news
that has nothing to do with image or video. Admit an item from them under this
rule ONLY when it bears on image or video generation — diffusion or video-model
support, a generation-path kernel or quantization, a VRAM or throughput figure
for an image/video workload, or a "this model now runs on this hardware" claim.
Everything else from those feeds is judged as ordinary `vendor` material on the
substance test above, with no video-gen priority. The builder's question here is
"can my card run it, and how fast" — an item that does not answer it is not a
video-gen item no matter which vendor published it.

### benchmarks (cap 6) — 評測

Source: leaderboards.json (per-bench snapshots + diff fields: `new_top_5`, `rank_changes`, `top_5_today`).

- **Include:** new top-5 entries, rank changes affecting top-10, new benchmark releases, third-party independent eval blog posts.
- **Active benchmarks — the COMPLETE list (no others are valid):**
  - `BFCL` — function calling / tool-use accuracy
  - `LMArena` — overall LLM capability (human-preference Elo)
  - `LiveBench` — overall, contamination-free
  - `SWE-bench-Live` — coding agent (live GitHub issues)
  - `GPQA Diamond (Epoch)` — hard science reasoning
  - `HLE (Epoch)` — Humanity's Last Exam, frontier reasoning
  - `tau2-bench` — agent tool-use
  - `GAIA` — general assistant / agents
  - `Artificial Analysis Intelligence Index` — composite score (only present when API key configured)
- **Event-driven rule:** `leaderboards.json` contains ONLY boards that changed today — frozen/unchanged boards emit nothing. Emit exactly one item per board that IS present in the file; if a board is absent, emit nothing for it — never write a "maintains lead" / "still #1" / "holds position" non-event.
- **Never invent a benchmark name.** If the board name in the file is not in the list above, treat it as an unknown source and skip it.
- **Titling guidance:** title each item by WHAT CHANGED, not the current standing. Good: "BFCL: <model> enters top-5", "LMArena: <model> rises to #3", "SWE-bench-Live: new #1 as <model> displaces <prior leader>". Avoid static "X leads Y benchmark" phrasing — that reads as a non-event.
- **Exclude:** internal-only benchmarks, vendor-self-reported numbers without independent replication.

For each item: `id`, `title` (e.g. "BFCL: <model> enters top-5"), `audience`, `takeaway`, `benchmark_changes: { new_top_5: [...], rank_changes: [...] }`. Do NOT emit a `url` — the official leaderboard link is attached deterministically by the system; never construct, copy, or guess one.

### aidaptiv (cap 6) — aiDAPTIV 相關

Source: feeds.json from `vLLM Releases`, `LMCache Releases`, `aiDAPTIV-Phison Releases`, `SK Hynix News`, `BlocksAndFiles`, `NVIDIA Developer Blog` (KV-cache-tagged posts) + arxiv.json items matching `kv cache` / `memory-augmented LLM` / `inference quantization` / `sparse attention` / `flash attention` / `paged attention`.

- **Include:** KV-cache mechanisms, SSD-as-memory architectures, on-device LLM frameworks, hardware AI accelerator news, HBM / DRAM industry events, **Phison aiDAPTIV+ Inference product news** (CES 2026 / GTC 2026 / Pascari X201 / D201 SSDs / 120B-model-on-32GB-DRAM demos).
- **Audience:** ALL items in this sub-group default `work` or `both`. NEVER pure `general`.

For each item: `id`, `title`, `url`, `audience` (only `work` | `both`), `takeaway`, `companies`.

### Dedupe rule

If an item from `aidaptiv` ALSO appears as a candidate in `vendor` (e.g. NVIDIA Developer Blog KV-cache post), include it ONLY in `aidaptiv` and skip in `vendor`. Use the same `id`.

### Numeric magnitude discipline

Do NOT put a multiplier (`N 倍` / `Nx` / "6x bandwidth") in a `takeaway` unless the source text explicitly states it AND it is plausible for the claim type. Prefer absolute figures (TB/s, GB, %, tokens/s). Treat vendor "up to N×" marketing as a claim, not a fact — paraphrase as "vendor claims up to N×", never assert it. (A wrong multiplier copied into a takeaway becomes a faithfulness-invisible error downstream — the synthesizer will faithfully repeat it.) Forward-looking figures (next-year TAM, projected scores, "will reach N") must be hedged in the `takeaway` (預計 / 預估 / 將 / 上看 / 有望) — never state a projection as an accomplished number.

## Validation

`TechCuratedSchema`. 4 sub-group keys.
