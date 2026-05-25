# 資料來源清單

本文件列出本專案每日爬取/抓取的所有來源，以 `src/fetchers/` 下的 4 支 fetcher 為分組單位。配置的權威來源是當前 theme 的 [`themes/ai-builder/sources.yaml`](../themes/ai-builder/sources.yaml)（預設 theme 為 `ai-builder`）；feed 基礎清單則在來源註冊表 [`src/sources/registry.js`](../src/sources/registry.js)，theme 的 `phison_overlay` 再附加 Phison 相關來源。

> **Last verified against `themes/ai-builder/sources.yaml`: 2026-05-24** — 與 sources.yaml 對齊的最近確認日期。修改 sources.yaml 或本文件時請一併更新此日期。

> 更新規則：新增或調整來源時，請同步修改 `themes/ai-builder/sources.yaml`（feed 基礎清單在 `src/sources/registry.js`）並更新本表，然後執行 `npm run check:sources` 驗證沒有漏。

---

## 抓取管線總覽

| Fetcher | 對應檔案 | 抓取機制 |
|---|---|---|
| `feeds` | `src/fetchers/feeds.js` | RSSHub routes / 原生 RSS / 原生 JSON API（來源於 `src/sources/registry.js` 基礎清單 + theme 的 `phison_overlay`，依各來源的 provider chain 分派） |
| `github-trending` | `src/fetchers/github-trending.js` | cheerio 抓 `github.com/trending` HTML + Octokit 補資料 |
| `github-search` | `src/fetchers/github-search.js` | Octokit `/search/repositories`，依 topic + `created:>30daysAgo` |
| `github-developers` | `src/fetchers/github-developers.js` | Octokit `/search/users` + 取使用者最新 repo（72h 視窗） |

RSSHub fallback：`themes/ai-builder/sources.yaml` → `rsshub_urls` 為一組依序嘗試的公共實例，目前順序為：

1. `https://rsshub.rssforever.com`
2. `https://rsshub.pseudoyu.com`

可用 `RSSHUB_URL` 環境變數強制指定單一實例（會停用 fallback，僅供本地除錯）。

---

## 1. `feeds` — RSS / RSSHub / JSON 綜合來源

預設啟用 35 個來源（不含 Phison overlay）。依分類整理如下。

### 1.1 透過 RSSHub

| 名稱 | RSSHub Route | 分類 | 每次取回上限 |
|---|---|---|---|
| Hacker News | `/hackernews/index` | community | 30 |
| Show HN | `/hackernews/show` | community | 15 |
| Dev.to Top (Week) | `/dev.to/top/week` | community | 15 |
| Anthropic News | `/anthropic/news` | AI 公司 | 10 |
| HuggingFace Daily Papers | `/huggingface/daily-papers` | 論文 | 15 |

> Hacker News 額外透過 Algolia API 補上分數與留言數。

### 1.2 透過原生 JSON API

| 名稱 | URL | 分類 | 每次取回上限 |
|---|---|---|---|
| Lobsters | `https://lobste.rs/hottest.json` | community | 15 |

### 1.3 透過原生 RSS / Atom（依分類分群）

#### 1.3.1 community（→ `pulse.hn` / `pulse.lobsters`）

| 名稱 | URL | 上限 |
|---|---|---|
| Changelog | `https://changelog.com/feed` | 10 |

#### 1.3.2 中文社群（→ `pulse.chinese_community`）

| 名稱 | URL | 上限 |
|---|---|---|
| SegmentFault | `https://segmentfault.com/feeds` | 10 |
| OSChina | `https://www.oschina.net/news/rss` | 5 |
| iThome | `https://www.ithome.com.tw/rss` | 10 |

#### 1.3.3 AI 部落格（→ `pulse.ai_bloggers`）

| 名稱 | URL | 上限 |
|---|---|---|
| Simon Willison | `https://simonwillison.net/atom/everything/` | 10 |
| Gary Marcus | `https://garymarcus.substack.com/feed` | 5 |
| Karpathy | `https://karpathy.substack.com/feed` | 5 |
| Eugene Yan | `https://eugeneyan.com/rss/` | 5 |
| Hamel Husain | `https://hamel.dev/index.xml` | 5 |
| Lilian Weng | `https://lilianweng.github.io/index.xml` | 5 |
| Sebastian Raschka | `https://magazine.sebastianraschka.com/feed` | 5 |
| Latent Space | `https://www.latent.space/feed` | 5 |

#### 1.3.4 系統/底層（→ `pulse.ai_bloggers`）

