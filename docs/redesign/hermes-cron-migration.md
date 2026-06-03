# Hermes Cron Migration 重構設計文件

> **給 Hermes / 後續實作者：** 這份文件是 `ai-daily-report` 從舊 VM/systemd + repo-local `memory.json` 遷移到 Hermes 接手的重構契約。主人確認本設計前，不要啟用排程、不修改敏感設定、不推送 production 報告。

**目標：** 讓 Hermes / 雷姆接手每日 AI 日報的排程、執行、監控、長期記憶與 Telegram 回報，同時維持公開網站輸出：<https://bolin8017.github.io/ai-daily-report/>。

**核心架構：** 保留目前 pipeline 中已經證明有效的部分：collect、curate、deterministic merge、schema validation、source-link validation、GitHub Pages publication；移除 `data/memory.json` 作為跨日狀態的角色，改由 Hermes Wiki 保存長期 intelligence，再由 bounded `report-context` 提供給 synthesizer。

**主要技術：** Node.js 22+、Bash、Claude Code CLI (`claude -p`)、GitHub Pages / `data` branch、Hermes cron、Hermes Telegram gateway、Hermes Wiki (`/home/bolin8017/Documents/Hermes/Wiki`)。

---

## 1. 摘要

這次不是把舊 VM 流程原封不動搬到 Hermes。這次應該視為一次正式重構。

目前 repo 已經有一個不錯的 v2 pipeline：

1. Stage 1 collect：收集並壓縮來源資料到 `data/staging/`。
2. Stage 2 curate：依 section 產生 `data/staging/curated/*.json`。
3. Stage 3 synthesize：用一個 synthesizer prompt 產生 `data/staging/editorial.json`。
4. Stage 4 merge：用 deterministic code 把 editorial + curated 合成 `data/reports/<date>.json`。
5. validate + commit：驗證後把報告 artifacts 推到 `data` branch，讓 GitHub Pages 更新。

真正需要移除的弱點是 `data/memory.json`。

`data/memory.json` 在舊設計中同時扮演：

- 跨日記憶；
- prediction ledger；
- narrative arcs store；
- synthesizer input；
- synthesizer output；
- schema repair source；
- `data` branch public artifact；
- 相容性負擔。

這讓 prompt 變大、schema drift 變多、repair script 變多，也讓「公開報告資料」和「雷姆的研究記憶」混在一起。

新設計的方向是：

```text
repo 保留公開報告與 deterministic pipeline
Hermes Wiki 保存長期 intelligence
Stage 2.5 從 curated output 更新 Wiki，並產出 bounded report-context
Stage 3 只讀 curated + report-context，只寫 editorial.json
```

---

## 2. 不可妥協的需求

### 2.1 公開輸出維持不變

- 公開網站仍是：<https://bolin8017.github.io/ai-daily-report/>。
- 每日報告仍產生：`data/reports/<YYYY-MM-DD>.json`。
- `data/feeds-snapshot.json` 如果仍被 Eleventy footer / source status 使用，就繼續推送。
- 除非主人另行確認，GitHub Pages / Eleventy 的公開呈現不做大改。

### 2.2 Hermes 成為 operator

Hermes 應該接手：

- 每日排程；
- pipeline dispatch；
- run status / logs；
- 失敗通知；
- 成功摘要；
- Pages 更新驗證；
- 長期 intelligence memory；
- report-context selection。

Hermes 不應該把失敗包裝成成功。任何 collect、curate、synthesize、merge、validate、commit、push、Pages deploy 的失敗都要如實回報。

### 2.3 `data/memory.json` 不再相容保留

`data/memory.json` 應該從 active pipeline 中移除。

它不應再被：

- `scripts/synthesize.sh` 讀取；
- synthesizer 寫入；
- `npm run validate:memory` 驗證；
- `scripts/analyze.sh` commit；
- `src/lib/commit.js` 預設 commit；
- `prediction_updates` carry-forward 使用；
- `data` branch 當作公開 artifact 保存。

### 2.4 品質標準不能降低

遷移後仍要保留或強化：

- source_links 驗證；
- schema validation；
- source recency discipline；
- named-source attribution discipline；
- anti-slop / anti-translation-smell writing rules；
- deterministic merge；
- non-critical section degraded behavior；
- Telegram 中的真實執行結果回報。

---

## 3. 目前 repo 狀態與耦合點

雷姆檢查目前 repo 後，看到以下 `memory.json` 耦合點。

### 3.1 文件耦合

