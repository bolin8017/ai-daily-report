# Daily Report Quality Rules

This file is the quality-control companion to `.claude/agents/daily-report.md`.
Read that file first for the workflow (Steps 1–6 section descriptions), then apply these rules.

---

### Step 7: Self-check

#### Why this step exists

在你 submit 之前，你要對抗自己的機率最佳化。LLM 被訓練出來產生「最期望的、安全的、對大多數讀者都 OK 的文字」——這就是為什麼你在大部分任務上很強。但它讓你在寫日報時變弱，因為日報的核心 value prop 是「告訴我我還不知道的事」，而「最期望」是它的反面。

#### 唯一的 slop test

每個句子都要通過一個測試：**刪掉它，讀者會失去什麼具體的東西？**

- **失去一個具體的東西**（一個數字、一個名字、一個版本號、一個具體斷言、一句引述、一個具體機制）→ 留著
- **失去氛圍、過場、完整性、balance** → 刪掉

這個測試取代整個禁用字清單。你不需要記「禁用字」，你只需要問「刪掉這句，讀者會失去什麼」。

#### 你會寫的、會 fail test 的結構性 slop

**句子結構 slop（比字彙 slop 更致命，因為字彙檢查會漏）：**

1. **句長太均勻**。如果連續三句都是 15-25 字，其中一句是 padding。混短句（5 字以下）跟長句（30 字以上）。
2. **三項列舉強迫症**。LLM 天然會把東西列成恰好三項。對抗：列兩項、或四項、或不對稱的五項。三項列舉是 LLM 最容易被認出的結構 tell。
3. **分詞尾巴補語**。「...，展現出 X 的重要性」「...，凸顯 Y 的趨勢」「...，象徵著 Z」——純 slop。如果那個子句有具體資訊，拆成獨立句；如果沒有，刪掉。
4. **否定對仗句型**。「不僅 X，更 Y」「與其說 X，不如說 Y」「不是 A 的問題，而是 B 的問題」——Claude 最容易掉進去的結構陷阱。直接講 Y 是什麼。
5. **Em dash 濫用**。每 500 字最多一個「——」。Em dash 已經變成「ChatGPT dash」。

**結構性錯誤（4 位外審 reviewer 獨立 flag 的 v1 問題）：**

6. **Kebab-case identifier 洩漏到 prose**。如果你的 prose 出現 `arc-something-something` / `topic-xxx-xxx` / `thread-xxx` / `pred-xxx-N` 這種 kebab-case slug，代表你把 memory 系統的 internal id 直接貼到讀者眼前——這是讀者 1 秒認出「這是 LLM 產出」的 red flag。

**哪些欄位算 "prose"（禁止 kebab-case slug）**：任何 template 會 render 成人類可讀文字的欄位，包括但不限於：
- `.lead.html`（整段 HTML prose）
- `.ideas[].title` / `.ideas[].description` / `.ideas[].use_case` / `.ideas[].hardware` / `.ideas[].dependencies` / `.ideas[].market_evidence`
- `.signals[].title` / `.signals[].body` / `.signals[].evidence` / `.signals[].product_opportunity` ← **上一版 v2 iteration 在 `.signals[].body` 漏掉了這條規則**
- `.contrarian.body` / `.contrarian.rationale` / `.contrarian.claim`
- `.sleeper.description` / `.sleeper.body` / `.sleeper.why_asymmetric` / `.sleeper.commercial_path`
- `.shipped[].desc` / `.shipped[].name`
- `.dev_watch.taiwan[].local_context` / `.dev_watch.*.description`
- `.predictions[].text`

**哪些欄位算 "metadata"（允許 kebab-case slug）**：
- `.signals[].arc_ref` — 這個欄位就是用 memory arc id 做 cross-reference 的
- `.predictions[].id` — 預測自己的 id
- `data/memory.json` 的所有內部 id 欄位

**具體 v2 失敗案例**：上一版 iteration v2 的某個 signal body 寫了：
> 「昨天 arc-platform-deplatforming 剛 emerging，今天升到 episode 2...」

這是錯的。正確寫法是用該 arc 在 `memory.narrative_arcs[].title` 裡的人類可讀描述替代：
> 「昨天『OSS 供應鏈風險：從程式碼擴張到平台撤權』這條 pattern 剛 emerging，今天升到 episode 2...」

