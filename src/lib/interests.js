// Reads themes/<theme>/interests.yaml (the topic-subscription registry) and
// projects it to fetch inputs: GitHub topic terms + arxiv keyword union.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { InterestsSchema } from '../schemas/interests.js';
import { ACTIVE_THEME } from './config.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function loadInterests(theme = ACTIVE_THEME) {
  const file = path.join(REPO_ROOT, 'themes', theme, 'interests.yaml');
  const parsed = YAML.parse(await readFile(file, 'utf8'));
  return InterestsSchema.parse(parsed);
}

function hashDate(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function pickRotating(pool, n, seed) {
  const out = [];
  const seen = new Set();
  let s = seed;
  while (seen.size < Math.min(n, pool.length)) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const idx = s % pool.length;
    if (!seen.has(idx)) {
      seen.add(idx);
      out.push(pool[idx]);
    }
  }
  return out;
}

// Core interests' github terms (every day) + a seeded daily sample of
// rotating interests' github terms. Deduped; `off` excluded.
export function githubTopicsForDate(
  reg,
  dateString,
  rotatingPerDay = reg.rotation.rotating_per_day,
) {
  const entries = Object.values(reg.interests);
  const core = entries.filter((e) => e.level === 'core');
  // Rotating entries with no github terms are pre-filtered from the pool so a
  // pick is never wasted on one; core entries with empty github resolve
  // harmlessly in the flatMap below (they contribute nothing).
  const rotating = entries.filter((e) => e.level === 'rotating' && (e.github?.length ?? 0) > 0);
  const picks = pickRotating(rotating, rotatingPerDay, hashDate(dateString));
  const terms = [...core, ...picks].flatMap((e) => e.github ?? []);
  return [...new Set(terms)];
}

// Union of arxiv keywords across all non-off interests. Deduped.
export function arxivKeywords(reg) {
  const terms = Object.values(reg.interests)
    .filter((e) => e.level !== 'off')
    .flatMap((e) => e.arxiv ?? []);
  return [...new Set(terms)];
}
