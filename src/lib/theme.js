// Theme loader — resolves theme.yaml + section manifests for the pipeline.
//
// Activated when FEATURE_THEME_BUNDLE=1. Callers pass the theme name
// (typically from ACTIVE_THEME env, default "ai-builder").
//
// Returns objects with absolute paths so downstream scripts and Node
// modules can read prompts / import schemas without re-resolving paths.

import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');

function themeDir(name) {
  return path.join(REPO_ROOT, 'themes', name);
}

async function fileExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function loadTheme(name) {
  const dir = themeDir(name);
  if (!(await fileExists(dir))) {
    throw new Error(`no such theme: ${name} (looked in ${dir})`);
  }
  const manifestPath = path.join(dir, 'theme.yaml');
  if (!(await fileExists(manifestPath))) {
    throw new Error(`theme ${name} missing theme.yaml`);
  }
  const manifest = YAML.parse(await readFile(manifestPath, 'utf8'));

  const promptPaths = {};
  for (const [key, rel] of Object.entries(manifest.prompt_files ?? {})) {
    promptPaths[key] = path.join(dir, rel);
  }

  let sources = null;
  if (manifest.sources_file) {
    const sourcesPath = path.join(dir, manifest.sources_file);
    sources = YAML.parse(await readFile(sourcesPath, 'utf8'));
  }

  let uiStrings = null;
  if (manifest.ui_strings_file) {
    const uiPath = path.join(dir, manifest.ui_strings_file);
    uiStrings = YAML.parse(await readFile(uiPath, 'utf8'));
  }

  return {
    name,
    dir,
    manifest,
    prompt_paths: promptPaths,
    sources,
    ui_strings: uiStrings,
    sections: manifest.sections ?? [],
    persona: manifest.persona,
    llm: manifest.llm,
  };
}

export async function listActiveSections(themeName) {
  const theme = await loadTheme(themeName);
  const declared = [...theme.sections].sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  const loaded = [];
  for (const decl of declared) {
    loaded.push(await loadSection(themeName, decl.id, theme));
  }
  return loaded;
}

export async function loadSection(themeName, sectionId, themeArg = null) {
  const theme = themeArg ?? (await loadTheme(themeName));
  const declared = (theme.sections ?? []).find((s) => s.id === sectionId);
  if (!declared) {
    throw new Error(`section "${sectionId}" not declared in theme "${themeName}"`);
  }
  const sectionDir = path.join(theme.dir, 'sections', sectionId);
  const manifestPath = path.join(sectionDir, 'manifest.yaml');
  if (!(await fileExists(manifestPath))) {
    throw new Error(`section "${sectionId}" missing manifest.yaml at ${manifestPath}`);
  }
  const manifest = YAML.parse(await readFile(manifestPath, 'utf8'));
  return {
    id: manifest.id,
    tab_label: manifest.tab_label,
    critical: manifest.critical,
    audience_split: manifest.audience_split,
    order: manifest.order,
    groups: manifest.groups ?? [],
    inputs: manifest.inputs ?? { required: [], optional: [] },
    paths: {
      manifest: manifestPath,
      curator_prompt: path.join(sectionDir, 'curator.md'),
      schema: path.join(sectionDir, 'schema.js'),
      partial: path.join(sectionDir, 'partial.njk'),
    },
    declared,
  };
}