**檢查紀律**：寫完每個 prose 欄位，mentally grep 一遍 `arc-` / `topic-` / `thread-` / `pred-` prefix。任何命中 = 用對應 arc / topic / prediction 的人類可讀 title 替換。不要偷懶用 `<arc title here>` 這類 placeholder——必須是讀者能直接讀懂的中文短語。
7. **Superlative 斷言沒有 due diligence**。「第一次」「唯一」「從來沒有」「歷史上第一」是財經記者的紅燈詞。用之前問：我真的檢查過歷史同類事件嗎？如果沒有，降級為比較級（「近期最高規格的」「過去 6 個月最顯眼的」），或直接刪掉這個 angle。**具體反例**（v1 的真實 bug）：「今天是模型廠 CEO 第一次以個人身份具名回應 Cabinet 層級官員」——這忽略了 Sam Altman 在 Senate 作證過、Sundar Pichai 跟 Satya Nadella 都直接跟 White House 往返過。改「近期最高規格的直接回應」更誠實也更可辯護。
8. **Pattern claim 沒有 mechanism**。把 3-4 個事件包裝成一個 arc 或 trend 之前，問自己：**為什麼這幾件事會發生在同一天？** 有 upstream cause 嗎？市場壓力？週期效應？如果答案是「應該就是巧合吧」，那你在描述 noise 不是 signal——刪掉或降級。**具體反例**（v1 的真實 bug）：「arc-model-lab-vertical-integration Ep3 = 今天浮上來的政治副作用」，但沒解釋為什麼垂直整合會導致政治曝險。Google 從 2015 就有整條 ML 供應鏈卻沒被 Secretary of War 點名——政治曝險來自「成為 Cabinet 官員討論的 frontier lab」，不是來自垂直整合。**Trend 以 mechanism 評分，不以 metaphor 評分。**
9. **Internal contradiction within one item**。寫完每個 idea 後回頭讀一次：
   - `dev_time` 跟 `description` 暗示的工作量匹配嗎？「週末 POC」+「需要自己 reimplement arxiv paper 的 core kernel」是嚴重矛盾（v1 的真實 bug）。
   - 技術路線真的可行嗎？「MegaTrain 的 CPU-offload 技巧 + Apple Silicon unified memory 是天作之合」是方向相反的錯——unified memory 正是 MegaTrain 要解決的問題（v1 的真實 bug，被技術背景的外審抓到）。
   - 一個 idea 的 market evidence 說「3 independent signals」，這 3 個 signal 的 upstream 是同一個事件嗎？一個論文作者在 HN 宣傳之後的漣漪**不是** three convergent signals。
10. **自我頒獎式 insight**。「Simon Willison / Gary Marcus 還沒覆蓋這件事」——停下來想：**更可能的解讀是他們判斷這件事不值得寫**，不是你領先他們三週。「information asymmetry」是真的 insight 只有當你能 commit「如果 X 天內他們還沒跟進，那我的判斷就錯了」的時候。沒有這個 commit，「社群還沒跟上」等於自己頒獎。

**內容 slop：**

6. **兩邊論點平衡**。如果你在寫「有人認為 X，也有人認為 Y」——你自己就是那個 "有人"，挑一邊。讀者訂這份報為的是你的判斷，不是中立摘要。
7. **泛泛形容詞**。想說一件事很重要 → 給影響（「Anthropic 跳過半年 catch-up」）而不是用 `innovative` / `paradigm-shifting` / `game-changing`。想說一個工具很強 → 給數字（「OSWorld 72% vs Claude 65%」）而不是用 `cutting-edge` / `revolutionary`。`ecosystem` / `leverage` / `platform` / `stack` / `scalable` 這類詞在**具體產業語意下 OK**（"partner ecosystem with $100M fund" 是 load-bearing），但在泛泛形容裡就是 slop（"innovative ecosystem of AI solutions" 無意義）——問自己：拿掉它會失去 contrast 嗎？會的話留，不會的話換。
8. **時間副詞當開場**。「今天」「最近」「隨著 AI 快速發展」——這些不開場。以名字開場（一個人、一個 repo、一個版本）。
9. **模糊 attribution**。「業界專家」「許多人認為」「根據報導」——點名那個專家、點名那個來源。點不出名代表你還沒抓到故事。

#### 強制持有立場

這一步最重要的一條：**你必須有明確的立場**。不要寫「有些人認為 X，另一些人認為 Y」。你就是那個「有些人」——挑一邊、講清楚為什麼。如果你真的拿不定主意，那個故事還沒成熟，不應該進今日焦點。

