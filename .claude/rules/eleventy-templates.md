---
paths:
  - "site/**"
  - "eleventy.config.js"
---

# 11ty / Nunjucks template conventions

## Template structure

- Engine: Nunjucks (`.njk`), configured in `eleventy.config.js`
- Input: `site/`, output: `_site/` (gitignored, built in CI)
- Includes: `site/_includes/` (base.njk, report-body.njk, idea-card.njk, shipped-item.njk)
- Static assets: `site/assets/` (style.css, app.js), passed through via `addPassthroughCopy`

## Data flow

- Report data comes from `data/reports/YYYY-MM-DD.json` via `addGlobalData('report', ...)`
- Archive pages generated via 11ty pagination over `archiveReports` global data
- Snapshot data from `data/feeds-snapshot.json` feeds `sourcesStatus` and `rssByCategory`
- Custom filters: `dayOfWeek`, `safeSlug`, `formatNum`, `hostname` -- defined in `eleventy.config.js`

## Template patterns

- Guard optional fields with `{% if field %}` before rendering (templates handle missing fields gracefully, rendering empty rather than crashing)
- Use `| safe` filter for HTML content (e.g., `report.lead.html | safe`)
- Use `| formatNum` for numeric display (adds locale separators)
- Tab/filter UI uses `data-tab` and `data-filter` attributes wired by `site/assets/app.js`
- ARIA roles on tab bar: `role="tablist"`, `role="tab"`, `role="tabpanel"`

## When editing templates

- The report JSON schema is loose (`.passthrough()`, most fields optional) -- always guard with `{% if %}` before accessing nested properties
- Test with `npm run serve` (11ty dev server with live reload)
- pathPrefix is `/ai-daily-report/` (GitHub Pages project site)
- RSS feed template at `site/feed.njk`
