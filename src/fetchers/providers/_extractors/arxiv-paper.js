// Extract arXiv papers from two markdown formats:
// 1. HuggingFace Daily Papers: ### [Title](https://huggingface.co/papers/<paper_id>)
// 2. arXiv.org listing: [paper_id](https://arxiv.org/abs/<paper_id>) Title text
// where paper_id is the arXiv id (YYMM.NNNNN).
export function extractArxivPaper(markdown) {
  const items = [];
  const seen = new Set();

  // Pattern 1: HuggingFace Daily Papers format
  //   ### [Title](https://huggingface.co/papers/2501.04906)
  const hfRe = /###\s+\[([^\]]{8,})\]\(https:\/\/huggingface\.co\/papers\/([0-9]{4}\.[0-9]+)\)/g;
  for (let m = hfRe.exec(markdown); m !== null; m = hfRe.exec(markdown)) {
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

  // Pattern 2: arXiv listing format
  //   [2501.04906](https://arxiv.org/abs/2501.04906) Title text...
  //   or: 1. [2501.04906](https://arxiv.org/abs/2501.04906) Title
  if (items.length === 0) {
    const arxivRe =
      /\[([0-9]{4}\.[0-9]+)\]\(https:\/\/arxiv\.org\/abs\/([0-9]{4}\.[0-9]+)\)\s+([^\n]+)/g;
    for (let m = arxivRe.exec(markdown); m !== null; m = arxivRe.exec(markdown)) {
      const id = m[2];
      if (seen.has(id)) continue;
      seen.add(id);
      items.push({
        paper_id: id,
        url: `https://arxiv.org/abs/${id}`,
        title: m[3].trim(),
        abstract: '',
        authors: [],
        categories: [],
        published: null,
      });
      if (items.length >= 20) break;
    }
  }

  return items;
}
