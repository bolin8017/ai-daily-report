// HuggingFace Daily Papers page renders each paper as:
//   ### [Title](https://huggingface.co/papers/<paper_id>)
// where paper_id is the arXiv id (YYMM.NNNNN).
export function extractArxivPaper(markdown) {
  const items = [];
  const seen = new Set();
  const re = /###\s+\[([^\]]{8,})\]\(https:\/\/huggingface\.co\/papers\/([0-9]{4}\.[0-9]+)\)/g;
  while (true) {
    const m = re.exec(markdown);
    if (m === null) break;
    const id = m[2];
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      paper_id: id,
      url: `https://arxiv.org/abs/${id}`,
      title: m[1].trim(),
      abstract: '',
      authors: [],
      categories: [],
      published: null,
    });
    if (items.length >= 20) break;
  }
  return items;
}
