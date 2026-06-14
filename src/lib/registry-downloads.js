// Best-effort weekly-download lookup for a candidate that is published as a
// package. npm only for v1 (the dominant registry for AI-builder tooling);
// returns null on any miss so it is a pure bonus signal. Public HTTP — does
// NOT consume the GitHub rate-limit budget. fetchImpl is injected for tests.
const NPM_LAST_WEEK = 'https://api.npmjs.org/downloads/point/last-week/';

export async function fetchPackageDownloads(pkg, { fetchImpl = fetch } = {}) {
  if (!pkg) return null;
  try {
    const res = await fetchImpl(`${NPM_LAST_WEEK}${encodeURIComponent(pkg)}`);
    if (!res.ok) return null;
    const body = await res.json();
    return typeof body?.downloads === 'number' ? body.downloads : null;
  } catch {
    return null;
  }
}
