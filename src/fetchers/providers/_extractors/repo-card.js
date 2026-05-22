// github.com/trending rendered as markdown shows each repo as:
//   ## [owner / repo](https://github.com/owner/repo)
//   description text
//   Language[NNN](.../stargazers)[NNN](.../forks) Built by ... NNN stars today
export function extractRepoCard(markdown) {
  const items = [];
  const seen = new Set();
  const re =
    /##\s+\[[^\]]+\]\((https:\/\/github\.com\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+))\)/g;
  let m;
  let rank = 0;
  while ((m = re.exec(markdown)) !== null) {
    const fullName = m[2];
    if (seen.has(fullName)) continue;
    seen.add(fullName);
    rank++;
    // Look ahead ~1KB for stars + description hints
    const window = markdown.slice(m.index, m.index + 1500);
    const starsMatch = window.match(/\[(\d[\d,]*)\]\(https:\/\/github\.com\/[^/]+\/[^/]+\/stargazers\)/);
    const stars = starsMatch ? parseInt(starsMatch[1].replace(/,/g, ''), 10) : 0;
    const starsTodayMatch = window.match(/(\d[\d,]*)\s+stars\s+today/);
    const starsToday = starsTodayMatch ? parseInt(starsTodayMatch[1].replace(/,/g, ''), 10) : null;
    items.push({
      full_name: fullName,
      url: `https://github.com/${fullName}`,
      description: null,
      language: null,
      stars,
      stars_today: starsToday,
      rank,
    });
    if (rank >= 25) break;
  }
  return items;
}
