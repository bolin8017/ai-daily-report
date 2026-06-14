// Pure funnel functions for the discoveries excellence pipeline.
// No I/O — all functions take plain data and return plain data.
// Consumed by src/lib/build-discoveries.js (Stage 1 Phase 2c).

// ---------------------------------------------------------------------------
// repoAgeDays
// ---------------------------------------------------------------------------

/**
 * Number of whole days between createdAtISO and todayISO.
 * Returns null on bad/missing input.
 * @param {string} createdAtISO
 * @param {string} todayISO
 * @returns {number|null}
 */
export function repoAgeDays(createdAtISO, todayISO) {
  if (!createdAtISO || !todayISO) return null;
  const created = Date.parse(createdAtISO);
  const today = Date.parse(todayISO);
  if (Number.isNaN(created) || Number.isNaN(today)) return null;
  return Math.floor((today - created) / 86_400_000);
}

// ---------------------------------------------------------------------------
// freeGates
// ---------------------------------------------------------------------------

/**
 * Deterministic, zero-cost gate checks. Returns {pass, reason}.
 * Reason is the first failing rule label, or null when all pass.
 *
 * @param {object} item
 * @param {object} opts
 * @param {string} opts.todayISO
 * @param {number} [opts.maxAgeDays=30]
 * @param {number} [opts.maxStaleDays=14]
 */
export function freeGates(item, { todayISO, maxAgeDays = 30, maxStaleDays = 14 }) {
  if (item.fork === true) return { pass: false, reason: 'fork' };
  if (!item.license) return { pass: false, reason: 'no-license' };

  const ageDays = repoAgeDays(item.created_at, todayISO);
  if (ageDays === null || ageDays > maxAgeDays) return { pass: false, reason: 'too-old' };

  const staleDays = repoAgeDays(item.pushed_at, todayISO);
  if (staleDays === null || staleDays > maxStaleDays) return { pass: false, reason: 'stale' };

  return { pass: true, reason: null };
}

// ---------------------------------------------------------------------------
// engSignalsFromTree
// ---------------------------------------------------------------------------

const SOURCE_EXTS = new Set(['js', 'ts', 'jsx', 'tsx', 'py', 'go', 'rs', 'java', 'rb']);
const LAYOUT_DIRS = new Set(['src', 'lib', 'app', 'packages', 'cmd', 'internal']);

const TEST_PATH_RE = /(^|\/)(tests?|__tests__|spec)\//i;
const TEST_FILE_RE = /\.(test|spec)\.[a-z]+$/i;

/**
 * Detect engineering quality signals from a list of repo-relative file paths.
 *
 * @param {string[]} paths
 * @returns {{ tests: boolean, ci: boolean, types: boolean, lint: boolean, lockfile: boolean, layout: boolean, docs: boolean, sourceFiles: number, codeSubstance: boolean }}
 */
export function engSignalsFromTree(paths) {
  let tests = false;
  let ci = false;
  let types = false;
  let lint = false;
  let lockfile = false;
  let docs = false;

  const sourceFiles = [];

  for (const p of paths) {
    const lower = p.toLowerCase();
    const basename = p.split('/').pop() ?? '';
    const lowerBase = basename.toLowerCase();

    // tests
    if (!tests && (TEST_PATH_RE.test(p) || TEST_FILE_RE.test(p))) tests = true;

    // ci
    if (!ci) {
      if (
        p.startsWith('.github/workflows/') ||
        lower === '.gitlab-ci.yml' ||
        lower === '.circleci/config.yml'
      ) {
        ci = true;
      }
    }

    // types
    if (!types) {
      if (
        lowerBase === 'tsconfig.json' ||
        p.endsWith('.ts') ||
        p.endsWith('.tsx') ||
        lowerBase === 'py.typed'
      ) {
        types = true;
      }
    }

    // lint
    if (!lint) {
      if (
        lowerBase === 'biome.json' ||
        lowerBase.startsWith('.eslintrc') ||
        lowerBase === '.ruff.toml' ||
        lowerBase === 'ruff.toml' ||
        lowerBase === '.flake8' ||
        lowerBase === '.prettierrc' ||
        lowerBase === 'prettier.config.js' ||
        lowerBase === 'prettier.config.cjs' ||
        lowerBase === '.prettierrc.json' ||
        lowerBase === '.prettierrc.js' ||
        lowerBase === '.prettierrc.yaml' ||
        lowerBase === '.prettierrc.yml'
      ) {
        lint = true;
      }
    }

    // lockfile
    if (!lockfile) {
      if (
        lowerBase === 'package-lock.json' ||
        lowerBase === 'pnpm-lock.yaml' ||
        lowerBase === 'yarn.lock' ||
        lowerBase === 'poetry.lock' ||
        lowerBase === 'cargo.lock' ||
        lowerBase === 'uv.lock' ||
        lowerBase === 'go.sum'
      ) {
        lockfile = true;
      }
    }

    // docs
    if (!docs) {
      if (p.startsWith('docs/') || (lowerBase.endsWith('.md') && p.includes('docs/'))) {
        docs = true;
      }
    }

    // source files (all files with source extensions)
    const ext = basename.includes('.') ? basename.split('.').pop()?.toLowerCase() : '';
    if (ext && SOURCE_EXTS.has(ext)) {
      sourceFiles.push(p);
    }
  }

  // layout: >50% of NON-TEST source files live under a canonical layout dir
  const nonTestSourceFiles = sourceFiles.filter(
    (p) => !TEST_PATH_RE.test(p) && !TEST_FILE_RE.test(p),
  );
  let layout = false;
  if (nonTestSourceFiles.length > 0) {
    const underLayout = nonTestSourceFiles.filter((p) => {
      const topDir = p.split('/')[0];
      return LAYOUT_DIRS.has(topDir);
    });
    layout = underLayout.length / nonTestSourceFiles.length > 0.5;
  }

  // codeSubstance: >=5 non-test source files, OR (>=2 AND tests)
  // Using nonTestSourceFiles prevents a test-only repo from wrongly passing.
  const count = sourceFiles.length;
  const codeSubstance = nonTestSourceFiles.length >= 5 || (nonTestSourceFiles.length >= 2 && tests);

  return { tests, ci, types, lint, lockfile, layout, docs, sourceFiles: count, codeSubstance };
}