| 名稱 | URL | 上限 |
|---|---|---|
| Phoronix | `https://www.phoronix.com/rss.php` | 10 |
| LWN | `https://lwn.net/headlines/rss` | 10 |

#### 1.3.5 大廠技術 / AI 公司（→ `tech.vendor`）

| 名稱 | URL | 分類 | 上限 |
|---|---|---|---|
| Google AI Blog | `https://blog.google/technology/ai/rss` | AI 公司 | 10 |
| OpenAI | `https://openai.com/news/rss.xml` | 大廠技術 | 8 |
| Microsoft Research AI | `https://www.microsoft.com/en-us/research/feed/` | 大廠技術 | 8 |
| AWS ML Blog | `https://aws.amazon.com/blogs/machine-learning/feed/` | 大廠技術 | 8 |
| NVIDIA Developer Blog | `https://developer.nvidia.com/blog/feed` | 大廠技術 | 8 |
| Meta Research | `https://research.facebook.com/feed` | 大廠技術 | 8 |

#### 1.3.6 aiDAPTIV+ / SSD-AI 關聯（→ `tech.aidaptiv`）

| 名稱 | URL | 上限 |
|---|---|---|
| Samsung Semiconductor | `https://news.samsung.com/global/feed` | 8 |
| aiDAPTIV-Phison Releases | `https://github.com/aiDAPTIV-Phison/aiDAPTIV/releases.atom` | 10 |

> Phison Blog / vLLM Releases / LMCache Releases / NVIDIA Developer / SK Hynix News / BlocksAndFiles 透過 theme 的 `phison_overlay` 提供，見 §5。

#### 1.3.7 市場情報（→ `market.ma` / `market.funding`）

| 名稱 | URL | 上限 |
|---|---|---|
| TechCrunch Venture | `https://techcrunch.com/category/venture/feed/` | 10 |
| Stratechery Articles | `https://stratechery.com/feed` | 5 |

#### 1.3.8 政策法規（→ `market.policy`）

| 名稱 | URL | 上限 |
|---|---|---|
| Lawfare | `https://www.lawfaremedia.org/feeds/articles` | 5 |

#### 1.3.9 台灣媒體（→ `market.taiwan`）

| 名稱 | URL | 上限 |
|---|---|---|
| TechNews | `https://technews.tw/feed/` | 10 |
| Inside | `https://feeds.feedburner.com/inside` | 10 |
| TechOrange | `https://buzzorange.com/techorange/feed/` | 8 |
| DIGITIMES | `https://www.digitimes.com.tw/tech/rss/rss.asp` | 8 |

---

## 2. `github-trending` — GitHub 趨勢頁

| 來源 | URL | 機制 |
|---|---|---|
| GitHub Trending | `https://github.com/trending` | cheerio 解析 HTML（通常 25 個 repo），逐一以 Octokit `repos.get` 補上 stars / language / description / README excerpt |

無分類細項，全部歸入 `shipped` 的 trending pool。

---

## 3. `github-search` — 依 topic 搜尋（新近 30 天）

使用 Octokit `search.repos`，query 形式為：

```
topic:<TOPIC> stars:>100 created:>30daysAgo
```

每個 topic 上限 10 筆（`themes/ai-builder/sources.yaml` → `github_topics.limit_per_topic`），結果用於 `shipped` 的 discovery picks（每日 3–5 個）。

Topic 清單分為兩層（`github_topics.tier`）：`core` 每天全數查詢；`rotating` 每天依日期種子（`rotation.rotation_seed_field: date`）挑選 `rotation.rotating_per_day`（目前 3）個輪替，避免每日 query 量過大又能維持新鮮度覆蓋。

#### 3.1 core（每日固定查詢）

| Topic | 用途定位 |
|---|---|
| `rag` | RAG 框架/工具 |
| `llm` | LLM 應用與基礎設施 |
| `agent` | Agent 框架 |
| `mcp` | Model Context Protocol |
| `vlm` | 視覺-語言模型 |
| `fine-tuning` | 微調工具與資料集 |
| `web-scraping` | 抓取工具（使用者副業興趣） |
| `local-llm` | 本地端 LLM 部署/執行 |
| `inference-engine` | 推論引擎 |

#### 3.2 rotating（每日輪替挑 3 個）