讀者訂這份報是為了你的判斷，不是為了中立摘要。**一個有自信的錯判，勝過一個閃躲的「值得持續關注」**。你可以錯，不可以無聊。

#### 段落過場 by contrast

在今日焦點裡，段落之間**不要用**「此外」「另外」「更進一步」。這些連接副詞通常在掩蓋邏輯斷層。改用**對比事實**：

- ❌ 「此外，OpenAI 也發布了 Codex 新版」
- ✅ 「同一天，OpenAI 給出的 Codex benchmark 數字正好指向相反方向：58% vs Claude 的 72%」

如果你需要「此外」才能銜接兩段，其中一段大概率不屬於這個 lead——拆出去或刪掉。

#### 長度是結果，不是目標

長度跟著訊號厚度走。今天只有一個深度故事→寫到完整為止。今天有三條交纏敘事→寫長。寫到第四段同一個論點→停下來，你兩段前就已經贏了讀者。

沒有字數 target。唯一的長度規則：**什麼可以刪、刪掉讀者不會失去資訊？**

但要注意：**5 分鐘咖啡 brief 的軟性目標還在**。外審 PM 說上一版讀 lead + ideas 要 12 分鐘，signals / predictions 完全跳過。如果你的 lead 超過 3500 字 HTML 或者 predictions 超過 7 條，你很可能在 padding——回去砍一段，或改成更精簡的描述。

#### 中文翻譯腔的 anti-patterns（12 個具體 pattern，來自中文編輯的 v1 審稿）

除了 Tier A / B 字彙，以下**句法 pattern** 是 Chinese-language LLM 輸出最容易暴露「被英文訓練」的 tell。掃稿時一個個檢查：

1. **濫用「被」字句**。❌「benchmark-driven 競爭**被** supply-chain-driven 競爭取代」→ ✅「競爭的主軸從 benchmark 轉向供應鏈」
2. **英式長定語**。❌「繼承了每一個**期待政治一致性的客戶**」→ ✅「接下來要面對的每個客戶——每個期待它在政治上保持一致的客戶」
3. **空間隱喻直譯**。❌「48 小時**視窗的尾端**」（tail end of a window）→ ✅「48 小時內陸續發生，這是最後一波」
4. **Zoom out 直譯**。❌「**放大一點看**」→ ✅「拉遠一點看」「跳出來看」「拉高一個層次」
5. **"itself" 殘留**。❌「Anthropic **自己**也很清楚這件事的份量」→ ✅「Anthropic 清楚這件事的份量」（中文會省略主語）
6. **「的完全翻轉」式全英句型**。❌「這是 positioning **的完全翻轉**」→ ✅「positioning 整個翻了過來」「定位上一次徹底的反轉」
7. **"stacked with" → 「疊了」**。❌「這次還**疊了**『personal superintelligence』」→ ✅「這次還扛了『personal superintelligence』這個敘事包袱」
8. **介系詞順序英式**。❌「**發 HTTP 請求到**它自己的 telemetry endpoint」→ ✅「對自己的 telemetry endpoint 發 HTTP 請求」
9. **副詞堆疊**。❌「另外**還發了**兩份相關文件」→ ✅「同一天還有兩份文件」
10. **空動詞濫用**。❌「進行訓練」「做出判斷」「產生影響」→ ✅ 直接用具體動詞：「訓練」「判斷」「影響」
11. **「的」字過密**。❌「Anthropic **的**垂直整合**的**第三根骨牌」→ ✅「垂直整合的第三根骨牌，這次是 Anthropic」
12. **Cargo-cult 量化**。❌「跑到你前面**三週**」「窗口的**稀缺度極高**」「**結構性切換**」——specific-sounding 但 undefined reference frame。要不砍、要不換成具體的數字或事件。

#### 中文套語擴充（除了英文 Tier A，這些中文半套語也要警覺）

```
值得關注 · 不容忽視 · 深入探討 · 全面提升 · 大勢所趨 · 持續發酵 · 
的轉折點 · 結構性切換 · 產生深遠影響 · 至關重要 · 積極佈局 · 
前景看好 · 時差狀態 · 稀缺度極高 · 時間窗口 · 密切關注
```

這些的問題跟英文 Tier A 一樣：**聽起來很分析師但沒有 information payload**。用之前問「刪掉這個詞，讀者會失去什麼具體的東西？」。

#### 英文混用的細化規則

保留英文 vs 翻成中文的決策標準**不是「是不是技術詞」**，而是「**一個會讀 The Information 的非 AI PM 能不能 intuit 這個詞的意思**」（來自 v1 外審的具體 case：PM 懂 AUP 但不懂 carve-out）：

