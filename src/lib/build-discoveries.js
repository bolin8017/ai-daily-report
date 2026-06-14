// Excellence funnel orchestrator for the 新發現 (discoveries) tab.
// Runs over already-fetched GitHub candidate items + the P1 star-history
// ledger + community feed items (for external validation) and emits a ranked
// candidate file. Pure-ish: octokit and the tree-fetcher are injected, so
// tests run without network.
//
// Output shape matches DiscoveriesStagingSchema (src/schemas/discoveries.js).

import {
  commitContinuity,
  contributorDiversity,
  engGatePass,
  engScore,
  engSignalsFromTree,
  excellenceScore,
  externalValidation,
  freeGates,
  repoAgeDays,
  velocityGatePass,
  velocityStats,
} from './excellence.js';
import { canonicalRepoKey } from './repo-key.js';

// How many top survivors (by the P2 excellence score) get the extra behavioral
// fetches. Bounds the GitHub-core call budget: ~2 calls × N ≈ 50/day.
const BEHAVIORAL_TOP_N = 25;

/**
 * Build the discoveries candidate file from already-fetched data.
 *
 * @param {object} opts
 * @param {object[]} opts.items - concatenated github-* candidate items
 * @param {object}   opts.history - loadStarHistory() result
 * @param {object[]} opts.feedItems - raw.feeds.items for external validation
 * @param {Set<string>} opts.seen - loadSeenSet() result
 * @param {string}   opts.todayISO - YYYY-MM-DD
 * @param {function} opts.fetchTree - (item) => Promise<string[]>
 * @param {function} [opts.fetchCommits] - (item) => Promise<commit[]>; optional behavioral enrichment
 * @param {function} [opts.fetchContributors] - (item) => Promise<contributor[]>; optional
 * @param {function} [opts.fetchDownloads] - (item) => Promise<number|null>; optional
 * @param {string}   [opts.generatedAt=''] - ISO timestamp; caller stamps it
 * @returns {Promise<{ ok: boolean, generated_at: string, candidates: object[], watchlist: object[], stats: object }>}
 */
