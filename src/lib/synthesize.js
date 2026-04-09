// Synthesis via `claude -p` subprocess. Two public functions:
//   synthesizeReport({ date, condensed, memory }) → report object
//   synthesizeMemory({ date, report, memory })    → updated memory object
//
// Both call `claude -p --output-format text --model <MODEL>`, pipe the prompt
// body via stdin, then extract + parse the JSON response. The CCR "nested
// claude" hang does not apply here — on a VM, `claude -p` is the primary
// session.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';

// Tools explicitly denied so `claude -p` never enters the "requesting a tool
// requires permission" hidden-wait path. The agent prompt mentions reading
// files ("Step 1: Read context" etc.) and without this list claude silently
// blocks for the entire TIMEOUT_MS waiting for a permission dialog that has
// no tty to present itself on. Empirically verified: a 48KB real synthesis
// prompt hangs 15 minutes without this list, returns in ~7 seconds with it.
const DENY_TOOLS = [
  'Read',
  'Write',
  'Edit',
  'Bash',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'NotebookEdit',
  'Task',
];

function runClaude(promptBody) {
  // Node child_process.spawn('claude', ...) hangs indefinitely for large
  // prompts (>50KB), regardless of whether stdin is a pipe, file FD, or
  // whether cwd is /tmp vs /workspace. The ONLY form empirically verified
  // to work is a shell-mediated `< file` redirect:
  //
  //   sh -c 'exec claude -p ... < /tmp/prompt.txt'
  //
  // Theory: something about the Node parent process's inherited environment
  // or file descriptor table confuses claude's startup when it's a direct
  // child. Shell intermediation (exec replaces sh with claude, but the initial
  // FD setup is done by sh) sidesteps whatever the interaction is.
  return new Promise((resolve, reject) => {
    const tmpPath = join(tmpdir(), `claude-prompt-${randomBytes(8).toString('hex')}.txt`);
    writeFileSync(tmpPath, promptBody);

    const claudeArgs = [
      '-p',
      '--output-format text',
      `--model ${MODEL}`,
      '--disable-slash-commands',
      `--disallowedTools ${DENY_TOOLS.join(' ')}`,
    ];
    if (process.env.CLAUDE_DEBUG === '1') {
      claudeArgs.push('--debug api');
    }
    const shellCmd = `exec claude ${claudeArgs.join(' ')} < "${tmpPath}"`;
    console.error(`[synthesize] sh -c '${shellCmd}'`);

    const proc = spawn('sh', ['-c', shellCmd], {
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: '/tmp',
    });

    // Shell opens < redirect immediately; safe to unlink after a brief delay
    // (child's FD keeps the inode alive on Linux).
    setTimeout(() => {
      try {
        unlinkSync(tmpPath);
      } catch {}
    }, 2000);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => {
      const s = chunk.toString('utf8');
      stdout += s;
      if (process.env.CLAUDE_DEBUG === '1') process.stderr.write(`[claude-out] ${s}`);
    });
    proc.stderr.on('data', (chunk) => {
      const s = chunk.toString('utf8');
      stderr += s;
      if (process.env.CLAUDE_DEBUG === '1') process.stderr.write(`[claude-err] ${s}`);
    });
    proc.on('error', (err) => {
      reject(new Error(`[synthesize] spawn failed: ${err.message}`));
    });
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `[synthesize] claude -p exit ${code}\nstderr: ${stderr}\nstdout head: ${stdout.slice(0, 500)}`,
          ),
        );
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Pull the first JSON object or array out of a claude response. Handles:
 *   - plain JSON (fastest path)
 *   - JSON wrapped in ```json ... ``` fences
 *   - JSON preceded/followed by explanatory text
 */