- `README.md`：描述 Stage 3 讀 memory 並寫 `data/memory.json`。
- `CLAUDE.md`：描述 `data/memory.json` 是 v2 cross-day state 且會被 commit 到 `data` branch。
- `docs/architecture.md`：架構圖與說明仍把 `data/memory.json` 視為 synthesis / storage 的一部分。

### 3.2 script / package 耦合

- `package.json`：有 `validate:memory`。
- `scripts/analyze.sh`：如果 `data/memory.json` 存在，就加入 `COMMIT_PATHS`。
- `scripts/synthesize.sh`：
  - prompt assembly 要求讀 staging + memory；
  - OUTPUT CONTRACT 要求寫 editorial + memory；
  - 用 `src/lib/repair-editorial.js` 從 memory 修補 `prediction_updates`；
  - 用 `src/lib/prune-memory.js` 修剪 memory。

### 3.3 prompt 耦合

- `themes/ai-builder/synthesizer.md`：
  - inputs 包含 `data/memory.json`；
  - outputs 包含 `data/memory.json`；
  - `signals.prediction_updates` 要求從 memory carry forward；
  - memory update 是 prompt 的正式段落。
- `themes/ai-builder/quality.md`：仍提到 `data/memory.json` internal ids 可作 metadata。

### 3.4 schema / helper 耦合

- `src/schemas/memory.js`：memory schema。
- `src/lib/prune-memory.js`：控制 prediction list 成長。
- `src/lib/repair-editorial.js`：從 memory backfill malformed `prediction_updates`。
- `src/schemas/editorial.js`：`prediction_updates` optional。
- `src/schemas/report.js`：`prediction_updates` optional。
- `src/lib/commit.js`：預設 commit paths 包含 `data/memory.json`。

### 3.5 tests 耦合

- `tests/prune-memory.test.js`
- `tests/repair-editorial.test.js`
- `tests/schemas.test.js`
- `tests/lens.test.js`

### 3.6 值得保留的好設計

以下不應被這次重構破壞：

- `src/lib/merge.js` 的 deterministic merge。
- `src/lib/merge.js` 對 dangling `source_links` 的驗證。
- `EditorialSchema` 使用 `schema_version: "2.1-editorial"` 區分 editorial-only output。
- Stage 2 curator 與 Stage 3 synthesizer 的分離。
- critical / non-critical sections 的降級策略。
- `themes/ai-builder/quality.md` 中大量反幻覺、反 slop 規則。
- `src/lib/commit.js` 使用 isolated Git index 推 `data` branch，避免污染 main working tree。

---

## 4. 目標架構

```text
Hermes cron dispatcher
  │
  ├─ scripts/hermes/daily-run.sh
  │    │
  │    ├─ Stage 1: collect
  │    │    └─ data/staging/*.json
  │    │
  │    ├─ Stage 2: curate
  │    │    └─ data/staging/curated/{shipped,pulse,market,tech}.json
  │    │
  │    ├─ Stage 2.5: update Hermes Wiki + build bounded report context
  │    │    ├─ /home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/**
  │    │    └─ data/staging/report-context.{md,json}
  │    │
  │    ├─ Stage 3: synthesize editorial only
  │    │    └─ data/staging/editorial.json
  │    │
  │    ├─ Stage 4: deterministic merge
  │    │    └─ data/reports/<date>.json
  │    │
  │    ├─ validate + build
  │    │
  │    ├─ commit/push data branch
  │    │    ├─ data/reports/<date>.json
  │    │    └─ data/feeds-snapshot.json
  │    │
  │    └─ run status + logs
  │         └─ runtime/hermes-runs/<run-id>/**
  │
  ├─ Hermes cron monitor
  │    └─ Telegram failure/status report（成功預設靜默）
  │
  └─ Hermes Pages verifier
       └─ confirms GitHub Pages exposes today's report
```

### 4.1 舊邊界

```text
repo 擁有公開報告 + staging + cross-day memory
synthesizer 讀 memory，也寫 memory
```

### 4.2 新邊界

```text
repo 擁有公開報告 + staging + deterministic pipeline code
Hermes 擁有 cross-day intelligence memory
synthesizer 只讀 bounded report-context，只寫 editorial.json
```

---

## 5. 資料所有權

### 5.1 可以進 `data` branch 的公開 artifacts

```text
data/reports/<YYYY-MM-DD>.json
data/feeds-snapshot.json
```

### 5.2 不應進 `data` branch 的 staging artifacts

