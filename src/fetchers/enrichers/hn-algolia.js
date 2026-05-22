export async function enrichHNAlgolia(items) {
  const hnItems = items.filter((i) => i.source === 'hackernews' && i.hn_id);
  if (!hnItems.length) return items;
  const BATCH = 10;
  let failed = 0;
  for (let i = 0; i < hnItems.length; i += BATCH) {
    const batch = hnItems.slice(i, i + BATCH);
    await Promise.allSettled(
      batch.map(async (item) => {
        try {
          const res = await fetch(`https://hn.algolia.com/api/v1/items/${item.hn_id}`, {
            signal: AbortSignal.timeout(10_000),
            headers: { 'User-Agent': 'ai-daily-report/1.0' },
          });
          if (!res.ok) {
            failed++;
            return;
          }
          const data = await res.json();
          item.score = data.points ?? item.score ?? 0;
          item.num_comments =
            data.descendants ?? data.children?.length ?? item.num_comments ?? 0;
          const kids = (data.children ?? [])
            .filter((c) => c.text && c.author)
            .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
            .slice(0, 3);
          item.comments = kids.map((c) => ({
            text: c.text?.replace(/<[^>]*>/g, '').slice(0, 500) ?? '',
            score: c.points ?? 0,
            by: c.author ?? '',
          }));
        } catch (err) {
          failed++;
          console.error(`[enricher/hn-algolia] failed id=${item.hn_id}: ${err.message}`);
        }
      }),
    );
  }
  if (failed > hnItems.length * 0.5) {
    console.error(
      `[enricher/hn-algolia] WARN: ${failed}/${hnItems.length} enrichments failed`,
    );
  }
  return items;
}