// ---------------------------------------------------------------------------
// engScore / engGatePass
// ---------------------------------------------------------------------------

/**
 * 0–6 score: one point each for tests, ci, types, lint, lockfile, layout.
 * @param {object} signals
 * @returns {number}
 */
export function engScore(signals) {
  return (
    (signals.tests ? 1 : 0) +
    (signals.ci ? 1 : 0) +
    (signals.types ? 1 : 0) +
    (signals.lint ? 1 : 0) +
    (signals.lockfile ? 1 : 0) +
    (signals.layout ? 1 : 0)
  );
}

/**
 * Gate: codeSubstance AND at least 2 of {tests, ci, (types || lockfile)}.
 * @param {object} signals
 * @returns {boolean}
 */
export function engGatePass(signals) {
  if (!signals.codeSubstance) return false;
  let count = 0;
  if (signals.tests) count++;
  if (signals.ci) count++;
  if (signals.types || signals.lockfile) count++;
  return count >= 2;
}

// ---------------------------------------------------------------------------
// velocityStats / velocityGatePass
// ---------------------------------------------------------------------------

/**
 * Compute velocity statistics from star-history snapshots.
 *
 * @param {{ date: string, stars: number|null, forks: number|null }[]} snapshots
 * @param {string} todayISO
 * @returns {{ historyDays: number, totalStars: number, perDay: number, spike: boolean }}
 */
export function velocityStats(snapshots, todayISO) {
  if (!snapshots || snapshots.length === 0) {
    return { historyDays: 0, totalStars: 0, perDay: 0, spike: false };
  }

  // Sort by date ascending
  const sorted = [...snapshots].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  const historyDays = repoAgeDays(first.date, todayISO) ?? 0;
  const totalStars = last.stars ?? 0;

  const starsDelta = (last.stars ?? 0) - (first.stars ?? 0);
  const daySpan = historyDays === 0 ? 1 : historyDays;
  const perDay = starsDelta / daySpan;

  // Spike detection: >60% of stars landed in the last 24h, then <1/day since
  let spike = false;
  if (sorted.length >= 2) {
    // Last snapshot vs second-to-last
    const prev = sorted[sorted.length - 2];
    const lastDelta = (last.stars ?? 0) - (prev.stars ?? 0);
    const prevSpan = repoAgeDays(prev.date, last.date) ?? 1;
    const lastDayRate = prevSpan > 0 ? lastDelta / prevSpan : lastDelta;
    if (starsDelta > 0 && lastDelta / starsDelta > 0.6 && lastDayRate > perDay * 3) {
      spike = true;
    }
  }

  return { historyDays, totalStars, perDay, spike };
}

/**
 * Velocity gate decision.
 *
 * @param {{ historyDays: number, perDay: number, totalStars: number, spike: boolean }} stats
 * @param {{ hasValidation: boolean }} opts
 * @returns {'pass' | 'fail' | 'watch'}
 */
export function velocityGatePass(stats, { hasValidation }) {
  const { historyDays, perDay, totalStars, spike } = stats;

  if (historyDays < 4) return 'watch';
  if (hasValidation) return 'pass';

  if (historyDays >= 7 && perDay >= 5 && totalStars >= 50 && !spike) return 'pass';
  if (historyDays >= 4 && historyDays <= 6 && perDay >= 7 && totalStars >= 30 && !spike)
    return 'pass';

  return 'fail';
}

// ---------------------------------------------------------------------------
// externalValidation
// ---------------------------------------------------------------------------

/**
 * Return distinct feed-source ids whose url+title+description mention the repo.
 *
 * @param {string} repoFullName  e.g. "o/r"
 * @param {{ source: string, url: string, title: string, description: string }[]} feedItems
 * @returns {string[]}
 */