```text
data/staging/source-ages.json
data/staging/editorial.json
data/staging/curated/*.json
data/staging/report-context.md
data/staging/report-context.json
```

### 5.3 Hermes-owned intelligence memory

```text
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/
```

這裡保存雷姆長期使用的研究記憶，不預設公開。

### 5.4 runtime / logs

推薦位置：

```text
/home/bolin8017/Documents/Hermes/Runs/ai-daily-report/<run-id>/
```

若第一版為了簡單放 repo 內，則應使用 ignored 目錄：

```text
runtime/hermes-runs/<run-id>/
```

並確認 `runtime/` 被 `.gitignore` 忽略。

---

## 6. Hermes Wiki 記憶設計

### 6.1 root path

```text
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/
```

### 6.2 directory skeleton

```text
ai-daily-report/
  index.md
  SCHEMA.md
  log.md
  daily/
    2026-06-03.md
  entities/
    companies/
    labs/
    models/
    products/
    repos/
    people/
  concepts/
    agents.md
    mcp.md
    rag.md
    inference.md
    fine-tuning.md
    local-llm.md
  trends/
    local-inference.md
    ai-agent-tooling.md
    open-model-deployment.md
  predictions/
    open.md
    resolved.md
  tracking/
    active.md
    resolved.md
    candidates.md
  report-context/
    2026-06-03.md
```

### 6.3 daily intelligence page

每天保存 distilled intelligence，不保存完整 raw article。

範例：

```md
# 2026-06-03 Daily Intelligence

## Source set
- staging date: 2026-06-03
- curated sections: shipped, pulse, market, tech

## Signals retained

### Local inference moved from demo novelty to product constraint
- Claim: ...
- Evidence ids:
  - shipped.trending.0:...
  - tech.paper.2:...
- Why retained: ...
- Related pages:
  - [[trends/local-inference]]
  - [[concepts/inference]]

## Rejected / low-confidence candidates
- ...
```

### 6.4 entity pages

Entity pages 保存公司、lab、model、repo、product、people 的 durable context。

範例：

```md
# vLLM

Type: repo
Canonical URL: https://github.com/vllm-project/vllm

## Durable context
- ...

## Timeline
- 2026-06-03: ... Evidence: `shipped.trending.0:...`

## Open questions
- ...
```

### 6.5 trend pages

Trend pages 保存跨日敘事與 mechanism。

範例：

```md
# Local Inference

## Thesis
Local inference is moving from hobbyist demo to product architecture constraint when memory footprint, routing, and data privacy appear in the same source set.

## Evidence timeline
- 2026-06-03: ...

## Mechanisms
- Memory ceiling changes product surface area.
- Privacy/on-prem requirements pull inference closer to users.

## Watch criteria
- More than one vendor ships consumer-visible local inference workflows.
- Developer tooling exposes routing/offload decisions instead of hiding them.
```

### 6.6 prediction ledger

用 Wiki-managed ledger 取代 `memory.json.predictions`。

```text
predictions/open.md
predictions/resolved.md
```

範例：

```md
## pred-2026-06-03-local-inference-01

- created: 2026-06-03
- resolution_date: 2026-07-15
- status: pending
- text: By 2026-07-15, at least two consumer AI apps will advertise an explicit local/offline inference mode backed by models >= 7B parameters.
- verification: Check vendor changelogs / release notes.
- source_links:
  - shipped.trending.0:...
  - tech.paper.2:...
- related:
  - [[trends/local-inference]]
```

### 6.7 local-only tracking ledger

主人希望 tracking 的目的不是讓公開報告每天多一個欄位，而是讓 Hermes / LLM 幫主人持續盯住真正有意義的主題，避免主人需要每天人工追蹤。因此第一版 migration 不把 tracking updates 放進 public report schema，但 Wiki 必須先保留 local-only tracking 設計。

建議新增：

```text
tracking/
  active.md
  resolved.md
  candidates.md
```

用途：

- `tracking/active.md`：保存 Hermes / LLM 判斷值得持續追蹤的主題。
- `tracking/resolved.md`：保存已結束、已證實、已證偽、或已失去追蹤價值的主題。
- `tracking/candidates.md`：保存尚未確定是否值得追蹤的候選主題，避免每天重新發現同一件事。

一個 tracking item 應該包含：