export function extractJson(text) {
  const trimmed = text.trim();

  // Plain JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // fall through to brace-matched extraction
    }
  }

  // Fenced ```json ... ```
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {
      // fall through
    }
  }

  // Locate first {...} or [...] by balanced-depth walk
  const firstBrace = trimmed.search(/[{[]/);
  if (firstBrace >= 0) {
    const opener = trimmed[firstBrace];
    const closer = opener === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = firstBrace; i < trimmed.length; i++) {
      const c = trimmed[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (c === opener) depth++;
      else if (c === closer) {
        depth--;
        if (depth === 0) {
          const slice = trimmed.slice(firstBrace, i + 1);
          return JSON.parse(slice);
        }
      }
    }
  }

  throw new Error(`[synthesize] no JSON found in claude response:\n${trimmed.slice(0, 500)}`);
}

function buildReportPrompt({ date, condensed, memory }) {
  const agentPrompt = readFileSync('.claude/agents/daily-report.md', 'utf8');
  const qualityRules = readFileSync('.claude/daily-report-quality.md', 'utf8');

  const memoryContext = {
    schema_version: memory.schema_version,
    last_updated: memory.last_updated,
    short_term: memory.short_term ?? null,
    long_term_featured_repos: memory.long_term?.featured_repos ?? [],
    recent_predictions: (memory.predictions ?? []).slice(0, 10),
  };

  return [
    agentPrompt,
    '',
    '---',
    '',
    '## Quality rules (must not violate)',
    '',
    qualityRules,
    '',
    '---',
    '',
    `## Today's date: ${date}`,
    '',
    '## Condensed source data',
    '',
    '```json',
    JSON.stringify(condensed, null, 2),
    '```',
    '',
    '## Memory context (previous days)',
    '',
    '```json',
    JSON.stringify(memoryContext, null, 2),
    '```',
    '',
    '---',
    '',
    '## Output instruction',
    '',
    'Produce EXACTLY one JSON object conforming to the ReportSchema described in the workflow above. The object MUST have `date` set to the date given above. Output ONLY the JSON — no preamble, no explanation, no code fences. Your entire response must be parseable by `JSON.parse` without any modification.',
  ].join('\n');
}

function buildMemoryPrompt({ date, report, memory }) {
  return [
    '# Memory update task',
    '',
    `You are updating the daily report memory state for ${date}. Given today's report and the current memory state, produce an updated memory object following these rules:`,
    '',
    '- Add newly featured repos to `short_term.featured_repos`; if a repo was already there, increment `times_featured`.',
    '- Promote any `short_term` entry whose `times_featured >= 3` into `long_term.featured_repos`.',
    '- Append one new entry to `short_term.key_observations` summarizing today (date + 1-2 sentence insight).',
    '- Drop `short_term.key_observations` entries older than 7 days.',
    '- Update `narrative_arcs` (extend existing arcs that continue, open a new arc only if the pattern is visible across multiple days).',
    '- Update `predictions` status where today provides evidence; do NOT add new predictions here (those come from the report itself).',
    '- Set `schema_version` to 2 and `last_updated` to the date above.',
    '',
    '## Current memory',
    '',
    '```json',
    JSON.stringify(memory, null, 2),
    '```',
    '',
    "## Today's report",
    '',
    '```json',
    JSON.stringify(report, null, 2),
    '```',
    '',
    '---',
    '',
    '## Output instruction',
    '',
    'Produce EXACTLY one JSON object conforming to MemorySchema. Output ONLY the JSON — no preamble, no code fences, no explanation. Your entire response must be parseable by `JSON.parse` without any modification.',
  ].join('\n');
}

export async function synthesizeReport({ date, condensed, memory }) {
  const prompt = buildReportPrompt({ date, condensed, memory });
  console.error(`[synthesize] report prompt: ${prompt.length} chars, calling claude -p...`);
  const { stdout } = await runClaude(prompt);
  return extractJson(stdout);
}

export async function synthesizeMemory({ date, report, memory }) {
  const prompt = buildMemoryPrompt({ date, report, memory });
  console.error(`[synthesize] memory prompt: ${prompt.length} chars, calling claude -p...`);
  const { stdout } = await runClaude(prompt);
  return extractJson(stdout);
}

// Exported for tests — allows mocking the claude subprocess
export const _internals = { runClaude, buildReportPrompt, buildMemoryPrompt };