export function externalValidation(repoFullName, feedItems) {
  const needle = `github.com/${repoFullName}`.toLowerCase();
  const sources = new Set();
  for (const item of feedItems) {
    const hay = `${item.url ?? ''} ${item.title ?? ''} ${item.description ?? ''}`.toLowerCase();
    if (hay.includes(needle)) {
      sources.add(item.source);
    }
  }
  return [...sources];
}

// ---------------------------------------------------------------------------
// Behavioral signals (Phase 4): commit-continuity + contributor-diversity.
// Computed only for the top funnel survivors (build-discoveries) from the
// fail-soft GitHub helpers. Bot authors are excluded so automation noise
// (dependabot/renovate/CI) does not masquerade as sustained human effort.
// ---------------------------------------------------------------------------

const BOT = /\bbot\b|\[bot\]|dependabot|renovate|github-actions/i;

/**
 * Distinct recent days with non-bot commits — distinguishes a repo that is
 * actively built from a one-day spike-and-abandon.
 *
 * @param {{ login: string|null, date: string|null, message: string }[]} commits
 * @param {string} todayISO  YYYY-MM-DD (or any Date-parseable today)
 * @returns {{ daysWithCommits: number, nonBotCommits: number, coherent: boolean }}
 */
export function commitContinuity(commits, todayISO) {
  const days = new Set();
  let nonBotCommits = 0;
  for (const c of commits ?? []) {
    if (!c?.date || BOT.test(c.login ?? '')) continue;
    const age = Math.round((Date.parse(todayISO) - Date.parse(c.date)) / 86_400_000);
    if (Number.isNaN(age) || age > 14 || age < 0) continue;
    nonBotCommits++;
    days.add(c.date.slice(0, 10));
  }
  const coherent =
    nonBotCommits === 0
      ? false
      : nonBotCommits >= Math.max(1, Math.ceil((commits?.length ?? 0) * 0.4));
  return { daysWithCommits: days.size, nonBotCommits, coherent };
}

/**
 * 0–1 contributor-diversity term: rewards a real team, penalizes one-author
 * dominance. Returns 0 when there are no non-bot contributors.
 *
 * @param {{ login: string|null, contributions: number }[]} contributors
 * @param {number} repoAgeDays
 * @returns {number}
 */
export function contributorDiversity(contributors, repoAgeDays) {
  const list = (contributors ?? []).filter((c) => c?.login && !BOT.test(c.login));
  if (list.length === 0) return 0;
  const total = list.reduce((s, c) => s + (c.contributions ?? 0), 0) || 1;
  const topShare = Math.max(...list.map((c) => (c.contributions ?? 0) / total));
  const dominancePenalty = topShare > 0.9 ? 0.5 : 1; // one author owns >90% → halve
  const ageNorm = Math.min(list.length / Math.max((repoAgeDays ?? 30) / 7 + 1, 1), 1);
  return Math.min(ageNorm * dominancePenalty, 1);
}

// ---------------------------------------------------------------------------
// excellenceScore
// ---------------------------------------------------------------------------

/**
 * Composite 0–1 score. Weights sum to 1.00 and every term clamps to [0,1].
 *
 * Weights:
 *   velocity         0.25  min(perDay/50, 1)
 *   eng              0.20  engScore/6
 *   validation       0.18  min(validationCount/2, 1)
 *   commitScore      0.12  behavioral (min(daysWithCommits/5, 1))
 *   fork             0.08  min(forkPerDay/10, 1)
 *   contributorScore 0.07  behavioral (contributorDiversity)
 *   downloadScore    0.05  behavioral (min(downloads/5000, 1))
 *   readme           0.03  min(readmeLen/400, 1)
 *   substance        0.02  codeSubstance ? 1 : 0
 *
 * The three behavioral terms default to 0, so P2/P3 callers that omit them
 * keep working — their score just lacks the behavioral lift.
 *
 * @param {{ perDay: number, engScore: number, validationCount: number, forkPerDay: number, readmeLen: number, codeSubstance: boolean, commitScore?: number, contributorScore?: number, downloadScore?: number }} params
 * @returns {number}
 */
export function excellenceScore({
  perDay,
  engScore: eng,
  validationCount,
  forkPerDay,
  readmeLen,
  codeSubstance,
  commitScore = 0,
  contributorScore = 0,
  downloadScore = 0,
}) {
  const clamp = (x) => Math.max(0, Math.min(x, 1));
  return (
    0.25 * clamp((perDay ?? 0) / 50) +
    0.2 * clamp((eng ?? 0) / 6) +
    0.18 * clamp(Math.min(validationCount ?? 0, 2) / 2) +
    0.12 * clamp(commitScore) +
    0.08 * clamp((forkPerDay ?? 0) / 10) +
    0.07 * clamp(contributorScore) +
    0.05 * clamp(downloadScore) +
    0.03 * clamp((readmeLen ?? 0) / 400) +
    0.02 * (codeSubstance ? 1 : 0)
  );
}