```md
## track-2026-06-03-local-inference-productization

- created: 2026-06-03
- status: active
- owner: hermes
- title: Local inference productization
- thesis: Local inference is becoming a product constraint rather than a demo feature.
- why_track: This affects app architecture, privacy positioning, and aiDAPTIV+ demo opportunities.
- check_cadence: weekly
- promotion_rule: Include in report-context only when today's curated evidence changes the thesis, strengthens it, weakens it, or reaches a decision point.
- stop_rule: Archive if no meaningful new evidence appears for 45 days, or if the thesis is resolved/invalidated.
- related:
  - [[trends/local-inference]]
  - [[concepts/inference]]
- evidence:
  - 2026-06-03: `shipped.trending.0:...` — ...
```

重要原則：

- Tracking item 由 Hermes / LLM 根據每日 curated evidence 判斷是否建立，但必須保守，不可把每個新聞都變成 tracking。
- Tracking 的目標是「替主人盯住有意義的主題」，不是填版面。
- Tracking item 不預設進 public report；只有當今日 evidence 對 thesis 有實質改變時，才被 selector 放進 `report-context`。
- 第一版不新增 public `tracking_updates` 欄位；等 no-memory pipeline 穩定後再決定是否公開呈現。

### 6.8 記憶更新原則

Wiki updater 必須保守：

- 只保存 durable claims。
- 優先保存 evidence IDs，不貼完整原文。
- 不把每個 daily item 都升級成 trend 或 tracking item。
- 記錄 rejected / low-confidence candidates，避免未來重複幻覺。
- prose 裡使用人類可讀標題；slug 只用於 page path 或 metadata。

---

## 7. `report-context` 設計

Synthesizer 不應讀整個 Wiki。Stage 2.5 應該產生 bounded context：

```text
data/staging/report-context.md
```

可選 machine-readable companion：

```text
data/staging/report-context.json
```

### 7.1 context budget

第一版建議：

- Markdown 最多約 4,000–8,000 words。
- 不包含完整 raw articles。
- 不包含全部 historical predictions。
- 只放今日報告真正需要的 trends、entities、due/relevant predictions、do-not-repeat warnings。

### 7.2 `report-context.md` shape

```md
# Report Context for 2026-06-03

## Selection policy
This file is a bounded context assembled from Hermes Wiki. It is not the full memory store.

## Relevant trends

### Local inference
- Current thesis: ...
- Recent evidence: ...
- What would change the thesis: ...

## Relevant entities

### vLLM
- Durable context: ...
- Today's relevant evidence ids: ...

## Open predictions due or relevant today
- pred-...: ...

## Selected tracking items
- track-...: only include if today's evidence materially changes, strengthens, weakens, or resolves the tracked thesis.

## Yesterday's unresolved editorial threads
- ...

## Do-not-repeat warnings
- Do not frame arXiv shared `published` timestamps as same-day research bursts.
- Do not claim named sources confirmed production status unless their takeaway states it.
```

### 7.3 selector inputs

```text
data/staging/curated/*.json
data/staging/source-ages.json
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/index.md
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/trends/*.md
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/entities/**/*.md
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/predictions/open.md
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/tracking/active.md
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/tracking/candidates.md
```

Selector 不應把所有頁面塞給 synthesizer。它應根據 entity names、repo names、model names、source IDs、trend tags、prediction due dates，以及 tracking item 的 `promotion_rule` 選擇相關頁面。

---

## 8. Prompt 重構

### 8.1 要移除的舊 synthesizer contract

從 `themes/ai-builder/synthesizer.md` 和 `scripts/synthesize.sh` 移除：

- `data/memory.json` input；
- `data/memory.json` output；
- memory update instructions；
- full carry-forward of old predictions；
- required `signals.prediction_updates` from memory；
- final actions are two Write calls。

### 8.2 新 synthesizer contract

Stage 3 新 contract：

```text
Read:
- data/staging/metadata.json
- data/staging/curated/shipped.json
- data/staging/curated/pulse.json
- data/staging/curated/market.json
- data/staging/curated/tech.json
- data/staging/source-ages.json
- data/staging/report-context.md

Write:
- data/staging/editorial.json only

Do not:
- write data/memory.json
- include shipped/pulse/market/tech sections
- invent source_links
- carry forward old predictions unless they appear in report-context
```

### 8.3 新 `editorial.json` 建議 shape

```json
{
  "schema_version": "2.1-editorial",
  "date": "YYYY-MM-DD",
  "theme": "ai-builder",
  "lead": { "html": "..." },
  "signals": {
    "focus": [],
    "sleeper": {},
    "contrarian": {},
    "predictions": []
  },
  "ideation": {
    "general": [],
    "work": []
  }
}
```