| Topic | 用途定位 |
|---|---|
| `ocr` | OCR、文件解析 |
| `vector-database` | 向量資料庫 |
| `embedding` | 向量嵌入模型/工具 |
| `evaluation` | 評測框架（通用） |
| `kv-cache` | KV cache 相關研究/工具 |
| `text-to-speech` | 文字轉語音 |
| `speech-to-text` | 語音轉文字 |
| `voice-cloning` | 語音克隆 |
| `embodied-ai` | 具身智慧 |
| `vla` | Vision-Language-Action 模型 |
| `browser-automation` | 瀏覽器自動化 |
| `quantization` | 模型量化 |
| `edge-ai` | 邊緣端 AI |
| `document-ai` | 文件 AI/解析 |
| `llm-eval` | LLM 評測 |
| `multi-agent` | 多代理系統 |
| `synthetic-data` | 合成資料 |
| `ai-coding` | AI 寫程式工具 |

---

## 4. `github-developers` — 觀察 Top Developer 新 repo

使用 Octokit `search.users`，再批次取每位使用者最近 72 小時內建立的 repo。

| 區域 | Query 條件 | 取樣上限 |
|---|---|---|
| Global | `followers:>1000` | 100 名開發者 |
| Taiwan | `location:taiwan OR location:taipei` 且 `followers:>50` | 50 名開發者 |

新 repo 視窗：72 小時（`themes/ai-builder/sources.yaml` → `github_developers.new_repo_window_hours`）。輸出對應到報告中的 `dev_watch.taiwan` / `dev_watch.global`。

---

## 5. Theme overlay：Phison aiDAPTIV+

`themes/ai-builder/sources.yaml` → `phison_overlay`（`enabled: true`）會「附加」到預設來源之上（不取代）。原本的多 lens 機制（`config.json.lenses[].sources_overlay`）已移除；Phison 相關來源改以 theme 層級的 overlay 提供，對 `ai-builder` theme 永遠啟用：

### 5.1 額外 RSS 來源

| 名稱 | URL | 分類 | 上限 |
|---|---|---|---|
| Phison Blog | `https://phisonblog.com/feed/` | phison-vendor | 10 |
| vLLM Releases | `https://github.com/vllm-project/vllm/releases.atom` | kv-cache-research | 10 |
| LMCache Releases | `https://github.com/LMCache/LMCache/releases.atom` | kv-cache-research | 10 |
| NVIDIA Developer | `https://developer.nvidia.com/blog/feed` | kv-cache-research | 10 |
| SK Hynix News | `https://news.skhynix.com/feed/` | ssd-vendor | 10 |
| BlocksAndFiles | `https://blocksandfiles.com/feed/` | ssd-vendor | 10 |

### 5.2 額外 GitHub Topics

`phison_overlay.github_topics.topics`，附加到 §3 的 core/rotating topic 之上：

- `kv-cache`
- `local-llm`
- `on-device-ai`
- `llm-app`

---

## 同步檢核

執行下列指令可一次比對 `themes/$ACTIVE_THEME/sources.yaml`（預設 `ai-builder`）與本文件是否同步（包含 `phison_overlay`）：

```bash
npm run check:sources
```

- 通過：輸出 `OK — all N sources from themes/ai-builder/sources.yaml present in docs/data-sources.md`，退出碼 0。
- 漂移：列出 sources.yaml 內存在但本文件未提到的每一個 `topic` / 區域 / overlay 來源，退出碼 1。
- 邏輯實作見 [`scripts/check-data-sources.mjs`](../scripts/check-data-sources.mjs)。腳本只檢「sources.yaml → doc」單向漂移，因為本文件含大量自由文字，反向比對誤判率太高；如果你「刪除來源」，請手動同步移除本文件對應段落。

修補本文件後，把上方的 **Last verified** 日期更新成當天。

---

## 鑑識備忘

- **抓取頻率**：所有來源每天 07:00 Asia/Taipei 抓一次（systemd timer + Docker）。
- **失敗容忍度**：4 個 fetcher 同層級 parallel，允許 1 個失敗（`src/fetchers/all.js`）；feeds.js 內部對 RSSHub 走 instance fallback，對單一 RSS/JSON 失敗則跳過該來源不中斷整個 fetcher。
- **GitHub API quota**：所有 GitHub fetcher 共用同一 `GITHUB_TOKEN`；`github-search` 走 search API 限制（已驗證 30 req/min），`github-developers` 對 README enrichment 用 5-batch 控速以避開 secondary rate limit。
- **數量**：抓取後經 `src/lib/condense.js` 壓到每來源 ≤8500 tokens，再交給 Stage 2 的 `claude -p` 分析。
