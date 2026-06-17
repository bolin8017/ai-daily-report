import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildReportContext, writeReportContext } from '../scripts/hermes/build-report-context.mjs';

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'adr-report-context-'));
  const stagingDir = path.join(root, 'staging');
  const curatedDir = path.join(stagingDir, 'curated');
  const wikiRoot = path.join(root, 'wiki');
  await mkdir(curatedDir, { recursive: true });
  await mkdir(path.join(wikiRoot, 'tracking'), { recursive: true });
  await mkdir(path.join(wikiRoot, 'predictions'), { recursive: true });
  await mkdir(path.join(wikiRoot, 'report-context'), { recursive: true });
  await writeFile(path.join(root, '.keep'), '', 'utf8');
  await writeFile(path.join(wikiRoot, 'index.md'), '# Wiki Index\n', 'utf8');
  await writeFile(
    path.join(wikiRoot, 'tracking', 'active.md'),
    `# Active Tracking Items\n\n## track-local-inference\n\n- title: Local inference productization\n- thesis: Local inference is becoming a product constraint.\n- promotion_rule: Include when today's evidence mentions local inference or offline mode.\n- evidence:\n  - 2026-06-01: old evidence\n`,
    'utf8',
  );
  await writeFile(
    path.join(wikiRoot, 'tracking', 'candidates.md'),
    '# Tracking Candidates\n\n## candidate-agent-tooling\n\n- thesis: Agent tooling may consolidate.\n',
    'utf8',
  );
  await writeFile(
    path.join(wikiRoot, 'predictions', 'open.md'),
    '# Open Predictions\n\n## pred-local-mode\n\n- resolution_date: 2026-07-15\n- text: Two apps ship explicit local/offline inference mode.\n',
    'utf8',
  );

  await writeJson(path.join(curatedDir, 'discoveries.json'), {
    rising: [
      {
        id: 'discoveries.rising.0:local-llm-app',
        name: 'Local LLM App',
        takeaway: 'A desktop AI app added offline local inference mode for 7B models.',
      },
    ],
    dev_watch: [],
  });
  await writeJson(path.join(curatedDir, 'pulse.json'), {
    hn: [
      {
        id: 'pulse.hn.0:agent-thread',
        title: 'Agent tooling discussion',
        takeaway: 'Developers compare MCP agent workflows.',
      },
    ],
    lobsters: [],
    chinese_community: [],
    ai_bloggers: [],
  });
  await writeJson(path.join(curatedDir, 'market.json'), {
    ma: [],
    funding: [],
    policy: [],
    taiwan: [],
  });
  await writeJson(path.join(curatedDir, 'tech.json'), {
    vendor: [],
    models: [
      {
        id: 'tech.models.0:tiny-model',
        title: 'Tiny model release',
        takeaway: 'A compact model targets on-device inference.',
      },
    ],
    benchmarks: [],
    aidaptiv: [],
  });
  await writeJson(path.join(stagingDir, 'source-ages.json'), {
    'discoveries.rising.0:local-llm-app': 1,
    'pulse.hn.0:agent-thread': 2,
    'tech.models.0:tiny-model': 3,
  });

  return { root, stagingDir, wikiRoot };
}

describe('build-report-context', () => {
  it('builds bounded markdown from curated items plus local-only Wiki tracking', async () => {
    const { stagingDir, wikiRoot } = await fixtureRoot();

    const markdown = await buildReportContext({ date: '2026-06-03', stagingDir, wikiRoot });

    expect(markdown).toContain('# Report Context for 2026-06-03');
    expect(markdown).toContain('## Curated evidence snapshot');
    expect(markdown).toContain('discoveries.rising.0:local-llm-app');
    expect(markdown).toContain('offline local inference mode');
    expect(markdown).toContain('## Selected tracking items');
    expect(markdown).toContain('track-local-inference');
    expect(markdown).toContain('Local inference is becoming a product constraint');
    expect(markdown).toContain('## Open predictions due or relevant today');
    expect(markdown).toContain('pred-local-mode');
    expect(markdown.length).toBeLessThan(12_000);
  });

  it('writes data/staging/report-context.md and archives a copy in the Wiki', async () => {
    const { stagingDir, wikiRoot } = await fixtureRoot();

    const result = await writeReportContext({ date: '2026-06-03', stagingDir, wikiRoot });

    expect(result.outputPath).toBe(path.join(stagingDir, 'report-context.md'));
    expect(result.archivePath).toBe(path.join(wikiRoot, 'report-context', '2026-06-03.md'));
    await expect(readFile(result.outputPath, 'utf8')).resolves.toContain(
      'Report Context for 2026-06-03',
    );
    await expect(readFile(result.archivePath, 'utf8')).resolves.toContain(
      'Report Context for 2026-06-03',
    );
  });

  it('uses staging metadata date when date is omitted', async () => {
    const { stagingDir, wikiRoot } = await fixtureRoot();
    await writeJson(path.join(stagingDir, 'metadata.json'), { date: '2026-06-04' });

    const result = await writeReportContext({ stagingDir, wikiRoot });

    expect(result.archivePath).toBe(path.join(wikiRoot, 'report-context', '2026-06-04.md'));
    await expect(readFile(result.archivePath, 'utf8')).resolves.toContain(
      'Report Context for 2026-06-04',
    );
  });
});