### 8.4 `prediction_updates` 建議

第一版建議從 prompt 移除 `signals.prediction_updates`。

理由：

- 它是舊 `memory.json` carry-forward model 的產物。
- 一旦 memory 移到 Wiki，就不應每天 echo 全部 predictions。
- 如果有到期或 relevant prediction，應由 `report-context` 精選出來。

未來若需要，可以新增更窄的欄位：

```json
"tracking_updates": []
```

但第一版先不要新增新 public carry-forward surface。Tracking 先保留在 Hermes Wiki local-only ledger；只有被 selector 精選後，才以背景脈絡進入 `report-context`。

---

## 9. Code refactor targets

### 9.1 保留

- `src/schemas/editorial.js` 的 `schema_version: "2.1-editorial"`。
- `src/lib/merge.js` deterministic composition。
- `src/lib/merge.js` dangling `source_links` guard。
- `src/schemas/report.js` final report validation。
- `src/lib/commit.js` isolated index / data branch push strategy。
- `src/lib/source-dates.js` / `source-ages.json` recency guard。
- `scripts/check-faithfulness.sh` non-blocking faithfulness guard。

### 9.2 修改

#### `scripts/synthesize.sh`

- 移除 memory instructions。
- 要求 `data/staging/report-context.md`。
- 只寫 `data/staging/editorial.json`。
- 移除 memory repair / prune calls。
- 更新 prompt assembly text。

#### `themes/ai-builder/synthesizer.md`

- 移除 Memory section。
- 加入 Report Context section。
- 移除 `signals.prediction_updates` section。
- 更新 output contract 和 self-check checklist。

#### `themes/ai-builder/quality.md`

- 移除 `data/memory.json` internal ids allowed metadata 的規則。
- 改成 Wiki page / human-readable title discipline。

#### `scripts/analyze.sh`

- 在 curate 和 synthesize 之間插入 Stage 2.5。
- 移除 `data/memory.json` commit path。
- 更新 comments 和 failure messages。

#### `src/lib/commit.js`

把預設 paths 從：

```js
['data/reports', 'data/memory.json', 'data/feeds-snapshot.json']
```

改成：

```js
['data/reports', 'data/feeds-snapshot.json']
```

#### `package.json`

- 移除或 legacy 化 `validate:memory`。

#### docs

更新：

```text
README.md
CLAUDE.md
docs/architecture.md
```

### 9.3 刪除或退休

刪除：

```text
src/schemas/memory.js
src/lib/prune-memory.js
tests/prune-memory.test.js
```

重寫或拆分：

```text
src/lib/repair-editorial.js
tests/repair-editorial.test.js
```

如果 `repair-editorial.js` 還有非 memory 的價值，例如 coercing invalid prediction status 或 ideation field drift，應拆成新的 helper，不再依賴 `memory.json`。

### 9.4 legacy path

`FEATURE_NEW_PIPELINE=0` 是舊 lens rollback path，也仍帶 memory-style output 假設。

建議：

- 新 pipeline 驗證成功後移除。
- 若暫留，只能標註為 unsupported rollback，且 Hermes cron 不使用它。
- 不要永久保留成隱藏 memory dependency。

---

## 10. Hermes cron 設計

Hermes cron 應該作為 supervisor，不應把整個長 pipeline 塞進一個 LLM cron prompt。

### 10.1 Job A：daily dispatcher

用途：啟動每日 pipeline。

建議時間：

```text
0 7 * * *
```

時區需明確使用 `Asia/Taipei`。

建議：

- 使用 Hermes cron `no_agent: true` + script。
- Script 啟動 durable run。
- 只在 dispatch 成功或失敗時輸出短訊息。

概念設定：

```text
Name: ai-daily-report-dispatch
Schedule: 0 7 * * *
Script: scripts/hermes/cron-dispatch.sh
Delivery: origin / Telegram home
```

### 10.2 Job B：pipeline monitor

用途：監控 run state，避免長任務卡死沒人知道。

建議：

```text
every 15m
```

行為：

- 今日沒有 run，且尚未到 dispatch window：靜默。
- run active 且健康：靜默。
- run active 但 stale：發 Telegram alert。
- run success：預設不發 Telegram 成功摘要；只更新 status / logs，並標記 completed。
- run failed：發一次失敗摘要，並標記 reported。

### 10.3 Job C：Pages verifier

用途：確認 public site 真的更新。

可獨立排程，也可以整合在 monitor 後段。