export async function buildDiscoveries({
  items,
  history,
  feedItems,
  seen,
  todayISO,
  fetchTree,
  fetchCommits,
  fetchContributors,
  fetchDownloads,
  generatedAt = '',
}) {
  const candidates = [];
  const watchlist = [];
  // Per-candidate enrichment context (full_name → { item, scoreInputs }), used
  // by the optional behavioral pass to recompute excellence_score in place.
  const enrichCtx = new Map();
  let pool = 0;

  // Deduplicate items by full_name (keep first occurrence)
  const seen_fn = new Set();
  const uniqueItems = [];
  for (const item of items ?? []) {
    const fn = item.full_name;
    if (!fn || seen_fn.has(fn)) continue;
    seen_fn.add(fn);
    uniqueItems.push(item);
  }

  for (const item of uniqueItems) {
    const fullName = item.full_name;

    // Skip repos already shown in the 精選 catalog
    if (seen.has(fullName)) continue;

    pool++;

    // Free gates (cheap, synchronous)
    const gates = freeGates(item, { todayISO });
    if (!gates.pass) continue;

    // Compute velocity from history; fall back to a single today-snapshot.
    // Use canonicalRepoKey to match the ledger key format (strips .git/trailing slash).
    const historyKey = canonicalRepoKey(item) ?? fullName;
    const rec = history[historyKey];
    const snapshots =
      rec?.snapshots?.length > 0
        ? rec.snapshots
        : [{ date: todayISO, stars: item.stars ?? 0, forks: item.forks ?? null }];

    const vstats = velocityStats(snapshots, todayISO);

    // External validation (used both to override velocity gate and as a score input)
    const validationRefs = externalValidation(fullName, feedItems ?? []);
    const hasValidation = validationRefs.length > 0;

    // Velocity gate
    const vgate = velocityGatePass(vstats, { hasValidation });
    if (vgate === 'watch') {
      // Cold-start: not enough history to judge — add to watchlist without tree fetch
      watchlist.push({
        full_name: fullName,
        url: item.url ?? `https://github.com/${fullName}`,
        stars: item.stars ?? null,
        stars_today: item.stars_today ?? null,
        velocity_per_day: vstats.perDay,
        repo_age_days: repoAgeDays(item.created_at, todayISO),
        eng_score: null,
        eng_signals: null,
        validation_refs: validationRefs,
        excellence_score: null,
        source: item.source ?? null,
      });
      continue;
    }
    if (vgate === 'fail') continue;

    // Engineering gate — fetch repo tree (only velocity survivors get here)
    const paths = await fetchTree(item);
    const signals = engSignalsFromTree(paths);
    if (!engGatePass(signals)) continue;

    // Compute forkPerDay from history forks delta
    let forkPerDay = 0;
    if (rec?.snapshots?.length >= 2) {
      const sorted = [...rec.snapshots].sort((a, b) => (a.date < b.date ? -1 : 1));
      const forksDelta = (sorted[sorted.length - 1].forks ?? 0) - (sorted[0].forks ?? 0);
      const daySpan = Math.max(vstats.historyDays, 1);
      forkPerDay = forksDelta / daySpan;
    } else {
      // fall back: current forks / historyDays
      forkPerDay = vstats.historyDays > 0 ? (item.forks ?? 0) / vstats.historyDays : 0;
    }

    const eScore = engScore(signals);
    const scoreInputs = {
      perDay: vstats.perDay,
      engScore: eScore,
      validationCount: validationRefs.length,
      forkPerDay,
      readmeLen: (item.readme_excerpt ?? '').length,
      codeSubstance: signals.codeSubstance,
    };
    const exScore = excellenceScore(scoreInputs);

    candidates.push({
      full_name: fullName,
      url: item.url ?? `https://github.com/${fullName}`,
      stars: item.stars ?? null,
      stars_today: item.stars_today ?? null,
      velocity_per_day: vstats.perDay,
      repo_age_days: repoAgeDays(item.created_at, todayISO),
      eng_score: eScore,
      eng_signals: signals,
      validation_refs: validationRefs,
      excellence_score: exScore,
      source: item.source ?? null,
    });
    enrichCtx.set(fullName, { item, scoreInputs });
  }

  // Sort candidates by excellence_score descending
  candidates.sort((a, b) => (b.excellence_score ?? 0) - (a.excellence_score ?? 0));

  // Behavioral enrichment (Phase 4): only when the caller injected the
  // fetchers, and only for the top survivors by the P2 excellence score.
  // Each signal is fetched fail-soft and defaults to 0, so absent fetchers
  // reproduce the P2 behavior exactly. Recompute excellence_score in place,
  // then re-sort.
  if (
    typeof fetchCommits === 'function' ||
    typeof fetchContributors === 'function' ||
    typeof fetchDownloads === 'function'
  ) {
    const top = candidates.slice(0, BEHAVIORAL_TOP_N);
    await Promise.all(
      top.map(async (candidate) => {
        const ctx = enrichCtx.get(candidate.full_name);
        if (!ctx) return;
        const { item, scoreInputs } = ctx;

        const [commits, contributors, downloads] = await Promise.all([
          typeof fetchCommits === 'function' ? fetchCommits(item) : Promise.resolve([]),
          typeof fetchContributors === 'function' ? fetchContributors(item) : Promise.resolve([]),
          typeof fetchDownloads === 'function' ? fetchDownloads(item) : Promise.resolve(null),
        ]);

        const continuity = commitContinuity(commits ?? [], todayISO);
        const diversity = contributorDiversity(contributors ?? [], candidate.repo_age_days);
        const dl = typeof downloads === 'number' ? downloads : null;

        const commitScore = Math.min(continuity.daysWithCommits / 5, 1);
        const downloadScore = dl === null ? 0 : Math.min(dl / 5000, 1);

        candidate.commit_continuity = continuity;
        candidate.contributor_diversity = diversity;
        candidate.downloads = dl;
        candidate.excellence_score = excellenceScore({
          ...scoreInputs,
          commitScore,
          contributorScore: diversity,
          downloadScore,
        });
      }),
    );
    candidates.sort((a, b) => (b.excellence_score ?? 0) - (a.excellence_score ?? 0));
  }

  return {
    ok: true,
    generated_at: generatedAt,
    candidates,
    watchlist,
    stats: {
      pool,
      survivors: candidates.length,
      watchlisted: watchlist.length,
    },
  };
}
