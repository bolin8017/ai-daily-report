Title: Simon Willison’s Weblog

URL Source: https://simonwillison.net/

Published Time: Fri, 22 May 2026 07:54:21 GMT

Markdown Content:
## [Entries](https://simonwillison.net/entries/)[Links](https://simonwillison.net/blogmarks/)[Quotes](https://simonwillison.net/quotations/)[Notes](https://simonwillison.net/notes/)[Guides](https://simonwillison.net/guides/)[Elsewhere](https://simonwillison.net/elsewhere/)

### May 22, 2026

**[FTC to Require Cox Media Group, Two Other Firms to Pay Nearly $1 Million to Settle Charges They Deceived Customers About “Active Listening” AI-Powered Marketing Service](https://www.ftc.gov/news-events/news/press-releases/2026/05/ftc-require-cox-media-group-two-other-firms-pay-nearly-1-million-settle-charges-they-deceived)** ([via](https://twitter.com/nydiatisdale/status/2057657844321705993 "@nydiatisdale")) Back in 2024 Cox Media Group were caught trying to sell advertisers packages based on "active listening", with [this deck](https://www.documentcloud.org/documents/25051283-cmg-pitch-deck-on-voice-data-advertising-active-listening/) which claimed:

> *   Smart devices capture real-time intent data by listening to our conversations
> *   Advertisers can pair this voice-data with behavioral data to target in-market consumers

I wrote about this [in September 2024](https://simonwillison.net/2024/Sep/2/facebook-cmg/). My theory:

> I think **active listening** is the term that the team came up with for “something that sounds fancy but really just means the way ad targeting platforms work already”. Then they got over-excited about the new metaphor and added that first couple of slides that talk about “voice data”, without really understanding how the tech works or what kind of a shitstorm that could kick off when people who DID understand technology started paying attention to their marketing.

This FTC press release appears to confirm that's pretty much what happened:

> CMG, MindSift and 1010 Digital Works claimed their “Active Listening” branded marketing service listened in on consumers’ conversations overheard by smart devices, in real time, to target advertising [...]
> 
> 
> According to the complaints, this service did not, in fact, listen in on consumers’ conversations or use voice data at all—nor did the service accurately place ads in customers’ desired locations. Instead, the service the companies provided consisted of reselling—at a significant markup—email lists obtained from other data brokers.

The FTC also clarify that hiding an "opt-in" to using voice data in terms of service would not be acceptable, as tricks like that do not constitute "adequate consent":

> The FTC also alleged that all three companies deceived potential customers by claiming that consumers had opted into the Active Listening service. The company, however, did not seek or obtain consumers’ consent, according to the complaints. Instead, the companies claimed that consumers had “opted in” by agreeing to the terms of service that people have to accept when downloading and using apps. Clicking through mandatory terms of service does not constitute “opt-in consent” for such an invasive service or for use of consumers’ voice data from inside their homes. If the Active Listening service had functioned as advertised, this collection and use of consumers’ voice data without adequate consent would itself violate Section 5 of the FTC Act.

Attempting to myth bust [the conspiracy theory](https://simonwillison.net/tags/microphone-ads-conspiracy/) that our mobile devices target ads to us based on spying through the microphones continues to be my least rewarding niche online hobby. It's nice to have a new piece of ammunition.

[#](https://simonwillison.net/2026/May/22/ftc-active-listening/)[4:48 am](https://simonwillison.net/2026/May/22/ftc-active-listening/) / [privacy](https://simonwillison.net/tags/privacy/), [microphone-ads-conspiracy](https://simonwillison.net/tags/microphone-ads-conspiracy/)

### May 21, 2026

### [Datasette Agent](https://simonwillison.net/2026/May/21/datasette-agent/)

[![Image 1: Visit Datasette Agent](https://static.simonwillison.net/static/2026/datasette-agent.jpg)](https://simonwillison.net/2026/May/21/datasette-agent/)

We just [announced the first release of Datasette Agent](https://datasette.io/blog/2026/datasette-agent/), a new extensible AI assistant for Datasette. I’ve been working on my [LLM](https://llm.datasette.io/) Python library for just over three years now, and Datasette Agent represents the moment that LLM and [Datasette](https://datasette.io/) finally come together. I’m really excited about it!

[... [659 words](https://simonwillison.net/2026/May/21/datasette-agent/)]

A Datasette Agent plugin for running commands in a [Fly Sprites](https://sprites.dev/) sandbox.

> *   "View SQL query" buttons below rendered charts.

> *   "View SQL query" buttons for both visible tables and collapsed SQL result tool calls.
> *   Don't display empty reasoning chunks
> *   Improved handling of truncated responses - table still displays to the user even if the SQL results were truncated when showing the agent.

See [Datasette Agent, an extensible AI assistant for Datasette](https://datasette.io/blog/2026/datasette-agent/).

### May 20, 2026

> We have the ability to use compute resources to support our proprietary AI applications (such as Grok 5, which is currently being trained at COLOSSUS II), while also providing access to select compute capacity to third-party customers. For example, in May 2026, we entered into **Cloud Services Agreements with Anthropic PBC** (“Anthropic”), an AI research and development public benefit corporation, with respect to access to **compute capacity across COLOSSUS and COLOSSUS II**. Pursuant to these agreements, the customer **has agreed to pay us $1.25 billion per month** through May 2029, with capacity ramping in May and June 2026 at a reduced fee. The agreements may be terminated by either party upon 90 days’ notice.

— [SpaceX S-1](https://www.sec.gov/Archives/edgar/data/1181412/000162828026036936/spaceexplorationtechnologi.htm), highlights mine

[#](https://simonwillison.net/2026/May/20/spacex-s1/)[10:26 pm](https://simonwillison.net/2026/May/20/spacex-s1/) / [anthropic](https://simonwillison.net/tags/anthropic/), [grok](https://simonwillison.net/tags/grok/), [generative-ai](https://simonwillison.net/tags/generative-ai/), [ai](https://simonwillison.net/tags/ai/), [llms](https://simonwillison.net/tags/llms/)

**[How fast is 10 tokens per second really?](https://mikeveerman.github.io/tokenspeed/)** ([via](https://news.ycombinator.com/item?id=48174920 "Hacker News")) Neat little HTML app by Mike Veerman ([source code here](https://github.com/MikeVeerman/tokenspeed/blob/master/index.html)) which simulates LLM token output speeds from 5/second to 800/second.

Useful if you see a model advertised as "30 tokens/second" and want to get a feel for what that actually looks like.

[#](https://simonwillison.net/2026/May/20/tokens-per-second/)[5:57 pm](https://simonwillison.net/2026/May/20/tokens-per-second/) / [ai](https://simonwillison.net/tags/ai/), [generative-ai](https://simonwillison.net/tags/generative-ai/), [llms](https://simonwillison.net/tags/llms/)

It's hard to find much to write about Google I/O this year because I have a policy of not writing about anything that I can't try out myself, and a lot of the big announcements are "coming soon".

I actually prefer to write about things that are in general availability, because I've had instances in the past where the previews didn't match what was released to the general public later on.

Aside from [Gemini 3.5 Flash](https://simonwillison.net/2026/May/19/gemini-35-flash/) the most interesting announcement looks to be Google's upcoming OpenClaw competitor [Gemini Spark](https://gemini.google/overview/agent/spark/), described as "your personal AI agent" which can "connect natively with your favorite Google apps like Gmail, Calendar, Drive, Docs, Sheets, Slides, YouTube, and Google Maps". The FAQ for that also includes this confusing detail:

> **What Gemini model does Gemini Spark run on?**
> 
> 
> Gemini Spark runs on Gemini 3.5 Flash and Antigravity.

The [antigravity.google](https://antigravity.google/) website currently lists Antigravity as a desktop app, a CLI agent tool (written in Go), the [Antigravity SDK](https://github.com/google-antigravity/antigravity-sdk-python) (an open source Python wrapper around a bundled closed source Go binary), and the original Antigravity IDE (a VS Code fork).

I guess Gemini Spark, the user-facing hosted agent product, might be running on that Go binary, but I'm not sure why that's worth mentioning in the FAQ!

Naturally I went looking for notes on how Gemini Spark intends to handle the risk of prompt injection. The best information I could find on that was in the [Everything Google Cloud customers need to know coming out of Google I/O](https://cloud.google.com/blog/products/ai-machine-learning/innovations-from-google-io-26-on-google-cloud) post aimed at enterprise customers, which includes:

> Spark operates in a fully managed, secure runtime on Google Cloud, meaning you get enterprise-grade security without ever having to manage the underlying infrastructure. Every task executes in a fresh, strictly isolated, ephemeral VM to help ensure data never overlaps between sessions. To protect your enterprise, all traffic routes through our secure Agent Gateway that enforces Data Loss Prevention (DLP) policies, while user credentials remain fully encrypted and are never exposed directly to the agent.

Given how many people are going to be piping _very_ sensitive data through Gemini Spark in the near future I hope they've made this bullet-proof, or this could be a top candidate for the agent security [challenger disaster](https://simonwillison.net/2026/Jan/8/llm-predictions-for-2026/#1-year-a-challenger-disaster-for-coding-agent-security) that we still haven't seen.

Also of note: in [Transitioning Gemini CLI to Antigravity CLI](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/) Google announce that the [open source Gemini CLI](https://github.com/google-gemini/gemini-cli) tool (Apache 2.0 licensed TypeScript) will stop working with their AI subscription plans on June 18th, replaced by the new closed source [Antigravity CLI](https://github.com/google-antigravity/antigravity-cli).

[#](https://simonwillison.net/2026/May/20/google-io/)[3:32 pm](https://simonwillison.net/2026/May/20/google-io/) / [gemini](https://simonwillison.net/tags/gemini/), [google](https://simonwillison.net/tags/google/), [generative-ai](https://simonwillison.net/tags/generative-ai/), [ai](https://simonwillison.net/tags/ai/), [google-io](https://simonwillison.net/tags/google-io/), [llms](https://simonwillison.net/tags/llms/), [prompt-injection](https://simonwillison.net/tags/prompt-injection/)

> *   More color! Bar and waffle charts without a color column are shaded by magnitude with a sequential color scheme; color columns holding text values use the `observable10` categorical scheme. #2
> *   Now checks `execute-sql` permission before running the query to find the column names.
> *   Charts now display interactive tooltips.
> *   Fixed a bug where `waffleY` charts were not described to the agent.

### May 19, 2026

### [Gemini 3.5 Flash: more expensive, but Google plan to use it for everything](https://simonwillison.net/2026/May/19/gemini-35-flash/)

[![Image 2: Visit Gemini 3.5 Flash: more expensive, but Google plan to use it for everything](https://static.simonwillison.net/static/2026/gemini-3.5-flash.png)](https://simonwillison.net/2026/May/19/gemini-35-flash/)

Today at Google I/O, Google [released Gemini 3.5 Flash](https://blog.google/innovation-and-ai/models-and-research/gemini-models/gemini-3-5/). This one skipped the `-preview` modifier and went straight to general availability, and Google appear to be using it for a whole lot of their key products:

[... [610 words](https://simonwillison.net/2026/May/19/gemini-35-flash/)]

> *   Fixed bug tracking chains of responses. Refs [datasette-llm#7](https://github.com/datasette/datasette-llm/issues/7)

> *   Compatible with `llm>=0.32a0` alpha - adds the ability to stream reasoning tokens.

> *   Fix for bug where `llm_prompt_context()` hook did not fully collect chains of responses. #7

### [The last six months in LLMs in five minutes](https://simonwillison.net/2026/May/19/5-minute-llms/)

[![Image 3: Visit The last six months in LLMs in five minutes](https://static.simonwillison.net/static/2026/5-minutes-llms/5-minutes-llms.001.jpeg)](https://simonwillison.net/2026/May/19/5-minute-llms/)

I put together these annotated slides from my five minute lightning talk at PyCon US 2026, using the [latest iteration](https://tools.simonwillison.net/annotated-presentations) of my [annotated presentation tool](https://simonwillison.net/2023/Aug/6/annotated-presentations/).

[... [2,061 words](https://simonwillison.net/2026/May/19/5-minute-llms/)]

### May 18, 2026

### May 17, 2026

**[GDS weighs in on the NHS’s decision to retreat from Open Source](https://shkspr.mobi/blog/2026/05/gds-weighs-in-on-the-nhss-decision-to-retreat-from-open-source/)**. Terence Eden continues his coverage of the NHS' [poorly considered decision](https://shkspr.mobi/blog/2026/05/nhs-goes-to-war-against-open-source/) to close down access to their open source repositories in response to vulnerabilities reported to them as part of [Project Glasswing](https://simonwillison.net/2026/Apr/7/project-glasswing/).

Now the Government Digital Service have joined the conversation with [AI, open code and vulnerability risk in the public sector](https://www.gov.uk/guidance/ai-open-code-and-vulnerability-risk-in-the-public-sector), published May 14th. Their key recommendation:

> Keep open by default. Making everything private adds additional delivery and policy costs, and can reduce reuse and scrutiny. Openness should remain the default posture, with closure used sparingly and deliberately.

While they don't mention the NHS by name, Terence speaks the language of the civil service and interprets this as a major escalation:

> Within the UK's Civil Service you occasionally hear the expression "being invited to a meeting _without biscuits_". It implies a rather frosty discussion without any of the polite niceties of a normal meeting. In general though, even when people have severe disagreements, it is rare for tempers to fray. It is even rarer for those internal disagreements to spill over into public.

[#](https://simonwillison.net/2026/May/17/gds-weighs-in/)[3:59 pm](https://simonwillison.net/2026/May/17/gds-weighs-in/) / [open-source](https://simonwillison.net/tags/open-source/), [security](https://simonwillison.net/tags/security/), [ai](https://simonwillison.net/tags/ai/), [generative-ai](https://simonwillison.net/tags/generative-ai/), [llms](https://simonwillison.net/tags/llms/), [gov-uk](https://simonwillison.net/tags/gov-uk/), [terence-eden](https://simonwillison.net/tags/terence-eden/), [ai-ethics](https://simonwillison.net/tags/ai-ethics/), [ai-security-research](https://simonwillison.net/tags/ai-security-research/)

### May 16, 2026

In preparation for a lightning talk I'm giving at PyCon US [this afternoon](https://us.pycon.org/2026/schedule/presentation/175/) I decided to figure out how many names OpenClaw has _actually_ had since that [first commit](https://github.com/openclaw/openclaw/commit/f6dd362d39b8e30bd79ef7560aab9575712ccc11) back in November.

Thanks to this [first_line_history.py tool](https://tools.simonwillison.net/python/#first_line_historypy) ([code here](https://github.com/simonw/tools/blob/main/python/first_line_history.py)) the answer, according to the Git history of the OpenClaw README, is:

Warelay → CLAWDIS → CLAWDBOT → Clawdbot → Moltbot →🦞 OpenClaw

Or in detail (the output from the tool):

2025-11-24T11:23:15+01:00 [16dfc1a](https://github.com/openclaw/openclaw/commit/16dfc1a) # Warelay — WhatsApp Relay CLI (Twilio)
2025-11-24T11:41:37+01:00 [d4153da](https://github.com/openclaw/openclaw/commit/d4153da) # 📡 Warelay — WhatsApp Relay CLI (Twilio)
2025-11-24T17:47:57+01:00 [343ef9b](https://github.com/openclaw/openclaw/commit/343ef9b) # 📡 warelay — WhatsApp Relay CLI (Twilio)
2025-11-25T04:44:10+01:00 [14b3c6f](https://github.com/openclaw/openclaw/commit/14b3c6f) # 📡 warelay — WhatsApp Relay CLI
2025-11-25T12:48:40+01:00 [4814021](https://github.com/openclaw/openclaw/commit/4814021) # 📡 warelay — Send, receive, and auto-reply on WhatsApp—Twilio-backed or QR-linked.
2025-11-25T13:50:18+01:00 [d51a3e9](https://github.com/openclaw/openclaw/commit/d51a3e9) # warelay 📡 - Send, receive, and auto-reply on WhatsApp via Twilio or QR-linked WhatsApp Web; webhook setup in one command
2025-11-25T13:51:13+01:00 [4d2a8a8](https://github.com/openclaw/openclaw/commit/4d2a8a8) # 📡 warelay — Send, receive, and auto-reply on WhatsApp—Twilio-backed or QR-linked.
2025-11-25T14:52:43+01:00 [1ef7f4d](https://github.com/openclaw/openclaw/commit/1ef7f4d) # 📡 warelay — Send, receive, and auto-reply on WhatsApp.
2025-12-03T15:45:32+00:00 [a27ee23](https://github.com/openclaw/openclaw/commit/a27ee23) # 🦞 CLAWDIS — WhatsApp Gateway for AI Agents
2025-12-08T12:43:13+01:00 [17fa2f4](https://github.com/openclaw/openclaw/commit/17fa2f4) # 🦞 CLAWDIS — WhatsApp & Telegram Gateway for AI Agents
2025-12-19T18:41:17+01:00 [7710439](https://github.com/openclaw/openclaw/commit/7710439) # 🦞 CLAWDIS — Personal AI Assistant
2026-01-04T14:32:47+00:00 [246adaa](https://github.com/openclaw/openclaw/commit/246adaa) # 🦞 CLAWDBOT — Personal AI Assistant
2026-01-10T05:14:09+01:00 [cdb915d](https://github.com/openclaw/openclaw/commit/cdb915d) # 🦞 Clawdbot — Personal AI Assistant
2026-01-27T13:37:47-05:00 [3fe4b25](https://github.com/openclaw/openclaw/commit/3fe4b25) # 🦞 Moltbot — Personal AI Assistant
2026-01-30T03:15:10+01:00 [9a71607](https://github.com/openclaw/openclaw/commit/9a71607) # 🦞 OpenClaw — Personal AI Assistant

[#](https://simonwillison.net/2026/May/16/openclaw-names/)[8:23 pm](https://simonwillison.net/2026/May/16/openclaw-names/) / [openclaw](https://simonwillison.net/tags/openclaw/), [git](https://simonwillison.net/tags/git/), [tools](https://simonwillison.net/tags/tools/)

> [...] in the last 10 years I’ve learned to really love and respect CSS as a technology.
> 
> 
> So I decided years ago that I wanted to react to “CSS is hard” by getting better at CSS and taking it seriously as a technology, instead of devaluing it. Doing that changed everything for me: I learned that so many of my frustrations (“centering is impossible”) had been addressed in CSS a long time ago, and that also what “centering” means is not always straightforward and it makes sense that there are many ways to do it. CSS is hard because it’s solving a hard problem!

— [Julia Evans](https://jvns.ca/blog/2026/05/15/moving-away-from-tailwind--and-learning-to-structure-my-css-/), Moving away from Tailwind, and learning to structure my CSS

[#](https://simonwillison.net/2026/May/16/julia-evans/)[4:45 pm](https://simonwillison.net/2026/May/16/julia-evans/) / [css](https://simonwillison.net/tags/css/), [julia-evans](https://simonwillison.net/tags/julia-evans/)

### May 15, 2026

[![Image 4: Western Gull](https://static.inaturalist.org/photos/660343826/small.jpg)](https://static.inaturalist.org/photos/660343826/large.jpg)

[Western Gull](https://www.inaturalist.org/observations/361818285 "View observation on iNaturalist")

[![Image 5: Rock Pigeon](https://static.inaturalist.org/photos/660344126/small.jpg)](https://static.inaturalist.org/photos/660344126/large.jpg)

[Rock Pigeon](https://www.inaturalist.org/observations/361818412 "View observation on iNaturalist")

I went for a bird walk in the morning before PyCon, and we spotted a local seagull enjoying a Starbucks.

Claude helped me build this tool for creating QR codes, for both text/URLs and for connecting to WiFi networks.

![Image 6: Screenshot of a QR code generator web form. Heading "QR code generator" with subtitle "Create a scannable code for a URL, text, or WiFi network." A segmented toggle shows "URL / text" and "WiFi" with WiFi selected. Below are fields: "Network name (SSID)" with placeholder "My WiFi"; "Password" with placeholder "Password" and a blue "Show" link; "Security" dropdown set to "WPA / WPA2 / WPA3 (most common)"; an unchecked "Hidden" checkbox; helper text "Not sure? Leave it on WPA / WPA2 / WPA3 — that covers almost every home WiFi network." Below that: "Style" dropdown set to "Square", an unchecked "Border" checkbox, "Size" dropdown set to "Medium", and a "Color" swatch showing black. At the bottom is a blue "Generate QR code" button.](https://static.simonwillison.net/static/2026/qr-code-generate.jpg)

This plugin works in conjunction with [datasette-llm](https://github.com/datasette/datasette-llm) and [datasette-llm-accountant](https://github.com/datasette/datasette-llm-accountant) to let you configure a per-user (or global) spending limit for LLM usage inside of Datasette. Configuration looks something like this:

plugins:
  datasette-llm-limits:
    limits:
      per-user-daily:
        scope: actor
        window: rolling-24h
        amount_usd: 1.00

> *   Tool availability can now be attached to a `required_permission`. The default background agent tools now require the new `datasette-agent-background` permission. #10

### May 14, 2026

This [Mitchell Hashimoto quote](https://simonwillison.net/2026/May/14/mitchell-hashimoto/) about Bun migrating from Zig to Rust reminded me of a similar conversation I had at a conference last week.

I was talking to someone who worked for a medium sized technology company with a pair of legacy/[legendary](https://simonwillison.net/2018/Jul/17/mark-norman-francis/) iPhone and Android apps.

They told me they had just completed a coding-agent driven rewrite of both apps to React Native.

I asked why they chose that, given that coding agents presumably drive down the cost of maintaining separate iPhone and Android apps.

They said that React Native has improved a lot over the past few years and covered everything their apps needed to do.

And... if it turned out to be the wrong decision, they could **just port back to native** in the future.

Like Mitchell said:

> Programming languages used to be LOCK IN, and they're increasingly not so.

[#](https://simonwillison.net/2026/May/14/not-so-locked-in/)[10:53 pm](https://simonwillison.net/2026/May/14/not-so-locked-in/) / [react](https://simonwillison.net/tags/react/), [coding-agents](https://simonwillison.net/tags/coding-agents/), [ai-assisted-programming](https://simonwillison.net/tags/ai-assisted-programming/), [generative-ai](https://simonwillison.net/tags/generative-ai/), [ai](https://simonwillison.net/tags/ai/), [llms](https://simonwillison.net/tags/llms/)

> [...] On the interesting side is how fungible programming languages are nowadays. Programming languages used to be LOCK IN, and they're increasingly not so. You think the Bun rewrite in Rust is good for Rust? Bun has shown they can be in probably any language they want in roughly a week or two. Rust is expendable. Its useful until its not then it can be thrown out. That's interesting!

— [Mitchell Hashimoto](https://twitter.com/mitchellh/status/2055039647924007222), on Bun porting from Zig to Rust

[#](https://simonwillison.net/2026/May/14/mitchell-hashimoto/)[10:31 pm](https://simonwillison.net/2026/May/14/mitchell-hashimoto/) / [zig](https://simonwillison.net/tags/zig/), [ai](https://simonwillison.net/tags/ai/), [mitchell-hashimoto](https://simonwillison.net/tags/mitchell-hashimoto/), [llms](https://simonwillison.net/tags/llms/), [rust](https://simonwillison.net/tags/rust/), [generative-ai](https://simonwillison.net/tags/generative-ai/), [agentic-engineering](https://simonwillison.net/tags/agentic-engineering/), [bun](https://simonwillison.net/tags/bun/)

> *   Now uses the `execute-sql` permission when deciding which tables to list to the user. #8

The [datasette.io](https://datasette.io/) site was being hammered by poorly-behaved crawlers, so I had Codex (GPT-5.5 xhigh) build a configurable rate limiting plugin to block IPs that were hammering specific areas of the site too quickly.

Here's [the production configuration](https://github.com/simonw/datasette.io/blob/b6022bf9987661b94a26d3143028193a6cabfdcf/datasette.yml#L103-L116) I'm using on that site for the new plugin:

  datasette-ip-rate-limit:
    header: Fly-Client-IP
    max_keys: 10000
    exempt_paths:
    - "/static/*"
    - "/-/turnstile*"
    rules:
    - name: demo-databases
      paths:
      - "/global-power-plants/*"
      - "/legislators/*"
      window_seconds: 60
      max_requests: 60
      block_seconds: 20

### May 13, 2026

**[Welcome to the Datasette blog](https://datasette.io/blog/2026/new-blog/)**. We have a bunch of neat Datasette announcements in the pipeline so we decided it was time the project grew an official blog.

I built this using OpenAI Codex desktop, which turns out to have the Markdown session transcript export feature I've always wanted. Here's [the session that built the blog](https://gist.github.com/simonw/885b11eee46822622b8031a1f4e5f3a3). See also [issue 179](https://github.com/simonw/datasette.io/issues/179).

[#](https://simonwillison.net/2026/May/13/welcome-to-the-datasette-blog/)[11:59 pm](https://simonwillison.net/2026/May/13/welcome-to-the-datasette-blog/) / [ai](https://simonwillison.net/tags/ai/), [datasette](https://simonwillison.net/tags/datasette/), [generative-ai](https://simonwillison.net/tags/generative-ai/), [llms](https://simonwillison.net/tags/llms/), [ai-assisted-programming](https://simonwillison.net/tags/ai-assisted-programming/), [codex](https://simonwillison.net/tags/codex/)

An experiment that shows that you can load an app in a CSP-protected sandboxed iframe (see [previous note](https://simonwillison.net/2026/Apr/3/test-csp-iframe-escape/)) and have a custom `fetch()` that intercepts CSP errors and passes them up to the parent window... which can then prompt the user to add that domain to an allow-list and then refresh the page.

![Image 7: Screenshot of a web tool titled "CSP Allow-list Experiment" with buttons Reset sample, Clear allow-list, Refresh preview. Left panel shows HTML source code starting with <!doctype html>. Right panel shows Preview with CSP header default-src 'none'; script-src 'unsafe-inline'; style-s... and heading "Sandbox fetch test". A modal dialog from tools.simonwillison.net is overlaid reading: "The sandbox tried to connect to: https://api.inaturalist.org   Add this origin to the CSP connect-src allow-list and refresh the page?" with an unchecked checkbox "Don't allow tools.simonwillison.net to prompt you again" and Cancel and OK buttons. Below is "Messages from sandbox" showing fetch-catch blocked https://api.inaturalist.org/v1/observations?per... connect-src · https://api.inaturalist.org. At the bottom left is "Allowed fetch() origins" with an input field containing https://api.github.com, an Add button, and a tag https://api.github.com x.](https://static.simonwillison.net/static/2026/csp-allow.jpg)

I built this one with GPT-5.5 xhigh running in the Codex desktop app.

### May 12, 2026

> *   New `TokenRestrictions.abbreviated(datasette)`[utility method](https://docs.datasette.io/en/latest/internals.html#tokenrestrictions) for creating `"_r"` dictionaries. [#2695](https://github.com/simonw/datasette/issues/2695)
> *   Table headers and column options are now visible even if a table contains zero rows. [#2701](https://github.com/simonw/datasette/issues/2701)
> *   Fixed bug with display of column actions dialog on Mobile Safari. [#2708](https://github.com/simonw/datasette/issues/2708)
> *   Fixed bug where tests could crash with a segfault due to a race condition between `Datasette.close()` and `Database.close()`. [#2709](https://github.com/simonw/datasette/issues/2709)

That segfault bug was _gnarly_. I added a mechanism to Datasette recently that would automatically close connections at the end of each test, but it turned out that introduced a race condition where an in-flight query could sometimes be executing in a thread against a connection while it was being closed. I ended up solving that by having Codex CLI (with GPT-5.5 xhigh) create [a minimal Dockerfile](https://github.com/simonw/datasette/issues/2709#issuecomment-4435604727) that recreated the bug.
