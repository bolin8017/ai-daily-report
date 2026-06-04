// Declarative stage registry for the daily pipeline DAG. Read-only data + pure
// helpers; nothing here executes a stage (the sequencer, a later phase, does).
//
// `outputs` are paths RELATIVE TO the staging dir (default data/staging) and are
// consulted by satisfied.js. The `merge` stage is special: its report lands in
// data/reports/<date>.json, so it carries no staging outputs and uses the
// 'report-for-day' satisfied check instead.
//
// criticality is DECLARED here but enforced by nobody yet — the sequencer
// (Phase 2) will read it. Declaring all four curators 'required' now is a pure
// no-op until then, matching the spec's all-required decision.

export const CURATE_SECTIONS = ['shipped', 'pulse', 'market', 'tech'];

export const STAGES = [
  {
    id: 'collect',
    deps: [],
    cost: 'cheap',
    criticality: 'required',
    outputs: ['metadata.json'],
    satisfiedCheck: 'today-metadata',
  },
  ...CURATE_SECTIONS.map((s) => ({
    id: `curate.${s}`,
    deps: ['collect'],
    cost: 'llm',
    criticality: 'required',
    outputs: [`curated/${s}.json`],
    satisfiedCheck: 'fresh-outputs',
  })),
  {
    id: 'context',
    deps: CURATE_SECTIONS.map((s) => `curate.${s}`),
    cost: 'cheap',
    criticality: 'required',
    outputs: ['report-context.md'],
    satisfiedCheck: 'fresh-outputs',
  },
  {
    id: 'synthesize',
    // curate.* are listed explicitly even though `context` already implies them —
    // a defensive/explicit declaration of the all-curators barrier.
    deps: [...CURATE_SECTIONS.map((s) => `curate.${s}`), 'context'],
    cost: 'llm',
    criticality: 'required',
    outputs: ['editorial.json'],
    satisfiedCheck: 'fresh-outputs',
  },
  {
    id: 'faithfulness',
    deps: ['synthesize'],
    cost: 'llm', // conditional Sonnet judge today; becomes token-free after the Phase 4 verifier swap
    criticality: 'optional', // never-abort guard
    outputs: ['editorial.json'],
    satisfiedCheck: 'editorial-audited',
  },
  {
    id: 'merge',
    deps: [...CURATE_SECTIONS.map((s) => `curate.${s}`), 'synthesize', 'faithfulness'],
    cost: 'cheap',
    criticality: 'required',
    outputs: [], // report lands outside staging; see 'report-for-day'
    satisfiedCheck: 'report-for-day',
  },
];

const BY_ID = new Map(STAGES.map((s) => [s.id, s]));

export function getStage(id) {
  const stage = BY_ID.get(id);
  if (!stage) throw new Error(`unknown stage: ${id}`);
  return stage;
}

export function allStageIds() {
  return STAGES.map((s) => s.id);
}

// Kahn topological sort. Throws on an unknown dependency or a cycle. The
// sequencer (Phase 2) runs stages in this order; the registry test asserts the
// graph is acyclic and deps precede dependents.
export function topoOrder() {
  const indegree = new Map(STAGES.map((s) => [s.id, 0]));
  const dependents = new Map(STAGES.map((s) => [s.id, []]));
  for (const s of STAGES) {
    for (const d of s.deps) {
      if (!BY_ID.has(d)) throw new Error(`stage ${s.id} depends on unknown stage ${d}`);
      dependents.get(d).push(s.id);
      indegree.set(s.id, indegree.get(s.id) + 1);
    }
  }
  const queue = [...indegree.entries()].filter(([, n]) => n === 0).map(([id]) => id);
  const order = [];
  while (queue.length > 0) {
    const id = queue.shift();
    order.push(id);
    for (const next of dependents.get(id)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (order.length !== STAGES.length) throw new Error('stage graph has a cycle');
  return order;
}
