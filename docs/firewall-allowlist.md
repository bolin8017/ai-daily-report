# Firewall Allowlist（防火牆白名單）

本專案在企業內網運行時，需要對外連線的網域。全部走 HTTPS / 443。

> 來源用途細節見 [data-sources.md](./data-sources.md)。

## 純清單（貼工單用）

```
rsshub.rssforever.com
rsshub.pseudoyu.com
hn.algolia.com
lobste.rs
segmentfault.com
www.oschina.net
www.ithome.com.tw
changelog.com
simonwillison.net
garymarcus.substack.com
karpathy.substack.com
eugeneyan.com
hamel.dev
lilianweng.github.io
magazine.sebastianraschka.com
www.latent.space
blog.google
openai.com
www.microsoft.com
aws.amazon.com
developer.nvidia.com
research.facebook.com
www.phoronix.com
lwn.net
github.com
api.github.com
techcrunch.com
stratechery.com
www.lawfaremedia.org
technews.tw
feeds.feedburner.com
buzzorange.com
www.digitimes.com.tw
news.samsung.com
phisonblog.com
news.skhynix.com
blocksandfiles.com
api.anthropic.com
statsig.anthropic.com
sentry.io
registry.npmjs.org
registry-1.docker.io
auth.docker.io
production.cloudflare.docker.com
deb.debian.org
security.debian.org
```

## 網域與用途

### 資料來源 — RSSHub 與社群

| Hostname | 用途 |
|---|---|
| `rsshub.rssforever.com` | RSSHub 公共實例（首選） |
| `rsshub.pseudoyu.com` | RSSHub 公共實例（fallback） |
| `hn.algolia.com` | Hacker News 分數/留言數 |
| `lobste.rs` | Lobsters JSON API |
| `changelog.com` | Changelog RSS |

### 資料來源 — 中文社群

| Hostname | 用途 |
|---|---|
| `segmentfault.com` | SegmentFault RSS |
| `www.oschina.net` | OSChina RSS |
| `www.ithome.com.tw` | iThome RSS |

### 資料來源 — AI 部落格

| Hostname | 用途 |
|---|---|
| `simonwillison.net` | Simon Willison Atom |
| `garymarcus.substack.com` | Gary Marcus RSS |
| `karpathy.substack.com` | Karpathy RSS |
| `eugeneyan.com` | Eugene Yan RSS |
| `hamel.dev` | Hamel Husain RSS |
| `lilianweng.github.io` | Lilian Weng Atom |
| `magazine.sebastianraschka.com` | Sebastian Raschka Substack |
| `www.latent.space` | Latent Space Substack |

### 資料來源 — 系統/底層

| Hostname | 用途 |
|---|---|
| `www.phoronix.com` | Phoronix RSS |
| `lwn.net` | LWN RSS |

### 資料來源 — 大廠技術 / AI 公司

| Hostname | 用途 |
|---|---|
| `blog.google` | Google AI Blog RSS |
| `openai.com` | OpenAI News RSS |
| `www.microsoft.com` | Microsoft Research AI RSS |
| `aws.amazon.com` | AWS ML Blog RSS |
| `developer.nvidia.com` | NVIDIA Developer Blog RSS |
| `research.facebook.com` | Meta Research RSS |

### 資料來源 — 市場 / 政策 / 台灣媒體

| Hostname | 用途 |
|---|---|
| `techcrunch.com` | TechCrunch Venture RSS |
| `stratechery.com` | Stratechery Articles RSS |
| `www.lawfaremedia.org` | Lawfare RSS |
| `technews.tw` | TechNews RSS |
| `feeds.feedburner.com` | Inside RSS（feedburner） |
| `buzzorange.com` | TechOrange RSS |
| `www.digitimes.com.tw` | DIGITIMES RSS |

### 資料來源 — aiDAPTIV+ / SSD-AI 相關

主來源走主 config（PR #30 起 promote 出 lens overlay）：

| Hostname | 用途 |
|---|---|
| `news.samsung.com` | Samsung Semiconductor News RSS |
| `github.com` | `aiDAPTIV-Phison/aiDAPTIV` releases.atom（已列於 GitHub 區段） |

仍在 lens overlay（僅啟用該 lens 時需要）：

| Hostname | 用途 |
|---|---|
| `phisonblog.com` | Phison Blog RSS |
| `news.skhynix.com` | SK Hynix 新聞 RSS |
| `blocksandfiles.com` | BlocksAndFiles RSS |

### GitHub

| Hostname | 用途 |
|---|---|
| `github.com` | Trending HTML、`releases.atom`、git clone/push |
| `api.github.com` | Octokit REST API（搜尋、README、開發者） |

### LLM 分析（Stage 2 / 3）

| Hostname | 用途 |
|---|---|
| `api.anthropic.com` | Claude API 推論（必要） |
| `statsig.anthropic.com` | Anthropic feature flag |
| `sentry.io` | Claude CLI 錯誤追蹤（可省） |

### 構建 / 容器 / 套件（首次安裝 + 更新時）

| Hostname | 用途 |
|---|---|
| `registry.npmjs.org` | npm 套件 |
| `registry-1.docker.io` | Docker Hub registry |
| `auth.docker.io` | Docker Hub 認證 |
| `production.cloudflare.docker.com` | Docker 映像層 CDN |
| `deb.debian.org` | Debian apt 套件源 |
| `security.debian.org` | Debian 安全更新 |

---

_Last updated: 2026-05-22_