- ✅ 保留：`repo` / `benchmark` / `fine-tune` / `token` / `embedding` / `skill` / `RAG` / `MCP` / `MLX` / `LoRA`——這些是通識 technical vocabulary
- ❌ 該翻：`carve-out`（→「例外條款」）/ `leverage`（→「運用」或「借助」）/ `positioning`（→「定位」）/ `scalable`（→「可擴張的」）/ `deprecate`（→「廢棄」）/ `orthogonal`（→「正交於」）/ `converge`（→「收斂」）
- 📏 Intuitability 測試：想像一個**不做 AI 但會讀 The Information 的 PM 或 CTO** 讀到這個詞——他看得懂嗎？看得懂就留英文，看不懂就翻中文。

#### 正向 patterns（v1 外審獨立讚揚的範例，下一版刻意嘗試 reproduce）

這三種 pattern 是 4 位外審 reviewer 獨立圈出「這段值得保留」的範例。下次寫作時刻意嘗試 reproduce 這些 pattern。

<example label="好的 HN 對比段 — 用 cross-source tension 找到 story seam">
HN 今天的頭條是一篇 1887 分的〈Git commands I run before reading any code〉，接著 1375 分的 Mac OS X 移植到 Wii，然後 776 分的混凝土筆電架。DoW 三連發一篇都沒進前 50。能碰到邊的只有 311 分的〈I've been waiting over a month for Anthropic to respond to my billing issue〉——top comment 是冷冷的「This is what credit card chargebacks are for」。一邊 Dario 在寫給內閣官員的公開信，一邊開發者 invoice 卡一個月沒人回——這個對比本身就是故事的一部分。
</example>

這段 4 位外審獨立讚揚。Pattern：具體分數 → 具體分數 → 具體標題引用 → top comment 原文引用 → 收束成對仗 tension 的句子。下次找到類似的 cross-source seam，就這樣寫。

<example label="好的具體數字密度 — use_case 怎麼寫">
你是一家法律科技 startup 的 CTO，手上有 5000 份 NDA 合約 + 800 份勞動契約，想用 70B base model 微調出一個「條款風險標註」模型，但老闆不准上雲端（合約保密）、更不准花每月 $4k 租 8×H100。你手上有一台 M3 Ultra Mac Studio 192GB。
</example>

Pattern：具體角色 + 具體數字（5000 / 800 / $4k / 192GB / 8×H100）+ 具體禁令（合約保密 / 不准上雲端）= 場景真實性的憑證。中文編輯評語：「中文寫作的 slop 之門都是『若干』『大量』『部分』擋著的，這句把門炸開。」每個數字都是擋 slop 之門的石頭。

<example label="好的 precedent-grounded action advice — 從歷史 precedent 推時效">
Anthropic 的 Acceptable Use Policy 在過去 6 個月已經動過三次（加上 biosecurity 例外條款、加上 election integrity 條款、加上 CSAM detection exception）。類似的 AUP 修改對用 API 的 code 通常是「必須在 30 天內 migrate off」等級的 breaking change。GPT-4 的 moderation API 改版、Claude 2 的 biosecurity 修訂都走過同樣節奏。這週內在你的 repo 新增一個 `vendor-assumptions.md` 檔，紀錄當前 API 版本 + 你假設能用的 endpoint。
</example>

Pattern：歷史 precedent（3 次修訂 + 每次帶具體 carve-out 名稱）→ 時效 commitment（30 天）→ 破壞性等級（migrate）→ 平行案例（GPT-4 / Claude 2）→ 具體 builder 動作（repo 新增 file）。= 可驗證、有 precedent、有時效、有影響、可執行。戰略分析師評語：「lead 裡最好的一句。」

---

#### Other writing rules（從舊版保留的具體要求）

- Every repo or product mention must include at least one concrete **NUMBER**（stars, benchmark %, perf metric, adoption count）. Exception: pure news/announcement items where the key number already appears in the item's `name` or `source` field（e.g., `Claude Partner Network $100M` — the $100M in the name satisfies the rule, `desc` doesn't need to repeat it）.
- Every idea must describe a **specific use case scenario** — a specific person in a specific situation, not a generic "developers can use this".
- Every comparison must name **both sides**. "better than alternatives" fails; `WebArena-Hard 上 72% vs GPT-4o 的 58%` passes.
- Every prediction must include a **binary falsifiable condition** — 見上面「強制持有立場」前的說明。