驗證項目：

- `origin/data` 最新 commit；
- `data/reports/<date>.json` 是否存在；
- GitHub Pages 是否可讀到今日 report；
- `data/feeds-snapshot.json` 是否更新；
- Telegram 回報 Pages 狀態。

### 10.4 為什麼不是單一 cron job

拆成 dispatch / monitor / verifier 的理由：

- 長任務不容易被 Hermes cron timeout 影響；
- 失敗面比較清楚；
- Telegram 不會 spam；
- Hermes restart 後仍能從 status file 接續監控；
- logs 和 status 可獨立檢查。

---

## 11. Runner 與 runtime status 設計

### 11.1 proposed scripts

```text
scripts/hermes/
  daily-run.sh
  cron-dispatch.sh
  monitor-run.sh
  verify-pages.sh
  update-wiki.mjs
  build-report-context.mjs
```

### 11.2 `daily-run.sh` responsibilities

1. 載入 `.env` / agreed host env。
2. 建立 run directory。
3. 寫入 `status.json`，state=`running`。
4. 執行 Stage 1 collect。
5. 執行 Stage 2 curate。
6. 執行 Stage 2.5 Wiki update + context build。
7. 執行 Stage 3 synthesize。
8. 執行 Stage 4 merge。
9. 驗證 final report。
10. 視需要執行 site build。
11. commit/push data branch。
12. 寫入 success/failure status。

### 11.3 `status.json` shape

```json
{
  "run_id": "2026-06-03T06-30-00+08-00",
  "date": "2026-06-03",
  "state": "running",
  "stage": "curate",
  "started_at": "2026-06-03T07:00:00+08:00",
  "updated_at": "2026-06-03T06:45:00+08:00",
  "finished_at": null,
  "report_file": "data/reports/2026-06-03.json",
  "data_commit": null,
  "pages_verified": false,
  "telegram_reported": false,
  "error": null
}
```

Final states：

```text
success
failed
stale
cancelled
```

### 11.4 log policy

- full logs 存 run directory。
- Telegram 只送摘要與 log path。
- log snippet 送出前要 redaction。
- 不送 `.env` 內容。

---

## 12. Secret / deployment handling

### 12.1 可能需要的 credentials

- Claude CLI auth：`~/.claude`。
- GitHub push：`GITHUB_TOKEN` 或 host git credential。
- source-specific API keys。
- repo `.env` 或 host `~/.ai-daily-report.env`。

### 12.2 原則

- 不 commit `.env`。
- `.env` 建議權限 `600`。
- tokens 不出現在 logs / prompts。
- runner scripts 從 agreed env file 載入 secrets。
- Hermes cron prompt 不包含 secrets。

### 12.3 啟用 production 前需主人確認

- 每日執行時間與 timezone。
- 是否自動 push。
- Telegram failure-only 通知策略已確認；成功時預設靜默。
- credential source file path。
- 舊 VM 是否停用。
- `data/memory.json` 要立即從 `data` branch 移除，或保留 grace period。

---

## 13. Migration phases

### Phase 0：設計確認

產出：

- 本文件。
- 主人確認或修改意見。

不改 runtime behavior。

### Phase 1：建立 Hermes Wiki skeleton

建立：

```text
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/SCHEMA.md
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/index.md
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/log.md
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/daily/.gitkeep
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/entities/**/.gitkeep
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/concepts/*.md
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/trends/*.md
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/predictions/open.md
/home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/predictions/resolved.md
```

驗證：

```bash
test -f /home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/SCHEMA.md
test -f /home/bolin8017/Documents/Hermes/Wiki/ai-daily-report/index.md
```

### Phase 2：新增 Wiki updater 與 context builder

建立：

```text
scripts/hermes/update-wiki.mjs
scripts/hermes/build-report-context.mjs
```

第一版可以保守：

- 讀 `data/staging/curated/*.json`；
- 寫 daily intelligence page；
- append selected evidence 到 `log.md`；
- 產生 `data/staging/report-context.md`；
- 暫不大規模改 entity pages，等規則穩定後再擴張。

驗證：

```bash
node scripts/hermes/update-wiki.mjs --date YYYY-MM-DD --dry-run
node scripts/hermes/build-report-context.mjs --date YYYY-MM-DD
test -f data/staging/report-context.md
```

### Phase 3：synthesizer 改成 no-memory editorial-only

修改：

```text
scripts/synthesize.sh
themes/ai-builder/synthesizer.md
themes/ai-builder/quality.md
src/schemas/editorial.js
src/schemas/report.js
```

