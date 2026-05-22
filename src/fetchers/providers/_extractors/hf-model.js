// huggingface.co/models?sort=trending markdown packs each model into a
// single anchor block:
//   [![alt-image](...) #### owner/model TASK • XB•Updated NNN days ago• 1k• 601](https://huggingface.co/owner/model)
// We anchor on the URL pattern at the end (https://huggingface.co/owner/model)
// and use a list of reserved top-level paths to filter nav links.
const HF_RESERVED = new Set([
  'models',
  'datasets',
  'spaces',
  'docs',
  'enterprise',
  'pricing',
  'tasks',
  'chat',
  'collections',
  'languages',
  'organizations',
  'blog',
  'posts',
  'papers',
  'learn',
  'join',
  'support',
  'inference',
  'inference-endpoints',
  'storage',
  'pro',
  'front',
  'login',
  'search',
  'huggingface',
  'privacy',
  'terms-of-service',
  'security',
  'about',
  'careers',
]);

export function extractHFModel(markdown) {
  const items = [];
  const seen = new Set();
  const re = /]\(https:\/\/huggingface\.co\/([A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+)\)/g;
  while (true) {
    const m = re.exec(markdown);
    if (m === null) break;
    const id = m[1];
    if (!id.includes('/')) continue;
    const topLevel = id.split('/')[0];
    if (HF_RESERVED.has(topLevel)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({
      id,
      url: `https://huggingface.co/${id}`,
      downloads: null,
      likes: null,
      last_modified: null,
      tags: [],
      pipeline_tag: null,
    });
    if (items.length >= 20) break;
  }
  return items;
}
