import { readFile, writeFile } from 'node:fs/promises';

const FIRECRAWL_USAGE_URL = 'https://api.firecrawl.dev/v1/team/credit-usage';

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

async function readLocal(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

export function createFirecrawlQuota({ file = 'data/quota.json', monthlyCap = 500 } = {}) {
  let initial = null;

  async function canSpend() {
    if (process.env.FIRECRAWL_DISABLED === '1') {
      return { allowed: false, reason: 'disabled', source: 'env', remaining: 0 };
    }

    if (process.env.FIRECRAWL_API_KEY) {
      try {
        const res = await fetch(FIRECRAWL_USAGE_URL, {
          headers: { Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          const json = await res.json();
          const remaining = json.remaining_credits ?? 0;
          if (initial == null) initial = remaining;
          return { allowed: remaining > 0, source: 'api', remaining };
        }
      } catch {
        // fall through to local counter
      }
    }

    const data = await readLocal(file);
    const used = data.firecrawl?.month === currentMonth() ? data.firecrawl.used : 0;
    const remaining = Math.max(0, monthlyCap - used);
    if (initial == null) initial = remaining;
    return { allowed: remaining > 0, source: 'local', remaining };
  }

  async function record(n = 1) {
    const data = await readLocal(file);
    const month = currentMonth();
    if (data.firecrawl?.month !== month) data.firecrawl = { month, used: 0 };
    data.firecrawl.used += n;
    await writeFile(file, JSON.stringify(data, null, 2));
  }

  async function snapshot() {
    const status = await canSpend();
    return {
      before: initial,
      after: status.remaining,
      used_today: (initial ?? 0) - status.remaining,
    };
  }

  return { canSpend, record, snapshot };
}