建議：

- prompt 不再要求 `prediction_updates`。
- schema / frontend 第一版直接移除 `prediction_updates`，不保留相容欄位。
- 增加測試，證明 editorial / final report 沒有 `prediction_updates` 也 valid。

驗證：

```bash
npm test
npm run validate:report
```

### Phase 4：移除 memory commit path

修改：

```text
scripts/analyze.sh
src/lib/commit.js
package.json
README.md
CLAUDE.md
docs/architecture.md
```

移除：

- `scripts/analyze.sh` 中 `data/memory.json` 的 `COMMIT_PATHS`。
- `src/lib/commit.js` default paths 裡的 `data/memory.json`。
- `package.json` 裡的 `validate:memory`，或標記 legacy-only。

驗證：

```bash
npm test
SKIP_PUSH=1 npm run analyze
```

### Phase 5：刪除或拆分 dead memory code

刪除：

```text
src/schemas/memory.js
src/lib/prune-memory.js
tests/prune-memory.test.js
```

重寫或拆分：

```text
src/lib/repair-editorial.js
tests/repair-editorial.test.js
```

驗證：

```bash
npm test
npm run build
```

### Phase 6：新增 Hermes operation scripts

建立：

```text
scripts/hermes/daily-run.sh
scripts/hermes/cron-dispatch.sh
scripts/hermes/monitor-run.sh
scripts/hermes/verify-pages.sh
```

驗證：

```bash
bash scripts/hermes/daily-run.sh --dry-run
bash scripts/hermes/monitor-run.sh --once
bash scripts/hermes/verify-pages.sh --date YYYY-MM-DD --dry-run
```

### Phase 7：設定 Hermes cron

主人確認敏感設定後才做。

預計 jobs：

```text
ai-daily-report-dispatch: 0 7 * * *
ai-daily-report-monitor: every 15m
ai-daily-report-pages-verify: every 15m during post-run window, or folded into monitor
```

驗證：

```bash
hermes cron list
```

正式啟用前，先手動 trigger 一次 controlled run。

### Phase 8：清理 `data` branch 舊 memory

選項：

1. 第一個 no-memory report 成功後立即刪除 `data/memory.json`。
2. 保留一週 grace period，但不再更新。

雷姆建議：成功後立即刪除。因為 stale public memory 會誤導。

驗證：

```bash
git fetch origin data
git show origin/data:data/memory.json
```

刪除後第二個命令應該失敗，這是預期結果。

---

## 14. 測試策略

### 14.1 unit tests

需要覆蓋：

- editorial schema 在沒有 `prediction_updates` 時仍 valid；
- merge 仍拒絕 dangling `source_links`；
- report-context builder 產生 bounded context；
- Wiki updater 可在 temp root / dry-run 寫出預期 pages；
- runner status transitions 正確；
- monitor idempotent，不重複 spam Telegram。

### 14.2 integration tests

本地 dry-run：

```bash
npm run collect:dry
SKIP_PUSH=1 npm run analyze
npm run validate:report
npm run build
```

如果某些步驟需要真實 Claude auth 或 GitHub token，測試文件要明確標註 prerequisite，而不是假裝通過。

### 14.3 production verification

真實 run 後確認：

- `origin/data` 有 `data/reports/<date>.json`。
- `origin/data` 有更新後的 `data/feeds-snapshot.json`。
- `data/memory.json` 不再更新，並在確認後移除。
- GitHub Pages 顯示今日 report。
- Hermes Wiki 有今日 daily intelligence page。
- `data/staging/report-context.md` 存在且 bounded。
- 若 production verification 失敗，Telegram 收到真實失敗摘要；成功 run 預設只留 status / logs。

---

## 15. Rollback strategy

Rollback 的目標是恢復報告發布，不是恢復 `memory.json` 長期架構。

### 15.1 短期 rollback

若 Stage 2.5 或新 synthesis 失敗：

1. 暫停 Hermes cron dispatcher。
2. 若舊 VM 還存在，可短暫恢復舊 VM/systemd。
3. 或回到 pre-migration commit 手動跑一次。
4. 保存 failure logs。
5. 不要未經確認就把 `memory.json` carry-forward 加回來。

### 15.2 code rollback

使用 git revert migration commits。

### 15.3 data branch rollback

如果推了壞報告：

- 為同一天推 corrected report；或
- revert `data` branch commit；或
- 讓 Pages 暫時顯示上一個有效日期並通知主人。

### 15.4 不是 rollback 的做法

永久保留 `FEATURE_NEW_PIPELINE=0` 不是 rollback，是 legacy debt。若暫留，需設定移除期限。

---

## 16. 已確認的主人決策

主人已確認以下部署與產品決策，後續實作依此執行，除非主人再修改：

1. **每日執行時間：** 改為 `07:00 Asia/Taipei`。
2. **Telegram 回報：** 只回報失敗；成功時預設靜默，但仍要在 run status / logs 中留下可查紀錄。
3. **`data/memory.json` 清理：** 第一個 no-memory report 成功後，立即從 `data` branch 刪除。
4. **舊 VM：** 主人會自行停止舊 VM；Hermes migration 不需要負責停 VM，但應避免與舊 VM 雙跑造成重複推送。
5. **Predictions UI / tracking：** 第一版直接移除 `prediction_updates`，不新增 public `tracking_updates`；但 Hermes Wiki 先保留 local-only tracking ledger，讓 Hermes / LLM 能判斷有意義的主題並持續追蹤，未來再決定是否公開呈現。
6. **Wiki privacy：** Hermes Wiki 維持 local-only，不同步到 private repo。
7. **Push gate：** 不需要人工 approval gate；完成 dry-run 與驗證後，可以讓 Hermes 自動 production push。

---

## 17. 建議實作順序

1. 主人確認本設計。
2. 建立 Hermes Wiki skeleton。
3. 新增 report-context builder dry-run。
4. 用既有 staging run 產生 context。
5. 修改 synthesizer prompt，停止寫 memory。
6. 跑 `SKIP_PUSH=1 npm run analyze` 到 report validates。
7. 移除 memory commit path。
8. 更新 docs/tests。
9. 新增 Hermes runner / monitor scripts。
10. 手動 production push 一次。
11. 驗證 GitHub Pages。
12. 啟用 Hermes cron。
13. 從 `data` branch 移除舊 `data/memory.json`。
14. 停用舊 VM schedule。

---

## 18. Acceptance criteria

遷移完成的定義：

- Hermes 能觸發每日 run。
- pipeline 不讀、不寫 `data/memory.json`。
- `data/reports/<date>.json` 通過 report schema。
- `data/feeds-snapshot.json` 更新並推送。
- GitHub Pages 顯示今日 report。
- Hermes Wiki 有今日 daily intelligence page。
- `data/staging/report-context.md` 存在且 bounded。
- 失敗時 Telegram 收到真實 run summary；成功時 status / logs 可查但預設不打擾主人。
- `npm test` 通過。
- `npm run build` 通過。
- 舊 VM/systemd schedule 已停用，或明確標註為 standby。

---

## 19. 第一輪 implementation commits 建議

### Commit 1：docs

- 加入本設計文件。
- 不改 runtime behavior。

### Commit 2：Wiki skeleton

- 建立 Hermes Wiki skeleton。
- repo docs 指向 local Wiki root。

### Commit 3：Stage 2.5 context builder

- 新增 `scripts/hermes/build-report-context.mjs`。
- 增加 fixture tests。

### Commit 4：no-memory synthesizer

- 重寫 `themes/ai-builder/synthesizer.md`。
- 修改 `scripts/synthesize.sh`。
- 調整 schema / tests。

### Commit 5：no-memory commit path

- 修改 `scripts/analyze.sh`。
- 修改 `src/lib/commit.js`。
- 移除 `validate:memory`。

### Commit 6：cleanup dead memory code

- 刪除或拆分 memory-only helpers。
- 更新 tests/docs。

### Commit 7：Hermes operation scripts

- 新增 dispatch / monitor / verify scripts。
- 加 dry-run tests。

### Commit 8：cron enablement

- 主人確認後建立 Hermes cron jobs。
- 手動 run 並驗證。

---

## 20. 給未來維護者的規則

- 不要把長期 intelligence 放回公開 `data` branch。
- 不要讓 synthesizer 寫 memory。
- 不要讓 synthesizer 讀整個 Wiki；永遠先產生 bounded context。
- 不要移除 source-link validation。
- 不要用 Hermes user profile / assistant memory 取代明確 Wiki。這個 pipeline 的 domain memory 必須可檢查、可備份、可遷移。
- 若未來新增 `tracking_updates`，只能從 Hermes Wiki local-only tracking ledger 中精選今日真的有 thesis 變化、證據增強/削弱、或到達決策點的項目；不可 echo 全部 tracking ledger。
